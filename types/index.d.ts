/**
 * HOGSWAP v1 SDK — TypeScript declarations.
 * Response shapes mirror the API wire format (snake_case) verbatim;
 * see docs/API.md for field-by-field descriptions.
 */

export declare const DEFAULT_BASE_URL: string;
export declare const ALGO: 0;
export declare const USDC: 31566704;
export declare const LIMITS: Readonly<{
  QUOTE_RATE_LIMIT: Readonly<{ requests: number; windowSeconds: number }>;
  EXECUTE_BUDGET_PER_QUOTE: number;
  CONCURRENT_PER_IP: number;
  QUOTE_TTL_SECONDS: number;
}>;

export declare function toBaseUnits(amount: string | number, decimals: number): bigint;
export declare function fromBaseUnits(baseUnits: number | bigint | string, decimals: number): string;

// ── errors ──────────────────────────────────────────────────────────

export declare class HogswapError extends Error {
  status: number;
  detail: unknown;
}
export declare class NetworkError extends HogswapError {}
export declare class RateLimitError extends HogswapError { retryAfterSeconds: number; }
export declare class QuoteExpiredError extends HogswapError {}
export declare class ExecuteBudgetError extends HogswapError {}
export declare class ValidationError extends HogswapError {}
export declare class NoRouteError extends HogswapError {}
export declare class NotFoundError extends HogswapError {}
export declare class ApiError extends HogswapError {}
export declare class PaymentRequiredError extends HogswapError {
  /** The x402 offer body (`x402_version`, `accepts`, ...). */
  offer: X402Offer | null;
}

// ── x402 shapes ─────────────────────────────────────────────────────

export interface X402AcceptsEntry {
  scheme: string;
  network: string;
  asset: number | string;
  amount: string | number;
  pay_to: string;
  /** Invoice nonce — keep it; it rides the payment txn note. */
  note?: string;
  expires_unix?: number;
  [key: string]: unknown;
}

export interface X402Offer {
  x402_version: number;
  accepts: X402AcceptsEntry[];
  /** Credit top-up offers only. */
  nonce?: string;
  credits_granted?: number;
  [key: string]: unknown;
}

export interface PayInput { assetId: number; amount?: number | bigint; }

export interface UnsignedGroup {
  /** "swap" (submit first) or "payment". */
  purpose: string;
  /** Base64 msgpack unsigned transactions, in group order. */
  txnsB64: string[];
}

export interface PayBuildResult {
  /** "direct" (single payment txn) or "swap+pay" (two groups). */
  mode: string | null;
  atomic: boolean;
  /** Sign everything, then submit groups IN ORDER. */
  groups: UnsignedGroup[];
  raw: Record<string, unknown>;
}

/** Sign one group's unsigned txns; return whatever `submit` accepts. */
export type SignGroupFn = (txnsB64: string[], purpose: string) => unknown | Promise<unknown>;
/** Broadcast one signed group (and ideally wait for confirmation). */
export type SubmitGroupFn = (signed: unknown, purpose: string) => unknown | Promise<unknown>;

export interface GroupReceipt { purpose: string; result: unknown; }

// ── watches (1.2.0) ────────────────────────────────────────────────

export interface WatchEvent {
  /** "hello" opens every stream (carries the current seq — LOWER than
   * you last saw ⇒ backend restarted, reconcile via watches());
   * "fired" is a triggered watch. At-least-once — dedupe by seq. */
  type: "hello" | "fired";
  seq: number;
  client_key?: string;
  kind?: "target" | "price";
  round?: number;
  fired_unix?: number;
  /** Numbers only — no quote attached; re-quote at fire time. */
  observed?: Record<string, unknown>;
  watches?: number;
  [key: string]: unknown;
}

// ── wire shapes (partial but stable) ───────────────────────────────

export interface LegResponse {
  pool_id: number;
  dex_kind: number;
  dex_name: string;
  asset_in: number;
  asset_out: number;
  planned_in: number;
  planned_out: number;
}

export interface QuoteResponse {
  quote_id: string;
  asset_in: number;
  asset_out: number;
  amount_in: number;
  /** Delivered amount the contract pays out (routing fee included). */
  expected_out: number;
  expected_out_robust: number;
  /** The on-chain floor — delivery below this reverts atomically. */
  min_out_at_slippage: number;
  slippage_bps: number;
  legs: LegResponse[];
  network_fee_microalgo: number;
  requested_out?: number;
  mode?: string;
  lp?: {
    mode: string;
    pool_app_id: number;
    tier_index: number;
    lp_asset_id: number;
    expected_lp_out: number;
    expected_a_out: number;
    expected_b_out: number;
    requires_multi_deposit: boolean;
    used_pool_ratio: boolean;
    target_asset: number;
  };
  [key: string]: unknown;
}

export interface ExecuteResult {
  /** Base64 msgpack unsigned transactions, in group order. */
  txnsB64: string[];
  groupId: string | null;
  raw: Record<string, unknown>;
}

export interface AssetInfo {
  asset_id: number;
  name: string | null;
  unit_name: string | null;
  decimals: number;
  price_algo_micro: number | null;
  price_usd_micro: number | null;
  price_confidence_bps: number | null;
  [key: string]: unknown;
}

export interface AmountEntry { assetId: number; amount: number | bigint; }

// ── client ──────────────────────────────────────────────────────────

export interface HogswapClientOptions {
  baseUrl?: string;
  sender?: string | null;
  /** `hsk_` bearer key for the paid tier (X-API-Key header). */
  apiKey?: string | null;
  fetch?: typeof fetch;
}

