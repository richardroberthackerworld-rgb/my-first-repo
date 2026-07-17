# 7Q 💯

Pick a subject & topic — or snap photos of your textbook / notes — and generate a full **question bank**: theory or practical, long answer, short answer, very short answer, MCQs, fill in the blanks, and true/false — with an optional answer key. The sister app of [7Solve](../doubtsnap/) (7Solve answers *your* questions; 7Q *asks you* questions).

## Features
- 📷 **Photo material** — upload up to **5 photos** of textbook pages or class notes (camera, gallery, drag & drop, paste Ctrl+V). Questions are generated **only from that material**. Handwritten and printed pages both work.
- ⌨️ **Or just type a topic** — e.g. "Photosynthesis", "Quadratic Equations", "Chapter 4 — The Mughal Empire". You can combine topic + photos.
- 📝 **6 question types, mix freely** — MCQ (4 options), Very Short (1–2 lines), Short (3–5 lines), Long Answer / Essay, Fill in the Blanks, True/False — each with its own count (1–25).
- 📐 **Theory or Practical** — choose Theory (definitions, explanations, distinctions), Practical (numericals, sums, worked problems — automatically uses the strongest reasoning models so the answer key is correct), or Mixed.
- 🎚️ **Difficulty** — Easy, Medium, Hard, or Mixed (easy → hard within each section).
- 🧠 **Hard mode = strongest AI** — Hard difficulty automatically routes through the most powerful free reasoning models: Gemini 2.5 Pro (~50 req/day free, also reads photos), then OpenRouter's free heavyweights (NVIDIA Nemotron 3 Ultra 555B, Tencent Hy3 295B, OpenAI gpt-oss-120b), falling back to the normal chain if they're busy.
- 🔑 **Answer key toggle** — generate with answers + explanations, but they stay hidden until you press "Show answer key". Practice first, check later.
- 🖨️ **Print / Save PDF** — prints only the question paper (clean, no site chrome). Answer key prints only if revealed.
- ➕ **More questions** — one click generates a fresh set on the same topic, telling the AI not to repeat questions it already asked.
- 🌐 **3 languages, fully translated UI + papers** — English, हिंदी, తెలుగు.
- 🎓 **Every level** — Class 1–10, Intermediate (MPC / BiPC / CEC / MEC / HEC), Degree & PG, CA / CMA (India) / US CMA / CS / ACCA / CFA, Jobs & competitive exams (UPSC, Groups, SSC, Banking, JEE/NEET…), Current Affairs & GK.
- 🤖 **Smart model routing** — auto-picks the best free AI model per subject and falls back if one is busy or rate-limited (same engine system as Doubt Snap).
- 🗂️ **My Paper Shelf** — last 20 generated papers saved on the device (localStorage).
- 📖 **Book theme** — same leather-and-paper look as Doubt Snap.

## Setup — add your free API keys

Open **`config.js`** and paste your free keys between the quotes. If you already set up Doubt Snap, **copy the same keys** — both apps share the same providers.

| # | Provider | Get a free key at | Key looks like | Best for |
|---|----------|-------------------|----------------|----------|
| 1 | **Google Gemini** | https://aistudio.google.com/apikey | `AIza…` | **Photos** (textbook pages, handwriting, Telugu/Hindi). ~1500/day. |
| 2 | **Groq** | https://console.groq.com/keys | `gsk_…` | Fastest text papers (Llama 3.3 70B). |
| 3 | **Cerebras** | https://cloud.cerebras.ai → API Keys | `csk-…` | Very fast, high daily volume. |
| 4 | **OpenRouter** | https://openrouter.ai/keys | `sk-or-…` | Coding subjects (Qwen3 Coder) + photo fallback (Gemma 4). |
| 5 | **Mistral** (optional) | https://console.mistral.ai/api-keys | — | Text + Pixtral vision; doesn't log prompts. |
| 6 | **GitHub Models** | https://github.com/settings/tokens | `ghp_…` / `github_pat_…` | **DeepSeek-R1** (~150/day) — best free CA/CMA numericals solver — plus GPT-4o (~50/day) and Phi-4-Reasoning. Free with any GitHub account. |

