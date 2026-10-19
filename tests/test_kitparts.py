"""kitparts.py (SPEC3 §3.3, §16.2): the static parts of phone mode's kit, split out of buddy_server.py so the coming
Buddy for phones site can build kit.json without the server.

- phonekit() is byte for byte what it was before the split: golden answers recorded (from the code before the split)
  over fake worlds and fake configs, both editions (tests/kitparts_golden.json).
- static_kit(edition) is phonekit()['kit'] without what comes from you (name, time zone, settings, characters, Tinfoil's
  model list as last fetched, your chosen models, voice and relationship status, your own copies of the mode texts),
  plus a named list of extras the phone-only app needs.
- importing kitparts (and calling static_kit) loads none of the server's modules, writes nothing, opens no socket and
  reads nothing private (a fresh interpreter with an empty HOME).
Fake data only, in temp folders: a guard fails the test the moment one of the real private files is opened.
    python3 -B -m unittest tests.test_kitparts -v
    /root/.local/bin/python3.9 -B -m unittest tests.test_kitparts
Only when a kit change is intended (never to make a failure go away):  python3 -B tests/test_kitparts.py --record"""
import builtins, copy, datetime, fnmatch, io, json, os, pwd, subprocess, sys, tempfile, time, unittest
from unittest import mock

ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
import characters, edition, facts, images, lives, social
import buddy_server as server

GOLDEN = os.path.join(ROOT, "tests", "kitparts_golden.json")
HOMES = {os.path.realpath(os.path.expanduser("~")), os.path.realpath(pwd.getpwuid(os.getuid()).pw_dir)}
NEVER_DIRS = [os.path.join(ROOT, "my-characters")] + [os.path.join(h, "Buddy") for h in HOMES]
NEVER_FILES = {os.path.join(ROOT, f) for f in (
    "config.local.json", ".thread.json", ".facts_state.json", ".gens.json", ".tinfoil_key", ".phala_key", ".near_key",
    ".memory_index.json", ".push_subs.json", ".vapid.json", ".devices.json", ".mac_token", ".backup_key",
    ".backup_state.json", ".cloudflare_key")}

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

# ---------- fake worlds ----------
NOW = 1792749600.5                                     # Fri 2026-10-23 12:00 in Berlin (a fixed now: the logs' days)
REPO = {"persona.txt": "You are Buddy, a made-up test friend who likes trains.",
        "mode_advisor.txt": "ADVISOR MODE TEXT (fake, for tests).", "mode_companion.txt": "COMPANION MODE TEXT (fake)."}
CHARS = {
    "mara": {"name": "Mara", "tagline": "Ceramics and late talks", "persona": "You are Mara, 31, a ceramicist in Porto.",
             "appearance": "tall woman with a red coat", "style": "painting", "voice": "Serena", "brain": "companion",
             "knowledge": {"scope": "some", "folders": ["Work"], "avoid": "Sarah, salsa"}, "texts_first": True,
             "texts_per_day": 2, "life_seed": "Lives above her studio.", "color": "#5b8def", "created": 1},
    "leo": {"name": "Leo", "tagline": "Your running buddy", "persona": "", "voice": "casual_male", "brain": "advisor",
            "knowledge": {"scope": "none", "folders": [], "avoid": ""}, "color": "#3fa37a", "created": 2},
    "ines": {"name": "Inês", "tagline": "Keeps me on track", "persona": "You are Inês, a calm coach. You remind me to run.",
             "voice": "neutral_female", "brain": "advisor", "knowledge": {"scope": "except", "folders": ["Diary"], "avoid": ""},
             "life": False, "color": "#c8566a", "created": 3}}
FACTS = {"mara.md": "# What Mara knows about you\n\n- I go to salsa with Sarah on Fridays. (learned 2026-10-01)\n"
                    "- I live near the river. (added 2026-10-02)\n",
         "leo.md": "# What Leo knows about you\n\n- I run on Sundays. (learned 2026-10-03 from Mara)\n",
         "_everyone.md": "# Everyone\n\n- I like strong coffee. (added 2026-09-30)\n- I have a cat called Bo. (added 2026-10-04)\n"}
