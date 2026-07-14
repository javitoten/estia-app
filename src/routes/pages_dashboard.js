const db = require("../db");
const { layout } = require("../render");
const { requirePage, sendHtml } = require("../guard");
const { dashboardKpis, allPropertiesRanked, monthlySeries, upcomingDocumentAlerts } = require("../queries");
const { kpiCard, statusBadge, priorityBadge, formatCurrency, emptyState } = require("../components");
const { escapeHtml, formatDate } = require("../utils");

module.exports = ({ get }) => {
  get("/dashboard", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const k = dashboardKpis(companyId);
    const ranked = allPropertiesRanked(companyId);
    const series = monthlySeries(companyId, 6);

    const cleaningsToday = db.prepare(`SELECT c.*, p.name as property_name FROM cleanings c JOIN properties p ON p.id=c.property_id
      WHERE c.company_id = ? AND c.date = date('now') ORDER BY c.status`).all(companyId);
    const openIncidents = db.prepare(`SELECT i.*, p.name as property_name FROM incidents i JOIN properties p ON p.id=i.property_id
      WHERE i.company_id = ? AND i.status != 'resolved' ORDER BY i.priority DESC, i.created_at DESC LIMIT 6`).all(companyId);
    const docAlerts = upcomingDocumentAlerts(companyId, 60).slice(0, 4);

    const rankRows = ranked.map((r) => `
      <tr data-row>
        <td><a class="row-link" href="/properties/${r.property.id}">${escapeHtml(r.property.name)}</a></td>
        <td>${formatCurrency(r.income)}</td>
        <td>${formatCurrency(r.expense)}</td>
        <td><strong>${formatCurrency(r.profit)}</strong></td>
        <td style="color:${r.margin >= 60 ? "#0E7C6B" : r.margin >= 30 ? "#92650B" : "#C2452C"}"><strong>${r.margin.toFixed(1)}%</strong></td>
      </tr>`).join("");

    const cleaningRows = cleaningsToday.length ? cleaningsToday.map((c) => `
      <div class="flex justify-between items-center" style="padding:9px 0;border-bottom:1px solid #F0F1F3;">
        <div><strong style="font-size:13px;">${escapeHtml(c.property_name)}</strong><div class="text-gray text-sm">${escapeHtml(c.assignee || "Sin asignar")}</div></div>
        ${statusBadge(c.status)}
      </div>`).join("") : emptyState("No hay limpiezas programadas para hoy.");

    const incidentRows = openIncidents.length ? openIncidents.map((i) => `
      <div class="flex justify-between items-center" style="padding:9px 0;border-bottom:1px solid #F0F1F3;">
        <div><strong style="font-size:13px;">${escapeHtml(i.title)}</strong><div class="text-gray text-sm">${escapeHtml(i.property_name)}</div></div>
        ${priorityBadge(i.priority)}
      </div>`).join("") : emptyState("No hay incidencias abiertas. 🎉");

    const alertRows = docAlerts.length ? docAlerts.map((d) => `
      <div class="flex justify-between items-center" style="padding:9px 0;border-bottom:1px solid #F0F1F3;">
        <div><strong style="font-size:13px;">${escapeHtml(d.name)}</strong><div class="text-gray text-sm">${escapeHtml(d.property_name)}</div></div>
        <span class="badge ${d.daysLeft <= 15 ? "badge-coral" : "badge-amber"}">${d.daysLeft} días</span>
      </div>`).join("") : emptyState("Ningún documento caduca próximamente.");

    const content = `
    <div class="grid grid-4 mb-16">
      ${kpiCard({ label: "Ingresos del mes", value: formatCurrency(k.income), delta: k.incomeDelta })}
      ${kpiCard({ label: "Gastos del mes", value: formatCurrency(k.expense), delta: k.expenseDelta })}
      ${kpiCard({ label: "Beneficio neto", value: formatCurrency(k.profit) })}
      ${kpiCard({ label: "Facturas pendientes", value: k.pendingInvoices, dark: true })}
    </div>
    <div class="grid grid-4 mb-16">
      <div class="card"><div class="kpi-label">Incidencias abiertas</div><div class="kpi-value">${k.openIncidents}</div></div>
      <div class="card"><div class="kpi-label">Limpiezas de hoy</div><div class="kpi-value">${k.cleaningsToday}</div></div>
      <div class="card"><div class="kpi-label">Mantenimientos pendientes</div><div class="kpi-value">${k.pendingMaintenance}</div></div>
      <div class="card"><div class="kpi-label">Viviendas activas</div><div class="kpi-value">${ranked.length}</div></div>
    </div>

    <div class="grid grid-2 mb-16" style="grid-template-columns: 1.4fr 1fr;">
      <div class="card">
        <div class="card-title">Ingresos vs Gastos · últimos 6 meses</div>
        <canvas id="chartMain" height="240"></canvas>
      </div>
      <div class="card">
        <div class="card-title">Distribución de gasto por categoría</div>
        <canvas id="chartCat" height="240"></canvas>
      </div>
    </div>

    <div class="grid grid-3 mb-16">
      <div class="card"><div class="card-title">Limpiezas de hoy <a class="link" href="/cleanings">Ver todas</a></div>${cleaningRows}</div>
      <div class="card"><div class="card-title">Incidencias abiertas <a class="link" href="/incidents">Ver todas</a></div>${incidentRows}</div>
      <div class="card"><div class="card-title">Documentos por caducar <a class="link" href="/documents">Ver todos</a></div>${alertRows}</div>
    </div>

    <div class="card">
      <div class="card-title">Rentabilidad por propiedad · este mes <a class="link" href="/profitability">Ver detalle</a></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Propiedad</th><th>Ingresos</th><th>Gastos</th><th>Beneficio</th><th>Margen</th></tr></thead>
          <tbody>${rankRows || `<tr><td colspan="5">${emptyState("Aún no hay propiedades con datos.")}</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <script>
      const seriesData = ${JSON.stringify(series)};
      new Chart(document.getElementById('chartMain'), {
        type: 'line',
        data: {
          labels: seriesData.map(s => s.label),
          datasets: [
            { label: 'Ingresos', data: seriesData.map(s => s.income), borderColor: '#0E7C6B', backgroundColor: 'rgba(14,124,107,0.08)', tension: 0.35, fill: true },
            { label: 'Gastos', data: seriesData.map(s => s.expense), borderColor: '#C2452C', backgroundColor: 'rgba(194,69,44,0.06)', tension: 0.35, fill: true },
          ]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { y: { ticks: { callback: v => v + ' €' } } } }
      });
      const catData = ${JSON.stringify((require("../queries").expensesByCategory(companyId)).slice(0, 7))};
      new Chart(document.getElementById('chartCat'), {
        type: 'doughnut',
        data: { labels: catData.map(c => c.name), datasets: [{ data: catData.map(c => c.total), backgroundColor: catData.map(c => c.color) }] },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10.5 } } } }, cutout: '65%' }
      });
    </script>`;

    sendHtml(res, 200, layout({
      title: `Buenos días, ${req.session.user.name.split(" ")[0]}`,
      subtitle: new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ` · ${ranked.length} propiedades activas`,
      active: "dashboard", user: req.session.user, company: req.session.company,
      actions: `<a class="btn btn-primary" href="/invoices/new">+ Subir factura</a>`,
      content,
    }));
  }));
};
