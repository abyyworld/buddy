"""Checks for lives.py (pure logic) with fake data only: no vault, thread, keys or network. Run by test_lives.py in
its own process (it sets the time zone), or directly:  python3 tests/lives_checks.py [days to simulate]"""
import datetime, json, os, random, stat, sys, tempfile, time
os.environ["TZ"] = "Europe/Berlin"; time.tzset()
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lives as L
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 60

CFG = {"quiet_from": 23.0, "quiet_until": 8.5, "life_texts": "some"}
MAYA = {"id": "maya", "name": "Maya", "persona": "You are Maya, 29, a sound engineer who climbs.", "texts_first": True, "life": True}
LEO = {"id": "leo", "name": "Leo", "persona": "You are Leo, 34, a chef.", "texts_first": True, "life": True}
QUIET = {"id": "ines", "name": "Ines", "persona": "You are Ines, 31.", "texts_first": False, "life": True}

def at(date, hhmm):
    h, m = map(int, hhmm.split(":")); return datetime.datetime(date.year, date.month, date.day, h, m).timestamp()

D = datetime.date(2026, 10, 8)            # a Thursday
ok = 0
def check(cond, what):
    global ok
    if not cond: raise AssertionError(what)
    ok += 1

def fake_reply(date, rnd, n_events=6, about=False, week=True):
    hours = sorted(rnd.sample(range(7, 23), n_events))
    ev = [{"at": f"{h:02d}:{rnd.choice([0, 15, 30, 45]):02d}", "what": f"thing {i} on {date}", "mood": "fine",
           "kind": rnd.choice(L.KINDS)} for i, h in enumerate(hours)]
    j = {"today": {"summary": f"a day on {date}", "events": ev},
         "moments": [{"at": f"{min(h + 1, 22):02d}:10", "event": i + 1, "angle": rnd.choice(["share", "vent", "ask", "photo"])}
                     for i, h in enumerate(hours)][:4] + [{"at": "16:00", "angle": "about_you"}],
         "ongoing": [{"what": "training for a 10k", "since": "2026-09-20"}],
         "yesterday": f"yesterday was calm ({date}). You would have loved it.", "gap": "quiet days, mostly work.",
         "week": f"a week ending near {date}", "month": f"a month ending near {date}"}
    if about:
        j["about"] = ["Lives in a small top-floor flat", "Works at a tiny recording studio", "Your best friend forever"]
        j["people"] = [{"name": "Lena", "who": "older sister, a nurse"}, {"name": "Sam", "who": "your coworker"}]
    return j

# 1. cleaning: nothing about "you", ids stable, bounds
log = L.clean({"about": ["Has a cat", "Thinks about you a lot"], "people": [{"name": "Lena", "who": "sister"},
       {"name": "X", "who": "your boss"}],
       "days": [{"date": "2026-10-07", "summary": "Long day. Texted you at noon. Climbed in the evening.",
                 "events": [{"id": "e1", "at": "7:05", "what": "overslept"}, {"id": "e2", "at": "12:00", "what": "lunch with you"},
                            {"id": "e3", "at": "19:00", "what": "climbing [photo: wall]"}],
                 "moments": [{"id": "m1", "event": "e3", "at": "19:30", "due": 1, "angle": "nope", "state": "sent", "msg": 5}]}]}, "maya")
check(log["about"] == ["Has a cat"], "owner fact dropped")
check([p["name"] for p in log["people"]] == ["Lena"], "owner person dropped")
d0 = log["days"][0]
check([e["id"] for e in d0["events"]] == ["e1", "e3"], "event about me dropped, ids kept")
check(d0["events"][0]["at"] == "07:05" and d0["events"][1]["what"] == "climbing", "time normalised, tag stripped")
check(d0["summary"] == "Long day. Climbed in the evening.", "summary sentence about me dropped")
check(d0["moments"][0]["event"] == "e3" and d0["moments"][0]["angle"] == "share", "moment keeps its event after cleaning")
check(L.clean(json.loads(json.dumps(log)), "maya") == log, "clean is stable (idempotent)")
check(L.path("../etc") is None and L.path("Maya") is None, "ids are checked")

