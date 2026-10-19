"""Buddy's social side: one shared conversation for Mac + phone, private push notifications,
and deciding when a character texts you first (like a friend would)."""
import json, os, random, subprocess, threading, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
THREAD = os.path.join(HERE, ".thread.json")
GENS = os.path.join(HERE, ".gens.json")       # how many times each conversation was deleted (counts only)
SUBS = os.path.join(HERE, ".push_subs.json")
VAPID = os.path.join(HERE, ".vapid.json")
_lock = threading.Lock()

def _load(p, default):
    try: return json.load(open(p))
    except Exception: return default

def _save(p, obj):
    """Whole or not at all: a full disk or an I/O error raises (also from the last write, when the file is closed) and
    leaves the old file as it was."""
    tmp = p + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(obj, f); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, 0o600); os.replace(tmp, p)
    except BaseException:
        try: os.remove(tmp)
        except OSError: pass
        raise

# ---------- shared conversation ----------
# Private messages are never written to disk: they live only in this process's memory and are gone after 12 hours
# or when Buddy restarts. (Their photos too, see images.save(private=True).)
_private = []
_marks = []    # "<character> is sending a photo": memory only, gone when the photo arrives, fails, or `until` passes
_hw = 0        # the highest message id handed out (ids never go down, even after deletes, restarts or private ones fading)

def _load_gens():
    """{char id: how many times its conversation was deleted} from .gens.json (counts only; anything else is ignored)."""
    d = _load(GENS, {})
    return {str(k): v for k, v in d.items() if isinstance(v, int) and not isinstance(v, bool) and v >= 0} \
        if isinstance(d, dict) else {}
_gen = _load_gens()   # char -> how many times its conversation was deleted (replies still being written for an older one
                      # are dropped; kept on disk so a phone's messages for a conversation deleted meanwhile are too)

def _fresh(m):                                          # private messages fade after 12 h
    return not (m.get("private") and m["ts"] < time.time() - 12 * 3600)

def thread(after=0):
    with _lock:
        now = time.time()
        t = _load(THREAD, []) + [m for m in _private if _fresh(m)] + [m for m in _marks if m["until"] > now]
        return sorted((m for m in t if m["id"] > after), key=lambda m: m["id"])

def _next_id(t):
    """time-based ids (ms) are bigger than any older small id and keep growing across restarts without a counter file"""
    global _hw
    _hw = max([t[-1]["id"] if t else 0] + [m["id"] for m in _private + _marks] + [_hw, int(time.time() * 1000)]) + 1
    return _hw

def gen(char):
    return _gen.get(char, 0)

def add(role, content, gen=None, **extra):
    """Adds a message; returns it (None if its conversation was deleted while it was being written: gen is old)."""
    prune_private()
    with _lock:
        if gen is not None and _gen.get(extra.get("char", "buddy"), 0) != gen:
            return None
        t = _load(THREAD, [])
        m = {"id": _next_id(t), "role": role, "content": content, "ts": time.time(), **extra}
        if m.get("private"):
            _private.append(m)
        else:
            t.append(m); _save(THREAD, t[-3000:])   # shared by all characters
            for old in t[:-3000]:                    # photos of messages trimmed off the end go too
                for media in (old.get("image"), old.get("voice")):
                    if not media: continue
                    try:
                        import images
                        images.remove(media)
                    except Exception:
                        pass
        return m

def mark(char, job, eta, until, **extra):
    """Shows "<character> is sending a photo…" on every device while the picture is being made (never on disk).
    Returns the marker; unmark(job) takes it away (the photo, or the note that it failed, has arrived)."""
    with _lock:
        m = {"id": _next_id(_load(THREAD, [])), "ts": time.time(), "role": "assistant", "content": "",
             "pending_photo": job, "eta": int(eta), "until": float(until), "char": char,
             **{k: v for k, v in extra.items() if v is not None}}
        _marks.append(m)
        return m

def unmark(job):
    with _lock:
        _marks[:] = [m for m in _marks if m["pending_photo"] != job]

def update(mid, **fields):
    """Adds details to a message already in the conversation (e.g. what was in a photo you sent, once it was looked
    at). Private ones change only in memory. True if it was found."""
    with _lock:
        for m in _private:
            if m["id"] == mid:
                m.update(fields); return True
        t = _load(THREAD, [])
        for m in t:
            if m["id"] == mid:
                m.update(fields); _save(THREAD, t); return True
    return False

