"""Tests for near.py (NEAR AI pictures): encryption vectors, the evidence checks against NEAR's real recorded answers,
tampered copies, the sealed request, the one-connection rule, status caching, and that nothing is ever sent unverified.
No network: everything is fake or recorded.   Run from Buddy's folder:  python3 -m unittest discover -s tests -v
Needs `cryptography`; the evidence tests also need dcap-qvl (scripts/near-requirements.txt) and recorded NEAR answers:
BUDDY_NEAR_FIXTURES = a checkout of https://github.com/13rac1/teep at d9f59d8 (or its internal/integration/testdata
folder; AGPL test data, used in place, never copied into Buddy). Tests that need what's missing are skipped."""
import base64, calendar, copy, datetime, hashlib, ipaddress, json, os, shutil, socket, ssl, subprocess, sys, tempfile
import threading, time, types, unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import near

def _have(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False

HAVE_CRYPTO, HAVE_DCAP = _have("cryptography"), _have("dcap_qvl")
FIX = os.environ.get("BUDDY_NEAR_FIXTURES", "")
if FIX and os.path.isdir(os.path.join(FIX, "internal", "integration", "testdata")):
    FIX = os.path.join(FIX, "internal", "integration", "testdata")
GOOD = "nearcloud_z-ai_glm-5.3-flash_20260910_153519"
TLS_BAD = ("nearcloud_z-ai_glm-5.3-flash_20260909_201120", "nearcloud_z-ai_glm-5.3-flash_20260909_204025")
GLM = "z-ai/glm-5.3-flash"
need_crypto = unittest.skipUnless(HAVE_CRYPTO, "needs cryptography")
need_evidence = unittest.skipUnless(HAVE_CRYPTO and HAVE_DCAP and FIX and os.path.isdir(os.path.join(FIX, GOOD)),
                                    "needs cryptography, dcap-qvl and BUDDY_NEAR_FIXTURES (recorded NEAR answers)")
FAKE_KEY = "fake-near-key-for-tests-0123456789"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
BLOCK = ("import sys\nclass _No:\n    def find_spec(self, name, path=None, target=None):\n"
         "        if name.split('.')[0] in %r: raise ImportError('blocked for the test')\n"
         "sys.meta_path.insert(0, _No())\n")


# ---------------------------------------------------------------------------------------------------- helpers
class Capture:
    """One recorded NEAR session in teep's format (manifest.json, responses/NNNN_<host>_<path>.{json,body})."""
    def __init__(self, name):
        d = os.path.join(FIX, name)
        with open(os.path.join(d, "manifest.json")) as f:
            man = json.load(f)
        self.nonce = man["nonce_hex"]
        self.now = calendar.timegm(time.strptime(man["captured_at"][:19], "%Y-%m-%dT%H:%M:%S"))
        self.items, r = [], os.path.join(d, "responses")
        for f in sorted(os.listdir(r)):
            if f.endswith(".json"):
                with open(os.path.join(r, f)) as m, open(os.path.join(r, f[:-5] + ".body"), "rb") as b:
                    self.items.append((json.load(m), b.read()))

    def find(self, part, has=""):
        for meta, body in self.items:
            if part in meta["url"] and has in meta["url"]:
                return meta, body
        raise KeyError(part + has)

    def report(self):
        return json.loads(self.find("/v1/attestation/report")[1])

    def peer(self):
        return hashlib.sha256(base64.b64decode(self.find("/v1/attestation/report")[0]["peer_spki_der_base64"])).hexdigest()


class Recorded:
    """verify_evidence's `fetch` from a capture's recorded Intel and NVIDIA answers; remembers what was asked."""
    def __init__(self, cap, nras_body=None):
        self.cap, self.calls, self.nras_body = cap, [], nras_body

    def collateral(self, fmspc, ca, fresh=False):
        self.calls.append(("collateral", fmspc.lower(), ca, fresh))
        c = self.cap
        tcb, qe = c.find("/tdx/certification/v4/tcb", "fmspc=" + fmspc.lower()), c.find("/tdx/certification/v4/qe/identity")
        crl, root = c.find("/sgx/certification/v4/pckcrl", "ca=" + ca), c.find("IntelSGXRootCA.der")
        return near.collateral_from_pcs((tcb[0]["headers"], tcb[1]), (qe[0]["headers"], qe[1]),
                                        (crl[0]["headers"], crl[1]), root[1])

    def nras(self, text):
        self.calls.append(("nras",))
        meta, body = self.cap.find("/v3/attest/gpu")
        return self.nras_body if self.nras_body is not None else body

    def jwks(self, refresh=False):
        self.calls.append(("jwks", refresh))
        return json.loads(self.cap.find("/.well-known/jwks.json")[1])


def _tcb(rep):
    t = rep["info"]["tcb_info"]
    return json.loads(t) if isinstance(t, str) else t

def _set_tcb(rep, tcb):
    rep["info"] = dict(rep["info"], tcb_info=json.dumps(tcb) if isinstance(rep["info"]["tcb_info"], str) else tcb)

def _ed_point(pk):
    """Ed25519 encoding -> extended point (for building test keys)."""
    P, D = near._P, near._D
    y = int.from_bytes(pk, "little") & ((1 << 255) - 1)
    x2 = (y * y - 1) * pow(D * y * y + 1, P - 2, P) % P
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P:
        x = x * near._SQRT_M1 % P
    if (x & 1) != pk[31] >> 7:
        x = P - x
    return (x, y, 1, x * y % P)

def _ed_encode(pt):
    P = near._P
    zi = pow(pt[2], P - 2, P)
    x, y = pt[0] * zi % P, pt[1] * zi % P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


# ---------------------------------------------------------------------------------------------------- N1-N3: encryption
class E2EE(unittest.TestCase):
    def test_hchacha20_vector(self):           # draft-irtf-cfrg-xchacha-03 2.2.1
        k, n = bytes(range(32)), bytes.fromhex("000000090000004a0000000031415927")
        self.assertEqual(near.hchacha20(k, n).hex(), "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc")

    @need_crypto
    def test_xchacha20_poly1305_vector(self):  # A.3.1 (with its AAD; near.py itself never uses AAD)
        pt = (b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, "
              b"sunscreen would be it.")
        aad, key, nonce = bytes.fromhex("50515253c0c1c2c3c4c5c6c7"), bytes(range(0x80, 0xa0)), bytes(range(0x40, 0x58))
        ct = near._crypto().ChaCha20Poly1305(near.hchacha20(key, nonce[:16])).encrypt(b"\0" * 4 + nonce[16:], pt, aad)
        self.assertEqual(ct[:16].hex(), "bd6d179d3e83d43b9576579493c0e939")
        self.assertEqual(ct[-16:].hex(), "c0875924c1c7987947deafd8780acf49")
        self.assertEqual(near._xchacha(key, nonce, near._xchacha(key, nonce, pt), decrypt=True), pt)

    @need_crypto
    def test_key_conversion_vectors(self):
        C = near._crypto()
        for seed, pub, xpub in (("11", "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737",
                                 "7a46e129fd805047448437e4744f1f1576be8c449fdf57e0c580d36c5cfc6668"),
                                ("22", "a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0",
                                 "9d8d78b9c9e6661e552f2f1af02095ee2f8743fa2e6183f41bb7077ef51b5379")):
            sk = C.Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed * 32))
            self.assertEqual(near._raw_pub(sk).hex(), pub)
            self.assertEqual(near.ed25519_pub_to_x25519(bytes.fromhex(pub)).hex(), xpub)
            self.assertEqual(near._raw_pub(near.seed_to_x25519_private(bytes.fromhex(seed * 32))).hex(), xpub)
        priv = near.seed_to_x25519_private(bytes.fromhex("11" * 32))
        raw = priv.private_bytes(C.ser.Encoding.Raw, C.ser.PrivateFormat.Raw, C.ser.NoEncryption())
        self.assertEqual(raw.hex(), "805b920bda4cd49d251d3329144a0cf8bdaaa07502626fa87f08e80faedab15f")

    def test_bad_keys_rejected(self):
        bad = ["00" * 32, "00" * 31 + "80", "01" + "00" * 31, "ec" + "ff" * 30 + "7f", "ff" * 32,
               "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
               "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
               "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
               "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa", "02" + "00" * 31]
        for h in bad:
            with self.assertRaises(ValueError, msg=h):
                near.ed25519_pub_to_x25519(bytes.fromhex(h))
        with self.assertRaises(ValueError):
            near.ed25519_pub_to_x25519(b"\x01" * 31)

    def test_mixed_order_key_rejected(self):   # a real key plus a small-order point: on the curve, outside the subgroup
        good = bytes.fromhex("d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737")
        near.ed25519_pub_to_x25519(good)
        t8 = _ed_point(bytes.fromhex("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"))
        with self.assertRaises(ValueError):
            near.ed25519_pub_to_x25519(_ed_encode(near._ed_add(_ed_point(good), t8)))

    @need_crypto
    def test_random_keys_agree_with_libsodium_identity(self):
        C = near._crypto()                     # X25519(clamped sha512(seed)) == birational map of the Ed25519 key
        for _ in range(40):
            sk = C.Ed25519PrivateKey.generate()
            seed = sk.private_bytes(C.ser.Encoding.Raw, C.ser.PrivateFormat.Raw, C.ser.NoEncryption())
            self.assertEqual(near.ed25519_pub_to_x25519(near._raw_pub(sk)), near._raw_pub(near.seed_to_x25519_private(seed)))

    @need_crypto
    def test_libsodium_sealed_vector(self):
        blob = bytes.fromhex("7b0d47d93427f8311160781c7c733fd89f88970aef490d8aa0ee19a4cb8a1b14" + "44" * 24
                             + "88c0f5ba15715d3a3e50208cdcecae6b68bb2801b55b41edcbfb8fc629")
        self.assertEqual(near.open_sealed(blob, near.seed_to_x25519_private(bytes.fromhex("11" * 32))), b"a red bicycle")

    @need_crypto
    def test_seal_round_trip_and_tamper(self):
        pub = bytes.fromhex("a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0")
        mine = near.seed_to_x25519_private(bytes.fromhex("22" * 32))
        a, b = near.seal(b"a quiet beach at dawn", pub), near.seal(b"a quiet beach at dawn", pub)
        self.assertNotEqual(a, b)              # a one-time key and nonce every time
        self.assertEqual(near.open_sealed(a, mine), b"a quiet beach at dawn")
        for i in (0, 40, len(a) - 1):          # key, nonce, tag
            t = bytearray(a); t[i] ^= 1
            with self.assertRaises(ValueError):
                near.open_sealed(bytes(t), mine)
        with self.assertRaises(ValueError):
            near.open_sealed(a, near.seed_to_x25519_private(bytes.fromhex("11" * 32)))
        with self.assertRaises(ValueError):
            near.open_sealed(a[:60], mine)


