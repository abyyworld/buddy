#!/usr/bin/env python3
"""Buddy server: brain, voice, hearing, memory, chat saving, the shared Mac/phone conversation and push.
Runs only on 127.0.0.1 (this Mac). Keys stay here, never sent to the page.
Advisor brain: Tinfoil (via the verified local proxy). Companion brain: Phala TEE."""
import base64, datetime, hashlib, json, os, random, re, select, socket, sys, threading, time, uuid, urllib.parse, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.umask(0o077)       # everything Buddy writes (chats, settings, temp files) is readable only by you, never other accounts
# Never through a proxy: the local Tinfoil Proxy, the image app and Ollama talk plain HTTP on this Mac, so a system or
# VPN proxy in between could read everything. (Phala and push are HTTPS anyway; requests/pywebpush follow NO_PROXY.)
# Each connection to a helper on this Mac is also checked to be the program of yours that was checked (localcheck.py).
import localcheck
urllib.request.install_opener(localcheck.opener())
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "*"
import http.cookies, shutil, subprocess
import characters, devices, images, localcheck, memory, social, tailnet, tinfoilproxy

WEB = os.path.join(HERE, "web")
SPEAKING = ("You're talking out loud with me: I hear you, I don't read you. Sound natural when spoken: no lists, "
            "no markdown, no emoji, no stage directions in brackets.")
VAULT = os.path.expanduser("~/Buddy")
CHATS = os.path.join(VAULT, "chats")
# Tinfoil is reached only through its attestation-verifying proxy, which Buddy runs itself (tinfoilproxy.py).
# Tinfoil retires models now and then, so each brain has fallbacks (checked against Tinfoil's own model list).
ADVISOR_MODELS = ["gemma4-31b", "glm-5-3", "kimi-k3", "llama3-3-70b"]
COMPANION_MODELS = ["deepseek-v4-1-flash", "glm-5-3-flash", "kimi-k3", "llama3-3-70b"]
PHALA = "https://inference.phala.com/v1"
PORT = 12400
CALLING = ("We're on a live voice call right now, so talk like a person on the phone, not like a writer: start with a "
           "short, natural reaction (a few words), then say at most one or two short sentences, and keep the "
           "conversation going. Use contractions and everyday words, and say numbers, dates and times the way you'd "
           "say them out loud. Never use lists, emoji, markdown, or actions in brackets or asterisks. Ask at most one "
           "question. Don't start the way you started your last replies. My words come from speech recognition, so "
           "they can be cut off or a little wrong: if something sounds garbled or unfinished, just ask me to say it "
           "again instead of guessing.")
# A voice can't wait for a model that "thinks" silently before it says anything (Buddy only reads what it says).
# These switch that off per model; a model that refuses them (HTTP 400) is asked without them from then on.
NO_THINKING = {"deepseek-v4-1-flash": {"reasoning_effort": "none", "chat_template_kwargs": {"thinking": False}},
               "kimi-k3": {"chat_template_kwargs": {"thinking": False, "enable_thinking": False}}}
ALWAYS_THINKS = {"glm-5-3", "glm-5-3-flash"}       # (no switch): spoken replies use another model when there is one
_thinking_refused = set()
ACTION = re.compile(r"[*(]\s*(?:laugh|chuckl|giggl|smil|grin|sigh|wink|blush|nod|shrug|whisper|gasp|paus|hug|kiss|"
                    r"smirk|sniff|yawn|cough|clear|lean|look|glanc|tilt|rais|roll|bit|hum|sing|sob|cr[iy]|grimac|"
                    r"frown|beam|blink|stretch)(?:s|es|d|ed|ing|[a-z]ing)?\b[^*()\n]{0,40}[*)]", re.I)   # (*huge* stays)
EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF\u20E3\uFE0F\u200D"
                   "\U000E0020-\U000E007F]")
def spoken(text):
    """Text as it should be said aloud: no emoji, no *laughs* / (smiles), no markdown symbols."""
    t = EMOJI.sub("", ACTION.sub("", str(text)))
    return re.sub(r"\s{2,}", " ", re.sub(r"[*_#`~]", "", t)).strip()
ABBREV = re.compile(r"(?:\b(?i:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|vs|e\.g|i\.e|a\.m|p\.m)|\b[A-Z])\.$")   # ("Oh no." ends)
PHOTOS = ("You can send me a photo (a selfie, or what you're up to or looking at) by ending your message with "
          "[photo: what the photo shows]. At most one per message, and only when I ask or when it really fits "
          "(now and then, not all the time). Never describe anyone as under 25.")
PHOTO_TAG = re.compile(r"\[photo:\s*([^\]]{3,300})\]", re.I)
TEXTING = ("We're texting on my phone right now, not talking face to face. Text like a real friend: short, casual, "
           "lowercase is fine, one thought per sentence, no long paragraphs.")

def read(name, default=""):
    """Your own copy wins: persona.local.txt over persona.txt (local files are git-ignored, so updates keep them)."""
    stem, ext = os.path.splitext(name)
    for p in (os.path.join(HERE, stem + ".local" + ext), os.path.join(HERE, name)):
        if os.path.exists(p):
            return open(p).read().strip()
    return default

def local_cfg():
    try: return json.load(open(os.path.join(HERE, "config.local.json")))
    except Exception: return {}

def synced_by(path):
    """The cloud service that syncs this folder (and so could read what's in it), or "". Paths only, never contents."""
    home = os.path.expanduser("~")
    try: r = os.path.realpath(path)
    except OSError: return ""
    if r.startswith(home + "/Library/CloudStorage/"):        # Dropbox, Google Drive, OneDrive, Box... (macOS File Provider)
        name = re.split(r"[-_]", r[len(home) + 22:].split("/")[0])[0]
        return {"GoogleDrive": "Google Drive", "": "a cloud service"}.get(name, name)
    if r.startswith(home + "/Library/Mobile Documents/"):
        return "iCloud Drive"
    for d, name in (("Dropbox", "Dropbox"), ("Google Drive", "Google Drive"), ("OneDrive", "OneDrive"), ("Box", "Box")):
        if r == os.path.join(home, d) or r.startswith(os.path.join(home, d) + "/"):
            return name
    if any(r == os.path.join(home, d) or r.startswith(os.path.join(home, d) + "/") for d in ("Desktop", "Documents")) and \
            os.path.isdir(os.path.join(home, "Library/Mobile Documents/com~apple~CloudDocs/Documents")):
        return "iCloud Drive"                                # "Desktop & Documents" syncing is on
    p = r
    while p not in ("/", home, ""):                         # an old-style Dropbox folder anywhere
        if os.path.exists(os.path.join(p, ".dropbox")): return "Dropbox"
        p = os.path.dirname(p)
    return ""

