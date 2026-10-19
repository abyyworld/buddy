"""Each character's own life, one day at a time: what they did today, who's in their life, what's going on lately,
and the moments they text you about. One model call per character per day plans it (in the morning, or on your first
chat with them that day); everything else is built from the log without a call.

The log lives in my-characters/lives/<id>.json (git-ignored via my-characters/, dir 0700, files 0600), never in the vault,
so the memory index never mixes a character's life with notes about you, and nothing about you is ever written into it
(lines about "you" are dropped). Characters may know each other (_world.json: you decide per pair, or the AI does when it
fits); then they hear about each other's days, never about what you told the other one.

Pure logic here; the model call, the thread and the scheduler loop are passed in (buddy_server.py, social.py).
Tested by tests/test_lives.py with fake data only."""
import datetime, hashlib, json, os, random, re, threading, time
import edition

HERE = os.path.dirname(os.path.abspath(__file__))
LIVES = os.path.join(HERE, "my-characters", "lives")
MAX_DAYS, MAX_WEEKS, MAX_MONTHS = 14, 12, 24          # detail for two weeks, then week and month summaries
FOLD_DAYS, FOLD_WEEKS = 7, 4
KINDS = ("mundane", "work", "social", "hobby", "errand", "rest", "notable", "setback")
ANGLES = ("share", "vent", "ask", "photo", "voice", "about_you")
QUOTA = {"few": 1, "some": 2, "lots": 4}               # moments a day per texting character ("some" sometimes 3)
GLOBAL_CAP = {"few": 3, "some": 6, "lots": 10}         # texts first a day, all characters together
LATE = 90 * 60                                         # a moment not sent within 90 min is let go (no bursts after sleep)
DAY_STARTS = 4                                         # 00:00-03:59 still belongs to yesterday (night owls)
OWNER = re.compile(r"(?<![\w'])(?:you|your|yours|you're|youre|you've|you'll|u|ur|the user)(?![\w'])", re.I)
HHMM = re.compile(r"^\s*([01]?\d|2[0-3])[:.h]([0-5]\d)\s*$")
# images.MINOR without its "at 7" branch (in a day log that is a time, not an age). Conservative on purpose: an entry
# that mentions a minor at all is dropped, so an uncensored (Companion) character's life never has one in it.
MINOR = re.compile(r"\b(child(ren)?|kids?|toddlers?|teen(age[rd]?|s)?|minors?|under ?age|school ?(girl|boy|uniform)s?|"
                   r"high ?school|little (girl|boy)|young (girl|boy)|(1[0-7]|[1-9]) ?(yo|y/o|years? ?old)|"
                   r"aged? (1[0-7]|[1-9])\b|preteen|loli(ta)?|shota|child-?like|jailbait|barely legal|young-looking)\b", re.I)
_lock = threading.RLock()       # (load-change-save of a log or of who knows whom is one step)

def _s(x, n):
    """One clean line: no tags, markdown or newlines, at most n characters."""
    return re.sub(r"\s+", " ", re.sub(r"\[[^\]]*\]|[*_#`]", "", str(x or ""))).strip()[:n]

def _mine(text):
    """About their own (adult) life, never about me: anything addressed to or about "you", or mentioning a minor,
    is dropped."""
    return bool(text) and not OWNER.search(text) and not MINOR.search(text)

def _own_sentences(text, n):
    return _s(" ".join(s for s in re.split(r"(?<=[.!?])\s+", _s(text, 2000)) if _mine(s)), n)

# ---------- storage ----------
def path(cid):
    return os.path.join(LIVES, cid + ".json") if re.fullmatch(r"[a-z0-9-]{1,40}", str(cid)) else None

def empty(cid):
    return {"v": 1, "char": cid, "sig": "", "about": [], "people": [], "ongoing": [], "days": [], "weeks": [],
            "months": [], "calls": {}, "edited": 0, "attempt": {"date": "", "n": 0, "at": 0}}

def load(cid):
    p = path(cid)
    try:
        with open(p) as f: return clean(json.load(f), cid)
    except Exception: return empty(cid)

def save(cid, log):
    p = path(cid)
    if not p: raise ValueError("bad id")
    with _lock:
        os.makedirs(LIVES, mode=0o700, exist_ok=True); os.chmod(LIVES, 0o700)
        tmp = p + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f: json.dump(clean(log, cid), f)
        os.replace(tmp, p)

def change(cid, fn):
    """Loads their log, changes it with fn(log) -> log and saves it, all in one step (edits, plans and the scheduler
    never overwrite each other). Returns the saved log."""
    with _lock:
        log = clean(fn(load(cid)), cid); save(cid, log); return log

def delete(cid):
    try: os.remove(path(cid)); return True
    except (OSError, TypeError): return False

# ---------- who knows whom (my-characters/lives/_world.json) ----------
WORLD = os.path.join(LIVES, "_world.json")              # (no character id has a "_")

def pair(a, b):
    return "+".join(sorted((a, b)))

def world():
    """{"a+b": {"know": True|False|None, "how": "...", "by": "you"|"ai"}}. None: not decided yet (the AI decides when it
    plans one of their days); "by": "you" is never changed by the AI."""
    try:
        with open(WORLD) as f: w = json.load(f)
    except Exception: return {}
    out = {}
    for k, v in (w.items() if isinstance(w, dict) else []):
        if isinstance(v, dict) and re.fullmatch(r"[a-z0-9-]{1,40}\+[a-z0-9-]{1,40}", str(k)):
            know = v.get("know") if v.get("know") in (True, False) else None
            out[k] = {"know": know, "how": _s(v.get("how"), 90) if know else "", "by": "you" if v.get("by") == "you" else "ai"}
    return out