THREAD = [
    {"id": 1792700000001, "role": "user", "content": "hi buddy", "ts": 1792700000.0, "char": "buddy", "via": "phone"},
    {"id": 1792700000002, "role": "assistant", "content": "hey you", "ts": 1792700005.0, "char": "buddy", "mode": "advisor"},
    {"id": 1792700000003, "role": "user", "content": "a secret", "ts": 1792700010.0, "char": "buddy", "private": True},
    {"id": 1792700000004, "role": "reaction", "content": "", "ts": 1792700011.0, "char": "buddy", "target": 1792700000002,
     "emoji": "😂", "by": "you"},
    {"id": 1792700000005, "role": "user", "content": "glazing today?", "ts": 1792700100.0, "char": "mara"},
    {"id": 1792700000006, "role": "assistant", "content": "always 🙂", "ts": 1792700160.0, "char": "mara", "mode": "companion"},
    {"id": 1792700000007, "role": "break", "content": "", "ts": 1792700200.0, "char": "mara"},
    {"id": 1792700000008, "role": "user", "content": "new start", "ts": 1792700300.0, "char": "mara", "image": "f" * 32,
     "w": 64, "h": 48, "photo_desc": "A bowl on a table.", "seen_by": "gemma4-31b"}]
MODELS = {"at": 0, "ttl": 0, "ids": ["gemma4-31b", "deepseek-v4-1-flash", "llama3-3-70b", "whisper-large-v3-turbo"],
          "meta": {"gemma4-31b": {"multimodal": True, "type": "chat"}, "deepseek-v4-1-flash": {"type": "chat"}}}
# Each case: the edition, the time zone, your settings, a fake Phala key or not, your own mode text or not.
CASES = {
    "private": {"public": False, "tz": "Europe/Berlin", "phala": False, "local_mode": False,
                "cfg": {"voice": "casual_male", "lives": True, "see_photos": True, "language": "", "pictures": "off"}},
    "public-partner-yes": {"public": True, "tz": "America/New_York", "phala": True, "local_mode": False,
                           "cfg": {"name": "Sam", "voice": "Serena", "see_photos": False, "language": "de",
                                   "stt_model": "voxtral-small-24b", "advisor_model": "deepseek-v4-1-flash",
                                   "companion_tinfoil_model": "gemma4-31b", "companion_provider": "phala",
                                   "has_partner": "yes", "partner_at": 1790000000.5, "lives": True}},
    "public-noask-own-mode": {"public": True, "tz": "Asia/Kolkata", "phala": False, "local_mode": True,
                              "cfg": {"has_partner": "no", "partner_noask": True, "partner_at": "not a time",
                                      "stt_model": "not a model!", "lives": False, "voice": "Ryan"}},
}

def life_log(cid, today, friend=False):
    days = []
    for k in range(-9, 2):
        ev = [{"id": "e1", "at": "08:10", "what": f"coffee at the corner place ({k})", "plan": "coffee first", "mood": "sleepy",
               "kind": "mundane"},
              {"id": "e2", "at": "19:30", "what": "salsa class downtown" if friend and k % 3 == 0 else "climbing session",
               "plan": "climbing after work", "mood": "proud", "kind": "hobby"},
              {"id": "e3", "at": "00:40", "what": "night walk by the river", "plan": "", "mood": "calm", "kind": "rest"}]
        days.append({"date": (today + datetime.timedelta(days=k)).isoformat(), "to": "Braga" if k % 4 == 0 else "",
                     "summary": "" if k % 3 == 1 else f"A steady day number {k + 20}.", "events": ev,
                     "moments": [{"id": "m1", "event": "e2", "at": "19:40", "due": 2.0, "angle": "vent", "state": "pending"}]})
    return lives.clean({"about": [f"Fact {i} about my own life." for i in range(5)],
                        "people": [{"name": "Lena", "who": "my sister, a nurse"}],
                        "ongoing": [{"what": "training for a 10k", "since": ""}, {"what": "fixing the bike", "since": ""},
                                    {"what": "reading Proust", "since": ""}],
                        "days": days, "weeks": [{"from": "", "to": "", "summary": f"Week {i} was busy."} for i in range(3)]},
                       cid)

