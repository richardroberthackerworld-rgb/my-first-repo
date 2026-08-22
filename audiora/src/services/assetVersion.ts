/**
 * ==========================================================================
 * Build stamp for the unhashed runtime assets.
 *
 * Vite content-hashes everything in assets/, but the workers, the worklet and
 * the ffmpeg core keep stable filenames — they are loaded by URL at runtime,
 * not imported, so the bundler never sees them.
 *
 * WHY THEY NEED A VERSION QUERY
 *
 * Cross-origin isolation (COOP + COEP) is enabled for this site so the
 * separation engine can use multiple CPU threads. COEP refuses any HTTP-cache
 * entry that was stored BEFORE the policy applied, and the refusal surfaces as
 * an opaque worker error with no message, no filename and no line number —
 * effectively undebuggable if you do not already know the cause.
 *
 * A returning visitor with these files cached from a pre-isolation build would
 * hit exactly that: separation broken, nothing in the console explaining why,
 * until the entry expired. Stamping the URL with the build id means the first
 * request after an upgrade is for a URL that has never been cached, so the
 * problem cannot occur.
 *
 * ASSET_VERSION is injected by vite.config.ts and changes on every build.
 * ==========================================================================
 */

declare const __ASSET_VERSION__: string;

/** The current build's id. Stable within a build, different between builds. */
export const ASSET_VERSION: string =
  typeof __ASSET_VERSION__ === 'string' ? __ASSET_VERSION__ : 'dev';

/**
 * Stamp a runtime asset URL with the build id.
 *
 *   versioned('/workers/separation-worker.js')
 *     → '/workers/separation-worker.js?v=m1x2y3'
 *
 * Only for files served from public/ and fetched by URL. Anything imported
 * normally is already content-hashed and must not go through here.
 */
export function versioned(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}v=${ASSET_VERSION}`;
}
