// review_form — post-fill validation. After fill_form / replay_recipe writes the
// form, the per-field readback only proves our value was TYPED — it cannot know the
// merchant rejected it server-side ("RFC inválido", "CP no coincide", "folio no
// existe"). This node re-reads the live page and looks for an explicit, visible error
// (an error modal / alert / inline validation message). If one is present, the form
// is NOT ready: we raise FORM_REJECTED (human-resolvable) so the run hands off to a
// person who fixes it live, instead of parking a rejected form at ready_to_submit.
//
// Ported from the old engine's reviewForm (facturin2025) detectModal pass, adapted
// to the node contract. Deliberately CONSERVATIVE: it only flags explicit error
// containers with visible, non-empty text, so a clean fill is never falsely blocked.
// Best-effort on infra: if the session can't be read, it returns ok (no false block).

import { reconnectSession, getActivePage } from "@/libs/engine/session";
import { engineError } from "@/libs/engine/node";
import { ENGINE_ERRORS } from "@/libs/engine/errorTypes";
import { INVOICE_STATUS } from "@/libs/engine/state";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:review-form" });

/**
 * Scan the live page for an explicit, visible error message left by the portal after
 * our fill. Returns the first error text found, or null when the form looks clean.
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<string|null>}
 */
async function detectPortalError(page) {
  try {
    return await page.evaluate(() => {
      // High-precision error containers across the common MX-portal UI kits
      // (Bootstrap, SweetAlert2, Ant Design, Toastify, plain ARIA alerts). We only
      // trust EXPLICIT error containers, not generic [class*=error], to avoid
      // false-positives on instructional copy.
      var SELECTORS = [
        ".alert-danger",
        ".alert-error",
        ".swal2-popup.swal2-icon-error .swal2-html-container",
        ".swal2-popup.swal2-icon-error .swal2-title",
        '[role="alertdialog"]',
        ".ant-form-item-explain-error",
        ".ant-message-error",
        ".ant-notification-notice-error",
        ".Toastify__toast--error",
        ".invalid-feedback",
        ".field-error",
        ".error-message",
        ".text-danger",
      ];

      function visible(el) {
        if (!el) return false;
        if (el.offsetParent === null) return false; // display:none / detached
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        var s = window.getComputedStyle(el);
        return s.visibility !== "hidden" && s.opacity !== "0";
      }

      var messages = [];
      for (var i = 0; i < SELECTORS.length; i++) {
        var nodes = document.querySelectorAll(SELECTORS[i]);
        for (var j = 0; j < nodes.length; j++) {
          var el = nodes[j];
          if (!visible(el)) continue;
          var text = (el.innerText || el.textContent || "").trim();
          if (text && messages.indexOf(text) === -1) messages.push(text);
        }
      }
      if (!messages.length) return null;
      // Cap to keep the error message readable in logs / the dashboard.
      return messages.join(" | ").slice(0, 500);
    });
  } catch (err) {
    log.warn("review_form: page scan failed (treating as clean)", {
      error: String(err),
    });
    return null;
  }
}

/**
 * review_form node — runs after a successful AI/recipe fill, before distill/ready.
 *
 * @param {import("@/libs/engine/state").InvoiceState} state
 * @returns {Promise<Partial<import("@/libs/engine/state").InvoiceState> & { detail?: string }>}
 */
export async function reviewForm(state) {
  // No live session to inspect (e.g. local dev without Browserbase) → nothing to
  // validate; don't block the run on missing infra.
  if (!state.browserbaseSessionId) {
    return { status: INVOICE_STATUS.REACHING_FORM, detail: "review skipped: no live session" };
  }

  let errorText = null;
  try {
    const { stagehand } = await reconnectSession(state.browserbaseSessionId);
    try {
      errorText = await detectPortalError(getActivePage(stagehand));
    } finally {
      // keepAlive keeps the cloud session for the (human/confirmed-submit) next step.
      await stagehand.close().catch(() => {});
    }
  } catch (err) {
    // Infra failure reading the page is not a form rejection — don't block.
    log.warn("review_form: could not reconnect to review the form", {
      ticketId: state.ticketId,
      error: String(err),
    });
    return { detail: "review skipped: session unreadable" };
  }

  if (errorText) {
    log.warn("review_form: portal rejected the fill", {
      ticketId: state.ticketId,
      error: errorText,
    });
    throw engineError(
      `Portal rejected the form: ${errorText}`,
      ENGINE_ERRORS.FORM_REJECTED.code
    );
  }

  return { detail: "form passed review (no portal validation errors)" };
}

export default reviewForm;
