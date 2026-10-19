#!/usr/bin/env python3
"""Builds Buddy for phones, the static website on GitHub Pages (https://abyyworld.github.io/buddy/), from the public
copy's files (SPEC3 §3.2-3.4). Stdlib only, Python 3.9+, deterministic: the same tree and version give the same bytes.

    python3 -I scripts/build_pages.py --tree <public tree> --out <empty dir> --version N [--base /buddy/]
    python3 -I scripts/build_pages.py --tree <public tree> --version N --check <a built or downloaded site>

Refuses (exit 1, nothing written) unless the tree is the public copy: `edition.json` says public, none of publish.sh's
private or development-only files are there, `site-signers` names exactly one Ed25519 key for "buddy-site" (the same
key as `release-signers`, if that's there), and every vendored file matches its `.sha256`. Only the files below are
written (an allowlist), never anything else from the tree, so chats, keys, characters and settings can't get in:

  index.html             web/chat.html with <meta name="buddy-site">, the site's CSP as a meta tag (with the __RELAY__
                         placeholder that the service worker fills), no-referrer, its inline <style> moved to app.css and
                         its one inline <script> to app.js, absolute links made relative, site.js first in <head>,
                         web/solo/*.js before direct.js, and SRI (sha384) on every <script> and the SDK's modulepreload
  app.js app.css         the former inline script (its first statement refuses to run in a frame) and style
                         (another inline script, if chat.html ever has one, becomes app-2.js, app-3.js, ... in place)
  site.js                the shell's page part (web/site.js): frame guard, the service worker, updates
  direct.js pcm-tap.js   as on the Mac's /phone, except direct.js loads the SDK as vendor/tinfoil.js
  solo/*.js              every web/solo/*.js (and *.mjs, renamed .js), sorted, engine.js last
  vendor/tinfoil.js      web/vendor/tinfoil.mjs byte for byte, served as .js (gate G8: whether Pages serves .mjs as
                         JavaScript can't be checked here, so the site never relies on it; imports are fixed)
  vendor/ed25519.js      the pinned noble-ed25519 (the worker's fallback where WebCrypto has no Ed25519)
  kit.json               kitparts.static_kit("public"), imported from the tree with an empty HOME (never buddy_server)
  site.json              {"invite": true, "name": "Buddy", "relay": ""}   (the default relay comes with sync, P2)
  manifest.webmanifest   the site's web app manifest: start_url and scope "./" (= /buddy/ on Pages)
  icons/icon-{180,192,512}.png
  sw.js                  web/sw-site.js with this VERSION, the FILES it keeps and SIGNER (from site-signers) baked in
  version.json           {"v": N}
  404.html               a redirect to --base (no script)
  site-manifest.json     {"edition": "public", "files": {path: sha256 of every file above}, "v": N}

publish.sh signs site-manifest.json (ssh-keygen -Y sign -n buddy-site); pages.yml builds the tag again and deploys only
if every byte matches the signed manifest; scripts/check_site.sh compares a live site with a release."""
import argparse, base64, hashlib, importlib, json, os, re, shutil, sys, tempfile

CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "media-src 'self' blob:; connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh __RELAY__; "
       "worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
       "form-action 'none'; frame-src 'none'")
TINFOIL = ("atc.tinfoil.sh", "inference.tinfoil.sh")
# Hosts the site's own files may name although nothing connects to them (the CSP's connect-src allows only Tinfoil's
# two and this device's relay). The vendored SDK and noble are byte-for-byte pinned third-party files and aren't
# scanned (the SDK names its documentation and Sigstore hosts; the CSP keeps it to Tinfoil's two).
NOT_CONTACTED = {"www.w3.org": "XML namespaces (SVG)",
                 "login.tailscale.com": "links in the Mac's Phone access settings: hidden on the site, never fetched"}
PRIVATE = (".tinfoil_key", ".phala_key", ".near_key", ".vapid.json", ".push_subs.json", ".mac_token", ".devices.json",
           ".thread.json", ".memory_index.json", ".backup_key", ".backup_state.json", ".cloudflare_key",
           ".facts_state.json", ".gens.json", ".sync_keys", ".sync_state.json", "config.local.json", "my-characters",
           ".media", ".tailnet", ".restore", "CLAUDE.md", "scripts/publish.sh", "docs/3d-desktop-character.md")
