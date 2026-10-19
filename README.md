# Buddy: a private voice AI with characters

Buddy is a private AI you talk to out loud, on your Mac and your phone. You can have several **characters**, each
with their own personality, voice, brain and knowledge: a close friend, a blunt coach, a study partner, anyone you
describe. Buddy remembers your life through your Obsidian notes, keeps one conversation per character across Mac and
phone, and can text you first.

It's built so that **nobody can read your conversations**: the AI runs inside confidential-computing enclaves
(Tinfoil, Phala, and optionally NEAR AI for pictures), and everything else stays on your Mac. (If you'd rather not pay,
there's an opt-in free brain that is **less private**: see [Free brain](#free-brain-less-private).)

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
[Draw Things](https://apps.apple.com/app/draw-things-offline-ai-art/id6444050820) (free) for your characters' pictures, made on your Mac, or a
[NEAR AI](https://cloud.near.ai) key to have them made in seconds on sealed cloud GPUs (see [Pictures](#pictures)); a
[Phala](https://phala.com) key if you'd rather run Companion on Phala (Settings → Brain).

**Don't want to pay?** The welcome screen also offers **Start free** (labelled *Less private*): everyday chats then go to
Cloudflare's AI with your own free account, which Cloudflare can read (typing only, unless you also add a Tinfoil key). Read [Free brain](#free-brain-less-private) first.

**Updates are automatic** on the Mac (or menu bar → Check for Updates…), and the phone app updates along with it.
Buddy must stay a `git clone` in `~/BuddyFace`: that's where the app looks, and how it updates (a downloaded ZIP won't).
(A one-file download is coming.) Keys can also be set from Terminal:
`read -rs "K?Paste Tinfoil key: " && BUDDY_KEY="$K" python3 ~/BuddyFace/set_tinfoil_key.py; unset K`.

## What it does
- **Talk or type.** Tap the mic and speak; it sends when you stop. Replies are spoken out loud in the character's voice.
- **Call them.** Tap the phone button for a live, hands-free voice call: just talk, they answer out loud almost at
  once (their voice streams in as it's made), and you can talk over them to interrupt (a quick "mm-hm" doesn't).
  Pause mid-sentence and they wait for you. Everything said lands in the conversation.
- **Photos, both ways.** Characters send you photos (selfies, what they're up to) when you ask or when it fits, like a
  real person would ("Mia is sending a photo…", and it arrives when it's ready), and each has a profile photo made from
  their looks. Send them a photo too (the picture button, or paste or drop one): they see it, privately. Their photo
  always comes as a picture, never as a description in brackets; when nothing can make one right now (pictures off,
  Draw Things closed) they just say they can't send one. See [Pictures](#pictures).
- **Characters.** Switch between them like chats. Create new ones by describing them ("a calm career coach",
  "three study buddies for maths, history and French", "future me, 10 years older, keeps me on track with my goals,
  serious"): the AI writes them, picks a voice and suggests what they should know. Edit anything afterwards: name,
  voice, personality, brain, knowledge, whether they may text you first. Who they are sets how they talk: a casual
  friend texts casually, a serious coach or a "future you" stays serious and to the point (no forced slang or emoji),
  and one whose description says to remind you or keep you on track follows up, when it texts first, on what you said
  you'd do. To change how someone talks, just change their description: there's no separate tone setting.
- **Honest, not flattering.** Characters are warm but don't gush ("that's amazing!", "I'm so proud of you") unless
  it's really earned; they say what they actually think.
- **Knowledge per character.** Each character can draw on *everything in your notes*, *only the folders you choose*,
  or *only your chats with them*.
- **Memory.** Your Obsidian vault (`~/Buddy`) is searched locally for what's relevant to the conversation.
  Chats are saved to `~/Buddy/chats/<character>/` (unless you switch on Private).
- **What they know about you.** Each character keeps a short list of lasting facts you've told them (in your notes,
  `~/Buddy/Buddy knows/`, one file per character plus one for everyone), learned in the background in Tinfoil's enclave,
  never from Private messages and never passwords or card numbers. What you tell one character stays with that one
  (learning never changes the shared file or a line you wrote). Ask "what do you know about me?" and they answer
  from that list only. **What they know** (⚙︎ → Memory, or tap "Knows your notes" under their name) shows and edits
  the facts, which notes they can read, their saved chats (delete any), and everything Buddy keeps. Under each reply,
  "2 notes · 5 facts" shows what that reply was given.
- **Lives of their own.** Each character has their own days: work, errands, friends, hobbies, small wins and bad
  days, people in their life and things going on lately. They mention it when it fits, and it stays consistent (what
  they tell you becomes part of their life). Your characters can know each other (you pick, or the AI decides when it
  fits); friends hear about each other's days, never what you told the other one. Nothing about you goes into a
  character's life. See or edit it: open a character → **See their life**.
- **Texts you first.** Characters text you about things that happen in their day (sometimes two quick texts, a photo
  or a voice message), check in and follow up on things you mentioned. They learn when you usually text (only the
  times) and write when you're likely around; friends who don't hear back text less. Per character: never, now and
  then, sometimes or often; all together: a little, some or a lot (⚙︎). At your Mac you hear it; away from it you get
  a notification on your phone. Never during quiet hours.
- **Two brains.** *Advisor* (Tinfoil, smart and careful) and *Companion* (warm and personal: on Tinfoil, or on Phala if you choose it in Settings).
  Replies start quickly (no silent "thinking" first); only a typed message that plainly asks for depth ("can you
  explain how…", "walk me through…", "pros and cons of…", "help me decide…") lets a Tinfoil brain think it through
  first, so a real question gets a real answer. Everyday texts, replies read aloud, calls and the free brain never wait.
- **Islamic guidelines.** This public version follows mainstream Islamic guidelines, always and on every brain: characters
  kindly say no to haram things (alcohol and drugs, pork, gambling, interest, explicit content, dating and affairs,
  fortune-telling, ...) and suggest a halal alternative. They're flirty or romantic only if you're not married or in a
  relationship, never explicit (they ask; or set it in ⚙︎ → "Are you married or in a relationship?").
- **Private mode.** Messages that are never saved to your notes and fade from the conversation after 12 hours.

## Privacy design
**Content:** what you say, your notes, your voice and your pictures. **Metadata:** that you used a service, when, how
much, and from which IP address.

| Part | Where it runs | Who can read the content |
|---|---|---|
| Brains: Advisor and Companion | Tinfoil enclave, through Tinfoil's own verifying proxy that runs inside Buddy: it checks the enclave's attestation before anything is sent | Nobody, and it's verified |
| Optional: Companion on Phala | Phala TEE models only (`is_tee`), routed only to attested hardware with no data kept | Nobody if Phala's TEE works as stated: **trusted, not verified by Buddy** |
| Optional: the free brain (**less private**, off unless you turn it on) | Cloudflare Workers AI's ordinary servers, your own free account: the text of everyday chats, calls, texts first, their lives and new characters only (of the conversation, only what was said since you turned it on) | **Cloudflare can.** Its terms say it doesn't keep it or train on it; Buddy can't check that |
| Voice (TTS), hearing (Whisper), memory's smart search (`nomic-embed-text`) | Tinfoil enclave (verified, as above) | Nobody |
| Photos you send: what's in them | A Tinfoil vision model in its enclave (verified, as above); never Phala, NEAR or your image app | Nobody |
| Pictures from characters, "On this Mac" | Draw Things (or another image app) on your Mac, port 7860, checked to be yours | Stays on your Mac (keep Draw Things' Cloud Compute off) |
| Pictures from characters, "NEAR AI" (opt-in, your key) | FLUX.2 [klein] 4B on NEAR AI Cloud's sealed GPUs (Intel TDX + NVIDIA); Buddy checks NEAR's proof before **every** picture and encrypts the prompt to the checked server | Nobody, and it's checked (see [Pictures](#pictures) for exactly what is and isn't) |
| Memory's keyword search | Your Mac | Stays on your Mac |
| Notes, saved chats, characters, the conversation, photos (theirs and yours) | Your Mac, files readable only by your account | Stays on your Mac, **unless that folder is synced** (see below) |
| Facts about you ("What they know") | Your Mac: `~/Buddy/Buddy knows/` (your notes); learned by the Advisor in Tinfoil's enclave | Stays on your Mac, **unless that folder is synced** |
| Private chats (and photos sent in them) | Buddy's memory only: never written to disk, gone after 12 hours or a restart | Your paired devices only |
| Phone access | Your Tailscale network (encrypted end to end): only your own devices, and only **paired** ones | Your paired devices only |
| Phone mode (optional, when your Mac is away) | Your phone talks straight to Tinfoil's enclave through Tinfoil's own verifying code, built into the app: it checks the enclave before anything is sent and seals every message to it. It uses a separate key you type on the phone | Nobody, and it's verified on your phone |
| Phone notifications | Apple/Google push, encrypted end to end to your phone: who it's from and the message, like any messenger (or just "Buddy sent you a message" if you turn that off; private chats never show) | Your phone; Apple/Google only see that one arrived. Anyone looking at your lock screen can read it: iPhone Settings → Notifications → Show Previews → When Unlocked |
| Backups (optional) | A folder you choose: iCloud Drive, Dropbox, Google Drive, OneDrive or a USB drive | Nobody without your recovery key: encrypted on your Mac before it's written |

**Who can use Buddy at all:** only this Mac's Buddy app and the phones/tablets you paired with a code (Settings →
Phones & tablets; remove one any time). Other devices on your tailnet, other accounts or apps on your Mac, other
websites and the public internet are refused. The Mac app also checks it's really talking to your Buddy before it
loads or gets the microphone. Software you run as yourself on the Mac is the one thing inside the boundary: it can
read your files anyway.

**What the services still see (metadata):** Tinfoil and Phala know your account, your IP address, and when and how much
you use them. In phone mode Tinfoil also sees your phone's IP address and your Buddy address's name (browsers send it
with each request). With NEAR AI pictures on, NEAR sees your account, IP address, when, how many and what size pictures (never
the prompt: it's sealed for the checked server), and Intel and NVIDIA see that someone checked NEAR's servers. Apple sees when a notification arrives. Tailscale sees your devices and when they connect (Buddy's own
Tailscale node sends Tailscale no logs). The phone address's name is published in public certificate logs once it uses
HTTPS: with Buddy's built-in phone access that's just `buddy`; with the Tailscale app it's the Mac's Tailscale name
(e.g. `your-name-macbook`), so give the Mac a neutral name there. To hide your IP from the AI services, use a VPN or a
Mullvad exit node in Tailscale on the Mac.

**Updates can't be hijacked:** once the publisher has a release key, Buddy installs only releases signed with it (see
"Publishing updates"). Nobody who gets into the GitHub repo can push code to your Mac.

**Never use `tailscale funnel` for Buddy** (Buddy refuses Funnel traffic anyway). Keep **FileVault** on, and encrypt
your Time Machine backups. Dictate with Buddy's own mic button rather than the keyboard's dictation key.

Keys live in dot-files (`.tinfoil_key`, `.phala_key`, `.near_key`, `.cloudflare_key`) readable only by you and are git-ignored. Never paste keys into
chats with AI assistants; set them in Buddy's welcome screen or Settings (or with the Terminal command under Install).
Phone mode is the exception: it uses a separate Tinfoil key that you type on the phone. It stays on the phone
(encrypted) and is sent only to https://inference.tinfoil.sh, in the header of requests made after the phone verified
Tinfoil's enclave; that header travels over ordinary TLS, so Tinfoil's servers can read the key (your messages are
sealed for the enclave). It is never sent to your Mac.

**Cloud sync breaks this.** Standard Dropbox, Google Drive, OneDrive and iCloud Drive encrypt your files with keys
they hold, so they can read them and can be made to hand them over. If your notes folder (`~/Buddy`, where Buddy also
saves chats and what characters learned about you) or Buddy's folder is inside one of them, they can read your notes and saved chats, whatever the enclaves
do. Keep them in a folder that isn't synced, or use end-to-end encrypted sync where only you hold the key: Cryptomator
(also on top of Dropbox), Obsidian Sync, or iCloud with Advanced Data Protection. Buddy checks this and warns you in
Settings (Memory); if your sync is end-to-end encrypted, tell it so there.

## Free brain (less private)
Buddy's brains normally run in Tinfoil's sealed enclaves, which costs a little. If you'd rather not pay, you can turn
on the **free brain** instead: Settings → **Brain for everyday chats** → **Free** (or **Start free** on the welcome
screen). It's off unless you choose it, it's labelled **Less private** wherever it's chosen and while it's on (a
"Free · Less private" chip next to Private), and **Learn more** explains it in plain words before it's turned on.

- **Who:** [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/), with your own free Cloudflare
  account (no card): dash.cloudflare.com → Workers AI → Use REST API → Create a Workers AI API Token; paste the token
  and the Account ID into Buddy on the Mac (kept in `.cloudflare_key`, readable only by you, never shown again). Keep
  the account on the free Workers plan: on Workers Paid, Cloudflare bills use beyond the daily allowance instead of
  stopping.
- **Less private:** Cloudflare's servers see what's sent in plain text. Its terms say it doesn't keep it or use it to
  train AI (unless you agree), but that's a promise Buddy can't check, and terms can change. Tinfoil can't read your
  chats at all, and Buddy verifies that.
- **What goes there:** the text of everyday chats and calls (your voice is heard in Tinfoil's enclave first), the
  conversation with that character since you turned Free on (nothing from before, and never a reply that drew on your
  notes or facts), the character's description and made-up life, texts first, and new characters you describe.
  **Never:** private chats (they stay in the enclaves; without a Tinfoil key they're refused), your notes, saved chats
  or facts (so on Free characters only remember the conversation), photos (not even a description of them),
  recordings, pictures, keys or backups. Learning facts stays on Tinfoil. A Companion you put on Phala stays on Phala.
- **Without a Tinfoil key, Free is typing only:** calls, talking, read-aloud, voice messages, photos and learning run
  only in Tinfoil's enclave, so Buddy doesn't offer them (the buttons say why).
- **Limits:** 10,000 "neurons" a day for free (roughly a couple of hundred replies), back at 00:00 UTC (Buddy shows
  it in your time). When they're used up Buddy says so (a call ends, and none starts until they're back); it never
  switches to a paid brain on its own.
- **Switch back:** Settings → Brain for everyday chats → Private, on any device; removing the Cloudflare key does the
  same. Private needs a Tinfoil key: without one, Buddy can't answer until you add it (any device can turn Free back on
  while its key is there).

## Backups
Settings → **Backup** (on the Mac) keeps an encrypted copy of what makes Buddy yours: the conversation, your
characters and their pictures, the photos they sent, your settings and personality edits, and your notes (`~/Buddy`,
with the chats Buddy saves there; switch this off if you already sync or back up your notes another way). Pick a
place you already trust: iCloud Drive, Dropbox, Google Drive, OneDrive or a USB drive. Buddy writes one file a day
into `Buddy Backups` there (while you're away from the Mac, never during a call; skipped if nothing changed), named
only by its date, reads it back to check it, and keeps the last 7 days plus 4 weekly ones. It only ever deletes
backups it wrote itself on this Mac.

- **Only you can open them.** Each backup is encrypted on your Mac (AES-256-GCM) before it's written, with a key
  locked by your **recovery key**. Buddy shows the recovery key once, when you set backups up: write it down or keep
  it in your password manager. **If you lose the recovery key, nobody can open your backups: not Buddy, not Apple, not
  Dropbox, not us.** Buddy keeps a copy on this Mac (`.backup_key`, readable only by you) so it can back up by itself.
- **Never in backups:** what pairs your phone and Mac (phones pair again after restoring on a new Mac), Buddy's
  Tailscale and push keys, private chats (never saved anywhere), and your API keys unless you tick *Include my API
  keys*.
- **What the storage service sees:** a file, its size and its date. Nothing inside it.
- **Restore:** on a new Mac, install Buddy and choose *Restore from a backup* on the welcome screen (or Settings →
  Backup → Restore). Buddy finds backups in iCloud Drive, Dropbox, Google Drive, OneDrive and drives by itself, or you
  pick the file. Enter your recovery key: Buddy checks the whole backup before changing anything, moves what it has
  now to `~/Buddy before restore <date>` (never deletes it), and restarts, then tells you how it went. Your API keys
  come back only if the backup has them; otherwise paste your Tinfoil key again.
- Backups need the encryption library in Buddy's own Python environment (it comes with the install). If Settings says
  backups need it, run `zsh ~/BuddyFace/scripts/deps.sh` in Terminal, then quit Buddy and open it again.

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

**Phone mode (optional):** in the Home Screen app, ⚙︎ → **Phone mode** keeps Buddy working when your Mac is off or can't
be reached: texting, voice messages, reading replies out loud, calls and photos you send, straight from Tinfoil's
verified enclaves. It needs its own Tinfoil API key on the phone (make a separate one you can revoke at tinfoil.sh).
It only ever uses Tinfoil (private, paid), never the free brain: if you chose Free and have no Tinfoil key on your Mac,
phone mode stays off and says why. When that key's credits run out, it says so in plain words, like your Mac does.
Your characters, what they know about you for sure, their own lives and your recent conversation go along; your notes,
texting first, pictures from characters, settings and character changes wait for the Mac. What you say in phone mode
joins the conversation on your Mac when it's back (private chats never do). The phone keeps all this, and its key,
until you turn phone mode off or remove the phone on your Mac (then also revoke its key at tinfoil.sh right away), or
until it hasn't reached your Mac for 30 days: then it forgets its copy and the key (what you wrote meanwhile still waits
for your Mac). The key is sent only to Tinfoil, after the phone verified Tinfoil's enclave; Tinfoil's servers can read
the key itself, never your messages. Don't save the key in Passwords. If iCloud Backup is on, iOS may include what
phone mode keeps on the phone in that backup; turn on Advanced Data Protection to keep it end-to-end encrypted. Phone
mode is safest with Buddy's own **Phone access** (it checks that it's really your Buddy before passing anything on;
`tailscale serve` doesn't).

The phone app updates itself whenever your Mac does (it keeps a copy of the app, so it opens even while your Mac is
off).

## Buddy on your phone, no Mac
Buddy for phones (coming) is Buddy for people without a Mac: the same chat page as a website that installs like an app
and talks straight to Tinfoil's verified enclaves from your phone. It lives only at
**https://abyyworld.github.io/buddy/**; anything else that says it's Buddy for phones isn't.
1. Open that address in **Safari** on your iPhone or iPad, Share → **Add to Home Screen**, and open Buddy from the Home
   Screen. In Safari itself it keeps nothing: Home Screen apps have their own storage, which iOS doesn't clear after 7
   days, and only they can get notifications.
2. Make a **separate Tinfoil API key** for this phone at tinfoil.sh, with a **spend limit**, and paste it in. It stays on
   this phone (encrypted at rest), goes only to Tinfoil after the page has verified Tinfoil's enclave, and you can
   revoke it at tinfoil.sh if you lose the phone. Getting a key (sign-up and credits) is the slow part.

**What it stores:** the website is static files only (the app's signed code); nobody's chats, keys, characters or
settings are ever on it. Your chats, characters, what they learn about you and your key live only on your phone,
encrypted at rest (private chats only in memory), together with a verified copy of the app's code so it opens
offline. It talks to no one but Tinfoil (`atc.tinfoil.sh`, `inference.tinfoil.sh`) and, only if you turn on sync later,
your own relay. No notes, no pictures from characters, no Phala, NEAR or free brain: those need a Mac.

**How far you can trust a website:** a web app runs whatever code its address serves, and no web app can pin its own
code. Buddy's site does what it can: each release is signed on the publisher's own Mac (the key never goes to GitHub)
and deployed only from a signed release tag after the publisher approves it; the app on your phone checks every new
version's signature and every file's hash against the key it saw the first time, never goes back to an older version,
keeps the old one if anything doesn't match, and never updates during a call. But if GitHub or the publisher's account
were taken over, a changed service worker could skip those checks, as with any web app. The Mac app (signed updates)
and your Mac's own `/phone` stay the stronger options. Anyone can check the live site against a release (in a clone of
this repo):
```bash
sh scripts/check_site.sh                   # the signature and every file's hash
sh scripts/check_site.sh --rebuild v58     # and that it's exactly what tag v58 builds, byte for byte
```
⚙︎ → About shows the version and the manifest fingerprint that `check_site.sh` prints. If Buddy's release key ever
changed, the app would refuse updates signed with the new one: remove it from the Home Screen and add it again.
Every GitHub Pages site of the `abyyworld` account would share that address's origin, so the publisher never puts
another one there.

## Sync relay (for Buddy for phones)
Buddy for phones (coming: a phone app without a Mac) keeps your phones and iPads in sync through a small relay that you
run yourself, invite-only: every device encrypts everything with keys from your recovery key, and the relay only ever
stores that ciphertext. To put it on your own free Cloudflare account (Node.js 22+ needed): `zsh relay/deploy.sh` in
Buddy's folder. It prints the relay's address and a first invite; `node relay/invite.mjs` makes more (one account each).
Or run the Python version on your own server. Everything about it, including exactly what it can and can't see:
[relay/README.md](relay/README.md).

## Pictures
**Pictures from characters** (⚙︎ → **Pictures from characters**). Every picture prompt says an adult (25–35) and an
original fictional person, and Buddy refuses to make one when a character's looks or the photo they'd send point at
anyone under 18 (describe them as a woman or man, not a girl or boy), at a real or famous person ("looks like …",
"celebrity"), or at a photo you sent; then there's simply no picture. A picture takes a while to make, so it works
like a real person sending one: "Mia is sending a photo…" shows on your Mac and phone, and the photo arrives when it's
ready (profile photos are made in the background too). However a character writes it ("[image: …]", "*sends a
selfie*", "📸 …"), it becomes a real picture with the same checks, never words in the chat, a notification or their
voice; while nothing can make one (Off, or Draw Things closed), characters are told they can't send photos right now,
so they say so instead (and if Draw Things is closed, a note in the chat says why). Choose who makes them:
- **Off**: no pictures.
- **On this Mac** (free, nothing leaves your Mac, slow): [**Draw Things**](https://apps.apple.com/app/draw-things-offline-ai-art/id6444050820)
  (free, Mac App Store). In Draw Things: download the model **Z-Image Turbo 1.0 (6-bit)** from its model list and select
  it; turn on its **API Server** (HTTP, port 7860, on this Mac only); and keep **Cloud Compute off** (that would make the
  pictures on Draw Things' servers, which Buddy can't see from outside). Buddy reads Draw Things' settings and tunes each
  request for Z-Image Turbo (8 steps, Draw Things' own recommended settings) and switches off LoRAs, upscalers and
  anything else left on in the app for its pictures. About 2–3 minutes a picture on a MacBook Air (M4, 16 GB), faster on
  a Pro or Max. Settings shows what Draw Things has loaded and warns if it isn't Z-Image Turbo. (Automatic1111 or Forge on
  port 7860 work too.)
- **NEAR AI** (seconds; about 1–2¢ a picture, billed by NEAR): FLUX.2 [klein] 4B on [NEAR AI Cloud](https://cloud.near.ai)'s
  sealed GPUs. Make an account there and an API key, then on the Mac choose NEAR AI and paste the key (kept only on this
  Mac). Before **every** picture Buddy checks, on the same connection it then uses: that NEAR's gateway and picture server
  are genuine Intel TDX machines (Intel's own verdict, with current security patches on the picture server), not in debug
  mode, running a known dstack system image and exactly the measured set of programs (each pinned by digest; nothing
  built from source or pulled in from other compose files), that the answer is fresh, that the
  encryption key belongs to that machine, NVIDIA's verdict on its GPUs, and that the connection really is NEAR's checked
  gateway. Only then is the prompt sent, end-to-end encrypted to that server, and the picture must come back encrypted to
  Buddy. If any check fails, nothing is sent and Settings says why. **Not** checked (trusted): that NEAR's container
  images were built from their public source, that NEAR's deployment tool only deploys their public files, the VM's
  hardware shape, that the GPUs are physically attached to that machine, and the gateway's own software beyond its
  firmware. Only picture prompts go to NEAR, never your chats, notes or photos. To see what NEAR's servers run:
  `~/BuddyFace/.venv/bin/python ~/BuddyFace/near.py --check` (never prints your key).

**Photos you send.** Tap the picture button next to the mic (or paste or drop a picture). Your device re-encodes it
before it leaves (so no location, camera or other details go along): the chat keeps a full-quality copy (up to 4096 px),
and only a smaller copy (1536 px) is ever looked at, by a vision model in Tinfoil's enclave (Gemma 4, DeepSeek or Kimi),
through the same verifying proxy as everything else. Characters whose brain can't see get a private description from
that model instead (with Companion on Phala, only that description goes to Phala, never the photo), and if no vision
model is available they tell you they can't see it. Your
photos are never used to make pictures (not even described in words), never go into calls, and saved chats get only a line like "[sent a photo: …]". In
Private, the photo lives only in Buddy's memory (gone after 12 hours or a restart). ⚙︎ → **Characters can see photos you
send** turns this off. Pictures and your photos are stored in `.media/` (git-ignored, only readable by you).

## Using it
- **Menu bar → Open Buddy** (or **Talk to Buddy** to start speaking right away).
- **Characters:** tap the name at the top to switch, create, edit or delete characters. Describe who you want (one or
  several) and the AI writes them, or make one by hand. For each one you choose:
  - **what they know:** everything in your notes, everything *except* some folders, only some folders, or only your
    chats with them; plus **"Doesn't know about"** (names, places or topics, e.g. "Sarah, work, health"): any note
    that mentions one of those words is kept from them completely (add people's names, not just "my ex"). Facts about
    you follow the character, not folders: keep a fact for one character only, or put its words in "Doesn't know
    about";
  - **their pictures:** describe their looks, pick a style (photo, illustration, anime, 3D cartoon, painting) and make a
    profile photo (each tap is a new take; add an idea like "at a café"), **change this photo** step by step ("shorter
    hair", "smiling": on your Mac it stays close to the one you have; "back to the one before" undoes it), or **upload
    your own picture** (on the phone or the Mac; cropped and re-encoded on your device, so no location data goes along).
    Their other photos follow the looks and style;
  - **chat wallpaper:** a picture behind your chat with them, on every device: make one from a place or a mood ("rainy
    window at night"), privately like their photos, or upload your own.
- **Calls:** 📞 for a voice call. Just talk, and talk over them to interrupt.
- **What they know:** ⚙︎ → Memory → What they know: add, edit, share or delete facts, switch learning off per
  character (what you say while it's off is never learned later), see which notes they can read and delete saved
  chats. Tap "1 note · 3 facts" under a reply to see what it was given (⚙︎ → Show notes behind replies hides that on
  a shared screen).
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
| `free_brain`, `free_model`, `free_since` | The free brain (**less private**, off by default; needs its key, set on the Mac; Settings → Brain for everyday chats), its Cloudflare model (default `@cf/google/gemma-4-26b-a4b-it`), and when it was last turned on (it only gets what was said since) |
| `memory_snippets` | How many note snippets each reply may use |
| `save_chats` | Save conversations to `~/Buddy/chats/` |
| `learn_facts` | Characters learn lasting facts about you from your chats (⚙︎ → Characters learn about me) |
| `proactive`, `quiet_from`, `quiet_until`, `proactive_mode` | Texting first: on/off, quiet hours, which brain |
| `lives`, `life_texts` | Characters have lives of their own (on); how much they text first, all together: `few` / `some` / `lots` (up to 3 / 6 / 10 a day) |
| `language` | The language you speak to Buddy in (e.g. `en`), if it mishears you; empty = detect |
| `stt_model` | Another Tinfoil speech-to-text model to hear you with (e.g. `voxtral-small-24b`, to compare what it costs); unset = Whisper |
| `phone_tailnet` | Built-in phone access on/off (⚙︎ → Phone access) |
| `phone_mode` | Phones may use phone mode (`true`); `false` stops giving phones what it needs (what they already wrote still syncs) |
| `backup` | Settings → Backup: `{dir, notes, keys}`; `keep_daily` / `keep_weekly` (7 / 4) |
| `pictures` | Who makes characters' pictures: `off`, `local` (Draw Things on this Mac) or `near` (NEAR AI, needs its key) |
| `see_photos` | Characters can see photos you send (`true`/`false`) |
| `has_partner`, `partner_at` | Married or in a relationship: `yes` / `no` / `""` (not set) and when you said so (⚙︎, or tell a character; decides only whether flirting is fine) |
| `local_image_model` | A Draw Things model file Buddy should switch to for its pictures (e.g. `z_image_turbo_1.0_q6p.ckpt`); unset = whatever is loaded |
| `image_steps` | Override the steps for pictures made on this Mac |

## Publishing updates (for Buddy's publisher)
Installs update only to **signed releases** once the repo they update from has a release key:
1. Once, on your own Mac: `zsh scripts/release-key.sh --here` (makes `~/.ssh/buddy_release`; use a passphrase and keep
   an offline backup). Commit and push the `release-signers` file it writes.
2. For each release, in an up-to-date clone of the repo installs update from, on `main`: `zsh scripts/release.sh`
   (signs and publishes `v1`, `v2`, ...).
Merging to `main` alone ships nothing after that. Each install trusts the key from the first time it sees it; a new key
must arrive in a release signed with the old one.

## Troubleshooting
- **"I can't reach my brain"**: Settings → Brain says why (no key yet, or Tinfoil's enclave couldn't be verified,
  e.g. offline). Buddy never falls back to anything unverified.
- **No voice**: check the voice in the character's settings, and Settings → Brain.
- **A call doesn't hear you**: the small bar under the status moves when the mic hears sound and turns bright when it
  counts as you talking; if something's wrong the call says what. On the Mac: System Settings → Privacy & Security →
  Microphone → Buddy on (if it's on, turn it off and on; macOS sometimes needs this after an update rebuilt the app),
  then quit Buddy and open it again; also check System Settings → Sound → Input (a closed MacBook lid turns its mic
  off). Still only silence? `zsh ~/BuddyFace/scripts/doctor.sh mic` makes macOS forget Buddy's old permission and ask
  again. On iPhone/iPad: Settings → Apps → Safari → Microphone → Allow; if it's allowed, another app may be holding the
  mic (a phone or FaceTime call, Voice Memos).
- **No pictures**: ⚙︎ → Pictures from characters says why (Draw Things not open or its API server off, NEAR not
  available and why). For NEAR, `near.py --check` (see [Pictures](#pictures)) shows each check.
- **Phone can't connect**: ⚙︎ → Phone access on the Mac says what's missing; the phone needs the Tailscale app on, with
  the same account. (Using the Tailscale app on the Mac instead: `tailscale serve --bg 12400` there.)
- **Updates stuck**: run the doctor command above and read what it prints.

## Project layout
| Path | What |
|---|---|
| `buddy_server.py` | Local server (127.0.0.1:12400): chat streaming, voice, hearing, memory, saving, characters API |
| `characters.py` | Characters: built-in Buddy + yours in `my-characters/`; AI creation from a description |
| `images.py` | Pictures: Draw Things on this Mac (tuned for Z-Image Turbo) or NEAR AI, made in the background; storing pictures and the photos you send |
| `near.py`, `set_near_key.py`, `scripts/near-requirements.txt` | NEAR AI pictures: checks NEAR's sealed servers (Intel TDX, NVIDIA) before every picture and seals the prompt to them |
| `tests/` | Tests (fake or recorded data only): `python3 -m unittest discover -s tests -v` |
| `memory.py` | Local embedding index of the Obsidian vault, filtered per character |
| `facts.py` | Facts about you per character (`~/Buddy/Buddy knows/`): parsing, who sees what, background learning |
| `lives.py` | Characters' own lives (`my-characters/lives/`): a day planned once a day, who knows whom, when to text you |
| `social.py` | The shared conversation (Mac + phone; private chats in memory only), content-free push, "texts you first" |
| `backup.py` | Encrypted backups (daily, to a folder you pick) and restore; `python3 backup.py --selftest` checks it |
| `devices.py` | Who may use Buddy: the Mac app's key and paired phones (codes, hashed keys, removal) |
| `localcheck.py` | Checks the local helpers (Tinfoil Proxy, image app) run as you, and that each connection really reached them, before anything is sent |
| `tinfoilproxy.py`, `scripts/fetch_tinfoil_proxy.sh` | Runs Tinfoil's own verifying proxy inside Buddy (pinned release, checked by SHA-256) |
| `tailnet.py`, `app/tailnet/`, `scripts/build_tailnet.sh` | Built-in phone access: Buddy's own Tailscale node (Tailscale's tsnet), only your devices, no logs |
| `persona.txt`, `mode_advisor.txt`, `mode_companion.txt` | Buddy's personality and the two brain styles |
| `edition.py`, `edition.json` | The Islamic guidelines every character follows in this public version (always on) |
| `web/chat.html` | The app UI, used on the Mac (in the menu bar app) and the phone (PWA); `web/sw.js`, `manifest.json` |
| `web/direct.js` | Phone mode in the page: talks to Tinfoil's verified enclave through the SDK when the Mac is away; parity-tested ports of the prompt code; storage and sync |
| `web/vendor/tinfoil.mjs`, `scripts/build_tinfoil_js.sh`, `scripts/vendor/tinfoil/` | Tinfoil's browser SDK (tinfoil@1.2.1), pinned and rebuilt bit for bit from its lockfile |
| `app/BuddyApp.swift`, `app/build.sh` | The menu bar Mac app (chat window, mic, voice, updates) |
| `scripts/update.sh`, `scripts/doctor.sh`, `scripts/deps.sh` | Updates (signed releases), the doctor, Python environment setup |
| `scripts/release-key.sh`, `scripts/release.sh` | For the publisher: make the release key once, sign and publish releases |
| `scripts/build_pages.py`, `web/sw-site.js`, `web/site.js`, `scripts/check_site.sh`, `.github/workflows/pages.yml` | Buddy for phones, the website: built from the public copy (signed manifest, SRI, strict CSP), its service worker (checks every update's signature and files, no downgrades), deployed only from signed release tags; `check_site.sh` compares the live site with a release |
| `web/vendor/ed25519.js`, `scripts/build_ed25519_js.sh` | noble-ed25519 (pinned, rebuilt bit for bit): the website's signature check where the browser has no Ed25519 |
| `relay/` | The end-to-end encrypted sync relay for Buddy for phones: Cloudflare Worker (`deploy.sh`) or `ref.py` (Python); `node relay/tests/run.mjs` tests both |

## Credits & licence
Personal project, provided as is. Uses only Python's standard library on the server (plus `pywebpush` for phone
notifications, and, only with NEAR AI pictures, [dcap-qvl](https://github.com/Phala-Network/dcap-qvl) (MIT) to check
Intel's quotes) and no web frameworks or CDNs.
