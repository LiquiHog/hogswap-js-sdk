/**
 * SDK unit tests — pure functions + client wiring via a stub fetch.
 * No network. Run: `npm test` (node --test, Node 18+).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HogswapClient,
  toBaseUnits,
  fromBaseUnits,
  ValidationError,
  RateLimitError,
  QuoteExpiredError,
  NoRouteError,
  NotFoundError,
} from "../src/index.js";

// ── amount helpers ──────────────────────────────────────────────────

test("toBaseUnits handles whole, fractional, and string amounts", () => {
  assert.equal(toBaseUnits("1.5", 6), 1_500_000n);
  assert.equal(toBaseUnits(10, 6), 10_000_000n);
  assert.equal(toBaseUnits("0.000001", 6), 1n);
  assert.equal(toBaseUnits("7", 0), 7n);
});

test("toBaseUnits rejects junk and over-precision", () => {
  assert.throws(() => toBaseUnits("1.2345678", 6));   // 7 dp on a 6-dp asset
  assert.throws(() => toBaseUnits("abc", 6));
  assert.throws(() => toBaseUnits("-1", 6));
  assert.throws(() => toBaseUnits("1.", 6));
});

test("fromBaseUnits round-trips and trims", () => {
  assert.equal(fromBaseUnits(1_500_000, 6), "1.5");
  assert.equal(fromBaseUnits(1n, 6), "0.000001");
  assert.equal(fromBaseUnits(0, 6), "0");
  assert.equal(fromBaseUnits(7, 0), "7");
  const v = toBaseUnits("123.456789", 6);
  assert.equal(fromBaseUnits(v, 6), "123.456789");
});

// ── stub-fetch client harness ───────────────────────────────────────

function stubClient(status, body, headers = {}) {
  const calls = [];
  const client = new HogswapClient({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
      };
    },
  });
  return { client, calls };
}

// ── input strictness (the "" → ALGO bug class) ─────────────────────

test("empty / boolean / unsafe amounts are rejected, never coerced", async () => {
  const { client } = stubClient(200, {});
  // async wrappers: validation throws synchronously, before a promise
  // exists — which is itself the desired behavior (fail fast).
  await assert.rejects(
    async () => client.swapQuote({ assetIn: "", assetOut: 1, amountIn: 5 }),
    ValidationError);
  await assert.rejects(
    async () => client.swapQuote({ assetIn: true, assetOut: 1, amountIn: 5 }),
    ValidationError);
  await assert.rejects(
    async () => client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 2n ** 60n }),
    ValidationError);                       // BigInt beyond safe range
  await assert.rejects(
    async () => client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 1.5 }),
    ValidationError);
});

test("safe BigInt amounts pass through exactly", async () => {
  const { client, calls } = stubClient(200, {});
  await client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 9_007_199_254_740_991n });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.amount_in, 9_007_199_254_740_991);
});

// ── GET params reach the URL (the Node-18 qs.size bug) ─────────────

test("GET query params are serialized into the URL", async () => {
  const { client, calls } = stubClient(200, { assets: [] });
  await client.assets({ limit: 5, q: "USDC" });
  assert.match(calls[0].url, /\/assets\?/);
  assert.match(calls[0].url, /limit=5/);
  assert.match(calls[0].url, /q=USDC/);
});

test("GET without params has no dangling question mark", async () => {
  const { client, calls } = stubClient(200, {});
  await client.tvl();
  assert.ok(calls[0].url.endsWith("/tvl"));
});

// ── error mapping ──────────────────────────────────────────────────

test("404 maps by endpoint: quote→NoRoute, execute→QuoteExpired, data→NotFound", async () => {
  {
    const { client } = stubClient(404, { detail: "no route" });
    await assert.rejects(
      client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 5 }), NoRouteError);
  }
  {
    const { client } = stubClient(404, { detail: "quote_id x not found" });
    await assert.rejects(
      client.execute({ quoteId: "x", userAddress: "A" }), QuoteExpiredError);
  }
  {
    const { client } = stubClient(404, { detail: "asset 999 not in catalogue" });
    await assert.rejects(client.asset(999), NotFoundError);
  }
});

test("429 carries Retry-After when the server sends it", async () => {
  const { client } = stubClient(429, { detail: "rate limited" },
                                { "retry-after": "7" });
  await assert.rejects(
    client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 5 }),
    (e) => e instanceof RateLimitError && e.retryAfterSeconds === 7);
});

test("429 defaults to ~10s without a header", async () => {
  const { client } = stubClient(429, { detail: "rate limited" });
  await assert.rejects(
    client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 5 }),
    (e) => e instanceof RateLimitError && e.retryAfterSeconds === 10);
});

// ── slippage / hops bounds ─────────────────────────────────────────

test("slippageBps and maxHops validate client-side with boundaries", async () => {
  const { client } = stubClient(200, {});
  const base = { assetIn: 0, assetOut: 1, amountIn: 5 };
  await assert.rejects(
    async () => client.swapQuote({ ...base, slippageBps: 0 }), ValidationError);
  await assert.rejects(
    async () => client.swapQuote({ ...base, slippageBps: 5001 }), ValidationError);
  await assert.rejects(
    async () => client.swapQuote({ ...base, slippageBps: "abc" }), ValidationError);
  await assert.rejects(
    async () => client.swapQuote({ ...base, maxHops: 5 }), ValidationError);
  await assert.rejects(
    async () => client.swapQuote({ ...base, maxHops: 0 }), ValidationError);
  // Valid boundaries pass through untouched.
  const { client: ok, calls } = stubClient(200, {});
  await ok.swapQuote({ ...base, slippageBps: 5000, maxHops: 4 });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.slippage_bps, 5000);
  assert.equal(sent.max_hops, 4);
});

// ── execute() fail-fast ────────────────────────────────────────────

test("execute() rejects missing params instead of a misleading 404", async () => {
  const { client, calls } = stubClient(404, { detail: "should never be reached" });
  await assert.rejects(
    async () => client.execute({ userAddress: "A" }), ValidationError);
  await assert.rejects(
    async () => client.execute({ quoteId: "q" }), ValidationError);
  await assert.rejects(async () => client.execute(), ValidationError);
  assert.equal(calls.length, 0);   // nothing traveled to the server
});

// ── swap() sender authority ────────────────────────────────────────

test("swap() prices the quote for userAddress even if sender is passed", async () => {
  const { client, calls } = stubClient(200, {
    quote_id: "q1", unsigned_group: [], group_id_b64: null,
  });
  await client.swap({
    userAddress: "USERADDR", sender: "SOMEONEELSE",
    assetIn: 0, assetOut: 1, amountIn: 5,
  });
  const quoteBody = JSON.parse(calls[0].init.body);
  assert.equal(quoteBody.sender, "USERADDR");
});

// ── x402: credits + universal pay rail (1.1.0) ─────────────────────

import { PaymentRequiredError, ValidationError as VErr } from "../src/index.js";

const ADDR = "A".repeat(58);
const OFFER = {
  x402_version: 1,
  accepts: [{ scheme: "algorand-exact", network: "algorand-mainnet",
              asset: 31566704, amount: "1000000", pay_to: "T".repeat(58),
              note: "nonce-1" }],
  nonce: "nonce-1", credits_granted: 1000,
};
const BUILD = {
  mode: "swap+pay", atomic: false, n_txns: 3,
  groups: [
    { purpose: "swap", txns: [{ txn_b64: "AA" }, { txn_b64: "BB" }] },
    { purpose: "payment", txns: [{ txn_b64: "CC" }] },
  ],
};

/** Sequenced stub: each call consumes the next {status, body}. */
function seqClient(responses, opts = {}) {
  const calls = [];
  const client = new HogswapClient({
    ...opts,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const { status, body } = responses[Math.min(calls.length - 1, responses.length - 1)];
      return {
        ok: status >= 200 && status < 300, status,
        headers: { get: () => null },
        json: async () => body,
      };
    },
  });
  return { client, calls };
}

