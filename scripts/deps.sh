#!/bin/zsh
# Makes sure Buddy's own Python environment (.venv) exists and has pywebpush (private phone notifications) and
# cryptography (comes with it; encrypted backups need it), and, only once you've added a NEAR AI key, Buddy's NEAR
# checker (dcap-qvl, pinned by hash in scripts/near-requirements.txt).
# Run automatically by app/build.sh and scripts/update.sh. Does nothing when everything is already there,
# installs only those (and what they need) from PyPI, and never fails the caller.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$DIR/.venv/bin/python"
zsh "$DIR/scripts/fetch_tinfoil_proxy.sh"           # Tinfoil's verifying proxy, run by Buddy (pinned, checksummed)
[[ -x "$DIR/.bin/buddy-tailnet" ]] && command -v go >/dev/null && zsh "$DIR/scripts/build_tailnet.sh"   # if you built it once
near_checker() {   # NEAR AI pictures (opt-in): Intel TDX quote checker for near.py; wheels only, every file hash-checked
  [[ -s "$DIR/.near_key" && -x "$PY" ]] || return 0
  "$PY" -c "import dcap_qvl" 2>/dev/null && return 0
  "$PY" -m pip install -q --disable-pip-version-check --only-binary=:all: --require-hashes \
    -r "$DIR/scripts/near-requirements.txt" && print "deps: NEAR checker installed" || print "deps: NEAR checker install failed"
}
[[ -x "$PY" ]] && "$PY" -c "import pywebpush, cryptography" 2>/dev/null && { near_checker; print "deps: ready"; exit 0; }
[[ -x "$PY" ]] || python3 -m venv --clear "$DIR/.venv" || { print "deps: couldn't create .venv"; exit 0; }   # (re)make it
"$PY" -m pip install -q --disable-pip-version-check pywebpush cryptography \
  || { command -v uv >/dev/null && uv pip install -q --python "$PY" pywebpush cryptography; }
"$PY" -c "import pywebpush" 2>/dev/null && print "deps: pywebpush installed" || print "deps: pywebpush install failed (notifications stay off)"
"$PY" -c "import cryptography" 2>/dev/null || print "deps: cryptography install failed (backups stay off)"
near_checker
exit 0
