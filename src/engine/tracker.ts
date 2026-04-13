// CO₂e and cost savings tracker
// Compares compiled context vs. naive full-dump baseline, provider-agnostic

import { recordInteraction, getCumulativeStats } from '../store/knowledge.js';

export interface CalculationBreakdown {
  naiveInputTokens: number;
  naiveOutputTokens: number;
  naiveTotalTokens: number;
  naiveEnergyKwh: number;
  naiveCo2Grams: number;
  naiveModel: string;
  naiveEnergyRateKwhPer1k: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualTotalTokens: number;
  actualEnergyKwh: number;
  actualCo2Grams: number;
  actualModel: string;
  actualEnergyRateKwhPer1k: number;
  gridIntensityGCo2PerKwh: number;
  methodology: string;
  caveats: string[];
}

export interface SavingsEstimate {
  interactionId: number;
  compiledTokens: number;
  naiveTokens: number;
  tokensSaved: number;
  reductionPct: number;
  estimatedCo2SavedGrams: number;
  estimatedCostSavedUsd: number;
  cumulativeCo2SavedGrams: number;
  cumulativeCostSavedUsd: number;
  cumulativeTokensSaved: number;
  breakdown: CalculationBreakdown;
}

// ---------------------------------------------------------------------------
// Energy intensity per 1k tokens (kWh), input + output combined.
// Source: Luccioni et al. 2023 "Power Hungry Processing: Watts Driving the
//   Cost of AI Deployment?" (https://arxiv.org/abs/2311.16863); Patterson et
//   al. 2022 "The Carbon Footprint of Machine Learning Training Will Plateau"
//   (https://arxiv.org/abs/2204.05149); provider sustainability reports.
// These are point estimates. Actual values vary ±50% with hardware generation,
// data-center PUE, and server utilization. Treat as order-of-magnitude guidance.
// ---------------------------------------------------------------------------
const ENERGY_KWH_PER_1K: Record<string, number> = {
  // Anthropic (Claude) — small/large model ratio ~10x, consistent with param scale
  'claude-haiku-4-5-20251001': 0.0001,
  'claude-sonnet-4-6':         0.001,
  // OpenAI
  'gpt-4o-mini': 0.0001,
  'gpt-4o':      0.001,
  // Google Gemini
  'gemini-2.5-flash-lite': 0.00008,
  'gemini-2.5-flash':      0.0005,
  'gemini-2.0-flash-lite': 0.00008,
  'gemini-2.0-flash':      0.0005,
  // Ollama — local consumer GPU estimate (RTX 3090 class); varies with hardware
  'llama3.2:3b': 0.00005,
  'llama3.1:8b': 0.0002,
  // Fallback for unknown capable-tier models
  default: 0.001,
};

// ---------------------------------------------------------------------------
// Grid emission intensity: 400 g CO₂e / kWh
// Source: US EPA eGRID 2023 national average (location-based accounting).
// Note: Major cloud providers (Google, Microsoft, Amazon) purchase renewable
// energy certificates. Market-based Scope 2 emissions for their data centers
// may be significantly lower. 400 g/kWh is a conservative location-based
// figure — it does NOT reflect provider-reported carbon-neutral claims.
// ---------------------------------------------------------------------------
const GRID_G_CO2_PER_KWH = 400;

// ---------------------------------------------------------------------------
// Pricing per 1k input tokens (USD) — public list prices as of April 2026.
// Output token pricing differs per provider but is omitted here for simplicity;
// input tokens dominate cost for retrieval-heavy workloads.
// ---------------------------------------------------------------------------
const COST_USD_PER_1K_INPUT: Record<string, number> = {
  'claude-haiku-4-5-20251001': 0.00025,
  'claude-sonnet-4-6':         0.003,
  'gpt-4o-mini': 0.00015,
  'gpt-4o':      0.0025,
  'gemini-2.5-flash-lite': 0.000075,
  'gemini-2.5-flash':      0.0001,
  'gemini-2.0-flash-lite': 0.000075,
  'gemini-2.0-flash':      0.0001,
  'llama3.2:3b': 0,
  'llama3.1:8b': 0,
  default: 0.003,
};

// The naive baseline uses the "capable" tier of the same provider family.
// We resolve it from the actual model name so the comparison is apples-to-apples.
function naiveModelFor(model: string): string {
  if (model.startsWith('claude-haiku') || model.startsWith('claude-sonnet')) return 'claude-sonnet-4-6';
  if (model.startsWith('gpt-4o'))  return 'gpt-4o';
  if (model.startsWith('gemini'))  return 'gemini-2.5-flash';
  if (model.startsWith('llama'))   return 'llama3.1:8b';
  return 'default';
}

