const db = require("./db");
const { escapeHtml, formatDate, formatCurrency, formatDateTime } = require("./utils");
const { statusBadge, priorityBadge, categoryBadge, emptyState, modal } = require("./components");
const { propertyProfitability, monthlySeries } = require("./queries");

function categoriesOptions(companyId, selected) {
  const cats = db.prepare("SELECT * FROM categories WHERE company_id=? ORDER BY name").all(companyId);
  return cats.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
}

function actionsCell(deleteUrl, confirmMsg) {
  return `<button class="btn btn-ghost btn-sm" data-delete="${deleteUrl}" data-confirm="${confirmMsg}" title="Eliminar">✕</button>`;
}

// ---------------- RESUMEN ----------------
function tabResumen(p, companyId) {
  const profitYear = propertyProfitability(companyId, p.id, { start: `${new Date().getFullYear()}-01-01` });
  const nextCheckin = db.prepare("SELECT * FROM reservations WHERE company_id=? AND property_id=? AND checkin >= date('now') ORDER BY checkin ASC LIMIT 1").get(companyId, p.id);
  const nextDoc = db.prepare("SELECT * FROM documents WHERE company_id=? AND property_id=? AND expiry_date IS NOT NULL ORDER BY expiry_date ASC LIMIT 1").get(companyId, p.id);
  const owner = p.owner_id ? db.prepare("SELECT * FROM owners WHERE id=?").get(p.owner_id) : null;

  const feed = db.prepare(`
    SELECT 'invoice' as kind, provider_name as label, amount, created_at FROM invoices WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'cleaning', 'Limpieza · ' || COALESCE(assignee,'sin asignar'), NULL, created_at FROM cleanings WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'incident', title, NULL, created_at FROM incidents WHERE company_id=? AND property_id=?
    ORDER BY created_at DESC LIMIT 8
  `).all(companyId, p.id, companyId, p.id, companyId, p.id);

  const feedHtml = feed.length ? feed.map((f) => `
    <div style="padding:9px 0;border-bottom:1px solid #F0F1F3;">
      <strong style="font-size:13px;">${escapeHtml(f.label || "")}</strong>${f.amount ? ` — ${formatCurrency(f.amount)}` : ""}
      <div class="text-gray text-sm">${formatDateTime(f.created_at)}</div>
    </div>`).join("") : emptyState("Todavía no hay actividad registrada.");

  return `
    <div class="grid grid-4 mb-16">
      <div class="card"><div class="kpi-label">Beneficio (año)</div><div class="kpi-value" style="font-size:22px;">${formatCurrency(profitYear.profit)}</div></div>
      <div class="card"><div class="kpi-label">Margen (año)</div><div class="kpi-value" style="font-size:22px;">${profitYear.margin.toFixed(1)}%</div></div>
      <div class="card"><div class="kpi-label">Próximo check-in</div><div class="kpi-value" style="font-size:16px;">${nextCheckin ? formatDate(nextCheckin.checkin) : "—"}</div></div>
      <div class="card"><div class="kpi-label">Próximo vencimiento</div><div class="kpi-value" style="font-size:15px;color:${nextDoc ? "#C2452C" : "inherit"}">${nextDoc ? escapeHtml(nextDoc.name) : "Sin datos"}</div></div>
    </div>
    <div class="grid grid-2" style="grid-template-columns:1.1fr 1fr;">
      <div class="card">
        <div class="card-title">Ficha técnica</div>
        <table class="data">
          <tr><td class="text-gray">Tipo</td><td>${escapeHtml(p.type)}</td></tr>
          <tr><td class="text-gray">Dirección</td><td>${escapeHtml(p.address || "—")}</td></tr>
          <tr><td class="text-gray">Propietario</td><td>${owner ? escapeHtml(owner.name) : "Gestión directa"}</td></tr>
          <tr><td class="text-gray">Canales activos</td><td>${escapeHtml(p.channels || "—")}</td></tr>
          <tr><td class="text-gray">Responsable limpieza</td><td>${escapeHtml(p.cleaning_lead || "—")}</td></tr>
          <tr><td class="text-gray">Responsable mantenimiento</td><td>${escapeHtml(p.maintenance_lead || "—")}</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-title">Actividad reciente</div>
        ${feedHtml}
      </div>
    </div>`;
}

