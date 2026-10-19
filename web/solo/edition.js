// Buddy for phones: the public edition (edition.py, ported). The site is built only from the public copy, so it is
// always the public edition: PUBLIC is a constant of this file, never read from data (kit.json, settings or anything
// synced can't switch it). Part of window.BuddySoloLib.
//   romance(ed, partner, now)   which of edition.romance()'s variants (written into kit.json by romance() itself)
//                               applies to your status, exactly as direct.js's romanceText picks it
//   partnerChange(said, private, now)   what a reply's [partner: yes|no|noask] changes in your settings: from a
//                               Private chat only "yes" or "noask" (they can only make it stricter), the status only
//   settingsChange(value, now)  Settings → "Are you married or in a relationship?" (yes | no | "")
//   check(ed)                   the kit's edition texts are all there (else nothing is answered: fail closed)
(function (root) {
  "use strict";
  const L = (root.BuddySoloLib = root.BuddySoloLib || {});
  const PUBLIC = true;                                  // (the Pages site: always the public edition)
  const PYWS = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const PARTNER_TAG = new RegExp(`\\[partner:[${PYWS}]*(yes|no|noask)[${PYWS}]*\\]`, "giu");   // (edition.PARTNER_TAG)

  function romance(ed, partner, nowSec) {
    const R = ed.romance, p = partner || {}, at = typeof p.at === "number" && Number.isFinite(p.at) ? p.at : 0;
    if (p.has === "yes") return R.yes;
    if (p.has === "no") return p.noask ? R.no_noask : nowSec - at > ed.recheck ? R.no_recheck : R.no;
    return p.noask ? R.unknown_noask : R.unknown;
  }
  const partnerTags = (text) => [...String(text || "").matchAll(PARTNER_TAG)].map((m) => m[1].toLowerCase());
  function partnerChange(said, isPrivate, nowSec) {     // -> the settings to change ({} for nothing)
    said = String(said || "").toLowerCase();
    if (said === "noask") return { partner_noask: true };
    if (said === "yes" || (said === "no" && !isPrivate)) return { has_partner: said, partner_at: nowSec };
    return {};
  }
  function settingsChange(value, nowSec) {             // Settings: yes | no | "" (not set: when it was said is forgotten)
    if (!["yes", "no", ""].includes(value)) throw new Error('has_partner is yes, no or ""');
    return { has_partner: value, partner_at: value ? nowSec : null };
  }
  function partnerOf(set) {                             // kit_edition's partner from your settings
    const at = typeof set.partner_at === "number" && Number.isFinite(set.partner_at) ? set.partner_at : null;
    return { has: set.has_partner === "yes" || set.has_partner === "no" ? set.has_partner : "", at, noask: !!set.partner_noask };
  }
  function check(ed) {                                  // every text the public edition puts in a prompt is there
    if (!PUBLIC) return true;
    const R = ed && ed.romance;
    const strs = [ed && ed.halal, ed && ed.companion, ed && ed.photos, ed && ed.create, ed && ed.create_companion, ed && ed.life];
    return !!(ed && ed.public === true && strs.every((s) => typeof s === "string" && s) && R &&
      ["yes", "no", "no_recheck", "no_noask", "unknown", "unknown_noask"].every((k) => typeof R[k] === "string" && R[k]) &&
      typeof ed.recheck === "number");
  }

  L.edition = { PUBLIC, PARTNER_TAG, romance, partnerTags, partnerChange, settingsChange, partnerOf, check };
})(typeof window !== "undefined" ? window : globalThis);
