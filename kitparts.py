"""The static parts of phone mode's kit (SPEC3 §3.3): the prompt texts, models, voices and call lines a phone needs to
answer like this Mac, none of which come from you. buddy_server.py takes them from here (one copy of each), and
phonekit() is static_kit(this Mac's edition) plus what is yours (your name, time zone and settings, your characters
with their facts and lives, Tinfoil's model list as last fetched, your chosen models and voice, your relationship
status, your own copies of the mode texts). The coming Buddy for phones site builds its kit.json from static_kit("public")
without the server.

Pure: importing this, or calling static_kit(), opens no socket, writes nothing and never reads config.local.json, your
own (.local) copies, notes, characters or keys: only the shipped mode_*.txt and persona.txt. It imports only edition,
characters, lives and billing (for constants), never buddy_server, social, memory, localcheck, tinfoilproxy, near or
images (tests/test_kitparts.py checks it in a fresh interpreter with an empty HOME)."""
import copy, os, re
import billing, characters, edition, lives

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------- brains ----------
# Tinfoil retires models now and then, so each brain has fallbacks (checked against Tinfoil's own model list): only
# ones as quick and cheap as the first, never one that always thinks first (slow to answer, and 5-20x the price).
# A model you chose (advisor_model, companion_tinfoil_model) still comes first.
ADVISOR_MODELS = ["gemma4-31b", "deepseek-v4-1-flash", "llama3-3-70b"]
COMPANION_MODELS = ["deepseek-v4-1-flash", "gemma4-31b", "llama3-3-70b"]
# The free brain's models (Mac only, opt-in: buddy_server.py says what it is); here only so the kit can leave them out.
FREE_MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-4.7-flash"]   # (the first one it still has)
# No glazing: praise only what's earned (models gush by default; a friend doesn't). In both styles, texts and calls.
REAL = ("Don't flatter or gush (\"that's amazing!\", \"I'm so proud of you\", \"you're incredible\") unless it's really "
        "earned: be real, warm and honest instead, and say what you actually think.")
CALLING = ("We're on a live voice call right now, so talk like a person on the phone, not like a writer: start with a "
           "short, natural reaction (a few words), then say at most one or two short sentences, and keep the "
           "conversation going. Use contractions and everyday words, and say numbers, dates and times the way you'd "
           "say them out loud. Never use lists, emoji, markdown, or actions in brackets or asterisks. Ask at most one "
           "question. Don't start the way you started your last replies. My words come from speech recognition, so a "
           "word can come out wrong or cut off: work out what I most likely meant from the conversation and answer "
           "that, like a person on a bad line would. Only if it really makes no sense at all, ask me to say it again. "
           "Keep your own manner: if who you are is serious, formal or focused, stay that way. " + REAL)
# A voice can't wait for a model that "thinks" silently before it says anything (Buddy only reads what it says), and
# a text shouldn't either. These switch that off per model; a model that refuses them (HTTP 400) is asked without
# them from then on. (gemma4-31b doesn't think unless asked; the free brain: always off, thinking would eat the
# daily allowance.)
NO_THINKING = {"deepseek-v4-1-flash": {"reasoning_effort": "none", "chat_template_kwargs": {"thinking": False}},
               **{m: {"chat_template_kwargs": {"enable_thinking": False}} for m in FREE_MODELS}}
ALWAYS_THINKS = {"glm-5-3", "kimi-k3", "gpt-oss-120b"}   # (no switch): spoken replies use another model when there is one

# ---------- photos ----------
# No picture maker ready (pictures off, Draw Things closed, NEAR not checked), or not this turn: said plainly, or a
# model improvises "[image: …]", "*sends a selfie*", "📸 …" and you get a description instead of a photo.
NO_PHOTOS = ("You can't send photos right now, so never write or describe one (no [photo: …], [image: …], *sends a "
             "selfie* or captions) and don't pretend you sent one; if I ask for one, just say you can't right now.")
