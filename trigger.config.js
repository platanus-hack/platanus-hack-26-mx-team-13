import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev project configuration. The project ref ties this repo to a project
// in the Trigger.dev dashboard — grab it from the project's Settings page and set
// TRIGGER_PROJECT_REF in .env.local (or replace the placeholder below). The
// secret key (TRIGGER_SECRET_KEY) authenticates the SDK at runtime/deploy.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "proj_REPLACE_ME",
  // Tasks live in ./trigger (e.g. trigger/processInvoice.js).
  dirs: ["./trigger"],
  // Default retry policy for tasks that don't set their own. The engine shell
  // also keeps its own per-node retry counters (see trigger/processInvoice.js).
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
