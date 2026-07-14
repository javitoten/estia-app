const crypto = require("crypto");
const db = require("./db");
const { uuid, parseCookies } = require("./utils");

const SECRET = process.env.ESTIA_SECRET || "estia-dev-secret-change-in-production";
const SESSION_DAYS = 30;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

function sign(value) {
  const h = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
  return `${value}.${h}`;
}

function unsign(signed) {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
  return token;
}

function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const signed = cookies["estia_session"];
  if (!signed) return null;
  const token = unsign(signed);
  if (!token) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  if (!user) return null;
  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(user.company_id);
  return { user, company, token };
}

function sessionCookieHeader(token) {
  const signed = sign(token);
  return `estia_session=${encodeURIComponent(signed)}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`;
}

function clearCookieHeader() {
  return `estia_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, getSessionUser,
  sessionCookieHeader, clearCookieHeader, uuid,
};
