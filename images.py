"""Pictures from your characters (selfies, what they're up to, profile pictures), made privately, and the photos you
send them. You choose who makes the pictures (Settings → Pictures, the `pictures` setting):
- "local": an image app on this Mac with an A1111-style HTTP API on 127.0.0.1:7860. Made for Draw Things (tuned for
  Z-Image Turbo, from the settings Draw Things itself reports); Automatic1111/Forge work too. Nothing leaves the Mac
  (keep Draw Things' Cloud Compute off: Buddy can't see that setting from outside).
- "near": FLUX.2 [klein] 4B on NEAR AI Cloud's sealed GPUs, only through near.py, which checks NEAR's servers before
  every picture and seals the prompt to them (opt-in, your own key in .near_key). Only picture prompts go there.
- "off": no pictures.
Pictures are made in the background, one job at a time on this Mac (submit()), and stored in .media/ (git-ignored,
only you can read it), or only in memory for private chats. Photos you send are kept the same way; they're never used
to make pictures."""
import base64, json, os, random, re, socket, struct, threading, time, urllib.error, urllib.request, uuid
import edition, localcheck, tinfoilproxy
try:
    import near                                  # NEAR AI pictures (Buddy works without it)
except Exception:
    near = None

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, ".media")
PHALA = "https://inference.phala.com/v1"
LOCAL = "http://127.0.0.1:7860"
IMAGE_HINT = re.compile(r"flux|sdxl|stable-diffusion|diffusion|qwen-image|z-image|hidream|imagen|image-gen|gpt-image", re.I)
ADULT = "an adult (25 to 35 years old), "
ORIGINAL = "an original fictional person who isn't anyone real, "
NEGATIVE = "child, teen, minor, young-looking, celebrity, real person, deformed, extra fingers, text, watermark"
# Anything that describes someone under 18 is refused before an image is ever made (hard rule; not up to the model).
# The picture models Buddy uses ignore NEGATIVE (CFG 1, and NEAR takes none), so this and the prompt's wording are the
# guarantee: it's strict on purpose (a bare "girl" or "boy" counts; say woman or man), and a missed picture is the cost.
_AGE = r"(1[0-7]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)"
MINOR = re.compile(
    r"\b(child(ren)?|kids?|kiddos?|toddlers?|bab(y|ies)(?![- ]?(blue|pink)\b)|infants?|newborns?|little ones?(?![\w-])|"
    r"teen(age[rd]?s?|s)?|tweens?|pre-?teens?|adolescen(ts?|ce)|(pre)?pubescent|puberty|minors?|under ?-?aged?|juveniles?|"
    r"boys?|girls?|sons?|daughters?|nieces?|nephews?|grand(child(ren)?|kids?|sons?|daughters?)|step(sons?|daughters?|kids?)|"
    r"school ?(girl|boy|kid|child|uniform)s?|(high|middle|elementary|primary|grade|nursery|pre) ?school(ers?)?|junior high|"
    r"kindergart(en|ner)s?|(\d{1,2}(st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|"
    r"twelfth)[- ]?grade(rs?)?|grade (school|[1-9]|1[0-2])|sweet sixteen|quincea[nñ]era|ba[rt] mitzvah|"
    r"as a (kid|child|teen(ager)?)|when i was (little|young|a kid|\d+)|"
    + _AGE + r"[- ]?(years?|yrs?)[- ]?olds?|" + _AGE + r" ?(yo|y/o|y\.o)|" + _AGE + r" years? of age|aged? " + _AGE + "|"
    r"\d+[- ]?(months?|weeks?|days?)[- ]?olds?|(looks?|looking|appears?) (about |around |maybe |like )?" + _AGE + "|"
    r"at (1[0-7]|[1-9])\b(?! ?(am|pm|o'?clock|:|h\b))|"
    r"loli(ta)?|shota|child-?like|kid-?like|baby ?faced?|chibi|jailbait|barely legal|"
    r"sailor (uniform|outfit|suit|fuku)|young-looking|looks? (very |so )?young|"
    r"looks? like a (kid|child|teen(ager)?|minor|little (girl|boy))|petite young|young (girl|boy))\b", re.I)
