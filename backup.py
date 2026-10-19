#!/usr/bin/env python3
"""Backups: an encrypted copy of what makes Buddy yours, written once a day into a folder you already trust (iCloud
Drive, Dropbox, Google Drive, OneDrive, a USB drive), and restoring it on this Mac or a new one.

- No Buddy server, no account, no network: this module opens no sockets. It reads Buddy's own private files and your
  notes, and writes one file a day into <your folder>/Buddy Backups/, named only by its date.
- Only you can open them: each file is encrypted here with its own random key, locked by your recovery key. Buddy
  shows the recovery key once; a copy stays in .backup_key (0600, git-ignored) so backups run by themselves. Lose the
  key and nobody can open the backups, not even us.
- What goes in is decided by DATA / KEYS / NEVER below (the selftest fails if a git-ignored file is in none of them).
- Restoring checks the whole file (every chunk, the last-chunk flag, the archive's end and counts) into a staging copy
  before anything is touched; what Buddy had is moved to "~/Buddy before restore <time>", never deleted. Buddy deletes
  only backup files it wrote itself on this Mac.

File format v1 (big-endian):
  header (87 bytes) = "BUDDYBAK" | version 1 | flags 0 | log2 chunk size (20) | 0 | key id (8) | wrap nonce (12) |
                      AES-256-GCM(KEK, file key, aad = header[0:32]) (48) | STREAM nonce prefix (7)
  body = STREAM (Hoang-Reyhanitabar-Rogaway-Vizar): AES-256-GCM(file key) chunks of 2^log2 plaintext bytes,
         nonce = prefix | counter (4) | last (1), aad = SHA-256(header). Only the final chunk has last = 1, so a file
         cut anywhere, or with chunks dropped, swapped or added, doesn't open.
  key id = HKDF-SHA256(recovery key, "buddy-backup v1 key-id")[:8]; KEK = HKDF-SHA256(recovery key, "buddy-backup v1 wrap")
  plaintext = PAX tar: manifest.json, buddy/<Buddy's files>, notes/<your notes>, end.json (what was written, checked on
              restore). Members carry no account names; text files are zlib'd one by one (pax BUDDY.z, BUDDY.size);
              mtimes are kept to the nanosecond (pax BUDDY.mtime).
Check it all with fake data in temp folders: python3 backup.py --selftest"""
import datetime, errno, fnmatch, hashlib, hmac, io, json, os, posixpath, re, secrets, shutil, stat, struct, sys, \
    tarfile, tempfile, threading, time, zlib
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:                                     # (only Buddy's own .venv has it, through pywebpush)
    AESGCM = None
import recovery                                         # the recovery key's format (shared with Buddy for phones' sync key)

SRC = os.path.dirname(os.path.abspath(__file__))        # Buddy's code (the selftest reads .gitignore from here)
HERE = SRC                                              # Buddy's private files (the selftest points these elsewhere)
VAULT = os.path.expanduser("~/Buddy")
KEY_FILE = os.path.join(HERE, ".backup_key")
STATE_FILE = os.path.join(HERE, ".backup_state.json")
RESTORE = os.path.join(HERE, ".restore")

def use_paths(here, vault):
    global HERE, VAULT, KEY_FILE, STATE_FILE, RESTORE
    HERE, VAULT = here, vault
    KEY_FILE, STATE_FILE, RESTORE = (os.path.join(here, n) for n in (".backup_key", ".backup_state.json", ".restore"))

# What a backup holds, by the exact names .gitignore uses (paths in Buddy's folder; only those that exist).
# New private files must be added to one of these three (the selftest checks every .gitignore line and PRIVATE_FILES).
# (A Buddy that doesn't know a top-level name in a backup says it was made by a newer Buddy, so DATA can grow in v1.)
DATA = (".thread.json", "my-characters/", ".media/", "config.local.json", "*.local.txt",
        ".facts_state.json", ".gens.json")                  # (the last two: from the facts and phone-mode work)
KEYS = (".tinfoil_key", ".phala_key", ".near_key", ".cloudflare_key")   # only with "Include my API keys"
NEVER = (".mac_token", ".devices.json", ".tailnet/", ".vapid.json", ".push_subs.json",   # pairing + push: never
         ".backup_key", ".backup_state.json", ".restore/", ".memory_index.json", ".memory_index.json.tmp",
         ".thread.json.tmp", ".tinfoil_cache_secret", ".tinfoil_proxy.pid", ".update.log", ".update_bad",
         ".update_result", ".update_from", ".release_signers*", ".update.lock/", ".update.flock", ".bin/", ".venv/",
         "__pycache__/", "web/node_modules/", "web/models/*.vrm", "web/models/previews/", "voice-samples/", "app/*.app",
         ".DS_Store", "*.tmp", "*.key", ".env", "web/icons/", "animations/",
         "scripts/vendor/tinfoil/node_modules/", "scripts/vendor/tinfoil/out/")
TEXT = {"md", "txt", "json", "canvas", "csv", "tsv", "html", "htm", "css", "js", "svg", "xml", "yml", "yaml", "base", "log"}
ZMAX = 32 << 20                # text files up to this are zlib'd (whole, in memory)
SMALL = 8 << 20                # other files up to this are read whole first (so one that changes while read is skipped)
MAGIC, HEAD, LOG2 = b"BUDDYBAK", 87, 20
DIRNAME, EXT = "Buddy Backups", ".buddybackup"
NAME_RE = re.compile(r"(\d{4}-\d{2}-\d{2})(?:-(\d{1,2}))?\.buddybackup")
PART_RE = re.compile(r"\.(?:[0-9a-f]{16}\.part|probe-[0-9a-f]{16})")
MEDIA_RE = re.compile(r"[0-9a-f]{32}\.(?:jpg|png)")
CHAR_RE = re.compile(r"[a-z0-9-]{1,40}\.(?:json|img|prev|seed|wall)")   # a character, their picture (+ the one before, its seed), wallpaper
LIFE_RE = re.compile(r"(?:[a-z0-9-]{1,40}|_world)\.json")       # a character's life, or who knows whom
B32 = recovery.B32                                      # Crockford base32: no I, L, O, U
KEEP = ("backup", "phone_tailnet", "sync_e2e")           # settings that belong to this Mac, not to a backup

WHY = ("Backups need Buddy's own Python environment (it has the encryption library). In Terminal run: "
       "zsh ~/BuddyFace/scripts/deps.sh — then quit Buddy and open it again.")
NOT_BACKUP = "That isn't a Buddy backup."
NEWER = "This backup was made by a newer Buddy. Update Buddy first, then try again."
WRONG_KEY = "That recovery key doesn't open this backup (is it from an older key?)."
DAMAGED = ("This backup is damaged or incomplete. If it's in iCloud Drive or Dropbox, wait until it has finished "
           "downloading and try again.")
INCOMPLETE = recovery.INCOMPLETE
TYPO = recovery.TYPO
BUSY = "A backup is running right now. Try again in a minute."

class Problem(ValueError): pass                      # words for people (400), passed through as they are

class Damaged(Problem):
    def __init__(self, msg=DAMAGED): super().__init__(msg)

class _Cancelled(Exception): pass

# ---------- keys (recovery.py: the format; backup's own check tag, recovery.BACKUP) ----------
hkdf = recovery.hkdf                                    # HKDF-SHA256 (RFC 5869), salt = 32 zero bytes

def kid(K): return hkdf(K, b"buddy-backup v1 key-id", 8)      # says "wrong key" apart from "damaged"
def kek(K): return hkdf(K, b"buddy-backup v1 wrap")            # locks each file's own random key

def key_text(K):
    """The recovery key as people see it: 256 bits + a 24-bit typo check, Crockford base32, 14 groups of 4."""
    return recovery.key_text(K, recovery.BACKUP)

_norm = recovery.norm

def parse_key(text):
    """A backup recovery key as typed -> its 32 bytes (INCOMPLETE, TYPO, or a sync key: recovery.NOT_BACKUP)."""
    return recovery.parse_key(text, recovery.BACKUP)

def saved_key():
    try:
        h = open(KEY_FILE).read().strip()
        return bytes.fromhex(h) if len(h) == 64 else None
    except (OSError, ValueError):
        return None

