// v1223（UI案104・Moto さん 11/26 承認）：キャリアマップ（A 階段＋C の行）・詳細パネル（PC は右・スマホは下からのシート）・責任マトリクス・店舗別の組織図を本物のブラウザ（Chrome）で確かめる。
// v1222 の career-hub-v1222.mjs を新しい画面に合わせて書き直した（確かめる中身は同じ＋ v1223 の決めごと）。合成データだけ（作りものの店・人）。本番にはつながない。
// ・アプリ：このリポジトリの index.html（APP_DIR で前の版も開ける）
// ・Supabase：tests/perf/mock-api.mjs（SS_REAL=1：本物の関数 secure-state・CSQ4_DB=1 と GP_DB=1：Career Score Q4 と育成計画の本物の SQL を PGlite で）
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/shots/career] node tests/e2e-career/career-map-v1223.mjs
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

const tabs = page => page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-panel .cr-tab')].map(b => b.innerText.trim()));
const tab = async (page, t) => { await page.evaluate(x => crSet('ptab', x), t); await sleep(250); return page.evaluate(() => (document.querySelector('#cr-root .cr-panel .cr-pb') || {}).innerText || ''); };
const box = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, pos: c.position, disp: c.display }; }, sel);
const RESP = ['自分のポジションを責任持ってやり切る', 'G1を育て、店を回す最初のリーダー', '専門領域でチームを率いるリーダー職', '店舗の全てに責任を持つマネージャー職', '管轄責任', '全社責任'];

