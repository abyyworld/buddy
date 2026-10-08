"""Pictures from your characters (selfies, what they're up to, profile pictures), made privately.
Only three places are ever used, in this order: an image model in Tinfoil's enclave (via the local Tinfoil Proxy),
an image model in Phala's TEE (is_tee only), or an image app on this Mac with an A1111-style API (e.g. Draw Things'
HTTP server, Automatic1111, Forge on 127.0.0.1:7860). Pictures are stored in .media/ (git-ignored, only you can read it)."""
import base64, json, os, re, threading, time, urllib.error, urllib.request, uuid
import localcheck, tinfoilproxy

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, ".media")
PHALA = "https://inference.phala.com/v1"
LOCAL = "http://127.0.0.1:7860"
IMAGE_HINT = re.compile(r"flux|sdxl|stable-diffusion|diffusion|qwen-image|z-image|hidream|imagen|image-gen|gpt-image", re.I)
ADULT = "an adult (25 to 35 years old), "
NEGATIVE = "child, teen, minor, young-looking, deformed, extra fingers, text, watermark"
# Anything that describes someone under 18 is refused before an image is ever made (hard rule; not up to the model).
MINOR = re.compile(r"\b(child(ren)?|kids?|toddlers?|teen(age[rd]?|s)?|minors?|under ?age|school ?(girl|boy|uniform)s?|high ?school|"
                   r"little (girl|boy)|young (girl|boy)|as a (kid|child|teen(ager)?)|when i was (little|young|a kid|\d+)|"
                   r"(1[0-7]|[1-9]) ?(yo|y/o|years? ?old)|aged? (1[0-7]|[1-9])\b|at (1[0-7]|[1-9])\b(?! ?(am|pm|o'?clock|:|h\b))|"
                   r"preteen|loli(ta)?|shota|child-?like|kid-?like|baby ?faced?|chibi|jailbait|barely legal|"
                   r"sailor (uniform|outfit|suit|fuku)|young-looking|looks? (very |so )?young|"
                   r"looks? like a (kid|child|teen(ager)?|minor|little (girl|boy))|petite young)\b", re.I)
def too_young(text):
    return bool(MINOR.search(str(text or "")))
_cache = {"at": 0, "found": None}
_lock = threading.Lock()

def _read(name):
    p = os.path.join(HERE, name)
    return open(p).read().strip() if os.path.exists(p) else ""

