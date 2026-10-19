// Poster pipeline run by the server: render slides to PNG -> (live mode) push them to your GitHub repo
// clone so they have public URLs -> publish a carousel with the Instagram Graph API.
// DRY_RUN=1 (the default) stops after rendering and writes everything to data/out/<mission>/.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';

const exec = promisify(execFile);
const W = 1080, H = 1350, M = 90;
const ACCENTS = ['#22D3EE', '#A78BFA', '#FBBF24', '#F472B6', '#60A5FA', '#6EE7B7'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post';

function wrap(text, size, maxW) {
  const per = size * 0.56, lim = Math.max(8, Math.floor(maxW / per)), out = []; let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length <= lim) cur = (cur + ' ' + w).trim(); else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}
function block(lines, x, y, size, fill, weight = 800, gap = 1.12) {
  return lines.map((l, i) => `<text x="${x}" y="${y + i * size * gap}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`).join('');
}

export function slideSVG(s, i, n, handle) {
  const acc = ACCENTS[i % ACCENTS.length];
  let body = '';
  if (s.kind === 'cover') {
    const lines = wrap(String(s.headline).toUpperCase(), 118, W - 2 * M);
    body = block(lines, M, 520, 118, '#F0F4FF') + `<text x="${M}" y="${520 + lines.length * 132 + 40}" font-size="52" font-weight="500" fill="${acc}">${esc(s.body || 'Swipe')}</text>`;
  } else if (s.kind === 'close') {
    const h = wrap(s.headline, 88, W - 2 * M);
    body = block(h, M, 440, 88, '#F0F4FF') + block(wrap(s.body || '', 44, W - 2 * M), M, 440 + h.length * 100 + 50, 44, '#96A0BE', 500, 1.35);
  } else {
    const h = wrap(s.headline, 92, W - 2 * M), b = wrap(s.body || '', 44, W - 2 * M - 20);
    body = `<text x="${M}" y="500" font-size="220" font-weight="800" fill="${acc}">${String(i).padStart(2, '0')}</text>` +
      `<text x="${M}" y="585" font-size="40" font-weight="600" fill="#96A0BE">${esc((s.label || '').toUpperCase())}</text>` +
      block(h, M, 690, 92, '#F0F4FF') + block(b, M, 690 + h.length * 103 + 40, 44, '#E3E8F8', 400, 1.35);
  }
  const dots = Array.from({ length: n }, (_, k) => `<circle cx="${M + k * 34}" cy="${H - 100}" r="${k === i ? 9 : 6}" fill="${k === i ? acc : '#3C4664'}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, Helvetica, Arial, sans-serif">
<defs><radialGradient id="g" cx="0.92" cy="0.02" r="0.6"><stop offset="0" stop-color="${acc}" stop-opacity="0.55"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="#0B1020"/><rect width="${W}" height="${H}" fill="url(#g)"/>
<text x="${M}" y="110" font-size="30" font-weight="700" fill="#F0F4FF">${esc(handle.toUpperCase())}</text>${body}${dots}
${i < n - 1 ? `<text x="${W - M}" y="${H - 90}" text-anchor="end" font-size="40" font-weight="600" fill="${acc}">Swipe →</text>` : ''}</svg>`;
}

async function renderPNGs(slides, handle) {
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { throw new Error('Rendering needs the "sharp" package. Run: npm install sharp'); }
  return Promise.all(slides.map((s, i) => sharp(Buffer.from(slideSVG(s, i, slides.length, handle))).png().toBuffer()));
}

async function graph(method, p, params) {
  const base = `https://graph.facebook.com/${cfg.publish.graphVersion}`;
  const body = new URLSearchParams({ ...params, access_token: cfg.publish.token });
  const r = await fetch(method === 'GET' ? `${base}/${p}?${body}` : `${base}/${p}`, method === 'GET' ? {} : { method, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Instagram API: ${j.error?.message || 'HTTP ' + r.status}`);
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitReady(id) {
  for (let k = 0; k < 20; k++) {
    const j = await graph('GET', id, { fields: 'status_code' });
    if (j.status_code === 'FINISHED') return;
    if (j.status_code === 'ERROR' || j.status_code === 'EXPIRED') throw new Error(`Instagram could not process the media (${j.status_code})`);
    await sleep(3000);
  }
  throw new Error('Instagram media is still processing after 60s. Check your account before retrying.');
}

export function status() {
  const p = cfg.publish;
  return { dryRun: p.dryRun, live: !p.dryRun && !!(p.igUserId && p.token && p.repoDir && p.rawBase) };
}

export async function publish(pkg) {
  const p = cfg.publish;
  const slides = pkg?.slides, caption = pkg?.caption;
  if (!Array.isArray(slides) || slides.length < 1 || slides.length > 10 || !caption) throw new Error('The package needs a caption and 1 to 10 slides');
  const folder = `${new Date().toISOString().slice(0, 10)}-${slug(pkg.topic || 'post')}`;
  const outDir = path.join(cfg.dataDir, 'out', folder);
  fs.mkdirSync(outDir, { recursive: true });
  const pngs = await renderPNGs(slides, p.handle);
  pngs.forEach((b, i) => fs.writeFileSync(path.join(outDir, `slide-${i + 1}.png`), b));
  fs.writeFileSync(path.join(outDir, 'caption.md'), `${caption}\n\nAlt text: ${pkg.altText || ''}\n`);
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2));
  if (p.dryRun) return { mode: 'dry-run', message: `Rendered ${pngs.length} slides. Nothing was posted. Set DRY_RUN=0 and the IG_* values in .env to publish.`, folder: outDir };
  if (!(p.igUserId && p.token && p.repoDir && p.rawBase)) throw new Error('Live mode needs IG_USER_ID, IG_ACCESS_TOKEN, IG_REPO_DIR and IG_RAW_BASE in .env');

  // 1. host the slides on GitHub
  const dest = path.join(p.repoDir, 'posts', folder);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, f), path.join(dest, f));
  const git = (...a) => exec('git', a, { cwd: p.repoDir, timeout: 120000 });
  await git('add', `posts/${folder}`);
  await git('commit', '-m', `Add post ${folder}`);
  await git('push');
  const urls = pngs.map((_, i) => `${p.rawBase}/posts/${folder}/slide-${i + 1}.png`);
  for (let k = 0; k < 20; k++) { const r = await fetch(urls[urls.length - 1], { method: 'HEAD' }); if (r.ok) break; if (k === 19) throw new Error('The pushed slides are not reachable at their public URL yet'); await sleep(3000); }

  // 2. publish the carousel
  const ig = p.igUserId;
  let creation;
  if (urls.length === 1) creation = (await graph('POST', `${ig}/media`, { image_url: urls[0], caption })).id;
  else {
    const kids = [];
    for (const u of urls) kids.push((await graph('POST', `${ig}/media`, { image_url: u, is_carousel_item: 'true' })).id);
    for (const id of kids) await waitReady(id);
    creation = (await graph('POST', `${ig}/media`, { media_type: 'CAROUSEL', children: kids.join(','), caption })).id;
  }
  await waitReady(creation);
  const pub = await graph('POST', `${ig}/media_publish`, { creation_id: creation });
  let permalink = '';
  try { permalink = (await graph('GET', pub.id, { fields: 'permalink' })).permalink || ''; } catch { /* optional */ }
  return { mode: 'live', message: 'Published to Instagram.', mediaId: pub.id, permalink, urls };
}
