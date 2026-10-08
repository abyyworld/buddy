#!/bin/zsh
# Buddy doctor: shows why updates aren't applying, then updates and restarts Buddy in the open.
# Run from ~/BuddyFace:  zsh scripts/doctor.sh
# Prints only update logs, versions and errors (never chats, notes, keys or settings).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
DIR="${BUDDY_DIR:-$HOME/BuddyFace}"
APP="$HOME/Applications/Buddy.app"
cd "$DIR" 2>/dev/null && [[ -f buddy_server.py ]] || { print "Can't find Buddy in $DIR"; exit 1; }
say() { print -r -- "$*"; }
problem() { say ""; say "PROBLEM: $*"; say "(Send this whole output to whoever is helping you.)"; exit 1; }

say "=== Buddy doctor ==="
say "--- last update attempts"
tail -n 12 .update.log 2>/dev/null || say "(no update log yet)"
# The updater's lock: held by the doctor until it's done, so no update starts in the middle of this.
zmodload zsh/system && : >> .update.flock && zsystem flock -t 0 -f LOCKFD .update.flock 2>/dev/null \
  || problem "an update is running right now; wait a minute and run me again"
say "--- before"
say "branch: $(git rev-parse --abbrev-ref HEAD)   version: $(git log -1 --format='%h %s' | cut -c1-70)"
[[ -f .update_bad ]] && say "marked as failed before: $(cut -c1-7 .update_bad)"
edits=$(git status --porcelain --untracked-files=no)
[[ -n "$edits" ]] && { say "tracked files with local edits:"; say "$edits"; }

