"""Buddy memory: search over your Obsidian vault, so characters remember your life.
Two kinds of search, combined:
- meaning ("smart") search: nomic-embed-text inside Tinfoil's attested enclave, through the local Tinfoil Proxy
  (the same path as the brain; nobody, Tinfoil included, can read the notes). Ollama on this Mac is used instead
  only if you happen to run it and Tinfoil isn't set up.
- keyword search on this Mac (nothing leaves it), so memory always works, even before Tinfoil is set up.
The index is stored next to Buddy's other private files (.memory_index.json, readable only by you)."""
import collections, json, math, operator, os, re, threading, time, urllib.request
import localcheck, tinfoilproxy

HERE = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.expanduser("~/Buddy")
INDEX = os.path.join(HERE, ".memory_index.json")
OLLAMA = "http://127.0.0.1:11434/api/embed"
EMBED_MODEL = "nomic-embed-text"
SKIP_DIRS = {".obsidian", ".trash", "templates", "skills", "system-prompts", "copilot-custom-prompts"}
SKIP_ROOT_FILES = {"AGENTS.md", "CLAUDE.md"}      # instruction files for AI coding tools that some vaults contain
CHUNK = 900

_lock = threading.Lock()
_write_lock = threading.Lock()   # one index write at a time (searches don't wait for it)
_index = {}  # path -> {"mtime": float, "chunks": [{"text": str, "vec": [float]}]}

_tokens = {}  # path -> (mtime, [Counter per chunk]) for keyword search (kept in memory only)
STATE = {"by": None, "error": ""}   # which meaning search works right now: "tinfoil", "ollama" or None

def _key():
    p = os.path.join(HERE, ".tinfoil_key")
    return open(p).read().strip() if os.path.exists(p) else ""

