# Buddy: a private voice AI with characters

Buddy is a private AI you talk to out loud, on your Mac and your phone. You can have several **characters**, each
with their own personality, voice, brain and knowledge: a close friend, a blunt coach, a study partner, anyone you
describe. Buddy remembers your life through your Obsidian notes, keeps one conversation per character across Mac and
phone, and can text you first.

It's built so that **nobody can read your conversations**: the AI runs inside confidential-computing enclaves
(Tinfoil, Phala), and everything else stays on your Mac.

## Install

**You need:** a Mac with Apple silicon (M1 or newer, macOS 13+). Optional: an iPhone or iPad.

**1. Get a Tinfoil API key** (the AI's private enclaves; pay as you go, the only account Buddy needs):
[tinfoil.sh](https://tinfoil.sh) → Get Started → Dashboard → Private Inference → API Keys
([how-to](https://docs.tinfoil.sh/get-api-key)).

**2. Install Buddy on your Mac.** Open Terminal (⌘ Space, type "Terminal") and paste:
```bash
git clone https://github.com/abyyworld/buddy.git ~/BuddyFace && zsh ~/BuddyFace/app/build.sh && open ~/Applications/Buddy.app
```
If a window asks to install the "command line developer tools", click **Install**, wait for it to finish, then paste
the line again. Buddy appears in the menu bar (two speech bubbles); paste your Tinfoil key into its welcome screen
(kept only on this Mac, readable only by you) and allow the microphone once.

**3. Optional: your phone or iPad.** Install [Tailscale for iPhone/iPad](https://apps.apple.com/app/tailscale/id1470499037) (free), then follow
[Your phone](#your-phone-iphone--ipad) below. Buddy runs on your phone as a Home Screen app from Safari; there's
nothing else to install.

**Optional extras:** [Obsidian](https://obsidian.md) to write the notes Buddy remembers (open `~/Buddy` as a vault);
[Draw Things](https://apps.apple.com/app/draw-things-offline-ai-art/id6444050820) (free) for your characters' pictures, made on your Mac; a [Phala](https://phala.com) key if you
want Companion fully uncensored (Settings → Brain).

**Updates are automatic** on the Mac (or menu bar → Check for Updates…), and the phone app updates along with it.
Buddy must stay a `git clone` in `~/BuddyFace`: that's where the app looks, and how it updates (a downloaded ZIP won't).
(A one-file download is coming.) Keys can also be set from Terminal:
`read -rs "K?Paste Tinfoil key: " && BUDDY_KEY="$K" python3 ~/BuddyFace/set_tinfoil_key.py; unset K`.

## What it does
- **Talk or type.** Tap the mic and speak; it sends when you stop. Replies are spoken out loud in the character's voice.
- **Call them.** Tap the phone button for a live, hands-free voice call: just talk, they answer out loud almost at
  once (their voice streams in as it's made), and you can talk over them to interrupt (a quick "mm-hm" doesn't).
  Pause mid-sentence and they wait for you. Everything said lands in the conversation.
- **Photos.** Characters can send you photos (selfies, what they're up to) when you ask or when it fits, and each has
  a profile photo made from their looks. Always made privately (see "Photos" below).
- **Characters.** Switch between them like chats. Create new ones by describing them ("a calm career coach",
  "three study buddies for maths, history and French"): the AI writes them, picks a voice and suggests what they
  should know. Edit anything afterwards: name, voice, personality, brain, knowledge, whether they may text you first.
- **Knowledge per character.** Each character can draw on *everything in your notes*, *only the folders you choose*,
  or *only your chats with them*.
- **Memory.** Your Obsidian vault (`~/Buddy`) is searched locally for what's relevant to the conversation.
  Chats are saved to `~/Buddy/chats/<character>/` (unless you switch on Private).
- **Texts you first.** Characters you allow can check in, follow up on things you mentioned, or bring up a topic.
  At your Mac you hear it; away from it you get a notification on your phone. Never during quiet hours.
- **Two brains.** *Advisor* (Tinfoil, smart and careful) and *Companion* (for adults: on Tinfoil, or fully uncensored on Phala if you choose it in Settings).
- **Private mode.** Messages that are never saved to your notes and fade from the conversation after 12 hours.

## Privacy design
**Content:** what you say, your notes, your voice and your pictures. **Metadata:** that you used a service, when, how
much, and from which IP address.

| Part | Where it runs | Who can read the content |
|---|---|---|
| Brains: Advisor and Companion | Tinfoil enclave, through Tinfoil's own verifying proxy that runs inside Buddy: it checks the enclave's attestation before anything is sent | Nobody, and it's verified |
| Optional: Companion on Phala (fully uncensored) | Phala TEE models only (`is_tee`), routed only to attested hardware with no data kept | Nobody if Phala's TEE works as stated: **trusted, not verified by Buddy** |
| Voice (TTS), hearing (Whisper), memory's smart search (`nomic-embed-text`) | Tinfoil enclave (verified, as above) | Nobody |
| Memory's keyword search | Your Mac | Stays on your Mac |
| Notes, saved chats, characters, the conversation, photos | Your Mac, files readable only by your account | Stays on your Mac, **unless that folder is synced** (see below) |
| Private chats | Buddy's memory only: never written to disk, gone after 12 hours or a restart | Your paired devices only |
| Phone access | Your Tailscale network (encrypted end to end): only your own devices, and only **paired** ones | Your paired devices only |
| Phone notifications | Apple/Google push, always just "Buddy sent you a message" | Nobody; Apple/Google see that one arrived |

**Who can use Buddy at all:** only this Mac's Buddy app and the phones/tablets you paired with a code (Settings →
Phones & tablets; remove one any time). Other devices on your tailnet, other accounts or apps on your Mac, other
websites and the public internet are refused. The Mac app also checks it's really talking to your Buddy before it
loads or gets the microphone. Software you run as yourself on the Mac is the one thing inside the boundary: it can
read your files anyway.

**What the services still see (metadata):** Tinfoil and Phala know your account, your IP address, and when and how much
you use them. Apple sees when a notification arrives. Tailscale sees your devices and when they connect (Buddy's own
Tailscale node sends Tailscale no logs). The phone address's name is published in public certificate logs once it uses
HTTPS: with Buddy's built-in phone access that's just `buddy`; with the Tailscale app it's the Mac's Tailscale name
(e.g. `your-name-macbook`), so give the Mac a neutral name there. To hide your IP from the AI services, use a VPN or a
Mullvad exit node in Tailscale on the Mac.

**Updates can't be hijacked:** once the publisher has a release key, Buddy installs only releases signed with it (see
"Publishing updates"). Nobody who gets into the GitHub repo can push code to your Mac.

**Never use `tailscale funnel` for Buddy** (Buddy refuses Funnel traffic anyway). Keep **FileVault** on, and encrypt
your Time Machine backups. Dictate with Buddy's own mic button rather than the keyboard's dictation key.

Keys live in dot-files (`.tinfoil_key`, `.phala_key`) readable only by you and are git-ignored. Never paste keys into
chats with AI assistants; set them in Buddy's welcome screen or Settings (or with the Terminal command under Install).

**Cloud sync breaks this.** Standard Dropbox, Google Drive, OneDrive and iCloud Drive encrypt your files with keys
they hold, so they can read them and can be made to hand them over. If your notes folder (`~/Buddy`, where Buddy also
saves chats) or Buddy's folder is inside one of them, they can read your notes and saved chats, whatever the enclaves
do. Keep them in a folder that isn't synced, or use end-to-end encrypted sync where only you hold the key: Cryptomator
(also on top of Dropbox), Obsidian Sync, or iCloud with Advanced Data Protection. Buddy checks this and warns you in
Settings (Memory); if your sync is end-to-end encrypted, tell it so there.

## Your phone (iPhone / iPad)
The phone app is served by your Mac over your private Tailscale network (free), so it works wherever you are as long
as your Mac is on, awake and online (System Settings → Battery → Options: prevent sleeping when the display is off,
on power). Your phone needs the Tailscale app;
the Mac doesn't, when Buddy has its built-in phone access (for now: install [Go](https://go.dev/dl/) once, then run
`zsh ~/BuddyFace/scripts/build_tailnet.sh` in Terminal; the coming one-file download will have it built in):
1. On the Mac: Buddy → ⚙︎ → **Phone access** → **Turn on**, then **Sign in to Tailscale** (makes a free account if you
   don't have one). If it says so, turn on HTTPS certificates in Tailscale's DNS settings (the link is right there).
   Buddy is now a device called `buddy` on your tailnet; only your own devices can reach it.
   (Without the built-in part: install Tailscale on the Mac, give the Mac a neutral name, and run
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 12400` once.)
2. Install [Tailscale](https://apps.apple.com/app/tailscale/id1470499037) on the phone or iPad and sign in with the same account.
3. On the Mac: ⚙︎ → **Pair a phone**. It shows a code and a QR code with the phone's address
   (`https://buddy.<tailnet>.ts.net/phone`).
4. Open that address in Safari on the phone, Share → **Add to Home Screen**, open Buddy from the Home Screen and type
   the code. (The Home Screen app keeps its own pairing, so pair it there.)
5. ⚙︎ → Notifications → **Enable**.

**Sign out of Tailscale** (under Phone access) takes Buddy off your tailnet and forgets its keys.

The phone app updates itself whenever your Mac does.

## Photos
Pictures are only ever made privately, in this order: an image model in Tinfoil's enclave, an image model in Phala's
enclave (`is_tee` only), or an image app on your own Mac. Buddy checks which one is available by itself. If neither
enclave offers an image model on your account, use an app on your Mac, for example [**Draw Things**](https://apps.apple.com/app/draw-things-offline-ai-art/id6444050820) (free, Mac App Store):
open it, pick a model, and turn on its **HTTP API server** (port 7860). Nothing leaves your Mac that way. Characters'
looks are always original fictional adults, never real people. Photos are stored in `.media/` (git-ignored, only
readable by you).

## Using it
- **Menu bar → Open Buddy** (or **Talk to Buddy** to start speaking right away).
- **Characters:** tap the name at the top to switch, create, edit or delete characters. Describe who you want (one or
  several) and the AI writes them, or make one by hand. For each one you choose:
  - **what they know:** everything in your notes, everything *except* some folders, only some folders, or only your
    chats with them; plus **"Doesn't know about"** (names, places or topics, e.g. "Sarah, work, health"): any note
    that mentions one of those words is kept from them completely (add people's names, not just "my ex");
  - **their pictures:** describe their looks, pick a style (photo, illustration, anime, 3D cartoon, painting) and make a
    profile photo (each tap is a new take; add an idea like "at a café"), or **upload your own picture** (on the phone
    or the Mac; cropped and re-encoded on your device, so no location data goes along). Their other photos follow the looks and style.
- **Calls:** 📞 for a voice call. Just talk, and talk over them to interrupt.
- **Advisor / Companion / Private** chips under the message box; ⚙︎ for voice replies, "texts first", notifications
  (phone) and **New chat** (a fresh start for the current character; it still remembers your notes).
- **Saved chats:** menu bar → Open Saved Chats (`~/Buddy/chats/<character>/`).

## Updates
Menu bar → **Check for Updates…**. Buddy also checks every few hours while you're away from the keyboard. Updates
install the newest signed release (or fast-forward from this repo's `main` until the publisher has a release key),
rebuild the app if needed, and roll back by themselves if the new version doesn't start. If updates ever get stuck ("Skipped: …"), run the doctor, which shows why and fixes it:
```bash
zsh ~/BuddyFace/scripts/doctor.sh
```
Your own things are never touched by updates: `config.local.json` (settings), `persona.local.txt` (Buddy's
personality, if you edited it), `my-characters/` (your characters), and everything in `~/Buddy`.

## Settings
`config.json` holds the defaults; put your changes in `config.local.json`:

| Key | What |
|---|---|
| `name`, `voice` | Name and default voice of the built-in Buddy |
| `advisor_model`, `companion_tinfoil_model` | Models for the two brains on Tinfoil |
| `companion_provider`, `companion_model` | Companion on `tinfoil` or `phala` (Settings → Brain), and the Phala model |
| `memory_snippets` | How many note snippets each reply may use |
| `save_chats` | Save conversations to `~/Buddy/chats/` |
| `proactive`, `quiet_from`, `quiet_until`, `proactive_mode` | Texting first: on/off, quiet hours, which brain |
| `language` | The language you speak to Buddy in (e.g. `en`), if it mishears you; empty = detect |
| `phone_tailnet` | Built-in phone access on/off (⚙︎ → Phone access) |

## Publishing updates (for Buddy's publisher)
Installs update only to **signed releases** once the repo they update from has a release key:
1. Once, on your own Mac: `zsh scripts/release-key.sh` (makes `~/.ssh/buddy_release`; use a passphrase and keep an
   offline backup). Commit and push the `release-signers` file it writes.
2. For each release, in an up-to-date clone of the repo installs update from, on `main`: `zsh scripts/release.sh`
   (signs and publishes `v1`, `v2`, ...).
Merging to `main` alone ships nothing after that. Each install trusts the key from the first time it sees it; a new key
must arrive in a release signed with the old one.

## Troubleshooting
- **"I can't reach my brain"**: Settings → Brain says why (no key yet, or Tinfoil's enclave couldn't be verified,
  e.g. offline). Buddy never falls back to anything unverified.
- **No voice**: check the voice in the character's settings, and Settings → Brain.
- **Phone can't connect**: ⚙︎ → Phone access on the Mac says what's missing; the phone needs the Tailscale app on, with
  the same account. (Using the Tailscale app on the Mac instead: `tailscale serve --bg 12400` there.)
- **Updates stuck**: run the doctor command above and read what it prints.

## Project layout
| Path | What |
|---|---|
| `buddy_server.py` | Local server (127.0.0.1:12400): chat streaming, voice, hearing, memory, saving, characters API |
| `characters.py` | Characters: built-in Buddy + yours in `my-characters/`; AI creation from a description |
| `images.py` | Private photo making (Tinfoil / Phala enclave image model, or a local image app) |
| `memory.py` | Local embedding index of the Obsidian vault, filtered per character |
| `social.py` | The shared conversation (Mac + phone; private chats in memory only), content-free push, "texts you first" |
| `devices.py` | Who may use Buddy: the Mac app's key and paired phones (codes, hashed keys, removal) |
| `localcheck.py` | Checks the local helpers (Tinfoil Proxy, image app) run as you, and that each connection really reached them, before anything is sent |
| `tinfoilproxy.py`, `scripts/fetch_tinfoil_proxy.sh` | Runs Tinfoil's own verifying proxy inside Buddy (pinned release, checked by SHA-256) |
| `tailnet.py`, `app/tailnet/`, `scripts/build_tailnet.sh` | Built-in phone access: Buddy's own Tailscale node (Tailscale's tsnet), only your devices, no logs |
| `persona.txt`, `mode_advisor.txt`, `mode_companion.txt` | Buddy's personality and the two brain styles |
| `web/chat.html` | The app UI, used on the Mac (in the menu bar app) and the phone (PWA); `web/sw.js`, `manifest.json` |
| `app/BuddyApp.swift`, `app/build.sh` | The menu bar Mac app (chat window, mic, voice, updates) |
| `scripts/update.sh`, `scripts/doctor.sh`, `scripts/deps.sh` | Updates (signed releases), the doctor, Python environment setup |
| `scripts/release-key.sh`, `scripts/release.sh` | For the publisher: make the release key once, sign and publish releases |

## Credits & licence
Personal project, provided as is. Uses only Python's standard library on the server (plus `pywebpush` for phone
notifications) and no web frameworks or CDNs.