// ---------------- INVOICES ----------------
function tabInvoices(p, companyId) {
  const rows = db.prepare(`SELECT i.*, c.name as cat_name, c.color as cat_color FROM invoices i LEFT JOIN categories c ON c.id=i.category_id
    WHERE i.company_id=? AND i.property_id=? ORDER BY i.issue_date DESC`).all(companyId, p.id);
  const trs = rows.map((r) => `
    <tr data-row>
      <td><a class="row-link" href="/invoices/${r.id}">${escapeHtml(r.provider_name || "—")}</a></td>
      <td>${formatDate(r.issue_date)}</td>
      <td>${categoryBadge(r.cat_name, r.cat_color)}</td>
      <td>${formatCurrency(r.amount)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${actionsCell("/api/invoices/" + r.id, "¿Eliminar esta factura?")}</td>
    </tr>`).join("");
  return `<div class="card">
    <div class="card-title">Facturas <a class="btn btn-primary btn-sm" href="/invoices/new?property_id=${p.id}">+ Subir factura</a></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Proveedor</th><th>Fecha</th><th>Categoría</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay facturas registradas todavía.")}</td></tr>`}</tbody></table></div>
  </div>`;
}

// ---------------- EXPENSES ----------------
function tabExpenses(p, companyId) {
  const rows = db.prepare(`SELECT e.*, c.name as cat_name, c.color as cat_color FROM expenses e LEFT JOIN categories c ON c.id=e.category_id
    WHERE e.company_id=? AND e.property_id=? ORDER BY e.date DESC`).all(companyId, p.id);
  const trs = rows.map((r) => `
    <tr data-row><td>${formatDate(r.date)}</td><td>${categoryBadge(r.cat_name, r.cat_color)}</td><td>${escapeHtml(r.description || "—")}</td>
    <td>${formatCurrency(r.amount)}</td><td>${actionsCell("/api/expenses/" + r.id, "¿Eliminar este gasto?")}</td></tr>`).join("");
  return `<div class="card">
    <div class="card-title">Gastos <button class="btn btn-primary btn-sm" onclick="openModal('modalExpense')">+ Añadir gasto</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Importe</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="5">${emptyState("No hay gastos manuales. Los gastos también se generan al confirmar facturas.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalExpense", title: "Añadir gasto", body: `
    <form data-api="/api/expenses" data-method="POST" data-success="Gasto añadido">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field-row"><div class="field"><label>Importe (€)</label><input type="number" step="0.01" name="amount" required></div>
      <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div></div>
      <div class="field"><label>Categoría</label><select name="category_id">${categoriesOptions(companyId)}</select></div>
      <div class="field"><label>Descripción</label><input type="text" name="description" placeholder="Opcional"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Guardar gasto</button>
    </form>` })}`;
}

// ---------------- INCOMES ----------------
function tabIncomes(p, companyId) {
  const rows = db.prepare("SELECT * FROM incomes WHERE company_id=? AND property_id=? ORDER BY date DESC").all(companyId, p.id);
  const trs = rows.map((r) => `
    <tr data-row><td>${formatDate(r.date)}</td><td><span class="badge badge-blue">${escapeHtml(r.channel)}</span></td><td>${escapeHtml(r.description || "—")}</td>
    <td>${formatCurrency(r.amount)}</td><td>${actionsCell("/api/incomes/" + r.id, "¿Eliminar este ingreso?")}</td></tr>`).join("");
  return `<div class="card">
    <div class="card-title">Ingresos <button class="btn btn-primary btn-sm" onclick="openModal('modalIncome')">+ Añadir ingreso</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Canal</th><th>Descripción</th><th>Importe</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="5">${emptyState("No hay ingresos registrados todavía.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalIncome", title: "Añadir ingreso", body: `
    <form data-api="/api/incomes" data-method="POST" data-success="Ingreso añadido">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field-row"><div class="field"><label>Importe (€)</label><input type="number" step="0.01" name="amount" required></div>
      <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div></div>
      <div class="field"><label>Canal</label><select name="channel"><option value="Airbnb">Airbnb</option><option value="Booking">Booking</option><option value="Directo">Directo</option><option value="Vrbo">Vrbo</option></select></div>
      <div class="field"><label>Descripción</label><input type="text" name="description" placeholder="Opcional"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Guardar ingreso</button>
    </form>` })}`;
}

// ---------------- CLEANINGS ----------------
function tabCleanings(p, companyId) {
  const rows = db.prepare("SELECT * FROM cleanings WHERE company_id=? AND property_id=? ORDER BY date DESC").all(companyId, p.id);
  const trs = rows.map((r) => {
    const checklist = JSON.parse(r.checklist || "[]");
    const done = checklist.filter((c) => c.done).length;
    return `<tr data-row><td>${formatDate(r.date)}</td><td>${escapeHtml(r.assignee || "Sin asignar")}</td>
    <td>${done}/${checklist.length} tareas</td><td>${statusBadge(r.status)}</td>
    <td>${actionsCell("/api/cleanings/" + r.id, "¿Eliminar esta limpieza?")}</td></tr>`;
  }).join("");
  return `<div class="card">
    <div class="card-title">Limpiezas <button class="btn btn-primary btn-sm" onclick="openModal('modalCleaning')">+ Programar limpieza</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Responsable</th><th>Checklist</th><th>Estado</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="5">${emptyState("No hay limpiezas programadas.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalCleaning", title: "Programar limpieza", body: `
    <form data-api="/api/cleanings" data-method="POST" data-success="Limpieza programada">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field"><label>Fecha</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Responsable</label><input type="text" name="assignee" value="${escapeHtml(p.cleaning_lead || "")}"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Programar</button>
    </form>` })}`;
}

// ---------------- MAINTENANCE ----------------
function tabMaintenance(p, companyId) {
  const rows = db.prepare("SELECT * FROM maintenances WHERE company_id=? AND property_id=? ORDER BY scheduled_date DESC").all(companyId, p.id);
  const trs = rows.map((r) => `
    <tr data-row><td>${escapeHtml(r.title)}</td><td>${r.type === "preventive" ? "Preventivo" : "Correctivo"}</td>
    <td>${formatDate(r.scheduled_date)}</td><td>${statusBadge(r.status)}</td><td>${formatCurrency(r.cost)}</td>
    <td class="flex gap-8">
      ${r.status !== "done" ? `<button class="btn btn-ghost btn-sm" onclick="apiCall('/api/maintenances/${r.id}','PUT',{status:'done'}).then(()=>location.reload())">Completar</button>` : ""}
      ${actionsCell("/api/maintenances/" + r.id, "¿Eliminar este mantenimiento?")}
    </td></tr>`).join("");
  return `<div class="card">
    <div class="card-title">Mantenimiento <button class="btn btn-primary btn-sm" onclick="openModal('modalMaint')">+ Nuevo mantenimiento</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Título</th><th>Tipo</th><th>Fecha</th><th>Estado</th><th>Coste</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay mantenimientos registrados.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalMaint", title: "Nuevo mantenimiento", body: `
    <form data-api="/api/maintenances" data-method="POST" data-success="Mantenimiento creado">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field"><label>Título</label><input type="text" name="title" required placeholder="Revisión caldera"></div>
      <div class="field-row">
        <div class="field"><label>Tipo</label><select name="type"><option value="corrective">Correctivo</option><option value="preventive">Preventivo</option></select></div>
        <div class="field"><label>Fecha</label><input type="date" name="scheduled_date"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Responsable</label><input type="text" name="assignee" value="${escapeHtml(p.maintenance_lead || "")}"></div>
        <div class="field"><label>Coste estimado (€)</label><input type="number" step="0.01" name="cost" value="0"></div>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Crear</button>
    </form>` })}`;
}