# ---------------------------------------------------------------------------------------------------- policy pieces
def _compose(lines, allowed=()):
    return json.dumps({"docker_compose_file": "services:\n" + "\n".join(lines) + "\n", "allowed_envs": list(allowed)})

D1, D2 = "a" * 64, "b" * 64

class Compose(unittest.TestCase):
    def test_pinned_known_images(self):
        got = near.compose_images(_compose([
            "  # image: whatever/in-a-comment", "  cm:", f"    image: ${{COMPOSE_MANAGER_IMAGE:-nearaidev/compose-manager@sha256:{D1}}}",
            "  launcher:", f'    image: "nearaidev/compose-manager-launcher@sha256:{D2}"',
            "  otel:", f"    image: otel/opentelemetry-collector-contrib@sha256:{D1}",
            "configs:", "  otel_config:", "    content: |", "      receivers:", "        filelog:",   # (inline text, like
            "          include: [/var/lib/docker/containers/*/*-json.log]", "", "          build: text"],  # NEAR's real one)
            allowed=["BEARER_TOKEN"]))
        self.assertEqual(got, [f"nearaidev/compose-manager@sha256:{D1}", f"nearaidev/compose-manager-launcher@sha256:{D2}",
                               f"otel/opentelemetry-collector-contrib@sha256:{D1}"])

    def test_refused(self):
        cases = {
            "unknown repo": [f"    image: evil/miner@sha256:{D1}"],
            "no digest": ["    image: nearaidev/compose-manager:latest"],
            "variable the host can set": [f"    image: ${{CM_IMAGE:-nearaidev/compose-manager@sha256:{D1}}}"],
            "bare variable": ["    image: ${CM_IMAGE}"],
            "flow style": ["  x: {image: evil/miner}"],
            "json style": ['  "x": {"image": "evil/miner"}'],
            "anchor": ["    image: *img"],
            "short digest": ["    image: nearaidev/compose-manager@sha256:abcd"],
            "trailing comment": [f"    image: nearaidev/compose-manager@sha256:{D1} # pinned"],
            "nothing": ["  x:", "    command: sleep"],
            "built from source": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  evil:",
                                  "    build: https://github.com/someone/anything.git#main"],
            "build, flow style": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  evil: {build: ., command: x}"],
            "other compose files": [f"    image: nearaidev/compose-manager@sha256:{D1}", "include:",
                                    "  - oci://registry.example/evil-compose:latest"],
            "extends a file": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  evil:", "    extends:",
                               "      file: https://example.com/evil.yml"],
            "quoted key": [f"    image: nearaidev/compose-manager@sha256:{D1}", '  "evil": {"build": "."}'],
            "explicit key": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  evil:", "    ? build", "    : ."],
            "escaped key": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  evil:", '    "bui\\x6cd": .'],
            "after inline text": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  x:", "    command: >", "      sleep 1",
                                  "    build: ."],
            "comment, not text": [f"    image: nearaidev/compose-manager@sha256:{D1}", "  x: # y: |", "    build: ."],
        }
        for why, lines in cases.items():
            with self.assertRaises(near.NearError, msg=why) as e:
                near.compose_images(_compose(lines, allowed=["CM_IMAGE"]))
            self.assertIn("so nothing was sent", str(e.exception))
        with self.assertRaises(near.NearError):
            near.compose_images("not json")
        try:
            near.compose_images(_compose([f"    image: evil/miner@sha256:{D1}"]))
        except near.NearError as e:
            self.assertIn("(evil/miner)", str(e))

    @unittest.skipUnless(FIX and os.path.isdir(FIX), "needs BUDDY_NEAR_FIXTURES")
    def test_every_recorded_near_server_passes(self):
        n = 0
        for c in sorted(os.listdir(FIX)):
            if not c.startswith(("nearcloud_", "neardirect_")) or not os.path.isdir(os.path.join(FIX, c, "responses")):
                continue
            r = json.loads(Capture(c).find("/v1/attestation/report")[1])
            for m in r.get("model_attestations") or [r]:
                imgs = near.compose_images(_tcb(m)["app_compose"])
                self.assertTrue(all(i.split("@")[0] in near.MODEL_IMAGE_REPOS for i in imgs))
                n += 1
        self.assertGreaterEqual(n, 9)


