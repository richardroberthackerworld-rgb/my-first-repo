/**
 * ==========================================================================
 * CURRENCY / COUNTRY PRICING
 *
 * Plan prices live in `pricing.ts` as USD. This file turns them into a local
 * price for the visitor's country.
 *
 * `multiplier` is a DISPLAY conversion, not a live exchange rate — nothing here
 * calls an FX service. Treat these as your local price points and edit them to
 * whatever you actually want to charge in each market; the UI reads only this
 * file, so changing a number here changes it everywhere.
 * ==========================================================================
 */

export type CountryCode = 'IN' | 'US' | 'EU' | 'GB' | 'CA' | 'AU' | 'JP';

export interface Currency {
  country: CountryCode;
  /** Shown in the country selector. */
  label: string;
  code: string;
  symbol: string;
  /** Multiplied against the USD price in pricing.ts. */
  multiplier: number;
  decimals: 0 | 2;
  /**
   * Nudge the result to a familiar price point. `charm9` rounds up to the next
   * multiple of ten minus one (699, 1,499 …), which is how prices are usually
   * quoted in whole-unit currencies.
   */
  rounding: 'charm9' | 'exact';
}

/** India first — it is the default market. */
export const CURRENCIES: Currency[] = [
  { country: 'IN', label: 'India', code: 'INR', symbol: '₹', multiplier: 83, decimals: 0, rounding: 'charm9' },
  { country: 'US', label: 'United States', code: 'USD', symbol: '$', multiplier: 1, decimals: 2, rounding: 'exact' },
  { country: 'EU', label: 'Europe', code: 'EUR', symbol: '€', multiplier: 0.92, decimals: 2, rounding: 'exact' },
  { country: 'GB', label: 'United Kingdom', code: 'GBP', symbol: '£', multiplier: 0.79, decimals: 2, rounding: 'exact' },
  { country: 'CA', label: 'Canada', code: 'CAD', symbol: 'C$', multiplier: 1.36, decimals: 2, rounding: 'exact' },
  { country: 'AU', label: 'Australia', code: 'AUD', symbol: 'A$', multiplier: 1.52, decimals: 2, rounding: 'exact' },
  { country: 'JP', label: 'Japan', code: 'JPY', symbol: '¥', multiplier: 152, decimals: 0, rounding: 'charm9' },
];

export const DEFAULT_COUNTRY: CountryCode = 'IN';

export function currencyFor(country: CountryCode): Currency {
  return CURRENCIES.find((c) => c.country === country) ?? CURRENCIES[0];
}

/** Convert a USD figure into the given currency and round it sensibly. */
export function convert(usd: number, currency: Currency): number {
  if (usd <= 0) return 0;
  const raw = usd * currency.multiplier;

  if (currency.decimals === 0) {
    if (currency.rounding === 'charm9') {
      // 663 → 669, 1,842 → 1,849
      return Math.ceil(raw / 10) * 10 - 1;
    }
    return Math.round(raw);
  }
  return Math.round(raw * 100) / 100;
}

/** Format an already-converted amount with its symbol and grouping. */
export function formatAmount(value: number, currency: Currency): string {
  if (value <= 0) return `${currency.symbol}0`;
  const body = value.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
  return `${currency.symbol}${body}`;
}

/** Convenience: USD in, formatted local string out. */
export function formatLocal(usd: number, currency: Currency): string {
  return formatAmount(convert(usd, currency), currency);
}
