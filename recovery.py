"""Recovery keys (SPEC3 §7.1), split out of backup.py: 256 random bits as people see them, Crockford base32 of the key
and a 24-bit typo check, 56 characters in 14 groups of 4. The check is SHA-256(tag + key)[:3], and each kind of key has
its own tag, so a key typed where the other kind is expected is recognised and named instead of being called a typo:
  BACKUP  b"buddy recovery key"  backup.py's (unchanged: every backup key made so far still parses)
  SYNC    b"buddy sync key"      Buddy for phones' sync key (a separate key: a phone with it can't open Mac backups)
Pure and stdlib only (no files, no network); the phone-only site's bcrypto.js ports it, checked against the same
vectors (tests/recovery_vectors.json). Keys made in tests only; never print a real one."""
import hashlib, hmac, re

B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"                 # Crockford base32: no I, L, O, U
BACKUP = b"buddy recovery key"
SYNC = b"buddy sync key"
NAMES = {BACKUP: "backup", SYNC: "sync"}
INCOMPLETE = "That recovery key isn't complete: it has 14 groups of 4 letters and numbers."
TYPO = "That recovery key has a typo somewhere. Check each group."
NOT_SYNC = "That's a backup recovery key, not a sync key."       # (a backup key typed where the sync key goes)
NOT_BACKUP = "That's a sync recovery key, not a backup key."     # (a sync key typed into the Mac's backup restore)
OTHER = {SYNC: NOT_SYNC, BACKUP: NOT_BACKUP}                      # expected tag -> the words when it's the other kind

class OtherKind(ValueError):
    """A whole, valid recovery key of the other kind (its name in .found: "backup" or "sync")."""
    def __init__(self, msg, found):
        super().__init__(msg); self.found = found

def _tag(tag):
    if tag not in NAMES: raise ValueError("unknown recovery key tag")
    return tag

def hkdf(ikm, info, n=32):
    """HKDF-SHA256 (RFC 5869), salt = 32 zero bytes."""
    prk = hmac.new(bytes(32), ikm, hashlib.sha256).digest(); out, t, i = b"", b"", 1
    while len(out) < n:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest(); out += t; i += 1
    return out[:n]

def _check(K, tag):
    return hashlib.sha256(tag + K).digest()[:3]

def key_text(K, tag):
    """The recovery key as people see it: 256 bits + a 24-bit typo check under tag, Crockford base32, 14 groups of 4."""
    if not isinstance(K, (bytes, bytearray)) or len(K) != 32: raise ValueError("a recovery key is 32 bytes")
    K = bytes(K)
    n = int.from_bytes(K + _check(K, _tag(tag)), "big")
    s = "".join(B32[(n >> (5 * i)) & 31] for i in range(55, -1, -1))
    return "-".join(s[i:i + 4] for i in range(0, 56, 4))

def norm(text):
    """As typed -> the 56 characters: spaces, dashes and dots dropped, O/I/L read as 0/1/1."""
    return re.sub(r"[\s\-.]", "", str(text or "")).upper().translate(str.maketrans("OIL", "011"))

def parse_key(text, tag):
    """Typed text -> the 32-byte key whose check matches tag. ValueError(INCOMPLETE) when it isn't 56 valid characters,
    OtherKind (NOT_SYNC / NOT_BACKUP) when it's a whole key of the other kind, else ValueError(TYPO)."""
    _tag(tag)
    s = norm(text)
    if len(s) != 56 or any(c not in B32 for c in s):
        raise ValueError(INCOMPLETE)
    n = 0
    for c in s:
        n = n * 32 + B32.index(c)
    b = n.to_bytes(35, "big")
    K, chk = b[:32], b[32:]
    if hmac.compare_digest(chk, _check(K, tag)):
        return K
    for other in NAMES:
        if other != tag and hmac.compare_digest(chk, _check(K, other)):
            raise OtherKind(OTHER[tag], NAMES[other])
    raise ValueError(TYPO)
