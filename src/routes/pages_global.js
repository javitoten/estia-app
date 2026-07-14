const db = require("../db");
const { layout } = require("../render");
const { requirePage, sendHtml } = require("../guard");
const { escapeHtml, formatDate, formatCurrency } = require("../utils");
const { statusBadge, priorityBadge, categoryBadge, emptyState, modal } = require("../components");

function propOptions(companyId) {
  return db.prepare("SELECT * FROM properties WHERE company_id=? AND status='active' ORDER BY name").all(companyId)
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}
function catOptions(companyId) {
  return db.prepare("SELECT * FROM categories WHERE company_id=? ORDER BY name").all(companyId)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}

function propertyChips(companyId, kind, selectedId) {
  const table = kind === "expenses" ? "expenses" : "incomes";
  const rows = db.prepare(`SELECT p.id, p.name, p.cover_color, COALESCE(SUM(t.amount),0) total FROM properties p
    LEFT JOIN ${table} t ON t.property_id = p.id AND t.company_id = p.company_id
    WHERE p.company_id = ? AND p.status='active' GROUP BY p.id ORDER BY p.name`).all(companyId);
  const grandTotal = rows.reduce((a, r) => a + r.total, 0);
  const allCard = `<a href="/${kind}" class="prop-chip ${!selectedId ? "active" : ""}">
      <div class="prop-chip-dot" style="background:#0B1A17;"></div>
      <div class="prop-chip-name">Todas las viviendas</div>
      <div class="prop-chip-total">${formatCurrency(grandTotal)}</div>
    </a>`;
  const cards = rows.map((r) => `<a href="/${kind}?property=${r.id}" class="prop-chip ${selectedId === r.id ? "active" : ""}">
      <div class="prop-chip-dot" style="background:${r.cover_color};"></div>
      <div class="prop-chip-name">${escapeHtml(r.name)}</div>
      <div class="prop-chip-total">${formatCurrency(r.total)}</div>
    </a>`).join("");
  return `<div class="prop-chip-row">${allCard}${cards}</div>`;
}

