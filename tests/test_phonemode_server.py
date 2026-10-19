"""Phone mode on the Mac's side (buddy_server.py, social.py, characters.py, lives.py): the kit a phone gets, the messages
it brings back, and what changed around them (headers, static files, times). Fake data only, in a fake world: every
path that could reach real notes, characters, settings, the thread or keys points into a temp folder, and a guard fails
the test the moment one of the real private files is opened (it names the path, never what's in it). Also runs on 3.9:
    python3 -B -m unittest discover -s tests -v
    /root/.local/bin/python3.9 -B -m unittest tests.test_phonemode_server"""
import base64, builtins, copy, datetime, fnmatch, http.client, io, json, os, pwd, socket, struct, sys, tempfile
import threading, time, types, unittest
from http.server import ThreadingHTTPServer
from unittest import mock
try: import resource
except ImportError: resource = None

ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
import backup, billing, characters, devices, edition, facts, images, lives, localcheck, social
import buddy_server as server

# ---------- the guard: the owner's real private files are never opened by these tests ----------
HOMES = {os.path.realpath(os.path.expanduser("~")), os.path.realpath(pwd.getpwuid(os.getuid()).pw_dir)}
NEVER_DIRS = [os.path.join(ROOT, "my-characters")] + [os.path.join(h, "Buddy") for h in HOMES]
NEVER_FILES = {os.path.join(ROOT, f) for f in (
    "config.local.json", ".thread.json", ".facts_state.json", ".gens.json", ".tinfoil_key", ".phala_key", ".near_key",
    ".memory_index.json", ".push_subs.json", ".vapid.json", ".devices.json", ".mac_token", ".backup_key",
    ".backup_state.json")}

class PrivateFileOpened(BaseException):
    """A test reached one of the owner's real private files (a BaseException: no `except Exception` can hide it)."""

def private_path(path):
    if isinstance(path, int):
        return None
    try: p = os.path.realpath(os.fsdecode(os.fspath(path)))
    except (TypeError, ValueError): return None
    if p in NEVER_FILES or any(p == d or p.startswith(d + os.sep) for d in NEVER_DIRS):
        return p
    if p.startswith(ROOT + os.sep) and fnmatch.fnmatch(os.path.basename(p), "*.local.*"):
        return p
    return None

# ---------- fake data ----------
REPO = {"persona.txt": "You are Buddy, a made-up test friend who likes trains.",
        "mode_advisor.txt": "ADVISOR MODE TEXT (fake, for tests).", "mode_companion.txt": "COMPANION MODE TEXT (fake)."}
CHARS = {
    "mara": {"name": "Mara", "tagline": "Ceramics and late talks", "persona": "You are Mara, 31, a ceramicist in Porto.",
             "appearance": "tall woman with a red coat", "style": "painting", "voice": "Serena", "brain": "companion",
             "knowledge": {"scope": "some", "folders": ["Work"], "avoid": "Sarah, salsa"}, "texts_first": True,
             "texts_per_day": 2, "life_seed": "Lives above her studio.", "color": "#5b8def", "created": 1},
    "leo": {"name": "Leo", "tagline": "Your running buddy", "persona": "", "voice": "casual_male", "brain": "advisor",
            "knowledge": {"scope": "none", "folders": [], "avoid": ""}, "color": "#3fa37a", "created": 2}}
FACTS = {"mara.md": "# What Mara knows about you\n\n- I go to salsa with Sarah on Fridays. (learned 2026-10-01)\n"
                    "- I live near the river. (added 2026-10-02)\n",
         "_everyone.md": "# Everyone\n\n- I like strong coffee. (added 2026-09-30)\n"}
WEB = {"chat.html": "<!doctype html><title>Buddy</title>", "sw.js": "// fake sw", "manifest.json": "{}",
       "pcm-tap.js": "// fake worklet", "direct.js": "// fake direct.js", "vendor/tinfoil.mjs": "export const x = 1;",
       "default-icons/icon-180.png": "png", "default-icons/icon-192.png": "png", "default-icons/icon-512.png": "png"}

def write(p, text):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: f.write(text)