def cfg():
    """Shipped defaults (config.json) overridden by your settings (config.local.json)."""
    try: c = json.load(open(os.path.join(HERE, "config.json")))
    except Exception: c = {}
    return {**c, **local_cfg()}

_cfg_lock = threading.Lock()
def save_cfg(**changes):
    """Settings changes go only to config.local.json, never to the tracked defaults."""
    with _cfg_lock:
        c = {**local_cfg(), **changes}
        tmp = os.path.join(HERE, "config.local.json.tmp")
        json.dump(c, open(tmp, "w"), indent=2); os.replace(tmp, os.path.join(HERE, "config.local.json"))

def post(url, key, body, ctype="application/json", timeout=120):
    if url.startswith(PHALA):                       # only ever a Phala model that runs in an enclave (is_tee)
        j = json.loads(body) if ctype == "application/json" else {}
        if not j.get("model") or not images.phala_tee(j["model"], key):
            raise RuntimeError("that Companion model isn't confirmed to run in Phala's enclave, so nothing was sent")
        # and Phala's gateway must route it to attested hardware with no data kept (else it refuses, never falls back)
        j["provider"] = {**(j.get("provider") or {}), "aci_verified": True, "zdr": True}
        body = json.dumps(j).encode()
    localcheck.check(url)                           # the Tinfoil Proxy really is yours, not another account's
    req = urllib.request.Request(url, data=body, method="POST",
        headers={"Authorization": "Bearer " + key, "Content-Type": ctype})
    return urllib.request.urlopen(req, timeout=timeout)

_models = {"at": 0, "ttl": 0, "ids": []}
def tinfoil_models():
    """Model ids Tinfoil serves right now (asked through the verified proxy; every 6 h, or a minute after a failure)."""
    if time.time() - _models["at"] < _models["ttl"]:
        return _models["ids"]
    try:
        u = tinfoilproxy.url() + "/models"; localcheck.check(u)
        req = urllib.request.Request(u, headers={"Authorization": "Bearer " + read(".tinfoil_key")})
        _models.update(at=time.time(), ttl=6 * 3600,
                       ids=[m["id"] for m in json.loads(urllib.request.urlopen(req, timeout=10).read())["data"]])
    except Exception:
        _models.update(at=time.time(), ttl=60)
    return _models["ids"]

def tinfoil():
    """Tinfoil's verified base URL, or a clear reason why not (no key yet, or not verified)."""
    if not read(".tinfoil_key"):
        raise RuntimeError("Buddy has no Tinfoil key yet: add it on your Mac (Settings → Brain)")
    tinfoilproxy.start()                              # (a key set from Terminal while Buddy runs: start verifying now)
    return tinfoilproxy.url()

def pick_model(preferred, fallbacks, spoken=False):
    ids = tinfoil_models()
    order = [m for m in [preferred] + fallbacks if m and (not ids or m in ids)]
    if spoken:                                        # out loud: a model that always thinks first only as a last resort
        order = [m for m in order if m not in ALWAYS_THINKS] + [m for m in order if m in ALWAYS_THINKS]
    return order[0] if order else preferred

def companion_provider(c=None):
    """Companion runs on Tinfoil (verified) unless you chose Phala (fully uncensored; trusted, not verified).
    Installs that already had a Phala key keep Phala until changed in Settings."""
    c = c or cfg()
    p = c.get("companion_provider") or ("phala" if read(".phala_key") else "tinfoil")
    return "phala" if p == "phala" and read(".phala_key") else "tinfoil"

def brain(mode, spoken=False):
    """Returns (base_url, key, model, mode_used). Raises if Tinfoil's verified connection isn't ready."""
    c = cfg()
    if mode == "companion" and companion_provider(c) == "phala":
        return PHALA, read(".phala_key"), c.get("companion_model"), "companion"
    if mode == "companion":
        return (tinfoil(), read(".tinfoil_key"), pick_model(c.get("companion_tinfoil_model"), COMPANION_MODELS, spoken),
                "companion")
    return tinfoil(), read(".tinfoil_key"), pick_model(c.get("advisor_model"), ADVISOR_MODELS, spoken), "advisor"

def alternate(msgs):
    """Strict user/assistant turns (some models reject two in a row): merge repeats, start with the user."""
    out = []
    for m in msgs:
        if m.get("role") not in ("user", "assistant") or not str(m.get("content", "")).strip():
            continue
        if out and out[-1]["role"] == m["role"]:
            out[-1] = {"role": m["role"], "content": out[-1]["content"] + "\n" + m["content"]}
        else:
            out.append({"role": m["role"], "content": m["content"]})
    if out and out[0]["role"] == "assistant":
        out.insert(0, {"role": "user", "content": "(earlier)"})
    return out

def since_last_talk(char, skip_newest=True):
    """A friend knows if it's been a while ("you've been quiet for two days").
    skip_newest: the newest message is the one being answered right now."""
    prev = [m for m in social.thread() if m["role"] in ("user", "assistant") and m.get("char", "buddy") == char]
    prev = prev[:-1] if skip_newest else prev
    if not prev:
        return ""
    gap = time.time() - prev[-1]["ts"]
    if gap < 3 * 3600:
        return ""
    return "Our last message before this was " + (f"{int(gap // 3600)} hours ago." if gap < 2 * 86400
                                                  else f"{int(gap // 86400)} days ago.")

