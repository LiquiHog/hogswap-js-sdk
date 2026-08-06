/**
 * HOGSWAP v1 SDK — amount helpers.
 *
 * The API speaks in BASE UNITS (integer µ-units): 1 ALGO = 1_000_000
 * base units, 1 USDC = 1_000_000 base units, etc. Each asset's
 * `decimals` comes from `client.assets()` / `client.asset(id)`.
 * These helpers convert between human amounts and base units without
 * floating-point drift.
 */

/**
 * "1.5" ALGO → 1500000n. Accepts a string or number; returns BigInt.
 * Throws on more decimal places than the asset supports.
 *
 * @param {string|number} amount human-readable amount, e.g. "12.34"
 * @param {number} decimals the asset's decimals (from /assets)
 * @returns {bigint} integer base units
 */
export function toBaseUnits(amount, decimals) {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`invalid amount: ${JSON.stringify(amount)}`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(
      `amount ${s} has ${frac.length} decimal places; asset supports ${decimals}`,
    );
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/**
 * 1500000 → "1.5" (with the asset's decimals). Accepts number,
 * bigint, or numeric string; returns a trimmed decimal string.
 *
 * @param {number|bigint|string} baseUnits integer base units
 * @param {number} decimals the asset's decimals
 * @returns {string} human-readable amount
 */
export function fromBaseUnits(baseUnits, decimals) {
  let v = BigInt(baseUnits);
  const neg = v < 0n;
  if (neg) v = -v;
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return (neg ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}
