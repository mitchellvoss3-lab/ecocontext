// POST /api/chat — main chat endpoint
// Classify → compile → route → call LLM provider → track savings

import type { Request, Response } from 'express';
import { classifyIntent } from '../engine/classifier.js';
import { routeModel } from '../engine/router.js';
import { getProvider } from '../engine/provider.js';
import { estimateSavings } from '../engine/tracker.js';
import {
  addConversationMessage,
  createConversation,
  getAllPreferences,
  getConversation,
  listCompetitors,
  listExpertise,
  listPeople,
  listProjects,
  recordZCFCorrectionEvent,
  refreshZCFAutoTuneTerms,
} from '../store/knowledge.js';
import { compileWithZCF, snapshotFromStore, verify } from 'zero-context-first';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatAttachment {
  name: string;
  content: string;
  size?: number;
  type?: string;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_CHARS = 12000;
const MAX_TOTAL_ATTACHMENT_CHARS = 40000;

function normalizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];

  const normalized: ChatAttachment[] = [];
  let totalChars = 0;

  for (const item of raw) {
    if (normalized.length >= MAX_ATTACHMENTS) break;
    if (!item || typeof item !== 'object') continue;

    const name = typeof (item as { name?: unknown }).name === 'string'
      ? (item as { name: string }).name.trim().slice(0, 200)
      : '';
    const contentRaw = typeof (item as { content?: unknown }).content === 'string'
      ? (item as { content: string }).content
      : '';
    if (!name || !contentRaw.trim()) continue;

    const content = contentRaw.slice(0, MAX_ATTACHMENT_CHARS);
    if (totalChars + content.length > MAX_TOTAL_ATTACHMENT_CHARS) break;

    const size = typeof (item as { size?: unknown }).size === 'number'
      ? (item as { size: number }).size
      : undefined;
    const type = typeof (item as { type?: unknown }).type === 'string'
      ? (item as { type: string }).type.slice(0, 120)
      : undefined;

    normalized.push({ name, content, size, type });
    totalChars += content.length;
  }

  return normalized;
}

function buildAttachmentPrompt(attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return '';
  const files = attachments
    .map((f, idx) => {
      const header = `File ${idx + 1}: ${f.name}${f.type ? ` (${f.type})` : ''}`;
      return `${header}\n${f.content}`;
    })
    .join('\n\n---\n\n');

  return `Attached files:\n\n${files}`;
}

