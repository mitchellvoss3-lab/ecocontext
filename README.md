# EcoContext

**Smart context compilation for AI — small models, big results, less carbon.**

An open-source personal AI assistant that makes small, cheap models (like Claude Haiku) perform like large expensive ones (like Claude Sonnet) by compiling exactly the right context for each query. Better AI for everyone, at a fraction of the compute cost and carbon emissions.

## The Problem

Larger AI models are expensive and energy-intensive, but smaller models perform worse on complex tasks requiring context. Most people dump everything into prompts (resumes, docs, emails, projects) hoping the model can find what matters. Result: wasted tokens, wasted money, wasted carbon.

## The Insight

Research shows that **8,000 tokens of perfectly curated context outperforms 200,000 tokens of noisy context.** Models perform best when relevant information is at the beginning and end of the input (the "lost in the middle" problem). Smaller models with focused context produce less verbose, more precise responses.

**Context quality × relevance >> model size**

## How It Works

1. You type a message into a simple chat interface (like Claude.ai or ChatGPT)
2. The engine classifies your intent and retrieves only relevant context from your personal knowledge store
3. It compiles a precision prompt within a tight token budget
4. It routes to the cheapest model that can handle the complexity:
   - **Haiku** for most things (classification, summarization, simple Q&A)
   - **Sonnet** for complex reasoning (strategy, analysis, planning)
5. You get a great response
6. An unobtrusive indicator shows: tokens used, **tokens saved vs naive approach**, and **estimated CO₂e savings**

## The Math

Running Haiku with 2,000 tokens of EcoContext instead of Sonnet with 8,000 tokens of full dump:

| Metric | Naive (Sonnet + full) | EcoContext (Haiku + curated) | Savings |
|--------|----------------------|------------------------------------|---------|
| **Cost** | $0.024 | $0.00025 | **96x cheaper** |
| **Tokens** | 8,000 | 2,000 | **75% fewer** |
| **Energy** | 2.6 kWh | 0.2 kWh | **87% less** |
| **CO₂e** | 1.04g | 0.08g | **92% avoided** |

Over 1,000 queries:
- **$24 → $0.25** (saves $23.75)
- **~1,000g CO₂e** (equivalent to 2 miles of car emissions)

## Features

✅ **Works locally** — Your data stays on your machine. SQLite, no cloud.

✅ **Multi-provider** — Anthropic, OpenAI, Google Gemini, or local Ollama. Choose your own model.

✅ **Zero setup** — No Docker, no infrastructure. Copy the repo, run `npm start`, open browser.

✅ **Your knowledge** — Add people, projects, expertise, competitors. The engine uses this to compile context.

✅ **Transparent savings** — See tokens saved, cost saved, CO₂e avoided on every message.

✅ **Import/Export** — Backup your knowledge as JSON. Share, sync, or migrate easily.

✅ **Open source** — MIT license. Modify, distribute, learn.

## Zero-Context-First

