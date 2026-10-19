import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfg, ROOT, setConfig } from './src/config.js';
import { complete, describeModel } from './src/llm.js';
import * as plugins from './src/plugins.js';
import { sweep, canSearch } from './src/search.js';
import { publish, status as publishStatus } from './src/poster.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const DB_FILE = path.join(cfg.dataDir, 'db.json');

const readDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; } };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 2e6) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}

// The server can run code you approve, so it only talks to pages it served itself:
// local clients only, Host must be this machine, and writes need a header a foreign website cannot send.
function allowed(req) {
  if (process.env.ALLOW_REMOTE === '1') return true;
  const addr = req.socket.remoteAddress || '';
  const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  return local && ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

const routes = {
  'GET /api/health': async () => ({ ...describeModel(), canSearch: canSearch(), ...publishStatus(), handle: cfg.publish.handle }),
  'POST /api/llm': async req => ({ text: await complete(String(req.body.prompt || '').slice(0, 60000)) }),
  'POST /api/sweep': async req => sweep(String(req.body.brief || 'AI agents').slice(0, 300)),
  'POST /api/publish': async req => publish(req.body.package),
  'POST /api/config': async req => { setConfig(String(req.body.key), req.body.value); return { ...describeModel(), canSearch: canSearch(), ...publishStatus(), handle: cfg.publish.handle }; },
  'GET /api/plugins': async () => ({ plugins: plugins.list() }),
  'POST /api/plugins/draft': async req => ({ plugin: await plugins.draft(req.body) }),
  'POST /api/plugins/approve': async req => ({ plugin: plugins.approve(String(req.body.id)) }),
  'POST /api/plugins/disable': async req => ({ plugin: plugins.disable(String(req.body.id)) }),
  'POST /api/plugins/run': async req => plugins.run(String(req.body.id), req.body),
  'POST /api/plugins/code': async req => ({ code: plugins.code(String(req.body.id)) }),
  'POST /api/plugins/remove': async req => ({ removed: plugins.remove(String(req.body.id)) }),
  'GET /api/db': async req => { const v = readDB()[req.query.get('path')]; return v === undefined ? { exists: false } : { exists: true, data: v }; },
  'PUT /api/db': async req => { const db = readDB(); db[String(req.body.path)] = req.body.data; fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); return { ok: true }; }
};

export const server = http.createServer(async (req, res) => {
  try {
    if (!allowed(req)) return send(res, 403, { error: 'This server only accepts requests from this machine' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-control-room'] !== '1') return send(res, 403, { error: 'Missing X-Control-Room header' });
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'Unknown endpoint' });
      req.query = url.searchParams;
      req.body = req.method === 'GET' ? {} : await body(req);
      return send(res, 200, await handler(req));
    }
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  server.listen(cfg.port, cfg.host, () => {
    const m = describeModel();
    console.log(`Control room: http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);
    console.log(`Model: ${m.provider} / ${m.model}   Search: ${canSearch() ? cfg.search.provider : 'built-in sweep'}   Publishing: ${publishStatus().live ? 'LIVE' : cfg.publish.dryRun ? 'dry run' : 'not configured'}`);
  });
}
