"""Tests for pictures and photos (images.py, social.py's markers, buddy_server.py's vision and uploads). Fake data only:
no network, no real vault, thread, notes or keys (every file Buddy would write goes to a temporary folder).
Run from Buddy's folder:  python3 -m unittest discover -s tests -v"""
import io, json, os, socket, struct, sys, tempfile, threading, time, unittest, urllib.error
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import characters, images, localcheck, social
import buddy_server as server

def text(p):
    with open(p) as f: return f.read()

seg = lambda m, body: b"\xff" + bytes([m]) + struct.pack(">H", len(body) + 2) + body
SOS = seg(0xDA, b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00")
def jpeg(w, h, extra=b"", scans=1):
    """A structurally valid JPEG (markers only, no real pixels): SOI, JFIF, extra segments, SOF0, SOS, data, EOI.
    scans > 1: progressive-style, with `extra` again between the scans (coded data holds FF00 and a restart marker)."""
    head = (b"\xff\xd8" + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00") + extra
            + seg(0xC0, b"\x08" + struct.pack(">HH", h, w) + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"))
    body = SOS + b"\x12\x34\xff\x00\x56" * 30 + b"\xff\xd0" + b"\x78" * 20
    return head + body + b"".join(extra + body for _ in range(scans - 1)) + b"\xff\xd9"

DT_OPTS = {k: None for k in ("model", "prompt", "negative_prompt", "width", "height", "seed", "seed_mode", "steps",
           "guidance_scale", "sampler", "shift", "resolution_dependent_shift", "strength", "batch_count", "batch_size", "loras",
           "controls", "upscaler", "refiner_model", "hires_fix", "tea_cache", "sharpness", "tiled_decoding", "tiled_diffusion",
           "expand_prompt_to_json")}

class DrawThings(unittest.TestCase):                  # I1
    def body(self, model, cfg=None, opts=None):
        o = dict(opts or DT_OPTS, model=model)
        return images.dt_body(o, "an adult (25 to 35 years old), test", 768, 1024, 7, cfg or {})

    def test_z_image_turbo(self):
        b = self.body("z_image_turbo_1.0_q6p.ckpt")
        self.assertEqual((b["steps"], b["guidance_scale"], b["sampler"], b["shift"], b["seed_mode"]),
                         (8, 1.0, "UniPC Trailing", 3.0, "Scale Alike"))
        self.assertNotIn("model", b)
        self.assertEqual((b["loras"], b["controls"], b["upscaler"], b["refiner_model"], b["expand_prompt_to_json"]),
                         ([], [], None, None, False))
        self.assertTrue(set(b) <= set(DT_OPTS))
        self.assertEqual((b["width"], b["height"], b["seed"]), (768, 1024, 7))

    def test_flux_klein_and_unknown(self):
        b = self.body("flux_2_klein_4b_q8p.ckpt")
        self.assertEqual((b["steps"], b["sampler"]), (4, "DDIM Trailing"))
        b = self.body("sd_xl_base_1.0_f16.ckpt")
        self.assertFalse({"steps", "sampler", "guidance_scale", "shift", "seed_mode"} & set(b))

    def test_local_model_and_missing_keys(self):
        b = self.body("sd_xl_base_1.0_f16.ckpt", {"local_image_model": "z_image_turbo_1.0_q8p.ckpt", "image_steps": 12})
        self.assertEqual((b["model"], b["sampler"], b["steps"]), ("z_image_turbo_1.0_q8p.ckpt", "UniPC Trailing", 12))
        o = {k: v for k, v in DT_OPTS.items() if k != "expand_prompt_to_json"}
        self.assertNotIn("expand_prompt_to_json", self.body("z_image_turbo_1.0_q6p.ckpt", opts=o))

    def test_status_labels(self):
        images.forget_found()
        with mock.patch.object(images, "_get", return_value=dict(DT_OPTS, model="z_image_turbo_1.0_q6p.ckpt")):
            s = images.local_status(fresh=True)
        self.assertEqual((s["running"], s["app"], s["label"], s["tuned"]), (True, "drawthings", "Z-Image Turbo (6-bit)", True))
        images.forget_found()
        with mock.patch.object(images, "_get", return_value=dict(DT_OPTS, model="flux_2_klein_4b_q8p.ckpt")):
            s = images.local_status(fresh=True)
        self.assertEqual((s["label"], s["tuned"]), ("FLUX.2 [klein] 4B (8-bit)", False))
        images.forget_found()
        with mock.patch.object(images, "_get", return_value={"sd_model_checkpoint": "x.safetensors"}):
            self.assertEqual(images.local_status(fresh=True)["app"], "a1111")
        images.forget_found()
        with mock.patch.object(images, "_get", side_effect=ConnectionRefusedError()):
            s = images.local_status(fresh=True)
        self.assertFalse(s["running"]); self.assertIn("isn't running", s["why"])
        images.forget_found()

    def test_find_follows_the_setting(self):
        self.assertIsNone(images.find({"pictures": "off"}))
        with mock.patch.object(images, "near_status", return_value={"ok": True, "checked": time.time()}):
            self.assertEqual(images.find({"pictures": "near"})["provider"], "near")
        with mock.patch.object(images, "near_status", return_value={"ok": True, "checked": time.time() - 7 * 3600}):
            self.assertIsNone(images.find({"pictures": "near"}))
        with mock.patch.object(images, "near_status", return_value={"ok": False, "reason": "x"}):
            self.assertIsNone(images.find({"pictures": "near"}))

    def test_old_off_setting_is_kept(self):
        with mock.patch.object(server, "local_cfg", return_value={"images": "off"}):
            self.assertEqual(images.setting(server.cfg()), "off")
        with mock.patch.object(server, "local_cfg", return_value={"images": "off", "pictures": "near"}):
            self.assertEqual(images.setting(server.cfg()), "near")

class LocalApp(unittest.TestCase):                    # Draw Things closed: say so (not "is the Tinfoil Proxy running?")
    def test_nothing_listening_and_someone_elses(self):
        with tempfile.TemporaryDirectory() as d:
            lsof = os.path.join(d, "lsof")                # lsof on a Mac with no program of yours on the port: nothing
            with open(lsof, "w") as f: f.write("#!/bin/sh\nexit 1\n")
            os.chmod(lsof, 0o700)
            with mock.patch.object(localcheck, "LSOF", lsof), mock.patch.dict(localcheck._seen, clear=True):
                try:
                    socket.create_connection(("127.0.0.1", 7860), timeout=1).close(); free = False
                except OSError:
                    free = True
                if free:
                    images.forget_found()
                    self.assertEqual(images.local_status(fresh=True)["why"], images.NOT_RUNNING)
                    self.assertEqual(images.why_not({}), images.NOT_RUNNING)
                    with self.assertRaises(RuntimeError) as e: images.make({}, "p", provider="local")
                    self.assertEqual(str(e.exception), images.NOT_RUNNING)
                    other = socket.socket()                   # another account's program on 7860 (lsof can't see it)
                    try:
                        other.bind(("127.0.0.1", 7860)); other.listen(1)
                        images.forget_found()
                        self.assertEqual(images.local_status(fresh=True)["why"], images.NOT_YOURS_PORT)
                    finally:
                        other.close()
                images.forget_found()

class Prompts(unittest.TestCase):                     # only adults, only original people, never your photo
    def test_minors_refused(self):
        for t in ("me with my 16-year-old cousin at the beach", "me and my sixteen year old sister", "a 15 year-old",
                  "holding my newborn baby niece", "A boy of about ten smiles at a birthday table.", "16yo", "16 yr old",
                  "a 9-yr-old", "fifteen-year-old", "aged twelve", "16 y.o.", "a 6 month old", "an infant", "adolescents",
                  "toddler", "babies", "10th grade", "5th grader", "grade 9", "kindergarten", "middle school", "high school",
                  "my son", "her daughter", "my grandson", "stepdaughter", "a niece", "two girls", "some boys", "teenager",
                  "pre-teen", "underage", "the little ones", "she looks 15", "sweet sixteen", "schoolkid", "as a kid"):
            self.assertTrue(images.too_young(t), t)
            with self.assertRaises(ValueError, msg=t): images.prompt_for("short dark hair, green eyes", t)
            with self.assertRaises(ValueError, msg=t): images.prompt_for(t, "at the beach")

    def test_adults_fine(self):
        for t in ("a 28-year-old woman with curly hair", "twenty-one-year-old", "twenty one year old", "25 years old", "my adult son",
                  "her grown-up daughter", "a 30-year-old daughter", "my boyfriend", "my girlfriend", "a cowboy hat", "boyish grin",
                  "baby blue eyes", "together for five years", "a little one-piece swimsuit", "a young woman with freckles",
                  "at 5pm", "at 7 o'clock", "my childhood home", "reading a sonnet", "looks about 30", "two adults hiking"):
            self.assertFalse(images.too_young(t), t)

    def test_real_people_refused(self):
        for t in ("looks exactly like Brad Pitt", "Looks like Zendaya", "a celebrity lookalike", "me backstage with a famous singer",
                  "the real Keanu", "resembles her favourite actress", "with a pop star", "spitting image of my ex", "deepfake"):
            self.assertTrue(images.real_person(t), t)
            with self.assertRaises(ValueError, msg=t) as e: images.prompt_for(t, "at the beach")
            self.assertEqual(str(e.exception), images.ONLY_ORIGINAL)
            with self.assertRaises(ValueError, msg=t): images.prompt_for("short dark hair", t)
        for t in ("looks like a runner", "Looks like rain today", "looks like she just woke up", "a TV on the wall", "rock climbing"):
            self.assertFalse(images.real_person(t), t)

    def test_never_from_your_photo(self):
        for t in ("me and the guy from your photo", "recreating your selfie", "the one you sent, but me", "like yours", "me in your pic"):
            self.assertTrue(images.from_your_photo(t), t)
            with self.assertRaises(ValueError) as e: images.prompt_for("short dark hair", t)
            self.assertEqual(str(e.exception), images.FROM_YOURS)
        self.assertFalse(images.from_your_photo("me at the beach, my own photo"))

    def test_prompt_wording(self):
        p = images.prompt_for("short dark hair, green eyes", "reading in a café")
        self.assertTrue(p.startswith(images.ADULT + images.ORIGINAL + "short dark hair"))
        self.assertIn("isn't anyone real", images.prompt_for("x", "y", style="anime"))
        self.assertIn("celebrity", images.NEGATIVE)

    def test_saved_looks_checked_but_old_ones_still_load(self):
        with self.assertRaises(ValueError): characters.clean({"name": "Mia", "appearance": "a girl next door"})
        with self.assertRaises(ValueError): characters.clean({"name": "Mia", "appearance": "looks exactly like Brad Pitt"})
        self.assertEqual(characters.clean({"name": "Mia", "appearance": "a girl next door"}, check_looks=False)["appearance"],
                         "a girl next door")                  # (no pictures from it either: prompt_for refuses)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(characters, "MINE", d):
            with open(os.path.join(d, "mia.json"), "w") as f:
                json.dump({"name": "Mia", "persona": "You are Mia.", "appearance": "a girl next door"}, f)
            self.assertIn("mia", [c["id"] for c in characters.all_characters({})])

class Jobs(unittest.TestCase):
    def test_background_job_and_eta(self):
        got, ev = [], threading.Event()
        with mock.patch.object(images, "find", return_value={"provider": "local", "model": "m"}), \
             mock.patch.object(images, "make", return_value=b"\x89PNG\r\n\x1a\nfake"):
            j = images.submit("photo", "mia", "p", 768, 1024, 1, lambda r: (got.append(r), ev.set()), {})
            self.assertTrue(ev.wait(5))
        self.assertEqual((got[0]["ok"], got[0]["job"], got[0]["made_by"], got[0]["mime"]), (True, j["job"], "local", "image/png"))
        self.assertGreater(j["eta"], 0)

    def test_failure_reason_and_queue_limit(self):
        got, ev = [], threading.Event()
        with mock.patch.object(images, "find", return_value={"provider": "near", "model": "m"}), \
             mock.patch.object(images, "make", side_effect=RuntimeError("NEAR didn't accept your key")):
            images.submit("avatar", "mia", "p", 1024, 1024, 1, lambda r: (got.append(r), ev.set()), {})
            self.assertTrue(ev.wait(5))
        self.assertEqual((got[0]["ok"], got[0]["why"]), (False, "NEAR didn't accept your key"))
        with mock.patch.object(images, "find", return_value=None):
            with self.assertRaises(RuntimeError): images.submit("photo", "mia", "p", 768, 1024, 1, lambda r: None, {})
        with mock.patch.dict(images._jobs, {str(i): {"provider": "local", "state": "waiting"} for i in range(6)}), \
             mock.patch.object(images, "find", return_value={"provider": "local", "model": "m"}):
            with self.assertRaises(RuntimeError) as e: images.submit("photo", "mia", "p", 768, 1024, 1, lambda r: None, {})
            self.assertEqual(str(e.exception), "busy")

class Photos(unittest.TestCase):                      # I2, E11
    def test_clean_photo_strips_metadata(self):
        exif = b"\xff\xe1" + struct.pack(">H", 2 + 22) + b"Exif\x00\x00FakeGPS 52.5N\x00\x00\x00"
        com = b"\xff\xfe" + struct.pack(">H", 2 + 14) + b"secret-comment"
        raw = jpeg(3000, 2000, exif + com)
        out, size = images.clean_photo(raw, 4096, 12_000_000)
        self.assertEqual(size, (3000, 2000))
        for bad in (b"Exif", b"FakeGPS", b"secret-comment"): self.assertNotIn(bad, out)
        self.assertTrue(out.startswith(b"\xff\xd8\xff\xe0") and out.endswith(b"\xff\xd9"))

    def test_clean_photo_strips_everywhere(self):        # between scans, and anything after the end of the picture
        exif = lambda tag: seg(0xE1, b"Exif\x00\x00" + tag)
        raw = jpeg(1200, 900, exif(b"FakeGPS-C") + seg(0xFE, b"note"), scans=3)
        raw += b"\xff\xd8" + exif(b"FakeGPS-B") + b"\xff\xd9" + b"\x00\x00\x00\x18ftypmp42 fake motion photo"
        out, size = images.clean_photo(raw, 4096, 12_000_000)
        self.assertEqual(size, (1200, 900))
        for bad in (b"Exif", b"FakeGPS", b"note", b"ftyp"): self.assertNotIn(bad, out)
        self.assertEqual(out.count(SOS), 3); self.assertEqual(out.count(b"\xff\xd0"), 3)   # the picture itself is all there
        self.assertTrue(out.endswith(b"\x78\xff\xd9") and out.count(b"\xff\xd9") == 1 and out.count(b"\xff\xd8") == 1)
        self.assertEqual(images.clean_photo(out, 4096, 12_000_000)[0], out)

    def test_clean_photo_refuses(self):
        for data, side in ((b"\x89PNG\r\n\x1a\n" + b"0" * 64, 4096), (jpeg(5000, 3000), 4096), (jpeg(2000, 1500), 1536),
                           (jpeg(8, 8), 4096), (b"\xff\xd8\xff\xe0\x00", 4096), (jpeg(100, 100)[:-2], 4096),
                           (jpeg(100, 100)[:-40], 4096), (jpeg(100, 100).replace(SOS, b""), 4096)):
            with self.assertRaises(ValueError): images.clean_photo(data, side, 12_000_000)
        with self.assertRaises(ValueError): images.clean_photo(jpeg(100, 100), 4096, 50)

    def test_pending_uploads(self):
        server._pending_photos.clear()
        pid = server.hold_photo("phone1", b"full", 100, 80)
        self.assertIs(server.add_view(pid, "phone2", b"view"), False)         # another device: no
        self.assertIsNone(server.take_photo(pid, "phone1"))                   # not ready (no view yet)
        self.assertIs(server.add_view(pid, "phone1", b"view"), True)
        self.assertIsNone(server.take_photo(pid, "phone2"))
        self.assertEqual(server.take_photo(pid, "phone1")["view"], b"view")
        self.assertIsNone(server.take_photo(pid, "phone1"))                   # only once
        pid = server.hold_photo("phone1", b"full", 100, 80)
        self.assertFalse(server.drop_photo(pid, "phone2")); self.assertTrue(server.drop_photo(pid, "phone1"))
        pid = server.hold_photo("phone1", b"full", 100, 80); server.add_view(pid, "phone1", b"v")
        with mock.patch.object(server.time, "time", return_value=time.time() + 1801):
            self.assertIsNone(server.take_photo(pid, "phone1"))               # 30 minutes: gone
        for _ in range(8): server.hold_photo("phone1", b"f", 1, 1)
        self.assertEqual(sum(1 for v in server._pending_photos.values() if v["dev"] == "phone1"), 6)
        server._pending_photos.clear()

    def test_private_photos_stay_in_memory(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(images, "MEDIA", os.path.join(d, ".media")):
            mid = images.save(b"\xff\xd8\xfffull", private=True, view=b"\xff\xd8\xffview")
            self.assertFalse(os.path.exists(os.path.join(d, ".media")))
            self.assertEqual(images.from_memory(mid, view=True), b"\xff\xd8\xffview")
            mid2 = images.save(b"\xff\xd8\xfffull", view=b"\xff\xd8\xffview")
            files = sorted(os.listdir(os.path.join(d, ".media")))
            self.assertEqual(files, [mid2 + ".jpg", mid2 + ".v.jpg"])
            self.assertEqual({oct(os.stat(os.path.join(d, ".media", f)).st_mode & 0o777) for f in files}, {"0o600"})
            images.remove(mid2); images.remove(mid)
            self.assertEqual(os.listdir(os.path.join(d, ".media")), []); self.assertIsNone(images.from_memory(mid))

class Delivery(unittest.TestCase):                    # a finished picture: nothing slow while holding the jobs lock
    def test_slow_push_holds_no_lock(self):
        got, seen = {}, []
        def submit(kind, cid, prompt, w, h, seed, done, cfg):
            got["done"] = done; return {"job": "j1", "eta": 20, "provider": "near"}
        char = {"id": "mia", "name": "Mia", "appearance": "short dark hair", "style": "photo"}
        with tempfile.TemporaryDirectory() as d, mock.patch.object(social, "THREAD", os.path.join(d, ".thread.json")), \
             mock.patch.object(images, "MEDIA", os.path.join(d, ".media")), mock.patch.object(server, "CHATS", os.path.join(d, "chats")), \
             mock.patch.object(images, "submit", submit), \
             mock.patch.object(social, "push", lambda **k: seen.append(server._jobs_lock.locked())):
            with mock.patch.object(server.time, "time", return_value=time.time() - 100):   # (handed in over a minute ago)
                line = server.send_photo(char, "reading in a café", proactive=True, delivered="phone")
            self.assertEqual(line["job"], "j1")
            got["done"]({"ok": True, "job": "j1", "data": b"\x89PNG\r\n\x1a\nfake", "mime": "image/png", "made_by": "near",
                         "model": "m", "secs": 70})
            self.assertEqual(seen, [False])                                              # pushed, with the lock free
            self.assertFalse(social._marks)
            self.assertTrue(any(m.get("image") and m.get("job") == "j1" for m in social.thread()))
        social._marks.clear()

    def test_webp_kept_as_is(self):
        webp = b"RIFF\x10\x00\x00\x00WEBPVP8 fake"
        self.assertEqual(images.mime(webp), "image/webp")
        with tempfile.TemporaryDirectory() as d, mock.patch.object(images, "MEDIA", os.path.join(d, ".media")):
            mid = images.save(webp)
            self.assertTrue(images.path(mid).endswith(".webp"))
            with open(images.path(mid), "rb") as f: self.assertEqual(f.read(), webp)
            self.assertEqual(images.from_memory(images.save(webp, private=True)), webp)
        self.assertIsNone(images.mime(b"GIF89a"))

class Markers(unittest.TestCase):                     # I3
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mock.patch.object(social, "THREAD", os.path.join(self.tmp.name, ".thread.json")); self.p.start()
        social._marks.clear(); social._private.clear()

    def tearDown(self):
        self.p.stop(); self.tmp.cleanup(); social._marks.clear(); social._private.clear()

    def test_marker_memory_only(self):
        social.add("user", "send me a selfie", char="mia")
        m = social.mark("mia", "job1", 150, time.time() + 600, via="phone")
        self.assertIn(m["id"], [x["id"] for x in social.thread()])
        self.assertNotIn("pending_photo", text(social.THREAD))
        self.assertEqual([x["content"] for x in social.recent_messages(char="mia")], ["send me a selfie"])
        later = social.add("assistant", "", image="a" * 32, photo_desc="at the beach", job="job1", char="mia")
        self.assertGreater(later["id"], m["id"])
        social.unmark("job1")
        self.assertFalse(any(x.get("pending_photo") for x in social.thread()))

    def test_marker_expires_and_forget(self):
        social.mark("mia", "job2", 150, time.time() - 1)
        self.assertFalse(any(x.get("pending_photo") for x in social.thread()))
        social.mark("mia", "job3", 150, time.time() + 600)
        social.forget("mia")
        self.assertFalse(social._marks)

    def test_photos_as_words_and_update(self):
        um = social.add("user", "look", image="b" * 32, w=4, h=3, char="mia")
        self.assertEqual(social.recent_messages(char="mia")[-1]["content"], "(I sent you a photo) look")
        self.assertTrue(social.update(um["id"], photo_desc="A red square.", seen_by="gemma4-31b"))
        self.assertEqual(social.recent_messages(char="mia")[-1]["content"], "(I'm sending you a photo: A red square.) look")
        pm = social.add("user", "", image="c" * 32, private=True, char="mia")
        social.update(pm["id"], photo_desc="A cat.")
        self.assertNotIn("A cat.", text(social.THREAD))
        self.assertEqual(social.recent_messages(char="mia", include_private=True)[-1]["content"], "(I'm sending you a photo: A cat.)")

class Vision(unittest.TestCase):                      # I4
    def models(self, data):
        return mock.patch.multiple(server, tinfoil_models=mock.Mock(return_value=[m["id"] for m in data]),
                                   read=mock.Mock(return_value="fake-key-for-tests"),
                                   _models={"at": 0, "ttl": 0, "ids": [m["id"] for m in data],
                                            "meta": {m["id"]: {k: m[k] for k in ("multimodal", "type") if k in m} for m in data}})

    def test_metadata_and_fallback(self):
        listed = [{"id": "llama3-3-70b", "multimodal": False, "type": "chat"}, {"id": "kimi-k3", "multimodal": True, "type": "chat"},
                  {"id": "gemma4-31b", "multimodal": True, "type": "chat"}, {"id": "whisper-large-v3-turbo", "multimodal": True, "type": "audio"}]
        with self.models(listed):
            self.assertEqual(server.vision_models(), ["gemma4-31b"])          # (never one that always thinks: kimi-k3)
        with self.models([{"id": "llama3-3-70b"}, {"id": "deepseek-v4-1-flash"}, {"id": "gemma4-31b"}]):
            self.assertEqual(server.vision_models(), ["gemma4-31b", "deepseek-v4-1-flash"])
            with mock.patch.dict(server._no_vision, {"gemma4-31b": time.time() + 60}):
                self.assertEqual(server.vision_models(), ["deepseek-v4-1-flash"])

    def test_hiccup_backs_off_briefly(self):              # one 503 mustn't leave every character blind for hours
        listed = [{"id": m, "multimodal": True, "type": "chat"} for m in ("gemma4-31b", "deepseek-v4-1-flash", "kimi-k3")]
        calls = []
        def failing(code=None, exc=None):
            def post(url, key, body, ctype="application/json", timeout=120):
                calls.append(json.loads(body)["model"])
                raise exc or urllib.error.HTTPError(url, code, "x", {}, io.BytesIO(b""))
            return post
        with self.models(listed), mock.patch.object(server, "tinfoil", return_value="http://127.0.0.1:9/v1"), \
             mock.patch.dict(server._no_vision, clear=True):
            with mock.patch.object(server, "post", failing(503)):
                self.assertEqual(server.describe(b"\xff\xd8\xff"), ("", None))
            self.assertEqual(calls, ["gemma4-31b"])                                      # (not every model's fault)
            self.assertLess(server._no_vision["gemma4-31b"] - time.time(), 600)
            self.assertEqual(server.vision_models(), ["deepseek-v4-1-flash"])
            calls.clear(); server._no_vision.clear()
            with mock.patch.object(server, "post", failing(exc=urllib.error.URLError(socket.timeout("timed out")))):
                server.describe(b"\xff\xd8\xff")
            self.assertEqual((calls, list(server._no_vision)), (["gemma4-31b"], ["gemma4-31b"]))
            self.assertLess(server._no_vision["gemma4-31b"] - time.time(), 600)
            calls.clear(); server._no_vision.clear()
            with mock.patch.object(server, "post", failing(400)):                         # they refuse pictures: 6 h each
                server.describe(b"\xff\xd8\xff")
            self.assertEqual(set(calls), {"gemma4-31b", "deepseek-v4-1-flash"})
            self.assertTrue(all(t - time.time() > 5 * 3600 for t in server._no_vision.values()) and len(server._no_vision) == 2)
            self.assertEqual(server.vision_models(), [])

    def test_retired_model_gone(self):
        self.assertNotIn("glm-5-3-flash", server.COMPANION_MODELS)
        self.assertEqual(server.ALWAYS_THINKS, {"glm-5-3", "kimi-k3", "gpt-oss-120b"})
        with mock.patch.object(server, "tinfoil_models", return_value=["glm-5-3-flash", "kimi-k3", "llama3-3-70b"]):
            self.assertEqual(server.pick_model("glm-5-3-flash", server.COMPANION_MODELS), "glm-5-3-flash")   # (you pinned it)
            self.assertEqual(server.pick_model(None, server.COMPANION_MODELS), "llama3-3-70b")
        with mock.patch.object(server, "tinfoil_models", return_value=["deepseek-v4-1-flash", "kimi-k3"]):
            self.assertEqual(server.pick_model("glm-5-3-flash", server.COMPANION_MODELS), "deepseek-v4-1-flash")

class ProfileAndWallpaper(unittest.TestCase):          # change a profile photo step by step; chat wallpapers
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        p = mock.patch.object(characters, "MINE", self.d.name); p.start(); self.addCleanup(p.stop)
        self.addCleanup(self.d.cleanup)

    def test_undo_and_seed(self):
        characters.set_avatar("maya", b"\x89PNG one", seed=11)
        self.assertEqual(characters.avatar_seed("maya"), 11)
        self.assertFalse(os.path.exists(characters.avatar_path("maya", "prev")))
        characters.set_avatar("maya", b"\x89PNG two")             # uploaded: no seed to change it from
        self.assertIsNone(characters.avatar_seed("maya"))
        self.assertTrue(characters.undo_avatar("maya"))
        with open(characters.avatar_path("maya"), "rb") as f: self.assertEqual(f.read(), b"\x89PNG one")
        self.assertTrue(characters.undo_avatar("maya"))            # and forward again
        with open(characters.avatar_path("maya"), "rb") as f: self.assertEqual(f.read(), b"\x89PNG two")
        for k in ("img", "prev"):
            self.assertEqual(os.stat(characters.avatar_path("maya", k)).st_mode & 0o777, 0o600)
        self.assertFalse(characters.undo_avatar("nobody"))
        self.assertIsNone(characters.avatar_path("../x", "img")); self.assertIsNone(characters.avatar_path("maya", "json"))

    def test_adjust_keeps_the_seed(self):
        seen, ts = {}, []
        def submit(kind, cid, prompt, w, h, seed, done, cfg):         # (done runs on a worker, like the real one)
            seen.update(kind=kind, prompt=prompt, w=w, h=h, seed=seed)
            t = threading.Thread(target=done, args=({"ok": True, "job": "j1", "data": b"\x89PNG made", "made_by": "local"},))
            ts.append(t); t.start(); return {"job": "j1", "eta": 5}
        def finish():
            for t in ts: t.join(5)
        with mock.patch.object(images, "submit", submit), \
             mock.patch.object(characters, "find", lambda cid, cfg: {"id": cid}):
            server.make_avatar("maya", "prompt", 1234); finish()
            self.assertEqual((seen["kind"], seen["w"], characters.avatar_seed("maya")), ("avatar", 1024, 1234))
            server.make_avatar("maya", images.wall_prompt("a rainy window at night"), 5, wall=True); finish()
            self.assertEqual((seen["kind"], seen["w"], seen["h"]), ("wallpaper", 768, 1344))
            self.assertIn("no person", seen["prompt"]); self.assertIn("rainy window", seen["prompt"])
            self.assertEqual(characters._avatar_version("maya", "wall") > 0, True)
            self.assertEqual(characters.avatar_seed("maya"), 1234)     # (a wallpaper never touches the photo's seed)
        self.assertTrue(characters.remove_wallpaper("maya")); self.assertFalse(characters.remove_wallpaper("maya"))

    def test_wallpaper_refusals(self):
        for bad in ("a schoolgirl on a beach", "a celebrity on stage", "looks like Brad Pitt", "the picture you sent"):
            with self.assertRaises(ValueError): images.wall_prompt(bad)
        self.assertIn("soft abstract", images.wall_prompt(""))

    def test_delete_takes_everything(self):
        os.makedirs(self.d.name, exist_ok=True)
        with open(os.path.join(self.d.name, "maya.json"), "w") as f: f.write("{}")
        characters.set_avatar("maya", b"a", seed=1); characters.set_avatar("maya", b"b", seed=2); characters.set_wallpaper("maya", b"w")
        with mock.patch.object(characters, "lives", create=True):
            self.assertTrue(characters.delete("maya"))
        self.assertEqual(sorted(os.listdir(self.d.name)), [])

if __name__ == "__main__":
    unittest.main()
