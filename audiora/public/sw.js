/* ===========================================================================
 * 7 Audio — service worker.
 *
 * What this does, and just as importantly what it deliberately does NOT do.
 *
 * DOES
 *   · Make repeat visits fast, and make the app installable.
 *   · Cache the hashed build output hard (the filenames change every build,
 *     so a stale file can never be served under a name that means something
 *     else).
 *   · Revalidate the unhashed workers and worklets, which keep stable names.
 *
 * DOES NOT
 *   · Touch cross-origin requests. The 181 MB separation model and the ONNX
 *     runtime come from huggingface.co and jsdelivr, and the separation code
 *     already stores them in its own Cache API bucket with its own progress
 *     reporting. Intercepting them here would cache 181 MB twice and break
 *     that progress readout.
 *   · Touch anything but GET. Sign-in, credit spends and payment calls must
 *     always hit the network.
 *   · Activate itself over a running page. A separation job takes minutes;
 *     swapping the assets underneath it would throw that work away. The new
 *     worker waits, the page offers a reload, and the user chooses when.
 *   · Serve the app to a device with no connection. Credits, sign-in and
 *     payments are decided by the server, so a shell loaded without one could
 *     only half-work. A disconnected visitor gets connection.html, which says
 *     plainly what is wrong, rather than an app that silently misbehaves.
 * ======================================================================== */

/* Both placeholders are rewritten by scripts/make-sw.mjs after `vite build`.
   In development this file is never registered, so the raw values never run. */
const VERSION = '__BUILD_VERSION__';
const PRECACHE_URLS = __PRECACHE_URLS__;

const SHELL_CACHE = `7audio-shell-${VERSION}`;
const RUNTIME_CACHE = `7audio-runtime-${VERSION}`;
const NO_CONNECTION_URL = '/connection.html';

/* ------------------------------------------------------------- install --- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One failed URL must not fail the whole install, or a single renamed
      // asset would leave the site with no worker at all.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((error) => {
            console.warn('[sw] could not precache', url, error);
          }),
        ),
      );
    })(),
  );
  // Note: no skipWaiting() here. See the header.
});

/* ------------------------------------------------------------ activate --- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('7audio-') && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

/* ------------------------------------------------------------- message --- */

self.addEventListener('message', (event) => {
  // The page sends this only when the user has agreed to reload.
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* --------------------------------------------------------------- fetch --- */

function isHashedAsset(url) {
  // Vite emits /assets/name-8charHash.ext — safe to pin forever.
  return url.pathname.startsWith('/assets/');
}

function isRevalidating(url) {
  // Stable filenames: they change in place between builds.
  return (
    url.pathname.startsWith('/workers/') ||
    url.pathname.startsWith('/worklets/') ||
    url.pathname.startsWith('/ffmpeg/') ||
    url.pathname.startsWith('/brand/')
  );
}

/* ---------------------------------------------------------- strategies --- */

/*
 * Every cache read below passes ignoreVary.
 *
 * Static hosts commonly answer with "Vary: Origin". A module script tagged
 * crossorigin — which is every script Vite emits — sends an Origin header,
 * while the plain Request used to precache it does not. With Vary honoured
 * those two never match, so the precached bundle is invisible to the very
 * requests it exists for, and every repeat visit re-downloads the whole app.
 * The assets are content-hashed and identical for every caller, so varying on
 * Origin means nothing here.
 */
const MATCH = { ignoreVary: true };

/** Cache-first: for content whose URL changes when the content changes. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, MATCH);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/** Serve what we have, refresh in the background for next time. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && (response.type === 'basic' || response.type === 'default')) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}

/**
 * Navigations always go to the network. 7 Audio needs the server for credits,
 * sign-in and payments, so it is never served from a cache — if the network is
 * unreachable the visitor gets a page that says exactly that.
 */
async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cached = await caches.match(NO_CONNECTION_URL, MATCH);
    if (cached) return cached;
    return new Response('7 Audio needs a connection. Check your connection and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Sign-in, credit spends and payments must never come from a cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The model, the ONNX runtime and the backend are all somebody else's
  // origin. Leave every one of them alone.
  if (url.origin !== self.location.origin) return;

  // A range request (audio scrubbing) must reach the network untouched.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isRevalidating(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});
