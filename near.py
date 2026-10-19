#!/usr/bin/env python3
"""NEAR AI Cloud pictures: FLUX.2 [klein] 4B on NEAR's sealed GPUs (Intel TDX + NVIDIA confidential computing), opt-in
with your own key (.near_key). Checked for every picture before anything is sent:

On one fresh TLS connection to cloud-api.near.ai, Buddy asks for NEAR's attestation with a fresh random nonce and checks
the gateway and the picture server: Intel's verdict on their TDX quotes (Intel's own collateral, via dcap-qvl), current
security patches (picture server), no debug mode, the nonce, a known TDX module and dstack OS (pinned MRSEAM, MRTD, and for
the picture server RTMR1/RTMR2), the exact measured configuration (MRCONFIGID, RTMR3 event log replay), only known
programs pinned by digest on the picture server, its encryption key bound into its quote, the gateway's TLS key equal to
the one this connection uses, and NVIDIA's verdict (NRAS) on the server's GPUs for this nonce. Only then, on that same
connection, the prompt goes out end-to-end encrypted to the attested key, and the picture must come back encrypted to
Buddy's one-time key. Any failed check: nothing is sent (fail closed). No setting, env var, file or endpoint can skip a
check or change where Buddy connects.

Hosts: cloud-api.near.ai (your key, the sealed prompt), api.trustedservices.intel.com and
certificates.trustedservices.intel.com (Intel's public collateral), nras.attestation.nvidia.com (NEAR's GPU evidence).
Nothing else. Only picture prompts ever go to NEAR: never chats, notes or your photos.
Check it yourself (prints what NEAR's servers run; never your key):  .venv/bin/python near.py --check [--json]"""
from __future__ import annotations
import base64, calendar, hashlib, hmac, http.client, importlib, json, os, re, secrets, socket, ssl, struct
import sys, threading, time, types, urllib.error, urllib.parse, urllib.request

MODEL = "black-forest-labs/FLUX.2-klein-4B"
HOST = "cloud-api.near.ai"
HERE = os.path.dirname(os.path.abspath(__file__))
PCS = "https://api.trustedservices.intel.com"
ROOT_CRL = "https://certificates.trustedservices.intel.com/IntelSGXRootCA.der"
NRAS = "https://nras.attestation.nvidia.com"
CHECKERS = {"api.trustedservices.intel.com", "certificates.trustedservices.intel.com", "nras.attestation.nvidia.com"}

# ---- Pinned policy (changed only by a reviewed Buddy release; never by a setting, never trust-on-first-use) ----
TCB_OK_MODEL = {"UpToDate"}
TCB_OK_GATEWAY = {"UpToDate", "SWHardeningNeeded", "ConfigurationNeeded", "ConfigurationAndSWHardeningNeeded",
                  "OutOfDate", "OutOfDateConfigurationNeeded"}      # the gateway only sees sealed data; Revoked always fails
MRSEAM_OK = {   # Intel TDX module (teep dstack_defaults.go; cross-check: intel/confidential-computing.tdx.tdx-module releases)
    "49b66faa451d19ebbdbe89371b8daf2b65aa3984ec90110343e9e2eec116af08850fa20e3b1aa9a874d77a65380ee7e6": "TDX module 1.5.08",
    "7bf063280e94fb051f5dd7b1fc59ce9aac42bb961df8d44b709c9b0ff87a7b4df648657ba6d1189589feab1d5a3c9a9d": "TDX module 1.5.16",
    "d0d80c085166ba78ccc69af268e5753cf0f3394523cb4ff7c50b08d9265c82489c099c377be6a400e4d2b57da924012c": "TDX module 1.5.20",
    "476a2997c62bccc78370913d0a80b956e3721b24272bc66c4d6307ced4be2865c40e26afac75f12df3425b03eb59ea7c": "TDX module 2.0.08",
    "685f891ea5c20e8fa27b151bf34bf3b50fbaf7143cc53662727cbdb167c0ad8385f1f6f3571539a91e104a1c96d75e04": "TDX module 2.0.02",
}
MRTD_OK = {     # dstack-nvidia virtual firmware (gateway and picture server)
    "b24d3b24e9e3c16012376b52362ca09856c4adecb709d5fac33addf1c47e193da075b125b6c364115771390a5461e217": "dstack-nvidia-0.5.4.1",
    "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077": "dstack-nvidia-0.5.5",
    "df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b": "dstack-nvidia-0.5.11",
}
RTMR1_OK = {    # picture server kernel (teep nearcloud/policy.go)
    "c0445b704e4c48139496ae337423ddb1dcee3a673fd5fb60a53d562f127d235f11de471a7b4ee12c9027c829786757dc",
    "ff61e68fa04516b1813d2d478397a97a58f9ccc402b6d96fb73f5e5104a4acf155913caec99a0c19afc16ae0f3a77726",  # 0.5.11
}
RTMR2_OK = {    # picture server cmdline/initrd/rootfs
    "564622c7ddc55a53272cc9f0956d29b3f7e0dd18ede432720b71fd89e5b5d76cb0b99be7b7ff2a6a92b89b6b01643135",
    "4d662c04766145dfe084fd014969b19c387afe9bb1d4f972c6968d28a7a8b4937c414603a2cf446105eddce67a86f9ce",  # 0.5.11
}
MODEL_IMAGE_REPOS = {"nearaidev/compose-manager", "nearaidev/compose-manager-launcher", "otel/opentelemetry-collector-contrib",
                     "datadog/agent", "certbot/dns-cloudflare"}

# ---- Limits ----
CONNECT_TIMEOUT, REPORT_TIMEOUT, CHECKER_TIMEOUT, GEN_TIMEOUT = 10, 30, 20, 120
REPORT_CAP, CHECKER_CAP, IMAGE_CAP = 4 << 20, 1 << 20, 40 << 20
OK_TTL, FAIL_TTL = 15 * 60, 2 * 60