// ---------------- INVENTORY ----------------
function tabInventory(p, companyId) {
  const rows = db.prepare("SELECT * FROM inventory_items WHERE company_id=? AND property_id=? ORDER BY room, name").all(companyId, p.id);
  const trs = rows.map((r) => `
    <tr data-row><td>${escapeHtml(r.room)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.brand || "—")}</td>
    <td>${formatDate(r.purchase_date)}</td><td>${formatCurrency(r.cost)}</td><td>${statusBadge(r.status)}</td>
    <td>${actionsCell("/api/inventory/" + r.id, "¿Eliminar este elemento?")}</td></tr>`).join("");
  return `<div class="card">
    <div class="card-title">Inventario <button class="btn btn-primary btn-sm" onclick="openModal('modalInv')">+ Añadir elemento</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Estancia</th><th>Elemento</th><th>Marca</th><th>Compra</th><th>Coste</th><th>Estado</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="7">${emptyState("Todavía no has cargado el inventario de esta vivienda.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalInv", title: "Añadir elemento de inventario", body: `
    <form data-api="/api/inventory" data-method="POST" data-success="Elemento añadido">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field-row">
        <div class="field"><label>Estancia</label><input type="text" name="room" value="General" required></div>
        <div class="field"><label>Elemento</label><input type="text" name="name" required placeholder="Nevera"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Marca/modelo</label><input type="text" name="brand"></div>
        <div class="field"><label>Coste (€)</label><input type="number" step="0.01" name="cost" value="0"></div>
      </div>
      <div class="field"><label>Fecha de compra</label><input type="date" name="purchase_date"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Añadir</button>
    </form>` })}`;
}

