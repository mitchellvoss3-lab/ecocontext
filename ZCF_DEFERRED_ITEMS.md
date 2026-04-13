# ZCF Deferred Items

These are queued after core chat-pipeline integration.

1. Learning From Corrections
- DONE: Persist verifier-triggered correction events (with context tier, retry signal, and corrective token count)
- DONE: Auto-tune classifier overrides from real usage via learned `zcf_force_nonzero_terms`
- DONE: Lightweight correction feedback loop updates learned terms after corrective retries

2. CLI Benchmarking Tool
- Add `zcf-bench` CLI that accepts exported chat logs
- Report zero/micro/targeted distribution and token savings
- Include side-by-side naive vs ZCF metrics per query batch

3. Real Token Telemetry
- Track provider-reported prompt/completion tokens in production
- Compare estimated vs actual token savings
- Surface measured savings in dashboard and benchmark panel

4. Python Port
- Port classifier/compressor/verifier pipeline to Python
- Keep format and behavior parity with TypeScript reference implementation
- Publish as a separate package for broader AI ecosystem adoption