# ---- What the user reads (never the key, the prompt or picture data) ----
NEED_KEY = "NEAR AI needs your key (add it on your Mac: Settings → Pictures)"
NOT_INSTALLED = "Buddy's NEAR checker isn't installed yet (it comes with the next update)"
CHECKING = "checking NEAR…"
OFFLINE = "Can't reach NEAR AI (offline?)"
CERT = "NEAR AI's HTTPS certificate couldn't be checked (is this Mac's clock right?), so nothing was sent"
SLOW = "NEAR AI took too long to answer; try again"
BAD_KEY = "NEAR didn't accept your key"
NO_CREDIT = "NEAR says the account is out of credit"
NO_MODEL = "NEAR doesn't offer FLUX.2 [klein] right now"
KEY_CHANGED = "NEAR's server key just changed; try again"
BUSY = "NEAR is busy; try again in a bit"
CLOSED = "NEAR closed the checked connection; try again"
TOO_BIG = "NEAR's answer was too big, so it wasn't used"
MALFORMED = "NEAR's answer about its servers was malformed, so nothing was sent"
OTHER_MODEL = "NEAR answered for a different model, so nothing was sent"
INTEL_FAILED = "Intel's check of NEAR's {} failed, so nothing was sent"
UPDATES = "Intel says NEAR's {} needs security updates ({}), so nothing was sent"
DEBUG = "NEAR's {} is in debug mode, so nothing was sent"
UNKNOWN_SW = "NEAR's {} runs software Buddy doesn't recognise yet ({} {}…), so nothing was sent"
UNKNOWN_PROGRAM = "NEAR's picture server runs a program Buddy doesn't recognise ({}), so nothing was sent"
GPU_FAIL = "NEAR's GPUs didn't pass NVIDIA's check, so nothing was sent"
CHECKERS_DOWN = "Can't reach Intel or NVIDIA to check NEAR, so nothing was sent"
TLS = "NEAR's gateway didn't match its own attestation (TLS), so nothing was sent"
NOT_FRESH = "NEAR's answer wasn't fresh, so nothing was sent"
DISAGREE = "NEAR's servers disagree about their key, so nothing was sent"
NOT_SEALED = "The picture didn't come back sealed for Buddy, so it wasn't used"
CANT_OPEN = "NEAR sent a picture Buddy can't open"
BAD_REQUEST = "Buddy's picture request wasn't one NEAR can make (empty, too long or an odd size)"
CHECK_FAILED = "Buddy couldn't finish checking NEAR, so nothing was sent"
UNEXPECTED = "Buddy hit a problem with NEAR AI; try again"
GATEWAY, SERVER = "gateway", "picture server"


class NearError(RuntimeError):
    """str(e) is a short plain-words reason for the user. Never contains the key, the prompt or picture data."""


class _TlsMismatch(NearError):
    """The gateway's attested TLS key isn't the one on this connection (NEAR load-balances: try a new connection)."""
    def __init__(self):
        super().__init__(TLS)


class _UnknownKid(NearError):
    """NRAS signed with a key that isn't in the cached key set (fetch it again once)."""
    def __init__(self):
        super().__init__(GPU_FAIL)


# ---- Libraries (imported only when needed, so Buddy runs without them until you turn NEAR on) ----
_mods = {}
_lock = threading.RLock()          # guards every cache in this file
_ready_at = [0.0]

def _crypto():
    c = _mods.get("crypto")
    if c is None:
        from cryptography import x509
        from cryptography.exceptions import InvalidSignature, InvalidTag
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec, utils
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
        from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        c = _mods["crypto"] = types.SimpleNamespace(
            x509=x509, InvalidSignature=InvalidSignature, InvalidTag=InvalidTag, hashes=hashes, ser=serialization, ec=ec,
            utils=utils, Ed25519PrivateKey=Ed25519PrivateKey, X25519PrivateKey=X25519PrivateKey,
            X25519PublicKey=X25519PublicKey, ChaCha20Poly1305=ChaCha20Poly1305, HKDF=HKDF)
    return c

def _dcap():
    d = _mods.get("dcap")
    if d is None:
        import dcap_qvl
        for name in ("Quote", "verify", "QuoteCollateralV3"):
            getattr(dcap_qvl, name)
        d = _mods["dcap"] = dcap_qvl
    return d

def ready() -> tuple[bool, str]:
    """(True, "") when the checker's libraries import (dcap_qvl; cryptography with Ed25519, X25519, ChaCha20-Poly1305
    and HKDF); else (False, NOT_INSTALLED). Notices a library installed while Buddy runs (looked for again every 5 s)."""
    with _lock:
        if "crypto" in _mods and "dcap" in _mods:
            return True, ""
        if time.time() - _ready_at[0] < 5 and _ready_at[0]:
            return False, NOT_INSTALLED
        _ready_at[0] = time.time()
        try:
            importlib.invalidate_caches()
            _crypto(); _dcap()
            return True, ""
        except Exception:
            return False, NOT_INSTALLED


# ---- End-to-end encryption (NEAR E2EE v2: X25519 + HKDF-SHA256 "ed25519_encryption" + XChaCha20-Poly1305) ----
_P = 2 ** 255 - 19
_D = -121665 * pow(121666, _P - 2, _P) % _P
_L = 2 ** 252 + 27742317777372353535851937790883648493
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)
_SMALL_ORDER_Y = {0, 1, _P - 1, 0x7a03ac9277fdc74ec6cc392cfa53202a0f67100d760b3cba4fd84d3d706a17c7,
                  0x05fc536d880238b13933c6d305acdfd5f098eff289f4c345b027b2c28f95e826}

def _rotl(v, c):
    return ((v << c) & 0xffffffff) | (v >> (32 - c))

def hchacha20(key32: bytes, nonce16: bytes) -> bytes:
    """HChaCha20 (draft-irtf-cfrg-xchacha-03 2.2): the subkey for XChaCha20 (cryptography has no XChaCha)."""
    if len(key32) != 32 or len(nonce16) != 16:
        raise ValueError("bad hchacha20 input")
    s = list(struct.unpack("<4I", b"expand 32-byte k")) + list(struct.unpack("<8I", key32)) + list(struct.unpack("<4I", nonce16))
    def qr(a, b, c, d):
        s[a] = (s[a] + s[b]) & 0xffffffff; s[d] = _rotl(s[d] ^ s[a], 16)
        s[c] = (s[c] + s[d]) & 0xffffffff; s[b] = _rotl(s[b] ^ s[c], 12)
        s[a] = (s[a] + s[b]) & 0xffffffff; s[d] = _rotl(s[d] ^ s[a], 8)
        s[c] = (s[c] + s[d]) & 0xffffffff; s[b] = _rotl(s[b] ^ s[c], 7)
    for _ in range(10):
        qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15)
        qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14)
    return struct.pack("<8I", *(s[0:4] + s[12:16]))

def _xchacha(key, nonce24, data, decrypt=False):
    aead = _crypto().ChaCha20Poly1305(hchacha20(key, nonce24[:16]))
    n = b"\0\0\0\0" + nonce24[16:24]
    return aead.decrypt(n, data, None) if decrypt else aead.encrypt(n, data, None)

def _ed_add(p, q):          # twisted Edwards (a = -1) addition in extended coordinates (RFC 8032 5.1.4; complete)
    x1, y1, z1, t1 = p; x2, y2, z2, t2 = q
    a, b = (y1 - x1) * (y2 - x2) % _P, (y1 + x1) * (y2 + x2) % _P
    c, d = t1 * 2 * _D * t2 % _P, z1 * 2 * z2 % _P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)

