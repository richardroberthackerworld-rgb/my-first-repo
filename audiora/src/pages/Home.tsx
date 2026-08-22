import { Link } from 'react-router-dom';
import { ArrowRight, BrainCircuit, Laptop, Lock, PlayCircle, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { ToolGrid } from '@/components/ToolCard';
import { AvatarRow, HeroVisual } from '@/components/HeroVisual';
import { PlayStoreCard } from '@/components/PlayStoreCard';
import { FEATURE_STRIP, HERO } from '@/config/site';

const WHY = [
  {
    icon: BrainCircuit,
    title: 'AI-Powered Accuracy',
    body: 'Studio-grade separation that keeps vocals clean and instruments intact.',
  },
  {
    icon: Lock,
    title: 'Secure & Private',
    body: 'Your files are handled securely and never shared with anyone.',
  },
  {
    icon: Zap,
    title: 'Blazing Fast',
    body: 'Cutting, joining, pitch and conversion happen in seconds. No queue.',
  },
  {
    icon: Laptop,
    title: 'Works Everywhere',
    body: 'Any modern browser, on desktop, tablet or phone. Nothing to install.',
  },
];

export default function Home() {
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero glow">
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="badge badge-ai" style={{ marginBottom: 18 }}>
              {HERO.eyebrow}
            </span>

            <h1 className="hero-title">
              All-in-One
              <br />
              <span className="grad-text">AI Audio</span> Toolkit
            </h1>

            <p className="hero-body">
              Powerful AI tools to edit, enhance and transform your audio.
              <br />
              Fast, private and easy to use — all in one place.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
              <Link to="/tools" className="btn btn-primary btn-lg">
                Explore Tools
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link to="/features" className="btn btn-secondary btn-lg">
                How It Works
                <PlayCircle size={17} aria-hidden="true" />
              </Link>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
              <AvatarRow />
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                Loved by <b style={{ color: 'var(--brand)' }}>200K+</b> creators &amp; musicians
              </p>
            </div>
          </div>

          <div className="hero-art">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- feature strip */}
      <section className="container" style={{ marginTop: 8 }}>
        <div className="card feature-strip">
          {FEATURE_STRIP.map((feature, index) => (
            <div key={feature.title} style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
              <span
                style={{
                  width: 42,
                  height: 42,
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 13,
                  background: [
                    'color-mix(in srgb, var(--a-violet) 12%, transparent)',
                    'color-mix(in srgb, var(--a-green) 12%, transparent)',
                    'color-mix(in srgb, var(--a-orange) 12%, transparent)',
                  ][index],
                  color: ['var(--a-violet)', 'var(--a-green)', 'var(--a-orange)'][index],
                }}
              >
                {[<Sparkles size={19} />, <ShieldCheck size={19} />, <Zap size={19} />][index]}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.015em' }}>
                  {feature.title}
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  {feature.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- tools */}
      <section className="section" id="tools">
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 34px' }}>
            <h2 style={{ fontSize: 'clamp(25px, 5vw, 34px)' }}>Powerful Audio Tools</h2>
            <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 10 }}>
              Everything you need for professional audio processing
            </p>
          </div>
          <ToolGrid />
        </div>
      </section>

      {/* ------------------------------------------------------------- why */}
      <section className="section" style={{ background: 'var(--bg-deep)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <div className="why-grid">
            {WHY.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      flex: 'none',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 13,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--brand)',
                    }}
                  >
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: 15.5 }}>{item.title}</h3>
                    <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the app */}
      <section className="container" style={{ paddingTop: 8 }}>
        <PlayStoreCard />
      </section>

      {/* ------------------------------------------------------------- cta */}
      <section className="section">
        <div className="container">
          <div className="card cta-card">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 className="grad-text" style={{ fontSize: 'clamp(23px, 4.4vw, 30px)' }}>
                Create Without Limits
              </h2>
              <p style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 12, maxWidth: 460, lineHeight: 1.65 }}>
                Join thousands of creators, musicians and podcasters who trust 7 Audio for their audio tools.
              </p>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 24 }}>
                <Link to="/tools" className="btn btn-primary">
                  Get Started Free
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AvatarRow count={3} />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Trusted by <b style={{ color: 'var(--text)' }}>200K+</b> users
                  </span>
                </div>
              </div>
            </div>

            <div className="cta-art" aria-hidden="true">
              <FormatOrbit />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** Decorative orbit of the formats 7 Audio reads, around a waveform disc. */
function FormatOrbit() {
  const chips = [
    { label: 'MP3', top: '4%', left: '6%' },
    { label: 'FLAC', top: '12%', right: '2%' },
    { label: 'WAV', bottom: '16%', left: '0%' },
    { label: 'M4A', bottom: '2%', right: '10%' },
  ];

  return (
    <div style={{ position: 'relative', width: 250, height: 190, maxWidth: '100%' }}>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 104,
          height: 104,
          borderRadius: '50%',
          background: 'var(--grad)',
          display: 'grid',
          placeItems: 'center',
          boxShadow: 'var(--shadow-brand)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 42 }}>
          {[0.4, 0.7, 1, 0.55, 0.85, 0.45, 0.7].map((h, i) => (
            <span key={i} style={{ width: 4, height: `${h * 100}%`, borderRadius: 99, background: 'rgba(255,255,255,0.92)' }} />
          ))}
        </div>
      </div>

      {chips.map((chip) => (
        <span
          key={chip.label}
          className="mono"
          style={{
            position: 'absolute',
            ...chip,
            padding: '7px 11px',
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 10,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-xs)',
            color: 'var(--text-muted)',
          }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
