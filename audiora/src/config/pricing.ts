/**
 * ==========================================================================
 * PRICING — SINGLE SOURCE OF TRUTH
 *
 * Every price, credit count, file limit, feature line and button label in the
 * UI is derived from this file. Nothing is hard-coded in a component, so the
 * displayed plan and the plan logic cannot drift apart.
 *
 * Two regions only, because only two price tables exist:
 *   IN   → Indian Rupees
 *   INTL → US Dollars (everywhere outside India)
 *
 * Yearly prices are REAL prices, not monthly × 12. Any "you save" figure shown
 * in the UI is computed as (monthly × 12 − yearly), so it is arithmetic on
 * these numbers rather than an invented discount.
 * ==========================================================================
 */

export type PlanId = 'starter' | 'plus' | 'pro';
export type Region = 'IN' | 'INTL';
export type Cycle = 'monthly' | 'yearly';

export interface RegionInfo {
  id: Region;
  label: string;
  currency: string;
  symbol: string;
}

export const REGIONS: Record<Region, RegionInfo> = {
  IN: { id: 'IN', label: 'India', currency: 'INR', symbol: '₹' },
  INTL: { id: 'INTL', label: 'International', currency: 'USD', symbol: '$' },
};

export const REGION_LIST: RegionInfo[] = [REGIONS.IN, REGIONS.INTL];

/** What a plan gives you on one billing cycle. */
export interface PlanTier {
  credits: number;
  /** How many files can be converted over the cycle. Never called "songs". */
  files: number;
  /** Price for the whole cycle, per region. */
  price: Record<Region, number>;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  featured?: boolean;
  badge?: string;
  monthly: PlanTier;
  yearly: PlanTier;
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For occasional projects.',
    monthly: { credits: 500, files: 50, price: { IN: 49, INTL: 1 } },
    yearly: { credits: 6_000, files: 600, price: { IN: 499, INTL: 10 } },
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'The sweet spot for regular work.',
    featured: true,
    badge: 'Best value',
    monthly: { credits: 1_000, files: 100, price: { IN: 99, INTL: 2 } },
    yearly: { credits: 12_000, files: 1_200, price: { IN: 999, INTL: 20 } },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For heavy, everyday use.',
    monthly: { credits: 2_000, files: 200, price: { IN: 199, INTL: 4 } },
    yearly: { credits: 25_000, files: 2_500, price: { IN: 1_999, INTL: 40 } },
  },
];

/** Capabilities every paid plan includes. */
export const SHARED_FEATURES = [
  'Vocal Remover + Stem Splitter',
  'Noise Remover',
  'WAV 24-bit + 320kbps MP3',
  '4-stem splitter (drums + bass)',
];

export function planById(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function tierOf(plan: Plan, cycle: Cycle): PlanTier {
  return cycle === 'monthly' ? plan.monthly : plan.yearly;
}

/* ------------------------------------------------------------ formatting -- */

export function formatPrice(amount: number, region: Region): string {
  const info = REGIONS[region];
  // Every price in the table is a whole number in both currencies.
  return `${info.symbol}${amount.toLocaleString('en-US')}`;
}

export function priceOf(plan: Plan, cycle: Cycle, region: Region): number {
  return tierOf(plan, cycle).price[region];
}

export function formatPlanPrice(plan: Plan, cycle: Cycle, region: Region): string {
  return formatPrice(priceOf(plan, cycle, region), region);
}

/** "Get Plus — ₹99" */
export function ctaLabel(plan: Plan, cycle: Cycle, region: Region): string {
  return `Get ${plan.name} — ${formatPlanPrice(plan, cycle, region)}`;
}

export function checkoutPath(plan: Plan, cycle: Cycle): string {
  return `/credits?plan=${plan.id}&billing=${cycle}`;
}

/**
 * Real saving from paying yearly: twelve monthly payments minus the yearly
 * price. Returns 0 when there is nothing to claim.
 */
export function yearlySaving(plan: Plan, region: Region): number {
  const twelveMonths = plan.monthly.price[region] * 12;
  return Math.max(0, twelveMonths - plan.yearly.price[region]);
}

export function formatSaving(plan: Plan, region: Region): string | null {
  const saving = yearlySaving(plan, region);
  if (saving <= 0) return null;
  const monthly = formatPrice(plan.monthly.price[region], region);
  return `Saves ${formatPrice(saving, region)} vs ${monthly} × 12`;
}

/** The feature list exactly as it should appear on a plan card. */
export function featuresFor(plan: Plan, cycle: Cycle): string[] {
  const tier = tierOf(plan, cycle);
  return [
    `${tier.credits.toLocaleString('en-US')} credits`,
    `Convert up to ${tier.files.toLocaleString('en-US')} files`,
    ...SHARED_FEATURES,
    cycle === 'monthly' ? 'Credits reset every month' : 'Credits valid for the full year',
  ];
}

/* ----------------------------------------------------------- comparison --- */

export interface ComparisonRow {
  label: string;
  values: Record<PlanId, string>;
}

/** Built from PLANS so the table can never disagree with the cards. */
export function comparisonRows(cycle: Cycle, region: Region): ComparisonRow[] {
  const per = (fn: (plan: Plan) => string): Record<PlanId, string> =>
    PLANS.reduce(
      (acc, plan) => {
        acc[plan.id] = fn(plan);
        return acc;
      },
      {} as Record<PlanId, string>,
    );

  return [
    { label: cycle === 'monthly' ? 'Price per month' : 'Price per year', values: per((p) => formatPlanPrice(p, cycle, region)) },
    { label: 'Credits', values: per((p) => tierOf(p, cycle).credits.toLocaleString('en-US')) },
    { label: 'Files', values: per((p) => `Up to ${tierOf(p, cycle).files.toLocaleString('en-US')}`) },
    { label: 'Vocal Remover + Stem Splitter', values: per(() => 'Yes') },
    { label: 'Noise Remover', values: per(() => 'Yes') },
    { label: 'WAV 24-bit + 320kbps MP3', values: per(() => 'Yes') },
    { label: '4-stem splitter (drums + bass)', values: per(() => 'Yes') },
  ];
}

export const PRICING_ASSURANCES = [
  { title: 'No Hidden Charges', body: 'What you see is what you pay.' },
  { title: 'Secure & Private', body: 'Your files are handled securely.' },
  { title: 'Cancel Anytime', body: 'No questions asked cancellation.' },
  { title: '24/7 Support', body: "We're here to help you anytime." },
];
