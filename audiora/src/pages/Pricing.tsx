import { useState } from 'react';
import { Check, Crown, Globe, Headphones, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Segmented } from '@/components/ui/Controls';
import { InlineNotice } from '@/components/ui/States';
import { PlayStoreCard } from '@/components/PlayStoreCard';
import {
  PLANS,
  PRICING_ASSURANCES,
  REGION_LIST,
  comparisonRows,
  featuresFor,
  formatPlanPrice,
  formatSaving,
  type Cycle,
  type Plan,
  type Region,
} from '@/config/pricing';
import { useRegion } from '@/hooks/useRegion';
import { backendConfigured } from '@/services/api';
import { BuyPlanButton } from '@/components/BuyPlanButton';

export default function Pricing() {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const { region, setRegion, info } = useRegion();
  const backendReady = backendConfigured();

  return (
    <>
      <section className="container section" style={{ paddingBottom: 24 }}>
        <header style={{ textAlign: 'center', maxWidth: 660, margin: '0 auto' }}>
          <span className="badge badge-ai" style={{ marginBottom: 14 }}>
            Simple, Transparent Pricing
          </span>
          <h1>
            Choose the plan that <span className="grad-text">fits you</span>
          </h1>
          <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 12 }}>
            Powerful audio tools for everyone. Upgrade anytime, cancel anytime.
          </p>

          <div className="pricing-controls">
            <Segmented<Cycle>
              label="Billing cycle"
              value={cycle}
              onChange={setCycle}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />

            <div className="country-select">
              <label
                htmlFor="pricing-region"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}
              >
                <Globe size={14} aria-hidden="true" />
                Region
              </label>
              <select
                id="pricing-region"
                className="field"
                value={region}
                onChange={(event) => setRegion(event.target.value as Region)}
                style={{ width: 'auto', minWidth: 180 }}
              >
                {REGION_LIST.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} ({r.symbol} {r.currency})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>
      </section>

      <section className="container" style={{ paddingBottom: 32 }}>
        <div className="plans-grid">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} cycle={cycle} region={region} />
          ))}
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 18 }}>
          All prices in {info.currency}. Taxes may apply at checkout.
        </p>

        {!backendReady && (
          <div style={{ maxWidth: 720, margin: '18px auto 0' }}>
            <InlineNotice kind="info">
              Checkout is not connected yet, so these buttons cannot take a payment. Every tool on the site is free to
              use in the meantime.
            </InlineNotice>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- assurances */}
      <section className="container" style={{ paddingBottom: 36 }}>
        <div className="card assurance-strip">
          {PRICING_ASSURANCES.map((item, index) => (
            <div key={item.title} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', minWidth: 0 }}>
              <span
                style={{
                  width: 36,
                  height: 36,
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 11,
                  background: 'var(--brand-soft)',
                  color: 'var(--brand)',
                }}
              >
                {[<Sparkles size={16} />, <ShieldCheck size={16} />, <Zap size={16} />, <Headphones size={16} />][index % 4]}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{item.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>{item.body}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- comparison */}
      <section className="container" style={{ paddingBottom: 40 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 20 }}>Compare plans</h2>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="scroll-x">
            <table className="plan-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} scope="col">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows(cycle, region).map((row) => (
                  <tr key={row.label}>
                    <th scope="row" style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                      {row.label}
                    </th>
                    {PLANS.map((plan) => {
                      const value = row.values[plan.id];
                      return (
                        <td key={plan.id} className="mono" style={{ fontSize: 12.5 }}>
                          {value === 'Yes' ? (
                            <Check size={15} style={{ margin: '0 auto', color: 'var(--ok)' }} aria-label="Included" />
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the app */}
      <section className="container" style={{ paddingBottom: 60 }}>
        <PlayStoreCard />
      </section>
    </>
  );
}

function PlanCard({ plan, cycle, region }: { plan: Plan; cycle: Cycle; region: Region }) {
  const saving = cycle === 'yearly' ? formatSaving(plan, region) : null;
  const features = featuresFor(plan, cycle);

  return (
    <div
      className="card plan-card"
      data-featured={plan.featured}
      style={{
        borderColor: plan.featured ? 'var(--brand)' : undefined,
        boxShadow: plan.featured ? 'var(--shadow-md)' : undefined,
      }}
    >
      {plan.badge && (
        <div className="plan-badge">
          <Crown size={13} aria-hidden="true" />
          {plan.badge}
        </div>
      )}

      <div className="plan-body">
        <h2 style={{ fontSize: 20 }}>{plan.name}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{plan.tagline}</p>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
          <span className="plan-price">{formatPlanPrice(plan, cycle, region)}</span>
          <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>/{cycle === 'monthly' ? 'month' : 'year'}</span>
        </div>

        {saving && (
          <p style={{ fontSize: 12.5, color: 'var(--ok)', fontWeight: 600, marginTop: 8 }}>{saving}</p>
        )}

        <div style={{ marginTop: 18 }}>
          <BuyPlanButton
            plan={plan}
            cycle={cycle}
            region={region}
            className={`btn btn-block ${plan.featured ? 'btn-primary' : 'btn-secondary'}`}
          />
        </div>

        <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'grid', gap: 10 }}>
          {features.map((feature) => (
            <li key={feature} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <Check size={15} style={{ color: 'var(--brand)', flex: 'none', marginTop: 2 }} aria-hidden="true" />
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
