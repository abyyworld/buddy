"""The same quality for less: a smaller Tinfoil bill without calls or texts getting slower or less natural. The brains'
fallbacks (never a model that always thinks first), thinking switched off where a model has a switch, generous caps on
background answers, a system prompt whose start stays the same from turn to turn, fewer facts sent to learning,
embeddings reused when a note changes, a setting for trying another speech-to-text model, and a plain message (and a
pause for background work) when Tinfoil credits run out. Fake data only: no notes, thread, keys or network (Tinfoil
is a fake on 127.0.0.1, every file goes to a temporary folder). Run from Buddy's folder:
python3 -m unittest discover -s tests -v"""
import datetime, http.client, io, json, os, re, shutil, subprocess, sys, tempfile, threading, time, types, unittest
import urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import billing, characters, devices, edition, facts, images, lives, localcheck, memory, social
import buddy_server as server

MODELS = ["gemma4-31b", "deepseek-v4-1-flash", "llama3-3-70b", "kimi-k3", "glm-5-3"]
SWITCH = ("reasoning_effort", "chat_template_kwargs")
WAV = (b"RIFF" + (36 + 4800).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00\x01\x00"
       + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little") + b"\x02\x00\x10\x00data" + (4800).to_bytes(4, "little")
       + b"\0" * 4800)
CHAR = {"id": "maya", "name": "Maya", "persona": "You are Maya, a fake test character.", "brain": "advisor",
        "knowledge": {"scope": "all"}}

