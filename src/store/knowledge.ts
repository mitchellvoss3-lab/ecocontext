// Knowledge store — SQLite-backed CRUD for all entities
// Database file: data/ecocontext.db (falls back to legacy precision-context.db)

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import type {
  Person,
  Project,
  Expertise,
  Competitor,
  Preference,
  Interaction,
  EmbeddingRecord,
  EmbeddingEntityType,
  FeedbackReason,
  Conversation,
  ConversationMessage,
  ZCFCorrectionEvent,
  ZCFCorrectionStats,
} from './schema.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'ecocontext.db');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'precision-context.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const resolvedDbPath = fs.existsSync(DB_PATH)
      ? DB_PATH
      : (fs.existsSync(LEGACY_DB_PATH) ? LEGACY_DB_PATH : DB_PATH);
    db = new Database(resolvedDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      relationship TEXT,
      context TEXT,
      last_referenced DATETIME,
      relevance_score REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT,
      priority TEXT,
      description TEXT,
      keywords TEXT,
      last_referenced DATETIME,
      relevance_score REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS project_people (
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS expertise (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      context TEXT
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      query TEXT,
      intent_domain TEXT,
      intent_complexity TEXT,
      model_used TEXT,
      compiled_tokens INTEGER,
      naive_tokens INTEGER,
      response_tokens INTEGER,
      estimated_co2_saved_grams REAL,
      estimated_cost_saved_usd REAL
    );

    CREATE TABLE IF NOT EXISTS zcf_correction_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      conversation_id TEXT,
      interaction_id INTEGER,
      query TEXT NOT NULL,
      context_need TEXT NOT NULL,
      should_retry INTEGER NOT NULL DEFAULT 0,
      retry_applied INTEGER NOT NULL DEFAULT 0,
      corrective_tokens INTEGER NOT NULL DEFAULT 0,
      model_used TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_zcf_correction_events_timestamp ON zcf_correction_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_zcf_correction_events_need ON zcf_correction_events(context_need);

    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      message_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      backend TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      source_text TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_entity_type ON embeddings(entity_type);
  `);

  // Lightweight migration path for existing databases.
  const interactionColumns = d.prepare("PRAGMA table_info('interactions')").all() as Array<{ name: string }>;
  const hasRating = interactionColumns.some(c => c.name === 'rating');
  const hasFeedbackReason = interactionColumns.some(c => c.name === 'feedback_reason');
  const hasFeedbackNote = interactionColumns.some(c => c.name === 'feedback_note');

  if (!hasRating) {
    d.exec('ALTER TABLE interactions ADD COLUMN rating INTEGER DEFAULT 0');
  }
  if (!hasFeedbackReason) {
    d.exec('ALTER TABLE interactions ADD COLUMN feedback_reason TEXT');
  }
  if (!hasFeedbackNote) {
    d.exec('ALTER TABLE interactions ADD COLUMN feedback_note TEXT');
  }

  const correctionColumns = d.prepare("PRAGMA table_info('zcf_correction_events')").all() as Array<{ name: string }>;
  const hasInteractionId = correctionColumns.some(c => c.name === 'interaction_id');
  if (!hasInteractionId) {
    d.exec('ALTER TABLE zcf_correction_events ADD COLUMN interaction_id INTEGER');
  }
}

// --- People ---

export function listPeople(): Person[] {
  return getDb().prepare('SELECT * FROM people ORDER BY relevance_score DESC, name ASC').all() as Person[];
}

export function getPerson(id: string): Person | undefined {
  return getDb().prepare('SELECT * FROM people WHERE id = ?').get(id) as Person | undefined;
}

export function upsertPerson(data: Omit<Person, 'id' | 'relevance_score'> & { id?: string; relevance_score?: number }): Person {
  const d = getDb();
  const id = data.id ?? randomUUID();
  const score = data.relevance_score ?? 1.0;
  d.prepare(`
    INSERT INTO people (id, name, role, relationship, context, relevance_score)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      relationship = excluded.relationship,
      context = excluded.context,
      relevance_score = excluded.relevance_score
  `).run(id, data.name, data.role ?? null, data.relationship ?? null, data.context ?? null, score);
  return getPerson(id)!;
}

export function deletePerson(id: string): void {
  getDb().prepare('DELETE FROM people WHERE id = ?').run(id);
}

export function touchPerson(id: string): void {
  getDb().prepare("UPDATE people SET last_referenced = datetime('now') WHERE id = ?").run(id);
}

// --- Projects ---

export function listProjects(): Project[] {
  return getDb().prepare('SELECT * FROM projects ORDER BY relevance_score DESC, name ASC').all() as Project[];
}

export function getProject(id: string): Project | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function upsertProject(data: Omit<Project, 'id' | 'relevance_score'> & { id?: string; relevance_score?: number }): Project {
  const d = getDb();
  const id = data.id ?? randomUUID();
  const score = data.relevance_score ?? 1.0;
  d.prepare(`
    INSERT INTO projects (id, name, status, priority, description, keywords, relevance_score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      priority = excluded.priority,
      description = excluded.description,
      keywords = excluded.keywords,
      relevance_score = excluded.relevance_score
  `).run(id, data.name, data.status ?? null, data.priority ?? null, data.description ?? null, data.keywords ?? null, score);
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function touchProject(id: string): void {
  getDb().prepare("UPDATE projects SET last_referenced = datetime('now') WHERE id = ?").run(id);
}

// --- Project–People links ---

export function linkPersonToProject(projectId: string, personId: string): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO project_people (project_id, person_id) VALUES (?, ?)
  `).run(projectId, personId);
}

export function getPeopleForProject(projectId: string): Person[] {
  return getDb().prepare(`
    SELECT p.* FROM people p
    JOIN project_people pp ON pp.person_id = p.id
    WHERE pp.project_id = ?
  `).all(projectId) as Person[];
}

export function getProjectsForPerson(personId: string): Project[] {
  return getDb().prepare(`
    SELECT proj.* FROM projects proj
    JOIN project_people pp ON pp.project_id = proj.id
    WHERE pp.person_id = ?
  `).all(personId) as Project[];
}

// --- Expertise ---

export function listExpertise(): Expertise[] {
  return getDb().prepare('SELECT * FROM expertise ORDER BY area ASC').all() as Expertise[];
}

export function upsertExpertise(data: Omit<Expertise, 'id'> & { id?: string }): Expertise {
  const d = getDb();
  const id = data.id ?? randomUUID();
  d.prepare(`
    INSERT INTO expertise (id, area, description)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET area = excluded.area, description = excluded.description
  `).run(id, data.area, data.description ?? null);
  return d.prepare('SELECT * FROM expertise WHERE id = ?').get(id) as Expertise;
}

export function deleteExpertise(id: string): void {
  getDb().prepare('DELETE FROM expertise WHERE id = ?').run(id);
}

// --- Competitors ---

export function listCompetitors(): Competitor[] {
  return getDb().prepare('SELECT * FROM competitors ORDER BY name ASC').all() as Competitor[];
}

export function upsertCompetitor(data: Omit<Competitor, 'id'> & { id?: string }): Competitor {
  const d = getDb();
  const id = data.id ?? randomUUID();
  d.prepare(`
    INSERT INTO competitors (id, name, context)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, context = excluded.context
  `).run(id, data.name, data.context ?? null);
  return d.prepare('SELECT * FROM competitors WHERE id = ?').get(id) as Competitor;
}

export function deleteCompetitor(id: string): void {
  getDb().prepare('DELETE FROM competitors WHERE id = ?').run(id);
}

// --- Embeddings ---

export function upsertEmbedding(data: {
  entity_type: EmbeddingEntityType;
  entity_id: string;
  backend: string;
  vector: number[];
  source_text: string;
}): void {
  getDb().prepare(`
    INSERT INTO embeddings (entity_type, entity_id, backend, vector_json, source_text, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      backend = excluded.backend,
      vector_json = excluded.vector_json,
      source_text = excluded.source_text,
      updated_at = datetime('now')
  `).run(data.entity_type, data.entity_id, data.backend, JSON.stringify(data.vector), data.source_text);
}

export function getEmbedding(entityType: EmbeddingEntityType, entityId: string): EmbeddingRecord | undefined {
  return getDb().prepare('SELECT * FROM embeddings WHERE entity_type = ? AND entity_id = ?').get(entityType, entityId) as EmbeddingRecord | undefined;
}

export function listEmbeddings(entityType?: EmbeddingEntityType): EmbeddingRecord[] {
  if (entityType) {
    return getDb().prepare('SELECT * FROM embeddings WHERE entity_type = ?').all(entityType) as EmbeddingRecord[];
  }
  return getDb().prepare('SELECT * FROM embeddings').all() as EmbeddingRecord[];
}

export function deleteEmbedding(entityType: EmbeddingEntityType, entityId: string): void {
  getDb().prepare('DELETE FROM embeddings WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
}

export function listMissingEmbeddings(entityType?: EmbeddingEntityType): Array<{ entity_type: EmbeddingEntityType; entity_id: string }> {
  const missing: Array<{ entity_type: EmbeddingEntityType; entity_id: string }> = [];

  const shouldInclude = (t: EmbeddingEntityType) => !entityType || entityType === t;

  if (shouldInclude('person')) {
    const rows = getDb().prepare(`
      SELECT p.id as entity_id
      FROM people p
      LEFT JOIN embeddings e ON e.entity_type = 'person' AND e.entity_id = p.id
      WHERE e.entity_id IS NULL
    `).all() as Array<{ entity_id: string }>;
    rows.forEach(r => missing.push({ entity_type: 'person', entity_id: r.entity_id }));
  }

  if (shouldInclude('project')) {
    const rows = getDb().prepare(`
      SELECT p.id as entity_id
      FROM projects p
      LEFT JOIN embeddings e ON e.entity_type = 'project' AND e.entity_id = p.id
      WHERE e.entity_id IS NULL
    `).all() as Array<{ entity_id: string }>;
    rows.forEach(r => missing.push({ entity_type: 'project', entity_id: r.entity_id }));
  }

  if (shouldInclude('expertise')) {
    const rows = getDb().prepare(`
      SELECT x.id as entity_id
      FROM expertise x
      LEFT JOIN embeddings e ON e.entity_type = 'expertise' AND e.entity_id = x.id
      WHERE e.entity_id IS NULL
    `).all() as Array<{ entity_id: string }>;
    rows.forEach(r => missing.push({ entity_type: 'expertise', entity_id: r.entity_id }));
  }

  if (shouldInclude('competitor')) {
    const rows = getDb().prepare(`
      SELECT c.id as entity_id
      FROM competitors c
      LEFT JOIN embeddings e ON e.entity_type = 'competitor' AND e.entity_id = c.id
      WHERE e.entity_id IS NULL
    `).all() as Array<{ entity_id: string }>;
    rows.forEach(r => missing.push({ entity_type: 'competitor', entity_id: r.entity_id }));
  }

  return missing;
}

// --- Preferences ---

export function getPreference(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setPreference(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO preferences (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function deletePreference(key: string): void {
  getDb().prepare('DELETE FROM preferences WHERE key = ?').run(key);
}

export function getAllPreferences(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM preferences').all() as Preference[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// --- Conversations ---

export function createConversation(title?: string): Conversation {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO conversations (id, title)
    VALUES (?, ?)
  `).run(id, title?.trim() || null);
  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | undefined {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined;
}

export function listConversations(limit = 30): Array<Conversation & { messageCount: number; lastPreview: string }> {
  return getDb().prepare(`
    SELECT
      c.*,
      COALESCE(COUNT(cm.id), 0) as messageCount,
      COALESCE(
        (
          SELECT substr(content, 1, 140)
          FROM conversation_messages cm2
          WHERE cm2.conversation_id = c.id
          ORDER BY cm2.id DESC
          LIMIT 1
        ),
        ''
      ) as lastPreview
    FROM conversations c
    LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(limit) as Array<Conversation & { messageCount: number; lastPreview: string }>;
}

export function addConversationMessage(data: ConversationMessage): ConversationMessage {
  const result = getDb().prepare(`
    INSERT INTO conversation_messages (conversation_id, role, content, meta_json)
    VALUES (?, ?, ?, ?)
  `).run(data.conversation_id, data.role, data.content, data.meta_json ?? null);

  const messageId = Number(result.lastInsertRowid);

  getDb().prepare(`
    UPDATE conversations
    SET updated_at = datetime('now'),
        title = CASE
          WHEN (title IS NULL OR trim(title) = '')
               AND ? = 'user'
               AND length(trim(?)) > 0
          THEN substr(trim(?), 1, 80)
          ELSE title
        END
    WHERE id = ?
  `).run(data.role, data.content, data.content, data.conversation_id);

  getDb().prepare(`
    INSERT INTO conversation_messages_fts (rowid, content, conversation_id, message_id)
    VALUES (?, ?, ?, ?)
  `).run(messageId, data.content, data.conversation_id, String(messageId));

  return getDb().prepare('SELECT * FROM conversation_messages WHERE id = ?').get(messageId) as ConversationMessage;
}

export function listConversationMessages(conversationId: string, limit = 200): ConversationMessage[] {
  return getDb().prepare(`
    SELECT *
    FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(conversationId, limit) as ConversationMessage[];
}

export function searchConversationMessages(query: string, limit = 25): Array<ConversationMessage & { conversation_title?: string }> {
  const normalized = query.trim();
  if (!normalized) return [];

  return getDb().prepare(`
    SELECT
      cm.*,
      c.title as conversation_title
    FROM conversation_messages_fts fts
    JOIN conversation_messages cm ON cm.id = CAST(fts.message_id as INTEGER)
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE conversation_messages_fts MATCH ?
    ORDER BY cm.id DESC
    LIMIT ?
  `).all(normalized, limit) as Array<ConversationMessage & { conversation_title?: string }>;
}

// --- Interactions ---

export function recordInteraction(data: Interaction): number {
  const result = getDb().prepare(`
    INSERT INTO interactions
      (query, intent_domain, intent_complexity, model_used, compiled_tokens, naive_tokens,
       response_tokens, estimated_co2_saved_grams, estimated_cost_saved_usd, rating, feedback_reason, feedback_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.query, data.intent_domain, data.intent_complexity, data.model_used,
    data.compiled_tokens, data.naive_tokens, data.response_tokens,
    data.estimated_co2_saved_grams, data.estimated_cost_saved_usd,
    data.rating ?? 0,
    data.feedback_reason ?? null,
    data.feedback_note ?? null,
  );
  return Number(result.lastInsertRowid);
}

export function setInteractionFeedback(
  interactionId: number,
  rating: -1 | 0 | 1,
  feedbackReason?: FeedbackReason,
  feedbackNote?: string,
): boolean {
  const result = getDb().prepare(`
    UPDATE interactions
    SET rating = ?, feedback_reason = ?, feedback_note = COALESCE(?, feedback_note)
    WHERE id = ?
  `).run(rating, feedbackReason ?? null, feedbackNote ?? null, interactionId);
  return result.changes > 0;
}

export function getFeedbackSummary(): {
  positive: number;
  negative: number;
  unrated: number;
  totalRated: number;
  approvalPct: number;
  reasons: Partial<Record<FeedbackReason, number>>;
} {
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) as positive,
      COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) as negative,
      COALESCE(SUM(CASE WHEN rating = 0 OR rating IS NULL THEN 1 ELSE 0 END), 0) as unrated
    FROM interactions
  `).get() as { positive: number; negative: number; unrated: number };

  const totalRated = row.positive + row.negative;
  const approvalPct = totalRated > 0 ? Math.round((row.positive / totalRated) * 100) : 0;

  const reasonRows = getDb().prepare(`
    SELECT feedback_reason, COUNT(*) as count
    FROM interactions
    WHERE rating = -1 AND feedback_reason IS NOT NULL
    GROUP BY feedback_reason
  `).all() as Array<{ feedback_reason: FeedbackReason; count: number }>;

  const reasons = Object.fromEntries(reasonRows.map(r => [r.feedback_reason, r.count])) as Partial<Record<FeedbackReason, number>>;

  return {
    positive: row.positive,
    negative: row.negative,
    unrated: row.unrated,
    totalRated,
    approvalPct,
    reasons,
  };
}

export function getAdaptiveFeedbackSignal(domain: string, complexity: string): {
  confidencePenalty: number;
  preferCapable: boolean;
  reason?: string;
} {
  const scopedRows = getDb().prepare(`
    SELECT rating, feedback_reason
    FROM interactions
    WHERE intent_domain = ? AND intent_complexity = ? AND rating != 0
    ORDER BY id DESC
    LIMIT 24
  `).all(domain, complexity) as Array<{ rating: -1 | 1; feedback_reason: FeedbackReason | null }>;

  const fallbackRows = scopedRows.length >= 4
    ? scopedRows
    : getDb().prepare(`
        SELECT rating, feedback_reason
        FROM interactions
        WHERE intent_domain = ? AND rating != 0
        ORDER BY id DESC
        LIMIT 36
      `).all(domain) as Array<{ rating: -1 | 1; feedback_reason: FeedbackReason | null }>;

  const rows = fallbackRows;
  if (rows.length < 4) {
    return { confidencePenalty: 0, preferCapable: false };
  }

  const positive = rows.filter(r => r.rating === 1).length;
  const negative = rows.filter(r => r.rating === -1);
  const approvalRate = rows.length > 0 ? positive / rows.length : 1;
  const countReason = (reason: FeedbackReason) => negative.filter(r => r.feedback_reason === reason).length;

  const wrongContext = countReason('wrong_context');
  const inaccurate = countReason('inaccurate');
  const tooShallow = countReason('too_shallow');
  const wrongModel = countReason('wrong_model');

  let confidencePenalty = 0;
  const reasons: string[] = [];
  let preferCapable = false;

  if (wrongContext >= 2) {
    confidencePenalty += 0.12;
    reasons.push('recent wrong-context feedback');
  }
  if (inaccurate >= 2) {
    confidencePenalty += 0.08;
    reasons.push('recent accuracy misses');
  }
  if (tooShallow >= 2 || wrongModel >= 2) {
    preferCapable = true;
    reasons.push('recent shallow or wrong-model feedback');
  }
  if (approvalRate < 0.5 && negative.length >= 3) {
    preferCapable = true;
    confidencePenalty += 0.05;
    reasons.push('recent approval dip on similar queries');
  }

  return {
    confidencePenalty: Math.min(confidencePenalty, 0.2),
    preferCapable,
    reason: reasons[0],
  };
}

export function getCumulativeStats(): { totalInteractions: number; totalCo2SavedGrams: number; totalCostSavedUsd: number; totalTokensSaved: number } {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) as totalInteractions,
      COALESCE(SUM(estimated_co2_saved_grams), 0) as totalCo2SavedGrams,
      COALESCE(SUM(estimated_cost_saved_usd), 0) as totalCostSavedUsd,
      COALESCE(SUM(naive_tokens - compiled_tokens), 0) as totalTokensSaved
    FROM interactions
  `).get() as { totalInteractions: number; totalCo2SavedGrams: number; totalCostSavedUsd: number; totalTokensSaved: number };
  return row;
}

export function recordZCFCorrectionEvent(data: ZCFCorrectionEvent): number {
  const result = getDb().prepare(`
    INSERT INTO zcf_correction_events
      (conversation_id, interaction_id, query, context_need, should_retry, retry_applied, corrective_tokens, model_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.conversation_id ?? null,
    data.interaction_id ?? null,
    data.query,
    data.context_need,
    data.should_retry,
    data.retry_applied,
    data.corrective_tokens,
    data.model_used ?? null,
  );

  return Number(result.lastInsertRowid);
}

export function getZCFCorrectionStats(): ZCFCorrectionStats {
  const totals = getDb().prepare(`
    SELECT
      COUNT(*) as totalEvents,
      COALESCE(SUM(should_retry), 0) as totalShouldRetry,
      COALESCE(SUM(retry_applied), 0) as totalRetryApplied,
      COALESCE(AVG(CASE WHEN should_retry = 1 THEN corrective_tokens END), 0) as avgCorrectiveTokens
    FROM zcf_correction_events
  `).get() as {
    totalEvents: number;
    totalShouldRetry: number;
    totalRetryApplied: number;
    avgCorrectiveTokens: number;
  };

  const byNeedRows = getDb().prepare(`
    SELECT context_need, COUNT(*) as count
    FROM zcf_correction_events
    GROUP BY context_need
  `).all() as Array<{ context_need: 'zero' | 'micro' | 'targeted'; count: number }>;

  const byNeed: Record<'zero' | 'micro' | 'targeted', number> = {
    zero: 0,
    micro: 0,
    targeted: 0,
  };

  for (const row of byNeedRows) {
    byNeed[row.context_need] = row.count;
  }

  const retryRatePct = totals.totalEvents > 0
    ? Math.round((totals.totalShouldRetry / totals.totalEvents) * 100)
    : 0;
  const appliedRatePct = totals.totalShouldRetry > 0
    ? Math.round((totals.totalRetryApplied / totals.totalShouldRetry) * 100)
    : 0;

  return {
    totalEvents: totals.totalEvents,
    totalShouldRetry: totals.totalShouldRetry,
    totalRetryApplied: totals.totalRetryApplied,
    retryRatePct,
    appliedRatePct,
    avgCorrectiveTokens: Number(totals.avgCorrectiveTokens.toFixed(1)),
    byNeed,
  };
}

const AUTOTUNE_STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'our', 'your',
  'and', 'or', 'but', 'for', 'with', 'from', 'into', 'about', 'after', 'before',
  'can', 'could', 'should', 'would', 'please', 'me', 'us', 'it', 'to', 'of',
  'on', 'in', 'by', 'at', 'as', 'if', 'than', 'then', 'also', 'just',
]);

function extractSignalTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4)
    .filter(token => !AUTOTUNE_STOPWORDS.has(token));
}

export function refreshZCFAutoTuneTerms(options?: {
  sampleSize?: number;
  minFrequency?: number;
  maxTerms?: number;
}): string[] {
  const sampleSize = options?.sampleSize ?? 200;
  const minFrequency = options?.minFrequency ?? 2;
  const maxTerms = options?.maxTerms ?? 12;

  const rows = getDb().prepare(`
    SELECT query
    FROM zcf_correction_events
    WHERE should_retry = 1
      AND retry_applied = 1
      AND context_need IN ('zero', 'micro')
    ORDER BY id DESC
    LIMIT ?
  `).all(sampleSize) as Array<{ query: string }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const uniqueTerms = new Set(extractSignalTerms(row.query));
    for (const term of uniqueTerms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }

  const learnedTerms = [...counts.entries()]
    .filter(([, count]) => count >= minFrequency)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms)
    .map(([term]) => term);

  setPreference('zcf_force_nonzero_terms', learnedTerms.join(','));
  return learnedTerms;
}

export function getZCFAutoTuneTerms(): string[] {
  const raw = getPreference('zcf_force_nonzero_terms') ?? '';
  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}

// --- Export / Import ---

export function exportKnowledge(): object {
  return {
    people: listPeople(),
    projects: listProjects(),
    expertise: listExpertise(),
    competitors: listCompetitors(),
    preferences: getAllPreferences(),
  };
}

export function importKnowledge(data: ReturnType<typeof exportKnowledge> & {
  people?: Person[];
  projects?: Project[];
  expertise?: Expertise[];
  competitors?: Competitor[];
  preferences?: Record<string, string>;
}): void {
  const d = getDb();
  const run = d.transaction(() => {
    (data.people ?? []).forEach(p => upsertPerson(p));
    (data.projects ?? []).forEach(p => upsertProject(p));
    (data.expertise ?? []).forEach(e => upsertExpertise(e));
    (data.competitors ?? []).forEach(c => upsertCompetitor(c));
    Object.entries(data.preferences ?? {}).forEach(([k, v]) => setPreference(k, v));
  });
  run();
}