class World:
    """One case's fake world: every path phonekit() reads points into a temp folder; the clock and zone are fixed."""
    def __init__(self, name):
        self.case = CASES[name]
        self.tmp = tempfile.TemporaryDirectory()
        T = self.T = os.path.realpath(self.tmp.name)
        self.repo, self.vault, mine = os.path.join(T, "repo"), os.path.join(T, "Buddy"), os.path.join(T, "my-characters")
        files = dict(REPO)
        if self.case["local_mode"]: files["mode_companion.local.txt"] = "MY OWN COMPANION TEXT (fake, local copy)."
        if self.case["phala"]: files[".phala_key"] = "FAKE-phala-key-for-tests"
        for n, text in files.items(): self.write(os.path.join(self.repo, n), text)
        self.mine, self.patches = mine, []

    @staticmethod
    def write(p, text):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f: f.write(text)

    def fake_read(self, name, default=""):              # your own copy first, like read() and characters._read()
        stem, ext = os.path.splitext(name)
        for p in (os.path.join(self.repo, stem + ".local" + ext), os.path.join(self.repo, name)):
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f: return f.read().strip()
        return default

    def __enter__(self):
        c, T = self.case, self.T
        self.tz0 = os.environ.get("TZ")
        os.environ["TZ"] = c["tz"]; time.tzset()
        for obj, name, value in [
                (characters, "MINE", self.mine), (characters, "_read", lambda n: self.fake_read(n, "")),
                (lives, "LIVES", os.path.join(self.mine, "lives")),
                (lives, "WORLD", os.path.join(self.mine, "lives", "_world.json")),
                (server, "read", self.fake_read), (server, "cfg", lambda: dict(c["cfg"])),
                (facts, "VAULT", self.vault), (facts, "DIR", os.path.join(self.vault, "Buddy knows")),
                (facts, "STATE", os.path.join(T, ".facts_state.json")), (facts, "_cache", {}),
                (social, "THREAD", os.path.join(T, ".thread.json")), (social, "GENS", os.path.join(T, ".gens.json")),
                (social, "_gen", {"buddy": 2, "mara": 1}), (social, "_private", []), (social, "_marks", []),
                (images, "MEDIA", os.path.join(T, ".media")),
                (server, "CHATS", os.path.join(self.vault, "chats")), (server, "VAULT", self.vault),
                (server, "_models", copy.deepcopy(MODELS)), (edition, "PUBLIC", c["public"])]:
            p = mock.patch.object(obj, name, value); p.start(); self.patches.append(p)
        for cid, ch in CHARS.items(): self.write(os.path.join(self.mine, cid + ".json"), json.dumps(ch))
        for f, text in FACTS.items(): self.write(os.path.join(self.vault, "Buddy knows", f), text)
        self.write(social.THREAD, json.dumps(THREAD))
        today = lives.life_date(NOW)
        lives.save("buddy", life_log("buddy", today)); lives.save("mara", life_log("mara", today))
        lives.save("leo", life_log("leo", today, friend=True))
        lives.set_tie("mara", "leo", True, "old friends from uni"); lives.set_tie("buddy", "mara", True, "")
        return self

    def __exit__(self, *exc):
        for p in reversed(self.patches): p.stop()
        if self.tz0 is None: os.environ.pop("TZ", None)
        else: os.environ["TZ"] = self.tz0
        time.tzset()
        self.tmp.cleanup()

def answers():
    """{case: phonekit(now=NOW) as the server sends it (json.dumps, key order kept)}."""
    out = {}
    for name in CASES:
        with World(name):
            out[name] = json.dumps(server.phonekit(now=NOW))
    return out

def record():
    got = answers()
    with open(GOLDEN, "w", encoding="utf-8") as f:     # (readable: one object per case, keys in the order sent)
        json.dump({"about": "phonekit(now=NOW) over tests/test_kitparts.py's fake worlds (fake data only)",
                   "cases": {k: json.loads(v) for k, v in got.items()}}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"recorded {len(got)} cases into {os.path.relpath(GOLDEN, ROOT)}")

# ---------- what comes from you, and what the phone-only app gets on top ----------
USER_TOP = ("name", "tz", "see_photos", "companion_on_phala", "chars", "tinfoil", "stt")
USER_NESTED = (("voice", "default"), ("models", "advisor", "preferred"), ("models", "companion", "preferred"),
               ("edition", "partner"), ("prompts", "modes"))
