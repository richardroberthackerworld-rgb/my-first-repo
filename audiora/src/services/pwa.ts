/**
 * ==========================================================================
 * Installability and updates.
 *
 * Three separate things live here, and they are only related in that the
 * browser drives all of them:
 *
 *   1. Registering the service worker — production only. A worker in dev
 *      would cache the dev server's output and make edits look like they did
 *      not apply.
 *   2. Noticing a new build. 7 Audio runs jobs that take minutes, so a new
 *      version is never installed over a live page. It waits, and the user is
 *      asked when to take it.
 *   3. Capturing the install prompt so it can be offered somewhere sensible
 *      instead of wherever Chrome happens to put it.
 * ==========================================================================
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

type UpdateListener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;

const installListeners = new Set<UpdateListener>();
const updateListeners = new Set<UpdateListener>();

function announceInstall() {
  installListeners.forEach((fn) => fn());
}

function announceUpdate() {
  updateListeners.forEach((fn) => fn());
}

/* ---------------------------------------------------------- capability --- */

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** True once the app is running from the home screen rather than a tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    // iOS Safari predates display-mode and uses its own flag.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS has no install prompt event at all — Safari installs only through the
 * Share sheet, so those visitors need instructions rather than a button.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function installAvailable(): boolean {
  return deferredPrompt !== null;
}

/* ------------------------------------------------------------- install --- */

export function onInstallAvailabilityChange(fn: UpdateListener): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

/**
 * Show the browser's own install dialog. Returns what the user chose, or
 * 'unavailable' when there was no prompt to show (already installed, iOS, or
 * the browser has not decided the site is installable yet).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  // The event can only be used once, whatever the outcome.
  deferredPrompt = null;
  announceInstall();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch (error) {
    console.warn('[7audio] install prompt failed', error);
    return 'unavailable';
  }
}

/* -------------------------------------------------------------- update --- */

export function onUpdateReady(fn: UpdateListener): () => void {
  updateListeners.add(fn);
  if (waitingWorker) fn();
  return () => updateListeners.delete(fn);
}

export function updateReady(): boolean {
  return waitingWorker !== null;
}

/**
 * Take the update the user just agreed to. The worker activates, and the
 * controllerchange handler reloads the page once — never before.
 */
export function applyUpdate(): void {
  if (!waitingWorker) return;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  waitingWorker = null;
}

/* ------------------------------------------------------------- startup --- */

let started = false;

export function startPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome shows its own mini-infobar unless this is prevented; the app
    // offers installation in its own words instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    announceInstall();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    announceInstall();
  });

  if (!serviceWorkerSupported()) return;

  // A worker in development would serve yesterday's bundle out of a cache and
  // make every edit look broken. Register in production builds only.
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    void registerWorker();
  });
}

async function registerWorker(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    // A build that landed while the tab was closed is already waiting.
    if (registration.waiting && navigator.serviceWorker.controller) {
      waitingWorker = registration.waiting;
      announceUpdate();
    }

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // `controller` is null on the very first visit — that is an install,
        // not an update, and must not prompt anybody to reload.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorker = installing;
          announceUpdate();
        }
      });
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    // Catch a new build during a long session, without hammering the server.
    window.setInterval(
      () => {
        void registration.update();
      },
      60 * 60 * 1000,
    );
  } catch (error) {
    // A failed registration must never stop the app loading.
    console.warn('[7audio] service worker registration failed', error);
  }
}