_TENS = re.compile(r"\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b", re.I)
_GROWN = re.compile(r"\b(adult|grown[- ]?up|grown|(1[89]|[2-9]\d|eighteen|nineteen|twenty|thirty|forty|fifty)[- ]?(years?|yrs?)[- ]?old)"
                    r"[- ](sons?|daughters?|nieces?|nephews?|boys?|girls?|grand(sons?|daughters?|kids?|children)|"
                    r"step(sons?|daughters?))\b", re.I)          # ("my adult son", "a 30-year-old daughter": fine)
def too_young(text):
    t = _GROWN.sub(" ", _TENS.sub(" ", str(text or "")))     # ("twenty-one-year-old" isn't "one-year-old")
    return bool(MINOR.search(t))

# Never a real person: their looks and every scene must not point at one (the prompt also says "original fictional").
_FAMOUS = re.compile(r"\b(look-?alikes?|celebrit(y|ies)|famous|spitting image|doppel-?g(a|ä)ngers?|impersonat\w*|deep-?fakes?|"
                     r"resembl\w*|(movie|film|tv|pop|rock|k-?pop|hollywood|bollywood|youtube|instagram|tiktok) ?"
                     r"(stars?|idols?|celeb\w*|influencers?))\b", re.I)
_LIKE_NAME = re.compile(r"\b(?:[Ll]ook(?:s|ing|ed)?(?: exactly| just| a lot| a bit| kind of| sort of| so much| almost)? like|"
                        r"[Tt]he real) +[A-Z]")              # "looks like Brad…", "the real Taylor…" (not "looks like a runner")
def real_person(text):
    t = str(text or "")
    return bool(_FAMOUS.search(t) or _LIKE_NAME.search(t))

# A photo you sent is never turned into a picture (not even in words: "me and the guy from your photo").
_YOURS = re.compile(r"\b(your|ur) (own )?(photos?|pictures?|pics?|selfies?|snaps?|images?|shots?)\b|"
                    r"\b(photos?|pictures?|pics?|selfies?|snaps?|images?|shots?|one) (that |which )?you (just )?"
                    r"(sent|shared|showed|posted|took)\b|\byou (just )?(sent|shared|showed)\b|\b(from|in|like) yours\b", re.I)
def from_your_photo(text):
    return bool(_YOURS.search(str(text or "")))

# The public edition (edition.py): every person in a picture is modestly dressed, said in the prompt itself (these models
# ignore NEGATIVE), and nothing revealing or haram is ever asked for.
MODEST = "modestly dressed in loose clothes that cover the body, nothing revealing, "
_IMMODEST = re.compile(r"\b(nude|naked|nudity|topless|shirtless|bare[- ]chested|undress\w*|lingerie|bikinis?|underwear|bras?|"
                       r"panties|thongs?|(?<!modest )swim ?suits?|swimwear|cleavage|see-?through|low-?cut|revealing|sexy|"
                       r"seductive|sensual|erotic|provocative|crop ?tops?|tank ?tops?|mini ?skirts?|short skirts?|shorts|"
                       r"tight\w*|bodycon|beers?|wine(?![- ](red|colou?red))|cocktails?(?! dress)|champagne|vodka|whiske?y|"
                       r"pints?|alcohol\w*|drunk|tipsy|(?<!chocolate )(?<!candy )bars?|pubs?|night ?clubs?|"
                       r"clubbing|casinos?|gambling|bacon|pork|ham)\b", re.I)
def immodest(text):
    return bool(_IMMODEST.search(str(text or "")))
_lock = threading.Lock()
NOT_RUNNING = "Draw Things isn't running (open it and turn on its API server, port 7860)"
NOT_YOURS_PORT = "port 7860 is used by a program that isn't yours, so nothing was sent (quit it, then open Draw Things)"
NEAR_MISSING = "Buddy's NEAR checker isn't installed yet (it comes with the next update)"
NEAR_NO_KEY = "NEAR AI needs your key (add it on your Mac: Settings → Pictures)"
NEAR_LABEL = "FLUX.2 [klein] 4B"

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

# ---------- who makes pictures ----------
def setting(cfg):
    """off | local | near (or "tinfoil", only hand-set in config.local.json together with image_model)."""
    p = cfg.get("pictures")
    return p if p in ("off", "local", "near", "tinfoil") else "local"

