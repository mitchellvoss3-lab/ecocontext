// Conversation persistence/search API

import type { Request, Response } from 'express';
import {
  getConversation,
  listConversationMessages,
  listConversations,
  searchConversationMessages,
} from '../store/knowledge.js';

export function getConversations(req: Request, res: Response): void {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 30)));
  res.json(listConversations(limit));
}

export function getConversationMessages(req: Request, res: Response): void {
  const conversationId = String(req.params.id ?? '');
  if (!conversationId) {
    res.status(400).json({ error: 'conversation id is required' });
    return;
  }

  const convo = getConversation(conversationId);
  if (!convo) {
    res.status(404).json({ error: 'conversation not found' });
    return;
  }

  const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 200)));
  res.json({
    conversation: convo,
    messages: listConversationMessages(conversationId, limit),
  });
}

export function searchConversations(req: Request, res: Response): void {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }

  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 25)));
  res.json(searchConversationMessages(q, limit));
}
