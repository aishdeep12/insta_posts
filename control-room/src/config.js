import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const e = process.env;
export const cfg = {
  port: Number(e.PORT || 8787),
  host: e.HOST || '127.0.0.1',
  dataDir: path.resolve(ROOT, e.DATA_DIR || 'data'),
  llm: {
    provider: (e.LLM_PROVIDER || 'ollama').toLowerCase(),
    model: e.LLM_MODEL || 'llama3.1:8b',
    baseUrl: (e.LLM_BASE_URL || '').replace(/\/$/, ''),
    apiKey: e.LLM_API_KEY || ''
  },
  search: { provider: (e.SEARCH_PROVIDER || '').toLowerCase(), apiKey: e.SEARCH_API_KEY || '' },
  publish: {
    dryRun: e.DRY_RUN !== '0',
    handle: e.ACCOUNT_HANDLE || 'analytunb',
    igUserId: e.IG_USER_ID || '',
    token: e.IG_ACCESS_TOKEN || '',
    graphVersion: e.GRAPH_VERSION || 'v21.0',
    repoDir: e.IG_REPO_DIR || '',
    rawBase: (e.IG_RAW_BASE || '').replace(/\/$/, '')
  }
};
fs.mkdirSync(cfg.dataDir, { recursive: true });

// Settings Root Master may propose and the user may apply from the UI. Secrets (API keys, tokens, paths)
// are deliberately not here: they only ever come from .env.
const OVERRIDE = path.join(cfg.dataDir, 'config.override.json');
export const SETTABLE = {
  LLM_PROVIDER: v => ['ollama', 'openai', 'anthropic', 'mock'].includes(v),
  LLM_MODEL: v => /^[\w.:\/\-]{1,100}$/.test(v),
  LLM_BASE_URL: v => v === '' || /^https?:\/\/[^\s]+$/.test(v),
  SEARCH_PROVIDER: v => ['', 'brave', 'tavily'].includes(v),
  DRY_RUN: v => ['0', '1'].includes(v),
  ACCOUNT_HANDLE: v => /^[A-Za-z0-9._]{1,30}$/.test(v)
};
function applyOne(key, v) {
  if (key === 'LLM_PROVIDER') cfg.llm.provider = v;
  else if (key === 'LLM_MODEL') cfg.llm.model = v;
  else if (key === 'LLM_BASE_URL') cfg.llm.baseUrl = v.replace(/\/$/, '');
  else if (key === 'SEARCH_PROVIDER') cfg.search.provider = v;
  else if (key === 'DRY_RUN') cfg.publish.dryRun = v !== '0';
  else if (key === 'ACCOUNT_HANDLE') cfg.publish.handle = v;
}
export function setConfig(key, value) {
  const v = String(value ?? '');
  if (!SETTABLE[key]) throw new Error(`${key} cannot be changed from the UI. Edit .env for it.`);
  if (!SETTABLE[key](v)) throw new Error(`Invalid value for ${key}`);
  applyOne(key, v);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(OVERRIDE, 'utf8')); } catch { /* first change */ }
  saved[key] = v;
  fs.writeFileSync(OVERRIDE, JSON.stringify(saved, null, 2));
}
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(OVERRIDE, 'utf8')))) if (SETTABLE[k]?.(String(v))) applyOne(k, String(v)); } catch { /* none yet */ }