VENDORED = ("web/vendor/tinfoil.mjs", "web/vendor/ed25519.js")
ICONS = ("icon-180.png", "icon-192.png", "icon-512.png")
SOLO_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}\.m?js$")
ALLOWED = re.compile(r"^(index\.html|app\.js|app-[2-9]\.js|app\.css|site\.js|direct\.js|pcm-tap\.js|kit\.json|site\.json|sw\.js|"
                     r"manifest\.webmanifest|version\.json|site-manifest\.json|404\.html|icons/icon-(180|192|512)\.png|"
                     r"vendor/(tinfoil|ed25519)\.js|solo/[a-z0-9][a-z0-9_-]{0,40}\.js)$")
NOT_KEPT = ("sw.js", "version.json", "404.html")      # in the manifest, not in the worker's cache
GUARD = ('if (window.top !== window.self) throw new Error("Open Buddy in its own window");   '
         '// (site.js already stopped a framed page)\n')
SERVER_MODULES = ("buddy_server", "social", "memory", "localcheck", "tinfoilproxy", "near", "images", "tailnet", "backup")


class Refuse(Exception):
    pass


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def sri(b):
    return "sha384-" + base64.b64encode(hashlib.sha384(b).digest()).decode()


def read(tree, rel):
    path = os.path.join(tree, *rel.split("/"))
    real, root = os.path.realpath(path), os.path.realpath(tree)
    if os.path.islink(path) or not real.startswith(root + os.sep):
        raise Refuse(rel + " is a link")
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        raise Refuse(rel + " is missing from the tree")


def text(tree, rel):
    return read(tree, rel).decode("utf-8")


# ---------- the tree ----------
def check_tree(tree):
    if not os.path.isdir(tree):
        raise Refuse("no tree at " + tree)
    try:
        ed = json.loads(text(tree, "edition.json"))
    except (Refuse, ValueError):
        raise Refuse("edition.json is missing: the site is built only from the public copy (publish.sh --tree)")
    if not isinstance(ed, dict) or ed.get("edition") != "public":
        raise Refuse("edition.json doesn't say public")
    for name in PRIVATE:
        if os.path.lexists(os.path.join(tree, *name.split("/"))):
            raise Refuse(name + " is in the tree: that's not the public copy")
    for rel in VENDORED:
        want = text(tree, rel + ".sha256").split()
        if not want or want[0] != sha256(read(tree, rel)):
            raise Refuse(rel + " doesn't match " + rel + ".sha256")


def ssh_strings(blob):
    out, i = [], 0
    while i < len(blob):
        if i + 4 > len(blob):
            raise ValueError("short")
        n = int.from_bytes(blob[i:i + 4], "big")
        if i + 4 + n > len(blob):
            raise ValueError("short")
        out.append(blob[i + 4:i + 4 + n])
        i += 4 + n
    return out


def signer_key(line, namespace):
    """The raw Ed25519 key of an allowed-signers line `buddy-release namespaces="<namespace>" ssh-ed25519 <b64> [c]`."""
    m = re.match(r'^buddy-release namespaces="%s" ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [^\n]*)?$' % re.escape(namespace),
                 line)
    if not m:
        return None
    try:
        parts = ssh_strings(base64.b64decode(m.group(1), validate=True))
    except ValueError:
        return None
    if len(parts) != 2 or parts[0] != b"ssh-ed25519" or len(parts[1]) != 32:
        return None
    return parts[1]


def lines_of(tree, rel):
    return [l.strip() for l in text(tree, rel).splitlines() if l.strip() and not l.strip().startswith("#")]


def signer(tree):
    try:
        lines = lines_of(tree, "site-signers")
    except Refuse:
        raise Refuse("site-signers is missing: publish.sh writes it from the release key (the site isn't signed)")
    key = signer_key(lines[0], "buddy-site") if len(lines) == 1 else None
    if key is None:
        raise Refuse('site-signers must be one line: buddy-release namespaces="buddy-site" ssh-ed25519 <key>')
    if os.path.lexists(os.path.join(tree, "release-signers")):
        rel = lines_of(tree, "release-signers")
        if len(rel) != 1 or signer_key(rel[0], "git") != key:
            raise Refuse("site-signers and release-signers name different keys")
    return base64.b64encode(key).decode()


