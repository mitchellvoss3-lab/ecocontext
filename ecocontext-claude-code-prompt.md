# EcoContext — Claude Code Build Prompt

## Copy everything below this line and paste it into Claude Code as your first message.

---

I want you to help me build an open-source project called **EcoContext**. This is a personal AI assistant interface that makes small/cheap AI models (like Haiku) perform like large expensive ones (like Opus) by compiling exactly the right context for each query. The result: better AI for everyone, at a fraction of the compute cost and carbon emissions.

## The Core Thesis

**Context quality × relevance > model size.** Research shows that 8,000 tokens of perfectly curated context outperforms 200,000 tokens of noisy context. Models perform best when relevant information is at the beginning or end of the input — the "lost in the middle" problem. Smaller models with focused context also produce less verbose, more precise responses.

This project proves it by building a usable tool, not just a research demo.

## What This Is (UX Vision)

This should feel **exactly like going to Claude.ai or ChatGPT** — a clean chat interface where you type a message and get a response. The difference is invisible to the user but transformative under the hood:

1. You type a message
2. The engine classifies your intent and retrieves only relevant context from your personal knowledge store
3. It compiles a precision prompt within a tight token budget
4. It routes to the cheapest model that can handle the complexity (Haiku for most things, Sonnet for complex reasoning)
5. You get a great response
6. A small, unobtrusive indicator shows: tokens used, tokens saved vs. naive approach, and estimated CO₂e savings

**It is NOT a developer tool.** It's not a dashboard with 6 panels. It's not a knowledge graph visualizer. It's a chat app that happens to be radically more efficient. Think iMessage simplicity, not Grafana complexity.

## Architecture

### Project Structure

```
ecocontext/
├── README.md                    # Project overview, thesis, quickstart
├── LICENSE                      # MIT
├── package.json                 # Node.js project
├── .env.example                 # ANTHROPIC_API_KEY placeholder
├── src/
│   ├── index.ts                 # Entry point — starts the web server
│   ├── server.ts                # Express/Fastify server serving the chat UI + API routes
│   ├── engine/
│   │   ├── classifier.ts        # Intent classification (domain, complexity, entity matching)
│   │   ├── compiler.ts          # Context compilation (retrieve, rank, assemble within token budget)
│   │   ├── router.ts            # Model routing (complexity → model selection)
│   │   └── tracker.ts           # CO₂e and token savings calculator
│   ├── store/
│   │   ├── knowledge.ts         # Knowledge store CRUD (SQLite-backed)
│   │   ├── schema.ts            # Entity types: Person, Project, Expertise, Competitor, Preference
│   │   └── seed.ts              # Optional seed data / onboarding wizard
│   ├── api/
│   │   ├── chat.ts              # POST /api/chat — main chat endpoint
│   │   ├── knowledge.ts         # CRUD endpoints for managing knowledge store
│   │   └── stats.ts             # GET /api/stats — cumulative savings
│   └── ui/
│       └── index.html           # Single-page chat interface (vanilla HTML/CSS/JS or lightweight framework)
├── data/
│   └── ecocontext.db     # SQLite database (created on first run)
├── docs/
│   ├── ARCHITECTURE.md          # Technical deep-dive
│   ├── HOW-IT-WORKS.md          # Non-technical explainer
│   └── CONTRIBUTING.md          # Contribution guide
└── tests/
    ├── classifier.test.ts
    ├── compiler.test.ts
    └── router.test.ts
```

### Key Design Decisions

- **SQLite, not Neo4j or Postgres.** Zero infrastructure. One file. Works on a Raspberry Pi. No Docker required.
- **Node.js/TypeScript.** Widest community, easiest to contribute to, npm ecosystem.
- **Single HTML file for UI.** No React build step. No webpack. Copy the repo, run `npm start`, open browser. The UI should be a single `index.html` that uses vanilla JS or Alpine.js at most.
- **Anthropic API.** Uses Claude models via the API. User provides their own API key.
- **No accounts, no cloud, no telemetry.** Everything runs locally. Your data stays on your machine.

## Module Specifications

### 1. Knowledge Store (`src/store/`)

SQLite database with these tables:

```sql
-- Core entities
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  relationship TEXT, -- manager, direct_report, peer, cross_functional, personal
  context TEXT,      -- free-text description of who they are and what they do
  last_referenced DATETIME,
  relevance_score REAL DEFAULT 1.0
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,       -- active, blocked, completed, exploration
  priority TEXT,     -- high, medium, low, personal
  description TEXT,
  keywords TEXT,     -- comma-separated for matching
  last_referenced DATETIME,
  relevance_score REAL DEFAULT 1.0
);

CREATE TABLE project_people (
  project_id TEXT REFERENCES projects(id),
  person_id TEXT REFERENCES people(id),
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE expertise (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  description TEXT
);

CREATE TABLE competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  context TEXT
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT -- user's name, communication style, role, company, etc.
);

-- Tracking
CREATE TABLE interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  query TEXT,
  intent_domain TEXT,
  intent_complexity TEXT,
  model_used TEXT,
  compiled_tokens INTEGER,
  naive_tokens INTEGER,
  response_tokens INTEGER,
  estimated_co2_saved_grams REAL,
  estimated_cost_saved_usd REAL
);
```

**Onboarding:** When you first run the app, it should ask a few simple questions to seed the store:
- What's your name?
- What's your role and company?
- What's your communication style preference? (direct, detailed, casual)

Then it should offer to import from a JSON file for power users, or let people add entities through the chat interface naturally ("Remember that Hossam is my direct report and manages Sales & Services Strategy").

