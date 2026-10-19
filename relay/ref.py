#!/usr/bin/env python3
"""Buddy's sync relay, the reference version: Python 3.9+, standard library only.

The same protocol as the Cloudflare Worker (worker.js; README.md "Protocol" is the contract), used by the tests and for
running your own relay (a home server, a Pi, a VPS) behind TLS: Caddy, or `tailscale serve` for a relay only your
tailnet can reach. It binds 127.0.0.1 unless told otherwise and only ever holds what devices encrypted themselves:
records (overwritten in place, no history; SQLite with secure_delete), blobs (files, 0600), link mailboxes (memory).
It writes no logs. Invite-only, like the Worker.

  python3 relay/ref.py serve  --data DIR [--port 8787] [--host 127.0.0.1] [--origins https://abyyworld.github.io]
                              [--ip-header X-Forwarded-For] [--quota-records N] [--quota-record-bytes N]
                              [--quota-blob-bytes N] [--quota-devices N]
  python3 relay/ref.py invite --data DIR [--days 30]
"""
import argparse, base64, hashlib, hmac, ipaddress, json, os, re, secrets, shutil, sqlite3, struct, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

KiB, MiB, GiB = 1024, 1024 ** 2, 1024 ** 3
SEC, MIN, HOUR, DAY = 1000, 60 * 1000, 3600 * 1000, 86400 * 1000

LIMITS = {
    "records": 100000, "record_bytes": 200 * MiB, "blob_bytes": 2 * GiB, "devices": 32,
    "record_max": MiB, "blob_max": 16 * MiB,
    "put_items": 200, "put_bytes": 2 * MiB,
    "changes_items": 500, "changes_bytes": 4 * MiB,
    "copy_items": 100,
    "requests_per_min": 600,
    "creates_per_ip_day": 3, "boxes_per_ip_hour": 10, "box_reads_per_min": 30,
    "box_ttl_s": 600, "box_msgs": 8, "box_msg_bytes": 8 * KiB,
    "auth_failures": 10, "auth_failure_window_s": 600,
    "device_rows": 4,
    "tombstone_days": 180, "idle_days": 365, "orphan_blob_hours": 24, "deleted_blob_days": 7,
    "delete_after_max_s": 1209600,
}
QUOTAS = ("records", "record_bytes", "blob_bytes", "devices")    # the only limits a deployment may change

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (rid TEXT PRIMARY KEY, ver INTEGER NOT NULL, seq INTEGER NOT NULL, ct BLOB,
                                    deleted_at INTEGER);
CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
CREATE INDEX IF NOT EXISTS records_deleted ON records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS devices (dev TEXT PRIMARY KEY, token_hash BLOB NOT NULL, added INTEGER, by TEXT, seen INTEGER,
                                    endpoint TEXT, revoked INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v BLOB);
