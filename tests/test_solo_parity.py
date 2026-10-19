"""Buddy for phones parity (SPEC3 §16.3 P1b): web/solo/*'s JS ports against the real Python, case by case, in node
(tests/solo/parity_check.mjs, tests/solo/parity_prompts.mjs):
  - recovery keys: key_text / parse_key with both tags (recovery_vectors.json and random keys), HKDF (RFC 5869 A.3, the
    backup vectors, every §7.2 label), the account id and keys a recovery key gives, record ids
  - characters.clean (images.too_young / real_person / from_your_photo / immodest, their pattern sources verbatim),
    create_prompt, characters.create's reading of the answer, persona_of, the id slug
  - edition: romance() selection, [partner: …] tags and what they change, kitparts.knows_ask
  - facts: fid, norm, clean_text, the SECRET guard, and facts.change's sheet edits step by step
  - a .buddysync file written in JS, opened here with `cryptography` (records, compression, blobs, the trailer MAC)
  - whole system prompts: a phone made through BuddySolo's routes, its kit, direct.js's systemPrompt against
    buddy_server.system_prompt for the same characters and facts as a Mac would have them
Fake data and keys made here only; every path that could reach your notes, characters, thread or keys points into a temp
folder. Skipped (not failed) when node isn't installed. Python 3.9+.
Run from Buddy's folder:  python3 -B -m unittest tests.test_solo_parity -v"""
import ast, base64, datetime, hashlib, hmac, json, os, random, shutil, subprocess, sys, tempfile, time, unittest, zlib
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import characters, edition, facts, images, kitparts, recovery

NODE = shutil.which("node")
CHECK = os.path.join(ROOT, "tests", "solo", "parity_check.mjs")
PROMPTS = os.path.join(ROOT, "tests", "solo", "parity_prompts.mjs")
TAGS = {"backup": recovery.BACKUP, "sync": recovery.SYNC}

