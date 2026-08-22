import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { BrandMark } from './Brand';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <Link to="/" aria-label="7 Audio home" style={{ display: 'inline-block' }}>
            <BrandMark size={52} />
          </Link>
          <h1 style={{ fontSize: 24, marginTop: 16 }}>{title}</h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.55 }}>{subtitle}</p>
        </div>

        {children}

        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>{footer}</div>
      </div>

      <p className="auth-note">
        <ShieldCheck size={13} aria-hidden="true" />
        The cutter, joiner, noise remover, pitch shifter and converter are free and need no account.{' '}
        <Link to="/tools" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          Go straight to the tools
        </Link>
      </p>
    </div>
  );
}
