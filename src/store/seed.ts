// Onboarding — checks if the user has completed initial setup, handles seed data

import type { Request, Response } from 'express';
import { getPreference, setPreference, deletePreference, importKnowledge } from './knowledge.js';

const ONBOARDING_KEY = 'onboarding_complete';

export function isOnboarded(): boolean {
  return getPreference(ONBOARDING_KEY) === 'true';
}

export function handleOnboardingStatus(_req: Request, res: Response): void {
  res.json({ complete: isOnboarded() });
}

export function handleOnboardingComplete(req: Request, res: Response): void {
  const { name, role, company, style, provider, apiKey } = req.body as {
    name?: string;
    role?: string;
    company?: string;
    style?: string;
    provider?: string;
    apiKey?: string;
  };

  if (name) setPreference('user_name', name);
  if (role) setPreference('user_role', role);
  if (company) setPreference('user_company', company);
  if (style) setPreference('communication_style', style);
  if (provider) setPreference('llm_provider', provider);
  if (apiKey) setPreference('llm_api_key', apiKey);
  setPreference(ONBOARDING_KEY, 'true');

  res.json({ ok: true });
}

export function handleOnboardingReset(_req: Request, res: Response): void {
  deletePreference(ONBOARDING_KEY);
  deletePreference('llm_provider');
  deletePreference('llm_api_key');
  res.json({ ok: true });
}
