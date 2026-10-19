"""A fake Mac for phone mode's browser tests (fake data only: nothing real is read, nothing is written outside a temp
folder). It serves a temp copy of web/ the way buddy_server does (/, /phone, /phone/ -> chat.html; /icons/* ->
default-icons/; the /phone CSP that allows Tinfoil, the plain CSP elsewhere; .mjs and .js as text/javascript; no-store),
the fake Tinfoil SDK at /vendor/tinfoil.mjs, and the /api/ endpoints the page uses, in memory: two characters (Buddy;
Mara, a Companion with a profile picture, an avoid word and looks), a conversation with a private message and a photo,
per-character epochs, a phone-mode kit (/api/phonekit) and the import (/api/thread/import, SPEC2 §3.3).

A control port the page never uses changes how the "Mac" behaves (POST /mode with one of):
  up | refuse (listening socket closed, reopened on up) | hang (accept, never answer) | slow <ms> [path] |
  proxy502 (plain-text 502 for everything) | unpaired (/api/me -> paired: false, the rest of /api/ 401) |
  locked [path] (401 except /api/me; with a path: only there) | kit-off (/api/phonekit -> 403 phone_mode: false) | kit-on |
  kit-free (/api/phonekit -> 403 phone_mode: false, free: true: the free brain without a Tinfoil key) |
  fail-file <path> [status] (500, or that status, for one path; "-" clears) | reset (all of it back to normal)
and POST /drop-import-response (store the next import, then close without answering), POST /epoch {char} (a Mac-side
delete: epoch + 1, that character's messages gone), POST /touch {path} (change a served file), POST /set {...},
GET /log (every request the page made: method, path, all headers, the raw body as base64), GET /thread, GET /state.

Run: python3 -B tests/phonemode/fake_mac.py [--real-sdk]
It prints one JSON line {"port", "control", "web", "mac_token", "sdk", "pid"} and serves until killed.
(The fake SDK is tests/phonemode/fake_tinfoil.mjs; --real-sdk serves web/vendor/tinfoil.mjs as it is.)"""
import argparse, base64, binascii, hashlib, json, math, os, re, secrets, shutil, signal, socket, struct, sys, tempfile
import threading, time, urllib.parse, zlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; "
       "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
PHONE_CSP = CSP.replace("connect-src 'self'", "connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh")
SHELL_FILES = ("chat.html", "sw.js", "manifest.json", "pcm-tap.js", "direct.js", "vendor/tinfoil.mjs",
               "default-icons/icon-180.png", "default-icons/icon-192.png", "default-icons/icon-512.png")
CID = re.compile(r"[A-Za-z0-9_-]{16,64}")
SEEN_BY = re.compile(r"[A-Za-z0-9._:/@+-]{1,80}")
REACTIONS = ("❤️", "😂", "👍", "😮", "😢", "🔥")
MAC_TOKEN = "mac-" + "0" * 40                            # the fake Mac app's own key (a test value)
LOOKS = "tall woman with a red coat and green eyes"
PRIVATE_TEXT = "PRIVATE-XYZ only between us"
HIDDEN_FACT = "Sarah is my sister."                    # kept from Mara (her avoid word): never in the kit