def ed25519_pub_to_x25519(pk32: bytes) -> bytes:
    """The X25519 public key for an Ed25519 public key (u = (1+y)/(1-y), as libsodium). Raises ValueError for a
    non-canonical encoding, a point not on the curve, a small-order point, or one outside the prime-order subgroup."""
    if not isinstance(pk32, (bytes, bytearray)) or len(pk32) != 32:
        raise ValueError("bad key length")
    y = int.from_bytes(pk32, "little") & ((1 << 255) - 1)
    sign = pk32[31] >> 7
    if y >= _P:
        raise ValueError("non-canonical key")
    if y in _SMALL_ORDER_Y:
        raise ValueError("small-order key")
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P:
        raise ValueError("not a curve point")
    if x == 0 and sign:
        raise ValueError("non-canonical key")
    if (x & 1) != sign:
        x = _P - x
    q, pt, n = (0, 1, 1, 0), (x, y, 1, x * y % _P), _L      # L·P must be the identity (prime-order subgroup)
    while n:
        if n & 1:
            q = _ed_add(q, pt)
        pt, n = _ed_add(pt, pt), n >> 1
    if q[0] % _P or (q[1] - q[2]) % _P:
        raise ValueError("key outside the prime-order subgroup")
    return ((1 + y) * pow(1 - y, _P - 2, _P) % _P).to_bytes(32, "little")

def seed_to_x25519_private(seed32: bytes):
    """The X25519 private key for an Ed25519 seed (SHA-512, clamped, as libsodium's sk_to_curve25519)."""
    if len(seed32) != 32:
        raise ValueError("bad seed length")
    h = bytearray(hashlib.sha512(seed32).digest()[:32])
    h[0] &= 248; h[31] &= 127; h[31] |= 64
    return _crypto().X25519PrivateKey.from_private_bytes(bytes(h))

def _hkdf(shared):
    C = _crypto()
    return C.HKDF(algorithm=C.hashes.SHA256(), length=32, salt=None, info=b"ed25519_encryption").derive(shared)

def _raw_pub(k):
    C = _crypto()
    return k.public_key().public_bytes(C.ser.Encoding.Raw, C.ser.PublicFormat.Raw)

def seal(plaintext: bytes, model_ed25519_pub: bytes) -> bytes:
    """Encrypts to an Ed25519 key's X25519 twin with a one-time key: eph_pub(32) ‖ nonce(24) ‖ ciphertext+tag."""
    C = _crypto()
    eph = C.X25519PrivateKey.generate()
    key = _hkdf(eph.exchange(C.X25519PublicKey.from_public_bytes(ed25519_pub_to_x25519(bytes(model_ed25519_pub)))))
    n = os.urandom(24)
    return _raw_pub(eph) + n + _xchacha(key, n, bytes(plaintext))

def open_sealed(blob: bytes, x25519_private) -> bytes:
    """Opens what seal() made for this X25519 private key. Raises ValueError if it wasn't sealed for it or was changed."""
    C = _crypto()
    if not isinstance(blob, (bytes, bytearray)) or len(blob) < 32 + 24 + 16:
        raise ValueError("too short to be sealed")
    try:
        key = _hkdf(x25519_private.exchange(C.X25519PublicKey.from_public_bytes(bytes(blob[:32]))))
        return _xchacha(key, bytes(blob[32:56]), bytes(blob[56:]), decrypt=True)
    except (C.InvalidTag, ValueError):
        raise ValueError("not sealed for this key") from None


# ---- Evidence checks ----
def _unhex(v, size=None, cap=None):
    if not isinstance(v, str):
        raise NearError(MALFORMED)
    v = v[2:] if v[:2] in ("0x", "0X") else v
    if cap and len(v) > cap * 2:
        raise NearError(MALFORMED)
    try:
        b = bytes.fromhex(v)
    except ValueError:
        raise NearError(MALFORMED) from None
    if size is not None and len(b) != size:
        raise NearError(MALFORMED)
    return b

def _maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            raise NearError(MALFORMED) from None
    return v

def replay_rtmr3(event_log) -> tuple[bytes, list]:
    """Replays the imr-3 (dstack runtime) events: digest = SHA-384(LE32(type) ‖ ":" ‖ event ‖ ":" ‖ payload), extended
    from 48 zero bytes. -> (RTMR3, those events). Raises ValueError when an event's stated digest doesn't match."""
    log = json.loads(event_log) if isinstance(event_log, str) else event_log
    if not isinstance(log, list) or len(log) > 4096:
        raise ValueError("event log isn't a list")
    r, events = bytes(48), []
    for e in log:
        if not isinstance(e, dict):
            raise ValueError("bad event")
        if e.get("imr") != 3:
            continue
        et, name, payload = e.get("event_type"), e.get("event"), e.get("event_payload") or ""
        if type(et) is not int or not isinstance(name, str) or not isinstance(payload, str):
            raise ValueError("bad event")
        try:
            d = hashlib.sha384(struct.pack("<I", et) + b":" + name.encode() + b":" + bytes.fromhex(payload)).digest()
        except struct.error:
            raise ValueError("bad event type") from None
        stated = e.get("digest")
        if stated and (not isinstance(stated, str) or bytes.fromhex(stated) != d):
            raise ValueError("event digest mismatch")
        r = hashlib.sha384(r + d).digest()
        events.append(e)
    return r, events

_IMAGE_LINE = re.compile(r"^\s*image:\s*(.*?)\s*$")
_IMAGE_KEY = re.compile(r"""(?:^|[\s{,\-])["']?image["']?\s*:""")
# Programs from anywhere but a pinned image: built from source (build), other compose files (include, extends file).
_FROM_ELSEWHERE = re.compile(r"""(?:^|[\s{,\-])["']?(build|include|extends)["']?\s*:""")
_HIDDEN_KEY = re.compile(r"""^\s*(?:-\s+)*(?:\?(?:\s|$)|\*)|["'][^"']*\\[^"']*["']\s*:""")   # ? key, *alias key, "esc\aped"
_BLOCK = re.compile(r"""^( *(?:- +)*)[^\s#'"-][^#'"]*:\s+[|>]([1-9]?)[-+]?([1-9]?)\s*$""")      # key: |  (text follows)
_REF = re.compile(r"^([a-z0-9][a-z0-9._/-]*)@sha256:[0-9a-f]{64}$")
_DEFAULT = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-|-)(.*)\}$")

