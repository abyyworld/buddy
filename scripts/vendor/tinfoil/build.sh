#!/bin/sh
# Rebuilds the vendored Tinfoil browser SDK from the exact npm tarballs pinned in package-lock.json
# (npm ci checks every tarball's sha512 integrity), then bundles it with the pinned esbuild.
# No install scripts run. Prints the output SHA-256; compare it with EXPECTED_SHA256 below.
set -eu
cd "$(dirname "$0")"
EXPECTED_SHA256="${EXPECTED_SHA256:-}"
command -v node >/dev/null || { echo "needs node >= 20"; exit 1; }
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
# Pinned SDK tarballs (sha512 from the registry; also enforced by npm ci through the lockfile).
node -e '
const l=require("./package-lock.json").packages;
const want={"node_modules/tinfoil":["1.2.1","sha512-goql//0KY6nViV96wBdmIT6ZZ7rYy9yEhJrtIPdg9YHw3vyDsyNsuXNq/sZgu0Bu+sm5crxQObxrMGwgN572OQ=="]};
for (const [k,[v,i]] of Object.entries(want)) { if (l[k].version!==v||l[k].integrity!==i) { console.error("lockfile pin mismatch for "+k); process.exit(1);} }'
node build.mjs
if [ -n "$EXPECTED_SHA256" ]; then
  got=$(awk '/tinfoil-/{print $1; exit}' out/SHA256SUMS)
  [ "$got" = "$EXPECTED_SHA256" ] && echo "reproduced: $got" || { echo "MISMATCH: got $got want $EXPECTED_SHA256"; exit 1; }
fi
