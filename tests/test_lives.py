"""Tests for characters' own lives (lives.py and how buddy_server.py uses it). Fake data only: no network, no real vault,
thread, notes or keys (every file Buddy would write goes to a temporary folder; the model is a fake on 127.0.0.1).
Run from Buddy's folder:  python3 -m unittest discover -s tests -v"""
import datetime, json, os, subprocess, sys, tempfile, threading, time, unittest
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import characters, facts, images, lives, localcheck, social
import buddy_server as server

class Logic(unittest.TestCase):
    def test_checks(self):                            # (own process: it sets a time zone)
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "tests", "lives_checks.py"), "45"],
                           capture_output=True, text=True, timeout=600)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertIn("OK", r.stdout)

SEEN = []
def plan_reply(prompt):
    h = time.localtime().tm_hour
    ev = [{"at": f"{max(h - 3, 5):02d}:10", "what": "overslept, cold shower", "plan": "", "mood": "grumpy", "kind": "mundane"},
          {"at": f"{max(h - 1, 6):02d}:00", "what": "burnt the toast at the studio", "plan": "studio shift", "mood": "annoyed", "kind": "work"},
          {"at": f"{min(h + 2, 22):02d}:00", "what": "climbing, finally sent the blue route", "plan": "climbing after work", "mood": "proud", "kind": "hobby"},
          {"at": f"{min(h + 3, 22):02d}:30", "what": "texted you about your exam", "plan": "", "mood": "", "kind": "social"}]
    j = {"today": {"summary": "a long studio day, then climbing", "events": ev},
         "moments": [{"at": f"{min(h + 2, 22):02d}:40", "event": 3, "angle": "share"}],
         "ongoing": [{"what": "training for a 10k", "since": "2026-09-20"}, {"what": "your birthday plans", "since": ""}],
         "about": ["Lives in a small top-floor flat", "Mixes sound at a tiny studio", "Thinks about you all day"],
         "people": [{"name": "Lena", "who": "my older sister, a nurse"}, {"name": "Sam", "who": "your boss"}]}
    if '"know"' in prompt:
        j["know"] = [{"name": "Buddy", "know": True, "how": "old flatmates"}, {"name": "Nobody", "know": True, "how": "x"}]
    return "Sure! ```json\n" + json.dumps(j) + "\n```"