class Rtmr3(unittest.TestCase):
    def test_replay(self):
        import struct
        evs = [{"imr": 0, "event_type": 1, "event": "", "event_payload": "", "digest": "00" * 48},
               {"imr": 3, "event_type": 134217729, "event": "app-id", "event_payload": "abcd", "digest": ""},
               {"imr": 3, "event_type": 134217729, "event": "compose-hash", "event_payload": "11" * 32}]
        r = bytes(48)
        for e in evs[1:]:
            d = hashlib.sha384(struct.pack("<I", e["event_type"]) + b":" + e["event"].encode() + b":" + bytes.fromhex(e["event_payload"])).digest()
            r = hashlib.sha384(r + d).digest()
        got, events = near.replay_rtmr3(json.dumps(evs))
        self.assertEqual(got, r)
        self.assertEqual([e["event"] for e in events], ["app-id", "compose-hash"])
        bad = copy.deepcopy(evs); bad[1]["digest"] = "00" * 48
        with self.assertRaises(ValueError):
            near.replay_rtmr3(bad)
        for broken in ([{"imr": 3, "event_type": -1, "event": "x", "event_payload": ""}],
                       [{"imr": 3, "event_type": 1, "event": "x", "event_payload": "zz"}], {"imr": 3}, ["x"]):
            with self.assertRaises(ValueError):
                near.replay_rtmr3(broken)


@need_crypto
class Gpu(unittest.TestCase):
    """NRAS verdicts from a test signer (its own P-384 key), so each claim check can be tried on its own."""
    NONCE = "ab" * 32

    def setUp(self):
        C = near._crypto()
        self.C, self.k = C, C.ec.generate_private_key(C.ec.SECP384R1())
        nums = self.k.public_key().public_numbers()
        b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
        self.jwks = {"keys": [{"kty": "EC", "crv": "P-384", "kid": "test-kid", "x": b64(nums.x.to_bytes(48, "big")),
                               "y": b64(nums.y.to_bytes(48, "big"))}]}
        self.payload = json.dumps({"nonce": self.NONCE, "arch": "HOPPER", "evidence_list": [{"x": 1}, {"x": 2}]})
        self.now = 1789054519

    def token(self, head=None, **claims):
        b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
        c = {"iss": near.NRAS, "x-nvidia-overall-att-result": True, "eat_nonce": self.NONCE, "nbf": self.now - 5,
             "exp": self.now + 3600}
        c.update(claims)
        h = b64(json.dumps(head or {"alg": "ES384", "kid": "test-kid"}).encode()) + "." + b64(json.dumps(c).encode())
        r, s = self.C.utils.decode_dss_signature(self.k.sign(h.encode(), self.C.ec.ECDSA(self.C.hashes.SHA384())))
        return json.dumps([["JWT", h + "." + b64(r.to_bytes(48, "big") + s.to_bytes(48, "big"))], {}]).encode()

    def test_ok(self):
        self.assertEqual(near.check_gpu(self.payload, self.NONCE, self.token(), self.jwks, self.now), {"gpus": 2, "arch": "HOPPER"})

    def test_refused(self):
        cases = {"other nonce": self.token(eat_nonce="cd" * 32), "not passed": self.token(**{"x-nvidia-overall-att-result": False}),
                 "passed as text": self.token(**{"x-nvidia-overall-att-result": "true"}), "expired": self.token(exp=self.now - 120),
                 "not yet": self.token(nbf=self.now + 600), "issuer": self.token(iss="https://evil.example"),
                 "alg": self.token(head={"alg": "ES256", "kid": "test-kid"}), "no exp": self.token(exp=None),
                 "garbage": b"[]", "not json": b"<html>"}
        for why, body in cases.items():
            with self.assertRaises(near.NearError, msg=why) as e:
                near.check_gpu(self.payload, self.NONCE, body, self.jwks, self.now)
            self.assertEqual(str(e.exception), near.GPU_FAIL)
        tok = json.loads(self.token()); h, p, s = tok[0][1].split(".")
        p = p[:10] + ("A" if p[10] != "A" else "B") + p[11:]
        with self.assertRaises(near.NearError):
            near.check_gpu(self.payload, self.NONCE, json.dumps([["JWT", ".".join((h, p, s))]]).encode(), self.jwks, self.now)
        with self.assertRaises(near.NearError):     # evidence for another nonce
            near.check_gpu(self.payload.replace(self.NONCE, "cd" * 32), self.NONCE, self.token(), self.jwks, self.now)

    def test_signed_by_another_key(self):
        other = self.C.ec.generate_private_key(self.C.ec.SECP384R1())
        real, self.k = self.k, other
        try:
            body = self.token()
        finally:
            self.k = real
        with self.assertRaises(near.NearError) as e:
            near.check_gpu(self.payload, self.NONCE, body, self.jwks, self.now)
        self.assertEqual(str(e.exception), near.GPU_FAIL)

    def test_unknown_kid(self):
        with self.assertRaises(near._UnknownKid):
            near.check_gpu(self.payload, self.NONCE, self.token(head={"alg": "ES384", "kid": "other"}), self.jwks, self.now)


