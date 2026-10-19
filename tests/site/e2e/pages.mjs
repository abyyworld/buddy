// A static server that answers like GitHub Pages, for Buddy for phones' site e2e tests (shell.mjs, built.mjs): no CSP,
// Cache-Control max-age=600, ETag (304s), /buddy -> /buddy/ (301), 404.html for misses; `down` makes every connection
// fail (offline). Serves one built site folder at a time (serve(dir)) under `prefix`; `log` holds every path asked for.
// Local only (127.0.0.1), temp folders only.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png" };
export function pages(prefix) {
  const s = { dir: null, down: false, log: [], prefix };
  s.server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    s.log.push(path);
    if (s.down) { req.socket.destroy(); return; }   // (offline: the connection just fails)
    const send = (code, body, type, extra = {}) => {
      const etag = '"' + createHash("sha1").update(body).digest("hex").slice(0, 16) + '"';
      if (code === 200 && req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "max-age=600", "Access-Control-Allow-Origin": "*", ETag: etag,
        "Last-Modified": "Fri, 09 Oct 2026 12:00:00 GMT", "Server": "GitHub.com", "X-GitHub-Request-Id": "TEST", Vary: "Accept-Encoding", ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (prefix !== "/" && path === prefix.slice(0, -1)) { res.writeHead(301, { Location: prefix }); res.end(); return; }
    const notFound = () => {
      const nf = join(s.dir, "404.html");
      send(404, existsSync(nf) ? readFileSync(nf) : Buffer.from("Not Found"), "text/html; charset=utf-8");
    };
    if (!path.startsWith(prefix) || path.includes("..")) return notFound();
    let rel = path.slice(prefix.length);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const f = join(s.dir, rel);
    if (!existsSync(f) || !statSync(f).isFile()) return notFound();
    send(200, readFileSync(f), TYPES[extname(f)] || "application/octet-stream");
  });
  s.start = () => new Promise((ok) => s.server.listen(0, "127.0.0.1", () => { s.port = s.server.address().port; s.origin = "http://127.0.0.1:" + s.port; ok(s); }));
  s.serve = (dir) => { s.dir = dir; };
  return s;
}
