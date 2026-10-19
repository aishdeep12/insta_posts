// Code integration. The user hands Master some code plus instructions; Master (the model) writes the
// registry record, the code is stored under data/plugins/<id>/ as "pending", and it only runs after
// the user reviews and approves it. Contract: the script receives {"task","input"} as JSON on stdin
// (and the task text in the TASK env var) and prints its result to stdout.
//
// SECURITY: approval is a human gate, not a sandbox. Approved code runs as a child process with your
// user's permissions (minimal environment, 30s timeout, output capped). Only approve code you read.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cfg } from './config.js';
import { complete } from './llm.js';

const DIR = path.join(cfg.dataDir, 'plugins');
const MAX_OUT = 64 * 1024, TIMEOUT_MS = 30000;
fs.mkdirSync(DIR, { recursive: true });

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plugin';
const dir = id => path.join(DIR, id);
const readManifest = id => JSON.parse(fs.readFileSync(path.join(dir(id), 'manifest.json'), 'utf8'));
const writeManifest = m => fs.writeFileSync(path.join(dir(m.id), 'manifest.json'), JSON.stringify(m, null, 2));
const validId = id => /^[a-z0-9-]{1,40}$/.test(id) && fs.existsSync(dir(id));

export function list() {
  return fs.readdirSync(DIR).filter(validId).map(id => { try { return readManifest(id); } catch { return null; } }).filter(Boolean);
}
export function get(id) { if (!validId(id)) throw new Error('No such plugin'); return readManifest(id); }
export function code(id) { const m = get(id); return fs.readFileSync(path.join(dir(id), m.entry), 'utf8'); }

function detectLanguage(code, filename = '') {
  if (/\.py$/i.test(filename)) return 'python';
  if (/\.(m?js|cjs)$/i.test(filename)) return 'node';
  if (/^\s*(import\s+\w+\s*$|from\s+\w+\s+import|def\s+\w+\(|print\()/m.test(code) && !/;\s*$/m.test(code)) return 'python';
  return 'node';
}
function parseJSON(t) {
  const m = String(t).match(/```(?:json)?\s*([\s\S]*?)```/), raw = m ? m[1] : String(t);
  const i = raw.search(/[{[]/), j = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  return JSON.parse(raw.slice(i, j + 1));
}
const stripFence = t => { const m = String(t).match(/```[a-z]*\n([\s\S]*?)```/); return (m ? m[1] : String(t)).trim(); };

export async function draft({ name, instructions, code: src, filename, adapt, parent }) {
  if (!src || String(src).trim().length < 3) throw new Error('No code was provided');
  if (String(src).length > 200000) throw new Error('Code is too large (200 KB max)');
  const language = detectLanguage(src, filename);
  let manifest = null;
  try {
    manifest = parseJSON(await complete(
      `PLUGIN_MANIFEST\nYou are Master in a multi-level agent organization. A user handed you code and instructions. Register it as a code-backed agent.\n` +
      `${name ? 'Preferred name: ' + name + '\n' : ''}INSTRUCTIONS:\n${instructions || '(none)'}\nCODE:\n${String(src).slice(0, 6000)}\n\n` +
      `Return ONLY JSON: {"name":"short name","role":"two or three words","speciality":"one sentence on what it does","handles":["8 to 12 lowercase keywords that tasks for it would contain"],"accepts":"one sentence","returns":"one sentence"}`));
  } catch { manifest = null; }
  const words = (instructions || '').toLowerCase().match(/[a-z]{4,}/g) || [];
  manifest = {
    name: String(name || manifest?.name || 'Code Agent').slice(0, 24),
    role: String(manifest?.role || 'Code agent').slice(0, 28),
    speciality: String(manifest?.speciality || instructions || 'Runs the supplied code').slice(0, 240),
    handles: (Array.isArray(manifest?.handles) && manifest.handles.length ? manifest.handles : words).map(h => String(h).toLowerCase().trim()).filter(Boolean).slice(0, 12),
    accepts: String(manifest?.accepts || 'A task as text'), returns: String(manifest?.returns || 'The output of the code')
  };
  let id = slug(manifest.name); const base = id; let n = 2;
  while (fs.existsSync(dir(id))) id = `${base}-${n++}`;
  fs.mkdirSync(dir(id), { recursive: true });
  const ext = language === 'python' ? 'py' : 'js';
  let final = String(src), adapted = false;
  if (adapt) {
    try {
      const out = stripFence(await complete(`Rewrite this ${language} script so it reads one JSON object {"task","input"} from stdin and prints its result to stdout. Keep the logic. Return ONLY the full code.\n\nINSTRUCTIONS:\n${instructions || ''}\n\nCODE:\n${String(src).slice(0, 12000)}`));
      if (out.length > 20) { fs.writeFileSync(path.join(dir(id), `original.${ext}`), String(src)); final = out; adapted = true; }
    } catch { /* keep the original */ }
  }
  const entry = `main.${ext}`;
  fs.writeFileSync(path.join(dir(id), entry), final);
  const m = { id, ...manifest, language, entry, adapted, parent: parent || null, status: 'pending', createdAt: new Date().toISOString() };
  writeManifest(m);
  return m;
}
export function approve(id) { const m = get(id); m.status = 'approved'; m.approvedAt = new Date().toISOString(); writeManifest(m); return m; }
export function disable(id) { const m = get(id); m.status = 'pending'; writeManifest(m); return m; }
export function remove(id) { if (!validId(id)) return false; fs.rmSync(dir(id), { recursive: true, force: true }); return true; }

export function run(id, { task = '', input = '' } = {}) {
  const m = get(id);
  if (m.status !== 'approved') return Promise.reject(new Error(`"${m.name}" is not approved yet. Review its code and approve it first.`));
  const cmd = m.language === 'python' ? (process.platform === 'win32' ? 'python' : 'python3') : process.execPath;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [m.entry], { cwd: dir(id), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TASK: String(task), PLUGIN_ID: id }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS);
    child.stdout.on('data', d => { if (out.length < MAX_OUT) out += d; });
    child.stderr.on('data', d => { if (err.length < MAX_OUT) err += d; });
    child.on('error', e => finish(reject, new Error(`Could not start ${cmd}: ${e.message}`)));
    child.on('close', codeNum => finish(resolve, { exitCode: codeNum, stdout: out.slice(0, MAX_OUT), stderr: err.slice(0, 4000) }));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ task: String(task), input: String(input) }));
  });
}
