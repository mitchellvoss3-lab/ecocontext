// CRUD API routes for the knowledge store
// Mounted at /api/knowledge

import type { Request, Response, ParamsDictionary } from 'express-serve-static-core';
import {
  listPeople, upsertPerson, deletePerson,
  listProjects, upsertProject, deleteProject,
  listExpertise, upsertExpertise, deleteExpertise,
  listCompetitors, upsertCompetitor, deleteCompetitor,
  getAllPreferences, setPreference,
  exportKnowledge, importKnowledge,
  linkPersonToProject,
  deleteEmbedding,
} from '../store/knowledge.js';
import { queueEntityEmbeddingRefresh, queueBackfillEmbeddings } from '../engine/embedder.js';

// --- People ---
export function getPeople(_req: Request, res: Response): void {
  res.json(listPeople());
}
export function putPerson(req: Request, res: Response): void {
  const person = upsertPerson(req.body);
  queueEntityEmbeddingRefresh('person', person.id);
  res.json(person);
}
export function removePerson(req: Request, res: Response): void {
  const id = req.params.id as string;
  deletePerson(id);
  deleteEmbedding('person', id);
  res.json({ ok: true });
}

// --- Projects ---
export function getProjects(_req: Request, res: Response): void {
  res.json(listProjects());
}
export function putProject(req: Request, res: Response): void {
  const project = upsertProject(req.body);
  queueEntityEmbeddingRefresh('project', project.id);
  res.json(project);
}
export function removeProject(req: Request, res: Response): void {
  const id = req.params.id as string;
  deleteProject(id);
  deleteEmbedding('project', id);
  res.json({ ok: true });
}

// --- Project–Person links ---
export function linkProjectPerson(req: Request, res: Response): void {
  const { projectId, personId } = req.body;
  linkPersonToProject(projectId, personId);
  res.json({ ok: true });
}

// --- Expertise ---
export function getExpertise(_req: Request, res: Response): void {
  res.json(listExpertise());
}
export function putExpertise(req: Request, res: Response): void {
  const expertise = upsertExpertise(req.body);
  queueEntityEmbeddingRefresh('expertise', expertise.id);
  res.json(expertise);
}
export function removeExpertise(req: Request, res: Response): void {
  const id = req.params.id as string;
  deleteExpertise(id);
  deleteEmbedding('expertise', id);
  res.json({ ok: true });
}

// --- Competitors ---
export function getCompetitors(_req: Request, res: Response): void {
  res.json(listCompetitors());
}
export function putCompetitor(req: Request, res: Response): void {
  const competitor = upsertCompetitor(req.body);
  queueEntityEmbeddingRefresh('competitor', competitor.id);
  res.json(competitor);
}
export function removeCompetitor(req: Request, res: Response): void {
  const id = req.params.id as string;
  deleteCompetitor(id);
  deleteEmbedding('competitor', id);
  res.json({ ok: true });
}

// --- Preferences ---
export function getPreferences(_req: Request, res: Response): void {
  res.json(getAllPreferences());
}
export function putPreference(req: Request, res: Response): void {
  const { key, value } = req.body;
  setPreference(key, value);
  res.json({ ok: true });
}

// --- Export / Import ---
export function exportKnowledgeHandler(_req: Request, res: Response): void {
  res.json(exportKnowledge());
}
export function importKnowledgeHandler(req: Request, res: Response): void {
  importKnowledge(req.body);
  queueBackfillEmbeddings();
  res.json({ ok: true });
}
