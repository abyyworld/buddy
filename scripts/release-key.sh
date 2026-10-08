#!/bin/zsh
# For Buddy's publisher (run once, on your own Mac): makes the key that signs releases.
# The private key stays in ~/.ssh/buddy_release (protect it with a passphrase when asked; back it up somewhere safe,
# offline). Only the public half goes into the repo (release-signers). Once installs have seen it, they only accept
# releases signed with it, so nobody who gets into the GitHub repo can push code to people's Macs.
set -e
cd "$(dirname "$0")/.."
KEY="$HOME/.ssh/buddy_release"
[[ -f "$KEY" ]] || ssh-keygen -t ed25519 -f "$KEY" -C "Buddy releases"
print -r -- "buddy-release namespaces=\"git\" $(cat "$KEY.pub")" > release-signers
print "Wrote release-signers (the public key). Commit and push it, then publish releases with: zsh scripts/release.sh"