def save_world(w):
    with _lock:
        os.makedirs(LIVES, mode=0o700, exist_ok=True); os.chmod(LIVES, 0o700)
        tmp = WORLD + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f: json.dump(w, f)
        os.replace(tmp, WORLD)

def set_tie(a, b, know, how="", by="you"):
    """You (or the AI, by="ai") decide whether two characters know each other. know None: let the AI decide again."""
    if a == b or not (path(a) and path(b)): return False
    with _lock:
        w = world(); k = pair(a, b)
        if by == "ai" and k in w: return False        # (decided already: by you, or by an earlier plan)
        if know is None and by == "you": w.pop(k, None)
        else: w[k] = {"know": bool(know), "how": _s(how, 90) if know else "", "by": by}
        save_world(w); return True

def forget_ties(cid):
    with _lock:
        w = world()
        left = {k: v for k, v in w.items() if cid not in k.split("+")}
        if left != w: save_world(left)

def ties(cid, chars, w=None):
    """[(other character, how)] for the characters with a life of their own this one knows."""
    w = world() if w is None else w
    return [(c, w[pair(cid, c["id"])]["how"]) for c in chars if c["id"] != cid and c.get("life", True)
            and w.get(pair(cid, c["id"]), {}).get("know")]

def undecided(cid, chars, w=None):
    w = world() if w is None else w
    return [c for c in chars if c["id"] != cid and c.get("life", True) and pair(cid, c["id"]) not in w][:6]

def decide(cid, j, others):
    """The plan's "know" answers for the undecided pairs (by name; anything else is ignored)."""
    by_name = {c["name"].strip().lower(): c for c in others}
    for k in (j.get("know") or [])[:8] if isinstance(j.get("know"), list) else []:
        c = isinstance(k, dict) and by_name.get(str(k.get("name", "")).strip().lower())
        if c and isinstance(k.get("know"), bool):
            how = _s(k.get("how"), 90)
            set_tie(cid, c["id"], k["know"], how if _mine(how) else "", by="ai")

def _without(lg, avoid):
    """A friend's log minus every line that mentions something this character mustn't know about (their "doesn't
    know about" list: names, places, topics), so nothing reaches them through a friend either."""
    if not avoid: return lg
    pat = re.compile(r"(?<![\w])(?:" + "|".join(re.escape(t) for t in avoid) + r")(?![\w])", re.I)
    ok = lambda t: not pat.search(t or "")
    lg = json.loads(json.dumps(lg))
    lg["ongoing"] = [o for o in lg["ongoing"] if ok(o["what"])]
    for d in lg["days"]:
        d["summary"] = d["summary"] if ok(d["summary"]) else ""
        d["events"] = [e for e in d["events"] if ok(e["what"]) and ok(e["plan"])]
    return lg

def friends_text(cid, chars, logs, now, w=None, avoid=()):
    """For planning: what the friends they share with me did lately (only their own lives: never what I told them)."""
    today = life_date(now).isoformat()
    lines = []
    for c, how in ties(cid, chars, w):
        lg = _without(logs.get(c["id"]) or empty(c["id"]), avoid)
        bits = [f"{c['name']} ({how or 'a friend'})"]
        if lg["ongoing"]: bits.append("lately: " + "; ".join(o["what"] for o in lg["ongoing"][:2]))
        past = [d for d in lg["days"] if d["date"] < today and d["summary"]]
        if past: bits.append("recently: " + past[-1]["summary"])
        d = day(lg, life_date(now))
        if d and d["events"]:
            bits.append("today: " + "; ".join(f"{e['at']} {e['plan'] or e['what']}" for e in d["events"][:6]))
        lines.append("- " + ", ".join(bits))
    if not lines: return ""
    return ("\nFriends of yours I also talk to (you know them in real life; their days are real too):\n" + "\n".join(lines)
            + "\nNow and then (not every day) you can do something with one of them, only if it fits their day too, "
            "and mention them like friends do. Never say what I might have told them.")

# ---------- when you usually text (learned from the times of your own messages only, never their words) ----------
def rhythm(msgs, now, days=28):
    """hour (0-23) -> share of the days you've written in that hour, over the last `days` days with any message from
    you. None until there are 5 such days (not enough to learn from yet)."""
    seen, hours = set(), {}
    for m in msgs:
        ts = float(m.get("ts") or 0)
        if m.get("role") != "user" or m.get("via") == "call" or now - ts > days * 86400: continue
        t = time.localtime(ts); d = (t.tm_year, t.tm_yday)
        seen.add(d); hours.setdefault(t.tm_hour, set()).add(d)
    if len(seen) < 5: return None
    return {h: len(hours.get(h, ())) / len(seen) for h in range(24)}

def active_text(rh, cfg):
    """"12-13h, 19-22h": the hours you're around on at least a third of your days (outside quiet hours)."""
    if not rh: return ""
    on = [h for h in range(24) if rh[h] >= 0.34 and not quiet_at(_at_hour(h), cfg)]
    spans, a = [], None
    for h in on + [99]:
        if a is None: a = b = h
        elif h == b + 1: b = h
        else: spans.append((a, b)); a = b = h
    return ", ".join(f"{a}-{b + 1}h" for a, b in spans if a != 99)[:80]

def _at_hour(h):
    t = time.localtime(); return time.mktime((t.tm_year, t.tm_mon, t.tm_mday, h, 30, 0, 0, 0, -1))