def prune_private():
    """Private messages and their photos are dropped from memory once they're 12 hours old."""
    with _lock:
        gone = [m for m in _private if not _fresh(m)]
        _private[:] = [m for m in _private if _fresh(m)]
        _marks[:] = [m for m in _marks if m["until"] > time.time()]
    for m in gone:
        for media in (m.get("image"), m.get("voice")):
            if not media: continue
            try:
                import images
                images.remove(media)
            except Exception:
                pass
    try:
        import images
        images.prune()
    except Exception:
        pass

def forget_private_on_disk():
    """At start: private messages saved by older versions are deleted from disk (with their photos)."""
    with _lock:
        t = _load(THREAD, [])
        gone = [m for m in t if m.get("private")]
        if gone:
            _save(THREAD, [m for m in t if not m.get("private")])
    for m in gone:
        for media in (m.get("image"), m.get("voice")):
            if not media: continue
            try:
                import images
                images.remove(media)
            except Exception:
                pass

def forget(char):
    """Deletes everything said with this character (both of you, private or not) and the photos they sent."""
    with _lock:
        _gen[char] = _gen.get(char, 0) + 1
        if os.path.dirname(GENS) == os.path.dirname(THREAD):   # (the counts go with the thread file next to them:
            try: _save(GENS, _gen)                             # a thread kept elsewhere, as in tests, leaves them be)
            except OSError: pass
        t = _load(THREAD, [])
        gone = [m for m in t + _private if m.get("char", "buddy") == char]
        _save(THREAD, [m for m in t if m.get("char", "buddy") != char])
        _private[:] = [m for m in _private if m.get("char", "buddy") != char]
        _marks[:] = [m for m in _marks if m.get("char", "buddy") != char]
    for m in gone:
        for media in (m.get("image"), m.get("voice")):
            if not media: continue
            try:
                import images
                images.remove(media)
            except Exception:
                pass
    return len(gone)

def private_counts(char=None):
    """Private messages right now (one character's, or everyone's): counts only, for "What Buddy knows"."""
    with _lock:
        mine = [m for m in _private if _fresh(m) and (char is None or m.get("char", "buddy") == char)]
    return {"messages": sum(1 for m in mine if m.get("role") in ("user", "assistant") and not m.get("image")),
            "photos": sum(1 for m in mine if m.get("image")), "last_ts": max((m["ts"] for m in mine), default=0)}

def _as_text(m, desc=True):
    """What the AI reads for a message: photos become words (what was in them), never the picture itself.
    desc=False (the free brain): only that there was a photo, never what was in it."""
    if m["role"] == "user" and m.get("voice"):
        return ("(a voice message) " + (m["content"] or "(I couldn't make out the words)")).strip()
    if m["role"] == "assistant" and m.get("image"):   # their own photo, written the way they send one (the old
        d = " ".join(str(m.get("photo_desc") or "").replace("[", "(").replace("]", ")").split())   # "(I sent you a
        return f"[photo: {d}]" if desc and d else "[photo]"     # photo: …)" taught them to type photos as words)
    if not desc and m.get("image"):
        return ("(I sent you a photo) " + (m["content"] or "")).strip()
    if m["role"] == "user" and m.get("image"):
        seen = f"(I'm sending you a photo: {m['photo_desc']})" if m.get("photo_desc") else "(I sent you a photo)"
        return (seen + " " + (m["content"] or "")).strip()
    return m["content"] or ""

def for_free(m, since):
    """A message the free brain (Less private) may be given: said since it was turned on (since), not a reply that
    drew on your notes or facts (those carry "sources"), not part of a conversation Phala had (brain: "phala"), and
    not a reply written in phone mode (direct): Tinfoil wrote those on the phone, with what the free brain never gets
    (a photo you sent or what was in it, your facts, whether you're married, the conversation from before)."""
    return (m.get("ts", 0) >= since and not m.get("sources") and m.get("brain") != "phala"
            and not (m.get("direct") and m.get("role") == "assistant"))

def recent_messages(n=30, include_private=False, char="buddy", since=None):
    """One character's current conversation for the AI: everything since its last "New chat", oldest first.
    Private messages are only context for private replies, so they never leak into saved chats or their texts.
    since (the free brain): only the messages for_free(since), and photos without what was in them."""
    t = [m for m in thread() if m.get("char", "buddy") == char and not m.get("pending_photo")]
    start = max((i + 1 for i, m in enumerate(t) if m["role"] == "break"), default=0)
    seen, out = {m["id"]: m for m in t[start:]}, []
    ok = (lambda m: True) if since is None else (lambda m: for_free(m, since))
    for m in t[start:]:
        if (m.get("private") and not include_private) or not ok(m):
            continue
        if m["role"] in ("user", "assistant"):
            out.append({"role": m["role"], "content": _as_text(m, desc=since is None)})
        elif m["role"] == "reaction" and m.get("by") == "you" and m.get("emoji"):   # your 😂 on one of theirs
            to = seen.get(m.get("target"))
            if to and to["role"] == "assistant" and ok(to):
                out.append({"role": "user", "content": f"(I reacted {m['emoji']} to your message: \"{' '.join(_as_text(to, since is None).split())[:80]}\")"})
    return out[-n:]