def _post(url, body, key=None, timeout=120):
    localcheck.check(url)                     # notes only ever go to a Tinfoil Proxy / Ollama that runs as you
    h = {"Content-Type": "application/json"}
    if key: h["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def _embed(texts, prefix, timeout=120):
    """Vectors for the texts, from Tinfoil's enclave (or local Ollama). Raises if neither is available."""
    inp = [prefix + t for t in texts]
    if _key():
        try:
            out = []
            for i in range(0, len(inp), 64):
                d = _post(tinfoilproxy.url() + "/embeddings", {"model": EMBED_MODEL, "input": inp[i:i + 64]}, _key(), timeout)["data"]
                out += [x["embedding"] for x in sorted(d, key=lambda x: x.get("index", 0))]
            STATE.update(by="tinfoil", error=""); return out
        except Exception as e:
            STATE["error"] = f"Tinfoil: {type(e).__name__}"
    try:
        out = _post(OLLAMA, {"model": EMBED_MODEL, "input": inp}, timeout=min(timeout, 60))["embeddings"]
        STATE.update(by="ollama"); return out
    except Exception:
        STATE["by"] = None
        raise

def _chunks(path):
    text = open(path, encoding="utf-8", errors="ignore").read().strip()
    if not text:
        return []
    name = os.path.relpath(path, VAULT)[:-3]
    parts, cur = [], ""
    for para in text.split("\n\n"):
        if len(cur) + len(para) > CHUNK and cur:
            parts.append(cur); cur = ""
        cur += para + "\n\n"
    if cur.strip():
        parts.append(cur)
    return [f"[{name}]\n{p.strip()}" for p in parts]

def _vault_files():
    for root, dirs, files in os.walk(VAULT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            if f.endswith(".md") and not (root == VAULT and f in SKIP_ROOT_FILES):
                yield os.path.join(root, f)

def refresh():
    """Index notes that changed (always, for keyword search) and add meaning vectors whenever the enclave is
    reachable; notes indexed while it wasn't get their vectors on a later round."""
    global _index
    seen, changed, down = set(), 0, False
    for p in _vault_files():
        seen.add(p)
        m = os.path.getmtime(p)
        e = _index.get(p)
        fresh = e and e["mtime"] == m
        if fresh and (down or all(c.get("vec") and e.get("by") == (STATE["by"] or e.get("by")) for c in e["chunks"])):
            continue
        ch = [c["text"] for c in e["chunks"]] if fresh else _chunks(p)
        vecs, by = [None] * len(ch), None
        if ch and not down:
            try: vecs, by = _embed(ch, "search_document: "), STATE["by"]
            except Exception: down = True                # try again next round; keyword search works meanwhile
        if fresh and by is None:
            continue
        with _lock:
            _index[p] = {"mtime": m, "by": by, "chunks": [{"text": t, "vec": v} for t, v in zip(ch, vecs)]}
        changed += 1
    with _lock:
        for p in list(_index):
            if p not in seen:
                del _index[p]; changed += 1
    if changed:
        _norms.clear()                                 # (lengths of vectors that are gone; recomputed as needed)
        _write()
    return changed

def _write():
    """Saves the index. Entries are replaced, never changed in place, so a copy taken under the lock is a consistent
    snapshot, and the (slow) writing happens without holding up searches."""
    with _write_lock:
        with _lock:
            snap = dict(_index)
        tmp = INDEX + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(fd, 0o600)                           # (also if an old .tmp was left with other permissions)
        with os.fdopen(fd, "w") as f:                  # note by note: one json.dumps of all of it would stop every
            f.write("{")                               # other thread (the voice, your call) for about a second
            for i, (p, e) in enumerate(snap.items()):
                f.write(("," if i else "") + json.dumps(p) + ":" + json.dumps(e))
            f.write("}")
        os.replace(tmp, INDEX)

_dot = getattr(math, "sumprod", None) or (lambda a, b: sum(map(operator.mul, a, b)))
_norms = {}   # id(vector) -> (vector, its length): computed once per vector, not on every search

def _norm(v):
    hit = _norms.get(id(v))
    if hit is None or hit[0] is not v:
        hit = _norms[id(v)] = (v, math.sqrt(_dot(v, v)))
    return hit[1]

def _cos(q, qn, v):
    return _dot(q, v) / (qn * _norm(v) + 1e-9)

def _allowed(path, folders, own=None, skip=None):
    """folders: vault-relative folders a character may know (None = everything except other characters' chats).
    own: the character's own chats folder (chats/<id>); old top-level chats belong to Buddy.
    skip: folders kept from the character ("everything except these")."""
    rel = os.path.relpath(path, VAULT).replace(os.sep, "/")
    if rel.startswith("chats/"):
        legacy = own == "chats/buddy" and rel.count("/") == 1
        if not (own and rel.startswith(own + "/")) and not legacy:
            return False
        return True
    if skip and any(rel.startswith(f.strip("/") + "/") for f in skip if f):
        return False
    if folders is None:
        return True
    return any(rel.startswith(f.strip("/") + "/") for f in folders if f)

def avoid_pattern(terms):
    """Words/phrases a character mustn't know about, as one regex: whole words, any spacing, either apostrophe;
    longer words also catch their endings (work -> working, Sarah -> Sarah's)."""
    alts = []
    for t in sorted({str(t).strip() for t in terms or [] if str(t).strip()}, key=len, reverse=True):
        a = re.escape(t).replace("\\ ", r"\s+").replace("'", "['\u2019]")
        alts.append(a + (r"\w*" if len(t) >= 4 else ""))
    return re.compile(r"(?<!\w)(?:" + "|".join(alts) + r")(?!\w)", re.I) if alts else None

def _banned_note(path, entry, banned):
    """A note that mentions one of them anywhere is kept from the character entirely (its own chats only lose the
    parts that mention it, so one mention doesn't hide a whole day of talking)."""
    if not banned or os.path.relpath(path, VAULT).replace(os.sep, "/").startswith("chats/"):
        return False
    return any(banned.search(c["text"]) for c in entry["chunks"])

STOP = set("""a an and are as at be but by for from had has have he her his i if in into is it its me my of on or our
she so that the their them there they this to was we were what when where which who will with you your am do did not
just about how why can could would should been being than then too very also any all""".split())

def _words(text):
    return [w for w in re.findall(r"\w+", text.lower()) if w not in STOP and len(w) > 1]

def _counts(path, entry):
    """Word counts per chunk (cached until the note changes)."""
    c = _tokens.get(path)
    if not c or c[0] != entry["mtime"]:
        c = (entry["mtime"], [collections.Counter(_words(x["text"])) for x in entry["chunks"]])
        _tokens[path] = c
    return c[1]

def _keyword_ranked(query, cands):
    """BM25 over the allowed chunks: [(score, text)], best first. Needs at least one uncommon word in common."""
    q = set(_words(query))
    if not q or not cands:
        return []
    n = len(cands); avg = sum(sum(c.values()) for c, _ in cands) / n or 1
    df = collections.Counter(w for c, _ in cands for w in q if w in c)
    out = []
    for c, text in cands:
        L = sum(c.values()) or 1; s = 0.0
        for w in q:
            f = c.get(w, 0)
            if f and (n < 20 or df[w] / n < 0.5):        # words in most notes (of many) say nothing
                s += math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5)) * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * L / avg))
        if s > 0:
            out.append((s, text))
    return sorted(out, reverse=True)

