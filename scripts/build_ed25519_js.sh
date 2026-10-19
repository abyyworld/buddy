#!/bin/sh
# Rebuilds web/vendor/ed25519.js: noble-ed25519 2.3.0 (MIT, Paul Miller) as one classic script, for Buddy for phones'
# service worker (web/sw-site.js), which checks the site's signature with it where the browser's WebCrypto has no
# Ed25519 (Safari before 17). The source is the npm tarball, checked against its pinned sha512 (the registry's integrity
# value); the only change is that its one export line becomes a frozen global (self.nobleEd25519 = {verifyAsync}) inside
# a function, under a header with its MIT licence. The built file is committed; nothing runs this at install or update.
# Needs curl, openssl, tar, python3 and the npm registry.
# Usage: scripts/build_ed25519_js.sh            rebuild and install into web/vendor/ (prints the SHA-256)
#        scripts/build_ed25519_js.sh --check    rebuild and compare with what's committed; changes nothing; exit 1 on
#                                               any difference (CI runs this)
# Upgrading: change VERSION and INTEGRITY (from `npm view @noble/ed25519@X dist.integrity`; at least 14 days old),
# check that the new index.js still has exactly one export line and verifyAsync(sig, msg, pub, {zip215}), rebuild, commit.
set -eu
case "${1:-}" in
  ""|--check) ;;
  *) echo "usage: scripts/build_ed25519_js.sh [--check]"; exit 2 ;;
esac
VERSION=2.3.0
INTEGRITY="sha512-M7dvXL2B92/M7dw9+gzuydL8qn/jiqNHaoR3Q+cb1q1GHV7uwE17WCyFMG+Y+TZb5izcaXk5TdJRrDUxHXL78A=="
DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT="$DIR/web/vendor"
sum() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://registry.npmjs.org/@noble/ed25519/-/ed25519-$VERSION.tgz" -o "$tmp/pkg.tgz"
got="sha512-$(openssl dgst -sha512 -binary "$tmp/pkg.tgz" | base64 | tr -d '\n')"
[ "$got" = "$INTEGRITY" ] || { echo "the tarball doesn't match its pinned sha512 (got $got)"; exit 1; }
mkdir "$tmp/x"
tar -xzf "$tmp/pkg.tgz" -C "$tmp/x" package/index.js package/LICENSE
python3 -I - "$tmp/x/package" "$tmp/ed25519.js" "$VERSION" <<'PY'
import re, sys
src, out, version = sys.argv[1:4]
code = open(src + "/index.js", encoding="utf-8").read()
lic = open(src + "/LICENSE", encoding="utf-8").read().strip()
lines = code.split("\n")
exports = [i for i, l in enumerate(lines) if l.startswith("export ")]
bare = re.sub(r"/\*.*?\*/", "", code, flags=re.S)   # (its opening comment shows an import as an example)
if len(exports) != 1 or "import.meta" in code or any(l.startswith("import ") for l in bare.split("\n")):
    sys.exit("index.js isn't the one-export module this script knows")
del lines[exports[0]]
if "*/" in lic:
    sys.exit("the licence text would end its comment")
head = ("// noble-ed25519 %s (MIT), from the npm tarball @noble/ed25519@%s (pinned sha512), as a classic script for\n"
        "// Buddy for phones' service worker: its one export line became self.nobleEd25519 = {verifyAsync}. Do not edit;\n"
        "// rebuild with scripts/build_ed25519_js.sh.\n" % (version, version))
body = "\n".join(lines).rstrip("\n")
text = (head + "/*\n" + lic + "\n*/\n(function () {\n\"use strict\";\n" + body +
        "\nself.nobleEd25519 = Object.freeze({ verifyAsync: verifyAsync, version: \"%s\" });\n})();\n" % version)
open(out, "w", encoding="utf-8", newline="\n").write(text)
PY
sha=$(sum "$tmp/ed25519.js")
if [ "${1:-}" = --check ]; then
  pinned=""; [ -f "$OUT/ed25519.js.sha256" ] && pinned=$(awk '{print $1; exit}' "$OUT/ed25519.js.sha256")
  have=""; [ -f "$OUT/ed25519.js" ] && have=$(sum "$OUT/ed25519.js")
  bad=0
  [ "$sha" = "$pinned" ] || { echo "differs: rebuilt $sha, web/vendor/ed25519.js.sha256 says ${pinned:-nothing}"; bad=1; }
  [ "$sha" = "$have" ] || { echo "differs: rebuilt $sha, web/vendor/ed25519.js is ${have:-missing}"; bad=1; }
  [ "$bad" = 0 ] || exit 1
  echo "reproduced: $sha"
  exit 0
fi
cp "$tmp/ed25519.js" "$OUT/ed25519.js"
printf '%s  ed25519.js\n' "$sha" > "$OUT/ed25519.js.sha256"
echo "web/vendor/ed25519.js: $sha"