say "--- getting the latest version"
git fetch -q origin main 2>&1 || problem "couldn't reach GitHub (offline, or git isn't logged in)"
[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || git checkout -q main 2>&1 || problem "couldn't switch to the main branch"
python3 scripts/migrate_local.py 2>&1      # edited settings -> your *.local files (this copy's own script)
edits=$(git status --porcelain --untracked-files=no)
[[ -n "$edits" ]] && problem "these tracked files have edits I won't overwrite:
$edits"
rm -f .update_bad .update.lock/pid; rmdir .update.lock 2>/dev/null   # (.update_from: an update that got cut off, kept)
TARGET=origin/main
[[ -f .release_signers || ! -s release-signers ]] || { cp release-signers .release_signers; chmod 600 .release_signers; }
if [[ -f .release_signers ]]; then                   # signed releases only (see scripts/update.sh)
  git fetch -q --force --tags origin main 2>&1 || problem "couldn't get the release tags from GitHub"
  TARGET=""
  for t in $(git for-each-ref --merged origin/main --no-merged HEAD --sort=-v:refname --format='%(objecttype) %(refname:short)' 'refs/tags/v*' | sed -n 's/^tag //p'); do
    git -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile=.release_signers verify-tag "$t" >/dev/null 2>&1 && { TARGET=$t; break; }
  done
  [[ -n "$TARGET" ]] || TARGET=HEAD
  if [[ "$TARGET" != HEAD ]] && git show "${TARGET}:release-signers" > .release_signers.new 2>/dev/null && [[ -s .release_signers.new ]]; then
    cmp -s .release_signers.new .release_signers || mv -f .release_signers.new .release_signers.pending   # (once it's in)
  fi
  rm -f .release_signers.new
  say "newest signed release: ${TARGET}"
fi
PRE=$(git rev-parse HEAD)
git merge -q --ff-only "$TARGET" 2>&1 || problem "your copy has changes that aren't on GitHub (can't fast-forward)"
f=$(cat .update_from 2>/dev/null)                   # if I get interrupted now, the next update check finishes (and checks)
[[ -n "$f" ]] && git merge-base --is-ancestor "$f" "$PRE" 2>/dev/null || print -r -- "$PRE" > .update_from   # it
say "now at: $(git log -1 --format='%h %s' | cut -c1-70)"

say "--- building Buddy.app"
BLOG=$(mktemp); SLOG=$(mktemp); trap 'rm -f "$BLOG" "$SLOG"' EXIT      # (private temp files, removed at the end)
if ! zsh app/build.sh > "$BLOG" 2>&1 </dev/null; then
  tail -n 25 "$BLOG"; problem "the app didn't build (errors above)"
fi
grep -E "^deps:|^tinfoil-proxy:|^Built" "$BLOG"

say "--- restarting Buddy"
held() {     # whoever listens on Buddy's port (even a server that hangs)
  local p=$(lsof -nP -t -iTCP@127.0.0.1:12400 -sTCP:LISTEN 2>/dev/null | head -1)
  [[ -n "$p" ]] || p=$(curl -sf -m 3 http://127.0.0.1:12400/api/status | sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p')
  print -r -- "$p"
}
mine() {     # that's this copy's server, however it was started (full, relative or symlinked path)
  local a cmd=$(ps -o command= -p "$1" 2>/dev/null)
  [[ "$cmd" == *"$DIR/buddy_server.py"* ]] && return 0
  for a in ${(z)cmd}; do
    [[ "$a" == *buddy_server.py ]] || continue
    [[ "$a" == /* ]] || a="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)/$a"
    [[ "${a:A}" == "${DIR:A}/buddy_server.py" ]] && return 0
  done
  return 1
}
pkill -x Buddy 2>/dev/null; pkill -f "[Pp]ython[0-9.]* $DIR/buddy_server.py" 2>/dev/null; sleep 2
p=$(held)
if [[ -n "$p" ]] && mine "$p"; then          # still running (started some other way, or it hangs): make it stop
  kill "$p" 2>/dev/null
  for i in {1..10}; do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$p" 2>/dev/null; sleep 1
fi
p=$(held)
[[ -n "$p" ]] && problem "something else still answers on Buddy's port (12400), so the new version can't start:
$(ps -o pid=,command= -p "$p" | cut -c1-150)
(another copy of Buddy, or some other program: stop it, then run me again)"
open "$APP" || problem "macOS couldn't open $APP"
for i in {1..45}; do
  up=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:12400/api/status)
  [[ "$up" == 200 ]] && pgrep -x Buddy >/dev/null && break
  sleep 1
done
if ! pgrep -x Buddy >/dev/null; then
  say "Buddy quit right after starting. Newest crash report:"
  r=$(ls -t ~/Library/Logs/DiagnosticReports/Buddy* 2>/dev/null | head -1)
  [[ -n "$r" ]] && grep -m 8 -E '"exception"|"type"|"signal"|"termination"|"indicator"|"codes"|"faultingThread"' "$r"
  problem "the app doesn't stay open"
fi
if [[ "$up" != 200 ]]; then
  say "The brain server isn't answering. Starting it here to see why:"
  for py in .venv/bin/python /opt/homebrew/bin/python3 /usr/bin/python3; do [[ -x $py ]] && break; done
  say "python: $py ($($py --version 2>&1))"
  $py buddy_server.py > "$SLOG" 2>&1 </dev/null & pid=$!
  sleep 8; kill $pid 2>/dev/null
  tail -n 20 "$SLOG"
  problem "the server doesn't start (errors above)"
fi
for py in .venv/bin/python /opt/homebrew/bin/python3 /usr/bin/python3; do [[ -x $py ]] && break; done
$py -c "import pywebpush" 2>/dev/null && say "phone notifications: ready" || say "phone notifications: pywebpush missing"
for f in ~/Buddy "$DIR"; do                 # (folder paths only, never what's in them)
  r=$(cd "$f" 2>/dev/null && pwd -P) || continue
  case "$r" in */Library/CloudStorage/*|*/Library/Mobile\ Documents/*|*/Dropbox|*/Dropbox/*|*/Google\ Drive*|*/OneDrive*)
    say "WARNING: $f is synced to a cloud service ($r). It can read those files; move them out of the synced folder.";; esac
done
[[ -s .release_signers.pending ]] && { mv -f .release_signers.pending .release_signers; chmod 600 .release_signers; }
rm -f .update_from
say ""
say "ALL GOOD: Buddy is updated to $(git log -1 --format=%h) and running. Updates will now install by themselves."
