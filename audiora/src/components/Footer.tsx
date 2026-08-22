import { Link } from 'react-router-dom';
import { MessageCircle, Twitter, Youtube } from 'lucide-react';
import { BrandMark } from './Brand';
import { BRAND, FOOTER_COLUMNS } from '@/config/site';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div style={{ maxWidth: 300 }}>
            <Link to="/" aria-label="7 Audio home" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <BrandMark size={30} />
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.03em' }}>7 Audio</span>
            </Link>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
              All-in-one audio toolkit for creators. Remove vocals, split stems and clean up any recording.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <a
                className="icon-btn icon-btn-sm"
                href={BRAND.social.twitter}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="7 Audio on Twitter"
              >
                <Twitter size={15} aria-hidden="true" />
              </a>
              <a
                className="icon-btn icon-btn-sm"
                href={BRAND.social.youtube}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="7 Audio on YouTube"
              >
                <Youtube size={15} aria-hidden="true" />
              </a>
              <a
                className="icon-btn icon-btn-sm"
                href={BRAND.social.discord}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="7 Audio on Discord"
              >
                <MessageCircle size={15} aria-hidden="true" />
              </a>
            </div>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 12 }}>{column.title}</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      style={{ fontSize: 13.5, color: 'var(--text-muted)' }}
                      className="footer-link"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="footer-bottom">
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>© {year} 7 Audio. All rights reserved.</p>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Audio tools, perfected.</p>
        </div>
      </div>
    </footer>
  );
}
