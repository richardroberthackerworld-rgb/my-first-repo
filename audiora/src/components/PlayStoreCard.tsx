import { BrandMark } from './Brand';
import { BRAND } from '@/config/site';

/**
 * Google Play promotion for the 7 Audio Android app.
 *
 * The store URL is not invented here. Until `BRAND.playStoreUrl` is set in
 * config/site.ts the card renders as "Coming soon" with the button disabled —
 * the moment a real URL is filled in, it becomes a live link.
 */

/** Google Play's four-colour triangle, drawn rather than fetched. */
function PlayGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M3.6 1.8a1.4 1.4 0 0 0-.5 1.1v18.2c0 .45.18.85.5 1.1l.1.06L13.8 12v-.24L3.7 1.74l-.1.06Z" fill="#00A0FF" />
      <path d="m17.2 15.4-3.4-3.4v-.24l3.4-3.4.08.05 4.03 2.29c1.15.65 1.15 1.72 0 2.38l-4.03 2.28-.08.04Z" fill="#FFBC00" />
      <path d="M17.28 15.35 13.8 11.88 3.6 22.1c.38.4 1 .45 1.71.05l11.97-6.8Z" fill="#FF3A44" />
      <path d="M17.28 8.41 5.31 1.62c-.71-.4-1.33-.35-1.71.05L13.8 11.88l3.48-3.47Z" fill="#00D563" />
    </svg>
  );
}

export function PlayStoreCard() {
  const url = BRAND.playStoreUrl;
  const live = typeof url === 'string' && url.length > 0;

  return (
    <div className="card play-card">
      <div className="play-copy">
        <span className="badge badge-ai" style={{ marginBottom: 12 }}>
          7 Audio App
        </span>
        <h2 style={{ fontSize: 'clamp(20px, 3.4vw, 26px)' }}>Take 7 Audio with you</h2>
        <p style={{ fontSize: 14.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6, maxWidth: 420 }}>
          Powerful audio tools, right from your phone. Separate stems, clean up recordings and export in any format
          while you are away from your desk.
        </p>

        <div style={{ marginTop: 20 }}>
          {live ? (
            <a href={url} target="_blank" rel="noreferrer noopener" className="btn play-btn">
              <PlayGlyph />
              <span style={{ textAlign: 'left', lineHeight: 1.15 }}>
                <span style={{ display: 'block', fontSize: 10, opacity: 0.75, letterSpacing: '0.04em' }}>GET IT ON</span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>Google Play</span>
              </span>
            </a>
          ) : (
            <>
              <span className="btn play-btn" aria-disabled="true" data-disabled="true">
                <PlayGlyph />
                <span style={{ textAlign: 'left', lineHeight: 1.15 }}>
                  <span style={{ display: 'block', fontSize: 10, opacity: 0.75, letterSpacing: '0.04em' }}>GET IT ON</span>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>Google Play</span>
                </span>
              </span>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>Coming soon to Google Play.</p>
            </>
          )}
        </div>
      </div>

      {/* Phone mockup showing the app icon on a home screen. */}
      <div className="play-art" aria-hidden="true">
        <div className="play-phone">
          <span className="play-notch" />
          <div className="play-screen">
            <span className="play-appicon">
              <BrandMark size={44} />
            </span>
            <span className="play-appname">7 Audio</span>
            <div className="play-rows">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
