#!/bin/sh
# Anyone can check that Buddy for phones (the website) is exactly a signed release (SPEC3 §3.7). It downloads the site's
# version.json, site-manifest.json and its signature, checks the signature (namespace "buddy-site") with Buddy's release
# key, then downloads every file the manifest lists and checks its SHA-256. With --rebuild vN (run in a clone of the
# public repo, github.com/abyyworld/buddy) it also checks tag vN's own signature, builds that tag with
# scripts/build_pages.py and compares the live site with the build byte for byte.
# The key is chosen apart from what's being checked: --signers FILE, else your ~/.ssh/buddy_release.pub (the owner),
# else the key this Buddy install pinned at its first signed update (./.release_signers, which a pull can't change). If
# ./site-signers, or tag vN's release-signers or site-signers, name another key, that's a MISMATCH ("the repo's release
# key changed"). With none of those, it can only trust what the repo says (and checks that the tag's key is the one
# the repo's first signed release had), and says so.
# Needs curl, ssh-keygen and python3 (and git for --rebuild). Fetches only the site's own files.
# Usage: sh scripts/check_site.sh [URL] [--rebuild vN] [--signers FILE]      (URL default: https://abyyworld.github.io/buddy/)
set -eu
URL="https://abyyworld.github.io/buddy/"; REBUILD=""; SIGNERS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rebuild) REBUILD="${2:-}"; shift 2 ;;
    --signers) SIGNERS="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "unknown option $1"; exit 2 ;;
    *) URL="$1"; shift ;;
  esac
done
case "$URL" in */) ;; *) URL="$URL/" ;; esac
case "$URL" in
  https://*) PROTO="=https"; LOCAL="" ;;
  http://127.0.0.1:*|http://localhost:*) PROTO="=http"; LOCAL="--noproxy 127.0.0.1,localhost" ;;   # (tests: a local copy)
  *) echo "The site's address must start with https://"; exit 2 ;;
esac
if [ -n "$REBUILD" ]; then
  case "$REBUILD" in v[1-9]*) ;; *) echo "--rebuild needs a release tag like v58"; exit 2 ;; esac