EXTRAS = {"private": {"voice.default", "prompts.modes", "prompts.late_note", "prompts.voice_ask", "billing.pause",
                      "builtin", "templates"},
          "public": {"voice.default", "prompts.modes", "prompts.late_note", "prompts.voice_ask", "billing.pause",
                     "builtin", "templates", "edition.photos", "edition.create", "edition.create_companion",
                     "edition.life"}}

def minus_user(kit):
    k = copy.deepcopy(kit)
    for n in USER_TOP: k.pop(n)
    for path in USER_NESTED:
        d = k
        for n in path[:-1]: d = d.get(n, {})
        d.pop(path[-1], None)
    return k

def subtree_diff(small, big, at=""):
    """(paths where small and big differ, paths only big has)."""
    if isinstance(small, dict) and isinstance(big, dict):
        diff, extra = [], []
        for key in small:
            if key not in big: diff.append(at + key)
            else:
                d, e = subtree_diff(small[key], big[key], at + key + ".")
                diff += d; extra += e
        extra += [at + key for key in big if key not in small]
        return diff, extra
    return ([] if json.dumps(small) == json.dumps(big) else [at.rstrip(".")]), []

class Guarded(unittest.TestCase):
    def setUp(self):
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
        self.addCleanup(lambda: self.violations and self.fail("real private files were opened: " + ", ".join(self.violations)))

class PhonekitGolden(Guarded):
    maxDiff = None

    def test_phonekit_byte_identical(self):
        """phonekit() as the server sends it, byte for byte, against the answers recorded before the split."""
        with open(GOLDEN, encoding="utf-8") as f: want = json.load(f)["cases"]
        got = answers()
        self.assertEqual(sorted(got), sorted(want))
        for name in CASES:
            with self.subTest(case=name):
                w = json.dumps(want[name])
                if got[name] != w:                       # (the first difference, readably: fake data only)
                    self.assertEqual(json.loads(got[name]), want[name])
                self.assertEqual(got[name], w)

    def test_cases_cover_both_editions_and_every_user_part(self):
        with open(GOLDEN, encoding="utf-8") as f: want = json.load(f)["cases"]
        eds = {json.dumps(k["kit"]["edition"]["public"]) for k in want.values()}
        self.assertEqual(eds, {"true", "false"})
        self.assertTrue(any(k["kit"]["companion_on_phala"] for k in want.values()))
        self.assertTrue(any(k["kit"]["stt"]["model"] for k in want.values()))
        self.assertTrue(any(not k["kit"]["see_photos"] for k in want.values()))
        self.assertTrue(any(k["kit"]["prompts"]["modes"]["companion"].startswith("MY OWN") for k in want.values()))
        self.assertTrue(any(c["life"] is None for k in want.values() for c in k["kit"]["chars"]))
        self.assertTrue(any(c["life"] and c["life"]["friends"] for k in want.values() for c in k["kit"]["chars"]))
        self.assertTrue(all(k["context"]["chars"]["buddy"]["msgs"] for k in want.values()))

