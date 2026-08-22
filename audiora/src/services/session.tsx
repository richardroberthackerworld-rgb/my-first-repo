import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  backendConfigured,
  readUserToken,
  request,
  writeGuestToken,
  writeUserToken,
} from './api';
import { GUEST_ALLOWANCE } from '@/config/credits';

/**
 * ==========================================================================
 * Session — who is signed in, and how many credits they have.
 *
 * The server is the authority for both. This holds a cached copy so the UI can
 * render immediately, and refreshes after anything that could change it.
 *
 * An honest note on enforcement: 7 Audio processes audio in the browser, on
 * the visitor's own machine. Credits are therefore a billing convention, not a
 * technical gate — someone determined can bypass the client-side call. What
 * the server does guarantee is that a balance cannot be inflated, spent twice
 * or driven negative, and that paid credits are only granted by a verified
 * payment.
 * ==========================================================================
 */

export interface Account {
  id: string;
  name: string;
  email: string;
  credits: number;
}

export type SessionStatus = 'loading' | 'guest' | 'signed-in' | 'unavailable';

interface SessionValue {
  status: SessionStatus;
  account: Account | null;
  credits: number;
  isGuest: boolean;
  signedIn: boolean;
  available: boolean;
  error: string | null;

  signInWithGoogle: (credential: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
  refresh: () => Promise<void>;
  spend: (amount: number) => Promise<{ ok: boolean; error?: string; credits: number }>;
  canAfford: (amount: number) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(backendConfigured() ? 'loading' : 'unavailable');
  const [account, setAccount] = useState<Account | null>(null);
  const [credits, setCredits] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** Fetch (or create) the guest allowance. */
  const startGuest = useCallback(async () => {
    try {
      const data = await request<{ token: string; credits: number }>('/api/guest/start', { auth: 'guest' });
      writeGuestToken(data.token);
      setCredits(data.credits ?? 0);
      setAccount(null);
      setStatus('guest');
    } catch (e) {
      console.warn('[7audio] guest session unavailable', e);
      setStatus('unavailable');
      setCredits(GUEST_ALLOWANCE);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!backendConfigured()) {
      setStatus('unavailable');
      return;
    }
    if (readUserToken()) {
      try {
        const data = await request<{ user: Account }>('/api/me', { method: 'GET', auth: 'user' });
        setAccount(data.user);
        setCredits(data.user.credits ?? 0);
        setStatus('signed-in');
        return;
      } catch (e) {
        // An expired or invalid token quietly drops back to guest.
        if (e instanceof ApiError && e.status === 401) writeUserToken(null);
      }
    }
    await startGuest();
  }, [startGuest]);

  useEffect(() => {
    void refresh();
    // Keep tabs roughly in step: if one signs in or out, the others follow.
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'audiora:token') void refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  const signInWithGoogle = useCallback(async (credential: string) => {
    setError(null);
    try {
      const data = await request<{ token: string; user: Account }>('/api/auth/google', {
        body: { credential },
        auth: 'none',
      });
      writeUserToken(data.token);
      writeGuestToken(null);
      setAccount(data.user);
      setCredits(data.user.credits ?? 0);
      setStatus('signed-in');
      return { ok: true };
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Could not sign you in. Please try again.';
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const signOut = useCallback(() => {
    writeUserToken(null);
    setAccount(null);
    setStatus('loading');
    void startGuest();
  }, [startGuest]);

  const spend = useCallback(
    async (amount: number) => {
      const want = Math.max(0, Math.floor(amount || 0));
      if (want === 0) return { ok: true, credits };

      // No backend means nothing to meter against, so never block the tools.
      if (!backendConfigured()) return { ok: true, credits };

      const signedIn = !!readUserToken();
      try {
        const data = await request<{ ok: boolean; credits: number }>(
          signedIn ? '/api/credits/spend' : '/api/guest/spend',
          { body: { amount: want }, auth: signedIn ? 'user' : 'guest' },
        );
        setCredits(data.credits ?? 0);
        return { ok: true, credits: data.credits ?? 0 };
      } catch (e) {
        if (e instanceof ApiError) {
          const left = typeof e.data.credits === 'number' ? e.data.credits : 0;
          setCredits(left);
          return { ok: false, error: e.message, credits: left };
        }
        return { ok: false, error: 'Could not update your credits.', credits };
      }
    },
    [credits],
  );

  const canAfford = useCallback(
    (amount: number) => {
      if (!backendConfigured()) return true;
      return credits >= Math.max(0, Math.floor(amount || 0));
    },
    [credits],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      account,
      credits,
      isGuest: status === 'guest',
      signedIn: status === 'signed-in',
      available: status !== 'unavailable',
      error,
      signInWithGoogle,
      signOut,
      refresh,
      spend,
      canAfford,
    }),
    [status, account, credits, error, signInWithGoogle, signOut, refresh, spend, canAfford],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
