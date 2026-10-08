#!/bin/zsh
# Buddy updater (run by the app: menu "Check for Updates", at launch and daily).
# Fast-forwards to origin/main only, rebuilds Buddy.app if app/ changed (otherwise restarts the server),
# and rolls back to the previous commit if the new version doesn't start. Your settings live in git-ignored
# *.local files, so they're never touched. Last line printed is "STATUS: …" for the app.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8          # (apps start scripts without a locale; keeps names intact)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Buddy.app"
LOG="$DIR/.update.log"
LOCK="$DIR/.update.lock"                             # (just says which updater is running: the lock is .update.flock)
cd "$DIR" || exit 1
log() { print -r -- "$(date '+%F %T') $*" >> "$LOG"; }
unlock() { rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null; }      # (the lock itself goes away with this process)
done_with() {            # the result also goes to .update_result, for when the app reading this is the one restarted
  log "$1"; print -r -- "$1" > "$DIR/.update_result"; unlock; print -r -- "STATUS: $1"; exit 0
}
SERVER="[Pp]ython[0-9.]* $DIR/buddy_server.py"    # only Buddy's server, never an editor that has the file open

python_bin() {
  for p in "$DIR/.venv/bin/python" /opt/homebrew/bin/python3 /usr/bin/python3; do [[ -x "$p" ]] && { print "$p"; return; }; done
}
answering() {   # the pid listening on Buddy's address 127.0.0.1:12400 (whichever program it is, even a hung one)
  local p=$(lsof -nP -t -iTCP@127.0.0.1:12400 -sTCP:LISTEN 2>/dev/null | head -1)
  [[ -n "$p" ]] || p=$(curl -sf --max-time 3 http://127.0.0.1:12400/api/status | sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p')
  print -r -- "$p"
}
listener() {    # that pid if it's this copy's server, however it was started (full, relative or symlinked path)
  local p=$(answering) a cmd
  [[ -n "$p" ]] || return
  cmd=$(ps -o command= -p "$p" 2>/dev/null)
  [[ "$cmd" == *"$DIR/buddy_server.py"* ]] && { print -r -- "$p"; return; }
  for a in ${(z)cmd}; do
    [[ "$a" == *buddy_server.py ]] || continue
    [[ "$a" == /* ]] || a="$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)/$a"
    [[ "${a:A}" == "${DIR:A}/buddy_server.py" ]] && { print -r -- "$p"; return; }
  done
}
port_taken() {  # something takes connections on Buddy's address (even one lsof can't see: another account's)
  curl -s -o /dev/null --max-time 3 http://127.0.0.1:12400/; (( $? != 7 ))
}
ours() { print -r -- " $(pgrep -f "$SERVER" | tr '\n' ' ') $(listener) "; }    # this copy's servers running now
stop_server() {   # ours, however it was started; one that doesn't stop (hung) is killed
  local l=$(listener) i
  pkill -f "$SERVER"; [[ -n "$l" ]] && kill "$l" 2>/dev/null
  for i in {1..20}; do
    if ! pgrep -f "$SERVER" >/dev/null && { [[ -z "$l" ]] || ! kill -0 "$l" 2>/dev/null; }; then return 0; fi
    sleep 0.25
  done
  pkill -9 -f "$SERVER"; [[ -n "$l" ]] && kill -9 "$l" 2>/dev/null; sleep 0.5
}
new_server() {  # this copy's server answers, and it isn't one that was already running before the update (a stale one)
  local pid
  curl -sf -o /dev/null --max-time 3 http://127.0.0.1:12400/api/status || return 1
  pid=$(listener)
  [[ -n "$pid" && "$OLDPIDS " != *" $pid "* ]]
}
healthy() {    # server answers, and the app is running if it should be
  for i in {1..60}; do
    [[ $i == 12 && "$1" == app && -n "$WAS_RUNNING" ]] && ! pgrep -x Buddy >/dev/null && open "$APP"   # one retry
    new_server && { [[ "$1" != app || -z "$WAS_RUNNING" ]] || pgrep -x Buddy >/dev/null; } && return 0
    sleep 1
  done
  return 1
}
apply() {      # $1 = app | server. Returns 2 if the app couldn't be built (nothing was stopped then).
  if [[ "$1" == app ]]; then
    zsh "$DIR/app/build.sh" >>"$LOG" 2>&1 || return 2
    pkill -x Buddy; stop_server; sleep 1
    [[ -n "$WAS_RUNNING" ]] && open "$APP"           # only relaunch it if it was running
    [[ -n "$WAS_RUNNING" ]] || { nohup "$(python_bin)" "$DIR/buddy_server.py" >/dev/null 2>&1 &! }
  else
    zsh "$DIR/scripts/deps.sh" >>"$LOG" 2>&1
    stop_server
    nohup "$(python_bin)" "$DIR/buddy_server.py" >/dev/null 2>&1 &!
  fi
  healthy "$1"
}
settle() {     # stopping early after going back to where a cut-off update started: run what's on disk again
  if [[ -n "$RESET" ]]; then
    WAS_RUNNING=""; OLDPIDS=$(ours)
    if apply server; then rm -f "$DIR/.update_from"     # (until then the next check tries again)
    else log "the server didn't come back after going back to ${OLD:0:7}"; fi
  fi
  done_with "$1"
}

# One check at a time (the doctor takes the same lock). It's held by this process, so one that gets cut off
# (shutdown, crash) never leaves it behind.
zmodload zsh/system && : >> "$DIR/.update.flock" && zsystem flock -t 0 -f LOCKFD "$DIR/.update.flock" 2>/dev/null \
  || { print "STATUS: already checking"; exit 0; }
mkdir -p "$LOCK"; print -r -- $$ > "$LOCK/pid"

git rev-parse --git-dir >/dev/null 2>>"$LOG" || done_with "skipped: git isn't working (the Xcode tools may need repair: run xcode-select --install)"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || done_with "skipped: not on the main branch"
for f in web/package.json web/package-lock.json; do  # left over from the old 3D character's npm install (generated files)
  git cat-file -e "HEAD:$f" 2>/dev/null && ! git diff --quiet -- "$f" 2>/dev/null && git checkout -q -- "$f"
done
python3 "$DIR/scripts/migrate_local.py" >>"$LOG" 2>&1     # your edits to tracked settings -> *.local files (safe to repeat)
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || done_with "skipped: tracked files have local edits"
git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 fetch --quiet --force --tags origin main 2>>"$LOG" \
  || done_with "couldn't reach GitHub (offline or not logged in)"   # (a stalled connection gives up after 30 s)
[[ -x "$DIR/.bin/tinfoil-proxy" ]] || zsh "$DIR/scripts/fetch_tinfoil_proxy.sh" >>"$LOG" 2>&1   # a failed download: retry
# An update that got cut off (after getting the code, before the app/server was restarted on it) is redone from where
# the running Buddy really came from, through the normal path below, so it can still be checked and rolled back.
BUILT=$(cat "$APP/Contents/Resources/source-rev" 2>/dev/null)     # the code the installed app was built from
FROM=$(cat "$DIR/.update_from" 2>/dev/null)                       # where a cut-off update started
# (RESET: the files were put back, so an early stop below restarts the server on them.)
BASE=""; RESET=""
if [[ -n "$FROM" ]] && git merge-base --is-ancestor "$FROM" HEAD 2>/dev/null; then
  BASE=$FROM                                        # (== HEAD: cut off before the merge, or a rollback after its reset)
elif [[ -n "$BUILT" ]] && git merge-base --is-ancestor "$BUILT" HEAD 2>/dev/null && ! git diff --quiet "$BUILT" HEAD -- app/; then
  # the app is older than the code: back to just before the first app change (server-only updates since then stay)
  first=$(git rev-list --reverse --first-parent --ancestry-path "$BUILT..HEAD" -- app/ | head -1)
  BASE=$BUILT; [[ -n "$first" ]] && BASE=$(git rev-parse --verify --quiet "$first^")
fi
if [[ -n "$BASE" ]]; then
  [[ "$BASE" == "$(git rev-parse HEAD)" ]] || log "finishing an update that was cut off (from ${BASE:0:7})"
  git reset --quiet --hard "$BASE" 2>>"$LOG" \
    || done_with "skipped: couldn't go back to ${BASE:0:7} to finish an update that was cut off (see .update.log)"
  RESET=1
  print -r -- "$BASE" > "$DIR/.update_from"         # kept until the server runs these files (this check gets cut off too?)
else
  rm -f "$DIR/.update_from"                         # (stale: nothing to redo from there)
fi
OLD=$(git rev-parse HEAD); NEW=$(git rev-parse origin/main)
# An app that can't be matched with the code is rebuilt from it once: built before builds were stamped with their
# commit, or built from code that isn't in this history any more (an update or rollback cut off mid-build, or a
# release that was withdrawn).
NOREV=""
if [[ -d "$APP" ]]; then
  if [[ -z "$BUILT" ]]; then NOREV=1
  elif ! git merge-base --is-ancestor "$BUILT" HEAD 2>/dev/null && ! git diff --quiet "$BUILT" HEAD -- app/ 2>/dev/null; then NOREV=1
  fi
fi
# Signed releases: once Buddy's publisher has a release key (release-signers in the repo), this install remembers it
# (.release_signers, the first time it sees it) and from then on only installs releases signed with it: unsigned
# changes, or someone who took over the GitHub repo, can't push code to this Mac.
# (Always checked with the Mac's own ssh-keygen, whatever signing program git is set up with, e.g. a password manager's.)
SIGNERS="$DIR/.release_signers"
rm -f "$SIGNERS.pending"
[[ -f "$SIGNERS" || ! -s "$DIR/release-signers" ]] || { cp "$DIR/release-signers" "$SIGNERS"; chmod 600 "$SIGNERS"; }
if [[ -f "$SIGNERS" ]]; then
  NEW=""
  for t in $(git for-each-ref --merged origin/main --no-merged HEAD --sort=-v:refname --format='%(objecttype) %(refname:short)' 'refs/tags/v*' | sed -n 's/^tag //p'); do    # newest first
    if git -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-tag "$t" >/dev/null 2>&1; then
      NEW=$(git rev-list -n 1 "$t"); break
    fi
  done
  [[ -n "$NEW" ]] || NEW=$OLD                       # no signed release newer than this yet
  git merge-base --is-ancestor "$NEW" "$OLD" && NEW=$OLD   # already at (or past) the newest signed release
  # A new release key announced inside a release signed with the trusted one is adopted once that release has been
  # tried (even if it then fails to start and is rolled back, so the next one can still be verified). Not before:
  # if this update gets cut off, redoing it still needs the key it was signed with.
  if [[ "$NEW" != "$OLD" ]] && git show "${NEW}:release-signers" > "$SIGNERS.new" 2>/dev/null && [[ -s "$SIGNERS.new" ]] \
      && ! cmp -s "$SIGNERS.new" "$SIGNERS"; then
    mv -f "$SIGNERS.new" "$SIGNERS.pending"
  fi
  rm -f "$SIGNERS.new"
fi
adopt_key() {
  [[ -s "$SIGNERS.pending" ]] || return 0
  mv -f "$SIGNERS.pending" "$SIGNERS"; chmod 600 "$SIGNERS"; log "release key changed (announced in a signed release)"
}
# (Checked first: with another program on Buddy's port, neither an update nor a restart could work.)
OLDPIDS=$(ours); ANS=$(answering)
if [[ -z "$ANS" ]] && port_taken; then             # (or Buddy's own server bound the port just now: look again)
  OLDPIDS=$(ours); ANS=$(answering); [[ -n "$ANS" ]] || ANS=unknown
fi
if [[ -n "$ANS" && "$OLDPIDS" != *" $ANS "* ]]; then
  done_with "skipped: another program is answering on Buddy's port (12400); quit it (or the other copy of Buddy) and check again"
fi

[[ "$OLD" == "$NEW" && -z "$NOREV" ]] && settle "up to date"
# (An app that has to be rebuilt anyway is rebuilt from the code that's here, rather than waiting for a newer version.)
if ! git merge-base --is-ancestor "$OLD" "$NEW"; then
  [[ -n "$NOREV" ]] || settle "skipped: origin/main isn't a fast-forward"
  NEW=$OLD; rm -f "$SIGNERS.pending"
fi
if [[ "$(cat "$DIR/.update_bad" 2>/dev/null)" == "$NEW" && "$NEW" != "$OLD" ]]; then
  [[ -n "$NOREV" ]] || settle "skipped: the latest version failed to start before"
  NEW=$OLD; rm -f "$SIGNERS.pending"
fi
print -r -- "$OLD" > "$DIR/.update_from"            # if this gets cut off, the next check redoes it from here
git merge --ff-only --quiet "$NEW" 2>>"$LOG" \
  || { [[ -n "$RESET" ]] || rm -f "$DIR/.update_from"; settle "skipped: merge failed (see .update.log)"; }   # (a redo: settle)
BASE=$OLD; [[ -n "$BUILT" ]] && git merge-base --is-ancestor "$BUILT" "$OLD" 2>/dev/null && BASE=$BUILT
KIND=server; [[ -z "$NOREV" ]] && git diff --quiet "$BASE" "$NEW" -- app/ || KIND=app   # vs what the app was built from
WAS_RUNNING=$(pgrep -x Buddy)
apply $KIND; rc=$?
if [[ $rc == 0 ]]; then
  rm -f "$DIR/.update_from"; adopt_key
  subject=$(git log -1 --format=%s); done_with "updated to ${subject[1,80]}"
fi
if [[ $rc == 2 ]]; then        # couldn't build (e.g. Xcode tools broken): the running app is untouched; try again later
  rm -f "$SIGNERS.pending"
  git reset --quiet --hard "$OLD" 2>>"$LOG" \
    || done_with "couldn't build the new app, and going back to ${OLD:0:7} didn't work yet (see .update.log); the next check finishes it"
  [[ -n "$RESET" ]] || rm -f "$DIR/.update_from"   # (a redo: settle() removes it once the server runs these files)
  settle "couldn't build the new app (the Xcode tools may need repair: run xcode-select --install); still on the previous version"
fi
if [[ "$NEW" == "$OLD" ]]; then  # this version was only rebuilt: there's nothing older to go back to
  rm -f "$DIR/.update_from"
  [[ -n "${$(ours)// /}" ]] || { nohup "$(python_bin)" "$DIR/buddy_server.py" >/dev/null 2>&1 &! }   # (at least the server)
  done_with "update failed to start: Buddy was rebuilt but didn't come up (run zsh scripts/doctor.sh in Buddy's folder)"
fi
log "new version failed to start; rolling back to ${OLD:0:7}"
print -r -- "$NEW" > "$DIR/.update_bad"; adopt_key
git reset --quiet --hard "$OLD" 2>>"$LOG" \
  || done_with "update failed to start, and going back to ${OLD:0:7} didn't work yet (see .update.log); the next check finishes it"
OLDPIDS=$(ours)
apply $KIND; rm -f "$DIR/.update_from"
done_with "update failed to start, so I rolled back to the previous version"
