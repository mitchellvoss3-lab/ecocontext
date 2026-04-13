// Context compiler — the heart of ecocontext
// Assembles a tight, ranked system prompt from the knowledge store within a token budget

import {
  getAllPreferences,
  getPerson,
  getProject,
  listPeople,
  listProjects,
  listExpertise,
  listCompetitors,
  getPeopleForProject,
  getProjectsForPerson,
  touchPerson,
  touchProject,
} from '../store/knowledge.js';
import type { ClassifiedIntent } from './classifier.js';

export interface ContextSection {
  label: string;
  content: string;
  tokens: number;
  relevanceScore: number;
}

export interface CompiledContext {
  systemPrompt: string;
  sections: ContextSection[];
  totalTokens: number;
  tokenBudget: number;
  utilizationPct: number;
  naiveTokenEstimate: number;
}

// Rough token estimator: 1 token ≈ 4 characters
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Naive baseline: tokens it would cost to dump every row in the store verbatim.
// This is the honest comparison point — not a hardcoded guess.
export function buildNaiveSystemPrompt(prefs: Record<string, string> = getAllPreferences()): string {
  const parts: string[] = [];

  // Identity block (same as compiled)
  const userName = prefs['user_name'] ?? '';
  const userRole = prefs['user_role'] ?? '';
  const userCompany = prefs['user_company'] ?? '';
  if (userName || userRole || userCompany) {
    parts.push(`You are assisting ${userName}${userRole ? `, ${userRole}` : ''}${userCompany ? ` at ${userCompany}` : ''}.`);
  }

  // All people
  for (const p of listPeople()) {
    parts.push([
      `${p.name}${p.role ? ` — ${p.role}` : ''}${p.relationship ? ` (${p.relationship})` : ''}`,
      p.context ?? '',
    ].filter(Boolean).join('. '));
  }

  // All projects
  for (const p of listProjects()) {
    parts.push([
      `${p.name}${p.status ? ` [${p.status}]` : ''}${p.priority ? ` — priority: ${p.priority}` : ''}`,
      p.description ?? '',
      p.keywords ?? '',
    ].filter(Boolean).join('. '));
  }

  // All expertise
  for (const e of listExpertise()) {
    parts.push(`${e.area}${e.description ? `: ${e.description}` : ''}`);
  }

  // All competitors
  for (const c of listCompetitors()) {
    parts.push(`${c.name}${c.context ? `: ${c.context}` : ''}`);
  }

  return parts.join('\n');
}

function buildNaiveBaseline(prefs: Record<string, string>): number {
  const fullDump = buildNaiveSystemPrompt(prefs);
  // Add a small fixed overhead for prompt framing (~200 tokens)
  return estimateTokens(fullDump) + 200;
}

function buildSection(label: string, content: string, relevanceScore: number): ContextSection {
  return { label, content, tokens: estimateTokens(content), relevanceScore };
}