module.exports = ({ get }) => {
  // ---------------- EXPENSES (global) ----------------
  get("/expenses", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const selectedId = req.query.property || null;
    const selectedProperty = selectedId ? db.prepare("SELECT * FROM properties WHERE id=? AND company_id=?").get(selectedId, companyId) : null;
    let q = `SELECT e.*, p.name as pname, c.name as cname, c.color as ccolor FROM expenses e
      JOIN properties p ON p.id=e.property_id LEFT JOIN categories c ON c.id=e.category_id
      WHERE e.company_id=?`;
    const params = [companyId];
    if (selectedProperty) { q += " AND e.property_id=?"; params.push(selectedProperty.id); }
    q += " ORDER BY e.date DESC LIMIT 200";
    const rows = db.prepare(q).all(...params);
    let totalQ = "SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=?";
    const totalParams = [companyId];
    if (selectedProperty) { totalQ += " AND property_id=?"; totalParams.push(selectedProperty.id); }
    const total = db.prepare(totalQ).get(...totalParams).s;
    const trs = rows.map((r) => `<tr data-row><td>${formatDate(r.date)}</td><td><a class="row-link" href="/properties/${r.property_id}?tab=expenses">${escapeHtml(r.pname)}</a></td>
      <td>${categoryBadge(r.cname, r.ccolor)}</td><td>${escapeHtml(r.description || "—")}</td><td>${formatCurrency(r.amount)}</td>
      <td><button class="btn btn-ghost btn-sm" data-delete="/api/expenses/${r.id}" data-confirm="¿Eliminar este gasto?">✕</button></td></tr>`).join("");
    const content = `
      ${propertyChips(companyId, "expenses", selectedProperty ? selectedProperty.id : null)}
      <div class="grid grid-4 mb-16 mt-16"><div class="card"><div class="kpi-label">${selectedProperty ? "Gasto de " + escapeHtml(selectedProperty.name) : "Gasto total registrado"}</div><div class="kpi-value">${formatCurrency(total)}</div></div></div>
      <div class="card"><div class="card-title">${selectedProperty ? "Gastos de " + escapeHtml(selectedProperty.name) : "Todos los gastos"} <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Añadir gasto</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Vivienda</th><th>Categoría</th><th>Descripción</th><th>Importe</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay gastos registrados todavía.")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Añadir gasto", body: `<form data-api="/api/expenses" data-method="POST" data-success="Gasto añadido">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field-row"><div class="field"><label>Importe (€)</label><input type="number" step="0.01" name="amount" required></div>
        <div class="field"><label>Fecha</label><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required></div></div>
        <div class="field"><label>Categoría</label><select name="category_id">${catOptions(companyId)}</select></div>
        <div class="field"><label>Descripción</label><input type="text" name="description"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Guardar</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Gastos", subtitle: selectedProperty ? escapeHtml(selectedProperty.name) : "Todos los gastos de tu cartera, separados por vivienda", active: "expenses", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- INCOMES (global) ----------------
  get("/incomes", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const selectedId = req.query.property || null;
    const selectedProperty = selectedId ? db.prepare("SELECT * FROM properties WHERE id=? AND company_id=?").get(selectedId, companyId) : null;
    let q = `SELECT i.*, p.name as pname FROM incomes i JOIN properties p ON p.id=i.property_id WHERE i.company_id=?`;
    const params = [companyId];
    if (selectedProperty) { q += " AND i.property_id=?"; params.push(selectedProperty.id); }
    q += " ORDER BY i.date DESC LIMIT 200";
    const rows = db.prepare(q).all(...params);
    let totalQ = "SELECT COALESCE(SUM(amount),0) s FROM incomes WHERE company_id=?";
    const totalParams = [companyId];
    if (selectedProperty) { totalQ += " AND property_id=?"; totalParams.push(selectedProperty.id); }
    const total = db.prepare(totalQ).get(...totalParams).s;
    const trs = rows.map((r) => `<tr data-row><td>${formatDate(r.date)}</td><td><a class="row-link" href="/properties/${r.property_id}?tab=incomes">${escapeHtml(r.pname)}</a></td>
      <td><span class="badge badge-blue">${escapeHtml(r.channel)}</span></td><td>${escapeHtml(r.description || "—")}</td><td>${formatCurrency(r.amount)}</td>
      <td><button class="btn btn-ghost btn-sm" data-delete="/api/incomes/${r.id}" data-confirm="¿Eliminar este ingreso?">✕</button></td></tr>`).join("");
    const content = `
      ${propertyChips(companyId, "incomes", selectedProperty ? selectedProperty.id : null)}
      <div class="grid grid-4 mb-16 mt-16"><div class="card"><div class="kpi-label">${selectedProperty ? "Ingreso de " + escapeHtml(selectedProperty.name) : "Ingreso total registrado"}</div><div class="kpi-value">${formatCurrency(total)}</div></div></div>
      <div class="card"><div class="card-title">${selectedProperty ? "Ingresos de " + escapeHtml(selectedProperty.name) : "Todos los ingresos"} <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Añadir ingreso</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Vivienda</th><th>Canal</th><th>Descripción</th><th>Importe</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay ingresos registrados todavía.")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Añadir ingreso", body: `<form data-api="/api/incomes" data-method="POST" data-success="Ingreso añadido">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field-row"><div class="field"><label>Importe (€)</label><input type="number" step="0.01" name="amount" required></div>
        <div class="field"><label>Fecha</label><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required></div></div>
        <div class="field"><label>Canal</label><select name="channel"><option>Airbnb</option><option>Booking</option><option>Directo</option><option>Vrbo</option></select></div>
        <div class="field"><label>Descripción</label><input type="text" name="description"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Guardar</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Ingresos", subtitle: selectedProperty ? escapeHtml(selectedProperty.name) : "Todos los ingresos de tu cartera, separados por vivienda", active: "incomes", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- PROFITABILITY (comparison) ----------------
  get("/profitability", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const { allPropertiesRanked } = require("../queries");
    const ranked = allPropertiesRanked(companyId, {});
    const rows = ranked.map((r) => `<tr><td><a class="row-link" href="/properties/${r.property.id}?tab=profitability">${escapeHtml(r.property.name)}</a></td>
      <td>${formatCurrency(r.income)}</td><td>${formatCurrency(r.expense)}</td><td><strong>${formatCurrency(r.profit)}</strong></td>
      <td style="color:${r.margin>=60?'#0E7C6B':r.margin>=30?'#92650B':'#C2452C'}"><strong>${r.margin.toFixed(1)}%</strong></td></tr>`).join("");
    const content = `
      <div class="card mb-16"><div class="card-title">Comparativa de rentabilidad — histórico completo</div>
        <canvas id="chartCompare" height="90"></canvas></div>
      <div class="card"><div class="card-title">Ranking de propiedades</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Propiedad</th><th>Ingresos</th><th>Gastos</th><th>Beneficio</th><th>Margen</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">${emptyState("Sin datos suficientes.")}</td></tr>`}</tbody></table></div></div>
      <script>
        new Chart(document.getElementById('chartCompare'), { type:'bar',
          data: { labels: ${JSON.stringify(ranked.map(r=>r.property.name))}, datasets:[{ label:'Beneficio (€)', data:${JSON.stringify(ranked.map(r=>Math.round(r.profit)))}, backgroundColor:'#0E7C6B', borderRadius:6 }] },
          options:{ plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>v+' €'}}} } });
      </script>`;
    sendHtml(res, 200, layout({ title: "Rentabilidad", subtitle: "Comparativa entre todas las viviendas", active: "profitability", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- CLEANINGS (global) ----------------
  get("/cleanings", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const rows = db.prepare(`SELECT c.*, p.name as pname FROM cleanings c JOIN properties p ON p.id=c.property_id WHERE c.company_id=? ORDER BY c.date DESC LIMIT 200`).all(companyId);
    const trs = rows.map((r) => {
      const checklist = JSON.parse(r.checklist || "[]");
      const done = checklist.filter(c=>c.done).length;
      return `<tr data-row><td>${formatDate(r.date)}</td><td><a class="row-link" href="/properties/${r.property_id}?tab=cleanings">${escapeHtml(r.pname)}</a></td>
      <td>${escapeHtml(r.assignee||"Sin asignar")}</td><td>${done}/${checklist.length}</td><td>${statusBadge(r.status)}</td>
      <td><button class="btn btn-ghost btn-sm" data-delete="/api/cleanings/${r.id}" data-confirm="¿Eliminar?">✕</button></td></tr>`;
    }).join("");
    const content = `<div class="card"><div class="card-title">Limpiezas <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Programar</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Vivienda</th><th>Responsable</th><th>Checklist</th><th>Estado</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay limpiezas programadas.")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Programar limpieza", body: `<form data-api="/api/cleanings" data-method="POST" data-success="Programada">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field"><label>Fecha</label><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required></div>
        <div class="field"><label>Responsable</label><input type="text" name="assignee"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Programar</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Limpiezas", subtitle: "Planificación de limpiezas de toda la cartera", active: "cleanings", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- MAINTENANCE (global) ----------------
  get("/maintenance", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const rows = db.prepare(`SELECT m.*, p.name as pname FROM maintenances m JOIN properties p ON p.id=m.property_id WHERE m.company_id=? ORDER BY m.scheduled_date DESC LIMIT 200`).all(companyId);
    const trs = rows.map((r) => `<tr data-row><td>${escapeHtml(r.title)}</td><td><a class="row-link" href="/properties/${r.property_id}?tab=maintenance">${escapeHtml(r.pname)}</a></td>
      <td>${r.type==='preventive'?'Preventivo':'Correctivo'}</td><td>${formatDate(r.scheduled_date)}</td><td>${statusBadge(r.status)}</td><td>${formatCurrency(r.cost)}</td>
      <td><button class="btn btn-ghost btn-sm" data-delete="/api/maintenances/${r.id}" data-confirm="¿Eliminar?">✕</button></td></tr>`).join("");
    const content = `<div class="card"><div class="card-title">Mantenimiento <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Nuevo</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Título</th><th>Vivienda</th><th>Tipo</th><th>Fecha</th><th>Estado</th><th>Coste</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="7">${emptyState("No hay mantenimientos registrados.")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Nuevo mantenimiento", body: `<form data-api="/api/maintenances" data-method="POST" data-success="Creado">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field"><label>Título</label><input type="text" name="title" required></div>
        <div class="field-row"><div class="field"><label>Tipo</label><select name="type"><option value="corrective">Correctivo</option><option value="preventive">Preventivo</option></select></div>
        <div class="field"><label>Fecha</label><input type="date" name="scheduled_date"></div></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Crear</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Mantenimiento", subtitle: "Mantenimientos preventivos y correctivos", active: "maintenance", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- INVENTORY (global) ----------------
  get("/inventory", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const rows = db.prepare(`SELECT i.*, p.name as pname FROM inventory_items i JOIN properties p ON p.id=i.property_id WHERE i.company_id=? ORDER BY p.name, i.room`).all(companyId);
    const trs = rows.map((r) => `<tr data-row><td><a class="row-link" href="/properties/${r.property_id}?tab=inventory">${escapeHtml(r.pname)}</a></td><td>${escapeHtml(r.room)}</td>
      <td>${escapeHtml(r.name)}</td><td>${formatCurrency(r.cost)}</td><td>${statusBadge(r.status)}</td>
      <td><button class="btn btn-ghost btn-sm" data-delete="/api/inventory/${r.id}" data-confirm="¿Eliminar?">✕</button></td></tr>`).join("");
    const content = `<div class="card"><div class="card-title">Inventario <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Añadir elemento</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Vivienda</th><th>Estancia</th><th>Elemento</th><th>Coste</th><th>Estado</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay inventario cargado.")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Añadir elemento", body: `<form data-api="/api/inventory" data-method="POST" data-success="Añadido">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field-row"><div class="field"><label>Estancia</label><input type="text" name="room" value="General"></div>
        <div class="field"><label>Elemento</label><input type="text" name="name" required></div></div>
        <div class="field"><label>Coste (€)</label><input type="number" step="0.01" name="cost" value="0"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Añadir</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Inventario", subtitle: "Inventario de toda la cartera", active: "inventory", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- DOCUMENTS (global) ----------------
  get("/documents", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const { upcomingDocumentAlerts } = require("../queries");
    const rows = db.prepare(`SELECT d.*, p.name as pname FROM documents d JOIN properties p ON p.id=d.property_id WHERE d.company_id=? ORDER BY d.expiry_date IS NULL, d.expiry_date ASC`).all(companyId);
    const now = new Date();
    const trs = rows.map((r) => {
      let alert = "—";
      if (r.expiry_date) {
        const days = Math.ceil((new Date(r.expiry_date) - now) / 86400000);
        alert = days < 0 ? `<span class="badge badge-coral">Caducado</span>` : days <= 30 ? `<span class="badge badge-coral">${days} días</span>` : days <= 60 ? `<span class="badge badge-amber">${days} días</span>` : `<span class="badge badge-teal">${days} días</span>`;
      }
      return `<tr data-row><td><a class="row-link" href="/properties/${r.property_id}?tab=documents">${escapeHtml(r.pname)}</a></td><td>${escapeHtml(r.name)}</td>
      <td>${formatDate(r.expiry_date)}</td><td>${alert}</td><td><button class="btn btn-ghost btn-sm" data-delete="/api/documents/${r.id}" data-confirm="¿Eliminar?">✕</button></td></tr>`;
    }).join("");
    const alerts = upcomingDocumentAlerts(companyId, 60);
    const content = `
      ${alerts.length ? `<div class="card mb-16" style="border-color:#F5D6C9;background:#FFF8F4;"><div class="card-title" style="color:#92650B;">⚠️ ${alerts.length} documento(s) caducan en menos de 60 días</div></div>` : ""}
      <div class="card"><div class="card-title">Documentación <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Añadir documento</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Vivienda</th><th>Nombre</th><th>Caducidad</th><th>Alerta</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="5">${emptyState("No hay documentación cargada.")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Añadir documento", body: `<form data-api="/api/documents" data-method="POST" data-success="Añadido">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field"><label>Nombre</label><input type="text" name="name" required></div>
        <div class="field-row"><div class="field"><label>Emisión</label><input type="date" name="issue_date"></div>
        <div class="field"><label>Caducidad</label><input type="date" name="expiry_date"></div></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Añadir</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Documentación", subtitle: "Repositorio documental con alertas de vencimiento", active: "documents", user: req.session.user, company: req.session.company, content }));
  }));

  // ---------------- INCIDENTS (global) ----------------
  get("/incidents", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const rows = db.prepare(`SELECT i.*, p.name as pname FROM incidents i JOIN properties p ON p.id=i.property_id WHERE i.company_id=? ORDER BY i.status, i.priority DESC, i.created_at DESC`).all(companyId);
    const trs = rows.map((r) => `<tr data-row><td>${escapeHtml(r.title)}</td><td><a class="row-link" href="/properties/${r.property_id}?tab=incidents">${escapeHtml(r.pname)}</a></td>
      <td>${priorityBadge(r.priority)}</td><td>${statusBadge(r.status)}</td><td>${formatDate(r.created_at)}</td>
      <td><button class="btn btn-ghost btn-sm" data-delete="/api/incidents/${r.id}" data-confirm="¿Eliminar?">✕</button></td></tr>`).join("");
    const content = `<div class="card"><div class="card-title">Incidencias <button class="btn btn-primary btn-sm" onclick="openModal('m')">+ Nueva incidencia</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Título</th><th>Vivienda</th><th>Prioridad</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay incidencias. 🎉")}</td></tr>`}</tbody></table></div></div>
      ${modal({ id: "m", title: "Nueva incidencia", body: `<form data-api="/api/incidents" data-method="POST" data-success="Registrada">
        <div class="field"><label>Vivienda</label><select name="property_id" required>${propOptions(companyId)}</select></div>
        <div class="field"><label>Título</label><input type="text" name="title" required></div>
        <div class="field"><label>Prioridad</label><select name="priority"><option value="normal">Normal</option><option value="high">Alta</option><option value="low">Baja</option></select></div>
        <div class="field"><label>Descripción</label><textarea name="description"></textarea></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Registrar</button></form>` })}`;
    sendHtml(res, 200, layout({ title: "Incidencias", subtitle: "Incidencias abiertas y resueltas", active: "incidents", user: req.session.user, company: req.session.company, content }));
  }));
};
