// 速さの計測用の模擬サーバー（合成データだけ。本番の Supabase・Toast・Google にはつながない）。
// ・HTTP  :APP_PORT   アプリ（APP_DIR の index.html・sw.js・appicons）。GitHub Pages と同じく gzip・ETag・max-age=600
// ・HTTPS :443        Supabase（REST・Edge Function）・jsdelivr（supabase-js・アイコン）・open-meteo を Host ごとに返す
// ・回線の遅さ：応答ごとに RTT を待ち、全部の応答で 1 本の帯域（BPS）を分け合う（端末の回線 1 本のつもり）
// ・/__log で、どの要求がいつ・何バイト（圧縮後）だったかを返す（PIN・本文は記録しない）
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createMock } from './mock-api.mjs';

const APP_DIR = process.env.APP_DIR || path.resolve(new URL('../..', import.meta.url).pathname);
const APP_PORT = Number(process.env.APP_PORT || 8080);
const VENDOR = process.env.VENDOR_DIR;            // node_modules（@supabase/supabase-js・@tabler/icons-webfont）
const CERT = process.env.CERT_DIR;                // key.pem・cert.pem
const DATA = process.env.DATA_FILE;               // 合成データ（gen-data.mjs が作る JSON）

let RTT = Number(process.env.RTT_MS || 0);        // 応答ごとの往復の遅れ
let BPS = Number(process.env.BPS || 0);           // 回線の帯域（バイト/秒）。0 は無制限
let mock = createMock(JSON.parse(fs.readFileSync(DATA, 'utf8')));
let delays = {};   // 要求の道ごとの遅れ（e2e-check.mjs）
let wfail = {};    // v1127：書き込みをわざと失敗させる（ux-check.mjs）
let log = [], t0 = Date.now();
// 返している途中の要求（終わってから log に入るので、大きな応答の途中を「止まった」と見ないため）
const inflight = new Map(); let inflightId = 0;
function track(req, res) { const id = ++inflightId; inflight.set(id, String(req.url).slice(0, 160)); res.once('close', () => inflight.delete(id)); }

// 1 本の回線：要求の順に少しずつ流す（同時の応答は帯域を分け合う）
let bucket = { busy: Promise.resolve() };
async function sendThrottled(res, buf) {
  if (!BPS) { res.end(buf); return; }
  const CH = 16 * 1024;
  for (let i = 0; i < buf.length; i += CH) {
    const part = buf.subarray(i, i + CH);
    const wait = (part.length / BPS) * 1000;
    const prev = bucket.busy; let done; bucket.busy = new Promise(r => (done = r));
    await prev; await new Promise(r => setTimeout(r, wait)); done();
    if (!res.write(part)) await new Promise(r => res.once('drain', r));
  }
  res.end();
}
const gzCache = new Map();   // 静的ファイルの圧縮は 1 回だけ（GitHub Pages・CDN も圧縮したものを置いておく）
async function gz(req, buf, type, cacheKey) {
  const ae = String(req.headers['accept-encoding'] || '');
  if (!(buf.length > 512 && /gzip/.test(ae) && /json|javascript|css|html|text|svg/.test(type))) return { body: buf, enc: null };
  if (cacheKey && gzCache.has(cacheKey)) return { body: gzCache.get(cacheKey), enc: 'gzip' };
  const body = await new Promise((res, rej) => zlib.gzip(buf, { level: 6 }, (e, out) => e ? rej(e) : res(out)));
  if (cacheKey) gzCache.set(cacheKey, body);
  return { body, enc: 'gzip' };
}
async function reply(req, res, status, headers, buf, kind, cacheKey) {
  const start = Date.now();
  const type = headers['content-type'] || 'application/octet-stream';
  const { body, enc } = await gz(req, buf, type, cacheKey);
  if (enc) headers['content-encoding'] = enc;
  headers['content-length'] = String(body.length);
  headers['access-control-allow-origin'] = req.headers.origin || '*';
  headers['access-control-expose-headers'] = 'content-range, content-length';
  if (RTT) await new Promise(r => setTimeout(r, RTT));
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || status === 304) { res.end(); }
  else await sendThrottled(res, body);
  log.push({ t: start - t0, ms: Date.now() - start, kind, host: req.headers.host, m: req.method, p: String(req.url).slice(0, 160), s: status, b: status === 304 ? 0 : body.length, raw: buf.length });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const etags = new Map();