seg = lambda m, body: b"\xff" + bytes([m]) + struct.pack(">H", len(body) + 2) + body
SOS = seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00")
def jpeg(w, h, extra=b""):
    """A structurally valid JPEG (markers only, no real pixels), as in test_pictures.py."""
    return (b"\xff\xd8" + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00") + extra
            + seg(0xC0, b"\x08" + struct.pack(">HH", h, w) + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00")
            + SOS + b"\x12\x34\xff\x00\x56" * 30 + b"\xff\xd0" + b"\x78" * 20 + b"\xff\xd9")
EXIF = seg(0xE1, b"Exif\x00\x00FakeGPS 52.5N\x00\x00")
WAV = (b"RIFF" + (36 + 4800).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00\x01\x00"
       + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little") + b"\x02\x00\x10\x00data" + (4800).to_bytes(4, "little")
       + b"\0" * 4800)                                # 0.1 s
b64 = lambda b: base64.b64encode(b).decode()
def new_cid():
    return base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()

def fake_log(cid, today, friend=False):
    """16 days (some without a summary), events after midnight, sent and pending moments; a friend's mentions salsa."""
    days = []
    for k in range(-13, 3):
        ev = [{"id": "e1", "at": "08:10", "what": f"coffee at the corner place ({k})", "plan": "coffee first",
               "mood": "sleepy", "kind": "mundane"},
              {"id": "e2", "at": "13:00", "what": "lunch with Lena", "plan": "", "mood": "", "kind": "social"},
              {"id": "e3", "at": "19:30", "what": "climbing session", "plan": "climbing after work", "mood": "proud",
               "kind": "hobby"},
              {"id": "e4", "at": "23:50", "what": "late film at the old cinema", "plan": "a late film", "mood": "",
               "kind": "rest"},
              {"id": "e5", "at": "00:40", "what": "night walk by the river", "plan": "", "mood": "calm", "kind": "rest"},
              {"id": "e6", "at": "02:15", "what": "finally asleep", "plan": "", "mood": "", "kind": "rest"}]
        if friend and k % 3 == 0:
            ev[2] = {"id": "e3", "at": "19:30", "what": "salsa class downtown", "plan": "dancing tonight", "mood": "",
                     "kind": "hobby"}
        if friend and k % 5 == 0:
            ev[0]["plan"] = "salsa practice first"
        summary = "" if k % 4 == 1 else ("Salsa all evening." if friend and k % 2 == 0 else f"A steady day number {k + 20}.")
        days.append({"date": (today + datetime.timedelta(days=k)).isoformat(), "to": "Braga" if k % 6 == 0 else "",
                     "summary": summary, "events": ev,
                     "moments": [{"id": "m1", "event": "e2", "at": "13:10", "due": 1.0, "angle": "share", "state": "sent"},
                                 {"id": "m2", "event": "e3", "at": "19:40", "due": 2.0, "angle": "vent", "state": "pending"}]})
    return lives.clean({"about": [f"Fact number {i} about my own life." for i in range(14)],
                        "people": [{"name": "Lena", "who": "my sister, a nurse"}, {"name": "Rui", "who": "a colleague"}],
                        "ongoing": [{"what": "training for a 10k", "since": ""},
                                    {"what": "learning salsa" if friend else "fixing the bike", "since": ""},
                                    {"what": "fixing the kitchen tap", "since": ""}, {"what": "reading Proust", "since": ""}],
                        "days": days, "weeks": [{"from": "", "to": "", "summary": f"Week {i} was busy."} for i in range(3)]},
                       cid)

class FakeWorld(unittest.TestCase):
    """Every private path in a temp folder (spec §5.6), a paired phone and the Mac, the guard on open()."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        T = self.T = os.path.realpath(self.tmp.name)
        self.repo, self.vault, mine = os.path.join(T, "repo"), os.path.join(T, "Buddy"), os.path.join(T, "my-characters")
        for name, text in REPO.items(): write(os.path.join(self.repo, name), text)
        self.cfg, self.kicks, self.looked = {}, [], []
        self.web = os.path.join(T, "web")
        for name, text in WEB.items(): write(os.path.join(self.web, name), text)
        def fake_read(name, default=""):                 # your own copy first, like read() and characters._read()
            stem, ext = os.path.splitext(name)
            for p in (os.path.join(self.repo, stem + ".local" + ext), os.path.join(self.repo, name)):
                if os.path.exists(p):
                    with open(p) as f: return f.read().strip()
            return default
        def describe(view):
            self.looked.append(len(view)); return "", None
        for obj, name, value in [
                (characters, "MINE", mine), (characters, "_read", fake_read),
                (lives, "LIVES", os.path.join(mine, "lives")), (lives, "WORLD", os.path.join(mine, "lives", "_world.json")),
                (server, "read", fake_read), (server, "local_cfg", lambda: dict(self.cfg)),
                (facts, "VAULT", self.vault), (facts, "DIR", os.path.join(self.vault, "Buddy knows")),
                (facts, "STATE", os.path.join(T, ".facts_state.json")), (facts, "_cache", {}),
                (facts, "kick", lambda cid, urgent=False: self.kicks.append(cid)),
                (social, "THREAD", os.path.join(T, ".thread.json")), (social, "GENS", os.path.join(T, ".gens.json")),
                (social, "SUBS", os.path.join(T, ".push_subs.json")), (social, "VAPID", os.path.join(T, ".vapid.json")),
                (social, "_gen", {}), (social, "_private", []), (social, "_marks", []), (social, "_hw", 0),
                (social, "push", lambda *a, **k: 0),
                (images, "MEDIA", os.path.join(T, ".media")), (images, "_mem", {}),
                (images, "find", lambda c, refresh=False: None),
                (server, "CHATS", os.path.join(self.vault, "chats")), (server, "VAULT", self.vault),
                (server, "WEB", self.web), (server, "plan_soon", lambda *a, **k: None),
                (server, "recall", lambda *a, **k: []), (server, "describe", describe),
                (server, "_models", {"at": 0, "ttl": 0, "ids": [], "meta": {}}),
                (devices, "FILE", os.path.join(T, ".devices.json")), (devices, "MAC_TOKEN", os.path.join(T, ".mac_token")),
                (backup, "restored_at", lambda: 0), (localcheck, "check", lambda url: None),
                (edition, "PUBLIC", False)]:   # (each test says which edition it checks: the same in the public copy)
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)
        for cid, c in CHARS.items(): write(os.path.join(mine, cid + ".json"), json.dumps(c))
        for f, text in FACTS.items(): write(os.path.join(self.vault, "Buddy knows", f), text)
        self.now = time.time(); today = lives.life_date(self.now)
        for cid in ("buddy", "mara"): lives.save(cid, fake_log(cid, today))
        lives.save("leo", fake_log("leo", today, friend=True))
        lives.set_tie("mara", "leo", True, "old friends from uni")
        devices.ensure()
        self.mac = devices.mac_token()
        code, _ = devices.start_pairing()
        self.phone, self.phone_dev = devices.pair(code, "Test phone")
        self.before = set(threading.enumerate())
        self.violations = []
        def wrap(real):
            def guarded(file, *a, **k):
                bad = None if k.get("dir_fd") is not None else private_path(file)
                if bad:
                    self.violations.append(bad)
                    raise PrivateFileOpened("a test opened a real private file: " + bad)
                return real(file, *a, **k)
            return guarded
        for obj, name in ((builtins, "open"), (io, "open"), (os, "open")):
            p = mock.patch.object(obj, name, wrap(getattr(obj, name))); p.start(); self.addCleanup(p.stop)
        self.addCleanup(self.drain)                       # (runs first: the guard and the patches are still on)
        self.srv = None

    def drain(self):
        if self.srv:
            self.srv.shutdown(); self.srv.server_close()
        for t in set(threading.enumerate()) - self.before:   # (background looks and saved chats finish in the fake world)
            t.join(15)
        if self.violations:
            self.fail("real private files were opened: " + ", ".join(sorted(set(self.violations))))

    def serve(self):
        if not self.srv:
            self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return self.srv.server_address[1]

    def http(self, method, path, body=None, cookie=None, headers=None):
        port = self.serve()
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        h = {"Host": f"127.0.0.1:{port}"}
        if cookie: h["Cookie"] = f"buddy={cookie}"
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode(); h["Content-Type"] = "application/json"
        h.update(headers or {})
        c.request(method, path, body=body, headers=h)
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, r.headers, json.loads(data) if r.headers.get("Content-Type") == "application/json" else data

    def kit(self, have="", cookie=None):
        return self.http("GET", "/api/phonekit" + (f"?have={have}" if have else ""), cookie=cookie or self.phone)

    def imp(self, items, cookie=None):
        return self.http("POST", "/api/thread/import", {"messages": items}, cookie=cookie or self.phone)

    def item(self, role="user", **kw):
        it = {"cid": new_cid(), "role": role, "char": "mara", "content": "" if role in ("break", "reaction") else "hey",
              "ts": self.now - 600, "epoch": 0}
        it.update(kw)
        return it

    def media(self):
        d = images.MEDIA
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def wait(self, cond, secs=3):
        end = time.time() + secs
        while time.time() < end:
            if cond(): return True
            time.sleep(0.02)
        return cond()

KIT_KEYS = {"v", "name", "tz", "see_photos", "companion_on_phala", "chars", "voices", "voice", "prompts", "facts_paths",
            "models", "tinfoil", "stt", "call", "texting", "edition", "billing"}
CHAR_KEYS = {"id", "name", "tagline", "color", "avatar", "wallpaper", "builtin", "brain", "voice", "persona", "facts",
             "knows_ask", "life"}

class Kit(FakeWorld):                                 # 1, 2
    def test_shape_and_who_may_have_it(self):
        st, h, r = self.kit()
        self.assertEqual(st, 200)
        self.assertEqual(set(r), {"v", "etag", "kit", "generated_at", "context"})
        k = r["kit"]
        self.assertEqual(set(k), KIT_KEYS); self.assertEqual((r["v"], k["v"]), (1, 3))
        self.assertRegex(r["etag"], r"^[0-9a-f]{32}$"); self.assertIsInstance(r["generated_at"], float)
        self.assertEqual([c["id"] for c in k["chars"]], ["buddy", "mara", "leo"])
        for c in k["chars"]:
            self.assertEqual(set(c), CHAR_KEYS)
            self.assertEqual(set(c["knows_ask"]), {"phone", "call"})
            self.assertEqual(set(c["knows_ask"]["call"]), {"have", "none"})
            self.assertEqual(set(c["facts"]), {"own", "shared"})
        mara = k["chars"][1]
        self.assertEqual((mara["voice"], mara["brain"], mara["builtin"], mara["avatar"]), ("Serena", "companion", False, 0))
        self.assertEqual(mara["facts"], {"own": [{"text": "I live near the river.", "date": "2026-10-02"}],
                                         "shared": [{"text": "I like strong coffee.", "date": "2026-09-30"}]})
        self.assertEqual(k["chars"][2]["facts"]["shared"], [])          # (Leo knows only your chats)
        self.assertEqual([f["name"] for f in mara["life"]["friends"]], ["Leo"])
        self.assertEqual(mara["life"]["friends"][0]["id"], "leo")
        self.assertEqual(k["prompts"]["modes"], {"advisor": REPO["mode_advisor.txt"], "companion": REPO["mode_companion.txt"]})
        self.assertEqual(k["prompts"]["styles"], {"phone": server.style_text("phone"), "call": server.CALLING})
        self.assertEqual(k["prompts"]["length"], server.LENGTH_HINTS)
        self.assertEqual(k["prompts"]["no_photos"], server.NO_PHOTOS)      # (phone mode never has a picture maker)
        self.assertEqual(k["texting"], {"caps": {"tiny": [2, 30], "short": [3, 50], "medium": [4, 80]}})
        self.assertEqual(k["facts_paths"], {"shared": "Buddy knows/_everyone", "own_prefix": "Buddy knows/"})
        self.assertEqual(k["models"]["advisor"], {"preferred": "gemma4-31b", "fallbacks": server.ADVISOR_MODELS})
        self.assertEqual(k["voice"]["ids"], [v for v, _ in characters.VOICES])
        self.assertIs(k["companion_on_phala"], False); self.assertIs(k["see_photos"], True)
        self.assertTrue(k["tz"] == "" or server.TZ_RE.fullmatch(k["tz"]))
        with mock.patch.dict(os.environ, {"TZ": ":Europe/Berlin"}):
            self.assertEqual(server.phonekit()["kit"]["tz"], "Europe/Berlin")
        with mock.patch.dict(os.environ, {"TZ": "../../etc/x y"}):
            self.assertEqual(server.phonekit()["kit"]["tz"], "")
        self.assertEqual(set(r["context"]), {"upto", "chars"}); self.assertEqual(set(r["context"]["chars"]), {"buddy", "mara", "leo"})
        self.assertEqual(r["context"]["chars"]["mara"], {"epoch": 0, "last_ts": 0, "last_role": "", "msgs": []})
        st, _, again = self.kit(have=r["etag"])                         # unchanged: no kit, the context still comes
        self.assertEqual((st, again["kit"], again["etag"]), (200, None, r["etag"]))
        self.assertIn("context", again)
        self.assertEqual(self.kit(cookie=self.mac)[:3:2], (403, {"error": "phone mode is for phones"}))
        st, _, r = self.http("GET", "/api/phonekit")
        self.assertEqual((st, r["error"]), (401, "pair"))
        self.cfg["phone_mode"] = False
        self.assertEqual(self.kit()[:3:2], (403, {"error": "phone mode is off on your Mac", "phone_mode": False}))
        self.cfg.update(phone_mode=True, name="Pal")
        st, _, r = self.kit(have=again["etag"])           # a change: a new etag, and the kit again
        self.assertNotEqual(r["etag"], again["etag"]); self.assertEqual(r["kit"]["name"], "Pal")

    def test_nothing_private_in_it(self):
        social.add("user", "PRIVATE-XYZ", private=True, via="phone", char="mara")
        social.add("user", "a normal message", private=False, via="phone", char="mara")
        social.add("assistant", "with notes", private=False, via="phone", char="mara", mode="companion",
                   sources=[{"kind": "note", "path": "Work/secret-plan", "n": 1}])
        self.cfg.update(companion_model="phala/secret-model", companion_provider="phala")
        st, _, r = self.kit()
        text = json.dumps(r)
        for bad in ("Sarah", "red coat", "phala/secret-model", "PRIVATE-XYZ", "secret-plan", "painting", "Lives above",
                    "knowledge", "appearance", "texts_first", "life_seed"):
            self.assertNotIn(bad, text, bad)
        self.assertNotIn("salsa", json.dumps(r["kit"]["chars"][1]).lower())   # Mara: not from Leo's days either
        k = copy.deepcopy(r["kit"])
        del k["chars"][2]["life"]["log"]                 # (Leo's own days: his to know, and nobody kept salsa from him)
        self.assertNotIn("salsa", json.dumps(k).lower())
        for c in k["chars"]: del c["knows_ask"]
        self.assertNotIn("Work", json.dumps(k))          # (the folder only where the model is told on the Mac too)
        self.assertIn("my notes in Work", r["kit"]["chars"][1]["knows_ask"]["phone"]["have"])
        self.assertIs(r["kit"]["companion_on_phala"], False)              # (no .phala_key here: Tinfoil after all)
        self.assertEqual([m["content"] for m in r["context"]["chars"]["mara"]["msgs"]], ["a normal message", "with notes"])

    def test_persona_and_knows_ask(self):
        st, _, r = self.kit()
        cs = characters.all_characters(server.cfg())
        for x, kc in zip(cs, r["kit"]["chars"]):
            sp = server.system_prompt(x, "advisor", "hi", None, via="phone")
            self.assertTrue(sp.startswith(kc["persona"] + f"\n\nYour name is {x['name']}. You are an adult.\n\n"), x["id"])
            for via, spoken in (("phone", False), ("call", True)):
                for have in (True, False):
                    self.assertEqual(kc["knows_ask"][via]["have" if have else "none"], server.knows_ask(x, have, spoken))
        personas = [c["persona"] for c in r["kit"]["chars"]]
        self.assertEqual(personas, [REPO["persona.txt"], CHARS["mara"]["persona"],
                                    "You are Leo, a friendly adult I can talk to. Your running buddy"])
        write(os.path.join(self.repo, "persona.local.txt"), "You are Buddy (your own local copy).")
        self.assertEqual(self.kit()[2]["kit"]["chars"][0]["persona"], "You are Buddy (your own local copy).")
        self.assertEqual(characters.persona_of(characters.get("buddy", server.cfg())), "You are Buddy (your own local copy).")

class LifeSlim(FakeWorld):                            # 3
    def test_slim_is_exact(self):
        today = lives.life_date(self.now)
        log, fl = fake_log("mara", today), fake_log("leo", today, friend=True)
        avoid = characters.avoid_terms(CHARS["mara"])
        self.assertEqual(avoid, ["sarah", "salsa"])
        s, fs = lives.slim(log, self.now), lives.slim(lives._without(fl, avoid), self.now, friend=True)
        self.assertLess(len(s["days"]), len(log["days"]))
        n, t = 0, self.now
        while t <= self.now + 3 * 86400:
            for short in (False, True):
                want = lives.context(log, t, short, friends=[("Leo", "old friends", fl)], avoid=avoid)
                got = lives.context(s, t, short, friends=[("Leo", "old friends", fs)])
                self.assertEqual(got, want, (t, short)); n += 1
            t += 47 * 60
        self.assertGreater(n, 180)
        self.assertEqual(lives.context(s, self.now, False), lives.context(log, self.now, False))

    def test_friend_copy_shape(self):
        today = lives.life_date(self.now)
        fs = lives.slim(lives._without(fake_log("leo", today, friend=True), ["salsa"]), self.now, friend=True)
        self.assertEqual((fs["about"], fs["people"], fs["weeks"]), ([], [], []))
        self.assertTrue(fs["ongoing"]); self.assertTrue(all(set(o) == {"what"} for o in fs["ongoing"]))
        self.assertTrue(fs["days"])
        for d in fs["days"]:
            self.assertEqual((d["to"], d["moments"]), ("", []))
            self.assertTrue(all(set(e) == {"at", "what"} for e in d["events"]))
        self.assertNotIn("salsa", json.dumps(fs).lower())
        past = [d for d in fs["days"] if d["date"] < (today - datetime.timedelta(days=1)).isoformat()]
        self.assertEqual(len(past), 1)                    # (only the newest older day with a summary)

def fake_thread(t0):
    """A conversation with breaks, private messages, photos, voice messages, reactions both ways (one taken back),
    messages from phone mode and texts first: (thread file, private messages)."""
    file, priv, nid = [], [], [5000]
    def add(role, content="", char="mara", private=False, **kw):
        nid[0] += 1
        m = {"id": nid[0], "role": role, "content": content, "ts": t0 + nid[0], **kw, "char": char}
        if role in ("user", "assistant"): m.update(private=private, via=kw.get("via", "phone"))
        elif private: m["private"] = True
        (priv if private else file).append(m)
        return nid[0]
    for i in range(6):
        add("user", f"old question {i}"); a = add("assistant", f"old answer {i}")
    add("reaction", target=a, emoji="😂", by="you")
    add("break")
    last_a = last_u = None
    for i in range(110):
        k = i % 10
        if i % 7 == 0: add("user", f"leo talk {i}", char="leo")
        if k == 0: last_u = add("user", "look", image="a" * 32, w=800, h=600, photo_desc="a dog on a beach", seen_by="gemma4-31b")
        elif k == 1: last_a = add("assistant", f"answer {i}", mode="companion", sources=[{"kind": "facts", "path": "x", "n": 1}])
        elif k == 2: last_u = add("user", "(spoken words)" if i % 20 else "", voice="b" * 32, dur=2.5)
        elif k == 3: last_a = add("assistant", f"a voice reply {i}", mode="companion", voice="c" * 32, dur=3.1)
        elif k == 4: add("reaction", target=last_a, emoji="😂", by="you")
        elif k == 5:
            add("user", f"secret {i}", private=True); pa = add("assistant", f"secret answer {i}", private=True)
            add("reaction", target=pa, emoji="❤️", by="you", private=True)
        elif k == 6: last_u = add("user", "", image="d" * 32, w=10, h=10, seen=False)
        elif k == 7: add("reaction", target=last_u, emoji="❤️", by="mara")
        elif k == 8:
            add("reaction", target=last_a, emoji="", by="you"); add("reaction", target=last_u, emoji="👍", by="you")
            add("assistant", "", photo_failed=True, why="the picture maker is off", job="j1")
        else:
            add("assistant", f"texted first {i}", proactive=True, delivered="phone")
            add("user", f"from phone mode {i}", cid=new_cid(), **{"from": "phone"}, direct=True)
    return file, priv

class Context(FakeWorld):                             # 4
    def test_enough_for_recent_messages(self):
        file, priv = fake_thread(self.now - 100000)
        social._save(social.THREAD, file); social._private.extend(priv)
        ctx = social.phone_context(["buddy", "mara", "leo"])
        self.assertEqual(ctx["upto"], max(m["id"] for m in file))
        brk = max(m["id"] for m in file if m["role"] == "break")
        self.assertGreater(sum(1 for m in file if m["id"] > brk and m["char"] == "mara" and m["role"] in ("user", "assistant")), 80)
        for c in ("mara", "leo", "buddy"):
            full = social.recent_messages(30, char=c)
            with mock.patch.object(social, "thread", lambda after=0, c=c: ctx["chars"][c]["msgs"]):
                self.assertEqual(social.recent_messages(30, char=c), full, c)
            self.assertEqual(ctx["chars"][c]["last_ts"], max((m["ts"] for m in file if m["char"] == c
                                                              and m["role"] in ("user", "assistant")), default=0))
        msgs = ctx["chars"]["mara"]["msgs"]
        self.assertTrue(msgs and len(msgs) < len(file))
        self.assertFalse(any("secret" in m["content"] or "sources" in m or "private" in m for m in msgs))
        self.assertTrue(any(m.get("cid") and m.get("direct") and m.get("from") == "phone" for m in msgs))
        self.assertTrue(any(m.get("proactive") and m.get("delivered") == "phone" for m in msgs))
        self.assertTrue(any(m["role"] == "reaction" and m["emoji"] == "" for m in msgs))     # (shown as taken back)
        self.assertTrue(all(set(m) <= set(social.PHONE_FIELDS) | {"char"} and m["char"] == "mara" for m in msgs))
        self.assertEqual([m["id"] for m in msgs], sorted(m["id"] for m in msgs))
        self.assertEqual(ctx["chars"]["buddy"], {"epoch": 0, "last_ts": 0, "last_role": "", "msgs": []})

    def test_one_locked_read(self):                   # a delete lands wholly before or wholly after, never between
        social.add("user", "before the delete", via="phone", char="mara", private=False)
        real, box = social._load, {}
        def slow(p, default):
            out = real(p, default)
            if p == social.THREAD and threading.current_thread() is threading.main_thread() and "t" not in box:
                box["t"] = threading.Thread(target=social.forget, args=("mara",)); box["t"].start()
                time.sleep(0.3)                           # (inside phone_context's lock: forget waits for it)
            return out
        with mock.patch.object(social, "_load", slow):
            ctx = social.phone_context(["mara"])
        box["t"].join(5)
        self.assertEqual((ctx["chars"]["mara"]["epoch"], len(ctx["chars"]["mara"]["msgs"])), (0, 1))
        self.assertEqual(social.phone_context(["mara"])["chars"]["mara"], {"epoch": 1, "last_ts": 0, "last_role": "", "msgs": []})
        social.add("user", "again", via="phone", char="mara", private=False)   # the other way round: forget first
        go = threading.Event()
        def slow2(p, default):
            out = real(p, default)
            if p == social.THREAD and threading.current_thread() is not threading.main_thread() and not go.is_set():
                go.set(); time.sleep(0.3)                 # (inside forget's lock: phone_context waits for it)
            return out
        with mock.patch.object(social, "_load", slow2):
            t = threading.Thread(target=social.forget, args=("mara",)); t.start()
            go.wait(5); ctx = social.phone_context(["mara"])
            t.join(5)
        self.assertEqual(ctx["chars"]["mara"], {"epoch": 2, "last_ts": 0, "last_role": "", "msgs": []})

class Import(FakeWorld):                              # 5
    def test_ids_order_retries_and_after(self):
        mac = social.add("assistant", "from the Mac", via="phone", char="mara", private=False, mode="companion")
        u, a = self.item(content="  one  "), self.item("assistant", content="Hi.\n\nHow are you?", mode="advisor")
        a["reply_to"] = u["cid"]
        items = [u, a, self.item("break"), self.item(content="three", call=True)]
        st, _, r = self.imp(items)
        self.assertEqual(st, 200); self.assertTrue(r["ok"])
        ids = [x["id"] for x in r["results"]]
        self.assertEqual([x["cid"] for x in r["results"]], [i["cid"] for i in items])
        self.assertEqual(ids, sorted(ids)); self.assertGreater(ids[0], mac["id"]); self.assertEqual(r["upto"], ids[-1])
        st, _, t = self.http("GET", f"/api/thread?after={mac['id']}", cookie=self.phone)
        self.assertEqual([m.get("cid") for m in t], [i["cid"] for i in items])
        self.assertEqual([m["content"] for m in t], ["one", "Hi.\n\nHow are you?", "", "three"])
        self.assertEqual(t[1]["mode"], "advisor"); self.assertEqual(t[3]["via"], "call")
        self.assertTrue(all(m["ts"] == self.now - 600 for m in t))
        before = social._load(social.THREAD, [])
        st, _, r2 = self.imp(items)                       # the answer got lost: the phone sends them again
        self.assertEqual(r2["results"], [{"cid": i["cid"], "id": n, "dup": True} for i, n in zip(items, ids)])
        self.assertEqual((r2["upto"], social._load(social.THREAD, [])), (0, before))
        self.assertEqual(self.kicks, ["mara"])           # (once per character, and not again for the retry)
        later = self.item(content="later")
        self.assertGreater(self.imp([later])[2]["results"][0]["id"], ids[-1])

    def test_deleted_conversations(self):
        social.forget("mara")
        st, _, r = self.imp([self.item(), self.item(epoch=1), self.item(char="leo")])
        self.assertEqual([x.get("dropped") for x in r["results"]], ["deleted", None, None])
        with open(social.GENS) as f: self.assertEqual(json.load(f), {"mara": 1})
        social._gen = social._load_gens()                 # (as after a restart)
        self.assertEqual(self.imp([self.item()])[2]["results"][0]["dropped"], "deleted")
        other = os.path.join(self.T, "elsewhere"); os.makedirs(other)
        with mock.patch.object(social, "THREAD", os.path.join(other, ".thread.json")):
            social.forget("leo")                          # (a thread kept elsewhere never changes these counts)
        with open(social.GENS) as f: self.assertEqual(json.load(f), {"mara": 1})

    def test_a_count_that_went_back_deletes_nothing(self):   # (a restored backup, or a count that wasn't saved)
        social.forget("mara"); social.forget("mara")
        written = [self.item(epoch=2), self.item(content="more", epoch=2)]   # (the phone's kit said 2)
        social._gen = {}                                  # (the Mac's count went back to 0)
        r = self.imp(written)[2]["results"]
        self.assertEqual([x.get("dropped") for x in r], [None, None])
        social.forget("mara")                             # (a real delete after that: 1 > 0, and the old ones are gone)
        self.assertEqual(self.imp([self.item(epoch=0)])[2]["results"][0]["dropped"], "deleted")
        st, _, j = self.http("POST", "/api/characters/forget", {"id": "mara"}, cookie=self.mac)
        self.assertEqual((st, j["epoch"]), (200, 2))      # (what the phone's later messages carry)

    def test_request_and_item_checks(self):
        self.assertEqual(self.imp([self.item()], cookie=self.mac)[:3:2], (403, {"error": "only phones have phone-mode messages"}))
        self.assertEqual(self.http("POST", "/api/thread/import", {"messages": [self.item()]})[0], 401)
        for body, why in (({"messages": [self.item() for _ in range(201)]}, "send 1 to 200 messages at a time"),
                          ({"messages": []}, "send 1 to 200 messages at a time"), ([1], "bad request"),
                          ({"messages": "x"}, "bad request"),
                          ({"messages": [self.item(voice={"data": b64(WAV)}), self.item(voice={"data": b64(WAV)})]},
                           "one photo or voice message at a time")):
            self.assertEqual(self.http("POST", "/api/thread/import", body, cookie=self.phone)[:3:2], (400, {"error": why}))
        self.assertEqual(self.http("POST", "/api/thread/import", b"{nope", cookie=self.phone,
                                   headers={"Content-Type": "application/json"})[0], 400)
        mac_a = social.add("assistant", "hi", via="phone", char="mara", private=False, mode="companion")["id"]
        cases = [
            ({"cid": "short"}, "bad id"), ({"cid": 5}, "bad id"), ({"private": True}, "private"),
            ({"role": "system"}, "bad role"), ({"char": "nobody"}, "no such character"), ({"char": None}, "no such character"),
            ({"content": 5}, "bad content"), ({"content": None}, "bad content"), ({"content": "   "}, "empty"),
            ({"role": "assistant", "content": ""}, "empty"), ({"ts": True}, "bad time"), ({"ts": "1"}, "bad time"),
            ({"ts": -1}, "bad time"), ({"ts": float("nan")}, "bad time"), ({"ts": self.now - 401 * 86400}, "too old"),
            ({"epoch": "0"}, "bad epoch"), ({"epoch": True}, "bad epoch"), ({"epoch": None}, "bad epoch"),
            ({"photo": {"full": "!!!", "view": "!!!"}}, "bad photo"), ({"photo": "x"}, "bad photo"),
            ({"photo": {"full": b64(jpeg(100, 100)), "view": b64(b"not a jpeg")}}, "bad photo"),
            ({"photo": {"full": b64(jpeg(5000, 100)), "view": b64(jpeg(100, 100))}}, "bad photo"),
            ({"role": "assistant", "photo": {"full": b64(jpeg(100, 100)), "view": b64(jpeg(100, 100))}}, "bad photo"),
            ({"voice": {"data": b64(b"just bytes")}}, "bad voice"), ({"voice": {"data": "@@"}}, "bad voice"),
            ({"voice": {"data": b64(WAV), "dur": "3"}}, "bad voice"), ({"voice": "x"}, "bad voice"),
            ({"role": "reaction", "emoji": "fire", "by": "you", "target": mac_a}, "bad reaction"),
            ({"role": "reaction", "emoji": "🍕🍕", "by": "you", "target": mac_a}, "bad reaction"),
            ({"role": "reaction", "emoji": "", "by": "mara", "target": mac_a}, "bad reaction"),
            ({"role": "reaction", "emoji": "😂", "by": "leo", "target": mac_a}, "bad reaction"),
            ({"role": "reaction", "emoji": "😂", "by": "you"}, "bad reaction"),
            ({"role": "reaction", "emoji": "😂", "by": "you", "target": True}, "bad reaction")]
        for kw, why in cases:
            it = self.item(kw.get("role", "user")); it.update(kw)
            st, _, r = self.imp([it])
            self.assertEqual((st, r["results"][0]["dropped"]), (200, why), kw)
            self.assertEqual(r["results"][0]["cid"], it["cid"] if isinstance(it["cid"], str) and len(it["cid"]) >= 16 else None)
        self.cfg["phone_mode"] = False                    # (off on the Mac: what phones already wrote still comes in)
        self.assertEqual(self.imp([self.item(ts=self.now + 9999)])[2]["results"][0].get("dropped"), None)
        self.assertLessEqual(social._load(social.THREAD, [])[-1]["ts"], time.time())   # (the phone's clock ahead: now)
        webm = b"\x1aE\xdf\xa3" + b"\0" * 100             # numbers too big for a float break nothing either
        st, _, r = self.imp([self.item(ts=10 ** 400, epoch=0, voice={"data": b64(webm), "dur": -10 ** 400})])
        self.assertEqual((st, social.find(r["results"][0]["id"])["dur"]), (200, 0.0))
        self.assertNotIn("dropped", self.imp([self.item(epoch=10 ** 400)])[2]["results"][0])   # (only a lower count is a delete)
        self.assertEqual(len(social._load(social.THREAD, [])), 4)

    def test_too_big_is_refused_before_reading(self):
        port = self.serve()
        s = socket.create_connection(("127.0.0.1", port), timeout=5)
        t0 = time.time()
        s.sendall(b"POST /api/thread/import HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\n"
                  b"Cookie: buddy=%s\r\nContent-Length: 25000000\r\n\r\n" % (port, self.phone.encode()))
        got = b""
        while True:                                       # (it answers and closes without waiting for the body)
            b = s.recv(65536)
            if not b: break
            got += b
        s.close()
        self.assertIn(b" 413 ", got.split(b"\r\n")[0]); self.assertLess(time.time() - t0, 2)
        self.assertIn(b'{"error": "too much at once"}', got)

    def test_photos_and_voice(self):
        full, view = jpeg(1200, 900, EXIF), jpeg(400, 300, EXIF)
        p = self.item(content="look", photo={"full": b64(full), "view": b64(view)}, photo_desc="  a  cat\n on a sofa ",
                      seen_by="gemma4-31b", w=1, h=1, image="evil")
        st, _, r = self.imp([p])
        m = social.find(r["results"][0]["id"])
        self.assertEqual((m["w"], m["h"], m["photo_desc"], m["seen_by"]), (1200, 900, "a cat on a sofa", "gemma4-31b"))
        self.assertRegex(m["image"], r"^[0-9a-f]{32}$")
        self.assertEqual(self.media(), sorted([m["image"] + ".jpg", m["image"] + ".v.jpg"]))
        for f in self.media():
            path = os.path.join(images.MEDIA, f)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            with open(path, "rb") as fh: data = fh.read()
            self.assertNotIn(b"Exif", data); self.assertNotIn(b"FakeGPS", data)
        self.assertEqual(self.imp([p])[2]["results"][0]["dup"], True)
        self.assertEqual(len(self.media()), 2)                       # (a retry saves nothing again)
        self.assertEqual(self.looked, [])                            # (it came described)
        v = self.item(content="(words)", voice={"data": b64(WAV), "dur": 99})
        a = self.item("assistant", content="a voice reply", voice={"data": b64(WAV), "dur": 1.5}, reply_to=v["cid"])
        r = self.imp([v])[2]
        m = social.find(r["results"][0]["id"])
        self.assertEqual((m["dur"], images.path(m["voice"]).endswith(".wav")), (0.1, True))
        m = social.find(self.imp([a])[2]["results"][0]["id"])
        self.assertEqual((m["dur"], m["role"]), (0.1, "assistant"))
        webm = b"\x1aE\xdf\xa3" + b"\0" * 100
        m = social.find(self.imp([self.item(content="", voice={"data": b64(webm), "dur": 4321})])[2]["results"][0]["id"])
        self.assertEqual(m["dur"], 600.0)
        d = social.find(self.imp([self.item(content="", photo={"full": b64(full), "view": b64(view)}, seen=False)])[2]
                        ["results"][0]["id"])
        self.assertIs(d["seen"], False); self.assertNotIn("photo_desc", d)

    def test_reactions(self):
        mac_u = social.add("user", "from the Mac", via="mac", char="mara", private=False)["id"]
        leo_a = social.add("assistant", "leo here", via="phone", char="leo", private=False, mode="advisor")["id"]
        priv = social.add("assistant", "private one", via="phone", char="mara", private=True, mode="companion")["id"]
        a = self.item("assistant", content="hello")
        items = [a, self.item("reaction", target_cid=a["cid"], emoji="❤", by="you"),
                 self.item("reaction", target=mac_u, emoji=" 😂 ", by="mara"),
                 self.item("reaction", target=leo_a, emoji="😂", by="you"),
                 self.item("reaction", target=priv, emoji="😂", by="you"),
                 self.item("reaction", target_cid=new_cid(), emoji="😂", by="you"),
                 self.item("reaction", target=mac_u, emoji="", by="you")]
        r = self.imp(items)[2]["results"]
        self.assertEqual([x.get("dropped") for x in r], [None, None, None, "no such message", "no such message",
                                                         "no such message", None])
        t = {m["id"]: m for m in social._load(social.THREAD, [])}
        self.assertEqual((t[r[1]["id"]]["target"], t[r[1]["id"]]["emoji"]), (r[0]["id"], "❤️"))
        self.assertEqual((t[r[2]["id"]]["target"], t[r[2]["id"]]["emoji"], t[r[2]["id"]]["by"]), (mac_u, "😂", "mara"))
        self.assertEqual(t[r[6]["id"]]["emoji"], "")
        later = self.item("reaction", target_cid=a["cid"], emoji="🔥", by="you")   # (an earlier batch's message)
        rid = self.imp([later])[2]["results"][0]["id"]
        self.assertEqual(social.find(rid)["target"], r[0]["id"])

    def test_stored_shapes(self):
        u = self.item(content="q", call=True, photo={"full": b64(jpeg(100, 100)), "view": b64(jpeg(50, 50))},
                      photo_desc="a mug", seen_by="bad model name!")
        a = self.item("assistant", content="ans", mode="nonsense", reply_to=u["cid"], knows=True, call="yes",
                      sources=[{"kind": "facts", "path": "Buddy knows/mara", "n": 2}, {"kind": "note", "path": "x", "n": 1},
                               {"kind": "facts", "path": "y" * 201, "n": 1}, {"kind": "facts", "path": "z", "n": True}])
        items = [u, a, self.item("reaction", target_cid=a["cid"], emoji="👍", by="you"), self.item("break"),
                 self.item(content="plain")]
        r = self.imp(items)[2]["results"]
        t = {m["id"]: m for m in social._load(social.THREAD, [])}
        base = {"id", "role", "content", "ts", "char", "cid", "from", "direct"}
        ms = [t[x["id"]] for x in r]
        self.assertEqual(set(ms[0]), base | {"private", "via", "image", "w", "h", "photo_desc"})   # (seen_by refused)
        self.assertEqual((ms[0]["via"], ms[0]["private"], ms[0]["from"], ms[0]["direct"]), ("call", False, "phone", True))
        self.assertEqual(set(ms[1]), base | {"private", "via", "mode", "sources", "knows"})
        self.assertEqual((ms[1]["mode"], ms[1]["via"], ms[1]["sources"]),
                         ("companion", "phone", [{"kind": "facts", "path": "Buddy knows/mara", "n": 2}]))
        self.assertEqual(set(ms[2]), base | {"target", "emoji", "by"})
        self.assertEqual(set(ms[3]), base); self.assertEqual(ms[3]["content"], "")
        self.assertEqual(set(ms[4]), base | {"private", "via"})
        self.assertNotIn("reply_to", json.dumps(ms))

    def test_nothing_half_stored(self):                   # the thread can't be saved: no photo left without its message
        real, failed = social._save, []
        def flaky(p, obj):
            if p == social.THREAD and not failed:
                failed.append(1); raise OSError("disk full (test)")
            return real(p, obj)
        p = self.item(content="pic", photo={"full": b64(jpeg(300, 200)), "view": b64(jpeg(150, 100))})
        with mock.patch.object(social, "_save", flaky):
            st, _, r = self.imp([p, self.item(content="text too")])
            self.assertGreaterEqual(st, 500)
            self.assertEqual((self.media(), social._load(social.THREAD, []), social._hw), ([], [], 0))
            st, _, r = self.imp([p, self.item(content="text too")])
        self.assertEqual(st, 200); self.assertNotIn("dup", r["results"][0])
        self.assertEqual(len(self.media()), 2); self.assertEqual(len(social._load(social.THREAD, [])), 2)

    def test_a_disk_error_loses_nothing(self):          # a full disk while saving a photo or a recording: a 5xx, no file
        real = images._write                              # left behind, and the phone's retry (same cids) adds it whole
        def full_disk(p, data):
            if p.endswith(".v.jpg") or p.endswith(".wav"):
                with open(p, "wb") as f: f.write(data[:10])   # (half written, as when the disk fills up)
                raise OSError(28, "No space left on device (test)")
            return real(p, data)
        p = self.item(content="pic", photo={"full": b64(jpeg(300, 200)), "view": b64(jpeg(150, 100))})
        v = self.item(content="(words)", voice={"data": b64(WAV)})
        first = [self.item(content="first"), p]
        for items in (first, [v]):
            with mock.patch.object(images, "_write", full_disk):
                st, _, r = self.imp(items)
            self.assertGreaterEqual(st, 500, r)
            self.assertEqual((self.media(), social._load(social.THREAD, [])), ([], []))
        st, _, r = self.imp(first)                        # (sent again)
        self.assertEqual(st, 200); self.assertTrue(all("id" in x and "dup" not in x for x in r["results"]))
        self.assertEqual(social.find(r["results"][1]["id"])["content"], "pic")
        self.assertEqual(self.imp([v])[2]["results"][0].get("dropped"), None)
        self.assertEqual(len(self.media()), 3)

    @unittest.skipUnless(resource, "needs RLIMIT_FSIZE")
    def test_a_full_disk_keeps_the_old_file(self):      # the disk fills up in the very last write (when the file is closed):
        msgs = [{"id": i, "role": "user" if i % 2 else "assistant", "content": f"fake message {i}", "ts": self.now - 9000 + i,
                 "char": "mara", "private": False} for i in range(1, 1501)]   # it raises (the import's 5xx) and the
        cases = [(social.THREAD, msgs, msgs + [dict(msgs[0], id=1501)]),         # old file stays whole, large or small
                 (social.GENS, {"buddy": 3}, {"buddy": 3, "mara": 1})]
        soft, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
        for p, before, after in cases:
            social._save(p, before)
            resource.setrlimit(resource.RLIMIT_FSIZE, (len(json.dumps(after)) - 5, hard))   # (Python ignores SIGXFSZ: EFBIG)
            try:
                with self.assertRaises(OSError): social._save(p, after)
            finally:
                resource.setrlimit(resource.RLIMIT_FSIZE, (soft, hard))
            self.assertEqual(social._load(p, None), before)
            self.assertFalse(os.path.exists(p + ".tmp"))
        self.assertEqual(oct(os.stat(social.THREAD).st_mode & 0o777), "0o600")

class SavedChats(FakeWorld):                          # 6, 6a
    def chat_file(self, cid, ts):
        return os.path.join(server.CHATS, cid, datetime.datetime.fromtimestamp(ts).date().isoformat() + ".md")

    def read(self, p):
        with open(p, encoding="utf-8") as f: return f.read()

    def test_saved_like_the_mac_does(self):
        ts = datetime.datetime.combine(datetime.date.today() - datetime.timedelta(days=3), datetime.time(12, 0)).timestamp()
        p = self.item(content="look", ts=ts, photo={"full": b64(jpeg(100, 100)), "view": b64(jpeg(60, 60))}, photo_desc="a cat")
        a = self.item("assistant", content="Hi.\n\nHow are you?", reply_to=p["cid"], ts=ts + 5)
        v = self.item(content="hello there", ts=ts + 60, voice={"data": b64(WAV)})
        b = self.item("assistant", content="hey you", ts=ts + 65, reply_to=v["cid"], voice={"data": b64(WAV)}, mode="advisor")
        l1 = self.item(char="leo", content="run?", ts=ts + 70)
        self.imp([p, a, l1])
        l2 = self.item("assistant", char="leo", content="Sure.\n\nAt six.", reply_to=l1["cid"], ts=ts + 75)
        self.imp([v]); self.imp([b, l2])                 # (the question came in an earlier batch)
        f = self.chat_file("mara", ts)
        text = self.read(f)
        self.assertTrue(text.startswith(f"# Chat with Mara, {datetime.datetime.fromtimestamp(ts):%d %B %Y %H:%M}\n\n"))
        self.assertIn("**Me:** [sent a photo: a cat] look\n\n**Mara** (companion): Hi. How are you?\n\n", text)
        self.assertIn("**Me:** 🎤 hello there\n\n**Mara** (advisor): 🎤 hey you\n\n", text)
        self.assertIn("**Leo** (advisor): Sure. At six.", self.read(self.chat_file("leo", ts)))
        self.assertEqual(sorted(self.kicks), ["leo", "leo", "mara", "mara", "mara"])   # (once per character per batch)
        self.imp([p, a, l1]); self.imp([b])               # retried: nothing more
        self.assertEqual(self.read(f), text)
        self.cfg["save_chats"] = False
        q = self.item(content="not saved", ts=ts + 100); self.imp([q, self.item("assistant", content="ok", reply_to=q["cid"])])
        self.assertEqual(self.read(f), text)

    def test_the_mac_looks_at_undescribed_photos(self):
        go = threading.Event()
        def slow(view):                                   # (0.3 s, and never before the import has answered)
            go.wait(10); time.sleep(0.3); self.looked.append(len(view)); return "a red square", "gemma4-31b"
        ts = self.now - 120
        p = self.item(content="what's this", ts=ts, photo={"full": b64(jpeg(200, 200)), "view": b64(jpeg(100, 100))})
        a = self.item("assistant", content="Nice!", reply_to=p["cid"], ts=ts + 3)
        with mock.patch.object(server, "describe", slow):
            st, _, r = self.imp([p, a])                   # the answer doesn't wait for the look
            mid = r["results"][0]["id"]
            self.assertEqual((st, self.looked), (200, []))
            self.assertNotIn("photo_desc", social.find(mid)); self.assertNotIn("seen", social.find(mid))
            go.set()
            self.assertTrue(self.wait(lambda: social.find(mid).get("photo_desc") == "a red square", 2))
            self.assertEqual(social.find(mid)["seen_by"], "gemma4-31b")
            f = self.chat_file("mara", ts)
            self.assertTrue(self.wait(lambda: os.path.exists(f) and "[sent a photo: a red square] what's this" in self.read(f), 3))
        p2 = self.item(content="and this?", ts=ts + 10, photo={"full": b64(jpeg(200, 200)), "view": b64(jpeg(100, 100))})
        a2 = self.item("assistant", content="Lovely.", reply_to=p2["cid"], ts=ts + 12)
        go.clear()
        with mock.patch.object(server, "describe", slow):
            self.imp([p2]); self.imp([a2])                # (the phone sends a photo's reply in the next request)
            go.set()
            self.assertTrue(self.wait(lambda: "[sent a photo: a red square] and this?" in self.read(f), 3), self.read(f))
        self.assertNotIn("[sent a photo] and this?", self.read(f))
        self.looked.clear()
        mid = self.imp([self.item(content="", photo={"full": b64(jpeg(200, 200)), "view": b64(jpeg(100, 100))})])[2]["results"][0]["id"]
        self.assertTrue(self.wait(lambda: social.find(mid).get("seen") is False, 2))   # (nobody could look)
        self.assertEqual(len(self.looked), 1); self.assertNotIn("photo_desc", social.find(mid))
        self.imp([self.item(content="described", photo={"full": b64(jpeg(200, 200)), "view": b64(jpeg(100, 100))},
                            photo_desc="a blue circle")])
        self.cfg["see_photos"] = False
        mid = self.imp([self.item(content="", photo={"full": b64(jpeg(200, 200)), "view": b64(jpeg(100, 100))})])[2]["results"][0]["id"]
        self.assertIs(social.find(mid).get("seen"), False)
        time.sleep(0.1)
        self.assertEqual(len(self.looked), 1)            # (never asked again: described already, or photos are off)

class Guard(FakeWorld):
    def test_guard_stops_real_private_files(self):     # (it raises before anything is opened)
        for p in (os.path.join(ROOT, ".thread.json"), os.path.join(ROOT, "my-characters", "x.json"),
                  os.path.join(ROOT, "persona.local.txt"), os.path.join(ROOT, ".tinfoil_key"),
                  os.path.join(sorted(HOMES)[0], "Buddy", "note.md")):
            with self.assertRaises(PrivateFileOpened):
                try: open(p)
                except Exception: pass                    # (code that swallows errors can't hide it)
        with self.assertRaises(PrivateFileOpened): os.open(os.path.join(ROOT, ".gens.json"), os.O_RDONLY)
        self.assertEqual(len(self.violations), 6)
        self.violations.clear()
        write(os.path.join(self.T, ".thread.json"), "[]")   # (the fake world's own files are fine)
        self.assertEqual(social._load(social.THREAD, None), [])

class CookieAndHeaders(FakeWorld):                    # 6b, 7
    def test_cookie_stays_fresh(self):
        st, h, r = self.http("GET", "/api/me", cookie=self.phone)
        self.assertEqual((r["paired"], r["device"]["kind"]), (True, "phone"))
        self.assertEqual(h["Set-Cookie"], f"buddy={self.phone}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict")
        for cookie in (self.mac, None, "not-a-key"):
            self.assertIsNone(self.http("GET", "/api/me", cookie=cookie)[1].get("Set-Cookie"))
        port = self.serve()
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("GET", "/api/me", headers={"Host": "buddy.tail1234.ts.net", "Cookie": f"buddy={self.phone}"})
        self.assertTrue(c.getresponse().headers["Set-Cookie"].endswith("; Secure")); c.close()

    def test_csp_types_version_routes(self):
        for path in ("/phone", "/phone/", "/phone?x=1"):
            csp = self.http("GET", path)[1]["Content-Security-Policy"]
            self.assertIn("connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh;", csp, path)
            self.assertEqual(csp, server.Handler.PHONE_CSP)
        for path in ("/", "/?mac=1", "/chat.html", "/api/status", "/direct.js", "/api/me"):
            csp = self.http("GET", path)[1]["Content-Security-Policy"]
            self.assertEqual(csp, server.Handler.CSP, path); self.assertNotIn("tinfoil", csp)
        self.assertEqual(server.Handler.PHONE_CSP.replace(" https://atc.tinfoil.sh https://inference.tinfoil.sh", ""),
                         server.Handler.CSP)
        for path in ("/vendor/tinfoil.mjs", "/direct.js", "/sw.js"):
            st, h, body = self.http("GET", path)
            self.assertEqual((st, h["Content-Type"]), (200, "text/javascript"), path)
        v1 = self.http("GET", "/api/version", cookie=self.phone)[2]["version"]
        p = os.path.join(self.web, "direct.js"); st = os.stat(p)
        os.utime(p, (st.st_atime, st.st_mtime + 5))
        v2 = self.http("GET", "/api/version", cookie=self.phone)[2]["version"]
        self.assertNotEqual(v1, v2)
        p = os.path.join(self.web, "vendor/tinfoil.mjs"); os.utime(p, (st.st_atime, st.st_mtime + 9))
        self.assertNotEqual(self.http("GET", "/api/version", cookie=self.phone)[2]["version"], v2)
        self.assertEqual(server.SHELL_FILES[:5], ("chat.html", "sw.js", "manifest.json", "pcm-tap.js", "direct.js"))
        social.add("user", "hello", via="phone", char="mara", private=False)
        st, h, t = self.http("GET", "/api/thread?after=0", cookie=self.phone)
        self.assertEqual((st, [m["content"] for m in t]), (200, ["hello"]))
        st, h, body = self.http("GET", "/api/thread/import", cookie=self.phone)
        self.assertNotEqual(st, 200)
        self.assertIn(".gens.json", server.PRIVATE_FILES)

class Timing(FakeWorld):                              # 8
    def test_newest_time_counts(self):
        now = time.time()
        msgs = [{"id": 1, "role": "user", "content": "a", "ts": now - 5 * 3600, "char": "mara", "private": False},
                {"id": 2, "role": "assistant", "content": "b", "ts": now - 4 * 3600, "char": "mara", "private": False},
                {"id": 3, "role": "user", "content": "from phone mode", "ts": now - 30 * 3600, "char": "mara",
                 "private": False, "cid": new_cid(), "direct": True},
                {"id": 4, "role": "user", "content": "now", "ts": now, "char": "mara", "private": False}]
        social._save(social.THREAD, msgs[:3])
        self.assertEqual(social.last_ts(), now - 4 * 3600)
        self.assertEqual(social.last_ts("user"), now - 5 * 3600)
        self.assertTrue(server.since_last_talk("mara", skip_newest=False).startswith(
            "Our last message before this was 4 hours ago. It was yours, and I never answered it. React to that"))
        social._save(social.THREAD, msgs)
        self.assertEqual(server.since_last_talk("mara"), "Our last message before this was 4 hours ago. It was yours, and I never answered it.")
        self.assertEqual(social.last_ts("assistant", proactive=True), 0)

    def test_a_late_reply_answered_meanwhile_is_dropped(self):   # (phone mode answered it, or a New chat): no reply,
        asked = []                                                # but a text you sent while it waited is still answered
        def brain(mode, spoken=False, free_ok=False):
            asked.append(mode); raise RuntimeError("no brain in tests")
        def chat(text, out):
            out.append(self.http("POST", "/api/chat", {"text": text, "char": "mara", "private": False, "via": "phone"},
                                 cookie=self.phone)[2])
        with mock.patch.object(server, "reply_delay", lambda c, via: 1.5), mock.patch.object(server, "brain", brain):
            for meanwhile in ("phone mode", "new chat", "another text"):
                asked.clear(); first, second = [], []
                text = f"are you there? ({meanwhile})"
                th = threading.Thread(target=chat, args=(text, first)); th.start()
                self.assertTrue(self.wait(lambda: any(m["content"] == text for m in social.thread())))
                if meanwhile == "phone mode":
                    st, _, r = self.imp([self.item("assistant", content="answered on the phone", mode="companion")])
                    self.assertEqual(st, 200, r)
                elif meanwhile == "new chat":
                    self.assertEqual(self.http("POST", "/api/newchat", {"char": "mara"}, cookie=self.phone)[0], 200)
                else:
                    chat("and now?", second)
                    self.assertIn(b'"later"', second[0])
                th.join(15)
                self.assertIn(b'"later"', first[0])
                self.assertEqual(asked, ["companion"] if meanwhile == "another text" else [], meanwhile)
                self.http("POST", "/api/newchat", {"char": "mara"}, cookie=self.phone)

    def test_system_prompt_unchanged(self):
        """The persona and the style come from persona_of() and style_text() now: the same text as main's own
        system_prompt (what doesn't change first; the public edition's rules near the end), in both editions."""
        S = server
        def old(char, mode_used, user_text, chat_file, via="mac", proactive=False, used=None, asking=False, spoken=None,
                photos=True, extra=(), length="", notes=True):   # (main's system_prompt at 1018218, inline expressions and all)
            aloud = via == "mac" and (spoken is None or spoken)
            style = S.CALLING if via == "call" else S.TEXTING.format(where=" on my phone" if via == "phone" else " (I'm on my Mac)") \
                + (" " + S.ALOUD if aloud else "")
            persona = char["persona"] or (S.read("persona.txt") if char.get("builtin")
                                          else f"You are {char['name']}, a friendly adult I can talk to. {char.get('tagline', '')}")
            pub = S.edition.PUBLIC
            parts = [persona, f"Your name is {char['name']}. You are an adult.",
                     S.edition.COMPANION if pub and mode_used == "companion" else S.read(f"mode_{mode_used}.txt"), style,
                     S.PHOTOS + (" " + S.edition.PHOTOS if pub else "") if photos and via != "call" and S.images.find(S.cfg())
                     else S.NO_PHOTOS,
                     S.life_block(char, via)]
            known, fsrc = S.facts.for_prompt(char, user_text, call=via == "call", everything=asking) if notes else ([], [])
            if known:
                parts.append(S.FACTS_HEAD + "\n" + "\n".join("- " + f for f in known) + "\n" + S.FACTS_RULE)
            parts.extend(extra)
            if asking and notes:
                parts.append(S.knows_ask(char, bool(known), via in ("call", "mac") if spoken is None else spoken))
            if pub:
                c = S.cfg()
                parts.append(S.edition.HALAL + "\n" + S.edition.romance(c.get("has_partner"), c.get("partner_at"), S.time.time(),
                                                                         bool(c.get("partner_noask")), quiet=not notes))
            now = S.datetime.datetime.now().strftime("%A %d %B %Y, %H:%M")
            parts.append(f"Right now it's {now}. {S.since_last_talk(char['id'], skip_newest=not proactive)}".strip())
            parts.append(length)
            return "\n\n".join(p for p in parts if p)
        class Fixed(datetime.datetime):
            @classmethod
            def now(cls, tz=None): return cls(2026, 10, 9, 14, 30)
        t0 = self.now
        clock = types.SimpleNamespace(**{k: getattr(time, k) for k in dir(time) if not k.startswith("_")})
        clock.time = lambda: t0
        social.add("user", "earlier", via="phone", char="mara", private=False)
        maker = {"on": {"x": 1}}                      # (a picture maker ready, and none: PHOTOS or NO_PHOTOS)
        with mock.patch.object(S, "datetime", types.SimpleNamespace(datetime=Fixed, date=datetime.date,
                                                                     timedelta=datetime.timedelta)), \
                mock.patch.object(S, "time", clock), mock.patch.object(S.images, "find", lambda c, refresh=False: maker["on"]):
            n = 0
            for pub, on in ((False, {"x": 1}), (True, {"x": 1}), (False, None), (True, None)):
                maker["on"] = on
                self.cfg.update(has_partner="no" if pub else "", partner_at=t0 - 86400, partner_noask=pub)
                with mock.patch.object(S.edition, "PUBLIC", pub):
                    for ch in characters.all_characters(S.cfg()):
                        for via, spoken in (("phone", None), ("mac", None), ("mac", False), ("call", None), ("mac", True)):
                            for asking in (False, True):
                                for notes in (True, False):
                                    kw = dict(via=via, spoken=spoken, asking=asking, extra=(S.PHOTO_SAFETY,), length="LEN", notes=notes)
                                    got = S.system_prompt(ch, "companion", "coffee?", None, **kw)
                                    self.assertEqual(got, old(ch, "companion", "coffee?", None, **kw), (pub, ch["id"], via, spoken, asking))
                                    self.assertEqual(S.edition.HALAL in got, pub)
                                    self.assertEqual(S.NO_PHOTOS in got, via == "call" or on is None)
                                    n += 1
            self.assertEqual(n, 240)

class EditionAndFree(FakeWorld):
    def saving(self):                                  # (settings in the fake world: never config.local.json)
        p = mock.patch.object(server, "save_cfg", lambda **kw: self.cfg.update(kw)); p.start(); self.addCleanup(p.stop)

    def test_kit_brings_the_new_rules(self):
        st, _, r = self.kit()
        k = r["kit"]
        self.assertEqual(k["edition"], {"public": False})          # (this repo: the private edition)
        self.assertEqual(k["billing"], {"out": billing.OUT, "limit": billing.LIMIT})
        self.assertEqual(k["voices"], server.voice_list())
        self.assertTrue(any(v.get("note") for v in k["voices"]) and not any(v.get("note") for v in k["voices"] if v["id"][:1].islower()))
        self.assertNotIn("@cf/", json.dumps(k))                     # (the free brain's models never reach the phone)
        self.assertNotIn("kimi-k3", k["models"]["advisor"]["fallbacks"] + k["models"]["companion"]["fallbacks"])
        self.assertNotIn("glm-5-3", k["models"]["advisor"]["fallbacks"] + k["models"]["companion"]["fallbacks"])
        self.assertEqual(k["models"]["no_thinking"]["deepseek-v4-1-flash"]["reasoning_effort"], "none")
        self.assertEqual(k["stt"], {"language": "", "model": ""})
        for raw, want in (("voxtral-small-24b", "voxtral-small-24b"), ("bad model!", ""), ("x" * 65, "")):
            self.cfg["stt_model"] = raw
            self.assertEqual(server.phonekit()["kit"]["stt"]["model"], want)
        self.cfg.pop("stt_model")
        self.cfg.update(has_partner="yes", partner_at=self.now - 5, partner_noask=True)
        self.assertEqual(server.phonekit()["kit"]["edition"], {"public": False})   # (nothing about you in the private one)
        with mock.patch.object(edition, "PUBLIC", True):
            e = server.phonekit()["kit"]["edition"]
            self.assertEqual((e["public"], e["halal"], e["companion"], e["recheck"]), (True, edition.HALAL, edition.COMPANION, edition.RECHECK))
            self.assertEqual(e["partner"], {"has": "yes", "at": self.now - 5, "noask": True})
            self.assertEqual(e["romance"]["no_recheck"], edition.romance("no", None, self.now))
            self.assertIn("months ago", e["romance"]["no_recheck"]); self.assertNotIn("months ago", e["romance"]["no"])
            for bad in ("maybe", None, 1):
                self.cfg.update(has_partner=bad, partner_at=float("nan") if bad == 1 else True)
                p = server.phonekit()["kit"]["edition"]["partner"]
                self.assertEqual((p["has"], p["at"]), ("", None if bad == 1 else 1.0))

    def test_free_brain_without_a_tinfoil_key_keeps_phone_mode_off(self):
        self.cfg["free_brain"] = True
        st, _, r = self.kit()
        self.assertEqual((st, r.get("phone_mode"), r.get("free"), r.get("error")), (403, False, True, server.PHONE_FREE))
        self.assertIn("never the free brain", r["error"])
        write(os.path.join(self.repo, ".tinfoil_key"), "sk-FAKE-tests-only-0123456789")   # (a fake key in the fake repo)
        self.assertEqual(self.kit()[0], 200)                       # (with a Tinfoil key: phone mode, Tinfoil only)
        os.remove(os.path.join(self.repo, ".tinfoil_key"))
        self.cfg["free_brain"] = False
        self.assertEqual(self.kit()[0], 200)                       # (Private chosen: as before)
        self.cfg["free_brain"] = True                              # (the import still takes what phone mode said before)
        st, _, r = self.imp([self.item("user", content="from before")])
        self.assertEqual((st, isinstance(r["results"][0].get("id"), int)), (200, True))

    def test_relationship_status_from_phone_mode(self):
        self.saving()
        pt = lambda **kw: {"cid": new_cid(), "role": "partner", **kw}
        st, _, r = self.imp([pt(has="no", at=self.now - 60)])
        self.assertEqual((st, r["results"][0]["dropped"]), (200, "not this edition"))   # (the private edition: nothing)
        self.assertNotIn("has_partner", self.cfg)
        with mock.patch.object(edition, "PUBLIC", True):
            a, b = pt(has="no", at=self.now - 60), self.item("user", content="hello")
            st, _, r = self.imp([a, b])
            self.assertEqual(r["results"][0], {"cid": a["cid"], "applied": True})
            self.assertTrue(isinstance(r["results"][1]["id"], int))
            self.assertEqual((self.cfg["has_partner"], self.cfg["partner_at"]), ("no", self.now - 60))
            self.assertEqual([m["content"] for m in social.thread()], ["hello"])          # (a status, never a message)
            st, _, r = self.imp([pt(has="yes", at=self.now - 3600)])                       # (older than what the Mac
            self.assertEqual((r["results"][0]["applied"], self.cfg["has_partner"]), (True, "no"))   # knows: its own wins)
            self.imp([pt(noask=True)])
            self.assertIs(self.cfg["partner_noask"], True)
            self.imp([pt(has="yes", at=self.now + 9999)])                                  # (the future: now)
            self.assertEqual(self.cfg["has_partner"], "yes"); self.assertLessEqual(self.cfg["partner_at"], time.time())
            for bad, why in ((pt(has="maybe", at=self.now), "bad partner"), (pt(has="no"), "bad time"),
                             (pt(has="no", at=True), "bad time"), (pt(), "empty"), (pt(noask=False), "empty"),
                             (pt(noask="yes"), "bad partner"), ({"cid": "x", "role": "partner", "noask": True}, "bad id")):
                st, _, r = self.imp([bad])
                self.assertEqual((st, r["results"][0]["dropped"]), (200, why), bad)
            st, _, r = self.imp([pt(noask=True)], cookie=self.mac)
            self.assertEqual(st, 403)                              # (only phones bring phone-mode things)
            def full(**kw): raise OSError(28, "No space left on device (test)")
            with mock.patch.object(server, "save_cfg", full):      # a disk error: a 5xx, so the phone sends it again
                st, _, r = self.imp([pt(has="no", at=time.time() + 60)])
            self.assertGreaterEqual(st, 500)
            self.assertEqual(self.cfg["has_partner"], "yes")

if __name__ == "__main__":
    unittest.main()
