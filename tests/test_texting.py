"""Texting like a person: the style each kind of chat gets, how long a reply should be, and where a runaway reply
stops. Fake data only (no network, no notes, no keys). Run from Buddy's folder:  python3 -m unittest discover -s tests -v"""
import http.client, json, os, re, sys, tempfile, threading, time, unittest
from http.server import ThreadingHTTPServer
from unittest import mock
try: import resource
except ImportError: resource = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import characters, devices, facts, social
import buddy_server as server

CHAR = {"id": "maya", "name": "Maya", "persona": "You are Maya.", "brain": "advisor", "knowledge": {"scope": "none"}}

class Length(unittest.TestCase):
    def test_hint_follows_what_you_sent(self):
        self.assertIn("tiny", server.length_hint("lol same", "phone"))
        self.assertIn("one or two", server.length_hint("so i went to the store and they were out of the oat milk again", "mac"))
        self.assertIn("Two or three", server.length_hint(" ".join(["word"] * 40), "phone"))
        for asks in ("can you explain how this works", "help me write a message to my boss", "what should i do",
                     "tell me more", "walk me through it step by step", "pros and cons?"):
            self.assertIn("longer if it really needs it", server.length_hint(asks, "phone"), asks)
        self.assertEqual(server.length_hint("hi", "call"), "")      # (calls have their own rule)

    def test_runaway_cap(self):
        self.assertEqual(server.long_enough("hey how was your day", "phone"), (2, 30))      # a few words: a few back
        self.assertEqual(server.long_enough("so i went to the store and they were out of oat milk again, unbelievable", "phone"), (3, 50))
        self.assertEqual(server.long_enough(" ".join(["word"] * 40), "phone"), (4, 80))
        self.assertIsNone(server.long_enough("explain it to me", "phone"))
        self.assertIsNone(server.long_enough("hi", "call"))
        self.assertIsNone(server.long_enough("x" * 500, "mac"))

class Style(unittest.TestCase):
    def prompt(self, via, spoken=None, length=""):
        with mock.patch.object(server, "life_block", lambda c, v: ""), \
             mock.patch.object(server, "recall", lambda *a, **k: []), \
             mock.patch.object(facts, "for_prompt", lambda *a, **k: ([], [])), \
             mock.patch.object(server, "since_last_talk", lambda *a, **k: ""), \
             mock.patch.object(server.images, "find", lambda c: None):
            return server.system_prompt(CHAR, "advisor", "hi", None, via=via, spoken=spoken, length=length)

    def test_typed_chats_text_like_a_person(self):
        phone, mac, mac_quiet = self.prompt("phone"), self.prompt("mac", spoken=True), self.prompt("mac", spoken=False)
        self.assertIn("texting on my phone", phone); self.assertNotIn(server.ALOUD, phone)
        self.assertIn("texting (I'm on my Mac)", mac); self.assertIn(server.ALOUD, mac)
        self.assertNotIn(server.ALOUD, mac_quiet)
        self.assertIn("a short text gets a short text back", phone)
        call = self.prompt("call")
        self.assertIn(server.CALLING, call); self.assertNotIn("texting", call)

    def test_length_comes_last(self):
        p = self.prompt("phone", length=server.length_hint("lol", "phone"))
        self.assertTrue(p.endswith(server.length_hint("lol", "phone")))