# ---------------------------------------------------------------------------------------------------- N4, N5: recorded evidence
@need_evidence
class Evidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cap = Capture(GOOD)

    def verify(self, report=None, fetch=None, peer=None, nonce=None, seen=None):
        c = self.cap
        return near.verify_evidence(report or c.report(), nonce or c.nonce, peer or c.peer(), c.now, fetch or Recorded(c),
                                    model=GLM, seen=seen)

    def test_recorded_capture_passes(self):
        m = self.cap.report()["model_attestations"][0]
        v = self.verify()
        self.assertEqual(v["model_key"], bytes.fromhex(m["signing_public_key"]))
        g, s = v["gateway"], v["server"]
        self.assertEqual(g["tcb"], "OutOfDate")          # allowed for the gateway (it only sees sealed data)
        self.assertEqual(s["tcb"], "UpToDate")
        self.assertEqual((s["os"], s["gpus"], s["gpu_arch"], s["candidates"]), ("dstack-nvidia-0.5.11", 8, "HOPPER", 1))
        self.assertEqual(len(s["rtmr"]), 3)
        self.assertTrue(s["images"] and s["key"] == m["signing_public_key"])
        self.assertEqual(g["compose"], hashlib.sha256(_tcb(self.cap.report()["gateway_attestation"])["app_compose"].encode()).hexdigest())
        self.assertTrue(len(v["checks"]) >= 10)

    def test_model_must_be_up_to_date(self):
        with mock.patch.object(near, "TCB_OK_MODEL", {"SWHardeningNeeded"}):
            with self.assertRaises(near.NearError) as e:
                self.verify()
        self.assertEqual(str(e.exception), near.UPDATES.format("picture server", "UpToDate"))
        with mock.patch.object(near, "TCB_OK_GATEWAY", {"UpToDate"}):
            with self.assertRaises(near.NearError) as e:
                self.verify()
        self.assertEqual(str(e.exception), near.UPDATES.format("gateway", "OutOfDate"))

    def test_tls_mismatch_captures(self):
        for name in TLS_BAD:
            c = Capture(name)
            with self.assertRaises(near._TlsMismatch, msg=name):
                near.verify_evidence(c.report(), c.nonce, c.peer(), c.now, Recorded(c), model=GLM)
        with self.assertRaises(near._TlsMismatch):
            self.verify(peer="00" * 32)
        with self.assertRaises(near._TlsMismatch):
            near.verify_evidence(self.cap.report(), self.cap.nonce, None, self.cap.now, Recorded(self.cap), model=GLM)

    def test_not_for_flux(self):              # near.py asks for FLUX; an answer for anything else is refused
        c = self.cap
        with self.assertRaises(near.NearError) as e:
            near.verify_evidence(c.report(), c.nonce, c.peer(), c.now, Recorded(c))
        self.assertEqual(str(e.exception), near.OTHER_MODEL)

    def tampered(self, edit, gateway=False):
        r = self.cap.report()
        edit(r["gateway_attestation"] if gateway else r["model_attestations"][0], r)
        return r

    def test_tampered_copies_are_refused(self):
        def flip_quote(m, r):
            q = bytearray(bytes.fromhex(m["intel_quote"])); q[48 + 520 + 5] ^= 1; m["intel_quote"] = q.hex()
        def nonce(m, r): m["request_nonce"] = "00" * 32
        def compose(m, r):
            t = _tcb(m); t["app_compose"] = t["app_compose"].replace("certbot", "certb0t", 1); _set_tcb(m, t)
        def event(m, r):
            log = m["event_log"] if isinstance(m["event_log"], list) else json.loads(m["event_log"])
            e = next(x for x in log if x.get("imr") == 3 and x["event"] == "app-id")
            e["event_payload"] = "00" + e["event_payload"][2:]; e["digest"] = ""
            m["event_log"] = log if isinstance(m["event_log"], list) else json.dumps(log)
        def key(m, r): m["signing_address"] = m["signing_public_key"] = "11" * 32
        def key_mismatch(m, r): m["signing_public_key"] = "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
        def algo(m, r): m["signing_algo"] = "ecdsa"
        def no_gpu(m, r): del m["nvidia_payload"]
        def gpu_nonce(m, r): m["nvidia_payload"] = m["nvidia_payload"].replace(self.cap.nonce, "00" * 32)
        def second(m, r):
            o = copy.deepcopy(m); o["signing_address"] = o["signing_public_key"] = "a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0"
            r["model_attestations"].append(o)
        def other_model(m, r): m["model_name"] = "z-ai/glm-5.3"
        def none(m, r): r["model_attestations"] = []
        def gw_quote(g, r):
            q = bytearray(bytes.fromhex(g["intel_quote"])); q[200] ^= 1; g["intel_quote"] = q.hex()
        def gw_key(g, r): g["signing_address"] = "22" * 32
        def gw_compose(g, r):
            t = _tcb(g); t["app_compose"] += " "; _set_tcb(g, t)
        cases = [("quote byte flipped", flip_quote, False), ("echoed nonce", nonce, False), ("app_compose", compose, False),
                 ("RTMR3 event", event, False), ("signing key swapped", key, False), ("public key != address", key_mismatch, False),
                 ("ecdsa", algo, False), ("no GPU evidence", no_gpu, False), ("GPU evidence for another nonce", gpu_nonce, False),
                 ("second candidate with another key", second, False), ("another model", other_model, False),
                 ("no candidates", none, False), ("gateway quote", gw_quote, True), ("gateway key", gw_key, True),
                 ("gateway compose", gw_compose, True)]
        for why, edit, gw in cases:
            with self.assertRaises(near.NearError, msg=why):
                self.verify(self.tampered(edit, gw))

    def test_policy_changes_are_enforced(self):
        for attr, label in (("MRTD_OK", "MRTD"), ("MRSEAM_OK", "MRSEAM"), ("RTMR1_OK", "RTMR1"), ("RTMR2_OK", "RTMR2")):
            seen = {}
            with mock.patch.object(near, attr, {}):
                with self.assertRaises(near.NearError, msg=attr) as e:
                    self.verify(seen=seen)
            self.assertIn(f"Buddy doesn't recognise yet ({label} ", str(e.exception))
        seen = {}                              # what was observed is kept for near.py --check
        with mock.patch.object(near, "RTMR2_OK", {}):
            with self.assertRaises(near.NearError):
                self.verify(seen=seen)
        self.assertEqual(len(seen["server"]["rtmr"][2]), 96)
        self.assertEqual(seen["gateway"]["tcb"], "OutOfDate")
        with mock.patch.object(near, "MODEL_IMAGE_REPOS", near.MODEL_IMAGE_REPOS - {"certbot/dns-cloudflare"}):
            with self.assertRaises(near.NearError) as e:
                self.verify()
        self.assertIn("(certbot/dns-cloudflare)", str(e.exception))

    def with_register(self, reg, value):
        """verify() where Intel's verified report says `reg` = value (to try each register check on its own)."""
        real = near._mods.get("dcap") or __import__("dcap_qvl")
        class V:
            def __init__(self, v): self.v = v; self.status = v.status; self.advisory_ids = v.advisory_ids
            def to_json(self):
                j = json.loads(self.v.to_json()); td = j["report"]["TD10"]
                td[reg] = value(td[reg]); return json.dumps(j)
        with mock.patch.object(near, "_dcap") as fake:
            fake.return_value = mock.Mock(Quote=real.Quote, QuoteCollateralV3=real.QuoteCollateralV3,
                                          verify=lambda *a: V(real.verify(*a)))
            with self.assertRaises(near.NearError) as e:
                self.verify()
        return str(e.exception)

    def test_each_register_check(self):
        flip = lambda h: ("0" if h[-1] != "0" else "1").join((h[:-1], ""))
        self.assertEqual(self.with_register("td_attributes", lambda h: "01" + h[2:]), near.DEBUG.format("gateway"))
        self.assertEqual(self.with_register("mr_config_id", flip), near.MALFORMED)
        self.assertEqual(self.with_register("rt_mr3", flip), near.MALFORMED)
        self.assertEqual(self.with_register("report_data", lambda h: h[:-2] + "00"), near.NOT_FRESH)
        self.assertEqual(self.with_register("report_data", lambda h: "00" + h[2:]), near.MALFORMED)

    def test_nras_answer_tampered(self):
        tok = json.loads(self.cap.find("/v3/attest/gpu")[1])
        h, p, s = tok[0][1].split(".")
        claims = json.loads(near._b64url(p)); claims["eat_nonce"] = "00" * 32
        p2 = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
        for body in (json.dumps([["JWT", ".".join((h, p2, s))]] + tok[1:]).encode(),
                     json.dumps([["JWT", ".".join((h, p[:-3] + ("A" if p[-3] != "A" else "B") + p[-2:], s))]]).encode()):
            with self.assertRaises(near.NearError) as e:
                self.verify(fetch=Recorded(self.cap, nras_body=body))
            self.assertEqual(str(e.exception), near.GPU_FAIL)

    def test_servers_must_agree(self):
        r = self.cap.report(); r["model_attestations"].append(copy.deepcopy(r["model_attestations"][0]))
        with mock.patch.object(near, "_check_server", side_effect=[b"\x01" * 32, b"\x02" * 32]):
            with self.assertRaises(near.NearError) as e:
                self.verify(r)
        self.assertEqual(str(e.exception), near.DISAGREE)

    def test_collateral_fetched_again_once(self):
        cap = self.cap
        class Stale(Recorded):                # the cached answer (wrong platform) fails; a fresh one is fetched
            def collateral(s, fmspc, ca, fresh=False):
                wrong = {"b0c06f000000": "90C06F000000", "90c06f000000": "B0C06F000000"}[fmspc.lower()]
                return Recorded.collateral(s, fmspc if fresh else wrong, ca, fresh)
        f = Stale(cap)
        self.verify(fetch=f)
        self.assertIn(("collateral", "b0c06f000000", "platform", True), f.calls)
        class Down(Recorded):
            def collateral(s, fmspc, ca, fresh=False):
                raise near.NearError(near.CHECKERS_DOWN)
        with self.assertRaises(near.NearError) as e:
            self.verify(fetch=Down(cap))
        self.assertEqual(str(e.exception), near.CHECKERS_DOWN)

    def test_nras_not_asked_before_cpu_checks_pass(self):
        f = Recorded(self.cap)
        with self.assertRaises(near.NearError):
            self.verify(self.tampered(lambda m, r: m.update(signing_address="11" * 32, signing_public_key="11" * 32)), fetch=f)
        self.assertNotIn(("nras",), f.calls)