// ================================================================ 1. GM（PC 1440）：キャリアマップ・詳細パネル・マトリクス・組織図
const G = await device(1440);
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
ok('上の細い帯「あなた」と左の表示（キャリアマップ・責任マトリクス・店舗別の組織図）', /あなた/.test(t) && /キャリアマップ/.test(t) && /責任マトリクス/.test(t) && /店舗別の組織図/.test(t), t.slice(0, 200));
ok('PC：左の選択・中央が横に並ぶ（.main を広げる）', await G.page.evaluate(() => { const r = document.querySelector('#cr-root .cr-rail').getBoundingClientRect(), m = document.querySelector('#cr-root .cr-main').getBoundingClientRect(); return document.body.classList.contains('cr-wide') && r.right <= m.left + 1 && m.width > 900; }));
const lanes = await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-pc .cr-ln')].map(l => [l.querySelector('.cr-ln-h b').innerText, l.querySelectorAll('.cr-card').length]));
ok('キャリアマップ：G・Prep・Chef の S・経理の S の順・どれも 6 段', lanes.length === 4 && lanes.every(x => x[1] === 6) && /^G/.test(lanes[0][0]) && /^Prep/.test(lanes[1][0]) && /^Chef/.test(lanes[2][0]) && /^経理/.test(lanes[3][0]), lanes);
ok('テーマカラー：段の上の線（G＝オレンジ・Prep＝深緑・Chef＝黄色・経理＝紫）', await G.page.evaluate(() => { const top = (k, g) => getComputedStyle(document.querySelector(`#cr-root .cr-pc [onclick="crOpen('${k}','${g}')"]`).parentElement.querySelector('.cr-stp')).borderTopColor; return top('G', 'G1') === 'rgb(240, 102, 31)' && top('PREP', 'P1') === 'rgb(21, 128, 61)' && top('S_CHEF', 'S1') === 'rgb(234, 179, 8)' && top('S_OFFICE', 'S1') === 'rgb(147, 51, 234)'; }));
ok('段の高さ＝基準点（G2 < G3 < G4 < G5 < G6）', await G.page.evaluate(() => { const h = g => document.querySelector(`#cr-root .cr-pc [onclick="crOpen('G','${g}')"]`).parentElement.querySelector('.cr-stp').getBoundingClientRect().height; return h('G1') < h('G2') && h('G2') < h('G3') && h('G3') < h('G4') && h('G4') < h('G5') && h('G5') < h('G6'); }));
ok('G のメインの責任（Moto さんの文）が 6 段に', RESP.every(x => t.includes(x)));
ok('Career Score：G1 は対象外（スキルレベル）・G2〜G6 と Chef S1〜S6・経理 S1〜S6 は対象・Prep は Prep の評価表', /G1 は対象外（スキルレベル）/.test(t) && /スキルレベル（CS 対象外）/.test(t) && /Career Score の対象（G2〜G6）/.test(t) && /Career Score の対象（Chef S1〜Chef S6）/.test(t) && /Career Score の対象（経理 S1〜経理 S6）/.test(t) && /Prep の評価表で段を決める/.test(t));
const border = await G.page.evaluate(() => { const b = g => { const c = getComputedStyle(document.querySelector(`#cr-root .cr-pc [onclick="crOpen('G','${g}')"]`).parentElement); return c.borderLeftStyle + ' ' + c.borderLeftWidth; }; return { G2: b('G2'), G3: b('G3'), G4: b('G4'), G5: b('G5') }; });
ok('境目：G1｜G2＝点線（CS ここから）・G3｜G4＝破線（マネージャー職 ここから）・G4｜G5＝細い線（本部配属は G5 から）', /^dotted/.test(border.G2) && /^dashed/.test(border.G4) && /^solid/.test(border.G5) && /^none/.test(border.G3) && /CS ここから/.test(t) && /マネージャー職 ここから/.test(t), border);
ok('配属の帯：G は店舗配属 4 列・本部配属 2 列、経理の S は全部本部配属', await G.page.evaluate(() => { const ln = [...document.querySelectorAll('#cr-root .cr-pc .cr-ln')]; const bands = l => [...l.querySelectorAll('.cr-band')].map(b => b.querySelector('b').innerText + ':' + b.style.gridColumn); return JSON.stringify(bands(ln[0])) === JSON.stringify(['店舗配属:span 4', '本部配属:span 2']) && JSON.stringify(bands(ln[3])) === JSON.stringify(['本部配属:span 6']) && JSON.stringify(bands(ln[2])) === JSON.stringify(['店舗配属:span 2', '本部配属:span 4']); }));
ok('C の行：最低条件（G1 は Career Score の対象外）・担当型', /最低条件/.test(t) && /Career Score の対象外/.test(t) && /Kitchen中心・Server中心・両部門育成/.test(t));
ok('給与の仕組み（GM＝見える）：G の帯・Prep の時給の段 $17〜$22（Q4 のマスター）', /G の給与の仕組み/.test(t) && /P1 \$17 〜 P6 \$22/.test(t) && ['$17', '$18', '$19', '$20', '$21', '$22'].every(x => t.includes(x)));
ok('1440：横にはみ出さない（キャリアマップ）', (await overflowX(G.page)) <= 0);
await shot(G.page, '01-gm-map-1440');
await shot(G.page, '01b-gm-map-1440-full', true);
// 詳細パネル：G3
await G.page.click(`#cr-root .cr-pc [onclick="crOpen('G','G3')"]`); await sleep(500);
const pb = await box(G.page, '#cr-root .cr-panel'), mb = await box(G.page, '#cr-root .cr-main'), rb = await box(G.page, '#cr-root .cr-rail');
ok('PC 1440：詳細は右のパネル（中央の横に並ぶ・左は細くなる）', pb && pb.pos === 'sticky' && pb.l >= mb.r - 1 && rb.w < 110, { pb, mb, rb });
ok('パネルのタブ：役割・評価・次の段階・スキルと OJT・育成計画・給与の仕組み', JSON.stringify(await tabs(G.page)) === JSON.stringify(['役割', '評価', '次の段階', 'スキルと OJT', '育成計画', '給与の仕組み']), await tabs(G.page));
t = await root(G.page);
ok('役割：メインの責任（Moto さんの文）と、その下の案（GM だけ）', /メインの責任\s*専門領域でチームを率いるリーダー職/.test(t) && /ここから下は案・会社の確認待ち/.test(t) && /責任を持つ範囲/.test(t) && /制度資料に書かれていません（未設定）/.test(t));
ok('選んだ段に印・パネルを開いても横にはみ出さない', await G.page.evaluate(() => !!document.querySelector(`#cr-root .cr-pc .cr-card.on[onclick="crOpen('G','G3')"]`)) && (await overflowX(G.page)) <= 0);
await shot(G.page, '02-gm-panel-G3-role-1440');
let p = await tab(G.page, 'eval');
ok('評価：基準点 75・配点・最低条件・点のつけ方（Q4 のマスター）', /基準点\s*75/.test(p) && /最低条件/.test(p) && /Kitchen中心/.test(p) && /3 点/.test(p));
await shot(G.page, '03-gm-panel-G3-eval-1440');
p = await tab(G.page, 'next');
ok('次の段階：G3 → G4・ここからマネージャー職・基準点 75 → 85・確かめ', /ここからマネージャー職/.test(p) && /75 → 85/.test(p.replace(/\s+/g, ' ')) && /OJT の習得確認/.test(p) && /昇格の申請と承認/.test(p));
p = await tab(G.page, 'pay');
ok('給与の仕組み：時給・Tip Rate・賞与 ①・基準点・福利厚生（今ある決まりの文と Q4 のマスターの数だけ）', /別の決まり（このガイドでは出しません）/.test(p) && /Tip Rate Policy/.test(p) && /「Career Score」→「今期の評価」で確定・公開した評価で決めます/.test(p) && /G3 は 75 点（次の G4 は 85 点）/.test(p) && /個人の時給・Tip Rate・賞与の額はここに出しません/.test(p));
await shot(G.page, '04-gm-panel-G3-pay-1440');
await G.page.locator('#cr-root .cr-panel .cr-pchip', { hasText: 'G4 ›' }).click(); await sleep(300);
ok('パネルの「G4 ›」で前後の等級へ（タブはそのまま）', await G.page.evaluate(() => FUNERGY_CAREER.state().grade === 'G4' && FUNERGY_CAREER.state().ptab === 'pay'));
await G.page.evaluate(() => crOpen('G', 'G1')); await sleep(300);
p = await tab(G.page, 'eval');
ok('G1 の評価：Career Score の対象外（スキルレベル・G2 から）', /G1 は Career Score の対象外です（G2 から対象）/.test(p) && /スキルレベル/.test(p) && !/基準点\s*55/.test(p));
p = await tab(G.page, 'plan');
ok('G1 の育成計画：担当する人（Aki Crew）の計画を開ける', /Aki Crew/.test(p), p.slice(0, 200));
for (const [k, g, name] of [['S_CHEF', 'S3', '05-gm-panel-chefS3-eval-1440'], ['S_OFFICE', 'S4', '06-gm-panel-acctS4-eval-1440'], ['PREP', 'P3', '07-gm-panel-prepP3-eval-1440']]) {
  await G.page.evaluate(([a, b]) => crOpen(a, b), [k, g]); await sleep(300);
  const x = await tab(G.page, 'eval');
  if (k === 'S_CHEF') ok('Chef S3：基準点 75・衛生安全の最低条件・本部配属', /基準点\s*75/.test(x) && /衛生安全/.test(x) && /本部配属/.test(await root(G.page)));
  if (k === 'S_OFFICE') ok('経理 S4：基準点 85・品質管理の最低条件', /基準点\s*85/.test(x) && /品質管理/.test(x));
  if (k === 'PREP') ok('Prep の評価：今のアプリの決まりと改定の方針（未反映）・評価のタブに時給は出さない', /今のアプリの決まり/.test(x) && /改定の方針（まだアプリに入っていません）/.test(x) && /別々の評価/.test(x) && !/\$\s?\d/.test(x));
  await shot(G.page, name);
}
p = await tab(G.page, 'pay');
ok('Prep の給与の仕組み：この段（P3）は $19・時給の段 P1〜P6（Q4 のマスター）', /この段（P3）は \$19（Q4 のマスター）/.test(p) && /P1\s*\$17/.test(p) && /P6\s*\$22/.test(p));
await shot(G.page, '08-gm-panel-prepP3-pay-1440');
await G.page.keyboard.press('Escape'); await sleep(300);
ok('Esc でパネルを閉じる（キャリアマップに戻る）', await G.page.evaluate(() => FUNERGY_CAREER.state().view === 'map' && !document.querySelector('#cr-root .cr-panel')));
await G.page.evaluate(() => crOpen('G', 'G1')); await sleep(300); await tab(G.page, 'plan');
await G.page.evaluate(() => crPlanOf('S1')); await sleep(1500);
t = await root(G.page);
ok('育成計画・OJT：対象の人の名前と OJT（Closing を手順どおりに）', /Aki Crew/.test(t) && /Closing を手順どおりに/.test(t));
ok('育成計画の画面はいつもの幅（.main を広げない）', await G.page.evaluate(() => !document.body.classList.contains('cr-wide')));
// 責任マトリクス
await G.page.evaluate(() => { crSet('view', 'map'); crSet('view', 'matrix'); }); await sleep(400);
t = await root(G.page);
ok('マトリクス：左に系統（件数）と分類（件数）・記号の説明・権限とは別', /日常業務/.test(t) && /スタッフ育成/.test(t) && /責任を持つ/.test(t) && /対象外/.test(t) && /アプリで操作できる範囲（権限）は別/.test(t) && await G.page.evaluate(() => document.querySelectorAll('#cr-root .cr-rail .cr-cnt').length >= 8));
ok('記号の色は系統の色と重ねない（責任＝紺・担当＝青緑・確認＝灰の枠・承認＝青い四角）', await G.page.evaluate(() => { const c = s => { const e = document.querySelector('#cr-root .cr-mxw .cr-mk2-' + s); return e ? getComputedStyle(e) : null; }; return c('lead').backgroundColor === 'rgb(30, 58, 138)' && c('do').backgroundColor === 'rgb(15, 118, 110)' && c('support').borderTopColor === 'rgb(100, 116, 139)' && (!c('approve') || c('approve').backgroundColor === 'rgb(219, 234, 254)'); }));
await shot(G.page, '09-gm-matrix-1440');
await G.page.click('#cr-root .cr-mxr:nth-of-type(2)'); await sleep(400);
t = await root(G.page);
ok('業務の行を押すと右に業務の詳細（等級ごとの関わり・根拠になる評価項目）', /等級ごとの関わり/.test(t) && /根拠になる評価項目（Q4 のマスター）/.test(t) && await G.page.evaluate(() => !!document.querySelector('#cr-root .cr-panel .cr-dgrid')));
await shot(G.page, '10-gm-matrix-duty-1440');
const duty = await G.page.evaluate(() => FUNERGY_CAREER.state().duty);
await G.page.click('#cr-root .cr-panel .cr-dcell:nth-child(4)'); await sleep(400);
ok('業務の詳細の等級（G4）→ 等級のパネル（キャリアマップ）', await G.page.evaluate(() => { const s = FUNERGY_CAREER.state(); return s.view === 'detail' && s.grade === 'G4' && s.from === 'matrix'; }) && /責任マトリクスに戻る/.test(await root(G.page)));
await G.page.click('#cr-root .cr-panel .cr-x'); await sleep(300);
ok('戻るとマトリクスの同じ業務の詳細', await G.page.evaluate(d => FUNERGY_CAREER.state().view === 'matrix' && FUNERGY_CAREER.state().duty === d, duty));
await G.page.fill('#cr-root .cr-mx-q', 'トラブル'); await sleep(200);
const vis = await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-mxr')].filter(r => !r.hidden).map(r => r.querySelector('b').innerText));
ok('業務の名前で探す（描き直さずに行をしぼる・入力は消えない）', vis.length >= 1 && vis.every(x => /トラブル/.test(x)) && await G.page.evaluate(() => document.querySelector('#cr-root .cr-mx-q').value === 'トラブル'), vis);
await G.page.evaluate(() => { crSet('mxmode', 'grade'); crSet('col', 'G4'); }); await sleep(300);
t = await root(G.page);
ok('等級で見る：G4 の業務を 4 つの欄（責任・担当・確認・承認）に', await G.page.evaluate(() => document.querySelectorAll('#cr-root .cr-mxgb').length === 4) && /責任/.test(t) && /承認/.test(t));
await shot(G.page, '11-gm-matrix-grade-1440');
await G.page.evaluate(() => { crSet('mxmode', 'duty'); crSet('mxsys', 'S_CHEF'); }); await sleep(300);
ok('Chef の S のマトリクス：最初の分類は調理・品質管理', /Chef の S（S Chef）/.test(await root(G.page)) && await G.page.evaluate(() => FUNERGY_CAREER.state().mxsys === 'S_CHEF' && /調理・品質管理/.test(document.querySelector('#cr-root .cr-top').innerText)));
const consistent = await G.page.evaluate(() => { const R = window.FUNERGY_ROLE_GUIDE; let bad = []; R.systems.forEach(s => s.duties.forEach(d => Object.keys(d.marks || {}).forEach(g => { if (!s.grades.some(x => x.grade === g)) bad.push(d.id + ':' + g); }))); return bad; });
ok('マトリクスの等級はどれもその系統の等級（役割の説明と同じマスター）', consistent.length === 0, consistent);
// 店舗別の組織図
await G.page.evaluate(() => { crSet('view', 'org'); crSet('org', 'F01'); }); await sleep(1500);
t = await root(G.page);
ok('組織図（図が最初）：本部の帯（G6・管轄 AM・担当 Chef）→ 店の G4 → G3・G2・G1・Prep・兼務', /本部（この店にかかわる人）/.test(t) && /Gabe Gm/.test(t) && /Ann Area/.test(t) && /Cal Chef/.test(t) && /Store Manager（店の G4）/.test(t) && /Mia Manager/.test(t) && /兼務（応援）/.test(t) && await G.page.evaluate(() => { const g = n => [...document.querySelectorAll('#cr-root .cr-grp')].find(x => x.querySelector('.cr-grp-h').innerText.includes(n)); const has = (n, who) => !!(g(n) && g(n).innerText.includes(who)); return has('G3', 'Sam Lead') && has('G2', 'Kai Leader') && has('G1', 'Aki Crew') && has('Prep', 'Pia Prep') && has('兼務', 'Ben Help'); }));
ok('組織図（GM＝採点できる）：Q4 の評価表の印（Aki Crew＝G1 · Server中心）', /評価表 G1 · Server中心/.test(t));
await shot(G.page, '12-gm-org-chart-F01-1440');
await G.page.click('#cr-root .cr-grp .cr-nd >> text=Sam Lead'); await sleep(300);
t = await root(G.page);
ok('人を押すと右に詳細：上司（店の G4）と決まりの説明・個人の評価や給与は出さない', /上司（報告先）\s*Mia Manager/.test(t) && /この店の G4（Store Manager）です/.test(t) && /個人の評価・給与・連絡先は出しません/.test(t) && !/\$\d|時給 \$/.test(t));
await shot(G.page, '13-gm-org-person-1440');
await G.page.evaluate(() => crSet('orgmode', 'list')); await sleep(300);
const orgRows = await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-org tr')].slice(1).map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim())));
const f01 = PEOPLE.filter(p => p.store === 'F01' || p.support.includes('F01') || p.name === 'Ann Area' || p.name === 'Cal Chef').map(p => p.name).sort();
ok('一覧に切り替え：所属・兼務・店舗マスターの AM と Chef が 1 人 1 行', JSON.stringify(orgRows.map(r => r[0].split('\n')[0].replace(/\s+(兼務|管轄|担当).*$/, '').trim()).sort()) === JSON.stringify(f01), orgRows.map(r => r[0]));
const rowOf = n => orgRows.find(r => r[0].startsWith(n)) || [];
ok('一覧：肩書きと Grade（従業員マスター）が元のデータと同じ', rowOf('Sam Lead')[1] === 'Server Leader' && rowOf('Sam Lead')[2] === 'G3' && rowOf('Pia Prep')[2] === 'G1-P' && rowOf('Mia Manager')[2] === 'G4', [rowOf('Sam Lead'), rowOf('Pia Prep')]);
ok('上司の決まり（v1222 のまま）：店舗配属＝店の G4・G4 本人と G4 のいない店＝管轄 AM・本部の人＝—', /^Mia Manager/.test(rowOf('Sam Lead')[3] || '') && /^Mia Manager/.test(rowOf('Pia Prep')[3] || '') && /^Ann Area\s*（管轄 AM）$/.test(rowOf('Mia Manager')[3] || '') && /^Ann Area\s*（管轄 AM）\s*（所属店）$/.test(rowOf('Ben Help')[3] || '') && rowOf('Cal Chef')[3] === '—' && rowOf('Ann Area')[3] === '—', [rowOf('Sam Lead')[3], rowOf('Mia Manager')[3], rowOf('Ben Help')[3], rowOf('Cal Chef')[3]]);
await G.page.evaluate(() => { crSet('orgmode', 'chart'); crSet('org', 'F02'); }); await sleep(300);
t = await root(G.page);
ok('Store B（G4 がいない店）：報告先は管轄 AM と図に書く・Grade の無い人は「そのほか」', /この店には G4（Store Manager）がいません → 店の人の報告先は管轄 AM/.test(t) && /そのほか/.test(t) && /Xen Blank/.test(t));
await G.page.evaluate(() => crSet('org', '*')); await sleep(300);
t = await root(G.page);
ok('全店：店ごとの小さな図（人数・Store Manager・Grade の数・管轄 AM）と本部・Office', await G.page.evaluate(() => document.querySelectorAll('#cr-root .cr-ovc').length === 3) && /Store Manager：Mia Manager/.test(t) && /本部・Office/.test(t) && /Cora Ceo/.test(t));
await shot(G.page, '14-gm-org-all-1440');
await G.page.evaluate(() => { crSet('org', 'HQ'); crSet('person', 'C1'); }); await sleep(300);
t = await root(G.page);
ok('本部・Office は一覧・人の詳細：Head Chef・Q4 の評価表のキャリア（Chef S3）', /Head Chef/.test(t) && /Q4 の評価表のキャリア（Chef S3）を開く/.test(t) && /従業員マスターの Grade（G4）の説明/.test(t));
await G.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-panel button')].find(b => /Chef S3/.test(b.innerText)).click()); await sleep(400);
ok('→ Chef S3 のパネルが開く（閉じると組織図の同じ人）', await G.page.evaluate(() => FUNERGY_CAREER.state().view === 'detail' && FUNERGY_CAREER.state().sys === 'S_CHEF' && FUNERGY_CAREER.state().grade === 'S3'));
await G.page.evaluate(() => crClose()); await sleep(300);
ok('（閉じると組織図・人の詳細のまま）', await G.page.evaluate(() => FUNERGY_CAREER.state().view === 'org' && FUNERGY_CAREER.state().person === 'C1'));
// 前の行き先
await G.page.evaluate(() => go('ojtmap')); await sleep(700);
ok('前の OJTマップ → キャリア・育成の育成計画・OJT', await G.page.evaluate(() => curPage === 'career' && FUNERGY_CAREER.state().view === 'plan'));
await G.page.evaluate(() => go('ojt_admin')); await sleep(700);
ok('前の OJT管理 → キャリア・育成の過去の記録', await G.page.evaluate(() => curPage === 'career' && FUNERGY_CAREER.state().view === 'history'));
await G.page.evaluate(() => crGo('guide', 'map')); await sleep(500);
ok('前の「役割と責任マップ」へのリンク → マトリクス（.main を広げる）', await G.page.evaluate(() => curPage === 'career' && FUNERGY_CAREER.state().view === 'matrix' && document.body.classList.contains('cr-wide')));
await G.page.evaluate(() => crGo('guide', 'grade')); await sleep(500);
ok('前の「制度・役割ガイド」へのリンク → キャリアマップ', await G.page.evaluate(() => FUNERGY_CAREER.state().view === 'map'));
await G.page.evaluate(() => go('mypage')); await sleep(600);
ok('ほかの画面に移ると .main はいつもの幅', await G.page.evaluate(() => !document.body.classList.contains('cr-wide')));
// 候補者向け（採用 › キャリア説明）
await G.page.evaluate(() => { window._ceMode = undefined; hiringTab = 'career'; go('hiring'); }); await sleep(800);
const cand = await G.page.evaluate(() => (document.getElementById('cr-root') || {}).innerText || '');
ok('採用 › キャリア説明：候補者向け（同じマスターのキャリアマップ・G のメインの責任）', /候補者向け/.test(cand) && /Chef の S/.test(cand) && /経理の S/.test(cand) && RESP.every(x => cand.includes(x)));
ok('候補者向け：社内の名前・組織・育成計画・給与の仕組みを出さない', !PEOPLE.some(p => cand.includes(p.name)) && !/組織図|育成計画|あなた|給与の仕組み|\$\d/.test(cand));
ok('候補者向け：役割の文（未公開の案）を出さない', !/一般スタッフ：担当作業を学び|担当の持ち場で、手順とルール/.test(cand));
await shot(G.page, '15-hiring-candidate-1440', true);
await G.page.evaluate(() => crOpen('S_CHEF', 'S2', 1)); await sleep(400);
ok('候補者向けのパネル：役割・評価・次の段階だけ（右から出る）', JSON.stringify(await tabs(G.page)) === JSON.stringify(['役割', '評価', '次の段階']) && (await box(G.page, '#cr-root .cr-panel')).pos === 'fixed');
await shot(G.page, '16-candidate-panel-1440');