# Draw Things' own recommended settings per model (its "Z Image Turbo 1.0" and "FLUX.2 [klein] 4B" presets).
DT_FAMILIES = [   # (family, file name pattern, label, tuning)
    ("z_image_turbo", r"^z_image_turbo", "Z-Image Turbo", {"steps": 8, "guidance_scale": 1.0, "sampler": "UniPC Trailing",
        "shift": 3.0, "resolution_dependent_shift": False, "seed_mode": "Scale Alike"}),
    ("flux_2_klein", r"^flux_2_klein_4b", "FLUX.2 [klein] 4B", {"steps": 4, "guidance_scale": 1.0, "sampler": "DDIM Trailing",
        "shift": 3.0, "resolution_dependent_shift": False, "seed_mode": "Scale Alike"}),
]
VARIANT = {"q6p": "6-bit", "q8p": "8-bit", "f16": "full size"}   # label suffix from the file name
# Whatever else is switched on in the app (LoRAs, controls, upscaler, refiner, prompt rewriting...) would apply to
# Buddy's request too, so it's switched off for it (only keys this Draw Things reports are ever sent).
QUIET = {"batch_count": 1, "batch_size": 1, "strength": 1.0, "loras": [], "controls": [], "hires_fix": False,
         "upscaler": None, "refiner_model": None, "tea_cache": False, "expand_prompt_to_json": False,
         "tiled_decoding": False, "tiled_diffusion": False, "sharpness": 0}

def family(model):
    """{"family", "label", "tuning"} for a Draw Things model file, or None (unknown: the app's own settings apply)."""
    name = os.path.basename(str(model or "")).lower()
    for fam, pat, label, tuning in DT_FAMILIES:
        if re.search(pat, name):
            v = next((t for k, t in VARIANT.items() if re.search(rf"[_.-]{k}\b", name)), "")
            return {"family": fam, "label": f"{label} ({v})" if v else label, "tuning": tuning}
    return None

def dt_body(opts, prompt, w, h, seed, cfg):
    """A txt2img request for Draw Things: tuned for the model it has loaded (or the one you set in local_image_model)."""
    body = {"prompt": prompt, "negative_prompt": NEGATIVE, "width": w, "height": h, "seed": seed}
    model = cfg.get("local_image_model") or opts.get("model")
    if cfg.get("local_image_model"):
        body["model"] = cfg["local_image_model"]
    f = family(model)
    body.update(QUIET); body.update(f["tuning"] if f else {})
    if cfg.get("image_steps"):
        body["steps"] = max(1, min(150, int(cfg["image_steps"])))
    return {k: v for k, v in body.items() if k in opts}       # only keys this Draw Things knows: never a 422 for those

_durs = {}           # (provider, "WxH") -> the last few times a picture took (s), to tell you how long it'll be
DEFAULT_ETA = {("local", "768x1024"): 150, ("local", "1024x1024"): 180}   # Z-Image Turbo 6-bit on an M4 MacBook Air
def eta(provider, w, h):
    d = _durs.get((provider, f"{w}x{h}"))
    if d:
        return int(sum(d) / len(d))
    if provider != "local":
        return 20
    return DEFAULT_ETA.get((provider, f"{w}x{h}"), 180 if w * h > 800_000 else 150)

_local = {"at": 0, "opts": None, "why": ""}   # the image app's own settings, asked at most once a minute
_busy_local = threading.Event()               # a picture is being made on this Mac right now

