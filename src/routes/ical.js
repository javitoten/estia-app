const db = require("../db");
const { uuid, parseBody } = require("../utils");
const { requireApi, sendJson } = require("../guard");
const { syncFeed, syncAllFeeds } = require("../ical");

function ownProperty(companyId, propertyId) {
  return db.prepare("SELECT * FROM properties WHERE id = ? AND company_id = ?").get(propertyId, companyId);
}

module.exports = ({ get, post, del }) => {
  // Crear una conexión de calendario (Airbnb/Booking/Vrbo/Otro) para una vivienda
  post("/api/ical-feeds", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    if (!b.url || !/^https?:\/\//i.test(b.url)) return sendJson(res, 400, { error: "Introduce una URL de calendario (.ics) válida." });
    const id = uuid();
    db.prepare("INSERT INTO ical_feeds (id, company_id, property_id, channel, url) VALUES (?,?,?,?,?)").run(
      id, companyId, b.property_id, b.channel || "airbnb", b.url.trim()
    );
    // Intentamos sincronizar inmediatamente para dar feedback rápido, pero no
    // bloqueamos la creación si el proveedor tarda o falla.
    let syncResult = null;
    try {
      const feed = db.prepare("SELECT * FROM ical_feeds WHERE id=?").get(id);
      syncResult = await syncFeed(feed);
    } catch (err) {
      db.prepare("UPDATE ical_feeds SET last_status=? WHERE id=?").run("error:" + String(err.message).slice(0, 150), id);
    }
    sendJson(res, 201, { id, sync: syncResult });
  }));

  del("/api/ical-feeds/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    db.prepare("DELETE FROM ical_feeds WHERE id=? AND company_id=?").run(req.params.id, companyId);
    sendJson(res, 200, { ok: true });
  }));

  post("/api/ical-feeds/:id/sync", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const feed = db.prepare("SELECT * FROM ical_feeds WHERE id=? AND company_id=?").get(req.params.id, companyId);
    if (!feed) return sendJson(res, 404, { error: "Conexión no encontrada" });
    try {
      const r = await syncFeed(feed);
      sendJson(res, 200, { ok: true, ...r });
    } catch (err) {
      sendJson(res, 502, { error: "No se pudo leer el calendario: " + err.message });
    }
  }));

  // Sincroniza todas las conexiones de la empresa (botón del Calendario)
  post("/api/ical/sync-all", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const r = await syncAllFeeds(companyId);
    sendJson(res, 200, r);
  }));
};