class Hearing(unittest.TestCase):                      # what Whisper is told along with your voice
    def run_whisper(self, text_back="hi there", setting="", **kw):
        sent = {}
        class R:
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"text": text_back}).encode()
        def post(url, key, body, ctype="", timeout=0):
            sent["body"] = body.decode(errors="ignore"); return R(body)
        with mock.patch.object(server, "post", post), mock.patch.object(server, "tinfoil", lambda: "http://x/v1"), \
             mock.patch.object(server, "read", lambda n, d="": "fake"), mock.patch.object(server, "stt_model", lambda: "whisper"), \
             mock.patch.object(server, "cfg", lambda: {"language": setting}):
            out = server.whisper(b"RIFFfake", "audio/wav", CHAR, **kw)
        return out, sent["body"]

    def field(self, body, name):
        m = re.search(r'name="%s"\r\n\r\n([^\r]*)\r\n' % name, body)
        return m.group(1) if m else None

    def test_only_your_language_setting(self):            # (the device's language is never sent: hints made it loop)
        _, b = self.run_whisper(hint="en"); self.assertIsNone(self.field(b, "language"))
        _, b = self.run_whisper(hint="en", setting="uz"); self.assertEqual(self.field(b, "language"), "uz")
        _, b = self.run_whisper(); self.assertIsNone(self.field(b, "language"))

    def test_only_the_name_as_prompt_and_an_echo_is_nothing(self):
        out, b = self.run_whisper(context="Did you *finally* call your sister? 😊")
        self.assertEqual(self.field(b, "prompt"), "Maya.")
        self.assertEqual(out, "hi there")
        out, _ = self.run_whisper(text_back="Did you finally call your sister?", context="Did you finally call your sister?")
        self.assertEqual(out, "")                       # (Whisper only gave their words back)
        out, _ = self.run_whisper(text_back="yes I did", context="Did you finally call your sister?")
        self.assertEqual(out, "yes I did")
        _, b = self.run_whisper(); self.assertEqual(self.field(b, "prompt"), "Maya.")

    def test_whisper_first_voxtral_only_if_it_fails(self):
        import io, urllib.error
        for failure, falls_back in ((404, True), (500, True), (503, True), ("timeout", True), ("model whisper not found", True),
                                    ("audio too short", False), (None, False)):
            calls = []
            class R:
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def read(self): return json.dumps({"text": "hello"}).encode()
            def post(url, key, body, ctype="", timeout=0):
                b = body.decode(errors="ignore"); m = re.search(r'name="model"\r\n\r\n([^\r]*)', b).group(1); calls.append(m)
                if m == server.STT and failure is not None:
                    if failure == "timeout": raise TimeoutError("timed out")
                    code, said = (failure, b"oops") if isinstance(failure, int) else (400, json.dumps({"error": failure}).encode())
                    raise urllib.error.HTTPError(url, code, "x", {}, io.BytesIO(said))
                return R()
            with mock.patch.object(server, "post", post), mock.patch.object(server, "tinfoil", lambda: "http://x/v1"), \
                 mock.patch.object(server, "read", lambda n, d="": "fake"), mock.patch.object(server, "cfg", lambda: {}), \
                 mock.patch.dict(server._stt_down, {"at": 0}), mock.patch.dict(server._models, {"ids": []}):
                if failure == "audio too short":
                    with self.assertRaises(urllib.error.HTTPError) as c: server.whisper(b"RIFFfake", "audio/wav", CHAR)
                    self.assertFalse(getattr(c.exception, "gone", False))
                else:
                    self.assertEqual(server.whisper(b"RIFFfake", "audio/wav", CHAR), "hello")
                self.assertEqual(calls, [server.STT, server.STT_NEXT] if falls_back else [server.STT], failure)
                self.assertEqual(server.stt_model(), server.STT_NEXT if falls_back else server.STT)   # (for 10 minutes)
        with mock.patch.dict(server._stt_down, {"at": 0}), mock.patch.dict(server._models, {"ids": ["gemma4-31b"]}):
            self.assertEqual(server.stt_model(), server.STT)   # (not listed, or no list yet: still Whisper)

    def test_a_model_that_takes_no_prompt(self):
        calls = []
        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"text": "hello"}).encode()
        def post(url, key, body, ctype="", timeout=0):
            b = body.decode(errors="ignore"); calls.append(b)
            if 'name="prompt"' in b:
                import io, urllib.error
                raise urllib.error.HTTPError(url, 400, "bad", {}, io.BytesIO(b'{"error": "prompt is not supported"}'))
            return R()
        with mock.patch.object(server, "post", post), mock.patch.object(server, "tinfoil", lambda: "http://x/v1"), \
             mock.patch.object(server, "read", lambda n, d="": "fake"), mock.patch.object(server, "stt_model", lambda: "voxtral-small-24b"), \
             mock.patch.object(server, "cfg", lambda: {}):
            self.assertEqual(server.whisper(b"RIFFfake", "audio/wav", CHAR, "en"), "hello")
        self.assertEqual(len(calls), 2); self.assertNotIn('name="prompt"', calls[1]); self.assertNotIn('name="language"', calls[1])

    def test_a_loop_is_not_words(self):
        for loop in ("very, " * 40, "no no, " + "no, " * 50, "Thank you. " * 8, "you you you you you you"):
            with self.assertRaises(server.Unclear): self.run_whisper(text_back=loop)
        for said in ("no, no, no", "ha ha ha ha", "bye bye", "really really really really cool", "no no no no no",
                     "one two three four five six seven eight nine ten", "very very very good, thanks for asking"):
            self.assertEqual(self.run_whisper(text_back=said)[0], said)

    def test_calls_work_out_what_you_meant(self):
        self.assertIn("work out what I most likely meant", server.CALLING)
        self.assertNotIn("instead of guessing", server.CALLING)


