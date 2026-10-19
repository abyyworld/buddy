"""Phone mode parity: web/direct.js's JS ports of the prompt code against the real Python (buddy_server.py, social.py,
facts.py, lives.py, memory.py, images.py), case by case, in node (tests/phonemode/parity_check.mjs).

Fake data only, in a fake world (SPEC2 §5.6): every path that could reach your notes, characters, thread, settings or
keys points into a temp folder, persona and mode texts are fake ones from there, and opening one of the real files
fails the test at once (naming the path, never what's in it). So a mismatch can only ever print fake data, also on
your Mac. Skipped (not failed) only when node isn't installed.
Run from Buddy's folder:  python3 -B -m unittest tests.test_phonemode_parity -v"""
import base64, builtins, datetime, io, json, os, pwd, random, shutil, struct, subprocess, sys, tempfile, threading, time
import unittest, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import billing, characters, devices, edition, facts, images, lives, localcheck, memory, social
import buddy_server as bs

sys.path.insert(0, os.path.join(ROOT, "tests"))
import test_photos_tone as tone                       # (main's photo spellings, mentions, deep and casual texts: cases here)

NODE = shutil.which("node")
CHECK = os.path.join(ROOT, "tests", "phonemode", "parity_check.mjs")
REPO = os.path.realpath(ROOT)
VAULTS = {os.path.realpath(os.path.join(h, "Buddy")) for h in (os.path.expanduser("~"), pwd.getpwuid(os.getuid()).pw_dir)}
PRIVATE = {"config.local.json", ".thread.json", ".facts_state.json", ".gens.json", ".tinfoil_key", ".phala_key", ".near_key",
           ".mac_token", ".devices.json", ".push_subs.json", ".vapid.json", ".memory_index.json"}
REAL_OPEN = builtins.open
ZONES = ("Europe/Berlin", "America/New_York", "Asia/Kolkata")
T0 = {"Europe/Berlin": 1792749600.0,       # Fri 2026-10-23 12:00 in Berlin (the clocks go back on the 25th)
      "America/New_York": 1793368800.0,    # Fri 2026-10-30 10:00 in New York (back on 1 November)
      "Asia/Kolkata": 1792742400.0}        # Fri 2026-10-23 13:30 in Kolkata

def private(path):
    """A real private file (or anything in your real notes): the fake world never opens one."""
    try:
        p = os.path.realpath(os.fspath(path))
    except TypeError:
        return False                                  # (a file descriptor)
    if p.startswith(os.path.join(REPO, "my-characters") + os.sep):
        return True
    if os.path.dirname(p) == REPO and (os.path.basename(p) in PRIVATE or ".local." in os.path.basename(p)):
        return True
    return any(p == v or p.startswith(v + os.sep) for v in VAULTS)

def guarded_open(file, *a, **k):
    if private(file):
        raise AssertionError(f"the parity test tried to open a private file: {file}")
    return REAL_OPEN(file, *a, **k)

class Clock:
    """time / datetime stand-ins for buddy_server and lives: a fixed now, everything else the real thing."""
    def __init__(self): self.now = time.time()
    def time_module(self):
        clock = self
        class _T:
            def __getattr__(self, n): return getattr(time, n)
            def time(self): return clock.now
        return _T()
    def datetime_module(self):
        clock = self
        class _DT(datetime.datetime):
            @classmethod
            def now(cls, tz=None): return datetime.datetime.fromtimestamp(clock.now, tz)
        class _M:
            def __getattr__(self, n): return getattr(datetime, n)
        m = _M(); m.datetime = _DT
        return m

def set_tz(z):
    if z is None: os.environ.pop("TZ", None)
    else: os.environ["TZ"] = z
    time.tzset()

def ref_slim(log, now, friend=False):                 # SPEC2 §5.2's text (the reference kit's own copy: catches drift)
    edge = (lives.life_date(now) - datetime.timedelta(days=1)).isoformat()
    old = [d for d in log["days"] if d["date"] < edge and d["summary"]][-(1 if friend else 6):]
    ev = ("at", "what") if friend else ("id", "at", "what", "mood", "kind", "plan")
    return {"about": [] if friend else list(log["about"]), "people": [] if friend else list(log["people"]),
            "ongoing": [{"what": o["what"]} for o in log["ongoing"][:2]] if friend else list(log["ongoing"]),
            "weeks": [] if friend else list(log["weeks"][-2:]),
            "days": [{"date": d["date"], "to": "" if friend else d["to"], "summary": d["summary"],
                      "events": [{k: e[k] for k in ev} for e in d["events"]],
                      "moments": [] if friend else [{"event": m["event"], "state": m["state"]} for m in d["moments"]]}
                     for d in old + [d for d in log["days"] if d["date"] >= edge]]}

PHONE_FIELDS = ("id", "role", "content", "ts", "via", "from", "image", "w", "h", "photo_desc", "seen", "voice", "dur",
                "mode", "knows", "target", "emoji", "by", "photo_failed", "why", "direct", "cid", "proactive", "delivered")
def ref_phone_msgs(t, char, n=30):                    # SPEC2 §5.3 item 4's text (checked against social.phone_context)
    t = sorted((m for m in t if not m.get("private") and not m.get("pending_photo")), key=lambda m: m["id"])
    t = [m for m in t if m.get("char", "buddy") == char]
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

class FakeResp:
    def __init__(self, data, ctype="application/json"): self.data, self.headers = data, {"Content-Type": ctype}
    def read(self, n=-1): return self.data
    def __enter__(self): return self
    def __exit__(self, *a): return False

WAV = (b"RIFF" + (36 + 4800).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00\x01\x00"
       + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little") + b"\x02\x00\x10\x00data" + (4800).to_bytes(4, "little")
       + b"\0" * 4800)

# ---------- the fake world's fixtures ----------
PERSONA = "You are Buddy, a warm and curious adult friend. You talk like a person, not a helpdesk."
MODES = {"advisor": "You give honest, practical advice when it's asked for.", "companion": "You're a warm companion first."}
CHARS = {
    "mara": {"name": "Mara", "tagline": "Ceramicist in Porto", "persona": "You are Mara, 31, a ceramicist in Porto.",
             "appearance": "tall woman with a red coat", "voice": "Serena", "brain": "companion", "life": True,
             "knowledge": {"scope": "some", "folders": ["Kiln Journal"], "avoid": "Sarah, salsa"}, "color": "#5b8def", "created": 1},
    "zed": {"name": "Zed", "tagline": "Night owl", "persona": "", "voice": "casual_male", "brain": "advisor", "life": False,
            "knowledge": {"scope": "none"}, "color": "#3fa37a", "created": 2},
    "ana-lu": {"name": "Ana-Lu (A.) [x]*", "tagline": "", "persona": "You are a child.", "voice": "bogus", "brain": "advisor",
               "life": True, "knowledge": {"scope": "except", "folders": ["Health"], "avoid": ""}, "color": "#c8566a", "created": 3},
}
VOCAB = ("lisbon porto café naïve Ünd climbing pottery kiln sister brother work studio 2026 a_b x I me my the and running "
         "sarah salsa dance coffee tea dog cat garden bike train guitar piano book novel ocean beach hike mountain").split()

def fact_lines(rnd, n, prefix=""):
    out = []
    for i in range(n):
        words = [rnd.choice(VOCAB) for _ in range(rnd.randint(3, 40 if i % 7 else 120))]
        date = rnd.choice(["2026-10-08", "2026-09-30", "2026-10-08", "2025-01-01", ""])
        text = (prefix + " ".join(words)).strip()[:290] + "."
        out.append(f"- {text}" + (f" (learned {date})" if date else ""))
    return out

def life_log(cid, today, rnd, friendish=False):
    days = []
    for k in range(-12, 4):
        d = (today + datetime.timedelta(days=k)).isoformat()
        ev = [{"id": "e1", "at": "07:30", "what": f"woke up early on {d}", "mood": "sleepy", "kind": "rest", "plan": ""},
              {"id": "e2", "at": "09:15", "what": "studio shift, glazing bowls", "mood": "", "kind": "work", "plan": "studio shift"},
              {"id": "e3", "at": "13:05", "what": "lunch at the market", "mood": "happy", "kind": "social", "plan": "lunch out"},
              {"id": "e4", "at": "18:40", "what": "salsa class with Sarah" if friendish else "climbing at the gym", "mood": "proud",
               "kind": "hobby", "plan": "salsa after work" if friendish else "climbing after work"},
              {"id": "e5", "at": "23:20", "what": "late film", "mood": "", "kind": "rest", "plan": ""},
              {"id": "e6", "at": "01:10", "what": "couldn't sleep, read a novel", "mood": "restless", "kind": "mundane", "plan": "read"}]
        rnd.shuffle(ev)
        days.append({"date": d, "to": rnd.choice(["", "Lisbon"]), "summary": "" if k % 4 == 1 else f"a full day on {d}.",
                     "events": ev, "moments": [{"id": "m1", "event": "e3", "at": "13:30", "due": 0, "angle": "share", "state": "sent"},
                                               {"id": "m2", "event": "e4", "at": "19:00", "due": 0, "angle": "share", "state": "pending"}]})
    return {"about": ["Has a cat called Miso.", "Grew up by the sea", "Works with clay"] + [f"Fact number {i}" for i in range(12)],
            "people": [{"name": "Lena", "who": "older sister, a nurse"}],
            "ongoing": [{"what": "training for a 10k", "since": "2026-09-20"}, {"what": "salsa lessons twice a week" if friendish else "a new kiln", "since": ""},
                        {"what": "learning Portuguese", "since": ""}],
            "weeks": [{"from": "2026-09-01", "to": "2026-09-07", "summary": "A quiet week."}, {"from": "2026-09-08", "to": "2026-09-14", "summary": "Busy at the studio."},
                      {"from": "2026-09-15", "to": "2026-09-21", "summary": "Visited Lena."}],
            "days": days}

THREAD_TEXTS = ["hey", "how was the kiln today?", "ok wait, the toast thing got worse", "tell me more about Lisbon",
                "lol same", "what do you know about me?", "I went climbing", "ugh mondays", "😂", "see you later"]

