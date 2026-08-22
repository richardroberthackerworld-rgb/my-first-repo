import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, googleConfigured } from '@/services/api';
import { useSession } from '@/services/session';
import { DAILY_ALLOWANCE } from '@/config/credits';
import { InlineNotice, Spinner } from './ui/States';

/**
 * "Continue with Google" using Google Identity Services.
 *
 * GIS returns an ID token (a JWT) to the browser. That token is sent to our
 * server, which verifies it against Google and decides whether to accept the
 * account. Only the CLIENT ID appears here — it is public by design. The
 * client secret never leaves the server.
 *
 * Accounts are Gmail-only; the server enforces it and returns a plain sentence
 * that this component shows as-is.
 */

interface GoogleAccounts {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (r: { credential?: string }) => void }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<boolean> | null = null;

function loadGis(): Promise<boolean> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<boolean>((resolve) => {
    if (window.google?.accounts?.id) return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function GoogleSignIn({ onDone }: { onDone?: () => void }) {
  const { signInWithGoogle } = useSession();
  const holder = useRef<HTMLDivElement>(null);
  // Held in a ref so a caller passing an inline arrow does not re-run the
  // effect on every render — which re-initialises GIS and makes it warn that
  // initialize() was called more than once.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [state, setState] = useState<'loading' | 'ready' | 'blocked' | 'origin'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!googleConfigured()) {
      setState('blocked');
      return;
    }
    let alive = true;

    loadGis().then((ok) => {
      if (!alive) return;
      if (!ok || !window.google?.accounts?.id || !holder.current) {
        setState('blocked');
        return;
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response.credential) return;
          setBusy(true);
          setMessage(null);
          const result = await signInWithGoogle(response.credential);
          setBusy(false);
          if (result.ok) onDoneRef.current?.();
          else setMessage(result.error ?? 'Could not sign you in.');
        },
      });
      window.google.accounts.id.renderButton(holder.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: 300,
      });
      /*
       * renderButton does NOT throw when the page's origin is missing from the
       * OAuth client's authorised JavaScript origins. It quietly renders an
       * iframe with no content, measuring 0x0. Without this check the component
       * would report itself 'ready' and the visitor would stare at a blank gap
       * where the button should be, with nothing said and nothing to click.
       *
       * So: watch for the button to gain a real size. If it never does, say so.
       * Polling rather than one timeout, because the iframe can take a moment
       * on a slow connection and a single check would cry wolf.
       */
      const deadline = Date.now() + 4000;
      const check = () => {
        if (!alive || !holder.current) return;
        /*
         * Measure the IFRAME, not the holder and not GIS's wrapper.
         *
         * When the origin is not authorised, GIS still builds its wrapper div
         * at a full 300x40 and still paints "Continue with Google" into it —
         * it simply leaves the iframe that carries the actual click target at
         * 0x0. So the holder looks fine, the wrapper looks fine, the text is
         * there, and nothing happens when you press it. The iframe's height is
         * the only honest signal.
         */
        const frame = holder.current.querySelector('iframe');
        if (frame && frame.getBoundingClientRect().height > 0) {
          setState('ready');
        } else if (Date.now() < deadline) {
          window.setTimeout(check, 200);
        } else {
          console.error(
            '[7audio] Google button did not render. The most likely cause is that ' +
              window.location.origin +
              " is not listed under Authorised JavaScript origins for this OAuth client.",
          );
          setState('origin');
        }
      };
      check();
    });

    return () => {
      alive = false;
    };
  }, [signInWithGoogle]);

  if (state === 'origin') {
    return (
      <InlineNotice kind="warning">
        Google sign-in is not set up for this address yet. Every tool still works
        without an account — you get 10 free credits, and nothing you make is
        uploaded.
      </InlineNotice>
    );
  }

  if (state === 'blocked') {
    return (
      <InlineNotice>
        Google sign-in is not available right now. Every tool still works without an account.
      </InlineNotice>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
      <div ref={holder} style={{ minHeight: 44, display: busy ? 'none' : 'block' }} />
      {state === 'loading' && <Spinner size={18} label="Loading sign-in…" />}
      {busy && <Spinner size={18} label="Signing you in…" />}
      {message && <InlineNotice kind="warning">{message}</InlineNotice>}
      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5, maxWidth: 300 }}>
        Accounts use Gmail. Signing in gives you {DAILY_ALLOWANCE} free credits every day.
      </p>
    </div>
  );
}