class Reactions(unittest.TestCase):                    # any emoji, and not on everything
    def test_any_single_emoji(self):
        for e in ("❤️", "❤", "😂", "🫠", "👍🏽", "👩‍💻", "🏳️‍🌈", "🇺🇿", "1️⃣", "🙈"):
            self.assertTrue(server.reaction(e), e)
        self.assertEqual(server.reaction("❤"), "❤️")
        for bad in ("", "lol", "😂😂😂😂😂😂😂😂😂", "a😂", "😂 ok", "<b>", "[react]"):
            self.assertIsNone(server.reaction(bad), bad)

    def test_rarely(self):
        t = [{"id": 1, "role": "user", "char": "maya"}, {"id": 2, "role": "assistant", "char": "maya"},
             {"id": 3, "role": "reaction", "char": "maya", "by": "maya", "target": 1},
             {"id": 4, "role": "user", "char": "maya"}]
        with mock.patch.object(server.social, "thread", lambda: t):
            self.assertTrue(server.reacted_lately("maya"))
        with mock.patch.object(server.social, "thread", lambda: t[:2] + t[3:]):
            self.assertFalse(server.reacted_lately("maya"))
        brk = {"id": 5, "role": "break", "char": "maya"}            # a New chat since: that was another conversation
        with mock.patch.object(server.social, "thread", lambda: t + [brk, {"id": 6, "role": "user", "char": "maya"}]):
            self.assertFalse(server.reacted_lately("maya"))

class Timing(unittest.TestCase):                       # they notice time, and don't always answer at once
    def thread(self, gap, last="user"):
        now = server.time.time()
        return [{"id": 1, "role": last, "char": "maya", "ts": now - gap, "content": "x"},
                {"id": 2, "role": "user", "char": "maya", "ts": now, "content": "hey"}]

    def test_gap_in_the_prompt(self):
        with mock.patch.object(server.social, "thread", lambda: self.thread(3 * 86400, "assistant")):
            s = server.since_last_talk("maya")
        self.assertIn("3 days ago", s); self.assertIn("never answered", s); self.assertIn("don't carry on as if no time passed", s)
        with mock.patch.object(server.social, "thread", lambda: self.thread(4 * 3600)):
            s = server.since_last_talk("maya")
        self.assertIn("4 hours ago", s); self.assertIn("It was mine", s); self.assertNotIn("carry on", s)
        with mock.patch.object(server.social, "thread", lambda: self.thread(600)):
            self.assertEqual(server.since_last_talk("maya"), "")

    def test_delay(self):
        char = {"id": "maya", "life": False}
        with mock.patch.object(server, "cfg", lambda: {}), mock.patch.object(server, "has_life", lambda c, x=None: False), \
             mock.patch.object(server.random, "random", lambda: 0.0), mock.patch.object(server.random, "uniform", lambda a, b: b):
            with mock.patch.object(server.social, "thread", lambda: self.thread(120)):
                self.assertEqual(server.reply_delay(char, "phone"), 0)            # mid-conversation: at once
            now = server.time.time()                                          # phone mode's messages, synced later
            synced = self.thread(120)[:1] + [{"id": 2, "role": "assistant", "char": "maya", "ts": now - 100, "content": "y"},
                {"id": 3, "role": "user", "char": "maya", "ts": now - 3 * 3600, "content": "x", "direct": True},
                {"id": 4, "role": "assistant", "char": "maya", "ts": now - 3 * 3600 + 5, "content": "y", "direct": True},
                {"id": 5, "role": "user", "char": "maya", "ts": now, "content": "hey"}]   # (older, with newer ids)
            with mock.patch.object(server.social, "thread", lambda: synced):
                self.assertEqual(server.reply_delay(char, "phone"), 0)            # still mid-conversation
            with mock.patch.object(server.social, "thread", lambda: self.thread(3 * 86400)):
                self.assertEqual(server.reply_delay(char, "phone"), 900)          # after days: a while
                self.assertEqual(server.reply_delay(char, "call"), 0)             # never in a call
            with mock.patch.object(server, "cfg", lambda: {"real_timing": False}), \
                 mock.patch.object(server.social, "thread", lambda: self.thread(3 * 86400)):
                self.assertEqual(server.reply_delay(char, "phone"), 0)
        with mock.patch.object(server, "cfg", lambda: {}), mock.patch.object(server, "has_life", lambda c, x=None: False), \
             mock.patch.object(server.random, "random", lambda: 0.99), mock.patch.object(server.social, "thread", lambda: self.thread(3 * 86400)):
            self.assertEqual(server.reply_delay(char, "phone"), 0)                # (and often at once anyway)

