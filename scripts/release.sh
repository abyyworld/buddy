#!/bin/zsh
# For Buddy's publisher: signs the current main as a release and publishes it. Installs only update to signed
# releases (once they know the key from release-signers), so merging to main alone doesn't ship anything.
# Usage: zsh scripts/release.sh            (picks the next version: v1, v2, ...)
#        zsh scripts/release.sh v7
set -e
cd "$(dirname "$0")/.."
KEY="$HOME/.ssh/buddy_release"
[[ -f "$KEY" ]] || { print "No release key yet: run zsh scripts/release-key.sh first."; exit 1; }
[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || { print "Switch to main first."; exit 1; }
git fetch -q origin main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { print "Your main differs from GitHub's: pull or push first."; exit 1; }
TAG=${1:-v$(( $(git tag -l 'v*' | sed -n 's/^v\([0-9][0-9]*\)$/\1/p' | sort -n | tail -1) + 1 ))}
git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey="$KEY" tag -s "$TAG" -m "Buddy $TAG"   # this key, here
git -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile=release-signers verify-tag "$TAG"
git push origin "$TAG"
print "Published $TAG. Installs pick it up on their next update check."
