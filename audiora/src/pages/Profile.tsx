import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Coins,
  LayoutDashboard,
  LogIn,
  LogOut,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
} from 'lucide-react';
import { SkeletonBlock } from '@/components/ui/States';
import { formatBytes, formatTime } from '@/services/audio';
import { listActivity, summarise, type WorkspaceStats } from '@/services/workspace';
import { backendConfigured } from '@/services/api';
import { useSession } from '@/services/session';
import { DAILY_ALLOWANCE, GUEST_ALLOWANCE } from '@/config/credits';

export default function Profile() {
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const backendReady = backendConfigured();
  const { account, credits, signedIn, available, signOut } = useSession();

  useEffect(() => {
    listActivity(200).then((records) => setStats(summarise(records)));
  }, []);

  return (
    <div className="container section" style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 20 }}>
        <h1>Profile</h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 6 }}>Your account and recent activity.</p>
      </header>

      <div style={{ display: 'grid', gap: 16 }}>
        {/* ------------------------------------------------------ identity */}
        <div className="card card-pad">
          <div className="profile-identity">
            <span
              style={{
                width: 56,
                height: 56,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}
            >
              <User size={24} style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{account ? account.name : 'Not signed in'}</h2>
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--text-muted)',
                  marginTop: 4,
                  lineHeight: 1.5,
                  overflowWrap: 'anywhere',
                }}
              >
                {account ? account.email : 'Every tool works without an account.'}
              </p>
            </div>

            {signedIn ? (
              <button type="button" className="btn btn-secondary profile-signin" onClick={signOut}>
                <LogOut size={16} aria-hidden="true" />
                Sign Out
              </button>
            ) : (
              <Link to="/signin" className="btn btn-primary profile-signin">
                <LogIn size={16} aria-hidden="true" />
                Sign In
              </Link>
            )}
          </div>

          {available && (
            <div className="profile-credits">
              <span className="profile-credits-icon">
                <Coins size={16} aria-hidden="true" />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                  {credits.toLocaleString('en-US')}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 1 }}>
                  {signedIn
                    ? `credits · ${DAILY_ALLOWANCE} free every day`
                    : `free credits · sign in for ${DAILY_ALLOWANCE} a day`}
                </p>
              </div>
              <Link to="/credits" className="btn btn-sm btn-secondary" style={{ flex: 'none' }}>
                Top up
              </Link>
            </div>
          )}

          {!backendReady && (
            <p className="callout" style={{ marginTop: 16 }}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Accounts are not available yet.</span>
            </p>
          )}
        </div>

        {/* --------------------------------------------------------- usage */}
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Your usage</span>
          </div>
          <div className="panel-body">
            {stats === null ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <SkeletonBlock height={20} />
                <SkeletonBlock height={20} />
                <SkeletonBlock height={20} />
              </div>
            ) : stats.runs === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 10,
                  padding: '20px 8px',
                }}
              >
                <span
                  style={{
                    width: 48,
                    height: 48,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 14,
                    background: 'var(--brand-soft)',
                    color: 'var(--brand)',
                  }}
                >
                  <Activity size={21} aria-hidden="true" />
                </span>
                <p style={{ fontSize: 15, fontWeight: 700 }}>No activity yet.</p>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 280 }}>
                  Run any tool and it will show up here.
                </p>
                <Link to="/tools" className="btn btn-secondary btn-sm" style={{ marginTop: 4 }}>
                  Browse tools
                </Link>
              </div>
            ) : (
              <dl style={{ display: 'grid', gap: 12, margin: 0 }}>
                <Row label="Jobs run" value={String(stats.runs)} />
                <Row label="Files produced" value={String(stats.files)} />
                <Row label="Audio processed" value={formatTime(stats.seconds)} />
                <Row label="Output written" value={formatBytes(stats.bytes)} />
                <Row label="Most used tool" value={stats.byTool[0]?.toolName ?? '—'} />
              </dl>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- data */}
        <div className="card card-pad">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <ShieldCheck size={19} style={{ color: 'var(--ok)', flex: 'none', marginTop: 2 }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 17 }}>Your data</h2>
              <ul className="bullets" style={{ marginTop: 10 }}>
                <li>{signedIn ? `Signed in with ${account?.email ?? 'Google'}.` : `No account is linked to this browser. Guests get ${GUEST_ALLOWANCE} free credits.`}</li>
                <li>Your activity history and preferences are saved for this browser.</li>
                <li>Setup data is kept so the AI tools start quickly.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------- actions */}
        <div className="button-pair">
          <Link to="/settings" className="btn btn-secondary">
            <SettingsIcon size={16} aria-hidden="true" />
            Settings
          </Link>
          <Link to="/dashboard" className="btn btn-secondary">
            <LayoutDashboard size={16} aria-hidden="true" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
      <dt style={{ fontSize: 14, color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="mono" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
