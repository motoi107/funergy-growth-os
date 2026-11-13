// v1142（2b の 4 つ目）を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない・名前はすべて作りもの）。
// 模擬サーバーは SS_REAL=1（本物の関数 secure-state）と RLS_HR=1（公開の鍵では採用・お悩み相談室のキーを読めない・書けない＝SQL のあと）で動かす。
// ・GM：応募者・不採用ログが関数から全部届く（公開の鍵では 1 行も渡らない）・画面から足す・不採用にする・名前はスクリプトにならない
// ・店長（Store Leader・F02）：自分の店（Brand B・Store B）の応募者と不採用ログだけ・端末にもそれだけ
// ・スタッフ：採用の画面は出ない・自分の相談だけ・画面から相談する（名前と店はサーバーが決める）・ログアウトで写しが消える
// 使い方：
//   node hr-check.mjs prep <元の合成データ> <出力>
//   模擬サーバー（server.mjs）を SS_REAL=1 RLS_HR=1 DATA_FILE=<出力> で動かしてから  DATA_FILE=<出力> node hr-check.mjs [結果の JSON]
import fs from 'node:fs';
const XSS_NAME = '<img src=x onerror="window.__xss=1">';
const XSS_TITLE = '<img src=x onerror="window.__xss=2">';
if (process.argv[2] === 'prep') {
  const d = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const at = '2026-10-19T09:00:00.000000+00:00';
  const sto = e => e.store || (e.data || {}).store;
  const crew = d.tables.employees.find(e => e.id === d.login.crewId);
  const other = d.tables.employees.find(e => e.role === 'crew' && sto(e) === 'F02');
  const st = d.tables.app_state.filter(r => !['applicants', 'reject_log', 'growthhub'].includes(r.key));
  st.push({ key: 'applicants', updated_at: at, value: [
    { id: 'p1', name: 'Hana Applicant', store: 'Brand A', status: '応募中', phone: '808-555-0101', email: '', date: '2026-10-01', source: 'Indeed', memo: '' },
    { id: 'p2', name: 'Ivo Applicant', store: 'Brand B', status: '応募中', phone: '808-555-0102', email: '', date: '2026-10-02', source: 'Indeed', memo: '' },
    { id: 'p3', name: 'Jo Applicant', store: 'Store B', status: '要確認', phone: '', email: '', date: '2026-10-03', source: 'Indeed', memo: '' },
    { id: 'p4', name: 'Kim Applicant', store: '未分類', status: '新規応募', phone: '', email: '', date: '2026-10-04', source: 'Indeed', memo: '' },
    { id: 'p5', name: XSS_NAME, store: 'Brand B', status: '応募中', phone: '', email: '', date: '2026-10-05', source: 'Indeed', memo: XSS_NAME },
    { id: 'p6', name: 'Lou Again', store: 'Brand B', status: '応募中', phone: '(808) 555-0199', email: '', date: '2026-10-06', source: 'Indeed', memo: '' },
  ] });
  st.push({ key: 'reject_log', updated_at: at, value: [
    { name: 'Lou Again', phone: '8085550199', email: '', store: 'Brand A', applyDate: '2026-01-01', rejectDate: '2026-01-10', reason: 'その他', memo: 'r-memo', by: 'GM' },
    { name: 'Old Bee', phone: '', email: '', store: 'Brand B', rejectDate: '2026-02-10', reason: 'その他', memo: '' },
    { name: 'Old Ace', phone: '', email: '', store: 'Brand A', rejectDate: '2026-03-10', reason: 'その他', memo: '' },
  ] });
  st.push({ key: 'growthhub', updated_at: at, value: [
    { id: 'ghc1', title: 'My shift', body: 'b1', author: crew.name, store: sto(crew), date: '2026/10/1', status: '未対応', replies: [] },
    { id: 'ghx1', title: XSS_TITLE, body: 'b2', author: crew.name, store: sto(crew), date: '2026/10/2', status: '未対応', replies: [] },
    { id: 'gho1', title: 'Other person', body: 'b3', author: other.name, store: sto(other), date: '2026/10/3', status: '未対応', replies: [] },
  ] });
  d.tables.app_state = st;
  fs.writeFileSync(process.argv[4], JSON.stringify(d));
  console.log('prepared');
  process.exit(0);
}
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const D = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = p => fetch(new URL(p, APP)).then(r => r.text());
const row = async k => JSON.parse(await ctl('/__hr?key=' + k));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

