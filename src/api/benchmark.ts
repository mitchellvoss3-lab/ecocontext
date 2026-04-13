// Benchmark API — compares compiled-context mode vs naive full-context mode

import type { Request, Response } from 'express';
import { classifyIntent } from '../engine/classifier.js';
import { buildNaiveSystemPrompt, compileContext } from '../engine/compiler.js';
import { getProvider } from '../engine/provider.js';
import { routeModel } from '../engine/router.js';

export async function runBenchmark(req: Request, res: Response): Promise<void> {
  const { message, history = [] } = req.body as {
    message?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const provider = getProvider();
    const intent = await classifyIntent(message);
    const routing = routeModel(intent);

    const compiled = compileContext(intent, routing.tier);
    const naiveSystemPrompt = buildNaiveSystemPrompt();

    const compiledStart = Date.now();
    const compiledResp = await provider.chat({
      model: routing.model,
      system: compiled.systemPrompt,
      messages: [...history, { role: 'user', content: message }],
      maxTokens: 1024,
      cacheKey: `compiled:${routing.model}:${compiled.sections.length}`,
    });
    const compiledLatencyMs = Date.now() - compiledStart;

    const naiveStart = Date.now();
    const naiveResp = await provider.chat({
      model: provider.capableModel,
      system: naiveSystemPrompt,
      messages: [...history, { role: 'user', content: message }],
      maxTokens: 1024,
      cacheKey: `naive:${provider.capableModel}:full`,
    });
    const naiveLatencyMs = Date.now() - naiveStart;

    const tokenReductionPct = naiveResp.inputTokens > 0
      ? Math.max(0, Math.round(((naiveResp.inputTokens - compiledResp.inputTokens) / naiveResp.inputTokens) * 100))
      : 0;

    res.json({
      intent: {
        domain: intent.domain,
        complexity: intent.complexity,
      },
      compiled: {
        model: compiledResp.model,
        latencyMs: compiledLatencyMs,
        inputTokens: compiledResp.inputTokens,
        outputTokens: compiledResp.outputTokens,
        cachedPromptTokens: compiledResp.cachedPromptTokens ?? 0,
        outputText: compiledResp.text,
      },
      naive: {
        model: naiveResp.model,
        latencyMs: naiveLatencyMs,
        inputTokens: naiveResp.inputTokens,
        outputTokens: naiveResp.outputTokens,
        cachedPromptTokens: naiveResp.cachedPromptTokens ?? 0,
        outputText: naiveResp.text,
      },
      comparison: {
        tokenReductionPct,
        latencyDeltaMs: naiveLatencyMs - compiledLatencyMs,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown benchmark error';
    res.status(500).json({ error: msg });
  }
}
