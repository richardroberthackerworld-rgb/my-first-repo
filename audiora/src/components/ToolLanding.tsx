import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { contentFor } from '@/data/tool-content';
import { toolById } from '@/config/tools';
import { Seo } from './Seo';
import { faqSchema } from '@/config/seo';
import type { ToolDef } from '@/config/tools';

/**
 * ==========================================================================
 * The landing half of a tool page.
 *
 * Every tool page is two things at once. Above this: the working tool, which
 * is what somebody arriving from a search for "vocal remover" wants in the
 * first second. Below it: the content that explains the job, answers the
 * questions people actually ask, and links on to the next tool.
 *
 * Keeping both on ONE url is deliberate. A separate /vocal-remover marketing
 * page would compete with /tools/vocal-remover for the same search, split the
 * links between them and leave Google to guess which to show. One strong page
 * beats two halves of one.
 *
 * The HowTo and FAQPage markup this emits describes exactly what is rendered
 * below — that is a condition of it being eligible for a rich result at all,
 * and it is read from the same file the markup is.
 * ==========================================================================
 */
export function ToolLanding({ tool }: { tool: ToolDef }) {
  const content = contentFor(tool.id);

  const schema = useMemo(() => {
    if (!content) return undefined;
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: content.howToName,
        description: content.lede,
        totalTime: 'PT2M',
        step: content.steps.map((step, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          name: step.name,
          text: step.text,
        })),
      },
      faqSchema(content.faqs),
    ];
  }, [content]);

  if (!content) return null;

  const related = content.related.map(toolById).filter((t): t is ToolDef => Boolean(t?.path));

  return (
    <>
      <Seo schema={schema} />

      <section className="tool-landing">
        {/* ------------------------------------------------------ intro -- */}
        <div className="landing-intro">
          <h2>{tool.name}: what it does</h2>
          <p>{content.lede}</p>
          <p>{content.body}</p>
        </div>

        {/* ------------------------------------------------------ steps -- */}
        <div className="landing-block">
          <h2>{content.howToName}</h2>
          <ol className="landing-steps">
            {content.steps.map((step, index) => (
              <li key={step.name}>
                <span className="landing-step-num mono">{index + 1}</span>
                <div>
                  <h3>{step.name}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* -------------------------------------------------- use cases -- */}
        <div className="landing-block">
          <h2>What people use it for</h2>
          <div className="landing-cases">
            {content.useCases.map((useCase) => (
              <div key={useCase.title} className="card card-pad">
                <h3>{useCase.title}</h3>
                <p>{useCase.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------ specs -- */}
        <div className="landing-block">
          <h2>At a glance</h2>
          <dl className="landing-specs">
            {content.specs.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* -------------------------------------------------------- faq -- */}
        <div className="landing-block">
          <h2>Questions</h2>
          <div className="card landing-faq">
            {content.faqs.map((faq, index) => (
              <FaqRow key={faq.q} faq={faq} first={index === 0} />
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------- related -- */}
        {related.length > 0 && (
          <div className="landing-block">
            <h2>Try these next</h2>
            <div className="landing-related">
              {related.map((other) => {
                const Icon = other.icon;
                return (
                  <Link key={other.id} to={other.path as string} className="card card-pad landing-related-card">
                    <span className="landing-related-icon" style={{ color: other.accent }}>
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3>{other.name}</h3>
                      <p>{other.short}</p>
                    </div>
                    <ArrowRight size={16} aria-hidden="true" style={{ flex: 'none', color: 'var(--text-dim)' }} />
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function FaqRow({ faq, first }: { faq: { q: string; a: string }; first: boolean }) {
  const [open, setOpen] = useState(first);

  return (
    <div style={{ borderTop: first ? 0 : '1px solid var(--border)' }}>
      <button type="button" className="landing-faq-q" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{faq.q}</span>
        <ChevronDown
          size={17}
          aria-hidden="true"
          style={{ flex: 'none', transition: 'transform 0.18s ease', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {/*
        Always rendered, collapsed with CSS. Unmounting it would remove the
        answer from the document while the FAQPage markup still claims it is
        there.
      */}
      <div className="landing-faq-panel" data-open={open}>
        <p className="landing-faq-a">{faq.a}</p>
      </div>
    </div>
  );
}
