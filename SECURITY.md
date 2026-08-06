# Security policy

## Reporting a vulnerability

If you find a security issue in this SDK, the HOGSWAP API, or the
router contracts, please email **liquihog@gmail.com** — ideally with
steps to reproduce. Please do not open a public issue for anything
exploitable before it has been addressed.

## Scope worth knowing

- **This SDK never handles keys.** It requests quotes and receives
  unsigned transactions; signing happens entirely in the caller's
  wallet, and submission goes to whatever algod node the caller
  chooses. There is no secret material in this codebase to leak.
- **The on-chain safety model** is enforced by the router contract:
  every trade group is atomic, and delivery below the quoted
  `min_out_at_slippage` reverts the whole group.
- Dependencies: none at runtime. The example page lazily loads
  `algosdk` and Pera Connect from a CDN, pinned to exact versions.
