#!/bin/zsh
# For Buddy's publisher (run once, on your own Mac): makes the key that signs releases.
# The private key stays in ~/.ssh/buddy_release (protect it with a passphrase when asked; back it up somewhere safe,
# offline). Installs that have seen its public half (release-signers in the repo they update from) only accept releases
# signed with it, so nobody who gets into the GitHub repo can push code to people's Macs.
#   zsh scripts/release-key.sh          make the key (scripts/publish.sh puts its public half into the public copy)
#   zsh scripts/release-key.sh --here   also write release-signers here, for installs that update from this repo
set -e
cd "$(dirname "$0")/.."
KEY="$HOME/.ssh/buddy_release"
[[ -f "$KEY" ]] || ssh-keygen -t ed25519 -f "$KEY" -C "Buddy releases"
if [[ "$1" == --here ]]; then
  print -r -- "buddy-release namespaces=\"git\" $(cat "$KEY.pub")" > release-signers
  print "Wrote release-signers (the public key). Commit and push it, then publish releases with: zsh scripts/release.sh"
else
  print "Your release key is ready ($KEY). Back it up offline, with its passphrase."
  print "(If installs update from this very repo, run: zsh scripts/release-key.sh --here)"
fi