def _get(url, key=None, timeout=6):
    localcheck.check(url)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key} if key else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def _post(url, body, key=None, timeout=240):
    localcheck.check(url)
    h = {"Content-Type": "application/json"}
    if key: h["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def _is_image_model(m):
    """Image *generators* only (image output), never vision chat models that merely read images."""
    arch = m.get("architecture") if isinstance(m.get("architecture"), dict) else {}
    outs = " ".join(str(x) for x in (m.get("output_modalities") or arch.get("output_modalities") or [])).lower()
    modality = str(m.get("modality") or arch.get("modality") or "").lower()
    kind = str(m.get("type") or m.get("task") or "").lower()
    return ("image" in outs or "->" in modality and "image" in modality.split("->", 1)[1]
            or kind in ("image", "images", "image-generation", "text-to-image") or bool(IMAGE_HINT.search(str(m.get("id", "")))))

_tee = {}   # Phala model id -> (checked_at, is_tee)
def phala_tee(model, key):
    """True only if Phala lists this exact model as running in a TEE (is_tee). Anything else is refused: nothing is
    ever sent to a Phala model outside an enclave, whatever a setting says. Re-checked every few hours."""
    hit = _tee.get(model)
    if hit and time.time() - hit[0] < (6 * 3600 if hit[1] else 600):
        return hit[1]
    try:
        ms = _get(PHALA + "/models", key, timeout=10).get("data", [])
        ok = any(m.get("id") == model and m.get("is_tee") is True for m in ms)
    except Exception:
        return False                                      # couldn't confirm: don't send
    _tee[model] = (time.time(), ok)
    return ok

def find(cfg, refresh=False):
    """Which private image maker is available: {"provider", "model"} or None (re-checked every hour or few)."""
    if cfg.get("images", "auto") == "off":
        return None
    with _lock:
        # found: re-checked every 6 h; nothing found: every hour (so the providers don't see a check with every chat);
        # couldn't ask Tinfoil yet (its proxy is still verifying at start): again in 30 s
        ttl = 6 * 3600 if _cache["found"] else _cache.get("ttl", 3600)
        if not refresh and time.time() - _cache["at"] < ttl:
            return _cache["found"]
        found, unsure = None, False
        if cfg.get("image_model") and cfg.get("image_provider", "tinfoil") in ("tinfoil", "local"):
            found = {"provider": cfg.get("image_provider", "tinfoil"), "model": cfg["image_model"]}
        if not found and _read(".tinfoil_key"):
            try:
                ms = _get(tinfoilproxy.url() + "/models", _read(".tinfoil_key")).get("data", [])
                m = next((m for m in ms if _is_image_model(m)), None)
                if m: found = {"provider": "tinfoil", "model": m["id"]}
            except Exception:
                unsure = True
        if not found:
            try:            # a real A1111-style image API (not just anything on port 7860, e.g. another Gradio app)
                if isinstance(_get(LOCAL + "/sdapi/v1/options", timeout=3), dict):
                    found = {"provider": "local", "model": "local"}
            except Exception:
                pass
        _cache.update(at=time.time(), found=found, ttl=30 if unsure and not found else 3600)
        return found

def forget_found():
    _cache.update(at=0, found=None)

# How a character's pictures look (chosen per character; "photo" unless you pick another).
STYLE = {
    "illustration": "digital illustration, clean lines, soft shading, detailed",
    "anime": "anime style illustration, cel shading, expressive eyes, vibrant colours",
    "cartoon": "3D animated film style character, stylised, soft lighting, high detail render",
    "painting": "oil painting, visible brush strokes, painterly, rich colours",
}

def prompt_for(appearance, scene, selfie=True, style=None):
    if too_young(appearance) or too_young(scene):
        raise ValueError("refused: only adults")
    looks = appearance.strip() or "a friendly person with a warm smile"
    if style in STYLE:      # stylised pictures lose the realism that keeps ages obvious, so say it plainly
        return (f"{ADULT}{looks}. {scene.strip()}. {'selfie, ' if selfie else ''}{STYLE[style]}, "
                "clearly a grown adult with adult proportions and a mature face")
    shot = ("candid smartphone selfie" if selfie else "candid smartphone photo") + ", natural light, realistic, high detail"
    return f"{ADULT}{looks}. {scene.strip()}. {shot}"

def make(cfg, prompt, seed=None, size=768):
    """Returns PNG/JPEG bytes. Raises if no private image maker is available."""
    f = find(cfg)
    if not f:
        raise RuntimeError("no private image model available")
    if f["provider"] == "local":
        body = {"prompt": prompt, "negative_prompt": NEGATIVE, "width": size, "height": size,
                "steps": int(cfg.get("image_steps", 8)), "seed": seed if seed is not None else -1}
        return base64.b64decode(_post(LOCAL + "/sdapi/v1/txt2img", body)["images"][0])
    if f["provider"] != "tinfoil":
        raise RuntimeError("no private image model available")
    url, key = tinfoilproxy.url(), _read(".tinfoil_key")      # Tinfoil's enclave, through its verifying proxy
    out = _post(url + "/images/generations", {"model": f["model"], "prompt": prompt, "n": 1,
                                              "size": f"{size}x{size}", "response_format": "b64_json"}, key)
    d = out["data"][0]
    if d.get("b64_json"):
        return base64.b64decode(d["b64_json"])
    raise RuntimeError("image model returned no picture")

_mem = {}   # id -> (made_at, bytes): photos from private chats, kept in memory only (gone after 12 h or a restart)

def save(data, private=False):
    """Stores a picture privately and returns its id (private chats: in memory only, never on disk)."""
    mid = uuid.uuid4().hex
    if private:
        for k in [k for k, (t, _) in _mem.items() if t < time.time() - 12 * 3600]:
            _mem.pop(k, None)
        _mem[mid] = (time.time(), data)
        return mid
    os.makedirs(MEDIA, exist_ok=True); os.chmod(MEDIA, 0o700)
    ext = "jpg" if data[:3] == b"\xff\xd8\xff" else "png"
    p = os.path.join(MEDIA, f"{mid}.{ext}")
    with open(p, "wb") as f:
        f.write(data)
    os.chmod(p, 0o600)
    return mid

def prune():
    for k in [k for k, (t, _) in list(_mem.items()) if t < time.time() - 12 * 3600]:
        _mem.pop(k, None)

def from_memory(mid):
    hit = _mem.get(str(mid))
    return hit[1] if hit and hit[0] > time.time() - 12 * 3600 else None

def remove(mid):
    _mem.pop(str(mid), None)
    p = path(mid)
    if p:
        try: os.remove(p)
        except OSError: pass

def path(mid):
    """The file for a picture id, or None (ids are checked, so nothing outside .media/ can be read)."""
    if not re.fullmatch(r"[0-9a-f]{32}", str(mid)):
        return None
    for ext in ("jpg", "png"):
        p = os.path.join(MEDIA, f"{mid}.{ext}")
        if os.path.exists(p):
            return p
    return None
