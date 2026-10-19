"""Characters' photos arrive as pictures, never as words like "[image: …]"; no glazing; a serious character (a coach, a
"future me") stays serious and follows up on what you said you'd do, while casual ones stay exactly as casual; and a
typed message that asks for depth may think first on Tinfoil. Fake data only: a fake Tinfoil, Cloudflare and Phala on
127.0.0.1, fake keys, a temp folder (run with HOME set to a temp folder):  python3 -m unittest discover -s tests -v"""
import datetime, http.client, json, os, random, re, shutil, sys, tempfile, threading, time, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import billing, characters, devices, edition, facts, images, lives, localcheck, memory, social
import buddy_server as server

WAV = (b"RIFF" + (4836).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\x01\x00\x01\x00"
       + (24000).to_bytes(4, "little") + (48000).to_bytes(4, "little") + b"\x02\x00\x10\x00data" + (4800).to_bytes(4, "little")
       + b"\0" * 4800)
MAKER = {"provider": "local", "model": "fake-z-image", "app": "drawthings", "label": "Fake", "tuned": True, "eta_s": 5}
# What models write instead of sending a photo (and the scene each one means).
SPELLINGS = [("haha ok [image: me at the gym, sweaty]", "me at the gym, sweaty"),
             ("sure! (image: me at the gym)", "me at the gym"),
             ("sure! *image: me at the gym*", "me at the gym"),
             ("[Image of me holding a coffee]", "me holding a coffee"),
             ("📸 me on my balcony at sunset", "me on my balcony at sunset"),
             ("[selfie: me at the climbing wall]", "me at the climbing wall"),
             ("[sends a photo of my new desk]", "my new desk"),
             ("(I sent you a photo: me in the park)", "me in the park"),
             ("*sends a selfie at the beach*", "selfie at the beach"),
             ("here you go 📷 [photo of the sunset from my window]", "the sunset from my window"),
             ("ok wait\n\nImage: me in the kitchen", "me in the kitchen"),
             ("**[Image: a man in his late twenties grinning at the camera]**", "a man in his late twenties grinning at the camera"),
             ("<image: me at the market>", "me at the market"),
             ("【photo: me at the lake】", "me at the lake"),
             ("[I’m sending you a photo: me on the bus]", "me on the bus"),
             ("[Image description: a man with messy hair and a grey hoodie]", "a man with messy hair and a grey hoodie"),
             ("there ![me in my new jacket](selfie.jpg)", "me in my new jacket"),                 # (markdown)
             ("(photo: me at the gym. so sweaty\n\nanyway, you?", "me at the gym. so sweaty"),   # (never closed)
             ("look [photo: me at the beach. it was windy", "me at the beach. it was windy"),     # (cut off at the end)
             ("[photo: me at the gym]", "me at the gym"),
             # the action forms both reviews found shown as words
             ("*sends a mirror selfie*", "mirror selfie"),
             ("*sends a gym selfie*", "gym selfie"),
             ("*sends a sunset photo*", "sunset photo"),
             ("*sends a selfie grinning*", "selfie grinning"),
             ("*sends a pic, smiling*", "pic, smiling"),
             ("omg ok *takes a selfie and sends it*", "a casual selfie"),
             ("*sends a cute selfie wearing your hoodie*", "cute selfie wearing your hoodie"),
             ("*shows you a photo of my cat*", "my cat"),
             ("*photo attached: me at the gym*", "me at the gym"),
             ("(sends a selfie, winking)", "selfie, winking"),
             ("_sends a selfie, grinning_", "selfie, grinning"),
             ("[takes a mirror selfie]", "mirror selfie"),
             ("{pic: me at the bakery}", "me at the bakery"),
             ("(here's a pic of me at the gym)", "me at the gym"),
             ("on my way *sends a selfie from the bus*", "selfie from the bus")]
# Text that mentions photos but isn't one they're sending: shown exactly as before (only * and _ dropped), no picture.
NOT_PHOTOS = ["omg yes 😭 (the photo of your dog killed me)", "_photo of the day_ goes to you honestly",
              "yes!! *the photo* is my new wallpaper", "(the pics from saturday are in the group chat btw)",
              "(photo of the full fit pls)", "Selfies: overrated.", "omg this **photo** is so good",
              "**Photos:** back them up to iCloud first…", "📸 nice shot!", "send the *image* to your boss",
              "Photos: love them, I take a ton", "Image: the brand logo should be on the left", "Selfie: no. Group photo: yes.",
              "(photos from the trip are on my drive btw)", "_Photo by me_", "Haha yes. 📸 moment for sure lol",
              "ugh :( that sucks", "love you <3", "(sending a pic soon)", "I took that photo last week", "📸 lol",
              "*laughs* okay", "that picture of you at the lake was so good", "my_photo_album is full",
              "here's my pic of the day: sunset", "(i sent the pic to my mom lol)", "*takes a deep breath*",
              "(show me a pic!)", "*shows you your photo*", "(sends back the photo you sent)", "i *sent* you a pic yesterday",
              "(i'll send a pic when i get home)", "*sending a selfie later*", "(photo: not great tbh)", "(pic-perfect day)",
              "ooh new outfit? *send pics* 👀", "wait you went skydiving?? (send pics or it didn't happen)",
              "clean everything first (take photos of every room before you hand the keys back)",
              "always *take a photo* of the receipt", "you should *take pics* at the wedding",
              "(attach a photo of the damage to the claim)", "aww (take a selfie with her!!)",
              "ok here's what i'd do:\n* Take photos of every room before you leave.\n* Keep all your receipts.",
              "aw :[ that sucks. hope tomorrow's better",
              "honestly go with the blue one (here's why: it matches your shoes. it was cheaper too. trust me on this one.)"]