# 2. planning prompt: first day asks for facts; later days reconcile yesterday, fill gaps, fold
now = at(D, "08:40")
p, fold = L.plan_prompt(MAYA, L.empty("maya"), now, CFG)
check('"about"' in p and "{" in p and "{name}" not in p and "Maya" in p, "first plan asks for lasting facts")
check("never mention me" in p and "fictional" in p and "adult" in p, "rules present")
check(not fold["days"] and not fold["weeks"], "no fold on day one")
rnd = random.Random(1)
log = L.apply_plan(L.empty("maya"), fake_reply(D - datetime.timedelta(days=1), rnd, about=True), MAYA,
                   at(D - datetime.timedelta(days=1), "08:40"), CFG, rnd=rnd)
check(log["about"] == ["Lives in a small top-floor flat", "Works at a tiny recording studio"], "facts kept, owner fact dropped")
check([x["name"] for x in log["people"]] == ["Lena"], "people about me dropped")
p, _ = L.plan_prompt(MAYA, log, now, CFG, own_msgs_yesterday=["ugh the boiler died again", "climbing later!"])
check("boiler died" in p and '"yesterday"' in p and '"about"' not in p, "yesterday's own messages become canon")
gap_log = json.loads(json.dumps(log)); gap_log["days"][0]["date"] = "2026-10-01"
p, _ = L.plan_prompt(MAYA, gap_log, now, CFG)
check('"gap"' in p and "2026-10-01" in p, "a gap is filled in one sentence")

# 3. applying a day: moments are real texts-to-be
rnd = random.Random(7)
others = [at(D, "14:00")]
log2 = L.apply_plan(log, fake_reply(D, rnd), MAYA, now, CFG, n_moments=3, others_due=others, photos=False, rnd=rnd)
d = L.day(log2, D)
check(log2["days"][0]["final"] and log2["days"][0]["summary"].startswith("yesterday was calm"), "yesterday reconciled")
check("loved it" not in log2["days"][0]["summary"], "reconciled summary has nothing about me")
ms = d["moments"]
check(1 <= len(ms) <= 3, f"quota respected ({len(ms)})")
for m in ms:
    check(not L.quiet_at(m["due"], CFG) and m["due"] >= now + 600, "moment outside quiet hours, in the future")
    check(all(abs(m["due"] - o) >= 40 * 60 for o in others), "away from other characters' texts")
    check(m["angle"] != "photo", "no photo angle without a picture maker")
    if m["event"]:
        e = next(x for x in d["events"] if x["id"] == m["event"])
        check(m["due"] >= L._ts(D, e["at"]), "texted only after it happened")
check(all(b["due"] - a["due"] >= 7200 for a, b in zip(ms, ms[1:])), "own texts 2 h apart")
check(sum(m["angle"] == "about_you" for m in ms) <= 1, "at most one check-in about me")

# 3b. the model's event numbers survive an event about me being dropped
j = {"today": {"summary": "x", "events": [{"at": "09:00", "what": "coffee with you"}, {"at": "12:00", "what": "burnt the toast"}]},
     "moments": [{"at": "12:30", "event": 2, "angle": "vent"}]}
lg = L.apply_plan(L.empty("maya"), j, MAYA, at(D, "08:40"), CFG, n_moments=2, rnd=random.Random(3))
dd = L.day(lg, D)
check([e["what"] for e in dd["events"]] == ["burnt the toast"], "event about me dropped")
check(len(dd["moments"]) == 1 and dd["moments"][0]["event"] == "e2", "moment still points at the right event")
check("burnt the toast" in L.moment_prompt(lg, D.isoformat(), dd["moments"][0], dd["moments"][0]["due"]), "moment prompt")
check(L.moment_prompt(lg, D.isoformat(), {"id": "m9", "event": None, "angle": "about_you"}, 0) is None and L.moment_prompt(lg, D.isoformat(), {"id": "m9", "event": "e7", "angle": "share"}, 0) is None, "check-ins and edited-away events fall back to the old prompt")
lg = L.clean({"days": [{"date": "2026-10-08", "events": [{"at": "00:30", "what": "late snack"}, {"at": "22:00", "what": "film"}]}]}, "m")
check([e["what"] for e in lg["days"][0]["events"]] == ["film", "late snack"], "after-midnight events sort last")

# 4. context in chats and calls
c = L.context(log2, at(D, "13:00"))
check("YOUR OWN LIFE" in c and "Today so far" in c and "Yesterday:" in c, "context has today and yesterday")
done = [e for e in d["events"] if e["at"] <= "13:00"]; later = [e for e in d["events"] if e["at"] > "13:00"]
check(all(e["what"] in c.split("Later today")[0] for e in done), "past events listed as done")
check("Later today" not in c, "surprises (no plan) are never known in advance")
d["events"][-1]["plan"] = "film night"; c = L.context(log2, at(D, "13:00"))
check("film night" in c.split("Later today")[1] and d["events"][-1]["what"] not in c, "future events only as plans")
L.mark(log2, D.isoformat(), ms[0]["id"], "sent", 123)
if ms[0]["event"]:
    c2 = L.context(log2, ms[0]["due"] + 60)
    check("[you already texted me about this]" in c2, "knows what it already texted")
