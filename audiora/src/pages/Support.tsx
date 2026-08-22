import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LifeBuoy, Mail } from 'lucide-react';
import { FAQS } from '@/data/faq';
import { Seo } from '@/components/Seo';
import { faqSchema } from '@/config/seo';
import { useMemo } from 'react';


export default function Support() {
  const [open, setOpen] = useState<number | null>(0);

  // Stable identity: <Seo> depends on this, and a new array per render would
  // rewrite the head on every keystroke-driven re-render.
  const schema = useMemo(() => [faqSchema(FAQS)], []);

  return (
    <div className="container section" style={{ maxWidth: 760 }}>
      <Seo schema={schema} />
      <header style={{ textAlign: 'center', marginBottom: 32 }}>
        <span className="badge badge-ai" style={{ marginBottom: 16 }}>
          <LifeBuoy size={12} aria-hidden="true" />
          Help Center
        </span>
        <h1 style={{ fontSize: 'clamp(27px, 5.2vw, 40px)' }}>How can we help?</h1>
        <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 14 }}>
          Answers to the questions people actually ask.
        </p>
      </header>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 26 }}>
        {FAQS.map((faq, index) => {
          const expanded = open === index;
          return (
            <div key={faq.q} style={{ borderTop: index === 0 ? 0 : '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : index)}
                aria-expanded={expanded}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  padding: '16px 20px',
                  minHeight: 56,
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 14.5,
                  fontWeight: 600,
                }}
              >
                {faq.q}
                <ChevronDown
                  size={17}
                  aria-hidden="true"
                  style={{
                    flex: 'none',
                    color: 'var(--text-dim)',
                    transform: expanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </button>
              {/* Collapsed with CSS, never unmounted — see FAQPage markup above. */}
              <div className="landing-faq-panel" data-open={expanded}>
                <p style={{ padding: '0 20px 18px', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  {faq.a}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card card-pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            width: 46,
            height: 46,
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 14,
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
          }}
        >
          <Mail size={20} aria-hidden="true" />
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: 16 }}>Still stuck?</h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.6 }}>
            Tell us what you were doing and which browser you are on — that usually solves it in one reply.
          </p>
        </div>
        <a href="mailto:support@7audio.app" className="btn btn-primary">
          Email support
        </a>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', marginTop: 26 }}>
        Looking for the technical details?{' '}
        <Link to="/features" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          See how 7 Audio works
        </Link>
      </p>
    </div>
  );
}