def nudge(due, rh, cfg, earliest, rnd=random):
    """Moves a text to when you're more likely around (up to 90 min either way), never before `earliest` or into quiet
    hours. No change without a rhythm."""
    if not rh: return due
    best, score = due, rh[time.localtime(due).tm_hour]
    for step in range(-6, 7):
        t = due + step * 15 * 60
        sc = rh[time.localtime(t).tm_hour] - abs(step) * 0.01
        if t >= earliest and not quiet_at(t, cfg) and sc > score + 0.1: best, score = t, sc
    if best == due: return due
    j = best + rnd.uniform(-8, 8) * 60                 # (not always on the quarter hour)
    return j if j >= earliest and not quiet_at(j, cfg) else best

def _hhmm(x):
    m = HHMM.match(str(x or ""))
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None

def clean(log, cid):
    """Only bounded, well-formed values are kept (also for edits made in the app). Hard cap ~40 KB per character."""
    log = log if isinstance(log, dict) else {}
    out = empty(cid)
    out["sig"] = _s(log.get("sig"), 32)
    out["about"] = [t for t in (_s(x, 160) for x in (log.get("about") or [])[:12]) if _mine(t)]
    out["people"] = [{"name": _s(p.get("name"), 30), "who": _s(p.get("who"), 80)} for p in (log.get("people") or [])[:8]
                     if isinstance(p, dict) and _s(p.get("name"), 30) and _mine(_s(p.get("who"), 80))]
    out["ongoing"] = [{"what": _s(o.get("what"), 160), "since": _s(o.get("since"), 10)} for o in (log.get("ongoing") or [])[:5]
                      if isinstance(o, dict) and _mine(_s(o.get("what"), 160))]
    days = []
    for d in (log.get("days") or [])[-(MAX_DAYS + FOLD_DAYS):]:
        if not isinstance(d, dict) or not re.fullmatch(r"\d{4}-\d\d-\d\d", str(d.get("date", ""))): continue
        ev = [{"id": e["id"] if re.fullmatch(r"e\d{1,2}", str(e.get("id"))) else f"e{i + 1}",   # (ids stay put:
               "at": _hhmm(e.get("at")) or "12:00", "what": _s(e.get("what"), 140),          # moments point at them)
               "mood": _s(e.get("mood"), 30), "kind": e.get("kind") if e.get("kind") in KINDS else "mundane",
               "plan": _s(e.get("plan"), 60)}                     # how they'd mention it beforehand ("" = a surprise)
              for i, e in enumerate(x for x in (d.get("events") or [])[:8] if isinstance(x, dict))]
        ev = [e for e in ev if _mine(e["what"]) and not OWNER.search(e["plan"])]
        ids = {e["id"] for e in ev}
        mo = [{"id": _s(m.get("id"), 6) or f"m{i + 1}", "event": m.get("event") if m.get("event") in ids else None,
               "at": _hhmm(m.get("at")) or "12:00", "due": float(m.get("due") or 0),
               "angle": m.get("angle") if m.get("angle") in ANGLES else "share",
               "state": m.get("state") if m.get("state") in ("pending", "sent", "skipped") else "skipped",
               "msg": m.get("msg") if isinstance(m.get("msg"), int) else None}
              for i, m in enumerate(x for x in (d.get("moments") or [])[:5] if isinstance(x, dict))]
        days.append({"date": d["date"], "to": _s(d.get("to"), 10), "summary": _own_sentences(d.get("summary"), 300),
                     "final": bool(d.get("final")), "moments": mo,
                     "events": sorted(ev, key=lambda e: (int(e["at"][:2]) < DAY_STARTS, e["at"])),   # (00:30 is late)
                     "planned": float(d.get("planned") or 0), "tries": int(d.get("tries") or 0)})
    out["days"] = sorted(days, key=lambda d: d["date"])
    out["weeks"] = [{"from": _s(w.get("from"), 10), "to": _s(w.get("to"), 10), "summary": _own_sentences(w.get("summary"), 400)}
                    for w in (log.get("weeks") or [])[-(MAX_WEEKS + FOLD_WEEKS):] if isinstance(w, dict)]
    out["months"] = [{"month": _s(m.get("month"), 7), "summary": _own_sentences(m.get("summary"), 500)}
                     for m in (log.get("months") or [])[-MAX_MONTHS:] if isinstance(m, dict)]
    out["calls"] = {k: int(v) for k, v in list((log.get("calls") or {}).items())[-3:]
                    if re.fullmatch(r"\d{4}-\d\d-\d\d", str(k)) and isinstance(v, int)}
    out["edited"] = float(log.get("edited") or 0)
    a = log.get("attempt") if isinstance(log.get("attempt"), dict) else {}
    out["attempt"] = {"date": a.get("date") if re.fullmatch(r"\d{4}-\d\d-\d\d", str(a.get("date", ""))) else "",
                      "n": int(a.get("n") or 0) if str(a.get("n") or 0).isdigit() else 0, "at": float(a.get("at") or 0)}
    return out

# ---------- time ----------
def life_date(now):
    return (datetime.datetime.fromtimestamp(now) - datetime.timedelta(hours=DAY_STARTS)).date()

def quiet_at(ts, cfg):
    """Same rule as social._quiet, for any moment (not just now)."""
    t = time.localtime(ts); h = t.tm_hour + t.tm_min / 60
    a, b = cfg.get("quiet_from", 23.0), cfg.get("quiet_until", 8.5)
    return (h >= a or h < b) if a > b else (a <= h < b)

def _ts(date, hhmm):
    """Local wall-clock time on that date -> epoch (DST handled by the OS; 00:00-03:59 is the next calendar day)."""
    h, m = map(int, hhmm.split(":"))
    d = date + datetime.timedelta(days=1) if h < DAY_STARTS else date
    return datetime.datetime(d.year, d.month, d.day, h, m).timestamp()

