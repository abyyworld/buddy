#!/usr/bin/env python3
# Saves your Tinfoil key to ~/BuddyFace/.tinfoil_key (only your user can read it).
# Never prints the key.
import os, sys
os.umask(0o077)   # anything written here is readable only by you
key = os.environ.get("BUDDY_KEY", "").strip()
if len(key) < 20:
    sys.exit(f"That key is only {len(key)} characters. Copy the FULL key from your Tinfoil dashboard and try again.")
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tinfoil_key")
with open(p, "w") as f:
    f.write(key)
os.chmod(p, 0o600)
print(f"Tinfoil key saved ({len(key)} characters).")