# ---------------------------------------------------------------------------------------------------- N6: the sealed request
MODEL_SEED = bytes.fromhex("11" * 32)
MODEL_PUB = bytes.fromhex("d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737")

class FakeNear:
    """A fake NEAR connection: decrypts the prompt with the model's key, checks the headers, answers per `mode`."""
    def __init__(self, mode="ok", picture=PNG, spki="00" * 32, report=None):
        self.mode, self.picture, self.spki_sha256, self.report = mode, picture, spki, report
        self.requests, self.prompts, self.closed = [], [], False

    def request(self, method, path, body=None, headers=None):
        if self.closed:
            raise near.NearError(near.CLOSED)
        self.requests.append((method, path, dict(headers or {}), body))
        if path.startswith("/v1/attestation/report"):
            return self.report(path) if callable(self.report) else (200, {}, json.dumps(self.report or {}).encode())
        assert (method, path) == ("POST", "/v1/images/generations")
        j, h = json.loads(body), headers
        self.prompts.append(near.open_sealed(bytes.fromhex(j["prompt"]), near.seed_to_x25519_private(MODEL_SEED)).decode())
        m = self.mode.pop(0) if isinstance(self.mode, list) else self.mode
        if m == "closed":
            raise near.NearError(near.CLOSED)
        if isinstance(m, int):
            return m, {}, b'{"error": "nope"}'
        if m == "size":
            return 400, {}, b'{"error": {"message": "unsupported size"}}'
        b64 = base64.b64encode(self.picture)
        if m == "plain":
            return 200, {}, json.dumps({"data": [{"b64_json": b64.decode()}]}).encode()
        to = MODEL_PUB if m == "wrongkey" else bytes.fromhex(h["X-Client-Pub-Key"])
        return 200, {}, json.dumps({"data": [{"b64_json": near.seal(b64, to).hex(), "revised_prompt": "x"}]}).encode()

    def close(self):
        self.closed = True


