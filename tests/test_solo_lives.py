"""Buddy for phones parity for P1c (SPEC3 §11.1-11.3, §12.1, §16.3): web/solo/life.js and web/solo/facts.js's learning
against the real Python, case by case, in node (tests/solo/parity_life.mjs):
  - lives.py: _s, _mine, _own_sentences, _hhmm, clean, life_date / quiet_at / _ts / happened (in the home zone, with the
    days the clocks change), rhythm, active_text, nudge, plan_prompt, sig, parse, apply_plan (whole simulated weeks,
    folding into weeks and months), quota, pick, needs_plan, thread_state, mark, attempted, edit, slim, friends_text,
    _without, world / ties / undecided / decide / set_tie, moment_prompt, life_info's shape; random numbers are a fixed
    stream fed to both sides (Python's uniform(a, b) is a + (b - a) * random(), so the same stream gives the same days)
  - texts first: the instruction (moment_prompt + follow_up, or the PROACTIVE check-in, which on a phone says how long
    since you last texted instead of "away from my Mac"), keeps_on_track, first_text's cleanup after pic_tags/no_tags
  - real timing: buddy_server.reply_delay (with the same random numbers) and life_busy, LATE_NOTE
  - schedule(): the Mac's minute-by-minute life_tick pick() loop, run ahead of time, picks the same moments at the same
    minutes over two days
  - facts learning: memory._words, remember_asked, _ok_text, _heard/_yours, _near, _parse_reply, relevant, due (with a
    fake clock: debounce, backoff, 30 runs an hour), and whole learning runs one after another with recorded Advisor
    replies (the prompt asked, what changed, the sheet's listing and the bookmark after each run)
Fake data only; every path that could reach your notes, characters, thread or keys points into a temp folder. Skipped
(not failed) when node isn't installed. Python 3.9+.
Run from Buddy's folder:  python3 -B -m unittest tests.test_solo_lives -v"""
import copy, datetime, json, math, os, random, shutil, subprocess, sys, tempfile, time, unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))
import characters, edition, facts, kitparts, lives, memory

NODE = shutil.which("node")
SCRIPT = os.path.join(ROOT, "tests", "solo", "parity_life.mjs")
TZ = "Europe/Berlin"
MAC_AWAY = "I've been\naway from my Mac for about {idle} minutes."
PHONE_AWAY = "I last texted you\nabout {idle} minutes ago."

class Stream:
    """random() from a fixed list; uniform() exactly as random.Random.uniform computes it."""
    def __init__(self, vals): self.vals, self.i = list(vals), 0
    def random(self):
        v = self.vals[self.i]; self.i += 1; return v
    def uniform(self, a, b): return a + (b - a) * self.random()

def vals(seed, n=300):
    r = random.Random(seed)
    return [r.random() for _ in range(n)]

def at(date, hhmm):
    h, m = map(int, hhmm.split(":")); return datetime.datetime(date.year, date.month, date.day, h, m).timestamp()

