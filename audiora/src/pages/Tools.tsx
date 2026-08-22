import { ShieldCheck } from 'lucide-react';
import { ToolCardWide } from '@/components/ToolCard';
import { TOOLS } from '@/config/tools';

export default function Tools() {
  return (
    <div className="container section">
      <header style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 36px' }}>
        <span className="badge badge-ai" style={{ marginBottom: 16 }}>
          Audio Tools
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 5.4vw, 42px)' }}>
          Everything you need for <span className="grad-text">professional audio</span>
        </h1>
        <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.65 }}>
          Seven tools, one design. Choose a file, pick your settings, and download the result.
        </p>
        <p
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            marginTop: 18,
            padding: '7px 14px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--ok-soft)',
            color: 'var(--ok)',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          Fast, secure and free to use
        </p>
      </header>

      <div className="tools-index-grid">
        {TOOLS.map((tool) => (
          <ToolCardWide key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
