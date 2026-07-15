const db = require("../db");
const { layout } = require("../render");
const { requirePage, sendHtml } = require("../guard");
const { escapeHtml, formatDate, formatDateTime } = require("../utils");
const { emptyState, modal } = require("../components");
const { initials } = require("../render");

module.exports = ({ get }) => {
  get("/settings", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const company = req.session.company;
    const users = db.prepare("SELECT * FROM users WHERE company_id=? ORDER BY created_at").all(companyId);
    const categories = db.prepare("SELECT * FROM categories WHERE company_id=? ORDER BY name").all(companyId);
    const tab = req.query.tab || "company";

    const tabNav = [
      ["company", "Empresa"], ["users", "Usuarios y roles"], ["categories", "Categorías"], ["integrations", "Integraciones"],
    ].map(([k, label]) => `<a class="tab ${tab === k ? "active" : ""}" href="/settings?tab=${k}">${label}</a>`).join("");

    let body = "";
    if (tab === "company") {
      body = `<div class="card" style="max-width:560px;">
        <div class="card-title">Datos de la empresa</div>
        <div class="field"><label>Nombre</label><input type="text" value="${escapeHtml(company.name)}" disabled></div>
        <div class="field-row">
          <div class="field"><label>CIF</label><input type="text" value="${escapeHtml(company.cif || "—")}" disabled></div>
          <div class="field"><label>Región fiscal</label><input type="text" value="${company.tax_region === "canarias" ? "Canarias" : "Península/Baleares"}" disabled></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Impuesto aplicado</label><input type="text" value="${company.tax_label} (${company.tax_rate}%)" disabled></div>
          <div class="field"><label>Plan</label><input type="text" value="${company.plan === "trial" ? "Prueba gratuita" : company.plan === "growth" ? "Growth" : company.plan}" disabled></div>
        </div>
        <p class="text-sm text-gray mt-16">La edición de datos fiscales estará disponible próximamente. Contacta con soporte para modificarlos mientras tanto.</p>
      </div>`;
    } else if (tab === "users") {
      const rows = users.map((u) => `<tr data-row>
        <td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:11px;">${initials(u.name)}</div>${escapeHtml(u.name)}</div></td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge badge-teal">${u.role === "admin" ? "Administrador" : u.role === "field" ? "Empleado de campo" : u.role}</span></td>
        <td>${u.id !== req.session.user.id ? `<button class="btn btn-ghost btn-sm" data-delete="/api/users/${u.id}" data-confirm="¿Eliminar este usuario?">✕</button>` : `<span class="text-gray text-sm">Tú</span>`}</td>
      </tr>`).join("");
      body = `<div class="card"><div class="card-title">Usuarios <button class="btn btn-primary btn-sm" onclick="openModal('mUser')">+ Invitar usuario</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>
        ${modal({ id: "mUser", title: "Invitar usuario", body: `<form data-api="/api/users" data-method="POST" data-success="Usuario invitado">
          <div class="field"><label>Nombre</label><input type="text" name="name" required></div>
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
          <div class="field"><label>Contraseña temporal</label><input type="text" name="password" value="estia1234" required></div>
          <div class="field"><label>Rol</label><select name="role">
            <option value="admin">Administrador</option>
            <option value="manager">Gerente</option>
            <option value="accountant">Contable</option>
            <option value="cleaning">Responsable de limpieza</option>
            <option value="maintenance">Responsable de mantenimiento</option>
            <option value="field" selected>Empleado de campo</option>
          </select></div>
          <button type="submit" class="btn btn-primary" style="width:100%;">Invitar</button></form>` })}`;
    } else if (tab === "categories") {
      const rows = categories.map((c) => `<tr><td><span class="dot" style="background:${c.color};display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:8px;"></span>${escapeHtml(c.name)}</td></tr>`).join("");
      body = `<div class="card"><div class="card-title">Categorías de gasto <button class="btn btn-primary btn-sm" onclick="openModal('mCat')">+ Nueva categoría</button></div>
        <table class="data"><tbody>${rows}</tbody></table></div>
        ${modal({ id: "mCat", title: "Nueva categoría", body: `<form data-api="/api/categories" data-method="POST" data-success="Categoría creada">
          <div class="field"><label>Nombre</label><input type="text" name="name" required></div>
          <div class="field"><label>Color</label><input type="color" name="color" value="#0E7C6B"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;">Crear</button></form>` })}`;
    } else if (tab === "integrations") {
      const feeds = db.prepare(`SELECT f.*, p.name as pname FROM ical_feeds f JOIN properties p ON p.id=f.property_id WHERE f.company_id=? ORDER BY f.created_at DESC`).all(companyId);
      const feedLabel = { airbnb: "Airbnb", booking: "Booking.com", vrbo: "Vrbo", other: "Otro" };
      const feedRows = feeds.map((f) => `<tr>
        <td><span class="badge badge-blue">${feedLabel[f.channel] || f.channel}</span></td>
        <td><a class="row-link" href="/properties/${f.property_id}?tab=channels">${escapeHtml(f.pname)}</a></td>
        <td>${f.last_synced_at ? formatDateTime(f.last_synced_at) : "Sin sincronizar"}</td>
        <td>${(f.last_status || "").startsWith("error") ? `<span class="badge badge-coral">Error</span>` : f.last_synced_at ? `<span class="badge badge-teal">${f.events_count || 0} reservas</span>` : `<span class="badge badge-gray">Pendiente</span>`}</td>
      </tr>`).join("");

      const otherIntegrations = [
        ["Google Calendar", "Exporta el calendario operativo"],
        ["Google Drive / Dropbox", "Copia de seguridad de documentación"],
        ["Holded / Quipu", "Exportación contable (España)"],
        ["QuickBooks / Xero", "Exportación contable (internacional)"],
        ["Stripe", "Cobro de suscripción y pagos"],
      ];

      body = `
        <div class="card mb-16">
          <div class="card-title">Airbnb, Booking.com y Vrbo <span class="badge badge-teal">Disponible</span></div>
          <p class="text-sm text-gray" style="margin-top:-4px;">Conecta el calendario de cada vivienda desde su propia ficha (pestaña "Canales"). Se importan las reservas automáticamente vía iCal, sin coste y sin esperar aprobación de ninguna plataforma. Aquí puedes ver el estado de todas tus conexiones.</p>
          ${feeds.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Canal</th><th>Vivienda</th><th>Última sincronización</th><th>Estado</th></tr></thead><tbody>${feedRows}</tbody></table></div>`
            : emptyState("Todavía no has conectado ningún calendario. Ve a la ficha de una vivienda → pestaña Canales.")}
        </div>
        <div class="grid grid-2">${otherIntegrations.map(([name, desc]) => `
          <div class="card flex justify-between items-center">
            <div><strong>${name}</strong><div class="text-sm text-gray">${desc}</div></div>
            <button class="btn btn-secondary btn-sm" disabled>Próximamente</button>
          </div>`).join("")}</div>`;
    }

    sendHtml(res, 200, layout({
      title: "Configuración", subtitle: "Empresa, usuarios, categorías e integraciones",
      active: "settings", user: req.session.user, company: req.session.company,
      content: `<div class="tabs">${tabNav}</div>${body}`,
    }));
  }));
};
