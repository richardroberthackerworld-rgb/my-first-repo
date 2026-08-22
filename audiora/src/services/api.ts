/**
 * ==========================================================================
 * Backend client.
 *
 * One place that knows the base URL, attaches the right token and turns
 * failures into plain sentences. Nothing above this layer touches `fetch`.
 *
 * Configure with VITE_AUDIORA_API (e.g. https://api.7by.in). With it unset the
 * app runs in local-only mode: every call reports "unavailable" rather than
 * throwing, so the audio tools keep working with no account at all.
 * ==========================================================================
 */

export const API_BASE = (import.meta.env.VITE_AUDIORA_API as string | undefined)?.replace(/\/$/, '') ?? '';

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

/** The client ID is public by design; the secret lives only on the server. */
export function backendConfigured(): boolean {
  return API_BASE.length > 0;
}

export function googleConfigured(): boolean {
  return backendConfigured() && GOOGLE_CLIENT_ID.length > 0;
}

const USER_TOKEN_KEY = 'audiora:token';
const GUEST_TOKEN_KEY = 'audiora:guest';

export function readUserToken(): string | null {
  try {
    return localStorage.getItem(USER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeUserToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    else localStorage.removeItem(USER_TOKEN_KEY);
  } catch {
    /* storage disabled */
  }
}

export function readGuestToken(): string | null {
  try {
    return localStorage.getItem(GUEST_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeGuestToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(GUEST_TOKEN_KEY, token);
    else localStorage.removeItem(GUEST_TOKEN_KEY);
  } catch {
    /* storage disabled */
  }
}

export class ApiError extends Error {
  status: number;
  /** Extra fields the server sent, e.g. remaining credits. */
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** 'user' uses the account token, 'guest' the guest token, 'none' neither. */
  auth?: 'user' | 'guest' | 'none';
  signal?: AbortSignal;
}

/**
 * Make a call. Throws ApiError with a message safe to show a user — the raw
 * cause is logged to the console instead.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!backendConfigured()) {
    throw new ApiError('Accounts are not available right now.', 0);
  }

  // The backend is shared between 7By products. This header is how it knows
  // which one is calling, so a verification code arrives branded as 7 Audio
  // and from noreply@7audio.7by.in rather than the generic sender.
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-7-App': '7audio' };
  const token = options.auth === 'guest' ? readGuestToken() : options.auth === 'user' ? readUserToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: options.method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
      signal: options.signal,
    });
  } catch (error) {
    console.error('[7audio] network failure', path, error);
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    // The server already writes user-facing sentences for the cases that matter.
    const message = typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.';
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}