def static_kit():
    """kit.json as the site gets it (kitparts.static_kit("public")), made in a fresh interpreter with an empty HOME."""
    with tempfile.TemporaryDirectory() as home:
        out = subprocess.run([sys.executable, "-I", "-B", "-c",
                              "import json, sys; sys.path.insert(0, sys.argv[1]); import kitparts; print(json.dumps(kitparts.static_kit('public')))",
                              ROOT], env={"HOME": home, "PATH": os.environ.get("PATH", "")}, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

def b32(b):                                             # Crockford base32 of bytes, most significant bit first (relay/common.js)
    n, bits = int.from_bytes(b, "big"), len(b) * 8
    pad = (-bits) % 5; n <<= pad; bits += pad
    return "".join(recovery.B32[(n >> (bits - 5 * (i + 1))) & 31] for i in range(bits // 5))
b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
def account(K):                                         # SPEC3 §7.2, written out here as the reference
    atok = recovery.hkdf(K, b"buddy-sync v1 admin", 32)
    return {"acct": b32(hashlib.sha256(b"buddy-sync v1 account" + atok).digest()).lower()[:26],
            "kdata": recovery.hkdf(K, b"buddy-sync v1 data", 32), "kname": recovery.hkdf(K, b"buddy-sync v1 names", 32),
            "kfile": recovery.hkdf(K, b"buddy-sync v1 file", 32), "kid": recovery.hkdf(K, b"buddy-sync v1 key-id", 8)}
rid_of = lambda kname, kind, i: b64u(hmac.new(kname, f"{kind}:{i}".encode(), hashlib.sha256).digest()[:16])

def strings_in(path, lo=2, hi=400):
    """Every string constant in a test file (a ready-made corpus of phrasings the Python is tested on)."""
    with open(path, encoding="utf-8") as f: tree = ast.parse(f.read())
    return sorted({n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and lo <= len(n.value) <= hi})

def run_node(script, payload, *args, tz="UTC"):
    r = subprocess.run([NODE, script, *args], input=json.dumps(payload), capture_output=True, text=True, timeout=600,
                       env={**os.environ, "TZ": tz})
    return r

class Ports(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        if not NODE: self.skipTest("node isn't installed")
        self.kit = static_kit()
        p = mock.patch.object(edition, "PUBLIC", True); p.start(); self.addCleanup(p.stop)   # (the site is always public)

    def node(self, cases):
        r = run_node(CHECK, {"kit": self.kit, "cases": cases})
        self.assertEqual(r.returncode, 0, "JS and Python differ (fake data only):\n" + (r.stdout + r.stderr)[-6000:])
        self.assertRegex(r.stdout, r"(\d+)/\1 cases match")
        return r.stdout

    def test_recovery_keys(self):
        with open(os.path.join(ROOT, "tests", "recovery_vectors.json"), encoding="utf-8") as f: v = json.load(f)
        rnd = random.Random(7)
        keys = [bytes.fromhex(t["key"]) for t in v["texts"]] + [bytes(rnd.randrange(256) for _ in range(32)) for _ in range(40)]
        cases = {"keytext": [], "parse": [], "norm": [], "hkdf": [], "acct": [], "rid": [], "b32": []}
        def parse(text, tag):
            try: return {"key": recovery.parse_key(text, TAGS[tag]).hex()}
            except ValueError as e: return {"error": str(e)}
        for K in keys:
            for tag in ("backup", "sync"):
                t = recovery.key_text(K, TAGS[tag])
                cases["keytext"].append({"key": K.hex(), "tag": tag, "out": t})
                flat = t.replace("-", "")
                for typed in (t, t.lower(), flat, " ".join(t.split("-")), t.replace("0", "O").replace("1", "I"), t.replace("1", "l"),
                              ".".join(t.split("-")), " " + t + "\n", flat[:-1], flat + "0", flat[:10] + "U" + flat[11:],
                              flat[:-1] + ("0" if flat[-1] != "0" else "1"), flat[:20] + ("Z" if flat[20] != "Z" else "Y") + flat[21:]):
                    for want in ("backup", "sync"):
                        cases["parse"].append({"text": typed, "tag": want, **parse(typed, want)})
        for typed in ("", None, "   ", "0" * 56, "Z" * 56, "ünd" * 20):
            for want in ("backup", "sync"):
                cases["parse"].append({"text": typed or "", "tag": want, **parse(typed, want)})
        for s in ["a-b c.d", "oil OIL", "x y", "ﬁ", "ß", "ı", ""]:
            cases["norm"].append({"in": s, "out": recovery.norm(s)})
        cases["hkdf"] = [{"ikm": h["ikm"], "info": h["info"], "n": h["n"], "out": h["out"]} for h in v["hkdf"]]
        for K in keys[:12]:
            for lab in ("buddy-sync v1 admin", "buddy-sync v1 data", "buddy-sync v1 names", "buddy-sync v1 file", "buddy-sync v1 key-id", "x"):
                for n in (8, 32, 42):
                    cases["hkdf"].append({"ikm": K.hex(), "info": lab, "n": n, "out": recovery.hkdf(K, lab.encode(), n).hex()})
            a = account(K)
            cases["acct"].append({"key": K.hex(), "out": {"acct": a["acct"], **{k: a[k].hex() for k in ("kdata", "kname", "kfile", "kid")}}})
            for kind, i in (("msg", "AbCdEfGhIjKlMnOpQrStUv"), ("char", "maya-7k2q"), ("facts", "_everyone"), ("set", "set"), ("char", "ünd")):
                cases["rid"].append({"kname": a["kname"].hex(), "kind": kind, "id": i, "out": rid_of(a["kname"], kind, i)})
        for n in range(0, 40):
            b = bytes(rnd.randrange(256) for _ in range(n))
            cases["b32"].append({"in": b.hex(), "out": b32(b)})
        self.assertGreater(len(cases["parse"]), 2000)
        self.assertTrue(any("error" in c and c["error"] == recovery.NOT_SYNC for c in cases["parse"]))
        self.assertTrue(any("error" in c and c["error"] == recovery.NOT_BACKUP for c in cases["parse"]))
        self.node(cases)

    def looks_corpus(self):
        base = strings_in(os.path.join(ROOT, "tests", "test_pictures.py")) + strings_in(os.path.join(ROOT, "tests", "test_edition.py"))
        extra = ["a 15-year-old girl", "fifteen year old", "twenty-one-year-old man", "a 30-year-old daughter", "my adult son",
                 "at 5pm", "at 15", "at 9 o'clock", "teenager", "baby blue dress", "baby", "chocolate bars", "candy bar", "bars",
                 "cocktail dress", "cocktails", "wine-red coat", "wine", "modest swimsuit", "swimsuit", "looks like Brad", "looks like a runner",
                 "The real Taylor", "the real deal", "celebrity lookalike", "K-pop idol", "kpop star", "your photo", "the one you sent",
                 "pics you shared", "like yours", "Doppelgänger", "doppelganger", "A WOMAN, 30, NAKED", "Schoolgirl", "school uniform",
                 "7th grade", "grade 5", "aged 12", "12 y/o", "3 months old", "looks about 14", "petite young woman", "young girl",
                 "kinda kid-like", "chibi style", "a little one", "little ones-", "grown-up daughters", "eighteen-year-old daughter",
                 "Ünd café naïve", "tight jeans", "tank top", "shorts", "short skirt", "beer", "pints", "bacon", "ham sandwich", "Hamburg",
                 "", "   ", "bar mitzvah", "sweet sixteen", "quinceañera", "when I was 7", "as a kid", "under-aged", "underage",
                 # Turkish İ/ı: Python's re.IGNORECASE matches them with i (JS folds them first)
                 "a little GİRL", "a KİD", "CHİLD", "a little gırl", "kıd", "in a bİkini", "TEENAGE GİRL", "LOOKS LİKE A KİD",
                 "a grown-up daughter, İstanbul", "İzmir sunset, adult woman", "celebrİty lookalike", "the one you sent, İ think"]
        rnd = random.Random(3)
        words = "adult woman man girl boy teen 30 15 years old year-old tall red coat bikini bar pub wine famous looks like Anna the real kid son daughter".split()
        fuzz = [" ".join(rnd.choice(words) for _ in range(rnd.randint(1, 8))) for _ in range(400)]
        return sorted(set(base + extra + fuzz))

    def test_looks_and_characters(self):
        corpus = self.looks_corpus()
        self.assertGreater(len(corpus), 600)
        cases = {"looks": [{"in": s, "out": [images.too_young(s), images.real_person(s), images.from_your_photo(s), images.immodest(s)]} for s in corpus]}
        self.assertTrue(any(c["out"][0] for c in cases["looks"]) and any(not c["out"][0] for c in cases["looks"]))
        cases["sources"] = [{"name": n, "which": "chars", "out": p.pattern} for n, p in
                            (("MINOR", images.MINOR), ("TENS", images._TENS), ("GROWN", images._GROWN), ("FAMOUS", images._FAMOUS),
                             ("LIKE_NAME", images._LIKE_NAME), ("YOURS", images._YOURS), ("IMMODEST", images._IMMODEST))]
        cases["sources"] += [{"name": "SECRET", "which": "facts", "out": facts.SECRET.pattern}, {"name": "SUFFIX", "which": "facts", "out": facts.SUFFIX.pattern}]
        cases["constants"] = [{"name": "CH.VOICE_IDS", "out": [v for v, _ in characters.VOICES]}, {"name": "CH.STYLES", "out": list(characters.STYLES)},
                              {"name": "CH.SCOPES", "out": list(characters.SCOPES)}, {"name": "CH.COLORS", "out": characters.COLORS},
                              {"name": "CH.ONLY_MODEST", "out": images.ONLY_MODEST}, {"name": "F.MAX_FACTS", "out": facts.MAX_FACTS},
                              {"name": "F.MAX_LEN", "out": facts.MAX_LEN}, {"name": "E.PUBLIC", "out": True}]
        rnd = random.Random(5)
        vals = {"name": ["Maya", "  Ünd  ", "", None, "x" * 60, 7, True, [], "Ana-Lu (A.) [x]*"],
                "tagline": ["Coach", None, "", " spaced ", "y" * 120, 0],
                "persona": ["You are Maya.", "", None, "p" * 9000, "  lead"],
                "appearance": corpus[::25] + [None, "", "an adult woman, 31, red coat"],
                "style": ["photo", "anime", "bogus", None, 3],
                "voice": ["Serena", "casual_male", "bogus", None, "", 5],
                "brain": ["advisor", "companion", "x", None],
                "knowledge": [{"scope": "some", "folders": ["A", "a/b", "..x", "  ", None, 5], "avoid": ["Sarah", 3]},
                              {"scope": "except", "folders": "abc", "avoid": "  work  "}, {"scope": "none"}, {"scope": "bogus"}, {}, None, "x",
                              {"scope": "all", "folders": ["F" * 80] * 50, "avoid": None}, {"avoid": "z" * 1200}],
                "texts_first": [True, False, 1, 0, "", "x", None, [], [0]],
                "learns": [True, False, None, 0], "life": [True, False, "", 2],
                "texts_per_day": [0, 1, 2, 4, 5, -1, True, None, "2"],
                "life_seed": ["Lives in Porto.", None, "s" * 700],
                "color": ["#5b8def", "#ABCDEF", "5b8def", "#5b8de", None, "", 12]}
        existing = [{}, {"name": "Old", "tagline": "old t", "persona": "old p", "appearance": "old looks", "style": "anime", "voice": "Ryan",
                         "brain": "companion", "knowledge": {"scope": "except", "folders": ["H"], "avoid": "ex"}, "texts_first": True,
                         "learns": False, "life": False, "texts_per_day": 3, "life_seed": "old seed", "color": "#3fa37a"}]
        cases["clean"] = []
        for i in range(700):
            c = {k: rnd.choice(v) for k, v in vals.items() if rnd.random() < 0.7}
            ex, check, known = rnd.choice(existing), rnd.random() < 0.8, rnd.choice([None, [], ["A"]])
            try: out = {"out": characters.clean(c, known_folders=known, existing=ex, check_looks=check)}
            except ValueError as e: out = {"error": str(e)}
            except TypeError: continue                   # (Python can't even look at it: the page never sends such)
            cases["clean"].append({"c": c, "existing": ex, "check": check, "known": known, **out})
        self.assertTrue(any("error" in c for c in cases["clean"]) and sum("out" in c for c in cases["clean"]) > 300)
        cases["slug"] = [{"in": s, "out": characters._slug(s)} for s in ["Maya", "Ünd Café", "", "---", "A" * 50, "x y-z!!", "İstanbul", "K", "日本"]]
        cases["persona"] = [{"c": c, "builtin": "BUILTIN PERSONA", "out": characters.persona_of(c) if not c.get("builtin") else (c.get("persona") or "BUILTIN PERSONA")}
                            for c in ({"name": "Maya", "tagline": "Coach", "persona": "P"}, {"name": "Maya", "tagline": "", "persona": ""},
                                      {"name": "Zed", "tagline": "Night owl", "persona": ""}, {"name": "Buddy", "builtin": True, "persona": ""},
                                      {"name": "Buddy", "builtin": True, "persona": "Mine"})]
        self.node(cases)

    def test_create(self):
        cases = {"create_prompt": [], "create": []}
        for d in ["a blunt fitness coach", "  3 study buddies for maths, history and French  ", "{weird} {{braces}} {desc}", "ü" * 1500, "x\ny"]:
            cases["create_prompt"].append({"desc": d, "out": characters.create_prompt(d, [])})
        item = lambda **k: {"name": "Maya", "persona": "You are Maya.", "appearance": "an adult woman, 31", "voice": "Serena", **k}
        replies = [json.dumps([item()]), "Sure!\n" + json.dumps([item(), item(name="Tess", appearance="a 16-year-old girl"), item(name="Leo", folders=["*"])]) + "\nEnjoy",
                   json.dumps({"characters": [item(name="A"), item(name="B", folders="abc", avoid=["x", "y"])]}), json.dumps(item(id="buddy", created=5, builtin=True, avatar=9)),
                   json.dumps([item(name=""), item(persona=""), "x", 5, None]), json.dumps([item(name=str(i)) for i in range(9)]),
                   "no json here", "", "[", json.dumps([]), json.dumps([item(appearance="looks like Brad Pitt")]),
                   json.dumps([item(appearance="in a bikini"), item(name="Ok", appearance="")]), 'prose [not json] then {"name": "X", "persona": "Y"}',
                   json.dumps([item(texts_first=False, texts_per_day=4, style="anime", color="#123456", knowledge={"scope": "all"})])]
        def py_create(txt):
            with mock.patch.object(characters, "save", lambda it, cfg, folders=None: characters.clean(it, folders)):
                try: return {"out": characters.create("desc", {}, lambda p: txt, folders=[])}
                except ValueError as e:
                    return {"error": "no characters in the reply" if isinstance(e, json.JSONDecodeError) else str(e)}   # (the phone says it plainly)
                except (AttributeError, TypeError): return {"error": "no characters in the reply"}
        for txt in replies: cases["create"].append({"txt": txt, **py_create(txt)})
        self.assertTrue(any("error" in c for c in cases["create"]) and any(len(c.get("out", [])) > 1 for c in cases["create"]))
        self.node(cases)

    def test_edition(self):
        now = 1792749600.0; R = edition.RECHECK
        cases = {"romance": [], "romance_direct": [], "ptags": [], "pchange": [], "knows": []}
        for has in ("yes", "no", "", None, "x"):
            for at in (None, now - 3600, now - R - 86400, now - R + 10, 0, "x"):
                for noask in (False, True):
                    p = {"has": has if has in ("yes", "no") else "", "at": at if isinstance(at, (int, float)) else None, "noask": noask}
                    out = edition.romance(has, at, now, noask)
                    cases["romance"].append({"partner": p, "t": now, "out": out})
                    cases["romance_direct"].append({"partner": p, "t": now, "out": out})
        for s in ["[partner: yes] ok", "[Partner:  NO ] and [partner: noask]", "[partner:maybe]", "nothing", "[partner: yes ]", "[partner: yes"]:
            cases["ptags"].append({"in": s, "out": [x.lower() for x in edition.PARTNER_TAG.findall(s)]})
        for said in ("yes", "no", "noask", "NO", "maybe", ""):
            for priv in (False, True):
                said_l = said.lower(); out = {}
                if said_l == "noask": out = {"partner_noask": True}
                elif said_l == "yes" or (said_l == "no" and not priv): out = {"has_partner": said_l, "partner_at": now}
                cases["pchange"].append({"said": said, "priv": priv, "t": now, "out": out})
        for name in ("Maya", "Ünd {x}", "Buddy"):
            for via in ("phone", "call"):
                for have in (True, False):
                    cases["knows"].append({"name": name, "via": via, "have": have,
                                           "out": kitparts.knows_ask({"name": name, "knowledge": {"scope": "none"}}, have, via == "call")})
        self.node(cases)

    def test_facts(self):
        corpus = sorted(set(strings_in(os.path.join(ROOT, "tests", "test_texting.py")) + strings_in(os.path.join(ROOT, "tests", "test_cheaper.py"), 2, 200)
                            + ["I keep bees.", "I’m from Porto", "My PIN is 4821", "my door code is 4821", "I learned to code in 2015", "card ends in 4242",
                               "4111 1111 1111 1111", "GB29NWBK60161331926819", "sk-abcdefgh12345678", "ghp_ABCDEFGH1234", "call me at 555-1234",
                               "my phone number is 0176 1234567", "exp 12/27", "123 on the back", "the wifi password is hunter2", "- [x] done (added 2026-10-01)",
                               "  hello\n\tworld  ", "![img](x) [[link]] `code` <b>", "a" * 310, "", "Ünd naïve CAFÉ!!!", "x (learned 2026-10-01 from Maya)",
                               "my PİN is 4821", "İBAN DE12", "my pın is 4821", "the wİfi password", "I live in İzmir.", "İ'm vegan"]))
        cases = {"fid": [{"in": s, "fid": facts.fid(s), "norm": facts.norm(s)} for s in corpus],
                 "secret": [{"in": s, "out": facts.secretish(s)} for s in corpus], "fclean": []}
        for s in corpus + [None, 5, True]:
            try: cases["fclean"].append({"in": s, "out": facts.clean_text(s)})
            except ValueError as e: cases["fclean"].append({"in": s, "error": str(e)})
        self.assertTrue(any(c["out"] for c in cases["secret"]) and any(not c["out"] for c in cases["secret"]))
        cases["fops"] = self.fact_sequences()
        self.node(cases)

    def fact_sequences(self):
        """facts.change in a temp folder, step by step; the listing (or the error) after each."""
        seqs = [
            [{"op": "add", "text": "I keep bees.", "to": "mine"}, {"op": "add", "text": "I live in Porto.", "to": "everyone"},
             {"op": "add", "text": "I keep bees!", "to": "mine"}, {"op": "add", "text": "My door code is 4821", "to": "mine"},
             {"op": "add", "text": "   ", "to": "mine"}, {"op": "add", "text": "x", "to": "nowhere"},
             {"op": "edit", "id": "@I keep bees.", "file": "mine", "text": "I keep two hives."},
             {"op": "edit", "id": "@I keep two hives.", "file": "mine", "text": "I keep two hives."},
             {"op": "move", "id": "@I live in Porto.", "file": "everyone", "to": "mine"},
             {"op": "move", "id": "@I keep two hives.", "file": "mine", "to": "mine"},
             {"op": "add", "text": "I climb.", "to": "everyone"}, {"op": "delete", "id": "@I climb.", "file": "everyone"},
             {"op": "delete", "id": "@I climb.", "file": "everyone"}, {"op": "add", "text": "I climb.", "to": "everyone"},
             {"op": "show", "id": "abc"}, {"op": "clear", "file": "everyone"}, {"op": "clear", "file": "mine"}, {"op": "bogus"},
             {"op": "edit", "id": "nope", "file": "mine", "text": "x"}, {"op": "add", "text": "I keep bees.", "to": "mine"}],
            [{"op": "add", "text": "Shared one", "to": "everyone"}, {"op": "add", "text": "Mine one"},
             {"op": "move", "id": "@Mine one", "file": "mine", "to": "everyone"}, {"op": "add", "text": "Mine one", "to": "mine"},
             {"op": "move", "id": "@Mine one", "file": "mine", "to": "everyone"}, {"op": "edit", "id": "@Shared one", "file": "everyone", "text": "Shared two (added 2026-10-01)"}],
        ]
        out = []
        today = datetime.date.today().isoformat()
        for shared_on in (True, False):
            for steps in seqs:
                with tempfile.TemporaryDirectory() as T, mock.patch.object(facts, "VAULT", os.path.join(T, "Buddy")), \
                        mock.patch.object(facts, "DIR", os.path.join(T, "Buddy", "Buddy knows")), \
                        mock.patch.object(facts, "STATE", os.path.join(T, ".facts_state.json")), mock.patch.object(facts, "_cache", {}):
                    char = {"id": "maya-7k2q", "name": "Maya", "knowledge": {"scope": "some" if shared_on else "none", "folders": [], "avoid": ""}}
                    got = []
                    for st in steps:
                        j = dict(st)
                        if str(j.get("id", "")).startswith("@"):
                            j["id"] = next((f["id"] for f in facts.listing(char) if f["text"] == j["id"][1:]), "missing")
                        try: got.append(facts.change(char, j))
                        except facts.Changed: got.append({"changed": True})
                        except ValueError as e: got.append({"error": str(e)})
                    out.append({"char": {"id": char["id"], "name": "Maya"}, "shared_on": shared_on, "today": today, "steps": steps, "out": got})
        return out

class FileFormat(unittest.TestCase):
    """A .buddysync file written by bcrypto.js, opened here exactly as SPEC3 §7.4/§7.5/§8.9 say (and P4's Mac will)."""
    def setUp(self):
        if not NODE: self.skipTest("node isn't installed")
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        except ImportError: self.skipTest("cryptography isn't installed")
        self.AESGCM = AESGCM

    def test_js_file_opens_here(self):
        rnd = random.Random(9)
        K = bytes(rnd.randrange(256) for _ in range(32))
        big = " ".join("word%d" % i for i in range(1500))                        # (> 4 KiB: compressed)
        records = [{"k": "set", "v": 1, "id": "set", "a": "dev", "n": 1, "h": "1760000000000:0000:dev", "d": {"f": {"tz": ["1760000000000:0000:dev", "UTC"]}}},
                   {"k": "char", "v": 1, "id": "maya-7k2q", "a": "dev", "n": 2, "h": "1760000000001:0000:dev", "d": {"id": "maya-7k2q", "f": {"name": ["1760000000001:0000:dev", "Maya"]}, "epoch": 0, "deleted": None}},
                   {"k": "msg", "v": 1, "id": "AbCdEfGhIjKlMnOpQrStUv", "a": "dev", "n": 3, "h": "1760000000002:0000:dev", "d": {"cid": "AbCdEfGhIjKlMnOpQrStUv", "content": big, "ünd": "é"}},
                   {"k": "facts", "v": 1, "id": "_everyone", "a": "dev", "n": 4, "h": "1760000000003:0000:dev", "d": None}]
        for r, ver in zip(records, (1, 3, 1, 7)): r["ver"] = ver
        blobs = [{"bid": b64u(bytes(rnd.randrange(256) for _ in range(16))), "data": base64.b64encode(os.urandom(n)).decode()} for n in (0, 1000, 70000)]
        r = run_node(CHECK, {"make": {"key": K.hex(), "created": 1760000000123, "records": records, "blobs": blobs}})
        self.assertEqual(r.returncode, 0, r.stderr[-3000:])
        got = json.loads(r.stdout); data = base64.b64decode(got["file"]); a = account(K)
        self.assertEqual(got["acct"], a["acct"])
        self.assertEqual(data[:8], b"BUDDYSYN"); self.assertEqual(data[8:10], b"\x01\x00")
        self.assertEqual(data[10:18], a["kid"]); self.assertEqual(int.from_bytes(data[18:26], "big"), 1760000000123)
        i, payloads, recs, bls, end = 26, [], [], [], None
        while i < len(data):
            t, n = data[i:i + 1], int.from_bytes(data[i + 1:i + 5], "big"); p = data[i + 5:i + 5 + n]; i += 5 + n
            if t == b"R": recs.append(p); payloads.append(p)
            elif t == b"B": bls.append(p); payloads.append(p)
            else: self.assertEqual(t, b"E"); end = p
        self.assertEqual(i, len(data)); self.assertIsNotNone(end)
        self.assertEqual(int.from_bytes(end[:4], "big"), len(records)); self.assertEqual(int.from_bytes(end[4:8], "big"), len(blobs))
        mac = hmac.new(a["kfile"], b"".join(hashlib.sha256(p).digest() for p in payloads), hashlib.sha256).digest()
        self.assertEqual(end[8:], mac, "the trailer MAC (truncation and reorder check)")
        for p, want in zip(recs, records):
            rid, ver, ct = p[:22].decode(), int.from_bytes(p[22:26], "big"), p[26:]
            self.assertEqual(rid, rid_of(a["kname"], want["k"], want["id"])); self.assertEqual(ver, want["ver"])
            self.assertEqual(ct[0], 1)
            P = self.AESGCM(a["kdata"]).decrypt(ct[1:13], ct[13:], f"buddy-sync v1|{a['acct']}|{rid}|{ver}".encode())
            size = len(P)
            self.assertTrue(512 <= size <= 65536 and size & (size - 1) == 0 or size % 65536 == 0, size)
            n, flag = int.from_bytes(P[:4], "big"), P[4]
            body = P[5:5 + n]
            if flag == 1: body = zlib.decompress(body, -15)
            self.assertEqual(flag, 1 if want["k"] == "msg" else 0)
            self.assertEqual(set(P[5 + n:]), set() if 5 + n == size else {0})
            self.assertEqual(json.loads(body), want)
            with self.assertRaises(Exception):                                   # (bound to its record id and version)
                self.AESGCM(a["kdata"]).decrypt(ct[1:13], ct[13:], f"buddy-sync v1|{a['acct']}|{rid}|{ver + 1}".encode())
        for p, b, ref in zip(bls, blobs, got["refs"]):
            bid, ct = p[:22].decode(), p[22:]
            self.assertEqual(bid, b["bid"]); self.assertEqual(b64u(hashlib.sha256(ct).digest()), ref["sha"])
            self.assertEqual((len(ct) - 28) % 65536, 0); self.assertGreaterEqual(len(ct) - 28, 65536)
            key = base64.urlsafe_b64decode(ref["key"] + "==")
            plain = self.AESGCM(key).decrypt(ct[:12], ct[12:], f"buddy-sync blob v1|{a['acct']}|{bid}".encode())[:ref["n"]]
            self.assertEqual(plain, base64.b64decode(b["data"]))

class Prompts(unittest.TestCase):
    """Whole system prompts: a phone made through BuddySolo, against buddy_server.system_prompt for the same world."""
    maxDiff = None

    def setUp(self):
        if not NODE: self.skipTest("node isn't installed")
        sys.path.insert(0, os.path.join(ROOT, "tests"))
        import test_phonemode_parity as tpp                 # (its guard: no real private file is ever opened)
        import buddy_server as bs, social
        self.tpp, self.bs, self.social = tpp, bs, social
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.kit = static_kit()
        self.kit["builtin"]["persona"] = "You are Buddy, a FAKE-PERSONA adult friend."   # (fake texts on both sides)
        self.kit["prompts"]["modes"] = {"advisor": "FAKE-ADVISOR-MODE.", "companion": "FAKE-COMPANION-MODE (unused: public)."}

    def test_whole_prompts(self):
        tpp, bs, social = self.tpp, self.bs, self.social
        spec = {"chars": [
            {"ref": "buddy", "shared_facts": True},
            {"ref": "maya", "shared_facts": True, "fields": {"name": "Maya", "tagline": "Climbing coach", "persona": "You are Maya, a calm coach.", "brain": "companion", "voice": "Serena"}},
            {"ref": "zed", "shared_facts": False, "fields": {"name": "Zed", "tagline": "Night owl", "persona": "", "brain": "advisor"}}],
            "facts": [{"char": "buddy", "op": "add", "text": "I keep bees.", "to": "mine"}, {"char": "buddy", "op": "add", "text": "I live in Porto.", "to": "everyone"},
                      {"char": "maya", "op": "add", "text": "I climb on Sundays.", "to": "mine"}, {"char": "maya", "op": "add", "text": "I like coffee and tea.", "to": "mine"},
                      {"char": "zed", "op": "add", "text": "I watch old films late.", "to": "mine"},
                      {"char": "buddy", "op": "edit", "id": "@I keep bees.", "file": "mine", "text": "I keep two hives of bees."},
                      {"char": "maya", "op": "add", "text": "Coffee every morning in Lisbon.", "to": "everyone"}],
            "settings": {"tz": "Europe/Berlin"}}
        r = run_node(PROMPTS, {"kit": self.kit, "spec": spec}, "world")
        self.assertEqual(r.returncode, 0, r.stderr[-3000:])
        world = json.loads(r.stdout); kit = world["kit"]
        self.assertEqual(kit["tz"], "Europe/Berlin")
        T = self.tmp.name; kdir = os.path.join(T, "Buddy", "Buddy knows"); os.makedirs(kdir)
        for owner in [c["id"] for c in kit["chars"]] + ["_everyone"]:
            rows = [f for c in kit["chars"] for f in world["facts"][c["id"]] if (f["file"] == "mine" and c["id"] == owner) or (f["file"] == "everyone" and owner == "_everyone")]
            seen, lines = set(), []
            for f in rows:
                if f["id"] in seen: continue
                seen.add(f["id"]); lines.append(f"- {f['text']} (added {f['date']})\n")
            if lines:
                with open(os.path.join(kdir, owner + ".md"), "w", encoding="utf-8") as fh: fh.write("".join(lines))
        shared = {c["ref"]: c["shared_facts"] for c in spec["chars"]}
        pychars = {}
        for c in kit["chars"]:
            ref = next(k for k, v in world["ids"].items() if v == c["id"])
            f = next((x.get("fields", {}) for x in spec["chars"] if x["ref"] == ref), {})
            pychars[c["id"]] = {"id": c["id"], "name": c["name"], "tagline": f.get("tagline", "Your closest friend" if ref == "buddy" else ""),
                                "persona": f.get("persona", ""), "builtin": ref == "buddy",
                                "knowledge": {"scope": "some" if shared[ref] else "none", "folders": [], "avoid": ""}}
        cfg = {}
        clock = tpp.Clock()
        ps = [mock.patch.object(characters, "_read", lambda name: self.kit["builtin"]["persona"] if name == "persona.txt" else ""),
              mock.patch.object(bs, "read", lambda name, default="": {"mode_advisor.txt": self.kit["prompts"]["modes"]["advisor"]}.get(name, default)),
              mock.patch.object(images, "find", lambda c: None), mock.patch.object(bs, "life_block", lambda char, via: ""),
              mock.patch.object(bs, "recall", lambda *a, **k: []), mock.patch.object(bs, "cfg", lambda: dict(cfg)),
              mock.patch.object(facts, "VAULT", os.path.join(T, "Buddy")), mock.patch.object(facts, "DIR", kdir),
              mock.patch.object(facts, "STATE", os.path.join(T, ".facts_state.json")), mock.patch.object(facts, "_cache", {}),
              mock.patch.object(edition, "PUBLIC", True), mock.patch.object(bs, "time", clock.time_module()),
              mock.patch.object(bs, "datetime", clock.datetime_module())]
        for p in ps: p.start(); self.addCleanup(p.stop)
        import builtins, io
        for o in (builtins, io):
            p = mock.patch.object(o, "open", tpp.guarded_open); p.start(); self.addCleanup(p.stop)
        tz0 = os.environ.get("TZ"); self.addCleanup(tpp.set_tz, tz0); tpp.set_tz("Europe/Berlin")
        R, now0 = edition.RECHECK, tpp.T0["Europe/Berlin"]
        partners = [{"has_partner": h, "partner_at": a, "partner_noask": q} for h in ("yes", "no", "") for a in (None, "T", "OLD") for q in (False, True)]
        rnd = random.Random(21); cases = []
        for cid, x in pychars.items():
            for mode in ("advisor", "companion"):
                for via in ("phone", "call"):
                    for asking in (False, True):
                        if asking and x["knowledge"]["scope"] != "none":
                            continue                      # (the site's knows_ask always says "not my notes": checked on its own)
                        for photo, cant in ((False, False), (True, False), (True, True)):
                            t = now0 + rnd.randint(0, 3 * 86400)
                            text = rnd.choice(["what do you know about me?", "hey", "explain bees in detail", "lol same", " ".join(["w"] * 12)])
                            query = rnd.choice(["bees in Porto", "coffee tea", "", text, "films"])
                            gap = rnd.choice([0, 3600, 5 * 3600, 3 * 86400])
                            thread = ([{"id": 1, "role": rnd.choice(["user", "assistant"]), "content": "x", "ts": t - gap, "char": cid}] if gap else []) + \
                                     [{"id": 2, "role": "user", "content": text, "ts": t, "char": cid}]
                            prev = thread[:-1]
                            p = dict(partners[len(cases) % len(partners)])
                            p["partner_at"] = t - 3600 if p["partner_at"] == "T" else t - R - 86400 if p["partner_at"] == "OLD" else None
                            cfg.clear(); cfg.update(p)
                            clock.now = t
                            used = []
                            with mock.patch.object(social, "thread", lambda after=0, th=thread: list(th)):
                                out = bs.system_prompt(x, mode, query, None, via, used=used, asking=asking, spoken=via == "call", photos=False,
                                                       extra=([bs.PHOTO_SAFETY] + ([bs.CANT_SEE] if cant else [])) if photo else [],
                                                       length="" if asking else bs.length_hint(text, via))
                            cases.append({"char": cid, "mode": mode, "via": via, "asking": asking, "photo": photo, "cant_see": cant, "text": text,
                                          "query": query, "t": t, "last_ts": prev[0]["ts"] if prev else 0, "last_role": prev[0]["role"] if prev else "",
                                          "partner": {"has": p["has_partner"] if p["has_partner"] in ("yes", "no") else "", "at": p["partner_at"], "noask": p["partner_noask"]},
                                          "out": out, "used": used})
        outs = [c["out"] for c in cases]
        self.assertTrue(all(edition.HALAL in o and "You are an adult." in o for o in outs))
        self.assertTrue(any("I keep two hives of bees." in o for o in outs) and any("Coffee every morning in Lisbon." in o for o in outs))
        self.assertFalse(any("I keep bees." in o for o in outs), "the edited fact replaced the old one")
        self.assertTrue(any("FAKE-PERSONA" in o for o in outs) and any("You are Zed, a friendly adult" in o for o in outs))
        r = run_node(PROMPTS, {"kit": kit, "cases": cases}, "check", tz="UTC")
        self.assertEqual(r.returncode, 0, "JS and Python prompts differ (fake data only):\n" + (r.stdout + r.stderr)[-6000:])
        self.assertRegex(r.stdout, r"(\d+)/\1 cases match")

if __name__ == "__main__":
    unittest.main()
