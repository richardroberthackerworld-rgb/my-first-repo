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

## 🔒 Hide your keys (do this before a public launch)

By default the app calls the AI providers straight from the browser, so anything in `config.js` is
visible in the page source. That's fine for personal use. For a **public site, use the built-in
proxy** — your keys then live only on the server and visitors can never read them:

1. **File Manager** → in the site folder, copy **`keys.example.php`** → **`keys.php`**
2. **Edit `keys.php`** → paste your API keys there (it also holds the allowed-origins list and the
   per-visitor hourly limit)
3. **Edit `config.js`** → set `proxy: "api.php"` and leave every key **empty**
4. Hard-refresh. Done — view source and you'll find no keys anywhere.

How it works: the browser posts to `api.php`, which adds the key server-side and returns the AI's
reply unchanged. `api.php` also:
- **rotates keys** when one hits its daily limit (put several in `keys.php` for more quota)
- **blocks other websites** from using your proxy (`allow_origins`)
- **rate-limits per visitor** (`rate_per_hour`, default 60) so nobody drains your quota
- **allow-lists models** so nobody can make it call something expensive

`.htaccess` blocks `keys.php` from ever being fetched over the web, and re-uploading the site zip
never overwrites it (the zip only ships `keys.example.php`). Requires PHP 7+ with cURL — standard
on every cPanel host.
### 💾 Answer cache (built in, on by default with the proxy)

Hundreds of students ask the same topics. The first one costs an AI call; **everyone after that is
served instantly from disk for free** — typically cutting API usage by **60–80%** once you have real
traffic, and making repeat questions feel instant.

- Controlled by `cache_hours` in `keys.php` (default `168` = 7 days; `0` disables)
- **Photo questions are never cached** — every photo is unique
- **Errors and empty replies are never cached** — only genuinely good answers
- Clicking **"More questions"** always generates fresh ones (it tells the AI what was already asked)
- Response header `X-7By-Cache: HIT|MISS` lets you confirm it's working
## 💳 Paywall — free tier, credits, ₹99/month

**Enforced on the server** (`billing.php`, called from `api.php`). The browser only holds an opaque
pass token — editing the page cannot grant anyone credits.

| Plan | Price | Credits |
|---|---|---|
| Free | ₹0 | **5 per day**, resets daily |
| Monthly | **₹99** | 500 credits / 30 days |
| 150 pack | ₹49 | 150 credits, valid 1 year |
| 50 pack | ₹20 | 50 credits, valid 1 year |

- **1 credit = 1 AI answer.** Cached answers (already asked by another student) are **free** — they
  cost you no quota, so they cost the student no credit.
- **Even paid plans use credits**, so one heavy user can never drain your API quota.
- **A failed AI call is refunded** — students are never charged for an error.
- **7Solve and 7Q bill separately** — a 7Q pass gives no credits on 7Solve.

### Switching it on
1. In  set  and your 7Pay credentials (see below).
2. Tune `'free_per_day'` and `'plans'` to taste. `'billing_off' => true` disables the paywall entirely.

### Wiring 7Pay (one-time)

1. **In 7Pay's **, add a merchant for each app:
\(7Solve →  = )

2. **In this app's ** set , , ,
    to match. That's it.

**The flow** (all automatic): student picks a plan → our server creates the 7Pay order
(the secret never reaches the browser) → 7Pay's checkout takes the money → 7Pay POSTs
 to our webhook → we issue the pass → 7Pay returns the student with
 → the page picks up the pass and the credits appear.

**Verified against a live 7Pay instance:** free tier blocks at the limit (402) → real ₹99
order created → real payment captured → webhook delivered (HTTP 200) → pass issued →
student unblocked → credits 500 → 497. Attacks all rejected: forged signature
(*Bad signature*), valid signature but underpaid (*Amount mismatch*), invented order
(*Unknown order*), webhook replay (*same token, no double credit*), attacker return URL
(*Bad return url*), another site using the proxy (*Origin not allowed*).
