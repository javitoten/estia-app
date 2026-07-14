const fs = require("fs");
const path = require("path");
const db = require("../db");
const { layout } = require("../render");
const { requirePage, requireApi, sendHtml, sendJson } = require("../guard");
const { uuid, parseBody, escapeHtml, formatDate, formatCurrency } = require("../utils");
const { statusBadge, categoryBadge, emptyState, modal } = require("../components");
const { runOcr, extractInvoiceData } = require("../ocr");

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");

function extFor(mimetype) {
  if (mimetype === "application/pdf") return ".pdf";
  if (mimetype === "image/png") return ".png";
  return ".jpg";
}

function categoriesOptions(companyId, selected) {
  const cats = db.prepare("SELECT * FROM categories WHERE company_id=? ORDER BY name").all(companyId);
  return cats.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
}
function propertiesOptions(companyId, selected) {
  const props = db.prepare("SELECT * FROM properties WHERE company_id=? AND status='active' ORDER BY name").all(companyId);
  return props.map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}

module.exports = ({ get, post, del }) => {
  // ---------------- LIST ----------------
  get("/invoices", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const filter = req.query.status || "all";
    let q = `SELECT i.*, p.name as property_name, c.name as cat_name, c.color as cat_color FROM invoices i
      LEFT JOIN properties p ON p.id = i.property_id LEFT JOIN categories c ON c.id = i.category_id
      WHERE i.company_id = ?`;
    const params = [companyId];
    if (filter === "pending") { q += " AND i.status = 'pending_review'"; }
    if (filter === "confirmed") { q += " AND i.status = 'confirmed'"; }
    q += " ORDER BY i.created_at DESC";
    const rows = db.prepare(q).all(...params);
    const pendingCount = db.prepare("SELECT COUNT(*) c FROM invoices WHERE company_id=? AND status='pending_review'").get(companyId).c;

    const trs = rows.map((r) => `
      <tr data-row>
        <td><a class="row-link" href="/invoices/${r.id}">${escapeHtml(r.provider_name || "Sin proveedor")}</a></td>
        <td>${r.property_name ? escapeHtml(r.property_name) : `<span class="text-gray">Sin asignar</span>`}</td>
        <td>${formatDate(r.issue_date)}</td>
        <td>${categoryBadge(r.cat_name, r.cat_color)}</td>
        <td>${formatCurrency(r.amount)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${actionsCell(r.id)}</td>
      </tr>`).join("");

    function actionsCell(id) {
      return `<button class="btn btn-ghost btn-sm" data-delete="/api/invoices/${id}" data-confirm="¿Eliminar esta factura?">✕</button>`;
    }

    const content = `
      <div class="pill-tabs mb-16">
        <a class="pill-tab ${filter === "all" ? "active" : ""}" href="/invoices">Todas</a>
        <a class="pill-tab ${filter === "pending" ? "active" : ""}" href="/invoices?status=pending">Por revisar ${pendingCount ? `(${pendingCount})` : ""}</a>
        <a class="pill-tab ${filter === "confirmed" ? "active" : ""}" href="/invoices?status=confirmed">Confirmadas</a>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Proveedor</th><th>Vivienda</th><th>Fecha</th><th>Categoría</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
          <tbody>${trs || `<tr><td colspan="7">${emptyState("No hay facturas todavía. Sube la primera.")}</td></tr>`}</tbody>
        </table></div>
      </div>`;

    sendHtml(res, 200, layout({
      title: "Facturas", subtitle: "Bandeja de facturas de toda la cartera",
      active: "invoices", user: req.session.user, company: req.session.company,
      actions: `<a class="btn btn-primary" href="/invoices/new">+ Subir factura</a>`,
      content,
    }));
  }));

  // ---------------- UPLOAD PAGE ----------------
  get("/invoices/new", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const preselect = req.query.property_id || "";
    const content = `
    <div class="grid grid-2" style="grid-template-columns: 1fr;max-width:640px;">
      <div class="card">
        <div class="field"><label>Vivienda (opcional — la IA puede sugerirla)</label>
          <select id="propertySelect">${preselect ? "" : `<option value="">— Sugerir automáticamente —</option>`}${propertiesOptions(companyId, preselect)}</select>
        </div>
        <div class="dropzone" id="dropzone">
          ${require("../icons").icon("upload", 32)}
          <div><strong>Arrastra un archivo o haz clic para subir</strong></div>
          <div class="types">PDF · Foto · Escaneo · Ticket (JPG, PNG o PDF, máx. 20MB)</div>
        </div>
        <input type="file" id="fileInput" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
        <div id="uploadStatus" class="mt-16" style="display:none;">
          <div class="flex items-center gap-8"><div class="spinner"></div><span id="uploadStatusText">Procesando documento con IA…</span></div>
        </div>
      </div>
    </div>
    <script>
      const dz = document.getElementById('dropzone');
      const fileInput = document.getElementById('fileInput');
      dz.addEventListener('click', () => fileInput.click());
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
      fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

      function handleFile(file) {
        document.getElementById('uploadStatus').style.display = 'block';
        dz.style.opacity = '0.5';
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result.split(',')[1];
          try {
            const data = await apiCall('/api/invoices/upload', 'POST', {
              filename: file.name, mimetype: file.type || 'image/jpeg', data: base64,
              property_id: document.getElementById('propertySelect').value,
            });
            window.location.href = '/invoices/' + data.id;
          } catch (err) {
            toast(err.message, 'error');
            dz.style.opacity = '1';
            document.getElementById('uploadStatus').style.display = 'none';
          }
        };
        reader.readAsDataURL(file);
      }
    </script>
    <style>.spinner{width:16px;height:16px;border:2.5px solid #E4E7EC;border-top-color:#0E7C6B;border-radius:50%;animation:spin .7s linear infinite;}@keyframes spin{to{transform:rotate(360deg);}}</style>
    `;
    sendHtml(res, 200, layout({
      title: "Nueva factura", subtitle: "Sube un documento y la IA lo completará por ti",
      active: "invoices", user: req.session.user, company: req.session.company,
      content, wide: false,
    }));
  }));

  // ---------------- UPLOAD API ----------------
  post("/api/invoices/upload", requireApi(async (req, res) => {
    const b = await parseBody(req);
    const companyId = req.session.company.id;
    if (!b.data || !b.filename) return sendJson(res, 400, { error: "No se ha recibido ningún archivo." });
    const buffer = Buffer.from(b.data, "base64");
    if (buffer.length > 20 * 1024 * 1024) return sendJson(res, 400, { error: "El archivo supera los 20MB." });

    const companyDir = path.join(UPLOADS_DIR, companyId);
    if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });
    const storedName = uuid() + extFor(b.mimetype);
    const filePath = path.join(companyDir, storedName);
    fs.writeFileSync(filePath, buffer);

    const text = runOcr(filePath, b.mimetype);
    const extracted = extractInvoiceData(companyId, text);

    const propertyId = b.property_id || extracted.property.propertyId || null;
    const id = uuid();
    db.prepare(`INSERT INTO invoices (id, company_id, property_id, provider_id, provider_name, cif, issue_date, amount, tax_base, tax_rate, tax_amount, category_id, payment_method, concept, status, file_path, ocr_text, confidence, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending_review', ?, ?, ?, 'upload')`).run(
      id, companyId, propertyId, extracted.category.providerId, extracted.providerName, extracted.cif,
      extracted.issueDate, extracted.amount || 0, extracted.taxBase, extracted.taxRate, extracted.taxAmount,
      extracted.category.categoryId, "card", extracted.category.categoryName + (extracted.providerName ? " — " + extracted.providerName : ""),
      "/uploads/" + companyId + "/" + storedName, text.slice(0, 4000), extracted.confidence
    );
    sendJson(res, 201, { id, extracted: { ...extracted, propertyId } });
  }));

  // ---------------- DETAIL / REVIEW ----------------
  get("/invoices/:id", requirePage(async (req, res) => {
    const companyId = req.session.company.id;
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND company_id = ?").get(req.params.id, companyId);
    if (!inv) { res.writeHead(404); return res.end("Factura no encontrada"); }
    const openIncidents = inv.property_id ? db.prepare("SELECT * FROM incidents WHERE company_id=? AND property_id=? AND status != 'resolved'").all(companyId, inv.property_id) : [];

    const confPct = Math.round((inv.confidence || 0) * 100);
    const isPending = inv.status === "pending_review";

    const content = `
    <div class="grid grid-2" style="grid-template-columns: 1fr 1fr; align-items:start;">
      <div class="card">
        <div class="card-title">Documento original</div>
        ${inv.file_path ? (
          inv.file_path.endsWith(".pdf")
            ? `<a class="btn btn-secondary" href="${inv.file_path}" target="_blank">Abrir PDF original</a>`
            : `<img src="${inv.file_path}" style="width:100%;border-radius:10px;border:1px solid var(--border);">`
        ) : emptyState("Sin documento adjunto (factura manual).")}
        ${inv.ocr_text ? `<div class="mt-16"><div class="text-sm text-gray mb-16" style="margin-bottom:6px;">Texto detectado por OCR:</div>
          <div style="background:#F7F8FA;border-radius:10px;padding:12px;font-size:11.5px;color:#4B5563;white-space:pre-wrap;max-height:180px;overflow:auto;">${escapeHtml(inv.ocr_text)}</div></div>` : ""}
      </div>
      <div class="card">
        <div class="card-title">
          ${isPending ? "Revisión de datos extraídos por IA" : "Datos de la factura"}
          ${isPending ? `<span class="badge badge-teal">Confianza ${confPct}%</span>` : statusBadge(inv.status)}
        </div>
        <form id="invForm" data-api="/api/invoices/${inv.id}/confirm" data-method="POST" data-success="Factura confirmada" data-redirect="/invoices/${inv.id}">
          <div class="field"><label>Empresa emisora</label><input type="text" name="provider_name" value="${escapeHtml(inv.provider_name || "")}" ${!isPending ? "disabled" : ""}></div>
          <div class="field-row">
            <div class="field"><label>CIF</label><input type="text" name="cif" value="${escapeHtml(inv.cif || "")}" ${!isPending ? "disabled" : ""}></div>
            <div class="field"><label>Fecha</label><input type="date" name="issue_date" value="${inv.issue_date || ""}" ${!isPending ? "disabled" : ""}></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Importe (€)</label><input type="number" step="0.01" name="amount" value="${inv.amount || ""}" ${!isPending ? "disabled" : ""}></div>
            <div class="field"><label>Método de pago</label>
              <select name="payment_method" ${!isPending ? "disabled" : ""}>
                <option value="card" ${inv.payment_method === "card" ? "selected" : ""}>Tarjeta</option>
                <option value="transfer" ${inv.payment_method === "transfer" ? "selected" : ""}>Transferencia</option>
                <option value="cash" ${inv.payment_method === "cash" ? "selected" : ""}>Efectivo</option>
              </select>
            </div>
          </div>
          <div class="field"><label>Categoría sugerida</label>
            <select name="category_id" ${!isPending ? "disabled" : ""}>${categoriesOptions(companyId, inv.category_id)}</select>
          </div>
          <div class="field"><label>Vivienda</label>
            <select name="property_id" ${!isPending ? "disabled" : ""}>
              <option value="">— Sin asignar —</option>${propertiesOptions(companyId, inv.property_id)}
            </select>
          </div>
          <div class="field"><label>Concepto</label><input type="text" name="concept" value="${escapeHtml(inv.concept || "")}" ${!isPending ? "disabled" : ""}></div>
          ${isPending && openIncidents.length ? `
          <div class="field"><label>¿Vinculada a una incidencia abierta?</label>
            <select name="incident_id">
              <option value="">— No —</option>
              ${openIncidents.map((i) => `<option value="${i.id}">${escapeHtml(i.title)}</option>`).join("")}
            </select>
          </div>` : ""}
          ${isPending ? `<button type="submit" class="btn btn-primary" style="width:100%;">${require("../icons").icon("check", 15)} Confirmar y guardar</button>` : ""}
        </form>
        ${!isPending ? `<button class="btn btn-secondary mt-16" onclick="apiCall('/api/invoices/${inv.id}/reopen','POST').then(()=>location.reload())">Editar de nuevo</button>` : ""}
      </div>
    </div>`;

    sendHtml(res, 200, layout({
      title: "Revisión de factura", subtitle: escapeHtml(inv.provider_name || "Factura sin proveedor"),
      active: "invoices", user: req.session.user, company: req.session.company,
      content,
    }));
  }));

  // ---------------- CONFIRM API ----------------
  post("/api/invoices/:id/confirm", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND company_id = ?").get(req.params.id, companyId);
    if (!inv) return sendJson(res, 404, { error: "Factura no encontrada" });
    const b = await parseBody(req);
    const amount = Number(b.amount) || inv.amount;
    db.prepare(`UPDATE invoices SET provider_name=?, cif=?, issue_date=?, amount=?, payment_method=?, category_id=?, property_id=?, concept=?, status='confirmed' WHERE id=?`).run(
      b.provider_name || inv.provider_name, b.cif || inv.cif, b.issue_date || inv.issue_date, amount,
      b.payment_method || inv.payment_method, b.category_id || inv.category_id, b.property_id || inv.property_id || null,
      b.concept || inv.concept, inv.id
    );
    if (b.property_id) {
      const expId = uuid();
      db.prepare("INSERT INTO expenses (id, company_id, property_id, invoice_id, category_id, amount, date, description) VALUES (?,?,?,?,?,?,?,?)").run(
        expId, companyId, b.property_id, inv.id, b.category_id || inv.category_id, amount, b.issue_date || inv.issue_date || new Date().toISOString().slice(0, 10),
        b.concept || inv.concept
      );
    }
    if (b.incident_id) {
      db.prepare("UPDATE incidents SET status='resolved', resolved_at=datetime('now'), invoice_id=? WHERE id=? AND company_id=?").run(inv.id, b.incident_id, companyId);
      db.prepare("UPDATE invoices SET incident_id=? WHERE id=?").run(b.incident_id, inv.id);
    }
    sendJson(res, 200, { id: inv.id });
  }));

  post("/api/invoices/:id/reopen", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND company_id = ?").get(req.params.id, companyId);
    if (!inv) return sendJson(res, 404, { error: "No encontrada" });
    db.prepare("UPDATE invoices SET status='pending_review' WHERE id=?").run(inv.id);
    db.prepare("DELETE FROM expenses WHERE invoice_id=?").run(inv.id);
    sendJson(res, 200, { ok: true });
  }));

  del("/api/invoices/:id", requireApi(async (req, res) => {
    const companyId = req.session.company.id;
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND company_id = ?").get(req.params.id, companyId);
    if (!inv) return sendJson(res, 404, { error: "No encontrada" });
    db.prepare("DELETE FROM expenses WHERE invoice_id=?").run(inv.id);
    db.prepare("DELETE FROM invoices WHERE id=?").run(inv.id);
    sendJson(res, 200, { ok: true });
  }));
};
