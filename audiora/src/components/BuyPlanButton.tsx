import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/services/session';
import { useToast } from './ui/Toast';
import { Spinner } from './ui/States';
import { paymentsHealth, purchasePlan } from '@/services/checkout';
import { ctaLabel, type Cycle, type Plan, type Region } from '@/config/pricing';

/**
 * The single buy control, used by both Pricing and Credits.
 *
 * It never grants anything itself: it starts a server-created order, opens
 * Cashfree, then asks the server what actually happened and re-reads the
 * balance from `/api/me`.
 */
export function BuyPlanButton({
  plan,
  cycle,
  region,
  className = 'btn btn-primary btn-block',
}: {
  plan: Plan;
  cycle: Cycle;
  region: Region;
  className?: string;
}) {
  const { signedIn, available, refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [payable, setPayable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void paymentsHealth().then((health) => {
      if (alive) setPayable(health.configured);
    });
    return () => {
      alive = false;
    };
  }, []);

  const label = ctaLabel(plan, cycle, region);

  // Payments are switched off in this build — say so rather than opening a
  // window that cannot take money.
  if (available && payable === false) {
    return (
      <button type="button" className={className} disabled title="Payments are not available yet">
        {label}
      </button>
    );
  }

  async function buy() {
    if (!signedIn) {
      // Carry the choice through sign-in so the user lands back on it.
      navigate(`/signin?plan=${plan.id}&billing=${cycle}`);
      return;
    }

    setBusy(true);
    try {
      const result = await purchasePlan({ plan: plan.id, cycle, region });
      await refresh();

      if (result.ok) {
        toast.push({
          kind: 'success',
          title: `${plan.name} is active`,
          body: result.added ? `${result.added.toLocaleString('en-US')} credits added to your account.` : undefined,
        });
        navigate('/dashboard');
      } else if (result.pending) {
        toast.push({ kind: 'info', title: 'Payment processing', body: result.error });
      } else if (result.cancelled) {
        toast.push({ kind: 'info', title: 'Payment cancelled', body: 'Nothing has been charged.' });
      } else {
        toast.push({ kind: 'error', title: 'Payment failed', body: result.error });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={() => void buy()} disabled={busy}>
      {busy ? (
        <>
          <Spinner size={16} />
          Please wait…
        </>
      ) : (
        label
      )}
    </button>
  );
}
