const { icon } = require("./icons");
const { escapeHtml } = require("./utils");

const NAV = [
  { section: "General", items: [
    { href: "/dashboard", label: "Dashboard", icon: "grid", key: "dashboard" },
    { href: "/properties", label: "Propiedades", icon: "home", key: "properties" },
    { href: "/calendar", label: "Calendario", icon: "calendar", key: "calendar" },
  ]},
  { section: "Financiero", items: [
    { href: "/invoices", label: "Facturas", icon: "invoice", key: "invoices" },
    { href: "/expenses", label: "Gastos", icon: "trendDown", key: "expenses" },
    { href: "/incomes", label: "Ingresos", icon: "trendUp", key: "incomes" },
    { href: "/profitability", label: "Rentabilidad", icon: "chart", key: "profitability" },
  ]},
  { section: "Operación", items: [
    { href: "/cleanings", label: "Limpiezas", icon: "spray", key: "cleanings" },
    { href: "/maintenance", label: "Mantenimiento", icon: "wrench", key: "maintenance" },
    { href: "/inventory", label: "Inventario", icon: "box", key: "inventory" },
    { href: "/documents", label: "Documentación", icon: "folder", key: "documents" },
    { href: "/incidents", label: "Incidencias", icon: "alert", key: "incidents" },
  ]},
  { section: "Cuenta", items: [
    { href: "/settings", label: "Configuración", icon: "settings", key: "settings" },
  ]},
];

const MOBILE_NAV = [
  { href: "/dashboard", label: "Inicio", icon: "grid", key: "dashboard" },
  { href: "/properties", label: "Viviendas", icon: "home", key: "properties" },
  { href: "/invoices", label: "Facturas", icon: "invoice", key: "invoices" },
  { href: "/calendar", label: "Calendario", icon: "calendar", key: "calendar" },
  { href: "/settings", label: "Ajustes", icon: "settings", key: "settings" },
];

function initials(name) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}

function layout({ title, subtitle, active, user, company, content, actions = "", wide = true }) {
  const sidebarHtml = NAV.map((sec) => `
    <div class="sidebar-section-label">${sec.section}</div>
    ${sec.items.map((it) => `
      <a class="sidebar-link ${active === it.key ? "active" : ""}" href="${it.href}">
        ${icon(it.icon)}<span>${it.label}</span>
      </a>`).join("")}
  `).join("");

  const mobileNavHtml = MOBILE_NAV.map((it) => `
    <a href="${it.href}" class="${active === it.key ? "active" : ""}">${icon(it.icon, 20)}<span>${it.label}</span></a>
  `).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escapeHtml(title)} · Estia</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<link rel="stylesheet" href="/css/app.css">
</head>
<body>
<div class="sidebar-backdrop" id="sidebarBackdrop"></div>
<div class="app-shell">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-brand"><span class="logo-dot"></span><span class="name">Estia</span></div>
    <div class="sidebar-tagline">Vacation Property OS</div>
    <nav class="sidebar-nav">${sidebarHtml}</nav>
    <div class="sidebar-footer">
      <a class="sidebar-user" href="/settings">
        <div class="avatar">${initials(user ? user.name : "")}</div>
        <div class="who"><strong>${escapeHtml(user ? user.name : "")}</strong><span>${escapeHtml(company ? company.name : "")}</span></div>
      </a>
      <a class="sidebar-link" href="/logout" style="margin-top:4px;">${icon("logout")}<span>Cerrar sesión</span></a>
    </div>
  </aside>
  <div class="main">
    <div class="topbar">
      <div class="flex items-center gap-12">
        <button class="mobile-menu-btn" id="menuBtn">${icon("menu", 22)}</button>
        <div>
          <h1>${escapeHtml(title)}</h1>
          ${subtitle ? `<div class="sub">${subtitle}</div>` : ""}
        </div>
      </div>
      <div class="topbar-actions">${actions}</div>
    </div>
    <div class="content" style="${wide ? "" : "max-width:900px;"}">
      ${content}
    </div>
  </div>
</div>
<div class="mobile-bottom-nav">${mobileNavHtml}</div>

<button class="ai-fab" id="aiFab" title="Asistente Estia">${icon("sparkles", 22)}</button>
<div class="ai-panel" id="aiPanel">
  <div class="ai-header">
    <div class="flex items-center gap-8"><strong>Asistente Estia</strong></div>
    <button class="close-x" id="aiClose">${icon("close", 18)}</button>
  </div>
  <div class="ai-messages" id="aiMessages">
    <div class="ai-msg bot">Hola${user ? ", " + escapeHtml(user.name.split(" ")[0]) : ""} 👋 Pregúntame lo que quieras sobre tu cartera: rentabilidad, gastos, proveedores, licencias que caducan…</div>
  </div>
  <div class="ai-suggestions" id="aiSuggestions">
    <button class="ai-suggestion">¿Cuál ha sido el apartamento más rentable este año?</button>
    <button class="ai-suggestion">¿Cuánto he gastado en reparaciones?</button>
    <button class="ai-suggestion">¿Qué licencias caducan pronto?</button>
    <button class="ai-suggestion">Resumen financiero del mes pasado</button>
  </div>
  <div class="ai-input-row">
    <input type="text" id="aiInput" placeholder="Escribe tu pregunta…">
    <button class="btn btn-primary btn-sm" id="aiSend">${icon("arrowRight", 15)}</button>
  </div>
</div>

<div id="toast"></div>
<script src="/js/app.js"></script>
</body>
</html>`;
}

function authLayout({ title, content }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Estia</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/app.css">
</head>
<body>
<div class="auth-wrap">${content}</div>
</body>
</html>`;
}

module.exports = { layout, authLayout, initials };