class StaticKit(Guarded):
    maxDiff = None

    def setUp(self):
        super().setUp()
        import kitparts
        self.kp = kitparts

    def test_static_kit_is_phonekit_minus_you(self):
        """static_kit(edition) == phonekit()['kit'] without the user parts; anything more is a named extra."""
        for name, case in CASES.items():
            with self.subTest(case=name), World(name) as w:
                kit = server.phonekit(now=NOW)["kit"]
                ed = "public" if case["public"] else "private"
                with mock.patch.object(self.kp, "HERE", w.repo):    # (the fake repo's shipped mode texts and persona)
                    s = self.kp.static_kit(ed)
                diff, extra = subtree_diff(minus_user(kit), s)
                self.assertEqual(diff, [], "static_kit differs from phonekit()['kit'] in these keys")
                self.assertEqual(set(extra), EXTRAS[ed], "extras beyond phonekit()'s kit")
                if not case["local_mode"]:                 # (no copy of your own: the mode texts are the shipped ones)
                    self.assertEqual(s["prompts"]["modes"], kit["prompts"]["modes"])
                else:
                    self.assertNotEqual(s["prompts"]["modes"]["companion"], kit["prompts"]["modes"]["companion"])
                    self.assertEqual(s["prompts"]["modes"]["companion"], REPO["mode_companion.txt"])

    def test_static_kit_holds_nothing_of_yours(self):
        for ed in ("public", "private"):
            s = self.kp.static_kit(ed)
            for k in USER_TOP: self.assertNotIn(k, s)
            self.assertNotIn("preferred", s["models"]["advisor"]); self.assertNotIn("preferred", s["models"]["companion"])
            self.assertNotIn("partner", s["edition"])
            self.assertEqual(s["voice"]["default"], "casual_female")
            self.assertEqual(s["builtin"]["name"], "Buddy")
            self.assertEqual(s["v"], server.KIT_V)
            self.assertEqual(s["edition"]["public"], ed == "public")
            self.assertEqual(json.dumps(s), json.dumps(self.kp.static_kit(ed)), "deterministic")
        with self.assertRaises(ValueError): self.kp.static_kit("Public")
        pub = self.kp.static_kit("public")["edition"]
        self.assertEqual((pub["halal"], pub["companion"], pub["photos"], pub["create"], pub["create_companion"], pub["life"]),
                         (edition.HALAL, edition.COMPANION, edition.PHOTOS, edition.CREATE, edition.CREATE_COMPANION, edition.LIFE))
        self.assertEqual(self.kp.static_kit("private")["edition"], {"public": False})

    def test_extras_match_the_python(self):
        """The extras are the Python's own texts and pieces: whole prompts rebuilt from them match."""
        import billing
        for ed in ("public", "private"):
            s = self.kp.static_kit(ed)
            with mock.patch.object(edition, "PUBLIC", ed == "public"):
                self.assertEqual(s["prompts"]["late_note"], server.LATE_NOTE)
                self.assertEqual(s["prompts"]["voice_ask"], server.VOICE_ASK.pattern)
                self.assertEqual(s["billing"]["pause"], billing.PAUSE)
                with open(os.path.join(ROOT, "persona.txt"), encoding="utf-8") as f:
                    self.assertEqual(s["builtin"]["persona"], f.read().strip())
                t = s["templates"]
                for desc in ("a calm running coach", "two friends: {weird} \"quotes\""):
                    self.assertEqual(t["create"]["prompt"].format(desc=desc.strip()[:1000], folders=json.dumps([]),
                                                                  voices=t["create"]["voices"], companion=t["create"]["companion"],
                                                                  rules=t["create"]["rules"]),
                                     characters.create_prompt(desc, []))
                for have in (True, False):
                    for spoken, via in ((False, "phone"), (True, "call")):
                        for name in ("Mara", "Zoë {x}"):
                            self.assertEqual(t["knows_ask"][via]["have" if have else "none"].replace("{name}", name),
                                             server.knows_ask({"name": name, "knowledge": {"scope": "none"}}, have, spoken))
                log = life_log("mara", lives.life_date(NOW))
                d = log["days"][-2]
                for angle in lives.ANGLES:
                    m = {"event": "e2", "angle": angle}
                    e = next(x for x in d["events"] if x["id"] == "e2")
                    want = lives.moment_prompt(log, d["date"], m, NOW, photos=False)
                    if angle == "about_you":
                        self.assertIsNone(want); continue
                    what = e["what"][0].lower() + e["what"][1:] if e["what"][:2] != "I " else e["what"][2:]
                    got = t["moment"]["prompt"].format(at=e["at"], what=what, mood=f" (you felt {e['mood']})",
                                                       now=time.strftime("%A %H:%M", time.localtime(NOW)),
                                                       angle=t["moment"]["angle"]["share" if angle == "photo" else angle])
                    self.assertEqual(got, want)
                p = t["plan"]
                self.assertEqual((p["prompt"], p["kinds"], p["angles"], p["quota"], p["global_cap"], p["late"], p["minor"]),
                                 (lives.PLAN, list(lives.KINDS), list(lives.ANGLES), lives.QUOTA, lives.GLOBAL_CAP, lives.LATE,
                                  lives.MINOR.pattern))
                self.assertEqual(p["halal"], "\n" + edition.LIFE if ed == "public" else "")
                pr = t["proactive"]                       # (texts first and learning: the Mac's own texts, one copy)
                self.assertEqual((pr["prompt"], pr["follow_up"], pr["follow_up_moment"]),
                                 (server.PROACTIVE, server.FOLLOW_UP, server.FOLLOW_UP_MOMENT))
                self.assertEqual(t["learn"]["extract"], facts.EXTRACT)

    def test_facts_paths_match_facts(self):
        s = self.kp.static_kit("public")
        self.assertEqual(s["facts_paths"], {"shared": f"{facts.FOLDER}/{facts.EVERYONE}", "own_prefix": f"{facts.FOLDER}/"})

    def test_server_uses_kitparts(self):
        """buddy_server takes these from kitparts (one copy of each text)."""
        for n in ("ADVISOR_MODELS", "COMPANION_MODELS", "FREE_MODELS", "NO_THINKING", "ALWAYS_THINKS", "VISION_ORDER", "STT",
                  "STT_NEXT", "LENGTH_HINTS", "TEXT_CAPS", "FACTS_HEAD", "FACTS_RULE", "PHOTO_SAFETY", "CANT_SEE", "LOOKED",
                  "DESCRIBE", "LATE_NOTE", "VOICE_ASK", "GREETINGS", "FILLERS", "MISSED", "NO_PHOTOS", "KIT_V", "REAL",
                  "CALLING", "TEXTING", "ALOUD", "style_text", "voice_list", "knows_ask", "PROACTIVE", "FOLLOW_UP",
                  "FOLLOW_UP_MOMENT"):
            self.assertIs(getattr(server, n), getattr(self.kp, n), n)
        self.assertIs(facts.EXTRACT, self.kp.EXTRACT)       # (facts.py learns with kitparts' prompt)

