import { useState, type ReactNode } from 'react';
import { useSession } from '@/services/session';
import { ToolLanding } from './ToolLanding';
import { DAILY_ALLOWANCE } from '@/config/credits';
import { Link, NavLink } from 'react-router-dom';
import {
  ArrowLeft,
  CircleHelp,
  Gem,
  Laptop,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { TOOLS, type ToolDef } from '@/config/tools';
import { Modal } from './ui/Modal';

/** Reassurance strip shown at the foot of every tool page. */
export function TrustStrip({ items }: { items?: { title: string; body: string }[] }) {
  const strip = items ?? [
    { title: 'Studio quality', body: 'Clean, accurate results' },
    { title: 'No watermark', body: 'Clean audio output' },
    { title: 'High quality', body: 'Lossless WAV or 320 kbps MP3' },
    { title: 'Works everywhere', body: 'Any device, any modern browser' },
  ];

  return (
    <div className="card trust-strip">
      {strip.map((item, index) => (
        <div key={item.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
          <span
            style={{
              width: 32,
              height: 32,
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              borderRadius: 10,
              background: 'var(--brand-soft)',
              color: 'var(--brand)',
            }}
          >
            {[<ShieldCheck size={15} />, <Sparkles size={15} />, <Gem size={15} />, <Laptop size={15} />][index % 4]}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{item.title}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>{item.body}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ current }: { current: ToolDef }) {
  return (
    <aside className="tool-sidebar">
      <nav aria-label="Tools">
        <p
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            padding: '0 12px 8px',
          }}
        >
          Tools
        </p>
        {TOOLS.filter((tool) => tool.path).map((tool) => {
          const Icon = tool.icon;
          return (
            <NavLink key={tool.id} to={tool.path as string} className="tool-sidebar-link" end>
              <Icon
                size={16}
                aria-hidden="true"
                style={{ color: tool.id === current.id ? 'var(--brand)' : tool.accent, flex: 'none' }}
              />
              {tool.name}
            </NavLink>
          );
        })}
      </nav>

      <SidebarCredits />

      <Link
        to="/support"
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-dim)', padding: '0 12px' }}
      >
        <CircleHelp size={15} aria-hidden="true" />
        Help Center
      </Link>
    </aside>
  );
}

/**
 * What a plan actually buys, next to what the visitor currently has. Hidden
 * entirely when there is no account system to report a balance from.
 */
function SidebarCredits() {
  const { credits, signedIn, available } = useSession();
  if (!available) return null;

  return (
    <div className="card" style={{ padding: 16, background: 'var(--brand-soft)', borderColor: 'var(--border-brand)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Zap size={15} style={{ color: 'var(--brand)' }} aria-hidden="true" />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand)' }}>Your credits</span>
      </div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>
        {credits.toLocaleString('en-US')}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '4px 0 12px' }}>
        {signedIn
          ? `${DAILY_ALLOWANCE} free every day. A plan adds more.`
          : `Sign in with Gmail for ${DAILY_ALLOWANCE} free every day.`}
      </p>
      <Link to={signedIn ? '/credits' : '/signin'} className="btn btn-primary btn-sm btn-block">
        {signedIn ? 'Get credits' : 'Sign in'}
      </Link>
    </div>
  );
}

interface ToolShellProps {
  tool: ToolDef;
  children: ReactNode;
  /** Steps rendered inside the "How It Works" dialog. */
  howItWorks: { title: string; body: string }[];
  trust?: { title: string; body: string }[];
}

export function ToolShell({ tool, children, howItWorks, trust }: ToolShellProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const Icon = tool.icon;

  return (
    <div className="container">
      <div className="tool-layout">
        <Sidebar current={tool} />

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <header className="tool-head">
            <Link to="/tools" className="icon-btn tool-head-back" aria-label="Back to all tools" style={{ flex: 'none' }}>
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>

            <div className="tool-head-main">
              <div className="tool-head-title">
                <h1 style={{ fontSize: 'clamp(21px, 4vw, 27px)' }}>{tool.name}</h1>
                {tool.badge === 'ai' ? (
                  <span className="badge badge-ai">
                    <Icon size={12} aria-hidden="true" />
                    AI Powered
                  </span>
                ) : (
                  <span className="badge badge-free">Free Tool</span>
                )}
              </div>
            </div>

            <p className="tool-head-desc">{tool.description}</p>

            <div className="tool-head-cta">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHelpOpen(true)}>
                <PlayCircle size={15} aria-hidden="true" />
                How It Works
              </button>
            </div>
          </header>

          {children}

          <TrustStrip items={trust} />

          <ToolLanding tool={tool} />
        </div>
      </div>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={`How ${tool.name} works`}
        description={tool.tagline}
        width={520}
      >
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 16 }}>
          {howItWorks.map((step, index) => (
            <li key={step.title} style={{ display: 'flex', gap: 13 }}>
              <span
                className="mono"
                style={{
                  width: 27,
                  height: 27,
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  background: 'var(--brand-soft)',
                  color: 'var(--brand)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {index + 1}
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{step.title}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 3 }}>
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Modal>
    </div>
  );
}