function staticFile(req, res, file, cache, kind) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return reply(req, res, 404, { 'content-type': 'text/plain' }, Buffer.from('not found'), kind);
  const buf = fs.readFileSync(file);
  let et = etags.get(file + buf.length + fs.statSync(file).mtimeMs);
  if (!et) { et = '"' + crypto.createHash('md5').update(buf).digest('hex') + '"'; etags.set(file + buf.length + fs.statSync(file).mtimeMs, et); }
  const h = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', etag: et, 'cache-control': cache };
  if (req.headers['if-none-match'] === et) return reply(req, res, 304, h, Buffer.alloc(0), kind);
  return reply(req, res, 200, h, buf, kind, et);
}

// ---- アプリ（GitHub Pages のつもり）
const appServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__log') {
    if (u.searchParams.has('reset')) { log = []; t0 = Date.now(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ t0, log, inflight: [...inflight.values()] })); return;
  }
  if (u.pathname === '/__net') {
    RTT = Number(u.searchParams.get('rtt') ?? RTT); BPS = Number(u.searchParams.get('bps') ?? BPS);
    res.writeHead(200); res.end(JSON.stringify({ RTT, BPS })); return;
  }
  if (u.pathname === '/__reset') { mock = createMock(JSON.parse(fs.readFileSync(DATA, 'utf8'))); delays = {}; wfail = {}; res.writeHead(200); res.end('ok'); return; }
  // 別の端末が保存したつもりで、クラウドの行を変える（e2e-check.mjs）
  if (u.pathname === '/__mutate') {
    const T = mock.T.app_state, at = new Date().toISOString(), changed = [];
    const n = T.find(r => r.key === 'notifications'); if (n) { n.value = [{ id: 'n-new', title: 'new', at }].concat(n.value); changed.push(n.key); }   // 中身だけ（updated_at はそのまま）
    const inv = T.find(r => r.key === 'spl_invoices_F02'); if (inv) { inv.value = inv.value.concat([{ id: 'inv_new_1', storeId: 'F02', date: '2026-10-19', total: 123.45, items: [] }]); inv.updated_at = at; changed.push(inv.key); }
    T.push({ key: 'purchases_NEW', value: [{ id: 'p1', date: '2026-10-19', amt: 9.5 }], updated_at: at }); changed.push('purchases_NEW');
    const ta = T.find(r => r.key === 'tasks_all'); if (ta) { ta.value = ta.value.concat([{ id: 'tk_legacy_new', title: 'old device', store: 'F01', status: '進行中' }]); ta.updated_at = at; changed.push('tasks_all'); }
    const ec = T.find(r => r.key === 'ec_log'); if (ec) { ec.value = ec.value.concat([{ d: 'x' }]); ec.updated_at = at; }   // 必要時だけ取る行（取りに行かないはず）
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ changedKeys: changed })); return;
  }
  // v1104：別の端末が売上（daily_actuals）と予算（spl_budgets_v2）を保存したつもりで、クラウドの行を新しくする
  if (u.pathname === '/__fin_bump') {
    const T = mock.T.app_state, at = new Date().toISOString().replace('Z', '123+00:00'), store = u.searchParams.get('store') || 'F01', day = u.searchParams.get('day') || '2026-10-21';
    const da = T.find(r => r.key === 'daily_actuals_' + store); if (da) { da.value = Object.assign({}, da.value, { [day]: { actual: 4321.5, guests: 99, toastSrc: true, _at: Date.now() } }); da.updated_at = at; }
    const bu = T.find(r => r.key === 'spl_budgets_v2_' + store); if (bu) { bu.value = [Object.assign({}, bu.value[0], { note: 'bumped ' + at })]; bu.updated_at = at; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ at, store, day })); return;
  }
  // v1107：店の保存をサーバーのエラーにする（n 回）・Toast の売上を少し変える（ログインの取り込みが書くように）
  if (u.pathname === '/__fin_fail') { mock.fin.fail[u.searchParams.get('store') || 'F01'] = Number(u.searchParams.get('n') || 1); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(mock.fin)); return; }
  if (u.pathname === '/__toast_bump') { const T = mock.T.toast_sales || []; let n = 0; for (const r of T) { r.net_sales = Math.round((Number(r.net_sales) + 1.25) * 100) / 100; n++; } res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ rows: n })); return; }
  if (u.pathname === '/__fin_drop') { mock.fin.drop = Number(u.searchParams.get('n') || 1); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(mock.fin)); return; }
  if (u.pathname === '/__fin_stat') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(mock.fin)); return; }
  if (u.pathname === '/__fin_row') {   // クラウドの行の版と、その日の値（中身の全部は返さない）
    const T = mock.T.app_state, key = u.searchParams.get('key'), day = u.searchParams.get('day');
    const r = T.find(x => x.key === key);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r ? { key, updated_at: r.updated_at, day: day && r.value && !Array.isArray(r.value) ? r.value[day] || null : undefined, note: Array.isArray(r.value) ? r.value[0].note || null : undefined } : null)); return;
  }
  if (u.pathname === '/__index') { process.env.HAS_INDEX = u.searchParams.get('on') === '0' ? '0' : '1'; mock = createMock(JSON.parse(fs.readFileSync(DATA, 'utf8'))); res.writeHead(200); res.end(process.env.HAS_INDEX); return; }   // SQL の関数がある／無い
  // v1127：書き込みをわざと失敗させる（path の POST・PATCH を n 回、status で返す）。保存の知らせ・送信待ちの確かめ用
  if (u.pathname === '/__wfail') { wfail[u.searchParams.get('path') || '/rest/v1/app_state'] = { n: Number(u.searchParams.get('n') || 1), status: Number(u.searchParams.get('status') || 503) }; res.writeHead(200); res.end(JSON.stringify(wfail)); return; }
  if (u.pathname === '/__delay') { delays[u.searchParams.get('path')] = Number(u.searchParams.get('ms') || 0); res.writeHead(200); res.end('ok'); return; }
  let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  const file = path.join(APP_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
  return staticFile(req, res, file, 'max-age=600', 'app');
});

