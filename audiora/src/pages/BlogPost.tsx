import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { BLOG_REDIRECTS, postBySlug, relatedPosts } from '@/data/blog/index';
import { EmptyState } from '@/components/ui/States';
import { Seo } from '@/components/Seo';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { articleSchema } from '@/config/seo';
import { useMemo } from 'react';
import { FileQuestion } from 'lucide-react';

export default function BlogPost() {
  const { slug } = useParams();
  const post = slug ? postBySlug(slug) : undefined;

  // An article that was retitled keeps its old URL working. Search results and
  // other people's links point at the old slug, and a 404 loses both.
  const movedTo = slug && !post ? BLOG_REDIRECTS[slug] : undefined;

  // Memoised: <Seo> treats this as a dependency, and a fresh array each render
  // would rewrite the document head continuously. Declared above the early
  // return so the hook order is identical on both paths.
  const schema = useMemo(() => (post ? [articleSchema(post)] : undefined), [post]);

  if (movedTo) return <Navigate to={`/blog/${movedTo}`} replace />;

  if (!post) {
    return (
      <div className="container section">
        <Seo title="Article not found" description="That link does not match any article we have." noindex />
        <div className="card">
          <EmptyState
            icon={FileQuestion}
            title="Article not found"
            body="That link does not match any article we have."
            action={
              <Link to="/blog" className="btn btn-primary">
                Back to the blog
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const others = relatedPosts(post, 3);

  return (
    <article className="container section" style={{ maxWidth: 760 }}>
      <Seo title={post.title} description={post.excerpt} type="article" schema={schema} />
      <Breadcrumbs
        override={[
          { label: 'Blog', path: '/blog' },
          { label: post.title, path: `/blog/${post.slug}` },
        ]}
      />

      <Link to="/blog" className="btn btn-quiet btn-sm" style={{ marginLeft: -14, marginBottom: 20 }}>
        <ArrowLeft size={15} aria-hidden="true" />
        All articles
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="badge badge-ai">{post.category}</span>
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <Clock size={12} aria-hidden="true" />
          {post.readingMinutes} min read
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {new Date(post.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <h1 style={{ fontSize: 'clamp(27px, 5vw, 40px)', lineHeight: 1.12 }}>{post.title}</h1>
      <p style={{ fontSize: 17, color: 'var(--text-muted)', marginTop: 16, lineHeight: 1.65 }}>{post.excerpt}</p>

      <hr className="divider" style={{ margin: '28px 0' }} />

      <div className="prose">
        {post.body.map((block, index) => {
          if (block.type === 'h2') return <h2 key={index}>{block.text}</h2>;
          if (block.type === 'h3') return <h3 key={index}>{block.text}</h3>;
          if (block.type === 'ul')
            return (
              <ul key={index}>
                {block.items?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          if (block.type === 'ol')
            return (
              <ol key={index}>
                {block.items?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            );
          if (block.type === 'quote')
            return (
              <blockquote key={index}>
                <p>{block.text}</p>
              </blockquote>
            );
          if (block.type === 'code')
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
            );
          return <p key={index}>{block.text}</p>;
        })}
      </div>

      <div className="card card-pad" style={{ marginTop: 36, background: 'var(--brand-soft)', borderColor: 'var(--border-brand)' }}>
        <h2 style={{ fontSize: 18 }}>Try it yourself</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
          Every 7 Audio tool runs on your own device. No account, no upload.
        </p>
        <Link to="/tools" className="btn btn-primary" style={{ marginTop: 16 }}>
          Explore tools
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 20, marginBottom: 18 }}>Keep reading</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {others.map((other) => (
            <Link
              key={other.slug}
              to={`/blog/${other.slug}`}
              className="card card-hover"
              style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}
            >
              <span
                style={{ width: 4, alignSelf: 'stretch', borderRadius: 99, background: other.accent, flex: 'none' }}
                aria-hidden="true"
              />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, letterSpacing: '-0.015em' }}>
                  {other.title}
                </span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  {other.excerpt}
                </span>
              </span>
              <ArrowRight size={16} style={{ color: 'var(--text-dim)', flex: 'none' }} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
