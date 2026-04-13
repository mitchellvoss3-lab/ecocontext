// Feedback API for interaction quality ratings

import type { Request, Response } from 'express';
import { FEEDBACK_REASONS, type FeedbackReason } from '../store/schema.js';
import { getFeedbackSummary, setInteractionFeedback } from '../store/knowledge.js';

export function submitFeedback(req: Request, res: Response): void {
  const { interactionId, rating, reason, note } = req.body as {
    interactionId?: number;
    rating?: -1 | 0 | 1;
    reason?: FeedbackReason;
    note?: string;
  };

  if (!Number.isInteger(interactionId) || ![-1, 0, 1].includes(Number(rating))) {
    res.status(400).json({ error: 'interactionId and rating (-1, 0, or 1) are required' });
    return;
  }

  const normalizedNote = typeof note === 'string' && note.trim()
    ? note.trim().slice(0, 1000)
    : undefined;

  const normalizedReason = typeof reason === 'string' && FEEDBACK_REASONS.includes(reason)
    ? reason
    : undefined;

  const ok = setInteractionFeedback(interactionId!, rating as -1 | 0 | 1, normalizedReason, normalizedNote);
  if (!ok) {
    res.status(404).json({ error: 'interaction not found' });
    return;
  }

  res.json({ success: true });
}

export function getFeedbackStats(_req: Request, res: Response): void {
  res.json(getFeedbackSummary());
}
