const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "estia.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cif TEXT,
  tax_region TEXT NOT NULL DEFAULT 'canarias',
  tax_label TEXT NOT NULL DEFAULT 'IGIC',
  tax_rate REAL NOT NULL DEFAULT 7,
  plan TEXT NOT NULL DEFAULT 'growth',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_id TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  cif TEXT,
  category TEXT,
  rating REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  kind TEXT NOT NULL DEFAULT 'expense'
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  type TEXT DEFAULT 'apartment',
  capacity INTEGER DEFAULT 2,
  bedrooms INTEGER DEFAULT 1,
  bathrooms INTEGER DEFAULT 1,
  license_number TEXT,
  owner_id TEXT REFERENCES owners(id),
  cleaning_lead TEXT,
  maintenance_lead TEXT,
  channels TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  cover_color TEXT DEFAULT '#0E7C6B',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT REFERENCES properties(id),
  provider_id TEXT REFERENCES providers(id),
  provider_name TEXT,
  cif TEXT,
  issue_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  tax_base REAL,
  tax_rate REAL,
  tax_amount REAL,
  category_id TEXT REFERENCES categories(id),
  payment_method TEXT DEFAULT 'card',
  concept TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  file_path TEXT,
  ocr_text TEXT,
  confidence REAL DEFAULT 0,
  incident_id TEXT,
  source TEXT DEFAULT 'upload',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  invoice_id TEXT REFERENCES invoices(id),
  category_id TEXT REFERENCES categories(id),
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incomes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  channel TEXT DEFAULT 'direct',
  description TEXT,
  reservation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  channel TEXT DEFAULT 'direct',
  guest_name TEXT,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'confirmed',
  external_uid TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ical_feeds (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  channel TEXT NOT NULL DEFAULT 'airbnb',
  url TEXT NOT NULL,
  last_synced_at TEXT,
  last_status TEXT,
  events_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cleanings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  date TEXT NOT NULL,
  assignee TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  checklist TEXT DEFAULT '[]',
  photos TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  title TEXT NOT NULL,
  type TEXT DEFAULT 'corrective',
  scheduled_date TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  assignee TEXT,
  cost REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  room TEXT DEFAULT 'general',
  name TEXT NOT NULL,
  brand TEXT,
  purchase_date TEXT,
  cost REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'good',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  inventory_item_id TEXT REFERENCES inventory_items(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  provider_id TEXT REFERENCES providers(id),
  photo_path TEXT,
  invoice_id TEXT REFERENCES invoices(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

// ---------------------------------------------------------------------------
// Migraciones ligeras: añaden columnas nuevas a bases de datos ya existentes
// (creadas antes de que existieran estos campos) sin perder datos.
// ---------------------------------------------------------------------------
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("reservations", "external_uid", "TEXT");
ensureColumn("reservations", "source", "TEXT DEFAULT 'manual'");
ensureColumn("users", "google_id", "TEXT");
ensureColumn("users", "avatar_url", "TEXT");
// password_hash ya no es obligatorio a nivel de aplicación para cuentas de Google
// (SQLite no permite quitar NOT NULL fácilmente, pero la tabla ya se crea sin
// esa restricción en instalaciones nuevas gracias al CREATE TABLE de arriba).

module.exports = db;
