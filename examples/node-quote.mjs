/**
 * HOGSWAP SDK — Node quickstart.
 *
 *   node examples/node-quote.mjs
 *
 * Quotes 10 ALGO → USDC, prints the route, then shows an LP-mint
 * quote. Read-only: nothing is signed or broadcast.
 */
import { HogswapClient, fromBaseUnits, RateLimitError } from "../src/index.js";

const hogswap = new HogswapClient();

try {
  const usdc = 31_566_704;

  const quote = await hogswap.swapQuote({
    assetIn: 0,            // ALGO
    assetOut: usdc,
    amountIn: 10_000_000,  // 10 ALGO in base units
    slippageBps: 50,
  });

  console.log("── 10 ALGO → USDC ─────────────────────────────");
  console.log("expected:  ", fromBaseUnits(quote.expected_out, 6), "USDC");
  console.log("worst case:", fromBaseUnits(quote.min_out_at_slippage, 6), "USDC");
  console.log("network fee:", fromBaseUnits(quote.network_fee_microalgo, 6), "ALGO");
  console.log("route:");
  for (const leg of quote.legs) {
    console.log(`  ${leg.dex_name}  pool ${leg.pool_id}  ${leg.asset_in} → ${leg.asset_out}`);
  }
  console.log("quote_id:", quote.quote_id, "(valid ~30s — pass to execute())");

  // Market data: top of the asset list.
  const { assets } = await hogswap.assets({ limit: 5 });
  console.log("\n── first assets from /assets ──────────────────");
  for (const a of assets) {
    console.log(`  ${a.asset_id}  ${a.unit_name ?? "?"}  (${a.decimals} dp)`);
  }
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(`Rate limited — retry in ~${err.retryAfterSeconds}s`);
  } else {
    console.error(`${err.name}: ${err.message}`);
  }
  process.exitCode = 1;
}
