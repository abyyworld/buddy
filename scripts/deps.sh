#!/bin/zsh
# Makes sure Buddy's own Python environment (.venv) exists and has pywebpush (private phone notifications).
# Run automatically by app/build.sh and scripts/update.sh. Does nothing when everything is already there,
# installs only pywebpush (and what it needs) from PyPI, and never fails the caller.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$DIR/.venv/bin/python"
zsh "$DIR/scripts/fetch_tinfoil_proxy.sh"           # Tinfoil's verifying proxy, run by Buddy (pinned, checksummed)
[[ -x "$DIR/.bin/buddy-tailnet" ]] && command -v go >/dev/null && zsh "$DIR/scripts/build_tailnet.sh"   # if you built it once
[[ -x "$PY" ]] && "$PY" -c "import pywebpush" 2>/dev/null && { print "deps: ready"; exit 0; }
[[ -x "$PY" ]] || python3 -m venv --clear "$DIR/.venv" || { print "deps: couldn't create .venv"; exit 0; }   # (re)make it
"$PY" -m pip install -q --disable-pip-version-check pywebpush \
  || { command -v uv >/dev/null && uv pip install -q --python "$PY" pywebpush; }
"$PY" -c "import pywebpush" 2>/dev/null && print "deps: pywebpush installed" || print "deps: pywebpush install failed (notifications stay off)"
exit 0
