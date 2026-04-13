// Entity types for the ecocontext knowledge store

export interface Person {
  id: string;
  name: string;
  role?: string;
  relationship?: 'manager' | 'direct_report' | 'peer' | 'cross_functional' | 'personal';
  context?: string;
  last_referenced?: string;
  relevance_score: number;
}

export interface Project {
  id: string;
  name: string;
  status?: 'active' | 'blocked' | 'completed' | 'exploration';
  priority?: 'high' | 'medium' | 'low' | 'personal';
  description?: string;
  keywords?: string;
  last_referenced?: string;
  relevance_score: number;
}

export interface Expertise {
  id: string;
  area: string;
  description?: string;
}

export interface Competitor {
  id: string;
  name: string;
  context?: string;
}

export interface Preference {
  key: string;
  value: string;
}

export interface Conversation {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationMessage {
  id?: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  meta_json?: string;
  created_at?: string;
}

export const FEEDBACK_REASONS = [
  'wrong_context',
  'inaccurate',
  'too_shallow',
  'too_verbose',
  'wrong_model',
  'not_helpful',
] as const;

export type FeedbackReason = typeof FEEDBACK_REASONS[number];

export interface Interaction {
  id?: number;
  timestamp?: string;
  query: string;
  intent_domain: string;
  intent_complexity: string;
  model_used: string;
  compiled_tokens: number;
  naive_tokens: number;
  response_tokens: number;
  estimated_co2_saved_grams: number;
  estimated_cost_saved_usd: number;
  rating?: -1 | 0 | 1;
  feedback_reason?: FeedbackReason;
  feedback_note?: string;
}

export type EmbeddingEntityType = 'person' | 'project' | 'expertise' | 'competitor';

export interface EmbeddingRecord {
  entity_type: EmbeddingEntityType;
  entity_id: string;
  backend: string;
  vector_json: string;
  source_text: string;
  updated_at?: string;
}

export interface ZCFCorrectionEvent {
  id?: number;
  timestamp?: string;
  conversation_id?: string;
  interaction_id?: number;
  query: string;
  context_need: 'zero' | 'micro' | 'targeted';
  should_retry: 0 | 1;
  retry_applied: 0 | 1;
  corrective_tokens: number;
  model_used?: string;
}

export interface ZCFCorrectionStats {
  totalEvents: number;
  totalShouldRetry: number;
  totalRetryApplied: number;
  retryRatePct: number;
  appliedRatePct: number;
  avgCorrectiveTokens: number;
  byNeed: Record<'zero' | 'micro' | 'targeted', number>;
}
