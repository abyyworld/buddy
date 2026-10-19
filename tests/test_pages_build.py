"""Buddy for phones' website build and signing (SPEC3 §3, §16.3 P1a): scripts/build_pages.py, publish.sh's site release,
pages.yml and scripts/check_site.sh.

- The site is built from the public copy's files (`publish.sh --tree`; in the public copy itself, from its own files)
  with a test key made here by ssh-keygen; it refuses without edition.json, with any private or development-only file,
  without site-signers (or with another key than release-signers) and with a vendored file that doesn't match its hash.
- The real build: the public copy's own web/solo/* (Buddy for phones' engine) on the site, engine last; other files in
  web/solo/ stay out (a folder of test-only stand-ins is used for the edge cases).
- Only allowlisted files come out; kit.json == kitparts.static_kit("public"); the CSP meta is exactly SPEC3 §3.4's (no
  'unsafe-inline' for scripts, no inline script left); SRI on every script; the manifest hashes every file; two builds
  (also with Python 3.9, if it's here) are byte-identical and --check catches one changed byte; no host but Tinfoil's two
  in the site's own files; the Mac's /phone never references solo/ or the site's files.
- publish.sh (local bare repos, a temp HOME with a test release key; never the owner's): a signed release writes
  release-signers exactly as before, site-signers with the same key, and site-release/ with a manifest whose signature
  verifies and which pages.yml's rebuild of the tag matches byte for byte; nothing new -> no release; without the key
  the site isn't signed and nothing is tagged; a public copy pinned to another site key -> refused.
- check_site.sh against a local copy of the site: OK, OK with --rebuild vN, and MISMATCH for a changed file; the key
  comes from --signers, the owner's ~/.ssh/buddy_release.pub or the install's pinned .release_signers, never from what
  is checked: a re-keyed clone or tag -> MISMATCH ("the repo's release key changed"); with no key of your own it says
  it only trusts the repo (and --rebuild needs the first signed release's key).
Fake data and test keys only; temp folders only.
    python3 -B -m unittest tests.test_pages_build -v       (needs git, zsh and ssh-keygen; node for one check)"""
import base64, fnmatch, functools, hashlib, http.server, json, os, re, shutil, socketserver, subprocess, sys, tempfile, threading
import unittest

ROOT = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLISH = os.path.join(ROOT, "scripts", "publish.sh")
IN_PUBLIC_COPY = not os.path.exists(PUBLISH) and os.path.exists(os.path.join(ROOT, "edition.json"))
TOOLS = all(shutil.which(t) for t in ("git", "ssh-keygen")) and (IN_PUBLIC_COPY or shutil.which("zsh"))
PY39 = "/root/.local/bin/python3.9" if os.path.exists("/root/.local/bin/python3.9") else shutil.which("python3.9")
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "media-src 'self' blob:; connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh __RELAY__; "
       "worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
       "form-action 'none'; frame-src 'none'")
ENGINE = "// test stand-in (temp only)\nwindow.BuddySoloStandIn = true;\n"
EXPECTED = {"404.html", "app.css", "app.js", "direct.js", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
            "index.html", "kit.json", "manifest.webmanifest", "pcm-tap.js", "site.js", "site.json", "sw.js",
            "vendor/ed25519.js", "vendor/tinfoil.js", "version.json", "site-manifest.json"}
_temps = []


def tmp():
    d = tempfile.mkdtemp(prefix="buddy-pages-test-")
    _temps.append(d)
    return d


def tearDownModule():
    for d in _temps:
        shutil.rmtree(d, ignore_errors=True)


def run(cmd, cwd=None, env=None, ok=True):
    p = subprocess.run(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    if ok and p.returncode != 0:
        raise AssertionError("%s failed (%d):\n%s" % (" ".join(cmd), p.returncode, p.stdout))
    return p


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def read(*p):
    with open(os.path.join(*p), "rb") as f:
        return f.read()


def write(path, text, mode="w"):
    with open(path, mode) as f:
        f.write(text)


def keygen(name="release"):
    d = tmp()
    run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "test-" + name, "-f", os.path.join(d, name)])
    pub = read(d, name + ".pub").decode().strip()
    return {"priv": os.path.join(d, name), "pub": pub, "raw": base64.b64decode(pub.split()[1])[-32:]}


def site_signers(k):
    return 'buddy-release namespaces="buddy-site" %s\n' % k["pub"]