class Saving(unittest.TestCase):                       # a full disk never leaves half a file behind
    @unittest.skipUnless(resource, "needs RLIMIT_FSIZE")
    def test_a_full_disk_keeps_the_old_file(self):     # (the disk fills up in the very last write, when the file is closed)
        with tempfile.TemporaryDirectory() as d:
            msgs = [{"id": i, "role": "user", "content": f"fake message {i}", "ts": i, "char": "maya"} for i in range(1, 1501)]
            for p, before, after in ((os.path.join(d, ".thread.json"), msgs, msgs + [dict(msgs[0], id=1501)]),
                                     (os.path.join(d, ".gens.json"), {"buddy": 3}, {"buddy": 3, "maya": 1})):
                social._save(p, before)
                soft, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
                resource.setrlimit(resource.RLIMIT_FSIZE, (len(json.dumps(after)) - 5, hard))   # (Python ignores SIGXFSZ)
                try:
                    with self.assertRaises(OSError): social._save(p, after)
                finally:
                    resource.setrlimit(resource.RLIMIT_FSIZE, (soft, hard))
                self.assertEqual(social._load(p, None), before)
                self.assertFalse(os.path.exists(p + ".tmp"))
                self.assertEqual(os.stat(p).st_mode & 0o777, 0o600)

class LateReplies(unittest.TestCase):                  # a late answer isn't sent once there's nothing left to answer
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); d = self.tmp.name
        self.asked = []
        def brain(mode, spoken=False, free_ok=False):
            self.asked.append(mode); raise RuntimeError("no brain in tests")
        for obj, name, value in [(social, "THREAD", os.path.join(d, ".thread.json")), (social, "_private", []),
                                 (social, "SUBS", os.path.join(d, ".push_subs.json")),
                                 (social, "_marks", []), (social, "push", lambda *a, **k: 0),
                                 (characters, "MINE", os.path.join(d, "my-characters")),
                                 (devices, "FILE", os.path.join(d, ".devices.json")),
                                 (devices, "MAC_TOKEN", os.path.join(d, ".mac_token")),
                                 (server, "CHATS", os.path.join(d, "chats")), (server, "recall", lambda *a, **k: []),
                                 (server, "local_cfg", lambda: {"save_chats": False, "lives": False}),
                                 (server, "reply_delay", lambda c, via: 1.5), (server, "brain", brain),
                                 (facts, "for_prompt", lambda *a, **k: ([], []))]:
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)
        devices.ensure(); self.cookie = devices.mac_token()
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    def post(self, path, body):
        port = self.srv.server_address[1]
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        c.request("POST", path, body=json.dumps(body).encode(), headers={"Host": f"127.0.0.1:{port}", "Content-Type":
                                                                          "application/json", "Cookie": f"buddy={self.cookie}"})
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, data

    def test_new_chat_meanwhile(self):
        for meanwhile in ("new chat", "another text"):
            self.asked.clear(); first, second = [], []
            text = f"are you there? ({meanwhile})"
            th = threading.Thread(target=lambda: first.append(self.post("/api/chat", {"text": text, "char": "buddy",
                                                                                       "private": False, "via": "phone"})))
            th.start()
            end = time.time() + 10
            while time.time() < end and not any(m.get("content") == text for m in social.thread()): time.sleep(0.02)
            if meanwhile == "new chat":
                self.assertEqual(self.post("/api/newchat", {"char": "buddy"})[0], 200)
            else:
                second.append(self.post("/api/chat", {"text": "and now?", "char": "buddy", "private": False, "via": "phone"}))
                self.assertIn(b'"later"', second[0][1])
            th.join(15)
            self.assertIn(b'"later"', first[0][1])
            self.assertEqual(self.asked, [] if meanwhile == "new chat" else ["advisor"], meanwhile)
            self.post("/api/newchat", {"char": "buddy"})

if __name__ == "__main__":
    unittest.main()