def find(mid):
    """One message by id (private ones from memory), or None."""
    with _lock:
        for m in _private:
            if m["id"] == mid: return dict(m)
    return next((dict(m) for m in thread() if m["id"] == mid), None)

def last_ts(role=None, proactive=None):
    """The newest time (not the last id: messages from phone mode get new ids but keep their own, older times)."""
    return max((m["ts"] for m in thread() if not m.get("pending_photo") and (role is None or m["role"] == role)
                and (proactive is None or bool(m.get("proactive")) == proactive)), default=0)

def by_cid(cid):
    """A copy of the (never private) message a phone wrote in phone mode with this client id, or None."""
    with _lock:
        return next((dict(m) for m in _load(THREAD, []) if m.get("cid") == cid and not m.get("private")), None)

# ---------- phone mode: what a phone needs of the conversation, and its messages coming back ----------
# Fields a phone may get of a message (never private ones, never which notes a reply was given).
PHONE_FIELDS = ("id", "role", "content", "ts", "via", "from", "image", "w", "h", "photo_desc", "seen", "voice", "dur",
                "mode", "knows", "target", "emoji", "by", "photo_failed", "why", "direct", "cid", "proactive",
                "delivered")

def _phone_msgs(t, char, n):
    """What recent_messages(n, char=char) reads of one conversation (since its last New chat), plus the reactions on
    those messages (for showing them)."""
    t = [m for m in t if m.get("char", "buddy") == char and not m.get("pending_photo") and not m.get("private")]
    cur = t[max((i + 1 for i, m in enumerate(t) if m["role"] == "break"), default=0):]
    by_id, keep, got = {m["id"]: m for m in cur}, set(), 0
    for m in reversed(cur):
        if got >= n:
            break
        if m["role"] in ("user", "assistant"):
            keep.add(m["id"]); got += 1
        elif (m["role"] == "reaction" and m.get("by") == "you" and m.get("emoji")
              and (by_id.get(m.get("target")) or {}).get("role") == "assistant"):
            keep.update((m["id"], m["target"])); got += 1
    keep |= {m["id"] for m in cur if m["role"] == "reaction" and m.get("target") in keep}
    return [{**{k: m[k] for k in PHONE_FIELDS if k in m}, "char": char} for m in cur if m["id"] in keep]

def phone_context(chars, n=30):
    """Each character's current conversation for phone mode, read in one go under the lock (from the file only:
    private messages and markers live in memory), so an epoch and its messages always belong together."""
    with _lock:
        t = sorted((m for m in _load(THREAD, []) if not m.get("private") and not m.get("pending_photo")),
                   key=lambda m: m["id"])
        def newest(c):                                # (by time: who sent it tells "you never answered" from "I didn't")
            said = [m for m in t if m.get("char", "buddy") == c and m["role"] in ("user", "assistant")]
            return max(reversed(said), key=lambda m: m["ts"]) if said else {"ts": 0, "role": ""}
        return {"upto": max((m["id"] for m in t), default=0),
                "chars": {c: {"epoch": _gen.get(c, 0), "last_ts": newest(c)["ts"], "last_role": newest(c)["role"],
                              "msgs": _phone_msgs(t, c, n)} for c in chars}}

