# 7Solve ✅ (formerly Doubt Snap)

Snap a photo of any doubt (or type it) and get the exact answer with a step-by-step explanation — like a good teacher writing in your notebook.

## Features
- 📷 **Photo doubts** — camera capture (mobile), gallery upload, drag & drop, and paste (Ctrl+V). Reads handwritten and printed questions.
- ⌨️ **Typed doubts** — or combine a photo + typed instructions.
- 🌐 **3 languages, fully translated UI + answers** — English, हिंदी, తెలుగు.
- 🎓 **Every level** — Class 1–10, Intermediate (MPC / BiPC / CEC / MEC / HEC), Degree & PG (B.Sc, B.Com, B.Tech, MBBS, MBA…), CA / CMA (India) / US CMA / CS / ACCA / CFA, Jobs & competitive exams (UPSC, Groups, SSC, Banking, JEE/NEET…), Current Affairs & GK.
- 🤖 **Smart model routing** — the app automatically picks the best free AI model for each question (see below) and falls back to another if one is busy or rate-limited.
- 🧠 **Automatic Deep Think** — the app reads your question and picks the right AI tier by itself (a live pill under the Solve button shows which): ⚡ simple definition-type doubts go to the fastest models (instant answers, saves the big-model quotas), 📖 normal doubts use the standard smart chain, and 🧠 big problems (calculations, proofs, multi-part numericals, anything at CA · CMA · Professional level) go to the strongest free reasoning models first — Gemini 2.5 Pro, DeepSeek-R1, Phi-4-Reasoning, Nemotron 3 Ultra 555B, Hy3 295B, gpt-oss-120b — with automatic fallback down the chain.
- ✅ **Answer format** — exact answer first, then step-by-step explanation at the student's level, then **"✏️ Draw this diagram"** instructions when a figure helps, then a memory tip. Each answer shows which model solved it.
- 📓 **My Notebook** — last 20 solved doubts saved on the device (localStorage).
- 📖 **Book theme** — leather cover, paper pages, ruled answer sheet, chapter headings.

## Setup — add your free API keys (no "set key" button; you configure once)

Open **`config.js`** and paste your free keys between the quotes. Add as many as you like — you don't need all of them, but the more you add, the fewer "limit reached" errors.

| # | Provider | Get a free key at | Key looks like | Best for |
|---|----------|-------------------|----------------|----------|
| 1 | **Google Gemini** | https://aistudio.google.com/apikey | `AIza…` | **Photos** (handwriting, Telugu/Hindi) + current affairs. ~1500/day. |
| 2 | **Groq** | https://console.groq.com/keys | `gsk_…` | Fastest text answers (Llama 3.3 70B). |
| 3 | **Cerebras** | https://cloud.cerebras.ai → API Keys | `csk-…` | Very fast, high daily volume. |
| 4 | **OpenRouter** | https://openrouter.ai/keys | `sk-or-…` | Coding (Qwen3 Coder) + photo fallback (Gemma 4). |
| 5 | **Mistral** (optional) | https://console.mistral.ai/api-keys | — | Text + Pixtral vision; doesn't log prompts. |
| 6 | **GitHub Models** | https://github.com/settings/tokens | `ghp_…` / `github_pat_…` | **DeepSeek-R1** (~150/day) — best free CA/CMA numericals solver — plus GPT-4o (~50/day) and Phi-4-Reasoning. Free with any GitHub account. |

**Minimum recommended:** add **Gemini** (for photos) + **Groq** (for fast text).

Visitors see a site tagline in the top-right. **Owner view:** open the site with `?owner=1` to see the real engine status badge and which model answered each doubt. All keys stay in `config.js` on your own site — the app calls the providers directly from the browser.

## How the app chooses a model (fully automatic)
- **🧠 Big question detected** (calculations, proofs, multi-part numericals, journal entries, or CA · CMA · Professional level) → Gemini 2.5 Pro → DeepSeek-R1 + Phi-4-Reasoning (GitHub Models) → Nemotron 3 Ultra 555B → Hy3 295B → gpt-oss-120b → then the normal chain below
- **⚡ Simple question detected** ("what is…", "define…", short one-liners) → Groq → Cerebras → Gemini Flash — instant answers that don't burn the big-model daily quotas
- **Maths / Accounts (reasoning)** also tries GPT-4o via GitHub Models right after Gemini.
- **Photo attached** → Gemini (best vision) → OpenRouter Gemma 4 → Mistral Pixtral
- **Coding / programming** → OpenRouter Qwen3 Coder → Gemini → Groq → Cerebras
- **Maths / Physics / Accounts (reasoning)** → Gemini → Cerebras → Groq → OpenRouter
- **Current affairs / GK** → Gemini → OpenRouter → Groq
- **General / language / essays** → Gemini → Groq → Cerebras → OpenRouter

If the first choice is missing a key or hits its limit, it automatically tries the next one.

## Run
Static files — open `index.html` directly, or serve the folder:

```
npx serve doubtsnap
```

No build step, no dependencies.

## ⚠️ Note on key privacy
Because this is a static site, any key you put in `config.js` is visible to anyone who can open the page's source. That's fine for personal use or a private/local deployment. If you ever put this on a **public** website, move the keys behind a tiny backend proxy so visitors can't read them — ask and I can add one.
