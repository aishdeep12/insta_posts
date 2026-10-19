// One function, four providers. To go cheaper, change LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL in .env.
// Everything else (agents, tool use, code integration) is model-agnostic: tools are driven through a
// plain JSON protocol in the prompt, so a small local model works as long as it can emit JSON.
import { cfg } from './config.js';

const TIMEOUT_MS = 120000;

async function post(url, headers, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${cfg.llm.provider} returned HTTP ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`The model did not answer within ${TIMEOUT_MS / 1000}s`);
    throw e;
  } finally { clearTimeout(timer); }
}

const providers = {
  async ollama(prompt) {
    const base = cfg.llm.baseUrl || 'http://127.0.0.1:11434';
    const j = await post(`${base}/api/chat`, {}, { model: cfg.llm.model, stream: false, messages: [{ role: 'user', content: prompt }], options: { temperature: 0.3 } });
    return j.message?.content ?? '';
  },
  async openai(prompt) {
    const base = cfg.llm.baseUrl || 'https://api.openai.com/v1';
    const headers = cfg.llm.apiKey ? { Authorization: `Bearer ${cfg.llm.apiKey}` } : {};
    const j = await post(`${base}/chat/completions`, headers, { model: cfg.llm.model, temperature: 0.3, messages: [{ role: 'user', content: prompt }] });
    return j.choices?.[0]?.message?.content ?? '';
  },
  async anthropic(prompt) {
    const base = cfg.llm.baseUrl || 'https://api.anthropic.com';
    const j = await post(`${base}/v1/messages`, { 'x-api-key': cfg.llm.apiKey, 'anthropic-version': '2023-06-01' }, { model: cfg.llm.model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },
  async mock(prompt) { return mockReply(prompt); }
};

export async function complete(prompt) {
  const fn = providers[cfg.llm.provider];
  if (!fn) throw new Error(`Unknown LLM_PROVIDER "${cfg.llm.provider}". Use ollama, openai, anthropic or mock.`);
  return String(await fn(String(prompt))).trim();
}
export const describeModel = () => ({ provider: cfg.llm.provider, model: cfg.llm.model });

/* ---- deterministic stand-in used by tests and for trying the UI with no model ---- */
function mockReply(p) {
  const words = s => (s.toLowerCase().match(/[a-z]{4,}/g) || []).slice(0, 8);
  if (p.includes('PLUGIN_MANIFEST')) {
    const instr = (p.match(/INSTRUCTIONS:\n([\s\S]*?)\nCODE:/) || [, ''])[1];
    return JSON.stringify({ name: 'Code Worker', role: 'Code agent', speciality: instr.slice(0, 120) || 'Runs the supplied code', handles: [...new Set(['code', 'run', ...words(instr)])].slice(0, 10), accepts: 'A task as text', returns: 'The output of the code' });
  }
  if (p.includes('\nTOOLS\n')) {
    const last = (p.match(/Conversation:\n([\s\S]*?)\n\nReply as/) || [, ''])[1].split('\n').filter(l => l.startsWith('User:')).pop() || '';
    if (p.includes('TOOL RESULT')) return JSON.stringify({ final: 'Done.' });
    if (/create .*domain/i.test(last) && p.includes('create_domain(')) return JSON.stringify({ tool: 'create_domain', args: { name: 'Research', description: 'Researches topics for the other domains' } });
    return JSON.stringify({ final: 'Mock reply.' });
  }
  if (p.includes('"team":[')) return JSON.stringify({ role: 'Career ops', handles: ['job', 'resume', 'apply', 'interview', 'career', 'hiring', 'cv', 'application'], accepts: 'Job search tasks', returns: 'Plans and drafts',
    team: [{ name: 'Resume Tailor', role: 'Writing', speciality: 'Tailors resumes to a job post', handles: ['resume', 'cv', 'tailor'], accepts: 'A job post', returns: 'A tailored resume' },
           { name: 'Tracker', role: 'Operations', speciality: 'Tracks applications and status', handles: ['track', 'application', 'status'], accepts: 'Updates', returns: 'A status table' }] });
  if (p.includes('Return ONLY JSON: {"role"')) {
    const name = (p.match(/Name: (.*)/) || [, 'agent'])[1];
    return JSON.stringify({ role: 'Specialist', handles: [...new Set(words(name + ' ' + p.slice(p.indexOf('Description'), p.indexOf('Description') + 200)))].slice(0, 10), accepts: 'Tasks in its area', returns: 'A result' });
  }
  if (p.includes('{"topics":[')) {
    const t = i => ({ title: `Topic ${i + 1} from the signals`, why: 'Grounded in the gathered signals.', keywords: [{ k: `keyword ${i}a`, type: 'broad' }, { k: `keyword ${i}b`, type: 'niche' }, { k: `how to ${i}`, type: 'intent' }], sources: [0] });
    return JSON.stringify({ topics: [0, 1, 2, 3, 4].map(t) });
  }
  if (p.includes('"caption":""')) {
    const kw = (p.match(/Keywords: (.*)/) || [, 'ai agents'])[1].split(',')[0].trim();
    return JSON.stringify({ caption: `${kw}: a practical look.\n\nShort and plain.\n\nWhich would you try first?`, hashtags: ['#AIAgents', '#AIEngineering', '#Automation', '#LLM'], alt: 'Dark carousel cover with the topic title.',
      slides: [{ kind: 'cover', headline: 'A practical look', body: 'Swipe' }, { kind: 'point', label: 'one', headline: 'First point', body: 'Plain explanation.' }, { kind: 'point', label: 'two', headline: 'Second point', body: 'Plain explanation.' }, { kind: 'point', label: 'three', headline: 'Third point', body: 'Plain explanation.' }, { kind: 'close', headline: 'Save this', body: 'Follow for more' }] });
  }
  return 'Mock reply.';
}
