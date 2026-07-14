const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const db = require("./db");

function runOcr(filePath, mimetype) {
  const tmpBase = path.join(os.tmpdir(), "estia_ocr_" + Date.now());
  let imagePath = filePath;
  try {
    if (mimetype === "application/pdf") {
      execFileSync("pdftoppm", ["-jpeg", "-r", "200", "-f", "1", "-l", "1", filePath, tmpBase], { timeout: 20000 });
      const candidate = tmpBase + "-1.jpg";
      imagePath = fs.existsSync(candidate) ? candidate : (fs.existsSync(tmpBase + "-01.jpg") ? tmpBase + "-01.jpg" : filePath);
    }
    const outBase = path.join(os.tmpdir(), "estia_txt_" + Date.now());
    execFileSync("tesseract", [imagePath, outBase, "-l", "eng", "--psm", "6"], { timeout: 20000, stdio: ["ignore", "ignore", "ignore"] });
    const text = fs.readFileSync(outBase + ".txt", "utf8");
    try { fs.unlinkSync(outBase + ".txt"); } catch (e) {}
    if (imagePath !== filePath) { try { fs.unlinkSync(imagePath); } catch (e) {} }
    return text;
  } catch (err) {
    return "";
  }
}

function findAmount(text) {
  // Look for currency-like numbers, prefer ones near TOTAL
  const lines = text.split("\n");
  const amountRe = /(\d{1,4}[.,]\d{2})\s*€?/g;
  let candidates = [];
  for (const line of lines) {
    const isTotalLine = /total|importe|amount/i.test(line);
    let m;
    while ((m = amountRe.exec(line))) {
      const val = parseFloat(m[1].replace(",", "."));
      if (val > 0 && val < 100000) candidates.push({ val, priority: isTotalLine ? 2 : 1 });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.priority - a.priority) || (b.val - a.val));
  return candidates[0].val;
}

function findDate(text) {
  const re = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
  const m = text.match(re);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  d = d.padStart(2, "0"); mo = mo.padStart(2, "0");
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  return iso;
}

function findCif(text) {
  const re = /\b[ABCDEFGHJNPQRSUVW][\s-]?\d{7}[\s-]?[0-9A-J]\b/i;
  const m = text.replace(/\s+/g, " ").match(re);
  return m ? m[0].replace(/[\s-]/g, "").toUpperCase() : null;
}

function findTaxRate(text) {
  const m = text.match(/(IGIC|IVA)\D{0,6}(\d{1,2})\s?%/i);
  if (m) return { label: m[1].toUpperCase(), rate: Number(m[2]) };
  return null;
}

function guessProviderName(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    const letters = line.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= 4 && !/factura|ticket|fecha|recibo/i.test(line)) {
      return line.slice(0, 60);
    }
  }
  return null;
}

const KEYWORD_CATEGORY = [
  [/fontaner|reparaci|arregl|averi/i, "Reparaciones"],
  [/limpiez/i, "Limpieza"],
  [/seguro|mapfre|mutua/i, "Seguros"],
  [/electro|nevera|lavadora|frigor/i, "Electrodomésticos"],
  [/mueble|sofa|colchon|ikea/i, "Mobiliario"],
  [/pintura|decorac/i, "Decoración"],
  [/endesa|iberdrola|luz|electricidad|agua|gas natural|telefonica|movistar|internet/i, "Suministros"],
  [/gestoria|asesor|notario|abogad/i, "Gestoría/Administración"],
  [/marketing|publicidad|anuncio|ads/i, "Marketing"],
  [/comision|booking|airbnb|expedia/i, "Comisiones"],
  [/\bimpuesto|\btasa municipal|\bhacienda|\btributo\b/i, "Impuestos"],
  [/ferreteria|bricolaje|tornill/i, "Mantenimiento"],
];

function suggestCategory(companyId, providerName, text) {
  const cats = db.prepare("SELECT * FROM categories WHERE company_id = ?").all(companyId);
  const byName = (n) => cats.find((c) => c.name === n);

  if (providerName) {
    const prov = db.prepare("SELECT * FROM providers WHERE company_id = ? AND name LIKE ?").get(companyId, "%" + providerName.split(" ")[0] + "%");
    if (prov && prov.category) {
      const c = byName(prov.category);
      if (c) return { categoryId: c.id, categoryName: c.name, confidence: 0.95, providerId: prov.id };
    }
  }
  const haystack = (providerName || "") + " " + text;
  for (const [re, catName] of KEYWORD_CATEGORY) {
    if (re.test(haystack)) {
      const c = byName(catName);
      if (c) return { categoryId: c.id, categoryName: c.name, confidence: 0.75, providerId: null };
    }
  }
  const other = byName("Otros");
  return { categoryId: other ? other.id : null, categoryName: "Otros", confidence: 0.3, providerId: null };
}

function suggestProperty(companyId, providerId, text) {
  if (providerId) {
    const row = db.prepare(`SELECT property_id, COUNT(*) n FROM invoices WHERE company_id=? AND provider_id=? AND property_id IS NOT NULL GROUP BY property_id ORDER BY n DESC LIMIT 1`).get(companyId, providerId);
    if (row) {
      const p = db.prepare("SELECT * FROM properties WHERE id=?").get(row.property_id);
      if (p) return { propertyId: p.id, propertyName: p.name, confidence: 0.88 };
    }
  }
  const props = db.prepare("SELECT * FROM properties WHERE company_id=? AND status='active'").all(companyId);
  for (const p of props) {
    if (text && (text.includes(p.name) || (p.city && text.includes(p.city)))) {
      return { propertyId: p.id, propertyName: p.name, confidence: 0.7 };
    }
  }
  return { propertyId: null, propertyName: null, confidence: 0 };
}

function extractInvoiceData(companyId, text) {
  const amount = findAmount(text);
  const date = findDate(text);
  const cif = findCif(text);
  const tax = findTaxRate(text);
  const providerName = guessProviderName(text);
  const cat = suggestCategory(companyId, providerName, text);
  const prop = suggestProperty(companyId, cat.providerId, text);
  const company = db.prepare("SELECT * FROM companies WHERE id=?").get(companyId);
  const taxRate = tax ? tax.rate : company.tax_rate;
  const taxBase = amount ? +(amount / (1 + taxRate / 100)).toFixed(2) : null;
  const taxAmount = amount && taxBase ? +(amount - taxBase).toFixed(2) : null;

  let confidence = 0.4;
  if (amount) confidence += 0.2;
  if (date) confidence += 0.15;
  if (cif) confidence += 0.1;
  if (providerName) confidence += 0.15;
  confidence = Math.min(confidence, 0.98);

  return {
    providerName, cif, issueDate: date, amount, taxBase, taxRate, taxAmount,
    category: cat, property: prop, confidence, rawText: text.slice(0, 4000),
  };
}

module.exports = { runOcr, extractInvoiceData, findAmount, findDate, findCif };