def ignored():
    """shutil.copytree's ignore for what git would leave out here (.gitignore's patterns; what tests left behind)."""
    pats = [l.strip() for l in read(ROOT, ".gitignore").decode().splitlines() if l.strip() and not l.startswith("#")]
    pats = [p.rstrip("/") for p in pats] + [".git"]

    def ignore(d, names):
        rel = os.path.relpath(d, ROOT).replace(os.sep, "/")
        out = set()
        for n in names:
            path = n if rel == "." else rel + "/" + n
            if any(fnmatch.fnmatch(path if "/" in p else n, p) for p in pats):
                out.add(n)
        return out
    return ignore


@functools.lru_cache(maxsize=None)
def public_tree():
    d = tmp()
    if IN_PUBLIC_COPY:                                  # (the suite run in the public copy: its own tracked files)
        shutil.copytree(ROOT, os.path.join(d, "t"), ignore=ignored())
        return os.path.join(d, "t")
    run(["zsh", PUBLISH, "--tree", d])
    return d


def real_solo():
    """The public copy's own web/solo/* scripts, as the site serves them (sorted, the engine last)."""
    d = os.path.join(public_tree(), "web", "solo")
    names = sorted(n for n in os.listdir(d) if n.endswith(".js")) if os.path.isdir(d) else []
    return ["solo/" + n for n in sorted(names, key=lambda n: (n == "engine.js", n))]


def tree(key, solo=None, change=None):
    """A copy of the public tree with this test key in site-signers; `solo` (temp-only stand-ins) replaces web/solo/."""
    t = os.path.join(tmp(), "tree")
    shutil.copytree(public_tree(), t, symlinks=True)
    with open(os.path.join(t, "site-signers"), "w") as f:
        f.write(site_signers(key))
    if solo is not None:
        shutil.rmtree(os.path.join(t, "web", "solo"), ignore_errors=True)
        os.makedirs(os.path.join(t, "web", "solo"))
    for n, src in (solo or {}).items():
        with open(os.path.join(t, "web", "solo", n), "w") as f:
            f.write(src)
    if change:
        change(t)
    return t


def build(t, version=58, python=None, base=None, ok=True):
    out = os.path.join(tmp(), "site")
    cmd = [python or sys.executable, "-I", os.path.join(t, "scripts", "build_pages.py"), "--tree", t, "--out", out,
           "--version", str(version)] + (["--base", base] if base else [])
    p = run(cmd, ok=ok)
    return out, p


def listing(d):
    out = {}
    for root, _, names in os.walk(d):
        for n in names:
            out[os.path.relpath(os.path.join(root, n), d).replace(os.sep, "/")] = read(root, n)
    return out


def sri(b):
    return "sha384-" + base64.b64encode(hashlib.sha384(b).digest()).decode()


