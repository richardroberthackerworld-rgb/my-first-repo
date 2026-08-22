'use strict';

/**
 * 7 Audio plan table — the SERVER's copy, and the only one that decides money.
 *
 * The browser sends a plan id and a region. It never sends an amount. These
 * numbers must stay in step with audiora/src/config/pricing.ts, which is the
 * display copy; if the two ever disagree, this file wins and the customer is
 * charged what is written here.
 */

const PLANS = {
  starter: {
    id: 'starter',
    name: '7 Audio Starter',
    monthly: { credits: 500, files: 50, price: { IN: 49, INTL: 1 } },
    yearly: { credits: 6000, files: 600, price: { IN: 499, INTL: 10 } },
  },
  plus: {
    id: 'plus',
    name: '7 Audio Plus',
    monthly: { credits: 1000, files: 100, price: { IN: 99, INTL: 2 } },
    yearly: { credits: 12000, files: 1200, price: { IN: 999, INTL: 20 } },
  },
  pro: {
    id: 'pro',
    name: '7 Audio Pro',
    monthly: { credits: 2000, files: 200, price: { IN: 199, INTL: 4 } },
    yearly: { credits: 25000, files: 2500, price: { IN: 1999, INTL: 40 } },
  },
};

const CURRENCY = { IN: 'INR', INTL: 'USD' };

/**
 * Resolve a client request into a priced, credited plan.
 * Returns null for anything unrecognised — callers must treat that as a 400.
 */
function resolvePlan(planId, cycle, region) {
  const plan = PLANS[String(planId || '').toLowerCase()];
  if (!plan) return null;

  const billing = cycle === 'yearly' ? 'yearly' : 'monthly';
  const market = region === 'IN' ? 'IN' : 'INTL';
  const tier = plan[billing];
  const amount = tier.price[market];
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    planId: plan.id,
    cycle: billing,
    region: market,
    amount,
    currency: CURRENCY[market],
    credits: tier.credits,
    files: tier.files,
    label: `${plan.name} — ${billing === 'yearly' ? 'yearly' : 'monthly'}`,
  };
}

module.exports = { PLANS, CURRENCY, resolvePlan };