CREATE TABLE IF NOT EXISTS blobs (bid TEXT PRIMARY KEY, rid TEXT, size INTEGER, at INTEGER);
"""

ACCOUNT_ROUTES = [          # (path after /v1/a/{acct}, methods, largest body), as worker.js
    (re.compile(r"\Z"), ("POST", "DELETE"), 2 * MiB),
    (re.compile(r"/changes\Z"), ("GET",), 0),
    (re.compile(r"/put\Z"), ("POST",), 3 * MiB),
    (re.compile(r"/usage\Z"), ("GET",), 0),
    (re.compile(r"/devices\Z"), ("GET", "POST"), 64 * KiB),
    (re.compile(r"/devices/[A-Za-z0-9_-]{22}\Z"), ("DELETE",), 0),
    (re.compile(r"/blob/copy\Z"), ("POST",), 64 * KiB),
    (re.compile(r"/blob/[A-Za-z0-9_-]{22}\Z"), ("GET", "PUT", "DELETE"), 16 * MiB + 28),
]
ALLOW_HEADERS = "authorization, content-type, x-rid, x-confirm, x-delete-after, if-none-match"

RE_ACCT = re.compile(r"[0-9a-hjkmnp-tv-z]{26}\Z")
RE_ID = re.compile(r"[A-Za-z0-9_-]{22}\Z")
RE_B64 = re.compile(r"[A-Za-z0-9_-]*={0,2}\Z")
RE_ADMIN = re.compile(r"Buddy-Admin ([A-Za-z0-9_-]{43}=?)\Z")
RE_BEARER = re.compile(r"Bearer ([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43}=?)\Z")
RE_TOKEN = re.compile(r"([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43}=?)\Z")


def now_ms():               # every clock read goes through here
    return int(time.time() * 1000)


# ---------- encodings and crypto (the same as common.js)
def b64e(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64d(s):
    if not isinstance(s, str) or not RE_B64.match(s):
        return None
    s = s.rstrip("=")
    if len(s) % 4 == 1:
        return None
    try:
        return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
    except (ValueError, TypeError):
        return None


B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"      # Crockford base32 (backup.py's alphabet)


def b32(b):                 # most significant bit first, 5 bits a character, the last one zero-filled
    bits = len(b) * 8
    pad = -bits % 5
    n = int.from_bytes(b, "big") << pad
    k = (bits + pad) // 5
    return "".join(B32[(n >> (5 * i)) & 31] for i in range(k - 1, -1, -1))


def b32norm(text):
    return re.sub(r"[\s.\-]", "", str(text or "")).upper().translate(str.maketrans("OIL", "011"))


def b32d(s):
    n = 0
    for c in s:
        i = B32.find(c)
        if i < 0:
            return None
        n = n * 32 + i
    bits = len(s) * 5
    k = bits // 8
    return (n >> (bits - 8 * k)).to_bytes(k, "big")


def sha256(b):
    return hashlib.sha256(b).digest()


def ip_key(ip):             # per-IP limits count an IPv6 /64 as one address (one home or phone), as common.js
    ip = str(ip or "").strip().lower()
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if a.version == 6 and a.ipv4_mapped:
        return str(a.ipv4_mapped)
    if a.version == 6:
        return ":".join("%x" % int(g, 16) for g in a.exploded.split(":")[:4]) + "::/64"
    return str(a)


def acct_of(atok):          # the account id is a hash of the admin token: the relay stores no secret
    return b32(sha256(b"buddy-sync v1 account" + atok)).lower()[:26]


def record_size_ok(n):      # SPEC3 §7.4: version (1) + nonce (12) + padded plaintext + tag (16)
    p = n - 29
    if p < 512 or p > LIMITS["record_max"]:
        return False
    return (p & (p - 1)) == 0 if p <= 64 * KiB else p % (64 * KiB) == 0


def blob_size_ok(n):        # SPEC3 §7.5: nonce (12) + data padded to 64 KiB multiples + tag (16)
    p = n - 28
    return 64 * KiB <= p <= LIMITS["blob_max"] and p % (64 * KiB) == 0


INVITE_LABEL = b"buddy-relay invite v1"


def invite_key(text):
    if not isinstance(text, str):
        return None
    k = b64d(text.strip().replace("+", "-").replace("/", "_"))
    return k if k and len(k) >= 32 else None


def make_invite(key, days=30, now=None, nonce=None):
    nonce = nonce or secrets.token_bytes(8)
    exp = struct.pack(">I", (now_ms() if now is None else now) // 1000 + round(days * 86400))
    mac = hmac.new(key, INVITE_LABEL + nonce + exp, hashlib.sha256).digest()[:8]
    s = b32(nonce + exp + mac)
    return "-".join(s[i:i + 4] for i in range(0, 32, 4))


def check_invite(key, text, now):
    s = b32norm(text)
    if not key or len(s) != 32:
        return None
    b = b32d(s)
    if not b or len(b) != 20:
        return None
    nonce, exp, mac = b[:8], b[8:12], b[12:]
    if not hmac.compare_digest(mac, hmac.new(key, INVITE_LABEL + nonce + exp, hashlib.sha256).digest()[:8]):
        return None
    until = struct.unpack(">I", exp)[0] * 1000
    return (nonce.hex(), until) if until > now else None


# ---------- responses: (status, headers, body)
def jres(status, obj, headers=None):
    h = {"content-type": "application/json"}
    h.update(headers or {})
    return status, h, json.dumps(obj, separators=(",", ":")).encode()


def err(status, error, more=None, headers=None):
    d = {"error": error}
    d.update(more or {})
    return jres(status, d, headers)


def slow(retry_ms):
    return err(429, "slow down", None, {"retry-after": str(max(1, -(-int(retry_ms) // 1000)))})


def parse_json(body):
    try:
        j = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        j = None
    return j if isinstance(j, dict) else None


BAD_JSON = err(400, "bad request", {"why": "the body must be a JSON object"})


def is_int(v):               # (as JavaScript reads JSON: 1.0 is the integer 1)
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


class Relay:
    def __init__(self, data, origins=("https://abyyworld.github.io",), quotas=None, housekeep_every=3600):
        os.umask(0o077)
        self.data = os.path.abspath(data)
        for d in (self.data, os.path.join(self.data, "accounts"), os.path.join(self.data, "blobs")):
            os.makedirs(d, mode=0o700, exist_ok=True)
            os.chmod(d, 0o700)
        self.key = invite_key(load_invite_secret(self.data))
        self.origins = list(origins)
        self.lim = dict(LIMITS)
        self.lim.update({k: v for k, v in (quotas or {}).items() if k in QUOTAS and v})
        self.lock = threading.RLock()
        self.dbs = {}
        self.fails, self.win, self.hits = {}, {}, {}
        self.boxes, self.box_reads = {}, {}
        self.reg = sqlite3.connect(os.path.join(self.data, "relay.db"), check_same_thread=False, isolation_level=None)
        self.reg.execute("CREATE TABLE IF NOT EXISTS invites (nonce TEXT PRIMARY KEY, acct TEXT NOT NULL, until INTEGER NOT NULL)")
        for name in os.listdir(os.path.join(self.data, "blobs")):          # blobs of an account whose delete was cut short
            if not os.path.exists(self.db_path(name)):
                shutil.rmtree(os.path.join(self.data, "blobs", name), ignore_errors=True)
        if housekeep_every:
            threading.Thread(target=self._housekeeper, args=(housekeep_every,), daemon=True).start()

    # ---- storage
    def db_path(self, acct):
        return os.path.join(self.data, "accounts", acct + ".db")

    def blob_path(self, acct, bid):             # hex of the id: safe on case-insensitive disks too
        return os.path.join(self.data, "blobs", acct, bid.encode().hex())

    def db(self, acct, create=False):
        c = self.dbs.get(acct)
        if c is not None:
            return c
        path = self.db_path(acct)
        if not create and not os.path.exists(path):
            return None
        c = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        os.chmod(path, 0o600)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA secure_delete = ON")       # deleted and overwritten ciphertext doesn't linger in the file
        self.dbs[acct] = c
        return c

    @staticmethod
    def meta(c):
        try:
            m = {r["k"]: r["v"] for r in c.execute("SELECT k, v FROM meta")}
        except sqlite3.OperationalError:
            return None
        return m if m.get("created") else None

    @staticmethod
    def setm(c, m, k, v):
        c.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", (k, v))
        m[k] = v

    def addm(self, c, m, k, d):
        self.setm(c, m, k, (m.get(k) or 0) + d)

    def wipe(self, acct):                       # the database first (from then on the account is gone), then the blobs
        c = self.dbs.pop(acct, None)
        if c is not None:
            c.close()
        for p in (self.db_path(acct), self.db_path(acct) + "-journal"):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
        shutil.rmtree(os.path.join(self.data, "blobs", acct), ignore_errors=True)

    # ---- per-IP and per-account limits (memory only)
    def take(self, ip, bucket, limit, window):
        now = now_ms()
        hs = [x for x in self.hits.get(ip, []) if x[1] > now]
        mine = [u for b, u in hs if b == bucket]
        if len(mine) >= limit:
            self.hits[ip] = hs
            return min(mine) - now
        hs.append((bucket, now + window))
        self.hits[ip] = hs
        return 0

    def backoff(self, acct, ip):
        f, w, now = self.fails.get((acct, ip)), self.lim["auth_failure_window_s"] * 1000, now_ms()
        if f and now - f[0] < w and f[1] >= self.lim["auth_failures"]:
            return slow(f[0] + w - now)
        return None

    def fail(self, acct, ip):
        w, now = self.lim["auth_failure_window_s"] * 1000, now_ms()
        f = self.fails.get((acct, ip))
        if not f or now - f[0] >= w:
            f = [now, 0]
        f[1] += 1
        self.fails[(acct, ip)] = f
        if len(self.fails) > 2000:
            self.fails = {k: v for k, v in self.fails.items() if now - v[0] < w}
        return err(401, "auth")

    # ---- the front door
    @staticmethod
    def body_limit(method, path):               # the largest body a route takes; None: no such route (404/405)
        m = re.match(r"/v1/a/[0-9a-hjkmnp-tv-z]{26}(/.*)?\Z", path)
        if m:
            for rx, methods, mx in ACCOUNT_ROUTES:
                if rx.match(m.group(1) or ""):
                    return mx if method in methods else None
            return None
        if re.match(r"/v1/m/[0-9a-hjkmnp-tv-z]{26}\Z", path) and method in ("GET", "PUT", "DELETE"):
            return 16 * KiB
        return None

    def precheck(self, method, path, h, ip):    # before a body is read: the account and the caller must be real
        m = re.match(r"/v1/a/([0-9a-hjkmnp-tv-z]{26})(/.*)?\Z", path)
        if not m or (not m.group(2) and method == "POST"):  # (creating: nothing stored to check yet)
            return None
        acct = m.group(1)
        with self.lock:
            c = self.db(acct)
            mt = self.meta(c) if c is not None else None
            if not mt or mt.get("acct") != acct:
                return err(404, "no account")
            who = self.backoff(acct, ip) or self.auth(acct, c, h, ip)
            return who if isinstance(who, tuple) else None

    def dispatch(self, method, path, query, h, body, ip):
        if path == "/v1/info":
            if method != "GET":
                return err(405, "method")
            return jres(200, {"v": 1, "vapid": None, "push": False, "invite": True, "limits": self.lim})
        m = re.match(r"/v1/a/([^/]+)(/.*)?\Z", path)
        if m:
            acct, rest = m.group(1), m.group(2) or ""
            if not RE_ACCT.match(acct):
                return err(404, "not found")
            r = next((r for r in ACCOUNT_ROUTES if r[0].match(rest)), None)
            if not r:
                return err(404, "not found")
            if method not in r[1]:
                return err(405, "method", None, {"allow": ", ".join(r[1])})
            with self.lock:
                return self.account(acct, rest or "/", method, query, h, body, ip)
        m = re.match(r"/v1/m/([^/]+)\Z", path)
        if m:
            if not RE_ACCT.match(m.group(1)):
                return err(404, "not found")
            if method not in ("GET", "PUT", "DELETE"):
                return err(405, "method", None, {"allow": "GET, PUT, DELETE"})
            with self.lock:
                return self.mailbox(m.group(1), method, query, body, ip)
        return err(404, "not found")

    # ---- accounts
    def admin_ok(self, acct, h):
        mm = RE_ADMIN.match(h.get("authorization", ""))
        atok = mm and b64d(mm.group(1))
        return bool(atok and len(atok) == 32 and acct_of(atok) == acct)

    def device(self, c, dev, tok_b64):          # "ok" | "revoked" | None
        tok = b64d(tok_b64)
        row = c.execute("SELECT token_hash, revoked FROM devices WHERE dev = ?", (dev,)).fetchone()
        if not row or not tok or len(tok) != 32 or not hmac.compare_digest(bytes(row["token_hash"]), sha256(tok)):
            return None
        return "revoked" if row["revoked"] else "ok"

    def auth(self, acct, c, h, ip):
        a = h.get("authorization", "")
        if a.startswith("Buddy-Admin "):
            return {"admin": True} if self.admin_ok(acct, h) else self.fail(acct, ip)
        mm = RE_BEARER.match(a)
        state = mm and self.device(c, mm.group(1), mm.group(2))
        if not state:
            return self.fail(acct, ip)
        if state == "revoked":
            return jres(410, {"error": "revoked", "revoked": True})     # the device wipes itself
        return {"dev": mm.group(1)}

    def account(self, acct, path, method, q, h, body, ip):
        c = self.db(acct)
        m = self.meta(c) if c is not None else None
        if path == "/" and method == "POST":
            return self.create(acct, h, body, ip, m)
        if not m or m.get("acct") != acct:
            return err(404, "no account")
        wait = self.backoff(acct, ip)
        if wait:
            return wait
        who = self.auth(acct, c, h, ip)
        if isinstance(who, tuple):
            return who
        now = now_ms()
        w = self.win.get(acct)
        if not w or w[0] != now // MIN:
            w = self.win[acct] = [now // MIN, 0]
        w[1] += 1
        if w[1] > self.lim["requests_per_min"]:
            return slow(MIN - now % MIN)
        if now - (m.get("last_seen") or 0) >= MIN:
            self.setm(c, m, "last_seen", now)
        if "dev" in who:
            r = c.execute("SELECT seen FROM devices WHERE dev = ?", (who["dev"],)).fetchone()
            if now - (r["seen"] or 0) >= MIN:
                c.execute("UPDATE devices SET seen = ? WHERE dev = ?", (now, who["dev"]))
        dev, adm = "dev" in who, "admin" in who
        no_dev, no_admin = err(401, "auth"), err(403, "admin")
        if path == "/" and method == "DELETE":
            return self.remove(acct, c, m, h) if adm else no_admin
        if path == "/changes":
            return self.changes(c, m, q) if dev else no_dev
        if path == "/put":
            return self.put(c, m, body) if dev else no_dev
        if path == "/usage":
            return self.usage(m) if dev else no_dev
        if path == "/devices" and method == "GET":
            return self.devices(c) if dev else no_dev
        if path == "/devices":
            return self.add_device(c, m, body, who)
        if path.startswith("/devices/"):
            return self.revoke(c, path[9:], who)
        if path == "/blob/copy":
            return self.copy(acct, c, m, body) if dev else no_dev
        if path.startswith("/blob/"):
            if not dev:
                return no_dev
            bid = path[6:]
            if method == "PUT":
                return self.blob_put(acct, c, m, bid, h, body)
            if method == "GET":
                return self.blob_get(acct, c, bid)
            return self.blob_delete(acct, c, m, bid)
        return err(404, "not found")

    def create(self, acct, h, body, ip, m):
        j = parse_json(body)
        if j is None:
            return BAD_JSON
        wait = self.backoff(acct, ip)
        if wait:
            return wait
        if not self.admin_ok(acct, h):
            return self.fail(acct, ip)
        if m:
            return err(409, "exists")
        d, hdr = j.get("dev"), j.get("hdr")
        d = d if isinstance(d, dict) else {}
        hdr = hdr if isinstance(hdr, dict) else {}
        th, ct = b64d(d.get("token_hash")), b64d(hdr.get("ct"))
        if not RE_ID.match(str(d.get("id", ""))) or not th or len(th) != 32 or not RE_ID.match(str(hdr.get("rid", ""))) \
                or not ct:
            return err(400, "bad request", {"why": "dev {id, token_hash} and hdr {rid, ct}"})
        if len(ct) > LIMITS["record_max"] + 29:
            return err(413, "too large")
        if not record_size_ok(len(ct)):
            return err(400, "padding")
        if not self.key:
            return err(503, "not set up", {"why": "the relay has no invite secret"})
        inv = check_invite(self.key, j.get("invite"), now_ms())
        if not inv:
            self.fail(acct, ip)
            return err(403, "invite")
        retry = self.take(ip, "create", self.lim["creates_per_ip_day"], DAY)
        if retry:
            return slow(retry)
        row = self.reg.execute("SELECT acct FROM invites WHERE nonce = ?", (inv[0],)).fetchone()
        if row and row[0] != acct:
            return err(403, "invite", {"why": "used"})
        if not row:
            self.reg.execute("INSERT INTO invites (nonce, acct, until) VALUES (?, ?, ?)", (inv[0], acct, inv[1]))
        now = now_ms()
        self.wipe(acct)                         # (leftovers of an account deleted before; none normally)
        c = self.db(acct, create=True)
        c.executescript(SCHEMA)
        c.execute("BEGIN IMMEDIATE")
        for k, v in (("acct", acct), ("created", now), ("last_seen", now), ("seq", 1), ("horizon", 0), ("nrec", 1),
                     ("bytes", len(ct)), ("nblob", 0), ("blob_bytes", 0)):
            c.execute("INSERT INTO meta (k, v) VALUES (?, ?)", (k, v))
        c.execute("INSERT INTO devices (dev, token_hash, added, by, seen) VALUES (?, ?, ?, 'admin', ?)",
                  (d["id"], th, now, now))
        c.execute("INSERT INTO records (rid, ver, seq, ct) VALUES (?, 1, 1, ?)", (hdr["rid"], ct))
        c.execute("COMMIT")
        return jres(201, {"seq": 1, "now": now})

    def changes(self, c, m, q):
        sq, lq = q.get("since", ["0"])[0], q.get("limit", [str(LIMITS["changes_items"])])[0]
        if not re.match(r"[0-9]{1,15}\Z", sq) or not re.match(r"[0-9]{1,6}\Z", lq) or int(lq) < 1:
            return err(400, "bad request", {"why": "since, limit"})
        since, limit = int(sq), int(lq)
        if 0 < since < m["horizon"]:
            return jres(410, {"error": "horizon", "horizon": m["horizon"]})
        n = min(limit, LIMITS["changes_items"])
        rows = c.execute("SELECT rid, ver, seq, length(ct) AS size FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
                         (since, n + 1)).fetchall()
        items, total, more = [], 0, False
        for r in rows:
            if len(items) == n or (items and total + (r["size"] or 0) > LIMITS["changes_bytes"]):
                more = True
                break
            total += r["size"] or 0
            items.append({"rid": r["rid"], "ver": r["ver"], "seq": r["seq"], "ct": None})
        if items:
            cts = {r["seq"]: bytes(r["ct"]) for r in c.execute(
                "SELECT seq, ct FROM records WHERE seq > ? AND seq <= ? AND ct IS NOT NULL", (since, items[-1]["seq"]))}
            for it in items:
                if it["seq"] in cts:
                    it["ct"] = b64e(cts[it["seq"]])
        return jres(200, {"seq": m["seq"], "horizon": m["horizon"], "more": more, "now": now_ms(), "items": items})

    def put(self, c, m, body):
        if m.get("delete_at"):
            return err(409, "read-only", {"delete_at": m["delete_at"]})
        j = parse_json(body)
        if j is None:
            return BAD_JSON
        items = j.get("items")
        if not isinstance(items, list) or not items:
            return err(400, "bad request", {"why": "items"})
        if len(items) > LIMITS["put_items"]:
            return err(413, "too large", {"why": "items"})
        seen, its, total = set(), [], 0
        for it in items:
            ok = isinstance(it, dict) and RE_ID.match(str(it.get("rid", ""))) and is_int(it.get("base")) \
                and 0 <= it["base"] <= 2 ** 31 and (it.get("ct", 0) is None or isinstance(it.get("ct"), str)) \
                and it["rid"] not in seen
            if not ok:
                return err(400, "bad request", {"why": "each item is {rid, base, ct | null}, every rid once"})
            seen.add(it["rid"])
            ct = None if it["ct"] is None else b64d(it["ct"])
            if it["ct"] is not None and not ct:
                return err(400, "bad request", {"why": "ct"})
            if ct and len(ct) > LIMITS["record_max"] + 29:
                return err(413, "too large")
            if ct and not record_size_ok(len(ct)):
                return err(400, "padding")
            total += len(ct) if ct else 0
            its.append((it["rid"], int(it["base"]), ct))
        if total > LIMITS["put_bytes"]:
            return err(413, "too large")
        go, results, rows, delta = [], [None] * len(its), 0, 0
        for i, (rid, base, ct) in enumerate(its):
            cur = c.execute("SELECT ver, length(ct) AS size FROM records WHERE rid = ?", (rid,)).fetchone()
            if base != (cur["ver"] if cur else 0):
                continue
            go.append(i)
            rows += 0 if cur else 1
            delta += (len(ct) if ct else 0) - ((cur["size"] or 0) if cur else 0)
        if rows and m["nrec"] + rows > self.lim["records"]:
            return err(507, "quota", {"what": "records"})
        if delta > 0 and m["bytes"] + delta > self.lim["record_bytes"]:
            return err(507, "quota", {"what": "bytes"})
        now, seq = now_ms(), m["seq"]
        c.execute("BEGIN IMMEDIATE")
        for i in go:
            rid, base, ct = its[i]
            seq += 1
            c.execute("INSERT OR REPLACE INTO records (rid, ver, seq, ct, deleted_at) VALUES (?, ?, ?, ?, ?)",
                      (rid, base + 1, seq, ct, None if ct else now))
            results[i] = {"rid": rid, "ver": base + 1, "seq": seq}
        self.setm(c, m, "seq", seq)
        self.addm(c, m, "nrec", rows)
        self.addm(c, m, "bytes", delta)
        c.execute("COMMIT")
        sent = 0
        for i, (rid, base, ct) in enumerate(its):    # a conflict carries the current version (its ct while small)
            if results[i] is not None:
                continue
            cur = c.execute("SELECT ver, ct FROM records WHERE rid = ?", (rid,)).fetchone()
            conflict = {"ver": cur["ver"] if cur else 0}
            cct = bytes(cur["ct"]) if cur and cur["ct"] is not None else None
            if cct is None:
                conflict["ct"] = None
            elif sent + len(cct) <= LIMITS["changes_bytes"]:
                conflict["ct"] = b64e(cct)
                sent += len(cct)
            results[i] = {"rid": rid, "conflict": conflict}
        return jres(200, {"seq": m["seq"], "results": results})

    def usage(self, m):
        return jres(200, {"records": m["nrec"], "bytes": m["bytes"], "blobs": m["nblob"], "blob_bytes": m["blob_bytes"],
                          "quota": {"records": self.lim["records"], "bytes": self.lim["record_bytes"],
                                    "blob_bytes": self.lim["blob_bytes"], "devices": self.lim["devices"]},
                          "created": m["created"], "last_seen": m["last_seen"], "delete_at": m.get("delete_at")})

    @staticmethod
    def devices(c):
        rows = c.execute("SELECT dev, added, by, seen, endpoint FROM devices WHERE revoked IS NULL ORDER BY added, dev")
        return jres(200, [{"id": r["dev"], "added": r["added"], "by": r["by"], "seen": r["seen"], "push": bool(r["endpoint"])}
                          for r in rows])

    def add_device(self, c, m, body, who):
        if m.get("delete_at"):
            return err(409, "read-only", {"delete_at": m["delete_at"]})
        j = parse_json(body)
        if j is None:
            return BAD_JSON
        th = b64d(j.get("token_hash"))
        if not RE_ID.match(str(j.get("id", ""))) or not th or len(th) != 32:
            return err(400, "bad request", {"why": "{id, token_hash}"})
        if c.execute("SELECT 1 FROM devices WHERE dev = ?", (j["id"],)).fetchone():
            return err(409, "exists")
        n, gone = c.execute("SELECT count(*), count(revoked) FROM devices").fetchone()     # removed ones count too
        if n - gone >= self.lim["devices"] or n >= LIMITS["device_rows"] * self.lim["devices"]:
            return err(507, "quota", {"what": "devices"})
        now, by = now_ms(), "admin" if "admin" in who else who["dev"]
        c.execute("INSERT INTO devices (dev, token_hash, added, by) VALUES (?, ?, ?, ?)", (j["id"], th, now, by))
        return jres(201, {"id": j["id"], "added": now, "by": by})

    @staticmethod
    def revoke(c, dev, who):                    # the recovery key (admin) or the device itself; also while read-only
        if "admin" not in who and who.get("dev") != dev:
            return err(403, "admin")
        row = c.execute("SELECT revoked FROM devices WHERE dev = ?", (dev,)).fetchone()
        if not row:
            return err(404, "no device")
        if not row["revoked"]:
            c.execute("UPDATE devices SET revoked = ?, endpoint = NULL WHERE dev = ?", (now_ms(), dev))
        return jres(200, {"revoked": dev})

    # ---- blobs
    def reserve(self, c, m, bid, rid, size):
        c.execute("INSERT INTO blobs (bid, rid, size, at) VALUES (?, ?, ?, ?)", (bid, rid, size, now_ms()))
        self.addm(c, m, "nblob", 1)
        self.addm(c, m, "blob_bytes", size)

    def unreserve(self, acct, c, m, bid):
        r = c.execute("SELECT size FROM blobs WHERE bid = ?", (bid,)).fetchone()
        if not r:
            return
        c.execute("DELETE FROM blobs WHERE bid = ?", (bid,))
        self.addm(c, m, "nblob", -1)
        self.addm(c, m, "blob_bytes", -r["size"])
        try:
            os.remove(self.blob_path(acct, bid))
        except FileNotFoundError:
            pass

    def write_blob(self, acct, bid, data):
        d = os.path.join(self.data, "blobs", acct)
        os.makedirs(d, mode=0o700, exist_ok=True)
        tmp = self.blob_path(acct, bid) + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.blob_path(acct, bid))

    def blob_quota(self, m, size):
        if m["blob_bytes"] + size > self.lim["blob_bytes"]:
            return err(507, "quota", {"what": "blob_bytes"})
        return None

    def blob_put(self, acct, c, m, bid, h, body):
        if m.get("delete_at"):
            return err(409, "read-only", {"delete_at": m["delete_at"]})
        rid = h.get("x-rid", "")
        if not RE_ID.match(rid):
            return err(400, "bad request", {"why": "X-Rid: the record that will hold the blob's key"})
        if not blob_size_ok(len(body)):
            return err(400, "padding")
        if c.execute("SELECT 1 FROM blobs WHERE bid = ?", (bid,)).fetchone():
            return err(412, "exists")
        q = self.blob_quota(m, len(body))
        if q:
            return q
        self.reserve(c, m, bid, rid, len(body))
        try:
            self.write_blob(acct, bid, body)
        except OSError:
            self.unreserve(acct, c, m, bid)
            return err(500, "server")
        return jres(201, {"bid": bid, "size": len(body)})

    def blob_get(self, acct, c, bid):
        if not c.execute("SELECT 1 FROM blobs WHERE bid = ?", (bid,)).fetchone():
            return err(404, "no blob")
        try:
            with open(self.blob_path(acct, bid), "rb") as f:
                data = f.read()
        except FileNotFoundError:
            return err(404, "no blob")
        return 200, {"content-type": "application/octet-stream"}, data

    def blob_delete(self, acct, c, m, bid):
        if m.get("delete_at"):
            return err(409, "read-only", {"delete_at": m["delete_at"]})
        had = c.execute("SELECT 1 FROM blobs WHERE bid = ?", (bid,)).fetchone() is not None
        self.unreserve(acct, c, m, bid)
        return jres(200, {"deleted": had})

    def copy(self, acct, c, m, body):           # new recovery key: the old account's blobs move over, no re-upload
        if m.get("delete_at"):
            return err(409, "read-only", {"delete_at": m["delete_at"]})
        j = parse_json(body)
        if j is None:
            return BAD_JSON
        bids, frm = j.get("bids"), str(j.get("from", ""))
        ok = RE_ACCT.match(frm) and frm != acct and isinstance(j.get("from_auth"), str) and isinstance(bids, list) \
            and bids and all(isinstance(b, dict) and RE_ID.match(str(b.get("bid", ""))) and RE_ID.match(str(b.get("rid", "")))
                             for b in bids) and len({b["bid"] for b in bids}) == len(bids)
        if not ok:
            return err(400, "bad request", {"why": "{from, from_auth, bids: [{bid, rid}]}"})
        if len(bids) > LIMITS["copy_items"]:
            return err(413, "too large", {"why": "bids"})
        oc = self.db(frm)
        om = self.meta(oc) if oc is not None else None
        if not om or om.get("acct") != frm:
            return err(404, "no account", {"which": "from"})
        mm = RE_TOKEN.match(j["from_auth"])
        if not mm or self.device(oc, mm.group(1), mm.group(2)) != "ok":
            return err(403, "from_auth")
        out = {"copied": [], "missing": [], "exists": []}
        todo = []
        for b in bids:
            r = oc.execute("SELECT size FROM blobs WHERE bid = ?", (b["bid"],)).fetchone()
            if c.execute("SELECT 1 FROM blobs WHERE bid = ?", (b["bid"],)).fetchone():
                out["exists"].append(b["bid"])
            elif not r:
                out["missing"].append(b["bid"])
            else:
                todo.append((b, r["size"]))
        q = self.blob_quota(m, sum(s for _, s in todo))
        if q:
            return q
        for b, size in todo:
            try:
                with open(self.blob_path(frm, b["bid"]), "rb") as f:
                    data = f.read()
            except FileNotFoundError:
                out["missing"].append(b["bid"])
                continue
            self.reserve(c, m, b["bid"], b["rid"], size)
            try:
                self.write_blob(acct, b["bid"], data)
            except OSError:
                self.unreserve(acct, c, m, b["bid"])
                return err(500, "server")
            out["copied"].append(b["bid"])
        return jres(200, out)

    # ---- deleting
    def remove(self, acct, c, m, h):
        if h.get("x-confirm") != acct:
            return err(400, "confirm", {"why": "X-Confirm: <account id>"})
        after = h.get("x-delete-after")
        if after is not None:
            s = int(after) if re.match(r"[0-9]{1,8}\Z", after) else 0
            if s < 1 or s > LIMITS["delete_after_max_s"]:
                return err(400, "bad request", {"why": "X-Delete-After: 1-1209600 seconds"})
            at = now_ms() + s * 1000
            self.setm(c, m, "delete_at", at)
            return jres(202, {"delete_at": at})
        self.wipe(acct)
        return jres(200, {"deleted": True})

    def housekeep(self, accts=None):            # the Worker's daily alarm, for every account (or the ones named)
        with self.lock:
            now = now_ms()
            names = accts if accts is not None else [f[:-3] for f in os.listdir(os.path.join(self.data, "accounts"))
                                                     if f.endswith(".db")]
            for acct in names:
                c = self.db(acct)
                m = self.meta(c) if c is not None else None
                if not m:
                    continue
                if (m.get("delete_at") and now >= m["delete_at"]) or now - m["last_seen"] >= LIMITS["idle_days"] * DAY:
                    self.wipe(acct)
                    continue
                cut = now - LIMITS["tombstone_days"] * DAY
                c.execute("DELETE FROM devices WHERE revoked IS NOT NULL AND revoked <= ?", (cut,))
                t = c.execute("SELECT count(*), max(seq) FROM records WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
                              (cut,)).fetchone()
                if t[0]:
                    c.execute("BEGIN IMMEDIATE")
                    c.execute("DELETE FROM records WHERE deleted_at IS NOT NULL AND deleted_at <= ?", (cut,))
                    self.addm(c, m, "nrec", -t[0])
                    self.setm(c, m, "horizon", max(m["horizon"], t[1]))    # an older cursor missed a deletion: 410
                    c.execute("COMMIT")
                gone = [r[0] for r in c.execute(
                    "SELECT b.bid FROM blobs b LEFT JOIN records r ON r.rid = b.rid "
                    "WHERE (r.rid IS NULL AND b.at <= ?) OR (r.deleted_at IS NOT NULL AND r.deleted_at <= ?)",
                    (now - LIMITS["orphan_blob_hours"] * HOUR, now - LIMITS["deleted_blob_days"] * DAY))]
                for bid in gone:
                    self.unreserve(acct, c, m, bid)
            ttl = LIMITS["box_ttl_s"] * 1000
            self.boxes = {k: v for k, v in self.boxes.items() if now < v["created"] + ttl}
            self.hits = {k: [x for x in v if x[1] > now] for k, v in self.hits.items()}
            self.hits = {k: v for k, v in self.hits.items() if v}
            self.reg.execute("DELETE FROM invites WHERE until <= ?", (now,))

    def _housekeeper(self, every):
        while True:
            try:
                self.housekeep()
            except Exception:                   # keep going; there are no logs to write it to
                pass
            time.sleep(every)

    # ---- link mailboxes (memory only)
    def mailbox(self, box, method, q, body, ip):
        ttl, now = LIMITS["box_ttl_s"] * 1000, now_ms()
        b = self.boxes.get(box)
        if b and now >= b["created"] + ttl:
            b = self.boxes.pop(box)
            b = None
        if method == "DELETE":
            self.boxes.pop(box, None)
            return jres(200, {"ok": True})
        if method == "GET":
            if self.box_reads.get("") != now // MIN:            # this minute's counts only (any box id may be read)
                self.box_reads = {"": now // MIN}
            r = self.box_reads.get(box)
            if not r:
                r = self.box_reads[box] = [now // MIN, 0]
            r[1] += 1
            if r[1] > LIMITS["box_reads_per_min"]:
                return slow(MIN - now % MIN)
            if not b:
                return err(404, "no mailbox")
            aq = q.get("after", ["0"])[0]
            if not re.match(r"[0-9]{1,6}\Z", aq):
                return err(400, "bad request", {"why": "after"})
            after = int(aq)
            return jres(200, {"msgs": [{"n": i + 1, "m": b64e(x)} for i, x in enumerate(b["msgs"]) if i + 1 > after],
                              "exp": b["created"] + ttl})
        j = parse_json(body)
        if j is None:
            return BAD_JSON
        msg = b64d(j.get("m"))
        if not msg:
            return err(400, "bad request", {"why": "m"})
        if len(msg) > LIMITS["box_msg_bytes"]:
            return err(413, "too large")
        if not b:
            retry = self.take(ip, "box", LIMITS["boxes_per_ip_hour"], HOUR)
            if retry:
                return slow(retry)
            b = self.boxes[box] = {"created": now, "msgs": []}
        if len(b["msgs"]) >= LIMITS["box_msgs"]:
            return err(409, "full")
        b["msgs"].append(msg)
        return jres(201, {"n": len(b["msgs"]), "exp": b["created"] + ttl})


def load_invite_secret(data):                   # made once, 0600; `ref.py invite` reads the same file
    path = os.path.join(data, "invite.key")
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        text = base64.b64encode(secrets.token_bytes(32)).decode() + "\n"
        with os.fdopen(fd, "w") as f:
            f.write(text)
        return text


class Handler(BaseHTTPRequestHandler):
    server_version = "buddy-relay"
    sys_version = ""
    timeout = 30                                # a connection that sends nothing for 30 s is dropped

    def log_message(self, *args):               # no logs
        pass

    def do_GET(self): self.go("GET")
    def do_POST(self): self.go("POST")
    def do_PUT(self): self.go("PUT")
    def do_DELETE(self): self.go("DELETE")
    def do_OPTIONS(self): self.go("OPTIONS")
    def do_HEAD(self): self.go("HEAD")
    def do_PATCH(self): self.go("PATCH")

    def client_ip(self):
        hdr = self.server.ip_header
        v = self.headers.get(hdr, "") if hdr else ""
        ip = v.split(",")[-1].strip() if v else self.client_address[0]
        return hashlib.sha256(("buddy-relay ip|" + ip_key(ip)).encode()).hexdigest()[:32]

    def drain(self, n):                         # read a refused body so the client sees the answer, up to 32 MiB
        if n <= 32 * MiB:
            while n > 0:
                got = self.rfile.read(min(n, 1 << 20))
                if not got:
                    break
                n -= len(got)

    def go(self, method):
        relay = self.server.relay
        u = urlsplit(self.path)
        h = {k.lower(): v for k, v in self.headers.items()}
        origin = h.get("origin")
        allowed = origin is None or origin in relay.origins
        close = False
        if not allowed:
            res = err(403, "origin")
        elif method == "OPTIONS":
            res = (204, {"access-control-allow-methods": "GET, POST, PUT, DELETE", "access-control-allow-headers": ALLOW_HEADERS,
                         "access-control-max-age": "86400"}, b"")
        elif "transfer-encoding" in h:
            res, close = err(411, "length required"), True
        else:
            try:
                n = int(h.get("content-length") or 0)
            except ValueError:
                n = -1
            limit = relay.body_limit(method, u.path)
            if n < 0:
                res, close = err(400, "bad request"), True
            elif limit is not None and n > limit:
                res, close = err(413, "too large"), True
                self.drain(n)
            else:
                ip, res = self.client_ip(), None
                if limit is None:               # 404, 405 or /v1/info: the body (if any) isn't kept
                    body, close = b"", n > 0
                    self.drain(n)
                elif n:
                    try:                        # (a stranger's body is never held in memory)
                        res = relay.precheck(method, u.path, h, ip)
                    except Exception:
                        res = err(500, "server")
                    if res:
                        close = True
                        self.drain(n)
                    else:
                        body = self.rfile.read(n)
                else:
                    body = b""
                if res is None:
                    try:
                        res = relay.dispatch(method, u.path, parse_qs(u.query), h, body, ip)
                    except Exception:
                        res = err(500, "server")
        status, headers, body = res
        self.send_response(status)
        headers = dict(headers)
        headers.update({"cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
                        "content-length": str(len(body))})
        if origin is not None and allowed:
            headers.update({"access-control-allow-origin": origin, "access-control-expose-headers": "retry-after",
                            "vary": "Origin"})
        if close:
            headers["connection"] = "close"
            self.close_connection = True
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(body)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128                    # (the default 5 makes a burst of connections wait a second)
    max_connections = 64                        # more at once get 503 (each may hold a 16 MiB body)

    def __init__(self, addr, relay, ip_header=None):
        super().__init__(addr, Handler)
        self.relay, self.ip_header = relay, ip_header
        self.slots = threading.BoundedSemaphore(self.max_connections)

    def handle_error(self, request, client_address):   # no logs (the default prints the client's address)
        pass

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nContent-Length: 0\r\n"
                                b"Connection: close\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main(argv=None):
    p = argparse.ArgumentParser(description="Buddy's sync relay (reference version, stdlib only).")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the relay")
    s.add_argument("--data", required=True, help="folder for the relay's data (0700)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8787)
    s.add_argument("--origins", default="https://abyyworld.github.io",
                   help="website origins allowed to use it from a browser, comma-separated")
    s.add_argument("--ip-header", default=None,
                   help="behind a reverse proxy: the header with the client's address (e.g. X-Forwarded-For)")
    for q in QUOTAS:
        s.add_argument("--quota-" + q.replace("_", "-"), type=int, default=None)
    i = sub.add_parser("invite", help="print an invite (one account each)")
    i.add_argument("--data", required=True)
    i.add_argument("--days", type=float, default=30)
    a = p.parse_args(argv)
    if a.cmd == "invite":
        os.umask(0o077)
        os.makedirs(a.data, mode=0o700, exist_ok=True)
        if not 0 < a.days <= 3650:
            p.error("--days must be between 1 and 3650")
        print("Invite (one sync account, valid %g days):\n\n  %s\n" % (a.days, make_invite(invite_key(load_invite_secret(a.data)), a.days)))
        return 0
    quotas = {q: getattr(a, "quota_" + q) for q in QUOTAS}
    relay = Relay(a.data, [o for o in re.split(r"[\s,]+", a.origins) if o], quotas)
    srv = Server((a.host, a.port), relay, a.ip_header)
    print("buddy relay listening on http://%s:%d (put TLS in front of it: README.md)" % srv.server_address[:2], flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
