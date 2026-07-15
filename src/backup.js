// src/backup.js
//
// Copia de seguridad gratuita de la base de datos usando el propio repositorio
// de GitHub de la aplicación (rama independiente "db-backup"). Render (plan
// gratuito) no ofrece disco persistente, así que cada vez que el servicio se
// "duerme" por inactividad y vuelve a arrancar, el sistema de archivos es
// nuevo y la base de datos SQLite se perdería. Para evitarlo sin pagar nada:
//
//   1. Al arrancar, restauramos la última copia guardada en GitHub (si existe)
//      antes de que db.js abra el fichero.
//   2. Mientras el servicio está vivo, subimos una copia cada pocos minutos
//      y también justo antes de apagarse (SIGTERM/SIGINT).
//
// Si no se configuran las variables de entorno GITHUB_BACKUP_REPO y
// GITHUB_BACKUP_TOKEN, este módulo no hace nada (modo local normal).

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "estia.db");

const REPO = process.env.GITHUB_BACKUP_REPO || "";
const TOKEN = process.env.GITHUB_BACKUP_TOKEN || "";
const BRANCH = process.env.GITHUB_BACKUP_BRANCH || "db-backup";
const FILE_PATH = process.env.GITHUB_BACKUP_PATH || "estia.db";
const INTERVAL_MIN = Number(process.env.GITHUB_BACKUP_INTERVAL_MIN || 5);

function enabled() {
  return Boolean(REPO && TOKEN);
}

function headers(extra) {
  return Object.assign(
    {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "estia-app-backup",
    },
    extra || {}
  );
}

function contentsUrl() {
  return `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${encodeURIComponent(BRANCH)}`;
}

async function ensureBranchExists() {
  const refRes = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/${BRANCH}`, {
    headers: headers(),
  });
  if (refRes.status === 200) return;
  if (refRes.status !== 404) {
    console.warn("[backup] No se pudo comprobar la rama de backup (status " + refRes.status + ").");
    return;
  }
  // La rama no existe: la creamos apuntando al commit actual de main.
  const mainRef = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/main`, {
    headers: headers(),
  });
  if (!mainRef.ok) {
    console.warn("[backup] No se pudo leer la rama main para crear la rama de backup.");
    return;
  }
  const mainJson = await mainRef.json();
  const sha = mainJson.object.sha;
  const createRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    console.warn("[backup] No se pudo crear la rama de backup:", createRes.status, text.slice(0, 200));
  } else {
    console.log(`[backup] Rama "${BRANCH}" creada para guardar copias de seguridad.`);
  }
}

async function restoreFromGitHub() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!enabled()) {
    console.log("[backup] Copia de seguridad remota desactivada (faltan GITHUB_BACKUP_REPO / GITHUB_BACKUP_TOKEN).");
    return;
  }
  try {
    await ensureBranchExists();
    const res = await fetch(contentsUrl(), { headers: headers() });
    if (res.status === 404) {
      console.log("[backup] Todavía no hay ninguna copia de seguridad remota; se creará una base de datos nueva.");
      return;
    }
    if (!res.ok) {
      console.warn("[backup] No se pudo restaurar la copia remota (status " + res.status + "). Se usará una base de datos nueva.");
      return;
    }
    const json = await res.json();
    const buf = Buffer.from(json.content, "base64");
    fs.writeFileSync(DB_PATH, buf);
    console.log(`[backup] Base de datos restaurada desde GitHub (${(buf.length / 1024).toFixed(1)} KB).`);
  } catch (err) {
    console.warn("[backup] Error restaurando desde GitHub:", err.message);
  }
}

let backing = false;
async function backupToGitHub(reason) {
  if (!enabled()) return;
  if (!fs.existsSync(DB_PATH)) return;
  if (backing) return;
  backing = true;
  try {
    const content = fs.readFileSync(DB_PATH).toString("base64");
    let sha;
    const getRes = await fetch(contentsUrl(), { headers: headers() });
    if (getRes.ok) {
      const j = await getRes.json();
      sha = j.sha;
    }
    const body = {
      message: `Backup automático (${reason || "periódico"}) — ${new Date().toISOString()}`,
      content,
      branch: BRANCH,
    };
    if (sha) body.sha = sha;
    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      const text = await putRes.text();
      console.warn("[backup] Fallo al subir la copia de seguridad:", putRes.status, text.slice(0, 300));
    } else {
      console.log(`[backup] Copia de seguridad subida a GitHub (${reason}).`);
    }
  } catch (err) {
    console.warn("[backup] Error subiendo la copia de seguridad:", err.message);
  } finally {
    backing = false;
  }
}

function scheduleBackups() {
  if (!enabled()) return;
  const timer = setInterval(() => backupToGitHub("periódico"), INTERVAL_MIN * 60 * 1000);
  if (timer.unref) timer.unref();

  let shuttingDown = false;
  const finalBackup = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[backup] Señal ${signal} recibida, subiendo copia final...`);
    backupToGitHub(signal).finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => finalBackup("SIGTERM"));
  process.on("SIGINT", () => finalBackup("SIGINT"));
}

module.exports = { restoreFromGitHub, backupToGitHub, scheduleBackups, enabled, DB_PATH };