short = L.context(log2, at(D, "13:00"), short=True)
check(len(short) < len(c) and "People in your life" not in short, "short version for calls")
check(L.life_date(at(D + datetime.timedelta(days=1), "01:30")) == D, "01:30 still belongs to the same day")
check(L.context(L.empty("x"), now) == "", "no life yet: nothing added")

# 5. picking who texts now
logs = {"maya": log2}
due = next(m for m in ms if m["state"] == "pending") if any(m["state"] == "pending" for m in ms) else None
if due:
    st = {"last_any": 0, "last_first": 0, "last_by": {}, "sent_today": {}, "unanswered": {}}
    cid, m, exp = L.pick(logs, {"maya": MAYA}, due["due"] + 30, CFG, st)
    check(cid == "maya" and m["id"] == due["id"], "a due moment is sent")
    check(L.pick(logs, {"maya": MAYA}, due["due"] + 30, CFG, {**st, "busy": True})[0] is None, "never during a call")
    check(L.pick(logs, {"maya": MAYA}, due["due"] + 30, CFG, {**st, "last_any": due["due"] - 60})[0] is None,
          "never right after you talked to anyone")
    check(L.pick(logs, {"maya": MAYA}, due["due"] + 30, CFG, {**st, "last_first": due["due"] - 1800})[0] is None,
          "never right after another character texted")
    check(L.pick(logs, {"maya": MAYA}, due["due"] + 30, CFG, {**st, "unanswered": {"maya": 4}})[0] is None,
          "paused after 4 unanswered texts")
    check(L.pick(logs, {"maya": {**MAYA, "texts_first": False}}, due["due"] + 30, CFG, st)[0] is None, "texts first off")
    cid, m, exp = L.pick(logs, {"maya": MAYA}, due["due"] + L.LATE + 60, CFG, st)
    check(cid is None and ("maya", due["id"]) in exp, "too late: let go, not sent")
check(L.quota(MAYA, CFG, 0) == 2 and L.quota(MAYA, CFG, 2) == 1 and L.quota(MAYA, CFG, 4) == 0, "back-off")
check(L.quota({**MAYA, "texts_per_day": 4}, CFG, 0) == 4 and L.quota({**MAYA, "texts_per_day": 0}, CFG, 0) == 0, "own setting")

# 6. storage: owner-only
with tempfile.TemporaryDirectory() as tmp:
    L.LIVES = os.path.join(tmp, "my-characters", "lives")
    L.save("maya", log2)
    check(stat.S_IMODE(os.stat(L.path("maya")).st_mode) == 0o600 and stat.S_IMODE(os.stat(L.LIVES).st_mode) == 0o700, "0600/0700")
    check(L.load("maya") == L.clean(log2, "maya"), "round trip")
    check(L.load("nobody") == L.empty("nobody"), "missing -> empty")

# 6b. adults only, first person, late (lazy) planning, when a day is planned, what the thread says
lg = L.clean({"people": [{"name": "Mia", "who": "my 15 year old cousin"}, {"name": "Jo", "who": "my older sister"}],
              "days": [{"date": "2026-10-08", "events": [{"at": "09:00", "what": "babysat the neighbour's kids"},
                                                         {"at": "19:00", "what": "dinner at 7 with Jo"}]}]}, "m")
