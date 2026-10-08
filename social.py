"""Buddy's social side: one shared conversation for Mac + phone, private push notifications,
and deciding when a character texts you first (like a friend would)."""
import json, os, random, subprocess, threading, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
THREAD = os.path.join(HERE, ".thread.json")
SUBS = os.path.join(HERE, ".push_subs.json")
VAPID = os.path.join(HERE, ".vapid.json")
_lock = threading.Lock()

def _load(p, default):
    try: return json.load(open(p))
    except Exception: return default

def _save(p, obj):
    tmp = p + ".tmp"; json.dump(obj, open(tmp, "w")); os.chmod(tmp, 0o600); os.replace(tmp, p)

# ---------- shared conversation ----------
# Private messages are never written to disk: they live only in this process's memory and are gone after 12 hours
# or when Buddy restarts. (Their photos too, see images.save(private=True).)
_private = []
_hw = 0        # the highest message id handed out (ids never go down, even after deletes, restarts or private ones fading)
_gen = {}      # char -> how many times its conversation was deleted (replies still being written for an older one are dropped)

def _fresh(m):                                          # private messages fade after 12 h
    return not (m.get("private") and m["ts"] < time.time() - 12 * 3600)

def thread(after=0):
    with _lock:
        t = _load(THREAD, []) + [m for m in _private if _fresh(m)]
        return sorted((m for m in t if m["id"] > after), key=lambda m: m["id"])

def gen(char):
    return _gen.get(char, 0)

def add(role, content, gen=None, **extra):
    """Adds a message; returns it (None if its conversation was deleted while it was being written: gen is old)."""
    global _hw
    prune_private()
    with _lock:
        if gen is not None and _gen.get(extra.get("char", "buddy"), 0) != gen:
            return None
        t = _load(THREAD, [])
        # time-based ids (ms) are bigger than any older small id and keep growing across restarts without a counter file
        nid = max([t[-1]["id"] if t else 0] + [m["id"] for m in _private] + [_hw, int(time.time() * 1000)]) + 1
        _hw = nid
        m = {"id": nid, "role": role, "content": content, "ts": time.time(), **extra}
        if m.get("private"):
            _private.append(m)
        else:
            t.append(m); _save(THREAD, t[-3000:])   # shared by all characters
            for old in t[:-3000]:                    # photos of messages trimmed off the end go too
                if old.get("image"):
                    try:
                        import images
                        images.remove(old["image"])
                    except Exception:
                        pass
        return m

def prune_private():
    """Private messages and their photos are dropped from memory once they're 12 hours old."""
    with _lock:
        gone = [m for m in _private if not _fresh(m)]
        _private[:] = [m for m in _private if _fresh(m)]
    for m in gone:
        if m.get("image"):
            try:
                import images
                images.remove(m["image"])
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
        if m.get("image"):
            try:
                import images
                images.remove(m["image"])
            except Exception:
                pass

def forget(char):
    """Deletes everything said with this character (both of you, private or not) and the photos they sent."""
    with _lock:
        _gen[char] = _gen.get(char, 0) + 1
        t = _load(THREAD, [])
        gone = [m for m in t + _private if m.get("char", "buddy") == char]
        _save(THREAD, [m for m in t if m.get("char", "buddy") != char])
        _private[:] = [m for m in _private if m.get("char", "buddy") != char]
    for m in gone:
        if m.get("image"):
            try:
                import images
                images.remove(m["image"])
            except Exception:
                pass
    return len(gone)

def recent_messages(n=30, include_private=False, char="buddy"):
    """One character's current conversation for the AI: everything since its last "New chat", oldest first.
    Private messages are only context for private replies, so they never leak into saved chats or their texts."""
    t = [m for m in thread() if m.get("char", "buddy") == char]
    start = max((i + 1 for i, m in enumerate(t) if m["role"] == "break"), default=0)
    return [{"role": m["role"], "content": m["content"] or (f"(I sent you a photo: {m['photo_desc']})" if m.get("photo_desc") else "")}
            for m in t[start:] if m["role"] in ("user", "assistant") and (include_private or not m.get("private"))][-n:]

def last_ts(role=None, proactive=None):
    for m in reversed(thread()):
        if (role is None or m["role"] == role) and (proactive is None or bool(m.get("proactive")) == proactive):
            return m["ts"]
    return 0

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

def push(note="Buddy sent you a message", contact="mailto:buddy@example.com"):
    """Content-free on purpose: Apple/Google only ever see this fixed note, never what was said."""
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
            webpush(s, json.dumps({"title": "Buddy", "body": note}), vapid_private_key=key,
                    vapid_claims={"sub": contact}, ttl=3600)      # fresh claims per phone (Apple and Google differ)
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

def start_proactive(cfg_fn, generate):
    """generate(reason, idle_min) -> (character id, text). Runs forever in the background."""
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
                reason = None
                if state["was_idle"] and idle < 1 and since_any > 30:
                    reason = "I just came back to my Mac after being away for a while"
                elif since_any > c.get("min_gap_min", 60) and since_mine > c.get("proactive_every_min", 150) \
                        and random.random() < 1 / 25:
                    reason = random.choice(["follow up", "personal question", "random topic", "share a thought", "check in"])
                state["was_idle"] = idle > 20
                if not reason:
                    continue
                char, text, photo = (tuple(generate(reason, int(idle)) or ()) + (None, None, None))[:3]
                if not text:
                    continue
                where = "mac" if idle < 3 else "phone"
                add("assistant", text, proactive=True, delivered=where, char=char)
                if photo:                                  # sometimes a picture comes with it
                    add("assistant", "", image=photo[0], photo_desc=photo[1], proactive=True, delivered=where, char=char)
                if idle >= 3:
                    push(contact=c.get("push_contact", "mailto:buddy@example.com"))
            except Exception:
                pass
    threading.Thread(target=loop, daemon=True).start()