**Minimum recommended:** add **Gemini** (for photos) + **Groq** (for fast text).

Visitors see a site tagline in the top-right. **Owner view:** open the site with `?owner=1` (e.g. `https://qbank.7by.in/?owner=1`) to see the real engine status badge and which model generated each paper. All keys stay in `config.js` on your own site — the app calls the providers directly from the browser.

## How the app chooses a model (automatic)
- **Hard difficulty, or CA · CMA · Professional level (automatic)** → Gemini 2.5 Pro → DeepSeek-R1 + Phi-4-Reasoning (GitHub Models) → Nemotron 3 Ultra 555B → Hy3 295B → gpt-oss-120b → then the normal chain below
- **Maths / Accounts (reasoning)** also tries GPT-4o via GitHub Models right after Gemini.
- **Photos attached** → Gemini (best vision) → OpenRouter Gemma 4 → Mistral Pixtral
- **Coding / programming subjects** → OpenRouter Qwen3 Coder → Gemini → Groq → Cerebras
- **Maths / Physics / Accounts (reasoning)** → Gemini → Cerebras → Groq → OpenRouter
- **Current affairs / GK** → Gemini → OpenRouter → Groq
- **General / language subjects** → Gemini → Groq → Cerebras → OpenRouter

If the first choice is missing a key or hits its limit, it automatically tries the next one.

## Run
Static files — open `index.html` directly, or serve the folder:

```
npx serve qbank
```

No build step, no dependencies.

## Deploy — launch on `qbank.7by.in` (cPanel)

The homepage tool card and footer already link to `https://qbank.7by.in`, so going live is just:

1. cPanel → **Domains → Create A New Domain** → `qbank.7by.in`. Uncheck "share document root"; let it create `/home/USER/qbank.7by.in` as the document root.
2. **File Manager** → open that folder → upload **`qbank-site.zip`** (from the repo root) → **Extract**. The files must sit directly in the document root.
3. **Rename `config.js.txt` → `config.js`** (right-click → Rename), then **Edit** it and paste your API keys. *(The zip ships it as `.txt` because cPanel's virus scanner false-positives on any zip containing `.js` files — "Foxhole.JS_Zip". It's not a real virus.)*
4. cPanel → **SSL/TLS Status → Run AutoSSL** so `https://qbank.7by.in` is secure.
5. Also re-upload the updated main-site `index.html` (or `vocalremover-app.zip`) so the homepage 7Q card shows the new name.

Visit `https://qbank.7by.in` — the ⚙️ badge at the top-right should show your active engines. If it says "No AI key set", `config.js` on the server still has empty keys.

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
- **7Q and 7Solve bill separately** — a 7Q pass gives no credits on 7Solve.

### Switching it on
1. In `keys.php` set `'app' => '7q'` and your 7Pay credentials (see *Wiring 7Pay* below).
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

## 👤 Accounts — sign in / sign up

Without an account, credits live in **one browser**: pay on a phone and they are gone on the
laptop (or when the student clears their browser). With accounts on, **credits live on the
account** and follow the student everywhere.

Powered by your existing **account-hub** (account.7by.in) — one account works across 7Q, 7Solve
and every other 7By tool.

### Switching it on
1. In  set 2. In **account-hub/config.php** add this site to :
   , 3. Done. Leave  empty to switch accounts off (the sign-in button then hides itself).

### How it works
- Sign up (email + OTP), sign in, or Google — all handled by account-hub
- On login the hub returns an **API token**; the tool stores it and sends it as - The tool's **server** asks the hub for the balance and spends a credit — the browser can
  never fake it
- **Signed in** → the account's credits are used. **Signed out** → the per-device daily free tier
- A credit is spent **only after the AI actually answers** — a failed call costs nothing
- Buying requires signing in first, so credits attach to the person, not the browser