def fake_thread(rnd, chars, n=90, t_end=None):
    t_end = t_end or time.time()
    msgs, mid, ts = [], 1000, t_end - n * 1800
    last_assistant = {}
    for i in range(n):
        c = rnd.choice(chars); mid += rnd.randint(1, 5); ts += rnd.randint(60, 3000)
        kind = rnd.random()
        m = {"id": mid, "ts": ts, "char": c, "content": ""}
        if c == "buddy" and rnd.random() < 0.3: m.pop("char")
        if kind < 0.04:
            m["role"] = "break"
        elif kind < 0.12 and last_assistant.get(c):
            tgt = last_assistant[c]
            m.update(role="reaction", target=tgt["id"], emoji=rnd.choice(["😂", "❤️", "", "🔥"]), by="you")
            if tgt.get("private"): m["private"] = True
        elif kind < 0.14 and last_assistant.get(c):
            m.update(role="reaction", target=last_assistant[c]["id"] - 1, emoji="👍", by=c)
        elif kind < 0.55:
            m.update(role="user", content=rnd.choice(THREAD_TEXTS), via=rnd.choice(["phone", "mac", "call"]), private=rnd.random() < 0.1)
            r = rnd.random()
            if r < 0.12: m.update(image="ab" * 16, w=768, h=1024, **({"photo_desc": "a cat on a sofa {text}"} if rnd.random() < 0.6 else {}))
            elif r < 0.2: m.update(voice="cd" * 16, dur=3.4, content=rnd.choice(["", "voice words here"]))
            elif r < 0.24: m.update(content="")
        else:
            m.update(role="assistant", content=rnd.choice(["sure!", "ha, yes\n\nand also this", "tell me everything 😮", ""]),
                     mode="advisor", via="phone", private=rnd.random() < 0.1)
            if rnd.random() < 0.1: m.update(image="ef" * 16, photo_desc="me at the beach", content="")
            if rnd.random() < 0.05: m.update(pending_photo="job1", content="")
            if rnd.random() < 0.1: m.update(proactive=True, delivered="phone")
            if rnd.random() < 0.1: m.update(cid="AbC-_0123456789xyz" + str(i).zfill(4), direct=True, **{"from": "phone"})
            last_assistant[c] = m
        msgs.append(m)
    return msgs

seg = lambda m, body: b"\xff" + bytes([m]) + struct.pack(">H", len(body) + 2) + body
SOS = seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00")
def jpeg(w, h, extra=b"", scans=1, tail=b""):         # tests/test_pictures.py's generator (markers only, no pixels)
    head = (b"\xff\xd8" + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00") + extra
            + seg(0xC0, b"\x08" + struct.pack(">HH", h, w) + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"))
    body = SOS + b"\x12\x34\xff\x00\x56" * 30 + b"\xff\xd0" + b"\x78" * 20
    return head + body + b"".join(extra + body for _ in range(scans - 1)) + b"\xff\xd9" + tail

# ---------- the fake model server for the real Handler._chat ----------
SCRIPT = {"pieces": []}
class FakeModel(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        try:
            for p in SCRIPT["pieces"]:
                self.wfile.write(p.encode()); self.wfile.flush()
        except OSError:
            pass                                      # (it stopped reading: enough texts, or the call hung up)

def sse(deltas, done=True):
    out = ["data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": d}, "finish_reason": None}]}) + "\n\n" for d in deltas]
    if done:
        out.append("data: " + json.dumps({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}) + "\n\n")
        out.append("data: [DONE]\n\n")
    return out

REPLIES = [
    ["Hey you! 😊 How was ", "the day? I missed you… *laughs* Tell me everything."],
    ["Dr. Smith said it at 5 p.m. today. ", "Then J. R. left. e.g. this one. vs. that!"],
    ["[react: 😂] haha ", "no way\n\nthat's wild\n\nok wait what happened next?"],
    ["Sure thing (smiles warmly) I'll send it. [photo: me at the beach. sunny day! wow] Here it is. Done."],
    ["Unclosed [bracket. still inside! and more. ] now out. End"],
    ["one. two. three. four. five. six. seven. eight. nine. ten. eleven."],
    [" ".join(["word"] * 30) + ". " + " ".join(["more"] * 30) + ". " + " ".join(["again"] * 30) + ". last bit."],
    ["first text\n\nsecond text\n\nthird text\n\nfourth text\n\nfifth text\n\nsixth"],
    ["[react: ❤] ", ""],
    ["Mr. and Mrs. Jones. Prof. X. Mt. Everest. St. Louis. Jr. done. A. B. c. d. ok"],
    ["*leans in closer and whispers* you know what? ", "(sighs) Fine.\n*huge* deal though. 🔥🔥"],
    ["Okay.  Two   spaces.\n\n\nNew para! **Bold** and _under_ and `code` # head", " [react: 🍕] [react:  👍 ] end."],
    ["[partner: no] Oh nice, ", "thanks for telling me.\n\n[Partner:  NOASK ] okay!"],
    ["haha ok *sends a mirr", "or selfie* there you go. (image: me at ", "the gym)\n📸 me on my balcony at sunset\n\naw :[ ok"],
    ["sure! ![me in my new jacket](selfie.jpg) ", "omg yes (the photo of your dog killed me). ", "ooh *send pics* 👀"],
    ["look [photo: me at the beach. it was windy"],
    ["here you go 📷 [photo of the sunset", " from my window]. Photos: love them, I take a ton\nImage: me in the kitchen"],
    ["(photo: me at the gym. so sweaty\n\nanyway, you?"],
    ["ok here's what i'd do:\n* Take photos of every room before you leave.\n* Keep all your receipts."],
    ["**[Image: a man in his late twenties grinning at the camera]** ", "*takes a selfie and sends it* lol. ", "<image: me at the market>"],
    ["(here's why: it matches your shoes. it was cheaper too. trust me.) ", "【photo: me at the lake】 _sends a selfie, grinning_ ok."],
    ["Haha yes. 📸 moment for sure lol. ", "*shows you a photo of my cat* Dr. Who (sends a pic. ", "of the view) done!"],
]
USER_TEXTS = ["hey how was your day", "explain how kilns work in detail", "what do you know about me?", "lol"]

