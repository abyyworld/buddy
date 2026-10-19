"""Phone mode's app shell (SPEC2 §3.5, §7): what the service worker keeps for opening Buddy while the Mac is away, and
the page rules that protect this phone's key. Reads only the repo's own code (never data); no network, no browser.
Run from Buddy's folder:  python3 -B -m unittest tests.test_phonemode_shell -v"""
import ast, json, os, re, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
SPEC_SHELL = ["/phone", "/direct.js", "/pcm-tap.js", "/manifest.json", "/vendor/tinfoil.mjs",
              "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png"]

def text(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()

def sw_shell():
    m = re.search(r"const SHELL = \[(.*?)\];", text("web", "sw.js"), re.S)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else None

def server_shell_files():
    """SHELL_FILES from buddy_server.py, read without running it."""
    for node in ast.parse(text("buddy_server.py")).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "SHELL_FILES" for t in node.targets):
            return list(ast.literal_eval(node.value))
    return None

def as_url(f):
    """SHELL_FILES entry -> the URL the service worker keeps (SPEC2 §3.5)."""
    return "/phone" if f == "chat.html" else "/icons/" + f[len("default-icons/"):] if f.startswith("default-icons/") else "/" + f


class Shell(unittest.TestCase):
    def test_sw_keeps_the_specified_shell(self):
        self.assertEqual(sw_shell(), SPEC_SHELL)

    def test_sw_shell_matches_the_servers_version_files(self):
        files = server_shell_files()
        self.assertIsNotNone(files, "buddy_server.SHELL_FILES")
        self.assertIn("sw.js", files)
        self.assertEqual(sorted(as_url(f) for f in files if f != "sw.js"), sorted(sw_shell()))
        for f in files:
            self.assertTrue(os.path.exists(os.path.join(WEB, f)), f)

    def test_the_fake_mac_versions_the_same_files(self):
        m = re.search(r"SHELL_FILES = \((.*?)\)\n", text("tests", "phonemode", "fake_mac.py"), re.S)
        self.assertEqual(sorted(as_url(f) for f in ast.literal_eval("(" + m.group(1) + ")") if f != "sw.js"), sorted(SPEC_SHELL))

    def test_sw_never_caches_api_or_data(self):
        sw = text("web", "sw.js")
        self.assertIn('u.pathname.startsWith("/api/")', sw)          # /api/ goes to the network, never respondWith
        self.assertIn('searchParams.get("mac") === "1"', sw)          # the Mac's window: never the worker's copy
        self.assertEqual(len(re.findall(r"\.put\(", sw)), 1)           # the one write: inside snapshot()
        snap = sw[sw.index("async function snapshot"):sw.index("async function cached")]
        self.assertIn(".put(", snap)
        self.assertIn('r.type !== "basic"', snap)
        self.assertIn("r.redirected", snap)
        for word in ("localStorage", "indexedDB", "__FAKE", "__TEST", "testHook"):
            self.assertNotIn(word, sw)

    def test_sw_install_never_fails_on_a_failed_snapshot(self):
        sw = text("web", "sw.js")
        install = sw[sw.index('addEventListener("install"'):sw.index('addEventListener("activate"')]
        self.assertRegex(install, r"try \{ await snapshot\(v\); \} catch \{\}")
        self.assertIn("skipWaiting()", install)

    def test_push_code_kept(self):
        sw = text("web", "sw.js")
        self.assertIn('addEventListener("push"', sw)
        self.assertIn('addEventListener("notificationclick"', sw)
        self.assertIn('d.body || "Buddy sent you a message"', sw)

    def test_page_loads_direct_js_before_its_own_script(self):
        html = text("web", "chat.html")
        self.assertLess(html.index('<script src="/direct.js"></script>'), html.index("<script>\n"))
        js = re.search(r"<script>(.*)</script>", html, re.S).group(1)   # (CI's extraction: the inline script only)
        self.assertNotIn('src="/direct.js"', js)
        self.assertIn("const DIRECT = window.BuddyDirect || null;", js)

    def test_page_renders_no_html_from_data(self):
        for f in ("chat.html", "direct.js"):
            src = text("web", f)
            for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "srcdoc", "__FAKE", "__TEST", "testHook"):
                self.assertNotIn(sink, src, f + ": " + sink)

    def test_page_texts(self):
        js = re.search(r"<script>(.*)</script>", text("web", "chat.html"), re.S).group(1)
        for t in ("phone mode · Mac away", "photo (on your Mac)", "needs your Mac (phone mode)", "switching to your Mac…",
                  "Phone mode needs this phone's own Tinfoil key: Settings → Phone mode.",
                  "Your Mac is back. Switching ends phone mode; its private messages will be gone.",
                  "Your Mac is back but syncing failed: ", "Phone mode was turned off on your Mac",
                  "Phone mode needs your Mac again (not reached for 30 days)",
                  "Never saved anywhere: kept only on this screen, gone when you close Buddy",
                  "Your Mac can't be reached. Phone mode can keep Buddy working: turn it on in Settings while your Mac is reachable."):
            self.assertIn(t, js, t)

    def test_manifest(self):
        self.assertEqual(json.loads(text("web", "manifest.json"))["description"],
                         "Your private AI characters, on your own Mac, or straight from Tinfoil's verified enclaves when "
                         "your Mac is away.")

if __name__ == "__main__":
    unittest.main()
