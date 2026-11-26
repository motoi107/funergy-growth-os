// v1222：1 つの「キャリア・育成」（キャリアマップ・カードの 1〜5・役割・責任マトリクス・店舗別の組織マップ・候補者向け・前の行き先）を本物のブラウザ（Chrome）で確かめる。
// 合成データだけ（作りものの店・人）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（APP_DIR で前の版も開ける）
// ・Supabase：tests/perf/mock-api.mjs（SS_REAL=1：本物の関数 secure-state・CSQ4_DB=1 と GP_DB=1：Career Score Q4 と育成計画の本物の SQL を PGlite で）
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/shots/career] node tests/e2e-career/career-hub-v1222.mjs
process.env.SS_REAL = '1'; process.env.CSQ4_DB = '1'; process.env.GP_DB = '1';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
const { createMock } = await import('../perf/mock-api.mjs');

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const APP_DIR = process.env.APP_DIR || ROOT;
const VENDOR = process.env.VENDOR_DIR || '/tmp/e2e/vendor', CERT = process.env.CERT_DIR || '/tmp/e2e/cert', SHOTS = process.env.SHOTS || '';
const PORT = 8097, ORIGIN = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); };

// ---------------------------------------------------------------- 作りものの店・人（実在の店・人ではない）
const STORES = [
  { id: 'F01', name: 'Store A', brand: 'Brand', color: '#335577', am: 'Ann Area', chef: 'Cal Chef', active: true },
  { id: 'F02', name: 'Store B', brand: 'Brand', color: '#8a4b2a', am: 'Ann Area', active: true },
  { id: 'F03', name: 'Store C', brand: 'Brand', color: '#2f7d5b', am: '', active: true },
].map(s => ({ toastGuid: '', hours: '11:00-22:00', days: '毎日', ...s }));
const PEOPLE = [
  ['E1', 'Cora Ceo', 'ceo', 'ALL', 'CEO'], ['E2', 'Gabe Gm', 'gm', 'ALL', 'General Manager'], ['E3', 'Dee Office', 'office', 'OFFICE', 'Accountant'],
  ['E4', 'Oki Crew', 'office_crew', 'OFFICE', 'Office Crew'], ['A1', 'Ann Area', 'am', 'ALL', 'Area Manager'], ['C1', 'Cal Chef', 'chef', 'ALL', 'Head Chef'],
  ['M1', 'Mia Manager', 'g4', 'F01', 'Store Manager'], ['S3', 'Sam Lead', 'sl', 'F01', 'Server Leader'], ['S2', 'Kai Leader', 'g2', 'F01', 'Crew Leader'],
  ['S1', 'Aki Crew', 'crew', 'F01', 'Crew'], ['P1', 'Pia Prep', 'crew', 'F01', 'Prep'], ['B1', 'Ben Help', 'crew', 'F02', 'Crew', ['F01']],
  ['X1', 'Xen Blank', '', 'F02', ''],
].map(([id, name, role, store, title, support]) => ({ id, name, role, store, title, support: support || [] }));
const EMP = p => ({ id: p.id, name: p.name, role: p.role, store: p.store, support: p.support, emp: '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: p.title, firstWorkDate: '2025-01-10' });
const at = new Date().toISOString();
const mock = createMock({ tables: {
  app_state: [{ key: 'ing_v2_backfill_done', value: true, updated_at: at }, { key: 'ing_v2_storeprice_fix', value: true, updated_at: at }],
  app_settings: [], employees: PEOPLE.map(p => ({ id: p.id, name: p.name, role: p.role, data: EMP(p) })),
  stores: STORES.map(s => ({ id: s.id, data: s })), ingredients: [], recipes: [], vendors: [], categories: [],
  toast_sales: [], tip_labor: [], toast_item_sales: [], shift_availability: [], shift_plans: [], manager_auth: [], handbook_test_results: [],
} });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const send = (res, st, h, buf) => { res.writeHead(st, Object.assign({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, h)); res.end(buf); };
const file = (res, f) => fs.existsSync(f) && fs.statSync(f).isFile() ? send(res, 200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }, fs.readFileSync(f)) : send(res, 404, {}, 'nf');
const app = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(APP_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, '')); if (!f.startsWith(APP_DIR)) return send(res, 403, {}, ''); file(res, f);
});
const ext = https.createServer({ key: fs.readFileSync(path.join(CERT, 'key.pem')), cert: fs.readFileSync(path.join(CERT, 'cert.pem')) }, async (req, res) => {
  const host = String(req.headers.host || '').split(':')[0]; const u = new URL(req.url, 'https://' + host);
  if (req.method === 'OPTIONS') return send(res, 204, { 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,PUT,HEAD,OPTIONS' }, '');
  if (host === 'cdn.jsdelivr.net') {
    if (u.pathname.startsWith('/npm/@supabase/supabase-js@2')) return file(res, path.join(VENDOR, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    const tb = u.pathname.match(/^\/npm\/@tabler\/icons-webfont@2\.44\.0\/(.+)$/);
    if (tb) return file(res, path.join(VENDOR, 'node_modules/@tabler/icons-webfont', tb[1].replace(/\.\./g, '')));
    return send(res, 404, {}, 'nf');
  }
  if (/open-meteo\.com$/.test(host)) return send(res, 200, { 'content-type': 'application/json' }, '{"daily":{"time":[],"weathercode":[],"temperature_2m_max":[],"precipitation_sum":[]}}');
  if (/supabase\.co$/.test(host)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    let r; try { r = await mock.handle(req.method, u, Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])), Buffer.concat(chunks).toString('utf8')); } catch (e) { r = { status: 500, body: JSON.stringify({ error: String(e && e.message || e) }) }; }
    if (r && typeof r.then === 'function') r = await r;
    if (r && r.waitUntil) await sleep(Math.max(0, r.waitUntil - Date.now()));
    return send(res, r.status, Object.assign({ 'content-type': 'application/json' }, r.headers || {}), r.body == null ? '' : r.body);
  }
  send(res, 404, {}, 'nf');
});
ext.on('upgrade', (req, sock) => sock.destroy());
await new Promise(r => app.listen(PORT, '127.0.0.1', r)); await new Promise(r => ext.listen(443, '127.0.0.1', r));

const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const all = [];
async function device(width = 390, { lang } = {}) {
  const phone = width < 500;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: phone ? 844 : 860 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', userAgent: phone ? IPHONE : undefined });
  if (lang) await ctx.addInitScript(l => { try { if (!localStorage.getItem('funergy_lang')) localStorage.setItem('funergy_lang', l); } catch (e) {} }, lang);
  const page = await ctx.newPage();
  const D = { ctx, page, errors: [], width };
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => { D.errors.push(String(e.message).slice(0, 200)); });
  all.push(D);
  return D;
}
const waitApp = page => page.waitForFunction(() => { const s = document.getElementById('app-shell'); return !!(s && s.style.display !== 'none' && curUserName) && window._heavyPending === false; }, null, { timeout: 90000 }).then(() => true, () => false);
const overflowX = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page, name, full) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); } };
const root = page => page.evaluate(() => (document.getElementById('cr-root') || {}).innerText || '');
const rootHtml = page => page.evaluate(() => (document.getElementById('cr-root') || {}).innerHTML || '');
async function login(D, store, name, pin = '1234') {
  await D.page.goto(ORIGIN + '/');
  await D.page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await sleep(300);
  await D.page.evaluate(s => loginPickLocation(s), store); await sleep(300);
  await D.page.locator('#login-name-grid .store-btn', { hasText: name }).first().click(); await sleep(400);
  if (await D.page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); })) { await D.page.click('#ml-pin'); await sleep(300); }
  await D.page.fill('#login-pin-input', pin); await D.page.click('#login-pin-btn');
  return waitApp(D.page);
}
async function openCareer(D) { await D.page.evaluate(() => go('career')); await sleep(1500); }
const ss = (page, p) => page.evaluate(x => ssCall(x), p);
const openAll = page => page.evaluate(() => { document.querySelectorAll('#cr-root details').forEach(d => { d.open = true; }); });
const openSteps = page => page.evaluate(() => { document.querySelectorAll('#cr-root details').forEach(d => { d.open = d.classList.contains('cr-step'); }); });

