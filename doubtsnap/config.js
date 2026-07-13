/* ============================================================
   DOUBT SNAP — API KEYS
   ------------------------------------------------------------
   Paste your FREE API keys between the quotes below.
   You do NOT need all of them — add the ones you have.
   Leave the others as "" (empty). The app auto-picks the best
   available model for each question and falls back if one is busy.

   WHERE TO GET EACH FREE KEY (no credit card needed):

   1) GOOGLE GEMINI   →  https://aistudio.google.com/apikey
        Best for PHOTOS (reads handwriting in English/Hindi/Telugu)
        and current affairs. ~1500 requests/day free. Key starts "AIza".
        Also unlocks Gemini 2.5 Pro (~50/day free) — the strongest free
        model, used when the 🧠 Deep Think toggle is on.

   2) GROQ            →  https://console.groq.com/keys
        Fastest text answers (Llama 3.3 70B). 30 req/min free.
        Key starts "gsk_".

   3) CEREBRAS        →  https://cloud.cerebras.ai   (Menu → API Keys)
        Very fast, high daily volume (Llama 3.3 70B). Key starts "csk-".

   4) OPENROUTER      →  https://openrouter.ai/keys
        Access to big free models incl. Qwen3 Coder (best for coding)
        and Gemma 4 (photo fallback). Key starts "sk-or-".

   5) MISTRAL         →  https://console.mistral.ai/api-keys
        Optional. Text + Pixtral vision. Doesn't log prompts.

   TIP: add Gemini (for photos) + Groq (for fast text) at minimum.
   You can add all 5 — the more you add, the fewer "limit reached" errors.
   ============================================================ */

window.DS_CONFIG = {
  keys: {
    gemini:     "",   // AIza...
    groq:       "",   // gsk_...
    cerebras:   "",   // csk-...
    openrouter: "",   // sk-or-...
    mistral:    ""    // ...
  }
};