def png(w, h, rgb):
    """A small solid-colour PNG (the fake profile picture)."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

def jpeg_size(b):
    """(w, h) from a JPEG's frame header, or None (also the check that it is one)."""
    if b[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(b):
        if b[i] != 0xFF:
            return None
        m = b[i + 1]
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2; continue
        n = struct.unpack(">H", b[i + 2:i + 4])[0]
        if m in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return (w, h) if w and h else None
        i += 2 + n
    return None

def audio_ok(b):
    return b[:4] == b"RIFF" and b[8:12] == b"WAVE" or b[:4] == b"\x1aE\xdf\xa3" or b[:4] == b"OggS" or b[4:8] == b"ftyp"

# ---------- the Mac's state (memory only) ----------
class World:
    def __init__(self):
        self.lock = threading.RLock()
        now = time.time(); base = int(now * 1000) - 86_400_000
        self.devices = {MAC_TOKEN: {"id": "mac", "name": "Mac", "kind": "mac"}}
        self.cfg = {"name": "Buddy", "voice": "casual_female", "see_photos": True, "phone_mode": True}
        self.chars = [
            {"id": "buddy", "name": "Buddy", "tagline": "Your closest friend", "color": "#d9973c", "builtin": True,
             "brain": "advisor", "voice": "casual_female", "persona": "You are Buddy, a warm and curious friend.",
             "knowledge": {"scope": "all", "folders": [], "avoid": ""}, "texts_first": True, "appearance": "",
             "style": "photo", "avatar": 0, "wallpaper": 0, "avatar_prev": 0},
            {"id": "mara", "name": "Mara", "tagline": "Painter by the sea", "color": "#c8566a", "builtin": False,
             "brain": "companion", "voice": "neutral_female", "persona": "You are Mara, a painter who lives by the sea.",
             "knowledge": {"scope": "some", "folders": ["Work"], "avoid": "Sarah"}, "texts_first": False,
             "appearance": LOOKS, "style": "photo", "avatar": base + 5, "wallpaper": 0, "avatar_prev": 0},
        ]
        self.facts = {"buddy": [{"text": "I like long walks.", "date": "2026-09-30"}],
                      "mara": [{"text": "I live in Lisbon.", "date": "2026-10-01"}, {"text": HIDDEN_FACT, "date": "2026-10-02"}],
                      "_everyone": [{"text": "I'm learning the cello.", "date": "2026-09-20"}]}
        self.life = {"buddy": True, "mara": True}
        self.gens = {}
        self.media = {"0123456789abcdef0123456789abcdef": {"full": png(48, 64, (40, 90, 160)), "view": png(24, 32, (40, 90, 160))}}
        self.avatar = png(64, 64, (200, 86, 106))
        t = [
            ("user", "buddy", "Morning!", {}), ("assistant", "buddy", "Hey you! How did you sleep?", {"mode": "advisor"}),
            ("user", "mara", "Look what I found", {"image": "0123456789abcdef0123456789abcdef", "w": 48, "h": 64,
                                                   "photo_desc": "a red boat on a beach", "seen_by": "gemma4-31b"}),
            ("assistant", "mara", "Oh, that boat! I'd paint it.", {"mode": "companion"}),
            ("user", "mara", PRIVATE_TEXT, {"private": True}),
        ]
        self.thread = []
        for i, (role, char, text, extra) in enumerate(t):
            m = {"id": base + 10 + i, "role": role, "content": text, "ts": now - 86400 + i * 60, "char": char,
                 "private": bool(extra.pop("private", False)), "via": "phone"}
            m.update(extra); self.thread.append(m)
        self.pairs = 0
        self.modes = {"net": "up", "auth": "ok", "kit": "on", "slow": None, "fail": {}}
        self.drop_import = False
        self.partner = []                                 # relationship statuses phone mode brought (public edition)
        self.log = []

    def next_id(self):
        return max([int(time.time() * 1000)] + [m["id"] + 1 for m in self.thread])

    def char(self, cid):
        return next((c for c in self.chars if c["id"] == cid), None)

    def add(self, role, char, content="", **kw):
        m = {"id": self.next_id(), "role": role, "content": content, "ts": time.time(), "char": char}
        m.update(kw); self.thread.append(m); return m

    def forget(self, cid, delete=False):
        self.thread = [m for m in self.thread if m.get("char", "buddy") != cid]
        self.gens[cid] = self.gens.get(cid, 0) + 1
        self.facts[cid] = []; self.life[cid] = False
        if delete:
            self.chars = [c for c in self.chars if c["id"] != cid]

    # -- the phone-mode kit (SPEC2 §3.2), built from the fixtures --
    def life_log(self, cid, friend=False):
        today = (time.time() - 4 * 3600)
        d0 = time.strftime("%Y-%m-%d", time.localtime(today)); d1 = time.strftime("%Y-%m-%d", time.localtime(today - 86400))
        d2 = time.strftime("%Y-%m-%d", time.localtime(today - 2 * 86400))
        who = {"buddy": ("works in a bookshop", "shelved new arrivals", "read on the balcony"),
               "mara": ("paints seascapes", "sketched boats at the harbour", "mixed a new blue")}[cid]
        if friend:
            return {"about": [], "people": [], "ongoing": [{"what": "a big commission"}], "weeks": [],
                    "days": [{"date": d1, "to": "", "summary": f"{who[1].capitalize()}.", "events": [], "moments": []},
                             {"date": d0, "to": "", "summary": "", "events": [{"at": "04:30", "what": who[2]}], "moments": []}]}
        return {"about": [f"I {who[0]}."], "people": [{"name": "Lena", "who": "my older sister"}],
                "ongoing": [{"what": "a big commission", "since": d2}], "weeks": [],
                "days": [{"date": d1, "to": "", "summary": f"{who[1].capitalize()}.",
                          "events": [{"id": "e1", "at": "10:00", "what": who[1], "mood": "calm", "kind": "work", "plan": who[1]}],
                          "moments": []},
                         {"date": d0, "to": "", "summary": "",
                          "events": [{"id": "e2", "at": "04:30", "what": who[2], "mood": "happy", "kind": "rest", "plan": who[2]}],
                          "moments": [{"event": "e2", "state": "pending"}]}]}

    def kit(self):
        def knows(c, have, call):
            k = c["knowledge"]
            where = "your notes in " + ", ".join(k["folders"]) if k["scope"] == "some" else "your notes"
            return (("On the phone, b" if call else "B") + "riefly: say what you know about me " +
                    ("from the facts above" if have else "(nothing for sure yet)") + f" and from {where}.")
        out = []
        for c in self.chars:
            avoid = [w.strip().lower() for w in c["knowledge"]["avoid"].split(",") if w.strip()]
            own = [f for f in self.facts.get(c["id"], []) if not any(w in f["text"].lower() for w in avoid)]
            shared = [f for f in self.facts["_everyone"] if not any(w in f["text"].lower() for w in avoid)]
            life = None
            if self.life.get(c["id"]):
                friends = [{"id": o["id"], "name": o["name"], "how": "old friends", "log": self.life_log(o["id"], friend=True)}
                           for o in self.chars if o["id"] != c["id"] and self.life.get(o["id"])]
                life = {"log": self.life_log(c["id"]), "friends": friends}
            out.append({"id": c["id"], "name": c["name"], "tagline": c["tagline"], "color": c["color"],
                        "avatar": c["avatar"], "wallpaper": c["wallpaper"], "builtin": c["builtin"], "brain": c["brain"],
                        "voice": c["voice"], "persona": c["persona"],
                        "facts": {"own": [dict(f) for f in own], "shared": [dict(f) for f in shared]},
                        "knows_ask": {"phone": {"have": knows(c, True, False), "none": knows(c, False, False)},
                                      "call": {"have": knows(c, True, True), "none": knows(c, False, True)}},
                        "life": life})
        return {
            "v": 3, "name": self.cfg["name"], "tz": "UTC", "see_photos": bool(self.cfg["see_photos"]),
            "companion_on_phala": False, "chars": out,
            "voices": [{"id": "casual_female", "label": "Casual (female)"}, {"id": "neutral_female", "label": "Calm (female)"},
                       {"id": "Vivian", "label": "Vivian (female)"}, {"id": "casual_male", "label": "Casual (male)"}],
            "voice": {"default": self.cfg["voice"], "ids": ["casual_female", "neutral_female", "Vivian", "casual_male"]},
            "prompts": {
                "modes": {"advisor": "FAKE-ADVISOR-MODE: be quick and careful.", "companion": "FAKE-COMPANION-MODE: be warm."},
                "styles": {"phone": "FAKE-TEXTING-STYLE: we're texting on my phone right now.",
                           "call": "FAKE-CALLING-STYLE: we're on a live voice call."},
                "length": {"long": "FAKE-LENGTH-LONG.", "tiny": "FAKE-LENGTH-TINY.", "short": "FAKE-LENGTH-SHORT.",
                           "medium": "FAKE-LENGTH-MEDIUM."},
                "facts_head": "What you know about me for sure:", "facts_rule": "Treat these as true.",
                "photo_safety": "FAKE-PHOTO-SAFETY.", "cant_see": "FAKE-CANT-SEE: you can't see photos right now.",
                "looked": "[FAKE-LOOKED: {desc}]\n{text}", "describe": "FAKE-DESCRIBE this photo.",
                "no_photos": "FAKE-NO-PHOTOS: you can't send photos right now."},
            "facts_paths": {"shared": "Buddy knows/_everyone", "own_prefix": "Buddy knows/"},
            "models": {"advisor": {"preferred": None, "fallbacks": ["gemma4-31b", "glm-5-3", "kimi-k3", "llama3-3-70b"]},
                       "companion": {"preferred": None, "fallbacks": ["deepseek-v4-1-flash", "kimi-k3", "llama3-3-70b"]},
                       "vision_order": ["gemma4-31b", "deepseek-v4-1-flash", "kimi-k3"],
                       "no_thinking": {"deepseek-v4-1-flash": {"reasoning_effort": "none", "chat_template_kwargs": {"thinking": False}},
                                       "kimi-k3": {"chat_template_kwargs": {"thinking": False}}},
                       "always_thinks": ["glm-5-3"], "temperature": 0.9, "call_max_tokens": 300,
                       "stt": "whisper-large-v3-turbo", "stt_next": "voxtral-small-24b"},
            "tinfoil": {"ids": ["gemma4-31b", "deepseek-v4-1-flash", "kimi-k3", "llama3-3-70b", "whisper-large-v3-turbo",
                                "voxtral-tts", "qwen3-tts"],
                        "meta": {"gemma4-31b": {"multimodal": True, "type": "chat"},
                                 "deepseek-v4-1-flash": {"multimodal": False, "type": "chat"}}},
            "stt": {"language": "", "model": ""},
            "edition": {"public": False},
            "billing": {"out": "FAKE-CREDITS-OUT: top up", "limit": "FAKE-SPEND-LIMIT: raise it"},
            "call": {"greetings": ["Hey!", "Hi, you."], "fillers": ["Hmm."],
                     "missed": {"missed": ["Hm? Say that again?"], "loud": ["Sorry, it's loud there."],
                                "cutout": ["You cut out for a sec."], "lost": ["Sorry, I lost my train of thought."],
                                "losing": ["I keep losing you."], "noisy": ["It's so noisy there."]}},
            "texting": {"caps": {"tiny": [2, 30], "short": [3, 50], "medium": [4, 80]}}}

    def context(self):
        t = sorted((m for m in self.thread if not m.get("private")), key=lambda m: m["id"])
        out = {}
        for c in self.chars:
            mine = [m for m in t if m.get("char", "buddy") == c["id"]]
            cur = mine[max((i + 1 for i, m in enumerate(mine) if m["role"] == "break"), default=0):]
            keep = [m for m in cur if m["role"] in ("user", "assistant")][-30:]
            ids = {m["id"] for m in keep}
            keep += [m for m in cur if m["role"] == "reaction" and m.get("target") in ids]
            fields = ("id", "role", "content", "ts", "via", "from", "image", "w", "h", "photo_desc", "seen", "voice", "dur",
                      "mode", "knows", "target", "emoji", "by", "photo_failed", "why", "direct", "cid", "proactive", "delivered")
            out[c["id"]] = {"epoch": self.gens.get(c["id"], 0),
                            "last_ts": max((m["ts"] for m in mine if m["role"] in ("user", "assistant")), default=0),
                            "last_role": max(reversed([m for m in mine if m["role"] in ("user", "assistant")]),
                                             key=lambda m: m["ts"], default={"role": ""})["role"],
                            "msgs": sorted(({**{k: m[k] for k in fields if k in m}, "char": c["id"]} for m in keep),
                                           key=lambda m: m["id"])}
        return {"upto": max((m["id"] for m in t), default=0), "chars": out}

    def phonekit(self, have):
        kit = self.kit()
        etag = hashlib.sha256(json.dumps(kit, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:32]
        return {"v": 1, "etag": etag, "kit": None if have == etag else kit, "generated_at": time.time(), "context": self.context()}

    # -- the import (SPEC2 §3.3) --
    def check_item(self, it, now):
        cid = it.get("cid") if isinstance(it, dict) else None
        if not isinstance(cid, str) or not CID.fullmatch(cid):
            return None, {"cid": None, "dropped": "bad id"}
        bad = lambda why: (None, {"cid": cid, "dropped": why})
        if it.get("private"): return bad("private")
        role = it.get("role")
        if role not in ("user", "assistant", "break", "reaction"): return bad("bad role")
        if not self.char(it.get("char")): return bad("no such character")
        if "content" in it and not isinstance(it["content"], str): return bad("bad content")
        text = (it.get("content") or "").strip()
        if (role == "user" and not text and not it.get("photo") and not it.get("voice")) or (role == "assistant" and not text):
            return bad("empty")
        ts = it.get("ts")
        if isinstance(ts, bool) or not isinstance(ts, (int, float)) or not math.isfinite(ts) or ts <= 0: return bad("bad time")
        if ts < now - 400 * 86400: return bad("too old")
        ep = it.get("epoch")
        if isinstance(ep, bool) or not isinstance(ep, int): return bad("bad epoch")
        out = {"cid": cid, "role": role, "char": it["char"], "ts": min(ts, now), "epoch": ep,
               "content": text[:4000] if role == "user" else text[:20000] if role == "assistant" else ""}
        if "photo" in it:
            p = it["photo"]
            try:
                if role != "user" or not isinstance(p, dict): raise ValueError
                full = base64.b64decode(p["full"], validate=True); view = base64.b64decode(p["view"], validate=True)
                size = jpeg_size(full)
                if not size or not jpeg_size(view) or len(full) > 12_000_000 or len(view) > 3_000_000: raise ValueError
            except (ValueError, KeyError, TypeError, binascii.Error):
                return bad("bad photo")
            out["_photo"] = (full, view, size)
            if it.get("photo_desc"):
                out["photo_desc"] = re.sub(r"\s+", " ", str(it["photo_desc"])).strip()[:600]
                if isinstance(it.get("seen_by"), str) and SEEN_BY.fullmatch(it["seen_by"]): out["seen_by"] = it["seen_by"]
            elif it.get("seen") is False:
                out["seen"] = False
        if "voice" in it:
            v = it["voice"]
            try:
                if not isinstance(v, dict) or not isinstance(v.get("data"), str): raise ValueError
                data = base64.b64decode(v["data"], validate=True)
                if len(data) > 12_000_000 or not audio_ok(data): raise ValueError
                dur = min(600.0, max(0.0, float(v.get("dur") or 0)))
            except (ValueError, TypeError, binascii.Error):
                return bad("bad voice")
            out["_voice"] = (data, dur)
        if role == "reaction":
            e = it.get("emoji")
            e = e if e == "" else next((r for r in REACTIONS if e in (r, r.replace("️", ""))), None)
            tgt, tcid = it.get("target"), it.get("target_cid")
            if (it.get("by") not in ("you", it["char"]) or e is None or (e == "" and it.get("by") != "you")
                    or not ((isinstance(tgt, int) and not isinstance(tgt, bool)) or (isinstance(tcid, str) and CID.fullmatch(tcid)))):
                return bad("bad reaction")
            out.update(emoji=e, by=it["by"], target=tgt if isinstance(tgt, int) else None, target_cid=tcid)
        if role == "assistant":
            out["mode"] = it.get("mode") if it.get("mode") in ("advisor", "companion") else self.char(it["char"])["brain"]
            if isinstance(it.get("reply_to"), str) and CID.fullmatch(it["reply_to"]): out["reply_to"] = it["reply_to"]
            src = [s for s in (it.get("sources") or [])[:10] if isinstance(s, dict) and s.get("kind") == "facts"
                   and isinstance(s.get("path"), str) and isinstance(s.get("n"), int)] if isinstance(it.get("sources"), list) else []
            if src: out["sources"] = src
            if it.get("knows") is True: out["knows"] = True
        if it.get("call") is True and role in ("user", "assistant"): out["call"] = True
        return out, None

    def add_imported(self, items):
        res = []
        known = {m["cid"]: m["id"] for m in self.thread if m.get("cid")}
        ids = {m["id"]: m for m in self.thread}
        for it in items:
            if it["cid"] in known:
                res.append({"cid": it["cid"], "id": known[it["cid"]], "dup": True}); continue
            if it["epoch"] < self.gens.get(it["char"], 0):
                res.append({"cid": it["cid"], "dropped": "deleted"}); continue
            m = {"id": self.next_id(), "role": it["role"], "content": it["content"], "ts": it["ts"], "char": it["char"],
                 "cid": it["cid"], "from": "phone", "direct": True}
            if it["role"] == "reaction":
                tid = known.get(it["target_cid"]) if it.get("target_cid") else it.get("target")
                t = ids.get(tid)
                if not t or t.get("private") or t["role"] not in ("user", "assistant") or t.get("char", "buddy") != it["char"]:
                    res.append({"cid": it["cid"], "dropped": "no such message"}); continue
                m.update(target=tid, emoji=it["emoji"], by=it["by"])
            elif it["role"] in ("user", "assistant"):
                m.update(private=False, via="call" if it.get("call") else "phone")
                if it["role"] == "assistant":
                    m["mode"] = it["mode"]
                    for k in ("sources", "knows"):
                        if k in it: m[k] = it[k]
                if "_photo" in it:
                    mid = secrets.token_hex(16); full, view, (w, h) = it["_photo"]
                    self.media[mid] = {"full": full, "view": view}; m.update(image=mid, w=w, h=h)
                    for k in ("photo_desc", "seen_by", "seen"):
                        if k in it: m[k] = it[k]
                if "_voice" in it:
                    mid = secrets.token_hex(16); self.media[mid] = {"full": it["_voice"][0]}
                    m.update(voice=mid, dur=it["_voice"][1])
            self.thread.append(m); known[m["cid"]] = m["id"]; ids[m["id"]] = m
            res.append({"cid": it["cid"], "id": m["id"]})
        return res


W = World()
ARGS = None
WEB = ""

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def log_message(self, *a):
        pass

    def translate_path(self, path):
        p = urllib.parse.unquote(path.split("?", 1)[0])
        if p.startswith("/icons/"):
            out = os.path.join(WEB, "default-icons", p[len("/icons/"):].lstrip("/"))
        elif p in ("/", "", "/phone", "/phone/"):
            out = os.path.join(WEB, "chat.html")
        else:
            out = os.path.join(WEB, p.lstrip("/"))
        if ".." in p or not (os.path.realpath(out) + os.sep).startswith(os.path.realpath(WEB) + os.sep):
            return os.path.join(WEB, "chat.html")
        return out

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", PHONE_CSP if self.path.split("?")[0] in ("/phone", "/phone/") else CSP)
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def json(self, code, obj, headers=()):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        for k, v in headers: self.send_header(k, v)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def raw(self, code, body, ctype):
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def dev(self):
        c = self.headers.get("Cookie", "")
        m = re.search(r"(?:^|;\s*)buddy=([^;]+)", c)
        return W.devices.get(m.group(1)) if m else None

    # every request: logged (all headers, the raw body), then the "Mac"'s current mood
    def gate(self, body=b""):
        W.log.append({"t": time.time(), "method": self.command, "path": self.path, "headers": dict(self.headers.items()),
                      "body": base64.b64encode(body).decode()})
        md = W.modes
        if md["net"] == "hang":
            until = time.time() + 120
            while W.modes["net"] == "hang" and time.time() < until: time.sleep(0.05)
            self.close_connection = True
            return False
        s = md["slow"]
        if s and (not s[1] or self.path.split("?")[0] == s[1]): time.sleep(s[0] / 1000)
        if md["net"] == "proxy502":
            self.raw(502, b"Bad Gateway", "text/plain"); return False
        p = self.path.split("?")[0]
        if p in md["fail"]:
            code = md["fail"][p]
            if code == 500: self.raw(500, b"broken on purpose", "text/plain")
            else: self.json(code, {"error": "too much at once" if code == 413 else "broken on purpose"})
            return False
        if p.startswith("/api/") and self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
            self.send_error(403); return False
        return True

    def locked(self):
        """True (and answered) unless a paired device asks; the control modes can say otherwise."""
        a, only = W.modes["auth"], W.modes.get("lockpath")
        if (a == "unpaired" or (a == "locked" and self.path != "/api/me" and (not only or self.path.split("?")[0] == only))
                or not self.dev()):
            self.json(401, {"error": "pair", "message": "This device isn't paired with Buddy yet."}); return True
        return False

    def do_GET(self):
        if not self.gate():
            return
        p, q = self.path.split("?")[0], urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if p == "/api/me":
            d = None if W.modes["auth"] == "unpaired" else self.dev()
            return self.json(200, {"paired": bool(d), "device": d})
        if p == "/api/status" and not self.dev():
            return self.json(200, {"ok": True, "pid": os.getpid(), "paired": False})
        if p.startswith("/api/") and self.locked():
            return
        with W.lock:
            if p == "/api/status":
                return self.json(200, {"name": W.cfg["name"], "voice": W.cfg["voice"], "paired": True, "companion_ready": True,
                                       "companion_provider": "tinfoil", "phala_key": False, "tinfoil_key": True,
                                       "tinfoil": {"ready": True}, "near_key": False, "memory_notes": 3,
                                       "memory": {"notes": 3, "smart_by": "tinfoil"}, "pid": os.getpid(), "boot": "fakeboot",
                                       "synced": {}, "sync_e2e": False, "tailnet": {"on": False}})
            if p == "/api/characters":
                return self.json(200, [dict(c, avatar_job=None, wall_job=None) for c in W.chars])
            if p.startswith("/api/characters/") and p.endswith("/avatar"):
                c = W.char(p.split("/")[3])
                if not c or not c["avatar"]: return self.json(404, {"error": "no picture"})
                return self.raw(200, W.avatar, "image/png")
            if p == "/api/voices":
                return self.json(200, W.kit()["voices"])
            if p == "/api/images":
                return self.json(200, {"available": False, "provider": None, "pictures": "off", "label": None, "eta_s": None,
                                       "local": None, "near": None, "near_key": False,
                                       "vision": {"available": True, "model": "gemma4-31b"}, "see_photos": W.cfg["see_photos"]})
            if p == "/api/settings":
                return self.json(200, {"proactive": True, "push_ready": False, "phones": 1, "learn_facts": True, "push_preview": True,
                                       "lives": True, "life_texts": "some", "quiet_from": 23, "quiet_until": 8.5,
                                       "pictures": "off", "see_photos": W.cfg["see_photos"]})
            if p == "/api/knowledge":
                return self.json(200, {"folders": ["Work", "Journal"]})
            if p == "/api/thread":
                after = int((q.get("after") or ["0"])[0])
                return self.json(200, sorted((m for m in W.thread if m["id"] > after), key=lambda m: m["id"]))
            if p == "/api/version":
                h = hashlib.sha256()
                for f in SHELL_FILES:
                    try: st = os.stat(os.path.join(WEB, f)); h.update(f"{f}:{st.st_mtime_ns}:{st.st_size};".encode())
                    except OSError: pass
                return self.json(200, {"version": h.hexdigest()[:8]})
            if p == "/api/push/key":
                return self.json(200, {"key": ""})
            if p == "/api/phonekit":
                if self.dev()["kind"] != "phone": return self.json(403, {"error": "phone mode is for phones"})
                if W.modes["kit"] == "free":
                    return self.json(403, {"error": "FAKE: the free brain without a Tinfoil key", "phone_mode": False, "free": True})
                if W.modes["kit"] == "off" or not W.cfg["phone_mode"]:
                    return self.json(403, {"error": "phone mode is off on your Mac", "phone_mode": False})
                return self.json(200, W.phonekit((q.get("have") or [""])[0][:64]))
            if p.startswith("/api/media/"):
                mid = p.split("/")[3]; m = W.media.get(mid)
                if not m: return self.json(404, {"error": "no picture"})
                data = m.get("view") if q.get("v") == ["1"] and m.get("view") else m["full"]
                ctype = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg" if data[:2] == b"\xff\xd8" else "audio/wav"
                return self.raw(200, data, ctype)
        if p.startswith("/api/"):
            return self.json(404, {"error": "not here (fake Mac)"})
        return super().do_GET()

    def do_HEAD(self):
        if self.gate():
            super().do_HEAD()

    def do_POST(self):
        p = self.path.split("?")[0]
        n = int(self.headers.get("Content-Length") or 0)
        if p == "/api/thread/import" and n > 24_000_000:
            self.gate(b""); return self.json(413, {"error": "too much at once"})
        body = self.rfile.read(n) if n else b""
        if not self.gate(body):
            return
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if p.startswith("/api/") and not (ctype == "application/json" or ctype.startswith("audio/")
                                          or (ctype == "image/jpeg" and p == "/api/photo")):
            return self.send_error(415)
        if p == "/api/pair":
            j = json.loads(body or b"{}")
            if str(j.get("code", "")).replace(" ", "") != "123456":
                return self.json(403, {"error": "That code didn't work. Make a new one on your Mac and try again."})
            token = secrets.token_hex(24); W.pairs += 1
            dev = {"id": f"phone{W.pairs}", "name": str(j.get("name") or "Phone")[:40], "kind": "phone"}
            W.devices[token] = dev
            return self.json(200, {"ok": True, "device": dev}, headers=[("Set-Cookie",
                f"buddy={token}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict")])
        if self.locked():
            return
        try:
            j = json.loads(body or b"{}") if ctype == "application/json" else {}
        except ValueError:
            return self.json(400, {"error": "bad json"})
        with W.lock:
            if p == "/api/thread/import":
                if self.dev()["kind"] == "mac": return self.json(403, {"error": "only phones have phone-mode messages"})
                items = j.get("messages") if isinstance(j, dict) else None
                if not isinstance(items, list): return self.json(400, {"error": "bad request"})
                if not 1 <= len(items) <= 200: return self.json(400, {"error": "send 1 to 200 messages at a time"})
                if sum(1 for it in items if isinstance(it, dict) and (it.get("photo") or it.get("voice"))) > 1:
                    return self.json(400, {"error": "one photo or voice message at a time"})
                now, results, good = time.time(), [], []
                for i, it in enumerate(items):
                    if isinstance(it, dict) and it.get("role") == "partner":   # (a relationship status, not a message)
                        W.partner.append(it); results.append({"cid": it.get("cid"), "applied": True}); continue
                    ok, why = W.check_item(it, now)
                    results.append(why)
                    if ok: good.append((i, ok))
                for (i, _), r in zip(good, W.add_imported([it for _, it in good])):
                    results[i] = r
                upto = max((r["id"] for r in results if r and "id" in r and not r.get("dup")), default=0)
                if W.drop_import:                         # stored, but the answer never comes (the phone retries)
                    W.drop_import = False; self.close_connection = True
                    try: self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError: pass
                    return
                return self.json(200, {"ok": True, "results": results, "upto": upto})
            if p == "/api/chat":                          # Mac mode: a short reply, like the real one streams it
                c = W.char(j.get("char")) or W.chars[0]
                um = W.add("user", c["id"], str(j.get("text") or "").strip(), private=bool(j.get("private")),
                           via=j.get("via") if j.get("via") in ("mac", "phone", "call") else "phone")
                if j.get("photo"): um.update(image="0123456789abcdef0123456789abcdef", w=48, h=64)
                reply = f"Hello from your Mac, this is {c['name']}."
                W.add("assistant", c["id"], reply, private=um["private"], via=um["via"], mode=c["brain"])
                self.send_response(200); self.send_header("Content-Type", "application/x-ndjson"); self.end_headers()
                for line in ({"mode": c["brain"]}, {"s": reply}):
                    self.wfile.write((json.dumps(line) + "\n").encode()); self.wfile.flush()
                return
            if p == "/api/newchat":
                c = W.char(j.get("char")) or W.chars[0]; W.add("break", c["id"]); return self.json(200, {"ok": True})
            if p == "/api/react":
                m = next((x for x in W.thread if x["id"] == j.get("id")), None)
                e = j.get("emoji") or ""
                if not m or m["role"] not in ("user", "assistant") or (e and e not in REACTIONS):
                    return self.json(404, {"error": "no such message"})
                W.add("reaction", m.get("char", "buddy"), target=m["id"], emoji=e, by="you"); return self.json(200, {"ok": True})
            if p == "/api/photo":
                if not jpeg_size(body): return self.json(400, {"error": "that isn't a photo Buddy can use"})
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if q.get("part") == ["full"]: return self.json(200, {"photo": secrets.token_urlsafe(16)})
                return self.json(200, {"photo": (q.get("photo") or [""])[0], "ready": True})
            if p == "/api/photo/drop":
                return self.json(200, {"ok": True})
            if p in ("/api/characters/forget", "/api/characters/delete"):
                cid = str(j.get("id") or "")
                if not W.char(cid): return self.json(404, {"error": "no such character"})
                if p.endswith("delete") and W.char(cid)["builtin"]: return self.json(400, {"error": "Buddy stays"})
                W.forget(cid, delete=p.endswith("delete")) if (p.endswith("forget") or j.get("forget")) else \
                    W.chars.remove(W.char(cid))
                return self.json(200, {"ok": True, **({"epoch": W.gens.get(cid, 0)} if p.endswith("forget") else {})})
            if p == "/api/settings":
                if "see_photos" in j: W.cfg["see_photos"] = bool(j["see_photos"])
                return self.json(200, {"ok": True})
            if p == "/api/call/start":
                k = W.kit()["call"]; return self.json(200, k)
            if p.startswith("/api/push/"):
                return self.json(200, {"ok": True, "sent": False})
            if p in ("/api/speak", "/api/stt", "/api/voice"):
                return self.json(503, {"error": "not in the fake Mac"})
        return self.json(404, {"error": "not here (fake Mac)"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64                             # (a browser opens several connections at once)
    def handle_error(self, request, client_address):   # (a browser that went away mid-answer: not worth a traceback)
        if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            super().handle_error(request, client_address)


class Main:
    """The page's port: opened, closed (refuse) and opened again on the same port."""
    def __init__(self, port=0):
        self.srv = None; self.port = port; self.open()

    def open(self):
        if self.srv: return
        self.srv = Server(("127.0.0.1", self.port), Handler)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        if not self.srv: return
        s, self.srv = self.srv, None
        s.shutdown(); s.server_close()


MAIN = None

class Control(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def out(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        p, q = self.path.split("?")[0], urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        with W.lock:
            if p == "/log":
                since = int((q.get("since") or ["0"])[0]); return self.out(W.log[since:])
            if p == "/thread":
                return self.out(W.thread)
            if p == "/state":
                return self.out({"modes": W.modes, "gens": W.gens, "log": len(W.log),
                                 "chars": [c["id"] for c in W.chars], "media": sorted(W.media), "devices": list(W.devices.values()), "partner": W.partner})
            if p == "/kit":
                return self.out(W.phonekit(""))
        self.out({"error": "?"}, 404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        p = self.path.split("?")[0]
        try: j = json.loads(body) if body.strip().startswith("{") else {}
        except ValueError: j = {}
        with W.lock:
            md = W.modes
            if p == "/mode":
                cmd = (j.get("mode") if j else body).strip().split()
                if not cmd: return self.out({"error": "mode?"}, 400)
                c = cmd[0]
                if c == "up": md.update(net="up", auth="ok", slow=None, lockpath=None); MAIN.open()
                elif c == "refuse": md["net"] = "up"; MAIN.close()
                elif c in ("hang", "proxy502"): md["net"] = c; MAIN.open()
                elif c == "slow": md["slow"] = (int(cmd[1]), cmd[2] if len(cmd) > 2 else None)
                elif c in ("unpaired", "locked"): md["auth"] = c; md["lockpath"] = cmd[1] if len(cmd) > 1 else None
                elif c == "kit-off": md["kit"] = "off"
                elif c == "kit-on": md["kit"] = "on"
                elif c == "kit-free": md["kit"] = "free"
                elif c == "fail-file":
                    if len(cmd) > 1 and cmd[1] != "-": md["fail"][cmd[1]] = int(cmd[2]) if len(cmd) > 2 else 500
                    else: md["fail"].clear()
                elif c == "reset": md.update(net="up", auth="ok", kit="on", slow=None, fail={}, lockpath=None); MAIN.open()
                else: return self.out({"error": "unknown mode " + c}, 400)
                return self.out({"ok": True, "modes": md})
            if p == "/drop-import-response":
                W.drop_import = True; return self.out({"ok": True})
            if p == "/epoch":
                cid = j.get("char") or "buddy"
                W.gens[cid] = W.gens.get(cid, 0) + 1
                W.thread = [m for m in W.thread if m.get("char", "buddy") != cid]
                return self.out({"ok": True, "epoch": W.gens[cid]})
            if p == "/touch":
                f = os.path.join(WEB, str(j.get("path") or "").lstrip("/"))
                if not os.path.realpath(f).startswith(os.path.realpath(WEB) + os.sep) or not os.path.exists(f):
                    return self.out({"error": "no such file"}, 404)
                with open(f, "a") as fh: fh.write(f"\n// touched {time.time()}\n")
                return self.out({"ok": True})
            if p == "/set":
                for k in ("see_photos", "phone_mode"):
                    if k in j: W.cfg[k] = bool(j[k])
                return self.out({"ok": True})
        self.out({"error": "?"}, 404)


def main():
    global ARGS, WEB, MAIN
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--real-sdk", action="store_true", help="serve web/vendor/tinfoil.mjs as it is (no fake SDK)")
    ARGS = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="buddy-fake-mac-")
    WEB = os.path.join(tmp, "web")
    shutil.copytree(os.path.join(REPO, "web"), WEB)
    sdk = None
    if not ARGS.real_sdk:                                # (the test seam: the fake SDK where the real one is served)
        sdk = os.path.join(HERE, "fake_tinfoil.mjs")
        shutil.copyfile(sdk, os.path.join(WEB, "vendor", "tinfoil.mjs"))
    MAIN = Main(ARGS.port)
    ctl = Server(("127.0.0.1", 0), Control)
    threading.Thread(target=ctl.serve_forever, daemon=True).start()
    print(json.dumps({"port": MAIN.port, "control": ctl.server_address[1], "web": WEB, "mac_token": MAC_TOKEN,
                      "sdk": sdk, "pid": os.getpid()}), flush=True)
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))   # (the temp copy goes with it)
    try:
        while True: time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