def static_kit(tree):
    """kitparts.static_kit("public") from the tree, imported with an empty HOME; no server module may come along."""
    if any(m in sys.modules for m in ("kitparts",) + SERVER_MODULES):
        raise Refuse("kitparts or a server module is already loaded here: run the build on its own")
    home, old_home = tempfile.mkdtemp(prefix="buddy-pages-home-"), os.environ.get("HOME")
    os.environ["HOME"] = home
    sys.dont_write_bytecode = True
    sys.path.insert(0, tree)
    try:
        kitparts = importlib.import_module("kitparts")
        if os.path.realpath(os.path.dirname(kitparts.__file__)) != os.path.realpath(tree):
            raise Refuse("kitparts didn't come from the tree")
        kit = kitparts.static_kit("public")
        loaded = [m for m in SERVER_MODULES if m in sys.modules]
        if loaded:
            raise Refuse("importing kitparts loaded " + ", ".join(loaded))
        if os.listdir(home):
            raise Refuse("kitparts wrote into HOME")
        return kit
    finally:
        sys.path.remove(tree)
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
        shutil.rmtree(home, ignore_errors=True)


def dumps(obj, **kw):
    return (json.dumps(obj, sort_keys=True, **kw) + "\n").encode("utf-8")


# ---------- the page ----------
def fix_imports(js, names):
    """Quoted references to a renamed module (x.mjs -> x.js)."""
    n = 0
    for b in sorted(names):
        js, k = re.subn(r"(?<=[/\"'`])(%s)\.mjs(?=[\"'`])" % re.escape(b), r"\1.js", js)
        n += k
    return js, n


def guard(js):
    """app.js's first statement refuses to run in a frame (after a "use strict" directive, which must stay first)."""
    m = re.match(r"\s*([\"'])use strict\1;[^\n]*\n", js)
    return js[:m.end()] + GUARD + js[m.end():] if m else GUARD + js


def page(chat, files, solo, renamed):
    """index.html, app.js and app.css from chat.html; `files` = the site's other files so far (for links and SRI),
    `solo` = [(path, is_module)] in load order, `renamed` = modules renamed from .mjs."""
    inline = re.findall(r"<script>(.*?)</script>", chat, re.S)
    names = ["app.js"] + ["app-%d.js" % i for i in range(2, len(inline) + 1)]      # (one today; more each get a file)
    page_ = re.sub(r"<script>.*?</script>", "\x01", chat, flags=re.S)             # (its code set aside first)
    styles = re.findall(r"<style>(.*?)</style>", page_, re.S)
    markup = re.sub(r"<style>.*?</style>", "", page_, flags=re.S)
    for bad, why in (('name="buddy-site"', "already has the buddy-site meta"), ("http-equiv", "has a meta http-equiv"),
                     ("__RELAY__", "names __RELAY__"), ("<base", "has a <base>")):
        if bad in markup:
            raise Refuse("web/chat.html " + why)
    if re.search(r"<style\b(?!>)", markup) or re.search(r"<script\b(?!>| src=\"[^\"]+\"></script>)", markup):
        raise Refuse("web/chat.html has a <style> or <script> this build doesn't know (attributes)")
    if not styles or not inline or len(inline) > 9 or "\x00" in chat or "\x01" in chat:
        raise Refuse("web/chat.html needs its <style> and its inline <script>")
    if re.search(r"<[a-zA-Z][^>]*\son[a-z]+\s*=", markup) or "javascript:" in markup:
        raise Refuse("web/chat.html has an inline event handler or javascript: link (the site's CSP refuses those)")
    css = "\n".join(styles).encode("utf-8")
    code = [fix_imports(js, renamed)[0] for js in inline]
    files = dict(files, **{"app.css": css}, **{n: (guard(js) if i == 0 else js).encode("utf-8")
                                                for i, (n, js) in enumerate(zip(names, code))})

    def tag(p, module=False):
        return '<script%s src="%s" integrity="%s"></script>' % (' type="module"' if module else "", p, sri(files[p]))

    html = re.sub(r"<style>.*?</style>", "\x00", page_, count=1, flags=re.S)
    html = re.sub(r"<style>.*?</style>", "", html, flags=re.S).replace("\x00", '<link rel="stylesheet" href="app.css">')
    for n in names:
        html = html.replace("\x01", tag(n), 1)

    def script(m):
        src = m.group(1)
        if src != "/direct.js":
            raise Refuse("web/chat.html loads " + src + ", which the site doesn't have")
        return "\n".join([tag(p, mod) for p, mod in solo] + [tag("direct.js")])
    html = re.sub(r'<script src="([^"]+)"></script>', script, html)

    def link(m):
        attr, path = m.group(1), m.group(2)
        rel = "manifest.webmanifest" if path == "manifest.json" else path
        if rel not in files:
            raise Refuse("web/chat.html links /" + path + ", which the site doesn't have")
        return '%s="%s"' % (attr, rel)
    html = re.sub(r'\b(href|src)="/([^"]*)"', link, html)
    head = ('<meta charset="utf-8">\n<meta name="buddy-site" content="solo">\n'
            '<meta http-equiv="Content-Security-Policy" content="%s">\n<meta name="referrer" content="no-referrer">\n%s'
            % (CSP, tag("site.js")))
    if html.count('<meta charset="utf-8">') != 1 or html.count("</head>") != 1:
        raise Refuse("web/chat.html needs one <meta charset=\"utf-8\"> and one </head>")
    html = html.replace('<meta charset="utf-8">', head)
    html = html.replace("</head>", '<link rel="modulepreload" href="vendor/tinfoil.js" integrity="%s">\n</head>'
                        % sri(files["vendor/tinfoil.js"]))
    if html.count("__RELAY__") != 1:
        raise Refuse("index.html must name __RELAY__ once (in its CSP)")
    return html.encode("utf-8"), {n: files[n] for n in names + ["app.css"]}