@need_crypto
class SendSealed(unittest.TestCase):
    PROMPT = "an adult (25 to 35 years old), reading on a train"

    def test_ok(self):
        c = FakeNear()
        self.assertEqual(near._send_sealed(c, FAKE_KEY, MODEL_PUB, self.PROMPT, 768, 1024), (PNG, "image/png"))
        self.assertEqual(c.prompts, [self.PROMPT])
        method, path, h, body = c.requests[0]
        j = json.loads(body)
        self.assertEqual({k: j[k] for k in ("model", "n", "size", "response_format")},
                         {"model": near.MODEL, "n": 1, "size": "768x1024", "response_format": "b64_json"})
        self.assertNotIn(self.PROMPT.encode(), body)
        want = {"Authorization": "Bearer " + FAKE_KEY, "Content-Type": "application/json", "Accept-Encoding": "identity",
                "x-no-aliasing": "true", "X-Signing-Algo": "ed25519", "X-Model-Pub-Key": MODEL_PUB.hex(),
                "X-Encryption-Version": "2", "X-Encrypt-All-Fields": "true"}
        self.assertEqual({k: h[k] for k in want}, want)
        self.assertRegex(h["X-Client-Pub-Key"], r"^[0-9a-f]{64}$")
        self.assertEqual(set(h), set(want) | {"X-Client-Pub-Key"})

    def test_jpeg_and_unknown(self):
        jpg = b"\xff\xd8\xff\xe0" + b"\0" * 40
        self.assertEqual(near._send_sealed(FakeNear(picture=jpg), FAKE_KEY, MODEL_PUB, self.PROMPT, 1024, 1024), (jpg, "image/jpeg"))
        webp = b"RIFF\x30\x00\x00\x00WEBPVP8 " + b"\0" * 40           # kept as it came: never written anywhere to convert it
        with mock.patch("builtins.open", side_effect=AssertionError("written to disk")), \
             mock.patch.object(near.os, "open", side_effect=AssertionError("written to disk")):
            self.assertEqual(near._send_sealed(FakeNear(picture=webp), FAKE_KEY, MODEL_PUB, self.PROMPT, 1024, 1024), (webp, "image/webp"))
        with self.assertRaises(near.NearError) as e:
            near._send_sealed(FakeNear(picture=b"GIF89a" + b"\0" * 40), FAKE_KEY, MODEL_PUB, self.PROMPT, 1024, 1024)
        self.assertEqual(str(e.exception), near.CANT_OPEN)

    def test_must_come_back_sealed(self):
        for mode in ("plain", "wrongkey"):
            with self.assertRaises(near.NearError, msg=mode) as e:
                near._send_sealed(FakeNear(mode), FAKE_KEY, MODEL_PUB, self.PROMPT, 768, 1024)
            self.assertEqual(str(e.exception), near.NOT_SEALED)

    def test_size_retry_once(self):
        c = FakeNear(["size", "ok"])
        near._send_sealed(c, FAKE_KEY, MODEL_PUB, self.PROMPT, 768, 1024)
        (_, _, h1, b1), (_, _, h2, b2) = c.requests
        self.assertEqual([json.loads(b)["size"] for b in (b1, b2)], ["768x1024", "1024x1024"])
        self.assertNotEqual(json.loads(b1)["prompt"], json.loads(b2)["prompt"])
        self.assertNotEqual(h1["X-Client-Pub-Key"], h2["X-Client-Pub-Key"])
        c = FakeNear(["size", "size"])
        with self.assertRaises(near.NearError):
            near._send_sealed(c, FAKE_KEY, MODEL_PUB, self.PROMPT, 768, 1024)
        self.assertEqual(len(c.requests), 2)
        c = FakeNear(["size"])                 # already 1024x1024: no retry
        with self.assertRaises(near.NearError):
            near._send_sealed(c, FAKE_KEY, MODEL_PUB, self.PROMPT, 1024, 1024)
        self.assertEqual(len(c.requests), 1)

    def test_http_reasons(self):
        for code, why in ((401, near.BAD_KEY), (403, near.BAD_KEY), (402, near.NO_CREDIT), (404, near.NO_MODEL),
                          (421, near.KEY_CHANGED), (429, near.BUSY), (500, "NEAR had a problem (HTTP 500)"),
                          (503, "NEAR had a problem (HTTP 503)")):
            with self.assertRaises(near.NearError) as e:
                near._send_sealed(FakeNear(code), FAKE_KEY, MODEL_PUB, self.PROMPT, 768, 1024)
            self.assertEqual(str(e.exception), why)
            self.assertNotIn(FAKE_KEY, str(e.exception)); self.assertNotIn("train", str(e.exception))

    def test_closed_connection(self):
        c = FakeNear("closed")
        with self.assertRaises(near.NearError) as e:
            near._send_sealed(c, FAKE_KEY, MODEL_PUB, self.PROMPT, 768, 1024)
        self.assertEqual((str(e.exception), len(c.requests)), (near.CLOSED, 1))


# ---------------------------------------------------------------------------------------------------- N7: never sent unverified
@need_evidence
class FailClosed(unittest.TestCase):
    def run_generate(self, rewrite, spki):
        cap, conns = Capture(GOOD), []
        def report(path):
            nonce = dict(x.split("=") for x in path.split("?")[1].split("&"))["nonce"]
            r = cap.report()
            if rewrite:                       # an attacker can echo the nonce, but can't change the signed quote
                for m in [r["gateway_attestation"]] + r["model_attestations"]:
                    m["request_nonce"] = nonce
                for m in r["model_attestations"]:
                    m["model_name"] = near.MODEL
            return 200, {}, json.dumps(r).encode()
        def connect(host):
            self.assertEqual(host, near.HOST)
            c = FakeNear(spki=spki or cap.peer(), report=report)
            conns.append(c)
            return c
        # near's clock reads the capture's time, as verify_evidence's `now` does elsewhere: Intel's recorded collateral
        # expires about a month after it was recorded, and the checks must still reach the step under test
        clock = types.SimpleNamespace(time=lambda: cap.now, strptime=time.strptime)
        with self.assertRaises(near.NearError) as e, mock.patch.object(near, "time", clock):
            near._generate("an adult (25 to 35 years old), smiling", 768, 1024, FAKE_KEY, connect, Recorded(cap))
        images = [r for c in conns for r in c.requests if r[1].startswith("/v1/images/")]
        self.assertEqual(images, [])          # the prompt never left
        self.assertTrue(all(c.closed for c in conns))
        return str(e.exception), conns

    def test_replayed_report(self):
        why, conns = self.run_generate(False, None)
        self.assertEqual((why, len(conns)), (near.NOT_FRESH, 1))

    def test_echoed_nonce_without_a_new_quote(self):
        why, conns = self.run_generate(True, None)
        self.assertEqual((why, len(conns)), (near.NOT_FRESH, 1))

    def test_other_tls_key(self):
        why, conns = self.run_generate(True, "ee" * 32)
        self.assertEqual((why, len(conns)), (near.TLS, 3))