def _late(hhmm):
    """"01:30" -> "25:30": times after midnight still belong to the day before (DAY_STARTS)."""
    return hhmm if int(hhmm[:2]) >= DAY_STARTS else f"{int(hhmm[:2]) + 24}{hhmm[2:]}"

def happened(e, now):
    """Has this event of today happened yet (by the clock)?"""
    return _late(e["at"]) <= _late(time.strftime("%H:%M", time.localtime(now)))

def edit(log, cid, j, now):
    """Your changes from the app (they're canon): about, people, going on lately, a day's summary, events removed.
    Moments about a removed event aren't sent."""
    log = clean(log, cid)
    if isinstance(j.get("about"), list): log["about"] = j["about"]
    if isinstance(j.get("people"), list): log["people"] = j["people"]
    if isinstance(j.get("ongoing"), list):
        log["ongoing"] = [o if isinstance(o, dict) else {"what": o, "since": ""} for o in j["ongoing"]]
    days = j.get("days") if isinstance(j.get("days"), dict) else {}
    drop = {str(x) for x in j.get("drop") or []} if isinstance(j.get("drop"), list) else set()
    for d in log["days"]:
        if isinstance(days.get(d["date"]), str): d["summary"] = days[d["date"]]
        d["events"] = [e for e in d["events"] if f"{d['date']}/{e['id']}" not in drop]
        ids = {e["id"] for e in d["events"]}
        for m in d["moments"]:
            if m["event"] and m["event"] not in ids and m["state"] == "pending": m["state"] = "skipped"
    log["edited"] = now
    return clean(log, cid)

def day(log, date):
    return next((d for d in log["days"] if d["date"] == date.isoformat()), None)

# ---------- what they know of their own life, in every chat and call ----------
def context(log, now, short=False, friends=(), avoid=()):
    """The block system_prompt() adds. No model call: built from the log in microseconds (fine for calls).
    friends: [(name, how, their log)] for my other characters they know: what those did lately, as far as it's
    happened (their own lives only)."""
    today = life_date(now)
    d = day(log, today)
    hm = time.strftime("%H:%M", time.localtime(now))
    hm = hm if time.localtime(now).tm_hour >= DAY_STARTS else str(int(hm[:2]) + 24) + hm[2:]   # (after midnight)
    def key(e): return e["at"] if int(e["at"][:2]) >= DAY_STARTS else str(int(e["at"][:2]) + 24) + e["at"][2:]
    lines = ["YOUR OWN LIFE (this is about you, not me; never mix it up with what you know about me):"]
    if log["about"]:
        lines.append("About you: " + " ".join(t.rstrip(".") + "." for t in log["about"][:4 if short else 12]))
    if log["people"] and not short:
        lines.append("People in your life (all fictional): " + "; ".join(f"{p['name']} ({p['who']})" for p in log["people"]))
    if log["ongoing"]:
        lines.append("Going on lately: " + "; ".join(o["what"] for o in log["ongoing"]))
    past = [x for x in log["days"] if x["date"] < today.isoformat() and x["summary"]]
    if log["weeks"] and not short:
        lines.append("Earlier: " + " ".join(w["summary"] for w in log["weeks"][-2:]))
    for x in past[-(2 if short else 6):]:
        dd = datetime.date.fromisoformat(x["date"])
        label = "Yesterday" if dd == today - datetime.timedelta(days=1) else dd.strftime("%A %d %B")
        lines.append(f"{label}{' to ' + x['to'] if x['to'] else ''}: {x['summary']}")
    if d:
        texted = {m["event"] for m in d["moments"] if m["state"] == "sent"}
        done = [e for e in d["events"] if key(e) <= hm]
        later = [e for e in d["events"] if key(e) > hm and e["plan"]]   # surprises aren't known in advance
        if done:
            lines.append("Today so far: " + "; ".join(
                f"{e['at']} {e['what']}" + (f" ({e['mood']})" if e["mood"] else "")
                + (" [you already texted me about this]" if e["id"] in texted else "") for e in done))
        if later:
            lines.append("Later today (plans, can change): " + "; ".join(f"{e['at']} {e['plan']}" for e in later[:2 if short else 4]))
        if done and key(done[-1]) > f"{max(int(hm[:2]) - 2, 0):02d}{hm[2:]}" and done[-1]["kind"] != "rest":
            lines.append(f"Latest ({done[-1]['at']}): {done[-1]['what']}. You may still be busy with it or just done: "
                         "if it fits, say so like a friend texting from there would.")
    for name, how, lg in list(friends)[:4]:
        lg, bits = _without(lg, avoid), []
        if lg["ongoing"] and not short: bits.append("lately " + "; ".join(o["what"] for o in lg["ongoing"][:2]))
        past = [x for x in lg["days"] if x["date"] < today.isoformat() and x["summary"]]
        if past: bits.append("recently: " + past[-1]["summary"])
        fd = day(lg, today)
        seen = [e for e in (fd["events"] if fd else []) if key(e) <= hm]
        if seen: bits.append("today: " + "; ".join(e["what"] for e in seen[-3:]))
        lines.append(f"Your friend {name} ({how or 'you know each other'}), whom I also talk to: "
                     + (", ".join(bits) if bits else "nothing new you know of") + ".")
    if len(lines) == 1:
        return ""
    lines.append("Talk about your own day the way a friend does: when it fits or when I ask, not in every message. "
                 "Details you add must fit this and then stay true. I wasn't part of any of it, and your life doesn't "
                 "revolve around me. (Never inventing memories is about me and my life; your own days are written "
                 "here, and anything you add to them is fine as long as it fits.)"
                 + (" What I talk about with your friends is between me and them: you never know it." if friends else ""))
    return "\n".join(lines)

