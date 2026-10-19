"""The public edition (edition.py): Islamic guidelines in every prompt that makes character text, only where edition.json
is (the public copy, written by publish.sh), with no way to switch them off; the relationship status and its hidden
[partner: …] tag. Fake data only (no network, notes, thread or keys; every file goes to a temporary folder).
Run from Buddy's folder:  python3 -m unittest discover -s tests -v"""
import http.client, json, os, shutil, subprocess, sys, tempfile, threading, time, unittest
from http.server import ThreadingHTTPServer
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import characters, devices, edition, facts, images, lives, social
import buddy_server as server

CHAR = {"id": "maya", "name": "Maya", "persona": "You are Maya.", "brain": "advisor", "knowledge": {"scope": "none"}}
BOTH = (True, False)                                    # (with and without edition.json)

def read(p):
    with open(p) as f: return f.read()

def prompt(via="phone", mode="advisor", cfg=None, pics=None, **kw):
    """A system prompt with everything around it faked (no notes, facts, life or picture maker)."""
    with mock.patch.object(server, "life_block", lambda c, v: ""), mock.patch.object(server, "recall", lambda *a, **k: []), \
         mock.patch.object(facts, "for_prompt", lambda *a, **k: ([], [])), \
         mock.patch.object(server, "since_last_talk", lambda *a, **k: ""), \
         mock.patch.object(server.images, "find", lambda c: pics), mock.patch.object(server, "cfg", lambda: cfg or {}):
        return server.system_prompt(CHAR, mode, "hi", None, via=via, **kw)

