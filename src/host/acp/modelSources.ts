import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import type { ModelSources } from '@shared/modelSources';

// Only aliases and source labels leave this module. Endpoint credentials stay in the CLI config.
export function grokModelSources(text: string): ModelSources {
  const config = parse(text);
  const models = config.model;
  const sources: ModelSources = {};
  if (!models || typeof models !== 'object' || Array.isArray(models)) return sources;
  for (const [alias, value] of Object.entries(models)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    // A context-window override alone does not turn a built-in model into a custom endpoint.
    if ('base_url' in value && typeof value.base_url === 'string' && value.base_url.trim()) {
      sources[alias] = { id: alias, name: alias, kind: 'custom' };
    }
  }
  return sources;
}

export async function readModelSources(agent: string, cwd: string, home = homedir()): Promise<ModelSources> {
  if (agent !== 'grok') return {};
  const paths = [join(home, '.grok/config.toml'), join(cwd, '.grok/config.toml')];
  const sources = await Promise.all(paths.map(async path => {
    try { return grokModelSources(await readFile(path, 'utf8')); }
    catch { return {}; }
  }));
  return Object.assign({}, ...sources);
}