// ---------------- DOCUMENTS ----------------
const DOC_TYPES = { license: "Licencia VV", insurance: "Seguro", contract: "Contrato", warranty: "Garantía", certificate: "Certificado", deed: "Escritura", manual: "Manual", other: "Otro" };
function tabDocuments(p, companyId) {
  const rows = db.prepare("SELECT * FROM documents WHERE company_id=? AND property_id=? ORDER BY expiry_date IS NULL, expiry_date ASC").all(companyId, p.id);
  const now = new Date();
  const trs = rows.map((r) => {
    let alert = "";
    if (r.expiry_date) {
      const days = Math.ceil((new Date(r.expiry_date) - now) / 86400000);
      alert = days < 0 ? `<span class="badge badge-coral">Caducado</span>` : days <= 30 ? `<span class="badge badge-coral">${days} días</span>` : days <= 60 ? `<span class="badge badge-amber">${days} días</span>` : `<span class="badge badge-teal">${days} días</span>`;
    }
    return `<tr data-row><td>${DOC_TYPES[r.type] || r.type}</td><td>${escapeHtml(r.name)}</td><td>${formatDate(r.issue_date)}</td>
    <td>${formatDate(r.expiry_date)}</td><td>${alert}</td><td>${actionsCell("/api/documents/" + r.id, "¿Eliminar este documento?")}</td></tr>`;
  }).join("");
  return `<div class="card">
    <div class="card-title">Documentación <button class="btn btn-primary btn-sm" onclick="openModal('modalDoc')">+ Añadir documento</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Tipo</th><th>Nombre</th><th>Emisión</th><th>Caducidad</th><th>Alerta</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="6">${emptyState("No hay documentación cargada.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalDoc", title: "Añadir documento", body: `
    <form data-api="/api/documents" data-method="POST" data-success="Documento añadido">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field"><label>Tipo</label><select name="type">${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div class="field"><label>Nombre</label><input type="text" name="name" required placeholder="Seguro de hogar 2026"></div>
      <div class="field-row">
        <div class="field"><label>Fecha de emisión</label><input type="date" name="issue_date"></div>
        <div class="field"><label>Fecha de caducidad</label><input type="date" name="expiry_date"></div>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Añadir</button>
    </form>` })}`;
}