class TheFile(unittest.TestCase):                      # edition.json decides, read once at start, nothing else does
    def test_present_means_public(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(edition.is_public(d))
            with open(os.path.join(d, "edition.json"), "w") as f: f.write('{"edition": "public"}')
            self.assertTrue(edition.is_public(d))
            with open(os.path.join(d, "edition.json"), "w") as f: f.write("not json {")
            self.assertTrue(edition.is_public(d))         # (a damaged file still counts: it fails closed)
        self.assertEqual(edition.PUBLIC, edition.is_public(ROOT))

    def test_no_env_var_or_setting_changes_it(self):
        env = {**os.environ, "BUDDY_EDITION": "private", "EDITION": "private", "HALAL": "0", "PUBLIC_EDITION": "0"}
        for public in BOTH:
            with tempfile.TemporaryDirectory() as d:
                shutil.copy(os.path.join(ROOT, "edition.py"), d)
                with open(os.path.join(d, "config.local.json"), "w") as f:
                    json.dump({"edition": "private", "halal": False, "public_edition": False}, f)
                if public:
                    with open(os.path.join(d, "edition.json"), "w") as f: f.write('{"edition": "public"}')
                out = subprocess.run([sys.executable, "-B", "-c", "import edition; print(edition.PUBLIC)"], cwd=d, env=env,
                                     capture_output=True, text=True, timeout=30)
                self.assertEqual(out.stdout.strip(), str(public), out.stderr)
        src = read(os.path.join(ROOT, "edition.py"))
        self.assertNotIn("environ", src)                  # (no env var is ever read for it)

class EveryPrompt(unittest.TestCase):                  # the rules in every kind of prompt, only in the public edition
    def test_chats_calls_and_texts_first(self):
        for public in BOTH:
            with mock.patch.object(edition, "PUBLIC", public):
                kinds = {"phone": prompt("phone"), "mac": prompt("mac", spoken=True), "mac quiet": prompt("mac", spoken=False),
                         "call": prompt("call"), "texts first": prompt("phone", proactive=True),
                         "companion": prompt("phone", mode="companion")}
                for kind, p in kinds.items():
                    self.assertEqual(edition.HALAL in p, public, kind)
                    self.assertEqual("[partner: yes]" in p, public, kind)
                    self.assertTrue(p.index("Right now it's") > (p.index(edition.HALAL) if public else -1), kind)
                comp = kinds["companion"]
                self.assertEqual(edition.COMPANION in comp, public)
                self.assertEqual(server.read("mode_companion.txt") in comp, not public)   # ("nothing is off-limits")
                p = prompt("phone", length=server.length_hint("lol", "phone"))
                self.assertTrue(p.endswith(server.length_hint("lol", "phone")))           # (the length line stays last)
                pics = prompt("phone", pics={"provider": "local"})
                self.assertIn(server.PHOTOS, pics); self.assertEqual(edition.PHOTOS in pics, public)

    def test_first_text_and_voice_messages_use_it(self):                    # texts first, life moments, their voice notes
        for public in BOTH:
            sent = {}
            class R:
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def read(self): return json.dumps({"choices": [{"message": {"content": "[partner: no] guess what"}}]}).encode()
            def post(url, key, body, ctype="", timeout=0):
                sent["body"] = json.loads(body); return R()
            with mock.patch.object(edition, "PUBLIC", public), mock.patch.object(server, "post", post), \
                 mock.patch.object(server, "brain", lambda m, spoken=False, free_ok=False: ("http://x/v1", "k", "m", "advisor")), \
                 mock.patch.object(server.social, "recent_messages", lambda *a, **k: []), \
                 mock.patch.object(server, "life_block", lambda c, v: ""), mock.patch.object(server, "recall", lambda *a, **k: []), \
                 mock.patch.object(facts, "for_prompt", lambda *a, **k: ([], [])), \
                 mock.patch.object(server, "since_last_talk", lambda *a, **k: ""), \
                 mock.patch.object(server.images, "find", lambda c: None), mock.patch.object(server, "cfg", lambda: {}):
                txt, scene, _ = server.first_text(CHAR, "text me about your day", 10)
            self.assertEqual(edition.HALAL in sent["body"]["messages"][0]["content"], public)
            self.assertEqual(txt, "guess what")                                        # (tags never reach you)

    def test_creating_characters(self):
        for public in BOTH:
            with mock.patch.object(edition, "PUBLIC", public):
                p = characters.create_prompt("a fun friend", ["Work"])
            self.assertEqual(edition.CREATE in p, public); self.assertEqual(edition.CREATE_COMPANION in p, public)
            self.assertEqual("uncensored" in p, not public)
            self.assertIn("ADULT", p); self.assertNotIn("{companion}", p); self.assertNotIn("{rules}", p)

    def test_planning_their_days(self):
        maya = {"id": "maya", "name": "Maya", "persona": "You are Maya, 29.", "texts_first": True, "life": True}
        for public in BOTH:
            with mock.patch.object(edition, "PUBLIC", public):
                p, _ = lives.plan_prompt(maya, lives.empty("maya"), time.time(), {"quiet_from": 23.0, "quiet_until": 8.5})
            self.assertEqual(edition.LIFE in p, public)
            self.assertIn("no children or teens in it at all.", p)

    def test_pictures(self):
        for public in BOTH:
            with mock.patch.object(edition, "PUBLIC", public):
                p = images.prompt_for("short dark hair, green eyes", "reading in a café")
                self.assertEqual(images.MODEST in p, public)
                self.assertTrue(p.startswith(images.ADULT + images.ORIGINAL))
                self.assertEqual(images.MODEST in images.prompt_for("short hair", "at the park", style="anime"), public)
                for bad in ("me in a bikini at the beach", "a glass of wine at dinner", "in lingerie", "at the casino",
                            "cocktails with friends", "a sexy outfit", "in a crop top", "at a bar with friends",
                            "a pint after work", "bacon for breakfast", "at a nightclub"):
                    if public:
                        with self.assertRaises(ValueError, msg=bad) as e: images.prompt_for("short hair", bad)
                        self.assertEqual(str(e.exception), images.ONLY_MODEST)
                        with self.assertRaises(ValueError, msg=bad): images.wall_prompt(bad)
                    else:
                        images.prompt_for("short hair", bad); images.wall_prompt(bad)
                for fine in ("at the beach in a long dress", "a wine-red scarf", "drinking tea at a café", "hiking",
                             "in a cocktail dress", "in a modest swimsuit", "a chocolate bar"):
                    images.prompt_for("short hair", fine)
                with self.assertRaises(ValueError) as e: images.prompt_for("short hair", "a 15 year old in a bikini")
                self.assertEqual(str(e.exception), images.ONLY_ADULTS)           # (the adults rule still comes first)

class Romance(unittest.TestCase):                      # married or in a relationship: yes / no / not known / long ago
    def test_texts(self):
        now = time.time()
        unknown, yes = edition.romance("", None, now), edition.romance("yes", now, now)
        fresh, old, never = edition.romance("no", now - 86400, now), edition.romance("no", now - 200 * 86400, now), \
            edition.romance("no", None, now)
        for t in (unknown, yes, fresh, old, never):
            self.assertIn("never sexual or explicit", t); self.assertIn("[partner: yes] or [partner: no]", t)
            self.assertIn("[partner: noask]", t)
        self.assertIn("ask me once", unknown)
        self.assertIn("no flirting, romance or pet names like \"babe\"", yes); self.assertIn("very close, warm and caring", yes)
        self.assertNotIn("months ago", yes)
        self.assertIn("flirting and romance are fine", fresh); self.assertIn("Once in a blue moon", fresh)
        self.assertNotIn("months ago", fresh)
        self.assertNotIn("months ago", edition.romance("no", now - 90 * 86400, now))     # (not before ~6 months)
        self.assertIn("months ago", old); self.assertIn("months ago", never)
        self.assertEqual(edition.romance("maybe", now, now), unknown)
        self.assertIn("months ago", edition.romance("no", "yesterday", now))   # (a hand-edited setting never breaks a chat)
        quiet = edition.romance("no", now - 400 * 86400, now, noask=True)        # "don't keep asking"
        self.assertIn("never do: it's on me to tell you", quiet)
        self.assertNotIn("blue moon", quiet); self.assertNotIn("months ago", quiet)
        self.assertIn("unless I tell you I'm single", edition.romance("", None, now, noask=True))
        self.assertNotIn("ask me once", edition.romance("", None, now, noask=True))

    def test_prompt_follows_the_setting(self):
        now = time.time()
        with mock.patch.object(edition, "PUBLIC", True):
            for c, want in (({}, "ask me once"), ({"has_partner": "yes", "partner_at": now}, "no flirting"),
                            ({"has_partner": "no", "partner_at": now}, "flirting and romance are fine"),
                            ({"has_partner": "no", "partner_at": now - 200 * 86400}, "months ago"),
                            ({"has_partner": "no", "partner_at": now, "partner_noask": True}, "never do")):
                self.assertIn(want, prompt("phone", cfg=c), c)
        with mock.patch.object(edition, "PUBLIC", False):
            self.assertNotIn("Romance:", prompt("phone", cfg={"has_partner": "no", "partner_at": now}))

def sse(*pieces):
    """A streamed answer, as Tinfoil sends it."""
    return [f"data: {json.dumps({'choices': [{'delta': {'content': p}}]})}\n".encode() for p in pieces] + \
        [f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})}\n".encode(), b"data: [DONE]\n"]

