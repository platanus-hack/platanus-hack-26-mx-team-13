/* ============================================================================
 * Facturín — Recipe Recorder (paste-in-console snippet)
 * ----------------------------------------------------------------------------
 * Authoring tool: open a merchant's facturación portal in your OWN Chrome, open
 * DevTools (F12) → Console, paste this whole file, hit Enter. A panel appears
 * top-right. Do the WHOLE flow (close popups, fill the lookup gate, click
 * "siguiente", fill the fiscal form). To capture the final submit WITHOUT firing
 * it, click "🎯 Marcar Enviar" then click the real submit button (the click is
 * blocked, just recorded). Then "💾 Guardar receta" → the recipe JSON is copied to
 * your clipboard. Drop it in the shared channel; Claude bulk-seeds + verifies.
 *
 * Output shape == models/MerchantRecipe.js so replay_recipe (Playwright, 0 AI)
 * follows it directly. Captures multi-strategy selectors (id/name/aria/placeholder/
 * css/xpath/text) so replay is resilient.
 * ========================================================================== */
(() => {
  if (window.__FACT_REC__) {
    window.__FACT_REC__.panel.style.display = "block";
    console.log("[facturin] recorder already running");
    return;
  }

  const KEY_ATTR = "data-fact-k";
  const DATA_KEYS = [
    "rfc", "businessName", "taxRegime", "taxRegimeFormatted", "postalCode",
    "cfdiUsage", "paymentMethod", "email", "folio", "total", "subtotal",
    "date", "sucursal", "puntoVenta", "terminal",
  ];

  // label/placeholder/name → billing dataKey. First match wins.
  const RULES = [
    [/uso.*cfdi/i, "cfdiUsage"],
    [/forma.*pago|m[eé]todo.*pago/i, "paymentMethod"],
    [/raz[oó]n\s*social|nombre.*(fiscal|raz)/i, "businessName"],
    [/r[eé]gimen/i, "taxRegime"],
    [/c[oó]digo\s*postal|^\s*c\.?\s*p\.?\s*$|codigo postal|domicilio.*postal/i, "postalCode"],
    [/correo|e-?mail/i, "email"],
    [/sub\s*total/i, "subtotal"],
    [/total|importe|monto/i, "total"],
    [/folio/i, "folio"],
    [/punto.*venta|^\s*pv\b|caja|terminal/i, "puntoVenta"],
    [/sucursal|tienda|establecimiento/i, "sucursal"],
    [/fecha/i, "date"],
    [/r\.?f\.?c\.?|rfc/i, "rfc"],
  ];

  const norm = (s) =>
    (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .trim().toLowerCase().replace(/\s+/g, " ");

  let counter = 0;
  const keyFor = (el) => {
    let k = el.getAttribute(KEY_ATTR);
    if (!k) { k = "k" + ++counter; try { el.setAttribute(KEY_ATTR, k); } catch (e) {} }
    return k;
  };

  const cssEsc = (s) =>
    window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return "#" + cssEsc(el.id);
    const parts = [];
    let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      if (node.id) { parts.unshift("#" + cssEsc(node.id)); break; }
      let sel = node.tagName.toLowerCase();
      const name = node.getAttribute && node.getAttribute("name");
      if (name) { sel += `[name="${name}"]`; parts.unshift(sel); node = node.parentElement; depth++; continue; }
      const sibs = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [];
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(sel);
      node = node.parentElement; depth++;
    }
    return parts.join(" > ");
  }

  function xPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const segs = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let i = 1, sib = node.previousElementSibling;
      while (sib) { if (sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
      segs.unshift(`${node.tagName.toLowerCase()}[${i}]`);
      node = node.parentElement;
    }
    return "/" + segs.join("/");
  }

  const attr = (el, a) => { const v = el.getAttribute && el.getAttribute(a); return v == null || v === "" ? null : v; };

  function selectorFor(el) {
    return {
      css: cssPath(el),
      xpath: xPath(el),
      text: (el.innerText || el.textContent || "").trim().slice(0, 60) || null,
      attributes: {
        id: attr(el, "id"), name: attr(el, "name"),
        ariaLabel: attr(el, "aria-label"), placeholder: attr(el, "placeholder"),
        type: attr(el, "type"),
      },
    };
  }

  // Best-effort human label for an input/select.
  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEsc(el.id)}"]`);
      if (l && l.innerText) return l.innerText;
    }
    let p = el.closest("label");
    if (p && p.innerText) return p.innerText;
    const aria = attr(el, "aria-label") || attr(el, "placeholder") || attr(el, "name");
    if (aria) return aria;
    // previous sibling / parent's preceding text
    let prev = el.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
      if (prev.innerText && prev.innerText.trim()) return prev.innerText.trim();
    }
    const cont = el.parentElement;
    if (cont && cont.innerText) return cont.innerText.trim();
    return "";
  }

  function dataKeyFor(el) {
    const hay = norm(labelFor(el) + " " + (attr(el, "name") || "") + " " + (attr(el, "placeholder") || "") + " " + (attr(el, "id") || ""));
    for (const [re, key] of RULES) if (re.test(hay)) return key;
    return null;
  }

  const steps = [];           // ordered recorded steps (pre-distill)
  let submitSel = null;
  let markSubmit = false;

  function pushFillOrSelect(el, action) {
    const k = keyFor(el);
    const dataKey = dataKeyFor(el);
    const value = (el.value != null ? String(el.value) : "");
    // coalesce repeated input on the same element → latest value
    const existing = steps.find((s) => s._k === k && (s.action === "fill" || s.action === "select"));
    if (existing) { existing.value = value; existing.dataKey = dataKey; render(); return; }
    steps.push({ _k: k, action, selector: selectorFor(el), dataKey, value, description: (labelFor(el) || "").slice(0, 80) });
    render();
  }

  function onClick(e) {
    const el = e.target.closest("button, a, [role=button], input[type=submit], input[type=button], [onclick]") || e.target;
    if (!el || el.closest("#fact-rec-panel")) return;
    if (markSubmit) {
      e.preventDefault(); e.stopPropagation();
      submitSel = selectorFor(el); markSubmit = false;
      console.log("[facturin] submit button captured:", submitSel.text);
      render();
      return;
    }
    steps.push({ _k: keyFor(el), action: "click", selector: selectorFor(el), dataKey: null, value: null, description: ((el.innerText || el.value || "click").trim()).slice(0, 80) });
    render();
  }
  function onChange(e) {
    const el = e.target;
    if (!el || !el.tagName || el.closest("#fact-rec-panel")) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return pushFillOrSelect(el, "select");
    if (tag === "input" || tag === "textarea") {
      const t = (el.type || "text").toLowerCase();
      if (["checkbox", "radio", "submit", "button", "file"].includes(t)) return;
      pushFillOrSelect(el, "fill");
    }
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("input", onChange, true);

  function buildRecipe() {
    const name = (document.getElementById("fact-rec-name") || {}).value || "";
    const rfc = (document.getElementById("fact-rec-rfc") || {}).value || "";
    const ordered = steps.map((s, i) => {
      const step = { order: i + 1, action: s.action, selector: s.selector, dataKey: s.dataKey || null, staticValue: null, description: s.description || null };
      // staticValue ONLY for merchant-fixed selects/values with no dataKey (NEVER free-text user data).
      if ((s.action === "select") && !s.dataKey && s.value) step.staticValue = s.value;
      return step;
    });
    return {
      merchantName: name, normalizedName: norm(name),
      rfcEmisor: rfc ? rfc.trim().toUpperCase() : null,
      invoiceUrl: location.origin + location.pathname,
      recordedVia: "human", version: 1, isActive: true,
      steps: ordered, submitButtonSelector: submitSel,
    };
  }

  function save() {
    const recipe = buildRecipe();
    const json = JSON.stringify(recipe, null, 2);
    try { navigator.clipboard.writeText(json); } catch (e) {}
    const ta = document.getElementById("fact-rec-out");
    if (ta) { ta.value = json; ta.style.display = "block"; ta.select(); }
    console.log("[facturin] RECIPE (copied to clipboard):\n", json);
  }

  // ---- panel UI ----
  const panel = document.createElement("div");
  panel.id = "fact-rec-panel";
  panel.style.cssText = "position:fixed;top:10px;right:10px;z-index:2147483647;background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:10px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4);width:260px";
  panel.innerHTML =
    '<div style="font-weight:700;margin-bottom:6px">🔴 Facturín Recorder</div>' +
    '<input id="fact-rec-name" placeholder="Comercio (ej. OXXO)" style="width:100%;margin-bottom:4px;padding:4px;border:0;border-radius:4px"/>' +
    '<input id="fact-rec-rfc" placeholder="RFC emisor (opcional)" style="width:100%;margin-bottom:6px;padding:4px;border:0;border-radius:4px"/>' +
    '<div id="fact-rec-count" style="margin-bottom:6px;color:#9f9">0 pasos · submit: no</div>' +
    '<button id="fact-rec-mark" style="width:100%;margin-bottom:4px;padding:6px;border:0;border-radius:4px;background:#f59e0b;color:#111;font-weight:700;cursor:pointer">🎯 Marcar Enviar</button>' +
    '<button id="fact-rec-save" style="width:100%;margin-bottom:4px;padding:6px;border:0;border-radius:4px;background:#22c55e;color:#111;font-weight:700;cursor:pointer">💾 Guardar receta</button>' +
    '<button id="fact-rec-undo" style="width:48%;padding:4px;border:0;border-radius:4px;background:#444;color:#fff;cursor:pointer">undo</button>' +
    '<button id="fact-rec-hide" style="width:48%;padding:4px;border:0;border-radius:4px;background:#444;color:#fff;cursor:pointer">ocultar</button>' +
    '<textarea id="fact-rec-out" style="display:none;width:100%;height:90px;margin-top:6px;font:10px monospace"></textarea>';
  document.documentElement.appendChild(panel);

  function render() {
    const c = document.getElementById("fact-rec-count");
    if (c) c.textContent = `${steps.length} pasos · submit: ${submitSel ? "✓" : "no"}${markSubmit ? " · CLICK EL BOTÓN ENVIAR" : ""}`;
  }
  panel.querySelector("#fact-rec-mark").onclick = (e) => { e.stopPropagation(); markSubmit = true; render(); };
  panel.querySelector("#fact-rec-save").onclick = (e) => { e.stopPropagation(); save(); };
  panel.querySelector("#fact-rec-undo").onclick = (e) => { e.stopPropagation(); steps.pop(); render(); };
  panel.querySelector("#fact-rec-hide").onclick = (e) => { e.stopPropagation(); panel.style.display = "none"; };

  window.__FACT_REC__ = { panel, steps, save, build: buildRecipe };
  console.log("[facturin] recorder ready — fill the form, then Guardar receta");
})();
