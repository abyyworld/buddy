# Buddy's sync relay

The small server that lets your phones, iPads and browsers keep one Buddy in sync without a Mac (SPEC3 §7–§10): every
device encrypts everything itself with keys made from your **recovery key**, and the relay only stores and passes on
that ciphertext. It's **invite-only**: you run it for yourself, your family and friends you give an invite to.

Two versions with the same protocol, tested by the same tests:
- **Cloudflare** (recommended): a Worker in front of one Durable Object (SQLite) per account, one per link mailbox and
  small per-IP counters, with R2 for photos and voice messages. You deploy it to your own free Cloudflare account with
  one command; there's no server to look after. Files: `worker.js`, `account.js`, `mailbox.js`, `gate.js`,
  `common.js`, `wrangler.toml`, `deploy.sh`, `invite.mjs`, `package.json` + `package-lock.json` (wrangler, pinned).
- **`ref.py`**: the same relay in Python's standard library (3.9+), for the tests and for running your own on a home
  server, a Pi or a VPS.

(The phone app and the Mac's part come later; pushes while the app is closed (SPEC3 §11, "P3") aren't in this relay
yet: `/v1/info` says `push: false`.)

## What it keeps, what it sees, what it never gets
- **Keeps**, per account: each record's latest ciphertext (overwritten in place), deleted records' ids and
  versions for 180 days, each device's id, when it was added and by whom, when it was last seen, and **SHA-256 of its
  token** (never the token; a removed device's row for 180 days, so it still gets 410); blob ciphertext and which
  record id will hold each blob's key; counts.
- **History**: `ref.py` keeps none (SQLite with `secure_delete`: an overwrite or delete is gone from the file). On
  Cloudflare an overwrite or delete leaves the live database at once, but Cloudflare keeps a 30-day restore log of
  every Durable Object's database (point-in-time recovery; it can't be turned off), so whoever controls the Cloudflare
  account (the owner, someone who gets into it, or Cloudflare) could roll an account back up to 30 days, to older
  **ciphertext** only. Devices notice a rollback (versions and `seq` going backwards). To make old ciphertext useless
  for good, make a new recovery key (everything is encrypted again under new keys). Link mailboxes for
  10 minutes at most. Per-IP counters for a day at most (a hash of the address, never the address), and which account
  used which invite.