function energyRateFor(model: string): number {
  return ENERGY_KWH_PER_1K[model] ?? ENERGY_KWH_PER_1K['default'];
}

function costRateFor(model: string): number {
  return COST_USD_PER_1K_INPUT[model] ?? COST_USD_PER_1K_INPUT['default'];
}

export function estimateSavings(params: {
  compiledTokens: number;
  naiveTokens: number;
  model: string;
  query: string;
  intentDomain: string;
  intentComplexity: string;
  responseTokens: number;
}): SavingsEstimate {
  const { compiledTokens, naiveTokens, model, query, intentDomain, intentComplexity, responseTokens } = params;

  const tokensSaved = Math.max(0, naiveTokens - compiledTokens);
  const reductionPct = naiveTokens > 0 ? Math.round((tokensSaved / naiveTokens) * 100) : 0;

  // Naive scenario: capable model of same provider family, full-dump input, same output.
  const naiveModel = naiveModelFor(model);
  const naiveEnergyRate = energyRateFor(naiveModel);
  const naiveTotalTokens = naiveTokens + responseTokens;
  const naiveEnergyKwh = (naiveTotalTokens / 1000) * naiveEnergyRate;
  const naiveCo2 = naiveEnergyKwh * GRID_G_CO2_PER_KWH;
  const naiveCost = (naiveTokens / 1000) * costRateFor(naiveModel);

  // Actual: compiled input + same output, actual model.
  const actualEnergyRate = energyRateFor(model);
  const actualTotalTokens = compiledTokens + responseTokens;
  const actualEnergyKwh = (actualTotalTokens / 1000) * actualEnergyRate;
  const actualCo2 = actualEnergyKwh * GRID_G_CO2_PER_KWH;
  const actualCost = (compiledTokens / 1000) * costRateFor(model);

  const estimatedCo2SavedGrams = Math.max(0, naiveCo2 - actualCo2);
  const estimatedCostSavedUsd  = Math.max(0, naiveCost - actualCost);

  const breakdown: CalculationBreakdown = {
    naiveInputTokens: naiveTokens,
    naiveOutputTokens: responseTokens,
    naiveTotalTokens,
    naiveEnergyRateKwhPer1k: naiveEnergyRate,
    naiveEnergyKwh: +naiveEnergyKwh.toFixed(8),
    naiveCo2Grams: +naiveCo2.toFixed(5),
    naiveModel,
    actualInputTokens: compiledTokens,
    actualOutputTokens: responseTokens,
    actualTotalTokens,
    actualEnergyRateKwhPer1k: actualEnergyRate,
    actualEnergyKwh: +actualEnergyKwh.toFixed(8),
    actualCo2Grams: +actualCo2.toFixed(5),
    actualModel: model,
    gridIntensityGCo2PerKwh: GRID_G_CO2_PER_KWH,
    methodology:
      'CO₂e = total_tokens / 1000 × energy_kWh_per_1k_tokens × grid_g_CO₂e_per_kWh. ' +
      'Savings = naive_CO₂e − actual_CO₂e. Both input and output tokens included.',
    caveats: [
      'Energy rates are estimates (±50%) based on Luccioni et al. 2023 and Patterson et al. 2022.',
      `Grid intensity ${GRID_G_CO2_PER_KWH} g CO₂e/kWh = US EPA eGRID 2023 national average (location-based).`,
      'Cloud providers may report lower market-based Scope 2 emissions via renewable energy certificates.',
      'Naive baseline assumes the capable model for your provider with full context dump.',
      'Local models (Ollama) reflect consumer GPU estimates; actual emissions depend on your hardware.',
    ],
  };

  // Record to DB
  const interactionId = recordInteraction({
    query,
    intent_domain: intentDomain,
    intent_complexity: intentComplexity,
    model_used: model,
    compiled_tokens: compiledTokens,
    naive_tokens: naiveTokens,
    response_tokens: responseTokens,
    estimated_co2_saved_grams: estimatedCo2SavedGrams,
    estimated_cost_saved_usd: estimatedCostSavedUsd,
  });

  const cumulative = getCumulativeStats();

  return {
    interactionId,
    compiledTokens,
    naiveTokens,
    tokensSaved,
    reductionPct,
    estimatedCo2SavedGrams,
    estimatedCostSavedUsd,
    cumulativeCo2SavedGrams: cumulative.totalCo2SavedGrams,
    cumulativeCostSavedUsd: cumulative.totalCostSavedUsd,
    cumulativeTokensSaved: cumulative.totalTokensSaved,
    breakdown,
  };
}
