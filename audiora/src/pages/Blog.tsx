import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock } from 'lucide-react';
import { CATEGORIES, POSTS } from '@/data/blog/index';
import { Segmented } from '@/components/ui/Controls';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Blog() {
  const [category, setCategory] = useState<string>('All');
  const posts = category === 'All' ? POSTS : POSTS.filter((post) => post.category === category);
  const [featured, ...rest] = posts;

  return (
    <div className="container section">
      <header style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 30px' }}>
        <span className="badge badge-ai" style={{ marginBottom: 16 }}>
          Blog
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 5.4vw, 42px)' }}>
          Notes on <span className="grad-text">audio and privacy</span>
        </h1>
        <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 14 }}>
          How the tools work, what the settings really do, and where the limits are.
        </p>
      </header>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 30 }}>
        <div className="scroll-x" style={{ maxWidth: '100%' }}>
          <Segmented
            label="Filter by category"
            size="sm"
            value={category}
            onChange={setCategory}
            options={[{ value: 'All', label: 'All' }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      </div>

      {featured && (
        <Link to={`/blog/${featured.slug}`} className="card card-hover blog-featured">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="badge badge-ai">{featured.category}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {formatDate(featured.date)}
              </span>
            </div>
            <h2 style={{ fontSize: 'clamp(21px, 3.4vw, 28px)' }}>{featured.title}</h2>
            <p style={{ fontSize: 14.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>{featured.excerpt}</p>
            <span
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 20 }}
            >
              Read article
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="blog-featured-art" aria-hidden="true">
            <WaveArt accent={featured.accent} />
          </div>
        </Link>
      )}

      <div className="blog-grid">
        {rest.map((post) => (
          <Link key={post.slug} to={`/blog/${post.slug}`} className="card card-hover card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                height: 4,
                width: 46,
                borderRadius: 99,
                background: post.accent,
                marginBottom: 16,
              }}
              aria-hidden="true"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className="badge badge-neutral">{post.category}</span>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Clock size={11} aria-hidden="true" />
                {post.readingMinutes} min
              </span>
            </div>
            <h3 style={{ fontSize: 17 }}>{post.title}</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 9, lineHeight: 1.6, flex: 1 }}>{post.excerpt}</p>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 16 }}>
              {formatDate(post.date)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function WaveArt({ accent }: { accent: string }) {
  const bars = [0.3, 0.55, 0.85, 0.45, 1, 0.62, 0.35, 0.72, 0.5, 0.9, 0.4, 0.66, 0.28, 0.8, 0.44];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        height: 130,
        padding: '0 8px',
      }}
    >
      {bars.map((height, index) => (
        <span
          key={index}
          style={{
            width: 7,
            height: `${height * 100}%`,
            borderRadius: 99,
            background: accent,
            opacity: 0.22 + height * 0.5,
          }}
        />
      ))}
    </div>
  );
}
