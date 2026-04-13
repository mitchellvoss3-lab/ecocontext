# EcoContext Autolearn v1 Spec

## Goal
Build an autolearn system that improves answer quality per token over time so lightweight models feel materially stronger without blindly increasing context size.

North-star optimization target:
- Maximize: user-rated quality
- Minimize: input tokens, latency, and unnecessary model escalation

Primary objective function (tracked, not directly trained):
- Quality-per-token index (QPTI) = quality_score / input_tokens

## Product Promise
Autolearn must do five things reliably:
1. Learn what to remember from conversations.
2. Learn what to retrieve for each query.
3. Learn what to compress and at what abstraction level.
4. Learn when to use cheap model vs capable model.
5. Prove improvements with eval gates before policy promotion.

## Non-goals (v1)
- End-to-end finetuning.
- Heavy external infra (no mandatory vector DB/cloud service).
- Full autonomous memory writes with no review controls.

## High-Level Architecture
Autolearn v1 has six layers:
1. Episodic Layer: raw conversation messages.
2. Distilled Facts Layer: extracted durable facts from conversations.
3. Hierarchical Summaries Layer: topic and conversation summaries (short/medium/long).
4. Retrieval Gate Layer: chooses candidate context and scores quality.
5. Packaging Layer: enforces strict token budgets per context slice.
6. Policy Layer: updates retrieval/routing parameters from outcome signals.

Flow per request:
1. Ingest query + recent turns.
2. Retrieve candidates from facts + summaries + explicit knowledge store.
3. Run retrieval quality gate (cheap pass).
4. If low confidence, corrective action (broaden retrieval or move to higher abstraction, then optional model escalation).
5. Build final context package under budget.
6. Generate response.
7. Log outcomes and update policy stats.

## Data Model Additions (SQLite)
Add tables in local DB:

### 1) memory_facts
- id TEXT PK
- subject TEXT NOT NULL
- predicate TEXT NOT NULL
- object TEXT NOT NULL
- source_conversation_id TEXT
- source_message_ids TEXT (JSON)
- confidence REAL DEFAULT 0
- novelty_score REAL DEFAULT 0
- utility_score REAL DEFAULT 0
- contradiction_state TEXT DEFAULT 'none'  -- none|candidate|confirmed
- first_seen_at DATETIME
- last_seen_at DATETIME
- superseded_by TEXT NULL

### 2) memory_summaries
- id TEXT PK
- scope_type TEXT NOT NULL   -- conversation|topic|global
- scope_key TEXT NOT NULL
- level INTEGER NOT NULL     -- 1=brief, 2=expanded, 3=deep
- summary_text TEXT NOT NULL
- token_estimate INTEGER NOT NULL
- source_span_json TEXT
- quality_score REAL DEFAULT 0
- updated_at DATETIME

### 3) retrieval_events
- id INTEGER PK AUTOINCREMENT
- timestamp DATETIME
- query TEXT
- domain TEXT
- complexity TEXT
- candidate_count INTEGER
- selected_count INTEGER
- selected_token_estimate INTEGER
- gate_confidence REAL
- corrective_action TEXT      -- none|broaden|abstract_up|escalate
- model_tier TEXT             -- cheap|capable
- interaction_id INTEGER

### 4) policy_state
- key TEXT PK
- value_json TEXT NOT NULL
- updated_at DATETIME

### 5) eval_runs
- id INTEGER PK AUTOINCREMENT
- run_name TEXT
- timestamp DATETIME
- dataset_tag TEXT
- config_json TEXT
- metrics_json TEXT
- pass BOOLEAN

## Write Gating (Memory Distillation)
Introduce a distillation worker that runs after assistant response.

Inputs:
- current user turn
- assistant turn
- conversation window (recent N turns)

Outputs:
- candidate facts + confidence
- candidate summary updates

Write policy:
- Write fact only if:
  - confidence >= min_confidence
  - novelty_score >= min_novelty
  - not contradicted by stronger existing fact
- Promote utility_score when reused successfully.
- Decay utility_score over time if not retrieved.
- Keep low-confidence candidates in pending state, not active retrieval.

Default thresholds (v1):
- min_confidence: 0.72
- min_novelty: 0.35
- max_new_facts_per_interaction: 5

## Retrieval Gate (Corrective Pattern)
Before final generation:
1. Retrieve top-k candidates from:
- explicit knowledge entities
- memory_facts
- memory_summaries (L1 first)

2. Score candidate set quality with cheap evaluator:
- coverage score
- contradiction risk
- relevance concentration
- expected token efficiency

3. If gate_confidence below threshold:
- first corrective action: broaden candidate pool
- second corrective action: move to higher-level summary (L2/L3)
- third corrective action: escalate to capable model

v1 thresholds:
- gate_confidence_low: 0.58
- escalation_trigger: two consecutive low-confidence corrective passes OR high complexity + low confidence

