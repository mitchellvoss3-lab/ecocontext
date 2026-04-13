// Model router — maps complexity + context quality to the cheapest adequate model
// Provider-agnostic: uses "cheap" and "capable" from the active provider

import type { ClassifiedIntent } from './classifier.js';
import { getProvider } from './provider.js';

export interface RoutingDecision {
  model: string;
  tier: 'cheap' | 'capable';
  reason: string;
}

export function routeModel(intent: ClassifiedIntent): RoutingDecision {
  const provider = getProvider();
  const { complexity, confidenceScore, routingPreference, feedbackTuningReason } = intent;

  if (routingPreference === 'prefer_capable') {
    return {
      model: provider.capableModel,
      tier: 'capable',
      reason: feedbackTuningReason
        ? `Adaptive escalation — ${feedbackTuningReason}`
        : 'Adaptive escalation — recent feedback suggests a stronger model for similar queries',
    };
  }

  if (complexity === 'low') {
    return { model: provider.cheapModel, tier: 'cheap', reason: 'Low complexity — cheap model sufficient' };
  }

  if (complexity === 'medium') {
    if (confidenceScore >= 0.7) {
      return { model: provider.cheapModel, tier: 'cheap', reason: 'Medium complexity with good context match — cheap model sufficient' };
    }
    return { model: provider.capableModel, tier: 'capable', reason: 'Medium complexity with weak context match — capable model for reliability' };
  }

  // High complexity
  return { model: provider.capableModel, tier: 'capable', reason: 'High complexity — capable model required' };
}
