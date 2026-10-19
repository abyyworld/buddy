// Reproducible browser build of the pinned Tinfoil SDK for Buddy (see build.sh, which runs `npm ci` first).
// Output: out/tinfoil-<version>.mjs  - one self-contained ES module, no imports, no Node built-ins,
//         no eval/new Function/WebAssembly/Workers (checked below), license texts appended (legalComments eof)
//         out/THIRD_PARTY_LICENSES.txt, out/SHA256SUMS
// Usage:  node build.mjs
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(join(here, "node_modules/tinfoil/package.json"), "utf8"));
const lockPin = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).dependencies.tinfoil;
if (pkg.version !== lockPin) throw new Error(`installed tinfoil ${pkg.version} != pinned ${lockPin}; run build.sh`);

// The verifier's gunzip has a Node-only fallback (`await import('zlib')`) used only when the
// browser lacks DecompressionStream (Safari >= 16.4 has it). Replace it with a stub that throws;
// any other Node built-in reaching the bundle is a hard error.
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => "node:" + m)]);
const nodeGuard = {
  name: "node-builtins",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (!builtins.has(a.path)) return;
      if (a.path === "zlib" && /@tinfoilsh\/verifier\/dist\/attestation\.js$/.test(a.importer)) return { path: "zlib", namespace: "stub" };
      return { errors: [{ text: `Node built-in "${a.path}" imported by ${a.importer}` }] };
    });
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: 'export function gunzipSync(){throw new Error("zlib is not available in the browser (needs DecompressionStream)")}',
      loader: "js",
    }));
  },
};

const common = {
  bundle: true, format: "esm", platform: "browser", target: ["es2020", "safari17"],
  legalComments: "eof", charset: "utf8", metafile: true, write: false, logLevel: "warning",
  plugins: [nodeGuard], absWorkingDir: here,
  banner: { js: `// tinfoil@${pkg.version} (Apache-2.0) and dependencies, bundled for Buddy by build.mjs with esbuild ${esbuild.version}. Do not edit; rebuild.` },
};
const builds = [{ entry: "entries/buddy-tinfoil.mjs", out: `out/tinfoil-${pkg.version}.mjs` }];

mkdirSync(join(here, "out"), { recursive: true });
const sums = [];
for (const { entry, out } of builds) {
  const r = await esbuild.build({ ...common, entryPoints: [entry], outfile: out });
  const code = r.outputFiles[0].contents;
  const text = Buffer.from(code).toString("utf8");
  const banned = [/\beval\s*\(/, /\bnew Function\s*\(/, /\bWebAssembly\b/, /\bnew (Shared)?Worker\s*\(/, /\bimportScripts\b/];
  for (const re of banned) if (re.test(text)) throw new Error(`${out}: forbidden construct ${re}`);
  const left = Object.values(r.metafile.outputs)[0].imports;
  if (left.length) throw new Error(`${out}: not self-contained, still imports ${left.map((i) => i.path).join(", ")}`);
  writeFileSync(join(here, out), code);
  const sha = createHash("sha256").update(code).digest("hex");
  sums.push(`${sha}  ${out.replace(/^out\//, "")}`);
  const min = await esbuild.build({ ...common, entryPoints: [entry], outfile: out, minify: true, legalComments: "none", banner: undefined });
  const pkgs = new Set();
  const bytes = {};
  for (const [p, v] of Object.entries(Object.values(r.metafile.outputs)[0].inputs)) {
    const m = p.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (m && v.bytesInOutput > 0) { pkgs.add(m[1]); bytes[m[1]] = (bytes[m[1]] || 0) + v.bytesInOutput; }
  }
  console.log(`${out}: ${code.length} B (gzip ${gzipSync(code).length} B); minified would be ${min.outputFiles[0].contents.length} B (gzip ${gzipSync(min.outputFiles[0].contents).length} B)`);
  console.log(`  sha256 ${sha}`);
  console.log(`  bundled packages: ${[...pkgs].map((p) => { const j = JSON.parse(readFileSync(join(here, p, "package.json"), "utf8")); return `${j.name}@${j.version} (${j.license}, ${bytes[p]} B)`; }).join(", ")}`);
  if (out.includes("/tinfoil-")) {
    let lic = `Third-party licenses for ${out.replace(/^out\//, "")}\n`;
    for (const p of [...pkgs].sort()) {
      const j = JSON.parse(readFileSync(join(here, p, "package.json"), "utf8"));
      const f = readdirSync(join(here, p)).find((n) => /^(licen[sc]e|copying)/i.test(n));
      lic += `\n${"=".repeat(78)}\n${j.name}@${j.version} - ${j.license}\n${"=".repeat(78)}\n` + (f ? readFileSync(join(here, p, f), "utf8") : "(no license file in package)\n");
      const notice = readdirSync(join(here, p)).find((n) => /^notice/i.test(n));
      if (notice) lic += `\n--- NOTICE ---\n` + readFileSync(join(here, p, notice), "utf8");
    }
    writeFileSync(join(here, "out/THIRD_PARTY_LICENSES.txt"), lic);
  }
}
writeFileSync(join(here, "out/SHA256SUMS"), sums.join("\n") + "\n");
