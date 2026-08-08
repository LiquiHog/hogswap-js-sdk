/**
 * HOGSWAP v1 SDK — public entry point.
 *
 *   import { HogswapClient } from "hogswap-js-sdk";
 *   const hogswap = new HogswapClient();
 *   const quote = await hogswap.swapQuote({ assetIn: 0, assetOut: 31566704, amountIn: 1_000_000 });
 */

export { HogswapClient } from "./client.js";
export { DEFAULT_BASE_URL, ALGO, USDC, LIMITS } from "./constants.js";
export { toBaseUnits, fromBaseUnits } from "./utils.js";
export {
  HogswapError,
  NetworkError,
  RateLimitError,
  PaymentRequiredError,
  QuoteExpiredError,
  ExecuteBudgetError,
  ValidationError,
  NoRouteError,
  NotFoundError,
  ApiError,
} from "./errors.js";
