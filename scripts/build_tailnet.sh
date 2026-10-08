#!/bin/zsh
# Builds Buddy's own Tailscale part (app/tailnet -> .bin/buddy-tailnet), so your phone can reach Buddy without the
# Tailscale app on this Mac (turn on Phone access in Buddy's settings). Needs Go (brew install go); once it's built,
# updates rebuild it. The downloadable Buddy has it inside already. Its source and every library it uses are pinned
# (app/tailnet/go.mod and go.sum), and it builds the same way every time (anyone can check the result).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:/usr/bin:/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export GOTOOLCHAIN="go$(sed -n 's/^go //p' "$DIR/app/tailnet/go.mod")"   # exactly that Go (so the result matches CI's)
command -v go >/dev/null || { print "tailnet: Go isn't installed (brew install go); or use the Tailscale app on this Mac"; exit 1; }
mkdir -p "$DIR/.bin"
( cd "$DIR/app/tailnet" && CGO_ENABLED=0 GOFLAGS=-mod=readonly \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o "$DIR/.bin/buddy-tailnet.new" . ) \
  || { rm -f "$DIR/.bin/buddy-tailnet.new"; print "tailnet: build failed"; exit 1; }
mv -f "$DIR/.bin/buddy-tailnet.new" "$DIR/.bin/buddy-tailnet"
print "tailnet: built .bin/buddy-tailnet with $(cd "$DIR/app/tailnet" && go env GOVERSION) (sha256 $(shasum -a 256 "$DIR/.bin/buddy-tailnet" | cut -c1-16)…)"
