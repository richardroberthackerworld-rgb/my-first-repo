/* ============================================================
   7Hand — reading the page with a vision model.

   This replaces exactly one step: typing out what the page says.
   Everything else — deskew, segmentation, alignment, glyph
   extraction — is unchanged and still runs locally. The model
   never sees a glyph and never decides which blob is which
   letter. It only produces text, and the alignment step then
   checks that text against the ink and discards anything that
   disagrees.

   That ordering matters. A vision model will misread a word now
   and then, and if its output were trusted the style would end
   up with mislabelled letters. Instead a misread word simply
   fails the blob-count check and is skipped, exactly like a word
   with joined letters. The model can be wrong without doing
   damage.

   TWO WAYS TO CALL IT

     proxy  (default)  browser → your server → provider
                       the key lives on the server, rate limited
     direct (dev only) browser → provider
                       the key is in the page source, visible to
                       anyone who opens devtools

   Direct mode exists so you can try this without deploying
   anything. It warns, loudly, and must never ship on a public
   page: a key on a public OCR button is lifted and burned within
   days.
   ============================================================ */
'use strict';

/**
 * Providers that accept an image on a free tier.
 * Ordered: the chain tries each in turn and falls through on failure, which
 * is the same shape writer/engine.js uses for text.
 */
export const VISION_PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    model: 'gemini-2.0-flash',
    /* Strongest of the free tiers at reading handwriting, and the most
       generous quota (~1500 requests/day). */
    build(key, model, dataUrl, prompt) {
      const [meta, b64] = dataUrl.split(',');
      const mime = /data:([^;]+)/.exec(meta)[1];
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 4096 }
          })
        }
      };
    },
    read(json) {
      const parts = json?.candidates?.[0]?.content?.parts;
      return parts ? parts.map(p => p.text || '').join('') : '';
    }
  },
  {
    id: 'github',
    label: 'GitHub Models',
    model: 'openai/gpt-4o-mini',
    build(key, model, dataUrl, prompt) {
      return {
        url: 'https://models.github.ai/inference/chat/completions',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [{
              role: 'user',
              content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }]
            }]
          })
        }
      };
    },
    read(json) { return json?.choices?.[0]?.message?.content || ''; }
  }
];

/**
 * The prompt.
 *
 * Line structure is not cosmetic here: alignment matches transcript line N
 * against detected ink line N, so a model that reflows or merges lines
 * silently destroys the mapping and every word gets skipped. Hence the
 * insistence on one output line per written line, and on no commentary — a
 * chatty "Here is the transcription:" preamble would become line 1.
 */
export const TRANSCRIBE_PROMPT = [
  'Transcribe the handwriting in this image exactly as written.',
  '',
  'Rules, all of them important:',
  '- Output ONE line of text for each line of writing, in order.',
  '- Do not merge lines, do not reflow, do not re-wrap.',
  '- Copy spelling and punctuation exactly, including mistakes.',
  '- If a word is illegible, write ??? in its place.',
  '- Output the transcription and nothing else: no preamble, no explanation,',
  '  no markdown fences, no line numbers.'
].join('\n');

/* ---------- image preparation ------------------------------------------ */

/**
 * Downscale and re-encode before sending.
 * A 12MP phone photo is several megabytes of upload on a connection that may
 * be a phone tethered in a hostel. Handwriting is legible to these models at
 * around 1600px on the long edge, and that is a tenth of the bytes.
 */
export async function prepareImage(source, { maxEdge = 1600, quality = 0.85 } = {}) {
  const bmp = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const cv = new OffscreenCanvas(w, h);
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality });
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('could not encode the image'));
    fr.readAsDataURL(blob);
  });
  return { dataUrl, width: w, height: h, bytes: blob.size };
}

/* ---------- the call ---------------------------------------------------- */