def compose_images(app_compose_text: str) -> list[str]:
    """Every container image of the picture server's measured configuration: each must be pinned by digest and come
    from a known repository (an image chosen by a variable counts only when NEAR's host can't set that variable), and
    no program may come from anywhere else (build, include, extends: refused at any indent, outside inline text).
    -> ["repo@sha256:<64 hex>", …]. Raises NearError when anything isn't recognised."""
    try:
        ac = json.loads(app_compose_text)
        text, allowed = ac["docker_compose_file"], ac.get("allowed_envs") or []
        if not isinstance(text, str) or not isinstance(allowed, list):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise NearError(MALFORMED) from None
    out, block = [], None                                  # block: (key's column, its text's indent) while in `key: |` text
    for line in text.splitlines():
        inline = False                                     # (a line of a config file written inline: text, not keys)
        if block is not None and line.strip():
            ind = len(line) - len(line.lstrip(" "))
            inline = ind > block[0] and ind >= (block[1] or ind)
            block = (block[0], block[1] or ind) if inline else None
        if line.lstrip().startswith("#"):
            continue
        if not inline:
            key = _FROM_ELSEWHERE.search(line)
            if key or _HIDDEN_KEY.search(line):            # (YAML that could hide a key from these checks: refused too)
                raise NearError(UNKNOWN_PROGRAM.format(key.group(1) + ":" if key else "a hidden key"))
            b = _BLOCK.match(line)
            if b:
                d = int(b.group(2) or b.group(3) or 0)
                block = (len(b.group(1)), len(b.group(1)) + d if d else 0)
        if not _IMAGE_KEY.search(line):                    # (image lines are checked everywhere, inline text too)
            continue
        hit = _IMAGE_LINE.match(line)                          # anything but a plain `image: <ref>` line is refused
        ref = hit.group(1) if hit else ""
        if len(ref) > 1 and ref[0] == ref[-1] and ref[0] in "\"'":
            ref = ref[1:-1]
        var = _DEFAULT.match(ref)
        if var:
            ref = var.group(2) if var.group(1) not in allowed else ""
        pinned = _REF.match(ref)
        if not pinned or pinned.group(1) not in MODEL_IMAGE_REPOS:
            name = (pinned.group(1) if pinned else ref.split("@")[0].split(":")[0]) or "image"
            raise NearError(UNKNOWN_PROGRAM.format(re.sub(r"[^A-Za-z0-9._/${}:-]", "", name)[:60]))
        out.append(ref)
    if not out:
        raise NearError(UNKNOWN_PROGRAM.format("no images"))
    return out

def _header(headers, name):
    for k, v in (headers or {}).items():
        if k.lower() == name.lower():
            v = v[0] if isinstance(v, list) and v else v
            return urllib.parse.unquote(v) if isinstance(v, str) else None
    return None

def _members(text):
    """Top-level members of a JSON object as {key: (start, end)} offsets into text (Intel signs the exact bytes)."""
    dec, out, i = json.JSONDecoder(), {}, 0
    ws = re.compile(r"\s*")
    i = ws.match(text, i).end()
    if text[i:i + 1] != "{":
        raise ValueError("not an object")
    i = ws.match(text, i + 1).end()
    while text[i:i + 1] != "}":
        k, i = dec.raw_decode(text, i)
        i = ws.match(text, i).end()
        if not isinstance(k, str) or text[i:i + 1] != ":":
            raise ValueError("bad member")
        i = ws.match(text, i + 1).end()
        _, end = dec.raw_decode(text, i)
        out[k] = (i, end)
        i = ws.match(text, end).end()
        if text[i:i + 1] == ",":
            i = ws.match(text, i + 1).end()
        elif text[i:i + 1] != "}":
            raise ValueError("bad object")
    return out

def _signed_part(body, member):
    text = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body
    spans, whole = _members(text), json.loads(text)
    a, b = spans[member]
    sig = whole.get("signature")
    if not isinstance(sig, str):
        raise ValueError("no signature")
    return text[a:b], bytes.fromhex(sig), json.loads(text[a:b])

def collateral_from_pcs(tcb: tuple, qe: tuple, pck_crl: tuple, root_crl: bytes):
    """Intel's PCS answers -> dcap_qvl.QuoteCollateralV3. Each tuple is (headers, body). Raises ValueError."""
    tcb_raw, tcb_sig, _ = _signed_part(tcb[1], "tcbInfo")
    qe_raw, qe_sig, _ = _signed_part(qe[1], "enclaveIdentity")
    chains = (_header(tcb[0], "TCB-Info-Issuer-Chain") or _header(tcb[0], "SGX-TCB-Info-Issuer-Chain"),
              _header(qe[0], "SGX-Enclave-Identity-Issuer-Chain"), _header(pck_crl[0], "SGX-PCK-CRL-Issuer-Chain"))
    if not all(chains) or not isinstance(pck_crl[1], (bytes, bytearray)) or not isinstance(root_crl, (bytes, bytearray)):
        raise ValueError("incomplete collateral")
    return _dcap().QuoteCollateralV3(
        pck_crl_issuer_chain=chains[2], root_ca_crl=bytes(root_crl), pck_crl=bytes(pck_crl[1]),
        tcb_info_issuer_chain=chains[0], tcb_info=tcb_raw, tcb_info_signature=tcb_sig,
        qe_identity_issuer_chain=chains[1], qe_identity=qe_raw, qe_identity_signature=qe_sig)

