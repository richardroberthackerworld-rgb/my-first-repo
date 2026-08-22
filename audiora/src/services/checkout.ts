/**
 * ==========================================================================
 * Checkout — Cashfree.
 *
 * The browser's part of a payment is deliberately small:
 *
 *   1. Ask OUR server to create the order. The server picks the amount from
 *      its own plan table, so a tampered client cannot buy Pro for ₹1.
 *   2. Hand the returned payment session to Cashfree's SDK.
 *   3. Ask OUR server whether the order is actually paid. The SDK's return
 *      value is never treated as proof.
 *
 * Credits are granted by the server — by the webhook, or by the confirm call
 * hitting Cashfree's own order API. Nothing here adds a credit.
 * ==========================================================================
 */

import { request, backendConfigured } from './api';
import type { Cycle, PlanId, Region } from '@/config/pricing';

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

type CashfreeMode = 'sandbox' | 'production';

interface CashfreeCheckout {
  checkout(options: {
    paymentSessionId: string;
    redirectTarget?: '_self' | '_blank' | '_modal';
  }): Promise<{ error?: { message?: string }; paymentDetails?: unknown; redirect?: boolean }>;
}

declare global {
  interface Window {
    Cashfree?: (config: { mode: CashfreeMode }) => CashfreeCheckout;
  }
}

export interface PaymentHealth {
  configured: boolean;
  env: CashfreeMode;
}

let healthCache: PaymentHealth | null = null;

/** Whether payments are switched on, asked once per page load. */
export async function paymentsHealth(): Promise<PaymentHealth> {
  if (!backendConfigured()) return { configured: false, env: 'sandbox' };
  if (healthCache) return healthCache;
  try {
    healthCache = await request<PaymentHealth>('/api/pay/cashfree/health', { method: 'GET', auth: 'none' });
  } catch {
    healthCache = { configured: false, env: 'sandbox' };
  }
  return healthCache;
}

let sdkPromise: Promise<boolean> | null = null;

/** Load Cashfree's script once, on demand — never on first paint. */
function loadSdk(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Cashfree) return Promise.resolve(true);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Cashfree));
    script.onerror = () => {
      sdkPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export interface PurchaseRequest {
  plan: PlanId;
  cycle: Cycle;
  region: Region;
}

export interface PurchaseResult {
  /** True only when OUR server says the order is paid. */
  ok: boolean;
  /** Credits added by this purchase, as reported by the server. */
  added?: number;
  /** The new balance, as reported by the server. */
  credits?: number;
  /** A plain sentence to show the user when something did not work. */
  error?: string;
  /** True when the user closed the payment window without paying. */
  cancelled?: boolean;
  /** True when payment is still settling — the webhook will finish it. */
  pending?: boolean;
}

interface OrderResponse {
  orderId: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
  credits: number;
}

/**
 * Run a full purchase. Resolves with what the SERVER concluded, never with
 * what the SDK claimed.
 */
export async function purchasePlan(wanted: PurchaseRequest): Promise<PurchaseResult> {
  const health = await paymentsHealth();
  if (!health.configured) {
    return { ok: false, error: 'Payments are not available right now. Please try again later.' };
  }

  let order: OrderResponse;
  try {
    order = await request<OrderResponse>('/api/pay/cashfree/order', {
      body: { plan: wanted.plan, cycle: wanted.cycle, region: wanted.region },
      auth: 'user',
    });
  } catch (error) {
    return { ok: false, error: messageOf(error, 'Could not start the payment. Please try again.') };
  }

  const ready = await loadSdk();
  if (!ready || !window.Cashfree) {
    return { ok: false, error: 'Could not load the payment window. Check your connection and try again.' };
  }

  let sdkError: string | null = null;
  try {
    const cashfree = window.Cashfree({ mode: health.env });
    const outcome = await cashfree.checkout({
      paymentSessionId: order.paymentSessionId,
      redirectTarget: '_modal',
    });
    if (outcome?.error?.message) sdkError = outcome.error.message;
  } catch (error) {
    console.error('[7audio] checkout failed', error);
    sdkError = 'The payment window closed unexpectedly.';
  }

  // Ask the server regardless of what the SDK said. A user who paid and then
  // lost the modal must still get their credits.
  try {
    const confirmed = await request<{ ok: boolean; status: string; added?: number; credits?: number }>(
      '/api/pay/cashfree/confirm',
      { body: { orderId: order.orderId }, auth: 'user' },
    );
    if (confirmed.ok) {
      return { ok: true, added: confirmed.added ?? order.credits, credits: confirmed.credits };
    }
    if (confirmed.status === 'ACTIVE' || confirmed.status === 'PENDING') {
      return {
        ok: false,
        pending: true,
        error: 'Your payment is still going through. Your credits will appear here shortly.',
        credits: confirmed.credits,
      };
    }
    return {
      ok: false,
      cancelled: !sdkError,
      error: sdkError ?? 'The payment was not completed. Nothing has been charged.',
      credits: confirmed.credits,
    };
  } catch (error) {
    return {
      ok: false,
      pending: true,
      error: messageOf(error, 'We could not confirm the payment yet. It will update shortly.'),
    };
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
