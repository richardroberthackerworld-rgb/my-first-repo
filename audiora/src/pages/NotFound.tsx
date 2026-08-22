import { Link } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { BrandMark } from '@/components/Brand';
import { TOOLS } from '@/config/tools';

export default function NotFound() {
  return (
    <div className="container section" style={{ textAlign: 'center', maxWidth: 620 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22, opacity: 0.9 }}>
        <BrandMark size={72} />
      </div>

      <p className="mono" style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 500, letterSpacing: '0.1em' }}>
        404
      </p>
      <h1 style={{ fontSize: 'clamp(26px, 5vw, 38px)', marginTop: 10 }}>This page went quiet</h1>
      <p style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.65 }}>
        The link you followed does not lead anywhere in 7 Audio. It may have moved, or never existed.
      </p>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
        <Link to="/" className="btn btn-primary">
          <Home size={16} aria-hidden="true" />
          Back home
        </Link>
        <Link to="/tools" className="btn btn-secondary">
          <ArrowLeft size={16} aria-hidden="true" />
          Browse tools
        </Link>
      </div>

      <div style={{ marginTop: 44 }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14 }}>Or jump straight to a tool</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {TOOLS.filter((tool) => tool.path).map((tool) => (
            <Link key={tool.id} to={tool.path as string} className="btn btn-sm btn-secondary">
              {tool.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