def system_prompt(char, mode_used, user_text, chat_file, via="mac", proactive=False):
    style = {"phone": TEXTING, "call": CALLING}.get(via, SPEAKING)
    persona = char["persona"] or (read("persona.txt") if char.get("builtin")
                                  else f"You are {char['name']}, a friendly adult I can talk to. {char.get('tagline', '')}")
    parts = [persona, f"Your name is {char['name']}. You are an adult.",
             read(f"mode_{mode_used}.txt"), style,
             PHOTOS if via != "call" and images.find(cfg()) else ""]
    snippets = recall(char, user_text, chat_file, live=via == "call")
    if snippets:   # (what they mustn't know is simply kept out; the list itself is never shown to them)
        parts.append("Things you remember about me (from my notes and past chats):\n\n" + "\n\n---\n\n".join(snippets))
    now = datetime.datetime.now().strftime("%A %d %B %Y, %H:%M")
    parts.append(f"Right now it's {now}. {since_last_talk(char['id'], skip_newest=not proactive)}".strip())
    return "\n\n".join(p for p in parts if p)

_live = {}            # (device, char id) -> (stop, done): the call answer being made right now
_call_mem = {}        # (char id, what they may know) -> (time, snippets): in a call, the last full search
_call_mem_busy = set()

def recall(char, query, chat_file, live=False):
    """Notes this character may know that fit what we're on about. live (a call): no waiting on Tinfoil: keyword
    search now (on this Mac, milliseconds) plus the previous full search, which is refreshed in the background."""
    args = dict(k=cfg().get("memory_snippets", 5), exclude=chat_file, folders=characters.memory_folders(char),
                own=f"chats/{char['id']}", skip=characters.memory_skip(char), avoid=characters.avoid_terms(char))
    if not live:
        return memory.search(query, **args)
    cid = (char["id"], social.gen(char["id"]),     # (a deleted conversation's notes are never used again)
           json.dumps([args["folders"], args["skip"], args["avoid"]], sort_keys=True, default=str))
    def full():
        try: _call_mem[cid] = (time.time(), memory.search(query, embed_timeout=6, **args))
        except Exception: pass
        finally: _call_mem_busy.discard(cid)
    if cid not in _call_mem_busy:
        _call_mem_busy.add(cid); threading.Thread(target=full, daemon=True).start()
    now = memory.search(query, meaning=False, **args)
    hit = _call_mem.get(cid)
    old = hit[1] if hit and time.time() - hit[0] < 1800 else []
    return list(dict.fromkeys(now[:3] + old + now[3:]))[:args["k"]]

def warm_call(char_id):
    """A call is starting: get everything ready so the first answer doesn't wait (model list, the connection to
    Tinfoil, the notes for what you've been talking about)."""
    char = characters.get(char_id, cfg())
    try: tinfoil_models()
    except Exception: pass
    msgs = social.recent_messages(10, char=char["id"])
    query = " ".join(m["content"] for m in msgs[-5:] if m["role"] == "user")
    if query:
        recall(char, query, chat_path(char, datetime.date.today().isoformat()), live=True)

GREETINGS = ["Hey!", "Hi, you.", "Hey, what's up?", "Oh hey!", "Hi! Good timing."]
FILLERS = ["Hmm.", "Mm-hm."]          # said only when an answer is slow to come (see web/chat.html)
_stock = {}                          # (voice, text) -> (type, audio): these few lines sound the same every time
_tts_stream_refused = set()

def chat_path(char, session):
    safe = re.sub(r"[^0-9A-Za-z_-]", "", session)[:40] or "chat"
    return os.path.join(CHATS, char["id"], f"{safe}.md")      # each character's chats in its own folder

def save_turn(char, session, user_text, reply, mode_used):
    p = chat_path(char, session)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    new = not os.path.exists(p)
    with open(p, "a", encoding="utf-8") as f:
        if new:
            f.write(f"# Chat with {char['name']}, {datetime.datetime.now():%d %B %Y %H:%M}\n\n")
        f.write(f"**Me:** {user_text}\n\n**{char['name']}** ({mode_used}): {reply}\n\n")

PROACTIVE = """You're texting me first, unprompted, like a close friend would. Reason: {reason}. It's {now}; I've been
away from my Mac for about {idle} minutes. Do ONE thing, specific to me, never generic:
- follow up on something I told you or that's in my notes (a plan, a person, a worry, an event): ask how it went;
- ask a personal question a close friend would ask, tied to what you know about my life;
- bring up an interesting topic, opinion or "random thought" to chat about;
- share a small thought or something on your mind;
- or react to the time of day (morning, late night) in a caring, teasing way.
Write it like a real text message: 1-2 short sentences, casual. Don't start with "Hey" if your last texts did.
No tags or stage directions. Don't mention notes or being an AI."""

def proactive_text(reason, idle):
    """One of the characters allowed to text first (you choose which) writes to you. Returns (character id, text)."""
    c = cfg()
    allowed = [x for x in characters.all_characters(c) if x.get("texts_first")]
    if not allowed:
        return None
    char = random.choice(allowed)
    url, key, model, used = brain(char["brain"] if char["brain"] == "companion" else c.get("proactive_mode", "advisor"))
    hint = " ".join(m["content"] for m in social.recent_messages(6, char=char["id"]))
    sysmsg = system_prompt(char, used, hint or "recent plans, people, worries, events in my life", None,
                           via="phone" if idle >= 3 else "mac", proactive=True)
    body = json.dumps({"model": model, "temperature": 1.0, "messages": [{"role": "system", "content": sysmsg}]
        + alternate(social.recent_messages(20, char=char["id"]) + [{"role": "user", "content": PROACTIVE.format(
            reason=reason, idle=idle, now=datetime.datetime.now().strftime("%A %H:%M"))}])}).encode()
    with post(url + "/chat/completions", key, body) as r:
        txt = json.loads(r.read())["choices"][0]["message"]["content"] or ""
    photo = None
    if (m := PHOTO_TAG.search(txt)):
        try: photo = (images.save(images.make(cfg(), images.prompt_for(char.get("appearance", ""), m.group(1),
                                                                    style=char.get("style")))), m.group(1))
        except Exception: photo = None
    return char["id"], re.sub(r"\[[^\]]*\]|[*_#`]", "", txt).strip().strip('"'), photo

