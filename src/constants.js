/**
 * HOGSWAP v1 SDK — constants.
 */

/** Production API host. Override via `new HogswapClient({ baseUrl })`. */
export const DEFAULT_BASE_URL = "https://hogswap-v1.liquihog.dev";

/** ALGO's asset id on Algorand (protocol-level constant). */
export const ALGO = 0;

/**
 * Server-side limits (documented so integrators can design for them —
 * they are enforced by the API, not by this SDK):
 *
 * - QUOTE_RATE_LIMIT:   30 quote requests per 10 seconds per IP.
 *                       Exceeding it returns HTTP 429 for ~10s.
 * - EXECUTE_BUDGET:     each quote_id funds at most 5 /execute builds.
 * - CONCURRENCY_LIMIT:  at most 4 simultaneous quote/execute
 *                       computations per IP; excess returns 429.
 * - QUOTE_TTL_SECONDS:  a quote_id expires ~30 seconds after issue.
 */
export const LIMITS = Object.freeze({
  QUOTE_RATE_LIMIT: Object.freeze({ requests: 30, windowSeconds: 10 }),
  EXECUTE_BUDGET_PER_QUOTE: 5,
  CONCURRENT_PER_IP: 4,
  QUOTE_TTL_SECONDS: 30,
});