def manifest_webapp(src):
    m = json.loads(src)
    return dumps({"name": m["name"], "short_name": m["short_name"],
                  "description": "Your private AI characters on this phone, answered by Tinfoil's verified enclaves.",
                  "start_url": "./", "scope": "./", "display": m["display"], "orientation": m.get("orientation", "any"),
                  "background_color": m["background_color"], "theme_color": m["theme_color"],
                  "icons": [dict(i, src=i["src"].lstrip("/")) for i in m["icons"]]}, indent=1)


def not_found(base):
    return ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'">\n'
            '<meta name="referrer" content="no-referrer">\n<meta http-equiv="refresh" content="0; url=%s">\n'
            '<title>Buddy</title>\n</head>\n<body><p><a href="%s">Open Buddy</a></p></body>\n</html>\n'
            % (base, base)).encode("utf-8")


def bake(sw, version, files, key):
    for pat, line in ((r"^const VERSION = 0;", "const VERSION = %d;" % version),
                      (r"^const FILES = \[\];", "const FILES = %s;" % json.dumps(files)),
                      (r'^const SIGNER = "";', 'const SIGNER = "%s";' % key)):
        sw, n = re.subn(pat, lambda m: line, sw, flags=re.M)
        if n != 1:
            raise Refuse("web/sw-site.js doesn't have exactly one " + pat)
    return sw.encode("utf-8")


