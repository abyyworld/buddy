"""Tinfoil's attestation-verifying proxy, run by Buddy itself (customers don't install a separate Tinfoil Proxy app).

Buddy starts Tinfoil's own open-source proxy (tinfoilsh/tinfoil-proxy, Apache-2.0; the exact binary is pinned by
SHA-256 in scripts/fetch_tinfoil_proxy.sh) on a random local port. In handshake mode the proxy first verifies Tinfoil's
enclave (attestation), only then says where it listens, and serves nothing until Buddy answers "go". Every request to
the brain, voice, hearing and memory goes through it, so nothing reaches Tinfoil unless the enclave checked out.
If it can't verify, Buddy simply can't reach the brain: nothing is ever sent anywhere else.

Older installs that still run the separate Tinfoil Proxy app on 127.0.0.1:3301 keep working until the bundled one is
there. The proxy never gets your Tinfoil key; Buddy adds it to each request, as before."""
import atexit, collections, json, os, secrets, signal, subprocess, threading, time, urllib.error, urllib.request
import localcheck

HERE = os.path.dirname(os.path.abspath(__file__))
PIDFILE = os.path.join(HERE, ".tinfoil_proxy.pid")
SECRET = os.path.join(HERE, ".tinfoil_cache_secret")
LEGACY = "http://127.0.0.1:3301/v1"            # the separate Tinfoil Proxy app (older setups)
STATE = {"url": None, "error": "", "since": 0, "source": "", "enclave": ""}
_log = collections.deque(maxlen=30)            # the proxy's own messages, for the doctor (no chat content in them)
_lock = threading.Lock()
_proc = None         # the running proxy (after "go")
_starting = None     # a proxy still verifying (so stop() can end it too)
_wanted = False

def binary():
    """The bundled proxy: next to Buddy's code (git installs) or inside Buddy.app."""
    for p in (os.environ.get("BUDDY_TINFOIL_PROXY"), os.path.join(HERE, ".bin", "tinfoil-proxy"),
              os.path.expanduser("~/Applications/Buddy.app/Contents/Helpers/tinfoil-proxy"),
              "/Applications/Buddy.app/Contents/Helpers/tinfoil-proxy"):
        if p and os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None

def url():
    """Base URL of a verified Tinfoil connection, or raises with the reason (nothing is sent anywhere else).
    Only while that proxy is still running: a stopped one's port could be taken by another program."""
    p = _proc
    if STATE["url"] and p is not None and p.poll() is None:
        return STATE["url"]
    if not binary() and _legacy_up():
        return LEGACY
    raise RuntimeError("Buddy's private connection to Tinfoil isn't ready" + (f" ({STATE['error']})" if STATE["error"] else ""))

def _legacy_up():
    """An older Tinfoil Proxy app answers on :3301, and it runs as you (not a program of another account)."""
    if not localcheck.own_port(3301):
        return False
    try:
        urllib.request.urlopen(LEGACY.rsplit("/v1", 1)[0] + "/verification-document", timeout=1).close()
        return True
    except urllib.error.HTTPError:
        return True                              # it answered: an older Tinfoil Proxy app is there
    except Exception:
        return False