class Server(unittest.TestCase):                       # through the real handler, with a fake brain
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); d = self.tmp.name
        self.local, self.said, self.asked = {"save_chats": True, "lives": False, "real_timing": False}, [], []
        self.answer = sse("[partner: ", "yes] Oh wow, congrats on the wedding!", "\n\nTell me everything.")
        def save_cfg(**changes): self.local.update(changes)
        def post(url, key, body, ctype="", timeout=0):
            self.asked.append(json.loads(body))
            answer = self.answer
            class R:
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def __iter__(self): return iter(answer)
            return R()
        def tts(text, voice):
            self.said.append(text); return b"RIFF-fake"
        for obj, name, value in [(social, "THREAD", os.path.join(d, ".thread.json")), (social, "_private", []),
                                 (social, "_marks", []), (social, "push", lambda *a, **k: 0),
                                 (social, "VAPID", os.path.join(d, ".vapid.json")), (social, "SUBS", os.path.join(d, ".subs.json")),
                                 (characters, "MINE", os.path.join(d, "my-characters")),
                                 (devices, "FILE", os.path.join(d, ".devices.json")),
                                 (devices, "MAC_TOKEN", os.path.join(d, ".mac_token")),
                                 (server, "CHATS", os.path.join(d, "chats")), (server, "recall", lambda *a, **k: []),
                                 (server, "local_cfg", lambda: dict(self.local)), (server, "save_cfg", save_cfg),
                                 (server, "brain", lambda mode, spoken=False, free_ok=False: ("http://127.0.0.1:9/v1", "k", "fake", "advisor")),
                                 (server, "post", post), (server, "tts_wav", tts), (server, "wav_seconds", lambda w: 1.0),
                                 (server.images, "save_audio", lambda data, private=False: "f" * 32),
                                 (server.images, "find", lambda c: None),
                                 (facts, "for_prompt", lambda *a, **k: ([], [])), (facts, "kick", lambda *a, **k: None)]:
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)
        for d_ in (server._call_seen, server._live):     # (a fake call here mustn't look like a call to later tests)
            p = mock.patch.dict(d_, clear=True); p.start(); self.addCleanup(p.stop)
        devices.ensure(); self.cookie = devices.mac_token()
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    def call(self, method, path, body=None):
        port = self.srv.server_address[1]
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        c.request(method, path, body=json.dumps(body).encode() if body is not None else None,
                  headers={"Host": f"127.0.0.1:{port}", "Content-Type": "application/json", "Cookie": f"buddy={self.cookie}"})
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, data

    def chat(self, text, via="phone", private=False):
        status, data = self.call("POST", "/api/chat", {"text": text, "char": "buddy", "private": private, "via": via})
        self.assertEqual(status, 200)
        return [json.loads(x) for x in data.decode().splitlines() if x.strip()]

    def saved(self):
        out = ""
        for root, _, files in os.walk(os.path.join(self.tmp.name, "chats")):
            for f in files: out += read(os.path.join(root, f))
        return out

    def test_tag_updates_the_setting_and_is_never_shown_kept_said_or_saved(self):
        for public in BOTH:
            with mock.patch.object(edition, "PUBLIC", public):
                self.local.pop("has_partner", None); self.local.pop("partner_at", None); self.said.clear()
                texted = self.chat("I got married last week")
                self.assertEqual([x["s"] for x in texted if "s" in x], ["Oh wow, congrats on the wedding!", "Tell me everything."])
                self.answer = sse("[partner: no] Oh no, I'm sorry.", " That's a lot.")
                self.assertEqual(self.local.get("has_partner"), "yes" if public else None)
                called = self.chat("we broke up", via="call")
                self.assertEqual(self.local.get("has_partner"), "no" if public else None)    # (in a call too)
                self.answer = sse("[partner: yes] ", "Okay, recording one now!")
                voiced = self.chat("send me a voice message")
                self.answer = sse("[partner: yes] Oh wow, congrats on the wedding!", "\n\nTell me everything.")
                lines = json.dumps(texted + called + voiced)
                self.assertNotIn("partner", lines)                                         # stream
                self.assertTrue(any("s" in x for x in called))
                mine = [m["content"] for m in social.thread() if m["role"] == "assistant"]
                self.assertTrue(mine and not any("partner" in m or "[" in m for m in mine), mine)   # thread
                self.assertEqual(self.said, ["Okay, recording one now!"])                 # spoken (their voice message)
                self.assertIn("congrats on the wedding", self.saved()); self.assertNotIn("partner", self.saved())   # saved chats
                if public:
                    self.assertEqual(self.local["has_partner"], "yes")                    # (the last thing said: yes)
                    self.assertLess(time.time() - self.local["partner_at"], 60)
                else:
                    self.assertNotIn("has_partner", self.local)                          # (private edition: no such rule)
                self.call("POST", "/api/newchat", {"char": "buddy"})

    def test_stop_asking_and_private_chats(self):
        with mock.patch.object(edition, "PUBLIC", True):
            self.local.update({"has_partner": "no", "partner_at": time.time() - 400 * 86400})
            self.answer = sse("[partner: noask] Okay, I won't ask again.", " Just tell me if that ever changes.")
            out = self.chat("please stop asking me about that")
            self.assertEqual([x["s"] for x in out if "s" in x], ["Okay, I won't ask again.", "Just tell me if that ever changes."])
            self.assertTrue(self.local.get("partner_noask")); self.assertEqual(self.local["has_partner"], "no")
            self.answer = sse("hey you!")
            self.chat("hi")
            sp = self.asked[-1]["messages"][0]["content"]
            self.assertIn("never do: it's on me to tell you", sp); self.assertNotIn("blue moon", sp)
            self.assertTrue(json.loads(self.call("GET", "/api/settings")[1])["partner_noask"])
            self.local.update({"has_partner": "yes"})
            self.answer = sse("[partner: no] Oh, I'm sorry.")
            self.chat("we split up", private=True)
            self.assertEqual(self.local["has_partner"], "yes")       # (a private chat may only make it stricter)
            self.local.update({"has_partner": "no"})
            self.answer = sse("[partner: yes] Congrats!")
            self.chat("I'm engaged!", private=True)
            self.assertEqual(self.local["has_partner"], "yes")
            self.assertEqual(self.call("POST", "/api/settings", {"partner_noask": False})[0], 200)
            self.assertFalse(self.local.get("partner_noask"))

    def test_settings_carry_it_and_cannot_turn_the_rules_off(self):
        self.answer = sse("hey you!")                    # (no tag: only the setting changes it here)
        with mock.patch.object(edition, "PUBLIC", True):
            self.local.update({"halal": False, "edition": "private", "public_edition": False, "rules": "off"})
            with mock.patch.dict(os.environ, {"BUDDY_EDITION": "private", "HALAL": "0"}):
                self.assertEqual(self.call("POST", "/api/settings", {"halal": False, "edition": "private",
                                                                     "public_edition": False})[0], 200)
                st = json.loads(self.call("GET", "/api/status")[1])
                self.assertEqual(st["edition"], "public")
                self.chat("hi there")
                self.assertIn(edition.HALAL, self.asked[-1]["messages"][0]["content"])
            self.assertEqual(json.loads(self.call("GET", "/api/settings")[1])["has_partner"], "")
            self.assertEqual(self.call("POST", "/api/settings", {"has_partner": "no"})[0], 200)
            got = json.loads(self.call("GET", "/api/settings")[1])
            self.assertEqual(got["has_partner"], "no"); self.assertLess(time.time() - got["partner_at"], 60)
            self.chat("hey")
            self.assertIn("flirting and romance are fine", self.asked[-1]["messages"][0]["content"])
            self.assertEqual(self.call("POST", "/api/settings", {"has_partner": "maybe"})[0], 400)
            self.assertEqual(self.call("POST", "/api/settings", {"has_partner": ""})[0], 200)
            got = json.loads(self.call("GET", "/api/settings")[1])
            self.assertEqual((got["has_partner"], got["partner_at"]), ("", None))
        with mock.patch.object(edition, "PUBLIC", False):
            self.assertEqual(json.loads(self.call("GET", "/api/status")[1])["edition"], "private")
            self.chat("hi again")
            self.assertNotIn(edition.HALAL, self.asked[-1]["messages"][0]["content"])

