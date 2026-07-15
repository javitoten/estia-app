const db = require("../db");
const { uuid, parseBody, formatCurrency } = require("../utils");
const { requireApi, sendJson } = require("../guard");
const { allPropertiesRanked, sumExpenses, monthBounds, upcomingDocumentAlerts } = require("../queries");

function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function monthsBack(text) {
  const m = text.match(/(\d+)\s*mes/);
  return m ? Number(m[1]) : 6;
}

function findCategory(companyId, text) {
  const cats = db.prepare("SELECT * FROM categories WHERE company_id = ?").all(companyId);
  const t = norm(text);
  return cats.find((c) => t.includes(norm(c.name).split("/")[0])) || null;
}

function answerQuestion(companyId, question) {
  const t = norm(question);

  if ((t.includes("mas rentable") || t.includes("mejor propiedad") || t.includes("mas beneficio")) ) {
    const ranked = allPropertiesRanked(companyId);
    if (!ranked.length) return "Todavía no tienes propiedades con datos suficientes para calcular rentabilidad.";
    const top = ranked[0];
    return `La propiedad más rentable es ${top.property.name}, con un beneficio de ${formatCurrency(top.profit)} y un margen del ${top.margin.toFixed(1)}% (ingresos ${formatCurrency(top.income)}, gastos ${formatCurrency(top.expense)}).`;
  }
  if (t.includes("menos rentable") || t.includes("peor propiedad")) {
    const ranked = allPropertiesRanked(companyId);
    if (!ranked.length) return "Todavía no tienes propiedades con datos suficientes.";
    const bottom = ranked[ranked.length - 1];
    return `La propiedad menos rentable es ${bottom.property.name}, con un beneficio de ${formatCurrency(bottom.profit)} y un margen del ${bottom.margin.toFixed(1)}%.`;
  }

  if (t.includes("gastado") || t.includes("gasto en") || t.includes("cuanto he gastado")) {
    const months = monthsBack(t);
    const cat = findCategory(companyId, t);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - months, 1).toISOString().slice(0, 10);
    let total;
    if (cat) {
      total = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=? AND category_id=? AND date >= ?").get(companyId, cat.id, start).s;
      return `En ${cat.name.toLowerCase()} has gastado ${formatCurrency(total)} durante los últimos ${months} meses.`;
    }
    total = sumExpenses(companyId, { start });
    return `El gasto total de los últimos ${months} meses ha sido de ${formatCurrency(total)}.`;
  }

  if (t.includes("proveedor")) {
    const rows = db.prepare(`SELECT provider_name, COALESCE(SUM(amount),0) total, COUNT(*) n FROM invoices
      WHERE company_id = ? AND provider_name IS NOT NULL GROUP BY provider_name ORDER BY total DESC LIMIT 5`).all(companyId);
    if (!rows.length) return "Todavía no hay facturas suficientes para analizar proveedores.";
    const lines = rows.map((r, i) => `${i + 1}. ${r.provider_name} — ${formatCurrency(r.total)} (${r.n} facturas)`);
    return `Los proveedores con más gasto son:\n${lines.join("\n")}`;
  }

  if (t.includes("resumen financiero") || t.includes("resumen del mes") || (t.includes("resumen") && t.includes("mes"))) {
    const wantsLastMonth = t.includes("pasado") || t.includes("anterior");
    const { start, end } = monthBounds(wantsLastMonth ? -1 : 0);
    const income = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM incomes WHERE company_id=? AND date>=? AND date<?").get(companyId, start, end).s;
    const expense = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id=? AND date>=? AND date<?").get(companyId, start, end).s;
    const label = new Date(start).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    return `Resumen de ${label}: ingresos ${formatCurrency(income)}, gastos ${formatCurrency(expense)}, beneficio ${formatCurrency(income - expense)} (margen ${income > 0 ? ((income - expense) / income * 100).toFixed(1) : 0}%).`;
  }

  if (t.includes("licencia") || t.includes("caduc") || t.includes("vence") || t.includes("vencimiento")) {
    const alerts = upcomingDocumentAlerts(companyId, 120).filter((a) => !t.includes("licencia") || a.type === "license");
    if (!alerts.length) return "No hay documentos próximos a caducar en los próximos meses.";
    const lines = alerts.slice(0, 6).map((a) => `• ${a.name} (${a.property_name}) — caduca en ${a.daysLeft} días`);
    return `Estos son los documentos que caducan próximamente:\n${lines.join("\n")}`;
  }

  if (t.includes("incidencia")) {
    const rows = db.prepare(`SELECT i.*, p.name as pname FROM incidents i JOIN properties p ON p.id=i.property_id WHERE i.company_id=? AND i.status != 'resolved' ORDER BY i.priority DESC`).all(companyId);
    if (!rows.length) return "No tienes incidencias abiertas ahora mismo. 🎉";
    const lines = rows.slice(0, 6).map((r) => `• ${r.title} — ${r.pname} (${r.priority === "high" ? "prioridad alta" : "normal"})`);
    return `Incidencias abiertas:\n${lines.join("\n")}`;
  }

  if (t.includes("ocupacion") || t.includes("reservas")) {
    const n = db.prepare("SELECT COUNT(*) c FROM reservations WHERE company_id=? AND checkin >= date('now','-30 day')").get(companyId).c;
    return `En los últimos 30 días se han registrado ${n} reservas en tu cartera.`;
  }

  return null;
}

module.exports = ({ post }) => {
  post("/api/ai/ask", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    const question = (b.question || "").trim();
    if (!question) return sendJson(res, 400, { error: "Escribe una pregunta." });
    let answer = answerQuestion(companyId, question);
    if (answer === null) {
      answer = "No he entendido bien la pregunta. Puedo ayudarte con: rentabilidad por vivienda, gasto por categoría o proveedor, resumen financiero del mes, documentos y licencias por caducar, e incidencias abiertas. Prueba a reformular la pregunta con alguno de esos temas.";
    }
    db.prepare("INSERT INTO ai_conversations (id, company_id, user_id, question, answer) VALUES (?,?,?,?,?)").run(
      uuid(), companyId, req.session.user.id, question, answer
    );
    sendJson(res, 200, { answer });
  }));
};
