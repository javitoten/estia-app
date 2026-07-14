const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { getSessionUser } = require("./src/auth");
const { ensureDemoAccount } = require("./src/seed");

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME = {
  ".css": "text/css", ".js": "application/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};

// route table: { method, pattern (regex), keys, handler }
const routes = [];
function addRoute(method, pattern, handler) {
  const keys = [];
  const regexStr = pattern.replace(/:[a-zA-Z_]+/g, (m) => {
    keys.push(m.slice(1));
    return "([^/]+)";
  });
  const regex = new RegExp("^" + regexStr + "$");
  routes.push({ method, regex, keys, handler });
}
const get = (p, h) => addRoute("GET", p, h);
const post = (p, h) => addRoute("POST", p, h);
const put = (p, h) => addRoute("PUT", p, h);
const del = (p, h) => addRoute("DELETE", p, h);

function serveStatic(req, res, pathname) {
  const filePath = path.join(PUBLIC_DIR, pathname.replace("/", path.sep));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    res.end(data);
  });
}

function serveUpload(req, res, pathname, session) {
  // /uploads/:companyId/:file — only accessible to logged-in users of that company
  const parts = pathname.split("/").filter(Boolean); // uploads, companyId, file
  if (parts.length < 3 || !session || session.company.id !== parts[1]) {
    res.writeHead(403); return res.end("Forbidden");
  }
  const filePath = path.join(UPLOADS_DIR, parts[1], parts[2]);
  if (!filePath.startsWith(UPLOADS_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function dispatch(req, res) {
  const parsed = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname);
  req.query = Object.fromEntries(parsed.searchParams);

  if (pathname.startsWith("/css/") || pathname.startsWith("/js/") || pathname.startsWith("/img/")) {
    return serveStatic(req, res, pathname);
  }

  const session = getSessionUser(req);
  req.session = session;

  if (pathname.startsWith("/uploads/")) {
    return serveUpload(req, res, pathname, session);
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    req.params = params;
    try {
      return await r.handler(req, res);
    } catch (err) {
      console.error(err);
      if (pathname.startsWith("/api/")) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Error interno: " + err.message }));
      }
      res.writeHead(500, { "Content-Type": "text/html" });
      return res.end("<h1>500</h1><p>" + escapeErr(err.message) + "</p>");
    }
  }
  res.writeHead(404, { "Content-Type": "text/html" });
  res.end("<h1>404</h1><p>Página no encontrada</p><a href='/dashboard'>Volver</a>");
}

function escapeErr(s) { return String(s).replace(/</g, "&lt;"); }

const server = http.createServer((req, res) => {
  dispatch(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) { res.writeHead(500); res.end("Internal error"); }
  });
});

require("./src/routes/auth")({ get, post });
require("./src/routes/pages")({ get });
require("./src/routes/api")({ get, post, put, del });
require("./src/routes/invoices")({ get, post, del });

ensureDemoAccount();

server.listen(PORT, () => {
  console.log("");
  console.log("  Estia — Vacation Property OS");
  console.log("  ------------------------------------");
  console.log(`  App:   http://localhost:${PORT}`);
  console.log("  Demo:  demo@estia.app / demo1234");
  console.log("");
});
