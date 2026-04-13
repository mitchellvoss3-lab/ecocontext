// Onboarding — checks if the user has completed initial setup, handles seed data

import type { Request, Response } from 'express';
import { getPreference, setPreference, deletePreference, importKnowledge } from './knowledge.js';

const ONBOARDING_KEY = 'onboarding_complete';

function validateApiKeyForProvider(provider: string | undefined, apiKey: string): string | null {
  const key = apiKey.trim();
  if (!provider || !key) return null;

  if (provider === 'gemini') {
    if (/^projects\//i.test(key)) {
      return 'That looks like a Google project id, not a Gemini API key. Use Google AI Studio -> Get API key.';
    }
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(key)) {
      return 'Gemini API key format is invalid.';
    }
  }

  if (provider === 'openai' && !/^sk-[A-Za-z0-9_-]{16,}$/.test(key)) {
    return 'OpenAI API key format is invalid.';
  }

  if (provider === 'anthropic' && !/^sk-ant-[A-Za-z0-9_-]{12,}$/.test(key)) {
    return 'Anthropic API key format is invalid.';
  }

  return null;
}

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

  if (apiKey) {
    const validationError = validateApiKeyForProvider(provider, apiKey);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
  }

  if (name) setPreference('user_name', name);
  if (role) setPreference('user_role', role);
  if (company) setPreference('user_company', company);
  if (style) setPreference('communication_style', style);
  if (provider) setPreference('llm_provider', provider);
  if (apiKey) {
    const normalized = apiKey.trim();
    setPreference('llm_api_key', normalized);
    if (provider === 'anthropic') setPreference('anthropic_api_key', normalized);
    if (provider === 'openai') setPreference('openai_api_key', normalized);
    if (provider === 'gemini') setPreference('gemini_api_key', normalized);
  }
  setPreference(ONBOARDING_KEY, 'true');

  res.json({ ok: true });
}

export function handleOnboardingReset(_req: Request, res: Response): void {
  deletePreference(ONBOARDING_KEY);
  deletePreference('llm_provider');
  deletePreference('llm_api_key');
  deletePreference('anthropic_api_key');
  deletePreference('openai_api_key');
  deletePreference('gemini_api_key');
  res.json({ ok: true });
}
