// Replaces the claude.ai runtime the page used when it was hosted as an artifact.
// window.claude.use('sample') is now a model-agnostic call that goes through your own server, so the
// model behind it is whatever LLM_PROVIDER / LLM_MODEL says in .env. Tool use is done with a plain
// JSON protocol in the prompt, which works with small models that have no native tool calling.
(() => {
  const H = { 'Content-Type': 'application/json', 'X-Control-Room': '1' };
  async function api(url, body, method) {
    const r = await fetch(url, { method: method || (body === undefined ? 'GET' : 'POST'), headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const llm = async prompt => (await api('/api/llm', { prompt })).text;
  const tryJSON = t => {
    const m = String(t).match(/```(?:json)?\s*([\s\S]*?)```/), raw = m ? m[1] : String(t);
    const i = raw.indexOf('{'), j = raw.lastIndexOf('}');
    if (i < 0 || j < i) return null;
    try { return JSON.parse(raw.slice(i, j + 1)); } catch { return null; }
  };

  async function sample(prompt, opts = {}) {
    const tools = opts.tools || [];
    if (!tools.length) return { text: await llm(prompt) };
    const docs = tools.map(t => `- ${t.name}(${Object.entries(t.inputSchema?.properties || {}).map(([k, v]) => `${k}: ${v.type}`).join(', ')}): ${t.description}`).join('\n');
    let transcript = `${prompt}\n\nTOOLS\n${docs}\n\nTo use a tool, reply with ONLY this JSON: {"tool":"<name>","args":{...}}\nWhen you are done, or no tool is needed, reply with ONLY: {"final":"<your reply to the user>"}`;
    for (let step = 0; step < 6; step++) {
      const out = await llm(transcript);
      const act = tryJSON(out);
      if (!act) return { text: out };
      if (act.final !== undefined) return { text: String(act.final) };
      if (!act.tool) return { text: out };
      const t = tools.find(x => x.name === act.tool);
      let res;
      try { res = t ? await t.execute(act.args || {}) : `Unknown tool "${act.tool}". Available: ${tools.map(x => x.name).join(', ')}`; }
      catch (e) { res = `Tool error: ${e.message}`; }
      transcript += `\n\nASSISTANT: ${JSON.stringify(act)}\nTOOL RESULT: ${String(res).slice(0, 800)}\nContinue. Reply with another tool call, or {"final":"..."}.`;
    }
    return { text: 'I stopped after several steps. The event log shows what was done.' };
  }

  const db = { doc: p => ({ set: d => api('/api/db', { path: p, data: d }, 'PUT'), get: () => api('/api/db?path=' + encodeURIComponent(p)) }) };
  window.ctrl = { api, health: api('/api/health').catch(() => null) };
  window.claude = { use: async name => name === 'sample' ? sample : name === 'db' ? db : null };
})();
