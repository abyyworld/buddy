"""Phone mode's integration suite (SPEC2 §15.6): the real Buddy server, on a copy of the repo's runtime files in a temp
folder with a temp HOME, so nothing in the repo changes and nothing real is read (the copy has no keys, notes,
characters or settings of its own: git-ignored files are never copied). No Tinfoil proxy, no background workers.
The copy's web/vendor/tinfoil.mjs is replaced by the fake SDK (tests/phonemode/fake_tinfoil.mjs), so /api/version
hashes it and the service worker keeps it like any shell file.

  python3 -B tests/phonemode/integration/serve.py                  -> {"port", "token", "root", "home", "pid"}
  python3 -B tests/phonemode/integration/serve.py --root R --port N  (again on that copy, e.g. after a stop)
token is the copy's own Mac token (made fresh for it; it's the cookie of the Mac app's window)."""
import argparse, json, os, shutil, signal, subprocess, sys, tempfile, threading

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SKIP = ("tests/", "docs/", ".github/")

def copy_repo(root):
    """The files git knows of (tracked, and new ones not ignored), minus tests, docs and CI."""
    out = subprocess.run(["git", "-C", REPO, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                         check=True, capture_output=True).stdout.decode().split("\0")
    for f in out:
        if not f or f.startswith(SKIP) or not os.path.isfile(os.path.join(REPO, f)):
            continue
        dst = os.path.join(root, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(REPO, f), dst)
    shutil.copyfile(os.path.join(REPO, "tests", "phonemode", "fake_tinfoil.mjs"), os.path.join(root, "web", "vendor", "tinfoil.mjs"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root"); ap.add_argument("--port", type=int, default=0)
    a = ap.parse_args()
    if a.root:
        root, home = a.root, os.path.join(os.path.dirname(a.root), "home")
    else:
        tmp = tempfile.mkdtemp(prefix="buddy-integration-")
        root, home = os.path.join(tmp, "repo"), os.path.join(tmp, "home")
        os.makedirs(home, mode=0o700)
        copy_repo(root)
    os.environ["HOME"] = home                            # (~/Buddy: the notes folder and saved chats, in the temp home)
    os.environ["NO_PROXY"] = "*"
    sys.dont_write_bytecode = True
    sys.path.insert(0, root)
    os.chdir(root)
    import buddy_server as b                             # (the copy's own: its HERE is the temp folder)
    assert os.path.dirname(os.path.abspath(b.__file__)) == root, "imported the wrong buddy_server"
    server = b.ThreadingHTTPServer(("127.0.0.1", a.port), b.Handler)
    b.tighten()
    b.devices.ensure()
    print(json.dumps({"port": server.server_address[1], "token": b.devices.mac_token(), "root": root, "home": home,
                      "pid": os.getpid()}), flush=True)
    signal.signal(signal.SIGTERM, lambda *x: (threading.Thread(target=server.shutdown, daemon=True).start(), None))
    server.serve_forever()
    server.server_close()

if __name__ == "__main__":
    main()
