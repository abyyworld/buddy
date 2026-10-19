"""Before anything private goes to a helper on this Mac (the Tinfoil Proxy, an image app, Ollama), check that the
program listening on that port runs as you. Another macOS account, or an app that grabbed the port first, could
otherwise pose as the Tinfoil Proxy and receive your chats in plain text.

Every connection to such a helper is checked again once it's made, before a single byte is sent: the program that
accepted it must be that same program of yours (a helper that just stopped frees its port, and another account's
program could take it between the check and the connection)."""
import http.client, ipaddress, os, select, socket, subprocess, time, urllib.parse, urllib.request

_seen = {}   # port -> (checked_at, pids of your programs listening there)
LSOF = "/usr/sbin/lsof"

def _listeners(port, fresh=False):
    """The pids listening on this local port, if they're all yours (else none). (lsof only sees your own processes
    without admin rights, so a listener owned by anyone else shows up as nothing at all, which counts as 'not yours'.)"""
    hit = _seen.get(port)
    if hit and not fresh and time.time() - hit[0] < 5:     # only "yes" is remembered, briefly
        return hit[1]
    pids, uids = set(), set()
    try:
        out = subprocess.run([LSOF, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fpu"],
                             capture_output=True, text=True, timeout=5).stdout
        for l in out.splitlines():
            if l[:1] == "p" and l[1:].isdigit(): pids.add(l[1:])
            elif l[:1] == "u" and l[1:].isdigit(): uids.add(int(l[1:]))
    except Exception:
        pids = set()
    if pids and uids == {os.getuid()}:
        _seen[port] = (time.time(), pids)
        return pids
    _seen.pop(port, None)
    return set()

def own_port(port):
    """True if whatever listens on this local port belongs to you."""
    if not os.path.exists(LSOF):          # not a Mac (tests): nothing to check with
        return True
    return bool(_listeners(port))

def _loopback(addr):
    try:
        ip = ipaddress.ip_address(str(addr).split("%")[0])
        return ip.is_loopback or ip.is_unspecified or bool(getattr(ip, "ipv4_mapped", None) and ip.ipv4_mapped.is_loopback)
    except ValueError:
        return False

def _local(host):
    """This name means this Mac (however it's spelled: 127.0.0.1, 127.1, localhost, ::1, ...). Names are never looked
    up (no DNS for every request): any other name that leads here is caught by the check on the connection itself."""
    host = (host or "").strip("[]").lower()
    if host == "localhost" or _loopback(host):
        return True
    try:
        return any(_loopback(a[4][0]) for a in socket.getaddrinfo(host, None, flags=socket.AI_NUMERICHOST))
    except Exception:
        return False

def _accepted_by_listener(sock, port, wait):
    """True once the connection on sock was accepted by the program of yours that listens on port. A busy program
    may leave it waiting in the queue for a while: up to `wait` seconds, as long as that program still listens
    (None if it's still yours and listening but never took it: busy). False otherwise."""
    host, me = sock.getsockname()[:2]
    at = f"[{host}]" if ":" in host else host
    pids, end, nap, refreshed = _listeners(port), time.monotonic() + wait, 0.01, time.monotonic()
    while pids:
        try:
            out = subprocess.run([LSOF, "-nP", "-a", "-p", ",".join(sorted(pids)), f"-iTCP@{at}:{me}", "-Fp"],
                                 capture_output=True, text=True, timeout=5).stdout
        except Exception:
            return False
        if any(l[1:] in pids for l in out.splitlines() if l[:1] == "p"):
            return True
        if select.select([sock], [], [], 0)[0]:   # reset or closed before anyone of yours took it (nothing was sent yet,
            return False                         # so only a stopped program, or someone else, can make it readable)
        if time.monotonic() > end:
            return None
        if nap == 0.01 or time.monotonic() - refreshed > 2:     # still listening? (a remembered program may be gone)
            pids, refreshed = _listeners(port, fresh=True), time.monotonic()
        time.sleep(nap); nap = min(nap * 2, 0.25)
    return False

class _Checked(http.client.HTTPConnection):
    def connect(self):
        super().connect()
        peer, port = self.sock.getpeername()[:2]
        if _loopback(peer) and os.path.exists(LSOF):
            wait = min(self.timeout, 30) if isinstance(self.timeout, (int, float)) else 30
            ok = _accepted_by_listener(self.sock, port, wait)
            if not ok:
                self.sock.close(); self.sock = None
                why = "was busy and didn't take the connection in time" if ok is None else "isn't the one Buddy checked"
                raise RuntimeError(f"the program on this Mac's port {port} {why}, so nothing was sent")

class _Handler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_Checked, req)

def opener():
    """For urllib: never through a proxy, and every connection to a helper on this Mac checked as above."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _Handler())

class NotYours(RuntimeError):
    """No program of yours listens on that port: someone else's does, or (lsof can't tell these apart) nothing at all."""

def check(url):
    """Raises NotYours unless url is remote, or local and served by a program of yours."""
    u = urllib.parse.urlparse(url)
    if _local(u.hostname) and not own_port(u.port or 80):
        raise NotYours(f"the program on this Mac's port {u.port} isn't running as you, so nothing was sent "
                       "(is the Tinfoil Proxy running?)")

def forget(port):
    """Forgets a "yes" for this port (its program stopped; whatever listens there next is checked again)."""
    _seen.pop(port, None)
