// fill_form — fill the invoicing form from scratch with a browsing agent (AI).
//
// The default fill path taken when no recipe exists (or a recipe replay failed).
// It drives the live Stagehand session over the merchant's CFDI form, mapping the
// user's billingData (#56) onto the form fields. CRITICAL: every field it fills is
// verified by reading the value back, and every verified interaction is recorded
// into state.recordedActions — that ordered list is the raw material distill_recipe
// turns into a reusable recipe, so each fill carries its { selector, dataKey } and
// each navigation click carries its { selector, staticValue }.
//
// Flow per step (CFDI portals are often multi-step: ticket data → fiscal data):
//   1. extract() a fill plan: which visible fields map to which billing dataKey,
//      whether this is the fiscal-data step, and the next / submit buttons.
//   2. For each mapped field with a value: observe() to locate it, then write our
//      value deterministically (never let the agent infer it — portals show
//      filled-in EXAMPLES it would copy) and verify by readback. Verified fills
//      are recorded as { action:'fill', selector, dataKey, fieldType }.
//   3. Detect the final submit button and STORE its selector — never click it
//      (a human confirms the submit downstream).
//   4. If this is not yet the fiscal step, click "next" (recorded as a click action)
//      and repeat, up to MAX_STEPS.
//
// The live browser is not carried on state (it is not serializable); this node
// reconnects to the keepAlive Browserbase session via reconnectSession(), the same
// path a human takeover uses. It disconnects when done WITHOUT releasing the
// session — later nodes (and HITL) still need it alive.

import { z } from "zod";
import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";
import { engineError } from "@/libs/engine/node";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import {
  assembleBillingData,
  getBillingValue,
  redactBillingData,
  BILLING_DATA_KEYS,
} from "@/libs/engine/billingData";
import { reconnectSession, getActivePage } from "@/libs/engine/session";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:fill-form" });

// CFDI portals split the form across a few pages at most (ticket data, then
// fiscal data). Cap the walk so a misread plan can never loop forever.
const MAX_STEPS = 5;

// Human-readable hint per recipe dataKey, embedded in the extract instruction so
// the model maps Spanish CFDI form fields onto our stable keys. The CFDI portals
// are in Spanish; the hints are too.
const DATA_KEY_HINTS = Object.freeze({
  rfc: "RFC del receptor (Registro Federal de Contribuyentes)",
  businessName: "Razón social / nombre fiscal del receptor",
  taxRegime: "Régimen fiscal (código SAT, p. ej. 626)",
  taxRegimeFormatted: "Régimen fiscal (nombre descriptivo)",
  postalCode: "Código postal del domicilio fiscal",
  cfdiUsage: "Uso de CFDI",
  paymentMethod: "Forma o método de pago",
  email: "Correo electrónico para recibir la factura",
  folio: "Folio / número de ticket o de la compra",
  total: "Total de la compra",
  subtotal: "Subtotal de la compra",
  date: "Fecha de la compra",
  sucursal: "Sucursal / tienda donde se hizo la compra",
  puntoVenta: "Punto de venta / caja / número de terminal (normalmente un número)",
  terminal: "Terminal / caja / número de transacción",
});

// The structured fill plan extract() returns for the current step. dataKey is
// constrained to the closed BILLING_DATA_KEYS set so a field always resolves to a
// known billing value.
const FILL_PLAN_SCHEMA = z.object({
  isFiscalStep: z
    .boolean()
    .describe(
      "True if this step asks for fiscal identity data (RFC, régimen fiscal, uso de CFDI, razón social)."
    ),
  fields: z
    .array(
      z.object({
        label: z
          .string()
          .describe("On-screen label, placeholder, or name of the field."),
        dataKey: z
          .enum(BILLING_DATA_KEYS)
          .describe("Which billing data key this field corresponds to."),
        fieldType: z
          .string()
          .describe("Control type: 'text', 'email', 'select', 'number', ..."),
      })
    )
    .describe("Visible fields on this step that map to a known billing dataKey."),
  nextStepButton: z
    .object({
      present: z.boolean(),
      label: z.string().nullable(),
    })
    .nullable()
    .describe("Button that advances to the next step of the form, if any."),
  submitButton: z
    .object({
      present: z.boolean(),
      label: z.string().nullable(),
    })
    .nullable()
    .describe("Final button that submits / generates the invoice, if present."),
});