// ================================================================ 2. GM（PC 1024）：左の選択は上に横並び・パネルは右から出る（下の画面に重ねる）
const N = await device(1024);
ok('GM（1024）で入る', await login(N, 'OFFICE', 'Gabe Gm'));
await openCareer(N);
ok('1024：左の選択は上に横並び', await N.page.evaluate(() => { const r = document.querySelector('#cr-root .cr-rail').getBoundingClientRect(), m = document.querySelector('#cr-root .cr-main').getBoundingClientRect(); return r.bottom <= m.top + 1; }));
ok('1024：横にはみ出さない', (await overflowX(N.page)) <= 0);
await N.page.click(`#cr-root .cr-pc [onclick="crOpen('G','G5')"]`); await sleep(400);
const nb = await box(N.page, '#cr-root .cr-panel');
ok('1024：パネルは右から出る（重ねる・後ろは暗く）', nb && nb.pos === 'fixed' && Math.abs(nb.r - 1024) < 2 && !!(await box(N.page, '#cr-root .cr-dim')), nb);
await shot(N.page, '17-gm-panel-G5-1024');
await N.page.mouse.click(40, 400); await sleep(300);
ok('1024：暗いところを押すと閉じる', await N.page.evaluate(() => !document.querySelector('#cr-root .cr-panel') && FUNERGY_CAREER.state().view === 'map'));