def _next_update(tcb_body, qe_body):
    """The earliest nextUpdate of Intel's TCB info and QE identity (unix time), or None."""
    try:
        times = [_signed_part(tcb_body, "tcbInfo")[2]["nextUpdate"], _signed_part(qe_body, "enclaveIdentity")[2]["nextUpdate"]]
        return min(calendar.timegm(time.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")) for t in times)
    except Exception:
        return None

def _b64url(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def check_gpu(payload_text: str, nonce_hex: str, nras_body: bytes, jwks: dict, now: int) -> dict:
    """NVIDIA's verdict on the GPU evidence: an ES384 JWT from NRAS, signed by a key in NRAS's key set, saying the
    overall result is true for this nonce, and current. -> {"gpus", "arch"}. Raises NearError (_UnknownKid when the
    signing key isn't in jwks)."""
    C = _crypto()
    try:
        payload = json.loads(payload_text)
        ev = payload.get("evidence_list")
        if not isinstance(payload.get("nonce"), str) or payload["nonce"].lower() != nonce_hex or not isinstance(ev, list) or not ev:
            raise ValueError("evidence isn't for this nonce")
        first = json.loads(nras_body)[0]
        if not (isinstance(first, list) and len(first) == 2 and first[0] == "JWT" and isinstance(first[1], str)):
            raise ValueError("no overall token")
        h64, p64, s64 = first[1].split(".")
        head, claims, sig = json.loads(_b64url(h64)), json.loads(_b64url(p64)), _b64url(s64)
        if head.get("alg") != "ES384" or len(sig) != 96:
            raise ValueError("not ES384")
        jwk = next((k for k in (jwks or {}).get("keys") or [] if isinstance(k, dict) and k.get("kid") == head.get("kid")), None)
        if jwk is None:
            raise _UnknownKid()
        x, y = _b64url(jwk.get("x") or ""), _b64url(jwk.get("y") or "")
        if jwk.get("kty") != "EC" or jwk.get("crv") != "P-384" or len(x) != 48 or len(y) != 48:
            raise ValueError("bad key")
        pub = C.ec.EllipticCurvePublicKey.from_encoded_point(C.ec.SECP384R1(), b"\x04" + x + y)
        der = C.utils.encode_dss_signature(int.from_bytes(sig[:48], "big"), int.from_bytes(sig[48:], "big"))
        pub.verify(der, (h64 + "." + p64).encode(), C.ec.ECDSA(C.hashes.SHA384()))
        if (claims.get("iss") != NRAS or claims.get("x-nvidia-overall-att-result") is not True
                or not isinstance(claims.get("eat_nonce"), str) or claims["eat_nonce"].lower() != nonce_hex
                or not isinstance(claims.get("nbf"), (int, float)) or claims["nbf"] > now + 60
                or not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - 60):
            raise ValueError("claims")
        return {"gpus": len(ev), "arch": payload.get("arch") if isinstance(payload.get("arch"), str) else None}
    except NearError:
        raise
    except Exception:
        raise NearError(GPU_FAIL) from None

def _check_td(rep, role, nonce, now, fetch, tcb_ok, obs, checks):
    """Intel's verdict on one TDX quote and everything bound to it. Fills obs with what was seen (public values)."""
    dcap = _dcap()
    quote = _unhex(rep.get("intel_quote"), cap=65536)
    try:
        pq = dcap.Quote.parse(quote)
        fmspc, ca, tdx = pq.fmspc(), pq.ca(), pq.is_tdx()
    except Exception:
        raise NearError(INTEL_FAILED.format(role)) from None
    if not tdx or not re.fullmatch(r"[0-9A-Fa-f]{12}", str(fmspc)) or ca not in ("platform", "processor"):
        raise NearError(INTEL_FAILED.format(role))
    v = None
    for fresh in (False, True):            # Intel's collateral may have been renewed since it was cached: once more
        try:
            col = fetch.collateral(fmspc, ca, fresh=fresh)
            v = dcap.verify(quote, col, int(now))
            break
        except NearError:
            raise
        except BaseException as e:         # (a Rust panic arrives as a BaseException)
            if isinstance(e, (KeyboardInterrupt, SystemExit)):
                raise
    if v is None:
        raise NearError(INTEL_FAILED.format(role))
    obs["tcb"], obs["advisories"] = str(v.status), [str(a) for a in v.advisory_ids]
    if v.status not in tcb_ok:
        raise NearError(UPDATES.format(role, v.status))
    checks.append(f"{role}: Intel verified its TDX quote ({v.status})")
    try:
        body = json.loads(v.to_json())["report"]
        td = body["TD10"] if "TD10" in body else body["TD15"]["base"]
        regs = {k: bytes.fromhex(td[k]) for k in ("td_attributes", "report_data", "mr_seam", "mr_td", "mr_config_id",
                                                   "rt_mr0", "rt_mr1", "rt_mr2", "rt_mr3")}
    except Exception:
        raise NearError(INTEL_FAILED.format(role)) from None
    obs.update(mrseam=regs["mr_seam"].hex(), mrtd=regs["mr_td"].hex(), rtmr=[regs[f"rt_mr{i}"].hex() for i in range(3)],
               rtmr3=regs["rt_mr3"].hex())
    if regs["td_attributes"][0] & 1:
        raise NearError(DEBUG.format(role))
    if not hmac.compare_digest(regs["report_data"][32:64], bytes.fromhex(nonce)):
        raise NearError(NOT_FRESH)
    checks.append(f"{role}: production mode; its quote carries Buddy's fresh nonce")
    info = rep.get("info")
    tcb_info = _maybe_json(info.get("tcb_info")) if isinstance(info, dict) else None
    compose = tcb_info.get("app_compose") if isinstance(tcb_info, dict) else None
    if not isinstance(compose, str):
        raise NearError(MALFORMED)
    digest = hashlib.sha256(compose.encode()).digest()
    obs["compose"] = digest.hex()
    try:
        rtmr3, events = replay_rtmr3(rep.get("event_log"))
    except (ValueError, TypeError):
        raise NearError(MALFORMED) from None
    hashes_seen = [e.get("event_payload", "") for e in events if e.get("event") == "compose-hash"]
    if (not hmac.compare_digest(rtmr3, regs["rt_mr3"]) or regs["mr_config_id"] != b"\x01" + digest + bytes(15)
            or not hashes_seen or any(str(h).lower() != digest.hex() for h in hashes_seen)):
        raise NearError(MALFORMED)
    checks.append(f"{role}: event log replays to RTMR3; its configuration (compose {digest.hex()[:12]}…) is the measured one")
    for reg, key, allowed in (("MRSEAM", "mr_seam", MRSEAM_OK), ("MRTD", "mr_td", MRTD_OK)):
        if regs[key].hex() not in allowed:
            raise NearError(UNKNOWN_SW.format(role, reg, regs[key].hex()[:16]))
    obs["os"] = MRTD_OK[regs["mr_td"].hex()]
    checks.append(f"{role}: known {MRSEAM_OK[regs['mr_seam'].hex()]} and {obs['os']} firmware")
    return regs

def _check_identity(rep, regs, role):
    """REPORTDATA[0:32] binds the signing key (and the TLS key when given): sha256(key ‖ tls) or the key itself."""
    if rep.get("signing_algo") != "ed25519":
        raise NearError(MALFORMED)
    ident = _unhex(rep.get("signing_address"), size=32)
    fp = rep.get("tls_cert_fingerprint")
    want = hashlib.sha256(ident + _unhex(fp, size=32)).digest() if fp else ident
    if not hmac.compare_digest(regs["report_data"][:32], want):
        raise NearError(MALFORMED)
    return ident

def _check_server(rep, nonce, now, fetch, obs, checks):
    regs = _check_td(rep, SERVER, nonce, now, fetch, TCB_OK_MODEL, obs, checks)
    if not isinstance(rep.get("signing_public_key"), str) or not isinstance(rep.get("signing_address"), str):
        raise NearError(MALFORMED)
    key = _unhex(rep["signing_public_key"], size=32)
    if key != _unhex(rep["signing_address"], size=32):
        raise NearError(MALFORMED)
    try:
        ed25519_pub_to_x25519(key)
    except ValueError:
        raise NearError(MALFORMED) from None
    _check_identity(rep, regs, SERVER)
    obs["key"] = key.hex()
    checks.append(f"{SERVER}: its encryption key {key.hex()[:16]}… is bound into its quote")
    for reg, k, allowed in (("RTMR1", "rt_mr1", RTMR1_OK), ("RTMR2", "rt_mr2", RTMR2_OK)):
        if regs[k].hex() not in allowed:
            raise NearError(UNKNOWN_SW.format(SERVER, reg, regs[k].hex()[:16]))
    checks.append(f"{SERVER}: known kernel and boot configuration (RTMR1, RTMR2)")
    tcb_info = _maybe_json(rep["info"]["tcb_info"])
    obs["images"] = compose_images(tcb_info["app_compose"])
    checks.append(f"{SERVER}: every program is a known one, pinned by digest ({len(obs['images'])} images)")
    return key

def _gpu(rep, nonce, now, fetch):
    text = rep.get("nvidia_payload")
    if not isinstance(text, str) or not text or len(text) > CHECKER_CAP:
        raise NearError(GPU_FAIL)
    try:                                    # the evidence must be for Buddy's nonce before it goes to NVIDIA
        p = json.loads(text)
        if not isinstance(p, dict) or not isinstance(p.get("nonce"), str) or p["nonce"].lower() != nonce:
            raise ValueError
    except ValueError:
        raise NearError(GPU_FAIL) from None
    body = fetch.nras(text)
    try:
        return check_gpu(text, nonce, body, fetch.jwks(), now)
    except _UnknownKid:
        return check_gpu(text, nonce, body, fetch.jwks(refresh=True), now)

def verify_evidence(report: dict, nonce_hex: str, peer_spki_sha256: str | None, now: int, fetch, model: str = MODEL,
                    seen: dict | None = None) -> dict:
    """Every check on NEAR's attestation answer (all required). -> {"model_key": 32 bytes, "gateway": {…}, "server": {…},
    "checks": [...]}, or raises NearError (_TlsMismatch when only the gateway's TLS key differs from this connection's).
    fetch supplies Intel's and NVIDIA's answers (.collateral(fmspc, ca, fresh=False), .nras(text), .jwks(refresh=False));
    production always passes _NET. seen (optional) collects the public values observed, also when a check fails."""
    seen = {} if seen is None else seen
    checks = seen.setdefault("checks", [])
    nonce = str(nonce_hex).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", nonce):
        raise NearError(NOT_FRESH)
    # (a) cheap checks first
    if not isinstance(report, dict):
        raise NearError(MALFORMED)
    gw, models = report.get("gateway_attestation"), report.get("model_attestations")
    if (not isinstance(gw, dict) or not isinstance(models, list) or not models or len(models) > 16
            or not all(isinstance(m, dict) for m in models)):
        raise NearError(MALFORMED)
    for rep in [gw] + models:
        if not isinstance(rep.get("request_nonce"), str):
            raise NearError(MALFORMED)
        if rep["request_nonce"].lower() != nonce:
            raise NearError(NOT_FRESH)
    if any(m.get("model_name") != model for m in models):
        raise NearError(OTHER_MODEL)
    fp = gw.get("tls_cert_fingerprint")
    if not isinstance(fp, str) or not peer_spki_sha256 or not hmac.compare_digest(fp.lower(), str(peer_spki_sha256).lower()):
        raise _TlsMismatch()
    checks.append(f"NEAR answered for {model} with Buddy's fresh nonce")
    # (b) each report
    g = seen["gateway"] = {}
    regs = _check_td(gw, GATEWAY, nonce, now, fetch, TCB_OK_GATEWAY, g, checks)
    _check_identity(gw, regs, GATEWAY)
    checks.append(f"{GATEWAY}: its TLS key ({fp[:16]}…) is the one this connection uses")
    servers, keys = [], []
    for i, rep in enumerate(models):              # (every candidate is checked; the first one's details are shown)
        servers.append({})
        if i == 0:
            seen["server"] = servers[0]
        keys.append(_check_server(rep, nonce, now, fetch, servers[i], checks if i == 0 else []))
    if any(k != keys[0] for k in keys):
        raise NearError(DISAGREE)
    # (c) GPUs last
    for rep, s in zip(models, servers):
        got = _gpu(rep, nonce, now, fetch)
        s["gpus"], s["gpu_arch"] = got["gpus"], got["arch"]
    gpus = " ".join(str(x) for x in (servers[0]["gpus"], servers[0]["gpu_arch"]) if x)
    checks.append(f"{SERVER}: NVIDIA verified its GPUs ({gpus}) for this nonce")
    server = dict(servers[0], candidates=len(models))
    return {"model_key": keys[0], "gateway": dict(g), "server": server, "checks": list(checks)}


# ---- Network ----
def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):     # never follow a redirect anywhere else
        return None

_opener = []

def _https(method, url, body=None, headers=None, cap=CHECKER_CAP):
    """One HTTPS request to Intel or NVIDIA (only those hosts; never through a proxy; never redirected).
    -> (headers, body). Raises NearError(CHECKERS_DOWN); HTTPError passes through for the caller to judge."""
    u = urllib.parse.urlparse(url)
    if u.scheme != "https" or u.hostname not in CHECKERS:
        raise NearError(CHECKERS_DOWN)
    with _lock:
        if not _opener:
            _opener.append(urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect(),
                                                       urllib.request.HTTPSHandler(context=_ssl_context())))
    req = urllib.request.Request(url, data=body, method=method, headers=dict(headers or {}, **{"Accept-Encoding": "identity"}))
    try:
        with _opener[0].open(req, timeout=CHECKER_TIMEOUT) as r:
            data = r.read(cap + 1)
            if len(data) > cap:
                raise NearError(CHECKERS_DOWN)
            return {k: v for k, v in r.headers.items()}, data
    except urllib.error.HTTPError:
        raise
    except NearError:
        raise
    except (OSError, http.client.HTTPException, ValueError):
        raise NearError(CHECKERS_DOWN) from None

class _Net:
    """Intel's and NVIDIA's answers, fetched for real and cached in memory (Intel's until its nextUpdate, at most 24 h;
    NVIDIA's signing keys 12 h). The GPU verdict is never cached: it's for this nonce."""
    def __init__(self):
        self._col, self._jwks = {}, None

    def collateral(self, fmspc, ca, fresh=False):
        k = (str(fmspc).lower(), str(ca))
        if not re.fullmatch(r"[0-9a-f]{12}", k[0]) or k[1] not in ("platform", "processor"):
            raise ValueError("bad fmspc")
        with _lock:
            hit = self._col.get(k)
            if hit and not fresh and time.time() < hit[0]:
                return hit[1]
        try:
            tcb = _https("GET", f"{PCS}/tdx/certification/v4/tcb?fmspc={k[0]}")
            qe = _https("GET", f"{PCS}/tdx/certification/v4/qe/identity")
            crl = _https("GET", f"{PCS}/sgx/certification/v4/pckcrl?ca={k[1]}&encoding=der")
            root = _https("GET", ROOT_CRL)
        except urllib.error.HTTPError:
            raise NearError(CHECKERS_DOWN) from None
        col = collateral_from_pcs(tcb, qe, crl, root[1])
        nxt = _next_update(tcb[1], qe[1])
        with _lock:
            self._col[k] = (min(time.time() + 86400, nxt if nxt else time.time() + 3600), col)
        return col

    def nras(self, payload_text):
        try:
            return _https("POST", f"{NRAS}/v3/attest/gpu", payload_text.encode(),
                          {"Content-Type": "application/json", "Accept": "application/json"})[1]
        except urllib.error.HTTPError as e:
            raise NearError(GPU_FAIL if 400 <= e.code < 500 else CHECKERS_DOWN) from None

    def jwks(self, refresh=False):
        with _lock:
            if self._jwks and not refresh and time.time() < self._jwks[0]:
                return self._jwks[1]
        try:
            keys = json.loads(_https("GET", f"{NRAS}/.well-known/jwks.json", headers={"Accept": "application/json"})[1])
        except (urllib.error.HTTPError, ValueError):
            raise NearError(CHECKERS_DOWN) from None
        if not isinstance(keys, dict) or not isinstance(keys.get("keys"), list):
            raise NearError(CHECKERS_DOWN)
        with _lock:
            self._jwks = (time.time() + 12 * 3600, keys)
        return keys

_NET = _Net()

def _spki_sha256(cert_der):
    C = _crypto()
    cert = C.x509.load_der_x509_certificate(cert_der)
    return hashlib.sha256(cert.public_key().public_bytes(C.ser.Encoding.DER, C.ser.PublicFormat.SubjectPublicKeyInfo)).hexdigest()

class _OneConnection(http.client.HTTPSConnection):
    """http.client quietly reconnects when a server closes a kept-alive connection; this one refuses to, because the
    checks hold only for the connection they were made on."""
    _opened = False

    def connect(self):
        if self._opened:
            raise NearError(CLOSED)
        self._opened = True
        super().connect()

class _PinnedHTTPS:
    """One TLS connection to NEAR (WebPKI, never a proxy) that remembers the server's key: spki_sha256 = sha256 of its
    certificate's SubjectPublicKeyInfo. request() never reconnects."""
    def __init__(self, host=HOST, port=443, context=None):
        self.spki_sha256 = None
        self._c = _OneConnection(host, port, timeout=CONNECT_TIMEOUT, context=context or _ssl_context())
        try:
            self._c.connect()
            self.spki_sha256 = _spki_sha256(self._c.sock.getpeercert(binary_form=True))
        except NearError:
            self.close(); raise
        except ssl.SSLCertVerificationError:
            self.close(); raise NearError(CERT) from None
        except socket.timeout:
            self.close(); raise NearError(OFFLINE) from None
        except (OSError, ValueError, TypeError):
            self.close(); raise NearError(OFFLINE) from None

    def request(self, method, path, body=None, headers=None):
        c = self._c
        if c.sock is None:
            raise NearError(CLOSED)
        gen = path.startswith("/v1/images/")
        cap = IMAGE_CAP if gen else REPORT_CAP
        try:
            c.sock.settimeout(GEN_TIMEOUT if gen else REPORT_TIMEOUT)
            c.request(method, path, body=body, headers=dict(headers or {}))
            r = c.getresponse()
            data = r.read(cap + 1)
            status, hdrs = r.status, {k.lower(): v for k, v in r.getheaders()}
        except NearError:
            self.close(); raise
        except socket.timeout:
            self.close(); raise NearError(SLOW) from None
        except (OSError, http.client.HTTPException, ValueError):
            self.close(); raise NearError(CLOSED) from None
        if len(data) > cap:
            self.close(); raise NearError(TOO_BIG)
        return status, hdrs, data

    def close(self):
        try:
            self._c.close()
        except Exception:
            pass


# ---- One picture ----
def _http_reason(code):
    if code in (401, 403):
        return BAD_KEY
    return {402: NO_CREDIT, 404: NO_MODEL, 421: KEY_CHANGED, 429: BUSY}.get(code, f"NEAR had a problem (HTTP {int(code)})")

def _key_ok(key):
    return isinstance(key, str) and 16 <= len(key) <= 400 and key.isascii() and all(ch.isprintable() and not ch.isspace() for ch in key)

def _report(conn, key, nonce, model=MODEL):
    q = urllib.parse.urlencode({"model": model, "provider": "near", "signing_algo": "ed25519",
                                "include_tls_fingerprint": "true", "nonce": nonce})
    status, _, body = conn.request("GET", "/v1/attestation/report?" + q, None, {
        "Authorization": "Bearer " + key, "Accept": "application/json", "Accept-Encoding": "identity", "x-no-aliasing": "true"})
    if status != 200:
        raise NearError(_http_reason(status))
    try:
        return json.loads(body)
    except ValueError:
        raise NearError(MALFORMED) from None

def _verified(key, connect, fetch, seen):
    """A new connection whose gateway and picture server passed every check, and that verification (up to 3
    connections when the gateway's TLS key doesn't match its attestation). The caller closes the connection."""
    for attempt in range(3):
        conn = connect(HOST)
        try:
            nonce = secrets.token_hex(32)
            v = verify_evidence(_report(conn, key, nonce), nonce, conn.spki_sha256, int(time.time()), fetch, seen=seen)
            return conn, v
        except _TlsMismatch:
            conn.close()
            seen["checks"] = []
            if attempt == 2:
                raise NearError(TLS) from None
        except BaseException:
            conn.close()
            raise

def _picture(data):
    """Image bytes -> (bytes, mime): PNG, JPEG or WebP as they came (never written anywhere: a private chat's picture
    stays in memory); anything else is refused."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return data, "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return data, "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return data, "image/webp"
    raise NearError(CANT_OPEN)

def _send_sealed(conn, key: str, model_key: bytes, prompt: str, width: int, height: int, model: str = MODEL) -> tuple[bytes, str]:
    """The prompt, sealed to the verified model key, on the checked connection; the picture must come back sealed to
    this request's one-time key. -> (bytes, mime). Raises NearError."""
    C = _crypto()
    sizes = [f"{int(width)}x{int(height)}"] + ([] if (int(width), int(height)) == (1024, 1024) else ["1024x1024"])
    for i, size in enumerate(sizes):
        me = C.Ed25519PrivateKey.generate()             # a new key for every request
        seed = me.private_bytes(C.ser.Encoding.Raw, C.ser.PrivateFormat.Raw, C.ser.NoEncryption())
        mine = seed_to_x25519_private(seed)
        body = json.dumps({"model": model, "prompt": seal(prompt.encode(), model_key).hex(), "n": 1, "size": size,
                           "response_format": "b64_json"}).encode()
        status, _, data = conn.request("POST", "/v1/images/generations", body, {
            "Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept-Encoding": "identity",
            "x-no-aliasing": "true", "X-Signing-Algo": "ed25519", "X-Client-Pub-Key": _raw_pub(me).hex(),
            "X-Model-Pub-Key": bytes(model_key).hex(), "X-Encryption-Version": "2", "X-Encrypt-All-Fields": "true"})
        if status == 400 and i + 1 < len(sizes) and b"size" in data.lower():
            continue                                        # (a new sealed copy, same connection)
        if status != 200:
            raise NearError(_http_reason(status))
        try:
            item = json.loads(data)["data"][0]
            sealed = item["b64_json"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise NearError(NOT_SEALED) from None
        if not isinstance(sealed, str) or len(sealed) < 144 or len(sealed) % 2 or not re.fullmatch(r"[0-9a-fA-F]+", sealed):
            raise NearError(NOT_SEALED)
        try:
            b64 = open_sealed(bytes.fromhex(sealed), mine)
        except ValueError:
            raise NearError(NOT_SEALED) from None
        try:
            pic = base64.b64decode(b64.strip(), validate=True)
        except ValueError:
            raise NearError(CANT_OPEN) from None
        return _picture(pic)
    raise NearError(_http_reason(400))

def _generate(prompt, width, height, key, connect, fetch, on_verified=None) -> tuple[bytes, str]:
    ok, why = ready()
    if not ok:
        raise NearError(why)
    key = key.strip() if isinstance(key, str) else ""
    if not key:
        raise NearError(NEED_KEY)
    if not _key_ok(key):
        raise NearError(BAD_KEY)
    try:
        w, h = int(width), int(height)
    except (TypeError, ValueError):
        raise NearError(BAD_REQUEST) from None
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000 or not (64 <= w <= 2048 and 64 <= h <= 2048):
        raise NearError(BAD_REQUEST)
    seen = {}
    try:
        conn, v = _verified(key, connect, fetch, seen)
    except NearError as e:
        if on_verified:
            on_verified(_result(False, str(e), seen=seen))
        raise
    if on_verified:
        on_verified(_result(True, "", gateway=v["gateway"], server=v["server"], checks=v["checks"]))
    try:
        return _send_sealed(conn, key, v["model_key"], prompt, w, h)
    finally:
        conn.close()

def generate(prompt: str, width: int, height: int, key: str) -> tuple[bytes, str]:
    """One picture: a fresh, complete verification on a new TLS connection, then the prompt end-to-end encrypted to the
    verified model key on that same connection. -> (image bytes, "image/png"|"image/jpeg"). Raises NearError (fail
    closed). Thread-safe. Blocks up to about 150 s."""
    kid = _kid(key)
    try:
        return _generate(prompt, width, height, key, _PinnedHTTPS, _NET, on_verified=lambda res: _remember(kid, res))
    except NearError:
        raise
    except Exception:
        raise NearError(UNEXPECTED) from None


# ---- Status (Settings, images.find) ----
_state = {"kid": None, "res": None, "busy": None}
_check_lock = threading.Lock()          # one full check at a time

def _kid(key):
    return hashlib.sha256(b"buddy-near-status:" + str(key or "").strip().encode()).hexdigest()

def _result(ok, reason, gateway=None, server=None, checks=None, seen=None, checking=False):
    r = {"ok": bool(ok), "reason": "" if ok else reason, "checked": 0.0 if checking else time.time(), "model": MODEL,
         "gateway": gateway if ok else None, "server": server if ok else None, "checks": list(checks or [])}
    if checking:
        r["checking"] = True
    if not ok and seen:          # what was observed before the failed check (public values, for near.py --check)
        r["seen"] = {k: seen[k] for k in ("gateway", "server") if seen.get(k)}
        r["checks"] = list(seen.get("checks") or [])
    return r

def _remember(kid, res):
    with _lock:
        _state.update(kid=kid, res=res)

def _fresh_enough(res):
    return res and time.time() - res["checked"] < (OK_TTL if res["ok"] else FAIL_TTL)

def _check(key):
    seen = {}
    try:
        conn, v = _verified(key, _PinnedHTTPS, _NET, seen)
        conn.close()
        return _result(True, "", gateway=v["gateway"], server=v["server"], checks=v["checks"])
    except NearError as e:
        return _result(False, str(e), seen=seen)
    except Exception:
        return _result(False, CHECK_FAILED, seen=seen)

def _run(key, kid, fresh):
    with _check_lock:
        with _lock:
            res = _state["res"] if _state["kid"] == kid else None
        if not fresh and _fresh_enough(res):
            return res                       # someone else just checked
        res = _check(key)
        _remember(kid, res)
        return res

def _background(key, kid):
    try:
        _run(key, kid, False)
    finally:
        with _lock:
            if _state["busy"] == kid:
                _state["busy"] = None

def status(key: str, fresh: bool = False, wait: bool = True) -> dict:
    """A full verification of NEAR's gateway and FLUX server, without making a picture or sending anything private.
    Cached (ok 15 min, failed 2 min). wait=False never blocks: the cached result (or "checking NEAR…" with
    checking=True), and a background check when it's stale. Never raises.
    -> {"ok", "reason", "checked", "model", "gateway": {tcb, mrtd, compose, …} | None,
        "server": {tcb, os, mrseam, mrtd, rtmr, compose, images, gpus, gpu_arch, key, candidates, …} | None, "checks"}"""
    try:
        key = key.strip() if isinstance(key, str) else ""
        if not key:
            return _result(False, NEED_KEY)
        ok, why = ready()
        if not ok:
            return _result(False, why)
        if not _key_ok(key):
            return _result(False, BAD_KEY)
        kid = _kid(key)
        with _lock:
            res = _state["res"] if _state["kid"] == kid else None
            if not fresh and _fresh_enough(res):
                return dict(res)
            if not wait:
                if _state["busy"] != kid:
                    _state["busy"] = kid
                    threading.Thread(target=_background, args=(key, kid), daemon=True, name="near-check").start()
                return dict(res, checking=True) if res else _result(False, CHECKING, checking=True)
        return dict(_run(key, kid, fresh))
    except Exception:
        return _result(False, CHECK_FAILED)

def forget() -> None:
    """Drops the cached status (the key changed or was removed). Intel's and NVIDIA's public answers stay cached."""
    with _lock:
        _state.update(kid=None, res=None)


# ---- For the owner: .venv/bin/python near.py --check [--json] ----
def _cli(argv):
    if "--check" not in argv:
        print(__doc__.strip())
        return 2
    try:
        with open(os.path.join(HERE, ".near_key")) as f:
            key = f.read().strip()
    except OSError:
        key = ""
    res = status(key, fresh=True)
    if "--json" in argv:
        print(json.dumps(res, indent=1, sort_keys=True))
        return 0 if res["ok"] else 1
    print(f"NEAR AI picture check: {MODEL} at {HOST}")
    for c in res.get("checks") or []:
        print("  ✓ " + c)
    print(("  ✓ all checks passed: pictures can be made" if res["ok"] else "  ✗ " + res["reason"]))
    found = {"gateway": res.get("gateway"), "server": res.get("server")} if res["ok"] else (res.get("seen") or {})
    for role, label in (("gateway", "Gateway"), ("server", "Picture server")):
        o = found.get(role)
        if not o:
            continue
        print(f"\n{label}:")
        if o.get("tcb"):
            print(f"  Intel TCB status  {o['tcb']}" + (f"  (advisories: {', '.join(o['advisories'])})" if o.get("advisories") else ""))
        for k, name in (("os", "OS"), ("mrseam", "MRSEAM"), ("mrtd", "MRTD")):
            if o.get(k):
                print(f"  {name:<17} {o[k]}")
        for i, r in enumerate((o.get("rtmr") or []) + ([o["rtmr3"]] if o.get("rtmr3") else [])):
            print(f"  RTMR{i:<13} {r}")
        if o.get("compose"):
            print(f"  compose sha256    {o['compose']}")
        for img in o.get("images") or []:
            print(f"  image             {img}")
        if o.get("key"):
            print(f"  encryption key    {o['key']}")
        if o.get("gpus"):
            print(f"  GPUs              {o['gpus']} {o.get('gpu_arch') or ''}".rstrip())
        if o.get("candidates"):
            print(f"  servers checked   {o['candidates']}")
    return 0 if res["ok"] else 1

if __name__ == "__main__":
    os.umask(0o077)
    sys.exit(_cli(sys.argv[1:]))