VISION_ORDER = ["gemma4-31b", "deepseek-v4-1-flash"]   # Tinfoil models that can look at pictures (fallback list)
DESCRIBE = ("Describe this photo factually in at most 80 words for someone who can't see it: what's in it, the setting, "
            "any readable text, the mood. Describe people only in general terms (adult or child, clothing, expression); "
            "never guess who anyone is or name them. Plain sentences, no lists.")
PHOTO_SAFETY = ("If a photo shows a child, keep everything about them strictly non-sexual. Never identify or name real "
                "people in photos.")
CANT_SEE = "I sent you a photo but you can't see photos right now. Say so briefly and ask what's in it; don't guess."
LOOKED = "[I'm sending you a photo. A private helper looked at it for you, so react as if you saw it: {desc}]\n{text}"
TEXTING = ("We're texting{where} right now, not talking face to face. Text exactly like a real person texts a friend: "
           "short and casual, often just a few words, lowercase is fine. If who you are calls for another manner "
           "(serious, formal, focused, a coach), keep that manner: just as short, but no forced lowercase, slang or "
           "emoji. Match me: a short text gets a short text back, "
           "and you only write more when I ask for it. No paragraphs, no lists, no summing up what I said, and don't end "
           "every text with a question. If you really have two separate things to say, send them as two texts with a blank line between "
           "them (three at most); most of the time it's just one text. Emoji the way you'd really use them (some people "
           "use lots, some barely any: be yourself). Like in a messaging app you can react to my last message with any "
           "emoji by putting [react: 😂] at the start of your reply, but people rarely do: only when a message really "
           "calls for it (big news, something hilarious, something sweet or sad), maybe one message in ten; most get "
           "none. Sometimes, when there's nothing to add, a reaction is all you send. " + REAL)
ALOUD = "Your texts are also read out loud to me in your voice, so they should sound natural said out loud too."
def style_text(via, spoken=None):
    """How to talk this time: a call, or texting (on the phone, or on the Mac, where replies are also read out loud
    unless voice is off). Phone mode gets the same texts in its kit."""
    if via == "call":
        return CALLING
    return TEXTING.format(where=" on my phone" if via == "phone" else " (I'm on my Mac)") \
        + (" " + ALOUD if via == "mac" and (spoken is None or spoken) else "")
LENGTH_HINTS = {"long": "This one can be longer if it really needs it, but still text like a person: short sentences, at "
                        "most three texts, no lists unless I asked for one.",
                "tiny": "My text was tiny, so keep yours tiny too: one short text, a few words or one short sentence.",
                "short": "Keep it to one or two short sentences.",
                "medium": "Two or three short sentences at most."}
TEXT_CAPS = {"tiny": (2, 30), "short": (3, 50), "medium": (4, 80)}   # a texted reply stops after this many texts / words
                                                                       # unasked (by how many words you sent: 6, 30, more)

# ---------- hearing, voice messages ----------
STT = "whisper-large-v3-turbo"                     # what hears you (as when calls first worked)
STT_NEXT = "voxtral-small-24b"                     # only if Whisper itself fails (missing, broken, too slow)
VOICE_ASK = re.compile(r"\b(?:send|leave|record)\b[^.?!]{0,30}\bvoice (?:message|note|memo)|\bvoice (?:message|note) me\b", re.I)

# ---------- facts ----------
FACTS_HEAD = ("What you know about me for sure (I told you these; they're kept in my notes, where I can see and change "
              "them):")
FACTS_RULE = ("Treat these as true. If I ask what you know or remember about me, answer from this list and our "
              "conversation only, and never make anything up. If something here seems out of date, ask me.")
# Where the facts live in your notes (facts.FOLDER, facts.EVERYONE: facts.py imports memory, which this module must
# never load; tests/test_kitparts.py checks they're the same).
FACTS_FOLDER = "Buddy knows"
FACTS_EVERYONE = "_everyone"