export async function handleChat(req: Request, res: Response): Promise<void> {
  const { message, history = [], forceTier, attachments, conversationId } = req.body as {
    message: string;
    history?: ChatMessage[];
    forceTier?: 'cheap' | 'capable';
    attachments?: ChatAttachment[];
    conversationId?: string;
  };

  const normalizedAttachments = normalizeAttachments(attachments);
  const attachmentPrompt = buildAttachmentPrompt(normalizedAttachments);
  const messageForModel = attachmentPrompt
    ? `${message}\n\n${attachmentPrompt}`
    : message;

  if (!messageForModel?.trim()) {
    res.status(400).json({ error: 'message or attachments are required' });
    return;
  }

  try {
    const resolvedConversationId = conversationId && getConversation(conversationId)
      ? conversationId
      : createConversation(message?.trim().slice(0, 80)).id;

    // 1. Classify intent
    const intent = await classifyIntent(messageForModel);

    // 2. Route model — respect manual override if set
    const autoRouting = routeModel(intent);
    const provider = getProvider();
    const routing = forceTier
      ? {
          model: forceTier === 'cheap' ? provider.cheapModel : provider.capableModel,
          tier: forceTier,
          reason: forceTier === 'cheap'
            ? 'Manual override — Fast model selected'
            : 'Manual override — Best model selected',
        }
      : autoRouting;

    // 3. Compile context with Zero-Context-First
    const prefs = getAllPreferences();
    const tokenBudgetCheap = parseInt(prefs['token_budget_cheap'] ?? '2000', 10);
    const tokenBudgetCapable = parseInt(prefs['token_budget_capable'] ?? '4000', 10);
    const tokenBudget = routing.tier === 'cheap' ? tokenBudgetCheap : tokenBudgetCapable;

    const knowledge = snapshotFromStore({
      listPeople,
      listProjects,
      listExpertise,
      listCompetitors,
      getAllPreferences,
    });
    const compiled = compileWithZCF(messageForModel, knowledge, tokenBudget);

    // 4. Call LLM provider
    let llmResponse = await provider.chat({
      model: routing.model,
      system: compiled.systemPrompt,
      messages: [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: messageForModel },
      ],
      maxTokens: 1024,
      cacheKey: `${provider.name}:${resolvedConversationId}:${routing.model}`,
    });

    // 4b. Safety-net retry for zero/micro context when response is too generic
    const verification = verify(
      messageForModel,
      llmResponse.text,
      {
        need: compiled.zcf.need,
        entityHits: [],
        domainKeywords: [],
        classificationTokens: 0,
        classificationMicros: compiled.zcf.classificationMicros,
      },
      knowledge,
    );

    let corrected = false;
    if (verification.shouldRetry && verification.correctiveFacts) {
      llmResponse = await provider.chat({
        model: routing.model,
        system: `${compiled.systemPrompt}\n\n${verification.correctiveFacts}`,
        messages: [
          ...history.map(m => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: messageForModel },
        ],
        maxTokens: 1024,
        cacheKey: `${provider.name}:${resolvedConversationId}:${routing.model}:zcf-retry`,
      });
      corrected = true;
    }

    // 5. Track savings
    const savings = estimateSavings({
      compiledTokens: llmResponse.inputTokens,
      naiveTokens: compiled.naiveTokenEstimate,
      model: llmResponse.model,
      query: messageForModel,
      intentDomain: intent.domain,
      intentComplexity: intent.complexity,
      responseTokens: llmResponse.outputTokens,
    });

    const correctionEventId = recordZCFCorrectionEvent({
      conversation_id: resolvedConversationId,
      interaction_id: savings.interactionId,
      query: messageForModel,
      context_need: compiled.zcf.need,
      should_retry: verification.shouldRetry ? 1 : 0,
      retry_applied: corrected ? 1 : 0,
      corrective_tokens: verification.correctiveTokens,
      model_used: llmResponse.model,
    });

    let learnedAutoTuneTerms: string[] = [];
    if (verification.shouldRetry) {
      learnedAutoTuneTerms = refreshZCFAutoTuneTerms();
    }

    const meta = {
      conversationId: resolvedConversationId,
      interactionId: savings.interactionId,
      provider: provider.name,
      model: llmResponse.model,
      domain: intent.domain,
      complexity: intent.complexity,
      routingReason: routing.reason,
      compiledTokens: llmResponse.inputTokens,
      naiveTokens: compiled.naiveTokenEstimate,
      contextCompilation: {
        sectionCount: compiled.sections.length,
        tokenBudget: compiled.tokenBudget,
        usedTokens: compiled.totalTokens,
        utilizationPct: compiled.utilizationPct,
        strategy: 'zero-context-first',
        zcf: compiled.zcf,
        sections: compiled.sections.map(s => ({
          label: s.label,
          tokens: s.tokens,
          relevanceScore: s.relevanceScore,
          content: s.content,
        })),
      },
      correctiveRetry: {
        eventId: correctionEventId,
        attempted: verification.shouldRetry,
        applied: corrected,
        correctiveTokens: verification.correctiveTokens,
        learnedTerms: learnedAutoTuneTerms,
      },
      tokensSaved: savings.tokensSaved,
      reductionPct: savings.reductionPct,
      estimatedCo2SavedGrams: savings.estimatedCo2SavedGrams,
      estimatedCostSavedUsd: savings.estimatedCostSavedUsd,
      cumulativeCo2SavedGrams: savings.cumulativeCo2SavedGrams,
      cumulativeTokensSaved: savings.cumulativeTokensSaved,
      attachmentsUsed: normalizedAttachments.length,
      cachedPromptTokens: llmResponse.cachedPromptTokens ?? 0,
      cacheReadInputTokens: llmResponse.cacheReadInputTokens ?? 0,
      cacheWriteInputTokens: llmResponse.cacheWriteInputTokens ?? 0,
      calculationBreakdown: savings.breakdown,
    };

    addConversationMessage({
      conversation_id: resolvedConversationId,
      role: 'user',
      content: messageForModel,
    });

    addConversationMessage({
      conversation_id: resolvedConversationId,
      role: 'assistant',
      content: llmResponse.text,
      meta_json: JSON.stringify(meta),
    });

    res.json({
      response: llmResponse.text,
      meta,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Chat error:', err);
    res.status(500).json({ error: msg });
  }
}
