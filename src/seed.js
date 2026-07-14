const db = require("./db");
const { uuid } = require("./utils");
const { hashPassword } = require("./auth");

const CATS = [
  ["Suministros", "#5B7FDE"],
  ["Limpieza", "#E9B44C"],
  ["Reparaciones", "#C2452C"],
  ["Mantenimiento", "#0E7C6B"],
  ["Mobiliario", "#9B7FE8"],
  ["Decoración", "#D4849A"],
  ["Electrodomésticos", "#3B8FA3"],
  ["Marketing", "#F0866B"],
  ["Comisiones", "#8A8FA0"],
  ["Seguros", "#4C7A99"],
  ["Impuestos", "#6B7280"],
  ["Gestoría/Administración", "#7C5CBF"],
  ["Personal", "#2E9E7C"],
  ["Otros", "#9CA3AF"],
];

const PROVIDERS = [
  ["Ferretería Suárez S.L.", "B35123456", "Mantenimiento"],
  ["Limpiezas Canarias Sur", "B38222111", "Limpieza"],
  ["Mapfre Seguros", "A28141935", "Seguros"],
  ["Fontanería Hermanos Pérez", "B35998877", "Reparaciones"],
  ["Electro Canarias", "B35445566", "Electrodomésticos"],
  ["Endesa Energía", "A81948077", "Suministros"],
  ["Gestoría Atlántico", "B38667788", "Gestoría/Administración"],
  ["Muebles Isla Verde", "B35112233", "Mobiliario"],
];