def ask(prompt, temperature=0.9):
    """A one-off question to the Advisor brain (Tinfoil enclave)."""
    url, key, model, _ = brain("advisor")
    body = json.dumps({"model": model, "temperature": temperature,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    with post(url + "/chat/completions", key, body, timeout=180) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"] or ""

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):  # no logs: keeps your words out of the terminal
        pass

    def allowed(self):
        """Only this Mac (127.0.0.1) and your own tailnet (*.ts.net via tailscale serve). Blocks other websites
        from reading your conversation through DNS-rebinding or cross-site requests, and the public internet."""
        name = self.headers.get("Host", "").rsplit(":", 1)[0] if "]" not in self.headers.get("Host", "") else ""
        if not (name in ("127.0.0.1", "localhost") or name.endswith(".ts.net")):
            self.send_error(403); return False
        if self.headers.get("Tailscale-Funnel-Request"):  # Tailscale Funnel = the public internet: never
            self.send_error(403); return False
        if self.path.startswith("/api/") and self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
            self.send_error(403); return False            # another website (even one on your tailnet) asking
        origin = self.headers.get("Origin")                # sent by browsers on cross-site requests (and POSTs)
        if origin is not None and urllib.parse.urlparse(origin).netloc not in (
                self.headers.get("Host"), self.headers.get("X-Forwarded-Host")):
            self.send_error(403); return False
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if self.command == "POST" and not (ctype == "application/json" or ctype.startswith("audio/")):
            self.send_error(415); return False            # forms/plain text could be sent cross-site without asking
        return True

    def translate_path(self, path):
        """Only files inside web/ are ever served (keys, notes and the thread live outside it)."""
        p = urllib.parse.unquote(path.split("?", 1)[0])
        if p.startswith("/icons/"):
            out = os.path.join(WEB, "default-icons", p[len("/icons/"):].lstrip("/"))
        elif p in ("/", "", "/phone", "/phone/"):           # the same chat page on the Mac and the phone
            out = os.path.join(WEB, "chat.html")
        else:
            out = os.path.join(WEB, p.lstrip("/"))
        web = os.path.realpath(WEB)
        if ".." in p or not (os.path.realpath(out) + os.sep).startswith(web + os.sep):
            return os.path.join(WEB, "chat.html")
        return out

    CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; "
           "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")             # nothing kept in browser caches
        self.send_header("Content-Security-Policy", self.CSP)     # nothing loads from anywhere else; no framing
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")   # other sites can't embed pictures/data
        super().end_headers()

    def device(self):
        """The paired device making this request (its key is in the 'buddy' cookie), or None."""
        try:
            c = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
            return devices.check(c["buddy"].value) if "buddy" in c else None
        except http.cookies.CookieError:
            return None

    def locked(self):
        """True (and answered with 401) unless a paired device is asking."""
        self.dev = self.device()
        if self.dev: return False
        self.json(401, {"error": "pair", "message": "This device isn't paired with Buddy yet."})
        return True

    def json(self, code, obj, headers=()):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        for k, v in headers: self.send_header(k, v)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def line(self, obj):
        self.wfile.write((json.dumps(obj) + "\n").encode()); self.wfile.flush()

    def start_stream(self):
        self.send_response(200); self.send_header("Content-Type", "application/x-ndjson"); self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == "/api/status" and not self.device():   # the updater's health check: alive, nothing else
            return self.json(200, {"ok": True, "pid": os.getpid(), "paired": False})
        if self.path == "/api/me":                       # is this device paired? (the page asks first)
            d = self.device()
            return self.json(200, {"paired": bool(d), "device": d})
        if self.path.startswith("/api/hello?"):           # the Mac app checking it's really talking to this Buddy.
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)   # No key needed or sent: the answer is
            return self.json(200, {"proof": devices.proof((q.get("nonce") or [""])[0][:200])})   # an HMAC of a fresh nonce
        if self.path.startswith("/api/") and self.locked():
            return
        if self.path == "/api/devices":
            return self.json(200, {"devices": devices.listing(), "me": self.dev["id"]})
        if self.path.startswith("/api/thread"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self.json(200, social.thread(int((q.get("after") or ["0"])[0])))
        if self.path == "/api/push/key":
            return self.json(200, {"key": social.vapid_public()})
        if self.path == "/api/version":                  # the phone reloads itself when this changes
            h = 0
            for f in ("chat.html", "sw.js", "manifest.json", "pcm-tap.js"):
                try: h = hash((h, os.path.getmtime(os.path.join(WEB, f)), os.path.getsize(os.path.join(WEB, f))))
                except OSError: pass
            return self.json(200, {"version": format(h & 0xFFFFFFFF, "08x")})
        if self.path == "/api/settings":
            c = cfg()
            return self.json(200, {"proactive": bool(c.get("proactive", True)), "push_ready": bool(social.vapid_public()),
                                   "phones": social.phone_count()})
        if self.path.startswith("/api/media/") or (self.path.startswith("/api/characters/") and "/avatar" in self.path):
            data = None
            if self.path.startswith("/api/media/"):
                mid = self.path.split("/")[3].split("?")[0]
                data = images.from_memory(mid)               # a photo from a private chat (memory only)
                p = images.path(mid)
            else:
                p = characters.avatar_path(self.path.split("/")[3])
            if data is None and (not p or not os.path.exists(p)):
                return self.json(404, {"error": "no picture"})
            data = data if data is not None else open(p, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg" if data[:3] == b"\xff\xd8\xff" else "image/png")
            self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            return
        if self.path == "/api/images":
            f = images.find(cfg())
            return self.json(200, {"available": bool(f), "provider": f and f["provider"]})
        if self.path == "/api/characters":
            return self.json(200, characters.all_characters(cfg()))
        if self.path == "/api/knowledge":                # folder names only, never what's in them
            return self.json(200, {"folders": memory.folders()})
        if self.path == "/api/voices":
            return self.json(200, [{"id": v, "label": l} for v, l in characters.VOICES])
        if self.path == "/api/status":
            mem = memory.health()
            c = cfg()
            return self.json(200, {"name": c.get("name"), "voice": c.get("voice"), "paired": True,
                "companion_ready": bool(read(".tinfoil_key") or read(".phala_key")), "companion_provider": companion_provider(c),
                "phala_key": bool(read(".phala_key")), "tinfoil_key": bool(read(".tinfoil_key")), "tinfoil": tinfoilproxy.status(),
                "memory_notes": mem["notes"], "memory": mem, "pid": os.getpid(),
                "synced": {"notes": synced_by(VAULT), "buddy": synced_by(HERE)}, "sync_e2e": bool(c.get("sync_e2e")),
                "tailnet": {**tailnet.status(), "on": bool(c.get("phone_tailnet"))}})
        if self.path == "/api/tailnet":                  # phone access through Buddy's own Tailscale node
            return self.json(200, {**tailnet.status(mac=self.dev["kind"] == "mac"), "on": bool(cfg().get("phone_tailnet"))})
        return super().do_GET()

    def chat(self, j):
        """In a call, one answer at a time per device and character: a new turn first stops the answer still being
        made (you cut in) and waits for it to be saved, so the conversation stays in the order things were said."""
        if j.get("via") != "call":
            return self._chat(j)
        lk = ((getattr(self, "dev", None) or {}).get("id"), str(j.get("char") or "buddy"))
        prev = _live.get(lk)
        if prev:
            prev[0].set(); prev[1].wait(3)
        live = _live[lk] = (threading.Event(), threading.Event())
        try:
            return self._chat(j, live[0])
        finally:
            live[1].set()
            if _live.get(lk) is live: _live.pop(lk, None)

    def _chat(self, j, cancel=None):
        private = bool(j.get("private", False))
        via = j.get("via") if j.get("via") in ("phone", "call") else "mac"
        char = characters.get(str(j.get("char") or "buddy"), cfg())
        user_text = str(j.get("text", "")).strip()[:4000]
        if not user_text:
            return self.json(400, {"error": "empty"})
        social.add("user", user_text, private=private, via=via, char=char["id"],
                   **({"from": "phone" if j.get("from") == "phone" else "mac"} if via == "call" else {}))
        g = social.gen(char["id"])                        # if you delete this conversation meanwhile, the reply is dropped
        msgs = social.recent_messages(30, include_private=private, char=char["id"])   # private stays out of saved chats
        heard = j.get("heard")
        if via == "call" and isinstance(heard, str):      # you cut off their last reply: they know what you heard
            last = len(msgs) - 2 if len(msgs) >= 2 and msgs[-2]["role"] == "assistant" else None
            if last is not None:
                msgs[last] = {**msgs[last], "content": (heard.strip()[:2000] + " … (you cut me off here)").strip()}
        opened = j.get("opened")
        if via == "call" and isinstance(opened, str) and opened.strip():   # what they said picking up (not saved)
            msgs = msgs[:-1] + [{"role": "assistant", "content": opened.strip()[:200]}] + msgs[-1:]
        session = datetime.date.today().isoformat()
        query = " ".join(m["content"] for m in msgs[-5:] if m["role"] == "user")   # recall what we're on about
        spoken_reply = via == "call" or (via == "mac" and j.get("spoken") is not False)   # out loud: no silent thinking
        try:
            url, key, model, mode_used = brain(j.get("mode") or char["brain"], spoken=spoken_reply)
        except RuntimeError as e:                         # e.g. Tinfoil's verified connection isn't ready yet
            self.start_stream(); self.line({"error": str(e)}); return
        sysmsg = system_prompt(char, mode_used, query, chat_path(char, session), via)
        base = {"model": model, "temperature": 0.9, "stream": True,
                "messages": [{"role": "system", "content": sysmsg}] + alternate(msgs)}
        extra = dict(NO_THINKING.get(model, {})) if spoken_reply and url != PHALA and model not in _thinking_refused else {}
        if (via == "call" and url != PHALA and model not in ALWAYS_THINKS and model not in _thinking_refused
                and (extra or model not in NO_THINKING)):
            extra["max_tokens"] = 300                     # (a call reply is a few sentences; never if it may still think)
        gone = False
        def out(obj):                                     # best effort: if you close the app, the reply still finishes
            nonlocal gone
            if gone: return
            try: self.line(obj)
            except OSError: gone = True
        self.start_stream()
        out({"mode": mode_used})
        buf, full = "", []
        photo = []
        def emit(s):
            photo.extend(PHOTO_TAG.findall(s))
            s = re.sub(r"[*_#`]|\[[^\]]{0,300}\]", "", spoken(s) if via == "call" else s).strip()   # no markdown,
            if s:                                                     # photo tags or stage directions
                full.append(s); out({"s": s})
        try:
            try:
                r = post(url + "/chat/completions", key, json.dumps({**base, **extra}).encode())
            except urllib.error.HTTPError as e:
                if e.code != 400 or not extra: raise
                r = post(url + "/chat/completions", key, json.dumps(base).encode())
                _thinking_refused.add(model)                  # it doesn't take those switches (asked plainly, it works)
            with r:
                for raw in r:
                    if via == "call" and not gone and select.select([self.connection], [], [], 0)[0]:
                        try: gone = not self.connection.recv(1, socket.MSG_PEEK)   # (the page let go of this answer)
                        except OSError: gone = True
                    if cancel is not None and cancel.is_set(): gone = True        # (your next turn started)
                    if gone and via == "call":
                        break
                    raw = raw.decode(errors="ignore").strip()
                    if not raw.startswith("data:") or raw.endswith("[DONE]"):
                        continue
                    ch = json.loads(raw[5:]).get("choices") or []
                    buf += (ch[0].get("delta", {}).get("content") or "") if ch else ""
                    while True:                               # sentence by sentence, never inside a [photo: ...]
                        m = next((x for x in re.finditer(r"(?<=[.!?…])\s+", buf)       # (nor after "Dr.", "p.m.")
                                  if buf[:x.start()].count("[") <= buf[:x.start()].count("]")
                                  and not ABBREV.search(buf[:x.start()])), None)
                        if not m: break
                        emit(buf[:m.start()]); buf = buf[m.end():]
                    if gone and via == "call":                # you hung up or cut them off: stop talking
                        break
            if not (gone and via == "call"):
                emit(buf)
        except Exception as e:                            # headers are already sent: report it in the stream
            who = "Phala" if url.startswith(PHALA) else "Tinfoil"
            code = getattr(e, "code", None)
            if who == "Tinfoil" and code in (400, 404): _models.update(at=0)   # maybe that model was retired
            out({"error": str(e) if isinstance(e, RuntimeError) else f"{who} returned {code}" if code else f"Can't reach {who}"})
        kept = bool(full) and social.add("assistant", " ".join(full), gen=g, private=private, mode=mode_used, via=via,
                                         char=char["id"]) is not None
        if kept and not private and cfg().get("save_chats", True):
            save_turn(char, session, user_text, " ".join(full), mode_used)
        if photo and via != "call":                       # a picture is coming: made privately in the background,
            out({"photo": "pending"})                     # then it appears in the conversation (the chat isn't blocked)
            def make_photo(desc=photo[0]):
                try:
                    mid = images.save(images.make(cfg(), images.prompt_for(char.get("appearance", ""), desc,
                                                                           style=char.get("style"))), private=private)
                    if social.add("assistant", "", gen=g, image=mid, photo_desc=desc, private=private, via=via,
                                  char=char["id"]) is None:
                        images.remove(mid)                # its conversation was deleted while it was being made
                except Exception:
                    social.add("assistant", "", gen=g, photo_failed=True, private=private, via=via, char=char["id"])
            threading.Thread(target=make_photo, daemon=True).start()

    def audio(self, ctype, data):
        self.send_response(200); self.send_header("Content-Type", ctype)
        if ctype == "audio/pcm": self.send_header("X-Sample-Rate", "24000")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def speak(self, j):
        """Their voice for a piece of text. stream: raw 24 kHz 16-bit mono PCM, passed on as Tinfoil makes it (the
        first words play while the rest is still being made); otherwise (or if Tinfoil won't stream) a WAV file."""
        voice = j.get("voice") if j.get("voice") in characters.VOICE_IDS else cfg().get("voice", "casual_female")
        model = "qwen3-tts" if voice[:1].isupper() else "voxtral-tts"   # Qwen voices are capitalised (Vivian, Serena…)
        text = spoken(j.get("text") or "")[:2000]
        if not text:
            self.send_response(204); self.end_headers(); return
        stock = (voice, text, j.get("stream") is True) if text in GREETINGS or text in FILLERS else None
        if stock in _stock:
            return self.audio(*_stock[stock])
        url, key, base = tinfoil() + "/audio/speech", read(".tinfoil_key"), {"model": model, "voice": voice, "input": text}
        refused = False
        if j.get("stream") is True and model not in _tts_stream_refused:
            try:
                r = post(url, key, json.dumps({**base, "response_format": "pcm", "stream_format": "audio",
                                               **({"initial_codec_chunk_frames": 4} if model == "qwen3-tts" else {})}).encode())
            except urllib.error.HTTPError as e:
                refused = e.code in (400, 422); r = None     # (anything else: a whole file this time)
            if r is not None:
                with r:
                    if "wav" in (r.headers.get("Content-Type") or ""):   # (a whole file after all)
                        data = r.read()
                        if stock: _stock[stock] = ("audio/wav", data)
                        return self.audio("audio/wav", data)
                    self.send_response(200); self.send_header("Content-Type", "audio/pcm")
                    self.send_header("X-Sample-Rate", "24000"); self.end_headers()
                    keep, read1 = [], getattr(r, "read1", r.read)
                    while True:
                        try: b = read1(8192)
                        except Exception: return                # it broke off: end ours (never an error after the headers)
                        if not b: break
                        try: self.wfile.write(b); self.wfile.flush()
                        except OSError: return                  # you stopped listening: stop making it
                        if stock: keep.append(b)
                    if stock: _stock[stock] = ("audio/pcm", b"".join(keep))
                    return
        with post(url, key, json.dumps({**base, "response_format": "wav"}).encode()) as r:
            data = r.read()
        if refused: _tts_stream_refused.add(model)          # this voice can't stream (it can make files): files from now on
        if stock: _stock[stock] = ("audio/wav", data)
        self.audio("audio/wav", data)

    def stt(self, data):
        ct = (self.headers.get("Content-Type") or "audio/mp4").split(";")[0].strip().lower()
        ext = {"audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg"}.get(ct, "mp4")
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        char = characters.find((q.get("char") or [""])[0], cfg())
        fields = {"model": "whisper-large-v3-turbo", "prompt": f"{char['name']}." if char else "",   # (names spelled right)
                  "language": str(cfg().get("language") or "")}
        b = uuid.uuid4().hex
        body = "".join(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n" for k, v in fields.items() if v)
        body = (body + f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.{ext}\"\r\n"
                f"Content-Type: {ct}\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
        with post(tinfoil() + "/audio/transcriptions", read(".tinfoil_key"), body,
                  f"multipart/form-data; boundary={b}") as r:
            self.json(200, {"text": json.loads(r.read()).get("text", "").strip()})

    def do_HEAD(self):                                    # same gate as everything else; nothing in Buddy uses HEAD
        if not self.allowed():
            return
        if self.path.startswith("/api/"):
            return self.send_error(405)
        super().do_HEAD()

    def do_POST(self):
        if not self.allowed():
            return
        data = self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 30_000_000))
        if self.path == "/api/pair":                      # a phone/tablet pairing with the code shown on the Mac
            j = json.loads(data or b"{}")
            got = devices.pair(j.get("code", ""), j.get("name", ""), "phone")
            if not got:
                return self.json(403, {"error": "That code didn't work. Make a new one on your Mac and try again."})
            token, dev = got
            secure = "; Secure" if self.headers.get("Host", "").split(":")[0].endswith(".ts.net") else ""
            return self.json(200, {"ok": True, "device": dev}, headers=[("Set-Cookie",
                f"buddy={token}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Strict{secure}")])
        if self.locked():
            return
        try:
            if self.path == "/api/pair/start":            # only the Mac app can let a new device in
                if self.dev["kind"] != "mac": return self.json(403, {"error": "pair new devices from the Mac"})
                code, ttl = devices.start_pairing()
                return self.json(200, {"code": code, "expires_in": ttl, **tailnet_address()})
            if self.path == "/api/setup/key":              # a key typed into the Mac app (never shown back, never logged)
                if self.dev["kind"] != "mac": return self.json(403, {"error": "keys can only be set on the Mac"})
                j = json.loads(data)
                if not isinstance(j, dict) or j.get("provider") not in ("tinfoil", "phala") or not isinstance(j.get("key", ""), str):
                    return self.json(400, {"error": "that doesn't look like an API key"})
                return self.json(200, {"ok": set_key(j["provider"], j.get("key", ""), remove=j.get("remove") is True)})
            if self.path in ("/api/tailnet", "/api/tailnet/signout"):   # phone access: turned on and off on the Mac
                if self.dev["kind"] != "mac": return self.json(403, {"error": "change this on the Mac"})
                if self.path == "/api/tailnet/signout":
                    save_cfg(phone_tailnet=False)
                    if not tailnet.sign_out():
                        return self.json(200, {**tailnet.status(mac=True), "on": False, "signout_failed": True})
                elif json.loads(data).get("on") is True:
                    save_cfg(phone_tailnet=True); tailnet.start()
                else:
                    save_cfg(phone_tailnet=False); tailnet.stop()
                return self.json(200, {**tailnet.status(mac=True), "on": bool(cfg().get("phone_tailnet"))})
            if self.path == "/api/devices/remove":
                if self.dev["kind"] != "mac": return self.json(403, {"error": "remove devices from the Mac"})
                return self.json(200, {"ok": devices.remove(str(json.loads(data).get("id") or ""))})
            if self.path == "/api/chat":
                return self.chat(json.loads(data))
            if self.path == "/api/speak":
                return self.speak(json.loads(data))
            if self.path.split("?")[0] == "/api/stt":
                return self.stt(data)
            if self.path == "/api/call/start":            # a call is starting: get ready (answers at once)
                cid = str(json.loads(data or b"{}").get("char") or "buddy")
                threading.Thread(target=warm_call, args=(cid,), daemon=True).start()
                return self.json(200, {"greetings": GREETINGS, "fillers": FILLERS})
            if self.path == "/api/push/subscribe":
                social.subscribe(json.loads(data), self.dev["id"]); return self.json(200, {"ok": True})
            if self.path == "/api/push/test":
                return self.json(200, {"sent": social.push("Test: Buddy can reach your phone",
                                                           cfg().get("push_contact", "mailto:buddy@example.com"))})
            if self.path == "/api/newchat":              # fresh start for that character; the thread itself stays
                char = characters.get(str(json.loads(data or b"{}").get("char") or "buddy"), cfg())
                social.add("break", "", char=char["id"]); return self.json(200, {"ok": True})
            if self.path == "/api/characters/create":    # the AI writes one or several new characters
                desc = str(json.loads(data).get("description", "")).strip()
                if len(desc) < 3:
                    return self.json(400, {"error": "describe who you want"})
                return self.json(200, {"created": characters.create(desc, cfg(), lambda p: ask(p, 1.0))})
            if self.path == "/api/characters/save":
                c = json.loads(data).get("character") or {}
                return self.json(200, {"ok": True, "character": characters.save(c, cfg(), memory.folders())})
            if self.path == "/api/characters/avatar":    # a new profile picture, made privately
                j = json.loads(data); c = characters.find(str(j.get("id") or ""), cfg())
                if not c:
                    return self.json(404, {"error": "that character doesn't exist any more"})
                scene = str(j.get("scene") or "").strip()[:200]           # optional: where/how, e.g. "at a café, laughing"
                first = not c.get("avatar")                               # the first one is the same for the same looks;
                seed = int(hashlib.md5(c["id"].encode()).hexdigest()[:6], 16) % 100000 if first else random.randrange(100000)
                try:
                    pic = images.make(cfg(), images.prompt_for(c.get("appearance", ""), (scene + ", " if scene else "")
                          + "head and shoulders portrait, looking at the camera, soft blurred background", selfie=False,
                          style=c.get("style")), seed=seed, size=1024)   # ...after that, each one is a new take
                except ValueError as e:
                    return self.json(400, {"error": str(e)})
                characters.set_avatar(c["id"], pic)
                return self.json(200, {"ok": True, "avatar": characters._avatar_version(c["id"])})
            if self.path == "/api/characters/avatar/upload":   # your own picture for them (re-encoded on your device)
                j = json.loads(data); c = characters.find(str(j.get("id") or ""), cfg())
                if not c:
                    return self.json(404, {"error": "that character doesn't exist any more"})
                try: pic = base64.b64decode(str(j.get("image") or "").split(",")[-1], validate=True)
                except Exception: pic = b""
                if not (pic[:3] == b"\xff\xd8\xff" or pic[:8] == b"\x89PNG\r\n\x1a\n") or len(pic) > 6_000_000:
                    return self.json(400, {"error": "that isn't a JPEG or PNG picture (or it's over 6 MB)"})
                characters.set_avatar(c["id"], pic)
                return self.json(200, {"ok": True, "avatar": characters._avatar_version(c["id"])})
            if self.path == "/api/characters/delete":
                j = json.loads(data); cid = j.get("id"); ok = characters.delete(cid)
                if ok and j.get("forget"): forget_char(cid)   # ...and everything you two said
                elif ok: social.add("break", "", char=cid)   # its old context never carries over
                return self.json(200, {"ok": ok})
            if self.path == "/api/characters/forget":         # delete the conversation, keep the character
                cid = str(json.loads(data).get("id") or "")
                if not characters.find(cid, cfg()): return self.json(404, {"error": "no such character"})
                return self.json(200, {"ok": True, "deleted": forget_char(cid)})
            if self.path == "/api/settings":
                j = json.loads(data)
                if "proactive" in j:
                    save_cfg(proactive=bool(j["proactive"]))
                if "sync_e2e" in j:                       # "my synced folder is end-to-end encrypted": no more warning
                    save_cfg(sync_e2e=bool(j["sync_e2e"]))
                if j.get("companion_provider") in ("tinfoil", "phala"):   # Companion: verified (Tinfoil) or uncensored (Phala)
                    save_cfg(companion_provider=j["companion_provider"])
                return self.json(200, {"ok": True})
            self.json(404, {"error": "not found"})
        except urllib.error.HTTPError as e:
            msg = "Phala" if PHALA in (e.url or "") else "Tinfoil"
            try: self.json(502, {"error": f"{msg} returned {e.code}"})
            except Exception: pass
        except (BrokenPipeError, ConnectionResetError):
            pass
        except RuntimeError as e:                              # refused on purpose (e.g. the proxy isn't yours)
            try: self.json(503, {"error": str(e)})
            except Exception: pass
        except (ValueError, KeyError, TypeError) as e:          # bad input (e.g. a fake push address)
            try: self.json(400, {"error": str(e) or type(e).__name__})
            except Exception: pass
        except Exception as e:
            try: self.json(500, {"error": type(e).__name__})
            except Exception: pass

PRIVATE_FILES = (".thread.json", ".memory_index.json", ".vapid.json", ".push_subs.json", ".tinfoil_key", ".phala_key",
                 "config.local.json", "persona.local.txt", ".devices.json", ".mac_token", ".update.log", ".update_result",
                 ".tinfoil_cache_secret", ".tinfoil_proxy.pid", ".update_from")

def tighten():
    """Files made before Buddy locked things down get owner-only permissions too (other macOS accounts can't read them):
    Buddy's own folder and private files, and the chats it saved in your notes (the rest of your notes is left alone).
    The notes folder is made on first run (owner-only), so Buddy works without Obsidian."""
    if not os.path.exists(VAULT):
        os.makedirs(VAULT, mode=0o700, exist_ok=True)
    for path, mode in [(HERE, 0o700)] + [(os.path.join(HERE, f), 0o600) for f in PRIVATE_FILES]:
        try:
            if os.path.exists(path): os.chmod(path, mode)
        except OSError: pass
    for root, dirs, files in os.walk(CHATS):
        for d in dirs + ["."]:
            try: os.chmod(os.path.join(root, d), 0o700)
            except OSError: pass
        for f in files:
            try: os.chmod(os.path.join(root, f), 0o600)
            except OSError: pass

KEY_FILES = {"tinfoil": ".tinfoil_key", "phala": ".phala_key"}

def set_key(provider, key, remove=False):
    """Saves (or removes) an API key typed into the Mac app: readable only by you, never returned or logged."""
    path = os.path.join(HERE, KEY_FILES[provider])
    if remove:
        try: os.remove(path)
        except OSError: pass
        return True
    key = str(key).strip()
    if not (16 <= len(key) <= 400) or not key.isascii() or any(ch.isspace() or not ch.isprintable() for ch in key):
        raise ValueError("that doesn't look like an API key")
    import tempfile
    fd, tmp = tempfile.mkstemp(dir=HERE, prefix=KEY_FILES[provider] + ".", suffix=".tmp")   # new, 0600, unique
    try:
        with os.fdopen(fd, "w") as f:
            f.write(key); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    if provider == "tinfoil":
        _models.update(at=0, ids=[]); images.forget_found()
        tinfoilproxy.start()                              # verify Tinfoil's enclave now that there's a key
    return True

def forget_char(cid):
    """Everything said with a character: the shared thread (both of you, private too), their photos, and the chats
    Buddy saved in your notes for them (~/Buddy/chats/<id>/). Your other notes are never touched."""
    if not re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)):
        return 0
    n = social.forget(cid)
    folder = os.path.realpath(os.path.join(CHATS, cid))
    if folder.startswith(os.path.realpath(CHATS) + os.sep) and os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    if cid == "buddy" and os.path.isdir(CHATS):           # Buddy's chats from before each character had its own folder
        for f in os.listdir(CHATS):
            p = os.path.join(CHATS, f)
            if f.endswith(".md") and os.path.isfile(p) and not os.path.islink(p):
                try: os.remove(p)
                except OSError: pass
    memory.forget_chats(cid)
    return n

