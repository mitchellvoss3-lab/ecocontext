// Express server — serves chat UI + API routes

import express from 'express';
import path from 'path';
import { handleChat } from './api/chat.js';
import {
  getPeople, putPerson, removePerson,
  getProjects, putProject, removeProject,
  getExpertise, putExpertise, removeExpertise,
  getCompetitors, putCompetitor, removeCompetitor,
  getPreferences, putPreference,
  exportKnowledgeHandler, importKnowledgeHandler,
  linkProjectPerson,
} from './api/knowledge.js';
import { getStats } from './api/stats.js';
import { getFeedbackStats, submitFeedback } from './api/feedback.js';
import { getConversationMessages, getConversations, searchConversations } from './api/conversations.js';
import { runBenchmark } from './api/benchmark.js';
import { getOllamaStatus, setupOllama } from './api/ollama.js';
import { handleOnboardingStatus, handleOnboardingComplete, handleOnboardingReset } from './store/seed.js';
import { getProvider, detectProvider, listProviders } from './engine/provider.js';

export function createServer(): express.Express {
  const app = express();

  app.use(express.json());

  // --- Static UI ---
  app.use(express.static(path.join(__dirname, '..', 'src', 'ui')));

  // --- Chat ---
  app.post('/api/chat', handleChat);
  app.post('/api/benchmark', runBenchmark);
  app.get('/api/conversations', getConversations);
  app.get('/api/conversations/search', searchConversations);
  app.get('/api/conversations/:id/messages', getConversationMessages);

  // --- Knowledge CRUD ---
  app.get('/api/knowledge/people', getPeople);
  app.put('/api/knowledge/people', putPerson);
  app.delete('/api/knowledge/people/:id', removePerson);

  app.get('/api/knowledge/projects', getProjects);
  app.put('/api/knowledge/projects', putProject);
  app.delete('/api/knowledge/projects/:id', removeProject);

  app.post('/api/knowledge/project-people', linkProjectPerson);

  app.get('/api/knowledge/expertise', getExpertise);
  app.put('/api/knowledge/expertise', putExpertise);
  app.delete('/api/knowledge/expertise/:id', removeExpertise);

  app.get('/api/knowledge/competitors', getCompetitors);
  app.put('/api/knowledge/competitors', putCompetitor);
  app.delete('/api/knowledge/competitors/:id', removeCompetitor);

  app.get('/api/knowledge/preferences', getPreferences);
  app.put('/api/knowledge/preferences', putPreference);

  app.get('/api/knowledge/export', exportKnowledgeHandler);
  app.post('/api/knowledge/import', importKnowledgeHandler);

  // --- Stats ---
  app.get('/api/stats', getStats);
  app.get('/api/feedback/stats', getFeedbackStats);
  app.post('/api/feedback', submitFeedback);

  // --- Onboarding ---
  app.get('/api/onboarding', handleOnboardingStatus);
  app.post('/api/onboarding', handleOnboardingComplete);
  app.post('/api/onboarding/reset', handleOnboardingReset);

  // --- Provider info ---
  app.get('/api/provider', (_req, res) => {
    const name = detectProvider();
    const provider = getProvider();
    res.json({
      active: name,
      cheapModel: provider.cheapModel,
      capableModel: provider.capableModel,
      available: listProviders(),
    });
  });

  // --- Ollama local setup ---
  app.get('/api/ollama/status', getOllamaStatus);
  app.post('/api/ollama/setup', setupOllama);

  return app;
}
