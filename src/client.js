/**
 * HOGSWAP v1 SDK — the client.
 *
 * Zero dependencies; works in any environment with `fetch` (browsers,
 * Node 18+, Deno, Bun, workers). All methods return the API's JSON
 * verbatim (snake_case fields — see docs/API.md), so the SDK never
 * drifts from the documented wire format.
 *
 * The two-step trade flow:
 *   1. quote  — plan the route, get a `quote_id` + expected numbers.
 *   2. execute — turn the quote into UNSIGNED transactions. Your app
 *      has the user's wallet sign them and submits to any algod node.
 *      The API never holds keys and never broadcasts.
 */

import { DEFAULT_BASE_URL } from "./constants.js";
import {
  ApiError,
  ExecuteBudgetError,
  NetworkError,
  NoRouteError,
  NotFoundError,
  QuoteExpiredError,
  RateLimitError,
  ValidationError,
} from "./errors.js";

export class HogswapClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl] API host (default: production).
   * @param {string} [opts.sender] Default wallet address attached to
   *   every quote — the API then prices that wallet's HOG-holdings
   *   fee discount exactly. Set/replace anytime via `setSender`.
   * @param {typeof fetch} [opts.fetch] Custom fetch (tests, proxies).
   */
  constructor({ baseUrl = DEFAULT_BASE_URL, sender = null, fetch = undefined } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sender = sender;
    this._fetch = fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Attach/replace the default sender wallet used for quotes. */
  setSender(address) {
    this.sender = address || null;
    return this;
  }

  // ── trading ──────────────────────────────────────────────────────

  /**
   * Quote a swap: `amountIn` of `assetIn` → `assetOut`.
   *
   * @param {object} p
   * @param {number} p.assetIn   input asset id (0 = ALGO)
   * @param {number} p.assetOut  output asset id
   * @param {number|bigint} p.amountIn amount in BASE UNITS
   * @param {number} [p.slippageBps=50]  slippage tolerance (50 = 0.5%)
   * @param {number} [p.maxHops=3]
   * @param {boolean} [p.coverAlgoFee=false] deliver an ALGO rebate
   *   covering network fees alongside the output
   * @param {string} [p.sender] overrides the client default
   * @returns {Promise<object>} quote response (see docs/API.md) —
   *   `expected_out` / `min_out_at_slippage` are what the contract
   *   actually delivers (routing fee already included).
   */
  swapQuote({ assetIn, assetOut, amountIn, slippageBps = 50, maxHops = 3, coverAlgoFee = false, sender } = {}) {
    return this._quote({
      asset_in: _int(assetIn, "assetIn"),
      asset_out: _int(assetOut, "assetOut"),
      amount_in: _int(amountIn, "amountIn"),
      slippage_bps: _bps(slippageBps),
      max_hops: _hops(maxHops),
      cover_algo_fee: coverAlgoFee,
    }, sender);
  }

  /**
   * Quote for an exact OUTPUT: the minimum input whose on-chain floor
   * covers `amountOut`. Response's `amount_in` is the required input.
   */
  exactOutQuote({ assetIn, assetOut, amountOut, slippageBps = 50, maxHops = 3, sender } = {}) {
    return this._quote({
      asset_in: _int(assetIn, "assetIn"),
      asset_out: _int(assetOut, "assetOut"),
      amount_out: _int(amountOut, "amountOut"),
      slippage_bps: _bps(slippageBps),
      max_hops: _hops(maxHops),
    }, sender);
  }

  /**
   * Consolidate 2-4 input assets into one output in a single atomic
   * group ("dust consolidation").
   *
   * @param {object} p
   * @param {{assetId:number, amount:number|bigint}[]} p.inputs
   * @param {number} p.assetOut
   */
  multiInputQuote({ inputs, assetOut, slippageBps = 50, maxHops = 3, sender } = {}) {
    return this._quote({
      inputs: (inputs ?? []).map((e) => ({
        asset_id: _int(e.assetId, "inputs[].assetId"),
        amount: _int(e.amount, "inputs[].amount"),
      })),
      asset_out: _int(assetOut, "assetOut"),
      slippage_bps: _bps(slippageBps),
      max_hops: _hops(maxHops),
    }, sender);
  }

  /**
   * One input → primary output + 1-3 exact-amount secondary outputs
   * ("basket"). Secondaries are delivered fee-free at least at their
   * target amounts; the primary receives the remainder.
   *
   * @param {object} p
   * @param {number} p.assetIn
   * @param {number|bigint} p.amountIn
   * @param {number} p.assetOut primary output
   * @param {{assetId:number, amount:number|bigint}[]} p.extraOutputs
   */
  basketQuote({ assetIn, amountIn, assetOut, extraOutputs, slippageBps = 50, maxHops = 3, sender } = {}) {
    return this._quote({
      asset_in: _int(assetIn, "assetIn"),
      amount_in: _int(amountIn, "amountIn"),
      asset_out: _int(assetOut, "assetOut"),
      extra_outputs: (extraOutputs ?? []).map((e) => ({
        asset_id: _int(e.assetId, "extraOutputs[].assetId"),
        amount: _int(e.amount, "extraOutputs[].amount"),
      })),
      slippage_bps: _bps(slippageBps),
      max_hops: _hops(maxHops),
    }, sender);
  }

  /**
   * Quote adding liquidity to a STAMM pool tier. Provide EITHER pool
   * assets (`amountA`/`amountB`) OR 1-2 `externalInputs` in any other
   * asset (the router converts cross-DEX to the tier ratio) — or mix.
   *
   * @param {object} p
   * @param {number} p.poolAppId
   * @param {number} p.tierIndex 0-5
   * @param {number|bigint} [p.amountA]
   * @param {number|bigint} [p.amountB]
   * @param {{assetId:number, amount:number|bigint}[]} [p.externalInputs]
   */
  lpMintQuote({ poolAppId, tierIndex, amountA, amountB, externalInputs, slippageBps = 100, sender } = {}) {
    const body = {
      mode: "LP_MINT",
      pool_app_id: _int(poolAppId, "poolAppId"),
      tier_index: _int(tierIndex, "tierIndex"),
      slippage_bps: _bps(slippageBps),
    };
    if (amountA != null) body.amount_a = _int(amountA, "amountA");
    if (amountB != null) body.amount_b = _int(amountB, "amountB");
    if (externalInputs?.length) {
      body.external_inputs = externalInputs.map((e) => ({
        asset_id: _int(e.assetId, "externalInputs[].assetId"),
        amount: _int(e.amount, "externalInputs[].amount"),
      }));
    }
    return this._quote(body, sender);
  }

  /**
   * Quote removing liquidity: burn `lpAmount` LP tokens and receive
   * `targetAsset` (a pool asset, or ANY asset — the router converts).
   */
  lpRedeemQuote({ poolAppId, tierIndex, lpAmount, targetAsset, slippageBps = 100, sender } = {}) {
    return this._quote({
      mode: "LP_REDEEM",
      pool_app_id: _int(poolAppId, "poolAppId"),
      tier_index: _int(tierIndex, "tierIndex"),
      lp_amount: _int(lpAmount, "lpAmount"),
      target_asset: _int(targetAsset, "targetAsset"),
      slippage_bps: _bps(slippageBps),
    }, sender);
  }

  /**
   * Build the UNSIGNED transaction group for a quote. Sign every
   * transaction with the user's wallet and submit the group to algod.
   *
   * Notes: a quote_id expires ~30s after issue and funds at most 5
   * builds. Call execute right before prompting the wallet so the
   * group is built against fresh chain state.
   *
   * @param {object} p
   * @param {string} p.quoteId from any quote method
   * @param {string} p.userAddress the wallet that will sign
   * @returns {Promise<{txnsB64: string[], groupId: string, raw: object}>}
   *   `txnsB64` are base64 msgpack-encoded unsigned transactions in
   *   group order (decode with algosdk.decodeUnsignedTransaction).
   */
  async execute({ quoteId, userAddress } = {}) {
    if (!quoteId || typeof quoteId !== "string") {
      throw new ValidationError("execute() requires quoteId (from a quote method)");
    }
    if (!userAddress || typeof userAddress !== "string") {
      throw new ValidationError("execute() requires userAddress (the signing wallet)");
    }
    const raw = await this._post("/execute", {
      quote_id: quoteId,
      user_address: userAddress,
    });
    return {
      txnsB64: (raw.unsigned_group ?? []).map((t) => t.txn_b64),
      groupId: raw.group_id_b64 ?? null,
      raw,
    };
  }

  /**
   * Convenience one-shot: swap quote + execute. Returns
   * `{ quote, txnsB64, groupId }` ready for wallet signing.
   * `userAddress` is authoritative — it is both the quote's sender
   * (fee-discount pricing) and the account the group is built for;
   * a `sender` field in the params is ignored.
   */
  async swap({ userAddress, ...quoteParams }) {
    if (!userAddress) throw new ValidationError("swap() requires userAddress");
    const quote = await this.swapQuote({ ...quoteParams, sender: userAddress });
    const { txnsB64, groupId } = await this.execute({
      quoteId: quote.quote_id,
      userAddress,
    });
    return { quote, txnsB64, groupId };
  }

  // ── market data (all cached ~5s at the edge) ─────────────────────

  /** Service health + uptime. */
  health() { return this._get("/health"); }

  /** List tradable assets (paginated; `q` searches name/unit/id). */
  assets({ limit = 100, cursor, q } = {}) {
    return this._get("/assets", { limit, cursor, q });
  }

  /** One asset's metadata + prices. */
  asset(assetId) { return this._get(`/assets/${_int(assetId, "assetId")}`); }

  /** Pools that trade an asset, sorted by TVL. */
  assetPools(assetId, { kind, minTvlAlgoMicro } = {}) {
    return this._get(`/assets/${_int(assetId, "assetId")}/pools`, {
      kind, min_tvl_algo_micro: minTvlAlgoMicro,
    });
  }

  /** List pools across every integrated DEX. */
  pools(params = {}) { return this._get("/pools", params); }

  /** One pool's detail. */
  pool(poolId) { return this._get(`/pools/${_int(poolId, "poolId")}`); }

  /** STAMM pools with per-tier state (for LP flows). */
  stammPools() { return this._get("/stamm/pools"); }

  /** Pair-level view between two assets. */
  pair(assetA, assetB) {
    return this._get(`/pairs/${_int(assetA, "assetA")}/${_int(assetB, "assetB")}`);
  }

  /** An asset's price in µALGO / µUSD with confidence. */
  price(assetId) { return this._get(`/price/${_int(assetId, "assetId")}`); }

  /** The pricing engine's anchor assets. */
  priceAnchors() { return this._get("/prices/anchors"); }

  /** Liquid-staking assets (tALGO, xALGO, …) with rates. */
  stakingAssets() { return this._get("/staking-assets"); }

  /** Protocol-wide TVL. */
  tvl() { return this._get("/tvl"); }

  // ── internals ────────────────────────────────────────────────────

  _quote(body, senderOverride) {
    const sender = senderOverride ?? this.sender;
    if (sender) body.sender = sender;
    return this._post("/quote", body);
  }

  async _post(path, body) {
    return this._request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async _get(path, params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    // toString(), not .size — URLSearchParams.size doesn't exist on
    // Node 18 (a supported runtime) and every GET param would be
    // silently dropped there.
    const query = qs.toString();
    return this._request(query ? `${path}?${query}` : path, { method: "GET" });
  }

  async _request(path, init) {
    let res;
    try {
      res = await this._fetch(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw new NetworkError(`request to ${path} failed: ${cause?.message ?? cause}`);
    }
    let payload = null;
    try { payload = await res.json(); } catch { /* non-JSON body */ }
    if (res.ok) return payload;

    const detail = payload?.detail ?? payload;
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail ?? res.statusText);
    const opts = { status: res.status, detail };
    const isExecute = path.startsWith("/execute");
    const isQuote = path.startsWith("/quote");
    if (res.status === 429) {
      const retryHeader = Number(res.headers?.get?.("retry-after"));
      if (Number.isFinite(retryHeader) && retryHeader > 0) {
        opts.retryAfterSeconds = retryHeader;
      }
      throw isExecute && /budget/i.test(msg)
        ? new ExecuteBudgetError(msg, opts)
        : new RateLimitError(msg, opts);
    }
    if (res.status === 404) {
      // 404 means three different things depending on the endpoint.
      if (isExecute) throw new QuoteExpiredError(msg, opts);
      if (isQuote) throw new NoRouteError(msg, opts);
      throw new NotFoundError(msg, opts);   // unknown asset/pool/pair
    }
    if (res.status === 400 || res.status === 422) {
      throw new ValidationError(msg, opts);
    }
    throw new ApiError(msg, opts);
  }
}

function _bps(v) {
  const n = _int(v, "slippageBps");
  if (n < 1 || n > 5000) {
    throw new ValidationError(`slippageBps must be 1-5000, got ${n}`);
  }
  return n;
}

function _hops(v) {
  const n = _int(v, "maxHops");
  if (n < 1 || n > 4) {
    throw new ValidationError(`maxHops must be 1-4, got ${n}`);
  }
  return n;
}

function _int(v, name) {
  // Strict on purpose: "" and booleans coerce to 0/1 under Number()
  // — and 0 is ALGO's asset id, so a sloppy falsy value must never
  // silently become "swap ALGO".
  if (v === undefined || v === null || v === "" || typeof v === "boolean") {
    throw new ValidationError(`${name} is required and must be an integer (base units)`);
  }
  if (typeof v === "bigint") {
    if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ValidationError(
        `${name} is outside the safe integer range: ${v} ` +
        `(max ${Number.MAX_SAFE_INTEGER} base units)`);
    }
    return Number(v);
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ValidationError(
      `${name} must be a non-negative safe integer (base units), got ${String(v)}`);
  }
  return n;
}