class FakeModel(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        j = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        msgs = j["messages"]; last = msgs[-1]["content"]
        SEEN.append({"sys": msgs[0]["content"] if msgs[0]["role"] == "system" else "", "last": last})
        if "Reply with ONLY this JSON" in last: out = plan_reply(last)
        elif "voice message" in last: out = "Guess who finally sent the blue route! Still shaking."
        else: out = "ok wait, the toast thing got worse\n\nthe whole studio smells like smoke now 😂"
        b = json.dumps({"choices": [{"message": {"content": out}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

WAV = (b"RIFF" + (36 + 4800).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00\x01\x00"
       + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little") + b"\x02\x00\x10\x00data" + (4800).to_bytes(4, "little")
       + b"\0" * 4800)

class Server(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); d = self.tmp.name
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{self.srv.server_address[1]}/v1"
        self.cfg = {}; self.pushes = []
        base = server.cfg
        for p in [mock.patch.object(social, "THREAD", os.path.join(d, ".thread.json")),
                  mock.patch.object(social, "_private", []), mock.patch.object(social, "_marks", []),
                  mock.patch.object(characters, "MINE", os.path.join(d, "my-characters")),
                  mock.patch.object(lives, "LIVES", os.path.join(d, "my-characters", "lives")),
                  mock.patch.object(lives, "WORLD", os.path.join(d, "my-characters", "lives", "_world.json")),
                  mock.patch.object(images, "MEDIA", os.path.join(d, ".media")),
                  mock.patch.object(server, "CHATS", os.path.join(d, "chats")),
                  mock.patch.object(server, "cfg", lambda: {**base(), **self.cfg}),
                  mock.patch.object(server, "save_cfg", lambda **k: self.cfg.update(k)),
                  mock.patch.object(server, "brain", lambda mode, spoken=False, free_ok=False: (url, "fake", "fake-model", mode)),
                  mock.patch.object(localcheck, "check", lambda url: None),
                  mock.patch.object(server, "recall", lambda *a, **k: []),            # (never your real notes)
                  mock.patch.object(facts, "for_prompt", lambda *a, **k: ([], [])),
                  mock.patch.object(server, "tts_wav", lambda text, voice: WAV),
                  mock.patch.object(images, "find", lambda c: None),
                  mock.patch.object(social, "push", lambda note="", contact="", title="Buddy": self.pushes.append((title, note)) or 1)]:
            p.start(); self.addCleanup(p.stop)
        self.cfg.update(lives=True, proactive=True, quiet_from=23.0, quiet_until=0.0, save_chats=True)   # (never quiet before 23h)
        if not 6 <= time.localtime().tm_hour < 22:     # (its fake day is laid out around the hour: needs daytime)
            self.skipTest("too close to quiet hours or the day's start (4:00) for this test")

    def tearDown(self):
        with server._plan_lock: pass                  # (a day being planned in the background finishes in here)
        self.srv.shutdown(); self.srv.server_close(); self.tmp.cleanup()

    def due_now(self, cid, angle):
        def f(lg):
            dd = lives.day(lg, lives.life_date(time.time()))
            dd["moments"] = [{"id": "m9", "event": "e1", "at": "12:00", "due": time.time() - 60, "angle": angle,
                              "state": "pending", "msg": None}]
            return lg
        lives.change(cid, f)

    def test_life_end_to_end(self):
        now = time.time()
        for k in range(6, 0, -1):                     # you text in the evenings on 6 days, last 3 hours ago
            social.add("user", f"fake message {k}", char="buddy", via="phone")
        t = social._load(social.THREAD, [])
        for i, m in enumerate(t): m["ts"] = now - (6 - i) * 86400 - 3 * 3600
        social._save(social.THREAD, t)
        maya = characters.save({"name": "Maya", "persona": "You are Maya, 29, a sound engineer.", "texts_first": True,
                                "texts_per_day": 2, "life_seed": "Lives in Lisbon, works at a studio."}, server.cfg())
        self.assertEqual((maya["id"], maya["life"], maya["texts_per_day"]), ("maya", True, 2))

        # her day: planned once, nothing about you kept, the tie to Buddy decided by the plan
        self.assertTrue(server.plan_day("maya", lazy=True))
        self.assertFalse(server.plan_day("maya", lazy=True))
        log = lives.load("maya"); d = lives.day(log, lives.life_date(time.time()))
        self.assertEqual(len(d["events"]), 3)
        self.assertEqual(log["about"], ["Lives in a small top-floor flat", "Mixes sound at a tiny studio"])
        self.assertEqual([p["name"] for p in log["people"]], ["Lena"])
        self.assertEqual([o["what"] for o in log["ongoing"]], ["training for a 10k"])
        self.assertEqual(lives.world(), {"buddy+maya": {"know": True, "how": "old flatmates", "by": "ai"}})
        plan = [s for s in SEEN if "Reply with ONLY this JSON" in s["last"]][-1]["last"]
        self.assertIn("Lives in Lisbon", plan); self.assertIn("Other people I talk to", plan)
        self.assertNotIn("fake message", plan)        # your messages never go into her day
        self.assertEqual(os.stat(lives.path("maya")).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(lives.LIVES).st_mode & 0o777, 0o700)

        # in chats: her own life, future only as plans; Buddy knows her as a friend (her life only)
        sp = server.system_prompt(maya, "advisor", "hi", None, via="phone")
        self.assertIn("YOUR OWN LIFE", sp); self.assertIn("overslept", sp)
        self.assertIn("climbing after work", sp); self.assertNotIn("finally sent", sp)
        spb = server.system_prompt(characters.get("buddy", server.cfg()), "advisor", "hi", None, via="phone")
        self.assertIn("Your friend Maya (old flatmates)", spb); self.assertNotIn("climbing", spb)

        # a due moment: two quick texts, tagged, marked, saved, notified with the text
        self.due_now("maya", "share")
        with mock.patch.object(server.time, "sleep", lambda s: None):
            sent = server.life_tick(10, False)
        self.assertEqual([m["content"] for m in sent], ["ok wait, the toast thing got worse", "the whole studio smells like smoke now 😂"])
        self.assertTrue(all(m["proactive"] and m["char"] == "maya" and m["life"].endswith("/m9") for m in sent))
        self.assertEqual(lives.day(lives.load("maya"), lives.life_date(time.time()))["moments"][0]["state"], "sent")
        self.assertEqual(self.pushes[-1][0], "Maya"); self.assertIn("toast", self.pushes[-1][1])
        chat = os.path.join(server.CHATS, "maya", datetime.date.today().isoformat() + ".md")
        with open(chat) as f: self.assertIn("(texted first)", f.read())
        self.assertIn("overslept", [s for s in SEEN if "texting me first" in s["last"]][-1]["last"])
        self.assertEqual(server.life_tick(10, False), [])

        # a voice moment from Buddy (no push: you're at the Mac)
        self.cfg.update(life_gap_min=0, life_after_chat_min=0)
        server.plan_day("buddy", lazy=True)
        with server._plan_lock: pass                  # (the tick may have started it already)
        self.assertTrue(lives.day(lives.load("buddy"), lives.life_date(time.time())))
        self.due_now("buddy", "voice")
        sent = server.life_tick(1, False)
        self.assertEqual(len(sent), 1); self.assertTrue(sent[0]["voice"] and sent[0]["dur"] > 0)
        self.assertTrue(images.path(sent[0]["voice"])); self.assertEqual(len(self.pushes), 1)

        # the app's view; edits; deleting the character takes her life and ties
        info = server.life_info(maya)
        self.assertEqual((info["ties"][0]["id"], info["ties"][0]["know"]), ("buddy", True))
        self.assertNotIn("fake message", json.dumps(info))
        lives.change("maya", lambda lg: lives.edit(lg, "maya", {"about": ["Has a grey cat", "Loves you"]}, time.time()))
        self.assertEqual(lives.load("maya")["about"], ["Has a grey cat"])
        characters.delete("maya")
        self.assertFalse(os.path.exists(lives.path("maya"))); self.assertEqual(lives.world(), {})
        self.assertEqual(server.stored_info()["lives"]["count"], 1)

        # lives off: no block, no plan
        self.cfg.update(lives=False)
        self.assertEqual(server.life_block(characters.get("buddy", server.cfg()), "phone"), "")
        lives.delete("buddy"); self.assertFalse(server.plan_day("buddy", lazy=True))

if __name__ == "__main__":
    unittest.main()