// ================================================================ 3. G4（Store Manager・PC 1280）：給与の仕組みが見える・自分のキャリア
const M = await device(1280);
ok('G4（Mia Manager）で入る', await login(M, 'F01', 'Mia Manager'));
await openCareer(M); await sleep(1200);
t = await root(M.page);
ok('G4：あなたの Q4 の評価表（G4 · 店長）', /G4/.test(t) && /店長/.test(t), t.slice(0, 200));
ok('G4 以上：給与の仕組みの帯と Prep の時給の段が見える', /G の給与の仕組み/.test(t) && /P1 \$17 〜 P6 \$22/.test(t) && /時給の段/.test(t));
ok('G4：役割の文（案）は出さない（GM・CEO だけ）', !/ここから下は案|文は案・会社の確認待ち/.test(t) && /役割の説明は会社が確認中/.test(t));
await M.page.click('#cr-root .cr-you2 .btn-primary'); await sleep(500);
ok('「自分のキャリアを見る」→ G4 のパネル（あなた・給与の仕組みのタブ）', await M.page.evaluate(() => FUNERGY_CAREER.state().view === 'detail' && FUNERGY_CAREER.state().grade === 'G4') && /あなた/.test(await root(M.page)) && (await tabs(M.page)).includes('給与の仕組み'));
await shot(M.page, '18-g4-map-panel-1280');

