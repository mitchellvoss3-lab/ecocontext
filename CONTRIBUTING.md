# Contributing to EcoContext

Thanks for your interest in EcoContext! We welcome contributions from everyone — whether you're fixing a bug, adding a feature, improving docs, or spreading the word.

## Getting Started

1. **Fork the repo** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/yourusername/ecocontext.git
   cd ecocontext
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Start dev server**:
   ```bash
   npm run dev
   # Watches src/ for changes, auto-restarts
   # Opens http://localhost:3000
   ```

## What We Need Help With

### High Priority

- **Better context compilation**: Improve the classifier and compiler to be smarter about entity matching, relevance ranking, and context assembly
- **UI enhancements**: Settings panel polish, knowledge management UX, conversation export/search
- **Testing**: Add comprehensive tests for the pipeline (classifier → compiler → router → LLM)
- **Documentation**: Expand docs, add architecture deep-dive, create tutorials

### Medium Priority

- **Additional providers**: Support for other LLM services (Claude.ai API, Cohere, local vLLM, etc.)
- **Advanced features**: Multi-turn conversation optimization, conversation branching, A/B testing different prompts
- **Performance**: Token counting optimization, caching layer for repeated queries
- **Observability**: Better logging, metrics, debugging tools

### Nice to Have

- **Mobile app**: React Native app that syncs with the local store
- **Browser extension**: Right-click context sharing to the AI
- **Integrations**: Slack, Discord, Email plugins
- **Visualization**: Knowledge graph visualization, interaction history analysis

## Development Workflow

### Code Style

- **TypeScript strict mode** — All code is type-safe
- **Minimal dependencies** — Prefer built-in APIs; only add deps if necessary
- **Comments for non-obvious logic** — Clear code is better than clever code
- **Functional over OOP** — Keep modules small and composable

### File Structure

```
src/
├── index.ts              # Entry point
├── server.ts             # Express setup
├── api/
│   ├── chat.ts           # Main chat endpoint
│   ├── knowledge.ts      # CRUD for entities
│   └── stats.ts          # Metrics endpoint
├── engine/
│   ├── classifier.ts     # Intent detection & entity matching
│   ├── compiler.ts       # Context assembly
│   ├── router.ts         # Model routing
│   ├── tracker.ts        # Savings calculation
│   └── provider.ts       # LLM provider abstraction
├── store/
│   ├── knowledge.ts      # SQLite CRUD operations
│   ├── schema.ts         # TypeScript types
│   └── seed.ts           # Onboarding logic
└── ui/
    └── index.html        # Single-file SPA
```

### Making Changes

1. **Edit TypeScript files** in `src/`
2. **Run build** to compile: `npm run build`
3. **Run dev server** for testing: `npm run dev`
4. **Test manually** at http://localhost:3000
5. **Add tests** in `tests/` (using Vitest)

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Single file
npm test -- classifier.test.ts
```

Write tests for:
- **Classifier**: Domain detection, complexity scoring, entity matching
- **Compiler**: Context assembly, token budgeting, section prioritization
- **Router**: Complexity-to-model mapping
- **Tracker**: Savings calculations

## Submitting Changes

1. **Commit with clear messages**:
   ```bash
   git commit -m "Improve entity matching in classifier"
   ```
2. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
3. **Open a Pull Request** on GitHub with:
   - Clear description of what changed and why
   - Link to any relevant issues
   - Screenshots if UI changed
4. **Respond to review feedback** — we'll iterate together

## PR Checklist

Before submitting, make sure:

- [ ] Code compiles (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] Linting passes (we use TypeScript strict mode)
- [ ] No console errors in the browser
- [ ] Commit messages are clear
- [ ] Related issues/PRs are linked
- [ ] Changes are documented in comments
- [ ] New dependencies are justified

## Asking Questions

- **GitHub Issues**: For bugs, feature requests, or design questions
- **Discussions**: For general ideas and brainstorming (to be enabled)
- **Pull Request Comments**: For code review feedback

## Code of Conduct

- Be respectful and inclusive
- Give credit for ideas
- Disagree constructively
- Focus on the work, not the person

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thanks for helping make ecocontext better! 🌱