function iso(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function seedCategories(companyId) {
  const existing = db.prepare("SELECT COUNT(*) c FROM categories WHERE company_id = ?").get(companyId);
  if (existing.c > 0) return;
  const stmt = db.prepare("INSERT INTO categories (id, company_id, name, color, kind) VALUES (?, ?, ?, ?, 'expense')");
  for (const [name, color] of CATS) stmt.run(uuid(), companyId, name, color);
}

function catMap(companyId) {
  const rows = db.prepare("SELECT id, name FROM categories WHERE company_id = ?").all(companyId);
  const m = {};
  rows.forEach((r) => { m[r.name] = r.id; });
  return m;
}

function seedProviders(companyId) {
  const existing = db.prepare("SELECT COUNT(*) c FROM providers WHERE company_id = ?").get(companyId);
  if (existing.c > 0) return provMap(companyId);
  const stmt = db.prepare("INSERT INTO providers (id, company_id, name, cif, category) VALUES (?, ?, ?, ?, ?)");
  for (const [name, cif, cat] of PROVIDERS) stmt.run(uuid(), companyId, name, cif, cat);
  return provMap(companyId);
}
function provMap(companyId) {
  const rows = db.prepare("SELECT id, name FROM providers WHERE company_id = ?").all(companyId);
  const m = {};
  rows.forEach((r) => { m[r.name] = r.id; });
  return m;
}

const DEMO_PROPERTIES = [
  { name: "Villa Atlántico 4", address: "Calle Los Almendros 12", city: "San Bartolomé de Tirajana", type: "villa", capacity: 6, bedrooms: 3, bathrooms: 2, license: "VV-35-002145", color: "#0E7C6B" },
  { name: "Casa Roque Nublo", address: "Camino de la Cumbre 3", city: "Tejeda", type: "house", capacity: 4, bedrooms: 2, bathrooms: 1, license: "VV-35-001982", color: "#5B7FDE" },
  { name: "Apto. Playa Blanca 2", address: "Av. Marítima 45, 2ºB", city: "Yaiza", type: "apartment", capacity: 4, bedrooms: 2, bathrooms: 1, license: "VV-35-002310", color: "#E9B44C" },
  { name: "Apto. Mogán 1", address: "Puerto Rico, Edif. Vista Mar 8", city: "Mogán", type: "apartment", capacity: 2, bedrooms: 1, bathrooms: 1, license: "VV-35-001754", color: "#9B7FE8" },
];

function seedDemoData(companyId, opts = {}) {
  const light = !!opts.light;
  seedCategories(companyId);
  const cats = catMap(companyId);
  const provs = light ? provMap(companyId) : seedProviders(companyId);
  if (Object.keys(provs).length === 0) Object.assign(provs, seedProviders(companyId));

  const propsToCreate = light ? DEMO_PROPERTIES.slice(0, 1) : DEMO_PROPERTIES;
  const propIds = [];

  for (const p of propsToCreate) {
    const id = uuid();
    propIds.push(id);
    db.prepare(`INSERT INTO properties (id, company_id, name, address, city, type, capacity, bedrooms, bathrooms, license_number, cleaning_lead, maintenance_lead, channels, cover_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, companyId, p.name, p.address, p.city, p.type, p.capacity, p.bedrooms, p.bathrooms, p.license,
      "María Suárez", "Luis Hernández", "Airbnb, Booking, Directo", p.color
    );

    if (light) continue; // keep new self-registered accounts lighter

    // Documents with varied expiry to demo alerts
    const docTypes = [
      ["license", "Licencia de Vivienda Vacacional", daysAgo(400), daysFromNow(310)],
      ["insurance", "Seguro de hogar", daysAgo(200), daysFromNow(22)],
      ["certificate", "Certificado energético", daysAgo(600), daysFromNow(140)],
      ["contract", "Contrato con propietario", daysAgo(500), null],
    ];
    const docStmt = db.prepare("INSERT INTO documents (id, company_id, property_id, type, name, issue_date, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const [type, name, issue, expiry] of docTypes) docStmt.run(uuid(), companyId, id, type, name, issue, expiry);

    // Inventory
    const items = [
      ["Cocina", "Nevera", "Balay", 700, daysAgo(500)],
      ["Cocina", "Lavadora", "Bosch", 420, daysAgo(400)],
      ["Salón", "Televisor 43\"", "Samsung", 380, daysAgo(300)],
      ["Dormitorio 1", "Colchón", "Flex", 250, daysAgo(600)],
      ["Exterior", "Tumbonas (x2)", "IKEA", 120, daysAgo(200)],
    ];
    const invItemStmt = db.prepare("INSERT INTO inventory_items (id, company_id, property_id, room, name, brand, purchase_date, cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'good')");
    const itemIds = [];
    for (const [room, name, brand, cost, date] of items) {
      const iid = uuid();
      itemIds.push({ id: iid, name });
      invItemStmt.run(iid, companyId, id, room, name, brand, date, cost);
    }

    // Reservations + incomes (last 6 months)
    const resStmt = db.prepare("INSERT INTO reservations (id, company_id, property_id, channel, guest_name, checkin, checkout, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')");
    const incStmt = db.prepare("INSERT INTO incomes (id, company_id, property_id, amount, date, channel, description, reservation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (let i = 0; i < 10; i++) {
      const start = 5 + i * 12 + Math.floor(Math.random() * 4);
      const nights = 3 + Math.floor(Math.random() * 5);
      const amount = Math.round((80 + Math.random() * 60) * nights);
      const channel = pick(["Airbnb", "Booking", "Directo"]);
      const rid = uuid();
      resStmt.run(rid, companyId, id, channel, pick(["J. Weber", "S. Dupont", "M. Rossi", "A. Johnson", "L. García"]), daysAgo(start), daysAgo(start - nights), amount, );
      incStmt.run(uuid(), companyId, id, amount, daysAgo(start - nights), channel, "Reserva " + channel, rid);
    }
    // One upcoming check-in today/tomorrow for calendar demo
    const nid = uuid();
    resStmt.run(nid, companyId, id, "Airbnb", "K. Nilsson", daysFromNow(propsToCreate.indexOf(p) === 0 ? 0 : propsToCreate.indexOf(p)), daysFromNow(4), 620);

    // Expenses + invoices (mix of categories, last 6 months)
    const expenseSeeds = [
      ["Ferretería Suárez S.L.", "Mantenimiento", 84.2, 12],
      ["Limpiezas Canarias Sur", "Limpieza", 240, 20],
      ["Endesa Energía", "Suministros", 118.5, 33],
      ["Mapfre Seguros", "Seguros", 310, 90],
      ["Fontanería Hermanos Pérez", "Reparaciones", 165, 55],
      ["Electro Canarias", "Electrodomésticos", 429, 140],
      ["Gestoría Atlántico", "Gestoría/Administración", 95, 15],
      ["Muebles Isla Verde", "Mobiliario", 210, 170],
      ["Endesa Energía", "Suministros", 102.3, 63],
      ["Limpiezas Canarias Sur", "Limpieza", 240, 48],
    ];
    const invStmt = db.prepare(`INSERT INTO invoices (id, company_id, property_id, provider_id, provider_name, cif, issue_date, amount, tax_base, tax_rate, tax_amount, category_id, payment_method, concept, status, confidence, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'demo')`);
    const expStmt = db.prepare("INSERT INTO expenses (id, company_id, property_id, invoice_id, category_id, amount, date, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const [provName, catName, amount, ago] of expenseSeeds) {
      const taxRate = 7;
      const base = +(amount / (1 + taxRate / 100)).toFixed(2);
      const invId = uuid();
      invStmt.run(invId, companyId, id, provs[provName] || null, provName, "B00000000", daysAgo(ago), amount, base, taxRate, +(amount - base).toFixed(2), cats[catName], pick(["card", "transfer", "cash"]), catName + " — " + provName, 0.94);
      expStmt.run(uuid(), companyId, id, invId, cats[catName], amount, daysAgo(ago), catName + " — " + provName);
    }
    // One pending-review invoice (for the OCR review demo)
    db.prepare(`INSERT INTO invoices (id, company_id, property_id, provider_name, issue_date, amount, tax_base, tax_rate, tax_amount, category_id, payment_method, concept, status, confidence, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 0.9, 'demo')`).run(
      uuid(), companyId, id, "Pinturas Canarias S.L.", daysAgo(1), 156.4, 146.2, 7, 10.2, cats["Reparaciones"], "card", "Pintura fachada exterior"
    );

    // Cleanings
    const cleanStmt = db.prepare("INSERT INTO cleanings (id, company_id, property_id, date, assignee, status, checklist, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const checklist = JSON.stringify([
      { label: "Cambio de sábanas y toallas", done: true },
      { label: "Limpieza de baños", done: true },
      { label: "Cocina y electrodomésticos", done: true },
      { label: "Revisión de inventario", done: false },
      { label: "Fotos finales", done: false },
    ]);
    cleanStmt.run(uuid(), companyId, id, daysFromNow(propsToCreate.indexOf(p) === 0 ? 0 : propsToCreate.indexOf(p) - 1), "María Suárez", propsToCreate.indexOf(p) === 0 ? "pending" : "done", checklist, "");
    cleanStmt.run(uuid(), companyId, id, daysAgo(20), "María Suárez", "done", checklist, "Sin incidencias");

    // Maintenance
    const maintStmt = db.prepare("INSERT INTO maintenances (id, company_id, property_id, title, type, scheduled_date, status, assignee, cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    maintStmt.run(uuid(), companyId, id, "Revisión anual de extintores", "preventive", daysFromNow(18), "scheduled", "Luis Hernández", 0, "");
    maintStmt.run(uuid(), companyId, id, "Reparación toldo terraza", "corrective", daysAgo(3), "in_progress", "Luis Hernández", 90, "Proveedor asignado");

    // Incidents (one linked to inventory + pending invoice for auto-link demo)
    const incidentStmt = db.prepare(`INSERT INTO incidents (id, company_id, property_id, inventory_item_id, title, description, priority, status, provider_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
    const nevera = itemIds.find((i) => i.name === "Nevera");
    incidentStmt.run(uuid(), companyId, id, nevera ? nevera.id : null, "Nevera no enfría", "Huésped reportó que la nevera de cocina no enfría correctamente desde ayer.", "high", "open", provs["Electro Canarias"] || null, "-1 day");
    incidentStmt.run(uuid(), companyId, id, null, "Cerradura puerta principal dura", "Cuesta girar la llave, revisar bombín.", "normal", "resolved", provs["Ferretería Suárez S.L."] || null, "-15 day");
  }

  return propIds;
}

function ensureDemoAccount() {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get("demo@estia.app");
  if (existing) return;
  const companyId = uuid();
  db.prepare("INSERT INTO companies (id, name, cif, tax_region, tax_label, tax_rate, plan) VALUES (?, ?, ?, 'canarias', 'IGIC', 7, 'growth')").run(
    companyId, "Gestión Atlántico Canarias S.L.", "B35999888"
  );
  const userId = uuid();
  db.prepare("INSERT INTO users (id, company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'admin')").run(
    userId, companyId, "Javier Montelongo", "demo@estia.app", hashPassword("demo1234")
  );
  const ownerId = uuid();
  db.prepare("INSERT INTO owners (id, company_id, name, email) VALUES (?, ?, ?, ?)").run(ownerId, companyId, "Fondo Atlántico SL", "propietario@fondoatlantico.com");
  seedDemoData(companyId, { light: false });
  console.log("Cuenta demo creada: demo@estia.app / demo1234");
}

module.exports = { seedDemoData, ensureDemoAccount };
