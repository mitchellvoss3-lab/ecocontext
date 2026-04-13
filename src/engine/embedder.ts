// Embedding infrastructure for semantic entity retrieval.
// Supports Ollama, OpenAI, Gemini, and a local deterministic fallback.

import {
  listPeople,
  listProjects,
  listExpertise,
  listCompetitors,
  getPerson,
  getProject,
  listEmbeddings,
  upsertEmbedding,
  listMissingEmbeddings,
} from '../store/knowledge.js';
import type { EmbeddingEntityType } from '../store/schema.js';
import { detectProvider } from './provider.js';

export type EmbeddingBackend = 'ollama' | 'openai' | 'gemini' | 'local-hash' | 'none';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

function magnitude(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denom = magnitude(a) * magnitude(b);
  if (!denom) return 0;
  return dot(a, b) / denom;
}

function normalizeEmbedding(v: number[]): number[] {
  const mag = magnitude(v);
  if (!mag) return v;
  return v.map(x => x / mag);
}

function getApiKeyFor(provider: 'openai' | 'gemini'): string {
  if (provider === 'openai') return process.env.OPENAI_API_KEY ?? '';
  return process.env.GEMINI_API_KEY ?? '';
}

function hashVector(text: string, dim = 128): number[] {
  const vector = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const idx = (c * 31 + i * 17) % dim;
    const sign = (c + i) % 2 === 0 ? 1 : -1;
    vector[idx] += sign * ((c % 13) / 13 + 0.1);
  }
  return normalizeEmbedding(vector);
}

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function detectEmbeddingBackend(): Promise<EmbeddingBackend> {
  const explicit = process.env.EMBEDDING_BACKEND as EmbeddingBackend | undefined;
  if (explicit && ['ollama', 'openai', 'gemini', 'local-hash', 'none'].includes(explicit)) {
    return explicit;
  }

  const provider = detectProvider();

  if (provider === 'openai' && getApiKeyFor('openai')) return 'openai';
  if (provider === 'gemini' && getApiKeyFor('gemini')) return 'gemini';

  if (await isOllamaAvailable()) return 'ollama';

  if (getApiKeyFor('openai')) return 'openai';
  if (getApiKeyFor('gemini')) return 'gemini';

  return 'local-hash';
}

async function embedWithOllama(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embeddings error ${res.status}: ${err}`);
  }
  const data = await res.json() as { embedding?: number[] };
  if (!Array.isArray(data.embedding)) throw new Error('Ollama embeddings missing vector');
  return normalizeEmbedding(data.embedding);
}

async function embedWithOpenAI(text: string): Promise<number[]> {
  const key = getApiKeyFor('openai');
  if (!key) throw new Error('OpenAI API key missing for embeddings');
  const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${err}`);
  }
  const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error('OpenAI embeddings missing vector');
  return normalizeEmbedding(embedding);
}

async function embedWithGemini(text: string): Promise<number[]> {
  const key = getApiKeyFor('gemini');
  if (!key) throw new Error('Gemini API key missing for embeddings');
  const res = await fetch(`${GEMINI_BASE_URL}/models/text-embedding-004:embedContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: {
        parts: [{ text }],
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embeddings error ${res.status}: ${err}`);
  }
  const data = await res.json() as { embedding?: { values?: number[] } };
  const embedding = data.embedding?.values;
  if (!Array.isArray(embedding)) throw new Error('Gemini embeddings missing vector');
  return normalizeEmbedding(embedding);
}

export async function embedText(text: string): Promise<{ backend: EmbeddingBackend; vector: number[] } | null> {
  const backend = await detectEmbeddingBackend();
  if (backend === 'none') return null;

  try {
    if (backend === 'ollama') return { backend, vector: await embedWithOllama(text) };
    if (backend === 'openai') return { backend, vector: await embedWithOpenAI(text) };
    if (backend === 'gemini') return { backend, vector: await embedWithGemini(text) };
    if (backend === 'local-hash') return { backend, vector: hashVector(text) };
    return null;
  } catch {
    // Fall back to deterministic local embedding so retrieval still works offline.
    return { backend: 'local-hash', vector: hashVector(text) };
  }
}

function serializeEntityForEmbedding(entityType: EmbeddingEntityType, entityId: string): string | null {
  if (entityType === 'person') {
    const p = getPerson(entityId);
    if (!p) return null;
    return [p.name, p.role ?? '', p.relationship ?? '', p.context ?? ''].filter(Boolean).join('. ');
  }

  if (entityType === 'project') {
    const p = getProject(entityId);
    if (!p) return null;
    return [p.name, p.status ?? '', p.priority ?? '', p.description ?? '', p.keywords ?? ''].filter(Boolean).join('. ');
  }

  if (entityType === 'expertise') {
    const e = listExpertise().find(x => x.id === entityId);
    if (!e) return null;
    return [e.area, e.description ?? ''].filter(Boolean).join(': ');
  }

  const c = listCompetitors().find(x => x.id === entityId);
  if (!c) return null;
  return [c.name, c.context ?? ''].filter(Boolean).join(': ');
}

export async function refreshEntityEmbedding(entityType: EmbeddingEntityType, entityId: string): Promise<void> {
  const sourceText = serializeEntityForEmbedding(entityType, entityId);
  if (!sourceText) return;

  const embedded = await embedText(sourceText);
  if (!embedded) return;

  upsertEmbedding({
    entity_type: entityType,
    entity_id: entityId,
    backend: embedded.backend,
    vector: embedded.vector,
    source_text: sourceText,
  });
}

export function queueEntityEmbeddingRefresh(entityType: EmbeddingEntityType, entityId: string): void {
  void refreshEntityEmbedding(entityType, entityId).catch(() => {
    // Non-blocking by design; classifier will fall back if vectors are missing.
  });
}

export function queueBackfillEmbeddings(): void {
  const missing = listMissingEmbeddings();
  for (const item of missing) {
    queueEntityEmbeddingRefresh(item.entity_type, item.entity_id);
  }
}

export async function semanticMatchIds(params: {
  entityType: EmbeddingEntityType;
  query: string;
  threshold?: number;
  maxResults?: number;
}): Promise<string[]> {
  const embedded = await embedText(params.query);
  if (!embedded?.vector?.length) return [];

  const rows = listEmbeddings(params.entityType);
  if (!rows.length) return [];

  const threshold = params.threshold ?? 0.72;
  const maxResults = params.maxResults ?? 5;

  const scored = rows
    .map(row => {
      try {
        const vector = JSON.parse(row.vector_json) as number[];
        const score = cosineSimilarity(embedded.vector, vector);
        return { id: row.entity_id, score };
      } catch {
        return { id: row.entity_id, score: -1 };
      }
    })
    .filter(x => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map(s => s.id);
}

export function supportsSemanticRetrieval(): boolean {
  return listEmbeddings().length > 0;
}