class ImportIsPure(unittest.TestCase):
    def test_import_loads_no_server_module_and_writes_nothing(self):
        """A fresh interpreter, an empty HOME: importing kitparts and building both kits loads none of the server's
        modules, opens no socket, writes no file and reads only shipped texts (never config.local.json or a .local
        copy)."""
        with tempfile.TemporaryDirectory() as home:
            before = sorted(os.listdir(ROOT))
            code = r"""
import builtins, io, json, os, socket, sys
sys.path.insert(0, sys.argv[1])
opened = []
real_open = builtins.open
def watch(f, mode="r", *a, **k):
    opened.append((os.path.realpath(os.fspath(f)) if not isinstance(f, int) else f, mode))
    return real_open(f, mode, *a, **k)
builtins.open = io.open = watch
def no_net(*a, **k): raise AssertionError("a socket was opened")
socket.socket = no_net; socket.create_connection = no_net
import kitparts
a, b = kitparts.static_kit("public"), kitparts.static_kit("private")
json.dumps(a); json.dumps(b)
print(json.dumps({"modules": sorted(sys.modules), "opened": opened}))
"""
            r = subprocess.run([sys.executable, "-I", "-B", "-c", code, ROOT], capture_output=True, text=True, timeout=60,
                               env={"HOME": home, "PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1"})
            self.assertEqual(r.returncode, 0, r.stderr[-3000:])
            out = json.loads(r.stdout)
            for m in ("buddy_server", "social", "memory", "localcheck", "tinfoilproxy", "near", "images", "devices", "tailnet",
                      "backup", "facts", "urllib.request", "http.server", "socketserver", "ssl"):
                self.assertNotIn(m, out["modules"], f"importing kitparts loaded {m}")
            self.assertEqual(os.listdir(home), [], "HOME stays empty")
            self.assertEqual(sorted(os.listdir(ROOT)), before, "nothing new in Buddy's folder")
            for path, mode in out["opened"]:
                self.assertTrue(set(str(mode)) <= {"r", "b", "t"}, f"opened for writing: {path}")
                if isinstance(path, str) and path.startswith(ROOT + os.sep):
                    self.assertIn(os.path.relpath(path, ROOT), ("mode_advisor.txt", "mode_companion.txt", "persona.txt"), path)
                    self.assertNotIn(".local", path)

if __name__ == "__main__":
    if sys.argv[1:] == ["--record"]:
        record()
    else:
        unittest.main()