def _atomic(path, data, mode=0o600):
    """Writes a file whole or not at all (temp file in the same folder, fsync, rename)."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data if isinstance(data, bytes) else data.encode()); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, mode); os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.remove(tmp)

# ---------- the file format ----------
class Enc:
    """Header, then STREAM chunks, to out (anything with write). close() seals the last chunk."""
    def __init__(self, out, K, log2=None):
        log2 = log2 or LOG2
        self.out, self.C, self.i, self.buf = out, 1 << log2, 0, bytearray()
        fk, wn, self.prefix = secrets.token_bytes(32), secrets.token_bytes(12), secrets.token_bytes(7)
        head = MAGIC + bytes([1, 0, log2, 0]) + kid(K) + wn
        head += AESGCM(kek(K)).encrypt(wn, fk, head) + self.prefix
        assert len(head) == HEAD
        out.write(head); self.g, self.aad = AESGCM(fk), hashlib.sha256(head).digest()
    def _emit(self, pt, last):
        if self.i >= 1 << 32: raise ValueError("backup too big")
        self.out.write(self.g.encrypt(self.prefix + struct.pack(">IB", self.i, last), bytes(pt), self.aad)); self.i += 1
    def write(self, b):
        self.buf += b
        while len(self.buf) > self.C:                      # a full chunk only when more follows (the last is sealed last=1)
            self._emit(self.buf[:self.C], 0); del self.buf[:self.C]
        return len(b)
    def close(self):
        self._emit(self.buf, 1); self.buf = bytearray()

class Dec:
    """Reads what Enc wrote, checking every chunk as it goes; read() returns b"" only at the true end."""
    def __init__(self, f, K):
        head = f.read(HEAD)
        if len(head) < 12 or head[:8] != MAGIC: raise Problem(NOT_BACKUP)
        if head[8] != 1: raise Problem(NEWER)
        if len(head) < HEAD or head[9] or head[11] or not 10 <= head[10] <= 24: raise Damaged()
        if not hmac.compare_digest(head[12:20], kid(K)): raise Problem(WRONG_KEY)
        try: fk = AESGCM(kek(K)).decrypt(head[20:32], head[32:80], head[:32])
        except Exception: raise Damaged()
        self.f, self.g, self.prefix, self.aad = f, AESGCM(fk), head[80:87], hashlib.sha256(head).digest()
        self.CT, self.i, self.cur, self.pos, self.done = (1 << head[10]) + 16, 0, b"", 0, False
        self.nxt = f.read(self.CT); self.got = HEAD + len(self.nxt)
    def _pull(self):
        cur = self.nxt
        if len(cur) < 16: raise Damaged()                   # (even an empty backup has one sealed chunk)
        self.nxt = self.f.read(self.CT) if len(cur) == self.CT else b""
        self.got += len(self.nxt)
        last = not self.nxt                                 # one chunk of lookahead: the one before the end must say "last"
        try: pt = self.g.decrypt(self.prefix + struct.pack(">IB", self.i, last), cur, self.aad)
        except Exception: raise Damaged()
        self.i += 1; self.done = last; self.cur, self.pos = pt, 0
    def read(self, n=-1):
        out = []
        while n:
            if self.pos >= len(self.cur):
                if self.done: break
                self._pull(); continue
            take = len(self.cur) - self.pos if n < 0 else min(n, len(self.cur) - self.pos)
            out.append(self.cur[self.pos:self.pos + take]); self.pos += take
            if n > 0: n -= take
        return b"".join(out)

class _Out:
    """The file a backup goes to; a short pause after each chunk so chats and calls stay smooth meanwhile."""
    def __init__(self, f): self.f = f
    def write(self, b):
        self.f.write(b)
        if len(b) > 65536: time.sleep(0.001)
        return len(b)

class _Exactly:
    """A big file streamed into the archive: exactly the size it had (zeros if it shrank; then it's marked bad)."""
    def __init__(self, f, size): self.f, self.left, self.short = f, size, False
    def read(self, n=-1):
        n = self.left if n < 0 else min(n, self.left)
        b = self.f.read(n) if n else b""
        if len(b) < n: self.short = True; b += bytes(n - len(b))
        self.left -= len(b)
        return b

# ---------- what goes in ----------
def _data_name(name, keys=True):
    """'file' / 'dir' if this top-level name in Buddy's folder belongs in backups, else None."""
    for pat in DATA + (KEYS if keys else ()):
        if pat.endswith("/"):
            if name == pat[:-1]: return "dir"
        elif fnmatch.fnmatchcase(name, pat):
            return "file"
    return None

def _buddy_ok(rel, isdir, keys=True):
    """May buddy/<rel> be in a backup (and so be restored)? The same rule both ways."""
    parts = rel.split("/")
    kind = _data_name(parts[0], keys)
    if kind == "file": return len(parts) == 1 and not isdir
    if kind != "dir": return False
    if len(parts) == 1: return isdir
    if parts[0] == ".media": return len(parts) == 2 and not isdir and bool(MEDIA_RE.fullmatch(parts[1]))
    if parts[0] == "my-characters":                         # <id>.json/.img/.prev/.seed/.wall, lives/<id>.json
        if len(parts) == 2: return parts[1] == "lives" if isdir else bool(CHAR_RE.fullmatch(parts[1]))
        return len(parts) == 3 and parts[1] == "lives" and not isdir and bool(LIFE_RE.fullmatch(parts[2]))
    return not parts[-1].endswith(".tmp")                   # (a folder someone adds to DATA later: all but temp files)

def _home(): return os.path.expanduser("~")

def _inside(p, root): return p == root or p.startswith(root.rstrip("/") + "/")

def _vault_ok():
    """The notes folder, if it's a sane one to copy and to put back (never your whole home folder)."""
    v = os.path.realpath(VAULT)
    if not os.path.isdir(v) or v in ("/", os.path.realpath(_home())) or _inside(os.path.realpath(HERE), v):
        return None
    return v

def _walk(root, arc, keep_dir, keep_file, skip=()):
    """(arcname, path, lstat) for root and everything under it: real files and folders only, never links."""
    out = []
    try: out.append((arc, root, os.lstat(root)))
    except OSError: return out
    for dirpath, dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        base = arc if rel == "." else arc + "/" + rel.replace(os.sep, "/")
        keep = []
        for d in sorted(dirs):
            p = os.path.join(dirpath, d)
            try: st = os.lstat(p)
            except OSError: continue
            if stat.S_ISDIR(st.st_mode) and keep_dir(base + "/" + d) and os.path.realpath(p) not in skip:
                keep.append(d); out.append((base + "/" + d, p, st))
        dirs[:] = keep
        for f in sorted(files):
            p = os.path.join(dirpath, f)
            try: st = os.lstat(p)
            except OSError: continue
            if stat.S_ISREG(st.st_mode) and keep_file(base + "/" + f):
                out.append((base + "/" + f, p, st))
    return out

def _plan(notes, keys, dest=""):
    """Everything that would go into a backup now: [(arcname, path, lstat)], folders before what's in them."""
    out = [("buddy", HERE, os.lstat(HERE))]
    for name in sorted(os.listdir(HERE)):
        kind, p = _data_name(name, keys), os.path.join(HERE, name)
        if not kind: continue
        try: st = os.lstat(p)
        except OSError: continue
        if kind == "file" and stat.S_ISREG(st.st_mode) and _buddy_ok(name, False, keys):
            out.append(("buddy/" + name, p, st))
        elif kind == "dir" and stat.S_ISDIR(st.st_mode):
            ok = lambda a, d: _buddy_ok(a[len("buddy/"):], d, keys)
            out += _walk(p, "buddy/" + name, lambda a: ok(a, True), lambda a: ok(a, False))
    v = _vault_ok() if notes else None
    if v:
        skip = {os.path.realpath(HERE), os.path.realpath(dest) if dest else ""}
        out += _walk(v, "notes", lambda a: a.rsplit("/", 1)[-1] not in (".trash", ".Trash"),
                     lambda a: a.rsplit("/", 1)[-1] != ".DS_Store", skip)
    return out

def _fingerprint(entries, notes, keys, K):
    h = hashlib.sha256(json.dumps([notes, keys, kid(K).hex()]).encode())
    for arc, _, st in sorted(entries, key=lambda e: e[0]):
        reg = stat.S_ISREG(st.st_mode)                     # (folders by name only: their times change all the time)
        h.update(f"{arc}\0{st.st_size if reg else -1}\0{st.st_mtime_ns if reg else 0}\n".encode())
    return h.hexdigest()

def _member(name, mtime_ns=None, isdir=False):
    ti = tarfile.TarInfo(name)
    ti.uid = ti.gid = 0; ti.uname = ti.gname = ""                     # no account names
    ns = mtime_ns if mtime_ns is not None else time.time_ns()
    ti.mtime, ti.pax_headers = ns // 10**9, {"BUDDY.mtime": str(ns)}
    if isdir: ti.type, ti.mode = tarfile.DIRTYPE, 0o700
    else: ti.mode = 0o600
    return ti

def _add(t, arc, path, st0, c):
    """One file or folder into the archive; counts in c. A file that's gone or changing right now is skipped."""
    if stat.S_ISDIR(st0.st_mode):
        t.addfile(_member(arc, st0.st_mtime_ns, isdir=True)); return
    base = arc.rsplit("/", 1)[-1]
    text = "." in base and base.rsplit(".", 1)[1].lower() in TEXT
    try: fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError: c["skipped"] += 1; return
    with os.fdopen(fd, "rb") as src:
        st = os.fstat(src.fileno())
        if not stat.S_ISREG(st.st_mode): c["skipped"] += 1; return
        if st.st_size <= (ZMAX if text else SMALL):
            for _ in range(3):                              # read it whole; again if it changed meanwhile
                src.seek(0); data = src.read(st.st_size + 1); st2 = os.fstat(src.fileno())
                if len(data) == st.st_size and (st2.st_size, st2.st_mtime_ns) == (st.st_size, st.st_mtime_ns): break
                st = st2
            else:
                c["skipped"] += 1; return                    # (being written right now: it's in the next one)
            raw, ti = data, _member(arc, st.st_mtime_ns)
            if text:
                z = zlib.compress(data, 6)
                if len(z) < len(data): ti.pax_headers.update({"BUDDY.z": "1", "BUDDY.size": str(len(data))}); data = z
            ti.size = len(data); t.addfile(ti, io.BytesIO(data))
            if arc == "buddy/.thread.json":
                try: c["messages"] = len(json.loads(raw))
                except ValueError: pass
        else:                                               # big (videos, PDFs): streamed as it is
            ti = _member(arc, st.st_mtime_ns); ti.size = st.st_size
            w = _Exactly(src, st.st_size); t.addfile(ti, w); st2 = os.fstat(src.fileno())
            if w.short or (st2.st_size, st2.st_mtime_ns) != (st.st_size, st.st_mtime_ns):
                c["bad"].append(arc); c["skipped"] += 1; return    # (the restore drops it; next time it's whole)
    part = arc.split("/", 1)[0]
    c["files"] += 1; c["bytes"][part] += st.st_size; _prog["files"] = c["files"]; _prog["bytes"] += st.st_size
    if re.fullmatch(r"buddy/my-characters/[^/]+\.json", arc):
        c["characters"] += 1; c["buddy_json"] = c["buddy_json"] or arc.endswith("/buddy.json")
    elif arc.startswith("buddy/.media/"): c["photos"] += 1
    elif part == "notes" and arc.lower().endswith(".md"): c["notes"] += 1

def _put(t, name, obj):
    data = json.dumps(obj).encode(); ti = _member(name); ti.size = len(data); t.addfile(ti, io.BytesIO(data))

def write_archive(f, K, entries, notes, keys, log2=None):
    """manifest.json, the members, end.json: tar -> STREAM -> f. Returns end.json's contents."""
    e = Enc(_Out(f), K, log2 or LOG2)
    t = tarfile.open(fileobj=e, mode="w|", format=tarfile.PAX_FORMAT)
    try:
        planned = {"buddy": 0, "notes": 0}
        for arc, _, st in entries:
            if stat.S_ISREG(st.st_mode): planned[arc.split("/", 1)[0]] += st.st_size
        _put(t, "manifest.json", {"format": 1, "made": time.time(), "notes": bool(notes), "keys": bool(keys), "bytes": planned})
        c = {"files": 0, "bytes": {"buddy": 0, "notes": 0}, "messages": 0, "characters": 0, "photos": 0, "notes": 0,
             "skipped": 0, "bad": [], "buddy_json": False}
        for arc, path, st in entries:
            _add(t, arc, path, st, c); t.members.clear()   # (tarfile keeps every header otherwise: memory)
        end = {"files": c["files"], "bytes": c["bytes"], "skipped": c["skipped"], "bad": c["bad"],
               "counts": {"messages": c["messages"], "characters": c["characters"] + (0 if c["buddy_json"] else 1),
                          "photos": c["photos"], "notes": c["notes"] if notes else None}}
        _put(t, "end.json", end)
        t.close(); e.close()
    except BaseException:                                   # (e.g. the drive is full: the .part is thrown away, and
        t.fileobj.closed = True                             #  tarfile mustn't write to it later when it's collected)
        raise
    return end

# ---------- reading one back ----------
def _check_member(m, man):
    """(part, isdir) for an allowed member, else Damaged: no paths out of place, no links, only what backups hold."""
    n = m.name
    if (not n or "\0" in n or n.startswith("/") or posixpath.normpath(n) != n or ".." in n.split("/")
            or "\\" in n.split("/", 1)[0]):
        raise Damaged()
    isdir = m.type == tarfile.DIRTYPE
    if not isdir and m.type not in (tarfile.REGTYPE, tarfile.AREGTYPE): raise Damaged()
    part, _, rel = n.partition("/")
    if part == "notes":
        if not man.get("notes") or (not rel and not isdir): raise Damaged()     # (the notes folder itself is a folder)
    elif part == "buddy":
        if (not rel and not isdir) or (rel and not _buddy_ok(rel, isdir, keys=bool(man.get("keys")))):
            top = rel.split("/", 1)[0]                      # a name this Buddy doesn't know at all: a newer one added it
            if rel and not _data_name(top) and not any(fnmatch.fnmatchcase(top, x.rstrip("/")) for x in NEVER):
                raise Problem(NEWER)
            raise Damaged()
    else:
        raise Damaged()
    return part, isdir

def _int(s, lo=0, hi=1 << 62):
    v = int(str(s))
    if not lo <= v <= hi: raise Damaged()
    return v

def _space(man, out):
    """Enough free room for the staging copy (a bit more than the backup's size), per disk."""
    need = {}
    for part, root in out.items():
        b = _int((man.get("bytes") or {}).get(part, 0))
        if part == "notes" and not man.get("notes"): continue
        dev = os.stat(root).st_dev
        r, n = need.get(dev, (root, 0)); need[dev] = (r, n + int(b * 1.1) + 100_000_000)
    for root, n in need.values():
        if shutil.disk_usage(root).free < n:
            raise Problem(f"There isn't enough free space to restore this backup (it needs about {human(n)}).")

def read_archive(path, K, out=None, job=None):
    """Decrypts and checks a whole backup. out = {"buddy": dir, "notes": dir} to unpack into (members land at
    <dir>/<member name>), or None to only check it. Returns (manifest, end). Raises ValueError with words for people."""
    size = max(1, os.path.getsize(path))
    with open(path, "rb") as f:
        d = Dec(f, K)
        try:
            t = tarfile.open(fileobj=d, mode="r|")
            m = t.next()
            if m is None or m.name != "manifest.json" or not m.isreg() or m.size > 65536: raise Damaged()
            man = json.loads(t.extractfile(m).read(m.size))
            if not isinstance(man, dict) or not isinstance(man.get("format"), int): raise Damaged()
            if man["format"] != 1: raise Problem(NEWER) if man["format"] > 1 else Damaged()
            if out: _space(man, out)
            got, end, dirs, big = {"files": 0, "bytes": {"buddy": 0, "notes": 0}}, None, [], {}
            while True:
                t.members.clear()                             # (tarfile keeps every header otherwise: memory)
                m = t.next()
                if m is None: break
                if job is not None:
                    if job.get("cancel"): raise _Cancelled()
                    job["done"] = min(0.99, d.got / size)
                if end is not None: raise Damaged()          # nothing may follow end.json
                if m.name == "end.json" and m.isreg() and m.size <= 1 << 20:
                    end = json.loads(t.extractfile(m).read(m.size)); continue
                part, isdir = _check_member(m, man)
                ns = _int(m.pax_headers.get("BUDDY.mtime", m.mtime * 10**9))
                p = os.path.join(out[part], m.name) if out else None
                if isdir:
                    if p:
                        os.makedirs(p, mode=0o700, exist_ok=True)
                        if os.path.islink(p) or not os.path.isdir(p): raise Damaged()
                        dirs.append((p, ns))
                    continue
                z = m.pax_headers.get("BUDDY.z") == "1"
                n = _int(m.pax_headers["BUDDY.size"], 0, ZMAX) if z else m.size
                if z and m.size > ZMAX + (ZMAX >> 8) + 4096: raise Damaged()
                src = t.extractfile(m)
                w = None
                if p:
                    os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
                    try: w = os.fdopen(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600), "wb")
                    except FileExistsError: raise Damaged()     # (the same name twice)
                try:
                    if z:
                        dz = zlib.decompressobj(); raw = dz.decompress(src.read(m.size), n + 1)
                        if len(raw) != n or not dz.eof or dz.unused_data or dz.unconsumed_tail: raise Damaged()
                        if w: w.write(raw)
                    elif w:
                        left = m.size
                        while left:
                            b = src.read(min(1 << 20, left))
                            if not b: raise Damaged()
                            w.write(b); left -= len(b)
                            if job is not None:                 # (a big video: progress and cancel as it goes)
                                if job.get("cancel"): raise _Cancelled()
                                job["done"] = min(0.99, d.got / size)
                finally:
                    if w: w.close()
                if p: os.utime(p, ns=(ns, ns))
                if not z and m.size > SMALL: big[m.name] = (p, m.size)
                got["files"] += 1; got["bytes"][part] += n
            if not isinstance(end, dict): raise Damaged()
            while d.read(1 << 20): pass                       # the tar's padding: then the stream must be at its end
            if not d.done: raise Damaged()
            for name in end.get("bad") or []:                 # big files that changed while they were copied
                if name not in big: raise Damaged()
                bp, bn = big.pop(name)
                if bp: os.remove(bp)
                got["files"] -= 1; got["bytes"][name.split("/", 1)[0]] -= bn
            if end.get("files") != got["files"] or end.get("bytes") != got["bytes"]: raise Damaged()
            for p, ns in reversed(dirs):                      # (folders last: filling them changed their times)
                os.utime(p, ns=(ns, ns))
            return man, end
        except (NotADirectoryError, IsADirectoryError, FileExistsError):
            raise Damaged()                                   # (names that clash: not what Buddy writes)
        except (Problem, _Cancelled, OSError):
            raise
        except Exception:                                     # anything else odd inside = not a backup we can trust
            raise Damaged()