def _secret():
    """Tinfoil's prompt-cache scoping secret, kept in Buddy's own folder (readable only by you)."""
    try:
        fd = os.open(SECRET, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    return open(SECRET).read().strip()

def _kill_leftover():
    """A proxy left behind by a Buddy that was force-quit (it keeps running once started). Only if that pid is
    still exactly our binary started in handshake mode (never some other program that got the pid since)."""
    try:
        pid, _, exe = open(PIDFILE).read().partition("\n")
        exe = exe.strip() or binary()                # (older Buddys wrote only the pid)
        cmd = subprocess.run(["ps", "-o", "command=", "-p", pid.strip()], capture_output=True, text=True).stdout.strip()
        if exe and cmd.startswith(exe + " ") and "--handshake" in cmd[len(exe):].split():   # (the path may have spaces)
            os.kill(int(pid), signal.SIGTERM)
    except Exception:
        pass
    try: os.remove(PIDFILE)
    except OSError: pass

def _start_once():
    global _proc, _starting
    exe = binary()
    if not exe:
        STATE.update(url=None, error="the Tinfoil Proxy that comes with Buddy is missing; run the doctor", source="")
        return False
    env = {**os.environ, "TINFOIL_USER_CACHE_SECRET": _secret()}
    p = subprocess.Popen([exe, "-p", "0", "-b", "127.0.0.1", "--handshake", "--log-format", "json"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                         text=True, bufsize=1, start_new_session=True)
    _starting = p
    threading.Thread(target=lambda: [_log.append(l.strip()[:300]) for l in p.stderr], daemon=True).start()
    late = threading.Timer(90, p.kill); late.daemon = True; late.start()   # it verifies first; never wait forever
    ready = None
    while True:
        line = p.stdout.readline()
        if not line:
            break
        try: msg = json.loads(line)
        except ValueError: continue
        if msg.get("event") == "ready":
            ready = msg; break
    late.cancel()
    listen = (ready or {}).get("listen", "")
    host, _, port = listen.rpartition(":")
    if not ready or host != "127.0.0.1" or not port.isdigit() or not _wanted:
        try: p.stdin.write("abort\n"); p.stdin.flush()
        except Exception: pass
        p.kill(); _close(p); _starting = None
        if not _wanted:                              # Buddy is stopping: not an error
            return False
        last = next((l for l in reversed(_log) if l), "")
        STATE.update(url=None, error="couldn't verify Tinfoil's enclave" + (f": {_why(last)}" if last else ""))
        return False
    try:
        p.stdin.write("go\n"); p.stdin.flush()
    except (OSError, ValueError):                    # it quit (or Buddy is stopping) right after verifying
        p.kill(); _close(p); _starting = None
        if _wanted:
            STATE.update(url=None, error="the Tinfoil Proxy stopped before it was ready")
        return False
    with open(PIDFILE, "w") as f:
        f.write(f"{p.pid}\n{exe}")
    mine = f"http://127.0.0.1:{port}/v1"
    def drain():                                     # keep reading its events (a full pipe would stall it)
        try:
            for line in p.stdout:
                try: msg = json.loads(line)
                except ValueError: continue
                if isinstance(msg, dict) and msg.get("event") == "verification":
                    STATE["since"] = time.time()
        except Exception:
            pass
        if STATE["url"] == mine:                     # it stopped: its address must not be used any more
            STATE.update(url=None, error="the Tinfoil Proxy stopped; restarting it")
        localcheck.forget(int(port))
    threading.Thread(target=drain, daemon=True).start()
    _proc, _starting = p, None
    STATE.update(url=mine, error="", since=time.time(), source="bundled", enclave=str(ready.get("enclave") or ""))
    return True

def _close(p):
    try: p.stdin.close()                             # (it may be gone already, or closed by the other thread)
    except (OSError, ValueError): pass

def _why(line):
    try: return str(json.loads(line).get("msg") or line)[:160]
    except ValueError: return line[:160]

def start():
    """Starts (and keeps restarting) the proxy in the background. Only once there's a Tinfoil key, so nothing
    contacts Tinfoil before you set Buddy up."""
    global _wanted
    with _lock:
        if _wanted:
            return
        _wanted = True
    def run():
        _kill_leftover()
        wait = 5
        while _wanted:
            if _proc is None or _proc.poll() is not None:
                if _proc is not None:
                    STATE.update(url=None, error="the Tinfoil Proxy stopped; restarting it")
                try:
                    ok = _start_once()
                except Exception as e:                   # never let one bad start end the restarting for good
                    STATE.update(url=None, error=f"couldn't start the Tinfoil Proxy ({type(e).__name__})"); ok = False
                if ok:
                    wait = 5
                else:
                    time.sleep(wait); wait = min(wait * 2, 300)
                    continue
            time.sleep(2)
    threading.Thread(target=run, daemon=True).start()

def stop(*_):
    global _wanted, _proc, _starting
    if not _wanted:                                  # this server never started one: leave the pidfile alone
        return
    _wanted = False
    for p in (_proc, _starting):
        if p and p.poll() is None:
            p.terminate()
            try: p.wait(timeout=3)
            except Exception: p.kill()
        if p: _close(p)
    _proc = _starting = None
    try: os.remove(PIDFILE)
    except OSError: pass
    STATE.update(url=None)

def status():
    legacy = not STATE["url"] and not binary() and _legacy_up()     # an older Tinfoil Proxy app of yours does the job
    return {"ready": bool(STATE["url"]) or legacy, "source": "legacy app" if legacy else STATE["source"],
            "error": "" if legacy else STATE["error"], "verified": STATE["since"], "bundled": bool(binary())}

atexit.register(stop)
