// ---------- Mobile sidebar ----------
(function () {
  const menuBtn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      sidebar.classList.add("open");
      backdrop.classList.add("open");
    });
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("open");
    });
  }
})();

// ---------- Toast ----------
function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  if (!el) return;
  const item = document.createElement("div");
  item.className = "toast-item " + type;
  item.textContent = msg;
  el.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

// ---------- Modal helpers ----------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("open");
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("open");
}
document.addEventListener("click", (e) => {
  if (e.target.classList && e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("open");
  }
});

// ---------- Generic API helpers ----------
async function apiCall(url, method = "GET", body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    throw new Error((data && data.error) || ("Error " + res.status));
  }
  return data;
}

// Delete buttons: data-delete="/api/xxx/id" data-confirm="¿Seguro?"
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-delete]");
  if (!btn) return;
  e.preventDefault();
  const msg = btn.getAttribute("data-confirm") || "¿Seguro que quieres eliminarlo?";
  if (!confirm(msg)) return;
  try {
    await apiCall(btn.getAttribute("data-delete"), "DELETE");
    toast("Eliminado correctamente");
    const row = btn.closest("[data-row]");
    if (row) row.remove(); else setTimeout(() => location.reload(), 400);
  } catch (err) {
    toast(err.message, "error");
  }
});

// Generic form -> JSON POST/PUT via fetch (form has data-api="/api/x" data-method="POST")
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.hasAttribute("data-api")) return;
  e.preventDefault();
  const url = form.getAttribute("data-api");
  const method = form.getAttribute("data-method") || "POST";
  const fd = new FormData(form);
  const body = {};
  fd.forEach((v, k) => { body[k] = v; });
  const submitBtn = form.querySelector("[type=submit]");
  if (submitBtn) submitBtn.disabled = true;
  try {
    const result = await apiCall(url, method, body);
    toast(form.getAttribute("data-success") || "Guardado correctamente");
    const redirect = form.getAttribute("data-redirect");
    if (redirect) {
      window.location.href = redirect.replace("{id}", result && result.id ? result.id : "");
    } else {
      setTimeout(() => location.reload(), 500);
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ---------- AI assistant panel ----------
(function () {
  const fab = document.getElementById("aiFab");
  const panel = document.getElementById("aiPanel");
  const closeBtn = document.getElementById("aiClose");
  const input = document.getElementById("aiInput");
  const sendBtn = document.getElementById("aiSend");
  const messages = document.getElementById("aiMessages");
  const suggestions = document.getElementById("aiSuggestions");
  if (!fab) return;

  fab.addEventListener("click", () => panel.classList.add("open"));
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));

  function addMsg(text, who) {
    const div = document.createElement("div");
    div.className = "ai-msg " + who;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function ask(q) {
    if (!q.trim()) return;
    addMsg(q, "user");
    input.value = "";
    if (suggestions) suggestions.style.display = "none";
    addMsg("Pensando…", "bot");
    try {
      const data = await apiCall("/api/ai/ask", "POST", { question: q });
      messages.lastChild.textContent = data.answer;
    } catch (err) {
      messages.lastChild.textContent = "No he podido procesar la pregunta: " + err.message;
    }
  }

  sendBtn.addEventListener("click", () => ask(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(input.value); });
  document.querySelectorAll(".ai-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => ask(btn.textContent));
  });
})();