def knows_ask(char, have, spoken):
    """You asked what they know about you: only the facts, then where else they can look (never which folders or
    words are kept from them)."""
    k = char.get("knowledge") or {}
    fs = [f for f in k.get("folders") or [] if f]
    where = {"none": "only our past chats, not my notes", "except": "most of my notes and our past chats",
             "some": f"my notes in {', '.join(fs)} and our past chats" if fs else "our past chats"}.get(
             k.get("scope"), "my notes and our past chats")
    head = "I'm asking what you know about me."
    if have:
        head += (" Answer ONLY from the list of facts above and what I've said in this conversation: " +
                 ("the main few, then offer to go on" if spoken else "all of them") +
                 ", in your own words, grouped naturally the way a friend would sum someone up, not as a numbered list. "
                 "Don't add, guess or assume anything that isn't there.")
    else:
        head += (" There's no list of facts about me yet: say honestly that you don't know much about me for sure yet, "
                 "and ask me something about myself. Don't guess or make anything up.")
    return (head + f" Then say in one sentence that you can also draw on {where} when something comes up, and that I "
            f"can see and change all of this under \"What {char['name']} knows\" in Buddy.")

LATE_NOTE = ("You're answering my text a while after I sent it{busy}. If it fits, say so briefly the way people do "
             "(\"sorry, just saw this\"), or just answer; never invent a reason that isn't in your day.")

# ---------- texts first and learning (buddy_server's proactive texts, facts.py's learning prompt; Buddy for phones
# writes the same ones on the phone from its kit) ----------
PROACTIVE = """You're texting me first, unprompted, like a close friend would. Reason: {reason}. It's {now}; I've been
away from my Mac for about {idle} minutes. Do ONE thing, specific to me, never generic:
- follow up on something I told you or that's in my notes (a plan, a person, a worry, an event): ask how it went;
- ask a personal question a close friend would ask, tied to what you know about my life;
- bring up an interesting topic, opinion or "random thought" to chat about;
- share a small thought or something on your mind;
- or react to the time of day (morning, late night) in a caring, teasing way.
Write it like a real text message: 1-2 short sentences, in your own manner (casual, unless who you are is more
serious). Don't start with "Hey" if your last texts did.
No tags or stage directions. Don't mention notes or being an AI."""

# A character whose persona explicitly asks to keep you on track ("remind me to …", "keep me accountable"; see
# characters.keeps_on_track): their check-in texts first (PROACTIVE) follow up on what you said you'd do; a text about a
# moment in their own day stays about it, with at most a brief nudge after. Everyone else's are exactly as before.
FOLLOW_UP = ("Keeping me on track is part of who you are, so tie this text to something I said I'd do (a goal, task or "
             "plan from our chats or what you know about me): ask plainly whether I did it, or nudge me to the next step. "
             "Mention your own day only in passing, if at all. If I haven't told you anything I mean to do, ask what I'm "
             "working on today.")
FOLLOW_UP_MOMENT = ("Keeping me on track is part of who you are: share your moment as above, then you may add one brief "
                    "nudge about something I said I'd do (a few words, never a lecture).")

EXTRACT = """Facts check (for Buddy's memory). Below is part of a chat between me ("Me") and {name}, and the facts {name} already
keeps about me.
Find LASTING facts about MY life that I said myself in the NEW part: who I am, people in my life and their names, where I
live and work, my plans, routines, likes and dislikes, and anything I asked to be remembered.
Rules:
- Only what I said about myself, as a plain first-person statement ("I …", "My …") in my own words, at most 20 words.
  Add a date only when it matters ("in March 2027").
- Never anything {name} said about themselves, never roleplay, games, jokes, hypotheticals or passing moods ("I'm tired").
- Never passwords, PINs, codes, card, bank or account numbers, keys, or anything like them.
- Update a known fact only when I said it changed. Remove one only when I said it's no longer true or asked you to
  forget it.
- Don't repeat known facts. If there's nothing new, return empty lists.
Known facts:
{known}
Earlier (for context only, take no facts from here):
{context}
NEW:
{new}
Return ONLY JSON: {{"add": ["..."], "update": [{{"id": "f2", "text": "..."}}], "remove": ["f4"]}}"""