test("402 responses throw PaymentRequiredError carrying the offer", async () => {
  const { client } = stubClient(402, OFFER);
  await assert.rejects(
    client.swapQuote({ assetIn: 0, assetOut: 1, amountIn: 5 }),
    (e) => e instanceof PaymentRequiredError &&
           e.offer?.accepts?.[0]?.note === "nonce-1");
});

test("creditOffer unwraps the 402 into the offer", async () => {
  const { client, calls } = stubClient(402, OFFER);
  const offer = await client.creditOffer({ usdcMicro: 1_000_000 });
  assert.equal(offer.nonce, "nonce-1");
  assert.equal(JSON.parse(calls[0].init.body).usdc_micro, 1_000_000);
});

test("apiKey rides every request as X-API-Key", async () => {
  const { client, calls } = stubClient(200, { balance: 7 });
  client.setApiKey("hsk_test");
  await client.creditBalance();
  assert.equal(calls[0].init.headers["X-API-Key"], "hsk_test");
});

test("payX402Build maps camelCase -> wire and unwraps groups", async () => {
  const { client, calls } = stubClient(200, BUILD);
  const res = await client.payX402Build({
    invoice: OFFER.accepts[0], userAddress: ADDR,
    inputs: [{ assetId: 0 }],
  });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.user_address, ADDR);
  assert.deepEqual(sent.inputs, [{ asset_id: 0 }]);   // amount omitted
  assert.equal(res.mode, "swap+pay");
  assert.deepEqual(res.groups.map((g) => g.purpose), ["swap", "payment"]);
  assert.deepEqual(res.groups[0].txnsB64, ["AA", "BB"]);
});

