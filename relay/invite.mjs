// Prints an invite for your relay: one invite creates one sync account (the relay is invite-only).
//   node relay/invite.mjs [--days 30] [--key relay/.secrets/invite.key]
// The key is the INVITE secret deploy.sh made (0600, git-ignored); it never leaves this computer except as the
// Worker's secret. Give the invite to someone you trust (it's typed once, on their first device).
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inviteKey, makeInvite } from "./common.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const file = opt("--key", join(dirname(fileURLToPath(import.meta.url)), ".secrets", "invite.key"));
const days = Number(opt("--days", "30"));
if (!(days > 0 && days <= 3650)) { console.error("--days must be between 1 and 3650."); process.exit(2); }
let text;
try {
  if (statSync(file).mode & 0o077) { console.error(`${file} must be readable by you only (chmod 600).`); process.exit(1); }
  text = readFileSync(file, "utf8");
} catch {
  console.error(`No invite secret at ${file}. Run zsh relay/deploy.sh first (it makes one).`); process.exit(1);
}
const key = inviteKey(text);
if (!key) { console.error(`${file} isn't an invite secret.`); process.exit(1); }
const code = await makeInvite(key, { days });
console.log(`Invite (one sync account, valid ${days} days):\n\n  ${code}\n`);
