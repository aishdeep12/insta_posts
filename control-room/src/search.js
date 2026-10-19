// Optional live search for Trend Scout. Returns sources in the same shape the UI already uses:
// [{src, url, date, points:[...]}]. Needs SEARCH_PROVIDER (brave | tavily) and SEARCH_API_KEY.
import { cfg } from './config.js';

export const canSearch = () => !!(cfg.search.provider && cfg.search.apiKey);

const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const sentences = s => clean(s).split(/(?<=[.!?])\s+/).filter(x => x.length > 25).slice(0, 3);

async function brave(q) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=6&freshness=pm`, { headers: { Accept: 'application/json', 'X-Subscription-Token': cfg.search.apiKey } });
  if (!r.ok) throw new Error(`Brave Search returned HTTP ${r.status}`);
  const j = await r.json();
  return (j.web?.results || []).map(x => ({ src: clean(x.title), url: x.url, date: x.age || 'recent', text: x.description }));
}
async function tavily(q) {
  const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.search.apiKey}` }, body: JSON.stringify({ query: q, max_results: 6, topic: 'news' }) });
  if (!r.ok) throw new Error(`Tavily returned HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).map(x => ({ src: clean(x.title), url: x.url, date: x.published_date || 'recent', text: x.content }));
}

export async function sweep(brief) {
  if (!canSearch()) throw new Error('Search is not configured (set SEARCH_PROVIDER and SEARCH_API_KEY)');
  const fn = cfg.search.provider === 'tavily' ? tavily : cfg.search.provider === 'brave' ? brave : null;
  if (!fn) throw new Error(`Unknown SEARCH_PROVIDER "${cfg.search.provider}"`);
  const year = new Date().getFullYear();
  const queries = [`${brief} trends this month`, `Instagram SEO keywords ${year}`];
  const seen = new Set(), sources = [];
  for (const q of queries) for (const x of await fn(q)) {
    if (seen.has(x.url)) continue; seen.add(x.url);
    const points = sentences(x.text);
    if (points.length) sources.push({ src: x.src.slice(0, 90), url: x.url, date: String(x.date).slice(0, 20), points });
  }
  return { date: new Date().toDateString(), sources: sources.slice(0, 8) };
}
