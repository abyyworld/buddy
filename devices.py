"""Who may use Buddy: this Mac's app and the phones/tablets you paired. Nothing else gets in (not other devices on
your tailnet, not other accounts or apps on this Mac, not the internet, not other websites).

- The Mac app's key lives in .mac_token (readable only by you); the app hands it to its own window as a cookie.
- A phone pairs once with a 6-digit code shown on the Mac (good for 10 minutes and 5 tries) and gets its own key,
  kept as an HttpOnly cookie on the phone. You can remove a device any time; its key stops working at once.
- Only hashes of keys and codes are stored (.devices.json, readable only by you)."""
import hashlib, hmac, json, os, secrets, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, ".devices.json")
MAC_TOKEN = os.path.join(HERE, ".mac_token")
_lock = threading.Lock()

def _h(s):
    return hashlib.sha256(str(s).encode()).hexdigest()

def _load():
    try:
        return json.load(open(FILE))
    except Exception:
        return {"devices": [], "pair": None}

def _save(d):
    tmp = FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(d, f, indent=1)
    os.replace(tmp, FILE)

def mac_token():
    """The Mac app's key (made once; the app reads the same file)."""
    try:
        fd = os.open(MAC_TOKEN, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_urlsafe(32))
    except FileExistsError:
        pass
    return open(MAC_TOKEN).read().strip()

def ensure():
    """At start: the Mac app is a known device. The first time locking is set up, phones subscribed to notifications
    before there was pairing are dropped (they get re-added when that phone pairs)."""
    with _lock:
        first = not os.path.exists(FILE)
        d = _load()
        d["devices"] = [x for x in d["devices"] if x.get("id") != "mac"]
        d["devices"].insert(0, {"id": "mac", "name": "This Mac", "kind": "mac", "hash": _h(mac_token()),
                                "created": 0, "seen": time.time()})
        _save(d)
    if first:
        try:
            import social
            social.drop_unpaired_subs()
        except Exception:
            pass

def check(token):
    """The device this key belongs to, or None."""
    if not token or len(token) > 200:
        return None
    th = _h(token)
    with _lock:
        d = _load()
        for x in d["devices"]:
            if hmac.compare_digest(x.get("hash", ""), th):
                if time.time() - x.get("seen", 0) > 600:         # "last used", without a write on every request
                    x["seen"] = time.time(); _save(d)
                return {k: x[k] for k in ("id", "name", "kind")}
    return None

def proof(nonce):
    """Shows the Mac app it's talking to this Buddy (only a server that can read .mac_token can answer this)."""
    return hmac.new(mac_token().encode(), str(nonce).encode(), hashlib.sha256).hexdigest()

def start_pairing():
    """A new 6-digit code for pairing a phone (the previous one stops working)."""
    code = f"{secrets.randbelow(10 ** 6):06d}"
    with _lock:
        d = _load()
        d["pair"] = {"hash": _h(code), "expires": time.time() + 600, "tries": 0}
        _save(d)
    return code, 600

def pair(code, name, kind="phone"):
    """Returns the new device's key if the code is right (and still valid), else None."""
    code = "".join(ch for ch in str(code) if ch.isdigit())
    with _lock:
        d = _load()
        p = d.get("pair")
        if not p or time.time() > p["expires"] or p["tries"] >= 5:
            d["pair"] = None; _save(d)
            return None
        if not hmac.compare_digest(p["hash"], _h(code)):
            p["tries"] += 1; _save(d)
            return None
        token = secrets.token_urlsafe(32)
        dev = {"id": secrets.token_hex(6), "name": (str(name).strip() or "Phone")[:40], "kind": kind,
               "hash": _h(token), "created": time.time(), "seen": time.time()}
        d["devices"].append(dev); d["pair"] = None
        _save(d)
        return token, {k: dev[k] for k in ("id", "name", "kind")}

def listing():
    with _lock:
        return [{k: x.get(k) for k in ("id", "name", "kind", "created", "seen")} for x in _load()["devices"]]

def remove(dev_id):
    if dev_id == "mac":
        return False
    with _lock:
        d = _load(); before = len(d["devices"])
        d["devices"] = [x for x in d["devices"] if x.get("id") != dev_id]
        _save(d)
    if len(d["devices"]) < before:
        try:
            import social
            social.drop_device_subs(dev_id)
        except Exception:
            pass
        return True
    return False