# ---------- state (this Mac only: never in a backup) ----------
_slock = threading.RLock()
def _state():
    try:
        st = json.load(open(STATE_FILE))
        return st if isinstance(st, dict) else {}
    except (OSError, ValueError):
        return {}

def _update(fn):
    with _slock:
        st = _state(); fn(st); _atomic(STATE_FILE, json.dumps(st, indent=1))
        return st

_env = {"cfg": lambda: {}, "save_cfg": None, "synced_by": None, "busy": lambda: False, "idle": lambda: 0}
_jlock = threading.Lock()
_job = {"kind": None}                  # "backup" | "inspect" | "restore" (one at a time)
_prog = {"files": 0, "bytes": 0}
_pending = {}                          # a recovery key shown but not confirmed yet: memory only, 15 minutes

def _bcfg():
    b = _env["cfg"]().get("backup")
    return b if isinstance(b, dict) else {}

def _set_bcfg(**kw):
    _env["save_cfg"](backup={**_bcfg(), **kw})

def _dir():
    d = _bcfg().get("dir")
    return os.path.expanduser(d) if isinstance(d, str) and d else ""

def _stored(p):                        # "~/…" under the home folder, so it still fits a new Mac with another user name
    h = _home()
    return "~" + p[len(h):] if _inside(p, h) else p

def _volumes(): return os.environ.get("BUDDY_VOLUMES", "/Volumes")   # (tests point it elsewhere)

def _synced(p):
    if _env["synced_by"]:
        return _env["synced_by"](p)
    h, r = _home(), os.path.realpath(p)                     # (standalone: the same idea as buddy_server.synced_by)
    if r.startswith(h + "/Library/CloudStorage/"):
        n = re.split(r"[-_]", r[len(h) + 22:].split("/")[0])[0]
        return {"GoogleDrive": "Google Drive", "": "a cloud service"}.get(n, n)
    return "iCloud Drive" if r.startswith(h + "/Library/Mobile Documents/") else ""

def _place(p):
    """(label, "cloud" | "drive" | "local") for a folder. Paths only."""
    r, v = os.path.realpath(p), os.path.realpath(_volumes())
    if r.startswith(v + "/"): return r[len(v) + 1:].split("/")[0], "drive"
    s = _synced(r)
    return (s, "cloud") if s else ("This Mac", "local")

def _err(e, verb="make the backup"):
    n = getattr(e, "errno", None)
    if n == errno.ENOENT: return "The backup folder isn't there (is the drive connected, or was the folder moved?)"
    if n in (errno.EACCES, errno.EPERM):
        return ("macOS didn't let Buddy write there. Allow Buddy in System Settings → Privacy & Security → Files & "
                "Folders, or pick another folder.")
    if n in (errno.ENOSPC, getattr(errno, "EDQUOT", -1)): return "There isn't enough space in the backup folder."
    if n == errno.EFBIG: return "That drive can't hold files this big (FAT32 drives stop at 4 GB). Use a Mac or exFAT drive."
    if n == errno.EROFS: return "That drive is read-only."
    return f"Couldn't {verb} ({getattr(e, 'strerror', None) or type(e).__name__})."

