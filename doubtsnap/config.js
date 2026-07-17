/* ============================================================
   7SOLVE — API KEYS
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
        model, used automatically when a big/complex question is detected.

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

   6) GITHUB MODELS   →  https://github.com/settings/tokens
        FREE with any GitHub account — no card. Generate a token
        (fine-grained with "Models: read" permission, or classic).
        Unlocks DeepSeek-R1 (~150/day, the best free model for CA/CMA
        numericals & step-by-step maths), GPT-4o (~50/day) and
        Phi-4-Reasoning. Token starts "ghp_" or "github_pat_".

   TIP: add Gemini (for photos) + Groq (for fast text) at minimum.
   You can add all 5 — the more you add, the fewer "limit reached" errors.
   ============================================================ */

/* MORE FREE QUOTA — use SEVERAL keys per provider.
   Any slot below accepts one key, OR a list. When a key hits its daily
   limit the app automatically rotates to the next one. Examples:
     gemini: ["AIza...key1", "AIza...key2", "AIza...key3"],
     gemini: "AIza...key1, AIza...key2",
   Tip: each Google Cloud project you own can have its own key. */

window.DS_CONFIG = {

  /* ---- RECOMMENDED FOR A PUBLIC SITE: hide your keys on the server ----
     Anything in THIS file is visible to anyone who views the page source.
     To keep keys private instead:
       1. copy keys.example.php → keys.php and put your keys there
       2. set   proxy: "api.php"   below
       3. leave every key below EMPTY
     The browser then calls api.php, and api.php calls the AI with the
     server-side keys. Nobody can read them.
     Leave proxy as "" to keep using the keys below directly (fine for
     local/personal use).                                              */
  proxy: "",

  keys: {
    gemini:     "",   // AIza...
    groq:       "",   // gsk_...
    cerebras:   "",   // csk-...
    openrouter: "",   // sk-or-...
    mistral:    "",   // ...
    github:     ""    // ghp_... or github_pat_...  (GitHub Models — DeepSeek-R1 / GPT-4o)
  }
};