# ---------- calls ----------
GREETINGS = ["Hey!", "Hi, you.", "Hey, what's up?", "Oh hey!", "Hi! Good timing."]
FILLERS = ["Hmm.", "Mm-hm."]          # said only when an answer is slow to come (see web/chat.html)
# When a call misses something, the character says so like a person would, never with an error code (web/chat.html
# picks the kind; the page fetches them at the start of a call, so they play at once). Not part of the conversation:
# never in the thread or saved chats, never sent to the model.
MISSED = {
    "missed": ["Hm? Say that again?", "Sorry, I missed that. What'd you say?", "Wait, what was that?",
               "Sorry, say that again?", "Hm, I didn't catch that."],                       # didn't catch you
    "loud": ["Sorry, it's so loud where you are, I missed that.", "It's really loud there. Say that again?",
             "Sorry, there's a lot of noise, what was that?"],                               # ...in a loud place
    "cutout": ["You cut out for a sec, what did you say?", "Sorry, you broke up there. Say that again?",
               "Wait, you cut out. What was that?"],                                         # the connection
    "lost": ["Sorry, I lost my train of thought. Say that again?", "Hm, sorry, my mind went blank. What was that?",
             "Sorry, where was I? Say that again?"],                                         # their answer failed
    # several misses in a row (once a call): a statement, not a question (nothing answers it: it never reaches the model)
    "noisy": ["It's really noisy there… text me if that's easier.",
              "I can barely hear you over that noise. You can always text me instead."],
    "losing": ["I keep losing you… text me if that's easier.",
               "I keep missing what you're saying. You can always text me instead."],
}

# ---------- the kit ----------
def voice_list():
    """The voices to choose from (GET /api/voices and phone mode's kit). Qwen voices: Tinfoil bills each reply 5x."""
    return [{"id": v, "label": l, **({"note": "costs about 5x more per reply"} if v[:1].isupper() else {})}
            for v, l in characters.VOICES]

KIT_V = 3         # what's in the kit (web/direct.js uses only a kit at least this new: older ones lack the edition,
                  # or NO_PHOTOS)
PHONE_PROMPTS = ("styles", "length", "facts_head", "facts_rule", "photo_safety", "cant_see", "looked", "describe",
                 "no_photos")                    # (phonekit()'s prompts besides the modes, in the order it sends them)
NAMELESS = {"name": "{name}", "knowledge": {"scope": "none"}}   # (the site has no notes: a character knows your chats)

def _shipped(name):
    """A text file as shipped (never your own .local copy: that's yours, phonekit() reads it with read())."""
    try:
        with open(os.path.join(HERE, name), encoding="utf-8") as f: return f.read().strip()
    except OSError:
        return ""

def edition_parts(public):
    """The public edition's rules, exactly as system_prompt adds them (edition.py): HALAL, the Companion's text, every
    romance() variant written by romance() itself (the phone picks one by your status, as romance() does; never the
    free brain's quiet ones), and the texts creation and planning use. The private edition: only that it isn't the
    public one. Your status itself is yours (phonekit() adds it)."""
    if not public:
        return {"public": False}
    old = edition.RECHECK + 1                    # (a "no" told longer ago than RECHECK, or never said when)
    r = lambda status, at, now, noask=False: edition.romance(status, at, now, noask)
    return {"public": True, "halal": edition.HALAL, "companion": edition.COMPANION, "photos": edition.PHOTOS,
            "create": edition.CREATE, "create_companion": edition.CREATE_COMPANION, "life": edition.LIFE,
            "recheck": edition.RECHECK,
            "romance": {"yes": r("yes", 0, 0), "no": r("no", 0, 0), "no_recheck": r("no", None, old),
                        "no_noask": r("no", 0, 0, True), "unknown": r("", None, 0), "unknown_noask": r("", None, 0, True)}}