async function open(tag) {
  const dir = '/tmp/hrcheck-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 }, locale: 'ja-JP' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => { d.accept().catch(() => {}); });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors };
}
async function login(page, loc, name) {
  await page.evaluate(s => loginPickLocation(s), loc);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 50 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(2500);
}
const onDevice = (page, k) => page.evaluate(k => { try { return ls(k, null); } catch (e) { return 'err'; } }, k);
const text = page => page.evaluate(() => document.getElementById('main-content').innerText);
async function goWait(page, p, re) {
  await page.evaluate(x => go(x), p);
  for (let i = 0; i < 40; i++) { await sleep(300); const t = await text(page); if (re.test(t) && !/サーバーから読み込んでいます/.test(t)) return t; }
  return text(page);
}
const toasts = page => page.evaluate(() => Array.from(document.querySelectorAll('.toast, #toast, [class*=toast]')).map(e => e.innerText).join(' | '));

// ---- GM
{
  const { ctx, page, errors } = await open('gm');
  await login(page, 'OFFICE', D.login.gm);
  const t = await goWait(page, 'hiring', /Hana Applicant/);
  ok('GM: the hiring page lists every applicant (from the function)', ['Hana Applicant', 'Ivo Applicant', 'Jo Applicant', 'Kim Applicant', 'Lou Again'].every(n => t.includes(n)), t.length);
  ok('GM: the name with HTML is shown as text', t.includes(XSS_NAME));
  ok('GM: every applicant and reject entry is on the device', (await onDevice(page, 'applicants') || []).length === 6 && (await onDevice(page, 'reject_log') || []).length === 3);
  ok('GM: “過去応募履歴あり” for the applicant rejected at another store', /過去応募履歴あり|過去に不採用/.test(t));
  // 画面から足す
  await page.locator('button', { hasText: '応募者を追加' }).first().click(); await sleep(500);
  await page.fill('#ap-name', 'Mia Walkin');
  await page.evaluate(() => { const s = document.getElementById('ap-store'); s.value = 'Brand C'; });
  await page.click('#ap-save-btn');
  for (let i = 0; i < 30; i++) { await sleep(300); if ((await row('applicants')).some(x => x.name === 'Mia Walkin')) break; }
  const a1 = await row('applicants');
  ok('GM: adding from the screen writes one record (the other six stay)', a1.length === 7 && a1.some(x => x.name === 'Mia Walkin' && x.store === 'Brand C'), a1.length);
  ok('GM: the modal closed after the cloud took it', await page.evaluate(() => !document.getElementById('modal-overlay').classList.contains('open')));
  // 画面から不採用にする
  await page.evaluate(() => openRejectModal('p1')); await sleep(400);
  await page.click('#rej-go-btn');
  for (let i = 0; i < 30; i++) { await sleep(300); if (!(await row('applicants')).some(x => x.id === 'p1')) break; }
  const a2 = await row('applicants'), l2 = await row('reject_log');
  ok('GM: reject from the screen moves the applicant into the log once', !a2.some(x => x.id === 'p1') && l2.filter(x => x.aid === 'p1').length === 1 && l2.find(x => x.aid === 'p1').name === 'Hana Applicant', { a: a2.length, l: l2.length });
  const t2 = await goWait(page, 'growthhub', /Other person/);
  ok('GM: the consultation room shows every post (title with HTML as text)', t2.includes('Other person') && t2.includes(XSS_TITLE) && t2.includes('My shift'));
  ok('GM: no script ran from the names', await page.evaluate(() => window.__xss === undefined));
  const ss = JSON.parse(await ctl('/__ss'));
  ok('GM: no hiring or consultation row went through the public key', ss.anonHr === 0 && ss.calls > 0, ss);
  ok('GM: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- 店長（Store Leader・F02＝Brand B・Store B）
{
  const { ctx, page, errors } = await open('sl');
  await login(page, D.login.slStore, D.login.sl);
  const t = await goWait(page, 'hiring', /Ivo Applicant/);
  ok('SL: their store\'s applicants (brand and store name)', t.includes('Ivo Applicant') && t.includes('Jo Applicant') && t.includes('Lou Again'), t.length);
  ok('SL: nothing from other stores or 未分類', !t.includes('Mia Walkin') && !t.includes('Kim Applicant'));
  const dev = (await onDevice(page, 'applicants') || []).map(x => x.id).sort();
  ok('SL: only their store on the device', JSON.stringify(dev) === JSON.stringify(['p2', 'p3', 'p5', 'p6']), dev);
  const lg = (await onDevice(page, 'reject_log') || []).map(x => x.name).sort();
  ok('SL: the reject log holds only their store', JSON.stringify(lg) === JSON.stringify(['Old Bee']), lg);
  const lou = (await onDevice(page, 'applicants') || []).find(x => x.id === 'p6');
  ok('SL: the match from another store comes as date/store/reason/memo only', lou && Array.isArray(lou._prior) && lou._prior.length === 1 && JSON.stringify(Object.keys(lou._prior[0]).sort()) === JSON.stringify(['memo', 'reason', 'rejectDate', 'store']), lou && lou._prior);
  ok('SL: the device refuses a whole-row write while routed', (await page.evaluate(() => lsSet('applicants', []))) === false);
  ok('SL: no script ran', await page.evaluate(() => window.__xss === undefined));
  ok('SL: no page errors', errors.length === 0, errors);
  await ctx.close();
}
// ---- スタッフ
{
  const { ctx, page, errors } = await open('crew');
  await login(page, D.login.crewStore, D.login.crew);
  const th = await goWait(page, 'hiring', /権限/);
  ok('crew: the hiring page is not shown', /閲覧権限がありません/.test(th));
  const t = await goWait(page, 'growthhub', /My shift/);
  ok('crew: own consultations only', t.includes('My shift') && !t.includes('Other person'), t.length);
  const dev = (await onDevice(page, 'growthhub') || []).map(x => x.id).sort();
  ok('crew: only own posts on the device', JSON.stringify(dev) === JSON.stringify(['ghc1', 'ghx1']), dev);
  await page.evaluate(() => openGHModal()); await sleep(400);
  await page.fill('#gh-title', 'Need help'); await page.fill('#gh-body', 'details');
  await page.locator('.modal button', { hasText: '送信' }).first().click();
  for (let i = 0; i < 30; i++) { await sleep(300); if ((await row('growthhub')).some(x => x.title === 'Need help')) break; }
  const g = (await row('growthhub')).find(x => x.title === 'Need help');
  ok('crew: posting from the screen: author and store set by the server', g && g.author === D.login.crew && g.store === D.login.crewStore && g.status === '未対応', g);
  ok('crew: no script ran', await page.evaluate(() => window.__xss === undefined));
  await page.evaluate(() => ssOnLogout()); await sleep(800);
  ok('crew: logout clears the consultation copy on this device', (await onDevice(page, 'growthhub')) === null);
  const ss = JSON.parse(await ctl('/__ss'));
  ok('all: no hiring or consultation row went through the public key', ss.anonHr === 0, ss.anonHr);
  ok('crew: no page errors', errors.length === 0, errors);
  await ctx.close();
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
const ng = results.filter(r => !r.ok).length;
console.log((results.length - ng) + '/' + results.length);
process.exit(ng ? 1 : 0);