def local_status(cfg=None, fresh=False):
    """Is the image app on this Mac ready, and with which model? (No prompt or picture is involved.)"""
    cfg = cfg or {}
    with _lock:
        # while it's making a picture it may not answer quickly: what it said before still holds
        busy = _busy_local.is_set() and _local["opts"] is not None
        fresh_enough = (_local["opts"] is not None or _local["why"]) and not fresh and time.time() - _local["at"] < 60
        opts, why = (_local["opts"], _local["why"]) if busy or fresh_enough else (None, None)
    if opts is None and why is None:
        opts, why = None, ""
        try:
            o = _get(LOCAL + "/sdapi/v1/options", timeout=5)
            if isinstance(o, dict):
                opts = o
            else:
                why = "the app on port 7860 isn't an image app Buddy knows"
        except localcheck.NotYours:                      # (no program of yours there: is anything there at all?)
            why = _refused()
        except RuntimeError as e:                        # (localcheck: it didn't take the connection in time)
            why = str(e)
        except Exception:
            why = NOT_RUNNING
        with _lock:
            _local.update(at=time.time(), opts=opts, why=why)
    if opts is None:
        return {"running": False, "app": None, "model": None, "label": "", "family": None, "tuned": False,
                "eta_s": eta("local", 768, 1024), "why": why or NOT_RUNNING}
    app = "drawthings" if ("seed_mode" in opts or "shift" in opts) else "a1111"   # (anything else: A1111-style)
    model = (cfg.get("local_image_model") or opts.get("model")) if app == "drawthings" else opts.get("sd_model_checkpoint")
    f = family(model) if app == "drawthings" else None
    return {"running": True, "app": app, "model": str(model) if model else None,
            "label": f["label"] if f else (os.path.basename(str(model)) if model else ""),
            "family": f and f["family"], "tuned": bool(f and f["family"] == "z_image_turbo"), "eta_s": eta("local", 768, 1024)}

def _refused():
    """localcheck found no program of yours on port 7860. lsof can't tell "nothing there" from "another account's
    program", so a bare connection (nothing is sent on it) tells: refused = Draw Things isn't running."""
    try:
        socket.create_connection(("127.0.0.1", 7860), timeout=2).close()
    except OSError:
        return NOT_RUNNING
    return NOT_YOURS_PORT

def near_status(fresh=False, wait=False):
    """NEAR AI's state for Settings: near.status() (a full check of NEAR's servers, cached), or why it can't be used."""
    if near is None:
        return {"ok": False, "reason": NEAR_MISSING}
    key = _read(".near_key")
    if not key:
        return {"ok": False, "reason": NEAR_NO_KEY}
    try:
        ok, why = near.ready()
        if not ok:
            return {"ok": False, "reason": why or NEAR_MISSING}
        st = near.status(key, fresh=fresh, wait=wait)
        return st if isinstance(st, dict) else {"ok": False, "reason": "NEAR's check didn't answer"}
    except Exception:
        return {"ok": False, "reason": "Buddy's NEAR checker ran into a problem"}

def find(cfg, refresh=False):
    """Can a picture be made right now, and by whom: {"provider", "model", "label", "eta_s", ...} or None (pictures
    off, or the chosen maker isn't ready). Cheap enough for every turn (the Mac's app is asked at most once a minute;
    NEAR's last check is used and renewed in the background)."""
    p = setting(cfg)
    if p == "local":
        s = local_status(cfg, fresh=refresh)
        if not s["running"]:
            return None
        return {"provider": "local", "model": s["model"] or "local", "app": s["app"], "label": s["label"],
                "tuned": s["tuned"], "eta_s": s["eta_s"]}
    if p == "near":
        st = near_status(fresh=refresh, wait=False)
        if st.get("ok") and time.time() - float(st.get("checked") or 0) < 6 * 3600:   # (every picture is checked anew)
            return {"provider": "near", "model": getattr(near, "MODEL", "black-forest-labs/FLUX.2-klein-4B"),
                    "label": NEAR_LABEL, "eta_s": eta("near", 768, 1024)}
        return None
    if p == "tinfoil" and cfg.get("image_model") and _read(".tinfoil_key"):   # (kept for a future Tinfoil image model)
        return {"provider": "tinfoil", "model": cfg["image_model"], "label": cfg["image_model"], "eta_s": eta("tinfoil", 768, 1024)}
    return None

def why_not(cfg):
    """Why no picture can be made right now, in plain words (for the note in the chat or the editor)."""
    p = setting(cfg)
    if p == "local":
        return local_status(cfg)["why"] or NOT_RUNNING
    if p == "near":
        st = near_status(wait=False)
        return st.get("reason") or "NEAR AI isn't available right now"
    return "pictures are off (Settings → Pictures)"

def forget_found():
    with _lock:
        _local.update(at=0, opts=None, why="")

# How a character's pictures look (chosen per character; "photo" unless you pick another).
STYLE = {
    "illustration": "digital illustration, clean lines, soft shading, detailed",
    "anime": "anime style illustration, cel shading, expressive eyes, vibrant colours",
    "cartoon": "3D animated film style character, stylised, soft lighting, high detail render",
    "painting": "oil painting, visible brush strokes, painterly, rich colours",
}

