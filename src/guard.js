function requirePage(handler) {
  return async (req, res) => {
    if (!req.session) {
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    return handler(req, res);
  };
}
function requireApi(handler) {
  return async (req, res) => {
    if (!req.session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No autenticado" }));
    }
    return handler(req, res);
  };
}
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}
module.exports = { requirePage, requireApi, sendJson, sendHtml };