// ================================================================ 1. GM（PC）：最初の画面・評価表を決める・カードの 1〜5・マトリクス・組織マップ
const G = await device(1280);
ok('GM で入る', await login(G, 'OFFICE', 'Gabe Gm'));
const asg = await ss(G.page, { action: 'cs4_assign', items: [
  { emp: 'S1', system: 'G', grade: 'G1', type: 'Server中心', expect: 0 }, { emp: 'M1', system: 'G', grade: 'G4', type: '店長', expect: 0 },
  { emp: 'C1', system: 'S_CHEF', grade: 'S3', expect: 0 }, { emp: 'E3', system: 'S_OFFICE', grade: 'S4', expect: 0 }, { emp: 'P1', system: 'PREP', expect: 0 }] });
ok('（GM が Q4 の評価表を決める：G1・G4・Chef S3・経理 S4・Prep）', asg && asg.ok, asg);
const plan = await ss(G.page, { action: 'gp_plan_save', emp: 'S1', f: { system: 'G', grade: 'G1', type: 'Server中心', target_grade: 'G2', target: 'Crew Leader', strengths: '接客が丁寧', issues: '締めの手順', next_check: '12 月', support: [] } });
ok('（GM が Aki Crew の育成計画を作る）', plan && plan.ok, plan);
if (plan && plan.ok) {
  const g0 = await ss(G.page, { action: 'gp_get', emp: 'S1' });
  const pid = g0 && g0.j && g0.j.plan ? g0.j.plan.id : null;
  const tk = await ss(G.page, { action: 'gp_task_save', plan: pid, f: { title: 'Closing を手順どおりに', items: ['02-03'], standard: 'リストを全部', method: '店長が見る', opportunity: '水曜の締め', trainer: 'S3', checker: 'M1', due: null } });
  ok('（OJT の課題を 1 つ足す）', tk && tk.ok, tk);
}
await openCareer(G);
let t = await root(G.page);
ok('最初の画面：あなたが見るところ・3 つ（キャリアマップ・マトリクス・組織マップ）', /あなたが見るところ/.test(t) && /キャリアマップ/.test(t) && /役割・責任マトリクス/.test(t) && /店舗別の組織マップ/.test(t), t.slice(0, 200));
const lanes = await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-lane')].map(l => [l.querySelector('.cr-lane-h b').innerText, l.querySelectorAll('.cr-card').length]));
ok('キャリアマップ：G・Prep・Chef の S・経理の S の順に 4 つ・どれも 6 枚（Moto さん 11/26 の順）', lanes.length === 4 && lanes.every(x => x[1] === 6) && /^G/.test(lanes[0][0]) && /^Prep/.test(lanes[1][0]) && /^Chef/.test(lanes[2][0]) && /^経理/.test(lanes[3][0]), lanes);
ok('テーマカラー：G＝オレンジ・Prep＝深緑・Chef＝黄色・経理＝紫（カードの帯）', await G.page.evaluate(() => { const top = g => { const c = [...document.querySelectorAll('#cr-root .cr-card')].find(x => x.querySelector('.cr-card-g').innerText.trim() === g); return getComputedStyle(c).borderTopColor; }; return top('G1') === 'rgb(240, 102, 31)' && top('P1') === 'rgb(21, 128, 61)' && top('Chef S1') === 'rgb(234, 179, 8)' && top('経理 S1') === 'rgb(147, 51, 234)'; }));
ok('Chef の S と経理の S は別の系統として出す（G と同じ数字でも同じではない）', /Chef の S/.test(t) && /経理の S/.test(t) && /同じ役職・権限ではありません/.test(t));
ok('GM には役割の文（案）と「案」の印', /文は案・会社の確認待ち/.test(t) && /部門Leader/.test(t));
ok('キャリアマップの職名（Crew・Store Manager・Area Manager＋複数店舗・管轄責任・General Manager＋全社運営責任）', await G.page.evaluate(() => { const c = g => [...document.querySelectorAll('#cr-root .cr-card')].find(x => x.querySelector('.cr-card-g').innerText.trim() === g); return /Crew/.test(c('G1').innerText) && /Store Manager/.test(c('G4').innerText) && /Area Manager\s*複数店舗・管轄責任/.test(c('G5').innerText) && /General Manager\s*全社運営責任/.test(c('G6').innerText); }));
ok('配属のラベル：G1〜G4・Chef S1〜S2・Prep は店舗配属、G5・G6・Chef S3〜S6・経理 S は本部配属', await G.page.evaluate(() => { const lab = [...document.querySelectorAll('#cr-root .cr-card')].map(x => [x.querySelector('.cr-card-g').innerText.trim(), (x.querySelector('.cr-asg') || {}).innerText || '']); const want = g => /^(G[1-4]|Chef S[12]|P[1-6])$/.test(g) ? '店舗配属' : '本部配属'; return lab.length === 24 && lab.every(([g, a]) => a.trim() === want(g)); }));
ok('1280：横にはみ出さない（キャリアマップ）', (await overflowX(G.page)) <= 0);
await shot(G.page, '01-gm-home-map-1280');
await shot(G.page, '01b-gm-home-map-1280-full', true);
// カード：G3 → 1〜5
await G.page.evaluate(() => crOpen('G', 'G3')); await sleep(400);
await openAll(G.page);
t = await root(G.page);
ok('G3 のカード：1 役割 2 評価 3 次の段階 4 スキル・OJT 5 育成計画（同じ形）', ['役割・仕事内容・責任範囲', '評価項目・評価方法', '次のキャリアへの成長条件', '習得するスキル・OJT 項目', '育成計画・現在の進捗'].every(x => t.includes(x)), t.slice(0, 120));
ok('G3：基準点 75・最低条件・担当型・点のつけ方（Q4 のマスターどおり）', /基準点\s*75/.test(t) && /最低条件/.test(t) && /Kitchen中心/.test(t) && /3 点/.test(t), (t.match(/基準点[^\n]{0,20}/) || [])[0]);
ok('G3 → G4：基準点 75 → 85・次の段階の確かめ（5 つ）・自動で上がらない', /75 → 85/.test(t.replace(/\s+/g, ' ')) && /OJT の習得確認/.test(t) && /昇格の申請と承認/.test(t));
ok('未設定の欄は作らず「未設定」と出す（自分で判断できること）', /制度資料に書かれていません（未設定）/.test(t));
await openSteps(G.page); await shot(G.page, '02-gm-card-G3-1280', true);
for (const [k, g, name] of [['S_CHEF', 'S3', '03-gm-card-chefS3-1280'], ['S_OFFICE', 'S4', '04-gm-card-acctS4-1280'], ['PREP', 'P3', '05-gm-card-prepP3-1280']]) {
  await G.page.evaluate(([a, b]) => crOpen(a, b), [k, g]); await sleep(300); await openAll(G.page);
  const x = await root(G.page);
  ok(name.slice(3) + '：同じ 1〜5 の形', ['役割・仕事内容・責任範囲', '評価項目・評価方法', '次のキャリアへの成長条件', '習得するスキル・OJT 項目', '育成計画・現在の進捗'].every(y => x.includes(y)));
  if (k === 'PREP') ok('Prep：時給は別の決まり（この画面では出さない）', /時給・Tip Rate・賞与・福利厚生は別の決まりです/.test(x) && !/\$\s?\d/.test(x));
  if (k === 'PREP') ok('Prep：今のアプリの決まりと改定の方針（未反映）を分ける・習得範囲と速さは別', /今のアプリの決まり/.test(x) && /改定の方針（まだアプリに入っていません）/.test(x) && /5 段階/.test(x) && /別日に 3 回/.test(x) && /別々の評価/.test(x) && !/\$\s?\d/.test(x));
  if (k === 'S_CHEF') ok('Chef S3：基準点 75・衛生安全の最低条件', /基準点\s*75/.test(x) && /衛生安全/.test(x));
  if (k === 'S_OFFICE') ok('経理 S4：基準点 85・品質管理の最低条件', /基準点\s*85/.test(x) && /品質管理/.test(x));
  await openSteps(G.page); await shot(G.page, name, true);
}
// 5：育成計画（GM はこの等級の人を開ける）
await G.page.evaluate(() => crOpen('G', 'G1')); await sleep(800); await openAll(G.page);
t = await root(G.page);
ok('G1 のカードの 5：担当する人（Aki Crew）の計画を開ける', /Aki Crew/.test(t), t.slice(t.indexOf('育成計画・現在の進捗'), t.indexOf('育成計画・現在の進捗') + 200));
await G.page.evaluate(() => crPlanOf('S1')); await sleep(1500);
t = await root(G.page);
ok('育成計画・OJT：対象の人の名前と OJT（Closing を手順どおりに）', /Aki Crew/.test(t) && /Closing を手順どおりに/.test(t));
await shot(G.page, '06-gm-plan-1280', true);
// マトリクス
await G.page.evaluate(() => { crSet('view', 'map'); crSet('view', 'matrix'); }); await sleep(400);
t = await root(G.page);
ok('マトリクス：分類（日常業務・スタッフ育成・数値管理・経理業務・調理・品質管理・仕込み）と凡例（記号と言葉）', ['日常業務', 'スタッフ育成', '数値管理', '経理業務', '調理・品質管理', '仕込み'].every(x => t.includes(x)) && /責任を持つ/.test(t) && /対象外/.test(t));
ok('マトリクス：役職上の責任とアプリの権限は別と書く', /アプリで操作できる範囲（権限）は別/.test(t));
await shot(G.page, '07-gm-matrix-daily-1280');
await G.page.evaluate(() => crSet('cat', 'people')); await sleep(300);
t = await root(G.page);
ok('マトリクス「スタッフ育成」：G・Chef の S・経理の S を並べる', /G（店舗・本部の運営）/.test(t) && /Chef の S/.test(t) && /経理の S/.test(t));
ok('マトリクス：業務の注と評価項目の ID も出す（前の役割と責任マップと同じ）', /Tip Rate の決まり・承認の流れは別の決まりのまま/.test(t) && /08-06/.test(t));
await shot(G.page, '08-gm-matrix-people-1280', true);
// 役割の文とマトリクスが矛盾しない（同じマスターの印から出す）
const consistent = await G.page.evaluate(() => {
  const R = window.FUNERGY_ROLE_GUIDE; let bad = [];
  R.systems.forEach(s => s.duties.forEach(d => Object.keys(d.marks || {}).forEach(g => { if (!s.grades.some(x => x.grade === g)) bad.push(d.id + ':' + g); })));
  return bad;
});
ok('マトリクスの等級はどれもその系統の等級（役割の説明と同じマスター）', consistent.length === 0, consistent);
// 組織マップ
await G.page.evaluate(() => { crSet('view', 'org'); crSet('org', 'F01'); }); await sleep(1500);
t = await root(G.page);
const orgRows = await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-org tr')].slice(1).map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim())));
const f01 = PEOPLE.filter(p => p.store === 'F01' || p.support.includes('F01') || p.name === 'Ann Area' || p.name === 'Cal Chef').map(p => p.name).sort();
ok('組織マップ Store A：所属・兼務・店舗マスターの AM と Chef が 1 人 1 行', JSON.stringify(orgRows.map(r => r[0].split('\n')[0].replace(/\s+(兼務|管轄|担当).*$/, '').trim()).sort()) === JSON.stringify(f01), orgRows.map(r => r[0]));
ok('組織マップ：兼務・管轄 AM・担当 Chef の印', /兼務（応援）/.test(t) && /管轄 AM（店舗マスター）/.test(t) && /担当 Chef（店舗マスター）/.test(t));
const rowOf = n => orgRows.find(r => r[0].startsWith(n)) || [];
ok('組織マップ：肩書きと Grade（従業員マスター）が元のデータと同じ', rowOf('Sam Lead')[1] === 'Server Leader' && rowOf('Sam Lead')[2] === 'G3' && rowOf('Pia Prep')[2] === 'G1-P' && rowOf('Mia Manager')[2] === 'G4', [rowOf('Sam Lead'), rowOf('Pia Prep')]);
ok('組織マップ（GM＝採点できる）：Q4 の評価表の列（Chef S3・Prep・G1）', /Chef S3/.test(rowOf('Cal Chef').join(' ')) && /Prep/.test(rowOf('Pia Prep')[4] || '') && /G1/.test(rowOf('Aki Crew')[4] || ''), [rowOf('Cal Chef'), rowOf('Pia Prep')]);
ok('組織マップの上司（Moto さん 11/26）：店舗配属＝店の G4・G4 本人と G4 のいない店＝管轄 AM・本部の人＝—', /^Mia Manager/.test(rowOf('Sam Lead')[3] || '') && /^Mia Manager/.test(rowOf('Pia Prep')[3] || '') && /^Ann Area\s*（管轄 AM）$/.test(rowOf('Mia Manager')[3] || '') && /^Ann Area\s*（管轄 AM）\s*（所属店）$/.test(rowOf('Ben Help')[3] || '') && rowOf('Cal Chef')[3] === '—' && rowOf('Ann Area')[3] === '—', [rowOf('Sam Lead')[3], rowOf('Mia Manager')[3], rowOf('Ben Help')[3], rowOf('Cal Chef')[3]]);
ok('組織マップ：上司は決まりから自動（入力しない）と書く・評価点・給与は出さない', /上司（報告先）は会社の決まりから自動で出しています/.test(t) && !/\$\d|時給|点数/.test(t.replace(/基準点/g, '')));
await shot(G.page, '09-gm-org-F01-1280', true);
await G.page.evaluate(() => crSet('org', 'F02')); await sleep(300);
const f02 = await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-org tr')].slice(1).map(r => r.querySelector('td').innerText));
ok('組織マップ Store B：Grade が分からない人は「未設定」', f02.some(x => /Xen Blank/.test(x)) && /未設定/.test(await root(G.page)), f02);
await G.page.evaluate(() => crSet('org', 'HQ')); await sleep(300);
t = await root(G.page);
ok('組織マップ 本部・Office：CEO・GM・経理・AM・Chef（全店）', ['Cora Ceo', 'Gabe Gm', 'Dee Office', 'Ann Area', 'Cal Chef'].every(n => t.includes(n)) && /全店/.test(t));
await G.page.evaluate(() => crSet('person', 'C1')); await sleep(300);
t = await root(G.page);
ok('名前を押すと：肩書き・Grade（従業員マスター）・Q4 の評価表・キャリアを開くボタン', /Head Chef/.test(t) && /Q4 の評価表のキャリア（Chef S3）を開く/.test(t) && /従業員マスターの Grade（G4）の説明/.test(t));
await shot(G.page, '10-gm-org-person-1280');
await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-person button')].find(b => /Chef S3/.test(b.innerText)).click()); await sleep(400);
ok('→ Chef S3 のカードが開く', await G.page.evaluate(() => FUNERGY_CAREER.state().view === 'detail' && FUNERGY_CAREER.state().sys === 'S_CHEF' && FUNERGY_CAREER.state().grade === 'S3'));
// 前の行き先
await G.page.evaluate(() => go('ojtmap')); await sleep(700);
ok('前の OJTマップ → キャリア・育成の育成計画・OJT', await G.page.evaluate(() => curPage === 'career' && FUNERGY_CAREER.state().view === 'plan'));
await G.page.evaluate(() => go('ojt_admin')); await sleep(700);
ok('前の OJT管理 → キャリア・育成の過去の記録', await G.page.evaluate(() => curPage === 'career' && FUNERGY_CAREER.state().view === 'history'));
await G.page.evaluate(() => crGo('guide', 'map')); await sleep(500);
ok('前の「役割と責任マップ」へのリンク → マトリクス', await G.page.evaluate(() => curPage === 'career' && FUNERGY_CAREER.state().view === 'matrix'));
await G.page.evaluate(() => crGo('guide', 'grade')); await sleep(500);
ok('前の「制度・役割ガイド」へのリンク → キャリアマップ', await G.page.evaluate(() => FUNERGY_CAREER.state().view === 'map'));
const navG = await G.page.evaluate(() => { const ids = []; (typeof MENU_GROUPS !== 'undefined' ? MENU_GROUPS : []).forEach(g => (g.children || []).forEach(c => ids.push(c))); return ids; });
ok('メニューに OJT管理・成長管理・OJTマップを出さない', !navG.includes('ojt_admin') && !navG.includes('growth_mgr') && !navG.includes('ojtmap'), navG.filter(x => /ojt|growth/.test(x)));
// 候補者向け（採用 › キャリア説明）
await G.page.evaluate(() => { window._ceMode = undefined; hiringTab = 'career'; go('hiring'); }); await sleep(800);
const cand = await G.page.evaluate(() => (document.getElementById('cr-root') || {}).innerText || '');
ok('採用 › キャリア説明：候補者向けが最初（同じマスターのキャリアマップ）', /候補者向け/.test(cand) && /Chef の S/.test(cand) && /経理の S/.test(cand));
ok('候補者向け：社内の名前・組織・育成計画・評価の記録を出さない', !PEOPLE.some(p => cand.includes(p.name)) && !/組織マップ|育成計画|Aki Crew|あなた/.test(cand));
ok('候補者向け：役割の文（未公開の案）を出さない', !/一般スタッフ：担当作業を学び|担当の持ち場で、手順とルール/.test(cand));
await shot(G.page, '11-hiring-candidate-1280', true);
await G.page.evaluate(() => crOpen('S_CHEF', 'S2', 1)); await sleep(300); await openAll(G.page);
const cd = await G.page.evaluate(() => (document.getElementById('cr-root') || {}).innerText || '');
ok('候補者向けのカード：1〜3 だけ（4 スキル・OJT・5 育成計画は出さない）', /評価項目・評価方法/.test(cd) && !/育成計画・現在の進捗/.test(cd) && !/習得するスキル/.test(cd));
await openSteps(G.page); await shot(G.page, '12-candidate-card-1280', true);