// ---- 外のサービス（Supabase・jsdelivr・open-meteo）
const ext = https.createServer({ key: fs.readFileSync(path.join(CERT, 'key.pem')), cert: fs.readFileSync(path.join(CERT, 'cert.pem')) }, async (req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  const u = new URL(req.url, 'https://' + host);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,PUT,OPTIONS', 'access-control-max-age': '86400' });
    res.end(); return;
  }
  if (host === 'cdn.jsdelivr.net') {
    if (u.pathname.startsWith('/npm/@supabase/supabase-js@2')) return staticFile(req, res, path.join(VENDOR, '@supabase/supabase-js/dist/umd/supabase.js'), 'public, max-age=604800', 'cdn');
    const m = u.pathname.match(/^\/npm\/@tabler\/icons-webfont@[^/]+\/(.*)$/);
    if (m) return staticFile(req, res, path.join(VENDOR, '@tabler/icons-webfont', m[1]), 'public, max-age=31536000, immutable', 'cdn');
    return reply(req, res, 404, { 'content-type': 'text/plain' }, Buffer.from('nf'), 'cdn');
  }
  if (/open-meteo\.com$/.test(host)) return reply(req, res, 200, { 'content-type': 'application/json' }, Buffer.from('{"daily":{"time":[],"weathercode":[],"temperature_2m_max":[],"precipitation_sum":[]}}'), 'ext');
  if (/supabase\.co$/.test(host)) {
    track(req, res);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    if (delays[u.pathname]) await new Promise(r => setTimeout(r, delays[u.pathname]));
    const wf = wfail[u.pathname];
    if (wf && wf.n > 0 && (req.method === 'POST' || req.method === 'PATCH')) { wf.n--; await reply(req, res, wf.status, { 'content-type': 'application/json' }, Buffer.from('{"message":"injected failure"}'), 'api'); return; }
    let wkeys = null;   // 書いた行のキーだけ（中身は記録しない）
    if (req.method === 'POST' && u.pathname === '/rest/v1/app_state') { try { const j = JSON.parse(body); wkeys = (Array.isArray(j) ? j : [j]).map(x => x.key); } catch (e) { } }
    let r;
    try { r = mock.handle(req.method, u, req.headers, body); }
    catch (e) { r = { status: 500, body: JSON.stringify({ error: String(e && e.message || e) }) }; }
    if (r.waitUntil) await new Promise(res => setTimeout(res, Math.max(0, r.waitUntil - Date.now())));
    const h = Object.assign({ 'content-type': 'application/json' }, r.headers || {});
    await reply(req, res, r.status, h, Buffer.from(r.body == null ? '' : r.body), r.kind || 'api');
    if (wkeys) log[log.length - 1].keys = wkeys;
    // v1104：Toast の取り込みで頼んだ日付（時間帯の確かめ。日付だけを記録する）
    if (u.pathname === '/functions/v1/hyper-worker') { try { const j = JSON.parse(body || '{}'); const d = {}; for (const k of Object.keys(j)) if (/date|day|from|to|ym|month/i.test(k) && typeof j[k] === 'string' && j[k].length <= 32) d[k] = j[k]; log[log.length - 1].dates = d; } catch (e) { } }
    return;
  }
  return reply(req, res, 404, { 'content-type': 'text/plain' }, Buffer.from('nf'), 'ext');
});
ext.on('upgrade', (req, sock) => { log.push({ t: Date.now() - t0, kind: 'ws', host: req.headers.host, p: String(req.url).slice(0, 80), s: 'refused' }); sock.destroy(); });

appServer.listen(APP_PORT, '127.0.0.1', () => ext.listen(443, '127.0.0.1', () => console.log('ready', APP_PORT)));
