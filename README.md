# HOGSWAP SDK

The official JavaScript SDK for the **HOGSWAP v1 router API** — one call to
quote the best route across every integrated Algorand DEX (STAMM, Tinyman,
Pact, Humble, AlgoFi, Folks, liquid-staking mints), one call to get unsigned
transactions your user's wallet signs. The API never touches keys and never
broadcasts — your app stays in full control.

- **Zero dependencies.** Works in browsers, Node 18+, Deno, Bun, workers.
- **Honest numbers.** `expected_out` and `min_out_at_slippage` are what the
  contract actually delivers — routing fee included. Attach the user's wallet
  address and their HOG-holdings fee discount is priced in exactly.
- **Everything is atomic.** A swap either delivers at least the quoted
  minimum or the whole transaction group reverts. No partial fills, no
  stuck funds.

```
Base URL: https://hogswap-v1.liquihog.dev
```

## 60-second start (Node)

```js
import { HogswapClient, fromBaseUnits } from "hogswap-js-sdk";

const hogswap = new HogswapClient();

// How much USDC for 10 ALGO?  (amounts are integer base units: 1 ALGO = 1_000_000)
const quote = await hogswap.swapQuote({
  assetIn: 0,              // ALGO
  assetOut: 31566704,      // USDC
  amountIn: 10_000_000,
  slippageBps: 50,         // 0.5% tolerance
});

console.log("expected:", fromBaseUnits(quote.expected_out, 6), "USDC");
console.log("worst case:", fromBaseUnits(quote.min_out_at_slippage, 6), "USDC");
console.log("route:", quote.legs.map(l => l.dex_name).join(" + "));
```

## The full trade loop (browser + wallet)

```js
import { HogswapClient } from "hogswap-js-sdk";

const hogswap = new HogswapClient({ sender: userAddress }); // fee discount priced in

// 1. Quote
const quote = await hogswap.swapQuote({ assetIn: 0, assetOut: 31566704, amountIn: 10_000_000 });

// 2. Build unsigned transactions (call this right before signing)
const { txnsB64 } = await hogswap.execute({ quoteId: quote.quote_id, userAddress });

// 3. Sign with the user's wallet (Pera shown; any wallet works)
const unsigned = txnsB64.map(b64 => algosdk.decodeUnsignedTransaction(
  Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
const signed = await peraWallet.signTransaction([unsigned.map(txn => ({ txn }))]);

// 4. Submit to any algod node  (algosdk v2 returns { txId } — capital I)
const { txId } = await algod.sendRawTransaction(signed).do();
await algosdk.waitForConfirmation(algod, txId, 4);
```

A complete working page — token pickers, live quotes, Pera signing —
is in [`examples/index.html`](examples/index.html). Serve the repo
with any static server and open `/examples/`:

```
npx serve .
```

## Install

```
npm install hogswap-js-sdk
```

Installing from the repo (`npm install github:LiquiHog/hogswap-js-sdk`)
also works, or vendor `src/` — it's dependency-free ES modules.

## What you can quote

| Method | What it does |
|---|---|
| `swapQuote` | best route for `amountIn` of A → B |
| `exactOutQuote` | minimum input that guarantees an exact output |
| `multiInputQuote` | 2-4 assets → one output, single atomic group (dust consolidation) |
| `basketQuote` | one input → primary + up to 3 exact-amount side outputs |
| `lpMintQuote` | add liquidity to a STAMM pool tier — with pool assets **or any asset** (auto-converted) |
| `lpRedeemQuote` | burn LP tokens into any asset |
| `execute` | quote → unsigned transaction group |
| `swap` | quote + execute in one call |

Market data (all edge-cached ~5s): `assets`, `asset`, `assetPools`, `pools`,
`pool`, `stammPools`, `pair`, `price`, `priceAnchors`, `stakingAssets`,
`tvl`, `health`.

**Live block stream** — the one endpoint without a wrapper method: it's
plain Server-Sent Events:

```js
const es = new EventSource("https://hogswap-v1.liquihog.dev/stream/blocks");
es.onmessage = (e) => console.log("block:", JSON.parse(e.data));
```

`EventSource` is built into every browser. In Node it's still
experimental — run with `node --experimental-eventsource` (v22+) or
use any SSE client package.

Full request/response reference: [`docs/API.md`](docs/API.md).

## Amounts, fees, and floors — the three things to know

1. **Everything is integer base units.** 1 ALGO = 1,000,000 µALGO; each
   ASA's `decimals` comes from `assets()`. Use `toBaseUnits("1.5", 6)` /
   `fromBaseUnits(1500000, 6)` to convert safely.
2. **Quotes are delivery-exact.** The router's fee (5 bps, discounted by the
   sender's HOG holdings, free at 100+ HOG) is already subtracted from
   `expected_out` and `min_out_at_slippage`. Don't subtract anything
   client-side.
3. **`min_out_at_slippage` is enforced on-chain.** If market movement makes
   delivery fall below it, the group reverts atomically and the user only
   spends network fees.

## Being a good API citizen (limits)

| Limit | Value | On violation |
|---|---|---|
| Quote rate | 30 requests / 10s / IP | HTTP 429 for ~10s |
| Concurrency | 4 in-flight requests / IP | immediate HTTP 429 |
| Execute budget | 5 builds per `quote_id` | HTTP 429 — get a fresh quote |
| Quote lifetime | ~30 seconds | HTTP 404 on execute — get a fresh quote |

The SDK throws typed errors (`RateLimitError`, `QuoteExpiredError`,
`ExecuteBudgetError`, …) so handling these is an `instanceof` check.
Identical anonymous quotes within 5s are served from cache — repeats are
nearly free, so don't build your own quote cache.

**Tips:** debounce type-to-quote inputs (~300ms); request a quote when the
user is ready to see a price, execute right before signing; never hardcode
pool/app ids — everything you need is in the API responses. (The router's
on-chain app id may change between releases; transactions returned by
`execute` always target the current one.)

## FAQ

**Do I need an API key?** No. Public, rate-limited per IP.

**Browser CORS?** Open — call the API from any origin, browser or
server. There are no cookies or credentials involved; abuse control is
per-IP rate limiting, not origin gating.

**Which wallets work?** Any Algorand wallet that signs standard transaction
groups (Pera, Defly, Exodus, KMD, …). The API returns plain unsigned
transactions; nothing wallet-specific.

**Is my seed phrase ever involved?** Never. The API builds unsigned
transactions; signing happens entirely in your app/wallet, and you submit
to algod yourself.

## License

MIT — see [LICENSE](LICENSE).
