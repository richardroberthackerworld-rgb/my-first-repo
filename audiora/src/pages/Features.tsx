import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BrainCircuit,
  Download,
  FileAudio,
  Gauge,
  Layers,
  Lock,
  MonitorSmartphone,
  Moon,
  Waves,
} from 'lucide-react';

const FEATURES = [
  {
    icon: BrainCircuit,
    title: 'Studio-grade separation',
    body: 'Vocal removal and stem splitting are accurate enough to use in a real mix, with a higher-quality option when you need the cleanest possible split.',
  },
  {
    icon: Waves,
    title: 'Six separate stems',
    body: 'Vocals, drums, bass, guitar, piano and everything else — each one previewable and downloadable on its own.',
  },
  {
    icon: FileAudio,
    title: 'Every common format',
    body: 'MP3, WAV, FLAC, M4A, OGG and AAC, in and out. Pick a format and that is genuinely what you get.',
  },
  {
    icon: Download,
    title: 'Downloads that just work',
    body: 'One click saves a single track. Batches arrive as a single zip, correctly named and ready to use.',
  },
  {
    icon: Gauge,
    title: 'No queue, no waiting around',
    body: 'Cutting, joining, converting and pitch shifting finish in seconds, however busy the site is.',
  },
  {
    icon: Lock,
    title: 'Secure and private',
    body: 'Your files are handled securely and are never shared with anyone.',
  },
  {
    icon: Layers,
    title: 'One consistent design',
    body: 'Every tool shares the same panels, controls and export settings, so learning one means you already know the rest.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Built for phones too',
    body: 'A real bottom navigation, touch-sized controls and layouts designed for small screens — not a desktop page squeezed down.',
  },
  {
    icon: Moon,
    title: 'A proper dark theme',
    body: 'Deep navy surfaces, re-tuned accents and waveforms that stay readable. It follows your system by default.',
  },
];

const STEPS = [
  { title: 'Choose a file', body: 'Drag it in, or browse for it.' },
  { title: 'Set it up', body: 'Format, quality, ranges, pitch — whatever the tool needs.' },
  { title: 'Process', body: 'One button. A simple progress bar tells you where it is up to.' },
  { title: 'Download', body: 'Straight to your downloads folder, with a sensible filename.' },
];

export default function Features() {
  return (
    <>
      <section className="container section" style={{ paddingBottom: 24 }}>
        <header style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto' }}>
          <span className="badge badge-ai" style={{ marginBottom: 16 }}>
            Features
          </span>
          <h1 style={{ fontSize: 'clamp(28px, 5.4vw, 44px)' }}>
            Audio tools, <span className="grad-text">perfected</span>
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.65 }}>
            Everything you need to edit, clean up and transform audio — in one place, with nothing to install.
          </p>
        </header>
      </section>

      <section className="container" style={{ paddingBottom: 40 }}>
        <div className="features-grid">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="card card-pad">
                <span
                  style={{
                    width: 46,
                    height: 46,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 14,
                    background: 'var(--brand-soft)',
                    color: 'var(--brand)',
                    marginBottom: 14,
                  }}
                >
                  <Icon size={21} aria-hidden="true" />
                </span>
                <h3 style={{ fontSize: 16 }}>{feature.title}</h3>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.65 }}>{feature.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section" style={{ background: 'var(--bg-deep)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div className="container">
          <h2 style={{ fontSize: 'clamp(23px, 4.4vw, 32px)', textAlign: 'center', marginBottom: 8 }}>How it works</h2>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 36 }}>
            Four steps, start to finish.
          </p>

          <ol className="steps-grid">
            {STEPS.map((step, index) => (
              <li key={step.title} className="card card-pad" style={{ listStyle: 'none' }}>
                <span
                  className="mono"
                  style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--grad)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                  }}
                >
                  {index + 1}
                </span>
                <h3 style={{ fontSize: 15.5 }}>{step.title}</h3>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container section" style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(22px, 4.2vw, 30px)' }}>Try it with one of your own files</h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 12, marginBottom: 26 }}>
          No account needed. Nothing to install.
        </p>
        <Link to="/tools" className="btn btn-primary btn-lg">
          Explore Tools
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}
