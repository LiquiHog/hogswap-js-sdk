/**
 * HOGSWAP v1 SDK — TypeScript declarations.
 * Response shapes mirror the API wire format (snake_case) verbatim;
 * see docs/API.md for field-by-field descriptions.
 */

export declare const DEFAULT_BASE_URL: string;
export declare const ALGO: 0;
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
  fetch?: typeof fetch;
}

export declare class HogswapClient {
  baseUrl: string;
  sender: string | null;
  constructor(opts?: HogswapClientOptions);
  setSender(address: string | null): this;

  swapQuote(p: {
    assetIn: number; assetOut: number; amountIn: number | bigint;
    slippageBps?: number; maxHops?: number; coverAlgoFee?: boolean; sender?: string;
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

  health(): Promise<Record<string, unknown>>;
  assets(p?: { limit?: number; cursor?: string; q?: string }):
    Promise<{ assets: AssetInfo[]; next_cursor: string | null; as_of_round: number }>;
  asset(assetId: number): Promise<AssetInfo>;
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
