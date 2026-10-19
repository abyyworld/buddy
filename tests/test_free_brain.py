"""The free brain (opt-in, "Less private"): off unless you turn it on (on the Mac, with its key), and then it only ever
gets the text of everyday chats: never private chats, photos, recordings, notes, saved chats, facts or learning. When
it fails, Buddy says so plainly and never switches to a paid brain on its own. Its key is never shown back.
Fake data only: a fake Cloudflare and a fake Tinfoil on 127.0.0.1, fake keys, a temp folder (run with HOME set to a
temp folder):  python3 -m unittest discover -s tests -v"""
import base64, http.client, json, os, shutil, struct, sys, tempfile, threading, time, unittest, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import backup, characters, devices, edition, facts, images, lives, localcheck, memory, social
import buddy_server as server

ACCT = "0123456789abcdef0123456789abcdef"            # (fake)
TOKEN = "fake-cf-token-for-tests-Qx7Rv2Lm9"          # (fake)
TINFOIL_KEY = "fake-tinfoil-key-for-tests-0000"      # (fake)
NOTE, FACT, FOLDER, TAGLINE = "CANARY-NOTE-7731", "CANARY-FACT-5521", "CANARY-FOLDER-3302", "CANARY-TAGLINE-8810"
WAV = (b"RIFF" + (4836).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00\x01\x00"
       + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little") + b"\x02\x00\x10\x00data" + (4800).to_bytes(4, "little")
       + b"\0" * 4800)