ONLY_ADULTS = "only adults: their looks and the scene must say woman or man (not girl, boy or teen) and no age under 18"
ONLY_ORIGINAL = "only original people: no real or famous person, and no \"looks like …\""
FROM_YOURS = "a picture is never made from a photo you sent"
ONLY_MODEST = "only modest pictures: nothing revealing, no alcohol or gambling"

def prompt_for(appearance, scene, selfie=True, style=None):
    """The picture prompt: always an adult (25-35), always an original fictional person (in the public edition always
    modestly dressed). Raises ValueError (with a reason for you) for anyone young, anyone real, a scene taken from a photo
    you sent, or (public edition) anything revealing or haram."""
    if too_young(appearance) or too_young(scene):
        raise ValueError(ONLY_ADULTS)
    if real_person(appearance) or real_person(scene):
        raise ValueError(ONLY_ORIGINAL)
    if from_your_photo(scene):
        raise ValueError(FROM_YOURS)
    if edition.PUBLIC and (immodest(appearance) or immodest(scene)):
        raise ValueError(ONLY_MODEST)
    looks = appearance.strip() or "a friendly person with a warm smile"
    modest = MODEST if edition.PUBLIC else ""
    if style in STYLE:      # stylised pictures lose the realism that keeps ages obvious, so say it plainly
        return (f"{ADULT}{ORIGINAL}{looks}. {scene.strip()}. {modest}{'selfie, ' if selfie else ''}{STYLE[style]}, "
                "clearly a grown adult with adult proportions and a mature face")
    shot = ("candid smartphone selfie" if selfie else "candid smartphone photo") + ", natural light, realistic, high detail"
    return f"{ADULT}{ORIGINAL}{looks}. {scene.strip()}. {modest}{shot}"

WALL_STYLE = {"illustration": "digital illustration, soft shading", "anime": "anime background art, painterly",
              "cartoon": "3D animated film background, soft lighting", "painting": "oil painting, visible brush strokes"}

def wall_prompt(scene, style=None):
    """A chat wallpaper: a place, a texture or a mood, never a person (same refusals as every picture)."""
    if too_young(scene):
        raise ValueError(ONLY_ADULTS)
    if real_person(scene):
        raise ValueError(ONLY_ORIGINAL)
    if from_your_photo(scene):
        raise ValueError(FROM_YOURS)
    if edition.PUBLIC and immodest(scene):
        raise ValueError(ONLY_MODEST)
    s = re.sub(r"\s+", " ", str(scene or "")).strip()[:200] or "soft abstract shapes in warm muted colours"
    return (f"{s}. Phone wallpaper, calm and uncluttered, soft muted colours, gentle light, empty of people: no person, "
            f"no face, no text. {WALL_STYLE.get(style, 'photo, natural light, high detail')}")

def mime(data):
    """image/png | image/jpeg | image/webp for picture bytes, or None (anything else is never stored or served)."""
    if data[:8] == b"\x89PNG\r\n\x1a\n": return "image/png"
    if data[:3] == b"\xff\xd8\xff": return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP": return "image/webp"
    return None

def audio_mime(data):
    """audio/wav | audio/webm | audio/ogg | audio/mp4 for voice-message bytes, or None."""
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE": return "audio/wav"
    if data[:4] == b"\x1aE\xdf\xa3": return "audio/webm"
    if data[:4] == b"OggS": return "audio/ogg"
    if data[4:8] == b"ftyp": return "audio/mp4"
    return None

def media_type(data):
    return mime(data) or audio_mime(data)

AUDIO_EXT = {"audio/wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a"}

def save_audio(data, private=False):
    """Stores a voice message (yours or theirs) and returns its id; private chats: in memory only."""
    kind = audio_mime(data)
    if not kind:
        raise ValueError("that isn't a voice recording")
    mid = uuid.uuid4().hex
    if private:
        prune(); _mem[mid] = (time.time(), data, None); return mid
    os.makedirs(MEDIA, exist_ok=True); os.chmod(MEDIA, 0o700)
    try: _write(os.path.join(MEDIA, f"{mid}.{AUDIO_EXT[kind]}"), data)
    except OSError:                                      # (no half-written file stays behind)
        remove(mid); raise
    return mid

def _picture(data, who):
    if mime(data):
        return data
    raise RuntimeError(f"{who} didn't send back a picture")

