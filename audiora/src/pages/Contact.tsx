import { Link } from 'react-router-dom';
import { CreditCard, LifeBuoy, Mail, MessageSquare, ShieldCheck } from 'lucide-react';
import { CONTACT_EMAIL } from '@/config/site';

/**
 * Contact.
 *
 * Deliberately not a form. A form needs an endpoint, a spam defence and a
 * mailbox somebody watches; an address needs none of those and reaches the
 * same inbox. It is also the address every 7 Audio email replies to, so a
 * customer who writes here is writing to the same place either way.
 */

const REASONS = [
  {
    icon: LifeBuoy,
    title: 'Something is not working',
    body: 'Tell us which tool, what you loaded and what happened. The browser you used helps too — some problems only appear on one.',
  },
  {
    icon: CreditCard,
    title: 'A question about a payment',
    body: 'Include the order ID from your confirmation email. That is the fastest way for us to find the transaction.',
  },
  {
    icon: MessageSquare,
    title: 'A suggestion',
    body: 'Missing a format, a tool or a setting? We would rather hear it than guess.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy or legal',
    body: 'Questions about how your data is handled, or anything covered by our Privacy Policy and Terms.',
  },
];

export default function Contact() {
  return (
    <div className="container section" style={{ maxWidth: 760 }}>
      <header style={{ textAlign: 'center', marginBottom: 30 }}>
        <span className="badge badge-ai" style={{ marginBottom: 16 }}>
          <Mail size={12} aria-hidden="true" />
          Contact
        </span>
        <h1 style={{ fontSize: 'clamp(27px, 5.2vw, 40px)' }}>Get in touch</h1>
        <p style={{ fontSize: 15.5, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.55 }}>
          One address, read by a person. We answer as quickly as we can.
        </p>
      </header>

      {/* ------------------------------------------------------- the address */}
      <div className="card card-pad contact-hero">
        <span className="contact-hero-icon">
          <Mail size={22} aria-hidden="true" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Email us
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="contact-address">
            {CONTACT_EMAIL}
          </a>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
            This is also the reply address on every email 7 Audio sends you.
          </p>
        </div>
        <a href={`mailto:${CONTACT_EMAIL}`} className="btn btn-primary contact-cta">
          Write to us
        </a>
      </div>

      {/* ------------------------------------------------- what to tell us */}
      <section style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 20, marginBottom: 14 }}>What to include</h2>
        <div className="contact-reasons">
          {REASONS.map((reason) => {
            const Icon = reason.icon;
            return (
              <div key={reason.title} className="card card-pad">
                <span className="contact-reason-icon">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <h3 style={{ fontSize: 15, marginTop: 12 }}>{reason.title}</h3>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>{reason.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------- before you do */}
      <section style={{ marginTop: 30 }}>
        <div className="card card-pad">
          <h2 style={{ fontSize: 18 }}>Before you write</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.65 }}>
            The Help Center answers the questions we are asked most — why the first run takes longer, which formats work,
            what uses credits and what does not. It may be faster than waiting for a reply.
          </p>
          <div className="button-pair" style={{ marginTop: 16 }}>
            <Link to="/support" className="btn btn-secondary">
              <LifeBuoy size={16} aria-hidden="true" />
              Help Center
            </Link>
            <Link to="/credits" className="btn btn-secondary">
              <CreditCard size={16} aria-hidden="true" />
              How credits work
            </Link>
          </div>
        </div>
      </section>

      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 24, textAlign: 'center', lineHeight: 1.6 }}>
        Please do not send passwords or card details by email. We will never ask for them.
      </p>
    </div>
  );
}
