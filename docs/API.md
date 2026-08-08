# HOGSWAP v1 API reference

Base URL: `https://hogswap-v1.liquihog.dev`

All requests/responses are JSON. Every amount is an **integer in base
units** (µ-units): 1 ALGO = 1,000,000; each ASA's `decimals` comes from
`GET /assets`. Asset id `0` is ALGO.

> **Precision note:** amounts travel as JSON numbers. JavaScript
> parses those as IEEE doubles, so a response amount above
> 2^53−1 base units (~9.0e15 — possible only for extreme-supply
> ASAs) would lose precision at `JSON.parse`. The SDK strictly
> rejects unsafe amounts on the *request* side; on the response side
> this is a wire-format limitation to be aware of when handling
> such assets.

Limits (see README): 30 quotes/10s/IP · 4 concurrent/IP · 5 builds per
quote · quotes expire ~30s · data endpoints edge-cached ~5s.

---

## POST /quote

One endpoint, several modes. Common optional fields for every mode:

| field | type | default | notes |
|---|---|---|---|
| `sender` | string | — | wallet that will sign; prices its HOG fee discount exactly. Recommended whenever a wallet is connected. |
| `slippage_bps` | int | 50 (100 LP) | tolerance in basis points, 1-5000 |
| `max_hops` | int | 3 | 1-4 intermediate assets — SWAP-family modes only; LP modes route their conversion legs with a fixed internal depth and ignore this field |

### Swap (default mode)

```json
{ "asset_in": 0, "asset_out": 31566704, "amount_in": 10000000 }
```

Optional `cover_algo_fee: true` — delivers an ALGO rebate covering the
group's network fees alongside the output (some routes can't support
it; you'll get HTTP 422 with a reason).

### Exact output

```json
{ "asset_in": 0, "asset_out": 31566704, "amount_out": 10000000 }
```

Finds the minimum input whose on-chain floor covers `amount_out`.
Response `amount_in` = required input; the floor equals your target.

### Multi-input (2-4 assets → one)

```json
{ "inputs": [ { "asset_id": 31566704, "amount": 3000000 },
              { "asset_id": 312769,   "amount": 3000000 } ],
  "asset_out": 0 }
```

One atomic session, one aggregate floor on the output.

### Basket (one input → primary + up to 3 exact side outputs)

```json
{ "asset_in": 31566704, "amount_in": 10000000, "asset_out": 0,
  "extra_outputs": [ { "asset_id": 312769, "amount": 2000000 } ] }
```

Each secondary is delivered at least at its target (fee-free); the
primary receives the remainder with the usual slippage floor.

### LP mint

```json
{ "mode": "LP_MINT", "pool_app_id": 3544791001, "tier_index": 1,
  "amount_a": 5000000 }
```

Deposit shapes: single-sided (`amount_a` or `amount_b`), custom two-sided
(both), third-asset (`external_inputs`: 1-2 entries in ANY asset — the
router converts cross-DEX to the tier ratio), or mixed (pool asset +
external). Response includes an `lp` object (`expected_lp_out`,
`lp_asset_id`, `requires_multi_deposit`, …). The wallet must be opted
into the LP asset before executing.

### LP redeem

```json
{ "mode": "LP_REDEEM", "pool_app_id": 3544791001, "tier_index": 1,
  "lp_amount": 1000000, "target_asset": 0 }
```

`target_asset` may be a pool asset or any other asset (converted).

### Quote response (all modes)

| field | meaning |
|---|---|
| `quote_id` | pass to `/execute`; expires ~30s |
| `expected_out` | delivered amount, routing fee included |
| `expected_out_robust` | conservative estimate under pool drift |
| `min_out_at_slippage` | the on-chain floor; below it the group reverts |
| `legs[]` | route: `{pool_id, dex_kind, dex_name, asset_in, asset_out, planned_in, planned_out}` |
| `network_fee_microalgo` | total group fees the signer pays |
| `path_breakdown[]` | per-path input/output split |
| `lp` | LP modes only (see above) |

Errors: `404` no route / target unachievable · `400/422` invalid
request (detail says why) · `429` rate limited.

---

## POST /execute

```json
{ "quote_id": "…", "user_address": "WALLET…" }
```