# ---------- making backups ----------
def probe(path):
    """A folder picked for backups: checked, its "Buddy Backups" made, and a test file written (this is when macOS
    asks about iCloud Drive / Dropbox / a drive, while you're looking). Returns the backup folder."""
    if not isinstance(path, str) or not path.strip() or len(path) > 1024 or "\0" in path:
        raise ValueError("Pick a folder.")
    p = os.path.expanduser(path.strip())
    if not os.path.isabs(p): raise ValueError("Pick a folder.")
    p = os.path.realpath(p)
    if not os.path.isdir(p): raise ValueError("That folder doesn't exist.")
    t = p if os.path.basename(p) == DIRNAME else os.path.join(p, DIRNAME)
    if _inside(t, os.path.realpath(VAULT)): raise ValueError("Pick a folder outside your notes folder: the backup includes your notes.")
    if _inside(t, os.path.realpath(HERE)): raise ValueError("Pick a folder outside Buddy's own folder.")
    try:
        os.makedirs(t, mode=0o700, exist_ok=True)
        tp = os.path.join(t, ".probe-" + secrets.token_hex(8))
        fd = os.open(tp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try: os.write(fd, b"buddy"); os.fsync(fd)
        finally: os.close(fd); os.remove(tp)
    except OSError as e:
        raise ValueError(_err(e, "use that folder"))
    return t

def _list(d):
    """(name, size) of the backups in a folder (names and sizes only: never opened)."""
    try: names = os.listdir(d)
    except OSError: return []
    out = []
    for n in names:
        if NAME_RE.fullmatch(n):
            try: s = os.stat(os.path.join(d, n))
            except OSError: continue
            if stat.S_ISREG(s.st_mode): out.append((n, s.st_size))
    return out

def _clean(d):
    """Half-written backups and test files left by a Buddy that was stopped (a day old: never one being written)."""
    try: names = os.listdir(d)
    except OSError: return
    for n in names:
        p = os.path.join(d, n)
        try:
            if PART_RE.fullmatch(n) and time.time() - os.lstat(p).st_mtime > 86400: os.remove(p)
        except OSError: pass

def run_backup(force=False):
    """One backup now. force: even if nothing changed. Errors are recorded for the status (and raised)."""
    t0 = time.time()
    try:
        if AESGCM is None: raise RuntimeError(WHY)
        K, d, b = saved_key(), _dir(), _bcfg()
        if not K and d and os.path.exists(KEY_FILE):
            raise ValueError("The recovery key saved on this Mac is damaged. Make a new one: Backup → New recovery key.")
        if not K or not d: raise ValueError("Backups aren't set up yet.")
        notes, keys = b.get("notes", True) is not False, b.get("keys") is True
        if not os.path.isdir(d):
            if not os.path.isdir(os.path.dirname(d)): raise OSError(errno.ENOENT, "missing", d)
            os.makedirs(d, mode=0o700, exist_ok=True)     # (only "Buddy Backups" itself: never a drive that's gone)
        _clean(d)
        st, real = _state(), os.path.realpath(d)
        ours = (st.get("ours") or {}).get(real, [])
        entries = _plan(notes, keys, d)
        fp, last = _fingerprint(entries, notes, keys, K), st.get("last") or {}
        if (not force and last.get("fp") == fp and last.get("dir") == real and time.time() - last.get("at", 0) < 7 * 86400
                and os.path.isfile(os.path.join(real, last.get("file", "")))):
            _update(lambda s: s.update(checked=time.time(), error=None)); return "same"
        day = datetime.date.today().isoformat()
        name = next((f + EXT for f in [day] + [f"{day}-{i}" for i in range(2, 100)]
                     if f + EXT in ours or not os.path.lexists(os.path.join(d, f + EXT))), None)
        if not name: raise ValueError("There are too many backups from today in that folder.")
        part = os.path.join(d, "." + secrets.token_hex(8) + ".part")
        fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            try: os.fchmod(fd, 0o600)
            except OSError: pass                            # (exFAT / FAT drives have no permissions)
            with os.fdopen(fd, "wb") as f:
                end = write_archive(f, K, entries, notes, keys)
                f.flush(); os.fsync(f.fileno())
            try: read_archive(part, K)                      # read it back whole before it counts
            except ValueError: raise ValueError("The backup didn't read back correctly. The drive may be failing; try another folder.")
            size = os.path.getsize(part)
            os.replace(part, os.path.join(d, name))
        except BaseException:
            try: os.remove(part)
            except OSError: pass
            raise
        try:
            dfd = os.open(d, os.O_RDONLY); os.fsync(dfd); os.close(dfd)
        except OSError: pass
        def rec(s):
            s["last"] = {"at": time.time(), "file": name, "size": size, "secs": round(time.time() - t0, 1),
                         "skipped": end["skipped"], "fp": fp, "dir": real, "verified": True}
            s["error"], s["checked"] = None, None
            o = s.setdefault("ours", {}).setdefault(real, [])
            if name not in o: o.append(name)
            prune(d, s, _n(b, "keep_daily", 7), _n(b, "keep_weekly", 4), just=name)
        _update(rec)
        return "made"
    except Exception as e:
        msg = str(e) if isinstance(e, (ValueError, RuntimeError)) else _err(e) if isinstance(e, OSError) \
            else f"Couldn't make the backup ({type(e).__name__})."
        _update(lambda s: s.update(error={"at": time.time(), "message": msg}))
        raise

def _n(b, k, default):
    try: return max(0, min(400, int(b.get(k, default))))
    except (TypeError, ValueError): return default

def prune(d, st, keep_daily=7, keep_weekly=4, just=None):
    """Keeps the newest 7, then the newest of each of the 4 newest weeks; deletes other backups this Mac wrote
    (only those: never one from another Mac or one you put there)."""
    real = os.path.realpath(d)
    have = []
    for n in (st.get("ours") or {}).get(real, []):
        m = NAME_RE.fullmatch(n)
        if not m or not os.path.isfile(os.path.join(real, n)): continue
        try: have.append((datetime.date.fromisoformat(m.group(1)), int(m.group(2) or 1), n))
        except ValueError: continue
    have.sort(reverse=True)
    keep, weeks = {n for _, _, n in have[:max(1, keep_daily)]}, []
    for day, _, n in have[max(1, keep_daily):]:
        wk = day.isocalendar()[:2]
        if wk not in weeks and len(weeks) < keep_weekly: weeks.append(wk); keep.add(n)
    if just: keep.add(just)
    for _, _, n in have:
        if n not in keep:
            try: os.remove(os.path.join(real, n))
            except OSError: keep.add(n)
    st.setdefault("ours", {})[real] = sorted(keep)

def due(now, st, on, running, busy, idle):
    """Is a scheduled backup due? Once a day, while the Mac is idle (or overdue), never during a call."""
    if not on or running or busy: return False
    last = max((st.get("last") or {}).get("at", 0), st.get("checked") or 0)
    if now - last < 23.5 * 3600: return False
    e = st.get("error") or {}
    if e and now - e.get("at", 0) < 3600: return False
    return idle >= 300 or now - last >= 30 * 3600

def _start_backup(force):
    """A backup in the background now. One forced while another job runs (a new recovery key, a new folder) runs as
    soon as that job ends: the newest backup must open with the key you were just shown, and be in the new place."""
    with _jlock:
        if _job["kind"]:
            if force: _job["again"] = True
            return False
        _job["kind"] = "backup"
    _go_backup(force)
    return True

def _go_backup(force):
    _prog.update(files=0, bytes=0)
    def go():
        try: run_backup(force)
        except Exception: pass                              # (recorded for the status)
        finally: _job_done("backup")
    threading.Thread(target=go, daemon=True).start()

def _job_done(kind):
    """A job ended; a forced backup asked for meanwhile starts at once (it never looks idle in between)."""
    with _jlock:
        if _job["kind"] != kind: return
        again = _job.pop("again", False) and _on()
        _job["kind"] = "backup" if again else None
    if again: _go_backup(True)

def _on(): return bool(AESGCM and _dir() and os.path.exists(KEY_FILE))

def start(cfg, save_cfg, synced_by=None, busy=None, idle=None):
    """Called once by the server: settings access, and the daily schedule (first look 3 minutes after start)."""
    _env.update(cfg=cfg, save_cfg=save_cfg, synced_by=synced_by, busy=busy or (lambda: False), idle=idle or (lambda: 0))
    def loop():
        time.sleep(180)
        while True:
            try:
                _expire()
                if _on():
                    st, now, run, busy = _state(), time.time(), bool(_job["kind"]), _env["busy"]()
                    if due(now, st, True, run, busy, 10**9) and due(now, st, True, run, busy, _env["idle"]()):
                        _start_backup(False)                # (idle time asked for only once one is due)
            except Exception:
                pass
            time.sleep(900)
    threading.Thread(target=loop, daemon=True).start()

# ---------- places, status ----------
def places():
    """Where backups could go: iCloud Drive, the cloud apps in ~/Library/CloudStorage, older Dropbox / Google Drive /
    OneDrive folders, and drives. Paths only, never what's in them."""
    h, out, seen = _home(), [], set()
    def add(label, path, kind, **kw):
        try:
            if not os.path.isdir(path) or not os.access(path, os.W_OK): return
            r = os.path.realpath(path)
        except OSError: return
        if r in seen: return
        seen.add(r); out.append({"label": label, "path": path, "show": _stored(path), "kind": kind, **kw})
    add("iCloud Drive", os.path.join(h, "Library/Mobile Documents/com~apple~CloudDocs"), "cloud")
    try: names = sorted(os.listdir(os.path.join(h, "Library/CloudStorage")))
    except OSError: names = []
    for n in names:
        if n.startswith("."): continue
        p = os.path.join(h, "Library/CloudStorage", n)
        if n.startswith("GoogleDrive"): p = os.path.join(p, "My Drive")
        add(_synced(p) or re.split(r"[-_]", n)[0], p, "cloud")      # (never the account's email as a label)
    for n in ("Dropbox", "Google Drive", "OneDrive"):
        add(n, os.path.join(h, n), "cloud")
    rank = {"iCloud Drive": 0, "Dropbox": 1, "Google Drive": 2, "OneDrive": 3}
    out.sort(key=lambda x: rank.get(x["label"], 4))
    try: vols = sorted(os.listdir(_volumes()))
    except OSError: vols = []
    for n in vols:
        p = os.path.join(_volumes(), n)
        if n.startswith(".") or os.path.islink(p) or not os.path.isdir(p): continue   # ("Macintosh HD" is a link to /)
        if any(os.path.exists(os.path.join(p, x)) for x in ("Backups.backupdb", ".com.apple.timemachine.donotpresent")):
            continue                                         # (Time Machine's disk)
        try:
            if os.statvfs(p).f_flag & os.ST_RDONLY: continue
            add(n, p, "drive", free=shutil.disk_usage(p).free)
        except OSError: continue
    return out

def found():
    """Backups Buddy can see: in the backup folder and in "Buddy Backups" of each place, newest first (names only)."""
    dirs, out, seen = ([(_dir(), _place(_dir())[0])] if _dir() else []), [], set()
    dirs += [(os.path.join(p["path"], DIRNAME), p["label"]) for p in places()]
    for d, label in dirs:
        r = os.path.realpath(d)
        if r in seen: continue
        seen.add(r)
        for n, size in _list(d):
            m = NAME_RE.fullmatch(n); p = os.path.join(d, n)
            out.append({"path": p, "show": _stored(p), "place": label, "date": m.group(1), "size": size,
                        "_k": (m.group(1), int(m.group(2) or 1))})
    out.sort(key=lambda x: x.pop("_k"), reverse=True)
    return out[:30]

def _expire():
    """A checked restore nobody went ahead with goes after an hour (its staging copy too)."""
    with _jlock:
        job = _r["job"]
        if job and job["state"] == "ready" and time.time() - job.get("ready_at", 0) > 3600:
            _r["job"] = None; _clear_staging()
        elif job and job["state"] == "failed" and time.time() - job.get("at", 0) > 3600:
            _r["job"] = None

def status():
    """For Settings → Backup (the Mac only). Never contains a key or anything from inside a backup."""
    _expire()
    b, d, st, now = _bcfg(), _dir(), _state(), time.time()
    on, last, job = _on(), st.get("last"), _r["job"]
    place, kind = _place(d) if d else ("", "")
    have = _list(d) if d else []
    restored = st.get("restored") if (st.get("restored") or {}).get("at", 0) > now - 7 * 86400 else None
    nxt = max((last or {}).get("at", 0), st.get("checked") or 0) + 23.5 * 3600 if on else None
    return {"available": AESGCM is not None, "why": "" if AESGCM else WHY, "on": on, "has_key": os.path.exists(KEY_FILE),
            "dir": d, "show": _stored(d) if d else "", "place": place, "local": kind == "local",
            "notes": b.get("notes", True) is not False, "keys": b.get("keys") is True,
            "running": _job["kind"] == "backup", "progress": dict(_prog) if _job["kind"] == "backup" else None,
            "last": {k: last.get(k) for k in ("at", "file", "size", "secs", "skipped")} if last else None,
            "checked": st.get("checked"), "error": st.get("error"), "since": st.get("since"),
            "count": len(have), "total": sum(s for _, s in have), "next": nxt and max(nxt, now),
            "restore": job and {k: job.get(k) for k in ("state", "done", "error", "summary")},
            "restored": restored and {**restored, "show": [_stored(p) for p in restored.get("aside") or []]}}

def restored_at():
    return (_state().get("restored") or {}).get("at", 0)

# ---------- restoring ----------
_r = {"job": None}      # the restore being checked / ready / restarting: {state, done, error, summary, K (memory only)…}

def _notes_parent():
    """Where a backup's notes are unpacked: inside .restore if that's on the same disk as your notes folder, else
    next to it (so putting them in place is a rename, never a copy)."""
    vp = os.path.dirname(os.path.realpath(VAULT))
    try: same = os.stat(vp).st_dev == os.stat(HERE).st_dev
    except OSError: same = True
    return RESTORE if same else os.path.join(vp, ".buddy-restore-notes")

def _waiting():
    """Why a new check can't start: a restore waiting for the restart, or one that couldn't be undone (its copy is kept)."""
    if os.path.exists(os.path.join(RESTORE, "plan.json")): return "Quit Buddy and open it again to finish restoring first."
    if os.path.exists(os.path.join(RESTORE, "failed-plan.json")):
        return (f"The last restore couldn't finish, and its copy is still in {_stored(RESTORE)}. Once what you need is "
                "back in place, delete that folder and try again.")
    return ""

def _clear_staging():
    """Removes unpacked copies (decrypted, only ever in Buddy's own folders). Not while a restore waits for the restart
    (plan.json), nor after one that couldn't be undone (failed-plan.json): then it holds your data and the message says where."""
    if _waiting(): return
    shutil.rmtree(RESTORE, ignore_errors=True)
    shutil.rmtree(os.path.join(os.path.dirname(os.path.realpath(VAULT)), ".buddy-restore-notes"), ignore_errors=True)

def _when(t):
    try: return time.strftime("%Y-%m-%d %H:%M", time.localtime(float(t)))
    except (TypeError, ValueError, OverflowError): return ""

def inspect(j):
    """Starts checking a backup into the staging folder (nothing live is touched)."""
    if AESGCM is None: raise RuntimeError(WHY)
    if _waiting(): raise ValueError(_waiting())
    path = j.get("path")
    if not isinstance(path, str) or not path.strip() or len(path) > 1024 or "\0" in path:
        raise ValueError("Pick the backup file itself.")
    path = os.path.expanduser(path.strip())
    if not os.path.isabs(path) or not os.path.isfile(path): raise ValueError("Pick the backup file itself.")
    key = j.get("key") or ""
    if not isinstance(key, str): raise ValueError(INCOMPLETE)
    K = parse_key(key) if key.strip() else saved_key()
    if not K: raise ValueError("Type your recovery key.")
    with _jlock:
        if _job["kind"] == "inspect": raise ValueError("The last check is still stopping. Try again in a moment.")
        if _job["kind"]: raise ValueError(BUSY)
        _job["kind"] = "inspect"
        job = _r["job"] = {"state": "checking", "done": 0.0, "error": "", "summary": None, "K": K, "path": path,
                           "at": time.time()}
    threading.Thread(target=_inspect, args=(job,), daemon=True).start()
    return {"ok": True}

def _rerr(e):
    n = getattr(e, "errno", None)
    if n == errno.ENOENT: return "The backup file isn't there any more."
    if n in (errno.EACCES, errno.EPERM):
        return ("macOS didn't let Buddy read that file. Allow Buddy in System Settings → Privacy & Security → Files & "
                "Folders, or copy the backup to your Desktop and choose it there.")
    if n in (errno.ENOSPC, getattr(errno, "EDQUOT", -1)): return "There isn't enough free space on this Mac to restore it."
    if n in (errno.EDEADLK, errno.ETIMEDOUT, errno.EIO, errno.EAGAIN):       # (iCloud: a file that isn't downloaded)
        return ("Couldn't read the backup file. If it's in iCloud Drive or Dropbox, open its folder in Finder, wait until "
                "it has finished downloading, and try again.")
    return f"Couldn't check the backup ({getattr(e, 'strerror', None) or type(e).__name__})."

def _inspect(job):
    try:
        _clear_staging()
        np = _notes_parent()
        for p in {RESTORE, np}:
            os.makedirs(p, mode=0o700, exist_ok=True); os.chmod(p, 0o700)
        man, end = read_archive(job["path"], job["K"], out={"buddy": RESTORE, "notes": np}, job=job)
        staged = os.path.join(RESTORE, "buddy")
        os.makedirs(staged, mode=0o700, exist_ok=True)
        keys = [n for n in KEYS if os.path.isfile(os.path.join(staged, n))]
        c = end.get("counts") or {}
        summary = {"made": man.get("made"), "from": _when(man.get("made")), "notes": bool(man.get("notes")),
                   "keys": keys, "tinfoil": ".tinfoil_key" in keys, "messages": c.get("messages"),
                   "characters": c.get("characters"), "photos": c.get("photos"), "note_files": c.get("notes"),
                   "settings": os.path.isfile(os.path.join(staged, "config.local.json")),
                   "bytes": sum((end.get("bytes") or {}).values()), "file": os.path.basename(job["path"])}
        with _jlock:
            if _r["job"] is job and not job.get("cancel"):
                job.update(state="ready", done=1.0, summary=summary, np=np, ready_at=time.time())
            else: _clear_staging()
    except _Cancelled:
        _clear_staging()
    except Exception as e:
        _clear_staging()
        msg = str(e) if isinstance(e, ValueError) else _rerr(e) if isinstance(e, OSError) \
            else f"Couldn't check the backup ({type(e).__name__})."
        with _jlock:
            if _r["job"] is job: job.update(state="failed", error=msg, K=None, at=time.time())
    finally:
        _job_done("inspect")

def _free(p):
    q, i = p, 2
    while os.path.lexists(q): q, i = f"{p} {i}", i + 1
    return q

def _dev(p):
    try: return os.stat(p).st_dev
    except OSError: return None

def make_plan(notes, keys, np, summary):
    """What the restart renames: [{live, staged | None, aside, root}] (staged None: not in the backup, so what's here
    goes aside; root: the folder to show people)."""
    stamp, home = time.strftime("%Y-%m-%d %H.%M"), os.path.realpath(_home())
    aside = _free(os.path.join(home, f"Buddy before restore {stamp}"))
    staged = os.path.join(RESTORE, "buddy")
    broot = aside if _dev(HERE) == _dev(home) else _free(os.path.join(os.path.dirname(HERE), f"Buddy files before restore {stamp}"))
    item = lambda n, s: {"live": os.path.join(HERE, n), "staged": s, "aside": os.path.join(broot, "buddy", n), "root": broot}
    names = set()
    for root in (HERE, staged):
        try: names |= {n for n in os.listdir(root) if _data_name(n, keys=False)}
        except OSError: pass
    items = [item(n, os.path.join(staged, n) if os.path.lexists(os.path.join(staged, n)) else None) for n in sorted(names)]
    if keys:                                                 # only the keys that are in the backup
        items += [item(n, os.path.join(staged, n)) for n in KEYS if os.path.isfile(os.path.join(staged, n))]
    if os.path.lexists(os.path.join(HERE, ".memory_index.json")):
        items.append(item(".memory_index.json", None))      # (rebuilt from the restored notes)
    # (no notes folder in the backup: yours stays as it is. An item with nothing staged would look done, and an undo
    # would then move your notes into the staging folder, which is deleted.)
    if notes and os.path.isdir(os.path.join(np, "notes")):
        v = os.path.realpath(VAULT)
        if v in ("/", home) or _inside(os.path.realpath(HERE), v):
            raise ValueError("Your notes folder can't be swapped automatically here. Turn off \"Restore my notes\".")
        if _dev(os.path.dirname(v)) == _dev(home):
            items.append({"live": v, "staged": os.path.join(np, "notes"), "aside": os.path.join(aside, "notes"), "root": aside})
        else:
            na = _free(os.path.join(os.path.dirname(v), f"Buddy notes before restore {stamp}"))
            items.append({"live": v, "staged": os.path.join(np, "notes"), "aside": na, "root": na})
    try: live = json.load(open(os.path.join(HERE, "config.local.json")))
    except (OSError, ValueError): live = {}
    keep = {k: live[k] for k in KEEP if isinstance(live, dict) and k in live}
    return {"v": 1, "at": time.time(), "from": summary.get("from", ""), "made": summary.get("made"), "aside": aside,
            "keep": keep, "items": items, "done": []}

def restore(j, restart):
    """Puts the checked backup in place: writes the plan, then restarts Buddy, which does the renames first thing."""
    with _jlock:
        job = _r["job"]
        if _job["kind"]: raise ValueError(BUSY)
        if not job or job["state"] != "ready": raise ValueError("Check the backup first.")
        s = job["summary"]
        notes, keys = j.get("notes") is True and s["notes"], j.get("keys") is True and bool(s["keys"])
        plan = make_plan(notes, keys, job["np"], s)
        if not saved_key():                                 # backups go on with the same recovery key
            _atomic(KEY_FILE, job["K"].hex() + "\n")
        _atomic(os.path.join(RESTORE, "plan.json"), json.dumps(plan, indent=1))
        job.update(state="restarting", K=None); _job["kind"] = "restore"
    restart()
    return {"ok": True}

def restart_failed():
    """The server couldn't restart itself: the plan runs at the next start."""
    msg = "Quit Buddy and open it again to finish restoring."
    with _jlock:
        _job["kind"] = None
        if _r["job"]: _r["job"].update(state="failed", error=msg, at=time.time())
    _update(lambda s: s.update(restored={"at": time.time(), "error": msg}))

def cancel():
    with _jlock:
        job = _r["job"]
        if job and job["state"] == "restarting": raise ValueError("Buddy is restarting to finish the restore.")
        _r["job"] = None
        if job: job["cancel"] = True
        if not job or job["state"] != "checking": _clear_staging()   # (a check still running cleans up after itself)
    return {"ok": True}

def _swap(it, act=None):
    """One item: what's live goes aside, the staged copy goes in. act is filled in as each rename is done, so a
    failure half way through the item (the live copy aside, the staged one not in yet) is undone like the others."""
    live, staged, aside = it["live"], it.get("staged"), it["aside"]
    act = {} if act is None else act
    act.update(aside=False, empty=False, placed=False)
    def away():
        if os.path.isdir(live) and not os.path.islink(live) and not os.listdir(live):
            os.rmdir(live); act["empty"] = True; return       # (an empty folder isn't worth keeping aside)
        if os.path.lexists(aside): raise OSError(errno.EEXIST, "already there", aside)
        os.makedirs(os.path.dirname(aside), mode=0o700, exist_ok=True)
        os.rename(live, aside); act["aside"] = True
    if staged is None:                                       # not in the backup: what's here goes aside
        if os.path.lexists(live): away()
        return act
    if not os.path.lexists(staged):                          # done already (a restart cut in after it)
        act.update(placed=True, aside=os.path.lexists(aside)); return act
    if os.path.lexists(live): away()
    elif os.path.lexists(aside): act["aside"] = True         # (moved aside by a run that was cut off)
    os.rename(staged, live); act["placed"] = True
    return act

def _unswap(it, act):
    live, staged, aside = it["live"], it.get("staged"), it["aside"]
    if act.get("placed") and staged and os.path.lexists(live):
        os.makedirs(os.path.dirname(staged), mode=0o700, exist_ok=True); os.rename(live, staged)
    if act.get("aside") and os.path.lexists(aside): os.rename(aside, live)
    elif act.get("empty") and not os.path.lexists(live): os.mkdir(live, 0o700)

def _patch_cfg(keep):
    """Settings that belong to this Mac stay as they were (where backups go, phone access, the sync note)."""
    p = os.path.join(HERE, "config.local.json")
    try:
        c = json.load(open(p)); c = c if isinstance(c, dict) else {}
    except OSError: c = None
    except ValueError: c = {}
    new = dict(c or {})
    for k in KEEP:
        if k in keep: new[k] = keep[k]
        elif k == "phone_tailnet" and new.get(k) and not os.path.isdir(os.path.join(HERE, ".tailnet")):
            new[k] = False                                   # (a new Mac signs in to Tailscale again)
        elif k == "sync_e2e": new.pop(k, None)
    if new != (c or {}) or (c is None and new):
        _atomic(p, json.dumps(new, indent=2))

def finish_restore(fail_after=None):
    """At start, right after the port is taken and before anything reads Buddy's files: puts a checked restore in
    place by renaming (never copying or deleting), undoing it all if anything fails. Safe to run again after a crash.
    fail_after: (selftest) fail on purpose after that many items."""
    pp = os.path.join(RESTORE, "plan.json")
    try:
        if not os.path.exists(pp):
            if os.path.lexists(RESTORE) or os.path.lexists(os.path.join(os.path.dirname(os.path.realpath(VAULT)), ".buddy-restore-notes")):
                _clear_staging()                             # (a check that was never restored)
            return
        try:
            plan = json.load(open(pp)); items = plan["items"]; done = plan.setdefault("done", [])
        except (OSError, ValueError, KeyError, TypeError):
            try: os.remove(pp)
            except OSError: pass
            _clear_staging()
            _update(lambda s: s.update(restored={"at": time.time(), "error": "Restore couldn't start. Nothing was changed."}))
            return
        try:
            for i, it in enumerate(items):
                if any(x.get("i") == i for x in done): continue
                if fail_after is not None and len(done) >= fail_after: raise OSError(errno.EIO, "test")
                act = {"i": i}; done.append(act)              # (in the list before the renames: see _swap)
                _swap(it, act); _atomic(pp, json.dumps(plan, indent=1))
        except Exception as e:
            why = getattr(e, "strerror", None) or type(e).__name__
            ok = True
            for act in reversed(done):                        # (each one even if another can't be put back)
                try: _unswap(items[act["i"]], act)
                except Exception: ok = False
            roots = sorted(r for r in {plan.get("aside")} | {it.get("root") for it in items} if r)
            for root in roots:
                for dp, _, _ in os.walk(root, topdown=False):  # (folders made for nothing)
                    try: os.rmdir(dp)
                    except OSError: pass
            left = [r for r in roots if os.path.lexists(r)]   # (anything still in one is yours: it's named, never "nothing")
            if ok:
                os.remove(pp); _clear_staging()
                _update(lambda s: s.update(restored={"at": time.time(), "aside": left, "error":
                    f"Restore couldn't finish ({why}). " + (f"Buddy put back what it could; the rest of what it had is in "
                    f"{' and '.join(left)}. Nothing was deleted." if left else "Nothing was changed.")}))
            else:
                os.replace(pp, os.path.join(RESTORE, "failed-plan.json"))
                _update(lambda s: s.update(restored={"at": time.time(), "aside": left, "error":
                    f"Restore couldn't finish ({why}) and couldn't put everything back. What Buddy had that isn't back "
                    f"in place is in {' and '.join(left) or plan.get('aside')}; the restored copy is in {RESTORE}. "
                    "Nothing was deleted."}))
            return
        _patch_cfg(plan.get("keep") or {})
        asides = sorted({items[a["i"]].get("root") or plan["aside"] for a in done if a.get("aside")})
        os.remove(pp); _clear_staging()
        _update(lambda s: s.update(restored={"at": time.time(), "from": plan.get("from", ""), "made": plan.get("made"),
                                             "aside": asides, "error": ""}))
    except Exception as e:                                    # never stops Buddy from starting
        try: _update(lambda s: s.update(restored={"at": time.time(), "error": f"Restore couldn't finish ({type(e).__name__})."}))
        except Exception: pass

# ---------- the server's door ----------
def get(path):
    """GET /api/backup, /api/backup/places, /api/backup/found (the Mac only; checked by the server)."""
    if path == "/api/backup": return status()
    if path == "/api/backup/places": return {"places": places()}
    if path == "/api/backup/found": return {"backups": found()}
    return None

def _bool(j, k, default):
    return j[k] if isinstance(j.get(k), bool) else default

def post(name, j, restart):
    """POST /api/backup/<name>. ValueError = a problem to show (400), RuntimeError = unavailable (503)."""
    if name == "folder":
        t = probe(j.get("path"))
        if _on() and os.path.realpath(_dir()) != t:
            _set_bcfg(dir=_stored(t)); _start_backup(True)
        label, kind = _place(t)
        return {"dir": t, "show": _stored(t), "place": label, "local": kind == "local", "existing": len(_list(t))}
    if name == "key":
        if AESGCM is None: raise RuntimeError(WHY)
        K = secrets.token_bytes(32); _pending.clear(); _pending.update(K=K, at=time.time())
        return {"key": key_text(K), "groups": 14}               # the only answer that ever holds a key
    if name == "confirm":
        if AESGCM is None: raise RuntimeError(WHY)
        b, reuse = _bcfg(), j.get("reuse") is True
        if reuse:
            if not saved_key(): raise ValueError("There's no saved recovery key on this Mac any more. Make a new one.")
        else:
            if not _pending or time.time() - _pending["at"] > 900:
                _pending.clear()
                raise ValueError("That key wasn't saved in time. Start again for a new one (the other one was never used).")
            if _norm(j.get("last")) != key_text(_pending["K"])[-4:]:
                raise ValueError("That isn't the last group of your key. Have a look at it again.")
        d = probe(j["dir"]) if j.get("dir") else _dir()
        if not d: raise ValueError("Pick a folder first.")
        if not reuse:
            _atomic(KEY_FILE, _pending["K"].hex() + "\n"); _pending.clear()
        _set_bcfg(dir=_stored(os.path.realpath(d)), notes=_bool(j, "notes", b.get("notes", True) is not False),
                  keys=_bool(j, "keys", b.get("keys") is True))
        _update(lambda s: s.update(since=time.time()))
        _start_backup(True)
        return status()
    if name == "settings":
        ch = {k: j[k] for k in ("notes", "keys") if isinstance(j.get(k), bool)}
        if ch: _set_bcfg(**ch)
        return status()
    if name == "now":
        if not _on(): raise RuntimeError(WHY) if AESGCM is None else ValueError("Backups aren't set up yet.")
        return {"started": True} if _start_backup(True) else {"running": True}
    if name == "off":
        b = _bcfg(); _env["save_cfg"](backup={k: b[k] for k in ("notes", "keys") if k in b})
        return status()
    if name == "inspect": return inspect(j)
    if name == "restore": return restore(j, restart)
    if name == "cancel": return cancel()
    return None

def human(n):
    n = float(n)
    for u in ("bytes", "KB", "MB", "GB", "TB"):
        if n < 1000 or u == "TB": return f"{n:.0f} {u}" if u == "bytes" or n >= 10 else f"{n:.1f} {u}"
        n /= 1000

# ---------- selftest: python3 backup.py --selftest (fake data in temp folders; never your real files or keys) ----------
def _selftest():
    import ast, random
    say = lambda what: print("ok ", what, flush=True)
    def expect(fn, text):
        try: fn()
        except ValueError as e:
            assert text in str(e), (text, str(e)); return
        raise AssertionError("not caught: " + text)
    def wait(cond, secs=60):
        t = time.time()
        while not cond():
            assert time.time() - t < secs, "timed out"
            time.sleep(0.02)
    tmp = os.path.realpath(tempfile.mkdtemp(prefix="buddy-backup-selftest-"))
    home = os.path.join(tmp, "home"); os.environ["HOME"] = home      # (asides go into the home folder: a fake one)
    os.environ["BUDDY_VOLUMES"] = os.path.join(tmp, "vol")
    here, vault = os.path.join(tmp, "BuddyFace"), os.path.join(home, "Buddy")
    os.makedirs(here); os.makedirs(vault); use_paths(here, vault)
    global LOG2, SMALL
    try:
        # 9. every private file has its place
        lines = [l.strip() for l in open(os.path.join(SRC, ".gitignore")) if l.strip() and not l.lstrip().startswith("#")]
        tree = ast.parse(open(os.path.join(SRC, "buddy_server.py")).read())
        pf = next(ast.literal_eval(n.value) for n in ast.walk(tree) if isinstance(n, ast.Assign)
                  and any(getattr(t, "id", "") == "PRIVATE_FILES" for t in n.targets))
        lists = {"DATA": DATA, "KEYS": KEYS, "NEVER": NEVER}
        for n in lines:
            hit = [k for k, v in lists.items() if n in v]
            assert len(hit) == 1, f".gitignore line {n!r} is in {hit or 'none'} of DATA/KEYS/NEVER (backup.py)"
        for n in pf:
            hit = [k for k, v in lists.items() if any(fnmatch.fnmatchcase(n, x.rstrip("/")) for x in v)]
            assert len(hit) == 1, f"PRIVATE_FILES {n!r} is in {hit or 'none'} of DATA/KEYS/NEVER (backup.py)"
        say(f"classification: {len(lines)} .gitignore lines and {len(pf)} PRIVATE_FILES each in exactly one list")

        # 1. HKDF
        assert hkdf(b"\x0b" * 22, b"", 42).hex() == ("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"
                                                    "9d201395faa4b61a96c8")
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        from cryptography.hazmat.primitives import hashes
        for _ in range(30):
            ikm, info, n = os.urandom(random.randint(1, 64)), os.urandom(random.randint(0, 40)), random.randint(1, 96)
            assert HKDF(hashes.SHA256(), n, bytes(32), info).derive(ikm) == hkdf(ikm, info, n)
        say("hkdf: RFC 5869 A.3 vector, same as cryptography's HKDF")

        # 2. the recovery key
        for _ in range(20):
            K = os.urandom(32); t = key_text(K); g = t.split("-")
            assert len(g) == 14 and all(len(x) == 4 and all(c in B32 for c in x) for x in g)
            assert parse_key(t) == K and parse_key(" ".join(g).lower()) == K and parse_key("".join(g)) == K
            assert parse_key(t.replace("0", "o").replace("1", random.choice("IiLl"))) == K
            i = random.randrange(56); flat = t.replace("-", "")
            bad = flat[:i] + random.choice([c for c in B32 if c != flat[i]]) + flat[i + 1:]
            expect(lambda: parse_key(bad), TYPO)
        expect(lambda: parse_key("-".join(g[:13])), INCOMPLETE)
        expect(lambda: parse_key(t[:-1] + "U"), INCOMPLETE)
        expect(lambda: parse_key(""), INCOMPLETE)
        expect(lambda: parse_key(recovery.key_text(K, recovery.SYNC)), recovery.NOT_BACKUP)   # (Buddy for phones' key)
        say("recovery key: 14 groups of 4, round trip, lowercase/spaces/O/I/L ok, typos, short keys and sync keys caught")

        # 3. the stream format
        def enc(data, K, log2):
            b = io.BytesIO(); e = Enc(b, K, log2); i = 0
            while i < len(data):
                k = random.randint(1, 5000); e.write(data[i:i + k]); i += k
            e.close(); return b.getvalue()
        def dec(raw, K, piece=None):
            d = Dec(io.BytesIO(raw), K)
            if piece is None: out = d.read()
            else:
                parts = []
                while True:
                    b = d.read(piece)
                    if not b: break
                    parts.append(b)
                out = b"".join(parts)
            assert d.done; return out
        tampered = 0
        for log2 in (10, 20):
            C = 1 << log2; CT = C + 16
            for size in (0, 1, C - 1, C, C + 1, 3 * C, 3 * C + 7):
                K, data = os.urandom(32), os.urandom(size)
                raw = enc(data, K, log2)
                assert dec(raw, K) == data and dec(raw, K, 777) == data
                assert len(raw) == HEAD + max(1, -(-size // C)) * 16 + size
                if size not in (0, C + 1, 3 * C + 7) and log2 == 20: continue
                n = (len(raw) - HEAD + CT - 1) // CT
                cases = [(raw[:3] + bytes([raw[3] ^ 1]) + raw[4:], NOT_BACKUP),
                         (raw[:8] + b"\x02" + raw[9:], NEWER), (raw[:9] + b"\x01" + raw[10:], DAMAGED),
                         (raw[:12] + bytes([raw[12] ^ 1]) + raw[13:], WRONG_KEY),
                         (raw[:40] + bytes([raw[40] ^ 1]) + raw[41:], DAMAGED),
                         (raw[:82] + bytes([raw[82] ^ 1]) + raw[83:], DAMAGED),
                         (raw[:-1], DAMAGED), (raw + b"\0", DAMAGED), (raw + bytes(16), DAMAGED), (raw[:HEAD - 1], DAMAGED), (raw[:5], NOT_BACKUP)]
                cases += [(raw[:HEAD + k * CT], DAMAGED) for k in range(n)]                     # cut at each chunk end
                cases += [(raw[:HEAD + k * CT + 9], DAMAGED) for k in range(n) if HEAD + k * CT + 9 < len(raw)]
                for i in random.sample(range(HEAD, len(raw)), min(25, len(raw) - HEAD)):
                    cases.append((raw[:i] + bytes([raw[i] ^ 0x40]) + raw[i + 1:], DAMAGED))
                if n >= 3:
                    c = [raw[HEAD + k * CT:HEAD + (k + 1) * CT] for k in range(n)]
                    cases.append((raw[:HEAD] + c[1] + c[0] + b"".join(c[2:]), DAMAGED))           # swapped
                    cases.append((raw[:HEAD] + c[0] + b"".join(c[2:]), DAMAGED))                  # one dropped
                    cases.append((raw[:HEAD] + b"".join(c[:-1]), DAMAGED))                        # last dropped
                for bad, text in cases:
                    expect(lambda: dec(bad, K), text); tampered += 1
                expect(lambda: dec(raw, os.urandom(32)), WRONG_KEY); tampered += 1
        say(f"stream: round trips (log2 10 and 20, 0..3C+7 bytes); {tampered} tampered/cut/reordered/wrong-key files refused")

        # 7. retention
        d = os.path.join(tmp, "ret"); os.makedirs(d)
        day0 = datetime.date(2026, 10, 9)
        mine = [(day0 - datetime.timedelta(days=i)).isoformat() + EXT for i in range(90)] + ["2026-10-09-2" + EXT]
        for n in mine + ["2026-09-01-3" + EXT, "notes.txt", "2026-10-02.buddybackup.icloud"]:
            open(os.path.join(d, n), "w").close()
        st = {"ours": {os.path.realpath(d): mine + ["2026-01-01" + EXT]}}            # (one that's gone already)
        prune(d, st, 7, 4)
        left = sorted(os.listdir(d))
        want = sorted(["2026-10-09-2", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05", "2026-10-04",
                       "2026-10-03", "2026-09-27", "2026-09-20", "2026-09-13"])
        assert sorted(st["ours"][os.path.realpath(d)]) == sorted(w + EXT for w in want), st
        assert left == sorted([w + EXT for w in want] + ["2026-09-01-3" + EXT, "notes.txt", "2026-10-02.buddybackup.icloud"]), left
        say("retention: newest 7 + newest of 4 weeks kept; other Macs' and other files untouched")

        # 8. when a scheduled backup is due
        H, now = 3600, 1_800_000_000
        def st_(last=None, err=None, checked=None):
            return {"last": {"at": now - last * H} if last is not None else None,
                    "error": {"at": now - err * H, "message": "x"} if err is not None else None,
                    "checked": now - checked * H if checked is not None else None}
        table = [((False, False, False, 400), st_(48), False), ((True, False, False, 400), st_(48), True),
                 ((True, False, True, 400), st_(48), False), ((True, True, False, 400), st_(48), False),
                 ((True, False, False, 400), st_(23), False), ((True, False, False, 400), st_(24), True),
                 ((True, False, False, 0), st_(24), False), ((True, False, False, 0), st_(31), True),
                 ((True, False, False, 400), st_(48, err=0.5), False), ((True, False, False, 400), st_(48, err=2), True),
                 ((True, False, False, 400), st_(200, checked=2), False), ((True, False, False, 0), st_(), True)]
        for (on, running, busy, idle), s, want in table:
            assert due(now, s, on, running, busy, idle) == want, (on, running, busy, idle, s, want)
        say(f"schedule: {len(table)} cases (off, call live, 23 h / 24 h, idle, overdue, recent error, unchanged)")

        # 4. a whole backup and restore, with canaries
        LOG2, SMALL = 10, 64 << 10                           # (many chunks, and the streamed path for big files)
        cfgp = os.path.join(here, "config.local.json")
        def cfg():
            try: return json.load(open(cfgp))
            except (OSError, ValueError): return {}
        def save_cfg(**kw): c = cfg(); c.update(kw); _atomic(cfgp, json.dumps(c, indent=2))
        _env.update(cfg=cfg, save_cfg=save_cfg, synced_by=None, busy=lambda: False, idle=lambda: 0)
        def w(p, data, mt=None):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f: f.write(data if isinstance(data, bytes) else data.encode())
            if mt: os.utime(p, (mt, mt))
        H_, V_ = lambda *a: os.path.join(here, *a), lambda *a: os.path.join(vault, *a)
        photo = secrets.token_hex(16) + ".jpg"
        w(H_(".thread.json"), json.dumps([{"id": i, "role": "user", "content": f"CANARY-MSG-{i}", "ts": 1e9 + i}
                                          for i in range(40)]), 1_700_000_000.123456789)
        w(H_("my-characters/zed.json"), json.dumps({"name": "CANARY-CHAR-Zed"})); w(H_("my-characters/zed.img"), b"\x89PNG CANARY-PIC")
        w(H_("my-characters/lives/zed.json"), "{\"CANARY-LIFE\": 1}"); w(H_("my-characters/x.json.tmp"), "CANARY-NEVER-tmp")
        w(H_(".media", photo), b"\xff\xd8\xff CANARY-PHOTO" + os.urandom(3000)); w(H_(".media/notahex.png"), "CANARY-NEVER-png")
        w(cfgp, json.dumps({"phone_tailnet": True, "name": "CANARY-CFG"})); w(H_("persona.local.txt"), "CANARY-PERSONA")
        for n in (".mac_token", ".devices.json", ".vapid.json", ".push_subs.json", ".memory_index.json", ".tinfoil_cache_secret"):
            w(H_(n), "CANARY-NEVER" + n)
        w(H_(".tailnet/state"), "CANARY-NEVER-tailnet")
        w(H_(".tinfoil_key"), "fake-key-for-tests-CANARY-KEY1"); w(H_(".phala_key"), "fake-key-for-tests-CANARY-KEY2")
        w(V_("journal/a.md"), "CANARY-NOTE-1 " * 300, 1_600_000_000.5); w(V_("journal/b.md"), "CANARY-NOTE-2")
        w(V_("chats/buddy/2026-10-01.md"), "CANARY-NOTE-chat"); w(V_(".obsidian/app.json"), "{}")
        w(V_("big.bin"), os.urandom(SMALL + 12345)); w(V_(".trash/old.md"), "CANARY-NEVER-trash")
        w(V_("Ünïcode folder/naïve note.md"), "CANARY-NOTE-ü")
        os.makedirs(V_("empty")); os.symlink(H_(".mac_token"), V_("link.md")); os.symlink(here, V_("linkdir"))
        cloud = os.path.join(home, "Library/Mobile Documents/com~apple~CloudDocs"); os.makedirs(cloud)
        for p_ in ("Library/CloudStorage/Dropbox", "Library/CloudStorage/GoogleDrive-fake@example.com/My Drive",
                   "Library/CloudStorage/OneDrive-Personal"):
            os.makedirs(os.path.join(home, p_))
        os.makedirs(os.path.join(tmp, "vol/STICK")); os.makedirs(os.path.join(tmp, "vol/TM/Backups.backupdb"))
        os.symlink("/", os.path.join(tmp, "vol/Macintosh HD"))
        pl = places()
        assert [x["label"] for x in pl] == ["iCloud Drive", "Dropbox", "Google Drive", "OneDrive", "STICK"], pl
        assert not any("@" in x["label"] for x in pl) and pl[2]["path"].endswith("/My Drive") and pl[0]["show"].startswith("~/")
        expect(lambda: probe(os.path.join(tmp, "nope")), "doesn't exist")
        expect(lambda: probe(H_(".thread.json")), "doesn't exist")
        expect(lambda: probe(V_("journal")), "outside your notes folder")
        expect(lambda: probe(here), "outside Buddy's own folder")
        say("places: iCloud, Dropbox, Google Drive (no email), OneDrive, drives (no links, no Time Machine); folder checks")
        r = post("folder", {"path": cloud}, None)
        assert r["dir"] == os.path.join(cloud, DIRNAME) and r["place"] == "iCloud Drive" and not r["local"] and os.listdir(r["dir"]) == []
        k1 = post("key", {}, None)["key"]
        expect(lambda: post("confirm", {"last": "ZZZZ" if not k1.endswith("ZZZZ") else "0000", "dir": r["dir"]}, None), "isn't the last group")
        out = post("confirm", {"last": k1[-4:].lower(), "dir": r["dir"], "notes": True, "keys": False}, None)
        assert out["on"] and k1[:14] not in json.dumps(out) and k1[-9:] not in json.dumps(out)
        expect(lambda: post("confirm", {"last": k1[-4:]}, None), "wasn't saved in time")
        K = saved_key(); assert K == parse_key(k1) and stat.S_IMODE(os.stat(KEY_FILE).st_mode) == 0o600
        for f_ in (cfgp, STATE_FILE):
            assert k1[:9] not in open(f_).read() and K.hex() not in open(f_).read()
        wait(lambda: not _job["kind"])
        st0 = status(); assert st0["last"] and not st0["error"] and st0["count"] == 1, st0
        today = os.path.join(r["dir"], datetime.date.today().isoformat() + EXT)
        raw = open(today, "rb").read()
        assert raw[:9] == MAGIC + b"\x01" and stat.S_IMODE(os.stat(today).st_mode) == 0o600
        assert b"CANARY" not in raw and b"fake-key" not in raw and b"my-characters/zed" not in raw and b"journal/a.md" not in raw
        def names(p_):
            with open(p_, "rb") as f:
                return {m.name for m in tarfile.open(fileobj=Dec(f, K), mode="r|")}
        got = names(today)
        want = {"manifest.json", "end.json", "buddy", "buddy/.thread.json", "buddy/config.local.json", "buddy/persona.local.txt",
                "buddy/my-characters", "buddy/my-characters/zed.json", "buddy/my-characters/zed.img", "buddy/my-characters/lives",
                "buddy/my-characters/lives/zed.json", "buddy/.media", "buddy/.media/" + photo, "notes", "notes/journal",
                "notes/journal/a.md", "notes/journal/b.md", "notes/chats", "notes/chats/buddy", "notes/chats/buddy/2026-10-01.md",
                "notes/.obsidian", "notes/.obsidian/app.json", "notes/big.bin", "notes/empty", "notes/Ünïcode folder",
                "notes/Ünïcode folder/naïve note.md"}
        assert got == want, (got ^ want)
        post("settings", {"keys": True}, None); post("now", {}, None); wait(lambda: not _job["kind"])
        assert {"buddy/.tinfoil_key", "buddy/.phala_key"} <= names(today) and status()["count"] == 1
        post("settings", {"notes": False}, None); post("now", {}, None); wait(lambda: not _job["kind"])
        assert not any(n.startswith("notes") for n in names(today))
        post("settings", {"notes": True}, None); post("now", {}, None); wait(lambda: not _job["kind"])
        assert names(today) == want | {"buddy/.tinfoil_key", "buddy/.phala_key"} and status()["count"] == 1
        assert run_backup() == "same" and status()["checked"]
        _update(lambda s_: s_["last"].update(at=time.time() - 8 * 86400))
        assert run_backup() == "made"
        say("backup: one file a day (0600, BUDDYBAK v1), no canary in its bytes, exactly DATA (+notes, +keys when on), "
            "never pairing/push/tailnet/index/temp/links; unchanged = skipped for < 7 days")

        def tree(*roots):
            out = {}
            for root in roots:
                for dp, ds, fs in os.walk(root):
                    for f in fs:
                        p_ = os.path.join(dp, f)
                        if os.path.islink(p_): out[p_] = ("link", os.readlink(p_)); continue
                        out[p_] = (hashlib.sha256(open(p_, "rb").read()).hexdigest(), os.stat(p_).st_mtime_ns)
                    for d_ in ds: out[os.path.join(dp, d_)] = "dir"
            return out
        junk = ("/.trash", "/notahex.png", "/x.json.tmp")        # (never in backups: they go aside with their folder)
        def data_tree():
            t = {k_: v_ for k_, v_ in tree(vault).items() if not any(j_ in k_ for j_ in junk)}
            for n in os.listdir(here):
                if _data_name(n, keys=False) and n != "config.local.json":
                    t.update({k_: v_ for k_, v_ in tree(H_(n)).items() if not any(j_ in k_ for j_ in junk)}
                             if os.path.isdir(H_(n)) else {H_(n): tree(here)[H_(n)]})
            return t
        def check(path, key=""):
            r_ = inspect({"path": path, "key": key}); assert r_ == {"ok": True}
            wait(lambda: _r["job"]["state"] != "checking"); return _r["job"]
        def go(notes=True, keys=False, fail_after=None):
            restore({"notes": notes, "keys": keys}, lambda: None); _job["kind"] = None    # (the restart)
            finish_restore(fail_after)
        for p_ in (V_("link.md"), V_("linkdir")): os.remove(p_)
        post("now", {}, None); wait(lambda: not _job["kind"])
        snap = data_tree()
        never = {n: open(H_(n), "rb").read() for n in (".mac_token", ".devices.json", ".tinfoil_key", ".vapid.json")}
        w(H_(".thread.json"), "[]"); os.remove(H_("my-characters/zed.json")); w(H_("my-characters/new.json"), "{}")
        os.remove(H_(".media", photo)); os.remove(H_(".media/notahex.png")); w(V_("journal/a.md"), "changed"); w(V_("new.md"), "new"); shutil.rmtree(V_("empty"))
        w(H_(".memory_index.json"), "index")
        expect(lambda: inspect({"path": today, "key": k1[:-1] + ("0" if k1[-1] != "0" else "1")}), TYPO)
        assert check(today, key_text(os.urandom(32)))["error"] == WRONG_KEY and not os.path.exists(RESTORE)
        job = check(today)
        assert job["state"] == "ready", job["error"]
        sm = job["summary"]
        assert (sm["messages"], sm["characters"], sm["photos"], sm["note_files"], sm["notes"], sm["tinfoil"]) == (40, 2, 1, 4, True, True), sm
        assert K.hex() not in json.dumps(status()) and k1[:14] not in json.dumps(status()) and "fake-key" not in json.dumps(status())
        go()
        assert data_tree() == snap, set(data_tree().items()) ^ set(snap.items())
        assert {n: open(H_(n), "rb").read() for n in never} == never and os.path.isfile(H_(".tailnet/state"))
        assert not os.path.exists(RESTORE) and not os.path.exists(H_(".memory_index.json"))
        rs = _state()["restored"]; aside = rs["aside"][0]
        assert not rs["error"] and os.path.basename(aside).startswith("Buddy before restore") and os.path.dirname(aside) == home
        assert all(os.path.exists(os.path.join(aside, x)) for x in ("notes/.trash/old.md", "buddy/my-characters/x.json.tmp"))
        assert open(os.path.join(aside, "notes/journal/a.md")).read() == "changed" and os.path.isfile(os.path.join(aside, "notes/new.md"))
        assert os.path.isfile(os.path.join(aside, "buddy/my-characters/new.json")) and os.path.isfile(os.path.join(aside, "buddy/.memory_index.json"))
        assert not os.path.exists(os.path.join(aside, "buddy/.media")) and os.path.isdir(H_(".media"))   # (it was empty)
        c_ = cfg(); assert c_["phone_tailnet"] is True and c_["name"] == "CANARY-CFG" and c_["backup"]["dir"].startswith("~/")
        say("restore: typo / wrong key refused before anything; same files and mtimes as backed up; what was there is in "
            "~/Buddy before restore (empty folders not); pairing, tailnet and keys untouched; this Mac's settings kept")

        # 5. a restore that fails half way is undone; one cut off by a crash finishes next time
        w(H_(".memory_index.json"), "index2"); w(V_("journal/b.md"), "changed b"); w(H_("persona.local.txt"), "other")
        k = 0
        while True:
            before = {p_: v for p_, v in tree(here, vault).items() if not p_.startswith(H_(".backup_state.json"))}
            assert check(today)["state"] == "ready"
            restore({"notes": True, "keys": False}, lambda: None); _job["kind"] = None
            pp = os.path.join(RESTORE, "plan.json")
            if k >= len(json.load(open(pp))["items"]):
                os.remove(pp); _clear_staging(); break
            finish_restore(k)
            now_ = {p_: v for p_, v in tree(here, vault).items() if not p_.startswith(H_(".backup_state.json"))}
            assert now_ == before, (k, set(now_.items()) ^ set(before.items()))
            assert "Nothing was changed" in _state()["restored"]["error"] and not os.path.exists(RESTORE)
            assert not [x for x in os.listdir(home) if x.startswith("Buddy before restore") and x != os.path.basename(aside)]
            k += 1
        assert k == 7, k
        real_rename, k = os.rename, 0
        while True:                                          # a failure inside an item: its live copy is aside already
            before = {p_: v for p_, v in tree(here, vault).items() if not p_.startswith(H_(".backup_state.json"))}
            assert check(today)["state"] == "ready"
            restore({"notes": True, "keys": False}, lambda: None); _job["kind"] = None
            pp = os.path.join(RESTORE, "plan.json")
            todo = [it for it in json.load(open(pp))["items"] if it["staged"] and os.path.lexists(it["live"])]
            if k >= len(todo):
                os.remove(pp); _clear_staging(); break
            def failing(a, b, _s=todo[k]["staged"]):
                if a == _s: raise OSError(errno.ENOTEMPTY, "test")
                return real_rename(a, b)
            os.rename = failing
            try: finish_restore()
            finally: os.rename = real_rename
            now_ = {p_: v for p_, v in tree(here, vault).items() if not p_.startswith(H_(".backup_state.json"))}
            assert now_ == before, (k, set(now_.items()) ^ set(before.items()))
            assert "Nothing was changed" in _state()["restored"]["error"] and not os.path.exists(RESTORE)
            assert not [x for x in os.listdir(home) if x.startswith("Buddy before restore") and x != os.path.basename(aside)]
            k += 1
        assert k >= 5, k
        assert check(today)["state"] == "ready"              # something written into your notes folder between the two
        restore({"notes": True, "keys": False}, lambda: None); _job["kind"] = None   # renames: it can't all go back
        pp = os.path.join(RESTORE, "plan.json"); its = json.load(open(pp))["items"]
        nt = next(it for it in its if it["live"] == os.path.realpath(vault))
        def racing(a, b):
            if a == nt["staged"]: w(os.path.join(nt["live"], ".obsidian/workspace.json"), "{}")
            return real_rename(a, b)
        os.rename = racing
        try: finish_restore()
        finally: os.rename = real_rename
        rs = _state()["restored"]; st_ = status()["restored"]
        assert "Nothing was changed" not in rs["error"] and rs["aside"] and st_["show"], rs
        assert os.path.isfile(os.path.join(rs["aside"][0], "notes/journal/b.md")) and os.path.isfile(H_(".memory_index.json"))
        expect(lambda: inspect({"path": today}), "The last restore couldn't finish")
        shutil.rmtree(vault); real_rename(os.path.join(rs["aside"][0], "notes"), vault); shutil.rmtree(rs["aside"][0])
        shutil.rmtree(RESTORE)
        for k in range(1, 7):                                # a crash after k items (the k-th half done)
            w(V_("journal/b.md"), f"changed {k}"); w(H_(".thread.json"), f"[{k}]")
            job = check(today); assert job["state"] == "ready"
            restore({"notes": True, "keys": False}, lambda: None); _job["kind"] = None
            pp = os.path.join(RESTORE, "plan.json"); plan = json.load(open(pp))
            for i in range(k - 1):
                plan["done"].append({**_swap(plan["items"][i]), "i": i})
            _atomic(pp, json.dumps(plan))
            it = plan["items"][k - 1]
            if it["staged"] and os.path.lexists(it["live"]):
                os.makedirs(os.path.dirname(it["aside"]), exist_ok=True); os.rename(it["live"], it["aside"])
            finish_restore()
            assert data_tree() == snap and not _state()["restored"]["error"] and not os.path.exists(RESTORE), k
        say("restore: a failure after or inside any item is undone byte for byte (or, if it can't be, says where things are); "
            "a crash after any item finishes on the next start")

        # 6. hostile archives (made with the right key) are refused, nothing live touched
        def craft(members, man=None, end=None, after=None):
            b = io.BytesIO(); e = Enc(b, K, 10); t = tarfile.open(fileobj=e, mode="w|", format=tarfile.PAX_FORMAT)
            _put(t, "manifest.json", man or {"format": 1, "made": time.time(), "notes": True, "keys": False,
                                             "bytes": {"buddy": 10, "notes": 10}})
            files, nb = 0, {"buddy": 0, "notes": 0}
            for name, data, kind, pax in members:
                ti = tarfile.TarInfo(name); ti.mode = 0o600
                if kind == "sym": ti.type, ti.linkname = tarfile.SYMTYPE, "/etc/passwd"; t.addfile(ti); continue
                if kind == "dir": ti.type = tarfile.DIRTYPE; t.addfile(ti); continue
                ti.size, ti.pax_headers = len(data), pax or {}; t.addfile(ti, io.BytesIO(data))
                files += 1; nb[name.split("/")[0] if name.split("/")[0] in nb else "buddy"] += int((pax or {}).get("BUDDY.size", len(data)))
            _put(t, "end.json", end if end is not None else {"files": files, "bytes": nb, "bad": []})
            if after: _put(t, after, {})
            t.close(); e.close()
            p_ = os.path.join(tmp, "x.buddybackup"); open(p_, "wb").write(b.getvalue()); return p_
        f_ = lambda n, d=b"hi", pax=None: (n, d, "file", pax)
        before = {p_: v for p_, v in tree(here, vault).items() if not p_.startswith(H_(".backup_state.json"))}
        bad = [[f_("../x")], [f_("/etc/x")], [f_("notes/a/../../x")], [f_("buddy/.mac_token")], [f_("buddy/.devices.json")],
               [("notes/l", b"", "sym", None)], [f_("buddy/.tinfoil_key")], [f_("other/x")], [f_("buddy/.media/x.png")],
               [f_("notes/z.md", zlib.compress(b"a" * 1000), {"BUDDY.z": "1", "BUDDY.size": "10"})],
               [f_("notes/z.md", zlib.compress(b"a" * 1000), {"BUDDY.z": "1", "BUDDY.size": "5000"})],
               [f_("notes/z.md", b"not zlib", {"BUDDY.z": "1", "BUDDY.size": "8"})],
               [f_("notes/d.md"), f_("notes/d.md")], [f_("notes/./x")], [f_("buddy/my-characters/../.mac_token")],
               [f_("notes")]]
        for m in bad:
            assert check(craft(m))["error"] == DAMAGED, m
        assert check(craft([f_("notes/a.md")], end={"files": 2, "bytes": {"buddy": 0, "notes": 2}}))["error"] == DAMAGED
        assert check(craft([f_("notes/a.md")], end={}))["error"] == DAMAGED
        assert check(craft([f_("notes/a.md")], after="notes/late.md"))["error"] == DAMAGED
        assert check(craft([], man={"format": 2}))["error"] == NEWER
        assert check(craft([f_("buddy/.added_later.json")]))["error"] == NEWER      # (a name a newer Buddy backs up)
        assert check(craft([("buddy", b"", "dir", None)]))["state"] == "ready"     # (notes on, but no notes folder in it:
        restore({"notes": True, "keys": False}, lambda: None); _job["kind"] = None   #  yours is never part of the plan)
        pp = os.path.join(RESTORE, "plan.json")
        assert not [it for it in json.load(open(pp))["items"] if it["live"] == os.path.realpath(vault)]; os.remove(pp); _clear_staging()
        assert check(craft([f_("notes/a.md")]))["state"] == "ready"; cancel()      # (and a good one passes)
        now_ = {p_: v for p_, v in tree(here, vault).items() if not p_.startswith(H_(".backup_state.json"))}
        assert now_ == before and not os.path.exists(RESTORE) and not os.path.exists(os.path.join(home, ".buddy-restore-notes"))
        say(f"hostile archives: {len(bad) + 5} kinds refused as damaged or newer (paths out, links, pairing files, lying "
            "sizes, missing/wrong/early end); staging removed, nothing live touched")

        # a big file that changes while it's copied is left out of that backup (the restore drops it)
        orig = _Exactly.read
        def shrinking(self, n=-1):
            b = orig(self, n)
            if not getattr(self, "_cut", False): self._cut = True; os.truncate(V_("big.bin"), 100)
            return b
        _Exactly.read = shrinking
        try: post("now", {}, None); wait(lambda: not _job["kind"])
        finally: _Exactly.read = orig
        assert status()["last"]["skipped"] == 1 and not status()["error"]
        job = check(today); assert job["state"] == "ready" and not os.path.exists(os.path.join(RESTORE, "notes/big.bin"))
        cancel(); assert not os.path.exists(RESTORE)
        say("a big file changing mid-copy: marked, dropped on restore, counted as skipped")

        # errors: the drive is gone, then back
        r = post("folder", {"path": os.path.join(tmp, "vol/STICK")}, None); wait(lambda: not _job["kind"])
        assert status()["place"] == "STICK" and status()["count"] == 1
        good = status()["last"]
        shutil.rmtree(os.path.join(tmp, "vol/STICK")); post("now", {}, None); wait(lambda: not _job["kind"])
        s = status(); assert "isn't there" in s["error"]["message"] and s["last"] == good, s
        os.makedirs(os.path.join(tmp, "vol/STICK")); post("now", {}, None); wait(lambda: not _job["kind"])
        assert not status()["error"] and status()["count"] == 1
        say("errors: a missing drive is reported and the last good backup kept; fixed by itself when it's back")

        # a fresh install: nothing but the backup and the recovery key
        st_path = today
        here2 = os.path.join(tmp, "Fresh"); os.makedirs(here2); vault2 = os.path.join(home, "Buddy")
        shutil.rmtree(vault); os.makedirs(vault)                     # (a new Mac: an empty notes folder)
        for n in os.listdir(home):
            if n.startswith("Buddy before restore"): shutil.rmtree(os.path.join(home, n))
        use_paths(here2, vault2); cfgp = os.path.join(here2, "config.local.json")
        assert not saved_key() and status()["on"] is False
        job = check(st_path, " ".join(k1.lower().split("-"))); assert job["state"] == "ready", job["error"]
        go(notes=True, keys=True)
        assert os.path.isfile(os.path.join(here2, ".tinfoil_key")) and saved_key() == K and status()["on"]
        assert json.load(open(os.path.join(here2, ".thread.json")))[0]["content"] == "CANARY-MSG-0"
        assert cfg().get("phone_tailnet") is False and status()["dir"] == os.path.join(cloud, DIRNAME)
        assert os.path.isfile(os.path.join(vault2, "journal/a.md")) and not os.listdir(home) == []
        assert not [n for n in os.listdir(home) if n.startswith("Buddy before restore")]      # (nothing there to move)
        post("now", {}, None); wait(lambda: not _job["kind"]); assert not status()["error"]
        say("fresh install: restored with the typed key (lowercase, spaces); keys back, phone access off, backups go on")
        print("selftest ok", flush=True)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    if sys.argv[1:] != ["--selftest"]:
        sys.exit("usage: python3 backup.py --selftest")
    if AESGCM is None:
        sys.exit("selftest needs the cryptography package (Buddy's .venv has it)")
    sys.exit(_selftest())