def static_kit():
    with tempfile.TemporaryDirectory() as home:
        out = subprocess.run([sys.executable, "-I", "-B", "-c",
                              "import json, sys; sys.path.insert(0, sys.argv[1]); import kitparts; print(json.dumps(kitparts.static_kit('public')))",
                              ROOT], env={"HOME": home, "PATH": os.environ.get("PATH", "")}, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

MAYA = {"id": "maya-7k2q", "name": "Maya", "persona": "You are Maya, 29, a sound engineer who climbs.", "tagline": "Climbing buddy",
        "texts_first": True, "life": True, "life_seed": "Lives in Lisbon, works at a small studio."}
LEO = {"id": "leo-ab12", "name": "Leo", "persona": "You are Leo, 34, a chef. You remind me to drink water.", "tagline": "Chef",
       "texts_first": True, "life": True, "texts_per_day": 1}
INES = {"id": "ines-9z9z", "name": "Ines", "persona": "You are Ines, 31.", "tagline": "", "texts_first": False, "life": True}
BUDDY = {"id": "buddy", "name": "Buddy", "persona": "You are Buddy, a FAKE persona.", "tagline": "Your closest friend", "texts_first": True,
         "life": True}
CHARS = [BUDDY, MAYA, LEO, INES]

def fake_reply(date, rnd, about=False, n_events=6, extra=True):
    hours = sorted(rnd.sample(range(7, 23), n_events))
    ev = [{"at": f"{h:02d}:{rnd.choice([0, 15, 30, 45]):02d}", "what": rnd.choice([f"thing {i} on {date}", "lunch with you",
           "burnt the toast", "babysat my niece", "dinner at 7 with Jo", "*climbing* [photo: wall]", "I fixed the bike"]),
           "mood": rnd.choice(["fine", "", "tired"]), "kind": rnd.choice(lives.KINDS + ("bogus",)), "plan": rnd.choice(["", "run after work", "see you later"])}
          for i, h in enumerate(hours)]
    j = {"today": {"summary": f"a day on {date}. You were there.", "events": ev},
         "moments": [{"at": f"{min(h + 1, 22):02d}:{rnd.choice([10, 40])}", "event": i + 1, "angle": rnd.choice(["share", "vent", "ask", "photo", "voice"])}
                     for i, h in enumerate(hours)][:4] + [{"at": "16:00", "angle": "about_you"}, {"at": "25:00", "event": 1}, "x"],
         "ongoing": [{"what": "training for a 10k", "since": "2026-09-20"}, {"what": "your birthday plans", "since": ""}]}
    if extra:
        j.update({"yesterday": f"yesterday was calm ({date}). You would have loved it.", "gap": "quiet days, mostly work.",
                  "week": f"a week ending near {date}", "month": f"a month ending near {date}"})
    if about:
        j["about"] = ["Lives in a small top-floor flat", "Works at a tiny recording studio", "Your best friend forever"]
        j["people"] = [{"name": "Lena", "who": "older sister, a nurse"}, {"name": "Sam", "who": "your coworker"}, {"name": "Mia", "who": "my 15 year old cousin"}]
    if rnd.random() < 0.3:
        j["know"] = [{"name": "leo", "know": True, "how": "old flatmates"}, {"name": "Ines", "know": False}, {"name": "Zed", "know": True}]
    return j

class Parity(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        if not NODE: self.skipTest("node isn't installed")
        sys.path.insert(0, os.path.join(ROOT, "tests"))
        import test_phonemode_parity as tpp                 # (its guard: no real private file is ever opened)
        self.tpp = tpp
        tz0 = os.environ.get("TZ"); self.addCleanup(tpp.set_tz, tz0); tpp.set_tz(TZ)
        p = mock.patch.object(edition, "PUBLIC", True); p.start(); self.addCleanup(p.stop)   # (the site is always public)
        self.kit = static_kit()
        import builtins, io
        for o in (builtins, io):
            p = mock.patch.object(o, "open", tpp.guarded_open); p.start(); self.addCleanup(p.stop)

    def node(self, cases):
        r = subprocess.run([NODE, SCRIPT], input=json.dumps({"kit": self.kit, "tz": TZ, "cases": cases}), capture_output=True, text=True,
                           timeout=900, env={**os.environ, "TZ": "UTC"})   # (node in UTC: the port must use the home zone itself)
        self.assertEqual(r.returncode, 0, "JS and Python differ (fake data only):\n" + (r.stdout + r.stderr)[-8000:])
        self.assertRegex(r.stdout, r"(\d+)/\1 cases match")
        return r.stdout

    # ---------- the simulated weeks every family draws from ----------
    def weeks(self, start=datetime.date(2026, 3, 20), days=40, seed=11):
        """A few characters' lives planned day by day (apply_plan through the clocks changing): every input and output."""
        rnd = random.Random(seed); cfg = {"quiet_from": 23.0, "quiet_until": 8.5, "life_texts": "some"}
        logs = {c["id"]: lives.empty(c["id"]) for c in CHARS}
        plans, applies, snaps = [], [], []
        for i in range(days):
            d = start + datetime.timedelta(days=i)
            for c in CHARS:
                if rnd.random() < 0.25: continue                  # (a day they weren't planned: a gap)
                t = at(d, rnd.choice(["08:31", "09:10", "13:45", "20:10", "02:30"])) + rnd.randint(0, 600)
                if c["id"] == "ines-9z9z" and rnd.random() < 0.5: t = at(d, "18:00")
                others = [m["due"] for k, lg in logs.items() if k != c["id"] for dd in [lives.day(lg, lives.life_date(t))] if dd
                          for m in dd["moments"] if m["state"] == "pending"]
                n = lives.quota(c, cfg, rnd.choice([0, 0, 2, 4])) + (1 if rnd.random() < 0.3 else 0)
                photos, voice = rnd.random() < 0.3, rnd.random() < 0.5
                rh = rnd.choice([None, {h: (1.0 if 19 <= h <= 21 else 0.5 if h == 12 else 0.0) for h in range(24)}])
                cfg2 = dict(cfg, **rnd.choice([{}, {"quiet_from": 22.5, "quiet_until": 7.0}, {"quiet_from": 1.0, "quiet_until": 6.0}]))
                yday = ["ugh the boiler died again", "climbing later!", "you texted me"] if rnd.random() < 0.5 else []
                today = ["finally fixed the bike"] if rnd.random() < 0.3 else []
                strangers = [(x["name"], x.get("tagline", "")) for x in CHARS if x["id"] != c["id"]][:rnd.randint(0, 3)]
                active = rnd.choice(["", "20-21h", "12-13h, 19-22h"])
                friends = rnd.choice(["", "\nFriends of yours I also talk to: Leo"])
                prompt, fold = lives.plan_prompt(c, logs[c["id"]], t, cfg2, yday, n, photos, today, friends=friends, strangers=strangers,
                                                 active=active, voice=voice)
                plans.append({"char": c, "log": copy.deepcopy(logs[c["id"]]), "t": t, "cfg": cfg2, "yday": yday, "n": n, "photos": photos,
                              "today": today, "friends": friends, "strangers": strangers, "active": active, "voice": voice,
                              "sig": lives.sig(c), "out": [prompt, fold]})
                j = fake_reply(d, rnd, about=(i % 9 == 0), extra=rnd.random() < 0.8)
                sv = vals(rnd.randrange(10 ** 9)); s = Stream(sv)
                before = copy.deepcopy(logs[c["id"]])
                try:
                    out = lives.apply_plan(before, copy.deepcopy(j), c, t, cfg2, n, others, photos, rnd=s, rh=rh, voice=voice)
                    case = {"out": out, "used": s.i}
                except (TypeError, ValueError, KeyError):
                    out, case = logs[c["id"]], {"error": True}
                applies.append({"log": copy.deepcopy(logs[c["id"]]), "j": j, "char": c, "t": t, "cfg": cfg2, "n": n, "others": others,
                                "photos": photos, "rh": rh, "voice": voice, "sig": lives.sig(c), "stream": sv, **case})
                logs[c["id"]] = out
            snaps.append((d, copy.deepcopy(logs)))
        return logs, plans, applies, snaps, cfg

    def test_lives(self):
        logs, plans, applies, snaps, cfg = self.weeks()
        self.assertTrue(any(len(lg["weeks"]) for lg in logs.values()), "the weeks fold")
        self.assertTrue(any(c.get("error") for c in applies) or True)
        cases = {"plan_prompt": plans, "apply_plan": applies}
        cases["sources"] = [{"name": n, "which": "life", "out": p.pattern} for n, p in
                            (("OWNER", lives.OWNER), ("HHMM", lives.HHMM), ("MINOR", lives.MINOR), ("ON_TRACK", characters.ON_TRACK))]
        cases["constants"] = [{"name": "LF." + k, "out": v} for k, v in
                              (("MAX_DAYS", lives.MAX_DAYS), ("MAX_WEEKS", lives.MAX_WEEKS), ("MAX_MONTHS", lives.MAX_MONTHS),
                               ("FOLD_DAYS", lives.FOLD_DAYS), ("FOLD_WEEKS", lives.FOLD_WEEKS), ("KINDS", list(lives.KINDS)),
                               ("ANGLES", list(lives.ANGLES)), ("QUOTA", lives.QUOTA), ("GLOBAL_CAP", lives.GLOBAL_CAP), ("LATE", lives.LATE),
                               ("DAY_STARTS", lives.DAY_STARTS), ("RETRY", lives.RETRY))]
        self.assertIn(MAC_AWAY, kitparts.PROACTIVE, "the check-in still says 'away from my Mac' where the phone changes it")
        # one clean line, about their own (adult) life
        corpus = ["Has a cat", "Thinks about you a lot", "lunch with you", "*climbing* [photo: wall]  ok", "dinner at 7 with Jo",
                  "babysat the neighbour's kids", "a 15 year old", "aged 30", "u up?", "Long day. Texted you at noon. Climbed.",
                  "yo", "", None, 5, "7:05", "07.30", "23h15", "24:00", "7:5", " 9:45 ", "12:60", "x" * 300, "Ünd naïve café. You!",
                  "your sister", "youre late", "the user said", "I'm off. Bye! What? Fine.", "teenage dream", "high-school reunion",
                  "babysat the KİDS", "a lİttle gİrl next door", "tıny kıds everywhere", "dinner in İzmir", "the usEr said hi"]
        cases["s"] = [{"in": x, "n": n, "out": [lives._s(x, n), lives._mine(x if isinstance(x, str) else ""), lives._own_sentences(x, n), lives._hhmm(x)]}
                      for x in corpus for n in (10, 160, 2000)]
        for c in cases["s"]:
            if not isinstance(c["in"], str): c["out"][1] = lives._mine("")
        cases["s"] = [c for c in cases["s"] if isinstance(c["in"], str) or c["in"] is None]
        # cleaning: everything the weeks made, and broken logs
        rnd = random.Random(5)
        broken = [{}, None, [], {"about": "abc", "people": [{"name": "Lena", "who": "sister"}, "x", {"name": "", "who": "a"}]},
                  {"days": [{"date": "2026-10-07", "events": [{"id": "e9", "at": "7:05", "what": "overslept"}, {"at": "00:30", "what": "late snack"},
                                                                 {"id": "x", "at": "bad", "what": "x"}, "e"],
                             "moments": [{"id": "m1", "event": "e9", "at": "19:30", "due": 1, "angle": "nope", "state": "sent", "msg": 5},
                                         {"event": "zz", "due": "12.5", "state": "pending"}, {"id": "longer-than-six", "msg": "7"}],
                             "summary": "Long day. Texted you. Climbed.", "final": 1, "tries": "2", "planned": 5}, {"date": "bad"}],
                   "weeks": [{"from": "2026-01-01", "to": "2026-01-07", "summary": "a week. You too."}, 3], "months": [{"month": "2026-01-x", "summary": "m"}],
                   "calls": {"2026-10-01": 2, "2026-10-02": "3", "x": 1, "2026-10-03": 1, "2026-10-04": 4}, "edited": "3.5",
                   "attempt": {"date": "2026-10-08", "n": "2", "at": 7}, "sig": "s" * 40},
                  {"attempt": {"date": "nope", "n": -1}}, {"days": [{"date": "2026-10-0%d" % i, "events": []} for i in range(1, 9)] * 4}]
        cases["clean"] = []
        for lg in broken + [x["out"] for x in applies if "out" in x][::3] + [x["log"] for x in applies][::5]:
            try: out = {"out": lives.clean(copy.deepcopy(lg), "maya-7k2q")}
            except (TypeError, ValueError, AttributeError): out = {"error": True}
            cases["clean"].append({"log": lg, "cid": "maya-7k2q", **out})
        # time in the home zone, through both of the year's clock changes
        ts_list = [at(datetime.date(2026, 3, 29), h) + s for h in ("00:30", "01:59", "03:00", "03:59", "04:00", "12:00", "23:30") for s in (0, 59)]
        ts_list += [at(datetime.date(2026, 10, 25), h) for h in ("01:30", "02:30", "03:30", "04:00", "23:00")] + [1792749600.0 + k * 3557.3 for k in range(80)]
        ts_list += [time.mktime((2026, 10, 25, 2, 30, 0, 0, 0, 1)), time.mktime((2026, 10, 25, 2, 30, 0, 0, 0, 0))]
        cfgs = [{}, {"quiet_from": 22.5, "quiet_until": 7.0}, {"quiet_from": 1.0, "quiet_until": 6.0}, {"quiet_from": 0.0, "quiet_until": 0.0}]
        cases["time"] = [{"t": t, "cfg": cfgs[i % 4], "out": {"date": lives.life_date(t).isoformat(), "hm": time.strftime("%H:%M", time.localtime(t)),
                          "dhm": time.strftime("%A %H:%M", time.localtime(t)), "quiet": lives.quiet_at(t, cfgs[i % 4]), "season": lives._season(t)}}
                         for i, t in enumerate(ts_list)]
        cases["ts"] = [{"date": d, "hhmm": h, "out": lives._ts(datetime.date.fromisoformat(d), h)}
                       for d in ("2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25", "2026-12-31", "2026-07-01")
                       for h in ("00:00", "01:30", "02:00", "02:30", "02:59", "03:00", "03:30", "03:59", "04:00", "12:15", "23:59")]
        cases["happened"] = [{"e": {"at": a}, "t": t, "out": lives.happened({"at": a}, t)} for a in ("07:00", "12:30", "23:59", "00:30", "03:59", "04:00")
                             for t in ts_list[::7]]
        # when you usually text, and texts moved toward it
        cases["rhythm"], cases["nudge"] = [], []
        D = datetime.date(2026, 10, 8)
        for k in range(12):
            r = random.Random(100 + k)
            msgs = [{"role": r.choice(["user", "user", "assistant"]), "ts": at(D - datetime.timedelta(days=r.randint(0, 40)), f"{r.randint(0, 23):02d}:{r.randint(0, 59):02d}"),
                     "via": r.choice(["phone", "phone", "call"])} for _ in range(r.randint(0, 60))]
            t = at(D, "09:00")
            rh = lives.rhythm(msgs, t); c2 = cfgs[k % 4]
            cases["rhythm"].append({"msgs": msgs, "t": t, "cfg": c2, "out": [None if rh is None else {str(h): v for h, v in rh.items()}, lives.active_text(rh, c2)]})
            for due in (at(D, "19:10"), at(D, "08:20"), at(D, "22:50"), at(D, "12:00")):
                for earliest in (due - 3600, due + 4 * 3600, 0):
                    sv = vals(k * 31 + int(due) % 97); s = Stream(sv)
                    cases["nudge"].append({"due": due, "rh": None if rh is None else {str(h): v for h, v in rh.items()}, "cfg": c2, "earliest": earliest,
                                           "stream": sv, "out": [lives.nudge(due, rh, c2, earliest, s), s.i]})
        cases["sig"] = [{"char": c, "out": lives.sig(c)} for c in CHARS + [{"persona": "", "life_seed": ""}, {"persona": "Ünd ✨"}]]
        cases["parse"] = []
        for txt in ['Sure! ```json\n{"a": 1}\n```', "no json", "{", '{"x": [1, 2]} trailing } brace', '[1, 2]', '{"a": "}"}', "", '{"b": null}']:
            try: cases["parse"].append({"in": txt, "out": lives.parse(txt)})
            except (ValueError, json.JSONDecodeError): cases["parse"].append({"in": txt, "error": True})
        # who texts now, when a day is planned, what the thread says
        cases["quota"] = [{"char": c, "cfg": {"life_texts": lt}, "un": u, "out": lives.quota(c, {"life_texts": lt}, u)}
                          for c in CHARS + [dict(MAYA, texts_per_day=0), dict(MAYA, texts_per_day=4), dict(MAYA, texts_per_day=7), dict(MAYA, texts_per_day=None)]
                          for lt in ("few", "some", "lots", "bogus") for u in (0, 1, 2, 3, 4, 9)]
        cases["pick"], cases["needs_plan"], cases["thread_state"] = [], [], []
        cm = {c["id"]: c for c in CHARS}
        r = random.Random(9)
        for d, lg in snaps[::2]:
            for _ in range(6):
                t = at(d, f"{r.randint(5, 23):02d}:{r.randint(0, 59):02d}")
                msgs = [{"role": r.choice(["user", "assistant", "break", "reaction"]), "ts": t - r.randint(0, 3 * 86400), "char": r.choice(list(cm)),
                         "content": r.choice(["hi", "", "ok"]), "proactive": r.random() < 0.4, "via": r.choice(["phone", "call"])} for _ in range(r.randint(0, 25))]
                msgs.sort(key=lambda m: m["ts"])
                st = lives.thread_state(msgs, t)
                cases["thread_state"].append({"msgs": msgs, "t": t, "out": st})
                for c2 in cfgs[:3]:
                    for ahead in (0, 3600):
                        cid, m, exp = lives.pick(lg, cm, t, c2, st, ahead=ahead)
                        cases["pick"].append({"logs": lg, "chars": CHARS, "t": t, "cfg": c2, "st": st, "ahead": ahead, "out": [cid, m and m["id"], [list(x) for x in exp]]})
                    for c in CHARS:
                        for lazy in (False, True):
                            cases["needs_plan"].append({"log": lg[c["id"]], "char": c, "cfg": dict(c2, proactive=r.random() < 0.9, lives=r.random() < 0.9),
                                                        "t": t, "st": st, "lazy": lazy})
                            x = cases["needs_plan"][-1]; x["out"] = lives.needs_plan(x["log"], c, x["cfg"], t, st, lazy)
        self.assertTrue(any(c["out"][0] for c in cases["pick"]), "some picks happen")
        self.assertTrue(any(c["out"] for c in cases["needs_plan"]) and any(not c["out"] for c in cases["needs_plan"]))
        last = logs["maya-7k2q"]
        days = [d["date"] for d in last["days"]]
        cases["mark"] = [{"log": last, "date": days[-1], "mid": "m1", "state": s, "msg": m, "out": lives.mark(copy.deepcopy(last), days[-1], "m1", s, m)}
                         for s in ("sent", "skipped") for m in (None, 12, "x")]
        cases["attempted"] = []
        for a in ({}, {"date": lives.life_date(at(D, "09:00")).isoformat(), "n": 2, "at": 1}, {"date": "2026-01-01", "n": 5, "at": 1}):
            lg = dict(lives.empty("x"), attempt=a)
            cases["attempted"].append({"log": lg, "t": at(D, "09:00"), "out": lives.attempted(copy.deepcopy(lg), at(D, "09:00"))["attempt"]})
        cases["edit"] = []
        for j in ({"about": ["Has a cat", "Misses you"], "drop": [f"{days[-1]}/e1", f"{days[-1]}/e2"], "days": {days[-1]: "my edit", days[0]: 5}},
                  {"people": [{"name": "Jo", "who": "my sister"}, {"name": "Kid", "who": "my 12 year old"}], "ongoing": ["a new job", {"what": "moving", "since": "x"}]},
                  {"drop": "x", "days": []}, {}):
            cases["edit"].append({"log": last, "cid": "maya-7k2q", "j": j, "t": 5.0, "out": lives.edit(copy.deepcopy(last), "maya-7k2q", copy.deepcopy(j), 5.0)})
        cases["slim"] = [{"log": lg, "t": t, "friend": fr, "out": lives.slim(lg, t, friend=fr)} for lg in logs.values()
                         for t in (at(datetime.date(2026, 4, 28), "12:00"), at(datetime.date(2026, 4, 29), "03:00")) for fr in (False, True)]
        w = {"leo-ab12+maya-7k2q": {"know": True, "how": "old flatmates", "by": "ai"}, "buddy+maya-7k2q": {"know": False, "how": "x", "by": "you"},
             "ines-9z9z+leo-ab12": {"know": None, "how": "", "by": "ai"}, "bad key": {"know": True}, "buddy+leo-ab12": {"know": True, "how": "*gym* [x] buddies", "by": "you"}}
        T2 = at(datetime.date(2026, 4, 28), "15:00")
        cases["friends"] = [{"cid": c["id"], "chars": CHARS, "logs": logs, "t": T2, "w": lives_world(w), "avoid": av,
                             "out": lives.friends_text(c["id"], CHARS, logs, T2, lives_world(w), avoid=av)} for c in CHARS for av in ((), ("thing 3", "Lisbon"))]
        cases["without"] = [{"lg": lg, "avoid": av, "out": lives._without(lg, av)} for lg in list(logs.values())[:2] for av in ([], ["thing 1", "TOAST"], ["a.b"])]
        cases["ties"] = [{"ties": w, "cid": c["id"], "chars": CHARS, "out": [lives_world(w), [[x["id"], how] for x, how in lives.ties(c["id"], CHARS, lives_world(w))],
                                                                              [x["id"] for x in lives.undecided(c["id"], CHARS, lives_world(w))]]} for c in CHARS]
        cases["decide"], cases["set_tie"] = [], []
        for j in ({"know": [{"name": "leo", "know": True, "how": "old flatmates"}, {"name": "Ines", "know": False}, {"name": "Zed", "know": True},
                            {"name": "Leo", "know": False}]}, {"know": [{"name": " INES ", "know": True, "how": "we met through you"}]}, {"know": "x"}, {}):
            for cid in ("maya-7k2q", "buddy"):
                with tempfile.TemporaryDirectory() as tmp, mock.patch.object(lives, "LIVES", tmp), mock.patch.object(lives, "WORLD", os.path.join(tmp, "_world.json")):
                    lives.save_world(copy.deepcopy(w))
                    others = lives.undecided(cid, CHARS, lives.world())
                    lives.decide(cid, copy.deepcopy(j), others)
                    cases["decide"].append({"ties": w, "cid": cid, "j": j, "others": others, "out": lives.world()})
        for a, b, know, how, by in (("maya-7k2q", "leo-ab12", False, "", "ai"), ("maya-7k2q", "leo-ab12", False, "", "you"),
                                    ("maya-7k2q", "ines-9z9z", True, "same gym", "ai"), ("maya-7k2q", "ines-9z9z", None, "", "you"),
                                    ("buddy", "maya-7k2q", None, "", "you"), ("x", "x", True, "", "you"), ("Bad", "x", True, "", "you"),
                                    ("leo-ab12", "ines-9z9z", True, "a" * 200, "you")):
            with tempfile.TemporaryDirectory() as tmp, mock.patch.object(lives, "LIVES", tmp), mock.patch.object(lives, "WORLD", os.path.join(tmp, "_world.json")):
                lives.save_world(copy.deepcopy(w))
                ok = lives.set_tie(a, b, know, how, by)
                cases["set_tie"].append({"ties": w, "a": a, "b": b, "know": know, "how": how, "by": by, "out": [ok, lives.world()]})
        # what a text first says
        cases["moment_prompt"], cases["instruction"] = [], []
        import buddy_server as bs
        for lg in logs.values():
            for d in lg["days"][-4:]:
                for m in d["moments"] + [{"id": "m9", "event": "e1", "angle": "photo"}, {"id": "m8", "event": None, "angle": "about_you"},
                                          {"id": "m7", "event": "e7", "angle": "share"}, {"id": "m6", "event": "e2", "angle": "voice"}]:
                    t = at(datetime.date.fromisoformat(d["date"]), "17:42")
                    for photos in (False, True):
                        cases["moment_prompt"].append({"log": lg, "date": d["date"], "m": m, "t": t, "photos": photos,
                                                       "out": lives.moment_prompt(lg, d["date"], m, t, photos=photos)})
                    for c in (MAYA, LEO):
                        mp = lives.moment_prompt(lg, d["date"], m, t, photos=False)
                        idle = 37.9
                        clock = self.tpp.Clock(); clock.now = t
                        with mock.patch.object(bs, "datetime", clock.datetime_module()):
                            want = mp + bs.follow_up(c, moment=True) if mp else bs.PROACTIVE.replace(MAC_AWAY, PHONE_AWAY).format(
                                reason="check in", idle=int(idle), now=datetime.datetime.fromtimestamp(t).strftime("%A %H:%M")) + bs.follow_up(c)
                        cases["instruction"].append({"char": c, "log": lg, "date": d["date"], "m": m, "t": t, "idle": idle, "out": want})
        cases["on_track"] = [{"char": c, "out": [characters.keeps_on_track(c), bs.follow_up(c), bs.follow_up(c, moment=True)]}
                             for c in CHARS + [{"persona": "Keeps me on track with uni", "tagline": ""}, {"persona": "", "tagline": "Holds me accountable"},
                                               {"persona": "You remind me of summer"}, {"persona": "follows up on whether I did my reps"}]]
        firsts = ['"hey you"', "  ok\t\twait  ", "*sends a selfie* look", "[photo: me at the gym] guess where", "\"quote\" inside \"", "hi [react: 😂]",
                  "line one\n\nline two", "📸 me on my balcony at sunset", "Image: the logo should be on the left", ""]
        cases["first_clean"] = []
        for txt in firsts:
            t2, _ = bs.pic_tags(txt)
            import re as _re
            cases["first_clean"].append({"in": txt, "out": _re.sub(r"[ \t]+", " ", bs.no_tags(t2)).strip().strip('"').strip()})
        # real timing
        cases["life_busy"], cases["reply_delay"] = [], []
        for d, lg in snaps[-6:]:
            for hhmm in ("08:00", "11:30", "14:05", "19:40", "23:55", "01:10"):
                t = at(d, hhmm)
                for c, cfg3 in ((MAYA, {}), (MAYA, {"lives": False}), (dict(MAYA, life=False), {})):
                    clock = self.tpp.Clock(); clock.now = t
                    with mock.patch.object(bs, "time", clock.time_module()), mock.patch.object(bs, "cfg", lambda c3=cfg3: dict(c3)), \
                            mock.patch.object(lives, "load", lambda cid, lg=lg: copy.deepcopy(lg[cid] if cid in lg else lives.empty(cid))):
                        cases["life_busy"].append({"char": c, "log": lg["maya-7k2q"], "t": t, "cfg": cfg3, "out": bs.life_busy(c)})
        r = random.Random(17)
        for k in range(160):
            t = 1792749600.0 + r.randint(0, 30 * 86400)
            gap = r.choice([0, 300, 599, 601, 3000, 7199, 7201, 50000, 86399, 86401, 9 * 86400])
            thread = [{"id": 1, "role": r.choice(["user", "assistant"]), "content": "x", "ts": t - gap, "char": MAYA["id"]},
                      {"id": 2, "role": "assistant", "content": "y", "ts": t - gap - 99, "char": "buddy"},
                      {"id": 3, "role": "user", "content": "z", "ts": t, "char": MAYA["id"]}][0 if gap else 2:]
            via = r.choice(["phone", "phone", "call"]); busy = r.choice(["", "", "climbing"]); cfg3 = r.choice([{}, {"real_timing": False}, {"real_timing": True}])
            sv = vals(1000 + k, 5); s = Stream(sv)
            with mock.patch.object(bs, "time", type("T", (), {"time": staticmethod(lambda t=t: t)})), mock.patch.object(bs, "random", s), \
                    mock.patch.object(bs, "cfg", lambda c3=cfg3: dict(c3)), mock.patch.object(bs, "life_busy", lambda ch, b=busy: b), \
                    mock.patch.object(bs.social, "thread", lambda after=0, th=thread: list(th)):
                got = bs.reply_delay(MAYA, via)
            cases["reply_delay"].append({"char": MAYA, "via": via, "thread": thread, "t": t, "cfg": cfg3, "busy": busy, "stream": sv, "out": [got, s.i]})
        self.assertTrue(any(c["out"][0] for c in cases["reply_delay"]) and any(not c["out"][0] for c in cases["reply_delay"]))
        cases["late_note"] = [{"busy": b, "out": kitparts.LATE_NOTE.format(busy=f" (you've been busy: {b})" if b else "")} for b in ("", "climbing", "{x}")]
        # what the app shows
        cases["info"] = []
        ww = lives_world(w)
        for c in (MAYA, INES, dict(LEO, life=False)):
            clock = self.tpp.Clock(); clock.now = T2
            with mock.patch.object(bs, "time", clock.time_module()), mock.patch.object(bs, "cfg", lambda: {"lives": True}), \
                    mock.patch.object(lives, "load", lambda cid: copy.deepcopy(logs.get(cid) or lives.empty(cid))), \
                    mock.patch.object(lives, "world", lambda: copy.deepcopy(ww)), mock.patch.object(characters, "all_characters", lambda cfg: CHARS):
                cases["info"].append({"char": c, "log": logs.get(c["id"]) or lives.empty(c["id"]), "ties": w, "chars": CHARS, "cfg": {"lives": True}, "t": T2,
                                      "out": bs.life_info(c)})
        out = self.node(cases)
        print(out.strip().splitlines()[-1])

    def test_schedule(self):
        """schedule() picks what the Mac's minute-by-minute life_tick would, at the same minutes, over two days."""
        logs, _, _, snaps, cfg = self.weeks(start=datetime.date(2026, 4, 2), days=12, seed=23)
        cm = {c["id"]: c for c in CHARS}
        cases = {"schedule": []}
        r = random.Random(4)
        for d, lg in snaps[-8:]:
            for start in ("07:50", "12:10", "18:40"):
                t = at(d, start) + r.randint(0, 59)
                msgs = [{"role": r.choice(["user", "assistant"]), "ts": t - r.randint(0, 2 * 86400), "char": r.choice(list(cm)),
                         "content": "hi", "proactive": r.random() < 0.3, "via": "phone"} for _ in range(r.randint(0, 12))]
                msgs.sort(key=lambda m: m["ts"])
                for c2 in (cfg, dict(cfg, life_texts="few"), dict(cfg, life_texts="lots", life_gap_min=30)):
                    cases["schedule"].append({"logs": lg, "chars": CHARS, "t": t, "cfg": c2, "msgs": msgs, "horizon": 48 * 3600,
                                              "out": py_schedule(lg, cm, t, c2, msgs, 48 * 3600)})
        self.assertTrue(sum(len(c["out"]) for c in cases["schedule"]) > 20, "moments get scheduled")
        out = self.node(cases)
        print(out.strip().splitlines()[-1])

    def test_learning(self):
        char = {"id": "maya-7k2q", "name": "Maya", "knowledge": {"scope": "some", "folders": [], "avoid": ""}, "learns": True}
        corpus = ["I live in Porto.", "I keep bees", "Maya likes bees.", "maya, I keep bees", "You keep bees.", "My PIN is 4821", "I'm a nurse",
                  "I work at Lisbon Zoo.", "Me and Lena go climbing", "I", "I'm", "my name is Ann", "I've got a cat named Mochi", "Mayana and I",
                  "I love your laugh", "x" * 250, "- [x] I run (learned 2026-10-01)", "I live in Berlin now, no longer in Porto",
                  "remember that my sister is Lena", "Don't forget I'm vegan", "it's not true anymore", "I used to smoke", "I'm not any more tired",
                  "Ünd I'm naïve", "I study at Uni in Coimbra", "I'm studying nursing", "Every Monday I swim", "In March 2027 I move", "My boss Tom is nice",
                  "I said hi to Tom's dog", "I'd love that", "I'll be in Rome", ""]
        cases = {"lwords": [{"in": s, "out": [memory._words(s), facts.remember_asked(s)]} for s in corpus],
                 "ok_text": [{"in": s, "char": ch, "out": facts._ok_text(s, ch, None)} for s in corpus + [None, 5]
                             for ch in (char, {"name": "  Maya "}, {"name": ""}, {"name": "Ma.ya"})]}
        saids = ["I live in Porto and I keep bees", "i moved to berlin. no longer porto!", "My sister Lena is a nurse", "i study nursing at uni",
                 "Tom's dog is cute", "I'm vegan", "", "Every Monday I swim with Ann"]
        cases["yours"] = [{"t": t, "said": s, "out": facts._yours(t, facts._heard(s))} for t in corpus for s in saids]
        self.assertTrue(any(c["out"] for c in cases["yours"]) and any(not c["out"] for c in cases["yours"]))
        cases["near"] = [{"a": a, "b": b, "out": facts._near(a, b)} for a in corpus[:14] for b in ("I live in Porto", "I keep bees!", "i keep the bees", "I'm a nurse.", "")]
        replies = ['{"add": ["I keep bees."], "update": [], "remove": []}', 'ok ```json {"add": ["a", 5, null], "update": [{"id": "f2", "text": "x"}, {"id": 3, "text": "y"},'
                   ' {"text": "z"}, {"id": "f1"}, "x"], "remove": ["f1", 4, true, null, 2.5]} ```', '{"add": "x"}', "nothing", '{"add": []', "[1]",
                   '{"update": {}}', '{}', '{"add": ["a"] } and then {"b": 1}', json.dumps({"add": [f"I x{i}" for i in range(30)]})]
        cases["parse_reply"] = []
        for txt in replies:
            try: a, u, rm = facts._parse_reply(txt); cases["parse_reply"].append({"in": txt, "out": [a, [list(x) for x in u], rm]})
            except facts._BadReply: cases["parse_reply"].append({"in": txt, "out": {"bad": True}})
        r = random.Random(8)
        known = [("mine" if i % 3 else "everyone", {"id": "%010x" % i, "text": " ".join(r.choice(["bees", "porto", "climb", "nurse", "tea", "dog", "x%d" % i])
                                                                                  for _ in range(3)), "date": "2026-10-%02d" % r.randint(1, 28)}) for i in range(260)]
        new = [{"content": "I keep bees in porto"}, {"content": "and a dog"}]
        cases["relevant"] = [{"known": known[:n], "new": new, "newest": nw, "most": mo, "out": [f["id"] for _, f in facts.relevant(known[:n], new, nw, mo)]}
                             for n in (5, 60, 201, 260) for nw, mo in ((60, 200), (5, 20), (0, 10))]
        # due: the debounce, with a fake clock
        cases["due"] = []
        now = 1792749600.0
        for k in range(200):
            st = {"seen": r.choice([0, 3, 6]), "last": now - r.choice([0, 19, 21, 119, 121, 3000]), "fails": r.choice([0, 0, 1, 3]),
                  "next": now + r.choice([-5, 5, 0]), "pre": r.random() < 0.2}
            runs = [now - r.randint(0, 5000) for _ in range(r.choice([0, 5, 29, 30, 40]))]
            msgs = [{"id": i + 1, "role": r.choice(["user", "assistant"]), "content": r.choice(["hi", "", "  "]), "char": r.choice(["maya-7k2q", "buddy"]),
                     "ts": now - r.choice([10, 200, 239, 241, 4000]), "private": r.random() < 0.1, "life": r.random() < 0.05} for i in range(r.randint(0, 10))]
            urgent, busy = r.random() < 0.3, r.random() < 0.2
            with mock.patch.object(facts, "_state", lambda st=st, runs=runs: {"boot": 0, "chars": {"maya-7k2q": dict(st)}, "gone": {}, "runs": list(runs), "over": {}}), \
                    mock.patch.object(facts, "_blocked", lambda cid: ""), mock.patch.object(facts, "_hold", {}):
                out = facts.due(char, msgs, now, urgent, busy)
            cases["due"].append({"cid": "maya-7k2q", "st": st, "runs": runs, "msgs": msgs, "t": now, "urgent": urgent, "busy": busy, "out": out})
        self.assertTrue(any(c["out"] for c in cases["due"]) and any(not c["out"] for c in cases["due"]))
        cases["learn"] = self.learn_sequences()
        self.assertTrue(any(s["n"] for c in cases["learn"] for s in c["out"]), "learning wrote something")
        out = self.node(cases)
        print(out.strip().splitlines()[-1])

    def learn_sequences(self):
        """facts.learn runs one after another in a temp folder, with recorded Advisor replies; the sheet in between."""
        U = lambda i, text, ts, **k: {"id": i, "role": "user", "content": text, "char": "maya-7k2q", "ts": ts, **k}
        A = lambda i, text, ts, **k: {"id": i, "role": "assistant", "content": text, "char": "maya-7k2q", "ts": ts, **k}
        t0 = 1792749600.0
        m1 = [U(1, "I live in Porto and I keep bees.", t0), A(2, "Bees! I keep plants, ha. Maya here.", t0 + 5)]
        m2 = m1 + [U(3, "I moved to Berlin last month, no longer in Porto", t0 + 400), A(4, "Big move!", t0 + 405)]
        m3 = m2 + [U(5, "my sister Lena is a nurse", t0 + 900), A(6, "Nice", t0 + 905)]
        m4 = m3 + [U(7, "remember that I'm vegan", t0 + 1300), A(8, "Noted!", t0 + 1305), U(9, "private thing: I'm 4821", t0 + 1310, private=True)]
        m4b = m4 + [U(10, "I'm vegan, remember that", t0 + 1600), A(11, "ok", t0 + 1605)]
        m4c = m4b + [U(12, "I'm a nurse too", t0 + 1700), A(13, "cool", t0 + 1705, life="2026-10-23/m1")]
        m5 = m4c + [U(14, "I stopped climbing, and I don't keep bees any more", t0 + 3000), A(15, "Oh no", t0 + 3005)]
        many = m5 + [x for i in range(20, 120, 2) for x in (U(i, f"I collect thing{i} stamps", t0 + 4000 + i), A(i + 1, "cool", t0 + 4001 + i))]
        R = lambda add=(), up=(), rem=(): json.dumps({"add": list(add), "update": [{"id": a, "text": b} for a, b in up], "remove": list(rem)})
        seqs = [
            {"name": "basics", "shared_on": True, "boot": 0, "steps": [
                {"msgs": m1, "t": t0 + 200, "reply": R(["I live in Porto.", "I keep bees.", "Maya likes bees.", "You keep bees.", "My PIN is 4821",
                                                     "I work at Lisbon Zoo.", "I keep plants.", "I keep bees!"])},
                {"msgs": m1, "t": t0 + 300, "reply": R(["I live in Porto."])},          # (nothing new you said: not asked)
                {"edits": [{"op": "add", "text": "I climb on Sundays.", "to": "everyone"}, {"op": "add", "text": "My cat is Mochi.", "to": "mine"}],
                 "msgs": m2, "t": t0 + 600, "reply": R(["I moved to Berlin."], [("f1", "I live in Berlin."), ("f9", "x"), ("f3", "I climb in Berlin.")], ["f2"])},
                {"msgs": m3, "t": t0 + 1000, "reply": "Sorry, I can't do JSON today."},
                {"msgs": m3, "t": t0 + 1100, "reply": None},
                {"msgs": m3, "t": t0 + 1200, "reply": R(["My sister Lena is a nurse.", "My sister is called Lena.", "My sister Lena works as a nurse."])},
                {"msgs": m4, "t": t0 + 1400, "reply": R(["I'm vegan.", "I'm 4821.", "I'm vegan!"])},
                {"edits": [{"op": "delete", "id": "@I'm vegan.", "file": "mine"}], "msgs": m4b, "t": t0 + 1650, "reply": R(["I'm vegan.", "I eat vegan."])},
                {"msgs": m4c, "t": t0 + 1800, "reply": R(["I'm a nurse too."]), "gone": True},
                {"msgs": m5, "t": t0 + 3100, "reply": R(["I'm vegan."], [("f6", "I keep no bees.")], ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10"])},
                {"edits": [{"op": "show", "id": "@I climb on Sundays."}], "msgs": many, "t": t0 + 5000,
                 "reply": R([f"I collect thing{i} stamps." for i in range(20, 40, 2)])},
                {"msgs": many, "t": t0 + 5200, "reply": R(["I collect thing110 stamps.", "I collect thing30 stamps."])},
            ]},
            {"name": "only its own", "shared_on": False, "boot": 2, "steps": [
                {"edits": [{"op": "add", "text": "I live in Porto.", "to": "everyone"}, {"op": "add", "text": "I keep bees.", "to": "mine"}],
                 "msgs": m2, "t": t0 + 600, "reply": R(["I moved to Berlin."], [("f1", "I keep bees in Berlin."), ("f2", "I live in Berlin.")], ["f1"])},
                {"msgs": m5, "t": t0 + 3100, "reply": R(["My sister Lena is a nurse.", "I'm vegan."], [("f1", "I live in Berlin now.")], ["f3", "f2", "f1"])},
                {"msgs": m5, "t": t0 + 3200, "reply": "{}"},
                {"msgs": m5 + [U(130, "nothing", t0 + 3300)], "t": t0 + 3400, "reply": "[]"},
                {"msgs": m5 + [U(130, "nothing", t0 + 3300)], "t": t0 + 3500, "reply": "[]"},
                {"msgs": m5 + [U(130, "nothing", t0 + 3300)], "t": t0 + 3600, "reply": "[]"},
                {"msgs": m5 + [U(130, "nothing", t0 + 3300), U(131, "I keep bees in Berlin", t0 + 3601)], "t": t0 + 3700,
                 "reply": R(["I keep bees in Berlin.", "I keep bees."])},
            ]},
        ]
        today = datetime.date.today().isoformat()
        out = []
        for seq in seqs:
            with tempfile.TemporaryDirectory() as T, mock.patch.object(facts, "VAULT", os.path.join(T, "Buddy")), \
                    mock.patch.object(facts, "DIR", os.path.join(T, "Buddy", "Buddy knows")), \
                    mock.patch.object(facts, "STATE", os.path.join(T, ".facts_state.json")), mock.patch.object(facts, "_cache", {}), \
                    mock.patch.object(facts, "_kicks", {}), mock.patch.object(facts, "_running", set()), mock.patch.object(facts, "_hold", {}):
                os.makedirs(os.path.join(T, "Buddy"))
                if seq["boot"]:
                    with open(facts.STATE, "w") as f: json.dump({"boot": seq["boot"]}, f)
                char = {"id": "maya-7k2q", "name": "Maya", "knowledge": {"scope": "some" if seq["shared_on"] else "none", "folders": [], "avoid": ""}, "learns": True}
                got = []
                for step in seq["steps"]:
                    for ed in step.get("edits", []):
                        j = dict(ed)
                        if str(j.get("id", "")).startswith("@"):
                            j["id"] = next((f["id"] for f in facts.listing(char) if f["text"] == j["id"][1:]), "missing")
                        try: facts.change(char, j)
                        except (facts.Changed, ValueError): pass
                    asked = []
                    def ask(p, step=step):
                        asked.append(p)
                        if step["reply"] is None: raise OSError("unreachable")
                        return step["reply"]
                    facts._kicks.clear()
                    msgs = step["msgs"]
                    with mock.patch("social.thread", lambda after=0, msgs=msgs, gone=step.get("gone"): [] if gone else [m for m in msgs if m["id"] > after]):
                        n = facts.learn(char, {"learn_facts": True}, ask, msgs=msgs, now=step["t"])
                    c = facts._cstate(facts._state(), char["id"])
                    got.append({"n": n, "asked": asked, "more": char["id"] in facts._kicks, "listing": facts.listing(char),
                                "state": {"seen": c["seen"], "fails": c.get("fails", 0), "next": c.get("next", 0), "last": c.get("last", 0), "off": c.get("off", 0)}})
                out.append({"name": seq["name"], "char": {"id": char["id"], "name": "Maya"}, "shared_on": seq["shared_on"], "boot": seq["boot"],
                            "today": today, "steps": seq["steps"], "out": got})
        return out

def lives_world(w):
    """lives.world() over a dict (as the tie records hold it)."""
    with tempfile.TemporaryDirectory() as tmp, mock.patch.object(lives, "LIVES", tmp), mock.patch.object(lives, "WORLD", os.path.join(tmp, "_world.json")):
        lives.save_world(copy.deepcopy(w))
        return lives.world()

def py_schedule(logs, chars, now, cfg, msgs, horizon):
    """The Mac's life_tick, minute by minute: pick() what's due, mark it, as if it was sent then."""
    logs, sims, out = copy.deepcopy(logs), list(msgs), []
    t = math.floor(now / 60) * 60
    if t < now: t += 60
    while t <= now + horizon:
        st = lives.thread_state(sims, t)
        cid, m, exp = lives.pick(logs, chars, t, cfg, st)
        date = lives.life_date(t).isoformat()
        for x, mid in exp: lives.mark(logs[x], date, mid, "skipped")
        if cid:
            lives.mark(logs[cid], date, m["id"], "sent")
            out.append([cid, date, m["id"], t])
            sims.append({"role": "assistant", "char": cid, "ts": t, "proactive": True, "content": "x"})
        t += 60
    return out

if __name__ == "__main__":
    unittest.main()