function cleanup(text) {
  return String(text)
    .replace(/^\s*```[a-z]*\s*/i, '')      // a fenced block slips through sometimes
    .replace(/```\s*$/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/^\s*\d+[.)]\s+/, '').trimEnd())   // stray line numbering
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function callWithTimeout(url, init, ms, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transcribe an image.
 *
 * `config` is `{ proxy }` for production, or `{ keys: { gemini, github } }`
 * for local development. Returns { text, provider, attempts } and throws only
 * when every provider has failed, with each failure named — "OCR failed" on
 * its own is useless when the cause is a quota reset four hours away.
 */
export async function transcribe(source, config = {}, opts = {}) {
  const { timeoutMs = 45000, signal, onProgress = () => {} } = opts;
  const prompt = opts.prompt || TRANSCRIBE_PROMPT;

  onProgress('preparing the image');
  const img = await prepareImage(source, opts);

  const attempts = [];

  /* Proxy path: the server holds the keys, owns the prompt, and picks the
     provider. Only the image is sent — deliberately. If the client could
     supply a prompt, the endpoint would be a free general-purpose vision
     model for anyone who found the URL, paid for out of your quota. The
     server ignores a prompt if one is sent; not sending one makes that
     contract visible from this side too. */
  if (config.proxy) {
    onProgress('sending to the server');
    const res = await callWithTimeout(config.proxy, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: img.dataUrl })
    }, timeoutMs, signal);

    let data = {};
    try { data = await res.json(); } catch (_) { /* fall through to the error below */ }
    if (!res.ok || data.error) {
      const detail = data.error || `HTTP ${res.status}`;
      if (res.status === 429) {
        throw new Error('Too many requests from this connection. Wait a minute and try again. (' + detail + ')');
      }
      throw new Error('The transcription service refused: ' + detail);
    }
    if (!data.text) throw new Error('The transcription service returned nothing.');
    return { text: cleanup(data.text), provider: data.provider || 'proxy', attempts };
  }

  /* Direct path: development only. */
  const keys = config.keys || {};
  const usable = VISION_PROVIDERS.filter(p => keys[p.id]);
  if (!usable.length) {
    throw new Error(
      'No transcription is configured. Either set a proxy endpoint, or add a key for ' +
      VISION_PROVIDERS.map(p => p.label).join(' or ') + ' for local testing.'
    );
  }
  console.warn(
    '[7Hand] Calling a vision provider directly from the browser. The API key is ' +
    'visible in page source and network requests. Fine on your own machine, never on a public page.'
  );

  for (const p of usable) {
    onProgress('reading with ' + p.label);
    try {
      const { url, init } = p.build(keys[p.id], config.model || p.model, img.dataUrl, prompt);
      const res = await callWithTimeout(url, init, timeoutMs, signal);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error?.message || `HTTP ${res.status}`;
        attempts.push({ provider: p.id, error: msg });
        continue;
      }
      const text = cleanup(p.read(json));
      if (!text) { attempts.push({ provider: p.id, error: 'empty response' }); continue; }
      return { text, provider: p.id, attempts };
    } catch (err) {
      attempts.push({ provider: p.id, error: err.name === 'AbortError' ? 'timed out' : err.message });
    }
  }

  throw new Error(
    'Every provider failed. ' +
    attempts.map(a => `${a.provider}: ${a.error}`).join('; ')
  );
}

/**
 * Reconcile a transcript against the number of ink lines that were detected.
 *
 * Alignment pairs transcript line N with ink line N, so a count mismatch
 * throws every later line out of step and the whole page yields nothing. A
 * mismatch is reported rather than papered over, because the user can fix it
 * in two seconds by looking at the page and the software cannot.
 */
export function checkLineCount(text, detectedLines) {
  const lines = text.split('\n').filter(l => l.trim().length);
  return {
    lines,
    ok: lines.length === detectedLines,
    got: lines.length,
    expected: detectedLines,
    hint: lines.length === detectedLines ? null
      : lines.length < detectedLines
        ? `The transcription has ${lines.length} lines but ${detectedLines} lines of writing were found. Some lines may have been merged — check for a blank line or a heading the model skipped.`
        : `The transcription has ${lines.length} lines but only ${detectedLines} lines of writing were found. A line may have been split, or the model added a heading of its own.`
  };
}
