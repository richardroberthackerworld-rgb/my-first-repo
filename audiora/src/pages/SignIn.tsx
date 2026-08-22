import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { AuthShell } from '@/components/AuthShell';
import { GoogleSignIn } from '@/components/GoogleSignIn';
import { InlineNotice } from '@/components/ui/States';
import { useSession } from '@/services/session';
import { DAILY_ALLOWANCE, GUEST_ALLOWANCE } from '@/config/credits';
import { backendConfigured } from '@/services/api';

export default function SignIn() {
  const { signedIn, account } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // A plan picked before signing in must survive the round trip, otherwise
  // the user lands on a dashboard and has to find it again.
  const plan = params.get('plan');
  const billing = params.get('billing') === 'yearly' ? 'yearly' : 'monthly';
  const destination = plan ? `/credits?plan=${plan}&billing=${billing}` : '/dashboard';

  // Already signed in? Nothing to do here.
  useEffect(() => {
    if (signedIn) navigate(destination, { replace: true });
  }, [signedIn, navigate, destination]);

  const perks = [
    `${DAILY_ALLOWANCE} free credits every day`,
    'Your credits follow you between devices',
    'Keep a history of what you have processed',
  ];

  return (
    <AuthShell
      title="Sign in to 7 Audio"
      subtitle={
        account
          ? `Signed in as ${account.email}`
          : `Continue with Gmail. Every tool also works signed out with ${GUEST_ALLOWANCE} free credits.`
      }
      footer={
        <>
          Just want to try it?{' '}
          <Link to="/tools" style={{ color: 'var(--brand)', fontWeight: 600 }}>
            Use the tools without an account
          </Link>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 18 }}>
        {!backendConfigured() && (
          <InlineNotice>
            Accounts are not connected yet, so signing in is unavailable. Every tool still works without one.
          </InlineNotice>
        )}

        <GoogleSignIn onDone={() => navigate(destination)} />

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 9 }}>
          {perks.map((perk) => (
            <li key={perk} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <Check size={15} style={{ color: 'var(--brand)', flex: 'none', marginTop: 2 }} aria-hidden="true" />
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{perk}</span>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: 11.5, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.55 }}>
          By continuing you agree to our{' '}
          <Link to="/terms" style={{ color: 'var(--brand)' }}>
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" style={{ color: 'var(--brand)' }}>
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </AuthShell>
  );
}
