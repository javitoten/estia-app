const db = require("./db");

function monthBounds(offset = 0) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function sumExpenses(companyId, { propertyId = null, start = null, end = null } = {}) {
  let q = "SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE company_id = ?";
  const params = [companyId];
  if (propertyId) { q += " AND property_id = ?"; params.push(propertyId); }
  if (start) { q += " AND date >= ?"; params.push(start); }
  if (end) { q += " AND date < ?"; params.push(end); }
  return db.prepare(q).get(...params).s;
}
function sumIncomes(companyId, { propertyId = null, start = null, end = null } = {}) {
  let q = "SELECT COALESCE(SUM(amount),0) s FROM incomes WHERE company_id = ?";
  const params = [companyId];
  if (propertyId) { q += " AND property_id = ?"; params.push(propertyId); }
  if (start) { q += " AND date >= ?"; params.push(start); }
  if (end) { q += " AND date < ?"; params.push(end); }
  return db.prepare(q).get(...params).s;
}

function propertyProfitability(companyId, propertyId, opts = {}) {
  const income = sumIncomes(companyId, { propertyId, ...opts });
  const expense = sumExpenses(companyId, { propertyId, ...opts });
  const profit = income - expense;
  const margin = income > 0 ? (profit / income) * 100 : 0;
  return { income, expense, profit, margin };
}

function allPropertiesRanked(companyId, opts = {}) {
  const props = db.prepare("SELECT * FROM properties WHERE company_id = ? AND status = 'active'").all(companyId);
  return props.map((p) => ({ property: p, ...propertyProfitability(companyId, p.id, opts) }))
    .sort((a, b) => b.profit - a.profit);
}

function expensesByCategory(companyId, opts = {}) {
  let q = `SELECT c.name, c.color, COALESCE(SUM(e.amount),0) total FROM categories c
    LEFT JOIN expenses e ON e.category_id = c.id AND e.company_id = c.company_id`;
  const params = [companyId];
  const conds = [];
  if (opts.propertyId) { conds.push("e.property_id = ?"); params.push(opts.propertyId); }
  if (opts.start) { conds.push("e.date >= ?"); params.push(opts.start); }
  if (opts.end) { conds.push("e.date < ?"); params.push(opts.end); }
  q += " WHERE c.company_id = ?" + (conds.length ? " AND " + conds.join(" AND ") : "");
  // move company_id param first correctly
  const finalParams = [companyId, ...params.slice(1)];
  q += " GROUP BY c.id ORDER BY total DESC";
  const rows = db.prepare(q).all(companyId, ...params.slice(1));
  return rows.filter((r) => r.total > 0);
}

function monthlySeries(companyId, months = 6, propertyId = null) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const { start, end } = monthBounds(-i);
    const income = sumIncomes(companyId, { propertyId, start, end });
    const expense = sumExpenses(companyId, { propertyId, start, end });
    const label = new Date(start).toLocaleDateString("es-ES", { month: "short" });
    out.push({ label, income, expense, profit: income - expense });
  }
  return out;
}

function dashboardKpis(companyId) {
  const thisMonth = monthBounds(0);
  const lastMonth = monthBounds(-1);
  const income = sumIncomes(companyId, thisMonth);
  const expense = sumExpenses(companyId, thisMonth);
  const incomePrev = sumIncomes(companyId, lastMonth);
  const expensePrev = sumExpenses(companyId, lastMonth);
  const pendingInvoices = db.prepare("SELECT COUNT(*) c FROM invoices WHERE company_id = ? AND status = 'pending_review'").get(companyId).c;
  const openIncidents = db.prepare("SELECT COUNT(*) c FROM incidents WHERE company_id = ? AND status != 'resolved'").get(companyId).c;
  const today = new Date().toISOString().slice(0, 10);
  const cleaningsToday = db.prepare("SELECT COUNT(*) c FROM cleanings WHERE company_id = ? AND date = ?").get(companyId, today).c;
  const pendingMaintenance = db.prepare("SELECT COUNT(*) c FROM maintenances WHERE company_id = ? AND status != 'done'").get(companyId).c;
  return {
    income, expense, profit: income - expense,
    incomeDelta: incomePrev > 0 ? ((income - incomePrev) / incomePrev) * 100 : 0,
    expenseDelta: expensePrev > 0 ? ((expense - expensePrev) / expensePrev) * 100 : 0,
    pendingInvoices, openIncidents, cleaningsToday, pendingMaintenance,
  };
}

function upcomingDocumentAlerts(companyId, withinDays = 60) {
  const rows = db.prepare(`SELECT d.*, p.name as property_name FROM documents d
    JOIN properties p ON p.id = d.property_id
    WHERE d.company_id = ? AND d.expiry_date IS NOT NULL ORDER BY d.expiry_date ASC`).all(companyId);
  const now = new Date();
  return rows.map((r) => {
    const diff = Math.ceil((new Date(r.expiry_date) - now) / 86400000);
    return { ...r, daysLeft: diff };
  }).filter((r) => r.daysLeft <= withinDays);
}

module.exports = { monthBounds, sumExpenses, sumIncomes, propertyProfitability, allPropertiesRanked, expensesByCategory, monthlySeries, dashboardKpis, upcomingDocumentAlerts };
