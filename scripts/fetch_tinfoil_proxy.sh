#!/bin/zsh
# Gets Tinfoil's attestation-verifying proxy (github.com/tinfoilsh/tinfoil-proxy, Apache-2.0), which Buddy runs itself
# so nobody has to install the separate Tinfoil Proxy app. Pinned to one exact release and checked byte for byte
# (SHA-256) before it's ever used. Run by scripts/deps.sh (every build and update); does nothing if it's already there.
VERSION=v0.2.3
SHA256=51d11a370dc43cee26825a796e3d826c2060b5d9b0f62b0673b36edc36f001f9   # tinfoil-proxy-darwin-arm64
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/.bin/tinfoil-proxy"
sum() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }
[[ "$(uname -s)/$(uname -m)" == Darwin/arm64 ]] || { print "tinfoil-proxy: needs a Mac with Apple silicon"; exit 0; }
[[ -f "$OUT" && "$(sum "$OUT")" == "$SHA256" ]] && { print "tinfoil-proxy: $VERSION ready"; exit 0; }
mkdir -p "$DIR/.bin" && chmod 700 "$DIR/.bin"
rm -f "$DIR"/.bin/.download.*(N)                       # leftovers from a download that was cut off
tmp="$DIR/.bin/.download.$$"
trap 'rm -f "$tmp"' EXIT INT TERM HUP
# a stalled connection gives up quickly (15 s to connect, or under 20 KB/s for 30 s), never holding an update for long
if ! curl -fsSL --connect-timeout 15 --speed-limit 20000 --speed-time 30 --max-time 300 -o "$tmp" \
    "https://github.com/tinfoilsh/tinfoil-proxy/releases/download/$VERSION/tinfoil-proxy-darwin-arm64"; then
  rm -f "$tmp"; print "tinfoil-proxy: couldn't download $VERSION (offline?); will try again next time"; exit 0
fi
if [[ "$(sum "$tmp")" != "$SHA256" ]]; then
  rm -f "$tmp"; print "tinfoil-proxy: the download didn't match the pinned checksum, so it wasn't used"; exit 0
fi
chmod 755 "$tmp" && mv -f "$tmp" "$OUT" && print "tinfoil-proxy: $VERSION installed"
