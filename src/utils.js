const crypto = require("crypto");

function uuid() {
  return crypto.randomUUID();
}

function formatCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(d) {
  if (!d) return "—";
  const date = new Date(d.replace(" ", "T"));
  if (isNaN(date.getTime())) return d;
  return date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  const target = new Date(dateStr);
  const diff = Math.ceil((target.getTime() - now.setHours(0, 0, 0, 0)) / 86400000);
  return diff;
}

function monthRange(offsetMonths = 0) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offsetMonths;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    let size = 0;
    const max = 25 * 1024 * 1024; // 25MB
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      data.push(chunk);
    });
    req.on("end", () => {
      const buf = Buffer.concat(data);
      const contentType = req.headers["content-type"] || "";
      try {
        if (contentType.includes("application/json")) {
          resolve(buf.length ? JSON.parse(buf.toString("utf8")) : {});
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          resolve(Object.fromEntries(new URLSearchParams(buf.toString("utf8"))));
        } else {
          resolve({ raw: buf });
        }
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

module.exports = { uuid, formatCurrency, formatDate, formatDateTime, escapeHtml, daysUntil, monthRange, parseBody, parseCookies };
