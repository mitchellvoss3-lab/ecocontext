import type { Request, Response } from 'express';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = 'llama3.2:3b';
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalRequest(req: Request): boolean {
  return LOCAL_IPS.has(req.socket.remoteAddress ?? '');
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
    };
  }
}

async function hasCommand(command: string): Promise<boolean> {
  const result = await runCommand('sh', ['-lc', `command -v ${command}`], 10_000);
  return result.ok;
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    return res.ok;
  } catch {
    return false;
  }
}

async function listModels(): Promise<string[]> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) return [];
    const json = await res.json() as { models?: Array<{ name?: string }> };
    return (json.models ?? []).map(m => m.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

function validateModelName(model: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/i.test(model);
}

export async function getOllamaStatus(req: Request, res: Response): Promise<void> {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Ollama setup endpoints are local-only.' });
    return;
  }

  const installed = await hasCommand('ollama');
  const running = installed ? await isOllamaRunning() : false;
  const models = running ? await listModels() : [];

  res.json({
    installed,
    running,
    models,
    recommendedModel: DEFAULT_MODEL,
  });
}

export async function setupOllama(req: Request, res: Response): Promise<void> {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Ollama setup endpoints are local-only.' });
    return;
  }

  const {
    autoInstall = true,
    startService = true,
    pullModel = DEFAULT_MODEL,
  } = (req.body ?? {}) as {
    autoInstall?: boolean;
    startService?: boolean;
    pullModel?: string;
  };

  if (!validateModelName(pullModel)) {
    res.status(400).json({ error: 'Invalid model name format.' });
    return;
  }

  const actions: string[] = [];
  let installed = await hasCommand('ollama');

  if (!installed && autoInstall) {
    if (process.platform === 'darwin') {
      const hasBrew = await hasCommand('brew');
      if (!hasBrew) {
        res.status(400).json({
          error: 'Homebrew is required for automatic Ollama install on macOS. Install brew first: https://brew.sh',
          actions,
        });
        return;
      }
      actions.push('Installing Ollama via Homebrew...');
      const installResult = await runCommand('brew', ['install', 'ollama'], 20 * 60_000);
      if (!installResult.ok) {
        res.status(500).json({
          error: 'Failed to install Ollama with Homebrew.',
          actions,
          stderr: installResult.stderr,
        });
        return;
      }
      installed = true;
      actions.push('Ollama installed.');
    } else {
      res.status(400).json({
        error: 'Automatic Ollama install is currently implemented for macOS only.',
        actions,
      });
      return;
    }
  }

  if (!installed) {
    res.status(400).json({
      error: 'Ollama is not installed. Install from https://ollama.com/download',
      actions,
    });
    return;
  }

  let running = await isOllamaRunning();
  if (startService && !running) {
    actions.push('Starting Ollama service...');
    // Start detached so the API call can return while service keeps running.
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
    child.unref();
    running = await isOllamaRunning();
    if (!running) {
      actions.push('Service start requested. It may take a few seconds to become available.');
    } else {
      actions.push('Ollama service is running.');
    }
  }

  if (running) {
    actions.push(`Pulling model ${pullModel} (this can take a few minutes)...`);
    const pullResult = await runCommand('ollama', ['pull', pullModel], 30 * 60_000);
    if (!pullResult.ok) {
      res.status(500).json({
        error: `Failed to pull model ${pullModel}.`,
        actions,
        stderr: pullResult.stderr,
      });
      return;
    }
    actions.push(`Model ${pullModel} is ready.`);
  }

  const models = running ? await listModels() : [];
  res.json({
    ok: true,
    installed,
    running,
    models,
    actions,
  });
}
