const db = require("../db");
const { layout } = require("../render");
const { requirePage, sendHtml } = require("../guard");
const { escapeHtml, formatDate, formatCurrency } = require("../utils");
const { statusBadge, priorityBadge, categoryBadge, emptyState, modal } = require("../components");
const { propertyProfitability, monthlySeries } = require("../queries");

const TYPE_LABELS = { apartment: "Apartamento", villa: "Villa", house: "Casa", studio: "Estudio" };

function propertyCard(p, profit) {
  return `<a class="prop-card" href="/properties/${p.id}" style="display:block;">
    <div class="prop-cover" style="background:linear-gradient(135deg, ${p.cover_color}, ${p.cover_color}CC);">${escapeHtml(p.name)}</div>
    <div class="prop-body">
      <div class="addr">${escapeHtml(p.city || "")} · ${TYPE_LABELS[p.type] || p.type}</div>
      <div class="prop-stats">
        <span>👥 <strong>${p.capacity}</strong></span>
        <span>🛏 <strong>${p.bedrooms}</strong></span>
        <span>🛁 <strong>${p.bathrooms}</strong></span>
      </div>
      <div class="divider" style="margin:10px 0;"></div>
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray">Beneficio (mes)</span>
        <strong style="color:${profit.profit >= 0 ? "#0E7C6B" : "#C2452C"}">${formatCurrency(profit.profit)}</strong>
      </div>
    </div>
  </a>`;
}

function createModal() {
  return modal({
    id: "modalNewProperty",
    title: "Nueva propiedad",
    body: `<form id="formNewProperty" data-api="/api/properties" data-method="POST" data-redirect="/properties/{id}" data-success="Propiedad creada">
      <div class="field"><label>Nombre</label><input type="text" name="name" required placeholder="Villa Atlántico 5"></div>
      <div class="field-row">
        <div class="field"><label>Dirección</label><input type="text" name="address" placeholder="Calle..."></div>
        <div class="field"><label>Municipio</label><input type="text" name="city" placeholder="San Bartolomé de Tirajana"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Tipo</label><select name="type"><option value="apartment">Apartamento</option><option value="villa">Villa</option><option value="house">Casa</option><option value="studio">Estudio</option></select></div>
        <div class="field"><label>Nº licencia VV</label><input type="text" name="license_number" placeholder="VV-35-XXXXXX"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Capacidad</label><input type="number" name="capacity" value="4" min="1"></div>
        <div class="field"><label>Dormitorios</label><input type="number" name="bedrooms" value="2" min="0"></div>
        <div class="field"><label>Baños</label><input type="number" name="bathrooms" value="1" min="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Responsable limpieza</label><input type="text" name="cleaning_lead" placeholder="María Suárez"></div>
        <div class="field"><label>Responsable mantenimiento</label><input type="text" name="maintenance_lead" placeholder="Luis Hernández"></div>
      </div>
      <div class="field"><label>Canales de venta</label><input type="text" name="channels" placeholder="Airbnb, Booking, Directo"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Crear propiedad</button>
    </form>`,
  });
}

module.exports = ({ get }) => {
  get("/properties", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const props = db.prepare("SELECT * FROM properties WHERE company_id = ? AND status='active' ORDER BY created_at DESC").all(companyId);
    const cards = props.map((p) => propertyCard(p, propertyProfitability(companyId, p.id, require("../queries").monthBounds(0)))).join("");
    const content = `
      ${props.length ? `<div class="grid grid-3">${cards}</div>` : emptyState("Todavía no tienes propiedades. Crea la primera para empezar.")}
      ${createModal()}
    `;
    sendHtml(res, 200, layout({
      title: "Propiedades", subtitle: `${props.length} viviendas gestionadas`,
      active: "properties", user: req.session.user, company: req.session.company,
      actions: `<button class="btn btn-primary" onclick="openModal('modalNewProperty')">+ Nueva propiedad</button>`,
      content,
    }));
  }));

  get("/properties/:id", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const p = db.prepare("SELECT * FROM properties WHERE id = ? AND company_id = ?").get(req.params.id, companyId);
    if (!p) { res.writeHead(404); return res.end("Propiedad no encontrada"); }
    const tab = req.query.tab || "resumen";
    const tabs = [
      ["resumen", "Resumen"], ["invoices", "Facturas"], ["expenses", "Gastos"], ["incomes", "Ingresos"],
      ["cleanings", "Limpiezas"], ["maintenance", "Mantenimiento"], ["inventory", "Inventario"],
      ["documents", "Documentación"], ["incidents", "Incidencias"], ["profitability", "Rentabilidad"], ["history", "Historial"],
    ];
    const tabNav = tabs.map(([k, label]) => `<a class="tab ${tab === k ? "active" : ""}" href="/properties/${p.id}?tab=${k}">${label}</a>`).join("");

    const renderTab = require("../property_tabs");
    const tabContent = renderTab(tab, p, companyId);

    const content = `
      <div class="card mb-16">
        <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px;">
          <div>
            <div class="text-sm text-gray">${escapeHtml(p.city || "")} · ${escapeHtml(p.license_number || "Sin licencia registrada")}</div>
            <div class="flex gap-12 mt-8">
              <span class="text-sm">👥 <strong>${p.capacity}</strong> huéspedes</span>
              <span class="text-sm">🛏 <strong>${p.bedrooms}</strong> hab.</span>
              <span class="text-sm">🛁 <strong>${p.bathrooms}</strong> baños</span>
              <span class="text-sm">📡 ${escapeHtml(p.channels || "—")}</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openModal('modalEditProperty')">Editar ficha</button>
        </div>
      </div>
      <div class="tabs">${tabNav}</div>
      <div>${tabContent}</div>
      ${modal({
        id: "modalEditProperty", title: "Editar propiedad",
        body: `<form data-api="/api/properties/${p.id}" data-method="PUT" data-success="Propiedad actualizada">
          <div class="field"><label>Nombre</label><input type="text" name="name" value="${escapeHtml(p.name)}" required></div>
          <div class="field-row">
            <div class="field"><label>Dirección</label><input type="text" name="address" value="${escapeHtml(p.address || "")}"></div>
            <div class="field"><label>Municipio</label><input type="text" name="city" value="${escapeHtml(p.city || "")}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Nº licencia VV</label><input type="text" name="license_number" value="${escapeHtml(p.license_number || "")}"></div>
            <div class="field"><label>Canales</label><input type="text" name="channels" value="${escapeHtml(p.channels || "")}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Responsable limpieza</label><input type="text" name="cleaning_lead" value="${escapeHtml(p.cleaning_lead || "")}"></div>
            <div class="field"><label>Responsable mantenimiento</label><input type="text" name="maintenance_lead" value="${escapeHtml(p.maintenance_lead || "")}"></div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;">Guardar cambios</button>
        </form>`,
      })}
    `;

    sendHtml(res, 200, layout({
      title: p.name, subtitle: "Propiedades / " + escapeHtml(p.name),
      active: "properties", user: req.session.user, company: req.session.company,
      actions: `<a class="btn btn-primary" href="/invoices/new?property_id=${p.id}">+ Subir factura</a>`,
      content,
    }));
  }));
};