@need_crypto
class Flow(unittest.TestCase):
    """_generate's order on one connection (verify_evidence replaced by a stand-in that 'passes')."""
    def test_one_connection_report_then_sealed_picture(self):
        conns, seen = [], []
        def connect(host):
            conns.append(FakeNear(report={"x": 1})); return conns[-1]
        ok = {"model_key": MODEL_PUB, "gateway": {"tcb": "OutOfDate"}, "server": {"tcb": "UpToDate"}, "checks": ["x"]}
        with mock.patch.object(near, "ready", return_value=(True, "")), \
                mock.patch.object(near, "verify_evidence", return_value=ok) as v:
            got = near._generate("an adult (25 to 35 years old), hiking", 768, 1024, FAKE_KEY, connect, object(), seen.append)
        self.assertEqual(got, (PNG, "image/png"))
        self.assertEqual(len(conns), 1)
        reqs = conns[0].requests
        self.assertEqual([(m, p.split("?")[0]) for m, p, _, _ in reqs], [("GET", "/v1/attestation/report"), ("POST", "/v1/images/generations")])
        q = dict(x.split("=") for x in reqs[0][1].split("?")[1].split("&"))
        self.assertEqual({k: q[k] for k in ("provider", "signing_algo", "include_tls_fingerprint")},
                         {"provider": "near", "signing_algo": "ed25519", "include_tls_fingerprint": "true"})
        self.assertEqual(q["model"], "black-forest-labs%2FFLUX.2-klein-4B")
        self.assertRegex(q["nonce"], r"^[0-9a-f]{64}$")
        self.assertEqual(v.call_args[0][1], q["nonce"])
        self.assertEqual(reqs[0][2]["x-no-aliasing"], "true")
        self.assertTrue(conns[0].closed and seen[0]["ok"])

    def test_report_refused(self):
        for code, why in ((401, near.BAD_KEY), (429, near.BUSY), (502, "NEAR had a problem (HTTP 502)")):
            conns = []
            def connect(host):
                conns.append(FakeNear(report=lambda path: (code, {}, b"{}"))); return conns[-1]
            with mock.patch.object(near, "ready", return_value=(True, "")):
                with self.assertRaises(near.NearError) as e:
                    near._generate("an adult, cooking", 768, 1024, FAKE_KEY, connect, object())
            self.assertEqual(str(e.exception), why)
            self.assertEqual(len(conns[0].requests), 1)

    def test_bad_requests_send_nothing(self):
        def connect(host):
            raise AssertionError("must not connect")
        with mock.patch.object(near, "ready", return_value=(True, "")):
            for args, why in ((("", 768, 1024, FAKE_KEY), near.BAD_REQUEST), (("x" * 5000, 768, 1024, FAKE_KEY), near.BAD_REQUEST),
                              (("a cat", 10, 1024, FAKE_KEY), near.BAD_REQUEST), (("a cat", 768, 1024, ""), near.NEED_KEY),
                              (("a cat", 768, 1024, "short"), near.BAD_KEY), (("a cat", 768, 1024, "key with\nnewline-0123456789"), near.BAD_KEY)):
                with self.assertRaises(near.NearError) as e:
                    near._generate(*args, connect, object())
                self.assertEqual(str(e.exception), why)


# ---------------------------------------------------------------------------------------------------- the one-connection rule
def _tls_files(d):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    k = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "buddy-near-test")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(k, hashes.SHA256()))
    cp, kp = os.path.join(d, "c.pem"), os.path.join(d, "k.pem")
    with open(cp, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(kp, "wb") as f:
        f.write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return cp, kp, hashlib.sha256(spki).hexdigest()

@need_crypto
class OneConnection(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.cert, key, self.spki = _tls_files(self.dir)
        self.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); self.ctx.load_cert_chain(self.cert, key)
        self.srv = socket.socket(); self.srv.bind(("127.0.0.1", 0)); self.srv.listen(8)
        self.port, self.conns, self.close_after = self.srv.getsockname()[1], 0, True
        threading.Thread(target=self.serve, daemon=True).start()

    def tearDown(self):
        self.srv.close(); shutil.rmtree(self.dir, ignore_errors=True)

    def serve(self):
        while True:
            try:
                s, _ = self.srv.accept()
            except OSError:
                return
            self.conns += 1
            try:
                t = self.ctx.wrap_socket(s, server_side=True)
                while True:
                    data = b""
                    while b"\r\n\r\n" not in data:
                        chunk = t.recv(65536)
                        if not chunk:
                            raise EOFError
                        data += chunk
                    body = b'{"ok": true}'
                    t.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n%s\r\n%s"
                              % (len(body), b"Connection: close\r\n" if self.close_after else b"", body))
                    if self.close_after:
                        t.close(); break
            except Exception:
                pass

    def client(self):
        return near._PinnedHTTPS("127.0.0.1", self.port, context=ssl.create_default_context(cafile=self.cert))

    def test_never_reconnects(self):
        c = self.client()
        self.assertEqual(c.spki_sha256, self.spki)
        self.assertEqual(c.request("GET", "/v1/attestation/report?x=1")[0], 200)
        with self.assertRaises(near.NearError) as e:
            c.request("POST", "/v1/images/generations", b"{}", {"Content-Type": "application/json"})
        self.assertEqual(str(e.exception), near.CLOSED)
        time.sleep(0.2)
        self.assertEqual(self.conns, 1)
        c.close()

    def test_keep_alive_reuses_the_checked_connection(self):
        self.close_after = False
        c = self.client()
        for _ in range(3):
            self.assertEqual(c.request("GET", "/v1/attestation/report?x=1")[2], b'{"ok": true}')
        c.close()
        time.sleep(0.2)
        self.assertEqual(self.conns, 1)

    def test_connection_class_refuses_a_second_connect(self):
        c = near._OneConnection("127.0.0.1", self.port, timeout=5, context=ssl.create_default_context(cafile=self.cert))
        c.connect(); c.close()
        with self.assertRaises(near.NearError):
            c.connect()
        with self.assertRaises(near.NearError):      # http.client's own auto-reconnect goes through connect() too
            c.request("GET", "/")
        time.sleep(0.2)
        self.assertEqual(self.conns, 1)

    def test_untrusted_certificate(self):
        with self.assertRaises(near.NearError) as e:
            near._PinnedHTTPS("127.0.0.1", self.port)        # the normal WebPKI check: a self-made certificate fails
        self.assertEqual(str(e.exception), near.CERT)

    def test_nothing_listening(self):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        with self.assertRaises(near.NearError) as e:
            near._PinnedHTTPS("127.0.0.1", port)
        self.assertEqual(str(e.exception), near.OFFLINE)