class Fake(BaseHTTPRequestHandler):
    """Tinfoil on 127.0.0.1: answers the way it does and keeps what Buddy sent. plan: [(path end, status, body)],
    each used once, for the next request whose path ends that way."""
    seen, plan = [], []
    def log_message(self, *a): pass
    def answer(self, code, out, ct="application/json"):
        self.send_response(code); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(out)))
        self.end_headers(); self.wfile.write(out)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        body = json.loads(raw) if self.headers.get("Content-Type", "").startswith("application/json") else {"raw": raw}
        Fake.seen.append((self.path, body))
        for i, (end, code, out) in enumerate(Fake.plan):
            if self.path.endswith(end):
                Fake.plan.pop(i); return self.answer(code, out)
        if self.path.endswith("/chat/completions") and body.get("stream"):
            chunks = [{"choices": [{"delta": {"content": "hey there."}}]}, {"choices": [{"delta": {}, "finish_reason": "stop"}]}]
            return self.answer(200, ("".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n").encode(),
                               "text/event-stream")
        if self.path.endswith("/chat/completions"):
            return self.answer(200, json.dumps({"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]}).encode())
        if self.path.endswith("/audio/transcriptions"):
            return self.answer(200, b'{"text": "hello"}')
        if self.path.endswith("/audio/speech"):
            return self.answer(200, WAV, "audio/wav")
        if self.path.endswith("/embeddings"):
            return self.answer(200, json.dumps({"data": [{"index": i, "embedding": [1.0, 0.5]}
                                                         for i in range(len(body.get("input") or []))]}).encode())
        self.answer(404, b"{}")

def start_fake(test):
    Fake.seen.clear(); Fake.plan.clear()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    test.addCleanup(lambda: (srv.shutdown(), srv.server_close()))
    return f"http://127.0.0.1:{srv.server_address[1]}/v1"

def chats_sent():
    return [b for p, b in Fake.seen if p.endswith("/chat/completions")]

class Resp:
    def __init__(self, obj): self.b = json.dumps(obj).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return self.b

def fake_post(answers, sent):
    """server.post, faked: answers = [(text, finish_reason) or an HTTP status to fail with], used in order."""
    def post(url, key, body, ctype="application/json", timeout=120):
        sent.append(json.loads(body))
        a = answers.pop(0) if answers else ("ok", "stop")
        if isinstance(a, int):
            raise urllib.error.HTTPError(url, a, "x", {}, io.BytesIO(b"{}"))
        return Resp({"choices": [{"message": {"content": a[0]}, "finish_reason": a[1]}]})
    return post

def clean_billing(test):
    """Nothing wrong with the bill, and no call on (planning waits for a call to end) for the length of the test."""
    for p in (mock.patch.object(billing, "_state", {"why": None, "at": 0.0}), mock.patch.dict(server._call_seen, clear=True),
              mock.patch.dict(server._live, clear=True)):
        p.start(); test.addCleanup(p.stop)

class Models(unittest.TestCase):                      # fallbacks only as quick and cheap as the first; your choice first
    def test_lists(self):
        self.assertEqual(server.ADVISOR_MODELS, ["gemma4-31b", "deepseek-v4-1-flash", "llama3-3-70b"])
        self.assertEqual(server.COMPANION_MODELS, ["deepseek-v4-1-flash", "gemma4-31b", "llama3-3-70b"])
        self.assertEqual(server.VISION_ORDER, ["gemma4-31b", "deepseek-v4-1-flash"])
        self.assertEqual(server.ALWAYS_THINKS, {"glm-5-3", "kimi-k3", "gpt-oss-120b"})
        self.assertEqual(set(server.NO_THINKING) - set(server.FREE_MODELS), {"deepseek-v4-1-flash"})
        for m in server.ADVISOR_MODELS + server.COMPANION_MODELS + server.VISION_ORDER:
            self.assertNotIn(m, server.ALWAYS_THINKS)

    def test_your_choice_still_wins(self):
        with mock.patch.object(server, "tinfoil_models", return_value=MODELS):
            self.assertEqual(server.pick_model(None, server.ADVISOR_MODELS), "gemma4-31b")
            self.assertEqual(server.pick_model(None, server.COMPANION_MODELS), "deepseek-v4-1-flash")
            self.assertEqual(server.pick_model("kimi-k3", server.COMPANION_MODELS), "kimi-k3")        # (typed: yours)
            self.assertEqual(server.pick_model("glm-5-3", server.ADVISOR_MODELS), "glm-5-3")
            self.assertEqual(server.pick_model("llama3-3-70b", server.ADVISOR_MODELS, spoken=True), "llama3-3-70b")
            # out loud, a model that always thinks first goes last (as before): a call never waits for it
            self.assertEqual(server.pick_model("kimi-k3", server.COMPANION_MODELS, spoken=True), "deepseek-v4-1-flash")
        with mock.patch.object(server, "tinfoil_models", return_value=["gemma4-31b", "kimi-k3"]):
            self.assertEqual(server.pick_model(None, server.COMPANION_MODELS), "gemma4-31b")      # (deepseek gone)
        with mock.patch.object(server, "tinfoil_models", return_value=["llama3-3-70b", "kimi-k3", "glm-5-3"]):
            self.assertEqual(server.pick_model(None, server.ADVISOR_MODELS), "llama3-3-70b")      # (never kimi or glm)
            self.assertEqual(server.pick_model(None, server.COMPANION_MODELS), "llama3-3-70b")

    def test_vision_never_a_thinker(self):
        listed = [{"id": m, "multimodal": True, "type": "chat"} for m in ("kimi-k3", "gpt-oss-120b", "deepseek-v4-1-flash",
                                                                          "gemma4-31b", "some-new-vision-model")]
        with mock.patch.multiple(server, tinfoil_models=mock.Mock(return_value=[m["id"] for m in listed]),
                                 read=mock.Mock(return_value="fake-key-for-tests"),
                                 _models={"at": 0, "ttl": 0, "ids": [m["id"] for m in listed],
                                          "meta": {m["id"]: {"multimodal": True, "type": "chat"} for m in listed}}), \
             mock.patch.dict(server._no_vision, clear=True):
            self.assertEqual(server.vision_models(), ["gemma4-31b", "deepseek-v4-1-flash", "some-new-vision-model"])

class Complete(unittest.TestCase):                    # background answers: thinking off, a generous cap, never cut off
    def setUp(self):
        p = mock.patch.object(server, "_thinking_refused", set()); p.start(); self.addCleanup(p.stop)

    def run_it(self, model, cap, answers=(), url="http://127.0.0.1:9/v1"):
        sent = []
        with mock.patch.object(server, "post", fake_post(list(answers), sent)):
            out = server.complete(url, "fake", {"model": model, "temperature": 0.5, "messages": [{"role": "user", "content": "x"}]},
                                  cap=cap)
        return out, sent

    def test_switches_and_caps_per_model(self):
        _, s = self.run_it("gemma4-31b", 800)
        self.assertEqual(s[0]["max_tokens"], 800); self.assertFalse(set(SWITCH) & set(s[0]))   # (gemma doesn't think)
        _, s = self.run_it("deepseek-v4-1-flash", 1500)
        self.assertEqual((s[0]["max_tokens"], s[0]["reasoning_effort"], s[0]["chat_template_kwargs"]),
                         (1500, "none", {"thinking": False}))
        _, s = self.run_it("deepseek-v4-1-flash", None)
        self.assertNotIn("max_tokens", s[0]); self.assertEqual(s[0]["reasoning_effort"], "none")
        for m in ("kimi-k3", "glm-5-3", "gpt-oss-120b"):              # (it thinks anyway: a cap could eat the answer)
            _, s = self.run_it(m, 400)
            self.assertFalse({"max_tokens", *SWITCH} & set(s[0]), m)
        _, s = self.run_it("deepseek-v4-1-flash", 800, url=server.PHALA)
        self.assertFalse({"max_tokens", *SWITCH} & set(s[0]))        # (Tinfoil only)
        self.assertEqual(len(s), 1)

    def test_refused_switches(self):
        out, s = self.run_it("deepseek-v4-1-flash", 800, [400, ("fine", "stop")])
        self.assertEqual(out, "fine"); self.assertEqual(len(s), 2)
        self.assertFalse({"max_tokens", *SWITCH} & set(s[1]))
        self.assertIn("deepseek-v4-1-flash", server._thinking_refused)
        _, s = self.run_it("deepseek-v4-1-flash", 800)
        self.assertFalse({"max_tokens", *SWITCH} & set(s[0]))        # (from then on: asked plainly)
        with self.assertRaises(urllib.error.HTTPError):               # (anything but a 400 isn't about the switches)
            self.run_it("gemma4-31b", 800, [503])

    def test_never_a_cut_off_answer(self):
        out, s = self.run_it("deepseek-v4-1-flash", 400, [('{"half": ', "length"), ('{"whole": true}', "stop")])
        self.assertEqual(out, '{"whole": true}'); self.assertEqual(len(s), 2)
        self.assertEqual(s[0]["max_tokens"], 400); self.assertNotIn("max_tokens", s[1])
        self.assertEqual(s[1]["reasoning_effort"], "none")          # (still no thinking)
        out, s = self.run_it("gemma4-31b", 400, [("all of it", "stop")])
        self.assertEqual((out, len(s)), ("all of it", 1))

    def test_each_background_job_has_its_cap(self):
        sent = []
        brain = lambda mode, spoken=False, free_ok=False: ("http://127.0.0.1:9/v1", "fake", "gemma4-31b", mode)
        with mock.patch.object(server, "post", fake_post([], sent)), mock.patch.object(server, "brain", brain):
            server.learn_ask("Facts check (fake)")
            self.assertEqual((sent[-1]["max_tokens"], sent[-1]["temperature"]), (800, 0.2))
            server.ask("anything")
            self.assertNotIn("max_tokens", sent[-1])
            with mock.patch.object(server, "system_prompt", lambda *a, **k: "SYS"), \
                 mock.patch.object(server.social, "recent_messages", lambda *a, **k: []):
                server.first_text(CHAR, "text me first (fake)", 10)
            self.assertEqual(sent[-1]["max_tokens"], 400)

    def test_day_plan_cap(self):
        clean_billing(self)
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d)
        sent, cfg = [], {**server.cfg(), "lives": True}
        brain = lambda mode, spoken=False, free_ok=False: ("http://127.0.0.1:9/v1", "fake", "deepseek-v4-1-flash", mode)
        with mock.patch.object(social, "THREAD", os.path.join(d, ".thread.json")), mock.patch.object(social, "_private", []), \
             mock.patch.object(characters, "MINE", os.path.join(d, "my-characters")), \
             mock.patch.object(lives, "LIVES", os.path.join(d, "my-characters", "lives")), \
             mock.patch.object(lives, "WORLD", os.path.join(d, "my-characters", "lives", "_world.json")), \
             mock.patch.object(server, "cfg", lambda: cfg), mock.patch.object(images, "find", lambda c: None), \
             mock.patch.object(characters, "find", lambda cid, c: dict(CHAR, life=True)), \
             mock.patch.object(characters, "all_characters", lambda c: [dict(CHAR, life=True)]), \
             mock.patch.object(lives, "needs_plan", lambda *a, **k: True), \
             mock.patch.object(server, "post", fake_post([("{}", "stop")], sent)), mock.patch.object(server, "brain", brain):
            server.plan_day("maya", lazy=True)
        self.assertEqual(len(sent), 1)
        self.assertEqual((sent[0]["max_tokens"], sent[0]["reasoning_effort"]), (1500, "none"))

class Harness(unittest.TestCase):
    """Buddy's server on a free port, talking to the fake Tinfoil (everything it writes in a temporary folder)."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); d = self.tmp.name
        url = start_fake(self)
        self.cfg = {"save_chats": False, "lives": False, "real_timing": False, "learn_facts": False}
        real_read = server.read
        def read(name, default=""):                    # (never a real key: a fake Tinfoil key, no Phala or NEAR key)
            return "fake-key-for-tests" if name == ".tinfoil_key" else "" if name.endswith("_key") else real_read(name, default)
        for obj, name, value in [(social, "THREAD", os.path.join(d, ".thread.json")), (social, "_private", []),
                                 (social, "_marks", []), (social, "push", lambda *a, **k: 0),
                                 (social, "SUBS", os.path.join(d, ".push_subs.json")),
                                 (characters, "MINE", os.path.join(d, "my-characters")),
                                 (devices, "FILE", os.path.join(d, ".devices.json")),
                                 (devices, "MAC_TOKEN", os.path.join(d, ".mac_token")),
                                 (images, "MEDIA", os.path.join(d, ".media")), (images, "find", lambda c: None),
                                 (server, "CHATS", os.path.join(d, "chats")), (server, "recall", lambda *a, **k: []),
                                 (server, "local_cfg", lambda: dict(self.cfg)), (server, "tinfoil", lambda: url),
                                 (server, "read", read), (server, "tinfoil_models", lambda: list(MODELS)),
                                 (server, "_thinking_refused", set()), (memory, "folders", lambda: []),
                                 (localcheck, "check", lambda u: None), (facts, "for_prompt", lambda *a, **k: ([], [])),
                                 (facts, "kick", lambda *a, **k: None)]:
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)
        clean_billing(self)
        devices.ensure(); self.cookie = devices.mac_token()
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    def request(self, method, path, body=None, ctype="application/json"):
        port = self.srv.server_address[1]
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
        h = {"Host": f"127.0.0.1:{port}", "Cookie": f"buddy={self.cookie}", **({"Content-Type": ctype} if data is not None else {})}
        c.request(method, path, body=data, headers=h)
        r = c.getresponse(); out = r.read(); c.close()
        return r.status, out

    def chat(self, **kw):
        st, out = self.request("POST", "/api/chat", {"text": "hey, how's it going?", "char": "buddy", "private": False,
                                                     "via": "phone", **kw})
        return st, [json.loads(x) for x in out.decode().splitlines() if x.strip()]

    def status(self):
        return json.loads(self.request("GET", "/api/status")[1])

class Thinking(Harness):                              # no silent thinking before a text or a call reply starts
    def last(self):
        return chats_sent()[-1]

    def test_texts_and_calls(self):
        st, lines = self.chat(mode="companion")       # (deepseek: typed now gets the switch too)
        self.assertEqual(st, 200); self.assertIn({"s": "hey there."}, lines)
        b = self.last()
        self.assertEqual((b["model"], b["reasoning_effort"], b["chat_template_kwargs"]), ("deepseek-v4-1-flash", "none", {"thinking": False}))
        self.assertNotIn("max_tokens", b)              # (a text's length is the texting rules' job, as before)
        self.chat(mode="companion", via="call")
        b = self.last()
        self.assertEqual((b["reasoning_effort"], b["max_tokens"]), ("none", 300))
        self.chat(mode="advisor")
        b = self.last()
        self.assertEqual(b["model"], "gemma4-31b"); self.assertFalse({"max_tokens", *SWITCH} & set(b))
        self.chat(mode="advisor", via="call")
        b = self.last()
        self.assertEqual(b["max_tokens"], 300); self.assertFalse(set(SWITCH) & set(b))
        self.chat(mode="advisor", via="mac", spoken=True)
        self.assertFalse({"max_tokens", *SWITCH} & set(self.last()))

    def test_your_model_choice(self):
        self.cfg["advisor_model"] = "kimi-k3"
        self.chat(mode="advisor")
        b = self.last()
        self.assertEqual(b["model"], "kimi-k3"); self.assertFalse({"max_tokens", *SWITCH} & set(b))   # (no switch to send)
        self.chat(mode="advisor", via="call")
        self.assertEqual(self.last()["model"], "gemma4-31b")   # (out loud it always thinks first: as before, last resort)

    def test_a_refused_switch_is_dropped(self):
        Fake.plan.append(("/chat/completions", 400, b'{"error": "unknown field reasoning_effort"}'))
        st, lines = self.chat(mode="companion")
        self.assertIn({"s": "hey there."}, lines)
        a, b = chats_sent()[-2:]
        self.assertIn("reasoning_effort", a); self.assertNotIn("reasoning_effort", b)
        self.assertIn("deepseek-v4-1-flash", server._thinking_refused)

    def test_voice_picker_notes_the_pricier_voices(self):
        vs = json.loads(self.request("GET", "/api/voices")[1])
        pricey = {v["id"] for v in vs if v.get("note")}
        self.assertEqual(pricey, {"Vivian", "Serena", "Ryan", "Aiden"})
        self.assertTrue(all("5x" in v["note"] for v in vs if v.get("note")))
        with open(os.path.join(ROOT, "web", "chat.html")) as f:
            self.assertIn("v.note", f.read())

class Credits(Harness):                              # Tinfoil credits ran out: said plainly everywhere
    def test_chat(self):
        Fake.plan.append(("/chat/completions", 402, b'{"error": "Payment Required"}'))
        st, lines = self.chat()
        self.assertEqual(st, 200)
        self.assertIn({"error": billing.OUT, "credits": True}, lines)
        self.assertIn("top up in Tinfoil's dashboard (Billing)", billing.OUT)
        s = self.status()
        self.assertEqual((s["credits"], s["credits_note"]), ("out", billing.OUT))
        st, lines = self.chat()                        # topped up: it works, and the banner goes
        self.assertIn({"s": "hey there."}, lines)
        s = self.status()
        self.assertEqual((s["credits"], s["credits_note"]), (None, ""))

    def test_call_hearing_says_it_never_you_cut_out(self):
        Fake.plan.append(("/audio/transcriptions", 402, b'{"error": "Payment Required"}'))
        st, out = self.request("POST", "/api/stt?char=buddy&call=1&lang=en", WAV, "audio/wav")
        self.assertEqual(st, 402)
        self.assertEqual(json.loads(out), {"error": billing.OUT, "credits": True})
        self.assertEqual(len([p for p, _ in Fake.seen if p.endswith("/audio/transcriptions")]), 1)   # (asked once)
        self.assertEqual(self.status()["credits"], "out")
        st, out = self.request("POST", "/api/stt?char=buddy&call=1&lang=en", WAV, "audio/wav")
        self.assertEqual((st, json.loads(out)), (200, {"text": "hello"}))
        self.assertIsNone(self.status()["credits"])

    def test_spend_limit_and_other_429s(self):
        Fake.plan.append(("/audio/transcriptions", 429, b'{"error": {"message": "Spend limit reached for this API key"}}'))
        st, out = self.request("POST", "/api/stt?char=buddy&call=1", WAV, "audio/wav")
        self.assertEqual((st, json.loads(out)), (429, {"error": billing.LIMIT, "credits": True}))
        self.assertEqual((self.status()["credits"], self.status()["credits_note"]), ("limit", billing.LIMIT))
        billing.worked()
        Fake.plan.append(("/audio/transcriptions", 429, b'{"error": "Too many requests, slow down"}'))
        st, out = self.request("POST", "/api/stt?char=buddy&call=1", WAV, "audio/wav")
        self.assertEqual(st, 502); self.assertNotIn("credits", json.loads(out))   # (just busy: as before)
        self.assertIsNone(self.status()["credits"])

    def test_voice_and_other_requests(self):
        Fake.plan.append(("/audio/speech", 402, b"{}"))
        st, out = self.request("POST", "/api/speak", {"text": "Something fake to say.", "voice": "casual_female", "stream": True})
        self.assertEqual((st, json.loads(out)), (402, {"error": billing.OUT, "credits": True}))
        self.assertEqual(len([p for p, _ in Fake.seen if p.endswith("/audio/speech")]), 1)   # (no second try as a file)
        Fake.plan.append(("/chat/completions", 402, b"{}"))
        st, out = self.request("POST", "/api/characters/create", {"description": "a fake friendly baker"})
        self.assertEqual((st, json.loads(out)), (402, {"error": billing.OUT, "credits": True}))

    def test_status_until_it_works(self):
        billing.refused(urllib.error.HTTPError("x", 402, "x", {}, io.BytesIO(b"")))
        self.assertTrue(billing.paused())
        billing._state["at"] = time.time() - 16 * 60   # (15 minutes later: background work tries again...)
        self.assertFalse(billing.paused())
        self.assertEqual(billing.status(), "out")      # (...and the banner stays until something works)

    def test_character_creation_cap(self):
        made = [{"name": "Testa", "tagline": "fake", "persona": "You are Testa, a fake test character.",
                 "voice": "casual_female", "appearance": "an adult woman in her thirties with short dark hair",
                 "style": "photo", "brain": "advisor", "life_seed": "", "folders": [], "avoid": ""}]
        Fake.plan.append(("/chat/completions", 200, json.dumps({"choices": [{"message": {"content": json.dumps(made)},
                                                                              "finish_reason": "stop"}]}).encode()))
        st, out = self.request("POST", "/api/characters/create", {"description": "a fake friendly baker"})
        self.assertEqual(st, 200, out)
        b = chats_sent()[-1]
        self.assertEqual((b["model"], b["max_tokens"], b["temperature"]), ("gemma4-31b", 4000, 1.0))

class Background(unittest.TestCase):                  # while credits are out, background work waits 15 minutes
    def setUp(self):
        clean_billing(self)
        self.d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, self.d)

    def out(self):
        billing.refused(urllib.error.HTTPError("x", 402, "x", {}, io.BytesIO(b"")))

    def test_lives_texts_first_and_planning(self):
        calls = []
        with mock.patch.object(server, "life_chars", lambda c=None: calls.append("life") or []), \
             mock.patch.object(characters, "find", lambda cid, c: calls.append("find")), \
             mock.patch.object(characters, "all_characters", lambda c: [dict(CHAR, texts_first=True)]), \
             mock.patch.object(server, "first_text", lambda *a: calls.append("text") or ("hi", None, [])), \
             mock.patch.object(server, "cfg", lambda: {"lives": True}), \
             mock.patch.object(social, "THREAD", os.path.join(self.d, ".thread.json")):
            self.out()
            self.assertEqual(server.life_tick(10, False), [])
            self.assertFalse(server.plan_day("maya"))
            self.assertIsNone(server.proactive_text("check in", 10))
            self.assertEqual(calls, [])
            server.plan_day("maya", lazy=True, asked=True)   # ("Redo today": you asked, so it tries)
            self.assertEqual(calls, ["find"])
            billing.worked(); calls.clear()
            server.life_tick(10, False); server.plan_day("maya"); server.proactive_text("check in", 10)
            self.assertEqual(calls, ["life", "find", "text"])

    def test_facts_learning(self):
        with open(os.path.join(self.d, ".tinfoil_key"), "w") as f: f.write("fake")
        learned = []
        with mock.patch.object(facts, "HERE", self.d), mock.patch.object(facts, "STATE", os.path.join(self.d, ".facts_state.json")), \
             mock.patch.object(facts, "due", lambda *a, **k: True), \
             mock.patch.object(facts, "learn", lambda c, *a, **k: learned.append(c["id"])), \
             mock.patch.object(social, "THREAD", os.path.join(self.d, ".thread.json")):
            tick = lambda: facts.tick(lambda: {}, lambda p: "", lambda: [{"id": "maya", "name": "Maya"}], lambda cid: False)
            self.out(); tick()
            self.assertEqual(learned, [])
            billing.worked(); tick()
            self.assertEqual(learned, ["maya"])

    def test_embeddings_wait_keywords_dont(self):
        vault = os.path.join(self.d, "vault"); os.makedirs(vault)
        with open(os.path.join(vault, "note.md"), "w") as f: f.write("A fake note about a fake garden.")
        sent = []
        def embed(texts, prefix, timeout=120):
            sent.extend(texts); memory.STATE["by"] = "tinfoil"; return [[1.0, 0.0] for _ in texts]
        with mock.patch.object(memory, "VAULT", vault), mock.patch.object(memory, "INDEX", os.path.join(self.d, "idx.json")), \
             mock.patch.object(memory, "_index", {}), mock.patch.dict(memory.STATE, {"by": None, "error": ""}), \
             mock.patch.object(memory, "_embed", embed):
            self.out(); memory.refresh()
            self.assertEqual(sent, [])
            self.assertEqual(memory.search("garden", meaning=False), ["[note]\nA fake note about a fake garden."])
            billing.worked(); memory.refresh()
            self.assertEqual(len(sent), 1)

    def test_embedding_402_is_noticed(self):
        url = start_fake(self)
        Fake.plan.append(("/embeddings", 402, b"{}"))
        with mock.patch.object(memory, "_key", lambda: "fake-key-for-tests"), mock.patch.object(memory.tinfoilproxy, "url", lambda: url), \
             mock.patch.object(memory, "OLLAMA", "http://127.0.0.1:9/api/embed"), mock.patch.object(localcheck, "check", lambda u: None), \
             mock.patch.dict(memory.STATE, {"by": None, "error": ""}):
            with self.assertRaises(Exception): memory._embed(["fake"], "search_document: ")
            self.assertEqual(billing.status(), "out")
            self.assertEqual(len(memory._embed(["fake"], "search_document: ")), 1)
            self.assertIsNone(billing.status())

class PromptOrder(unittest.TestCase):                 # the start of the prompt stays the same; only the order changed
    def setUp(self):
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d)
        os.makedirs(os.path.join(d, "Buddy knows"))
        with open(os.path.join(d, "Buddy knows", "maya.md"), "w") as f:
            f.write("# What Maya knows about you\n\n- I live in a small flat by the river (learned 2026-09-01)\n"
                    "- I play guitar on weekends (learned 2026-10-01)\n- My sister is called Lena (added 2026-09-15)\n")
        with open(os.path.join(d, "Buddy knows", "_everyone.md"), "w") as f:
            f.write("- I work night shifts at a fake bakery (added 2026-08-01)\n- I don't eat meat (added 2026-08-02)\n")
        class FakeDT(datetime.datetime):
            @classmethod
            def now(cls, tz=None): return cls(2026, 10, 10, 9, 30)
        for obj, name, value in [(facts, "DIR", os.path.join(d, "Buddy knows")), (facts, "STATE", os.path.join(d, ".fs.json")),
                                 (facts, "_cache", {}),
                                 (server, "life_block", lambda c, v: "YOUR OWN LIFE (fake): read a book this morning."),
                                 (server, "recall", lambda c, q, f, live=False: [f"[notes/fake]\nA fake note about {q}."]),
                                 (server, "since_last_talk", lambda cid, skip_newest=True: ""),
                                 (server, "datetime", types.SimpleNamespace(datetime=FakeDT, date=datetime.date)),
                                 (images, "find", lambda c: {"provider": "local"})]:
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)

    def turn(self, text, extra=()):
        return server.system_prompt(CHAR, "advisor", text, None, via="phone", extra=list(extra),
                                    length=server.length_hint(text, "phone"))

    def test_same_start_every_turn(self):
        late = server.LATE_NOTE.format(busy="")
        a = self.turn("how was the guitar lesson today", [late])
        b = self.turn("what's for dinner tonight?")
        cut = a.index(server.FACTS_RULE) + len(server.FACTS_RULE)
        self.assertEqual(a[:cut], b[:cut])            # persona, mode, style, photos, their life, the facts: the same
        self.assertNotEqual(a[cut:], b[cut:])
        order = [CHAR["persona"], "Your name is Maya.", server.read("mode_advisor.txt")[:40], "We're texting on my phone",
                 server.PHOTOS, "YOUR OWN LIFE (fake)", server.FACTS_HEAD, late, "Things you remember about me",
                 "Right now it's Saturday 10 October 2026, 09:30.", server.length_hint("how was the guitar lesson today", "phone")]
        at = [a.index(x) for x in order]
        self.assertEqual(at, sorted(at))
        self.assertTrue(a.endswith(order[-1]))

    def test_same_content(self):                      # (exactly what it was given before, nothing added or dropped)
        late = server.LATE_NOTE.format(busy="")
        text = "how was the guitar lesson today"
        with mock.patch.object(edition, "PUBLIC", False):   # (the private copy's prompt; the public one adds its rules)
            p = self.turn(text, [late])
        known, _ = facts.for_prompt(CHAR, text)
        style = server.TEXTING.format(where=" on my phone")
        parts = [CHAR["persona"], "Your name is Maya. You are an adult.", server.read("mode_advisor.txt"), style, late,
                 "YOUR OWN LIFE (fake): read a book this morning.", server.PHOTOS,
                 server.FACTS_HEAD + "\n" + "\n".join("- " + f for f in known) + "\n" + server.FACTS_RULE,
                 "Things you remember about me (from my notes and past chats):\n\n[notes/fake]\nA fake note about " + text + ".",
                 "Right now it's Saturday 10 October 2026, 09:30.", server.length_hint(text, "phone")]
        for x in parts:
            self.assertEqual(p.count(x), 1, x[:60])
        self.assertEqual(len(p), sum(map(len, parts)) + 2 * (len(parts) - 1))

    def test_facts_in_a_fixed_order(self):
        a, _ = facts.for_prompt(CHAR, "guitar lesson")
        b, _ = facts.for_prompt(CHAR, "my sister Lena")
        self.assertEqual(a, b)
        self.assertEqual(a, ["I work night shifts at a fake bakery", "I don't eat meat", "I live in a small flat by the river",
                             "I play guitar on weekends", "My sister is called Lena"])   # (shared, then its own: file order)
        lots = os.path.join(facts.DIR, "maya.md")      # over the cap: still the most fitting ones, in file order
        with open(lots, "a") as f:
            for i in range(120): f.write(f"- I collect fake stamp number {i} from a far away place (learned 2026-07-01)\n")
        facts._cache.clear()
        c, _ = facts.for_prompt(CHAR, "guitar weekends")
        self.assertIn("I play guitar on weekends", c)
        self.assertLess(len(c), 125)
        pos = {f["text"]: i for i, f in enumerate(facts.load("maya"))}
        own = [x for x in c if x in pos]
        self.assertEqual(c, [x for x in c if x not in pos] + own); self.assertEqual(own, sorted(own, key=pos.get))

class FactsLearning(unittest.TestCase):               # only the facts that matter for what was just said
    def known(self, n=100, guitar=(5, 50)):
        out = []
        for i in range(n):
            t = f"I play guitar in fake band {i}" if i in guitar else f"Fake fact number {i} about topic{i}"
            out.append(("mine", {"id": f"x{i}", "text": t, "date": (datetime.date(2026, 1, 1) + datetime.timedelta(days=i)).isoformat()}))
        return out

    def test_relevant(self):
        k = self.known()
        new = [{"role": "user", "content": "I finally bought a new guitar"}, {"role": "assistant", "content": "nice!"}]
        self.assertEqual(facts.relevant(k, new), k)                               # (up to 200: all of them, as before)
        many = [(w, dict(f, id=f"y{n}_{f['id']}")) for n in range(3) for w, f in self.known(guitar=range(0, 10))]
        got = facts.relevant(many, new)
        self.assertLessEqual(len(got), 200)                                       # (past 200: the newest + related)
        self.assertTrue(all(f["id"] in {g["id"] for _, g in got} for _, f in many if "guitar" in f["text"]))

    def test_learning_prompt(self):
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d)
        os.makedirs(os.path.join(d, "Buddy knows"))
        with open(os.path.join(d, "Buddy knows", "maya.md"), "w") as f:
            for _, x in self.known():
                f.write(f"- {x['text']} (learned {x['date']})\n")
            f.write("- I live in Tashkent (learned 2026-01-02)\n")
        asked = []
        with mock.patch.object(facts, "DIR", os.path.join(d, "Buddy knows")), mock.patch.object(facts, "VAULT", d), \
             mock.patch.object(facts, "STATE", os.path.join(d, ".fs.json")), mock.patch.object(facts, "_cache", {}), \
             mock.patch.object(social, "THREAD", os.path.join(d, ".thread.json")):
            msgs = [{"id": 1, "role": "user", "content": "I moved to Berlin last week", "char": "maya", "ts": time.time()}]
            facts.learn(CHAR, {}, lambda p: asked.append(p) or '{"add": [], "update": [], "remove": []}', msgs=msgs)
        known = re.findall(r"^f\d+\. (.*)$", asked[0], re.M)
        self.assertEqual(len(known), 101)                                         # (every fact, so an old one can change)
        self.assertIn("I live in Tashkent", known)

class Embeddings(unittest.TestCase):                  # a changed note: only the new text is embedded
    def setUp(self):
        clean_billing(self)
        self.d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, self.d)
        self.note = os.path.join(self.d, "chats", "maya", "2026-10-10.md"); os.makedirs(os.path.dirname(self.note))
        self.sent, self.by = [], "tinfoil"
        def embed(texts, prefix, timeout=120):
            self.sent.append(list(texts)); memory.STATE["by"] = self.by
            return [[float(len(t)), 1.0] for t in texts]
        for p in (mock.patch.object(memory, "VAULT", self.d), mock.patch.object(memory, "INDEX", os.path.join(self.d, "idx.json")),
                  mock.patch.object(memory, "_index", {}), mock.patch.dict(memory.STATE, {"by": None, "error": ""}),
                  mock.patch.object(memory, "_embed", embed)):
            p.start(); self.addCleanup(p.stop)

    def write(self, paras, n):
        with open(self.note, "w") as f: f.write("\n\n".join(paras))
        os.utime(self.note, (1_700_000_000 + n, 1_700_000_000 + n))

    def chunks(self):
        return memory._index[self.note]["chunks"]

    def test_only_new_text(self):
        paras = [f"**Me:** fake line {i} " + "x" * 600 for i in range(3)]
        self.write(paras, 1); memory.refresh()
        self.assertEqual(len(self.sent[-1]), 3)
        before = [c["vec"] for c in self.chunks()]
        self.write(paras + ["**Me:** a fourth fake line " + "y" * 600], 2); memory.refresh()
        self.assertEqual(len(self.sent), 2); self.assertEqual(len(self.sent[-1]), 1)   # (just the new part)
        self.assertIn("fourth", self.sent[-1][0])
        self.assertEqual([c["vec"] for c in self.chunks()][:3], before)
        paras[1] = "**Me:** a changed fake line " + "z" * 600
        self.write(paras + ["**Me:** a fourth fake line " + "y" * 600], 3); memory.refresh()
        self.assertEqual(len(self.sent[-1]), 1); self.assertIn("changed", self.sent[-1][0])
        self.assertTrue(all(c["vec"] for c in self.chunks()))
        self.assertEqual(memory.health()["smart_notes"], 1)
        memory.refresh(); self.assertEqual(len(self.sent), 3)      # (nothing changed: nothing sent)

    def test_other_search_or_paused(self):
        paras = [f"fake paragraph {i} " + "x" * 600 for i in range(3)]
        self.write(paras, 1); memory.refresh()
        self.by = "ollama"                             # (Tinfoil can't be reached; Ollama on this Mac answers)
        self.write(paras + ["fake paragraph 3 " + "y" * 600], 2); memory.refresh()
        self.assertEqual([len(s) for s in self.sent[1:]], [1, 3])  # (vectors from another search don't fit: the rest too)
        self.assertEqual(sorted(self.sent[1] + self.sent[2]), sorted(c["text"] for c in self.chunks()))
        self.assertEqual(memory._index[self.note]["by"], "ollama")
        self.by = "ollama"
        billing.refused(urllib.error.HTTPError("x", 402, "x", {}, io.BytesIO(b"")))   # credits ran out
        self.write(paras + ["fake paragraph 3 " + "y" * 600, "fake paragraph 4 " + "w" * 600], 3); memory.refresh()
        self.assertEqual(len(self.sent), 3)            # (nothing sent while it waits; the note is indexed for keywords)
        self.assertEqual(len(self.chunks()), 5); self.assertEqual(sum(1 for c in self.chunks() if c["vec"]), 4)
        billing.worked(); memory.refresh()
        self.assertEqual(len(self.sent[-1]), 1); self.assertIn("paragraph 4", self.sent[-1][0])
        self.assertTrue(all(c["vec"] for c in self.chunks()))

class Hearing(unittest.TestCase):                     # a setting to try another speech-to-text model (default: Whisper)
    def test_setting(self):
        with mock.patch.dict(server._stt_down, {"at": 0}):
            with mock.patch.object(server, "cfg", lambda: {}):
                self.assertEqual(server.stt_model(), server.STT)
            with mock.patch.object(server, "cfg", lambda: {"stt_model": "voxtral-small-24b"}):
                self.assertEqual(server.stt_model(), "voxtral-small-24b")
            with mock.patch.object(server, "cfg", lambda: {"stt_model": "bad model; name"}):
                self.assertEqual(server.stt_model(), server.STT)

    def test_a_broken_choice_falls_back_to_whisper(self):
        calls = []
        def post(url, key, body, ctype="", timeout=0):
            m = re.search(r'name="model"\r\n\r\n([^\r]*)', body.decode(errors="ignore")).group(1); calls.append(m)
            if m != server.STT: raise urllib.error.HTTPError(url, 503, "x", {}, io.BytesIO(b"busy"))
            return Resp({"text": "hello"})
        with mock.patch.object(server, "post", post), mock.patch.object(server, "tinfoil", lambda: "http://x/v1"), \
             mock.patch.object(server, "read", lambda n, d="": "fake"), mock.patch.dict(server._stt_down, {"at": 0}), \
             mock.patch.object(server, "cfg", lambda: {"stt_model": "voxtral-small-24b"}):
            self.assertEqual(server.whisper(b"RIFFfake", "audio/wav", CHAR), "hello")
        self.assertEqual(calls, ["voxtral-small-24b", server.STT])
        self.assertEqual(server._stt_down["at"], 0)    # (Whisper itself is fine)

class Billing(unittest.TestCase):
    def setUp(self):
        clean_billing(self)

    def err(self, code, body=b""):
        return urllib.error.HTTPError("x", code, "x", {}, io.BytesIO(body))

    def test_kinds(self):
        self.assertEqual(billing.kind(self.err(402)), "out")
        self.assertEqual(billing.kind(self.err(429, b'{"error": "Spend limit reached"}')), "limit")
        self.assertEqual(billing.kind(self.err(429, b'{"error": "spending_limit_exceeded"}')), "limit")
        self.assertIsNone(billing.kind(self.err(429, b'{"error": "rate limit: too many requests"}')))
        self.assertIsNone(billing.kind(self.err(500)))
        self.assertIsNone(billing.kind(RuntimeError("no")))
        e = self.err(429, b"Spend limit reached")
        billing.kind(e); self.assertEqual(billing.said(e), "Spend limit reached")   # (read once, kept for the next reader)
        self.assertEqual(server.whisper_said(e), "Spend limit reached")

    def test_post_notices_and_clears(self):
        url = start_fake(self)
        Fake.plan.append(("/chat/completions", 402, b"{}"))
        with mock.patch.object(localcheck, "check", lambda u: None):
            with self.assertRaises(urllib.error.HTTPError):
                server.post(url + "/chat/completions", "fake", b'{"model": "gemma4-31b"}')
            self.assertEqual((billing.status(), billing.message()), ("out", billing.OUT))
            self.assertTrue(billing.paused())
            with server.post(url + "/chat/completions", "fake", b'{"model": "gemma4-31b"}') as r: r.read()
            self.assertEqual((billing.status(), billing.message(), billing.paused()), (None, "", False))

class Page(unittest.TestCase):                        # the page still parses, and says it the plain way
    @unittest.skipUnless(shutil.which("node"), "needs node")
    def test_node_check(self):
        with open(os.path.join(ROOT, "web", "chat.html")) as f: html = f.read()
        js = re.search(r"<script>(.*)</script>", html, re.S).group(1)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "page.js")
            with open(p, "w") as f: f.write(js)
            r = subprocess.run(["node", "--check", p], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertIn("j.credits", js); self.assertIn("creditsOut(", js)
        self.assertIn(billing.OUT, js)                 # (the same words as the server's)

if __name__ == "__main__":
    unittest.main()
