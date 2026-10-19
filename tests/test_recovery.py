"""recovery.py (SPEC3 §7.1, §16.2): the recovery key format with a check tag per kind of key. Backup keys keep their
tag (every backup key made so far still parses: the backup vectors were made by backup.py before the split), the sync
key has its own, and a key typed where the other kind belongs is named, not called a typo. Fixed or random test keys
only. Also runs on 3.9:  /root/.local/bin/python3.9 -B -m unittest tests.test_recovery"""
import json, os, random, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import backup, recovery

VECTORS = os.path.join(ROOT, "tests", "recovery_vectors.json")
TAGS = {"backup": recovery.BACKUP, "sync": recovery.SYNC}

class Vectors(unittest.TestCase):
    def setUp(self):
        with open(VECTORS, encoding="utf-8") as f: self.v = json.load(f)

    def test_tags_and_words(self):
        self.assertEqual(self.v["tags"], {"backup": "buddy recovery key", "sync": "buddy sync key"})
        for k, text in self.v["errors"].items(): self.assertEqual(getattr(recovery, k), text)
        self.assertEqual(recovery.NOT_SYNC, "That's a backup recovery key, not a sync key.")
        self.assertEqual(recovery.NOT_BACKUP, "That's a sync recovery key, not a backup key.")

    def test_key_texts_both_tags(self):
        for t in self.v["texts"]:
            K = bytes.fromhex(t["key"])
            with self.subTest(key=t["name"]):
                self.assertEqual(recovery.key_text(K, recovery.BACKUP), t["backup"])
                self.assertEqual(recovery.key_text(K, recovery.SYNC), t["sync"])
                self.assertEqual(backup.key_text(K), t["backup"])          # (backup.py: its own tag, as before)
                self.assertNotEqual(t["backup"], t["sync"])
                flat = lambda s: s.replace("-", "")
                self.assertEqual(flat(t["backup"])[:51], flat(t["sync"])[:51])   # (the key's first 255 bits: the same)
                self.assertEqual(recovery.parse_key(t["backup"], recovery.BACKUP), K)
                self.assertEqual(recovery.parse_key(t["sync"], recovery.SYNC), K)
                self.assertEqual(backup.parse_key(t["backup"]), K)

    def test_parse_cases(self):
        for p in self.v["parse"]:
            with self.subTest(text=p["text"], tag=p["tag"]):
                if "key" in p:
                    self.assertEqual(recovery.parse_key(p["text"], TAGS[p["tag"]]).hex(), p["key"])
                else:
                    with self.assertRaises(ValueError) as cm: recovery.parse_key(p["text"], TAGS[p["tag"]])
                    self.assertEqual(str(cm.exception), getattr(recovery, p["error"]))
                    if p["error"] in ("NOT_SYNC", "NOT_BACKUP"):
                        self.assertIsInstance(cm.exception, recovery.OtherKind)
                        self.assertEqual(cm.exception.found, "backup" if p["error"] == "NOT_SYNC" else "sync")
                    else:
                        self.assertNotIsInstance(cm.exception, recovery.OtherKind)

    def test_hkdf(self):
        for h in self.v["hkdf"]:
            out = recovery.hkdf(bytes.fromhex(h["ikm"]), h["info"].encode(), h["n"])
            self.assertEqual(out.hex(), h["out"], h["info"])
            self.assertEqual(backup.hkdf(bytes.fromhex(h["ikm"]), h["info"].encode(), h["n"]), out)
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        except ImportError:
            return                                      # (Buddy's .venv and CI have it; the vectors are checked anyway)
        for h in self.v["hkdf"]:
            self.assertEqual(HKDF(hashes.SHA256(), h["n"], bytes(32), h["info"].encode()).derive(bytes.fromhex(h["ikm"])).hex(),
                             h["out"])

class Random(unittest.TestCase):
    def test_round_trips_and_mixups(self):
        rnd = random.Random(7)
        for _ in range(300):
            K = bytes(rnd.getrandbits(8) for _ in range(32))
            for tag, other in ((recovery.SYNC, recovery.BACKUP), (recovery.BACKUP, recovery.SYNC)):
                t = recovery.key_text(K, tag)
                g = t.split("-")
                self.assertTrue(len(g) == 14 and all(len(x) == 4 and all(c in recovery.B32 for c in x) for x in g))
                self.assertEqual(recovery.parse_key(" ".join(g).lower(), tag), K)
                with self.assertRaises(recovery.OtherKind) as cm: recovery.parse_key(t, other)
                self.assertEqual(str(cm.exception), recovery.OTHER[other])
                i = rnd.randrange(56); flat = t.replace("-", "")
                bad = flat[:i] + rnd.choice([c for c in recovery.B32 if c != flat[i]]) + flat[i + 1:]
                for tg in (tag, other):
                    with self.assertRaises(ValueError) as cm: recovery.parse_key(bad, tg)
                    self.assertIn(str(cm.exception), (recovery.TYPO, recovery.OTHER[tg]))   # (a 1-in-16M match: named)

    def test_bad_input(self):
        for bad in (b"short", bytes(31), bytes(33), "x" * 32, None):
            with self.assertRaises(ValueError): recovery.key_text(bad, recovery.SYNC)
        with self.assertRaises(ValueError): recovery.key_text(bytes(32), b"some other tag")
        with self.assertRaises(ValueError): recovery.parse_key(recovery.key_text(bytes(32), recovery.SYNC), b"x")
        for text in (None, 0, "0" * 55, "0" * 57, "U" * 56):
            with self.assertRaises(ValueError) as cm: recovery.parse_key(text, recovery.SYNC)
            self.assertEqual(str(cm.exception), recovery.INCOMPLETE)

    def test_backup_names_stay(self):
        """backup.py's names and messages are the same objects as before (callers and the page see no change)."""
        self.assertIs(backup.B32, recovery.B32)
        self.assertEqual((backup.INCOMPLETE, backup.TYPO), (recovery.INCOMPLETE, recovery.TYPO))
        self.assertIs(backup.hkdf, recovery.hkdf)
        self.assertIs(backup._norm, recovery.norm)
        K = os.urandom(32)
        with self.assertRaises(ValueError) as cm: backup.parse_key(recovery.key_text(K, recovery.SYNC))
        self.assertEqual(str(cm.exception), recovery.NOT_BACKUP)

if __name__ == "__main__":
    unittest.main()
