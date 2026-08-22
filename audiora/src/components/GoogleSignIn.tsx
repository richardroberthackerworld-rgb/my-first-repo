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
  const [state, setState] = useState<'loading' | 'ready' | 'blocked'>('loading');
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
          if (result.ok) onDone?.();
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
      setState('ready');
    });

    return () => {
      alive = false;
    };
  }, [signInWithGoogle, onDone]);

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