def add_imported(items):
    """Messages written on a phone in phone mode join the shared thread, in the order given: fresh ids at the end (so
    every device's ?after= picks them up) with their own times; each client id (cid) only once; nothing for a
    conversation deleted since (epoch). items: checked by buddy_server.check_imports, media cleaned ("_photo":
    (full, view, w, h), "_voice": (data, dur)). -> (results, [(item, message)]). Media is saved only for messages that
    are added; if a picture, a recording or the thread can't be saved, every media file saved for this batch is removed
    again and the error goes on (the phone gets a 5xx and sends the batch again)."""
    import images
    global _hw
    prune_private()
    results, added, saved, trimmed, done = [], [], [], [], False
    try:
        with _lock:
            t = _load(THREAD, [])
            known = {m["cid"]: m["id"] for m in t if m.get("cid")}
            ids = {m["id"]: m for m in t}
            nid = max([t[-1]["id"] if t else 0] + [m["id"] for m in _private + _marks] + [_hw, int(time.time() * 1000)])
            for it in items:
                cid, char, role = it["cid"], it["char"], it["role"]
                if cid in known:                                  # sent again (the answer didn't reach the phone)
                    results.append({"cid": cid, "id": known[cid], "dup": True}); continue
                if it["epoch"] < _gen.get(char, 0):               # that conversation was deleted on the Mac meanwhile
                    results.append({"cid": cid, "dropped": "deleted"}); continue   # (a count that went back, e.g. a
                                                                  # restored backup, deleted nothing they wrote)
                m = {"role": role, "content": it["content"], "ts": it["ts"], "char": char, "cid": cid,
                     "from": "phone", "direct": True}
                if role == "reaction":
                    to = ids.get(known.get(it["target_cid"]) if it.get("target_cid") else it.get("target"))
                    if not to or to.get("private") or to["role"] not in ("user", "assistant") \
                            or to.get("char", "buddy") != char:
                        results.append({"cid": cid, "dropped": "no such message"}); continue
                    m.update(target=to["id"], emoji=it["emoji"], by=it["by"])
                elif role in ("user", "assistant"):
                    m.update(private=False, via="call" if it.get("call") else "phone")
                    if role == "assistant": m["mode"] = it["mode"]
                    if it.get("_photo"):                          # (a disk error goes on: the phone keeps it and
                        full, view, w, h = it["_photo"]           # sends it again, so nothing of it is lost)
                        mid = images.save(full, view=view); saved.append(mid)
                        m.update(image=mid, w=w, h=h)
                        m.update({"photo_desc": it["photo_desc"], "seen_by": it["seen_by"]} if it.get("seen_by")
                                 else {"photo_desc": it["photo_desc"]} if it.get("photo_desc")
                                 else {"seen": False} if it.get("seen") is False else {})
                    if it.get("_voice"):
                        vid = images.save_audio(it["_voice"][0]); saved.append(vid)
                        m.update(voice=vid, dur=it["_voice"][1])
                    if role == "assistant":
                        if it.get("sources"): m["sources"] = it["sources"]
                        if it.get("knows"): m["knows"] = True
                nid += 1
                m = {"id": nid, **m}
                t.append(m); ids[nid] = m; known[cid] = nid
                added.append((it, m)); results.append({"cid": cid, "id": nid})
            if added:
                trimmed = t[:-3000]
                _save(THREAD, t[-3000:])
                _hw = nid
            done = True
    finally:
        if not done:                                      # nothing half-stored: no file without its message
            for mid in saved:
                images.remove(mid)
    for old in trimmed:                                   # photos of messages trimmed off the end go too
        for media in (old.get("image"), old.get("voice")):
            if not media: continue
            try: images.remove(media)
            except Exception: pass
    return results, added

# ---------- private push notifications (no message text ever leaves the Mac) ----------
def ensure_vapid():
    """Creates this Mac's own push signing key once (stored in .vapid.json, never committed)."""
    if _load(VAPID, {}).get("public"):
        return
    try:
        import base64
        from py_vapid import Vapid
        from cryptography.hazmat.primitives import serialization
    except ImportError:
        return
    v = Vapid(); v.generate_keys()
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    with _lock:
        _save(VAPID, {"public": base64.urlsafe_b64encode(raw).decode().rstrip("="),
                      "private_pem": v.private_pem().decode()})

def vapid_public():
    ensure_vapid()
    return _load(VAPID, {}).get("public", "")

PUSH_HOSTS = ("web.push.apple.com", ".push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com",
              ".notify.windows.com")

def subscribe(sub, device):
    """A paired device's notification address. Only the real push services are accepted (Apple, Google, Mozilla,
    Microsoft), and only the keys a subscription needs are kept."""
    ep = str(sub.get("endpoint", ""))
    host = urllib.parse.urlparse(ep).hostname or ""
    keys = sub.get("keys") if isinstance(sub.get("keys"), dict) else {}
    if not ep.startswith("https://") or not any(host == h.lstrip(".") or host.endswith(h) for h in PUSH_HOSTS) \
            or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("bad subscription")
    clean = {"endpoint": ep[:1000], "keys": {"p256dh": str(keys["p256dh"])[:200], "auth": str(keys["auth"])[:100]},
             "device": device}
    with _lock:
        subs = [s for s in _load(SUBS, []) if s.get("endpoint") != ep and s.get("device") != device]
        subs.append(clean); _save(SUBS, subs[-20:])

def drop_unpaired_subs():
    """Notification addresses from before pairing existed (their phones re-add themselves once paired)."""
    with _lock: _save(SUBS, [s for s in _load(SUBS, []) if s.get("device")])

