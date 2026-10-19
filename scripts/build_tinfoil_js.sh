#!/bin/sh
# Rebuilds web/vendor/tinfoil.mjs, Tinfoil's browser SDK (tinfoil@1.2.1, Apache-2.0) that phone mode uses (web/direct.js),
# bit for bit from the npm tarballs pinned in scripts/vendor/tinfoil/package-lock.json (npm ci checks each one's sha512;
# no install scripts run), bundled into one self-contained file by the pinned esbuild. The built file is committed:
# nothing runs this at install or update time. Needs node >= 20, npm and the npm registry.
# Usage: scripts/build_tinfoil_js.sh            rebuild from the lockfile and install into web/vendor/ (prints the SHA-256)
#        scripts/build_tinfoil_js.sh --check    rebuild and compare with what's committed; changes nothing in web/;
#                                               exit 1 on any difference (CI runs this)
# Upgrading the SDK:
#   1. Edit the pins (scripts/vendor/tinfoil/package.json) and the .npmrc before= date; every version must be at least
#      14 days old.
#   2. npm install --package-lock-only --ignore-scripts   in scripts/vendor/tinfoil/; review the lockfile diff.
#   3. Update the expected tinfoil version and sha512 in scripts/vendor/tinfoil/build.sh.
#   4. Run scripts/build_tinfoil_js.sh; commit everything, including the new hash.
#   5. Before moving past tinfoil 1.2.1 / ehbp 0.3.x, review behaviour changes (OPFS spooling, WebCrypto AES, new
#      fetches during verification, new headers that the CORS gates didn't cover) and re-run gates G1/G2.
set -eu
case "${1:-}" in
  ""|--check) ;;
  *) echo "usage: scripts/build_tinfoil_js.sh [--check]"; exit 2 ;;
esac
DIR=$(cd "$(dirname "$0")/.." && pwd)
V="$DIR/scripts/vendor/tinfoil"
OUT="$DIR/web/vendor"
sum() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
rm -rf "$V/out"                                    # (so nothing from an older build can be picked up)
sh "$V/build.sh"
name=$(awk '/tinfoil-/{print $2; exit}' "$V/out/SHA256SUMS")
NEW="$V/out/$name"
[ -n "$name" ] && [ -f "$NEW" ] && [ -f "$V/out/THIRD_PARTY_LICENSES.txt" ] || { echo "the build left no bundle"; exit 1; }
sha=$(sum "$NEW")
if [ "${1:-}" = --check ]; then
  pinned=""; [ -f "$OUT/tinfoil.mjs.sha256" ] && pinned=$(awk '{print $1; exit}' "$OUT/tinfoil.mjs.sha256")
  have=""; [ -f "$OUT/tinfoil.mjs" ] && have=$(sum "$OUT/tinfoil.mjs")
  bad=0
  [ "$sha" = "$pinned" ] || { echo "differs: rebuilt $sha, web/vendor/tinfoil.mjs.sha256 says ${pinned:-nothing}"; bad=1; }
  [ "$sha" = "$have" ] || { echo "differs: rebuilt $sha, web/vendor/tinfoil.mjs is ${have:-missing}"; bad=1; }
  cmp -s "$V/out/THIRD_PARTY_LICENSES.txt" "$OUT/THIRD_PARTY_LICENSES.txt" \
    || { echo "differs: web/vendor/THIRD_PARTY_LICENSES.txt"; bad=1; }
  [ "$bad" = 0 ] || exit 1
  echo "reproduced: $sha"
  exit 0
fi
mkdir -p "$OUT"
cp "$NEW" "$OUT/tinfoil.mjs"
cp "$V/out/THIRD_PARTY_LICENSES.txt" "$OUT/THIRD_PARTY_LICENSES.txt"
printf '%s  tinfoil.mjs\n' "$sha" > "$OUT/tinfoil.mjs.sha256"
echo "web/vendor/tinfoil.mjs: $sha"