def slim(log, now, friend=False):
    """What context() reads of a log, for phone mode's kit: every day from the day before life_date(now) on, plus
    the newest older days that have a summary (6 of them; 1 for a friend). context() then gives the same block as with
    the whole log, at any time from that day on. A friend's copy keeps only what the friend part reads."""
    edge = (life_date(now) - datetime.timedelta(days=1)).isoformat()
    old = [d for d in log["days"] if d["date"] < edge and d["summary"]][-(1 if friend else 6):]
    ev = ("at", "what") if friend else ("id", "at", "what", "mood", "kind", "plan")
    return {"about": [] if friend else list(log["about"]), "people": [] if friend else list(log["people"]),
            "ongoing": [{"what": o["what"]} for o in log["ongoing"][:2]] if friend else list(log["ongoing"]),
            "weeks": [] if friend else list(log["weeks"][-2:]),
            "days": [{"date": d["date"], "to": "" if friend else d["to"], "summary": d["summary"],
                      "events": [{k: e[k] for k in ev} for e in d["events"]],
                      "moments": [] if friend else [{"event": m["event"], "state": m["state"]} for m in d["moments"]]}
                     for d in old + [d for d in log["days"] if d["date"] >= edge]]}

# ---------- planning a day (one model call per character per day) ----------
PLAN = """You are {name}. Here's who you are:
{persona}

You're an adult living your own ordinary life. Write YOUR day today, {date} ({weekday}), as JSON. It's {now} where you
live ({tz}). {season}
{about}{people}{ongoing}{recent}{yesterday}{gap}{told_today}{fold}{friends}{strangers}
Rules:
- Write it like your own diary, in the first person ("I", "my"). "You" always means me, the person you text.
- 4 to 7 events from waking up to bed, in time order. "what": one short line, as it happened ("overslept, cold
  shower"). "plan": how you'd mention it beforehand ("run after work"), or "" if it's a surprise.
- Realistic and varied: mostly ordinary things (work, errands, food, chores, friends, hobbies, rest), at most one
  notable thing, now and then a small setback.{weekend} Don't repeat these recent events: {avoid}.
- Everyone in your life is fictional: never a real, famous or public person, and no real news, weather or events.
- You are an adult, and so is everyone in your day (25 or older): no children or teens in it at all.{halal}
- I'm NOT part of your day: never mention me or "you", never invent anything about me or my life.
- "ongoing": the 0-5 things running through your life lately (keep, update, finish or add at most one new).
{moments}
Reply with ONLY this JSON:
{{"today": {{"summary": "one line: the shape of my day", "events": [{{"at": "HH:MM", "what": "...", "plan": "...",
  "mood": "one word", "kind": one of {kinds}}}]}}, "moments": [{{"at": "HH:MM", "event": 1, "angle": "share"}}],
 "ongoing": [{{"what": "...", "since": "YYYY-MM-DD"}}]{ask_about}{ask_yesterday}{ask_gap}{ask_fold}{ask_know}}}"""

def tz_name():
    """This Mac's time zone name (e.g. Europe/Berlin), from the system setting: nothing is looked up online."""
    z = os.environ.get("TZ") or os.path.realpath("/etc/localtime")
    return z.split("zoneinfo/")[-1] if "zoneinfo/" in z else (z or time.strftime("%Z"))

def _season(now):
    m = time.localtime(now).tm_mon
    south = tz_name().startswith(("Australia/", "Pacific/Auckland", "America/Argentina", "America/Santiago",
                                  "America/Sao_Paulo", "Africa/Johannesburg"))
    s = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][m - 1]
    if south: s = {"winter": "summer", "summer": "winter", "spring": "autumn", "autumn": "spring"}[s]
    return f"It's {s}."

def sig(char):
    return hashlib.sha256((char.get("persona", "") + "\n" + char.get("life_seed", "")).encode()).hexdigest()[:16]

