import { Link } from 'react-router-dom';
import { Coins, LogIn } from 'lucide-react';
import { useSession } from '@/services/session';
import { costFor, describeCost, GUEST_ALLOWANCE } from '@/config/credits';
import { GoogleSignIn } from './GoogleSignIn';
import { Modal } from './ui/Modal';

/**
 * Shows what a run will cost and what the visitor has left, and — when they are
 * out — the way forward rather than a dead end.
 */
export function CreditBar({ toolId, durationSeconds }: { toolId: string; durationSeconds: number }) {
  const { credits, available, signedIn, isGuest } = useSession();
  const cost = costFor(toolId, durationSeconds);
  const per = describeCost(toolId);

  // Free tool, or no account system configured — nothing to say.
  if (cost === 0 || !available) return null;

  const short = credits < cost;

  return (
    <div
      className="card"
      style={{
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        borderColor: short ? 'color-mix(in srgb, var(--warn) 35%, transparent)' : undefined,
        background: short ? 'var(--warn-soft)' : 'var(--surface)',
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 10,
          background: short ? 'color-mix(in srgb, var(--warn) 18%, transparent)' : 'var(--brand-soft)',
          color: short ? 'var(--warn)' : 'var(--brand)',
        }}
      >
        <Coins size={16} aria-hidden="true" />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>
          This run costs {cost} credit{cost === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          You have {credits} · {per}
          {durationSeconds > 0 ? ' · rounded up' : ''}
        </div>
      </div>

      {short && (
        <Link to={signedIn ? '/pricing' : '/signin'} className="btn btn-sm btn-primary">
          {signedIn ? 'Get more credits' : 'Sign in'}
        </Link>
      )}
      {!short && isGuest && (
        <span className="badge badge-neutral" style={{ flex: 'none' }}>
          {GUEST_ALLOWANCE} free to try
        </span>
      )}
    </div>
  );
}

/**
 * Shown when a run is refused for lack of credits. A guest is offered sign-in
 * inline; a signed-in user is pointed at a plan.
 */
export function OutOfCreditsModal({
  open,
  onClose,
  message,
}: {
  open: boolean;
  onClose: () => void;
  message?: string | null;
}) {
  const { signedIn, refresh } = useSession();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={signedIn ? 'You are out of credits' : 'Your free credits are used'}
      description={
        message ??
        (signedIn
          ? 'Your daily free credits will refresh tomorrow, or you can top up with a plan.'
          : 'Sign in with Gmail to keep going — you get free credits every day.')
      }
      width={420}
      footer={
        signedIn ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Not now
            </button>
            <Link to="/pricing" className="btn btn-primary">
              See plans
            </Link>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            Not now
          </button>
        )
      }
    >
      {!signedIn && (
        <div style={{ display: 'grid', gap: 14, justifyItems: 'center', paddingBottom: 4 }}>
          <GoogleSignIn
            onDone={() => {
              void refresh();
              onClose();
            }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
            <LogIn size={13} aria-hidden="true" />
            Free, and takes a moment
          </span>
        </div>
      )}
    </Modal>
  );
}