ZSH, GIT = shutil.which("zsh"), shutil.which("git")
PUBLISH = os.path.join(ROOT, "scripts", "publish.sh")         # (only in the private repo: not in the public copy)

@unittest.skipUnless(ZSH and GIT and os.path.exists(PUBLISH), "needs zsh, git and scripts/publish.sh (private repo)")
class Publish(unittest.TestCase):                      # publish.sh writes edition.json into the public copy, never here
    def git(self, repo, *a):
        return subprocess.run([GIT, "-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com",
                               "-c", "commit.gpgsign=false", *a], capture_output=True, text=True, check=True)

    def test_parses(self):
        r = subprocess.run([ZSH, "-n", PUBLISH], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_tree_has_edition_json_and_refuses_it_tracked_here(self):
        with tempfile.TemporaryDirectory() as d:
            repo, out, out2 = os.path.join(d, "repo"), os.path.join(d, "out"), os.path.join(d, "out2")
            for p in (repo, out, out2): os.makedirs(p)
            os.makedirs(os.path.join(repo, "scripts")); os.makedirs(os.path.join(repo, "docs"))
            shutil.copy(PUBLISH, os.path.join(repo, "scripts", "publish.sh"))
            shutil.copy(os.path.join(ROOT, ".gitignore"), repo)                 # (edition.json must not be ignored)
            for f in ("CLAUDE.md", "docs/3d-desktop-character.md", "README.md", "buddy_server.py"):
                with open(os.path.join(repo, f), "w") as fh: fh.write("fake\n")
            self.git(repo, "init", "-q"); self.git(repo, "add", "-A"); self.git(repo, "commit", "-q", "-m", "fake")
            r = subprocess.run([ZSH, os.path.join(repo, "scripts", "publish.sh"), "--tree", out], capture_output=True,
                               text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual(json.loads(read(os.path.join(out, "edition.json"))), {"edition": "public"})
            self.assertTrue(edition.is_public(out))
            self.assertTrue(os.path.exists(os.path.join(out, "README.md")) and os.path.exists(os.path.join(out, "buddy_server.py")))
            for gone in ("CLAUDE.md", "scripts/publish.sh", "docs/3d-desktop-character.md"):
                self.assertFalse(os.path.exists(os.path.join(out, gone)), gone)
            self.assertFalse(os.path.exists(os.path.join(repo, "edition.json")))   # (written there, never here)
            for bad in (".", repo, os.path.join(repo, "docs"), out):              # (never into this repo, never over files)
                r = subprocess.run([ZSH, os.path.join(repo, "scripts", "publish.sh"), "--tree", bad], capture_output=True,
                                   text=True, timeout=60, cwd=repo if bad == "." else d)
                self.assertNotEqual(r.returncode, 0, bad)
                self.assertFalse(os.path.exists(os.path.join(repo, "edition.json")), bad)
            ignored = subprocess.run([GIT, "-C", repo, "check-ignore", "-q", "edition.json"]).returncode
            self.assertEqual(ignored, 1)                                             # (so the public copy commits it)
            with open(os.path.join(repo, "edition.json"), "w") as fh: fh.write('{"edition": "public"}')
            self.git(repo, "add", "edition.json"); self.git(repo, "commit", "-q", "-m", "oops")
            r = subprocess.run([ZSH, os.path.join(repo, "scripts", "publish.sh"), "--tree", out2], capture_output=True,
                               text=True, timeout=60)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("Refusing: edition.json is tracked here", r.stdout)
            self.assertEqual(os.listdir(out2), [])

if __name__ == "__main__":
    unittest.main()
