/// <reference types="@cloudflare/workers-types" />

// Bindings that miniflare provides to `test/edge/` (`d1Databases` in vitest.edge.config.ts).
// `env` from `cloudflare:workers` is typed as `Cloudflare.Env`, which projects extend by
// redeclaring it; TypeScript merges the declarations.
declare namespace Cloudflare {
  interface Env {
    TASKS_DB: D1Database;
  }
}
