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
  PaymentRequiredError,
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
   * @param {string} [opts.apiKey] `hsk_` bearer key for the paid tier
   *   (sent as X-API-Key on every request). Self-issue one with
   *   `register` + `registerVerify` — no signup, no human.
   * @param {typeof fetch} [opts.fetch] Custom fetch (tests, proxies).
   */
  constructor({ baseUrl = DEFAULT_BASE_URL, sender = null, apiKey = null, fetch = undefined } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sender = sender;
    this.apiKey = apiKey;
    this._fetch = fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Attach/replace the default sender wallet used for quotes. */
  setSender(address) {
    this.sender = address || null;
    return this;
  }

  /** Attach/replace the `hsk_` API key sent with every request. */
  setApiKey(key) {
    this.apiKey = key || null;
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

  // ── x402: credits + the universal pay rail ───────────────────────
  //
  // The paid tier and the payment rail. Everything here is strictly
  // non-custodial: build methods return UNSIGNED transactions; the
  // orchestrators (`payInvoice`, `topupWithAssets`) take `sign` and
  // `submit` callbacks so keys never touch the SDK. NEVER pass a
  // mnemonic or private key to any SDK method.

  /**
   * Self-service API key, step 1 of 2 — zero human, zero email.
   * Returns `{ challenge, expires_unix, ... }`; sign the exact
   * challenge string bytes with the address's key (e.g. algosdk
   * `signBytes`), then call `registerVerify`.
   */
  register({ address } = {}) {
    _addr(address, "address");
    return this._post("/credits/register", { address });
  }

  /**
   * Self-service key issuance, step 2 of 2. Returns your key ONCE
   * (`{ api_key, ... }`) — store it yourself, it is not recoverable.
   * Call `setApiKey(res.api_key)` to start using it.
   */
  registerVerify({ address, challenge, signatureB64 } = {}) {
    _addr(address, "address");
    if (!challenge || !signatureB64) {
      throw new ValidationError("registerVerify() requires challenge and signatureB64");
    }
    return this._post("/credits/register/verify", {
      address, challenge, signature_b64: signatureB64,
    });
  }

  /** Credit balance + per-endpoint weights for the attached key. */
  creditBalance() { return this._get("/credits/balance"); }

  /**
   * Create a credit top-up and return the x402 OFFER (the API
   * responds HTTP 402 by design — that IS the payment instruction,
   * not an error; this method unwraps it). `offer.accepts[0]` is a
   * plain USDC transfer; pay it with any asset via `payInvoice`, or
   * use `topupWithAssets` to do offer→build→submit in one call.
   *
   * @param {object} p
   * @param {number|bigint} p.usdcMicro top-up size in µUSDC
   */
  async creditOffer({ usdcMicro } = {}) {
    try {
      return await this._post("/credits/topup", {
        usdc_micro: _int(usdcMicro, "usdcMicro"),
      });
    } catch (e) {
      if (e instanceof PaymentRequiredError) return e.offer;
      throw e;
    }
  }

  /** Assets accepted as payment inputs (price-confidence gated). */
  payableAssets() { return this._get("/pay/x402/assets"); }

  /**
   * Build unsigned groups paying an Algorand-settled x402 invoice —
   * ANY recipient, ANY demanded asset — with any 1-4 assets you hold.
   *
   * @param {object} p
   * @param {object} p.invoice the 402's `accepts` entry you picked
   *   (`{scheme, network, asset, amount, pay_to, note?, expires_unix?}`
   *   — keep the `note`, it carries the invoice nonce)
   * @param {string} p.userAddress the paying wallet
   * @param {{assetId:number, amount?:number|bigint}[]} p.inputs 1-4
   *   inputs; omit `amount` on a SINGLE input to have the exact-out
   *   solver find the minimum
   * @returns {Promise<{mode:string, atomic:boolean,
   *   groups:{purpose:string, txnsB64:string[]}[], raw:object}>}
   *   Sign every txn, then submit the groups IN ORDER (swap first —
   *   its on-chain floor guarantees the payment is funded; `direct`
   *   mode is a single payment txn).
   */
  async payX402Build({ invoice, userAddress, inputs } = {}) {
    _addr(userAddress, "userAddress");
    if (!invoice || typeof invoice !== "object") {
      throw new ValidationError("payX402Build() requires the invoice (an x402 accepts entry)");
    }
    const raw = await this._post("/pay/x402/build", {
      invoice,
      user_address: userAddress,
      inputs: _inputs(inputs),
    });
    return _groupsResult(raw);
  }

  /**
   * Build unsigned groups paying a pending credit top-up (from
   * `creditOffer`) with any 1-4 assets. Same group semantics as
   * `payX402Build`.
   */
  async topupBuild({ nonce, userAddress, inputs } = {}) {
    _addr(userAddress, "userAddress");
    if (!nonce || typeof nonce !== "string") {
      throw new ValidationError("topupBuild() requires the offer's nonce");
    }
    const raw = await this._post("/credits/topup/build", {
      nonce, user_address: userAddress, inputs: _inputs(inputs),
    });
    return _groupsResult(raw);
  }

  /**
   * One-shot: pay an x402 invoice end to end. Builds the groups,
   * has YOUR callbacks sign and submit each one in order, and
   * returns the receipts. The SDK never sees keys.
   *
   * @param {object} p
   * @param {object} p.invoice the `accepts` entry (see payX402Build)
   * @param {string} p.userAddress
   * @param {{assetId:number, amount?:number|bigint}[]} p.inputs
   * @param {(txnsB64:string[], purpose:string) => Promise<unknown>}
   *   p.sign given base64 unsigned txns, return what `submit`
   *   accepts (e.g. signed blobs from your wallet)
   * @param {(signed:unknown, purpose:string) => Promise<unknown>}
   *   p.submit broadcast ONE group (e.g. algod sendRawTransaction +
   *   wait). Called once per group, in order; its return values are
   *   surfaced as receipts.
   */
  async payInvoice({ invoice, userAddress, inputs, sign, submit } = {}) {
    _fn(sign, "sign");
    _fn(submit, "submit");
    const build = await this.payX402Build({ invoice, userAddress, inputs });
    const receipts = [];
    for (const g of build.groups) {
      const signed = await sign(g.txnsB64, g.purpose);
      receipts.push({ purpose: g.purpose, result: await submit(signed, g.purpose) });
    }
    return { ...build, receipts };
  }

  /**
   * One-shot credit top-up: offer → build → sign/submit each group
   * in order → poll until the credits land. The complete 402 loop —
   * after this resolves, retry whatever returned the 402.
   *
   * @param {object} p
   * @param {number|bigint} p.usdcMicro
   * @param {string} p.userAddress
   * @param {{assetId:number, amount?:number|bigint}[]} p.inputs
   * @param {Function} p.sign   as in `payInvoice`
   * @param {Function} p.submit as in `payInvoice`
   * @param {boolean} [p.waitForCredits=true] poll `creditBalance`
   *   until it rises (crediting lands ~1 block after the payment)
   * @param {number} [p.timeoutMs=60000]
   * @param {number} [p.pollMs=3000]
   * @returns {Promise<{offer:object, receipts:object[],
   *   balance:number|null}>}
   */
  async topupWithAssets({ usdcMicro, userAddress, inputs, sign, submit,
                          waitForCredits = true, timeoutMs = 60_000,
                          pollMs = 3_000 } = {}) {
    _fn(sign, "sign");
    _fn(submit, "submit");
    const before = waitForCredits
      ? (await this.creditBalance()).balance ?? 0 : 0;
    const offer = await this.creditOffer({ usdcMicro });
    const build = await this.topupBuild({
      nonce: offer.nonce, userAddress, inputs,
    });
    const receipts = [];
    for (const g of build.groups) {
      const signed = await sign(g.txnsB64, g.purpose);
      receipts.push({ purpose: g.purpose, result: await submit(signed, g.purpose) });
    }
    let balance = null;
    if (waitForCredits) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        balance = (await this.creditBalance()).balance ?? 0;
        if (balance > before) break;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      if (balance !== null && balance <= before) {
        throw new ApiError(
          `top-up paid but credits not visible within ${timeoutMs}ms — ` +
          `they land ~1 block after the payment confirms; check ` +
          `creditBalance() shortly`, { status: 0, detail: { offer } });
      }
    }
    return { offer, receipts, balance };
  }

  // ── market data (all cached ~5s at the edge) ─────────────────────

  /** Service health + uptime. */
  health() { return this._get("/health"); }

  /**
   * List tradable assets (paginated; `q` searches name/unit/id) — or
   * pass `ids` (array of asset ids, max 100) for a batch lookup that
   * ignores paging and returns exactly those assets.
   */
  assets({ limit = 100, cursor, q, ids } = {}) {
    if (ids != null) return this._get("/assets", { ids: _ids(ids) });
    return this._get("/assets", { limit, cursor, q });
  }

  /** One asset's metadata + prices. */
  asset(assetId) { return this._get(`/assets/${_int(assetId, "assetId")}`); }

  /** Batch price lookup for up to 100 asset ids in one call. */
  prices(ids) { return this._get("/prices", { ids: _ids(ids) }); }

  /** Batch per-asset TVL summaries for up to 100 asset ids. */
  assetsTvl(ids) { return this._get("/tvl/assets", { ids: _ids(ids) }); }

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
    if (this.apiKey) {
      init.headers = { ...(init.headers ?? {}), "X-API-Key": this.apiKey };
    }
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
    if (res.status === 402) {
      // The body IS the x402 offer — carry it whole so callers can
      // pay it (payInvoice / topupWithAssets) and retry.
      throw new PaymentRequiredError(msg, { ...opts, offer: payload });
    }
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

function _addr(v, name) {
  if (typeof v !== "string" || v.length !== 58) {
    throw new ValidationError(`${name} must be a 58-char Algorand address`);
  }
  return v;
}

function _fn(v, name) {
  if (typeof v !== "function") {
    throw new ValidationError(
      `${name} must be a function — the SDK never signs or submits ` +
      `itself (non-custodial); you provide those`);
  }
  return v;
}

function _inputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4) {
    throw new ValidationError("inputs must be 1-4 {assetId, amount?} entries");
  }
  return inputs.map((e, i) => {
    const out = { asset_id: _int(e.assetId, `inputs[${i}].assetId`) };
    // amount omitted on a single input = exact-out solves the minimum
    if (e.amount != null) out.amount = _int(e.amount, `inputs[${i}].amount`);
    return out;
  });
}

function _ids(ids) {
  const arr = Array.isArray(ids) ? ids : [ids];
  if (arr.length < 1 || arr.length > 100) {
    throw new ValidationError("ids must be 1-100 asset ids");
  }
  return arr.map((v, i) => _int(v, `ids[${i}]`)).join(",");
}

function _groupsResult(raw) {
  return {
    mode: raw.mode ?? null,
    atomic: raw.atomic ?? (raw.groups?.length === 1),
    groups: (raw.groups ?? []).map((g) => ({
      purpose: g.purpose,
      txnsB64: (g.txns ?? []).map((t) => t.txn_b64),
    })),
    raw,
  };
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