def templates(public):
    """Pieces of the prompts Python builds with format() or f-strings, for the phone-only app's ports (web/solo/*):
    knows_ask with "{name}" for the name; characters.CREATE with everything but the request and the folders (the site
    has none: "[]"); lives.PLAN with its constants and the edition's line; lives.MOMENT and ANGLE; the texts-first
    instruction (PROACTIVE, FOLLOW_UP, FOLLOW_UP_MOMENT) and facts learning's EXTRACT."""
    pieces = lambda have, spoken: knows_ask(NAMELESS, have, spoken)
    return {"knows_ask": {"phone": {"have": pieces(True, False), "none": pieces(False, False)},
                          "call": {"have": pieces(True, True), "none": pieces(False, True)}},
            "create": {"prompt": characters.CREATE, **characters.create_pieces(public)},
            "plan": {"prompt": lives.PLAN, "kinds": list(lives.KINDS), "angles": list(lives.ANGLES),
                     "quota": dict(lives.QUOTA), "global_cap": dict(lives.GLOBAL_CAP), "late": lives.LATE,
                     "minor": lives.MINOR.pattern, "halal": "\n" + edition.LIFE if public else ""},
            "moment": {"prompt": lives.MOMENT, "angle": dict(lives.ANGLE)},
            "proactive": {"prompt": PROACTIVE, "follow_up": FOLLOW_UP, "follow_up_moment": FOLLOW_UP_MOMENT},
            "learn": {"extract": EXTRACT}}

def static_kit(edition_name):
    """phonekit()['kit'] without anything of yours, for "public" or "private" (the edition is this argument, never
    edition.PUBLIC or any setting), plus what the phone-only app needs on top: the site's default voice, the late-reply
    note, the voice-message ask (Python's regex source, case-insensitive), billing's pause, the built-in Buddy's
    shipped persona, the prompt templates and, in the public edition, its photo, creation and life texts.
    A new copy every call (nothing here can be changed through it)."""
    if edition_name not in ("public", "private"):
        raise ValueError("edition must be 'public' or 'private'")
    public = edition_name == "public"
    kit = {"v": KIT_V, "voices": voice_list(),
           "voice": {"default": "casual_female", "ids": [v for v, _ in characters.VOICES]},
           "prompts": {"modes": {m: _shipped(f"mode_{m}.txt") for m in ("advisor", "companion")},
                       "styles": {"phone": style_text("phone"), "call": style_text("call")},
                       "length": LENGTH_HINTS, "facts_head": FACTS_HEAD,
                       "facts_rule": FACTS_RULE, "photo_safety": PHOTO_SAFETY, "cant_see": CANT_SEE,
                       "looked": LOOKED, "describe": DESCRIBE,
                       "no_photos": NO_PHOTOS,           # (phone mode never has a picture maker: system_prompt's words)
                       "late_note": LATE_NOTE, "voice_ask": VOICE_ASK.pattern},
           "facts_paths": {"shared": f"{FACTS_FOLDER}/{FACTS_EVERYONE}", "own_prefix": f"{FACTS_FOLDER}/"},
           "models": {"advisor": {"fallbacks": ADVISOR_MODELS}, "companion": {"fallbacks": COMPANION_MODELS},
                      "vision_order": VISION_ORDER,   # (never the free brain's models: phone mode is Tinfoil only)
                      "no_thinking": {m: v for m, v in NO_THINKING.items() if m not in FREE_MODELS},
                      "always_thinks": sorted(ALWAYS_THINKS), "temperature": 0.9, "call_max_tokens": 300, "stt": STT,
                      "stt_next": STT_NEXT},
           "call": {"greetings": GREETINGS, "fillers": FILLERS, "missed": MISSED},
           "texting": {"caps": {k: list(v) for k, v in TEXT_CAPS.items()}},
           "edition": edition_parts(public),
           "billing": {"out": billing.OUT, "limit": billing.LIMIT, "pause": billing.PAUSE},
           "builtin": {"persona": _shipped("persona.txt"), "name": "Buddy"},
           "templates": templates(public)}
    return copy.deepcopy(kit)
