const db = require("../db");
const { uuid, parseBody } = require("../utils");
const { requireApi, sendJson } = require("../guard");

function ownProperty(companyId, propertyId) {
  return db.prepare("SELECT * FROM properties WHERE id = ? AND company_id = ?").get(propertyId, companyId);
}
function logAudit(companyId, userId, entity, action, detail) {
  db.prepare("INSERT INTO audit_log (id, company_id, user_id, entity, action, detail) VALUES (?,?,?,?,?,?)").run(uuid(), companyId, userId, entity, action, detail || "");
}

module.exports = ({ get, post, put, del }) => {
  // ---------------- PROPERTIES ----------------
  post("/api/properties", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!b.name) return sendJson(res, 400, { error: "El nombre de la vivienda es obligatorio." });
    const id = uuid();
    db.prepare(`INSERT INTO properties (id, company_id, name, address, city, type, capacity, bedrooms, bathrooms, license_number, cleaning_lead, maintenance_lead, channels, cover_color)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, companyId, b.name, b.address || "", b.city || "", b.type || "apartment",
      Number(b.capacity) || 2, Number(b.bedrooms) || 1, Number(b.bathrooms) || 1,
      b.license_number || "", b.cleaning_lead || "", b.maintenance_lead || "", b.channels || "",
      ["#0E7C6B", "#5B7FDE", "#E9B44C", "#9B7FE8", "#C2452C"][Math.floor(Math.random() * 5)]
    );
    logAudit(companyId, req.session.user.id, "property", "create", b.name);
    sendJson(res, 201, { id });
  }));

  put("/api/properties/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const prop = ownProperty(companyId, req.params.id);
    if (!prop) return sendJson(res, 404, { error: "Vivienda no encontrada" });
    const b = await parseBody(req);
    db.prepare(`UPDATE properties SET name=?, address=?, city=?, type=?, capacity=?, bedrooms=?, bathrooms=?, license_number=?, cleaning_lead=?, maintenance_lead=?, channels=? WHERE id=?`).run(
      b.name || prop.name, b.address ?? prop.address, b.city ?? prop.city, b.type || prop.type,
      Number(b.capacity) || prop.capacity, Number(b.bedrooms) || prop.bedrooms, Number(b.bathrooms) || prop.bathrooms,
      b.license_number ?? prop.license_number, b.cleaning_lead ?? prop.cleaning_lead, b.maintenance_lead ?? prop.maintenance_lead,
      b.channels ?? prop.channels, prop.id
    );
    sendJson(res, 200, { id: prop.id });
  }));

  del("/api/properties/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const prop = ownProperty(companyId, req.params.id);
    if (!prop) return sendJson(res, 404, { error: "Vivienda no encontrada" });
    db.prepare("UPDATE properties SET status='archived' WHERE id=?").run(prop.id);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- EXPENSES ----------------
  post("/api/expenses", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    if (!b.amount || !b.date) return sendJson(res, 400, { error: "Importe y fecha son obligatorios" });
    const id = uuid();
    db.prepare("INSERT INTO expenses (id, company_id, property_id, category_id, amount, date, description) VALUES (?,?,?,?,?,?,?)").run(
      id, companyId, b.property_id, b.category_id || null, Number(b.amount), b.date, b.description || ""
    );
    sendJson(res, 201, { id });
  }));
  del("/api/expenses/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    db.prepare("DELETE FROM expenses WHERE id = ? AND company_id = ?").run(req.params.id, companyId);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- INCOMES ----------------
  post("/api/incomes", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    if (!b.amount || !b.date) return sendJson(res, 400, { error: "Importe y fecha son obligatorios" });
    const id = uuid();
    db.prepare("INSERT INTO incomes (id, company_id, property_id, amount, date, channel, description) VALUES (?,?,?,?,?,?,?)").run(
      id, companyId, b.property_id, Number(b.amount), b.date, b.channel || "direct", b.description || ""
    );
    sendJson(res, 201, { id });
  }));
  del("/api/incomes/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    db.prepare("DELETE FROM incomes WHERE id = ? AND company_id = ?").run(req.params.id, companyId);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- CLEANINGS ----------------
  post("/api/cleanings", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    const id = uuid();
    const checklist = JSON.stringify([
      { label: "Cambio de sábanas y toallas", done: false },
      { label: "Limpieza de baños", done: false },
      { label: "Cocina y electrodomésticos", done: false },
      { label: "Revisión de inventario", done: false },
      { label: "Fotos finales", done: false },
    ]);
    db.prepare("INSERT INTO cleanings (id, company_id, property_id, date, assignee, status, checklist) VALUES (?,?,?,?,?,?,?)").run(
      id, companyId, b.property_id, b.date, b.assignee || "", "pending", checklist
    );
    sendJson(res, 201, { id });
  }));
  put("/api/cleanings/:id", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    const row = db.prepare("SELECT * FROM cleanings WHERE id=? AND company_id=?").get(req.params.id, companyId);
    if (!row) return sendJson(res, 404, { error: "No encontrada" });
    if (b.toggle_item !== undefined) {
      const checklist = JSON.parse(row.checklist || "[]");
      const idx = Number(b.toggle_item);
      if (checklist[idx]) checklist[idx].done = !checklist[idx].done;
      const allDone = checklist.length > 0 && checklist.every((c) => c.done);
      db.prepare("UPDATE cleanings SET checklist=?, status=? WHERE id=?").run(JSON.stringify(checklist), allDone ? "done" : "pending", row.id);
      return sendJson(res, 200, { ok: true, status: allDone ? "done" : "pending" });
    }
    db.prepare("UPDATE cleanings SET status=?, assignee=? WHERE id=?").run(b.status || row.status, b.assignee ?? row.assignee, row.id);
    sendJson(res, 200, { ok: true });
  }));
  del("/api/cleanings/:id", requireApi(async (req, res) => {
    db.prepare("DELETE FROM cleanings WHERE id = ? AND company_id = ?").run(req.params.id, req.session.company.id);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- MAINTENANCE ----------------
  post("/api/maintenances", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    const id = uuid();
    db.prepare("INSERT INTO maintenances (id, company_id, property_id, title, type, scheduled_date, status, assignee, cost, notes) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      id, companyId, b.property_id, b.title, b.type || "corrective", b.scheduled_date || null, "scheduled", b.assignee || "", Number(b.cost) || 0, b.notes || ""
    );
    sendJson(res, 201, { id });
  }));
  put("/api/maintenances/:id", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    const row = db.prepare("SELECT * FROM maintenances WHERE id=? AND company_id=?").get(req.params.id, companyId);
    if (!row) return sendJson(res, 404, { error: "No encontrada" });
    db.prepare("UPDATE maintenances SET status=? WHERE id=?").run(b.status || row.status, row.id);
    sendJson(res, 200, { ok: true });
  }));
  del("/api/maintenances/:id", requireApi(async (req, res) => {
    db.prepare("DELETE FROM maintenances WHERE id = ? AND company_id = ?").run(req.params.id, req.session.company.id);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- INVENTORY ----------------
  post("/api/inventory", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    const id = uuid();
    db.prepare("INSERT INTO inventory_items (id, company_id, property_id, room, name, brand, purchase_date, cost, status) VALUES (?,?,?,?,?,?,?,?,?)").run(
      id, companyId, b.property_id, b.room || "General", b.name, b.brand || "", b.purchase_date || null, Number(b.cost) || 0, "good"
    );
    sendJson(res, 201, { id });
  }));
  del("/api/inventory/:id", requireApi(async (req, res) => {
    db.prepare("DELETE FROM inventory_items WHERE id = ? AND company_id = ?").run(req.params.id, req.session.company.id);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- DOCUMENTS ----------------
  post("/api/documents", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    const id = uuid();
    db.prepare("INSERT INTO documents (id, company_id, property_id, type, name, issue_date, expiry_date) VALUES (?,?,?,?,?,?,?)").run(
      id, companyId, b.property_id, b.type || "other", b.name, b.issue_date || null, b.expiry_date || null
    );
    sendJson(res, 201, { id });
  }));
  del("/api/documents/:id", requireApi(async (req, res) => {
    db.prepare("DELETE FROM documents WHERE id = ? AND company_id = ?").run(req.params.id, req.session.company.id);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- INCIDENTS ----------------
  post("/api/incidents", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!ownProperty(companyId, b.property_id)) return sendJson(res, 400, { error: "Vivienda no válida" });
    const id = uuid();
    db.prepare("INSERT INTO incidents (id, company_id, property_id, inventory_item_id, title, description, priority, status) VALUES (?,?,?,?,?,?,?,'open')").run(
      id, companyId, b.property_id, b.inventory_item_id || null, b.title, b.description || "", b.priority || "normal"
    );
    sendJson(res, 201, { id });
  }));
  put("/api/incidents/:id", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    const row = db.prepare("SELECT * FROM incidents WHERE id=? AND company_id=?").get(req.params.id, companyId);
    if (!row) return sendJson(res, 404, { error: "No encontrada" });
    const status = b.status || row.status;
    db.prepare("UPDATE incidents SET status=?, resolved_at=? WHERE id=?").run(
      status, status === "resolved" ? new Date().toISOString() : row.resolved_at, row.id
    );
    sendJson(res, 200, { ok: true });
  }));
  del("/api/incidents/:id", requireApi(async (req, res) => {
    db.prepare("DELETE FROM incidents WHERE id = ? AND company_id = ?").run(req.params.id, req.session.company.id);
    sendJson(res, 200, { ok: true });
  }));

  // ---------------- PROVIDERS / CATEGORIES ----------------
  post("/api/providers", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    const id = uuid();
    db.prepare("INSERT INTO providers (id, company_id, name, cif, category) VALUES (?,?,?,?,?)").run(id, companyId, b.name, b.cif || "", b.category || "");
    sendJson(res, 201, { id });
  }));
  post("/api/categories", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    const id = uuid();
    db.prepare("INSERT INTO categories (id, company_id, name, color, kind) VALUES (?,?,?,?,?)").run(id, companyId, b.name, b.color || "#6B7280", "expense");
    sendJson(res, 201, { id });
  }));

  // ---------------- USERS (settings) ----------------
  post("/api/users", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (req.session.user.role !== "admin") return sendJson(res, 403, { error: "Solo un administrador puede invitar usuarios." });
    const existing = db.prepare("SELECT id FROM users WHERE email=?").get((b.email||"").toLowerCase());
    if (existing) return sendJson(res, 400, { error: "Ese email ya está registrado." });
    const { hashPassword } = require("../auth");
    const id = uuid();
    db.prepare("INSERT INTO users (id, company_id, name, email, password_hash, role) VALUES (?,?,?,?,?,?)").run(
      id, companyId, b.name, (b.email||"").toLowerCase(), hashPassword(b.password || "estia1234"), b.role || "field"
    );
    sendJson(res, 201, { id });
  }));
  del("/api/users/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    if (req.session.user.role !== "admin") return sendJson(res, 403, { error: "No autorizado" });
    if (req.params.id === req.session.user.id) return sendJson(res, 400, { error: "No puedes eliminarte a ti mismo." });
    db.prepare("DELETE FROM users WHERE id=? AND company_id=?").run(req.params.id, companyId);
    sendJson(res, 200, { ok: true });
  }));

  require("./ai")({ post });
};
