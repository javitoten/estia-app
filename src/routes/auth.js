const db = require("../db");
const { hashPassword, verifyPassword, createSession, destroySession, sessionCookieHeader, clearCookieHeader, uuid } = require("../auth");
const { authLayout } = require("../render");
const { parseBody, escapeHtml, parseCookies } = require("../utils");
const { sendHtml } = require("../guard");
const { seedDemoData } = require("../seed");

// ---------------------------------------------------------------------------
// Login con Google (OAuth 2.0), implementado a mano con fetch (sin librerías
// externas). Se activa solo si están configuradas las tres variables de
// entorno; si faltan, el botón simplemente no aparece y todo sigue
// funcionando con email/contraseña como hasta ahora.
// ---------------------------------------------------------------------------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:-4px;margin-right:8px;"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 34.7 27 35.5 24 35.5c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C41.4 36.4 44 30.7 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>`;

function googleButton() {
  if (!GOOGLE_ENABLED) return "";
  return `
    <a href="/auth/google" class="btn" style="width:100%;background:#fff;border:1px solid var(--border,#E4E7EC);color:#1F2937;display:flex;align-items:center;justify-content:center;margin-bottom:14px;">
      ${GOOGLE_ICON}<span>Continuar con Google</span>
    </a>
    <div style="display:flex;align-items:center;gap:10px;margin:14px 0;color:#9CA3AF;font-size:12px;">
      <div style="flex:1;height:1px;background:#E4E7EC;"></div>o<div style="flex:1;height:1px;background:#E4E7EC;"></div>
    </div>`;
}

function loginPage(error) {
  return authLayout({
    title: "Iniciar sesión",
    content: `
    <div class="auth-card">
      <div class="auth-logo"><span class="logo-dot"></span><span>Estia</span></div>
      <div class="auth-sub">Accede a tu cuenta para gestionar tu cartera de viviendas vacacionales.</div>
      ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ""}
      ${googleButton()}
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
      ${googleButton()}
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

// Crea (si hace falta) empresa + usuario a partir de un perfil de Google y
// devuelve la fila de usuario ya lista para crear sesión.
function findOrCreateGoogleUser(profile) {
  const email = profile.email.toLowerCase();
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (user) {
    if (!user.google_id) {
      db.prepare("UPDATE users SET google_id=?, avatar_url=? WHERE id=?").run(profile.sub, profile.picture || null, user.id);
    }
    return user;
  }
  const companyId = uuid();
  const firstName = (profile.name || email.split("@")[0]).split(" ")[0];
  db.prepare("INSERT INTO companies (id, name, tax_region, tax_label, tax_rate, plan) VALUES (?, ?, 'canarias', 'IGIC', 7, 'trial')").run(
    companyId, `Empresa de ${firstName}`
  );
  const userId = uuid();
  db.prepare("INSERT INTO users (id, company_id, name, email, password_hash, google_id, avatar_url, role) VALUES (?, ?, ?, ?, NULL, ?, ?, 'admin')").run(
    userId, companyId, profile.name || email.split("@")[0], email, profile.sub, profile.picture || null
  );
  seedDemoData(companyId, { skipIfPopulated: false, light: true });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
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

  // ---------------- GOOGLE OAUTH ----------------
  get("/auth/google", async (req, res) => {
    if (!GOOGLE_ENABLED) { res.writeHead(404); return res.end("No disponible"); }
    if (req.session) { res.writeHead(302, { Location: "/dashboard" }); return res.end(); }
    const state = uuid();
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      prompt: "select_account",
      state,
    });
    res.writeHead(302, {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      "Set-Cookie": `estia_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`,
    });
    res.end();
  });

  get("/auth/google/callback", async (req, res) => {
    if (!GOOGLE_ENABLED) { res.writeHead(404); return res.end("No disponible"); }
    const { code, state, error: googleError } = req.query;
    if (googleError) {
      return sendHtml(res, 400, loginPage("Google no completó el inicio de sesión: " + googleError));
    }
    const cookies = parseCookies(req);
    if (!code || !state || state !== cookies["estia_oauth_state"]) {
      return sendHtml(res, 400, loginPage("No se pudo verificar la solicitud de Google. Inténtalo de nuevo."));
    }
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI, grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) throw new Error("No se pudo obtener el token de Google (status " + tokenRes.status + ")");
      const tokenJson = await tokenRes.json();

      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!profileRes.ok) throw new Error("No se pudo leer el perfil de Google (status " + profileRes.status + ")");
      const profile = await profileRes.json();

      if (!profile.email || profile.email_verified === false) {
        return sendHtml(res, 400, loginPage("Tu cuenta de Google no tiene un email verificado."));
      }

      const user = findOrCreateGoogleUser(profile);
      const token = createSession(user.id);
      res.writeHead(302, {
        Location: "/dashboard",
        "Set-Cookie": [sessionCookieHeader(token), "estia_oauth_state=; HttpOnly; Path=/; Max-Age=0"],
      });
      res.end();
    } catch (err) {
      console.error("Error en login con Google:", err);
      sendHtml(res, 500, loginPage("No se pudo iniciar sesión con Google. Inténtalo de nuevo en unos minutos."));
    }
  });
};