/** Normalize a value for tolerant readback comparison. */
function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** normalize + strip diacritics, for tolerant <option> matching. */
function normalizeLoose(value) {
  return normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Choose the option on a <select> that best matches our value. Portals label branch
 * dropdowns freely ("ALSUPER PLUS BOSQUES" for our "BOSQUES", or a store number), so
 * an exact match is too strict. Try exact label then exact value, then fall back to
 * the closest real option by normalized containment / token overlap (placeholders
 * like "-- Seleccione --" have an empty value and are skipped). Throws when nothing
 * matches, so the field is left for a human rather than picking the wrong branch.
 */
async function selectOptionFuzzy(locator, valueStr) {
  // Exact label, then exact value — the common, unambiguous cases.
  try {
    await locator.selectOption({ label: valueStr });
    return;
  } catch {
    /* fall through */
  }
  try {
    await locator.selectOption(valueStr);
    return;
  } catch {
    /* fall through */
  }

  // Fuzzy: score every real option against our value and pick the best.
  const options = await locator
    .locator("option")
    .evaluateAll((els) =>
      els.map((o) => ({ value: o.value, label: (o.textContent || "").trim() }))
    );
  const want = normalizeLoose(valueStr);
  const wantTokens = want.split(" ").filter((t) => t.length >= 3);

  let best = null;
  let bestScore = 0;
  for (const o of options) {
    // Skip placeholders / empty options.
    if (!o.value || !o.label) continue;
    const lab = normalizeLoose(o.label);
    if (!lab) continue;
    let score = 0;
    if (lab === want) score = 100;
    else if (lab.includes(want) || want.includes(lab)) score = 50;
    else score = wantTokens.filter((t) => lab.includes(t)).length * 10;
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }

  if (!best || bestScore === 0) {
    throw new Error(`no <select> option matched "${valueStr}"`);
  }
  await locator
    .selectOption({ value: best.value })
    .catch(() => locator.selectOption({ label: best.label }));
}

/**
 * Stringify a billing value for typing into a form. Dates become YYYY-MM-DD;
 * numbers and everything else become their string form. Null/undefined → null.
 */
function formatValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Whether a field's read-back value confirms the write. Tolerant on purpose:
 * portals reformat input (currency masks, trimmed selects), so an exact match is
 * too strict — we accept equality or either string containing the other.
 */
function valueWasWritten(readback, expected) {
  const a = normalize(readback);
  const b = normalize(expected);
  if (!b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Read a field's current value back, trying input value then text content. */
async function readbackValue(stagehand, selector) {
  try {
    const locator = getActivePage(stagehand).locator(selector);
    const inputValue = await locator.inputValue();
    if (inputValue != null && inputValue !== "") return inputValue;
    const text = await locator.textContent();
    return (text || "").trim();
  } catch {
    return "";
  }
}

/**
 * Fill one field with OUR billing value. observe() is used ONLY to locate the
 * field (its selector); the value is then written deterministically with
 * Playwright. We never hand the value to the agent to type: portals often show a
 * filled-in EXAMPLE (a sample receipt with its own folio/fecha/total), and an
 * agent told to "fill this field" will happily copy that visible example instead
 * of the user's real data. Writing the value ourselves makes the example a
 * harmless guide, not a source of wrong input. The agent stays as a fallback for
 * inputs Playwright's fill() can't drive (custom widgets, masked/date pickers).
 * Returns the outcome (selector + whether it verified) or null if not found.
 */
async function fillField(stagehand, label, valueStr, fieldType) {
  const handles = await stagehand.observe(
    `Find the "${label}" input field on the form. Do not type anything into it.`
  );
  const handle = Array.isArray(handles) ? handles[0] : null;
  if (!handle || !handle.selector) return null;

  const { selector } = handle;
  const isSelect = String(fieldType).toLowerCase() === "select";

  // Primary path: write the value deterministically. Playwright's fill() clears
  // the field first, so any pre-filled example is replaced, not appended. A
  // <select> rejects fill() ("not an <input>") — choose the closest option instead
  // (exact label/value, then fuzzy), so a branch dropdown still resolves.
  try {
    const locator = getActivePage(stagehand).locator(selector);
    if (isSelect) {
      await selectOptionFuzzy(locator, valueStr);
    } else {
      await locator.fill(valueStr);
    }
  } catch {
    // Deterministic write failed (custom widget, masked/date input) — fall back
    // to the agent, re-observing with our value in the instruction so it has
    // something to type. Only reached for inputs fill() can't drive, so the
    // example-copying risk is marginal here.
    try {
      const valueHandles = await stagehand.observe(
        `Fill the "${label}" field with the value ${JSON.stringify(valueStr)}.`
      );
      const vh = Array.isArray(valueHandles) ? valueHandles[0] : null;
      if (vh) await stagehand.act(vh);
    } catch {
      // keep going to the readback verdict below
    }
  }

  const verified = valueWasWritten(
    await readbackValue(stagehand, selector),
    valueStr
  );
  return { selector, verified };
}

/**
 * Find the submit button's selector without clicking it. Returns the selector or
 * null. We deliberately never act on this — a human confirms the submit step.
 */
async function findSubmitSelector(stagehand, label) {
  const hint = label || "submit or generate the invoice";
  const handles = await stagehand.observe(
    `Find the button that would submit the form / ${hint}. Do not click it.`
  );
  const handle = Array.isArray(handles) ? handles[0] : null;
  return handle && handle.selector ? handle.selector : null;
}

/**
 * Click the "next step" control to advance a multi-step form, returning the
 * selector clicked (recorded as a nav action) or null if it couldn't be found.
 */
async function clickNext(stagehand, label) {
  const hint = label || "continue to the next step";
  const handles = await stagehand.observe(
    `Click the button to ${hint}.`
  );
  const handle = Array.isArray(handles) ? handles[0] : null;
  if (!handle || !handle.selector) return null;
  await stagehand.act(handle);
  // The lookup submit advances to the next step, usually an SPA re-render (the
  // fiscal fields appear client-side). Let it settle before the loop re-extracts,
  // or the next extract races the render and sees the previous step.
  try {
    await getActivePage(stagehand).waitForLoadState("networkidle", {
      timeout: 5000,
    });
  } catch {
    /* already idle, or still loading — extract whatever rendered */
  }
  return handle.selector;
}

/** Build the extract instruction listing the dataKeys we can fill on this step. */
function buildExtractInstruction(availableKeys) {
  const lines = availableKeys.map((k) => `- ${k}: ${DATA_KEY_HINTS[k]}`);
  return [
    "This is a Mexican CFDI invoicing (facturación) flow, usually split across",
    "several steps. The FIRST step is typically a ticket-lookup gate that asks for",
    "the purchase's identifying data (sucursal/tienda, folio, punto de venta, fecha,",
    "total/importe) to find the ticket; a LATER step asks for the buyer's fiscal data",
    "(RFC, razón social, régimen fiscal, uso de CFDI, código postal). The portal may",
    "render a SAMPLE ticket as a visual guide — ignore its values; only map the real",
    "input/select fields.",
    "",
    "Identify the visible input/select fields on the CURRENT step that correspond to",
    "any of these billing data keys:",
    lines.join("\n"),
    "",
    "For each such field return its on-screen label, the matching dataKey, and its",
    "control type.",
    "Set isFiscalStep=true ONLY when this step collects the buyer's fiscal identity",
    "(RFC, régimen fiscal, uso de CFDI, razón social); a ticket-lookup step is NOT",
    "fiscal (isFiscalStep=false).",
    "Buttons: nextStepButton is the control that ADVANCES the flow (looks up the",
    "ticket / continues to the next step) — classify the lookup/search button here",
    "EVEN when it is labelled 'Facturar', 'Buscar', 'Consultar', 'Continuar' or",
    "'Siguiente', because it does not yet issue the CFDI. submitButton is ONLY the",
    "FINAL button that actually generates/issues the invoice on the fiscal step.",
    "Report whichever of nextStepButton / submitButton is present.",
  ].join("\n");
}

/**
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function fillForm(state) {
  // Assemble the values to write (throws MISSING_COMPANY_DATA when there is no
  // company/RFC — nothing to invoice).
  const billingData = await assembleBillingData(state.ticketId, state.userId);

  // Presence-only log (no values): proves the agent is driven by the real OCR + CSF
  // data hydrated server-side, not the thin {ticketId} payload, and surfaces missing
  // fields (e.g. cfdiUsage:false) at a glance in trigger.log.
  log.info("fill_form: billingData", {
    ticketId: state.ticketId,
    present: redactBillingData(billingData),
  });

  // The keys we actually have data for; only these are worth mapping/filling.
  const availableKeys = BILLING_DATA_KEYS.filter(
    (k) => getBillingValue(billingData, k) != null
  );

  // Reconnect to the live keepAlive session opened upstream. Without a session
  // there is no browser to drive — an infrastructure failure, not a fillable one.
  const sessionRef = state.browserbaseSessionId || state.connectUrl;
  if (!sessionRef) {
    throw engineError(
      "No browser session to fill the form (browserbaseSessionId missing)",
      ENGINE_ERRORS.AGENT_FAILED.code
    );
  }

  let stagehand;
  try {
    ({ stagehand } = await reconnectSession(sessionRef));
  } catch (err) {
    throw engineError(
      `Could not reconnect to the browser session: ${err?.message || err}`,
      ENGINE_ERRORS.AGENT_FAILED.code
    );
  }

  const recordedActions = [...(state.recordedActions || [])];
  const filledFields = [];
  const unfilledFields = [];
  let submitButtonSelector = state.submitButtonSelector || null;
  let stepsWalked = 0;

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      stepsWalked = step;

      let plan;
      try {
        plan = await stagehand.extract(
          buildExtractInstruction(availableKeys),
          FILL_PLAN_SCHEMA
        );
      } catch (err) {
        // A step we can't read is a dead end; stop walking and report what we got.
        log.warn("fill_form: extract failed", {
          ticketId: state.ticketId,
          step,
          error: String(err),
        });
        break;
      }

      const fields = Array.isArray(plan?.fields) ? plan.fields : [];

      for (const field of fields) {
        const { label, dataKey, fieldType } = field || {};
        const valueStr = formatValue(getBillingValue(billingData, dataKey));

        // No value for this key → leave it for a human, don't fabricate one.
        if (valueStr == null || valueStr === "") {
          unfilledFields.push({
            field: dataKey,
            reason: "no billing value available",
          });
          continue;
        }

        try {
          const outcome = await fillField(stagehand, label, valueStr, fieldType);
          if (!outcome) {
            unfilledFields.push({ field: dataKey, reason: "field not found" });
            continue;
          }
          if (!outcome.verified) {
            unfilledFields.push({
              field: dataKey,
              selector: outcome.selector,
              reason: "readback did not match written value",
            });
            continue;
          }

          // Verified fill — both the engine's audit (filledFields) and the
          // recipe's raw material (recordedActions, with selector + dataKey).
          filledFields.push({
            field: dataKey,
            selector: outcome.selector,
            value: valueStr,
          });
          recordedActions.push({
            action: "fill",
            selector: outcome.selector,
            dataKey,
            fieldType: fieldType || "text",
          });
        } catch (err) {
          unfilledFields.push({
            field: dataKey,
            reason: `fill error: ${err?.message || err}`,
          });
        }
      }

      // Detect (but never click) the final submit control once it appears.
      if (!submitButtonSelector && plan?.submitButton?.present) {
        try {
          submitButtonSelector = await findSubmitSelector(
            stagehand,
            plan.submitButton.label
          );
        } catch (err) {
          log.warn("fill_form: submit detection failed", {
            ticketId: state.ticketId,
            error: String(err),
          });
        }
      }

      // The fiscal-data step is the last one we fill; stop here.
      if (plan?.isFiscalStep) break;

      // Otherwise advance to the next step if there is one, recording the nav
      // click so distillation can replay the walk.
      if (plan?.nextStepButton?.present) {
        try {
          const navSelector = await clickNext(
            stagehand,
            plan.nextStepButton.label
          );
          if (!navSelector) break; // couldn't advance → nothing more to do
          recordedActions.push({
            action: "click",
            selector: navSelector,
            staticValue: plan.nextStepButton.label || "next",
          });
        } catch (err) {
          log.warn("fill_form: next-step click failed", {
            ticketId: state.ticketId,
            error: String(err),
          });
          break;
        }
      } else {
        break; // single-step form, or no way forward
      }
    }
  } finally {
    // Disconnect our CDP/SDK handle. keepAlive sessions survive this — only an
    // explicit closeSession() releases them, and later nodes/HITL still need it.
    try {
      await stagehand.close();
    } catch (err) {
      log.warn("fill_form: stagehand close failed", {
        ticketId: state.ticketId,
        error: String(err),
      });
    }
  }

  // Couldn't write a single field: the form was reached but is unfillable — let
  // the shell retry / route to a human.
  if (filledFields.length === 0) {
    throw engineError(
      "AI fill verified no fields on the form",
      ENGINE_ERRORS.FORM_FILL_FAILED.code
    );
  }

  log.info("fill_form: filled form", {
    ticketId: state.ticketId,
    steps: stepsWalked,
    filled: filledFields.length,
    unfilled: unfilledFields.length,
    recorded: recordedActions.length,
    submitDetected: Boolean(submitButtonSelector),
  });

  return {
    status: INVOICE_STATUS.AI_FILLING,
    method: INVOICE_METHOD.AI,
    recipeUsed: false,
    filledFields,
    unfilledFields,
    recordedActions,
    submitButtonSelector,
    detail: `AI filled ${filledFields.length} field(s) across ${stepsWalked} step(s); submit ${
      submitButtonSelector ? "detected (not clicked)" : "not found"
    }`,
  };
}

export default fillForm;