check([p["name"] for p in lg["people"]] == ["Jo"], "a minor in their life is dropped")
check([e["what"] for e in lg["days"][0]["events"]] == ["dinner at 7 with Jo"], "kids dropped; 'at 7' is a time, kept")
p, _ = L.plan_prompt(MAYA, log, at(D, "20:10"), CFG, own_msgs_today=["finally fixed the bike"])
check("finally fixed the bike" in p and "first person" in p and "25 or older" in p, "late plan keeps what they said today")
st0 = {"last_user": at(D, "08:00"), "unanswered": {}}
e0 = L.empty("maya")
check(L.needs_plan(e0, MAYA, CFG, at(D, "08:40"), st0), "texting character: planned after quiet hours")
check(not L.needs_plan(e0, MAYA, CFG, at(D, "07:40"), st0), "not during quiet hours")
check(not L.needs_plan(e0, QUIET, CFG, at(D, "08:40"), st0), "not texting: no morning plan")
check(L.needs_plan(e0, QUIET, CFG, at(D, "18:00"), st0, lazy=True), "not texting: planned on the first chat")
check(not L.needs_plan(e0, MAYA, {**CFG, "lives": False}, at(D, "08:40"), st0, lazy=True), "lives off: never")
check(not L.needs_plan(e0, {**MAYA, "life": False}, CFG, at(D, "08:40"), st0, lazy=True), "their life off: never")
check(not L.needs_plan(e0, MAYA, CFG, at(D, "08:40"), {**st0, "last_user": at(D, "08:00") - 4 * 86400}), "you're away: paused")
check(not L.needs_plan(e0, MAYA, CFG, at(D, "08:40"), {**st0, "unanswered": {"maya": 4}}), "4 unanswered: no plan either")
check(not L.needs_plan(log2, MAYA, CFG, at(D, "09:40"), st0, lazy=True), "already planned today")
e1 = L.attempted(L.empty("maya"), at(D, "08:40"))
check(not L.needs_plan(e1, MAYA, CFG, at(D, "08:50"), st0) and L.needs_plan(e1, MAYA, CFG, at(D, "09:01"), st0), "retry after 20 min")
e3 = L.attempted(L.attempted(e1, at(D, "09:01")), at(D, "09:30"))
check(e3["attempt"]["n"] == 3 and not L.needs_plan(e3, MAYA, CFG, at(D, "12:00"), st0), "at most 3 tries a day")
check(L.clean(json.loads(json.dumps(e3)), "maya")["attempt"] == e3["attempt"], "tries survive a restart")
thr = [{"role": "user", "ts": at(D, "09:00"), "char": "maya", "content": "hi"},
       {"role": "assistant", "ts": at(D, "09:01"), "char": "maya", "content": "hey"},
       {"role": "assistant", "ts": at(D, "12:00"), "char": "maya", "content": "ugh boiler", "proactive": True},
       {"role": "assistant", "ts": at(D, "12:00") + 5, "char": "maya", "content": "", "image": "x", "proactive": True},
       {"role": "assistant", "ts": at(D, "15:00"), "char": "maya", "content": "climbing!", "proactive": True},
       {"role": "break", "ts": at(D, "15:30"), "char": "leo", "content": ""},
       {"role": "user", "ts": at(D, "16:00"), "char": "leo", "content": "yo", "via": "call"}]
st = L.thread_state(thr, at(D, "16:01"))
check(st["unanswered"] == {"maya": 2, "leo": 0} and st["sent_today"] == {"maya": 2}, "unanswered and sent today (photo not counted)")
check(st["busy"] and st["last_user"] == at(D, "16:00") and st["last_first"] == at(D, "15:00"), "call in progress, last times")
check(not L.thread_state(thr, at(D, "16:10"))["busy"], "the call is over after 3 quiet minutes")
pend = [m for m in ms if m["state"] == "pending"]
if pend:
    m0 = pend[0]; st1 = {"last_any": 0, "last_first": 0, "last_by": {}, "sent_today": {}, "unanswered": {}}
    check(L.pick({"maya": log2}, {"maya": MAYA}, m0["due"] - 1800, CFG, st1)[0] is None, "not before it's due")
    check(L.pick({"maya": log2}, {"maya": MAYA}, m0["due"] - 1800, CFG, st1, ahead=3600)[1]["id"] == m0["id"],
          "back at the Mac: a moment due within the hour comes a little early")

