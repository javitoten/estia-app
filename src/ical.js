// src/ical.js
//
// Sincronización de calendarios de Airbnb / Booking / Vrbo vía iCal.
// Estas plataformas ofrecen, sin necesidad de aprobación ni API de pago,
// una URL de calendario (formato .ics) por cada anuncio con las fechas
// ocupadas. La importamos y creamos/actualizamos reservas automáticamente,
// que además aparecen solas en el Calendario y en Ingresos si se les añade
// importe manualmente.

const db = require("./db");
const { uuid } = require("./utils");

function unfoldLines(text) {
  return text.replace(/\r\n/g, "\n").split("\n").reduce((acc, line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && acc.length) {
      acc[acc.length - 1] += line.slice(1);
    } else {
      acc.push(line);
    }
    return acc;
  }, []);
}

function parseIcsDate(val) {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}`;
}

function parseIcs(text) {
  const lines = unfoldLines(text);
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    let key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    key = key.split(";")[0];
    if (key === "UID") cur.uid = value;
    else if (key === "DTSTART") cur.start = parseIcsDate(value);
    else if (key === "DTEND") cur.end = parseIcsDate(value);
    else if (key === "SUMMARY") cur.summary = value.replace(/\\,/g, ",").replace(/\\n/gi, " ").replace(/\\\\/g, "\\");
  }
  return events.filter((e) => e.start && e.end);
}

async function fetchIcsText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "estia-app-ical-sync" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}

const CHANNEL_LABEL = { airbnb: "Airbnb", booking: "Booking", vrbo: "Vrbo", other: "Otro" };

async function syncFeed(feed) {
  const text = await fetchIcsText(feed.url);
  const events = parseIcs(text);
  let created = 0, updated = 0;
  const seenUids = [];
  for (const ev of events) {
    const uidKey = ev.uid || `${ev.start}_${ev.end}`;
    seenUids.push(uidKey);
    const existing = db.prepare("SELECT * FROM reservations WHERE company_id=? AND property_id=? AND external_uid=?").get(feed.company_id, feed.property_id, uidKey);
    const label = CHANNEL_LABEL[feed.channel] || "Canal externo";
    const guestName = (ev.summary && !/^(not available|blocked|closed)/i.test(ev.summary.trim())) ? ev.summary : `Reserva ${label}`;
    if (existing) {
      db.prepare("UPDATE reservations SET checkin=?, checkout=?, guest_name=? WHERE id=?").run(ev.start, ev.end, guestName, existing.id);
      updated++;
    } else {
      db.prepare("INSERT INTO reservations (id, company_id, property_id, channel, guest_name, checkin, checkout, amount, status, external_uid, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
        uuid(), feed.company_id, feed.property_id, label, guestName, ev.start, ev.end, 0, "confirmed", uidKey, "ical"
      );
      created++;
    }
  }
  db.prepare("UPDATE ical_feeds SET last_synced_at=datetime('now'), last_status=?, events_count=? WHERE id=?").run(
    `ok`, events.length, feed.id
  );
  return { created, updated, total: events.length };
}

async function syncAllFeeds(companyId) {
  const feeds = companyId
    ? db.prepare("SELECT * FROM ical_feeds WHERE company_id=?").all(companyId)
    : db.prepare("SELECT * FROM ical_feeds").all();
  const results = [];
  let created = 0, updated = 0, errors = 0;
  for (const feed of feeds) {
    try {
      const r = await syncFeed(feed);
      created += r.created; updated += r.updated;
      results.push({ id: feed.id, ok: true, ...r });
    } catch (err) {
      errors++;
      db.prepare("UPDATE ical_feeds SET last_synced_at=datetime('now'), last_status=? WHERE id=?").run("error:" + String(err.message).slice(0, 150), feed.id);
      results.push({ id: feed.id, ok: false, error: err.message });
    }
  }
  return { created, updated, errors, feeds: results.length, results };
}

function scheduleIcalSync(intervalMinutes) {
  const min = Number(intervalMinutes || process.env.ICAL_SYNC_INTERVAL_MIN || 60);
  const timer = setInterval(() => {
    syncAllFeeds().catch((err) => console.warn("[ical] Error en sincronización periódica:", err.message));
  }, min * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { parseIcs, fetchIcsText, syncFeed, syncAllFeeds, scheduleIcalSync };