seg = lambda m, body: b"\xff" + bytes([m]) + struct.pack(">H", len(body) + 2) + body
def jpeg(w, h):
    """A structurally valid JPEG (markers only, no real pixels), as in test_pictures.py."""
    return (b"\xff\xd8" + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
            + seg(0xC0, b"\x08" + struct.pack(">HH", h, w) + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00")
            + seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00") + b"\x12\x34\xff\x00\x56" * 30 + b"\xff\xd9")
b64 = lambda b: base64.b64encode(b).decode()
new_cid = lambda: base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()

class Fake(BaseHTTPRequestHandler):
    """A fake Cloudflare (/client/v4/accounts/<id>/ai/v1/...) and a fake Tinfoil (/v1/...) in one."""
    seen, how = [], {"cf": "ok", "content": "hey there.", "desc": None}
    def log_message(self, *a): pass
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try: body = json.loads(raw)
        except ValueError: body = None
        cf = self.path.startswith("/client/v4/")
        Fake.seen.append({"who": "cloudflare" if cf else "tinfoil", "path": self.path, "raw": raw.decode(errors="ignore"),
                          "auth": self.headers.get("Authorization"), "body": body})
        if cf and Fake.how["cf"] == "no_kwargs" and "chat_template_kwargs" in (body or {}):
            Fake.how["cf"] = "ok"                         # (a model that refuses the thinking switch, once: 400)
            return self.reply({"errors": [{"code": 5006, "message": "unknown field chat_template_kwargs"}]}, 400)
        if cf and Fake.how["cf"] != "ok":
            code, said = {"used_up": (429, {"errors": [{"code": 3036, "message": "AiError: You have used up your daily "
                                                         "free allocation of 10,000 neurons."}], "success": False}),
                          "busy": (429, {"errors": [{"code": 3040, "message": "Capacity temporarily exceeded"}]}),
                          "bad_key": (401, {"errors": [{"code": 10000, "message": "Authentication error"}]})}[Fake.how["cf"]]
            b = json.dumps(said).encode()
            self.send_response(code); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
            return
        if self.path.endswith("/audio/transcriptions"):
            return self.reply({"text": "hello there"})
        if self.path.endswith("/audio/speech"):
            self.send_response(200); self.send_header("Content-Type", "audio/wav"); self.send_header("Content-Length", str(len(WAV)))
            self.end_headers(); self.wfile.write(WAV); return
        content = Fake.how["content"]
        if not cf and Fake.how["desc"] and "image_url" in Fake.seen[-1]["raw"]:
            content = Fake.how["desc"]                    # (Tinfoil's vision model, describing a photo)
        if isinstance(body, dict) and body.get("stream"):
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            for d in ({"choices": [{"delta": {"content": content}}]},
                      {"choices": [{"delta": {}, "finish_reason": "stop"}]}):
                self.wfile.write(b"data: " + json.dumps(d).encode() + b"\n\n")
            self.wfile.write(b"data: [DONE]\n\n"); return
        return self.reply({"choices": [{"message": {"content": content}}]})
    def reply(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

class FreeBrain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); d = self.here = self.tmp.name
        for f in ("config.json", "mode_advisor.txt", "mode_companion.txt", "persona.txt"):   # (shipped files only)
            shutil.copy(os.path.join(ROOT, f), d)
        Fake.seen.clear(); Fake.how.update(cf="ok", content="hey there.", desc=None)
        self.tinfoil_down = False
        self.fake = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=self.fake.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.fake.shutdown(), self.fake.server_close()))
        base = self.base = f"http://127.0.0.1:{self.fake.server_address[1]}"
        for obj, name, value in [(server, "HERE", d), (server, "CLOUDFLARE", base + "/client/v4/accounts/"),
                                 (server, "tinfoil", self.fake_tinfoil),
                                 (server, "tinfoil_models", lambda: ["gemma4-31b", "deepseek-v4-1-flash"]),
                                 (server, "_free", {"limited": 0, "gone": {}}), (server, "_thinking_refused", set()),
                                 (server, "_call_seen", {}), (server, "_live", {}),
                                 (server, "CHATS", os.path.join(d, "chats")), (server, "reply_delay", lambda c, via: 0),
                                 (server, "plan_soon", lambda *a, **k: None),
                                 (server, "recall", lambda *a, **k: [f"[journal/a.md]\nA fake note: {NOTE}"]),
                                 (facts, "for_prompt", lambda *a, **k: ([f"My fake fact {FACT}"], [{"kind": "facts", "n": 1}])),
                                 (facts, "kick", lambda *a, **k: None), (memory, "folders", lambda: [FOLDER]),
                                 (social, "THREAD", os.path.join(d, ".thread.json")), (social, "_private", []),
                                 (social, "GENS", os.path.join(d, ".gens.json")), (social, "SUBS", os.path.join(d, ".push_subs.json")),
                                 (social, "VAPID", os.path.join(d, ".vapid.json")),
                                 (social, "_marks", []), (social, "push", lambda *a, **k: 0),
                                 (characters, "MINE", os.path.join(d, "my-characters")),
                                 (lives, "LIVES", os.path.join(d, "my-characters", "lives")),
                                 (lives, "WORLD", os.path.join(d, "my-characters", "lives", "_world.json")),
                                 (images, "MEDIA", os.path.join(d, ".media")), (images, "find", lambda c: None),
                                 (devices, "FILE", os.path.join(d, ".devices.json")),
                                 (devices, "MAC_TOKEN", os.path.join(d, ".mac_token"))]:
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)
        devices.ensure(); self.mac = devices.mac_token()
        code, _ = devices.start_pairing(); self.phone = devices.pair(code, "Phone")[0]
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    # ---- helpers ----
    def fake_tinfoil(self):                              # (like the real one: nothing without a Tinfoil key)
        if not server.read(".tinfoil_key"):
            raise RuntimeError("Buddy has no Tinfoil key yet: add it on your Mac (Settings → Brain)")
        if self.tinfoil_down:
            raise RuntimeError("Tinfoil's enclave isn't verified yet")
        return self.base + "/v1"

    def call(self, method, path, body=None, who="mac"):
        port = self.srv.server_address[1]
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        h = {"Host": f"127.0.0.1:{port}", "Cookie": "buddy=" + (self.mac if who == "mac" else self.phone)}
        if body is not None: h["Content-Type"] = "application/json"
        c.request(method, path, body=None if body is None else json.dumps(body).encode(), headers=h)
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, data.decode()

    def chat(self, text, **kw):
        code, data = self.call("POST", "/api/chat", {"text": text, "char": "buddy", "private": False, "via": "phone", **kw})
        self.assertEqual(code, 200, data)
        return [json.loads(l) for l in data.splitlines() if l.strip()]

    def tinfoil_key(self):
        with open(os.path.join(self.here, ".tinfoil_key"), "w") as f: f.write(TINFOIL_KEY)

    def free_on(self):
        self.assertEqual(self.call("POST", "/api/setup/key", {"provider": "cloudflare", "account": ACCT, "key": TOKEN})[0], 200)
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": True})[0], 200)

    def to(self, who):
        return [s for s in Fake.seen if s["who"] == who]

    # ---- tests ----
    def test_off_by_default(self):
        self.assertNotIn("free_brain", json.load(open(os.path.join(ROOT, "config.json"))))
        self.tinfoil_key()
        self.assertFalse(json.loads(self.call("GET", "/api/settings")[1])["free_brain"])
        st = json.loads(self.call("GET", "/api/status")[1])["free"]
        self.assertEqual((st["on"], st["key"], st["chosen"]), (False, False, False))
        out = self.chat("hi")
        self.assertIn({"s": "hey there."}, out)
        self.assertEqual(len(self.to("tinfoil")), 1); self.assertEqual(self.to("cloudflare"), [])
        self.assertIn(NOTE, self.to("tinfoil")[0]["raw"])     # (the private brain does get your notes, as before)
        # chosen but without its key (e.g. the file was deleted): nothing to Tinfoil instead, it says so
        server.save_cfg(free_brain=True)
        out = self.chat("hello?")
        self.assertTrue(out[-1].get("plain") and "key is missing" in out[-1]["error"], out)
        self.assertEqual(len(self.to("tinfoil")), 1); self.assertEqual(self.to("cloudflare"), [])

    def test_key_and_setting(self):
        # keys only on the Mac; the account ID must look like one; never shown back anywhere
        self.assertEqual(self.call("POST", "/api/setup/key", {"provider": "cloudflare", "account": ACCT, "key": TOKEN}, who="phone")[0], 403)
        self.assertEqual(self.call("POST", "/api/setup/key", {"provider": "cloudflare", "account": "nope", "key": TOKEN})[0], 400)
        self.assertEqual(self.call("POST", "/api/setup/key", {"provider": "cloudflare", "account": ACCT, "key": "short"})[0], 400)
        self.assertFalse(os.path.exists(os.path.join(self.here, ".cloudflare_key")))
        # turning it on needs the key first (which only the Mac can add)
        code, data = self.call("POST", "/api/settings", {"free_brain": True})
        self.assertEqual(code, 400); self.assertIn("Cloudflare", data)
        code, data = self.call("POST", "/api/settings", {"free_brain": True}, who="phone")
        self.assertEqual(code, 400); self.assertIn("from your Mac", data)
        code, data = self.call("POST", "/api/setup/key", {"provider": "cloudflare", "account": ACCT.upper(), "key": TOKEN})
        self.assertEqual((code, json.loads(data)), (200, {"ok": True}))
        p = os.path.join(self.here, ".cloudflare_key")
        self.assertEqual(os.stat(p).st_mode & 0o777, 0o600)
        self.assertEqual(open(p).read(), f"{ACCT}:{TOKEN}")
        self.assertEqual(server.free_key(), (ACCT, TOKEN))
        self.assertFalse(server.free_on())                    # (a key alone turns nothing on)
        # on with its key (so it was chosen on the Mac); it only gets what's said from then on (free_since)
        t0 = time.time()
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": True})[0], 200)
        self.assertTrue(server.free_on())
        since = server.cfg()["free_since"]; self.assertGreaterEqual(since, t0)
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": True})[0], 200)   # (already on: kept)
        self.assertEqual(server.cfg()["free_since"], since)
        for who in ("mac", "phone"):
            for path in ("/api/status", "/api/settings", "/api/images", "/api/characters"):
                code, data = self.call("GET", path, who=who)
                self.assertNotIn(TOKEN, data, path); self.assertNotIn(ACCT, data, path)
        st = json.loads(self.call("GET", "/api/status", who="phone")[1])["free"]
        self.assertEqual((st["on"], st["key"], st["name"]), (True, True, "Cloudflare"))
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": False}, who="phone")[0], 200)
        self.assertFalse(server.free_on())
        time.sleep(0.01)                                      # back on from the phone (its key is there): from now on
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": True}, who="phone")[0], 200)
        self.assertTrue(server.free_on()); self.assertGreater(server.cfg()["free_since"], since)
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": "yes"})[0], 200)   # (anything but true: off)
        self.assertFalse(server.free_on())
        # removing the key turns it off (back to Private)
        self.assertEqual(self.call("POST", "/api/settings", {"free_brain": True})[0], 200)
        self.assertEqual(self.call("POST", "/api/setup/key", {"provider": "cloudflare", "remove": True})[0], 200)
        self.assertFalse(os.path.exists(p)); self.assertFalse(server.cfg().get("free_brain"))

    def test_everyday_chats_go_free_private_never(self):
        self.tinfoil_key(); self.free_on()
        out = self.chat("hi, how was your day?")
        self.assertIn({"s": "hey there."}, out)
        cf = self.to("cloudflare"); self.assertEqual((len(cf), self.to("tinfoil")), (1, []))
        r = cf[0]
        self.assertEqual(r["path"], f"/client/v4/accounts/{ACCT}/ai/v1/chat/completions")
        self.assertEqual(r["auth"], "Bearer " + TOKEN)
        self.assertEqual(r["body"]["model"], "@cf/google/gemma-4-26b-a4b-it")
        self.assertEqual(r["body"]["chat_template_kwargs"], {"enable_thinking": False})   # (thinking would eat the allowance)
        for canary in (NOTE, FACT, FOLDER, TINFOIL_KEY):
            self.assertNotIn(canary, r["raw"])
        self.assertIn(server.FREE_MEMORY, r["raw"])
        self.assertFalse(any("sources" in x for x in out))   # (it was given no notes or facts)
        # a call turn too (the brain only: hearing and voice stay in Tinfoil's enclave)
        self.chat("and now on the phone", via="call")
        self.assertEqual(len(self.to("cloudflare")), 2); self.assertEqual(self.to("cloudflare")[1]["body"]["max_tokens"], 300)
        # a private chat: Tinfoil's enclave, never the free brain, and nothing private in later free requests
        out = self.chat("a secret: CANARY-PRIVATE-4412", private=True)
        self.assertIn({"s": "hey there."}, out)
        self.assertEqual((len(self.to("cloudflare")), len(self.to("tinfoil"))), (2, 1))
        self.assertIn("CANARY-PRIVATE-4412", self.to("tinfoil")[0]["raw"])
        self.chat("back to normal")
        self.assertEqual(len(self.to("cloudflare")), 3)
        self.assertNotIn("CANARY-PRIVATE-4412", self.to("cloudflare")[2]["raw"])
        # "what do you know about me?" on the free brain: no facts, no folders, just the conversation
        self.chat("what do you know about me?")
        r = self.to("cloudflare")[3]["raw"]
        self.assertNotIn(FACT, r); self.assertNotIn(FOLDER, r); self.assertNotIn("What Buddy knows", r)

    def test_private_without_tinfoil_is_refused(self):
        self.free_on()
        out = self.chat("a secret", private=True)
        self.assertEqual(out, [{"error": server.PRIVATE_NOT_FREE, "plain": True}])
        self.assertNotIn("turn Private off", server.PRIVATE_NOT_FREE)   # (never an invitation to send it to the free brain)
        # with a Tinfoil key whose enclave isn't verified (yet): the real reason, not "add a Tinfoil key"
        self.tinfoil_key(); self.tinfoil_down = True
        out = self.chat("a secret", private=True)
        self.assertEqual(out, [{"error": "Tinfoil's enclave isn't verified yet"}])
        self.assertEqual(Fake.seen, [])

    def test_failures_are_said_plainly_never_a_paid_brain(self):
        self.tinfoil_key(); self.free_on()
        Fake.how["cf"] = "used_up"
        out = self.chat("hi")
        self.assertTrue(out[-1]["plain"]); self.assertIn("used up", out[-1]["error"]); self.assertIn("come back at", out[-1]["error"])
        self.assertIn("switch Brain to Private", out[-1]["error"])
        self.assertEqual((len(self.to("cloudflare")), self.to("tinfoil")), (1, []))
        st = json.loads(self.call("GET", "/api/status")[1])["free"]
        self.assertGreater(st["limited_until"], time.time()); self.assertEqual(st["limited_until"] % 86400, 0)   # (00:00 UTC)
        out = self.chat("still there?", via="call")          # used up: not even asked again until it comes back
        self.assertEqual(len(out), 1); self.assertTrue(out[0]["plain"]); self.assertIn("used up", out[0]["error"])
        self.assertEqual((len(self.to("cloudflare")), self.to("tinfoil")), (1, []))
        server._free["limited"] = 0
        for how, said in (("bad_key", "didn't accept your free key"), ("busy", "busy right now")):
            Fake.how["cf"] = how
            out = self.chat("hi again")
            self.assertTrue(out[-1]["plain"]); self.assertIn(said, out[-1]["error"])
        self.assertEqual(self.to("tinfoil"), [])
        with mock.patch.object(server, "CLOUDFLARE", "http://127.0.0.1:9/client/v4/accounts/"), \
             mock.patch.object(localcheck, "check", lambda url: None):   # (nobody there; the real one is remote, so
            out = self.chat("hello?")                                    # the check for local programs never applies)
        self.assertIn("Can't reach Cloudflare", out[-1]["error"])
        self.assertEqual(self.to("tinfoil"), [])
        # without a Tinfoil key, "switch Brain to Private" isn't offered: Private couldn't answer
        os.remove(os.path.join(self.here, ".tinfoil_key")); Fake.how["cf"] = "bad_key"
        out = self.chat("and now?")
        self.assertIn("didn't accept your free key", out[-1]["error"]); self.assertNotIn("Private", out[-1]["error"])

    def test_guard_in_post(self):
        url = server.CLOUDFLARE + ACCT + "/ai/v1/chat/completions"
        ok = json.dumps({"model": "m", "messages": [{"role": "user", "content": "hi"}]}).encode()
        with self.assertRaises(RuntimeError): server.post(url, TOKEN, ok)               # (it's off)
        self.free_on()
        server.post(url, TOKEN, ok).close()
        pic = json.dumps({"model": "m", "messages": [{"role": "user", "content": [{"type": "text", "text": "look"},
                          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}}]}]}).encode()
        for u, b, ct in ((url, pic, "application/json"),
                         (server.CLOUDFLARE + ACCT + "/ai/v1/embeddings", ok, "application/json"),
                         (server.CLOUDFLARE + ACCT + "/ai/run/@cf/openai/whisper-large-v3-turbo", ok, "application/json"),
                         (server.CLOUDFLARE + ACCT + "/ai/v1/audio/transcriptions", b"RIFF", "multipart/form-data; boundary=x"),
                         (server.CLOUDFLARE + "nope/ai/v1/chat/completions", ok, "application/json"),
                         ("https://api.example.com/v1/chat/completions", ok, "application/json")):
            with self.assertRaises(RuntimeError, msg=u): server.post(u, TOKEN, b, ct)
        self.assertEqual(len(self.to("cloudflare")), 1)
        self.assertTrue(server.has_media({"messages": [{"role": "user", "content": [{"type": "input_audio"}]}]}))
        self.assertFalse(server.has_media({"messages": [{"role": "system", "content": "x"}, {"role": "user", "content": [{"type": "text", "text": "y"}]}]}))

    def test_learning_vision_voice_stay_on_tinfoil(self):
        self.tinfoil_key(); self.free_on()
        self.assertEqual(server.ask("learn something"), "hey there.")          # learning: ask()'s default
        Fake.how["content"] = "A fake photo of a cup on a table."
        self.assertEqual(server.describe(b"\xff\xd8\xfffake")[0], "A fake photo of a cup on a table.")
        self.assertEqual(server.whisper(WAV, "audio/wav", None), "hello there")
        self.assertEqual(server.tts_wav("hi", "casual_male"), WAV)
        self.assertEqual(self.to("cloudflare"), [])
        self.assertEqual(len(self.to("tinfoil")), 4)
        # a photo you send on the free brain: looked at in Tinfoil (for saved chats and later private brains); the free
        # brain only hears that you sent one, never the picture or what's in it, then or later
        Fake.how.update(content="hey there.", desc="CANARY-PHOTO-DESC a cup on a table.")
        pid = server.hold_photo("mac", b"\xff\xd8\xfffake-full", 800, 600)
        self.assertTrue(server.add_view(pid, "mac", b"\xff\xd8\xfffake-view"))
        out = self.chat("look at this", photo=pid)
        cf = self.to("cloudflare"); self.assertEqual(len(cf), 1)
        self.assertNotIn("image_url", cf[0]["raw"]); self.assertNotIn("base64", cf[0]["raw"])
        self.assertNotIn("CANARY-PHOTO-DESC", cf[0]["raw"]); self.assertNotIn("A private helper looked", cf[0]["raw"])
        self.assertIn("(I sent you a photo) look at this", cf[0]["raw"]); self.assertIn(server.CANT_SEE, cf[0]["raw"])
        for _ in range(100):                              # (its description arrives in the background)
            if any(m.get("photo_desc") for m in social.thread()): break
            time.sleep(0.05)
        self.assertTrue(any("CANARY-PHOTO-DESC" in (m.get("photo_desc") or "") for m in social.thread()))
        self.chat("and?")
        self.assertNotIn("CANARY-PHOTO-DESC", self.to("cloudflare")[-1]["raw"])
        self.assertIn("(I sent you a photo) look at this", self.to("cloudflare")[-1]["raw"])
        self.assertTrue(all(s["who"] == "tinfoil" for s in Fake.seen if "image_url" in s["raw"]))

    def test_texts_first_lives_and_new_characters(self):
        self.tinfoil_key(); self.free_on()
        char = characters.get("buddy", server.cfg())
        txt, scene, given = server.first_text(char, "text me something", 10)
        self.assertEqual((txt, given), ("hey there.", []))
        r = self.to("cloudflare")[-1]["raw"]
        self.assertNotIn(NOTE, r); self.assertNotIn(FACT, r)
        # their day: other characters' taglines and when you usually text stay out of the free brain's prompt
        got = {}
        def plan_prompt(*a, **k):
            got.update(k); return "plan my fake day", None
        with mock.patch.object(lives, "needs_plan", lambda *a, **k: True), \
             mock.patch.object(lives, "undecided", lambda *a, **k: [{"id": "sam", "name": "Sam", "tagline": TAGLINE}]), \
             mock.patch.object(lives, "active_text", lambda *a, **k: "19-22h"), \
             mock.patch.object(lives, "plan_prompt", plan_prompt):
            server.plan_day("buddy", lazy=True)
        self.assertEqual((got["strangers"], got["active"]), ([("Sam", "")], ""))
        self.assertEqual(self.to("cloudflare")[-1]["raw"].count("plan my fake day"), 1)
        # a new character: the free brain isn't told your note folders' names
        Fake.how["content"] = json.dumps([{"name": "Lena", "persona": "You are Lena, 31, a fake florist.", "tagline": "fake"}])
        code, data = self.call("POST", "/api/characters/create", {"description": "a florist friend"})
        self.assertEqual(code, 200, data); self.assertEqual(json.loads(data)["created"][0]["name"], "Lena")
        self.assertNotIn(FOLDER, self.to("cloudflare")[-1]["raw"])
        self.assertEqual(self.to("tinfoil"), [])
        # thinking is off on every one of them (it would use up the daily allowance)
        self.assertEqual(len(self.to("cloudflare")), 3)
        for r in self.to("cloudflare"):
            self.assertEqual(r["body"]["chat_template_kwargs"], {"enable_thinking": False}, r["raw"][:200])
        # a model that refuses that switch (400) is asked again without it, and from then on plainly
        Fake.how["cf"] = "no_kwargs"
        self.assertTrue(server.ask("a fake question", free_ok=True))
        self.assertEqual(["chat_template_kwargs" in r["body"] for r in self.to("cloudflare")[-2:]], [True, False])
        self.assertIn("@cf/google/gemma-4-26b-a4b-it", server._thinking_refused)
        # with the free brain off, the private brain is told them (as before)
        self.call("POST", "/api/settings", {"free_brain": False})
        Fake.how["content"] = json.dumps([{"name": "Omar", "persona": "You are Omar, 40, a fake chef.", "tagline": "fake"}])
        self.assertEqual(self.call("POST", "/api/characters/create", {"description": "a chef friend"})[0], 200)
        self.assertIn(FOLDER, self.to("tinfoil")[-1]["raw"])

    def test_only_what_was_said_since_it_was_turned_on(self):
        # weeks on Private: replies that drew on your notes, a photo with its description, then Free is turned on
        self.tinfoil_key()
        Fake.how["content"] = "CANARY-TINFOIL-REPLY from your notes."
        self.chat("CANARY-BEFORE-FREE how is my project going?")
        self.assertTrue(any(m.get("sources") for m in social.thread()))   # (that reply drew on notes and facts)
        social.add("user", "look", char="buddy", image="0" * 32, photo_desc="CANARY-OLD-PHOTO-DESC", w=1, h=1)
        old = social.thread()[0]
        time.sleep(0.01); self.free_on(); Fake.how["content"] = "hey there."
        # after the switch: your reaction to an old reply, and a reply from notes (e.g. a Companion on Phala)
        social.add("reaction", "", target=social.thread()[1]["id"], emoji="😂", by="you", char="buddy")
        social.add("assistant", "CANARY-NOTE-ECHO since your note says so", char="buddy", sources=[{"kind": "facts", "n": 1}])
        social.add("assistant", "CANARY-AFTER-FREE ok!", char="buddy")
        self.chat("next")
        r = self.to("cloudflare")[-1]["raw"]
        for canary in ("CANARY-BEFORE-FREE", "CANARY-TINFOIL-REPLY", "CANARY-OLD-PHOTO-DESC", "CANARY-NOTE-ECHO"):
            self.assertNotIn(canary, r)
        self.assertIn("CANARY-AFTER-FREE", r); self.assertIn("next", r)
        # texts first and their day: the same
        char = characters.get("buddy", server.cfg())
        server.first_text(char, "text me something", 10)
        r = self.to("cloudflare")[-1]["raw"]
        self.assertNotIn("CANARY-TINFOIL-REPLY", r); self.assertNotIn("CANARY-NOTE-ECHO", r); self.assertIn("CANARY-AFTER-FREE", r)
        today = lives.life_date(time.time())
        self.assertIn("CANARY-TINFOIL-REPLY from your notes.", server.own_lines("buddy", today))   # (Tinfoil: everything)
        self.assertEqual(server.own_lines("buddy", today, server.free_since()), ["CANARY-AFTER-FREE ok!", "hey there."])
        self.assertLess(old["ts"], server.free_since())

    def test_phone_mode_replies_never_reach_the_free_brain(self):
        # Free is on, and there's a Tinfoil key too, so phone mode still runs on the phone (on Tinfoil). While the Mac
        # was away you sent a photo in phone mode, and Tinfoil answered having seen it (and maybe your facts, whether
        # you're married and what was said before). Back on the Mac: your own words reach the free brain, as they
        # would have on the Mac; that reply (and your reaction to it) never does.
        self.tinfoil_key(); self.free_on(); time.sleep(0.01)
        t = time.time()
        p = {"cid": new_cid(), "role": "user", "char": "buddy", "content": "CANARY-PM-USER look what I got", "ts": t,
             "epoch": 0, "photo": {"full": b64(jpeg(800, 600)), "view": b64(jpeg(400, 300))},
             "photo_desc": "CANARY-PM-DESC a red sports car", "seen_by": "gemma4-31b"}
        a = {"cid": new_cid(), "role": "assistant", "char": "buddy", "ts": t + 0.001, "epoch": 0, "reply_to": p["cid"],
             "content": "CANARY-PM-REPLY Wow, a red sports car in front of your blue house! Since you're married…"}
        r = {"cid": new_cid(), "role": "reaction", "char": "buddy", "content": "", "ts": t + 0.002, "epoch": 0,
             "by": "you", "emoji": "😂", "target_cid": a["cid"]}
        code, data = self.call("POST", "/api/thread/import", {"messages": [p, a, r]}, who="phone")
        self.assertEqual(code, 200, data)
        self.assertTrue(all(isinstance(x.get("id"), int) for x in json.loads(data)["results"]), data)
        self.assertGreaterEqual(t, server.free_since())
        self.assertEqual(social.recent_messages(30, char="buddy", since=server.free_since()),
                         [{"role": "user", "content": "(I sent you a photo) CANARY-PM-USER look what I got"}])
        self.chat("CANARY-MAC-NEXT and now?")
        char = characters.get("buddy", server.cfg())
        server.first_text(char, "text me something", 10)
        for req in self.to("cloudflare")[-2:]:
            raw = req["raw"]
            self.assertIn("CANARY-PM-USER", raw); self.assertIn("(I sent you a photo)", raw)
            for canary in ("CANARY-PM-REPLY", "CANARY-PM-DESC", "I reacted"):
                self.assertNotIn(canary, raw)
        self.assertIn("CANARY-MAC-NEXT", self.to("cloudflare")[-2]["raw"])
        today = lives.life_date(t)
        self.assertNotIn(a["content"], server.own_lines("buddy", today, server.free_since()))
        self.assertIn("hey there.", server.own_lines("buddy", today, server.free_since()))   # (the free brain's own)
        self.assertIn(a["content"], server.own_lines("buddy", today))                          # (Tinfoil: everything)
        self.assertIn("CANARY-PM-REPLY", json.dumps(social.recent_messages(30, char="buddy")))
        self.assertEqual(self.to("tinfoil"), [])

    def test_public_edition_rules_hold_on_the_free_brain(self):
        self.tinfoil_key(); self.free_on()
        with mock.patch.object(edition, "PUBLIC", True):
            self.chat("hi")
            server.first_text(characters.get("buddy", server.cfg()), "text me something", 10)
        for r in self.to("cloudflare"):
            self.assertIn(edition.HALAL, r["body"]["messages"][0]["content"])
        with mock.patch.object(edition, "PUBLIC", False):     # (the private copy, the owner's Mac: unchanged)
            self.chat("hi again")
        self.assertNotIn(edition.HALAL, self.to("cloudflare")[-1]["raw"])

    def test_phala_companion_stays_on_phala(self):
        self.tinfoil_key(); self.free_on()
        with open(os.path.join(self.here, ".phala_key"), "w") as f: f.write("fake-phala-key-for-tests-000")
        server.save_cfg(companion_provider="phala", companion_model="fake/phala-model")
        self.assertEqual(server.brain("companion", free_ok=True)[0], server.PHALA)
        self.assertTrue(server.brain("advisor", free_ok=True)[0].startswith(server.CLOUDFLARE))
        server.save_cfg(companion_provider="tinfoil")
        self.assertTrue(server.brain("companion", free_ok=True)[0].startswith(server.CLOUDFLARE))
        self.assertEqual(Fake.seen, [])

    def test_phala_conversation_never_reaches_the_free_brain(self):
        self.tinfoil_key(); self.free_on()
        with open(os.path.join(self.here, ".phala_key"), "w") as f: f.write("fake-phala-key-for-tests-000")
        server.save_cfg(companion_provider="phala", companion_model="fake/phala-model")
        with mock.patch.object(images, "phala_tee", lambda m, k=None: True), \
             mock.patch.object(server, "PHALA", self.base + "/phala"):
            self.chat("CANARY-PHALA-USER something for my companion", mode="companion")
        self.chat("quick question", mode="advisor")
        raw = self.to("cloudflare")[-1]["raw"]
        self.assertIn("quick question", raw); self.assertNotIn("CANARY-PHALA", raw)

    def test_free_prompts_never_say_whether_youre_married(self):
        self.tinfoil_key(); self.free_on()
        with mock.patch.object(edition, "PUBLIC", True):
            for status in ("yes", "no"):
                server.save_cfg(has_partner=status, partner_at=time.time())
                self.chat("hi")
                raw = self.to("cloudflare")[-1]["raw"]
                self.assertNotIn("I'm married or in a relationship:", raw); self.assertNotIn("I'm single:", raw)
                self.assertIn("Flirting and romance are fine" if status == "no" else "No flirting", raw)

    def test_key_file_is_private_everywhere(self):
        self.assertIn(".cloudflare_key", server.PRIVATE_FILES)
        self.assertIn(".cloudflare_key", backup.KEYS)
        self.assertIn(".cloudflare_key", [l.strip() for l in open(os.path.join(ROOT, ".gitignore"))])
        self.assertEqual(server.KEY_FILES["cloudflare"], ".cloudflare_key")
        pub = os.path.join(ROOT, "scripts", "publish.sh")             # (only in the private repo, not the public copy)
        if os.path.exists(pub):
            sh = open(pub).read()                                     # (publish.sh refuses them if ever tracked)
            loop = sh[sh.index("for f in .tinfoil_key"):]; loop = loop[:loop.index("done")]
            for f in (".cloudflare_key", ".facts_state.json"):
                self.assertIn(f, loop)

if __name__ == "__main__":
    unittest.main()