def _make_local(cfg, prompt, w, h, seed):
    """txt2img on this Mac's image app (never img2img: no picture is ever made from another picture)."""
    st = local_status(cfg, fresh=True)
    if not st["running"]:
        raise RuntimeError(st["why"])
    with _lock:
        opts = dict(_local["opts"] or {})
    if st["app"] == "drawthings":
        if not {"prompt", "width", "height"} <= set(opts):   # (a request without Buddy's prompt would make whatever's set)
            raise RuntimeError("this Draw Things version isn't supported (update it)")
        body = dt_body(opts, prompt, w, h, seed, cfg)
        minimal = {k: v for k, v in body.items() if k in ("prompt", "negative_prompt", "width", "height", "seed")}
    else:
        body = minimal = {"prompt": prompt, "negative_prompt": NEGATIVE, "width": w, "height": h,
                          "steps": int(cfg.get("image_steps") or 8), "seed": seed}
    _busy_local.set()
    try:
        try:
            out = _post(LOCAL + "/sdapi/v1/txt2img", body, timeout=900)   # nothing comes back until it's done
        except urllib.error.HTTPError as e:
            if e.code != 422:
                raise RuntimeError(f"Draw Things returned an error (HTTP {e.code})")
            try:
                out = _post(LOCAL + "/sdapi/v1/txt2img", minimal, timeout=900)   # once more, with only the basics
            except urllib.error.HTTPError as e2:
                raise RuntimeError("Draw Things refused the request" + _detail(e2, prompt))
    except localcheck.NotYours:                          # (it quit since: no program of yours there any more)
        raise RuntimeError(_refused())
    except (socket.timeout, TimeoutError):
        raise RuntimeError("Draw Things took over 15 minutes")
    except urllib.error.URLError as e:
        if isinstance(e.reason, (socket.timeout, TimeoutError)) or "timed out" in str(e.reason):
            raise RuntimeError("Draw Things took over 15 minutes")
        raise RuntimeError(NOT_RUNNING)
    except OSError:
        raise RuntimeError(NOT_RUNNING)
    finally:
        _busy_local.clear()
    try:
        return _picture(base64.b64decode((out.get("images") or [""])[0]), "Draw Things")
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError("Draw Things didn't send back a picture")

def _detail(e, prompt):
    """The app's own short reason, only if it can't contain any of the prompt (reasons never carry what you asked for)."""
    try: d = str(json.loads(e.read(4000)).get("detail") or "")
    except Exception: return ""
    d = re.sub(r"\s+", " ", d).strip()[:80]
    words = {w for w in re.findall(r"[a-z]{4,}", prompt.lower())} - set(re.findall(r"[a-z]{4,}", (ADULT + ORIGINAL).lower())) \
        - {"photo", "selfie", "light", "realistic"}
    if not d or not re.fullmatch(r"[\w\s:'\"\[\],._()/-]+", d) or any(w in d.lower() for w in words):
        return ""
    return ": " + d

def _make_near(prompt, w, h):
    if near is None:
        raise RuntimeError(NEAR_MISSING)
    key = _read(".near_key")
    if not key:
        raise RuntimeError(NEAR_NO_KEY)
    try:
        data, _mime = near.generate(prompt, w, h, key)     # checks NEAR's servers first, then sends it sealed
    except getattr(near, "NearError", RuntimeError) as e:
        raise RuntimeError(str(e) or "NEAR AI couldn't make the picture")
    except Exception:
        raise RuntimeError("NEAR AI pictures ran into a problem")
    return _picture(data, "NEAR AI")

def make(cfg, prompt, seed=None, size=768, width=None, height=None, provider=None):
    """Returns PNG/JPEG bytes (blocks until it's made). Raises RuntimeError with a short reason for you (never the
    prompt). provider: fixed when the job was handed in (the setting may change meanwhile)."""
    w, h = int(width or size), int(height or size)
    seed = random.randrange(2 ** 31) if seed is None else int(seed)
    if provider is None:
        f = find(cfg)
        if not f:
            raise RuntimeError("no picture maker")
        provider = f["provider"]
    if provider == "local":
        return _make_local(cfg, prompt, w, h, seed)
    if provider == "near":
        return _make_near(prompt, w, h)
    if provider == "tinfoil" and cfg.get("image_model"):
        url, key = tinfoilproxy.url(), _read(".tinfoil_key")      # Tinfoil's enclave, through its verifying proxy
        out = _post(url + "/images/generations", {"model": cfg["image_model"], "prompt": prompt, "n": 1,
                                                  "size": f"{w}x{h}", "response_format": "b64_json"}, key)
        d = (out.get("data") or [{}])[0]
        if d.get("b64_json"):
            return _picture(base64.b64decode(d["b64_json"]), "Tinfoil's image model")
        raise RuntimeError("Tinfoil's image model returned no picture")
    raise RuntimeError("no picture maker")

