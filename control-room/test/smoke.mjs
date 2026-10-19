// Run with: npm test   (uses the mock model, no network, no keys)
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LLM_PROVIDER = 'mock';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-room-'));
process.env.DRY_RUN = '1';
const { server } = await import('../server.js');
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'Content-Type': 'application/json', 'X-Control-Room': '1' };
const call = async (p, body, method) => {
  const r = await fetch(base + p, { method: method || (body === undefined ? 'GET' : 'POST'), headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
let pass = 0; const ok = (name) => { pass++; console.log('ok -', name); };

// health + static page
let r = await call('/api/health'); assert.equal(r.json.provider, 'mock'); ok('health reports the model');
assert.match(await (await fetch(base + '/')).text(), /Control Room/); ok('serves the UI');
assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404); ok('static path stays inside public/');

// security gates
assert.equal((await fetch(base + '/api/plugins/approve', { method: 'POST', body: '{}' })).status, 403); ok('writes need the X-Control-Room header');
const hostStatus = await new Promise(res => http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/health', headers: { Host: 'evil.example' } }, r2 => { r2.resume(); res(r2.statusCode); }));
assert.equal(hostStatus, 403); ok('requests with a foreign Host header are refused (DNS rebinding)');

// llm proxy
r = await call('/api/llm', { prompt: 'hello' }); assert.equal(r.json.text, 'Mock reply.'); ok('llm proxy answers');

// config: allowlist + validation
r = await call('/api/config', { key: 'LLM_MODEL', value: 'qwen2.5:7b' }); assert.equal(r.json.model, 'qwen2.5:7b'); ok('config change applies');
r = await call('/api/config', { key: 'LLM_API_KEY', value: 'x' }); assert.equal(r.status, 500); ok('secrets cannot be changed through the API');
r = await call('/api/config', { key: 'DRY_RUN', value: 'maybe' }); assert.equal(r.status, 500); ok('invalid config values are rejected');

// plugin: draft -> pending -> blocked -> approve -> run
const code = `import sys, json\nd = json.load(sys.stdin)\nprint("echo:" + d["task"].upper())\n`;
r = await call('/api/plugins/draft', { name: 'Echo', instructions: 'Echoes the task in capitals', code, filename: 'echo.py', parent: 'master' });
const id = r.json.plugin.id; assert.equal(r.json.plugin.status, 'pending'); assert.equal(r.json.plugin.language, 'python'); ok('code is drafted as pending');
r = await call('/api/plugins/run', { id, task: 'hi' }); assert.equal(r.status, 500); assert.match(r.json.error, /not approved/); ok('unapproved code does not run');
await call('/api/plugins/approve', { id });
r = await call('/api/plugins/run', { id, task: 'hi' }); assert.equal(r.json.stdout.trim(), 'echo:HI'); ok('approved code runs');
const js = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).task.length))`;
r = await call('/api/plugins/draft', { instructions: 'Counts characters', code: js, filename: 'count.js' }); const id2 = r.json.plugin.id;
await call('/api/plugins/approve', { id: id2 });
r = await call('/api/plugins/run', { id: id2, task: 'abcd' }); assert.equal(r.json.stdout.trim(), '4'); ok('node code runs too');
r = await call('/api/plugins/code', { id: '../../etc' }); assert.equal(r.status, 500); ok('plugin ids cannot traverse paths');
r = await call('/api/plugins'); assert.ok(r.json.plugins.length >= 2); ok('plugins are listed');

// db
await call('/api/db', { path: 'handoff/latest', data: { a: 1 } }, 'PUT');
r = await call('/api/db?path=handoff%2Flatest'); assert.equal(r.json.data.a, 1); ok('db round trip');

// publish dry run (needs sharp)
let sharpOK = true; try { await import('sharp'); } catch { sharpOK = false; }
if (sharpOK) {
  r = await call('/api/publish', { package: { topic: 'Test post', caption: 'Hello', slides: [{ kind: 'cover', headline: 'Hello world', body: 'Swipe' }, { kind: 'point', label: 'one', headline: 'A point', body: 'Some words here.' }, { kind: 'close', headline: 'Save this', body: 'Follow' }] } });
  assert.equal(r.json.mode, 'dry-run'); assert.ok(fs.existsSync(path.join(r.json.folder, 'slide-1.png'))); ok('dry-run publish renders slides and posts nothing');
} else console.log('skip - publish dry run (npm install sharp to enable)');

console.log(`\n${pass} checks passed`);
server.close(); process.exit(0);