### 2. Intent Classifier (`src/engine/classifier.ts`)

Takes a user message and returns:

```typescript
interface ClassifiedIntent {
  domain: 'work' | 'personal' | 'technical' | 'creative' | 'communication' | 'strategy' | 'general';
  complexity: 'low' | 'medium' | 'high';
  relevantEntityIds: string[];     // IDs from knowledge store
  mentionedPeople: string[];       // Person IDs detected in message
  suggestedModel: string;          // claude-haiku-4-5-20251001 or claude-sonnet-4-20250514
  confidenceScore: number;         // 0-1
}
```

**Classification logic (rule-based first, LLM-upgrade later):**

- Scan message for entity name matches (people, projects, competitors)
- Scan for domain keywords (carbon, ghg, scope → climate; capacity, openair → operations)
- Assess complexity: simple factual questions → low; multi-step reasoning, strategy → high
- Model routing: low/medium complexity → Haiku; high complexity → Sonnet

### 3. Context Compiler (`src/engine/compiler.ts`)

The heart of the system. Takes classified intent + knowledge store and produces a precision prompt.

```typescript
interface CompiledContext {
  systemPrompt: string;          // The assembled context
  sections: ContextSection[];    // What was included and why
  totalTokens: number;
  tokenBudget: number;
  utilizationPct: number;
}

interface ContextSection {
  label: string;                 // "Identity", "Project: Delivery Control Tower", etc.
  content: string;
  tokens: number;
  relevanceScore: number;
}
```

**Compilation algorithm:**

1. Always include user identity (name, role, company, style) — ~50 tokens, highest priority
2. Add directly referenced entities (people/projects mentioned by name) — high priority
3. Add entities connected to referenced entities (e.g., if Cigna project mentioned, also pull in Mara and Jasmine) — medium priority
4. Add domain expertise if the domain matches — medium priority
5. Add competitor context if strategy domain — lower priority
6. Stop when token budget is reached

**Token budget should default to 2,000 for Haiku, 4,000 for Sonnet.** Configurable.

### 4. Model Router (`src/engine/router.ts`)

Simple routing table:

| Complexity | Context Quality | Model |
|-----------|----------------|-------|
| Low | Any | Haiku |
| Medium | Good match | Haiku |
| Medium | Poor match | Sonnet |
| High | Any | Sonnet |

"Good match" = classifier found relevant entities with confidence > 0.7.

### 5. CO₂ Tracker (`src/engine/tracker.ts`)

Estimates savings per interaction and tracks cumulative totals.

```typescript
interface SavingsEstimate {
  compiledTokens: number;
  naiveTokens: number;          // What it would have been with full context dump
  tokensSaved: number;
  reductionPct: number;
  estimatedCo2SavedGrams: number;
  estimatedCostSavedUsd: number;
  cumulativeCo2SavedGrams: number;  // Lifetime total from SQLite
  cumulativeCostSavedUsd: number;
}
```

**Estimation methodology (rough but directionally correct):**
- Haiku: ~0.0001 kWh per 1k tokens
- Sonnet: ~0.001 kWh per 1k tokens
- US grid average: ~400g CO₂/kWh
- Naive baseline assumes Sonnet with full context dump every time
- Cost uses published Anthropic API pricing

### 6. Chat UI (`src/ui/index.html`)

**Design principles:**
- Clean, minimal chat interface. Dark mode default.
- Message input at bottom, responses above.
- Each response has a tiny, unobtrusive footer: "Haiku · 847 tokens · saved 1,243 tokens · ~0.02g CO₂e"
- Settings panel (gear icon) to manage knowledge store, view cumulative stats, adjust token budget
- Knowledge store management: add/edit/remove people, projects, etc.
- Import/export knowledge as JSON

**Tech: Single HTML file.** Use vanilla JS or Alpine.js. No build step. Include Tailwind via CDN if needed for styling. The entire UI should be one file that the Express server serves.

## README.md Content

The README should include:

1. **Hero section** with the core thesis and a screenshot/GIF of the chat interface
2. **Why this exists** — the problem with current AI assistants (context is dumb, models are expensive, energy is wasted)
3. **How it works** — 4-step diagram (classify → retrieve → compile → route)
4. **Quickstart** — 3 commands max: clone, `npm install`, `npm start`
5. **The numbers** — estimated token/cost/CO₂ savings with example queries
6. **Comparison** with related projects (Zep/Graphiti, Cognee, OpenClaw, Leon) and how this is different (consumer-first, small-model-first, zero-infrastructure)
7. **Contributing** — how to add features, report bugs, improve the classifier
8. **License** — MIT

## What to Build First

Build in this order:
1. Knowledge store (SQLite + CRUD)
2. Classifier + Compiler (the core engine)
3. Chat API endpoint (POST /api/chat)
4. Chat UI (the single HTML file)
5. CO₂ tracker + savings display
6. Onboarding flow
7. Knowledge management UI
8. Tests
9. README + docs

## Important Notes

- The name is **ecocontext**. The repo will be github.com/[username]/ecocontext.
- The tagline is: "Smart context compilation for AI — small models, big results, less carbon."
- The license is MIT.
- There should be NO telemetry, NO analytics, NO cloud dependencies. Everything local.
- The `.env.example` should only need `ANTHROPIC_API_KEY=your-key-here`.
- It should work with `node >= 18` and have zero native dependencies (no Python, no Docker, no Neo4j).
- Keep the total codebase small and readable. This should be something a developer can understand in 30 minutes.

Please start by setting up the project structure, package.json, and then build the knowledge store and core engine modules. We'll iterate on the UI after the engine works.