TAG_WORDS = re.compile(r"\[|\]|image|selfie|photo|📸|📷|【|<image|\*", re.I)

class Fake(BaseHTTPRequestHandler):
    """Tinfoil (/v1/…), Cloudflare (/client/v4/…) and Phala (/phala/…) in one; replies with Fake.content, streamed in
    small pieces like a real model (so a tag arrives a few characters at a time; Fake.pieces: exactly these pieces;
    Fake.pace: seconds between pieces)."""
    seen, content, pieces, pace = [], "hey there.", None, 0
    def log_message(self, *a): pass
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try: body = json.loads(raw)
        except ValueError: body = None
        who = "cloudflare" if self.path.startswith("/client/v4/") else "phala" if self.path.startswith("/phala") else "tinfoil"
        Fake.seen.append({"who": who, "path": self.path, "body": body})
        if self.path.endswith("/audio/speech"):
            self.send_response(200); self.send_header("Content-Type", "audio/wav"); self.send_header("Content-Length", str(len(WAV)))
            self.end_headers(); self.wfile.write(WAV); return
        text = Fake.content
        if isinstance(body, dict) and body.get("stream"):
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            try:
                for piece in Fake.pieces or [text[i:i + 4] for i in range(0, len(text), 4)]:
                    self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}).encode() + b"\n\n")
                    if Fake.pace: self.wfile.flush(); time.sleep(Fake.pace)
                self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]}).encode() + b"\n\n")
                self.wfile.write(b"data: [DONE]\n\n")
            except OSError:
                pass                                      # (Buddy stopped reading: it had all it needed)
            return
        b = json.dumps({"choices": [{"message": {"content": text}, "finish_reason": "stop"}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

class Harness(unittest.TestCase):
    """Buddy's server on a free port with everything it writes in a temporary folder, talking to the fakes."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); d = self.here = self.tmp.name
        for f in ("config.json", "mode_advisor.txt", "mode_companion.txt", "persona.txt"):   # (shipped files only)
            shutil.copy(os.path.join(ROOT, f), d)
        with open(os.path.join(d, ".tinfoil_key"), "w") as f: f.write("fake-tinfoil-key-for-tests-0000")
        Fake.seen.clear(); Fake.content, Fake.pieces, Fake.pace = "hey there.", None, 0
        self.fake = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=self.fake.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.fake.shutdown(), self.fake.server_close()))
        self.base = f"http://127.0.0.1:{self.fake.server_address[1]}"
        self.maker, self.made, self.pushes, self.delay = MAKER, [], [], 0
        def submit(kind, cid, prompt, w, h, seed, done, cfg):          # (the picture itself isn't made: what was asked)
            if not self.maker: raise RuntimeError("no picture maker")     # (like the real one)
            self.made.append(prompt); return {"job": f"job{len(self.made)}", "eta": 5, "provider": "local"}
        for obj, name, value in [(server, "HERE", d), (server, "CLOUDFLARE", self.base + "/client/v4/accounts/"),
                                 (server, "tinfoil", lambda: self.base + "/v1"),
                                 (server, "tinfoil_models", lambda: ["gemma4-31b", "deepseek-v4-1-flash"]),
                                 (server, "_free", {"limited": 0, "gone": {}}), (server, "_thinking_refused", set()),
                                 (server, "_call_seen", {}), (server, "_live", {}), (server, "_late", {}),
                                 (server, "CHATS", os.path.join(d, "chats")),
                                 (server, "reply_delay", lambda c, via: self.delay), (server, "plan_soon", lambda *a, **k: None),
                                 (server, "recall", lambda *a, **k: []), (facts, "for_prompt", lambda *a, **k: ([], [])),
                                 (facts, "kick", lambda *a, **k: None), (memory, "folders", lambda: []),
                                 (billing, "_state", {"why": None, "at": 0.0}), (localcheck, "check", lambda u: None),
                                 (social, "THREAD", os.path.join(d, ".thread.json")), (social, "_private", []),
                                 (social, "_marks", []), (social, "SUBS", os.path.join(d, ".push_subs.json")),
                                 (social, "push", lambda note="", contact="", title="Buddy": self.pushes.append((title, note)) or 1),
                                 (social, "mac_idle_seconds", lambda: 600),
                                 (characters, "MINE", os.path.join(d, "my-characters")),
                                 (lives, "LIVES", os.path.join(d, "my-characters", "lives")),
                                 (lives, "WORLD", os.path.join(d, "my-characters", "lives", "_world.json")),
                                 (images, "MEDIA", os.path.join(d, ".media")), (images, "find", lambda c: self.maker),
                                 (images, "submit", submit),
                                 (devices, "FILE", os.path.join(d, ".devices.json")),
                                 (devices, "MAC_TOKEN", os.path.join(d, ".mac_token"))]:
            p = mock.patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)
        server.save_cfg(lives=False, real_timing=False, learn_facts=False, save_chats=True, pictures="local", proactive=True)
        devices.ensure(); self.mac = devices.mac_token()
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    def chat(self, text="send me a pic of you", **kw):
        port = self.srv.server_address[1]
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        c.request("POST", "/api/chat", body=json.dumps({"text": text, "char": "buddy", "private": False, "via": "phone",
                                                         **kw}).encode(),
                  headers={"Host": f"127.0.0.1:{port}", "Cookie": "buddy=" + self.mac, "Content-Type": "application/json"})
        r = c.getresponse(); data = r.read().decode(); c.close()
        self.assertEqual(r.status, 200, data)
        return [json.loads(x) for x in data.splitlines() if x.strip()]

    def shown(self, lines):
        return [x["s"] for x in lines if "s" in x]

    def said(self):                                   # what they said, as kept in the conversation (no photo messages)
        return [m["content"] for m in social.thread() if m["role"] == "assistant" and not m.get("image")
                and not m.get("photo_failed")]

    def saved(self, cid="buddy"):
        p = os.path.join(server.CHATS, cid, datetime.date.today().isoformat() + ".md")
        if not os.path.exists(p): return ""
        with open(p) as f: return f.read()

    def chats_sent(self, who="tinfoil"):
        return [s["body"] for s in Fake.seen if s["who"] == who and s["path"].endswith("/chat/completions")]

    def clean(self, text, where):
        self.assertFalse(TAG_WORDS.search(text or ""), f"{where}: {text!r}")

class TheParser(unittest.TestCase):                  # every spelling of "here's a photo", and nothing else
    def test_every_spelling(self):
        for text, scene in SPELLINGS:
            words, scenes = server.pic_tags(text)
            self.assertEqual(scenes, [scene], text)
            self.assertFalse(TAG_WORDS.search(server.no_tags(words)), text)
        self.assertEqual(server.pic_tags("[Photo]")[1], ["a casual selfie"])
        self.assertEqual(server.pic_tags("*snaps a pic* 📸")[1], ["a casual selfie"])
        self.assertEqual(server.pic_tags("![image](x.jpg)")[1], ["a casual selfie"])
        long = "omg look [image: " + "the light on the water " * 30 + "]"       # (over the old 300-character limit)
        words, scenes = server.pic_tags(long)
        self.assertEqual(words.strip(), "omg look"); self.assertGreater(len(scenes[0]), 600)

    def test_everything_else_stays(self):
        for text in NOT_PHOTOS + ["[react: 😂] lol", "[partner: no] cool"]:
            self.assertEqual(server.pic_tags(text), (text, []), text)
            self.assertEqual(server.pic_tags(text, line_start=False), (text, []), text)
        # a camera or "Photo:" line counts only at a real line start of the reply, never mid-line after a sentence
        self.assertEqual(server.pic_tags("📸 me on my balcony at sunset", line_start=False)[1], [])
        self.assertEqual(server.pic_tags("Image: me in the kitchen", line_start=False)[1], [])
        self.assertEqual(server.pic_tags("ok\nImage: me in the kitchen", line_start=False)[1], ["me in the kitchen"])
        self.assertEqual(server.no_tags("[react: 😂] lol"), " lol")      # (other tags: dropped from what's shown, as before)

    def test_a_tag_being_written_isnt_split(self):
        for open_ in ("haha (sends a photo: me at the", "*sends a selfie at the", "<image: me", "_snaps a pic of",
                      "*photo attached: me"):
            self.assertTrue(server._PIC_OPEN.search(open_), open_)
            self.assertTrue(server.pic_open(open_), open_)
        for fine in ("ugh :( that", "love you <3 and", "*laughs* ok", "(that was fun)", "a pic (of what?)",
                     "omg this **photo", "yes!! *the photo", "(the photo of your dog"):
            self.assertFalse(server._PIC_OPEN.search(fine), fine)
        for started in ("so pretty [photo: me on a", "so pretty [", "so pretty [Ima", "📸 me at", "ok\nPhoto: me"):
            self.assertTrue(server.pic_open(started), started)
        for done in ("so pretty [photo: me]", "so pretty", "nice [laughing at you] ok", "haha 📸 moment"):
            self.assertFalse(server.pic_open(done, line_start=False), done)
        self.assertEqual(server.pic_tags("ok [photo: me at", final=False)[1], [])     # (still coming: not yet)
        self.assertEqual(server.pic_tags("📸 me at the gym\nok", final=False)[1], ["me at the gym"])

    def test_their_own_photos_in_their_history(self):  # how the brain reads the photos it sent: the way it sends one
        with tempfile.TemporaryDirectory() as d, mock.patch.object(social, "THREAD", os.path.join(d, ".t.json")), \
             mock.patch.object(social, "_private", []), mock.patch.object(social, "_marks", []):
            social.add("assistant", "", char="mia", image="a" * 32, photo_desc="me at the [beach]", w=1, h=1)
            social.add("user", "cute", char="mia")
            self.assertEqual(social.recent_messages(char="mia")[0]["content"], "[photo: me at the (beach)]")
            self.assertEqual(social.recent_messages(char="mia", since=0)[0]["content"], "[photo]")   # (free: never what)
            self.assertNotIn("(I sent you a photo:", json.dumps(social.recent_messages(char="mia")))

class Prompts(unittest.TestCase):                    # pictures offered only when one can be made, else said plainly
    def prompt(self, via="phone", maker=MAKER, **kw):
        char = {"id": "maya", "name": "Maya", "persona": "You are Maya.", "brain": "advisor", "knowledge": {"scope": "none"}}
        with mock.patch.object(server, "life_block", lambda c, v: ""), mock.patch.object(server, "recall", lambda *a, **k: []), \
             mock.patch.object(facts, "for_prompt", lambda *a, **k: ([], [])), \
             mock.patch.object(server, "since_last_talk", lambda *a, **k: ""), \
             mock.patch.object(images, "find", lambda c: maker), mock.patch.object(server, "cfg", lambda: {}):
            return server.system_prompt(char, "advisor", "hi", None, via=via, **kw)

    def test_photos_or_plainly_not(self):
        p = self.prompt()
        self.assertIn(server.PHOTOS, p); self.assertNotIn(server.NO_PHOTOS, p)
        for p in (self.prompt(maker=None), self.prompt(photos=False), self.prompt(via="call"), self.prompt(via="mac", maker=None)):
            self.assertIn(server.NO_PHOTOS, p); self.assertNotIn(server.PHOTOS, p)
        self.assertIn("can't send photos right now", server.NO_PHOTOS)
        self.assertIn("never write or describe one", server.NO_PHOTOS)

    def test_planned_photo_moment_without_a_maker(self):   # their day planned a photo, but nothing can make it now
        log = {"days": [{"date": "2026-10-10", "events": [{"id": "e1", "at": "12:00", "what": "climbed a new route", "mood": ""}]}]}
        m = {"id": "m1", "event": "e1", "angle": "photo"}
        self.assertIn(lives.ANGLE["photo"], lives.moment_prompt(log, "2026-10-10", m, time.time()))
        p = lives.moment_prompt(log, "2026-10-10", m, time.time(), photos=False)
        self.assertIn(lives.ANGLE["share"], p); self.assertNotIn("[photo:", p)

class ChatPhotos(Harness):                           # texted (phone, Mac), read aloud, voice messages, calls, pushes
    def test_any_spelling_becomes_a_real_picture(self):
        for i, (reply, scene) in enumerate(SPELLINGS):
            Fake.content = reply
            for via, extra in (("phone", {}), ("mac", {"spoken": True})):
                n = len(self.made)
                lines = self.chat(via=via, **extra)
                for s in self.shown(lines): self.clean(s, f"shown ({via})")
                self.assertTrue(any(x.get("photo") == "pending" for x in lines), (reply, lines))
                self.assertEqual(len(self.made), n + 1, reply)
                self.assertIn(scene[:600], self.made[-1])
                self.assertTrue(self.made[-1].startswith(images.ADULT + images.ORIGINAL))
        for t in self.said(): self.clean(t, "stored")
        self.clean(self.saved().replace("**Me:** send me a pic of you", "").replace("**Buddy** (advisor):", ""), "saved chat")

    def test_voice_message_and_call_never_say_it(self):
        Fake.content = "here you go! [image: me waving at the camera]"
        self.chat(text="send me a voice message and a pic")
        tts = [s["body"]["input"] for s in Fake.seen if s["path"].endswith("/audio/speech")]
        self.assertEqual(tts, ["here you go!"])
        self.assertEqual(len(self.made), 1)
        n = len(self.made)
        lines = self.chat(text="what are you up to", via="call")
        for s in self.shown(lines): self.clean(s, "call")
        self.assertFalse(any("photo" in x for x in lines)); self.assertEqual(len(self.made), n)   # (no photos in calls)
        self.assertIn(server.NO_PHOTOS, self.chats_sent()[-1]["messages"][0]["content"])

    def test_no_picture_maker_says_so_and_never_shows_it(self):
        self.maker = None
        for reply, _ in SPELLINGS:
            Fake.content = reply
            lines = self.chat()
            for s in self.shown(lines): self.clean(s, "shown")
            sysmsg = self.chats_sent()[-1]["messages"][0]["content"]
            self.assertIn(server.NO_PHOTOS, sysmsg); self.assertNotIn(server.PHOTOS, sysmsg)
        self.assertEqual(self.made, [])
        for t in self.said(): self.clean(t, "stored")
        notes = [m for m in social.thread() if m.get("photo_failed")]           # (pictures on, Draw Things closed: why)
        self.assertTrue(notes and all(m["why"] for m in notes))
        server.save_cfg(pictures="off"); social.add("break", "", char="buddy")
        before = len([m for m in social.thread() if m.get("photo_failed")])
        Fake.content = "sure [image: me at the gym]"
        self.assertEqual(self.shown(self.chat()), ["sure"])
        self.assertEqual(len([m for m in social.thread() if m.get("photo_failed")]), before)   # (off: nothing at all)

    def test_text_about_photos_stays_text(self):         # end to end, Draw Things open and closed: no text lost, no
        for maker in (MAKER, None):                       # picture, no "didn't come through" note
            self.maker = maker
            for reply in NOT_PHOTOS:
                Fake.content = reply
                lines = self.chat(text="look at this one i took")
                self.assertEqual(" ".join(self.shown(lines)), " ".join(server.no_tags(reply).split()), reply)
                self.assertFalse(any("photo" in x for x in lines), reply)
        self.assertEqual(self.made, [])
        self.assertFalse([m for m in social.thread() if m.get("photo_failed") or m.get("image")])
        self.assertIn("Haha yes. 📸 moment for sure lol", self.said())         # (stored as it was said, too)

    def test_the_length_cap_ends_the_stream_as_before(self):   # an over-long reply: hung up at the cap, maker or not
        Fake.content = "hey!\n\n" + "so here's the thing about my day, it was long and kind of weird honestly. " * 25
        Fake.pace = 0.005                                  # (400+ pieces: over 2 s to send it all)
        took = {}
        for maker in (MAKER, None):
            self.maker = maker
            t0 = time.monotonic(); lines = self.chat(text="lol ok"); took[bool(maker)] = time.monotonic() - t0
            self.assertLessEqual(len(" ".join(self.shown(lines)).split()), 50)
        # (hung up at the cap: well before the 2+ s the whole reply takes to arrive, on a slow machine too, and no
        # slower with a picture maker than without one)
        self.assertLess(took[True], 2.0, took); self.assertLess(took[True], took[False] + 0.5, took)
        self.assertEqual(self.made, [])

    def test_a_photo_being_written_at_the_cap_still_comes(self):
        three = ["hey", "look where i am", "so pretty here"]                   # (a few words: it stops there)
        Fake.pieces = ["hey\n\nlook where i am\n\nso pretty here\n\n[photo: me on", " a pier at", " sunset]",
                       "\n\nand more", " texts nobody", " asked for"]
        lines = self.chat(text="hi")
        self.assertEqual(self.shown(lines), three)
        self.assertEqual(len(self.made), 1); self.assertIn("me on a pier at sunset", self.made[0])
        Fake.pieces = ["hey\n\nlook where i am\n\nso pretty here\n\n*sends a sel", "fie from the", " pier*", "\n\nok"]
        lines = self.chat(text="hi")
        self.assertEqual(self.shown(lines), three); self.assertIn("selfie from the pier", self.made[-1])
        # one that hadn't started at the cap isn't waited for (as before): the stream ends there
        Fake.pieces = None
        Fake.content = "hey\n\nlook where i am\n\nso pretty here\n\nhonestly the best\n\n[photo: me on a pier at sunset]"
        n = len(self.made)
        self.assertEqual(self.shown(self.chat(text="hi")), three); self.assertEqual(len(self.made), n)
        # nor one that never ends: a few hundred characters at most, then it's cut off
        Fake.pieces = ["hey\n\nlook where i am\n\nso pretty here\n\n[photo: me"] + [" on the pier"] * 300
        Fake.pace = 0.005                                  # (300 pieces: 1.5 s to send them all)
        t0 = time.monotonic(); lines = self.chat(text="hi"); took = time.monotonic() - t0
        self.assertEqual(self.shown(lines), three); self.assertLess(took, 1.0)
        self.assertIn("me" + " on the pier" * 26, self.made[-1]); self.assertNotIn(" on the pier" * 27, self.made[-1])
        self.maker = None                                                     # (no maker: nothing more is read)
        Fake.pace = 0
        Fake.pieces = ["hey\n\nlook where i am\n\nso pretty here\n\n[photo: me on", " a pier at", " sunset]"]
        n = len([m for m in social.thread() if m.get("photo_failed")])
        lines = self.chat(text="hi again")
        self.assertEqual(self.shown(lines), three)
        self.assertEqual(len([m for m in social.thread() if m.get("photo_failed")]), n)

    def test_same_safety_checks_as_photo_tags(self):
        for reply in ("[image: me at 15 in my school uniform]", "*sends a selfie with a teen girl*",
                      "(photo: me looking like a famous actor)", "[image: me holding your photo]"):
            Fake.content = reply
            lines = self.chat()
            self.assertEqual(self.shown(lines), [], reply); self.assertFalse(any("photo" in x for x in lines), reply)
        self.assertEqual(self.made, [])

    def test_late_reply_push_is_clean(self):
        self.delay = 1
        Fake.content = "sorry just saw this\n\n[image: me on the train]"
        lines = self.chat(text="hey you around")
        self.assertTrue(any("later" in x for x in lines))
        for _ in range(100):
            if self.pushes: break
            time.sleep(0.05)
        self.assertEqual(self.pushes, [("Buddy", "sorry just saw this")])
        for _ in range(100):
            if self.made: break
            time.sleep(0.05)
        self.assertEqual(len(self.made), 1)

    def test_free_brain_and_phala(self):
        with open(os.path.join(self.here, ".cloudflare_key"), "w") as f:
            f.write("0123456789abcdef0123456789abcdef:fake-cf-token-for-tests-Qx7Rv2Lm9")
        server.save_cfg(free_brain=True, free_since=0)
        Fake.content = "omg ok (image: me at the bakery)"
        lines = self.chat()
        self.assertEqual(self.shown(lines), ["omg ok"]); self.assertEqual(len(self.chats_sent("cloudflare")), 1)
        self.assertEqual(len(self.made), 1)
        server.save_cfg(free_brain=False)
        with open(os.path.join(self.here, ".phala_key"), "w") as f: f.write("fake-phala-key-for-tests-000")
        server.save_cfg(companion_provider="phala", companion_model="fake/phala-model")
        Fake.content = "*sends a selfie from the couch* hey you"
        with mock.patch.object(images, "phala_tee", lambda m, k=None: True), mock.patch.object(server, "PHALA", self.base + "/phala"):
            lines = self.chat(mode="companion")
        self.assertEqual(self.shown(lines), ["hey you"]); self.assertEqual(len(self.chats_sent("phala")), 1)
        self.assertEqual(len(self.made), 2); self.assertIn("selfie from the couch", self.made[-1])

class TextsFirstPhotos(Harness):                     # texts first and moments in their day: the same
    def test_first_text(self):
        char = characters.get("buddy", server.cfg())
        for reply, scene in SPELLINGS:
            Fake.content = reply
            txt, got, _ = server.first_text(char, "text me something", 10)
            self.clean(txt, "first text"); self.assertEqual(got, scene)

    def test_life_moment(self):
        server.save_cfg(lives=True, quiet_from=23.99, quiet_until=0.0)
        maya = characters.save({"name": "Maya", "persona": "You are Maya, 29, a fake climber.", "texts_first": True}, server.cfg())
        date = lives.life_date(time.time()).isoformat()
        log = {"days": [{"date": date, "events": [{"id": "e1", "at": "12:00", "what": "climbed a new route", "mood": ""}],
                         "moments": []}]}
        for maker, angle in ((MAKER, "photo"), (None, "photo"), (None, "share")):
            self.maker, n = maker, len(self.made)
            Fake.content = "finally sent the blue route!!\n\n[image: me at the top of the wall]"
            with mock.patch.object(lives, "pick", lambda *a, **k: ("maya", {"id": "m1", "event": "e1", "angle": angle}, [])), \
                 mock.patch.object(lives, "change", lambda cid, f: log), mock.patch.object(lives, "needs_plan", lambda *a, **k: False), \
                 mock.patch.object(server.time, "sleep", lambda s: None):
                sent = server.life_tick(10, False)
            self.assertEqual([m["content"] for m in sent], ["finally sent the blue route!!"])
            self.assertEqual(self.pushes[-1], ("Maya", "finally sent the blue route!!"))
            self.assertEqual(len(self.made), n + (1 if maker else 0))
            asked = self.chats_sent()[-1]["messages"][-1]["content"]
            self.assertEqual(lives.ANGLE["photo"] in asked, bool(maker))     # (no maker: share it in words)
        self.clean(self.saved("maya").replace("**Maya** (texted first):", ""), "saved chat")

    def test_old_texts_first(self):
        server.save_cfg(lives=False)
        Fake.content = "thinking of you [selfie: me with my coffee]"
        cid, txt, scene, given, extra = server.proactive_text("check in", 10)
        self.assertEqual((txt, scene), ("thinking of you", "me with my coffee"))

class NoGlazing(unittest.TestCase):                  # praise only what's earned, in texts and calls
    def test_rule_everywhere(self):
        for style in (server.TEXTING, server.CALLING):
            self.assertIn(server.REAL, style)
        self.assertIn("Don't flatter or gush", server.REAL); self.assertIn("unless it's really earned", server.REAL)
        self.assertIn("warm", server.REAL)

    def test_shipped_texts_dont_push_it(self):         # (persona.txt stays as it was: it's in lives.sig, so editing
        with open(os.path.join(ROOT, "mode_companion.txt")) as f: comp = f.read()   # it would re-plan Buddy's "about"
        self.assertNotIn("enthusiastically", comp)                                  # facts and people; a mode text
        self.assertIn("Go along with it willingly and in character", comp)          # isn't in it)
        c = {"persona": "You are Maya.", "life_seed": "a fake flat"}
        with mock.patch.object(server, "read", lambda f: "changed"):
            self.assertEqual(lives.sig(c), lives.sig(dict(c)))

FUTURE_ME = {"name": "Alex", "tagline": "Future you, keeping you on track",
             "persona": ("You are Alex, me ten years from now: 38, calm and serious, and you've already been through what "
                         "I'm facing. You text plainly and briefly, in full sentences, no slang or emoji. You keep me on "
                         "track with my goals: you remind me of what I said I'd do and follow up on whether I did it, and "
                         "you don't let excuses slide, though you're never cruel."),
             "voice": "neutral_male", "appearance": "an adult man in his thirties with short dark hair and a calm face",
             "brain": "advisor", "life_seed": "Lives in a quiet flat, works as an engineer, runs every morning.",
             "folders": []}

class SeriousCharacters(Harness):                    # no tone setting: who they are wins over the default style
    def test_styles_let_who_they_are_win(self):
        self.assertIn("If who you are calls for another manner (serious, formal, focused, a coach), keep that manner",
                      server.TEXTING)
        self.assertIn("no forced lowercase, slang or emoji", server.TEXTING)
        self.assertIn("short and casual, often just a few words, lowercase is fine", server.TEXTING)   # (the default)
        self.assertIn("Keep your own manner: if who you are is serious, formal or focused, stay that way", server.CALLING)
        self.assertNotIn("1-2 short sentences, casual.", server.PROACTIVE)
        self.assertIn("in your own manner (casual, unless who you are is more\nserious)", server.PROACTIVE)
        self.assertIn("(casual\nunless who you are is more serious)", lives.MOMENT)
        self.assertNotIn("tone", json.dumps(characters.clean({"name": "x"})))      # (no new setting)

    def test_creating_a_future_me(self):
        p = characters.create_prompt("future me, 10 years older, keeps me on track with my goals, serious", [])
        self.assertIn("future me, 10 years older, keeps me on track with my goals, serious", p)
        self.assertIn("serious, formal or focused if that fits who they are or the request says so", p)
        self.assertIn("follow up\n   on what I said I'd do", p)
        asked = []
        made = characters.create("future me, 10 years older, keeps me on track with my goals, serious", server.cfg(),
                                 lambda prompt: asked.append(prompt) or json.dumps([FUTURE_ME]), folders=[])
        alex = made[0]
        self.assertEqual((alex["name"], alex["texts_first"]), ("Alex", True))
        self.assertTrue(characters.keeps_on_track(alex))
        sysmsg = server.system_prompt(alex, "advisor", "hi", None, via="phone")
        self.assertLess(sysmsg.index("calm and serious"), sysmsg.index("keep that manner"))   # (who they are, then the rule)
        # its check-in texts first follow up on what you said you'd do
        Fake.content = "Did you send the application you said you'd finish yesterday?"
        with mock.patch.object(characters, "all_characters", lambda c: [alex]):
            cid, txt, _, _, _ = server.proactive_text("check in", 10)
        self.assertEqual((cid, txt), (alex["id"], "Did you send the application you said you'd finish yesterday?"))
        sent = self.chats_sent()[-1]["messages"]
        self.assertIn(server.FOLLOW_UP, sent[-1]["content"]); self.assertIn("calm and serious", sent[0]["content"])

    def test_casual_characters_text_exactly_as_before(self):
        buddy = characters.get("buddy", server.cfg())
        maya = characters.save({"name": "Maya", "persona": "You are Maya, 29, a chill sound engineer who loves bad puns. "
                                "You follow up. If I mention a gig, ask how it went.", "texts_first": True}, server.cfg())
        for c in (buddy, maya):
            self.assertFalse(characters.keeps_on_track(c), c["name"])
            self.assertEqual(server.follow_up(c), ""); self.assertEqual(server.follow_up(c, moment=True), "")
            server.first_text(c, "text me something", 10)
            self.assertEqual(self.chats_sent()[-1]["messages"][-1]["content"], "text me something")   # (byte for byte)
        for persona in ("You remind me to drink water and keep me on track.", "You hold me accountable.",
                        "You follow up on what I said I'd do.", "You keep me accountable for my workouts.",
                        "You hold me to my goals.", "You follow up on whether I did my reading."):
            self.assertTrue(characters.keeps_on_track({"persona": persona}), persona)
        self.assertTrue(characters.keeps_on_track({"persona": "You are Sam.", "tagline": "Keeps you on track"}))
        for persona in ("You remind me of summer evenings.", "Your laugh reminds me of summer and you love bad puns.",
                        "my flirty girlfriend who cheers on my goals", "You push me to try new games.",
                        "You are Leo, a chill gamer. You push me to try new games.", "pushes me to try new games",
                        "you nudge me to draw more", "you love deep talks about my goals and dreams",
                        "always on track with the latest gossip", "a flirty bartender who knows all my goals and dreams.",
                        "A coach who helps with my goals.", "You keep me focused on my studies.",
                        "You hold me close when I'm sad.", "You hold me to your chest.", "You follow up. If I mention a gig, "
                        "ask how it went.", "You're accountable to no one."):
            self.assertFalse(characters.keeps_on_track({"persona": persona}), persona)

    def test_follow_up_only_in_check_ins(self):        # their own moments stay theirs: at most a brief nudge after
        server.save_cfg(lives=True, quiet_from=23.99, quiet_until=0.0)
        alex = characters.save({**FUTURE_ME, "texts_first": True}, server.cfg())
        maya = characters.save({"name": "Maya", "persona": "You are Maya, 29, a fake climber. You remind me of summer.",
                                "texts_first": True}, server.cfg())
        date = lives.life_date(time.time()).isoformat()
        log = {"days": [{"date": date, "events": [{"id": "e1", "at": "12:00", "what": "climbed a new route", "mood": ""}],
                         "moments": []}]}
        Fake.content = "Finished the route I'd been stuck on."
        asked = {}
        for c in (alex, maya):
            for angle in ("share", "about_you"):
                with mock.patch.object(lives, "pick", lambda *a, **k: (c["id"], {"id": "m1", "event": "e1", "angle": angle}, [])), \
                     mock.patch.object(lives, "change", lambda cid, f: log), \
                     mock.patch.object(lives, "needs_plan", lambda *a, **k: False), \
                     mock.patch.object(server.time, "sleep", lambda s: None):
                    server.life_tick(10, False)
                asked[c["name"], angle] = self.chats_sent()[-1]["messages"][-1]["content"]
        clock = lambda t: re.sub(r"It's \w+ \d\d:\d\d", "It's <now>", t)
        moment = clock(lives.moment_prompt(log, date, {"id": "m1", "event": "e1", "angle": "share"}, time.time()))
        self.assertTrue(asked["Alex", "share"].endswith(server.FOLLOW_UP_MOMENT))
        self.assertNotIn(server.FOLLOW_UP, asked["Alex", "share"]); self.assertIn("climbed a new route", asked["Alex", "share"])
        self.assertTrue(asked["Alex", "about_you"].endswith(server.FOLLOW_UP))
        self.assertEqual(clock(asked["Maya", "share"]), moment)                       # (byte for byte, but the clock)
        self.assertEqual(clock(asked["Alex", "share"]), moment + "\n" + server.FOLLOW_UP_MOMENT)
        for k in (("Maya", "share"), ("Maya", "about_you")):
            self.assertNotIn("Keeping me on track", asked[k])
        with mock.patch.object(random, "choice", lambda xs: next(x for x in xs if x["id"] == maya["id"])):
            server.proactive_text("check in", 10)
        sent = self.chats_sent()[-1]["messages"][-1]["content"]
        self.assertTrue(sent.endswith("Don't mention notes or being an AI."), sent)   # (PROACTIVE, nothing after it)

class DeepQuestions(Harness):                        # thinking stays off for texts, except a plain ask for depth
    SWITCH = ("reasoning_effort", "chat_template_kwargs")
    CASUAL = ("hey what's up", "why not", "how do i look", "what should i eat", "tell me about your day",
              "how do you feel about me", "why are you so cute", "why are you up so late", "any details?",
              "longer hair or shorter?", "steps today: 12k", "explain it to me", "what should i do about my landlord",
              "why are you like this lol", "lol ok", "you better explain why you didn't text me back last night",
              "explain yourself mister, where were you all day", "omg i can't explain it but i miss you so much",
              "nothing can compare to you babe honestly", "don't compare me to my ex like that ever again")
    DEEP = ("can you explain how compound interest works", "help me decide between these two jobs",
            "give me some advice on sleeping better", "walk me through setting up a budget please")

    def test_which_texts(self):
        for t in self.CASUAL: self.assertFalse(server.deep_question(t), t)
        for t in self.DEEP: self.assertTrue(server.deep_question(t), t)

    def test_texts_calls_and_the_free_brain(self):
        self.maker = None
        for text in self.CASUAL:                           # (deepseek: off, as before)
            self.chat(text=text, mode="companion")
            b = self.chats_sent()[-1]
            self.assertEqual((b["model"], b.get("reasoning_effort")), ("deepseek-v4-1-flash", "none"), text)
        for text in self.DEEP:
            self.chat(text=text, mode="companion")
            b = self.chats_sent()[-1]
            self.assertEqual(b["model"], "deepseek-v4-1-flash"); self.assertFalse(set(self.SWITCH) & set(b), text)
        q = "can you explain how compound interest works?"
        self.chat(text=q, mode="companion", via="mac", spoken=True)        # (typed on the Mac and read aloud: never)
        self.assertEqual(self.chats_sent()[-1].get("reasoning_effort"), "none")
        self.chat(text=q, mode="companion", via="mac")                     # (the Mac reads aloud unless voice is off)
        self.assertEqual(self.chats_sent()[-1].get("reasoning_effort"), "none")
        self.chat(text=q, mode="companion", via="mac", spoken=False)       # (voice off: a typed text like the phone's)
        self.assertFalse(set(self.SWITCH) & set(self.chats_sent()[-1]))
        self.chat(text=q, mode="companion", via="call")
        b = self.chats_sent()[-1]
        self.assertEqual((b["reasoning_effort"], b["max_tokens"]), ("none", 300))  # (never in a call)
        with open(os.path.join(self.here, ".cloudflare_key"), "w") as f:
            f.write("0123456789abcdef0123456789abcdef:fake-cf-token-for-tests-Qx7Rv2Lm9")
        server.save_cfg(free_brain=True, free_since=0)
        self.chat(text=q)
        self.assertEqual(self.chats_sent("cloudflare")[-1]["chat_template_kwargs"], {"enable_thinking": False})   # (never)

if __name__ == "__main__":
    unittest.main()
