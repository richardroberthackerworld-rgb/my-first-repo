import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TOOLS, type ToolDef } from '@/config/tools';

function BadgeFor({ badge }: { badge: ToolDef['badge'] }) {
  if (badge === 'ai') return <span className="badge badge-ai">AI Powered</span>;
  if (badge === 'free') return <span className="badge badge-free">Free Tool</span>;
  return <span className="badge badge-neutral">Soon</span>;
}

export function ToolCard({ tool }: { tool: ToolDef }) {
  const Icon = tool.icon;
  const disabled = tool.path === null;

  const inner = (
    <>
      <span
        className="tool-card-icon"
        style={{ background: `color-mix(in srgb, ${tool.accent} 12%, transparent)`, color: tool.accent }}
      >
        <Icon size={23} aria-hidden="true" />
      </span>

      <span className="tool-card-name">{tool.name}</span>

      <span className="tool-card-desc">{tool.short}</span>

      <span className="tool-card-cta">
        {disabled ? (
          <span className="badge badge-neutral">Stay Tuned</span>
        ) : (
          <>
            <span className="btn btn-ghost btn-sm cta-full">
              Open Tool
              <ArrowRight size={14} aria-hidden="true" />
            </span>
            <span className="cta-compact">
              <BadgeFor badge={tool.badge} />
            </span>
          </>
        )}
      </span>
    </>
  );

  if (disabled) {
    return (
      <div className="card tool-card" style={{ ['--tool-accent']: tool.accent } as React.CSSProperties} aria-label={`${tool.name} — coming soon`}>
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={tool.path as string}
      className="card card-hover tool-card"
      style={{ ['--tool-accent']: tool.accent } as React.CSSProperties}
      aria-label={`Open ${tool.name}`}
    >
      {inner}
    </Link>
  );
}

export function ToolGrid({ tools = TOOLS }: { tools?: ToolDef[] }) {
  return (
    <div className="tool-grid">
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

/** Roomier card used on the Tools index, where descriptions have space. */
export function ToolCardWide({ tool }: { tool: ToolDef }) {
  const Icon = tool.icon;
  const disabled = tool.path === null;

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <span
          style={{
            width: 54,
            height: 54,
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 16,
            background: `color-mix(in srgb, ${tool.accent} 12%, transparent)`,
            color: tool.accent,
          }}
        >
          <Icon size={24} aria-hidden="true" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 17 }}>{tool.name}</h3>
            <BadgeFor badge={tool.badge} />
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{tool.description}</p>
        </div>
      </div>
      {!disabled && (
        <div style={{ marginTop: 18 }}>
          <span className="btn btn-ghost btn-sm">
            Open Tool
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </div>
      )}
    </>
  );

  if (disabled) {
    return (
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
        {body}
      </div>
    );
  }

  return (
    <Link to={tool.path as string} className="card card-hover card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
      {body}
    </Link>
  );
}
