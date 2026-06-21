// process-invoice — the durable task shell that drives one invoice run.
//
// Trigger.dev is the durable runtime (queue + no timeout + suspend/resume +
// tracing); this task is the JS state machine on top of it. It builds an
// InvoiceState from the ticket, runs the engine nodes in order, and persists
// ticket.invoice after every node so the dashboard can poll progress.
//
// The nodes are STUBS for now (see libs/engine/nodes/*); the real Browserbase /
// Stagehand work lands in later issues. The shell — ordering, retry counters,
// the recipe-vs-AI branch, per-node persistence, and failure handling — is real.

import { task } from "@trigger.dev/sdk";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";
import { runNode } from "@/libs/engine/node";
import {
  resolvePortal,
  initNavigate,
  reachForm,
  replayRecipe,
  fillForm,
  distillRecipe,
  readyToSubmit,
} from "@/libs/engine/nodes";
import { createLogger } from "@/libs/core/logger";

const log = createLogger({ component: "engine:process-invoice" });

// Retry budgets per the engine spec: navigation is flaky (portals are slow /
// throw transient errors) so allow more attempts than form filling.
const NAV_MAX_ATTEMPTS = 3;
const FILL_MAX_ATTEMPTS = 2;

// Build the initial InvoiceState for a ticket. Mirrors the InvoiceState typedef
// in libs/engine/state.js; seeds the merchant identity from the OCR extraction.
function buildInvoiceState(ticket) {
  return {
    status: INVOICE_STATUS.QUEUED,
    ticketId: ticket._id.toString(),
    userId: ticket.userId ? ticket.userId.toString() : null,
    merchantName: ticket.extracted?.merchantNameGuess || null,
    rfcEmisor: ticket.extracted?.rfcEmisor || null,
    portalUrl: null,
    urlSource: null,
    browserbaseSessionId: null,
    connectUrl: null,
    recipeId: null,
    recipeUsed: false,
    recipeVersion: null,
    method: null,
    formReached: false,
    recordedActions: [],
    filledFields: [],
    unfilledFields: [],
    submitButtonSelector: null,
    stages: [],
    cost: 0,
    screenshots: [],
    error: null,
    errorType: null,
  };
}

// A compact summary returned to the Trigger.dev dashboard for the run.
function summarize(state) {
  return {
    ticketId: state.ticketId,
    status: state.status,
    method: state.method,
    error: state.error,
    errorType: state.errorType,
    stages: state.stages.length,
  };
}

export const processInvoiceTask = task({
  id: "process-invoice",
  // The full run is a long browser job; give it generous headroom.
  maxDuration: 600,
  run: async ({ ticketId }) => {
    await connectMongoose();

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const state = buildInvoiceState(ticket);

    // Persist after every node so ticket.invoice (and the dashboard) always
    // reflects the latest phase. Mutates `state` in place by merging the node's
    // partial, then writes the whole InvoiceState onto the ticket.
    const persist = async (partial) => {
      Object.assign(state, partial);
      await Ticket.updateOne({ _id: ticketId }, { $set: { invoice: state } });
    };

    // Persist the initial queued state so the run is visible immediately.
    await persist({});

    // Run one node: wrap it with runNode (records a stage, classifies failures),
    // persist the merged state, and report success (no error after the merge).
    const step = async (name, fn) => {
      const partial = await runNode(name, fn, state);
      await persist(partial);
      return !state.error;
    };

    // Run a node with a retry budget. runNode swallows throws into state.error,
    // so we retry while it keeps failing. Each attempt appends its own stage, so
    // the audit trail shows every try. (A later issue routes human-resolvable
    // errors — captcha, login — to awaiting_human instead of retrying.)
    const stepWithRetry = async (name, fn, maxAttempts) => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (await step(name, fn)) return true;
        log.warn(`${name} failed`, {
          ticketId,
          attempt,
          maxAttempts,
          errorType: state.errorType,
        });
      }
      return false;
    };

    // Mark the run failed and return its summary. state.error/errorType already
    // carry the cause from the failing node.
    const fail = async () => {
      await persist({ status: INVOICE_STATUS.FAILED });
      log.error("process-invoice failed", {
        ticketId,
        errorType: state.errorType,
        error: state.error,
      });
      return summarize(state);
    };

    // 1. Resolve the merchant's portal URL (and any reusable recipe).
    if (!(await step("resolve_portal", resolvePortal))) return fail();

    // 2. Open the browser session and navigate to the portal (flaky → retry).
    if (!(await stepWithRetry("init_navigate", initNavigate, NAV_MAX_ATTEMPTS))) {
      return fail();
    }

    // 3. Reach the invoicing form.
    if (!(await step("reach_form", reachForm))) return fail();

    // 4. Fill the form. When the run carries a recipe, replay it deterministically
    //    first (cheap, zero-AI); otherwise AI-fill from scratch. A replay that
    //    fails (RECIPE_REPLAY_FAILED) or finds no usable recipe (recipeFound:false)
    //    wrote nothing into the form, so it must fall back to an AI fill — it can
    //    never short-circuit the run to submit on an empty form.
    let filled;
    if (state.recipeId) {
      filled = await stepWithRetry("replay_recipe", replayRecipe, FILL_MAX_ATTEMPTS);

      // replay_recipe reports recipeFound:false (no active recipe) WITHOUT throwing,
      // so runNode marks the step ok even though nothing was filled — recipeUsed
      // stays false. Treat that, like an outright replay error, as a miss to fall
      // back on rather than a successful fill.
      if (!filled || state.recipeUsed !== true) {
        log.warn("replay_recipe did not fill the form — falling back to AI fill", {
          ticketId,
          recipeFound: state.recipeFound,
          errorType: state.errorType,
        });
        // Drop the recipe context so the AI fill starts clean and the run's method
        // resolves to AI (so distill_recipe still runs on the fresh fill below) and
        // any replay error doesn't linger on the persisted state.
        await persist({
          recipeId: null,
          recipeUsed: false,
          recipeVersion: null,
          method: null,
          error: null,
          errorType: null,
        });
        filled = await stepWithRetry("fill_form", fillForm, FILL_MAX_ATTEMPTS);
      }
    } else {
      filled = await stepWithRetry("fill_form", fillForm, FILL_MAX_ATTEMPTS);
    }

    if (!filled) return fail();

    // 5. Distill a reusable recipe from a fresh ai/human fill. Best-effort: a
    //    distillation failure does not fail the run (we already filled the form).
    if (state.method !== INVOICE_METHOD.RECIPE) {
      await step("distill_recipe", distillRecipe);
    }

    // 6. Form is ready; park for the (human-confirmed) submit step. This is the
    //    terminal step that sets the final success status, so a failure here must
    //    fail the run like every other step (don't report a half-done run as ok).
    if (!(await step("ready_to_submit", readyToSubmit))) return fail();

    log.info("process-invoice finished", {
      ticketId,
      status: state.status,
      method: state.method,
    });
    return summarize(state);
  },
});

export default processInvoiceTask;