# ---------- picture jobs: made in the background, one at a time on this Mac ----------
MAX_WAITING = 6
_jobs = {}                       # job id -> {"kind", "char", "since", "eta", "provider", "state"}
_jlock = threading.Lock()
_queue = []                      # this Mac's jobs, in order (its app makes one at a time anyway)
_qready = threading.Condition(_jlock)
_worker = [None]
_near_slots = threading.Semaphore(2)

def submit(kind, char_id, prompt, w, h, seed, done, cfg):
    """Hands in a picture to make (kind: "photo" | "avatar"). done(result) runs on a worker thread with
    {"ok": True, "job", "data", "mime", "made_by", "model", "secs"} or {"ok": False, "job", "why"}.
    Returns {"job", "eta", "provider"} at once; raises RuntimeError("no picture maker") or RuntimeError("busy")."""
    f = find(cfg)
    if not f:
        raise RuntimeError("no picture maker")
    prov = f["provider"]
    with _jlock:
        mine = [j for j in _jobs.values() if j["provider"] == prov]
        if sum(1 for j in mine if j["state"] == "waiting") >= MAX_WAITING:
            raise RuntimeError("busy")
        avg = eta(prov, w, h)
        ahead = len(mine) if prov == "local" else len(mine) // 2
        jid = uuid.uuid4().hex
        _jobs[jid] = {"kind": kind, "char": char_id, "since": time.time(), "eta": int(avg * (1 + ahead)),
                      "provider": prov, "state": "waiting"}
        out = {"job": jid, "eta": _jobs[jid]["eta"], "provider": prov}

    def run():
        with _jlock:
            if jid in _jobs: _jobs[jid]["state"] = "running"
        t0 = time.time()
        try:
            data = make(cfg, prompt, seed=seed, width=w, height=h, provider=prov)
            secs = time.time() - t0
            with _jlock:
                d = _durs.setdefault((prov, f"{w}x{h}"), []); d.append(secs); del d[:-5]
            res = {"ok": True, "job": jid, "data": data, "mime": mime(data),
                   "made_by": prov, "model": f["model"], "secs": secs}
        except RuntimeError as e:
            res = {"ok": False, "job": jid, "why": str(e) or "the picture couldn't be made"}
        except Exception:
            res = {"ok": False, "job": jid, "why": "the picture couldn't be made"}
        try:
            done(res)
        except Exception:
            pass
        finally:
            with _jlock: _jobs.pop(jid, None)

    if prov == "local":
        with _jlock:
            _queue.append(run); _qready.notify()
            if not (_worker[0] and _worker[0].is_alive()):
                _worker[0] = threading.Thread(target=_local_worker, daemon=True); _worker[0].start()
    else:
        def slot():
            with _near_slots: run()
        threading.Thread(target=slot, daemon=True).start()
    return out

def _local_worker():
    while True:
        with _jlock:
            while not _queue:
                _qready.wait()
            run = _queue.pop(0)
        run()

def jobs():
    """Pictures being made or waiting: job id -> {"kind", "char", "since", "eta", "provider"} (memory only)."""
    with _jlock:
        return {k: {x: v[x] for x in ("kind", "char", "since", "eta", "provider")} for k, v in _jobs.items()}

# ---------- storing pictures (yours and theirs) ----------
_mem = {}   # id -> (made_at, picture, view copy or None): from private chats, in memory only (gone after 12 h or a restart)

def _write(p, data):
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.chmod(p, 0o600)