# 7. simulated days (a year: python3 tests/lives_checks.py 365), three characters, minute by minute during waking hours: size, folds, spacing, caps
rnd = random.Random(42)
chars = {"maya": MAYA, "leo": LEO, "ines": QUIET}
logs = {k: L.empty(k) for k in chars}
sent = []                      # (ts, cid)
calls = {"plan": 0, "text": 0}
start = datetime.date(2026, 1, 5)
user_last = {k: 0 for k in chars}
for i in range(DAYS):
    day_ = start + datetime.timedelta(days=i)
    for cid, ch in chars.items():
        if not ch["texts_first"] and rnd.random() < 0.6: continue      # lazy: planned only on days you talk to them
        t0 = at(day_, "08:31") + rnd.randint(0, 600)
        others = [m["due"] for k, lg in logs.items() if k != cid and L.day(lg, day_) for m in L.day(lg, day_)["moments"]
                  if m["state"] == "pending"]
        n = L.quota(ch, CFG, 0) + (1 if rnd.random() < 0.3 else 0)
        logs[cid] = L.apply_plan(logs[cid], fake_reply(day_, rnd, about=(i == 0)), ch, t0, CFG, n_moments=n,
                                 others_due=others, photos=True, rnd=rnd)
        calls["plan"] += 1
    for minute in range(8 * 60 + 30, 23 * 60):
        now = at(day_, "00:00") + minute * 60
        st = {"last_any": max(user_last.values()), "last_first": max([t for t, _ in sent] or [0]),
              "last_by": {k: max([t for t, c in sent if c == k] + [user_last[k]]) for k in chars},
              "sent_today": {k: sum(1 for t, c in sent if c == k and L.life_date(t) == day_) for k in chars},
              "unanswered": {k: 0 for k in chars}}
        cid, m, exp = L.pick(logs, chars, now, CFG, st)
        for k, mid in exp: L.mark(logs[k], day_.isoformat(), mid, "skipped")
        if cid:
            L.mark(logs[cid], day_.isoformat(), m["id"], "sent", int(now)); sent.append((now, cid)); calls["text"] += 1
            if rnd.random() < 0.5: user_last[cid] = now + rnd.randint(300, 3600)    # you answer half of them
size = max(len(json.dumps(lg)) for lg in logs.values())
gaps = [b - a for (a, _), (b, _) in zip(sent, sent[1:]) if L.life_date(a) == L.life_date(b)]
per_day = {}
for t, c in sent: per_day[L.life_date(t)] = per_day.get(L.life_date(t), 0) + 1
check(size < 40_000, f"a year of life stays small ({size} bytes)")
check(all(len(lg["days"]) <= L.MAX_DAYS and len(lg["weeks"]) <= L.MAX_WEEKS + 1 and len(lg["months"]) <= L.MAX_MONTHS
          for lg in logs.values()), "rolling summaries keep it bounded")
check(not gaps or min(gaps) >= 60 * 60 - 60, f"never two texts within an hour (min {min(gaps) / 60:.0f} min)")
check(max(per_day.values()) <= L.GLOBAL_CAP["some"], "global daily cap")
check(not any(c == "ines" for _, c in sent), "a character who doesn't text first never does")
check(not any(L.quiet_at(t, CFG) for t, _ in sent), "never in quiet hours")
ctx = max(len(L.context(lg, at(start + datetime.timedelta(days=DAYS - 1), "20:00"))) for lg in logs.values())
check(ctx < 3000, f"chat context stays short ({ctx} chars)")
# 8. who knows whom, when you text, your edits
with tempfile.TemporaryDirectory() as tmp:
    L.LIVES = os.path.join(tmp, "lives"); L.WORLD = os.path.join(L.LIVES, "_world.json")
    ch = [MAYA, LEO, QUIET]
    check([c["id"] for c in L.undecided("maya", ch)] == ["leo", "ines"], "all undecided at first")
    L.decide("maya", {"know": [{"name": "leo", "know": True, "how": "old flatmates"}, {"name": "Ines", "know": False},
                               {"name": "Zed", "know": True}]}, L.undecided("maya", ch))
    check(L.world() == {"leo+maya": {"know": True, "how": "old flatmates", "by": "ai"},
                        "ines+maya": {"know": False, "how": "", "by": "ai"}}, "the plan decides (names, case-insensitive)")
    check(not L.set_tie("maya", "leo", False, by="ai") and L.set_tie("maya", "leo", False) and
          L.world()["leo+maya"]["by"] == "you", "the AI decides once; you can always change it")
    L.set_tie("maya", "leo", True, "met at the climbing gym, through you")
    check(L.world()["leo+maya"]["how"] == "met at the climbing gym, through you", "your own words are kept")
    L.decide("leo", {"know": [{"name": "Ines", "know": True, "how": "we met through you"}]}, [QUIET])
    check(L.world()["ines+leo"] == {"know": True, "how": "", "by": "ai"}, "an AI 'how' about you is dropped")
    L.set_tie("maya", "ines", None)
    check("ines+maya" not in L.world() and [c["id"] for c in L.undecided("maya", ch)] == ["ines"], "back to 'AI decides'")
    lg = L.apply_plan(L.empty("leo"), fake_reply(D, random.Random(5)), LEO, at(D, "08:40"), CFG, rnd=random.Random(5))
    logs = {"leo": lg}
    ft = L.friends_text("maya", ch, logs, at(D, "08:40"))
    check("Leo (met at the climbing gym, through you)" in ft and "thing 0" in ft, "friends' days go into the plan")
    cx = L.context(L.empty("maya"), at(D, "08:40"), friends=[("Leo", "old flatmates", lg)])
    check("Your friend Leo (old flatmates), whom I also talk to" in cx, "a friend's line in chats")
    late = L.context(L.empty("maya"), at(D, "22:50"), friends=[("Leo", "", lg)])
    early = L.context(L.empty("maya"), at(D, "07:00"), friends=[("Leo", "", lg)])
    check(late.count("thing") >= early.count("thing") and "today:" not in early, "only what has happened by now")
    check("between me and them" in cx, "never what I told the other one")
    cxa = L.context(L.empty("maya"), at(D, "22:50"), friends=[("Leo", "", lg)], avoid=["thing 3", "THING 4"])
    check("thing 3" not in cxa and "thing 4" not in cxa and "thing 5" in cxa, "a friend's news minus what they mustn't know")
    fta = L.friends_text("maya", ch, logs, at(D, "08:40"), avoid=["thing 0"])
    check("thing 0" not in fta and "thing 2" in fta, "the same when planning")
    L.forget_ties("maya")
    check(all("maya" not in k for k in L.world()), "ties go with the character")