# ---------------------------------------------------------------------------------------------------- status()
class Status(unittest.TestCase):
    def setUp(self):
        near.forget()
        p = mock.patch.object(near, "ready", return_value=(True, ""))
        p.start(); self.addCleanup(p.stop); self.addCleanup(near.forget)

    def ok(self, *a):
        return near._result(True, "", gateway={"tcb": "OutOfDate"}, server={"tcb": "UpToDate"}, checks=["x"])

    def test_no_key_and_not_installed(self):
        self.assertEqual(near.status("")["reason"], near.NEED_KEY)
        self.assertEqual(near.status(None, wait=False)["reason"], near.NEED_KEY)
        with mock.patch.object(near, "ready", return_value=(False, near.NOT_INSTALLED)):
            r = near.status(FAKE_KEY)
        self.assertEqual((r["ok"], r["reason"], r["gateway"], r["server"]), (False, near.NOT_INSTALLED, None, None))
        self.assertEqual(near.status("bad key with spaces 0123456789")["reason"], near.BAD_KEY)

    def test_cached_fresh_and_forget(self):
        with mock.patch.object(near, "_check", side_effect=self.ok) as chk:
            self.assertTrue(near.status(FAKE_KEY)["ok"])
            self.assertTrue(near.status(FAKE_KEY)["ok"] and near.status(FAKE_KEY, wait=False)["ok"])
            self.assertEqual(chk.call_count, 1)
            near.status(FAKE_KEY, fresh=True)
            self.assertEqual(chk.call_count, 2)
            near.status(FAKE_KEY + "x")                       # another key: checked again
            self.assertEqual(chk.call_count, 3)
            near.forget(); near.status(FAKE_KEY + "x")
            self.assertEqual(chk.call_count, 4)

    def test_failures_cached_briefly(self):
        bad = near._result(False, near.OFFLINE)
        with mock.patch.object(near, "_check", return_value=bad) as chk:
            self.assertEqual(near.status(FAKE_KEY)["reason"], near.OFFLINE)
            near.status(FAKE_KEY)
            self.assertEqual(chk.call_count, 1)
            with mock.patch.object(near, "FAIL_TTL", 0):
                near.status(FAKE_KEY)
            self.assertEqual(chk.call_count, 2)

    def test_wait_false_never_blocks(self):
        go, calls = threading.Event(), []
        def slow(key):
            calls.append(key); go.wait(5); return self.ok()
        with mock.patch.object(near, "_check", side_effect=slow):
            t = time.time()
            r = [near.status(FAKE_KEY, wait=False) for _ in range(5)]
            self.assertLess(time.time() - t, 1)
            self.assertTrue(all(x["checking"] and not x["ok"] and x["reason"] == near.CHECKING for x in r))
            go.set()
            for _ in range(50):
                if near.status(FAKE_KEY, wait=False)["ok"]:
                    break
                time.sleep(0.05)
            self.assertTrue(near.status(FAKE_KEY, wait=False)["ok"])
            self.assertEqual(len(calls), 1)               # one background check, however often it was asked

    def test_never_raises(self):
        with mock.patch.object(near, "_check", side_effect=RuntimeError("boom " + FAKE_KEY)):
            r = near.status(FAKE_KEY)
        self.assertEqual((r["ok"], r["reason"]), (False, near.CHECK_FAILED))
        self.assertNotIn(FAKE_KEY, json.dumps(r))

    def test_check_reports_reason_and_what_it_saw(self):
        def connect_fail(*a, **k):
            raise near.NearError(near.OFFLINE)
        with mock.patch.object(near, "_PinnedHTTPS", side_effect=connect_fail):
            r = near._check(FAKE_KEY)
        self.assertEqual((r["ok"], r["reason"]), (False, near.OFFLINE))
        self.assertNotIn(FAKE_KEY, json.dumps(r))


# ---------------------------------------------------------------------------------------------------- N8, CLI, hosts
def _run(code, cwd=None, extra_env=None):
    env = dict(os.environ, **(extra_env or {}))
    return subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, cwd=cwd, env=env, timeout=60)

class Installed(unittest.TestCase):
    def test_works_without_the_checker(self):     # N8: Buddy imports near.py before dcap-qvl is installed
        code = (BLOCK % (("dcap_qvl",),)) + (
            f"sys.path.insert(0, {ROOT!r})\nimport near, json\n"
            "ok, why = near.ready(); assert not ok and why == near.NOT_INSTALLED, why\n"
            f"r = near.status({FAKE_KEY!r}); assert r['reason'] == near.NOT_INSTALLED and not r['ok'], r\n"
            f"r = near.status({FAKE_KEY!r}, wait=False); assert r['reason'] == near.NOT_INSTALLED, r\n"
            "try:\n    near.generate('a cat', 768, 1024, %r)\n    raise SystemExit('generated')\n"
            "except near.NearError as e:\n    assert str(e) == near.NOT_INSTALLED, e\n"
            "assert 'dcap_qvl' not in sys.modules\nprint('fine')\n" % FAKE_KEY)
        r = _run(code)
        self.assertEqual(r.stdout.strip(), "fine", r.stderr)
        r = _run((BLOCK % (("dcap_qvl", "cryptography"),)) + f"sys.path.insert(0, {ROOT!r})\nimport near\n"
                 "assert near.ready() == (False, near.NOT_INSTALLED)\nprint(near.hchacha20(bytes(32), bytes(16)).hex()[:8])\n")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_cli(self):
        d = tempfile.mkdtemp()
        try:
            shutil.copy(os.path.join(ROOT, "near.py"), d)
            r = subprocess.run([sys.executable, "-I", os.path.join(d, "near.py"), "--check", "--json"], capture_output=True,
                               text=True, timeout=60)
            self.assertEqual((r.returncode, json.loads(r.stdout)["reason"]), (1, near.NEED_KEY))
            with open(os.path.join(d, ".near_key"), "w") as f:
                f.write(FAKE_KEY)
            code = (BLOCK % (("dcap_qvl",),)) + f"sys.path.insert(0, {d!r})\nimport near\nsys.exit(near._cli(['--check']))\n"
            r = _run(code)
            self.assertEqual(r.returncode, 1)
            self.assertIn(near.NOT_INSTALLED, r.stdout)
            self.assertNotIn(FAKE_KEY, r.stdout + r.stderr)
        finally:
            shutil.rmtree(d, ignore_errors=True)

class Hosts(unittest.TestCase):
    def test_only_the_listed_hosts(self):
        import re
        with open(os.path.join(ROOT, "near.py")) as f:
            src = f.read()
        hosts = set(re.findall(r"https://([A-Za-z0-9.-]+)", src))
        self.assertEqual(hosts, {"api.trustedservices.intel.com", "certificates.trustedservices.intel.com",
                                 "nras.attestation.nvidia.com", "cloud-api.near.ai"} & hosts)
        self.assertEqual(near.HOST, "cloud-api.near.ai")
        for url in ("https://example.com/x", "http://api.trustedservices.intel.com/x", "https://api.trustedservices.intel.com.evil/x"):
            with self.assertRaises(near.NearError):
                near._https("GET", url)

    def test_no_env_or_setting_changes_anything(self):
        import re
        with open(os.path.join(ROOT, "near.py")) as f:
            src = f.read()
        self.assertFalse(re.search(r"os\.environ|getenv|config(\.local)?\.json|\bopen\(.*(config|settings)", src))


if __name__ == "__main__":
    unittest.main()
