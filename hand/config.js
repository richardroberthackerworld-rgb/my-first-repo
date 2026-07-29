/* ============================================================
   7Hand — client configuration.

   Transcription is OPTIONAL. Everything else works without it:
   you type what the page says and the software does the rest.
   This only automates that one step.

   TWO WAYS TO SET IT UP

   1. Proxy (what you deploy). Copy api/config.example.php to
      api/config.php, put a free key in it, and leave `proxy`
      below pointing at the endpoint. The key stays on the
      server and the endpoint is rate limited per caller.

   2. Direct (your machine only). Put a key in `devKeys` below
      and it calls the provider straight from the browser. The
      key is then visible in page source and in every network
      request, so this must never reach a public page — a key on
      a public button is lifted and burned within days. The code
      logs a warning every time it takes this path.

   Free keys, no card needed:
     Gemini         https://aistudio.google.com/apikey
     GitHub Models  https://github.com/settings/tokens
   ============================================================ */
'use strict';

export const CONFIG = {
  /* Relative, so it works on any domain this is deployed to. Set to null to
     disable the proxy path and fall back to devKeys. */
  proxy: './api/ocr.php',

  /* LOCAL DEVELOPMENT ONLY. Leave empty in anything you deploy. */
  devKeys: {
    gemini: '',
    github: ''
  }
};

/** What ocr.js expects: prefer the proxy, fall back to direct keys. */
export function ocrConfig() {
  if (CONFIG.proxy) return { proxy: CONFIG.proxy };
  return { keys: CONFIG.devKeys };
}

/** Whether transcription is available at all, for the UI to reflect honestly. */
export function ocrAvailable() {
  return Boolean(CONFIG.proxy || CONFIG.devKeys.gemini || CONFIG.devKeys.github);
}