def plan_prompt(char, log, now, cfg, own_msgs_yesterday=(), n_moments=2, photos=False, own_msgs_today=(),
                friends="", strangers=(), active="", voice=False):
    """own_msgs_yesterday: what this character said to me yesterday (not private), so what they improvised
    becomes canon. own_msgs_today: the same for today, when the day is planned late (lazily, on the first chat).
    friends: friends_text() (my other characters they know). strangers: (name, tagline) of my other characters whose
    tie to them isn't decided yet: the reply says whether they know each other. active: when I usually text
    (active_text()). Returns (prompt, fold) where fold says which old entries the reply also summarises."""
    today = life_date(now)
    prev = [d for d in log["days"] if d["date"] < today.isoformat()]
    last = prev[-1] if prev else None
    yday = today - datetime.timedelta(days=1)
    n_days = len(log["days"]) + (0 if day(log, today) else 1)          # (today's entry is added by apply_plan)
    fold = {"days": n_days > MAX_DAYS}
    fold["weeks"] = len(log["weeks"]) + fold["days"] > MAX_WEEKS
    q = cfg.get("quiet_until", 8.5); qf = cfg.get("quiet_from", 23.0)
    first = max(q, time.localtime(now).tm_hour + time.localtime(now).tm_min / 60 + 0.25)
    fmt = lambda h: f"{int(h) % 24:02d}:{int(round((h % 1) * 60)) % 60:02d}"
    recent = [f"- {d['date']}: {d['summary']}" for d in prev[-3:] if d["summary"]]
    recent_events = [e["what"] for d in prev[-5:] for e in d["events"]][-20:]
    needs_about = not log["about"] or log["sig"] != sig(char)
    p = PLAN.format(
        name=char["name"], persona=(char.get("persona") or "")[:4000] + (
            "\nAbout your everyday life: " + char["life_seed"][:600] if char.get("life_seed") else ""),
        date=today.isoformat(), weekday=today.strftime("%A"), now=time.strftime("%H:%M", time.localtime(now)),
        tz=tz_name(), season=_season(now),
        about=("\nAbout you so far:\n" + "\n".join("- " + t for t in log["about"])) if log["about"] else "",
        people=("\nPeople in your life:\n" + "\n".join(f"- {x['name']}: {x['who']}" for x in log["people"])) if log["people"] else "",
        ongoing=("\nGoing on lately:\n" + "\n".join(f"- {o['what']} (since {o['since']})" for o in log["ongoing"])) if log["ongoing"] else "",
        recent=("\nYour last days:\n" + "\n".join(recent) + "".join(
            f"\nEarlier: {w['summary']}" for w in log["weeks"][-2:])) if recent else "",
        yesterday=("\nYesterday's plan was: " + "; ".join(f"{e['at']} {e['what']}" for e in last["events"])
                   + ("\nWhat you actually told me about your life yesterday (this is now true):\n" + "\n".join(
                       "- " + _s(m, 200) for m in list(own_msgs_yesterday)[-20:]) if own_msgs_yesterday else "")
                   ) if last and last["date"] == yday.isoformat() and not last["final"] else "",
        told_today=("\nWhat you already told me about today (true now: fit the day around it):\n" + "\n".join(
            "- " + _s(m, 200) for m in list(own_msgs_today)[-12:])) if own_msgs_today else "",
        gap=(f"\nYou last wrote about your life on {last['date']}; the days since passed quietly." if last and
             last["date"] < yday.isoformat() else ""),
        fold=("\nOld days to sum up as one week:\n" + "\n".join(f"- {d['date']}: {d['summary']}" for d in log["days"][:FOLD_DAYS])
              if fold["days"] else "") + ("\nOld weeks to sum up as one month:\n" + "\n".join(
                  f"- {w['from']}..{w['to']}: {w['summary']}" for w in log["weeks"][:FOLD_WEEKS]) if fold["weeks"] else ""),
        weekend=" It's the weekend: a different rhythm." if today.weekday() >= 5 else "",
        avoid="; ".join(recent_events) or "nothing yet",
        moments=(f'- "moments": {n_moments} times today you\'d text me about something that happened (after it happened), '
                 f"between {fmt(first)} and {fmt(qf - 0.5 if qf > q else 23.5)}, at least 2 hours apart."
                 + (f" I usually text around {active}: pick times when I'm likely around." if active else "")
                 + " angle: share, vent, ask (my opinion)" + (", photo (you'd send me a picture of it)" if photos else "")
                 + (", voice (you'd send me a voice message about it)" if voice else "")
                 + ", about_you (no event: you're curious how I'm doing).") if n_moments > 0
                else '- "moments": [] (you won\'t text me first today).',
        friends=friends, halal="\n" + edition.LIFE if edition.PUBLIC else "",   # (the public copy: a halal life)
        strangers=("\nOther people I talk to (they're real too, but you might not know them): " + "; ".join(
            f"{_s(n, 40)}" + (f" ({_s(t, 90)})" if t else "") for n, t in strangers) + ". For each, decide like real "
            "life: most people don't know each other, so say yes only if it fits naturally (same city, work, scene, "
            "old friends), and then how, in a few words.") if strangers else "",
        ask_know=(',\n "know": [{"name": "...", "know": true or false, "how": "how you know each other, or \'\'"}]'
                  if strangers else ""),
        kinds=json.dumps(list(KINDS)),
        ask_about=(',\n "about": ["6-10 short lasting facts about your everyday life: home, work or study, routine, hobbies"], '
                   '"people": [{"name": "...", "who": "in your words, e.g. my older sister, a nurse"}]' if needs_about else ""),
        ask_yesterday=(',\n "yesterday": "1-2 sentences: how yesterday actually went"' if last and last["date"] == yday.isoformat()
                       and not last["final"] else ""),
        ask_gap=',\n "gap": "one sentence: those days in between"' if last and last["date"] < yday.isoformat() else "",
        ask_fold=(',\n "week": "max 400 characters"' if fold["days"] else "") + (',\n "month": "max 500 characters"' if fold["weeks"] else ""))
    return p, fold

def parse(txt):
    """The model's JSON, even with prose or ```json fences around it."""
    a, b = txt.find("{"), txt.rfind("}")
    if a < 0 or b <= a: raise ValueError("no JSON in the reply")
    j = json.loads(txt[a:b + 1])
    if not isinstance(j, dict): raise ValueError("not an object")
    return j

