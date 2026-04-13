// Intent classifier — rule-based entity + domain detection, LLM-upgradeable
// Returns a ClassifiedIntent that drives context compilation and model routing

import { getAdaptiveFeedbackSignal, listPeople, listProjects, listCompetitors } from '../store/knowledge.js';
import { semanticMatchIds, supportsSemanticRetrieval } from './embedder.js';

export interface ClassifiedIntent {
  domain: 'work' | 'personal' | 'technical' | 'creative' | 'communication' | 'strategy' | 'general';
  complexity: 'low' | 'medium' | 'high';
  relevantEntityIds: string[];
  mentionedPeople: string[];
  mentionedProjects: string[];
  mentionedCompetitors: string[];
  confidenceScore: number;
  routingPreference?: 'auto' | 'prefer_capable';
  feedbackTuningReason?: string;
}

// Domain keyword sets
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  work: ['project', 'team', 'meeting', 'deadline', 'client', 'stakeholder', 'deliverable', 'sprint', 'milestone', 'roadmap', 'capacity', 'utilization', 'salesforce', 'jira', 'confluence', 'slack', 'asana', 'notion'],
  technical: ['code', 'bug', 'function', 'api', 'database', 'script', 'deploy', 'error', 'typescript', 'python', 'node', 'sql', 'git', 'build'],
  creative: ['write', 'draft', 'design', 'idea', 'brainstorm', 'creative', 'story', 'marketing', 'copy', 'blog'],
  communication: ['email', 'slack', 'message', 'reply', 'respond', 'draft', 'send', 'memo', 'announce'],
  strategy: ['strategy', 'competitor', 'market', 'roadmap', 'priority', 'goal', 'objective', 'kpi', 'growth', 'revenue', 'pipeline'],
  personal: ['feel', 'personal', 'family', 'health', 'vacation', 'balance'],
  climate: ['carbon', 'ghg', 'scope', 'emissions', 'esg', 'tcfd', 'cdp', 'csrd', 'climate', 'sustainability', 'co2', 'offset', 'net zero', 'renewable'],
};

// High-complexity signal words
const HIGH_COMPLEXITY_SIGNALS = [
  'analyze', 'compare', 'strategy', 'plan', 'design', 'architecture', 'evaluate', 'recommend',
  'comprehensive', 'detailed', 'explain why', 'trade-off', 'pros and cons', 'what should i',
  'how do i', 'help me think', 'review', 'assess'
];

const LOW_COMPLEXITY_SIGNALS = [
  'what is', 'who is', 'when', 'where', 'list', 'show me', 'tell me', 'quick', 'simple', 'just'
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ');
}

function countMatches(text: string, keywords: string[]): number {
  return keywords.filter(kw => text.includes(kw)).length;
}

export async function classifyIntent(message: string): Promise<ClassifiedIntent> {
  const normalized = normalize(message);
  const words = normalized.split(/\s+/);

  // --- Entity matching ---
  const people = listPeople();
  const projects = listProjects();
  const competitors = listCompetitors();

  const mentionedPeople: string[] = [];
  const mentionedProjects: string[] = [];
  const mentionedCompetitors: string[] = [];

  const useSemantic = supportsSemanticRetrieval();

  if (useSemantic) {
    const [semanticPeople, semanticProjects, semanticCompetitors] = await Promise.all([
      semanticMatchIds({ entityType: 'person', query: message, threshold: 0.7, maxResults: 6 }),
      semanticMatchIds({ entityType: 'project', query: message, threshold: 0.7, maxResults: 6 }),
      semanticMatchIds({ entityType: 'competitor', query: message, threshold: 0.73, maxResults: 4 }),
    ]);
    mentionedPeople.push(...semanticPeople);
    mentionedProjects.push(...semanticProjects);
    mentionedCompetitors.push(...semanticCompetitors);
  }

  // Fallback keyword matching (also supplements semantic hits).
  for (const person of people) {
    const nameParts = normalize(person.name).split(' ');
    if (nameParts.some(part => part.length > 2 && normalized.includes(part))) {
      mentionedPeople.push(person.id);
    }
  }

  for (const project of projects) {
    const projectWords = normalize(project.name).split(' ');
    const kwList = project.keywords ? project.keywords.split(',').map(k => normalize(k.trim())) : [];
    const allTerms = [...projectWords, ...kwList];
    if (allTerms.some(term => term.length > 3 && normalized.includes(term))) {
      mentionedProjects.push(project.id);
    }
  }

  for (const competitor of competitors) {
    if (normalized.includes(normalize(competitor.name))) {
      mentionedCompetitors.push(competitor.id);
    }
  }

  const dedupPeople = [...new Set(mentionedPeople)];
  const dedupProjects = [...new Set(mentionedProjects)];
  const dedupCompetitors = [...new Set(mentionedCompetitors)];

  const relevantEntityIds = [...new Set([...dedupPeople, ...dedupProjects, ...dedupCompetitors])];

  // --- Domain detection ---
  const domainScores: Record<string, number> = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    domainScores[domain] = countMatches(normalized, keywords);
  }

  // Strategy domain if competitors mentioned
  if (dedupCompetitors.length > 0) {
    domainScores['strategy'] = (domainScores['strategy'] ?? 0) + 2;
  }

  // Climate maps to work domain
  if ((domainScores['climate'] ?? 0) > 0) {
    domainScores['work'] = (domainScores['work'] ?? 0) + domainScores['climate'];
  }

  const topDomain = Object.entries(domainScores)
    .filter(([d]) => d !== 'climate')
    .sort(([, a], [, b]) => b - a)[0];

  const domain = (topDomain && topDomain[1] > 0
    ? topDomain[0]
    : 'general') as ClassifiedIntent['domain'];

  // --- Complexity ---
  const highCount = countMatches(normalized, HIGH_COMPLEXITY_SIGNALS);
  const lowCount = countMatches(normalized, LOW_COMPLEXITY_SIGNALS);
  const wordCount = words.length;

  let complexity: ClassifiedIntent['complexity'];
  if (highCount >= 2 || (highCount >= 1 && wordCount > 20)) {
    complexity = 'high';
  } else if (lowCount > highCount || wordCount < 10) {
    complexity = 'low';
  } else {
    complexity = 'medium';
  }

  // --- Confidence: higher when we found relevant entities ---
  const baseConfidence = 0.5 + (relevantEntityIds.length * 0.15) + (topDomain?.[1] ?? 0) * 0.05;
  const semanticBoost = useSemantic ? 0.08 : 0;
  const feedbackSignal = getAdaptiveFeedbackSignal(domain, complexity);
  const confidenceScore = Math.max(0.1, Math.min(baseConfidence + semanticBoost - feedbackSignal.confidencePenalty, 1.0));

  return {
    domain,
    complexity,
    relevantEntityIds,
    mentionedPeople: dedupPeople,
    mentionedProjects: dedupProjects,
    mentionedCompetitors: dedupCompetitors,
    confidenceScore,
    routingPreference: feedbackSignal.preferCapable ? 'prefer_capable' : 'auto',
    feedbackTuningReason: feedbackSignal.reason,
  };
}