def search(query, k=5, exclude=None, min_score=0.45, folders=None, own=None, skip=None, avoid=None, meaning=True,
           embed_timeout=8):
    """Returns the k most relevant note snippets for the query (only from `folders` if given, never from `skip`,
    and never a snippet mentioning one of the `avoid` words/phrases). meaning=False: keyword search only (on this
    Mac, in milliseconds)."""
    if folders is not None and not folders and not own:
        return []
    banned = avoid_pattern(avoid)
    with _lock:
        ok = [(p, e) for p, e in _index.items()
              if p != exclude and _allowed(p, folders, own, skip) and not _banned_note(p, e, banned)]
        chunks = [(p, e, i, c) for p, e in ok for i, c in enumerate(e["chunks"])
                  if not banned or not banned.search(c["text"])]
        cands = [(_counts(p, e)[i], c["text"]) for p, e, i, c in chunks]
    ranks = collections.defaultdict(float)             # the two searches combined (reciprocal rank fusion)
    for r, (s, t) in enumerate(_keyword_ranked(query, cands)[:50]):
        ranks[t] += 1 / (60 + r)
    vecs = [(e.get("by"), c) for p, e, i, c in chunks if c.get("vec")] if meaning else []
    if vecs:
        try:
            qv = _embed([query], "search_query: ", timeout=embed_timeout)[0]; by = STATE["by"]   # never waits long
            qn = math.sqrt(_dot(qv, qv))
            close = sorted(((_cos(qv, qn, c["vec"]), c["text"]) for b, c in vecs if b == by or (b is None and by == "ollama")),
                           reverse=True)
            for r, (s, t) in enumerate(x for x in close[:50] if x[0] >= min_score):
                ranks[t] += 1 / (60 + r) + 0.0001       # (a tie goes to meaning)
        except Exception:
            pass                                       # enclave not reachable right now: keywords only
    return [t for t, _ in sorted(ranks.items(), key=lambda x: -x[1])[:k]]

def folders():
    """Top-level note folders (names only) that can be given to characters."""
    try:
        return sorted(d for d in os.listdir(VAULT) if os.path.isdir(os.path.join(VAULT, d))
                      and d not in SKIP_DIRS and d != "chats" and not d.startswith("."))   # chats: per character
    except OSError:
        return []

def forget_chats(cid):
    """Drops a character's saved chats from the index at once (after Delete conversation)."""
    def theirs(p):
        rel = os.path.relpath(p, VAULT).replace(os.sep, "/")
        return rel.startswith(f"chats/{cid}/") or (cid == "buddy" and rel.startswith("chats/") and rel.count("/") == 1)
    with _lock:
        gone = [p for p in _index if theirs(p)]
        for p in gone:
            _index.pop(p, None); _tokens.pop(p, None)
    if gone:
        _write()

def stats():
    with _lock:
        return len(_index), sum(len(e["chunks"]) for e in _index.values())

def health():
    """For the app: how many notes, and whether meaning search is on (and where)."""
    with _lock:
        smart = sum(1 for e in _index.values() if e.get("by") and all(c.get("vec") for c in e["chunks"]))
        return {"notes": len(_index), "smart_notes": smart, "smart_by": STATE["by"], "error": STATE["error"]}

def start_background(every=180):
    global _index
    if os.path.exists(INDEX):
        try:
            _index = json.load(open(INDEX))
        except Exception:
            _index = {}
    def loop():
        while True:
            try:
                refresh()
            except Exception:
                pass
            # until smart search works (e.g. Tinfoil's proxy is still verifying at start), try again soon
            time.sleep(30 if _key() and STATE["by"] is None else every)
    threading.Thread(target=loop, daemon=True).start()