Returns `unsigned_group`: an array of `{ txn_b64, description }` —
base64 msgpack **unsigned** transactions in group order, built against
current chain state. Sign all of them with the user's wallet
(`algosdk.decodeUnsignedTransaction` each) and submit the group to any
algod node. The response also carries `group_id_b64`, `n_outers`,
`fee_microalgo`.

Call execute right before prompting the wallet. Errors: `404` quote
expired/unknown · `429` build budget spent (5 per quote) · `422/502`
route no longer buildable (get a fresh quote).

**Safety model:** the group is atomic; the on-chain minimum from your
quote is enforced by the router contract; the API never sees keys and
never broadcasts. Wallets should verify every transaction's sender is
the connected account (they all are).

---

## Market data (GET, edge-cached ~5s)

| endpoint | returns |
|---|---|
| `/health` | service status, uptime |
| `/assets?limit&cursor&q` | tradable assets with names, decimals, prices |
| `/assets/{id}` | one asset |
| `/assets/{id}/pools?kind&min_tvl_algo_micro` | pools trading the asset, TVL-sorted |
| `/pools` | pools across every DEX |
| `/pools/{id}` | one pool |
| `/stamm/pools` | STAMM pools with per-tier state (LP flows) |
| `/pairs/{a}/{b}` | pair view between two assets |
| `/price/{id}` | `price_algo_micro`, `price_usd_micro`, `price_confidence_bps` |
| `/prices/anchors` | the pricing engine's anchor assets |
| `/staking-assets` | liquid-staking tokens with redemption rates |
| `/tvl` | protocol-wide TVL |
| `/stream/blocks` | Server-Sent Events: per-block reserve updates |

Prices: `price_algo_micro` = µALGO per whole unit; `price_usd_micro` =
µUSD per whole unit; `price_confidence_bps` 0-10000, higher = more
reliable.

## Batch lookups (1.1.0)

| Endpoint | SDK method | Notes |
|---|---|---|
| `GET /assets?ids=1,2` | `assets({ ids })` | up to 100 ids, order-preserving, unknown ids omitted |
| `GET /prices?ids=1,2` | `prices(ids)` | batch price lookup |
| `GET /tvl/assets?ids=1,2` | `assetsTvl(ids)` | per-asset TVL summaries |

## x402 — paid tier + universal payment rail (1.1.0)

Free anonymous quotes never change. Presenting an `X-API-Key`
(`apiKey` client option) opts into the credit tier; out of credits,
the API answers **HTTP 402** whose body is an x402 offer — the SDK
throws `PaymentRequiredError` with the offer attached.

| Endpoint | SDK method | Notes |
|---|---|---|
| `POST /credits/register` | `register({ address })` | challenge to sign — zero-human key issuance |
| `POST /credits/register/verify` | `registerVerify({...})` | returns `api_key` ONCE |
| `GET /credits/balance` | `creditBalance()` | balance + per-endpoint weights |
| `POST /credits/topup` | `creditOffer({ usdcMicro })` | returns the 402 offer (`accepts`, `nonce`, `credits_granted`) |
| `POST /credits/topup/build` | `topupBuild({...})` | unsigned groups paying a pending top-up with any 1-4 assets |
| `GET /pay/x402/assets` | `payableAssets()` | accepted payment inputs (confidence-gated) |
| `POST /pay/x402/build` | `payX402Build({...})` | unsigned groups paying ANY Algorand x402 invoice |

**Group semantics (both build endpoints):** the response is
`groups[]` — usually `swap` then `payment` (or a single `payment` in
`direct` mode when you already hold the demanded asset). Sign every
transaction in one pass, then **submit the groups in order**: the
swap is floor-gated on-chain at the payment amount, so the payment is
funded by construction; if the payment group somehow fails you keep
the swapped asset and can resubmit it. Overshoot above the payment
stays with the payer.

**Orchestrators:** `payInvoice({ invoice, userAddress, inputs, sign,
submit })` and `topupWithAssets({ usdcMicro, ..., sign, submit })`
run build -> sign -> submit per group in order (top-ups also poll
until credits land, ~1 block). `sign(txnsB64, purpose)` and
`submit(signed, purpose)` are YOUR callbacks — the SDK is strictly
non-custodial and never sees keys. Never pass a mnemonic anywhere.

EVM-settled invoices are rejected with HTTP 400 (no bridge; Algorand
-settled x402 only).