class Parity(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        if not NODE:
            self.skipTest("node isn't installed")
        self.tmp = tempfile.TemporaryDirectory(); T = self.tmp.name
        self.T = T
        repo = os.path.join(T, "repo"); os.makedirs(repo)
        for name, text in [("persona.txt", PERSONA), ("mode_advisor.txt", MODES["advisor"]), ("mode_companion.txt", MODES["companion"])]:
            with REAL_OPEN(os.path.join(repo, name), "w") as f: f.write(text + "\n")
        def fake_read(name, default=""):              # the .local-first lookup, only inside the fake repo
            stem, ext = os.path.splitext(name)
            for p in (os.path.join(repo, stem + ".local" + ext), os.path.join(repo, name)):
                if os.path.exists(p):
                    with REAL_OPEN(p) as f: return f.read().strip()
            return default
        self.fake_read = fake_read
        self.cfg = {"voice": "casual_male", "save_chats": False, "lives": True, "see_photos": True, "language": "", "pictures": "off",
                    "real_timing": False}            # (phone mode answers at once: the page is the one answering)
        self.clock = Clock()
        self.kicks = []
        ps = [mock.patch.object(characters, "MINE", os.path.join(T, "my-characters")),
              mock.patch.object(characters, "_read", lambda name: fake_read(name, "")),
              mock.patch.object(bs, "read", fake_read),
              mock.patch.object(bs, "local_cfg", lambda: dict(self.cfg)),
              mock.patch.object(lives, "LIVES", os.path.join(T, "my-characters", "lives")),
              mock.patch.object(lives, "WORLD", os.path.join(T, "my-characters", "lives", "_world.json")),
              mock.patch.object(facts, "VAULT", os.path.join(T, "Buddy")),
              mock.patch.object(facts, "DIR", os.path.join(T, "Buddy", "Buddy knows")),
              mock.patch.object(facts, "STATE", os.path.join(T, ".facts_state.json")),
              mock.patch.object(facts, "_cache", {}),
              mock.patch.object(facts, "kick", lambda cid, urgent=False: self.kicks.append(cid)),
              mock.patch.object(social, "THREAD", os.path.join(T, ".thread.json")),
              mock.patch.object(social, "GENS", os.path.join(T, ".gens.json")),
              mock.patch.object(social, "SUBS", os.path.join(T, ".push_subs.json")),
              mock.patch.object(social, "VAPID", os.path.join(T, ".vapid.json")),
              mock.patch.object(social, "_gen", {}), mock.patch.object(social, "_private", []), mock.patch.object(social, "_marks", []),
              mock.patch.object(images, "MEDIA", os.path.join(T, ".media")),
              mock.patch.object(images, "find", lambda c: None),
              mock.patch.object(bs, "CHATS", os.path.join(T, "Buddy", "chats")),
              mock.patch.object(bs, "VAULT", os.path.join(T, "Buddy")),
              mock.patch.object(devices, "FILE", os.path.join(T, ".devices.json")),
              mock.patch.object(devices, "MAC_TOKEN", os.path.join(T, ".mac_token")),
              mock.patch.object(bs, "plan_soon", lambda *a, **k: None),
              mock.patch.object(bs, "recall", lambda *a, **k: []),
              mock.patch.object(localcheck, "check", lambda url: None),
              mock.patch.object(bs, "_models", {"at": 0, "ttl": 0, "ids": [], "meta": {}}),
              mock.patch.object(bs, "_no_vision", {}), mock.patch.object(bs, "_thinking_refused", set()),
              mock.patch.object(bs, "_tts_stream_refused", set()), mock.patch.object(bs, "_stock", {}),
              mock.patch.object(bs, "time", self.clock.time_module()),
              mock.patch.object(bs, "datetime", self.clock.datetime_module()),
              mock.patch.object(lives, "time", self.clock.time_module()),
              mock.patch.object(edition, "PUBLIC", False)]   # (each test says which edition it checks: the same in the public copy)
        for p in ps:
            p.start(); self.addCleanup(p.stop)
        self.tz0 = os.environ.get("TZ")
        self.addCleanup(set_tz, self.tz0)            # (the other tests in this process see the normal zone)
        for o in (builtins, io):                     # the guard: no real private file is ever opened from here on
            p = mock.patch.object(o, "open", guarded_open); p.start(); self.addCleanup(p.stop)
        self.world()

    def tearDown(self):
        if hasattr(self, "tmp"): self.tmp.cleanup()

    def world(self):
        """Characters, facts and lives in the temp folder (lives' dates follow the zone's T0: rebuilt per zone)."""
        mine = characters.MINE
        os.makedirs(mine, exist_ok=True)
        for cid, c in CHARS.items():
            with REAL_OPEN(os.path.join(mine, cid + ".json"), "w") as f: json.dump(c, f)
        rnd = random.Random(3)
        os.makedirs(facts.DIR, exist_ok=True)
        files = {"_everyone": fact_lines(rnd, 12, "We both like "), "buddy": fact_lines(rnd, 200),
                 "mara": fact_lines(rnd, 5) + ["- I went to salsa with Sarah. (learned 2026-10-01)", "- My sister Sarah visits. (added 2026-10-02)",
                                               "- I like coffee coffee coffee coffee. (learned 2026-10-05)", "- I like tea. (learned 2026-10-05)",
                                               "- I like tea. (learned 2026-10-06)"],
                 "ana-lu": fact_lines(rnd, 40, "Long one: ")}
        for owner, lines in files.items():
            with REAL_OPEN(os.path.join(facts.DIR, owner + ".md"), "w") as f: f.write("# facts\n\n" + "\n".join(lines) + "\n")

    def lives_for(self, now):
        today = lives.life_date(now); rnd = random.Random(int(now))
        for cid, friendish in (("buddy", True), ("mara", False), ("ana-lu", False)):
            lives.save(cid, lives.clean(life_log(cid, today, rnd, friendish), cid))
        lives.save_world({"buddy+mara": {"know": True, "how": "old friends from uni", "by": "you"},
                          "ana-lu+buddy": {"know": True, "how": "", "by": "ai"}, "ana-lu+mara": {"know": False, "how": "", "by": "ai"}})

    # ---------- the kit, as SPEC2 §3.2 builds it (with its own copies of §5.1, §5.2 and the texting texts, so a drift
    # between the spec and buddy_server.phonekit() shows in test_kit_matches_the_mac) ----------
    def ref_kit(self, now):
        c = bs.cfg(); chars = characters.all_characters(c); lc = bs.life_chars(c)
        persona_of = lambda x: x.get("persona") or (
            characters._read("persona.txt") if x.get("builtin") else f"You are {x['name']}, a friendly adult I can talk to. {x.get('tagline', '')}")
        slim = ref_slim
        kc = []
        for x in chars:
            own, shared = facts.visible(x)
            life = None
            if bs.has_life(x, c):
                avoid = characters.avoid_terms(x)
                life = {"log": slim(lives.load(x["id"]), now),
                        "friends": [{"id": o["id"], "name": o["name"], "how": how,
                                     "log": slim(lives._without(lives.load(o["id"]), avoid), now, friend=True)}
                                    for o, how in lives.ties(x["id"], lc)[:4]]}
            kc.append({"id": x["id"], "name": x["name"], "tagline": x.get("tagline", ""), "color": x["color"],
                       "avatar": x.get("avatar", 0), "wallpaper": x.get("wallpaper", 0), "builtin": bool(x.get("builtin")),
                       "brain": x["brain"], "voice": x["voice"], "persona": persona_of(x),
                       "facts": {"own": [{"text": f["text"], "date": f["date"]} for f in own],
                                 "shared": [{"text": f["text"], "date": f["date"]} for f in shared]},
                       "knows_ask": {"phone": {"have": bs.knows_ask(x, True, False), "none": bs.knows_ask(x, False, False)},
                                     "call": {"have": bs.knows_ask(x, True, True), "none": bs.knows_ask(x, False, True)}},
                       "life": life})
        style_text = lambda via: bs.CALLING if via == "call" else bs.TEXTING.format(where=" on my phone")
        length = {"long": bs.length_hint("explain", "phone"), "tiny": bs.length_hint("hi", "phone"),
                  "short": bs.length_hint("one two three four five six seven", "phone"),
                  "medium": bs.length_hint(" ".join(["w"] * 31), "phone")}
        tz = lives.tz_name().lstrip(":")
        import re
        tz_re = re.compile(r"[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+){0,2}")
        stt = str(c.get("stt_model") or "")
        return {"v": 3, "name": c.get("name", "Buddy"), "tz": tz if tz_re.fullmatch(tz) else "",
                "see_photos": bool(c.get("see_photos", True)), "companion_on_phala": bs.companion_provider(c) == "phala",
                "chars": kc, "voices": [{"id": v, "label": l, **({"note": "costs about 5x more per reply"} if v[:1].isupper() else {})}
                                        for v, l in characters.VOICES],
                "voice": {"default": c.get("voice", "casual_female"), "ids": [v for v, _ in characters.VOICES]},
                "prompts": {"modes": {m: bs.read(f"mode_{m}.txt") for m in ("advisor", "companion")},
                            "styles": {"phone": style_text("phone"), "call": style_text("call")},
                            "length": length, "facts_head": bs.FACTS_HEAD, "facts_rule": bs.FACTS_RULE,
                            "photo_safety": bs.PHOTO_SAFETY, "cant_see": bs.CANT_SEE, "looked": bs.LOOKED, "describe": bs.DESCRIBE,
                            "no_photos": bs.NO_PHOTOS},
                "facts_paths": {"shared": f"{facts.FOLDER}/{facts.EVERYONE}", "own_prefix": f"{facts.FOLDER}/"},
                "models": {"advisor": {"preferred": c.get("advisor_model"), "fallbacks": bs.ADVISOR_MODELS},
                           "companion": {"preferred": c.get("companion_tinfoil_model"), "fallbacks": bs.COMPANION_MODELS},
                           "vision_order": bs.VISION_ORDER,
                           "no_thinking": {m: v for m, v in bs.NO_THINKING.items() if not m.startswith("@cf/")},
                           "always_thinks": sorted(bs.ALWAYS_THINKS), "temperature": 0.9, "call_max_tokens": 300, "stt": bs.STT, "stt_next": bs.STT_NEXT},
                "tinfoil": {"ids": list(bs._models["ids"]), "meta": dict(bs._models.get("meta") or {})},
                "stt": {"language": str(c.get("language") or ""), "model": stt if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", stt) else ""},
                "call": {"greetings": bs.GREETINGS, "fillers": bs.FILLERS, "missed": bs.MISSED},
                "texting": {"caps": {k: list(v) for k, v in bs.TEXT_CAPS.items()}},
                "edition": self.ref_edition(c, now), "billing": {"out": billing.OUT, "limit": billing.LIMIT}}

    def ref_edition(self, c, now):                    # (the reference copy of buddy_server.kit_edition)
        if not edition.PUBLIC:
            return {"public": False}
        at = c.get("partner_at")
        return {"public": True, "halal": edition.HALAL, "companion": edition.COMPANION, "recheck": edition.RECHECK,
                "romance": {"yes": edition.romance("yes", now, now), "no": edition.romance("no", now, now),
                            "no_recheck": edition.romance("no", None, now), "no_noask": edition.romance("no", now, now, True),
                            "unknown": edition.romance("", None, now), "unknown_noask": edition.romance("", None, now, True)},
                "partner": {"has": c.get("has_partner") if c.get("has_partner") in ("yes", "no") else "",
                            "at": float(at) if isinstance(at, (int, float)) and at == at and abs(at) != float("inf") else None,
                            "noask": bool(c.get("partner_noask"))}}

    def node(self, kit, cases, tz="UTC"):
        env = {**os.environ, "TZ": tz}
        r = subprocess.run([NODE, CHECK], input=json.dumps({"kit": kit, "cases": cases}), capture_output=True, text=True,
                           env=env, timeout=600)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 0, "JS and Python differ (fake data only):\n" + out[-6000:])
        self.assertRegex(r.stdout, r"(\d+)/\1 cases match")
        return r.stdout

    # ---------- families that don't depend on the time zone ----------
    def test_text_and_models(self):
        set_tz("Europe/Berlin")
        now = T0["Europe/Berlin"]; self.clock.now = now
        self.lives_for(now)
        kit = self.ref_kit(now)
        rnd = random.Random(11)
        cases = {}
        sp = ["Hey you! 😊 How was the day? I missed you… *laughs* Tell me everything.", "Flags 🇩🇪 and keycaps 1️⃣ and ZWJ 👨‍👩‍👧 and ☀️ ⌚ ⭐",
              "skin tones 👍🏽👋🏿 and tags 🏴\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F", "*leans in closer and whispers* you know? (sighs) Fine. *huge* deal",
              "(nodding slowly) yeah. *grins* *giggling* (crying) (cries) *coughs* lol", "*nodé* ok (smilés) fine. *ſmiles* (KISSES) *sighs_* (nod2)",
              "Okay.  Two   spaces.\n\nNew para! **Bold** and _under_ and `code` ~strike~ # head", "a\x1cb\x1dc\x1ed\x1fe", "x\x85y \x85 z",
              "wide　space　　here", "bom﻿here ﻿", "nbsp\xa0\xa0there line para", "", "   ", "😊", "*smiles*",
              "(laughing softly into the phone) bye", "*pauses* *raises an eyebrow* hm", "(looks away) ok", "*bites lip*", "*hums a tune*",
              "*clears throat* So.", "(blinks) what", "*stretches* tired", "(beaming) yes!", "*cries* no", "*crying* no", "*cry* no",
              "~~gone~~ and #tags and __dunder__", "tab\there\tand\nnewline", "Ünd. Then 2. Next. i.e. this.", "♥ ✨ ❤️ ✔️ ⭐️ ⌛ ⬆️",
              "(whispers)", "*" * 5, "(smiles" , "smiles)", "*whispering something that is definitely longer than forty characters here*"]
        cases["spoken"] = [{"in": s, "out": bs.spoken(s)} for s in sp]
        th = fake_thread(rnd, ["buddy", "mara", "zed"], 140, now)
        social_thread = lambda after=0: sorted((m for m in th if m["id"] > after), key=lambda m: m["id"])
        with mock.patch.object(social, "thread", social_thread):
            cases["recent"] = [{"thread": social_thread(), "n": n, "priv": priv, "char": ch,
                                "out": social.recent_messages(n, include_private=priv, char=ch)}
                               for ch in ("buddy", "mara", "zed", "nobody") for priv in (False, True) for n in (30, 5)]
            cases["context"] = [{"msgs": ref_phone_msgs(th, ch), "char": ch, "out": social.recent_messages(30, char=ch)}
                                for ch in ("buddy", "mara", "zed")]
        rl, cases["rlately"] = [dict(m) for m in th], []    # (their reactions on your recent messages: not every time)
        for i, m in enumerate(rl):
            mine = [x["id"] for x in rl[:i] if x["role"] == "user" and x.get("char", "buddy") == m.get("char", "buddy")][-9:]
            if m["role"] == "reaction" and m.get("by") != "you" and mine: m["target"] = rnd.choice(mine)
            elif m["role"] == "user" and rnd.random() < 0.15 and mine:
                rl.insert(i + 1, {"id": m["id"] + 0.5, "role": "reaction", "content": "", "ts": m["ts"], "char": m.get("char", "buddy"),
                                  "target": rnd.choice(mine), "emoji": "😂", "by": m.get("char", "buddy")})
        job = [{"id": 1, "role": "user", "content": "I got the job!", "ts": now - 300, "char": "mara"},   # their 🔥 on it,
               {"id": 2, "role": "reaction", "content": "", "ts": now - 290, "char": "mara", "target": 1, "emoji": "🔥", "by": "mara"},
               {"id": 3, "role": "assistant", "content": "yay!", "ts": now - 280, "char": "mara"},     # then a New chat
               {"id": 4, "role": "break", "content": "", "ts": now - 200, "char": "mara"},
               {"id": 5, "role": "user", "content": "hi", "ts": now - 100, "char": "mara"}]
        for part in [rl[:k] for k in range(8, len(rl) + 1, 5)] + [job]:
            with mock.patch.object(social, "thread", lambda after=0, part=part: list(part)):
                for ch in ("buddy", "mara", "zed"):
                    out, own = bs.reacted_lately(ch), [m for m in part if m.get("char", "buddy") == ch]
                    cur = own[max((i + 1 for i, m in enumerate(own) if m["role"] == "break"), default=0):]
                    cases["rlately"] += [{"thread": part, "char": ch, "out": out},   # the whole thread, and only what
                                         {"thread": cur, "char": ch, "out": out}]    # phone mode has (since New chat)
        self.assertEqual({c["out"] for c in cases["rlately"]}, {True, False})
        with mock.patch.object(social, "thread", lambda after=0: list(job[:3]) + [dict(job[4], id=4)]):
            self.assertTrue(bs.reacted_lately("mara"))                 # (without the New chat they had reacted lately)
        with REAL_OPEN(social.THREAD, "w") as f: json.dump([m for m in th if not m.get("private") and not m.get("pending_photo")], f)
        for c in cases["context"]:                     # (the Mac's own phone_context, read from the thread file)
            got = social.phone_context([c["char"]])["chars"][c["char"]]["msgs"]
            self.assertEqual(got, c["msgs"], "social.phone_context differs from SPEC2 §5.3 item 4 (fake data only)")
            c["msgs"] = got
        own = [{"role": "assistant", "content": c, "image": "ef" * 16, **({"photo_desc": d} if d is not None else {})}
               for c in ("", "hi there") for d in (None, "", "me at the [beach]", "  a\x85cat \u3000on [a] sofa ]", "x" * 400, "[[]]")]
        own += [{"role": "user", "content": "", "image": "ab" * 16, "photo_desc": "[me]"}, {"role": "assistant", "content": "", "photo_desc": "old"}]
        cases["astext"] = [{"m": m, "out": social._as_text(m)} for m in th + own if m["role"] in ("user", "assistant")]
        self.assertTrue(any(c["out"].startswith("[photo: ") for c in cases["astext"]) and any(c["out"] == "[photo]" for c in cases["astext"]))
        cases["alternate"] = [{"in": c["out"], "out": bs.alternate(c["out"])} for c in cases["recent"]]
        weird = [{"role": "assistant", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "user", "content": " \x85"},
                 {"role": "system", "content": "s"}, {"role": "user", "content": "x"}, {"role": "user", "content": "y"}]
        cases["alternate"].append({"in": weird, "out": bs.alternate(weird)})
        def py_edits(msgs, heard, opened):            # buddy_server.py:986-993 (via == "call"), verbatim
            msgs = list(msgs)
            if isinstance(heard, str):
                last = len(msgs) - 2 if len(msgs) >= 2 and msgs[-2]["role"] == "assistant" else None
                if last is not None:
                    msgs[last] = {**msgs[last], "content": (heard.strip()[:2000] + " … (you cut me off here)").strip()}
            if isinstance(opened, str) and opened.strip():
                msgs = msgs[:-1] + [{"role": "assistant", "content": opened.strip()[:200]}] + msgs[-1:]
            return msgs
        base = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "long reply"}, {"role": "user", "content": "b"}]
        cases["edits"] = [{"msgs": m, "heard": h, "opened": o, "out": py_edits(m, h, o)}
                          for m in (base, base[:1], base[1:], [], cases["recent"][0]["out"])
                          for h in (None, "", "  long re ", "😊" * 2100, " \x85x　") for o in (None, "", " Hey! ", "x" * 300, "\x1c")]
        cases["query"] = [{"msgs": c["out"], "out": " ".join(m["content"] for m in c["out"][-5:] if m["role"] == "user")} for c in cases["recent"]]
        def py_heard(msgs, desc, user_text):          # buddy_server.py:1003-1008, verbatim
            msgs = list(msgs)
            if msgs and msgs[-1]["role"] == "user":
                msgs[-1] = {"role": "user", "content": bs.LOOKED.format(desc=desc, text=user_text).strip() if desc
                            else (msgs[-1]["content"] or "(I sent you a photo)")}
            return [msgs, [bs.PHOTO_SAFETY] + ([] if desc else [bs.CANT_SEE])]
        cases["heard"] = [{"msgs": m, "desc": d, "text": t, "out": py_heard(m, d, t)}
                          for m in (base, base[:2], [], [{"role": "user", "content": ""}])
                          for d in ("", "a red square {text} {desc}", " a cat ") for t in ("", "look!", "{x}")]
        # facts
        wq = ["", "climbing in Lisbon", "café naïve Ünd", "coffee", "tea tea tea", "a_b x I", "the and my", "2026 sister work studio pottery kiln"]
        cases["words"] = [{"in": t, "out": memory._words(t)} for t in wq + [f["text"] for f in kit["chars"][0]["facts"]["own"][:30]]]
        cases["facts"] = []
        for x in characters.all_characters(bs.cfg()):
            for q in wq:
                for call in (False, True):
                    for every in (False, True):
                        known, src = facts.for_prompt(x, q, call=call, everything=every)
                        cases["facts"].append({"char": x["id"], "query": q, "call": call, "everything": every, "out": [known, src]})
        # what you asked
        kq = ["what do you know about me?", "What do you know about me", "what do u know abt me", "tell me what you remember about me",
              "Tell me everything you know about me.", "how much do you know about me?", "what have you got on me", "what've you stored about me",
              "do you know anything about me", "Did you remember stuff about me?", "do u know much about me", "what's stored about me",
              "what is saved on me", "what do you have on file about me", "What’s kept about me?", "what do you know about my life",
              "anything you learned about myself?", "what did you learnt about me", "what do you know", "what do you know about cats",
              "I know about you", "tell me about yourself", "what you keep on me", "everything ya got about me", "WHAT DO YOU KNOW ABOUT ME",
              "what do you know about me. And more", "what? you know about me", "what　do you know about me", "what do you\x85know about me",
              "do you remember a lot about me", "did you know things about me?", "what do you have stored about me", "whats saved about me",
              "what is on file on me", "what's kept about meow", "what do you know about meself", "somewhat you know about me", "what do yougot about me",
              "tell me, what do you remember of me", "do you know anything about me?!", "what do you remember on me"]
        cases["knowsq"] = [{"in": t, "out": facts.is_knows_question(t)} for t in kq]
        va = ["send me a voice message", "Send a voice note please", "leave me a voice memo", "record a voice message for me",
              "voice message me", "can you voice note me?", "send voice message", "sending a voice message", "resend a voice message",
              "send me a quick little voice message", "send me something. a voice message", "voice messages are cool", "Voice Message me now",
              "record yourself and send a voice note", "send a voice notes", "leave a voice memo!", "send me a voice", "a voice message",
              "please record a quick voice memo", "send—voice message", "send me a long long long long long voice message", "recorded a voice note",
              "send_ voice note", "can you send me a voice message?", "voice note me?", "voice memo me", "SEND A VOICE NOTE", "send ü voice note",
              "send.voice note", "leave voice note", "record voice memo", "send me your voice", "voicemessage me", "send a voice message pls",
              "send x voice message", "send2 voice message", "leave me a voice message, ok?", "just send me a voice message", "voice note",
              "can u record a voice message"]
        cases["voiceask"] = [{"in": t, "out": bool(bs.VOICE_ASK.search(t))} for t in va]
        dt = ["explain this", "can you explain how this works", "how do I fix it", "how can we go", "how to cook rice", "why is the sky blue",
              "why not", "tell me more", "tell me about it", "in detail please", "details?", "detail", "step by step", "step-by-step", "steps",
              "walk me through it", "help me write a message", "help me plan", "write me a poem", "write a note", "plan for tomorrow",
              "compare these", "pros and cons?", "recommend something", "any advice", "what should i do", "go deeper", "longer please",
              "lol same", "hi", "explained", "explains", "longest", "how do", "why", "tell me", "EXPLAIN", "Details", "help me with this",
              "reexplain", "write the", "plan a trip", "recommendation", "advices", "stepsister", "how does it work"]
        cases["detail"] = [{"in": t, "out": bool(bs.DETAIL.search(t))} for t in dt]
        # a photo however they wrote it (pic_tags), the rest without tags (no_tags), and one still being written
        # (_PIC_OPEN): main's own spellings and mentions, more of the same, and random mixes of the pieces they're made of
        pt = [t for t, _ in tone.SPELLINGS] + list(tone.NOT_PHOTOS) + [
            "[Photo]", "*snaps a pic* 📸", "![image](x.jpg)", "![](x.jpg) hi", "![\"me\"](a.png)", "omg look [image: " + "the light " * 300 + "]",
            "[react: 😂] lol", "[partner: no] cool", "ok\nImage: me in the kitchen", "📸 me at the gym\nok", "ok [photo: me at",
            "so pretty [photo: me on a", "(sends a selfie\nwinking)", "📷[selfie at the pier]📷", "🤳️ me in the mirror at the gym",
            "📸: me at the lake", "📸 - me at the lake", "Photo — me at the lake", "photo attached: me at the beach", "SELFIE: me at the GYM",
            "*Sends A Selfie At The Beach*", "**sends a selfie at the beach**", "* sends a selfie*", "x*sends a selfie*", "a_sends a pic_",
            "(i'm sending you a photo of my dog)", "(I just sent a pic of the view)", "(just snapped a pic at the market)",
            "*quickly takes a selfie and sends it to you*", "(takes a pic & shares it)", "*sends you back a selfie*", "*shows me a pic*",
            "(here is a photo of the sunset)", "(here are some pics from the trip: me at the top)", "[a quick selfie at the gym]",
            "[one more blurry selfie in the rain]", "(photo of: me at the gym)", "(photo showing me at the gym)", "(image description: me at the gym)",
            "(image caption: me at the gym)", "(photos: me and lena at the beach)", "(pic: your dog at the beach)", "(pic of your cat)",
            "[sent you that pic of me]", "*sends a selfie tomorrow*", "(sending a photo once i'm home)", "(after i get home i'll send a pic)",
            "here's a photo: me at the beach", "Here’s a pic — me at the lake", "it was [photo: a) me b) you]", "nested (photo: me (at) the gym)",
            "{photo: me}", "<photo: me at the gym> and <3", "【selfie at the lake】", "【 sends a selfie 】", "_photo: me at the gym_",
            "_takes a selfie at the gym_ lol", "(selfie)", "*selfie*", "(a selfie: me grinning)", "(my photo: me in a hat)",
            "photos: me at the gym\nPhotos: love them", "line one\n  Image: me on a boat\nline three", "Image:me on a boat",
            "📸\tme on my balcony", "📸 me", "📸 the view from my window", "📸 nice", "photo:\u3000me at the beach", "a\x85b [photo: x\x85y]",
            "Selfie\u2028me at the beach", "(sends\u3000a selfie)", "*ſends a selfie at the beach*", "(KELVIN takes a pic at 5\u212a)",
            "( sends a selfie )", "(sends a selfie", "*sends a selfie", "_sends a selfie", "<image: me at the", "[image: me at the\n", "x [a\n",
            "aw :[ that sucks. hope tomorrow's better", "ugh :( that", "love you <3 and", "*laughs* ok", "(that was fun)", "a pic (of what?)",
            "omg this **photo", "yes!! *the photo", "(the photo of your dog", "haha (sends a photo: me at the", "*sends a selfie at the",
            "<image: me", "_snaps a pic of", "*photo attached: me", "", " ", "\n", "[", "]", "(", "*", "📸", "[photo: ", "[photo:]", "[photo: a]"]
        rnd2 = random.Random(29)
        bits = ["[", "]", "(", ")", "*", "**", "_", "{", "}", "<", ">", "【", "】", "![", "](x.jpg)", "📸", "📷", "🤳", "\ufe0f", "\n", " ", "  ",
                "\t", "\u3000", "\x85", ":", " - ", "—", ",", ".", "!", "photo", "Photos", "pic", "image", "selfie", "Snapshot", "img", "sends",
                "sent", "takes", "snaps", "here's", "I'm", "just", "quickly", "me", "my", "a", "an", "another", "at", "the", "beach", "gym",
                "your", "you sent", "soon", "and sends it", "of", "description:", "attached", "incoming", "showing", "wearing", "is", "love",
                "react: 😂", "partner: no", "😂", "é", "ſ", "lol", "ok", "x", "_x_", "can you explain how", "help me decide", "why not"]
        pt += ["".join(rnd2.choice(bits) for _ in range(rnd2.randint(1, 18))) for _ in range(500)]
        cases["pictags"] = [{"in": t, "final": f, "line": ln, "out": list(bs.pic_tags(t, final=f, line_start=ln))}
                            for t in pt for f in (True, False) for ln in (True, False)]
        cases["notags"] = [{"in": t, "out": bs.no_tags(t)} for t in pt] + [{"in": w, "out": bs.no_tags(w)} for w in sorted({c["out"][0] for c in cases["pictags"]})]
        cases["picopen"] = [{"in": t[:k], "out": bool(bs._PIC_OPEN.search(t[:k]))} for t in pt[:300] for k in sorted({len(t), len(t) // 2, len(t) * 3 // 4})]
        found = [c for c in cases["pictags"] if c["out"][1]]
        self.assertTrue(len(found) > 200 and any(not c["out"][1] for c in cases["pictags"]) and any(c["out"] for c in cases["picopen"]))
        dq = list(tone.DeepQuestions.CASUAL) + list(tone.DeepQuestions.DEEP)
        cases["deep"] = [{"in": t, "out": bs.deep_question(t)} for t in dq + dt + [
            "can you explain how compound interest works", "Could U please explain what a kiln is exactly", "please explain the rules to me now",
            "explain to me why the sky is blue please", "explain why you didn't text me back last night", "explain why u did that to me ok",
            "explain the difference between these two please", "walk me through setting up a budget please", "step-by-step how do i do this",
            "give me some advice on sleeping better", "give me advice about my landlord situation", "give me good advice", "pros and cons of moving to Lisbon",
            "help me decide between these two jobs", "help me plan a trip to Porto", "help me write a note to my boss", "help me figure it out please now",
            "would you explain how it works", "will u explain how it works", "can you\u3000explain how\x85this works", "can you explain", "explain how",
            "you better explain why you didn't text me back", "omg i can't explain it but i miss you so much", "explain yourself mister, where were you",
            "can you explainhow this works ok", "re-explain how this works to me", "EXPLAIN HOW THIS WORKS TO ME", "", "   ", "one two three four five six"]]
        self.assertEqual({c["out"] for c in cases["deep"]}, {True, False})
        lt = dt + ["", "one two three four five six", "one two three four five six seven", " ".join(["w"] * 30), " ".join(["w"] * 31),
                   "x" * 400, "x" * 401, "é" * 401, "😊" * 300, "a\x1cb c\x85d e　f g h"]
        cases["length"] = [{"in": t, "via": v, "out": bs.length_hint(t, v)} for t in lt for v in ("phone", "call")]
        cases["cap"] = [{"in": t, "via": v, "out": (lambda r: list(r) if r else None)(bs.long_enough(t, v))} for t in lt for v in ("phone", "call")]
        rx = ["❤️", "❤", "😂", " 😂 ", "👍", "😮", "😢", "🔥", "🍕", "", " ", "❤️❤️", "♥", "😂️", "️", "👍🏽", "x", "🔥 ", "\x85😮　",
              "😢😢", "fire", "❤ ", "LOL", "😮‍💨", "🙂", "🥲", "😭", "❣️", "💔", "👎", "🙏", "😂😂", "❤️ ", " ❤", "\t🔥\n", "👍️", "😢 ", "🤣", "😆", "🔥🔥",
              "🍕🍕", "🇵🇹", "🇵", "1️⃣", "#⃣", "👩‍❤️‍👨", "🧑🏿‍🚀", "©️", "™", "a😂", "😂a", ":)", "<3", "🫠", "🪩", "☕", "⭐",
              "👨‍👩‍👧‍👦👨‍👩‍👧‍👦", "🏳️‍🌈", "‼️", "〰️", "\u200d", "😂\u200d", "👍🏽👍🏽", "x" * 17, "\U0001F1E6\U0001F1E6\U0001F1E6"]
        cases["reaction"] = [{"in": e, "out": bs.reaction(e)} for e in rx]
        # models
        cases["pick"] = []
        for ids in ([], ["gemma4-31b", "glm-5-3", "kimi-k3"], ["glm-5-3-flash", "deepseek-v4-1-flash"], ["glm-5-3"], ["nothing"], ["kimi-k3", "llama3-3-70b"]):
            with mock.patch.object(bs, "tinfoil_models", lambda ids=ids: ids):
                for pref, fb in (("gemma4-31b", bs.ADVISOR_MODELS), (None, bs.COMPANION_MODELS), ("glm-5-3", bs.ADVISOR_MODELS), ("", bs.ADVISOR_MODELS)):
                    for spk in (False, True):
                        cases["pick"].append({"pref": pref, "fb": fb, "ids": ids, "spoken": spk, "out": bs.pick_model(pref, fb, spk)})
        cases["brain"] = []
        for conf in ({}, {"advisor_model": "glm-5-3", "companion_tinfoil_model": "kimi-k3"}, {"advisor_model": None}):
            self.cfg.update(advisor_model=conf.get("advisor_model", "gemma4-31b"), **({"companion_tinfoil_model": conf["companion_tinfoil_model"]} if "companion_tinfoil_model" in conf else {}))
            k2 = self.ref_kit(now)
            for ids in ([], ["glm-5-3", "kimi-k3"], ["deepseek-v4-1-flash"]):
                with mock.patch.object(bs, "tinfoil_models", lambda ids=ids: ids), mock.patch.object(bs, "tinfoil", lambda: "http://fake/v1"):
                    for x in characters.all_characters(bs.cfg()):
                        for mode in (None, "advisor", "companion"):
                            for spk in (False, True):
                                _, _, model, used = bs.brain(mode or x["brain"], spoken=spk)
                                cases["brain"].append({"kit": k2["models"], "mode": mode, "char": x["id"], "ids": ids, "spoken": spk,
                                                       "out": {"model": model, "modeUsed": used}})
            self.cfg.pop("companion_tinfoil_model", None); self.cfg["advisor_model"] = "gemma4-31b"
        cases["extras"] = []
        for model in ("gemma4-31b", "glm-5-3", "kimi-k3", "deepseek-v4-1-flash", "llama3-3-70b", "other"):
            for via in ("phone", "call"):
                for refused in ([], [model]):
                    for text in ("hey", "can you explain how compound interest works"):
                        url, free, spoken_reply = "http://127.0.0.1:1/v1", False, via == "call"   # buddy_server._chat, verbatim
                        deep = not spoken_reply and via != "call" and not free and url != bs.PHALA and bs.deep_question(text)
                        extra = dict(bs.NO_THINKING.get(model, {})) if url != bs.PHALA and model not in refused and not deep else {}
                        if (via == "call" and url != bs.PHALA and model not in bs.ALWAYS_THINKS and model not in refused
                                and (extra or model not in bs.NO_THINKING)):
                            extra["max_tokens"] = 300
                        cases["extras"].append({"model": model, "via": via, "refused": refused, "text": text, "out": extra})
        cases["sttmodel"] = []
        for chosen in (None, "", "whisper-large-v3-turbo", "voxtral-small-24b", "whisper-x.1_b", "bad model!", "x" * 64, "x" * 65,
                       "ünï", "gpt-4o-transcribe"):
            for down in (False, True):
                if chosen is None: self.cfg.pop("stt_model", None)
                else: self.cfg["stt_model"] = chosen
                with mock.patch.object(bs, "_stt_down", {"at": self.clock.now - (30 if down else 3600)}):
                    kit_model = self.ref_kit(now)["stt"]["model"]        # (what the kit says the setting is)
                    cases["sttmodel"].append({"chosen": kit_model, "down": down, "out": bs.stt_model()})
        self.cfg.pop("stt_model", None)
        class Refused(Exception):
            def __init__(self, code, text): self.code, self.text = code, text
            def read(self, n=-1): return self.text.encode()[:n if n >= 0 else None]
        cases["billing"] = [{"code": code, "text": text, "out": billing.kind(Refused(code, text))}
                            for code in (402, 429, 400, 401, 403, 500, 503)
                            for text in ("", "Spend limit reached", "spending_limit exceeded", "spend-limit", "SPEND  LIMIT",
                                         "spend\tlimit", "spend\u3000limit", "rate limit", "too many requests", "spendlimit",
                                         "spending limit", "spend xx limit", "Spend Limit: $5")]
        cases["vision"], cases["vfail"] = [], []
        metas = [{}, {"gemma4-31b": {"multimodal": True, "type": "chat"}, "kimi-k3": {"multimodal": True}, "glm-5-3": {"multimodal": False},
                      "llama3-3-70b": {"multimodal": True, "type": None}, "nomic": {"multimodal": True, "type": "embedding"},
                      "zz-vision": {"multimodal": True, "type": ""}, "deepseek-v4-1-flash": {"type": "chat"}}]
        with mock.patch.object(bs, "read", lambda n, d="": "sk-FAKE-parity" if n == ".tinfoil_key" else self.fake_read(n, d)):
            for ids in (["gemma4-31b", "deepseek-v4-1-flash", "kimi-k3", "glm-5-3", "llama3-3-70b", "nomic", "zz-vision"], ["kimi-k3"], [], ["zz-vision", "kimi-k3", "gemma4-31b"]):
                for meta in metas:
                    for nv in ({}, {"gemma4-31b": now + 10}, {"kimi-k3": now - 1, "zz-vision": now}):
                        bs._models.update(ids=ids, meta=meta); bs._no_vision.clear(); bs._no_vision.update(nv)
                        with mock.patch.object(bs, "tinfoil_models", lambda ids=ids: ids):
                            cases["vision"].append({"ids": ids, "meta": meta, "no_vision": nv, "t": now, "out": bs.vision_models()})
            for code in (None, 400, 413, 415, 422, 500, 503, 404):
                bs.vision_failed("m", code)
                cases["vfail"].append({"code": code, "t": now, "out": bs._no_vision["m"]})
        bs._models.update(ids=[], meta={}); bs._no_vision.clear()
        # describe: the body it posts and its cleanup
        cases["describe"] = []
        view = jpeg(64, 48)
        for model in ("gemma4-31b", "deepseek-v4-1-flash", "kimi-k3"):
            for refused in (False, True):
                for content in ("A red square.", "<think>hmm\nlet me see</think> A  cat\non a\tsofa. ", "x " * 700, None, "", "<think>only</think>"):
                    sent = []
                    def fake_post(url, key, body, ctype="application/json", timeout=120, content=content):
                        sent.append(json.loads(body))
                        return FakeResp(json.dumps({"choices": [{"message": {"content": content}}]}).encode())
                    bs._thinking_refused.clear()
                    if refused: bs._thinking_refused.add(model)
                    with mock.patch.object(bs, "post", fake_post), mock.patch.object(bs, "tinfoil", lambda: "http://fake/v1"), \
                         mock.patch.object(bs, "vision_models", lambda model=model: [model]), \
                         mock.patch.object(bs, "read", lambda n, d="": "sk-FAKE-parity" if n == ".tinfoil_key" else self.fake_read(n, d)):
                        desc, _m = bs.describe(view)
                    cases["describe"].append({"model": model, "refused": refused, "view": base64.b64encode(view).decode(), "content": content,
                                              "body": sent[0], "desc": desc})
        bs._thinking_refused.clear()
        # voice: what speak() and tts_wav() post, and which lines are stock
        cases["tts"], cases["voicereply"], cases["stock"] = [], [], []
        texts = ["Hi! 😊 *smiles*", "", "😊", "x" * 2100, "Hey!", "Hmm.", "Hey! 😊", "*laughs* Mm-hm.", "Sorry, say that again?",
                 "It's really noisy there… text me if that's easier.", "Hi, you. 🔥", "plain words"]
        class Self:
            def __init__(s): s.got = None
            def audio(s, ctype, data): s.got = ctype
            def send_response(s, code): s.got = code
            def send_header(s, *a): pass
            def end_headers(s): pass
        with mock.patch.object(bs, "tinfoil", lambda: "http://fake/v1"), \
             mock.patch.object(bs, "read", lambda n, d="": "sk-FAKE-parity" if n == ".tinfoil_key" else self.fake_read(n, d)):
            for v in [x for x, _ in characters.VOICES] + ["bogus", None]:
                for text in texts:
                    for stream in (True, False):
                        for refused in ([], ["qwen3-tts", "voxtral-tts"]):
                            sent = []
                            def fake_post(url, key, body, ctype="application/json", timeout=120):
                                sent.append(json.loads(body)); return FakeResp(WAV, "audio/wav")
                            bs._tts_stream_refused.clear(); bs._tts_stream_refused.update(refused); bs._stock.clear()
                            with mock.patch.object(bs, "post", fake_post):
                                bs.Handler.speak(Self(), {"text": text, "voice": v, **({"stream": True} if stream else {})})
                            cases["tts"].append({"text": text, "voice": v, "stream": stream, "refused": refused, "out": sent[0] if sent else None})
                    if text:
                        sent = []
                        def fake_post2(url, key, body, ctype="application/json", timeout=120):
                            sent.append(json.loads(body)); return FakeResp(WAV, "audio/wav")
                        with mock.patch.object(bs, "post", fake_post2):
                            bs.tts_wav(text, v)
                        cases["voicereply"].append({"text": text, "voice": v, "out": sent[0]})
            for text in texts:
                cases["stock"].append({"text": text, "out": bs.spoken(text)[:2000] in bs.STOCK})
        bs._tts_stream_refused.clear(); bs._stock.clear()
        # hearing: the exact bytes whisper() posts
        cases["stt"] = []
        class U: hex = "0123456789abcdef0123456789abcdef"
        data = bytes(range(256)) * 3 + "Zoë €".encode()
        for ct in ("audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"):
            for char in (None, {"id": "x", "name": "Mara"}, {"id": "y", "name": "Zoë (ä)"}):
                for lang in ("", "pt"):
                    self.cfg["language"] = lang
                    sent = []
                    def fake_post(url, key, body, ctype="application/json", timeout=120):
                        sent.append((body, ctype)); return FakeResp(b'{"text": " hi "}')
                    with mock.patch.object(bs, "post", fake_post), mock.patch.object(bs.uuid, "uuid4", lambda: U), \
                         mock.patch.object(bs, "tinfoil", lambda: "http://fake/v1"), \
                         mock.patch.object(bs, "read", lambda n, d="": "sk-FAKE-parity" if n == ".tinfoil_key" else self.fake_read(n, d)):
                        bs.whisper(data, ct, char)
                    body, ctype = sent[0]
                    self.assertEqual(ctype, f"multipart/form-data; boundary={U.hex}")
                    cases["stt"].append({"model": bs.stt_model(), "prompt": f"{char['name']}." if char else "", "language": lang, "ct": ct,
                                         "data": base64.b64encode(data).decode(), "boundary": U.hex, "out": base64.b64encode(body).decode()})
        self.cfg["language"] = ""
        gone = ["model 'whisper-x' not found", "The model `whisper` does not exist", "model whisper-large is not available",
                "Model: unavailable", "model is not supported", "model unsupported here", "model was retired", "model deprecated",
                "model_not_found", "unknown model", "Invalid  model", "unsupported\nmodel", "no such model", "audio too short",
                "could not decode audio", "model", "the model doesn't exist", "model x doesn't exist", "model x does not exist",
                "modelnot found", "model:" + "y" * 90 + " not found", "model:" + "y" * 70 + " not found", "language 'xx' is not supported",
                "Model\nnot found", "MODEL NOT FOUND", "model notXfound", "unknownmodel", "model ünot found"]
        cases["gone"] = [{"in": t, "out": bool(bs.WHISPER_GONE.search(t))} for t in gone]
        # photos: clean_photo, byte for byte
        app1 = seg(0xE1, b"Exif\x00\x00" + b"GPS" * 20)
        app13 = seg(0xED, b"Photoshop 3.0\x00" + b"x" * 40)
        com = seg(0xFE, b"a comment")
        pics = {"plain": jpeg(800, 600), "exif": jpeg(800, 600, app1), "app13+com": jpeg(640, 480, app13 + com),
                "progressive": jpeg(1024, 768, app1 + com, scans=3), "tail": jpeg(400, 300, tail=b"\xff\xd8\xff\xe1junk"),
                "fill": jpeg(100, 100).replace(b"\xff\xc0", b"\xff\xff\xff\xc0", 1), "big": jpeg(5000, 3000), "tiny": jpeg(8, 8),
                "no-eoi": jpeg(100, 100)[:-2], "broken": jpeg(100, 100)[:30] + b"\x00\x01" + jpeg(100, 100)[30:],
                "rst-outside": b"\xff\xd8\xff\xd0" + jpeg(100, 100)[2:], "short": b"\xff\xd8\xff", "not-jpeg": b"\x89PNG\r\n\x1a\n" + b"x" * 40,
                "no-scan": b"\xff\xd8" + seg(0xE0, b"JFIF\x00") + b"\xff\xd9", "edge": jpeg(1536, 16), "sof2": jpeg(300, 200).replace(b"\xff\xc0", b"\xff\xc2", 1)}
        cases["photo"] = []
        for name, data in pics.items():
            for side, mx in ((4096, 12_000_000), (1536, 3_000_000), (1536, 200)):
                try:
                    out, (w, h) = images.clean_photo(data, side, mx)
                    want = {"b64": base64.b64encode(out).decode(), "w": w, "h": h}
                except ValueError:
                    want = None
                cases["photo"].append({"name": name, "in": base64.b64encode(data).decode(), "max_side": side, "max_bytes": mx, "out": want})
        def wav_of(n, rate=24000, ch=1, bits=16, size=None):
            sz = n if size is None else size
            return (b"RIFF" + (36 + n).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00" + ch.to_bytes(2, "little")
                    + rate.to_bytes(4, "little") + (rate * ch * bits // 8).to_bytes(4, "little") + (ch * bits // 8).to_bytes(2, "little")
                    + bits.to_bytes(2, "little") + b"data" + sz.to_bytes(4, "little") + b"\0" * n)
        auds = {"wav": wav_of(48000), "wav-odd": wav_of(12345 * 2), "wav-stereo": wav_of(96000, ch=2), "wav-open": wav_of(30000, size=0xFFFFFFFF),
                "wav-zero": wav_of(30000, size=0), "wav-norate": wav_of(1000, rate=0), "webm": b"\x1aE\xdf\xa3" + b"\0" * 30,
                "ogg": b"OggS" + b"\0" * 30, "mp4": b"\0\0\0\x20ftypM4A " + b"\0" * 20, "junk": b"hello world, not audio", "empty": b"",
                "short": b"RIFF", "riff-avi": b"RIFF\0\0\0\0AVI " + b"\0" * 40, "wav-nodata": b"RIFF\0\0\0\0WAVEfmt " + b"\0" * 30}
        cases["audio"] = [{"name": n, "in": base64.b64encode(d).decode(), "mime": images.audio_mime(d), "secs": bs.wav_seconds(d)} for n, d in auds.items()]
        # (brain cases carry their own kit models: the node side uses the kit, so run them with each kit's models)
        brain = cases.pop("brain")
        self.node(kit, cases)
        for models in {json.dumps(c["kit"], sort_keys=True) for c in brain}:
            k2 = dict(kit, models=json.loads(models))
            self.node(k2, {"brain": [c for c in brain if json.dumps(c["kit"], sort_keys=True) == models]})

    # ---------- the time zone families: the Mac's zone from the kit, node itself in UTC ----------
    def time_cases(self, zone, kit_tz=None, partners=None):
        """partners (the public edition): relationship statuses, one per prompt case in turn."""
        set_tz(zone)
        now = T0[zone]; self.clock.now = now
        self.lives_for(now)
        kit = self.ref_kit(now)
        if kit_tz is not None: kit["tz"] = kit_tz
        self.assertEqual(kit["tz"], zone if kit_tz is None else kit_tz)
        cases = {"now": [], "lifedate": [], "since": [], "life": [], "prompt": []}
        ts = [now + k * 37 * 60 for k in range(0, int(3 * 86400 / (37 * 60)) + 1)]
        for t in ts:
            cases["now"].append({"t": t, "out": datetime.datetime.fromtimestamp(t).strftime("%A %d %B %Y, %H:%M")})
            cases["lifedate"].append({"t": t, "out": lives.life_date(t).isoformat()})
        for gap in (0, 60, 3 * 3600 - 1, 3 * 3600, 5 * 3600 + 7, 6 * 3600 - 1, 6 * 3600, 2 * 86400 - 1, 2 * 86400, 9 * 86400 + 5):
            for role in ("user", "assistant"):
                t = now + 1000
                fake = [{"id": 1, "role": role, "content": "x", "ts": t - gap, "char": "buddy"}, {"id": 2, "role": "user", "content": "y", "ts": t, "char": "buddy"}]
                self.clock.now = t
                with mock.patch.object(social, "thread", lambda after=0, fake=fake: list(fake)):
                    cases["since"].append({"last": t - gap if gap else 0, "t": t, "role": role, "out": bs.since_last_talk("buddy") if gap else ""})
        cases["since"].append({"last": 0, "t": now, "out": ""})
        for c in kit["chars"]:
            if not c["life"]: continue
            full = lives.load(c["id"]); x = characters.find(c["id"], bs.cfg())
            fr = [(o["name"], how, lives.load(o["id"])) for o, how in lives.ties(c["id"], bs.life_chars(bs.cfg()))]
            for t in ts:
                for short in (False, True):
                    cases["life"].append({"char": c["id"], "t": t, "short": short,
                                          "out": lives.context(full, t, short, friends=fr, avoid=characters.avoid_terms(x))})
        rnd = random.Random(int(now))
        th = fake_thread(rnd, ["buddy", "mara", "zed", "ana-lu"], 60, now - 600)
        for x in characters.all_characters(bs.cfg()):
            mine = [m for m in th if m.get("char", "buddy") == x["id"]]
            for mode in ("advisor", "companion"):
                for via in ("phone", "call"):
                    for asking in (False, True):
                        for photo, cant in ((False, False), (True, False), (True, True)):
                            t = now + rnd.randint(0, 3 * 86400)
                            text = rnd.choice(["what do you know about me?", "hey", "explain kilns in detail", "lol same", " ".join(["w"] * 12)])
                            query = rnd.choice(["climbing in Lisbon", "coffee tea", "", text])
                            msg = {"id": 10 ** 7, "role": "user", "content": text, "ts": t, "char": x["id"]}
                            thread = sorted(th + [msg], key=lambda m: m["id"])
                            prev = [m for m in thread if m["role"] in ("user", "assistant") and m.get("char", "buddy") == x["id"] and not m.get("pending_photo")][:-1]
                            last_ts = max((m["ts"] for m in prev), default=0)
                            last_role = max(reversed(prev), key=lambda m: m["ts"])["role"] if prev else ""
                            turn = ([bs.PHOTO_SAFETY] + ([bs.CANT_SEE] if cant else [])) if photo else []
                            self.clock.now = t
                            partner = None
                            if partners:                  # (what the phone's kit would say about it: ref_edition)
                                self.cfg.update(partners[len(cases["prompt"]) % len(partners)])
                                partner = self.ref_edition(self.cfg, t)["partner"]
                            used = []
                            with mock.patch.object(social, "thread", lambda after=0, thread=thread: list(thread)):
                                out = bs.system_prompt(x, mode, query, None, via, used=used, asking=asking, spoken=via == "call",
                                                       photos=False, extra=turn, length="" if asking else bs.length_hint(text, via))
                            cases["prompt"].append({"char": x["id"], "mode": mode, "via": via, "asking": asking, "photo": photo,
                                                    "cant_see": cant, "text": text, "query": query, "last_ts": last_ts, "last_role": last_role, "t": t,
                                                    "partner": partner, "out": out, "used": used})
            self.assertTrue(mine is not None)
        return kit, cases

    def test_time_in_the_macs_zone(self):
        for zone in ZONES:
            try:
                kit, cases = self.time_cases(zone)
                self.node(kit, cases, tz="UTC")       # (node in UTC: the kit's zone is what counts)
            finally:
                set_tz(self.tz0)

    def test_public_edition_prompts(self):
        """The public copy's rules (edition.py) in the phone's prompts exactly where and as the Mac puts them, for every
        relationship status (romance()'s variants, a "no" months old, "don't keep asking"), and romance() itself."""
        R = edition.RECHECK
        partners = [{"has_partner": h, "partner_at": a, "partner_noask": q}
                    for h in ("yes", "no", "", None, "maybe") for a in (None, "T", "OLD", True) for q in (False, True)]
        with mock.patch.object(edition, "PUBLIC", True):
            try:
                for zone in ("Europe/Berlin", "Asia/Kolkata"):
                    now = T0[zone]
                    ps = [{**x, "partner_at": now - 3600 if x["partner_at"] == "T" else now - R - 86400 if x["partner_at"] == "OLD"
                           else x["partner_at"]} for x in partners]
                    kit, cases = self.time_cases(zone, partners=ps)
                    self.assertTrue(kit["edition"]["public"])
                    outs = [c["out"] for c in cases["prompt"]]
                    self.assertTrue(all(edition.HALAL in o for o in outs))
                    self.assertTrue(any(edition.COMPANION in o for o in outs) and any("single" in o for o in outs))
                    self.assertTrue(any("months ago" in o for o in outs) and any("asked you not to" in o for o in outs))
                    cases["romance"] = [{"partner": self.ref_edition({"has_partner": h, "partner_at": a, "partner_noask": q}, t)["partner"],
                                         "t": t, "out": edition.romance(h, a, t, bool(q))}
                                        for h in ("yes", "no", "", None, "x") for q in (False, True, 0, 1)
                                        for t in (now, now + 5 * 86400)
                                        for a in (None, now, now - R, now - R - 1, now - R + 1, now - R - 0.5, 0, True, False, "x", t - R)]
                    cases["ptag"] = [{"in": t, "out": edition.PARTNER_TAG.findall(t)} for t in (
                        "[partner: yes] oh!", "[partner:no]", "[Partner:  NOASK ] ok", "[partner: maybe]", "[partner : yes]",
                        "x [partner: no] y [partner: yes]", "[partner:\tyes\u3000]", "[partner:yes ]]", "[partner: Yes] [react: 😂]",
                        "no tag", "[partner: noaskx]", "[partner:\u2028no]")]
                    self.node(kit, cases, tz="UTC")
            finally:
                set_tz(self.tz0)
                for k in ("has_partner", "partner_at", "partner_noask"): self.cfg.pop(k, None)

    def test_time_fallback_to_the_phones_zone(self):
        try:
            kit, cases = self.time_cases("America/New_York", kit_tz="")
            self.node(kit, cases, tz="America/New_York")
        finally:
            set_tz(self.tz0)

    # ---------- stream splitting: the real Handler._chat against a fake model, the JS Splitter on the same bytes ----------
    def test_stream_splitting(self):
        set_tz("Europe/Berlin")
        self.clock.now = T0["Europe/Berlin"]
        self.lives_for(self.clock.now)
        kit = self.ref_kit(self.clock.now)
        model = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{model.server_address[1]}/v1"
        buddy = ThreadingHTTPServer(("127.0.0.1", 0), bs.Handler)
        threading.Thread(target=buddy.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (model.shutdown(), model.server_close(), buddy.shutdown(), buddy.server_close()))
        devices.ensure()
        cookie = "buddy=" + devices.mac_token()
        rnd = random.Random(5)
        cases = []
        with mock.patch.object(bs, "brain", lambda mode, spoken=False, free_ok=False: (url, "fake", "fake-model", "companion" if mode == "companion" else "advisor")):
            for i, deltas in enumerate(REPLIES):
                for via in ("phone", "call"):
                    for text in (USER_TEXTS if i % 3 == 0 else USER_TEXTS[:1] + USER_TEXTS[3:]):
                        pieces = sse(deltas)
                        SCRIPT["pieces"] = pieces
                        if os.path.exists(social.THREAD): os.remove(social.THREAD)
                        body = json.dumps({"text": text, "char": "mara", "private": False, "via": via}).encode()
                        req = urllib.request.Request(f"http://127.0.0.1:{buddy.server_address[1]}/api/chat", data=body, method="POST",
                                                     headers={"Content-Type": "application/json", "Cookie": cookie})
                        with urllib.request.urlopen(req, timeout=30) as r:
                            got = [json.loads(l) for l in r.read().decode().splitlines() if l.strip()]
                        self.assertFalse([g for g in got if "error" in g], got)
                        lines = [{k: g[k] for k in ("s", "p") if k in g} if "s" in g else {"react": g["react"]} for g in got if "s" in g or "react" in g]
                        t = social._load(social.THREAD, [])
                        a = [m for m in t if m["role"] == "assistant" and not m.get("photo_failed")]
                        whole = "".join(pieces); cuts = sorted(rnd.sample(range(1, len(whole)), min(len(whole) - 1, 9)))
                        chunks = [whole[a_:b_] for a_, b_ in zip([0] + cuts, cuts + [len(whole)])]
                        cases.append({"chunks": chunks, "via": via, "text": text, "asking": facts.is_knows_question(text),
                                      "lines": lines, "content": a[-1]["content"] if a else None})
        self.assertGreaterEqual(len(cases), 24)
        self.assertTrue(any(c["lines"] and "react" in c["lines"][-1] for c in cases))
        self.assertTrue(any(any(l.get("p") for l in c["lines"]) for c in cases))
        self.node(kit, {"split": cases})

    # ---------- whole requests: the real Handler._chat and the phone's own chat() (direct.js), turn by turn ----------
    # Same thread, same kit and context (bs.phonekit before the first turn), same times: the phone works out everything
    # itself (its thread, the time since you last talked, call edits, the photo, model and switches, your relationship
    # status in the public edition), so every request body it sends Tinfoil must equal the Mac's (SPEC2 §15.3).
    def chat_parity(self, steps, reply=None):
        """The turns through the Mac's real Handler._chat and the phone's chat() -> (turns, mac, phone). A turn may
        bring its own "reply" (what the model says that time)."""
        set_tz("Europe/Berlin")
        now = T0["Europe/Berlin"]; self.clock.now = now
        self.lives_for(now)
        with REAL_OPEN(os.path.join(self.T, "repo", ".tinfoil_key"), "w") as f: f.write("sk-FAKE-parity")
        ids = sorted(set(bs.ADVISOR_MODELS + bs.COMPANION_MODELS + bs.VISION_ORDER + [bs.STT]))
        models = [{"id": m, **({"multimodal": m in bs.VISION_ORDER, "type": "chat"} if m != bs.STT else {})} for m in ids]
        bs._models.update(at=now, ttl=10 ** 9, ids=ids, meta={m["id"]: {k: m[k] for k in ("multimodal", "type") if k in m} for m in models})
        reply = reply or ["Sure! ", "That sounds lovely.\n\nTell me more?"]
        look, sent, cur = "A red square on white.", [], {"reply": reply}
        class Model(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_POST(self):
                sent.append(json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0))))
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                self.wfile.write("".join(sse(cur["reply"])).encode())
        model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        threading.Thread(target=model.serve_forever, daemon=True).start()
        buddy = ThreadingHTTPServer(("127.0.0.1", 0), bs.Handler)
        threading.Thread(target=buddy.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (model.shutdown(), model.server_close(), buddy.shutdown(), buddy.server_close()))
        devices.ensure()
        cookie, base = "buddy=" + devices.mac_token(), f"http://127.0.0.1:{buddy.server_address[1]}"
        def http(path, body, ctype="application/json"):
            req = urllib.request.Request(base + path, data=body if isinstance(body, bytes) else json.dumps(body).encode(),
                                         method="POST", headers={"Content-Type": ctype, "Cookie": cookie})
            with urllib.request.urlopen(req, timeout=30) as r: return r.read().decode()
        th = [m for m in fake_thread(random.Random(7), ["buddy", "mara"], 40, now - 900)
              if not m.get("private") and not m.get("pending_photo")]
        with REAL_OPEN(social.THREAD, "w") as f: json.dump(th, f)
        kit = json.loads(json.dumps(bs.phonekit(now=now)))
        photo = jpeg(1200, 900, seg(0xE1, b"Exif\x00\x00FakeGPS"))
        turns, t = [], now
        for gap, s in steps:
            t += gap; turns.append({**s, "t": t})
        mac = []
        def save_cfg(**kw): self.cfg.update(kw)       # (the fake world's settings: never config.local.json)
        with mock.patch.object(bs, "tinfoil", lambda: f"http://127.0.0.1:{model.server_address[1]}/v1"), \
                mock.patch.object(bs, "describe", lambda view: (look, "gemma4-31b")), \
                mock.patch.object(bs, "save_cfg", save_cfg), mock.patch.object(social, "time", self.clock.time_module()):
            for turn in turns:
                self.clock.now = turn["t"]; cur["reply"] = turn.get("reply") or reply
                if turn["kind"] == "newchat":
                    http("/api/newchat", {"char": turn["char"]}); mac.append(None); continue
                body, n = dict(turn["body"]), len(sent)
                if turn.get("photo"):
                    pid = json.loads(http("/api/photo?part=full", photo, "image/jpeg"))["photo"]
                    http(f"/api/photo?part=view&photo={pid}", photo, "image/jpeg")
                    body["photo"] = pid
                lines = [json.loads(l) for l in http("/api/chat", body).splitlines() if l.strip()]
                self.assertFalse([x for x in lines if "error" in x], lines)
                if turn.get("photo"):                     # (its look ends before the next turn, as on the phone)
                    end = time.time() + 5
                    while time.time() < end and not any(m.get("photo_desc") == look for m in social._load(social.THREAD, [])):
                        time.sleep(0.02)
                mac.append({"lines": lines, "request": [b for b in sent[n:] if b.get("stream")][-1]})
        r = subprocess.run([NODE, os.path.join(ROOT, "tests", "phonemode", "parity_chat.mjs")], capture_output=True, text=True, timeout=300,
                           input=json.dumps({"phonekit": kit, "models": models, "look": look, "reply": reply, "turns": turns}),
                           env={**os.environ, "TZ": "UTC"})
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        phone = json.loads(r.stdout)["turns"]
        self.assertEqual(len(phone), len(mac))
        for i, (m, p) in enumerate(zip(mac, phone)):
            if m is None: continue
            self.assertEqual(p["request"], m["request"], f"turn {i} ({turns[i]['body']['text']!r}): the phone's request differs (fake data only)")
            self.assertEqual(p["lines"], m["lines"], f"turn {i}: what the page got")
        return turns, mac, phone

    def test_chat_requests_match(self):
        chat = lambda char, text, reply=None, **kw: {"kind": "chat", "body": {"text": text, "char": char, "private": False, "via": "phone",
                                                                                **kw}, **({"reply": reply} if reply else {})}
        photo = base64.b64encode(jpeg(1200, 900, seg(0xE1, b"Exif\x00\x00FakeGPS"))).decode()
        steps = [(0, chat("buddy", "hey how was your day")),
                 (4 * 3600, chat("buddy", "I went climbing")),             # (4 hours later: they know)
                 (60, chat("mara", "what do you know about me?")),
                 (60, chat("buddy", "tell me more about Lisbon", via="call", opened="Hey!", heard="Sure! That sounds")),
                 (60, {**chat("buddy", "what's this?"), "photo": photo}),
                 (60, chat("buddy", "and now?")),                         # (what was in it, as words)
                 (60, {"kind": "newchat", "char": "buddy"}),
                 (60, chat("buddy", "fresh start")),
                 (60, chat("mara", "typing to mara")),                    # (deepseek: thinking switched off, typed too)
                 (2 * 86400 + 3600, chat("mara", "hello again")),
                 (60, chat("mara", "can you explain how compound interest works")),   # 10: a deep ask: may think first
                 (60, chat("mara", "why not")),                           # 11: casual: off again
                 (60, chat("mara", "can you explain how compound interest works", via="call")),   # 12: never in a call
                 (60, chat("buddy", "send me a pic of you", reply=["haha ok *sends a mirr", "or selfie* there you go. (image: me at ",
                                                                   "the gym)\n📸 me on my balcony at sunset\n\naw :[ ok"])),   # 13
                 (60, chat("buddy", "and another?", reply=["sure! ![me in my new jacket](selfie.jpg) ", "omg yes (the photo of your ",
                                                           "dog killed me). [photo: me at the beach. it was windy"])),             # 14
                 (60, chat("buddy", "and now?"))]                         # 15: what they said, without the photos
        turns, mac, phone = self.chat_parity(steps)
        sys_of = lambda i: mac[i]["request"]["messages"][0]["content"]
        self.assertIn("Our last message before this was 4 hours ago.", sys_of(1))   # (the cases that matter are there)
        self.assertNotIn("Our last message before this was", sys_of(5))
        self.assertIn("Our last message before this was 2 days ago.", sys_of(9))
        self.assertEqual(mac[3]["request"].get("max_tokens"), 300)
        self.assertIn("image_url", json.dumps(mac[4]["request"]))
        self.assertIn("A red square on white.", json.dumps(mac[5]["request"]))
        self.assertEqual(mac[8]["request"]["model"], "deepseek-v4-1-flash")
        self.assertEqual(mac[8]["request"].get("reasoning_effort"), "none")   # (thinking off in a typed turn)
        self.assertNotIn("max_tokens", mac[8]["request"])
        self.assertNotIn(edition.HALAL, sys_of(0))                            # (the private edition: no extra rules)
        for i in (0, 3, 9, 13):                                               # (phone mode never has a picture maker)
            self.assertIn(bs.NO_PHOTOS, sys_of(i)); self.assertNotIn(bs.PHOTOS, sys_of(i))
        self.assertEqual(mac[10]["request"]["model"], "deepseek-v4-1-flash")
        self.assertFalse({"reasoning_effort", "chat_template_kwargs"} & set(mac[10]["request"]))   # (a deep ask may think)
        self.assertEqual(mac[11]["request"].get("reasoning_effort"), "none")
        self.assertEqual((mac[12]["request"].get("reasoning_effort"), mac[12]["request"].get("max_tokens")), ("none", 300))
        shown = lambda i: [l["s"] for l in mac[i]["lines"] if "s" in l]
        self.assertEqual(shown(13), ["haha ok there you go.", "aw :[ ok"])
        self.assertEqual(shown(14), ["sure!", "omg yes (the photo of your dog killed me)."])
        self.assertFalse([l for t in mac[13:15] for l in t["lines"] if "photo" in l or "job" in l])   # (no picture is made)
        hist = json.dumps(mac[15]["request"]["messages"][1:], ensure_ascii=False)
        self.assertIn("haha ok there you go.\\n\\naw :[ ok", hist)
        self.assertNotIn("selfie", hist); self.assertNotIn("balcony", hist); self.assertNotIn("windy", hist)

    def test_chat_public_edition(self):
        """The public copy: HALAL and the romance rule in each prompt, and [partner: …] in a reply changing your status
        for the next turn on the phone just as on the Mac (from a private chat only "yes" and "noask")."""
        chat = lambda char, text, reply=None, **kw: {"kind": "chat", "body": {"text": text, "char": char, "private": False,
                                                                                "via": "phone", **kw}, **({"reply": reply} if reply else {})}
        steps = [(0, chat("buddy", "hey")),                                    # 0: not known yet: they'd ask first
                 (60, chat("buddy", "I'm single btw", reply=["[partner: no] Oh nice, ", "good to know."])),
                 (60, chat("buddy", "so what now?")),                          # 2: single
                 (60, chat("mara", "please stop asking if I'm married", reply=["[Partner: NOASK] Okay, ", "I won't ask again."])),
                 (60, chat("mara", "hi again")),                               # 4: and don't keep asking
                 (60, chat("buddy", "I got married", private=True, reply=["[partner: yes] Congrats!"])),
                 (60, chat("buddy", "hello")),                                 # 6: married (from a private chat: stricter)
                 (60, chat("buddy", "we split up", private=True, reply=["[partner: no] Oh no."])),
                 (60, chat("buddy", "how are you")),                           # 8: still married (a private "no" doesn't count)
                 (60, chat("mara", "call me", via="call", reply=["[partner: no] Oh, okay."])),
                 (60, chat("mara", "back to texting"))]                        # 10: single again (said in a call)
        with mock.patch.object(edition, "PUBLIC", True):
            turns, mac, phone = self.chat_parity(steps)
        sys_of = lambda i: mac[i]["request"]["messages"][0]["content"]
        for i in (0, 2, 4, 6, 8, 10):
            self.assertIn(edition.HALAL, sys_of(i))
        self.assertIn("You don't know yet if I'm married", sys_of(0))
        self.assertIn("I'm single", sys_of(2)); self.assertIn("Once in a blue moon", sys_of(2))
        self.assertIn("I asked you not to keep asking", sys_of(4))
        self.assertIn("I'm married or in a relationship:", sys_of(6))
        self.assertIn("I'm married or in a relationship:", sys_of(8))
        self.assertIn("I'm single", sys_of(10))
        self.assertIn(edition.COMPANION, sys_of(4))                          # (Mara is a Companion)
        self.assertFalse(any("partner" in json.dumps(m["lines"]).lower() for m in mac if m))   # (the tag is never shown)
        self.assertEqual((self.cfg.get("has_partner"), self.cfg.get("partner_noask")), ("no", True))

    # ---------- the kit itself ----------
    def test_kit_matches_the_mac(self):
        set_tz("Europe/Berlin")
        now = T0["Europe/Berlin"]; self.clock.now = now
        self.lives_for(now)
        kit = self.ref_kit(now)
        text = json.dumps(kit)
        for secret in ("red coat", "phala/", "Health", "appearance", "knowledge", "texts_first"):
            self.assertNotIn(secret, text, f"the kit holds something it mustn't ({secret!r})")
        mara = next(c for c in kit["chars"] if c["id"] == "mara")
        for secret in ("sarah", "salsa"):             # (Mara doesn't know about them: not in her facts, nor her friends' days)
            self.assertNotIn(secret, json.dumps(mara, ensure_ascii=False).lower())
        self.assertTrue(mara["life"]["friends"] and mara["facts"]["own"] and mara["facts"]["shared"])
        self.assertIn("Kiln Journal", json.dumps(mara["knows_ask"]))
        self.assertNotIn("Kiln Journal", json.dumps({k: v for k, v in mara.items() if k != "knows_ask"}))
        self.assertEqual(next(c for c in kit["chars"] if c["id"] == "zed")["facts"]["shared"], [])
        self.assertIn("salsa", json.dumps(next(c for c in kit["chars"] if c["id"] == "buddy")["life"]))   # (Buddy's own day keeps it)
        real = json.loads(json.dumps(bs.phonekit(now=now)["kit"]))   # (the spec and the Mac agree)
        ref = json.loads(json.dumps(kit))
        diff = sorted(k for k in set(real) | set(ref) if real.get(k) != ref.get(k))
        self.assertEqual(diff, [], "phonekit() differs from SPEC2 §3.2 in these keys (fake data only)")
        self.assertNotIn("@cf/", text)                  # (never the free brain's models: phone mode is Tinfoil only)
        self.assertEqual((kit["v"], kit["edition"], kit["billing"]["out"]), (3, {"public": False}, billing.OUT))
        self.assertEqual(kit["prompts"]["no_photos"], bs.NO_PHOTOS)   # (phone mode never has a picture maker)
        with mock.patch.object(edition, "PUBLIC", True):  # the public copy: its rules and your relationship status
            self.cfg.update(has_partner="no", partner_at=now - 10, partner_noask=True)
            real = json.loads(json.dumps(bs.phonekit(now=now)["kit"]))
            ref = json.loads(json.dumps(self.ref_kit(now)))
            self.assertEqual(sorted(k for k in set(real) | set(ref) if real.get(k) != ref.get(k)), [])
            self.assertEqual(real["edition"]["partner"], {"has": "no", "at": now - 10, "noask": True})
            self.assertEqual(real["edition"]["halal"], edition.HALAL)
            self.assertEqual(len(set(real["edition"]["romance"].values())), 6)   # (six different rules)
            later = json.loads(json.dumps(bs.phonekit(now=now + 400 * 86400)["kit"]))
            self.assertEqual(later["edition"], real["edition"])                # (the same kit whatever the time)
            for k in ("has_partner", "partner_at", "partner_noask"): self.cfg.pop(k)

if __name__ == "__main__":
    unittest.main()
