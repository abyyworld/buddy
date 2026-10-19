#!/usr/bin/env python3
# Saves your NEAR AI Cloud key to .near_key in Buddy's folder (only your user can read it), for pictures made on
# NEAR's sealed GPUs (Settings → Pictures → NEAR AI). Never prints the key. Usage: BUDDY_KEY='…' python3 set_near_key.py
# (The Mac app's Settings does the same.)
import os, sys, tempfile
os.umask(0o077)   # anything written here is readable only by you
key = os.environ.get("BUDDY_KEY", "").strip()
if not (16 <= len(key) <= 400) or not key.isascii() or any(ch.isspace() or not ch.isprintable() for ch in key):
    sys.exit(f"That key is {len(key)} characters and doesn't look right. Copy the FULL key from NEAR AI Cloud and try again.")
here = os.path.dirname(os.path.abspath(__file__))
fd, tmp = tempfile.mkstemp(dir=here, prefix=".near_key.", suffix=".tmp")   # new, 0600
try:
    with os.fdopen(fd, "w") as f:
        f.write(key)
    os.replace(tmp, os.path.join(here, ".near_key"))
finally:
    if os.path.exists(tmp):
        os.remove(tmp)
print(f"NEAR AI key saved ({len(key)} characters). Run `zsh scripts/deps.sh` once to install Buddy's NEAR checker.")