msgs = [{"role": "user", "ts": at(D - datetime.timedelta(days=k), "20:15"), "content": "x"} for k in range(1, 7)]
rh = L.rhythm(msgs, at(D, "09:00"))
check(rh and rh[20] == 1.0 and rh[9] == 0, "rhythm: the hours you write in")
check(L.rhythm(msgs[:4], at(D, "09:00")) is None, "rhythm needs 5 days")
check(L.rhythm([{**m, "via": "call"} for m in msgs], at(D, "09:00")) is None, "calls don't count")
check(L.active_text(rh, CFG) == "20-21h", L.active_text(rh, CFG))
t = at(D, "19:10"); n = L.nudge(t, rh, CFG, t - 3600, random.Random(1))
check(time.localtime(n).tm_hour == 20 and n - t <= 5400, "a text moves to when you're around")
check(L.nudge(t, rh, CFG, t + 4 * 3600) == t and L.nudge(t, None, CFG, 0) == t, "never before it may be sent; no rhythm, no move")
lg = L.apply_plan(L.empty("maya"), fake_reply(D, random.Random(9)), MAYA, at(D, "08:40"), CFG, n_moments=3, rnd=random.Random(9))
dd = L.day(lg, D); ev0 = dd["events"][0]["id"]
lg = L.edit(lg, "maya", {"about": ["Has a cat", "Misses you"], "drop": [f"{D}/{ev0}"], "days": {D.isoformat(): "my edit"}}, 5)
dd = L.day(lg, D)
check(lg["about"] == ["Has a cat"] and ev0 not in [e["id"] for e in dd["events"]] and dd["summary"] == "my edit", "edits")
check(all(m["state"] != "pending" for m in dd["moments"] if m["event"] == ev0), "a removed event isn't texted about")
j0 = L.apply_plan(L.empty("ines"), {**fake_reply(D, random.Random(2))}, QUIET, at(D, "08:40"), CFG, n_moments=0)
check(L.day(j0, D)["moments"] == [], "no texts first: no moments")
p0, _ = L.plan_prompt(QUIET, L.empty("ines"), at(D, "08:40"), CFG, n_moments=0, strangers=[("Maya", "sound engineer")])
check('"moments": []' in p0 and '"know"' in p0 and "Maya (sound engineer)" in p0, "plan prompt: no moments, strangers")
p1, _ = L.plan_prompt(MAYA, L.empty("maya"), at(D, "08:40"), CFG, n_moments=2, active="20-21h", voice=True)
check("20-21h" in p1 and "voice" in p1 and '"know"' not in p1, "plan prompt: rhythm, voice")

print(f"OK {ok} checks. {DAYS}-day sim: {calls['plan']} plan calls ({calls['plan'] / DAYS:.1f}/day), {calls['text']} texts "
      f"({calls['text'] / DAYS:.1f}/day, max {max(per_day.values())}/day, min gap {min(gaps) / 60:.0f} min), "
      f"largest log {size} bytes, context <= {ctx} chars")
