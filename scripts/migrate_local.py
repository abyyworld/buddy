#!/usr/bin/env python3
"""One-time move of your personal settings out of git-tracked files (run inside ~/BuddyFace).
config.json -> config.local.json (only the values you changed), and an edited persona.txt / mode_*.txt ->
persona.local.txt / mode_*.local.txt. The tracked files are then reset to the shipped defaults so updates
can pull cleanly. Never prints file contents."""
import json, os, subprocess, time
os.umask(0o077)   # anything written here is readable only by you

def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True)

def committed(name):
    r = git("show", "HEAD:" + name)
    return r.stdout if r.returncode == 0 else None

moved = []
head = committed("config.json")
if os.path.exists("config.json") and head is not None and open("config.json").read() != head:
    mine = json.load(open("config.json"))
    changed = {k: v for k, v in mine.items() if json.loads(head).get(k) != v}
    try: local = json.load(open("config.local.json"))
    except Exception: local = {}
    json.dump({**changed, **local}, open("config.local.json", "w"), indent=2)   # settings already local win
    moved.append(f"config.json ({len(changed)} changed settings)")
    git("checkout", "--", "config.json")
for name in ["persona.txt", "mode_advisor.txt", "mode_companion.txt"]:
    stem, ext = os.path.splitext(name)
    local, head = stem + ".local" + ext, committed(name)
    if os.path.exists(name) and head is not None and open(name).read() != head:
        if os.path.exists(local):                       # you already have your own copy: keep these edits too
            local = stem + ".edited-" + time.strftime("%Y%m%d-%H%M%S") + ".local" + ext
        os.replace(name, local); moved.append(f"{name} -> {local}")
        git("checkout", "--", name)
print("Moved to local files: " + (", ".join(moved) if moved else "nothing needed"))
