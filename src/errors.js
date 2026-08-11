/**
 * HOGSWAP v1 SDK — typed errors.
 *
 * Every non-2xx API response is thrown as one of these, so callers can
 * branch on `instanceof` instead of parsing strings:
 *
 *   try { await client.swapQuote(...) }
 *   catch (e) {
 *     if (e instanceof RateLimitError) retryLater(e.retryAfterSeconds);
 *     else if (e instanceof ValidationError) showMessage(e.detail);
 *   }
 */

/** Base class for every error this SDK throws. */
export class HogswapError extends Error {
  constructor(message, { status = 0, detail = null, code = null,
                         assets = null } = {}) {
    super(message);
    this.name = new.target.name;
    /** HTTP status code (0 for network-level failures). */
    this.status = status;
    /** The API's `detail` payload — a human-readable sentence. */
    this.detail = detail;
    /** Stable machine code from the API's `error` field, when present
     * (e.g. "missing_opt_in"). Branch on this rather than on `detail`,
     * whose wording may change. Null on responses that predate it. */
    this.code = code;
    /** Asset ids the error refers to, when the API supplies them. */
    this.assets = assets;
  }
}

/** The request never reached the API (offline, DNS, CORS, timeout). */
export class NetworkError extends HogswapError {}

/**
 * HTTP 429 — either the 30-quotes-per-10s edge limit or the
 * 4-concurrent-requests-per-IP guard. Back off and retry.
 */
export class RateLimitError extends HogswapError {
  constructor(message, opts = {}) {
    super(message, opts);
    /** Wait before retrying: the response's Retry-After header when
     * present, else the ~10s block window. */
    this.retryAfterSeconds = opts.retryAfterSeconds ?? 10;
  }
}

/** HTTP 404 on a market-data endpoint — unknown asset/pool/pair. */
export class NotFoundError extends HogswapError {}

/**
 * The quote_id passed to /execute was not found — quotes expire ~30s
 * after issue. Request a fresh quote and retry.
 */
export class QuoteExpiredError extends HogswapError {}

/**
 * The quote_id exhausted its build budget (5 /execute calls per
 * quote). Request a fresh quote.
 */
export class ExecuteBudgetError extends HogswapError {}

/**
 * HTTP 402 — payment required. The body IS the x402 offer: an
 * `accepts` array of payment options (plus `nonce` /
 * `credits_granted` on credit top-ups). Not a dead end — pay any
 * entry with `client.payInvoice(...)` or top up credits with
 * `client.topupWithAssets(...)`, then retry.
 */
export class PaymentRequiredError extends HogswapError {
  constructor(message, opts = {}) {
    super(message, opts);
    /** The x402 offer body (`x402_version`, `accepts`, ...). */
    this.offer = opts.offer ?? null;
  }
}

/** HTTP 400/422 — the request shape or values were rejected. */
export class ValidationError extends HogswapError {}

/**
 * HTTP 422 with `error: "missing_opt_in"` — the signer has not opted
 * into one or more OUTPUT assets, so the group cannot be built. The
 * ids are on `.assets`; opt in, then request a fresh quote.
 *
 * Subclasses ValidationError so existing `catch (ValidationError)`
 * keeps working unchanged.
 */
export class MissingOptInError extends ValidationError {}

/** No viable route / target not achievable (HTTP 404 on quotes). */
export class NoRouteError extends HogswapError {}

/** Anything else the API refused (5xx, unexpected statuses). */
export class ApiError extends HogswapError {}
