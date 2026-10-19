// A stand-in for the Buddy for phones site, for the solo tests: what scripts/build_pages.py makes from the public tree
// (SPEC3 §3.2-§3.4), done the simple way here: chat.html with <meta name="buddy-site" content="solo">, its inline style
// and script moved to app.css / app.js, relative paths, the web/solo/* scripts before direct.js, kit.json =
// kitparts.static_kit("public"), and the page's Content-Security-Policy as a header (no relay: none yet). The Tinfoil
// SDK at vendor/tinfoil.mjs is the fake one (tests/phonemode/fake_tinfoil.mjs). Served under /buddy/ like the real site.
// Fake data only. Run alone to look at it:  node tests/solo/site.mjs   (prints its address)
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SOLO_FILES, staticKit } from "./harness.mjs";

export const PREFIX = "/buddy/";
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; connect-src 'self' https://atc.tinfoil.sh https://inference.tinfoil.sh; worker-src 'self'; " +
  "manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const web = (f) => readFileSync(join(ROOT, "web", f));

export function siteFiles({ version = 58 } = {}) {
  let html = web("chat.html").toString("utf8");
  const style = /<style>([\s\S]*?)<\/style>/.exec(html), script = /<script>([\s\S]*)<\/script>/.exec(html);
  if (!style || !script) throw new Error("chat.html changed shape");
  html = html.replace(style[0], '<link rel="stylesheet" href="app.css">').replace(script[0], '<script src="app.js"></script>');
  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="buddy-site" content="solo">\n<meta name="referrer" content="no-referrer">');
  html = html.replace('<script src="/direct.js"></script>', SOLO_FILES.map((f) => `<script src="solo/${f}.js"></script>`).join("\n") + '\n<script src="direct.js"></script>');
  html = html.replace(/(href|src)="\/(manifest\.json|icons\/[^"]+)"/g, '$1="$2"');
  if (/(?:src|href)="\//.test(html)) throw new Error("an absolute path is left in the site's page");
  const files = {
    "index.html": [html, "text/html; charset=utf-8"],
    "app.js": [script[1], "text/javascript"], "app.css": [style[1], "text/css"],
    "direct.js": [web("direct.js"), "text/javascript"], "pcm-tap.js": [web("pcm-tap.js"), "text/javascript"],
    "vendor/tinfoil.mjs": [readFileSync(join(ROOT, "tests", "phonemode", "fake_tinfoil.mjs")), "text/javascript"],
    "kit.json": [JSON.stringify(staticKit("public")), "application/json"],
    "version.json": [JSON.stringify({ v: version }), "application/json"],
    "manifest.json": [JSON.stringify({ name: "Buddy", short_name: "Buddy", id: "./", start_url: "./", scope: "./", display: "standalone",
      icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }] }), "application/manifest+json"],
  };
  for (const f of SOLO_FILES) files[`solo/${f}.js`] = [web(`solo/${f}.js`), "text/javascript"];
  for (const f of readdirSync(join(ROOT, "web", "default-icons"))) files["icons/" + f] = [web("default-icons/" + f), "image/png"];
  return files;
}

// -> {url (the site's address, ending in /buddy/), log: [paths asked for], stop()}
export function serve(opts = {}) {
  const files = siteFiles(opts), log = [];
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    log.push({ method: req.method, path: u.pathname, ua: req.headers["user-agent"] || "" });
    let p = u.pathname.startsWith(PREFIX) ? u.pathname.slice(PREFIX.length) : null;
    if (p === "") p = "index.html";
    const f = p !== null && Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null;
    if (req.method !== "GET" || !f) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    const h = { "Content-Type": f[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (p === "index.html") h["Content-Security-Policy"] = CSP + "; frame-ancestors 'none'";
    res.writeHead(200, h); res.end(f[0]);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({
    url: `http://127.0.0.1:${srv.address().port}${PREFIX}`, origin: `http://127.0.0.1:${srv.address().port}`, log, files,
    stop: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) })));
}

if (process.argv[1] && process.argv[1].endsWith("site.mjs")) {
  const s = await serve();
  process.stdout.write(s.url + "\n");
}
