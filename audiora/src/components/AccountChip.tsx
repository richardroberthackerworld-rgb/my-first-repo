import { Link } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { useSession } from '@/services/session';

/**
 * Header affordance: shows the live credit balance, and a way in or out.
 * Renders nothing when there is no account system configured, so the header
 * never advertises something that does not work.
 */
export function AccountChip() {
  const { status, credits, signedIn, account } = useSession();

  if (status === 'unavailable' || status === 'loading') {
    return (
      <Link to="/signin" className="btn btn-primary btn-sm signin-btn">
        Sign In
      </Link>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Link
        to="/credits"
        className="credit-chip"
        title={signedIn ? `${credits} credits` : `${credits} free credits left`}
      >
        <Coins size={14} aria-hidden="true" />
        <span className="mono">{credits}</span>
      </Link>

      {signedIn ? (
        <Link to="/dashboard" className="btn btn-secondary btn-sm signin-btn" title={account?.email}>
          Account
        </Link>
      ) : (
        <Link to="/signin" className="btn btn-primary btn-sm signin-btn">
          Sign In
        </Link>
      )}
    </div>
  );
}
