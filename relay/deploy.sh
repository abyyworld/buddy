#!/bin/zsh
# Puts Buddy's sync relay on YOUR Cloudflare account (the free plan is enough for a family). Run it once; run it again
# later to update the relay's code (your data and invites stay).
#   zsh relay/deploy.sh
# What it does: installs the pinned Cloudflare tool (wrangler, exact versions and hashes from package-lock.json, no
# install scripts) into relay/node_modules, signs you in to Cloudflare in the browser (once), creates the R2 bucket
# for encrypted photos and voice messages, makes the invite secret here (relay/.secrets/invite.key, 0600, git-ignored,
# never printed) and gives it to the relay as its INVITE secret, deploys with logs off, checks the relay answers, and
# prints its address (and, the first time, an invite). Make invites with: node relay/invite.mjs
# Another website than https://abyyworld.github.io (your own copy of Buddy for phones):
#   BUDDY_SITE_ORIGINS="https://you.github.io" zsh relay/deploy.sh
set -e
cd "$(dirname "$0")"
umask 077
command -v node >/dev/null && command -v npm >/dev/null || {
  print "This needs Node.js 22 or newer (https://nodejs.org, or: brew install node). Then run it again."; exit 1; }
(( $(node -p 'process.versions.node.split(".")[0]') >= 22 )) || { print "This needs Node.js 22 or newer (you have $(node -v))."; exit 1; }
command -v openssl >/dev/null || { print "openssl is missing."; exit 1; }
command -v curl >/dev/null || { print "curl is missing."; exit 1; }
export WRANGLER_SEND_METRICS=false

print "Installing Cloudflare's tool (wrangler $(node -p 'require("./package.json").devDependencies.wrangler'), pinned)…"
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
W=(./node_modules/.bin/wrangler)

if ! $W whoami 2>/dev/null | grep -qi "logged in"; then
  print "Sign in to Cloudflare in the browser window that opens (an account is free: https://dash.cloudflare.com/sign-up)."
  $W login
fi

BUCKET=buddy-relay-blobs                 # (the same name as in wrangler.toml)
if ! $W r2 bucket list 2>/dev/null | grep -q "$BUCKET"; then
  $W r2 bucket create "$BUCKET" || {
    print "Couldn't create the R2 bucket. Open R2 once in Cloudflare's dashboard (https://dash.cloudflare.com → R2) and"
    print "turn it on (Cloudflare may ask for a payment method even for the free tier), then run this again."; exit 1; }
fi

mkdir -p .secrets && chmod 700 .secrets
NEW=""
if [[ ! -s .secrets/invite.key ]]; then
  openssl rand -base64 32 > .secrets/invite.key
  NEW=1
fi
chmod 600 .secrets/invite.key

print "Deploying…"
vars=()
[[ -n "$BUDDY_SITE_ORIGINS" ]] && vars=(--var "ALLOWED_ORIGINS:$BUDDY_SITE_ORIGINS")
INFO=$(mktemp -t buddy-relay-deploy.XXXXXX)           # (wrangler notes the address there; nothing secret)
trap 'rm -f "$INFO"' EXIT
WRANGLER_OUTPUT_FILE_PATH=$INFO $W deploy $vars
URL=$(node -e 'let u = ""; for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
  try { const j = JSON.parse(l); if (j.type === "deploy" && j.targets) u = j.targets.find((t) => t.startsWith("https://")) || u; } catch {} }
  console.log(u)' "$INFO")
rm -f "$INFO"
$W secret put INVITE < .secrets/invite.key >/dev/null     # (every time, so the relay and this file always agree)

if [[ -z "$URL" ]]; then
  print "Deployed. Its address is in the lines above (or under Workers & Pages → buddy-relay in Cloudflare's dashboard)."
else
  ok=""
  for i in {1..30}; do
    curl -sf "$URL/v1/info" | grep -q '"invite":true' && { ok=1; break; }
    sleep 2
  done
  [[ -n "$ok" ]] || print "The relay doesn't answer yet (a new workers.dev address can take a few minutes). Check: curl $URL/v1/info"
  print "\nYour relay: $URL"
  print "It's what Buddy for phones asks for as the sync server. It only ever stores what devices encrypted themselves."
fi
print
if [[ -n "$NEW" ]]; then
  print "Made the invite secret (relay/.secrets/invite.key; keep it: invites made with an older one stop working)."
  node invite.mjs
else
  print "Make an invite (one sync account each) with: node relay/invite.mjs"
fi
