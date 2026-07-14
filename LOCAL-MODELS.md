# Local AI Models — Honest Guide (small downloads vs. CA/CMA-grade reasoning)

You asked: *"can I download a free model locally, around 200–250 MB, that solves complex CA / CMA / US CMA questions?"*

**Short honest answer: no.** Models that small exist and are genuinely useful for some things, but complex professional numericals (costing sums, tax computations, financial-management workings) need step-by-step reasoning that only much larger models can do. Here's the full picture so you can pick the right tool for each job.

---

## What actually fits in 200–250 MB

These are real, free, downloadable models (GGUF format, run with Ollama / llama.cpp / LM Studio):

| Model | Download size | Get it | What it's honestly good for |
|---|---|---|---|
| **Gemma 3 270M** (Google) | ~200–290 MB | `ollama run gemma3:270m` | Flashcard-style Q&A, definitions, grammar, simple summaries. Surprisingly coherent for its size. |
| **SmolLM2-360M-Instruct** (Hugging Face) | ~220–280 MB (Q4/Q5) | Hugging Face GGUF → llama.cpp / LM Studio | Short answers, vocabulary, basic explanations. |
| **Qwen2.5-0.5B-Instruct** | ~250–350 MB (Q3/Q4) | `ollama run qwen2.5:0.5b` | Slightly better at simple arithmetic and formatting than the two above. |

**What these CAN do for a CA/CMA student:** offline definition lookups ("what is contribution margin?"), theory one-liners, flashcard drills, English grammar — with no internet and total privacy.

**What these CANNOT do:** multi-step numericals, tax slabs, standard-costing variances, journal-entry chains, anything where one wrong intermediate step ruins the answer. At this size they *will* confidently produce wrong workings — dangerous for exam prep.

## The smallest sizes where real reasoning starts

If you want *local* solving that's actually usable for professional-course problems, the honest floor is ~2.5 GB:

| Model | Download size | Get it | Notes |
|---|---|---|---|
| **Phi-4-mini-reasoning** (Microsoft, 3.8B) | ~2.3–2.6 GB (Q4) | `ollama run phi4-mini-reasoning` | Best small reasoning model of its class; trained specifically for multi-step math. Runs on any 8 GB-RAM laptop, CPU-only is fine (slow but works). |
| **Qwen3 4B** | ~2.5 GB (Q4) | `ollama run qwen3:4b` | Strong all-rounder with a thinking mode. |
| **Phi-4-mini** (3.8B) | ~2.5 GB (Q4) | `ollama run phi4-mini` | Top ARC-C score in its size class; good knowledge Q&A. |

Even these are *below* the free cloud models in accuracy — they're the "offline emergency" tier, not the primary tool.

## How to run any of them (free, 5 minutes)

1. Install **Ollama** (free, open source — github.com/ollama/ollama) → `winget install Ollama.Ollama`
2. `ollama run gemma3:270m` (tiny) or `ollama run phi4-mini-reasoning` (real reasoning)
3. Chat in the terminal, or point any OpenAI-compatible app at `http://localhost:11434/v1`.

Alternatives: **LM Studio** (GUI, easiest), **llama.cpp** (github.com/ggml-org/llama.cpp) with GGUF files from Hugging Face.

## The right tool for CA / CMA / US CMA questions

For exam-grade accuracy, the free **cloud** reasoning chain in DoubtSnap and QBank beats anything that fits on disk under ~10 GB, and it costs nothing:

1. **DeepSeek-R1** via GitHub Models — ~150 requests/day free with just a GitHub token; purpose-built for step-by-step numericals. Both apps now use it automatically for the CA · CMA · Professional level.
2. **Gemini 2.5 Pro** — ~50/day free, also reads photos of the question.
3. **Nemotron 3 Ultra 555B / Hy3 295B / gpt-oss-120b** — free on OpenRouter, automatic fallbacks.

**Recommended setup:** use DoubtSnap/QBank (free APIs) for real problem-solving, and optionally keep `phi4-mini-reasoning` installed for offline practice when you have no internet. Skip the sub-250 MB tier for professional courses — it will mislead you.
