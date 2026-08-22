import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Coins, Globe, Sparkles } from 'lucide-react';
import { PlayStoreCard } from '@/components/PlayStoreCard';
import { BuyPlanButton } from '@/components/BuyPlanButton';
import { GoogleSignIn } from '@/components/GoogleSignIn';
import { InlineNotice } from '@/components/ui/States';
import {
  PLANS,
  REGION_LIST,
  formatPlanPrice,
  planById,
  tierOf,
  type Cycle,
  type Region,
} from '@/config/pricing';
import { CREDIT_COSTS, DAILY_ALLOWANCE, FREE_TOOLS, GUEST_ALLOWANCE } from '@/config/credits';
import { toolById } from '@/config/tools';
import { useRegion } from '@/hooks/useRegion';
import { useSession } from '@/services/session';
import { backendConfigured } from '@/services/api';

export default function Credits() {
  const backendReady = backendConfigured();
  const { region, setRegion, info } = useRegion();
  const { credits, signedIn, isGuest, available, refresh } = useSession();
  const [params, setParams] = useSearchParams();

  // A plan chosen on /pricing (or before signing in) arrives as ?plan=&billing=.
  const wantedPlan = planById(params.get('plan') ?? '');
  const wantedCycle: Cycle = params.get('billing') === 'yearly' ? 'yearly' : 'monthly';
  const [cycle, setCycle] = useState<Cycle>(wantedCycle);

  useEffect(() => {
    if (wantedPlan) setCycle(wantedCycle);
  }, [wantedPlan, wantedCycle]);

  const costRows = useMemo(
    () =>
      Object.entries(CREDIT_COSTS).map(([toolId, cost]) => ({
        name: toolById(toolId)?.name ?? toolId,
        cost: `${cost.perBlock} credits`,
        per: `per ${Math.round(cost.blockSeconds / 60)} minutes of audio`,
      })),
    [],
  );

  const freeNames = FREE_TOOLS.map((id) => toolById(id)?.name).filter(Boolean) as string[];

  return (
    <div className="container section" style={{ maxWidth: 900 }}>
      <header style={{ textAlign: 'center', marginBottom: 26 }}>
        <span className="badge badge-credits" style={{ marginBottom: 14 }}>
          <Coins size={12} aria-hidden="true" />
          Credits
        </span>
        <h1>How credits work</h1>
        <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
          Credits pay for the AI separation tools. Everything else on the site stays free.
        </p>
      </header>

      {/* --------------------------------------------------------- balance */}
      {available && (
        <div
          className="card card-pad"
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}
        >
          <span
            style={{
              width: 52,
              height: 52,
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              borderRadius: 16,
              background: 'var(--brand-soft)',
              color: 'var(--brand)',
            }}
          >
            <Coins size={22} aria-hidden="true" />
          </span>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em' }}>
              {credits.toLocaleString('en-US')}
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
              {signedIn
                ? `Credits available. You get ${DAILY_ALLOWANCE} free every day.`
                : `Free credits left. Sign in with Gmail for ${DAILY_ALLOWANCE} free every day.`}
            </p>
          </div>

          {isGuest && <GoogleSignIn onDone={() => void refresh()} />}
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {/* ------------------------------------------------------ what costs */}
        <div className="card card-pad">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 44,
                height: 44,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 13,
                background: 'var(--brand-soft)',
                color: 'var(--brand)',
              }}
            >
              <Coins size={20} aria-hidden="true" />
            </span>
            <div style={{ minWidth: 0, width: '100%' }}>
              <h2 style={{ fontSize: 18 }}>What uses credits</h2>
              <dl style={{ display: 'grid', gap: 10, margin: '12px 0 0' }}>
                {costRows.map((row) => (
                  <div
                    key={row.name}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}
                  >
                    <dt style={{ fontSize: 14, color: 'var(--text-muted)' }}>{row.name}</dt>
                    <dd style={{ margin: 0, textAlign: 'right' }}>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                        {row.cost}
                      </span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)' }}>{row.per}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.55 }}>
                Rounded up to the next block. A run that fails or is cancelled costs nothing.
              </p>
            </div>
          </div>
        </div>

        {/* -------------------------------------------------------- free set */}
        <div className="card card-pad">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 44,
                height: 44,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 13,
                background: 'var(--ok-soft)',
                color: 'var(--ok)',
              }}
            >
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18 }}>Free, with or without an account</h2>
              <ul className="bullets" style={{ marginTop: 12 }}>
                {freeNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
                <li>{GUEST_ALLOWANCE} credits to try the AI tools, no sign-in needed</li>
                <li>{DAILY_ALLOWANCE} free credits every day once you sign in</li>
              </ul>
            </div>
          </div>
        </div>

        {!backendReady && (
          <p className="callout">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Credits cannot be purchased yet. Every free tool on the site is usable in the meantime.</span>
          </p>
        )}
      </div>

      {/* ----------------------------------------------------- plan credits */}
      <section style={{ marginTop: 32 }}>
        <div className="credits-head">
          <h2 style={{ fontSize: 22 }}>{wantedPlan ? `Get ${wantedPlan.name}` : 'Top up with a plan'}</h2>

          <div className="pricing-controls" style={{ marginTop: 0 }}>
            <div className="country-select">
              <label
                htmlFor="credits-region"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}
              >
                <Globe size={14} aria-hidden="true" />
                Region
              </label>
              <select
                id="credits-region"
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

            <select
              className="field"
              aria-label="Billing cycle"
              value={cycle}
              onChange={(event) => {
                setCycle(event.target.value as Cycle);
                if (wantedPlan) {
                  params.set('billing', event.target.value);
                  setParams(params, { replace: true });
                }
              }}
              style={{ width: 'auto', minWidth: 130 }}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>

        {available && !signedIn && (
          <div style={{ marginTop: 14 }}>
            <InlineNotice kind="info">Sign in with Gmail before buying, so the credits land on your account.</InlineNotice>
          </div>
        )}

        <div className="price-grid" style={{ marginTop: 18 }}>
          {PLANS.map((plan) => {
            const tier = tierOf(plan, cycle);
            const highlighted = wantedPlan?.id === plan.id;
            return (
              <div
                key={plan.id}
                className="card price-card"
                style={
                  highlighted
                    ? { borderColor: 'var(--border-brand)', boxShadow: 'var(--shadow-brand)' }
                    : undefined
                }
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <h3 style={{ fontSize: 18 }}>{plan.name}</h3>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                    {formatPlanPrice(plan, cycle, region)}
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
                      /{cycle === 'monthly' ? 'mo' : 'yr'}
                    </span>
                  </span>
                </div>

                <div style={{ marginTop: 14 }}>
                  <span className="price-amount" style={{ color: 'var(--brand)' }}>
                    {tier.credits.toLocaleString('en-US')}
                  </span>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    credits {cycle === 'monthly' ? 'per month' : 'per year'}
                  </p>
                </div>

                <p
                  style={{
                    fontSize: 13.5,
                    color: 'var(--text-muted)',
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  Convert up to <b style={{ color: 'var(--text)' }}>{tier.files.toLocaleString('en-US')}</b> files
                </p>

                <div style={{ marginTop: 16 }}>
                  <BuyPlanButton
                    plan={plan}
                    cycle={cycle}
                    region={region}
                    className={`btn btn-block ${highlighted || plan.featured ? 'btn-primary' : 'btn-secondary'}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 14, textAlign: 'center', lineHeight: 1.5 }}>
          Prices shown in {info.currency}. Taxes may apply at checkout.
        </p>

        <div style={{ marginTop: 22 }}>
          <Link to="/pricing" className="btn btn-secondary btn-lg btn-block compare-btn">
            Compare plans
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 36 }}>
        <PlayStoreCard />
      </section>
    </div>
  );
}