def drop_device_subs(device):
    with _lock: _save(SUBS, [s for s in _load(SUBS, []) if s.get("device") != device])

def phone_count():
    return len(_load(SUBS, []))

def preview(cfg, name, text="", private=False, photo=False):
    """What a notification shows: who it's from and the message, like any messenger (setting push_preview, on by
    default); "Buddy sent you a message" when that's off or the message is private. Web Push encrypts it end to end
    to the phone (RFC 8291), so Apple/Google carry it without being able to read it."""
    if private or not cfg.get("push_preview", True):
        return "Buddy", "Buddy sent you a message"
    body = " ".join(str(text or "").split())
    body = (body[:147].rstrip() + "…") if len(body) > 150 else body
    return (name or "Buddy"), (body or ("📷 Photo" if photo else "Sent you a message"))

def push(note="Buddy sent you a message", contact="mailto:buddy@example.com", title="Buddy"):
    """Sends a notification to every paired phone (see preview() for what it says)."""
    try:
        from pywebpush import webpush, WebPushException
        from py_vapid import Vapid
    except ImportError:
        return 0
    ensure_vapid()
    pem = _load(VAPID, {}).get("private_pem")
    if not pem:
        return 0
    key, sent, dead = Vapid.from_pem(pem.encode()), 0, set()
    for s in _load(SUBS, []):
        try:
            webpush(s, json.dumps({"title": title, "body": note}), vapid_private_key=key,     # fresh claims per phone
                    vapid_claims={"sub": contact}, ttl=3600, timeout=10)   # (Apple and Google differ); never stuck on one
            sent += 1
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):   # drop expired phones only
                dead.add(s.get("endpoint"))
        except Exception:
            pass
    if dead:
        with _lock: _save(SUBS, [s for s in _load(SUBS, []) if s.get("endpoint") not in dead])
    return sent

# ---------- are you at the Mac? ----------
def mac_idle_seconds():
    try:
        out = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True, timeout=3).stdout
        for line in out.splitlines():
            if "HIDIdleTime" in line:
                return int(line.split("=")[-1].strip()) / 1e9
    except Exception:
        pass
    return 0

# ---------- when does a character text first? ----------
def _quiet(cfg):
    h = time.localtime().tm_hour + time.localtime().tm_min / 60
    a, b = cfg.get("quiet_from", 23.0), cfg.get("quiet_until", 8.5)
    return (h >= a or h < b) if a > b else (a <= h < b)

def start_proactive(cfg_fn, generate, photo=None, name=lambda cid: "Buddy", life=None):
    """generate(reason, idle_min) -> (character id, text, photo scene or None, notes used). Runs forever in the
    background. photo(character id, scene, delivered): starts making a picture to go with the text (it arrives when
    it's ready). life(idle_min, came_back): with their own lives on (setting "lives"), texts come from moments in their
    days instead (it plans the days, writes, stores and notifies itself)."""
    state = {"was_idle": False}
    def loop():
        while True:
            time.sleep(60)
            prune_private()                          # every minute, even with texting first off
            try:
                c = cfg_fn()
                if not c.get("proactive", True) or _quiet(c):
                    continue
                idle = mac_idle_seconds() / 60
                since_any = (time.time() - max(last_ts("user"), last_ts("assistant"))) / 60
                since_mine = (time.time() - last_ts("assistant", proactive=True)) / 60
                came_back = state["was_idle"] and idle < 1 and since_any > 30
                if life and c.get("lives", True):
                    state["was_idle"] = idle > 20
                    life(int(idle), came_back)
                    continue
                reason = None
                if came_back:
                    reason = "I just came back to my Mac after being away for a while"
                elif since_any > c.get("min_gap_min", 60) and since_mine > c.get("proactive_every_min", 150) \
                        and random.random() < 1 / 25:
                    reason = random.choice(["follow up", "personal question", "random topic", "share a thought", "check in"])
                state["was_idle"] = idle > 20
                if not reason:
                    continue
                char, text, scene, src, extra = (tuple(generate(reason, int(idle)) or ()) + (None,) * 5)[:5]
                if not text:
                    continue
                where = "mac" if idle < 3 else "phone"
                add("assistant", text, proactive=True, delivered=where, char=char, **({"sources": src} if src else {}),
                    **(extra or {}))
                if scene and photo:                        # sometimes a picture follows (made in the background)
                    try: photo(char, scene, where)
                    except Exception: pass
                if idle >= 3:
                    who, body = preview(c, name(char), text)
                    push(note=body, contact=c.get("push_contact", "mailto:buddy@example.com"), title=who)
            except Exception:
                pass
    threading.Thread(target=loop, daemon=True).start()