test("payInvoice signs and submits each group IN ORDER", async () => {
  const { client } = stubClient(200, BUILD);
  const order = [];
  const res = await client.payInvoice({
    invoice: OFFER.accepts[0], userAddress: ADDR,
    inputs: [{ assetId: 0 }],
    sign: async (txns, purpose) => { order.push(`sign:${purpose}`); return txns; },
    submit: async (_signed, purpose) => { order.push(`submit:${purpose}`); return `tx-${purpose}`; },
  });
  assert.deepEqual(order,
    ["sign:swap", "submit:swap", "sign:payment", "submit:payment"]);
  assert.deepEqual(res.receipts.map((r) => r.result), ["tx-swap", "tx-payment"]);
});

test("payInvoice demands sign/submit callbacks (non-custodial)", async () => {
  const { client } = stubClient(200, BUILD);
  await assert.rejects(
    async () => client.payInvoice({
      invoice: OFFER.accepts[0], userAddress: ADDR,
      inputs: [{ assetId: 0 }],
    }), VErr);
});

test("topupWithAssets: offer -> build -> submit -> credits land", async () => {
  const { client, calls } = seqClient([
    { status: 200, body: { balance: 0 } },      // balance before
    { status: 402, body: OFFER },               // offer
    { status: 200, body: BUILD },               // topup build
    { status: 200, body: { balance: 1000 } },   // poll: landed
  ]);
  const order = [];
  const res = await client.topupWithAssets({
    usdcMicro: 1_000_000, userAddress: ADDR, inputs: [{ assetId: 0 }],
    sign: async (t, p) => { order.push(`sign:${p}`); return t; },
    submit: async (_s, p) => { order.push(`submit:${p}`); return p; },
    pollMs: 1,
  });
  assert.equal(res.balance, 1000);
  assert.equal(res.offer.nonce, "nonce-1");
  assert.deepEqual(order,
    ["sign:swap", "submit:swap", "sign:payment", "submit:payment"]);
  assert.match(calls[2].url, /\/credits\/topup\/build$/);
  assert.equal(JSON.parse(calls[2].init.body).nonce, "nonce-1");
});

// ── batch lookups (1.1.0) ──────────────────────────────────────────

test("prices/assetsTvl/assets serialize ids as comma lists", async () => {
  const { client, calls } = stubClient(200, {});
  await client.prices([0, 31566704]);
  assert.match(calls[0].url, /\/prices\?ids=0%2C31566704|\/prices\?ids=0,31566704/);
  await client.assetsTvl([5]);
  assert.match(calls[1].url, /\/tvl\/assets\?ids=5/);
  await client.assets({ ids: [1, 2, 3] });
  assert.match(calls[2].url, /\/assets\?ids=1%2C2%2C3|\/assets\?ids=1,2,3/);
});

test("ids batches reject empty and >100", async () => {
  const { client } = stubClient(200, {});
  await assert.rejects(async () => client.prices([]), VErr);
  await assert.rejects(
    async () => client.prices(Array.from({ length: 101 }, (_, i) => i)), VErr);
});
