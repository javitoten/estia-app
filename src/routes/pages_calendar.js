const db = require("../db");
const { layout } = require("../render");
const { requirePage, sendHtml } = require("../guard");
const { escapeHtml } = require("../utils");

const WEEKDAYS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const EVENT_COLORS = {
  checkin: "#0E7C6B", checkout: "#6FBFAE", cleaning: "#E9B44C",
  maintenance_c: "#C2452C", maintenance_p: "#9B7FE8", document: "#F0C43C",
};

function pad(n) { return String(n).padStart(2, "0"); }
function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

module.exports = ({ get }) => {
  get("/calendar", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const now = new Date();
    let year = Number(req.query.y) || now.getFullYear();
    let month = req.query.m !== undefined ? Number(req.query.m) : now.getMonth();
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }

    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday = 0
    const gridStart = new Date(year, month, 1 - startOffset);
    const daysInGrid = 42;
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + daysInGrid - 1);

    const events = {};
    function pushEvent(dateStr, label, type) {
      if (!events[dateStr]) events[dateStr] = [];
      events[dateStr].push({ label, type });
    }

    const s = iso(gridStart), e = iso(gridEnd);
    db.prepare("SELECT r.*, p.name as pname FROM reservations r JOIN properties p ON p.id=r.property_id WHERE r.company_id=? AND r.checkin BETWEEN ? AND ?").all(companyId, s, e)
      .forEach((r) => pushEvent(r.checkin, "Check-in · " + r.pname, "checkin"));
    db.prepare("SELECT r.*, p.name as pname FROM reservations r JOIN properties p ON p.id=r.property_id WHERE r.company_id=? AND r.checkout BETWEEN ? AND ?").all(companyId, s, e)
      .forEach((r) => pushEvent(r.checkout, "Check-out · " + r.pname, "checkout"));
    db.prepare("SELECT c.*, p.name as pname FROM cleanings c JOIN properties p ON p.id=c.property_id WHERE c.company_id=? AND c.date BETWEEN ? AND ?").all(companyId, s, e)
      .forEach((c) => pushEvent(c.date, "Limpieza · " + c.pname, "cleaning"));
    db.prepare("SELECT m.*, p.name as pname FROM maintenances m JOIN properties p ON p.id=m.property_id WHERE m.company_id=? AND m.scheduled_date BETWEEN ? AND ?").all(companyId, s, e)
      .forEach((m) => pushEvent(m.scheduled_date, (m.type === "preventive" ? "Revisión · " : "Reparación · ") + m.pname, m.type === "preventive" ? "maintenance_p" : "maintenance_c"));
    db.prepare("SELECT d.*, p.name as pname FROM documents d JOIN properties p ON p.id=d.property_id WHERE d.company_id=? AND d.expiry_date BETWEEN ? AND ?").all(companyId, s, e)
      .forEach((d) => pushEvent(d.expiry_date, "Vence: " + d.name + " · " + d.pname, "document"));

    const todayIso = iso(new Date());
    let cells = "";
    for (let i = 0; i < daysInGrid; i++) {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const dIso = iso(d);
      const inMonth = d.getMonth() === month;
      const evs = (events[dIso] || []).slice(0, 4);
      const more = (events[dIso] || []).length - evs.length;
      cells += `<div class="calendar-cell ${inMonth ? "" : "muted"} ${dIso === todayIso ? "today" : ""}">
        <div class="calendar-daynum">${d.getDate()}</div>
        ${evs.map((ev) => `<div class="cal-event" style="background:${EVENT_COLORS[ev.type]}" title="${escapeHtml(ev.label)}">${escapeHtml(ev.label)}</div>`).join("")}
        ${more > 0 ? `<div class="text-gray" style="font-size:10px;">+${more} más</div>` : ""}
      </div>`;
    }

    const monthLabel = first.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    const prevM = month - 1, nextM = month + 1;
    const content = `
      <div class="flex justify-between items-center mb-16">
        <div class="flex gap-8">
          <a class="btn btn-secondary btn-sm" href="/calendar?y=${prevM < 0 ? year - 1 : year}&m=${(prevM + 12) % 12}">‹</a>
          <div class="btn btn-secondary btn-sm" style="pointer-events:none;text-transform:capitalize;">${monthLabel}</div>
          <a class="btn btn-secondary btn-sm" href="/calendar?y=${nextM > 11 ? year + 1 : year}&m=${nextM % 12}">›</a>
        </div>
        <a class="btn btn-secondary btn-sm" href="/calendar">Hoy</a>
      </div>
      <div class="calendar-grid">
        ${WEEKDAYS.map((w) => `<div class="calendar-head">${w}</div>`).join("")}
        ${cells}
      </div>
      <div class="legend">
        <div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS.checkin}"></span>Entradas</div>
        <div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS.checkout}"></span>Salidas</div>
        <div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS.cleaning}"></span>Limpiezas</div>
        <div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS.maintenance_c}"></span>Reparaciones</div>
        <div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS.maintenance_p}"></span>Revisiones</div>
        <div class="legend-item"><span class="legend-dot" style="background:${EVENT_COLORS.document}"></span>Vencimientos</div>
      </div>`;

    sendHtml(res, 200, layout({
      title: "Calendario", subtitle: "Vista unificada de toda la operación",
      active: "calendar", user: req.session.user, company: req.session.company,
      content,
    }));
  }));
};
