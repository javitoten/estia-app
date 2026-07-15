const db = require("../db");
const { hashPassword, verifyPassword, createSession, destroySession, sessionCookieHeader, clearCookieHeader, uuid } = require("../auth");
const { authLayout } = require("../render");
const { parseBody, escapeHtml } = require("../utils");
const { sendHtml } = require("../guard");
const { seedDemoData } = require("../seed");

function loginPage(error) {
  return authLayout({
    title: "Iniciar sesión",
    content: `
    <div class="auth-card">
      <div class="auth-logo"><span class="logo-dot"></span><span>Estia</span></div>
      <div class="auth-sub">Accede a tu cuenta para gestionar tu cartera de viviendas vacacionales.</div>
      ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ""}
      <form method="POST" action="/login">
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="tu@empresa.com" value="demo@estia.app"></div>
        <div class="field"><label>Contraseña</label><input type="password" name="password" required placeholder="••••••••" value="demo1234"></div>
        <button class="btn btn-primary" type="submit" style="width:100%;">Entrar</button>
      </form>
      <div class="demo-note">Cuenta demo precargada: <strong>demo@estia.app</strong> / <strong>demo1234</strong></div>
      <div class="auth-alt">¿No tienes cuenta? <a href="/register">Crea tu empresa gratis</a></div>
    </div>`,
  });
}

function registerPage(error) {
  return authLayout({
    title: "Crear cuenta",
    content: `
    <div class="auth-card">
      <div class="auth-logo"><span class="logo-dot"></span><span>Estia</span></div>
      <div class="auth-sub">Crea tu empresa y empieza a gestionar tu cartera en minutos.</div>
      ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ""}
      <form method="POST" action="/register">
        <div class="field"><label>Nombre de la empresa</label><input type="text" name="company_name" required placeholder="Gestión Atlántico SL"></div>
        <div class="field"><label>Tu nombre</label><input type="text" name="name" required placeholder="Javier Montelongo"></div>
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="tu@empresa.com"></div>
        <div class="field"><label>Contraseña</label><input type="password" name="password" required minlength="6" placeholder="Mínimo 6 caracteres"></div>
        <div class="field">
          <label>Región fiscal</label>
          <select name="tax_region">
            <option value="canarias">Canarias (IGIC)</option>
            <option value="peninsula">Península / Baleares (IVA)</option>
          </select>
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;">Crear mi cuenta</button>
      </form>
      <div class="auth-alt">¿Ya tienes cuenta? <a href="/login">Inicia sesión</a></div>
    </div>`,
  });
}

module.exports = ({ get, post }) => {
  get("/", async (req, res) => {
    res.writeHead(302, { Location: req.session ? "/dashboard" : "/login" });
    res.end();
  });

  get("/login", async (req, res) => {
    if (req.session) { res.writeHead(302, { Location: "/dashboard" }); return res.end(); }
    sendHtml(res, 200, loginPage());
  });

  post("/login", async (req, res) => {
    const body = await parseBody(req);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get((body.email || "").trim().toLowerCase());
    if (!user || !user.password_hash || !verifyPassword(body.password || "", user.password_hash)) {
      return sendHtml(res, 401, loginPage("Email o contraseña incorrectos."));
    }
    const token = createSession(user.id);
    res.writeHead(302, { Location: "/dashboard", "Set-Cookie": sessionCookieHeader(token) });
    res.end();
  });

  get("/register", async (req, res) => {
    if (req.session) { res.writeHead(302, { Location: "/dashboard" }); return res.end(); }
    sendHtml(res, 200, registerPage());
  });

  post("/register", async (req, res) => {
    const body = await parseBody(req);
    const email = (body.email || "").trim().toLowerCase();
    if (!body.company_name || !body.name || !email || !body.password) {
      return sendHtml(res, 400, registerPage("Rellena todos los campos."));
    }
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return sendHtml(res, 400, registerPage("Ya existe una cuenta con ese email."));
    }
    const companyId = uuid();
    const isCanarias = body.tax_region !== "peninsula";
    db.prepare("INSERT INTO companies (id, name, tax_region, tax_label, tax_rate, plan) VALUES (?, ?, ?, ?, ?, ?)").run(
      companyId, body.company_name, isCanarias ? "canarias" : "peninsula", isCanarias ? "IGIC" : "IVA", isCanarias ? 7 : 21, "trial"
    );
    const userId = uuid();
    db.prepare("INSERT INTO users (id, company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)").run(
      userId, companyId, body.name, email, hashPassword(body.password), "admin"
    );
    seedDemoData(companyId, { skipIfPopulated: false, light: true });
    const token = createSession(userId);
    res.writeHead(302, { Location: "/dashboard", "Set-Cookie": sessionCookieHeader(token) });
    res.end();
  });

  get("/logout", async (req, res) => {
    if (req.session) destroySession(req.session.token);
    res.writeHead(302, { Location: "/login", "Set-Cookie": clearCookieHeader() });
    res.end();
  });
};