// ================================================================ 2. Crew（スマホ）：自分の評価表・カード・役割は確認中・組織マップ（評価表の列なし）
const A = await device(390);
ok('Crew（Aki Crew）で入る', await login(A, 'F01', 'Aki Crew'));
await openCareer(A); await sleep(1200);
t = await root(A.page);
ok('Crew：あなたの Q4 の評価表（G1）と育成計画（OJT 1 件）', /G1/.test(t) && /Server中心/.test(t) && /OJT 1 件/.test(t), t.slice(0, 300));
ok('Crew：役割の文（案）は出さない・評価の基準は出す', !/一般スタッフ：担当作業/.test(t) && /会社が確認中/.test(t) && /基準点 55/.test(t));
ok('Crew にも決まった職名と配属は出す（ほかの職名は公開まで出さない）', /Store Manager/.test(t) && /Area Manager/.test(t) && /本部配属/.test(t) && /店舗配属/.test(t) && !/部門Leader|Head Chefの目安/.test(t));
ok('390：横にはみ出さない（最初の画面）', (await overflowX(A.page)) <= 0);
await shot(A.page, '13-crew-home-390');
await shot(A.page, '13b-crew-home-390-full', true);
await A.page.click('#cr-root .cr-you button.btn-primary'); await sleep(500);
ok('「自分のキャリアを見る」→ G1 のカード（あなた）', await A.page.evaluate(() => FUNERGY_CAREER.state().view === 'detail' && FUNERGY_CAREER.state().grade === 'G1') && /あなた/.test(await root(A.page)));
ok('自分のカードは自分の担当型（Server中心）で開く', await A.page.evaluate(() => FUNERGY_CAREER.state().type === 'Server中心' && /cr-chip on[^>]*>Server中心 · あなた/.test(document.getElementById('cr-root').innerHTML)));
await openAll(A.page);
t = await root(A.page);
ok('Crew のカード：役割は「会社が確認中」・評価項目と例・次の段階の確かめ・わたしの計画', /役割の説明は会社が確認中です/.test(t) && /評価の根拠になる項目/.test(t) && /新しい必須条件ではありません/.test(t) && /OJT の習得確認/.test(t) && /G1 → G2/.test(t));
ok('390：横にはみ出さない（カード）', (await overflowX(A.page)) <= 0);
await openSteps(A.page); await shot(A.page, '14-crew-card-G1-390', true);
await A.page.evaluate(() => { crSet('view', 'map'); crSet('view', 'matrix'); }); await sleep(300);
ok('Crew：マトリクスは「会社が確認中」（未公開の案を出さない）', /会社が確認中/.test(await root(A.page)) && !/Opening・Closing と各種リスト/.test(await root(A.page)));
await A.page.evaluate(() => crSet('view', 'org')); await sleep(800);
t = await root(A.page);
ok('Crew：組織マップは見られる・Q4 の評価表の列は出さない', /Aki Crew/.test(t) && /Sam Lead/.test(t) && !/Q4 の評価表\t|Chef S3/.test(t) && /採点できる人にだけ/.test(t));
ok('390：横にはみ出さない（組織マップ）', (await overflowX(A.page)) <= 0);
await shot(A.page, '15-crew-org-390', true);
await A.page.evaluate(() => crSet('view', 'plan')); await sleep(1200);
t = await root(A.page);
ok('Crew：わたしの育成計画（Closing を手順どおりに）・希望を書ける', /わたしの育成計画/.test(t) && /Closing を手順どおりに/.test(t) && await A.page.evaluate(() => !!document.getElementById('gp-wish')));
await shot(A.page, '16-crew-plan-390', true);
// 英語
await A.page.evaluate(() => { setLang('en'); crSet('view', 'map'); }); await sleep(500);
t = await root(A.page);
ok('英語：見出しと系統の名前', /Start here/.test(t) && /Chef S track/.test(t) && /Accounting S track/.test(t));
ok('英語：役割の文が出ないあいだは「英訳確認中」の知らせも出さない', !/English translation under review/.test(t));
await shot(A.page, '17-crew-home-en-390');
await A.page.evaluate(() => setLang('ja'));

// ================================================================ 3. Chef（スマホ）：Chef S3 のカード
const C = await device(390);
ok('Chef（Cal Chef）で入る', await login(C, 'OFFICE', 'Cal Chef'));
await openCareer(C); await sleep(1200);
t = await root(C.page);
ok('Chef：あなたの Q4 の評価表は Chef S3', /Chef S3/.test(t));
await shot(C.page, '18-chef-home-390');

// ================================================================ まとめ
const errs = all.flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