def apply_plan(log, j, char, now, cfg, n_moments=2, others_due=(), photos=False, rnd=random, rh=None, voice=False):
    """Validates the model's day and schedules its moments: never in quiet hours, after the event happened, 2 h apart,
    and away (40 min) from other characters' texts so they never all text at once."""
    today = life_date(now)
    log = clean(log, char["id"])
    prev = [d for d in log["days"] if d["date"] < today.isoformat()]
    last = prev[-1] if prev else None
    if last and isinstance(j.get("yesterday"), str) and j["yesterday"].strip():
        last["summary"], last["final"] = _own_sentences(j["yesterday"], 300) or last["summary"], True
    elif last:
        last["final"] = True
    if last and last["date"] < (today - datetime.timedelta(days=1)).isoformat() and _own_sentences(j.get("gap"), 200):
        log["days"].append({"date": (datetime.date.fromisoformat(last["date"]) + datetime.timedelta(days=1)).isoformat(),
                            "to": (today - datetime.timedelta(days=1)).isoformat(), "summary": _own_sentences(j["gap"], 200),
                            "final": True, "events": [], "moments": [], "planned": now, "tries": 1})
    if isinstance(j.get("about"), list) and j["about"]:
        log["about"], log["sig"] = j["about"], sig(char)
        if isinstance(j.get("people"), list): log["people"] = j["people"]
    if isinstance(j.get("ongoing"), list):
        log["ongoing"] = j["ongoing"]
    t = j.get("today") if isinstance(j.get("today"), dict) else {}
    ev = [{**e, "id": f"e{i + 1}"} for i, e in enumerate((t.get("events") or [])[:8])   # (the model's numbering)
          if isinstance(e, dict) and _hhmm(e.get("at"))]
    d = {"date": today.isoformat(), "summary": _s(t.get("summary"), 300), "final": False, "events": ev, "moments": [],
         "planned": now, "tries": (day(log, today) or {}).get("tries", 0) + 1}
    d = clean({"days": [d]}, char["id"])["days"][0]                     # (ids e1.., owner filter, bounds)
    dl = datetime.date.fromisoformat(d["date"])
    qf = cfg.get("quiet_from", 23.0)
    taken, mine = list(others_due), []
    for m in (j.get("moments") or [])[:6] if n_moments > 0 and isinstance(j.get("moments"), list) else []:
        if not isinstance(m, dict) or not _hhmm(m.get("at")): continue
        angle = m.get("angle") if m.get("angle") in ANGLES else "share"
        if angle == "photo" and not photos or angle == "voice" and not voice: angle = "share"
        idx = m.get("event")
        e = next((x for x in d["events"] if x["id"] == f"e{idx}"), None) if isinstance(idx, int) else None
        if angle != "about_you" and not e: continue                    # a life text is about something that happened
        if angle == "about_you": e = None
        due = _ts(dl, _hhmm(m["at"])) + rnd.uniform(-12, 12) * 60
        if e: due = max(due, _ts(dl, e["at"]) + rnd.uniform(5, 25) * 60)   # never before it happened
        due = nudge(due, rh, cfg, max(now + 10 * 60, _ts(dl, e["at"]) + 5 * 60 if e else 0), rnd)   # when you're around
        for _ in range(3):                                             # step away from other characters' texts
            clash = [x for x in taken if abs(x - due) < 40 * 60]
            if not clash: break
            due = max(clash) + 45 * 60
        if due < now + 10 * 60 or quiet_at(due, cfg) or any(abs(x - due) < 40 * 60 for x in taken): continue
        if any(abs(x["due"] - due) < 120 * 60 for x in mine): continue
        if angle in ("photo", "voice", "about_you") and any(x["angle"] == angle for x in mine): continue
        mine.append({"id": f"m{len(mine) + 1}", "event": e and e["id"], "at": time.strftime("%H:%M", time.localtime(due)),
                     "due": due, "angle": angle, "state": "pending", "msg": None})
        if len(mine) >= n_moments: break
    d["moments"] = sorted(mine, key=lambda x: x["due"])
    log["days"] = [x for x in log["days"] if x["date"] != d["date"]] + [d]
    # rolling summaries: the reply sums up the oldest days/weeks; if it didn't, a plain join keeps them (no extra call)
    if len(log["days"]) > MAX_DAYS:
        old, log["days"] = log["days"][:FOLD_DAYS], log["days"][FOLD_DAYS:]
        log["weeks"].append({"from": old[0]["date"], "to": old[-1].get("to") or old[-1]["date"],
                             "summary": _own_sentences(j.get("week"), 400) or _s(" ".join(x["summary"] for x in old), 400)})
    if len(log["weeks"]) > MAX_WEEKS:
        old, log["weeks"] = log["weeks"][:FOLD_WEEKS], log["weeks"][FOLD_WEEKS:]
        log["months"].append({"month": old[0]["from"][:7],
                              "summary": _own_sentences(j.get("month"), 500) or _s(" ".join(x["summary"] for x in old), 500)})
    log["months"] = log["months"][-MAX_MONTHS:]
    return clean(log, char["id"])

