// Buddy for phones: whole system prompts against the Mac's (tests/test_solo_parity.py drives this). Two steps:
//   world  (stdin {kit, spec}): a phone made through BuddySolo's own routes (characters saved, facts added and changed
//          on the sheet, settings) in an in-memory IndexedDB -> {chars, facts, kit}: what Python rebuilds as a Mac
//   check  (stdin {kit, cases}): direct.js's systemPrompt on that phone's kit for every turn Python answered with
//          buddy_server.system_prompt; prints every mismatch, exit 1 on any
// Fake data and a fake key only; nothing leaves the process.
import { readFileSync } from "node:fs";
import { FakeIDB, FakeStorage } from "../phonemode/fake_idb.mjs";
import { device, post } from "./harness.mjs";

const input = JSON.parse(readFileSync(0, "utf8"));
const mode = process.argv[2];
if (mode === "world") {
  const d = device(input.kit, { idb: new FakeIDB(), ls: new FakeStorage("local"), ss: new FakeStorage("session") });
  const r = await d.S.init();
  if (!r.ok) throw new Error("init: " + JSON.stringify(r));
  const ids = { buddy: "buddy" };
  for (const c of input.spec.chars) {
    if (c.ref === "buddy") { await post(d.S, "/api/characters/save", { character: { id: "buddy", shared_facts: c.shared_facts } }); continue; }
    const res = await (await post(d.S, "/api/characters/save", { character: { ...c.fields, shared_facts: c.shared_facts } })).json();
    if (!res.ok) throw new Error("save: " + JSON.stringify(res));
    ids[c.ref] = res.character.id;
  }
  for (const f of input.spec.facts) {
    const j = { ...f, char: ids[f.char] };
    if (j.id && j.id.startsWith("@")) {
      const k = await (await d.S.fetch("/api/knows?char=" + encodeURIComponent(j.char))).json();
      j.id = (k.facts.find((x) => x.text === j.id.slice(1)) || {}).id;
    }
    const res = await post(d.S, "/api/knows/fact", j);
    if (!res.ok) throw new Error("fact: " + JSON.stringify([j, await res.json()]));
  }
  await post(d.S, "/api/settings", input.spec.settings || {});
  const kit = d.S.kit(), facts = {};
  for (const c of kit.chars) {
    const k = await (await d.S.fetch("/api/knows?char=" + encodeURIComponent(c.id))).json();
    facts[c.id] = k.facts;
  }
  await new Promise((ok) => process.stdout.write(JSON.stringify({ ids, kit, facts }), ok));   // (all of it, before exiting)
  process.exit(0);
}

// check
const { cases } = input;
const kit = input.kit;
const d = device(kit);                                   // (only direct.js's pure prompt code is used here)
const P = d.D._pure;
let n = 0, bad = 0;
for (const c of cases) {
  const kchar = kit.chars.find((x) => x.id === c.char);
  const turn = c.photo ? [kit.prompts.photo_safety].concat(c.cant_see ? [kit.prompts.cant_see] : []) : [];
  const r = P.systemPrompt({ kit, kchar, modeUsed: c.mode, via: c.via, extra: turn, query: c.query, asking: c.asking,
    lastTs: c.last_ts, lastRole: c.last_role, nowSec: c.t, length: c.asking ? "" : P.lengthHint(kit, c.text, c.via), partner: c.partner });
  n++;
  if (r.text === c.out && JSON.stringify(r.used) === JSON.stringify(c.used)) continue;
  bad++;
  if (bad <= 10) {
    let i = 0; while (i < r.text.length && r.text[i] === c.out[i]) i++;
    console.log(`MISMATCH prompt ${JSON.stringify([c.char, c.mode, c.via, c.asking, c.photo, c.t])}\n  at ${i}: got  ${JSON.stringify(r.text.slice(Math.max(0, i - 80), i + 160))}\n` +
      `         want ${JSON.stringify(c.out.slice(Math.max(0, i - 80), i + 160))}\n  used: ${JSON.stringify(r.used)} want ${JSON.stringify(c.used)}`);
  }
}
console.log(`${n - bad}/${n} cases match`);
process.exit(bad ? 1 : 0);
