import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev project configuration. The project ref ties this repo to a project
// in the Trigger.dev dashboard — grab it from the project's Settings page and set
// TRIGGER_PROJECT_REF in .env.local (or replace the placeholder below). The
// secret key (TRIGGER_SECRET_KEY) authenticates the SDK at runtime/deploy.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "proj_REPLACE_ME",
  // Pin the task runtime to Node 22 (repo requires it via engines.node + .nvmrc);
  // Trigger.dev v4 otherwise defaults to Node 21.
  runtime: "node-22",
  // Tasks live in ./trigger (e.g. trigger/processInvoice.js).
  dirs: ["./trigger"],
  // Max wall-clock seconds a task run may take before the engine kills it.
  // Required by trigger.dev v4 (must be >= 5). Override per-task as needed.
  maxDuration: 300,
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
