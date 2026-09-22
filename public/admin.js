const state = { key: sessionStorage.getItem("admin-key") || "", products: [], editingId: null };
const $ = (selector) => document.querySelector(selector);

function setStatus(selector, message, error = false) {

  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("error", error);
}

async function api(path, options = {}) {
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.key}`, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request gagal");
  return data;
}

function showApp() {
  $("#gate").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#logout").classList.remove("hidden");
  loadSettings(); loadProducts();
}

async function login() {
  state.key = $("#dashboard-key").value.trim();
  try { await api("/settings"); sessionStorage.setItem("admin-key", state.key); showApp(); }
  catch (error) { setStatus("#gate-status", error.message, true); }
}

async function loadSettings() {
  try {
    const settings = await api("/settings");
    for (const [name, value] of Object.entries(settings)) { const field = $(`[name="${name}"]`); if (field) field.value = value || ""; }
  } catch (error) { setStatus("#settings-status", error.message, true); }
}

async function saveSettings(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const payload = Object.fromEntries(form.entries());
  try { await api("/settings", { method: "PUT", body: JSON.stringify(payload) }); $("[name=midtransServerKey]").value = ""; setStatus("#settings-status", "Pengaturan tersimpan."); }
  catch (error) { setStatus("#settings-status", error.message, true); }
}

async function loadProducts() {
  try { state.products = (await api("/products")).products; renderProducts(); }
  catch (error) { setStatus("#products-status", error.message, true); }
}

function renderProducts() {
  $("#products").innerHTML = state.products.length ? state.products.map((product) => `
    <article class="product"><div class="product-head"><strong>${escapeHtml(product.title)}</strong><div><button class="secondary edit-product" data-id="${product.id}">Edit</button> <button class="danger delete-product" data-id="${product.id}">Hapus</button></div></div>
    <div class="meta">${escapeHtml(product.sku)} · Rp${Number(product.discount || product.price).toLocaleString("id-ID")} · ${product.variants.length} varian</div>
    <div>${product.variants.map((variant) => `<span>${escapeHtml(variant.color)}${variant.sizeType ? ` / ${escapeHtml(variant.sizeType)}` : ""}: ${variant.stock}${variant.imageUrl ? " · gambar siap" : ""}</span>`).join(" · ") || "Belum ada varian"}</div></article>`).join("") : "<p class=meta>Belum ada produk.</p>";
  document.querySelectorAll(".edit-product").forEach((button) => button.addEventListener("click", () => openEditor(state.products.find((item) => item.id === button.dataset.id))));
  document.querySelectorAll(".delete-product").forEach((button) => button.addEventListener("click", () => deleteProduct(button.dataset.id)));
}

function openEditor(product = null) {
  state.editingId = product?.id || null; $("#product-editor").classList.remove("hidden"); $("#editor-title").textContent = product ? "Edit produk" : "Produk baru";
  const form = $("#product-form"); form.reset(); $("#variants").innerHTML = "";
  if (product) for (const [name, value] of Object.entries(product)) { const field = form.elements[name]; if (field) field.value = value ?? ""; }
  (product?.variants || [{ color: "", sizeType: "", stock: 0 }]).forEach(addVariant);
  $("#product-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function addVariant(variant = { color: "", sizeType: "", stock: 0 }) {
  const row = document.createElement("div"); row.className = "variant";
  row.innerHTML = `<input aria-label="Warna" placeholder="Warna" value="${escapeAttribute(variant.color)}" /><input aria-label="Ukuran atau tipe" placeholder="Ukuran / tipe" value="${escapeAttribute(variant.sizeType)}" /><input aria-label="URL gambar varian" type="url" placeholder="URL gambar varian" value="${escapeAttribute(variant.imageUrl || "")}" /><input aria-label="Stok" type="number" min="0" placeholder="Stok" value="${Number(variant.stock) || 0}" /><button type="button" aria-label="Hapus varian">×</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove()); $("#variants").append(row);
}

async function saveProduct(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const variants = [...document.querySelectorAll("#variants .variant")].map((row) => { const fields = row.querySelectorAll("input"); return { color: fields[0].value.trim(), sizeType: fields[1].value.trim(), imageUrl: fields[2].value.trim(), stock: Number(fields[3].value) || 0 }; }).filter((variant) => variant.color);
  const payload = { title: form.get("title"), sku: form.get("sku"), category: form.get("category"), price: Number(form.get("price")), discount: Number(form.get("discount")) || 0, image: form.get("image"), description: form.get("description"), variants };
  try { await api(state.editingId ? `/products/${state.editingId}` : "/products", { method: state.editingId ? "PUT" : "POST", body: JSON.stringify(payload) }); setStatus("#editor-status", "Produk tersimpan."); await loadProducts(); setTimeout(closeEditor, 400); }
  catch (error) { setStatus("#editor-status", error.message, true); }
}

async function deleteProduct(id) {
  if (!confirm("Hapus produk ini?")) return;
  try { await api(`/products/${id}`, { method: "DELETE" }); await loadProducts(); } catch (error) { setStatus("#products-status", error.message, true); }
}

function closeEditor() { state.editingId = null; $("#product-editor").classList.add("hidden"); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }

$("#login").addEventListener("click", login); $("#settings-form").addEventListener("submit", saveSettings); $("#product-form").addEventListener("submit", saveProduct); $("#add-variant").addEventListener("click", () => addVariant()); $("#new-product").addEventListener("click", () => openEditor()); $("#cancel-product").addEventListener("click", closeEditor);
$("#logout").addEventListener("click", () => { sessionStorage.removeItem("admin-key"); location.reload(); });
if (state.key) { $("#dashboard-key").value = state.key; login(); }