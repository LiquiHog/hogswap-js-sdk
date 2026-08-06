# Examples

## Node quickstart (no wallet needed)

```
node examples/node-quote.mjs
```

Quotes 10 ALGO → USDC against the live API and prints the route.

## Browser page (quote + swap with Pera Wallet)

Serve the repo root with any static server and open `/examples/`:

```
npx serve .
```

The API is public with open CORS — the page works from any origin,
including your own domain when you lift the code into your app.

What the page demonstrates, all in one self-contained file you can take directly:

- token pickers populated from `GET /assets` (never hardcode ids),
- debounced type-to-quote with delivery-exact numbers and the route,
- sender-aware quoting the moment a wallet connects,
- the full execute → wallet-sign → algod-submit → confirm loop.

The wallet libraries (algosdk + Pera Connect) load lazily from a CDN,
so quoting works even if those fail to load. Your keys never leave the
wallet; the page submits the signed group to a public algod node.
