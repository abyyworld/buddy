"""Your Tinfoil bill. When your Tinfoil credits run out (HTTP 402) or your key reaches the spend limit you set in
Tinfoil's dashboard (a 429 that says so), every request to Tinfoil fails the same way, whatever the model or endpoint,
so trying another model can't help. Buddy then says so plainly (in chats, in calls, and a banner on the Mac and the
phone: /api/status `credits`), and its background work (facts learning, planning their days, texts first, embedding
notes for smart search) waits 15 minutes instead of asking again and again. The next Tinfoil request that works clears
it. Kept in memory only; nothing here is ever sent anywhere."""
import re, threading, time

OUT = "Your Tinfoil credits ran out: top up in Tinfoil's dashboard (Billing), then try again"
LIMIT = "Your Tinfoil key reached its spend limit: raise it in Tinfoil's dashboard (Billing), then try again"
PAUSE = 15 * 60                                   # background work waits this long after the bill was refused
SPEND = re.compile(r"spend(?:ing)?[\s_-]*limit", re.I)   # (any other 429 is just "too many requests right now")
_state = {"why": None, "at": 0.0}
_lock = threading.Lock()

def said(e):
    """Tinfoil's reason for refusing (its error text, read once and kept on the error for whoever asks next)."""
    if not hasattr(e, "said"):
        try: e.said = e.read(2000).decode(errors="ignore")
        except Exception: e.said = ""
    return e.said

def kind(e):
    """For an HTTP error from Tinfoil: "out" (credits ran out), "limit" (the key's spend limit), else None."""
    code = getattr(e, "code", None)
    if code == 402:
        return "out"
    return "limit" if code == 429 and SPEND.search(said(e)) else None

def refused(e):
    """A Tinfoil request failed: if it was the bill, remember it. Returns its kind (or None)."""
    k = kind(e)
    if k:
        with _lock: _state.update(why=k, at=time.time())
    return k

def worked():
    """A Tinfoil request went through: whatever was wrong with the bill is sorted."""
    if _state["why"]:
        with _lock: _state.update(why=None, at=0.0)

def status():
    """"out", "limit" or None (for /api/status)."""
    return _state["why"]

def message(k=None):
    """What to tell you, in plain words ("" when nothing's wrong)."""
    k = k or _state["why"]
    return LIMIT if k == "limit" else OUT if k else ""

def paused():
    """Background work waits: the bill was refused in the last 15 minutes and nothing has worked since."""
    return bool(_state["why"]) and time.time() - _state["at"] < PAUSE
