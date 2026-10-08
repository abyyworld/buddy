"""Buddy's own private door into your tailnet, so your phone can reach Buddy without the Tailscale app on this Mac.

Only once you turn on "Phone" in Buddy's settings on the Mac: Buddy runs its helper (app/tailnet, built from
Tailscale's open-source tsnet library). The first time, it gives a Tailscale sign-in link (shown only on this Mac).
After that this Mac's Buddy is a device called "buddy" on your tailnet, and your phone (Tailscale app, same account)
opens https://buddy.<your tailnet>.ts.net/phone and pairs. Only your own devices get through, over HTTPS, never from
the public internet, and nothing is logged to Tailscale. Turning it off stops the helper; "Sign out" also takes this
Buddy off your tailnet and forgets its keys (kept in .tailnet/, readable only by you).

Without the helper (it comes with the downloadable Buddy app), the Tailscale app on this Mac does the same job:
`tailscale serve --bg 12400`."""
import json, os, shutil, subprocess, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(HERE, ".tailnet")
STATE = {"state": "off", "url": "", "host": "", "error": ""}
_lock = threading.Lock()
_busy = threading.Lock()        # a sign-out in progress (turning it back on waits for it)
_proc = None
_wanted = False
_gen = 0                        # each start() is a new run; an older one's thread stops by itself

def binary():
    """The helper: inside Buddy.app (the download), or next to Buddy's code (built with scripts/build_tailnet.sh)."""
    for p in (os.environ.get("BUDDY_TAILNET"), os.path.join(HERE, ".bin", "buddy-tailnet"),
              os.path.expanduser("~/Applications/Buddy.app/Contents/Helpers/buddy-tailnet"),
              "/Applications/Buddy.app/Contents/Helpers/buddy-tailnet"):
        if p and os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None

def start():
    """Starts (and keeps restarting) the helper in the background."""
    global _wanted, _gen
    with _busy, _lock:
        if _wanted:
            return
        _wanted, _gen = True, _gen + 1
        STATE.update(state="starting", url="", error="")
        threading.Thread(target=_run, args=(_gen,), daemon=True).start()

def _run(gen):
    global _proc
    live = lambda: _wanted and _gen == gen
    def say(**kw):
        with _lock:
            if live(): STATE.update(**kw)
    wait = 5
    while live():
        exe = binary()
        if not exe:
            say(state="missing", url="", host="", error="")
            time.sleep(30); continue
        say(state="starting", url="", error="")
        began, p = time.time(), None
        with _lock:
            if not live():
                break
            try:
                p = _proc = subprocess.Popen([exe, "--state", STATE_DIR, "--buddy", HERE], stdin=subprocess.PIPE,
                                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
                                             start_new_session=True)
            except OSError as e:
                STATE.update(state="error", error=f"couldn't start Buddy's Tailscale part ({e.strerror or e})")
        if p is None:
            time.sleep(wait); wait = min(wait * 2, 300); continue
        try:
            for line in p.stdout:
                try: ev = json.loads(line)
                except ValueError: continue
                if not isinstance(ev, dict) or ev.get("event") != "status":
                    continue
                st = str(ev.get("state") or "")
                say(state=st, url=str(ev.get("url") or "") if st == "login" else "", error=str(ev.get("msg") or "")[:200],
                    **({"host": str(ev.get("host") or "")} if st == "ready" else {}))
        except Exception:
            pass
        try: p.wait(timeout=5)
        except Exception: p.kill()
        with _lock:
            if _proc is p:
                _proc = None
        why = STATE["error"] if STATE["state"] == "error" else ""     # what it said before it stopped, if anything
        say(state="error" if why else "starting", url="", error=why or "the connection stopped; restarting it")
        if time.time() - began > 120:
            wait = 5
        time.sleep(wait); wait = min(wait * 2, 300)

def stop(*_):
    """Stops the helper (it stops by itself when Buddy does: its input closes)."""
    global _wanted, _proc, _gen
    with _lock:
        _wanted, _gen = False, _gen + 1
        p, _proc = _proc, None
        STATE.update(state="off", url="", host="", error="")
    if p and p.poll() is None:
        try: p.stdin.close()
        except (OSError, ValueError): pass
        try: p.wait(timeout=5)
        except Exception: p.kill()

def sign_out():
    """Stops the helper, takes this Buddy off your tailnet and forgets its keys. False if Tailscale couldn't be told
    (the keys are gone anyway; the device stays listed in Tailscale's admin console until you remove it there)."""
    with _busy:
        stop()
        exe, told = binary(), True
        if exe and os.path.isdir(STATE_DIR):
            try:
                told = subprocess.run([exe, "--logout", "--state", STATE_DIR, "--buddy", HERE], stdin=subprocess.DEVNULL,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=40).returncode == 0
            except Exception:
                told = False
        shutil.rmtree(STATE_DIR, ignore_errors=True)
        return told

def status(mac=False):
    """For the page. The sign-in link only for this Mac (whoever opens it could add this Buddy to their tailnet)."""
    s = {k: STATE[k] for k in ("state", "host", "error")}
    if mac:
        s["url"] = STATE["url"]
    s["available"] = bool(binary())
    return s
