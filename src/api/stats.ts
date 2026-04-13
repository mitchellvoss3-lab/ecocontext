// GET /api/stats — cumulative savings metrics

import type { Request, Response } from 'express';
import { getCumulativeStats, getZCFAutoTuneTerms, getZCFCorrectionStats } from '../store/knowledge.js';

export function getStats(_req: Request, res: Response): void {
  res.json({
    ...getCumulativeStats(),
    zcfCorrections: getZCFCorrectionStats(),
    zcfAutoTune: {
      forceNonZeroTerms: getZCFAutoTuneTerms(),
    },
  });
}