EcoContext is powered by **[zero-context-first](https://github.com/mitchellvoss3-lab/zero-context-first)** — a standalone library that eliminates up to 89% of context tokens by proving most queries need no personal context at all. Instead of always injecting your full knowledge store, it classifies each query in under 0.01ms (zero LLM calls) and sends only what the model actually needs.

| Context level | % of queries | Avg tokens sent |
|---|---|---|
| Zero context | ~57% | ~20 |
| Micro context | ~10% | ~60 |
| Targeted context | ~33% | ~80 |
| **Naive (without ZCF)** | 100% | **265** |

→ [zero-context-first on GitHub](https://github.com/mitchellvoss3-lab/zero-context-first)

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- An LLM provider (Anthropic, OpenAI, Gemini) **or** [Ollama](https://ollama.com) (free, local)

### Installation

```bash
# Clone the repo
git clone https://github.com/mitchellvoss3-lab/ecocontext.git
cd ecocontext

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Running Locally

**Option 1: Using Ollama (free, no account needed)**

```bash
# Install Ollama from ollama.com
# Pull a small model
ollama pull llama3.2:3b

# Start Ollama in another terminal
ollama serve

# Back in ecocontext directory
npm run dev
# Opens http://localhost:3000
```

**Option 2: Using Anthropic (Claude)**

```bash
# Get an API key at console.anthropic.com/settings/keys
# Add to .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

npm run dev
# Opens http://localhost:3000
```

**Option 3: Using OpenAI**

```bash
# Get an API key at platform.openai.com/api-keys
echo "OPENAI_API_KEY=sk-..." >> .env

npm run dev
```

### Using ecocontext

1. On first visit, select your LLM provider and provide setup details (name, role, company)
2. Add knowledge: people, projects, expertise, competitors — whatever you want the AI to know about
3. Start chatting. Each message is classified, relevant context is compiled, and routed to the best model
4. Watch the savings grow

## Architecture

### Core Engine

- **Classifier** — Intent detection (domain + complexity) + entity matching
- **Compiler** — Context selection, ranking, assembly within token budget
- **Router** — Complexity → model routing (cheap vs capable)
- **Tracker** — Real-time savings calculation (CO₂e, cost, tokens)

### Knowledge Store

SQLite database with:
- **People** — Team members, stakeholders, anyone you interact with
- **Projects** — Active work, goals, initiatives
- **Expertise** — Your skills and specialties
- **Competitors** — Companies and products relevant to your strategy
- **Preferences** — User profile, communication style, token budgets

### Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: SQLite (zero infrastructure)
- **Frontend**: Vanilla HTML/CSS/JS (single file, no build step)
- **LLM Integration**: Anthropic SDK, OpenAI API, Google Generative AI, Ollama

## Building for Production

```bash
npm run build
npm start
# Runs on http://localhost:3000 (default)

# With environment variables
PORT=8080 npm start
```

## Developing

```bash
npm run dev
# Watches src/** for changes, restarts on save
```

## Testing

```bash
npm test
# Runs vitest suite
```

## Configuration

Edit `.env`:

```env
# Required for your chosen provider
ANTHROPIC_API_KEY=sk-ant-...
# OR
OPENAI_API_KEY=sk-...
# OR
GEMINI_API_KEY=...
# OR run Ollama locally (no key needed)

# Optional
PORT=3000
LLM_PROVIDER=anthropic  # Explicit provider selection
OLLAMA_BASE_URL=http://localhost:11434  # If using Ollama
```

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/chat` | Send message, get response + savings |
| GET | `/api/stats` | Cumulative savings metrics |
| GET/PUT/DELETE | `/api/knowledge/*` | Manage people, projects, expertise, competitors |
| GET/POST | `/api/onboarding` | Onboarding status and completion |
| GET | `/api/provider` | Active LLM provider and available models |

## FAQ

**Q: How accurate is the CO₂e calculation?**  
A: We use US grid average (400g CO₂e per kWh) and energy estimates from provider pricing models. It's approximate but directionally correct.

**Q: Can I use this offline?**  
A: Yes, with Ollama. No internet needed. (API-based providers require internet.)

**Q: Is my data private?**  
A: Completely. Everything runs locally. No telemetry, no cloud sync. Your knowledge is in a local SQLite file.

**Q: Can I use this with different providers for different queries?**  
A: Not yet, but planned. Currently you select one provider per session.

**Q: What models does each provider support?**

- **Anthropic**: Claude Haiku (cheap) → Claude Sonnet (capable)
- **OpenAI**: GPT-4o Mini (cheap) → GPT-4o (capable)
- **Google Gemini**: Gemini 2.0 Flash Lite (cheap) → Gemini 2.0 Flash (capable)
- **Ollama**: Llama 3.2 3B (cheap) → Llama 3.1 8B (capable)

## Contributing

Contributions are welcome! Areas we're looking for help:

- **Better context compilation** — Improve entity matching and relevance ranking
- **Additional providers** — Support for other LLM APIs
- **Testing** — End-to-end tests for the full pipeline
- **Documentation** — Improve docs, add examples, create tutorials
- **UI improvements** — Better knowledge management, conversation export, etc.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT. Use it, modify it, ship it.

## Why This Matters

Every query we run has a real cost: money out of pocket, energy from power plants, carbon in the atmosphere. With how often we'll interact with AI over the next decade, efficiency at scale matters.

ecocontext proves you don't need bigger models to get smarter responses. You need *better context*. This tool makes that accessible to everyone — builders, researchers, teams, individuals.

Less tokens. Less carbon. Less cost. Same (or better) results.

---

**Questions?** Open an issue. **Ideas?** Do a PR. **Want to chat?** Find me on Twitter/X or GitHub.

Built with ❤️ for everyone trying to use AI responsibly.
