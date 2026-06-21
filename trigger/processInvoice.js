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

import { task, wait } from "@trigger.dev/sdk";
import connectMongoose from "@/libs/core/mongoose";
import Ticket from "@/models/Ticket";
import { INVOICE_STATUS, INVOICE_METHOD } from "@/libs/engine/state";
import { isHumanResolvable } from "@/libs/engine/errorTypes";
import { runNode } from "@/libs/engine/node";
import {
  getLiveViewUrl,
  reconnectSession,
  closeSession,
} from "@/libs/engine/session";
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

// How long a human handoff stays open before the waitpoint times out and the run
// fails. Aligned with the keepAlive session lifetime (session.js, 1h): past it the
// Browserbase session is gone, so there's nothing left for a human to resume into.
const HANDOFF_TIMEOUT = "1h";

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
    liveViewUrl: null,
    waitpointTokenId: null,
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
    // the audit trail shows every try. A human-resolvable blocker (captcha, login,
    // a form we couldn't find/fill) won't clear by retrying, so stop early and let
    // the caller route it to a human handoff instead of burning the budget.
    const stepWithRetry = async (name, fn, maxAttempts) => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (await step(name, fn)) return true;
        if (isHumanResolvable(state.errorType)) return false;
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
    // carry the cause from the failing node. This is the TERMINAL failure path —
    // the run will not resume — so release the keepAlive Browserbase session here
    // (it outlives the script and bills until released). The non-terminal parks
    // (awaiting_human, ready_to_submit) never call fail(), so their sessions are
    // preserved for the human / the confirmed-submit step.
    const fail = async () => {
      await persist({ status: INVOICE_STATUS.FAILED });
      if (state.browserbaseSessionId) {
        await closeSession(state.browserbaseSessionId).catch((err) =>
          log.warn("process-invoice: closeSession on fail failed", {
            ticketId,
            error: String(err),
          })
        );
      }
      log.error("process-invoice failed", {
        ticketId,
        errorType: state.errorType,
        error: state.error,
      });
      return summarize(state);
    };

    // HITL handoff — durably suspend on a human-resolvable blocker (captcha,
    // login wall, a form we couldn't find/fill), let the person finish in the
    // SAME live Browserbase session, then resume. The waitpoint holds NO compute
    // while suspended. Returns true once the human resolved it (the run should
    // converge on distill + ready_to_submit), or false if the handoff couldn't be
    // set up / timed out (the caller then fails the run).
    const handoff = async () => {
      // The interactive live-view page the human drives. Best-effort: without it
      // the dashboard loses the embedded view, but the handoff still works.
      let liveViewUrl = null;
      if (state.browserbaseSessionId) {
        try {
          liveViewUrl = await getLiveViewUrl(state.browserbaseSessionId);
        } catch (err) {
          log.warn("process-invoice: could not get live view URL", {
            ticketId,
            error: String(err),
          });
        }
      }

      // Durable waitpoint the run suspends on. The resume route completes it when
      // the user clicks "Listo"; it times out so a run never hangs forever.
      let token;
      try {
        token = await wait.createToken({
          timeout: HANDOFF_TIMEOUT,
          tags: [`ticket:${ticketId}`, "awaiting-human"],
        });
      } catch (err) {
        log.error("process-invoice: could not create handoff waitpoint", {
          ticketId,
          error: String(err),
        });
        return false;
      }

      await persist({
        status: INVOICE_STATUS.AWAITING_HUMAN,
        liveViewUrl,
        waitpointTokenId: token.id,
      });

      // Notify the user their attention is needed. No push/email channel exists
      // yet — the dashboard surfaces awaiting_human by polling — so this is a
      // structured log for now; a real channel can hook in here later.
      log.info("process-invoice awaiting human", {
        ticketId,
        errorType: state.errorType,
        waitpointTokenId: token.id,
        hasLiveView: Boolean(liveViewUrl),
      });

      // Suspend durably until the human resolves it. forToken resolves with the
      // data the resume route passed to completeToken.
      const result = await wait.forToken(token);

      // A timed-out waitpoint means the human never resolved it → fail the run.
      if (!result.ok) {
        await persist({
          error: "Human handoff timed out before it was resolved",
          waitpointTokenId: null,
        });
        return false;
      }

      // The human worked the form live; fold in any actions the resume route
      // captured and mark the run human-driven so distill records a human recipe.
      const resumed = result.output || {};
      const mergedActions = [
        ...(state.recordedActions || []),
        ...(Array.isArray(resumed.recordedActions) ? resumed.recordedActions : []),
      ];

      // Reconnect to the same keepAlive session the human used — parity with the
      // other nodes and a liveness check after the handoff. Drop the local handle
      // immediately (keepAlive keeps the cloud session for the confirmed-submit
      // step). Best-effort: distill works off state even if the session expired
      // (Browserbase drops idle CDP after ~10 min).
      if (state.browserbaseSessionId) {
        try {
          const { stagehand } = await reconnectSession(state.browserbaseSessionId);
          await stagehand.close().catch(() => {});
        } catch (err) {
          log.warn("process-invoice: reconnect after handoff failed", {
            ticketId,
            error: String(err),
          });
        }
      }

      await persist({
        method: INVOICE_METHOD.HUMAN,
        recordedActions: mergedActions,
        waitpointTokenId: null,
        liveViewUrl: null,
        error: null,
        errorType: null,
      });

      log.info("process-invoice resumed after human handoff", { ticketId });
      return true;
    };

    // The browser steps below can fail with a human-resolvable blocker (captcha,
    // login wall, a form we couldn't find or fill). When one does, hand off to a
    // human in the live session instead of failing — and once they finish, the run
    // converges straight on distill + ready_to_submit, since the human filled the
    // form. A non-resolvable failure (missing URL, timeout, crash) still fails.

    // 1. Resolve the merchant's portal URL (and any reusable recipe). A missing URL
    //    is not something a human at the keyboard can fix → never hand off here.
    if (!(await step("resolve_portal", resolvePortal))) return fail();

    // Set once a human took over and finished the form live; short-circuits the
    // remaining fill pipeline so we don't re-drive a form the human already filled.
    let handedOff = false;

    // 2. Open the browser session and navigate to the portal (flaky → retry).
    if (!(await stepWithRetry("init_navigate", initNavigate, NAV_MAX_ATTEMPTS))) {
      if (!isHumanResolvable(state.errorType)) return fail();
      if (!(await handoff())) return fail();
      handedOff = true;
    }

    // 3. Reach the invoicing form.
    if (!handedOff && !(await step("reach_form", reachForm))) {
      if (!isHumanResolvable(state.errorType)) return fail();
      if (!(await handoff())) return fail();
      handedOff = true;
    }

    // 4. Fill the form. When the run carries a recipe, replay it deterministically
    //    first (cheap, zero-AI); otherwise AI-fill from scratch. A replay that
    //    fails (RECIPE_REPLAY_FAILED) or finds no usable recipe (recipeFound:false)
    //    wrote nothing into the form, so it must fall back to an AI fill — it can
    //    never short-circuit the run to submit on an empty form. Skipped entirely
    //    when a human already took over and filled the form in an earlier step.
    if (!handedOff) {
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

      // A form we found but couldn't fill (FORM_FILL_FAILED) is human-resolvable —
      // hand off so a person finishes it live; any other failure ends the run.
      if (!filled) {
        if (!isHumanResolvable(state.errorType)) return fail();
        if (!(await handoff())) return fail();
        handedOff = true;
      }
    }

    // 5. Distill a reusable recipe from a fresh ai/human fill. Best-effort: a
    //    distillation failure does not fail the run (we already filled the form).
    if (state.method !== INVOICE_METHOD.RECIPE) {
      await step("distill_recipe", distillRecipe);
    }

    // 6. Form is ready; park for the (human-confirmed) submit step. This is the
    //    terminal step that sets the final success status, so a failure here must
    //    fail the run like every other step (don't report a half-done run as ok).
    if (!(await step("ready_to_submit", readyToSubmit))) return fail();

    // ready_to_submit parks at awaiting_human when it can't verify a submit control
    // on an automated fill (it never fabricates one). Route that through one
    // durable handoff; when the human confirms in the live session, the form is
    // ready to submit. (A human-driven fill is already trusted ready, so this only
    // fires on an ai/recipe fill that found no submit control.)
    if (state.status === INVOICE_STATUS.AWAITING_HUMAN) {
      if (!(await handoff())) return fail();
      await persist({ status: INVOICE_STATUS.READY_TO_SUBMIT });
    }

    log.info("process-invoice finished", {
      ticketId,
      status: state.status,
      method: state.method,
    });
    return summarize(state);
  },
});

export default processInvoiceTask;