# ---------- which moment is sent now (called every minute by the proactive loop) ----------
def quota(char, cfg, unanswered):
    """How many texts first today: the character's own setting or the global one, halved after 2 unanswered texts
    in a row and paused after 4 (until you write to them). Friends who get no answer text less."""
    base = char.get("texts_per_day")
    base = base if isinstance(base, int) and 0 <= base <= 4 else QUOTA.get(cfg.get("life_texts", "some"), 2)
    return 0 if unanswered >= 4 else max(1, base // 2) if unanswered >= 2 and base else base

def pick(logs, chars, now, cfg, st, ahead=0):
    """st (from the thread): last_any (ts of the last message with anyone), last_first (last text first, anyone),
    last_by[cid] (last message of this character), sent_today[cid], unanswered[cid], busy (a call is on).
    ahead: also a moment due within this many seconds (you just came back to the Mac: it's sent a little early).
    Returns (cid, moment, expired) where expired lists (cid, moment id) to mark skipped."""
    expired, cands = [], []
    if quiet_at(now, cfg):
        return None, None, expired
    today = life_date(now)
    for cid, log in logs.items():
        d = day(log, today)
        for m in (d["moments"] if d else []):
            if m["state"] != "pending" or m["due"] > now + ahead: continue
            if now - m["due"] > LATE: expired.append((cid, m["id"])); continue
            cands.append((m["due"], cid, m))
    if not cands or st.get("busy"): return None, None, expired
    if now - st.get("last_any", 0) < cfg.get("life_after_chat_min", 25) * 60: return None, None, expired
    if now - st.get("last_first", 0) < cfg.get("life_gap_min", 60) * 60: return None, None, expired
    if sum(st.get("sent_today", {}).values()) >= GLOBAL_CAP.get(cfg.get("life_texts", "some"), 6): return None, None, expired
    for due, cid, m in sorted(cands, key=lambda c: (c[0], st.get("last_by", {}).get(c[1], 0))):
        ch = chars.get(cid)
        if not ch or not ch.get("texts_first") or not ch.get("life", True): continue
        if st.get("sent_today", {}).get(cid, 0) >= quota(ch, cfg, st.get("unanswered", {}).get(cid, 0)): continue
        if now - st.get("last_by", {}).get(cid, 0) < 120 * 60: continue
        return cid, m, expired
    return None, None, expired

def mark(log, date_iso, mid, state, msg=None):
    for d in log["days"]:
        if d["date"] == date_iso:
            for m in d["moments"]:
                if m["id"] == mid: m["state"], m["msg"] = state, msg if isinstance(msg, int) else m["msg"]
    return log

MOMENT = """You're texting me first, unprompted, because of something in your own day: at {at} you {what}{mood}.
It's {now}. {angle}
Write it like a real text from a close friend: 1-2 short sentences, specific, in your own voice and manner (casual
unless who you are is more serious). If it feels natural you can send it as two quick texts in a row: put a blank
line between them. Don't explain why you're
texting, don't list your day, no tags or stage directions, don't mention being an AI. Don't start with "Hey" if your
last texts did. If I didn't answer your last text, just move on, never guilt-trip me."""
ANGLE = {"share": "Share it the way you'd share a small moment with a friend.",
         "vent": "Vent about it a little, with some humour.",
         "ask": "Ask my opinion or advice about it (one question).",
         "photo": "Send a photo of it: end with [photo: what the photo shows].",
         "voice": "Send it as a voice message: write just what you'd say out loud (one go, no blank lines, no emoji)."}

def moment_prompt(log, date_iso, m, now, photos=True):
    """The instruction for a text about something in their day; None for an "about_you" check-in (or an event that
    was edited away), which uses the old PROACTIVE prompt (buddy_server.py) with reason "check in". photos: a picture
    can be made right now (planned with one, but nothing can make it now: they share it in words instead)."""
    d = next((x for x in log["days"] if x["date"] == date_iso), None)
    e = next((x for x in d["events"] if x["id"] == m.get("event")), None) if d else None
    if m.get("angle") == "about_you" or not e:
        return None
    what = e["what"][0].lower() + e["what"][1:] if e["what"][:2] != "I " else e["what"][2:]
    return MOMENT.format(at=e["at"], what=what, mood=f" (you felt {e['mood']})" if e["mood"] else "",
                         now=time.strftime("%A %H:%M", time.localtime(now)),
                         angle=ANGLE["share" if m["angle"] == "photo" and not photos else m["angle"]])


# ---------- when a day is planned (asked every minute by the proactive loop, and on the first chat of a day) ----------
RETRY = 20 * 60                                        # a failed plan is tried again after 20 min, at most 3 times a day

def needs_plan(log, char, cfg, now, st, lazy=False):
    """Plan today now? Texting characters: at the first tick after quiet hours, if they'll text today (quota > 0) and
    you've talked to anyone in the last few days. Others (lazy=True): on the first chat or call with them that day."""
    if not cfg.get("lives", True) or not char.get("life", True):
        return False
    today = life_date(now).isoformat()
    if day(log, life_date(now)):
        return False
    a = log.get("attempt") or {}
    if a.get("date") == today and (a.get("n", 0) >= 3 or now - a.get("at", 0) < RETRY):
        return False
    if lazy:
        return True
    if quiet_at(now, cfg) or not cfg.get("proactive", True) or not char.get("texts_first"):
        return False
    if now - st.get("last_user", 0) > cfg.get("life_pause_days", 3) * 86400:
        return False                                   # you're away: their days pass quietly (one "gap" line later)
    return quota(char, cfg, st.get("unanswered", {}).get(char["id"], 0)) > 0

def attempted(log, now):
    today = life_date(now).isoformat()
    a = log.get("attempt") or {}
    log["attempt"] = {"date": today, "n": (a.get("n", 0) if a.get("date") == today else 0) + 1, "at": now}
    return log

def thread_state(msgs, now, calling_window=180):
    """What pick() and needs_plan() need, from the shared thread (messages: role, ts, char, proactive, via).
    unanswered[cid]: their texts first in a row since you last wrote to them."""
    st = {"last_any": 0, "last_user": 0, "last_first": 0, "last_by": {}, "sent_today": {}, "unanswered": {}, "busy": False}
    today = life_date(now)
    for m in msgs:
        if m.get("role") not in ("user", "assistant"):
            continue
        c, ts = m.get("char", "buddy"), float(m.get("ts") or 0)
        st["last_any"] = max(st["last_any"], ts)
        st["last_by"][c] = max(st["last_by"].get(c, 0), ts)
        if m["role"] == "user":
            st["last_user"] = max(st["last_user"], ts); st["unanswered"][c] = 0
            if m.get("via") == "call" and now - ts < calling_window: st["busy"] = True
        elif m.get("proactive") and m.get("content"):  # (a photo that came with a text isn't a second text)
            st["last_first"] = max(st["last_first"], ts)
            st["unanswered"][c] = st["unanswered"].get(c, 0) + 1
            if life_date(ts) == today: st["sent_today"][c] = st["sent_today"].get(c, 0) + 1
    return st