// ---------------- INCIDENTS ----------------
function tabIncidents(p, companyId) {
  const rows = db.prepare("SELECT * FROM incidents WHERE company_id=? AND property_id=? ORDER BY created_at DESC").all(companyId, p.id);
  const items = db.prepare("SELECT id, name FROM inventory_items WHERE company_id=? AND property_id=?").all(companyId, p.id);
  const trs = rows.map((r) => `
    <tr data-row><td>${escapeHtml(r.title)}</td><td>${priorityBadge(r.priority)}</td><td>${statusBadge(r.status)}</td>
    <td>${formatDate(r.created_at)}</td>
    <td class="flex gap-8">
      ${r.status !== "resolved" ? `<button class="btn btn-ghost btn-sm" onclick="apiCall('/api/incidents/${r.id}','PUT',{status:'resolved'}).then(()=>location.reload())">Resolver</button>` : ""}
      ${actionsCell("/api/incidents/" + r.id, "¿Eliminar esta incidencia?")}
    </td></tr>`).join("");
  return `<div class="card">
    <div class="card-title">Incidencias <button class="btn btn-primary btn-sm" onclick="openModal('modalInc')">+ Nueva incidencia</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Título</th><th>Prioridad</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
    <tbody>${trs || `<tr><td colspan="5">${emptyState("No hay incidencias registradas. 🎉")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalInc", title: "Nueva incidencia", body: `
    <form data-api="/api/incidents" data-method="POST" data-success="Incidencia registrada">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field"><label>Título</label><input type="text" name="title" required placeholder="Nevera no enfría"></div>
      <div class="field"><label>Elemento de inventario afectado (opcional)</label>
        <select name="inventory_item_id"><option value="">— Ninguno —</option>${items.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Prioridad</label><select name="priority"><option value="normal">Normal</option><option value="high">Alta</option><option value="low">Baja</option></select></div>
      <div class="field"><label>Descripción</label><textarea name="description" placeholder="Detalles de la incidencia..."></textarea></div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Registrar</button>
    </form>` })}`;
}

// ---------------- PROFITABILITY ----------------
function tabProfitability(p, companyId) {
  const series = monthlySeries(companyId, 12, p.id);
  const profit = propertyProfitability(companyId, p.id, {});
  const byCat = db.prepare(`SELECT c.name, c.color, COALESCE(SUM(e.amount),0) total FROM categories c
    LEFT JOIN expenses e ON e.category_id=c.id AND e.property_id=? WHERE c.company_id=? GROUP BY c.id HAVING total > 0 ORDER BY total DESC`).all(p.id, companyId);
  return `
    <div class="grid grid-4 mb-16">
      <div class="card"><div class="kpi-label">Ingresos totales</div><div class="kpi-value" style="font-size:22px;">${formatCurrency(profit.income)}</div></div>
      <div class="card"><div class="kpi-label">Gastos totales</div><div class="kpi-value" style="font-size:22px;">${formatCurrency(profit.expense)}</div></div>
      <div class="card"><div class="kpi-label">Beneficio</div><div class="kpi-value" style="font-size:22px;">${formatCurrency(profit.profit)}</div></div>
      <div class="card"><div class="kpi-label">Margen</div><div class="kpi-value" style="font-size:22px;">${profit.margin.toFixed(1)}%</div></div>
    </div>
    <div class="card mb-16">
      <div class="card-title">Evolución mensual (12 meses)</div>
      <canvas id="chartProp" height="230"></canvas>
    </div>
    <div class="card">
      <div class="card-title">Gasto por categoría</div>
      <table class="data"><thead><tr><th>Categoría</th><th>Importe</th></tr></thead>
      <tbody>${byCat.map((c) => `<tr><td>${categoryBadge(c.name, c.color)}</td><td>${formatCurrency(c.total)}</td></tr>`).join("") || `<tr><td colspan="2">${emptyState("Sin gastos registrados.")}</td></tr>`}</tbody></table>
    </div>
    <script>
      new Chart(document.getElementById('chartProp'), {
        type: 'line',
        data: { labels: ${JSON.stringify(series.map((s) => s.label))},
          datasets: [
            { label: 'Ingresos', data: ${JSON.stringify(series.map((s) => s.income))}, borderColor: '#0E7C6B', backgroundColor:'rgba(14,124,107,.08)', tension:.35, fill:true },
            { label: 'Gastos', data: ${JSON.stringify(series.map((s) => s.expense))}, borderColor: '#C2452C', backgroundColor:'rgba(194,69,44,.06)', tension:.35, fill:true },
            { label: 'Beneficio', data: ${JSON.stringify(series.map((s) => s.profit))}, borderColor: '#5B7FDE', borderDash:[5,4], tension:.35 }
          ] },
        options: { plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}, scales:{y:{ticks:{callback:v=>v+' €'}}} }
      });
    </script>`;
}

// ---------------- CHANNELS (iCal) ----------------
const CHANNEL_OPTIONS = [
  ["airbnb", "Airbnb"],
  ["booking", "Booking.com"],
  ["vrbo", "Vrbo"],
  ["other", "Otro"],
];
function tabChannels(p, companyId) {
  const feeds = db.prepare("SELECT * FROM ical_feeds WHERE company_id=? AND property_id=? ORDER BY created_at DESC").all(companyId, p.id);
  const rows = feeds.map((f) => {
    let statusBadgeHtml;
    if (!f.last_synced_at) statusBadgeHtml = `<span class="badge badge-gray">Sin sincronizar</span>`;
    else if ((f.last_status || "").startsWith("error")) statusBadgeHtml = `<span class="badge badge-coral" title="${escapeHtml(f.last_status)}">Error</span>`;
    else statusBadgeHtml = `<span class="badge badge-teal">${f.events_count || 0} reservas</span>`;
    const label = { airbnb: "Airbnb", booking: "Booking.com", vrbo: "Vrbo", other: "Otro" }[f.channel] || f.channel;
    return `<tr data-row>
      <td><span class="badge badge-blue">${escapeHtml(label)}</span></td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(f.url)}">${escapeHtml(f.url)}</td>
      <td>${f.last_synced_at ? formatDateTime(f.last_synced_at) : "—"}</td>
      <td>${statusBadgeHtml}</td>
      <td class="flex gap-8">
        <button class="btn btn-ghost btn-sm" onclick="syncOneFeed('${f.id}', this)">Sincronizar</button>
        ${actionsCell("/api/ical-feeds/" + f.id, "¿Eliminar esta conexión de calendario?")}
      </td>
    </tr>`;
  }).join("");
  return `<div class="card">
    <div class="card-title">Canales conectados <button class="btn btn-primary btn-sm" onclick="openModal('modalFeed')">+ Conectar calendario</button></div>
    <p class="text-sm text-gray" style="margin-top:-6px;margin-bottom:14px;">Importa automáticamente las reservas de Airbnb, Booking o Vrbo pegando la URL de calendario (formato iCal / .ics) que cada plataforma ofrece gratis para cada anuncio. No hace falta esperar aprobación de ninguna API — solo el enlace del calendario.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Canal</th><th>URL del calendario</th><th>Última sincronización</th><th>Estado</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">${emptyState("Todavía no has conectado ningún calendario externo.")}</td></tr>`}</tbody></table></div>
  </div>
  ${modal({ id: "modalFeed", title: "Conectar calendario", body: `
    <form id="formFeed" data-api="/api/ical-feeds" data-method="POST" data-success="Calendario conectado y sincronizado">
      <input type="hidden" name="property_id" value="${p.id}">
      <div class="field"><label>Plataforma</label><select name="channel">${CHANNEL_OPTIONS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <div class="field"><label>URL del calendario (iCal / .ics)</label><input type="url" name="url" required placeholder="https://www.airbnb.com/calendar/ical/....ics"></div>
      <p class="text-sm text-gray">En Airbnb: Anuncio → Calendario → Disponibilidad → Sincronizar calendarios → Exportar calendario. En Booking: Extranet → Tarifas y disponibilidad → Sincronización de calendarios.</p>
      <button type="submit" class="btn btn-primary" style="width:100%;">Conectar y sincronizar</button>
    </form>` })}
  <script>
    async function syncOneFeed(id, btn) {
      btn.disabled = true; const orig = btn.textContent; btn.textContent = '...';
      try {
        const r = await apiCall('/api/ical-feeds/' + id + '/sync', 'POST');
        toast('Sincronizado: ' + r.created + ' nuevas, ' + r.updated + ' actualizadas');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = orig;
      }
    }
  </script>`;
}

// ---------------- HISTORY ----------------
function tabHistory(p, companyId) {
  const rows = db.prepare(`
    SELECT 'Factura' as kind, provider_name || ' — ' || CAST(amount as TEXT) || ' €' as label, created_at FROM invoices WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'Gasto', description || ' — ' || CAST(amount as TEXT) || ' €', created_at FROM expenses WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'Ingreso', channel || ' — ' || CAST(amount as TEXT) || ' €', created_at FROM incomes WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'Limpieza', 'Limpieza · ' || COALESCE(assignee,'sin asignar') || ' (' || status || ')', created_at FROM cleanings WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'Mantenimiento', title || ' (' || status || ')', created_at FROM maintenances WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'Incidencia', title || ' (' || status || ')', created_at FROM incidents WHERE company_id=? AND property_id=?
    UNION ALL SELECT 'Documento', name, created_at FROM documents WHERE company_id=? AND property_id=?
    ORDER BY created_at DESC LIMIT 100
  `).all(companyId, p.id, companyId, p.id, companyId, p.id, companyId, p.id, companyId, p.id, companyId, p.id, companyId, p.id);
  const trs = rows.map((r) => `<tr><td><span class="badge badge-gray">${r.kind}</span></td><td>${escapeHtml(r.label || "")}</td><td class="text-gray text-sm">${formatDateTime(r.created_at)}</td></tr>`).join("");
  return `<div class="card"><div class="card-title">Historial completo</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Tipo</th><th>Detalle</th><th>Fecha</th></tr></thead>
    <tbody>${trs || `<tr><td colspan="3">${emptyState("Sin actividad todavía.")}</td></tr>`}</tbody></table></div></div>`;
}

module.exports = function renderTab(tab, p, companyId) {
  switch (tab) {
    case "invoices": return tabInvoices(p, companyId);
    case "expenses": return tabExpenses(p, companyId);
    case "incomes": return tabIncomes(p, companyId);
    case "cleanings": return tabCleanings(p, companyId);
    case "maintenance": return tabMaintenance(p, companyId);
    case "inventory": return tabInventory(p, companyId);
    case "documents": return tabDocuments(p, companyId);
    case "incidents": return tabIncidents(p, companyId);
    case "profitability": return tabProfitability(p, companyId);
    case "history": return tabHistory(p, companyId);
    case "channels": return tabChannels(p, companyId);
    default: return tabResumen(p, companyId);
  }
};