def save(data, private=False, view=None):
    """Stores a picture privately and returns its id (private chats: in memory only, never on disk).
    view: a smaller copy of a photo you sent (what the chat shows; the full one opens when you tap it)."""
    mid = uuid.uuid4().hex
    if private:
        prune()
        _mem[mid] = (time.time(), data, view)
        return mid
    os.makedirs(MEDIA, exist_ok=True); os.chmod(MEDIA, 0o700)
    ext = {"image/jpeg": "jpg", "image/webp": "webp"}.get(mime(data), "png")
    try:
        _write(os.path.join(MEDIA, f"{mid}.{ext}"), data)
        if view:
            _write(os.path.join(MEDIA, f"{mid}.v.jpg"), view)
    except OSError:                                      # (e.g. a full disk: no half-written file stays behind)
        remove(mid); raise
    return mid

def prune():
    for k in [k for k, v in list(_mem.items()) if v[0] < time.time() - 12 * 3600]:
        _mem.pop(k, None)

def from_memory(mid, view=False):
    hit = _mem.get(str(mid))
    if not hit or hit[0] <= time.time() - 12 * 3600:
        return None
    return hit[2] if view and hit[2] else hit[1]

def remove(mid):
    _mem.pop(str(mid), None)
    for p in (path(mid), view_path(mid)):
        if p:
            try: os.remove(p)
            except OSError: pass

def path(mid):
    """The file for a picture id, or None (ids are checked, so nothing outside .media/ can be read)."""
    if not re.fullmatch(r"[0-9a-f]{32}", str(mid)):
        return None
    for ext in ("jpg", "png", "webp", "wav", "webm", "ogg", "m4a"):
        p = os.path.join(MEDIA, f"{mid}.{ext}")
        if os.path.exists(p):
            return p
    return None

def view_path(mid):
    if not re.fullmatch(r"[0-9a-f]{32}", str(mid)):
        return None
    p = os.path.join(MEDIA, f"{mid}.v.jpg")
    return p if os.path.exists(p) else None

def clean_photo(data, max_side, max_bytes):
    """A photo you send, checked again here (the page already re-encoded it, which drops location and camera
    details): JPEG only, sizes in bounds, and every metadata segment (EXIF/GPS, XMP, ICC, comments) dropped wherever
    it is (also between the scans of a progressive JPEG), and anything after the picture's end marker too (a second
    picture with its own EXIF, a motion photo's video). Pixels are never decoded.
    -> (clean bytes, (width, height)); raises ValueError."""
    if len(data) > max_bytes or data[:3] != b"\xff\xd8\xff":
        raise ValueError("not a photo")
    out, i, size, scans, end = bytearray(b"\xff\xd8"), 2, None, 0, len(data)
    while i + 2 <= end:
        if data[i] != 0xFF:
            raise ValueError("broken JPEG")
        m = data[i + 1]
        if m == 0xFF:                                    # fill byte
            i += 1; continue
        if m == 0xD9:                                    # end of the picture: whatever follows it is dropped
            if not scans:
                raise ValueError("JPEG has no image data")
            return bytes(out + b"\xff\xd9"), size
        if 0xD0 <= m <= 0xD8 or m in (0x00, 0x01):       # (restart markers belong inside a scan; one picture only)
            raise ValueError("broken JPEG")
        if i + 4 > end:
            raise ValueError("broken JPEG")
        n = struct.unpack(">H", data[i + 2:i + 4])[0]
        if n < 2 or i + 2 + n > end:
            raise ValueError("broken JPEG")
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC) and n >= 7:   # SOFn: height, width
            hh, ww = struct.unpack(">HH", data[i + 5:i + 9]); size = (ww, hh)
        if not (0xE1 <= m <= 0xEF or m == 0xFE):         # APP1..APP15 and comments go; JFIF, tables and scans stay
            out += data[i:i + 2 + n]
        i += 2 + n
        if m == 0xDA:                                    # start of scan: its coded data runs to the next real marker
            if not size or max(size) > max_side or min(size) < 16:
                raise ValueError("size")
            scans += 1
            j = i
            while True:
                j = data.find(b"\xff", j)
                if j < 0 or j + 1 >= end:
                    raise ValueError("JPEG has no end")
                if data[j + 1] == 0x00 or 0xD0 <= data[j + 1] <= 0xD7:   # a coded 0xFF byte, or a restart marker
                    j += 2; continue
                break
            out += data[i:j]; i = j
    raise ValueError("JPEG has no end")
