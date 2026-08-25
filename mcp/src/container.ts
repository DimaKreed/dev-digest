/**
 * Ring 5 — the composition root. The one file allowed to reach everywhere, and
 * the only one that reads configuration.
 *
 * Nothing mutable is exported at module scope: the adapters are constructed here
 * and handed to the use cases, so a test can build a second, independent set
 * without the first one leaking into it.
 */
import { createSystemClock } from './adapters/clock.js';
import { createHttpApi } from './adapters/http-client.js';
import type { ToolDeps } from './transport/tools.js';

const DEFAULT_API_URL = 'http://localhost:3001';

export function buildDeps(env: NodeJS.ProcessEnv = process.env): ToolDeps {
  return {
    api: createHttpApi({ baseUrl: env.DEVDIGEST_API_URL ?? DEFAULT_API_URL }),
    clock: createSystemClock(),
  };
}