export function compileContext(intent: ClassifiedIntent, modelTier?: 'cheap' | 'capable', tokenBudget?: number): CompiledContext {
  const prefs = getAllPreferences();
  const budgetCheap = parseInt(prefs['token_budget_cheap'] ?? '2000');
  const budgetCapable = parseInt(prefs['token_budget_capable'] ?? '4000');
  const tier = modelTier ?? 'cheap';
  const budget = tokenBudget ?? (tier === 'cheap' ? budgetCheap : budgetCapable);

  const sections: ContextSection[] = [];
  let usedTokens = 0;

  function tryAdd(section: ContextSection): boolean {
    if (usedTokens + section.tokens <= budget) {
      sections.push(section);
      usedTokens += section.tokens;
      return true;
    }
    return false;
  }

  // --- Priority 1: User identity (always included) ---
  const userName = prefs['user_name'] ?? 'the user';
  const userRole = prefs['user_role'] ?? '';
  const userCompany = prefs['user_company'] ?? '';
  const userStyle = prefs['communication_style'] ?? 'direct';

  const identityLines = [
    `You are assisting ${userName}${userRole ? `, ${userRole}` : ''}${userCompany ? ` at ${userCompany}` : ''}.`,
    `Communication style: ${userStyle}. Be concise and precise.`,
  ].join(' ');

  tryAdd(buildSection('Identity', identityLines, 1.0));

  // --- Priority 2: Directly mentioned people ---
  const addedPeople = new Set<string>();
  for (const personId of intent.mentionedPeople) {
    const person = getPerson(personId);
    if (!person) continue;
    const lines = [
      `${person.name}${person.role ? ` — ${person.role}` : ''}${person.relationship ? ` (${person.relationship})` : ''}`,
      person.context ?? '',
    ].filter(Boolean).join('. ');
    if (tryAdd(buildSection(`Person: ${person.name}`, lines, 0.95))) {
      addedPeople.add(personId);
      touchPerson(personId);
    }
  }

  // --- Priority 3: Directly mentioned projects ---
  const addedProjects = new Set<string>();
  for (const projectId of intent.mentionedProjects) {
    const project = getProject(projectId);
    if (!project) continue;
    const lines = [
      `${project.name}${project.status ? ` [${project.status}]` : ''}${project.priority ? ` — priority: ${project.priority}` : ''}`,
      project.description ?? '',
    ].filter(Boolean).join('. ');
    if (tryAdd(buildSection(`Project: ${project.name}`, lines, 0.9))) {
      addedProjects.add(projectId);
      touchProject(projectId);

      // Pull in people linked to this project (secondary)
      const linked = getPeopleForProject(projectId);
      for (const lp of linked) {
        if (addedPeople.has(lp.id)) continue;
        const lpLines = [
          `${lp.name}${lp.role ? ` — ${lp.role}` : ''}${lp.relationship ? ` (${lp.relationship})` : ''}`,
          lp.context ?? '',
        ].filter(Boolean).join('. ');
        if (tryAdd(buildSection(`Person: ${lp.name}`, lpLines, 0.75))) {
          addedPeople.add(lp.id);
        }
      }
    }
  }

  // Pull in projects for mentioned people that weren't already covered (secondary)
  for (const personId of intent.mentionedPeople) {
    const linked = getProjectsForPerson(personId);
    for (const lp of linked) {
      if (addedProjects.has(lp.id)) continue;
      const lpLines = [
        `${lp.name}${lp.status ? ` [${lp.status}]` : ''}${lp.priority ? ` — priority: ${lp.priority}` : ''}`,
        lp.description ?? '',
      ].filter(Boolean).join('. ');
      if (tryAdd(buildSection(`Project: ${lp.name}`, lpLines, 0.7))) {
        addedProjects.add(lp.id);
      }
    }
  }

  // --- Priority 4: Domain expertise ---
  const workDomains = ['work', 'technical', 'strategy'];
  if (workDomains.includes(intent.domain)) {
    const expertise = listExpertise();
    for (const exp of expertise) {
      const content = `${exp.area}${exp.description ? `: ${exp.description}` : ''}`;
      tryAdd(buildSection(`Expertise: ${exp.area}`, content, 0.6));
    }
  }

  // --- Priority 5: Competitor context (strategy domain) ---
  if (intent.domain === 'strategy' || intent.mentionedCompetitors.length > 0) {
    const competitors = listCompetitors();
    for (const comp of competitors) {
      const content = `${comp.name}${comp.context ? `: ${comp.context}` : ''}`;
      tryAdd(buildSection(`Competitor: ${comp.name}`, content, 0.5));
    }
  }

  // --- Assemble prompt ---
  const assembled = sections
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map(s => `## ${s.label}\n${s.content}`)
    .join('\n\n');

  const naiveTokenEstimate = buildNaiveBaseline(prefs);

  return {
    systemPrompt: assembled,
    sections,
    totalTokens: usedTokens,
    tokenBudget: budget,
    utilizationPct: Math.round((usedTokens / budget) * 100),
    naiveTokenEstimate,
  };
}