def tailnet_address():
    """The address your phone opens (https://<name>.<tailnet>.ts.net/phone) and whether it's on: from Buddy's own
    Tailscale node ("buddy") when phone access is on in Buddy, else from the Tailscale app on this Mac (whose name
    becomes public in certificate logs once HTTPS is on, so it's shown)."""
    if cfg().get("phone_tailnet"):
        st = tailnet.STATE
        if st["state"] == "ready" and st["host"]:
            return {"url": f"https://{st['host']}/phone", "tailscale": True, "builtin": True, "serving": True,
                    "host": st["host"].split(".")[0]}
        return {"url": None, "tailscale": True, "builtin": True, "state": st["state"]}
    exe = next((p for p in ("/Applications/Tailscale.app/Contents/MacOS/Tailscale", shutil.which("tailscale") or "")
                if p and os.path.exists(p)), None)
    if not exe:
        return {"url": None, "tailscale": False}
    try:
        st = json.loads(subprocess.run([exe, "status", "--json"], capture_output=True, text=True, timeout=5).stdout)
        dns = (st.get("Self") or {}).get("DNSName", "").rstrip(".")
        serve = subprocess.run([exe, "serve", "status"], capture_output=True, text=True, timeout=5).stdout
        return {"url": f"https://{dns}/phone" if dns else None, "tailscale": True, "host": dns.split(".")[0],
                "serving": "12400" in serve}
    except Exception:
        return {"url": None, "tailscale": True}

if __name__ == "__main__":
    # The port first: if another Buddy is already running here, stop now, before touching its files or its proxy.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    tighten()
    devices.ensure()
    social.forget_private_on_disk()
    social.ensure_vapid()
    memory.start_background()
    social.start_proactive(cfg, proactive_text)
    import signal
    signal.signal(signal.SIGTERM, lambda *a: (tinfoilproxy.stop(), tailnet.stop(), sys.exit(0)))   # and its helpers
    if read(".tinfoil_key"):
        tinfoilproxy.start()                          # nothing contacts Tinfoil before there's a key
    if cfg().get("phone_tailnet"):
        tailnet.start()                               # nothing contacts Tailscale unless you turned phone access on
    print(f"Buddy is ready at http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