// ================================================================ 4. Crew（スマホ 390）：縦のはしご・下からのシート・給与の仕組みは出さない
const A = await device(390);
ok('Crew（Aki Crew）で入る', await login(A, 'F01', 'Aki Crew'));
await openCareer(A); await sleep(1200);
t = await root(A.page);
ok('Crew：あなたの Q4 の評価表（G1 · Server中心）と育成計画（OJT 1 件）', /G1/.test(t) && /Server中心/.test(t) && /OJT 1 件/.test(t), t.slice(0, 300));
ok('スマホ：上のタブ（マップ・責任の表・組織図）・PC の段は隠れて縦のはしご', await A.page.evaluate(() => { const v = [...document.querySelectorAll('#cr-root .cr-rg-views .cr-rv')].map(b => b.innerText.trim()); const pc = document.querySelector('#cr-root .cr-main > .cr-pc'), ph = document.querySelector('#cr-root .cr-main > .cr-ph'); return JSON.stringify(v) === JSON.stringify(['マップ', '責任の表', '組織図']) && getComputedStyle(pc).display === 'none' && getComputedStyle(ph).display === 'block' && ph.querySelectorAll('.cr-pcard').length === 6; }));
ok('はしご：配属の見出し・「ここから Career Score の対象」・「ここからマネージャー職」・メインの責任', /店舗配属/.test(t) && /本部配属/.test(t) && /ここから Career Score の対象/.test(t) && /ここからマネージャー職/.test(t) && RESP.every(x => t.includes(x)));
ok('Crew：役割の文（案）と給与の仕組みは出さない', !/一般スタッフ：担当作業/.test(t) && !/給与の仕組み|時給の段|\$\d/.test(t));
ok('390：横にはみ出さない（マップ）', (await overflowX(A.page)) <= 0);
await shot(A.page, '19-crew-map-390');
await shot(A.page, '19b-crew-map-390-full', true);
await A.page.click('#cr-root .cr-you2 .btn-primary'); await sleep(500);
const sb = await box(A.page, '#cr-root .cr-panel');
ok('「自分のキャリアを見る」→ 下からのシート（G1 · あなた）', sb && sb.pos === 'fixed' && Math.abs(sb.b - 844) < 2 && sb.t > 60 && await A.page.evaluate(() => FUNERGY_CAREER.state().grade === 'G1' && FUNERGY_CAREER.state().type === 'Server中心') && /あなた/.test(await root(A.page)), sb);
ok('Crew のシートのタブ：給与の仕組みは無い', JSON.stringify(await tabs(A.page)) === JSON.stringify(['役割', '評価', '次の段階', 'スキルと OJT', '育成計画']), await tabs(A.page));
p = await tab(A.page, 'role');
ok('Crew の役割：メインの責任は出す・ほかは「会社が確認中」', /自分のポジションを責任持ってやり切る/.test(p) && /役割の説明は会社が確認中です/.test(p));
await shot(A.page, '20-crew-sheet-G1-390');
p = await tab(A.page, 'eval');
ok('Crew の評価：G1 は Career Score の対象外（スキルレベル）', /G1 は Career Score の対象外です/.test(p));
p = await tab(A.page, 'next');
ok('Crew の次の段階：G1 → G2・ここから Career Score・G2 の基準点 65', /ここから Career Score の対象/.test(p) && /G2 の基準点 65/.test(p) && /OJT の習得確認/.test(p));
await shot(A.page, '21-crew-sheet-next-390');
await A.page.click('#cr-root .cr-panel .cr-x'); await sleep(300);
await A.page.evaluate(() => crSet('track', 'S_CHEF')); await sleep(300);
ok('系統のボタンで Chef の S のはしご', await A.page.evaluate(() => [...document.querySelectorAll('#cr-root .cr-ph .cr-pcard-l b')].map(b => b.innerText).join(',') === 'Chef S1,Chef S2,Chef S3,Chef S4,Chef S5,Chef S6'));
await A.page.evaluate(() => crSet('view', 'matrix')); await sleep(300);
ok('Crew：マトリクスは「会社が確認中」（未公開の案を出さない）', /会社が確認中/.test(await root(A.page)) && !/Opening・Closing と各種リスト/.test(await root(A.page)));
await A.page.evaluate(() => crSet('view', 'org')); await sleep(800);
t = await root(A.page);
ok('Crew：組織図は見られる・Q4 の評価表の印は出さない', /Aki Crew/.test(t) && /Sam Lead/.test(t) && !/評価表 G1|Chef S3/.test(t) && /採点できる人にだけ/.test(t));
ok('390：横にはみ出さない（組織図）', (await overflowX(A.page)) <= 0);
await shot(A.page, '22-crew-org-390', true);
await A.page.click('#cr-root .cr-grp .cr-nd >> text=Sam Lead'); await sleep(300);
ok('組織図の人 → 下からのシート（上司 Mia Manager）', /上司（報告先）\s*Mia Manager/.test(await root(A.page)) && (await box(A.page, '#cr-root .cr-panel')).pos === 'fixed');
await shot(A.page, '23-crew-org-sheet-390');
await A.page.evaluate(() => crSet('view', 'plan')); await sleep(1200);
t = await root(A.page);
ok('Crew：わたしの育成計画（Closing を手順どおりに）・希望を書ける（今のまま）', /わたしの育成計画/.test(t) && /Closing を手順どおりに/.test(t) && await A.page.evaluate(() => !!document.getElementById('gp-wish')));
// 英語
await A.page.evaluate(() => { setLang('en'); crSet('view', 'map'); crSet('track', 'G'); }); await sleep(500);
t = await root(A.page);
ok('英語：見出しと系統の名前・Moto さんの文（英訳は案）はスタッフには日本語のまま', /You/.test(t) && /Chef S/.test(t) && /Map/.test(t) && t.includes(RESP[0]));
ok('英語：役割の文が出ないあいだは「英訳確認中」の知らせも出さない', !/English translation under review/.test(t));
await shot(A.page, '24-crew-map-en-390');
await A.page.evaluate(() => setLang('ja'));

// ================================================================ 5. Chef（スマホ）
const C = await device(390);
ok('Chef（Cal Chef）で入る', await login(C, 'OFFICE', 'Cal Chef'));
await openCareer(C); await sleep(1200);
t = await root(C.page);
ok('Chef：あなたの Q4 の評価表は Chef S3・はしごも Chef の S', /Chef S3/.test(t) && await C.page.evaluate(() => /Chef S1/.test(document.querySelector('#cr-root .cr-ph').innerText)));
ok('Chef（Head Chef＝従業員マスター G4）：給与の仕組みが見える（G4 以上）', /給与の仕組み/.test(t));
await shot(C.page, '25-chef-map-390');

// ================================================================ まとめ
const errs = all.flatMap(D => D.errors);
ok('pageerror 0', errs.length === 0, errs.slice(0, 3));
await browser.close(); app.close(); ext.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);