@unittest.skipUnless(TOOLS, "needs git, zsh and ssh-keygen")
class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = keygen()
        cls.tree = tree(cls.key)                         # (the real web/solo/*, as publish.sh --tree has it)
        cls.solo = real_solo()
        cls.site, cls.out = build(cls.tree)
        cls.files = listing(cls.site)
        cls.html = cls.files["index.html"].decode()

    def refused(self, change, part, key=None):
        t = tree(key or self.key, change=change)
        out, p = build(t, ok=False)
        self.assertNotEqual(p.returncode, 0, p.stdout)
        self.assertIn("Refusing:", p.stdout)
        self.assertIn(part, p.stdout)
        self.assertFalse(os.path.exists(out) and os.listdir(out), "nothing written")

    def test_refuses_without_edition_json(self):
        self.refused(lambda t: os.remove(os.path.join(t, "edition.json")), "edition.json")
        self.refused(lambda t: write(os.path.join(t, "edition.json"), '{"edition": "private"}'), "public")

    def test_refuses_private_or_dev_only_files(self):
        for name in (".tinfoil_key", ".thread.json", "config.local.json", ".sync_keys", ".backup_key", "CLAUDE.md",
                     "scripts/publish.sh"):
            self.refused(lambda t: write(os.path.join(t, *name.split("/")), "fake"), name)
        self.refused(lambda t: os.makedirs(os.path.join(t, "my-characters")), "my-characters")

    def test_refuses_without_a_good_site_key(self):
        self.refused(lambda t: os.remove(os.path.join(t, "site-signers")), "site-signers is missing")
        self.refused(lambda t: write(os.path.join(t, "site-signers"),
                                     'buddy-release namespaces="git" %s\n' % self.key["pub"]), "site-signers must be one line")
        other = keygen("other")
        self.refused(lambda t: write(os.path.join(t, "release-signers"),
                                     'buddy-release namespaces="git" %s\n' % other["pub"]), "different keys")
        t = tree(self.key, change=lambda t: write(os.path.join(t, "release-signers"),
                                                  'buddy-release namespaces="git" %s\n' % self.key["pub"]))
        self.assertEqual(build(t)[1].returncode, 0, "the same key in both is fine")

    def test_refuses_a_vendored_file_that_doesnt_match(self):
        for rel in ("web/vendor/tinfoil.mjs", "web/vendor/ed25519.js"):
            self.refused(lambda t: write(os.path.join(t, *rel.split("/")), "\n// changed", "a"), rel)

    def test_allowlist(self):
        self.assertIn("solo/engine.js", self.solo, "the public copy has Buddy for phones' engine")
        self.assertEqual(set(self.files), EXPECTED | set(self.solo))
        for p in self.solo:
            self.assertEqual(self.files[p], read(ROOT, "web", p), p + " byte for byte")
        t = tree(self.key, solo={"engine.js": ENGINE, "notes.md": "not a script", "Bad Name.js": "x"})
        self.assertIn("isn't a name the site takes", build(t, ok=False)[1].stdout)
        t = tree(self.key, solo={"engine.js": ENGINE, "notes.md": "not a script"})
        self.assertEqual(set(listing(build(t)[0])), EXPECTED | {"solo/engine.js"}, "other files in web/solo/ stay out")
        t = tree(self.key, solo={"engine.js": ENGINE}, change=lambda t: os.symlink("/etc/hostname", os.path.join(t, "web", "solo", "x.js")))
        self.assertIn("is a link", build(t, ok=False)[1].stdout)
        self.assertEqual(set(listing(build(tree(self.key, solo={}))[0])), EXPECTED, "an empty web/solo/: the site still builds")

    def test_kit_json_is_static_kit_public(self):
        home = tmp()
        p = subprocess.run([sys.executable, "-I", "-c", "import json, sys; sys.path.insert(0, sys.argv[1]); import kitparts; "
                            "print(json.dumps(kitparts.static_kit('public')))", self.tree],
                           env=dict(os.environ, HOME=home), stdout=subprocess.PIPE, universal_newlines=True, check=True)
        self.assertEqual(json.loads(self.files["kit.json"]), json.loads(p.stdout))
        self.assertTrue(json.loads(self.files["kit.json"])["edition"]["public"])
        self.assertEqual(os.listdir(home), [], "HOME stayed empty")

    def test_csp_meta_exact_and_no_inline_script(self):
        metas = re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', self.html)
        self.assertEqual(metas, [CSP])
        script_src = re.search(r"script-src ([^;]*);", CSP).group(1)
        self.assertNotIn("unsafe-inline", script_src)
        self.assertEqual(re.search(r"connect-src ([^;]*);", CSP).group(1),
                         "'self' https://atc.tinfoil.sh https://inference.tinfoil.sh __RELAY__")
        self.assertEqual(self.html.count("__RELAY__"), 1)
        self.assertNotIn("<script>", self.html)
        self.assertNotIn("<style>", self.html)
        self.assertIsNone(re.search(r"<[a-zA-Z][^>]*\son[a-z]+\s*=", self.html))
        self.assertIn('<meta name="buddy-site" content="solo">', self.html)
        self.assertIn('<meta name="referrer" content="no-referrer">', self.html)
        sw = self.files["sw.js"].decode()
        self.assertEqual(re.search(r'const CSP = ((?:"[^"]*"(?: \+\s*)?)+);', sw).group(1).replace('" +\n  "', "").strip('"'), CSP,
                         "the worker's header CSP is the same policy")
        self.assertIn("frame-ancestors 'none'", sw)
        for rel in ("href", "src"):
            self.assertEqual(re.findall(r'\b%s="/' % rel, self.html), [], "no absolute links (the site lives under /buddy/)")

    def test_sri_on_every_script(self):
        tags = re.findall(r"<script\b([^>]*)>", self.html)
        self.assertTrue(tags)
        srcs = []
        for attrs in tags:
            src = re.search(r'src="([^"]+)"', attrs).group(1)
            self.assertEqual(re.search(r'integrity="([^"]+)"', attrs).group(1), sri(self.files[src]), src)
            srcs.append(src)
        self.assertEqual(srcs, ["site.js"] + self.solo + ["direct.js", "app.js"],
                         "site.js first, web/solo/* sorted with the engine last, before direct.js")
        harness = os.path.join(ROOT, "tests", "solo", "harness.mjs")
        if os.path.exists(harness):                     # (the solo tests' stand-in site loads them in the same order)
            m = re.search(r"^export const SOLO_FILES = (\[[^\]]*\]);", read(harness).decode(), re.M)
            self.assertEqual(["solo/%s.js" % f for f in json.loads(m.group(1))], self.solo, "tests/solo/harness.mjs SOLO_FILES")
        self.assertLess(self.html.index("site.js"), self.html.index("</head>"))
        pre = re.findall(r'<link rel="modulepreload" href="vendor/tinfoil.js" integrity="([^"]+)">', self.html)
        self.assertEqual(pre, [sri(self.files["vendor/tinfoil.js"])])

    def test_manifest_hashes_every_file(self):
        man = json.loads(self.files["site-manifest.json"])
        self.assertEqual(set(man), {"v", "edition", "files"})
        self.assertEqual((man["v"], man["edition"]), (58, "public"))
        self.assertEqual(set(man["files"]), set(self.files) - {"site-manifest.json"})
        for p, h in man["files"].items():
            self.assertEqual(h, sha256(self.files[p]), p)
        self.assertEqual(json.loads(self.files["version.json"]), {"v": 58})
        self.assertEqual(json.loads(self.files["site.json"]), {"relay": "", "invite": True, "name": "Buddy"})

    def test_two_builds_are_byte_identical_and_check_catches_a_change(self):
        again = listing(build(self.tree)[0])
        self.assertEqual(again, self.files)
        if PY39:
            self.assertEqual(listing(build(self.tree, python=PY39)[0]), self.files, "Python 3.9 builds the same bytes")
        cmd = [sys.executable, "-I", os.path.join(self.tree, "scripts", "build_pages.py"), "--tree", self.tree, "--version", "58"]
        p = run(cmd + ["--check", self.site])
        self.assertIn("matches release v58 byte for byte", p.stdout)
        changed = os.path.join(tmp(), "site")
        shutil.copytree(self.site, changed)
        with open(os.path.join(changed, "app.js"), "ab") as f:
            f.write(b" ")
        p = run(cmd + ["--check", changed], ok=False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("differs: app.js", p.stdout)
        p = run(cmd[:-1] + ["59", "--check", self.site], ok=False)
        self.assertEqual(p.returncode, 1, "another version doesn't match")

    def test_no_host_but_tinfoils_in_the_sites_own_files(self):
        hosts = set()
        for p, b in self.files.items():
            if p.startswith("vendor/") or p.endswith(".png"):
                continue
            hosts |= {h.lower() for h in re.findall(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://([A-Za-z0-9.-]+)", b.decode())}
        never_contacted = {"www.w3.org", "login.tailscale.com"}          # (SVG namespaces; Mac-only links, hidden)
        self.assertTrue({h for h in hosts if not h.endswith(".invalid")} <= {"atc.tinfoil.sh", "inference.tinfoil.sh"} | never_contacted,
                        sorted(hosts))
        self.assertEqual(self.files["vendor/tinfoil.js"], read(ROOT, "web", "vendor", "tinfoil.mjs"), "the SDK byte for byte")
        self.assertEqual(self.files["vendor/ed25519.js"], read(ROOT, "web", "vendor", "ed25519.js"))
        self.assertFalse([p for p in self.files if p.endswith(".mjs")], "no .mjs on the site (gate G8)")

    def test_direct_js_only_loads_the_sdk_as_js(self):
        mine, theirs = self.files["direct.js"].decode().split("\n"), read(ROOT, "web", "direct.js").decode().split("\n")
        diff = [(a, b) for a, b in zip(mine, theirs) if a != b]
        self.assertEqual(len(mine), len(theirs))
        self.assertEqual(diff, [('  const SDK_URL = "/vendor/tinfoil.js";', '  const SDK_URL = "/vendor/tinfoil.mjs";')])
        t = tree(self.key, solo={"engine.mjs": 'import { b } from "./b.mjs";\nexport const a = b;\n', "b.mjs": "export const b = 1;\n"})
        files = listing(build(t)[0])
        self.assertIn('from "./b.js"', files["solo/engine.js"].decode())
        self.assertIn('<script type="module" src="solo/engine.js"', files["index.html"].decode())

    def test_app_js_is_the_inline_script_with_the_frame_guard(self):
        chat = read(ROOT, "web", "chat.html").decode()
        inline = re.findall(r"<script>(.*?)</script>", chat, re.S)[0]
        app = self.files["app.js"].decode()
        lines = app.split("\n")
        self.assertEqual(lines[1], '"use strict";', "the directive stays first")
        self.assertTrue(lines[2].startswith('if (window.top !== window.self) throw new Error("Open Buddy in its own window");'))
        self.assertEqual("\n".join(lines[:2] + lines[3:]), inline)
        self.assertEqual(self.files["app.css"].decode(), "\n".join(re.findall(r"<style>(.*?)</style>", chat, re.S)))
        if shutil.which("node"):
            for p in ("app.js", "sw.js", "site.js", "direct.js"):
                f = os.path.join(self.site, p)
                run(["node", "--check", f])

    def test_chat_html_code_may_name_the_site_but_its_markup_is_checked(self):
        line = "const SOLO_T = !!document.querySelector('meta[name=\"buddy-site\"]') && \"<style>x</style>\";\n"

        def solo_code(t):
            p = os.path.join(t, "web", "chat.html")
            write(p, read(p).decode().replace('<script>\n"use strict";\n', '<script>\n"use strict";\n' + line, 1))
        files = listing(build(tree(self.key, change=solo_code))[0])
        self.assertIn(line, files["app.js"].decode(), "solo-mode code naming the meta is fine")
        self.assertEqual(files["app.css"], self.files["app.css"], "a <style> inside the code isn't the page's style")

        def second(t):
            p = os.path.join(t, "web", "chat.html")
            write(p, read(p).decode().replace("</body>", "<script>window.SECOND_T = 1;</script>\n</body>", 1))
        files = listing(build(tree(self.key, change=second))[0])
        self.assertEqual(files["app-2.js"], b"window.SECOND_T = 1;", "a second inline script gets its own file")
        html = files["index.html"].decode()
        self.assertLess(html.index('src="app.js"'), html.index('src="app-2.js" integrity="%s"' % sri(files["app-2.js"])))
        for markup, why in (('<button onclick="go()">x</button>', "inline event handler"),
                            ('<a href="javascript:go()">x</a>', "inline event handler"),
                            ('<meta name="buddy-site" content="solo">', "already has the buddy-site meta"),
                            ('<script src="/elsewhere.js"></script>', "loads /elsewhere.js"),
                            ('<script type="module">x</script>', "doesn't know"),
                            ('<script>x()</script><script>y()</script>' * 5, "its inline <script>"),
                            ('<img src="/nope.png">', "links /nope.png")):
            def add(t, markup=markup):
                p = os.path.join(t, "web", "chat.html")
                write(p, read(p).decode().replace("<body>", "<body>" + markup, 1))
            self.refused(add, why)

    def test_sw_has_this_release_baked_in(self):
        sw = self.files["sw.js"].decode()
        self.assertIn("\nconst VERSION = 58;", sw)
        files = json.loads(re.search(r"^const FILES = (\[.*\]);$", sw, re.M).group(1))
        self.assertEqual(files, sorted(set(self.files) - {"sw.js", "version.json", "404.html", "site-manifest.json"}))
        self.assertIn('\nconst SIGNER = "%s";' % base64.b64encode(self.key["raw"]).decode(), sw)
        self.assertNotIn("const VERSION = 0;", sw)
        src = read(ROOT, "web", "sw-site.js").decode()
        for line in ("const VERSION = 0;", "const FILES = [];", 'const SIGNER = "";'):
            self.assertEqual(src.count("\n" + line), 1, "the source keeps its placeholder " + line)

    def test_web_manifest_and_404(self):
        m = json.loads(self.files["manifest.webmanifest"])
        self.assertEqual((m["start_url"], m["scope"]), ("./", "./"), "= /buddy/ on Pages, and / in the tests")
        self.assertNotIn("id", m)
        self.assertTrue(all(i["src"] in self.files for i in m["icons"]))
        nf = self.files["404.html"].decode()
        self.assertIn('url=/buddy/"', nf)
        self.assertNotIn("<script", nf)
        self.assertIn('url=/"', listing(build(self.tree, base="/")[0])["404.html"].decode())

    def test_the_macs_phone_is_untouched(self):
        chat = read(ROOT, "web", "chat.html").decode()
        self.assertIsNone(re.search(r"""(src|href)=["'][^"']*(solo/|site\.js|sw-site\.js)""", chat))
        self.assertIsNone(re.search(r"""import\(\s*["'][^"']*solo/""", chat))
        markup = re.sub(r"<(script|style)>.*?</\1>", "", chat, flags=re.S)   # (its code may look for the site's meta)
        self.assertNotIn('name="buddy-site"', markup)
        sw = read(ROOT, "web", "sw.js").decode()
        self.assertNotIn("solo/", sw)
        self.assertNotIn("sw-site", sw)
        server = read(ROOT, "buddy_server.py").decode()
        shell = re.search(r"SHELL_FILES = \((.*?)\)\n", server, re.S).group(1)
        self.assertNotIn("solo", shell)
        self.assertNotIn("site.js", shell)
        self.assertEqual(json.loads(read(ROOT, "web", "manifest.json"))["start_url"], "/phone")

    def test_check_site_sh(self):
        site = os.path.join(tmp(), "site")
        shutil.copytree(self.site, site)
        subprocess.run(["ssh-keygen", "-q", "-Y", "sign", "-f", self.key["priv"], "-n", "buddy-site",
                        os.path.join(site, "site-manifest.json")], check=True)
        signers = os.path.join(self.tree, "site-signers")
        check = os.path.join(ROOT, "scripts", "check_site.sh")
        here, home = tmp(), tmp()                       # (no ./site-signers, no ~/.ssh key: only what each case gives)
        env = dict(os.environ, HOME=home)
        chk = lambda *a, cwd=here, env=env, ok=True: run(["sh", check] + list(a), cwd=cwd, env=env, ok=ok)
        httpd, url = serve(site)
        try:
            ok = chk(url, "--signers", signers)
            self.assertIn("OK: %s is release v58, signed by Buddy's release key; all its files match (manifest %s)."
                          % (url, sha256(self.files["site-manifest.json"])[:16]), ok.stdout)
            other = keygen("other")
            o = os.path.join(tmp(), "other-signers")
            write(o, site_signers(other))
            bad = chk(url, "--signers", o, ok=False)
            self.assertIn("MISMATCH: site-manifest.json isn't signed by Buddy's release key", bad.stdout)
            # the owner's key in HOME, or this install's pinned .release_signers, decides; never the folder's site-signers
            os.makedirs(os.path.join(home, ".ssh"))
            write(os.path.join(home, ".ssh", "buddy_release.pub"), self.key["pub"] + "\n")
            real = tmp()
            write(os.path.join(real, "site-signers"), site_signers(self.key))
            self.assertIn("OK: ", chk(url, cwd=real).stdout, "the real key in HOME and in the clone")
            self.assertIn("OK: ", chk(url).stdout, "the real key in HOME alone")
            evil = keygen("evil")                       # a re-keyed (taken over) repo, and a site signed with that key
            esite = os.path.join(tmp(), "esite")
            shutil.copytree(site, esite)
            os.remove(os.path.join(esite, "site-manifest.json.sig"))
            subprocess.run(["ssh-keygen", "-q", "-Y", "sign", "-f", evil["priv"], "-n", "buddy-site",
                            os.path.join(esite, "site-manifest.json")], check=True)
            rekeyed = tmp()
            write(os.path.join(rekeyed, "site-signers"), site_signers(evil))
            ehttpd, eurl = serve(esite)
            try:
                bad = chk(eurl, cwd=rekeyed, ok=False)
                self.assertEqual(bad.returncode, 1, bad.stdout)
                self.assertIn("MISMATCH: the repo's release key changed: ./site-signers names another key than your ~/.ssh/buddy_release.pub", bad.stdout)
                self.assertNotIn("OK:", bad.stdout)
                bad = chk(eurl, ok=False)
                self.assertIn("MISMATCH: site-manifest.json isn't signed by Buddy's release key", bad.stdout, "the evil site, the real key")
                pinned = tmp()                          # no HOME key: the install's own pinned key (release-signers' format)
                write(os.path.join(pinned, ".release_signers"), 'buddy-release namespaces="git" %s\n' % self.key["pub"])
                write(os.path.join(pinned, "site-signers"), site_signers(evil))
                noenv = dict(os.environ, HOME=tmp())
                bad = chk(eurl, cwd=pinned, env=noenv, ok=False)
                self.assertIn("MISMATCH: the repo's release key changed: ./site-signers names another key than the key this install pinned", bad.stdout)
                os.remove(os.path.join(pinned, "site-signers"))
                self.assertIn("OK: ", chk(url, cwd=pinned, env=noenv).stdout, "the pinned key alone, the real site")
                weak = chk(eurl, cwd=rekeyed, env=noenv)  # nothing of your own: it says plainly it trusts the folder
                self.assertIn("Note: no key of your own to check with", weak.stdout)
                self.assertIn("only trusts what this folder's site-signers says", weak.stdout)
            finally:
                ehttpd.shutdown()
                ehttpd.server_close()
            write(os.path.join(site, "solo", "engine.js"), "\n// changed", "a")
            bad = chk(url, "--signers", signers, ok=False)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("MISMATCH: solo/engine.js isn't the signed file", bad.stdout)
            self.assertNotEqual(chk("http://example.invalid/buddy/", ok=False).returncode, 0, "https only")
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_pages_workflow(self):
        y = read(ROOT, ".github", "workflows", "pages.yml").decode()
        self.assertEqual(y.count("if: github.repository == 'abyyworld/buddy'"), 2, "both jobs run only in the public repo")
        self.assertIn('tags: ["v*"]', y)
        uses = re.findall(r"uses: (\S+)", y)
        self.assertEqual(len(uses), 3)
        for u in uses:
            self.assertRegex(u, r"^actions/(checkout|upload-pages-artifact|deploy-pages)@[0-9a-f]{40}$", "pinned by commit")
        self.assertIn("name: github-pages", y)
        self.assertIn("verify-tag", y)
        self.assertIn("ssh-keygen -Y verify -f site-signers -I buddy-release -n buddy-site", y)
        self.assertIn('cmp site-release/site-manifest.json "$RUNNER_TEMP/site/site-manifest.json"', y)
        self.assertIn("test -f edition.json", y)
        self.assertIn("persist-credentials: false", y)
        top = y[:y.index("jobs:")]
        self.assertIn("permissions:\n  contents: read", top)
        self.assertEqual(y.count("pages: write"), 1)
        self.assertLess(y.index("ssh-keygen -Y verify"), y.index("upload-pages-artifact"), "checked before the upload")


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory):
    """A local copy of the site at http://127.0.0.1:<port>/buddy/ (a thread; stopped by the caller)."""
    root = tmp()
    os.symlink(directory, os.path.join(root, "buddy"))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d/buddy/" % httpd.server_address[1]


@unittest.skipUnless(TOOLS and not IN_PUBLIC_COPY and shutil.which("zsh"), "needs publish.sh (this repo), git, zsh, ssh-keygen")
class Publish(unittest.TestCase):
    """publish.sh end to end into local bare repos, with a test release key in a temp HOME."""

    def setUp(self):
        self.d = tmp()
        self.home = os.path.join(self.d, "home")
        os.makedirs(os.path.join(self.home, ".ssh"))
        self.key = os.path.join(self.home, ".ssh", "buddy_release")
        run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "test release", "-f", self.key])
        self.pub = read(self.key + ".pub").decode().strip()
        self.priv = os.path.join(self.d, "priv")
        os.makedirs(self.priv)
        archive = subprocess.run(["git", "-C", ROOT, "archive", "HEAD"], stdout=subprocess.PIPE, check=True).stdout
        subprocess.run(["tar", "-x", "-C", self.priv], input=archive, check=True)
        me = ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"]
        self.git = lambda *a, cwd=None: run(["git"] + me + list(a), cwd=cwd or self.priv)
        self.git("init", "-q", "-b", "main")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "private main")
        run(["git", "clone", "-q", "--bare", self.priv, os.path.join(self.d, "origin.git")])
        self.git("remote", "add", "origin", os.path.join(self.d, "origin.git"))
        self.git("fetch", "-q", "origin")
        self.git("branch", "-q", "--set-upstream-to=origin/main", "main")
        self.public = os.path.join(self.d, "public.git")
        run(["git", "init", "-q", "--bare", self.public])
        run(["git", "-C", self.public, "symbolic-ref", "HEAD", "refs/heads/main"])
        self.env = dict(os.environ, HOME=self.home, BUDDY_PUBLIC=self.public, GIT_CONFIG_NOSYSTEM="1")
        self.env.pop("GIT_CONFIG_GLOBAL", None)

    def publish(self, msg="Test publish", ok=True):
        return run(["zsh", os.path.join(self.priv, "scripts", "publish.sh"), msg], cwd=self.priv, env=self.env, ok=ok)

    def clone(self):
        c = os.path.join(tmp(), "pub")
        run(["git", "clone", "-q", self.public, c])
        return c

    def test_a_signed_release_signs_the_site(self):
        p = self.publish()
        self.assertIn("Published and signed v1", p.stdout)
        c = self.clone()
        self.assertEqual(read(c, "release-signers").decode(), 'buddy-release namespaces="git" %s\n' % self.pub,
                         "release-signers exactly as installs pin it")
        self.assertEqual(read(c, "site-signers").decode(), 'buddy-release namespaces="buddy-site" %s\n' % self.pub)
        for f in ("CLAUDE.md", "scripts/publish.sh"):
            self.assertFalse(os.path.exists(os.path.join(c, f)), f + " stays private")
        man = os.path.join(c, "site-release", "site-manifest.json")
        v = subprocess.run(["ssh-keygen", "-Y", "verify", "-f", os.path.join(c, "site-signers"), "-I", "buddy-release",
                            "-n", "buddy-site", "-s", man + ".sig"], input=read(man), stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT)
        self.assertEqual(v.returncode, 0, v.stdout)
        self.assertEqual(json.loads(read(man))["v"], 1)
        run(["git", "-c", "gpg.ssh.program=ssh-keygen", "-c", "gpg.ssh.allowedSignersFile=" + os.path.join(c, "release-signers"),
             "verify-tag", "v1"], cwd=c)
        # what pages.yml does: build the tag's own files and compare with the signed manifest byte for byte
        site, _ = build(c, version=1)
        self.assertEqual(read(site, "site-manifest.json"), read(man))
        # check_site.sh against a local copy of that site (with the signature, as Pages would serve it)
        shutil.copy(man + ".sig", os.path.join(site, "site-manifest.json.sig"))
        httpd, url = serve(site)
        try:
            ok = run(["sh", os.path.join(ROOT, "scripts", "check_site.sh"), url, "--rebuild", "v1"], cwd=c)
            self.assertIn("OK: " + url + " is release v1", ok.stdout)
            self.assertIn("exactly what tag v1 builds", ok.stdout)
            with open(os.path.join(site, "app.js"), "ab") as f:
                f.write(b"\n// not the signed file")
            bad = run(["sh", os.path.join(ROOT, "scripts", "check_site.sh"), url, "--signers", os.path.join(c, "site-signers")],
                      cwd=c, ok=False)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("MISMATCH: app.js isn't the signed file", bad.stdout)
            # a re-keyed repo: a newer tag whose release-signers and site-signers name another key, signed by it
            rk = self.clone()
            evil = os.path.join(self.d, "evil")
            run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "test evil", "-f", evil])
            epub = read(evil + ".pub").decode().strip()
            write(os.path.join(rk, "release-signers"), 'buddy-release namespaces="git" %s\n' % epub)
            write(os.path.join(rk, "site-signers"), 'buddy-release namespaces="buddy-site" %s\n' % epub)
            me = ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"]
            run(["git"] + me + ["commit", "-q", "-am", "new key"], cwd=rk)
            run(["git"] + me + ["-c", "gpg.format=ssh", "-c", "user.signingkey=" + evil + ".pub", "tag", "-s", "v2", "-m", "v2"], cwd=rk)
            chk = lambda env: run(["sh", os.path.join(ROOT, "scripts", "check_site.sh"), url, "--rebuild", "v2"], cwd=rk, env=env, ok=False)
            bad = chk(self.env)                         # (the owner's key in HOME)
            self.assertEqual(bad.returncode, 1, bad.stdout)
            self.assertIn("MISMATCH: the repo's release key changed: ./site-signers names another key than your ~/.ssh/buddy_release.pub", bad.stdout)
            run(["git", "checkout", "-q", "v1"], cwd=rk)  # (an old clone whose files still have the real key, after git fetch --tags)
            bad = chk(self.env)
            self.assertIn("MISMATCH: the repo's release key changed: v2's release-signers names another key", bad.stdout)
            bad = chk(dict(self.env, HOME=tmp()))       # nothing of your own: the key must be the first signed release's
            self.assertIn("MISMATCH: the repo's release key changed: v2's release-signers isn't the one its first signed release (v1) had", bad.stdout)
        finally:
            httpd.shutdown()
            httpd.server_close()
        # nothing new: no release; a change: v2
        self.assertIn("Nothing new to publish.", self.publish().stdout)
        with open(os.path.join(self.priv, "README.md"), "a") as f:
            f.write("\nA test change.\n")
        self.git("commit", "-q", "-am", "change")
        self.git("push", "-q", "origin", "main")
        self.assertIn("Published and signed v2", self.publish().stdout)
        c2 = self.clone()
        self.assertEqual(json.loads(read(c2, "site-release", "site-manifest.json"))["v"], 2)
        self.assertEqual(read(c2, "release-signers"), read(c, "release-signers"), "release-signers never edited")

    def test_without_the_key_the_site_isnt_signed(self):
        os.remove(self.key)
        p = self.publish()
        self.assertIn("The site isn't signed", p.stdout)
        c = self.clone()
        for f in ("site-signers", "release-signers", "site-release"):
            self.assertFalse(os.path.exists(os.path.join(c, f)), f)
        self.assertEqual(run(["git", "tag", "-l"], cwd=c).stdout.strip(), "", "no tag, so pages.yml never runs")

    def test_a_public_copy_pinned_to_another_site_key_is_refused(self):
        c = os.path.join(tmp(), "seed")
        run(["git", "clone", "-q", self.public, c])
        other = keygen("other")
        with open(os.path.join(c, "site-signers"), "w") as f:
            f.write(site_signers(other))
        run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A"], cwd=c)
        run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "seed"], cwd=c)
        run(["git", "push", "-q", "origin", "HEAD:main"], cwd=c)
        p = self.publish(ok=False)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("site is signed by a different key", p.stdout)

    def test_publish_refuses_site_files_tracked_here(self):
        with open(os.path.join(self.priv, "site-signers"), "w") as f:
            f.write("x\n")
        self.git("add", "site-signers")
        self.git("commit", "-q", "-m", "oops")
        self.git("push", "-q", "origin", "main")
        p = self.publish(ok=False)
        self.assertIn("site-signers or site-release/ is tracked here", p.stdout)


if __name__ == "__main__":
    unittest.main()