- **Sees** (and so does Cloudflare, or whoever hosts `ref.py`): IP addresses, your account id (it's in every URL),
  when requests come, padded sizes, how many devices you have and when each was last seen. Cloudflare's own edge logs
  (address and URL) exist whatever the relay does; the relay itself logs nothing (observability and Logpush off).
- **Never gets**: your recovery key, any message, character, name, fact, photo or voice message in readable form,
  device names (they're inside encrypted records). Your admin token and device tokens pass through it inside TLS on
  each request and are checked, never stored (the account id is a hash of the admin token, so there's no password
  store); a relay that logged them could act as you on that relay, but couldn't read anything.

## Deploy it on Cloudflare (once)
You need a free Cloudflare account and Node.js 22 or newer (`brew install node`). In Terminal, in Buddy's folder:
```
zsh relay/deploy.sh
```
It installs Cloudflare's tool (wrangler, the exact version and hashes in `package-lock.json`, no install scripts),
opens Cloudflare's sign-in in your browser the first time, creates the R2 bucket `buddy-relay-blobs`, makes the invite
secret (`relay/.secrets/invite.key`, readable by you only, git-ignored, never printed) and gives it to the relay,
deploys with logs off, checks the relay answers and prints its address (`https://buddy-relay.<you>.workers.dev`) and a
first invite. That address is the sync server Buddy for phones asks for.
- **More invites**: `node relay/invite.mjs` (one account each, valid 30 days; `--days N`). An invite is typed once, on
  the first device of a new sync account; linked devices need none.
- **Update** the relay's code: run `zsh relay/deploy.sh` again (data, invites and the address stay).
- **Several Cloudflare accounts**: `CLOUDFLARE_ACCOUNT_ID=<id> zsh relay/deploy.sh`. **Your own copy of the phone
  site** at another address: `BUDDY_SITE_ORIGINS="https://you.github.io" zsh relay/deploy.sh` (CORS lets only that
  website use the relay from a browser; the default is `https://abyyworld.github.io`, and because every GitHub Pages
  site of `abyyworld` shares that origin, no other Pages site may ever be published on that account).
- **Free plan**: Workers and SQLite Durable Objects (about 100,000 requests a day), R2 10 GB. One active device makes
  a few thousand requests a day, so a family fits. R2 may ask for a payment method even for the free tier; check
  Cloudflare's current terms (SPEC3 gate G10).
- **Remove it**: in Cloudflare's dashboard delete the Worker `buddy-relay` and the R2 bucket `buddy-relay-blobs`
  (everything in them is gone; devices keep their own copies).

## Run your own (`ref.py`)
```
python3 relay/ref.py serve --data ~/buddy-relay            # 127.0.0.1:8787; --port, --host
python3 relay/ref.py invite --data ~/buddy-relay           # one invite (one account), --days 30
```
It needs TLS in front: [Caddy](https://caddyserver.com) (`relay.example.com { reverse_proxy 127.0.0.1:8787 }`, and
start `ref.py` with `--ip-header X-Forwarded-For` so the per-IP limits see real addresses), or, for a relay only your
own devices reach, `tailscale serve --bg 8787`. The data folder (0700, files 0600) holds only ciphertext; deleted and
overwritten records are zeroed in its database (SQLite `secure_delete`). Quotas: `--quota-records`,
`--quota-record-bytes`, `--quota-blob-bytes`, `--quota-devices`; allowed websites: `--origins`.

## Protocol (v1)
The contract for devices; `worker.js` and `ref.py` answer exactly alike. Base `https://<relay>/v1`. Bodies and answers
are JSON unless said; binary values in JSON are base64url without padding ("b64"). Every answer has
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

**Ids.** `acct` = `lower(B32(SHA-256("buddy-sync v1 account" ‖ atok)))[:26]`, where `atok` = HKDF(K, "buddy-sync v1
admin", 32) (SPEC3 §7.2) and B32 is Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), most significant bit first,
5 bits a character, the last one zero-filled (for 35 bytes this is exactly `backup.key_text`'s encoding). Link
mailbox `box` = the same over `"buddy-link v1 box" ‖ code`. Record ids, device ids and blob ids: 16 bytes, b64 (22
characters).

**Auth.** Admin (recovery key): `Authorization: Buddy-Admin <b64 atok>`; the relay checks `acct == H(atok)` and stores
nothing. Device: `Authorization: Bearer <dev>.<b64 token>` (32 random bytes made on the device; the relay has only
SHA-256 of it and updates that device's last seen). A removed device's own token gets **410 `{"revoked": true}`** on
every call (the device wipes its Buddy data); a wrong token is always 401, which never wipes. After 10 failed
sign-ins from one IP in 10 minutes that IP gets 429 for the rest of the 10 minutes.

| Call | Auth | Request → answer |
|---|---|---|
| `GET /info` | none | → `{v: 1, vapid: null, push: false, invite: true, limits}` |
| `POST /a/{acct}` | admin | `{invite, dev: {id, token_hash}, hdr: {rid, ct}}` → 201 `{seq: 1, now}` (the header record at version 1); 409 exists; 403 `{error: "invite"}` (missing, wrong, expired) or `{error: "invite", why: "used"}` (another account used it); 429 after 3 creations from one IP in a day |
| `GET /a/{acct}/changes?since=S&limit=L` | device | → `{seq, horizon, more, now, items: [{rid, ver, seq, ct \| null}]}`: records with seq > S in seq order, at most L (≤ 500) and 4 MiB of ciphertext (always at least one); `seq` = the account's head; `now` = the relay's clock (ms); 410 `{error: "horizon", horizon}` when 0 < S < horizon (deletions were purged: pull from 0) |
| `POST /a/{acct}/put` | device | `{items: [{rid, base, ct \| null}]}` (≤ 200 items, ≤ 2 MiB of ciphertext, each rid once) → `{seq, results: [{rid, ver, seq} \| {rid, conflict: {ver, ct?}}]}` in item order |
| `PUT /a/{acct}/blob/{bid}` | device | raw ciphertext, `X-Rid: <record that will hold its key>` (`If-None-Match: *` welcome; blobs are never overwritten) → 201 `{bid, size}`; 412 already there (a retry: done) |
| `GET /a/{acct}/blob/{bid}` | device | → the ciphertext (`application/octet-stream`); 404 |
| `DELETE /a/{acct}/blob/{bid}` | device | → `{deleted: true \| false}` |
| `POST /a/{acct}/blob/copy` | device of this account | `{from: <old acct>, from_auth: "<dev>.<b64 token>" of a device of the old account, bids: [{bid, rid}]}` (≤ 100) → `{copied, missing, exists}` (lists of bids); 403 `{error: "from_auth"}`; 404 old account gone |
| `GET /a/{acct}/devices` | device | → `[{id, added, by: "admin" \| <dev>, seen, push: false}]` (removed devices left out; names are in encrypted records) |
| `POST /a/{acct}/devices` | admin or device | `{id, token_hash}` → 201 `{id, added, by}`; 409 the id exists or existed |
| `DELETE /a/{acct}/devices/{dev}` | admin, or that device itself | → `{revoked: dev}`: 410 for it from now on (also while the account is read-only) |
| `GET /a/{acct}/usage` | device | → `{records, bytes, blobs, blob_bytes, quota: {records, bytes, blob_bytes, devices}, created, last_seen, delete_at}` |
| `DELETE /a/{acct}` | admin | `X-Confirm: <acct>` → 200 `{deleted: true}`: records, blobs, devices, all at once. With `X-Delete-After: <1–1209600 s>` → 202 `{delete_at}`: read-only until then (409 `{error: "read-only", delete_at}` for put, blob put/delete/copy, adding devices), then gone |
| `PUT /m/{box}` | none | `{m: b64}` (≤ 8 KiB) → 201 `{n, exp}`; the first message opens the box for 10 minutes; 409 `{error: "full"}` after 8; 429 after 10 new boxes from one IP in an hour |
| `GET /m/{box}?after=N` | none | → `{msgs: [{n, m}], exp}`; 404 none or expired; 429 after 30 reads of a box in a minute |
| `DELETE /m/{box}` | none | → `{ok: true}` |

**Records** (`put`). An item is applied when `base` equals the record's current version (0 if it doesn't exist): it
becomes version `base + 1` with the next account-wide `seq`, replacing the old ciphertext (no history kept by the relay; see **History** above for Cloudflare's restore log). Otherwise the
answer carries the current version and its ciphertext (`ct: null` for a deleted or missing record; `ct` left out when
the answer would pass 4 MiB: pull it). `ct: null` is a delete: the ciphertext is dropped at once and only `{rid, ver,
seq, deleted_at}` stays, for 180 days. A put is checked whole first (400/413 change nothing; a quota answer 507 applies
nothing). The relay can't read records, so the merge rules (SPEC3 §8.2) are the devices' job: it accepts any valid
ciphertext at the right base, including a write over a delete.

**Padding** (checked, 400 `{error: "padding"}`): a record's ciphertext is `1 + 12 + P + 16` bytes, where P is a power of
two from 512 to 64 KiB or a multiple of 64 KiB up to 1 MiB (SPEC3 §7.4); a blob's is `12 + P + 16`, P a multiple of 64
KiB from 64 KiB to 16 MiB (§7.5). Bigger: 413.

**Errors**: 400 bad request, 401 auth, 403 admin needed / invite / another website's page (`{error: "origin"}`), 404 no
such account, route, device, blob or mailbox, 405 method (`Allow`), 409 exists / read-only / full, 410 horizon /
revoked, 412 blob exists, 413 too large, 429 + `Retry-After` (seconds), 507 `{error: "quota", what: records | bytes |
blob_bytes | devices}`, 503 `{error: "not set up"}` (the relay has no invite secret yet). Always `{error, …}`.

**Limits** (also in `/v1/info`): per account 100,000 records (deletes count until they're purged), 200 MiB of records,
2 GiB of blobs, 32 devices (a removed device's row counts toward 4 × that until it's purged, so adding and removing
devices can't grow an account; these four can be changed per deployment: `QUOTA_RECORDS`, `QUOTA_RECORD_BYTES`,
`QUOTA_BLOB_BYTES`, `QUOTA_DEVICES` in `wrangler.toml`, or `ref.py --quota-…`); 600 signed-in requests a minute.
Per-IP limits (3 new accounts a day, 10 new mailboxes an hour, the failed sign-in back-off) count an IPv6 /64 as one
address.

**Every day** each account is tidied: deleted records and removed devices older than 180 days are purged (the
`horizon` moves up; a device purged then gets 401, not 410), a
blob whose `X-Rid` record never appeared within 24 hours or whose record was deleted more than 7 days ago is removed,
an account with no signed-in request for 365 days is deleted, and a scheduled deletion happens.

**CORS**: `Access-Control-Allow-Origin` only for the configured website(s) (`ALLOWED_ORIGINS`), headers
`authorization, content-type, x-rid, x-confirm, x-delete-after, if-none-match`, `Max-Age: 86400`, `Retry-After`
readable, never credentials. A request from any other website's page gets 403; apps that send no `Origin` (the Mac)
are fine.

**For device code** (P2): keep the highest `ver` per record and the highest `seq` applied, and say so when the relay
answers with less (older data, or a head `seq` below what you had: it lost data or was reset); a record that doesn't
open (AEAD over `"buddy-sync v1|" ‖ acct ‖ "|" ‖ rid ‖ "|" ‖ ver`) is never used. `tests/client.mjs` shows the checks.
Open point for the client spec: a blob's AEAD binds the account id it was made in (§7.5) while a new recovery key
copies blobs without re-encrypting them (§9.5, `blob/copy`), so a copied blob's reference must keep the old account id
(or the blob AAD must drop it).

## Tests
```
node relay/tests/run.mjs                          # ref.py, and the Worker if relay/node_modules is installed
node relay/tests/run.mjs --target ref --python python3.9
cd relay && npm ci --ignore-scripts && cd .. && node relay/tests/run.mjs --target worker
```
The same black-box tests (`tests/conformance.mjs`) run against `ref.py` and against the Worker in `wrangler dev`
(Cloudflare's own runtime, workerd, on this computer: Durable Objects with SQLite and R2 on disk, no account, nothing
deployed), with random keys and invented records only, in temp folders: auth and invites, per-device tokens and
removal (410 and the wipe signal; 401 never), compare-and-swap and seq, rollback and reset detection, padding, record
and blob limits, quotas, deletes, compaction and the 410 horizon, blob clean-up, deleting an account now or later,
idle accounts, rate limits, mailboxes, moved/replayed/rolled-back/hidden records and swapped blobs (caught by the
devices' checks), CORS, and finally that nothing the relay stores contains a record's plaintext, a name, a token, an
admin token or a recovery key. Clock-dependent tests move a test-only clock (`tests/ref_harness.py`,
`tests/worker_entry.js`; the relay's own code has no test hooks). Static checks: the Worker never logs, has no
dependencies, wrangler is pinned with hashes, `ref.py` needs only the standard library.