def scan_hosts(files):
    for p, b in sorted(files.items()):
        if p.startswith("vendor/") or p.endswith(".png"):
            continue
        for h in re.findall(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://([A-Za-z0-9.-]+)", b.decode("utf-8")):
            h = h.lower().rstrip(".")
            if h not in TINFOIL and h not in NOT_CONTACTED and not h.endswith(".invalid"):
                raise Refuse(p + " names " + h + ": the site talks only to Tinfoil (and this device's relay)")


# ---------- the build ----------
def build(tree, version, base="/buddy/"):
    """{path: bytes} of the whole site (site-manifest.json included)."""
    if not isinstance(version, int) or version < 1:
        raise Refuse("--version must be a whole number from 1")
    if not re.match(r"^/(?:[A-Za-z0-9._-]+/)*$", base):
        raise Refuse("--base must be a path like /buddy/")
    tree = os.path.abspath(tree)
    check_tree(tree)
    key = signer(tree)
    files = {"direct.js": None, "pcm-tap.js": read(tree, "web/pcm-tap.js"), "site.js": read(tree, "web/site.js"),
             "vendor/tinfoil.js": read(tree, "web/vendor/tinfoil.mjs"), "vendor/ed25519.js": read(tree, "web/vendor/ed25519.js"),
             "kit.json": dumps(static_kit(tree), ensure_ascii=False, separators=(",", ":")),
             "site.json": dumps({"relay": "", "invite": True, "name": "Buddy"}),
             "manifest.webmanifest": manifest_webapp(text(tree, "web/manifest.json"))}
    for i in ICONS:
        files["icons/" + i] = read(tree, "web/default-icons/" + i)
    renamed = {"tinfoil"}
    solo_dir, solo = os.path.join(tree, "web", "solo"), []
    names = sorted(n for n in os.listdir(solo_dir) if n.endswith((".js", ".mjs"))) if os.path.isdir(solo_dir) else []
    for n in names:
        if not SOLO_NAME.match(n):
            raise Refuse("web/solo/" + n + " isn't a name the site takes")
        out = "solo/" + n.rsplit(".", 1)[0] + ".js"
        if out in files:
            raise Refuse("web/solo/" + n + " and another file would both be " + out)
        files[out] = read(tree, "web/solo/" + n)
        if n.endswith(".mjs"):
            renamed.add(n[:-4])
        solo.append((out, n.endswith(".mjs")))
    solo.sort(key=lambda s: (s[0] == "solo/engine.js", s[0]))   # helpers first, the engine last
    direct, n = fix_imports(text(tree, "web/direct.js"), renamed)
    if 'const SDK_URL = "/vendor/tinfoil.js";' not in direct:
        raise Refuse("web/direct.js's SDK_URL isn't /vendor/tinfoil.mjs")
    files["direct.js"] = direct.encode("utf-8")
    for p, _ in solo:
        files[p] = fix_imports(files[p].decode("utf-8"), renamed)[0].encode("utf-8")
    files["index.html"], code = page(text(tree, "web/chat.html"), files, solo, renamed)
    files.update(code)
    keep = sorted(p for p in files if p not in NOT_KEPT)
    files["sw.js"] = bake(text(tree, "web/sw-site.js"), version, keep, key)
    files["version.json"] = dumps({"v": version})
    files["404.html"] = not_found(base)
    scan_hosts(files)
    files["site-manifest.json"] = dumps({"v": version, "edition": "public",
                                         "files": {p: sha256(b) for p, b in files.items()}}, indent=1)
    for p in files:
        if not ALLOWED.match(p):
            raise Refuse(p + " isn't on the site's allowlist")
    return files


def write(files, out):
    if os.path.exists(out) and (not os.path.isdir(out) or os.listdir(out)):
        raise Refuse("--out must be an empty folder")
    for p, b in sorted(files.items()):
        path = os.path.join(out, *p.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(b)


def listing(d):
    out = {}
    for root, dirs, names in os.walk(d):
        dirs.sort()
        for n in names:
            path = os.path.join(root, n)
            with open(path, "rb") as f:
                out[os.path.relpath(path, d).replace(os.sep, "/")] = f.read()
    return out


def compare(files, d):
    """Differences between a build and a folder (a signature or CNAME there is fine)."""
    have = {p: b for p, b in listing(d).items() if p not in ("site-manifest.json.sig", "CNAME")}
    diffs = ["missing: " + p for p in sorted(set(files) - set(have))]
    diffs += ["extra: " + p for p in sorted(set(have) - set(files))]
    diffs += ["differs: " + p for p in sorted(set(files) & set(have)) if files[p] != have[p]]
    return diffs


def main(argv=None):
    a = argparse.ArgumentParser(description="Build the Buddy for phones website from the public copy's files.")
    a.add_argument("--tree", required=True, help="the public copy's files (publish.sh --tree DIR, or its checkout)")
    a.add_argument("--out", help="an empty folder for the site")
    a.add_argument("--version", required=True, type=int, help="the release number N (tag vN)")
    a.add_argument("--base", default="/buddy/", help="the site's path, for 404.html (default /buddy/)")
    a.add_argument("--check", metavar="DIR", help="rebuild and compare with DIR byte for byte (nothing written)")
    o = a.parse_args(argv)
    if not o.out and not o.check:
        a.error("--out or --check is needed")
    try:
        files = build(o.tree, o.version, o.base)
        if o.check:
            diffs = compare(files, o.check)
            for d in diffs:
                print(d)
            print("The site matches release v%d byte for byte." % o.version if not diffs else
                  "The site doesn't match release v%d." % o.version)
            if diffs:
                return 1
        if o.out:
            write(files, o.out)
            print("Built v%d into %s (%d files; manifest %s)." % (o.version, o.out, len(files),
                                                                   sha256(files["site-manifest.json"])[:16]))
        return 0
    except Refuse as e:
        print("Refusing: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