export declare class HogswapClient {
  baseUrl: string;
  sender: string | null;
  apiKey: string | null;
  constructor(opts?: HogswapClientOptions);
  setSender(address: string | null): this;
  setApiKey(key: string | null): this;

  swapQuote(p: {
    assetIn: number; assetOut: number; amountIn: number | bigint;
    slippageBps?: number; maxHops?: number; coverAlgoFee?: boolean;
    /** Cap TOTAL route legs incl. parallel splits (1-16); maxHops
     * bounds depth only. Slightly worse price; 404 if nothing fits. */
    maxLegs?: number; sender?: string;
  }): Promise<QuoteResponse>;

  exactOutQuote(p: {
    assetIn: number; assetOut: number; amountOut: number | bigint;
    slippageBps?: number; maxHops?: number; sender?: string;
  }): Promise<QuoteResponse>;

  multiInputQuote(p: {
    inputs: AmountEntry[]; assetOut: number;
    slippageBps?: number; maxHops?: number; sender?: string;
  }): Promise<QuoteResponse>;

  basketQuote(p: {
    assetIn: number; amountIn: number | bigint; assetOut: number;
    extraOutputs: AmountEntry[];
    slippageBps?: number; maxHops?: number; sender?: string;
  }): Promise<QuoteResponse>;

  lpMintQuote(p: {
    poolAppId: number; tierIndex: number;
    amountA?: number | bigint; amountB?: number | bigint;
    externalInputs?: AmountEntry[];
    slippageBps?: number; sender?: string;
  }): Promise<QuoteResponse>;

  lpRedeemQuote(p: {
    poolAppId: number; tierIndex: number;
    lpAmount: number | bigint; targetAsset: number;
    slippageBps?: number; sender?: string;
  }): Promise<QuoteResponse>;

  execute(p: { quoteId: string; userAddress: string }): Promise<ExecuteResult>;

  swap(p: {
    userAddress: string; assetIn: number; assetOut: number;
    amountIn: number | bigint; slippageBps?: number; maxHops?: number;
    coverAlgoFee?: boolean;
  }): Promise<{ quote: QuoteResponse; txnsB64: string[]; groupId: string | null }>;

  // ── x402: credits + the universal pay rail ──
  register(p: { address: string }): Promise<Record<string, unknown>>;
  registerVerify(p: { address: string; challenge: string; signatureB64: string }):
    Promise<{ api_key: string; address: string; [key: string]: unknown }>;
  creditBalance(): Promise<{ balance: number; [key: string]: unknown }>;
  creditOffer(p: { usdcMicro: number | bigint }): Promise<X402Offer>;
  payableAssets(): Promise<{ count: number; min_confidence_bps: number;
    assets: { asset_id: number; price_confidence_bps: number | null }[] }>;
  payX402Build(p: { invoice: X402AcceptsEntry; userAddress: string;
    inputs: PayInput[] }): Promise<PayBuildResult>;
  topupBuild(p: { nonce: string; userAddress: string;
    inputs: PayInput[] }): Promise<PayBuildResult>;
  payInvoice(p: { invoice: X402AcceptsEntry; userAddress: string;
    inputs: PayInput[]; sign: SignGroupFn; submit: SubmitGroupFn }):
    Promise<PayBuildResult & { receipts: GroupReceipt[] }>;
  topupWithAssets(p: { usdcMicro: number | bigint; userAddress: string;
    inputs: PayInput[]; sign: SignGroupFn; submit: SubmitGroupFn;
    waitForCredits?: boolean; timeoutMs?: number; pollMs?: number }):
    Promise<{ offer: X402Offer; receipts: GroupReceipt[]; balance: number | null }>;

  // ── watches: standing conditions + per-key SSE alerts (1.2.0) ──
  putWatch(p: {
    clientKey: string; kind: "target" | "price";
    assetIn?: number; assetOut?: number; amountIn?: number | bigint;
    minOut?: number | bigint; marginBps?: number;
    assetId?: number; op?: "gte" | "lte";
    thresholdUsdMicro?: number | bigint;
    rearmBps?: number; cooldownS?: number; ttlS?: number;
  }): Promise<{ watch: Record<string, unknown>; active: number;
                quota: number }>;
  watches(): Promise<{ watches: Record<string, unknown>[]; count: number;
                       quota: number; latest_seq: number }>;
  deleteWatch(clientKey: string): Promise<{ deleted: string }>;
  watchEvents(p?: { sinceSeq?: number; signal?: AbortSignal }):
    AsyncGenerator<WatchEvent>;
  watchStreamUrl(p?: { sinceSeq?: number }): string;

  health(): Promise<Record<string, unknown>>;
  assets(p?: { limit?: number; cursor?: string; q?: string; ids?: number[] }):
    Promise<{ assets: AssetInfo[]; next_cursor: string | null; as_of_round: number }>;
  asset(assetId: number): Promise<AssetInfo>;
  prices(ids: number[]): Promise<Record<string, unknown>>;
  assetsTvl(ids: number[]): Promise<Record<string, unknown>>;
  assetPools(assetId: number, p?: { kind?: number; minTvlAlgoMicro?: number }): Promise<Record<string, unknown>>;
  pools(params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  pool(poolId: number): Promise<Record<string, unknown>>;
  stammPools(): Promise<Record<string, unknown>>;
  pair(assetA: number, assetB: number): Promise<Record<string, unknown>>;
  price(assetId: number): Promise<Record<string, unknown>>;
  priceAnchors(): Promise<Record<string, unknown>>;
  stakingAssets(): Promise<Record<string, unknown>>;
  tvl(): Promise<Record<string, unknown>>;
}