## Context Packaging Budgets
Hard budget slices by tier:

Cheap tier (example 2000 tokens):
- system + identity: 250
- distilled facts: 500
- summaries: 500
- direct entity snippets: 500
- recent turns: 250

Capable tier (example 4000 tokens):
- system + identity: 350
- distilled facts: 900
- summaries: 1100
- direct entity snippets: 1200
- recent turns: 450

Policy:
- Always include highest utility + recency blend first.
- Drop lowest utility slices before truncating high-signal facts.

## Adaptive Policy Learning
Autolearn policy updates after each interaction using logged outcomes.

Signals:
- explicit feedback rating and reason
- token usage
- latency
- escalation outcome
- benchmark deltas

Update knobs:
- retrieval depth per (domain, complexity)
- summary level preference
- cheap/capable routing boundary
- budget slice allocations

Mechanism:
- Contextual bandit style online updates over parameter sets.
- Keep shadow policy and champion policy.
- Promote only when eval gate passes.

## API Additions
### Chat Metadata (extend)
Return in chat meta:
- retrievalGate: { confidence, correctiveAction, candidateCount, selectedCount }
- memoryUsage: { factsUsed, summariesUsed, estimatedTokens }
- policyVersion

### New endpoints
- POST /api/autolearn/distill-now
  - Force-run distillation for current conversation.
- GET /api/autolearn/state
  - Current thresholds and policy version.
- GET /api/autolearn/metrics
  - QPTI, escalation rate, retrieval gate stats.
- POST /api/autolearn/evals/run
  - Run benchmark set and return pass/fail.
- POST /api/autolearn/policy/promote
  - Promote shadow policy if latest eval passed.

## Compiler Integration Plan
Update compile pipeline to include memory sources:
1. Existing entity-based compilation remains.
2. Insert memory retrieval stage between intent classification and section assembly.
3. Add section types:
- Memory Fact
- Memory Summary
4. Keep transparency panel showing each memory section with utility score and provenance count.

## Prompt Caching and Compaction Strategy
1. Cache stable prefix aggressively:
- system instructions
- durable summaries
- high-stability fact bundles

2. Keep variable suffix minimal:
- latest user message
- tiny recent-turn window

3. Track and optimize:
- cache_read_input_tokens
- cache_write_input_tokens
- cachedPromptTokens

4. Add compaction policy for long conversations:
- replace old turn blocks with compact summary blocks once threshold exceeded
- preserve citation/provenance pointers where possible

## Eval Harness (Release Gate)
Autolearn changes are feature-flagged and must pass evals.

Dataset composition:
- 40-80 real query templates from this product's domains
- mixture of low/medium/high complexity
- at least 25 percent multi-step and follow-up queries

Required metrics:
- Quality win-rate vs current baseline
- Input token delta
- Latency delta
- Escalation rate delta
- Hallucination proxy (judge + evidence presence)

Promotion gate (minimum):
- quality_win_rate >= +5%
- input_tokens <= -20% on cheap tier median
- no >2% regression on high-complexity quality
- no >10% latency regression median

## Rollout Plan
Phase 0: Instrumentation only
- add tables, logging, and metrics views

Phase 1: Distillation + passive retrieval
- write-gated facts and summaries
- no routing policy changes yet

Phase 2: Corrective retrieval gate
- enable corrective actions
- keep manual routing override intact

Phase 3: Policy adaptation
- shadow policy learning
- eval-gated promotion

Phase 4: Default-on for cheap tier paths
- guarded rollout with rollback toggle

## Flags and Safety
Feature flags:
- AUTOLEARN_ENABLED
- AUTOLEARN_WRITE_ENABLED
- AUTOLEARN_GATE_ENABLED
- AUTOLEARN_POLICY_ENABLED

Safety rules:
- never delete source conversations
- preserve provenance for all distilled memory
- block automatic overwrite on contradictions (flag first)
- provide user-facing memory controls (inspect, disable, clear)

## UI Requirements (v1)
1. Memory Inspector panel:
- facts used
- summaries used
- corrective action taken

2. Policy and quality panel:
- current policy version
- QPTI trend
- escalation rate
- top negative feedback reasons

3. Controls:
- pause autolearn
- clear distilled memory
- run eval now

## Definition of Done
Autolearn v1 is done when:
1. Distilled memory is persisted locally with provenance.
2. Compiler consumes memory facts/summaries under strict budgets.
3. Retrieval gate and corrective actions are live.
4. Policy state updates from feedback and metrics.
5. Eval harness enforces promotion gates.
6. UI exposes memory use and policy status transparently.

## Why this should work
- Keeps humans in control while reducing maintenance overhead.
- Uses cheap models for most gating/scoring operations.
- Reduces repeated rediscovery costs by compiling durable memory.
- Prevents drift with contradiction handling and eval-gated policy changes.
- Directly optimizes for the core product objective: better quality from fewer tokens.