fi
fail() { echo "MISMATCH: $*"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/live"
get() { curl -fsS --proto "$PROTO" $LOCAL --max-redirs 0 --max-time 60 -o "$tmp/live/$1" "$URL$1" || fail "couldn't download $1"; }
for f in version.json site-manifest.json site-manifest.json.sig; do get "$f"; done

# the key that must have signed it: one the repo being checked can't choose
keys_of() { sed -n 's|.*\(ssh-ed25519 [A-Za-z0-9+/=]*\).*|\1|p' "$1" | sort -u; }
as_site() { sed 's/namespaces="[^"]*"/namespaces="buddy-site"/' "$1"; }      # (a release-signers line -> a site-signers line)
WHERE=""
if [ -n "$SIGNERS" ]; then
  [ -s "$SIGNERS" ] || { echo "No such signers file: $SIGNERS"; exit 2; }
  WHERE="$SIGNERS"
elif [ -s "$HOME/.ssh/buddy_release.pub" ]; then
  printf 'buddy-release namespaces="buddy-site" %s\n' "$(cat "$HOME/.ssh/buddy_release.pub")" > "$tmp/site-signers"; SIGNERS="$tmp/site-signers"
  WHERE="your ~/.ssh/buddy_release.pub"
elif [ -s .release_signers ]; then
  as_site .release_signers > "$tmp/site-signers"; SIGNERS="$tmp/site-signers"
  WHERE="the key this install pinned (.release_signers)"
fi
[ -z "$SIGNERS" ] || [ -n "$(keys_of "$SIGNERS")" ] || { echo "$WHERE names no Ed25519 key."; exit 2; }
same_key() {                                           # $1 names exactly the independent key, or it's a MISMATCH
  [ "$(keys_of "$1")" = "$(keys_of "$SIGNERS")" ] \
    || fail "the repo's release key changed: $2 names another key than $WHERE. Don't trust this site (or enter keys in it) until that's explained."
}
[ -z "$SIGNERS" ] || [ ! -s site-signers ] || same_key site-signers "./site-signers"
if [ -n "$REBUILD" ]; then
  git rev-parse -q --verify "refs/tags/$REBUILD" >/dev/null || { echo "No tag $REBUILD here: run this in a clone of github.com/abyyworld/buddy (git fetch --tags)."; exit 2; }
  git show "$REBUILD:release-signers" > "$tmp/release-signers" 2>/dev/null || fail "$REBUILD has no release-signers"
  git show "$REBUILD:site-signers" > "$tmp/tag-site-signers" 2>/dev/null || fail "$REBUILD has no site-signers"
  if [ -n "$SIGNERS" ]; then
    same_key "$tmp/release-signers" "$REBUILD's release-signers"
    same_key "$tmp/tag-site-signers" "$REBUILD's site-signers"
    sed 's/namespaces="[^"]*"/namespaces="git"/' "$SIGNERS" > "$tmp/tag-signers"   # (the tag is checked with that key too)
  else
    FIRST=""                                           # key continuity: the same release-signers as the first signed release
    for t in $(git tag -l 'v[1-9]*' --sort=v:refname); do
      if git cat-file -e "$t:release-signers" 2>/dev/null; then FIRST=$t; break; fi
    done
    git show "$FIRST:release-signers" > "$tmp/first-signers" 2>/dev/null || fail "no signed release here to compare $REBUILD's key with"
    cmp -s "$tmp/first-signers" "$tmp/release-signers" \
      || fail "the repo's release key changed: $REBUILD's release-signers isn't the one its first signed release ($FIRST) had. Don't trust this site until that's explained."
    [ "$(keys_of "$tmp/tag-site-signers")" = "$(keys_of "$tmp/release-signers")" ] || fail "$REBUILD's site-signers and release-signers name different keys"
    cp "$tmp/release-signers" "$tmp/tag-signers"; cp "$tmp/tag-site-signers" "$tmp/site-signers"; SIGNERS="$tmp/site-signers"
    echo "Note: no key of your own to check with (--signers, ~/.ssh/buddy_release.pub or this install's .release_signers), so this trusts the repo: it checks only that $REBUILD's key is the one its first signed release ($FIRST) had."
  fi
  git -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile="$tmp/tag-signers" verify-tag "$REBUILD" 2>/dev/null \
    || fail "tag $REBUILD isn't signed by Buddy's release key"
fi
if [ -z "$SIGNERS" ]; then
  if [ -s site-signers ]; then
    SIGNERS=site-signers
    echo "Note: no key of your own to check with (--signers, ~/.ssh/buddy_release.pub or this install's .release_signers), so this only trusts what this folder's site-signers says."
  else echo "No key to check with: run this in a clone of github.com/abyyworld/buddy, or pass --signers FILE."; exit 2
  fi
fi
ssh-keygen -Y verify -f "$SIGNERS" -I buddy-release -n buddy-site -s "$tmp/live/site-manifest.json.sig" \
  < "$tmp/live/site-manifest.json" >/dev/null 2>&1 || fail "site-manifest.json isn't signed by Buddy's release key"

# every file it lists, and nothing that isn't a plain path
python3 -I - "$tmp/live" > "$tmp/paths" <<'PY' || fail "the manifest isn't a public Buddy for phones release"
import json, os, re, sys
d = sys.argv[1]
man = json.load(open(os.path.join(d, "site-manifest.json")))
v = json.load(open(os.path.join(d, "version.json"))).get("v")
assert isinstance(man.get("v"), int) and man["v"] == v and man.get("edition") == "public", "version or edition"
for p, h in sorted(man["files"].items()):
    assert re.match(r"^[a-z0-9][a-z0-9_.-]*(/[a-z0-9][a-z0-9_.-]*)*$", p) and ".." not in p and re.match(r"^[0-9a-f]{64}$", h), p
    print(p)
PY
while IFS= read -r p; do
  case "$p" in version.json) continue ;; esac
  mkdir -p "$tmp/live/$(dirname "$p")"; get "$p"
done < "$tmp/paths"
python3 -I - "$tmp/live" <<'PY' || exit 1
import hashlib, json, os, sys
d = sys.argv[1]
man = json.load(open(os.path.join(d, "site-manifest.json")))
bad = [p for p, h in sorted(man["files"].items()) if hashlib.sha256(open(os.path.join(d, p), "rb").read()).hexdigest() != h]
for p in bad:
    print("MISMATCH: %s isn't the signed file" % p)
sys.exit(1 if bad else 0)
PY
V=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["v"])' "$tmp/live/version.json")
FP=$(python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest()[:16])' "$tmp/live/site-manifest.json")
echo "OK: $URL is release v$V, signed by Buddy's release key; all its files match (manifest $FP)."

if [ -n "$REBUILD" ]; then
  [ "v$V" = "$REBUILD" ] || fail "the site is v$V, not $REBUILD"
  mkdir "$tmp/tree"
  git archive "$REBUILD" | tar -x -C "$tmp/tree"
  cmp -s "$tmp/tree/site-release/site-manifest.json" "$tmp/live/site-manifest.json" || fail "the live manifest isn't $REBUILD's"
  python3 -I "$tmp/tree/scripts/build_pages.py" --tree "$tmp/tree" --version "${REBUILD#v}" --check "$tmp/live" \
    || fail "the live site isn't what $REBUILD builds"
  echo "OK: and it's exactly what tag $REBUILD builds, byte for byte."
fi
