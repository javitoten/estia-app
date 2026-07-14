const { formatCurrency, escapeHtml } = require("./utils");

function kpiCard({ label, value, delta = null, dark = false }) {
  let deltaHtml = "";
  if (delta !== null && !isNaN(delta)) {
    const up = delta >= 0;
    deltaHtml = `<div class="kpi-delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}% vs mes anterior</div>`;
  }
  return `<div class="card ${dark ? "kpi-dark" : ""}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${deltaHtml}
  </div>`;
}

const STATUS_BADGES = {
  pending_review: ["badge-amber", "Por revisar"],
  confirmed: ["badge-teal", "Confirmada"],
  open: ["badge-coral", "Abierta"],
  in_progress: ["badge-amber", "En curso"],
  resolved: ["badge-teal", "Resuelta"],
  done: ["badge-teal", "Completada"],
  pending: ["badge-amber", "Pendiente"],
  scheduled: ["badge-blue", "Programado"],
  active: ["badge-teal", "Activa"],
  archived: ["badge-gray", "Archivada"],
  good: ["badge-teal", "Correcto"],
  broken: ["badge-coral", "Averiado"],
  replaced: ["badge-gray", "Reemplazado"],
};
function statusBadge(status) {
  const [cls, label] = STATUS_BADGES[status] || ["badge-gray", status];
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function priorityBadge(p) {
  const map = { high: ["badge-coral", "Alta"], normal: ["badge-amber", "Normal"], low: ["badge-gray", "Baja"] };
  const [cls, label] = map[p] || map.normal;
  return `<span class="badge ${cls}">${label}</span>`;
}

function categoryBadge(name, color) {
  if (!name) return `<span class="badge badge-gray">Sin categoría</span>`;
  return `<span class="badge" style="background:${color}22;color:${color}"><span class="dot" style="background:${color}"></span>${escapeHtml(name)}</span>`;
}

function emptyState(msg, iconSvg = "") {
  return `<div class="empty">${iconSvg}<p>${escapeHtml(msg)}</p></div>`;
}

function modal({ id, title, body, footer }) {
  return `<div class="modal-overlay" id="${id}">
    <div class="modal">
      <div class="modal-header"><h3>${escapeHtml(title)}</h3><button class="close-x" onclick="closeModal('${id}')">✕</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ""}
    </div>
  </div>`;
}

module.exports = { kpiCard, statusBadge, priorityBadge, categoryBadge, emptyState, modal, formatCurrency };
