# EcoContext Growth Sprint Prompt (Next-Week Adoption)

You are the lead engineer for EcoContext. Build and ship the following 3 improvements end-to-end with production quality, clean architecture, and measurable impact.

## Objective
Deliver a release that materially improves daily retention, trust, and shareability by implementing:
1. Conversation persistence + search
2. Prompt caching integration
3. A proof/benchmark panel that demonstrates compiled-context advantage

This must feel polished enough for real users next week.

## Product constraints
- Keep local-first behavior (SQLite, no mandatory cloud service).
- Preserve existing routing, context compiler, and sustainability metrics.
- Maintain fast UX and graceful fallback behavior.
- Avoid regressions in onboarding and chat flow.

## 1) Conversation persistence + search
### Requirements
- Persist conversations and messages in SQLite.
- Auto-create a conversation when user sends first message.
- Return and reuse conversation_id in API and UI.
- Show recent conversations in settings panel.
- Support search across message content.
- Allow loading previous conversation into chat view.

### API requirements
- `GET /api/conversations` (recent list)
- `GET /api/conversations/:id/messages` (full thread)
- `GET /api/conversations/search?q=...` (search results)

### UX requirements
- New chat action clears current thread and starts fresh.
- Selecting a conversation restores messages and assistant metadata.
- Search is low-latency and keyboard-friendly.

## 2) Prompt caching integration
### Requirements
- Integrate provider-aware caching where supported.
- Anthropic: use explicit/automatic cache control for stable prompt prefix.
- OpenAI: use prompt cache key/retention when supported, with safe fallback if unsupported.
- Surface cache telemetry in response metadata:
  - cache read tokens
  - cache write tokens
  - cache hit tokens (where provider supports)

### UX requirements
- Show concise cache signal in message meta when available (e.g., "cache hit: 1,920 tokens").
- Never fail request because caching features are unavailable.

## 3) Proof / benchmark panel
### Requirements
- Add endpoint to run side-by-side benchmark for one query:
  - Compiled mode (current pipeline)
  - Naive mode (capable model + full context dump)
- Measure and return:
  - latency
  - input tokens
  - output tokens
  - reduction percentage
  - model used per mode
- Return both outputs for qualitative comparison.

### UX requirements
- Add benchmark action in UI and a dedicated result panel.
- Keep benchmark optional and user-triggered (not default on every query).
- Present concise, visual comparison suitable for screenshots.

## Quality bar
- Strong typing and clear interfaces.
- Migration-safe DB updates.
- No duplicated logic where shared functions are possible.
- Handle all edge cases:
  - empty message
  - missing conversation
  - provider caching unsupported
  - benchmark errors
- Keep APIs backward-compatible where feasible.

## Validation checklist
- `npm run build` passes.
- Manual smoke test:
  - send chat, reload page, thread still available
  - search finds prior message
  - cache telemetry appears when provider supports it
  - benchmark returns both outputs and metrics

## Deliverables
- Updated backend routes and store functions
- Updated UI for conversations/search and benchmark panel
- Updated chat metadata for caching + conversation id
- Clean summary of what changed and why
