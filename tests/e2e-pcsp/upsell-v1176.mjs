// v1176：アップセル対象の設定カードと業務用アカウントのタブを本物のブラウザ（Chromium）で。模擬サーバー・合成データだけ（本番にはつながない）。
// 使い方：node upsell-v1176-gen.mjs <data.json> /tmp/u.json → 模擬サーバー（tests/perf/server.mjs）を DATA_FILE=/tmp/u.json で → DATA_FILE=/tmp/u.json node upsell-v1176.mjs [結果の JSON]
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const D = JSON.parse(fs.readFileSync(process.env.DATA_FILE || '/tmp/u.json', 'utf8'));
const REC = 'Menu 24';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(tag, w = 1280, mob = false) { const dir = '/tmp/bprobe1176-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: w, height: 860 }, isMobile: mob, hasTouch: mob, locale: 'ja-JP', timezoneId: 'Pacific/Honolulu' });
  const page = ctx.pages()[0] || await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 160))); page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(APP); await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 }); return { ctx, page, errors }; }
async function login(page, loc, name) { await page.evaluate(s => loginPickLocation(s), loc); await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 180000 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 180000, polling: 100 }); await sleep(1500); }
async function openCard(page) { await page.evaluate(() => { window._kpiTab = 'manual'; window._kpiStore = 'F04-K'; go('kpi_master'); });
  await page.waitForFunction(() => { const c = document.getElementById('ups-card'); return c && /Crab/.test(c.innerText); }, null, { timeout: 30000 }).catch(() => {});
  await sleep(800); return page.evaluate(() => { const c = document.getElementById('ups-card'); return c ? c.innerText : ''; }); }
const cloud = page => page.evaluate(async () => { const r = await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.kpi_config&select=value', { headers: supaHeaders() }); const j = await r.json(); const v = j && j[0] && j[0].value; const u = (v && v.__st) ? v.v : v; return ((u && u.byStore) || {})['F04-K'] || null; });
const res = []; const ok = (n, c, i) => { res.push({ n, ok: !!c }); console.log((c ? 'OK  ' : 'NG  ') + n + (i !== undefined && !c ? '  ' + JSON.stringify(i).slice(0, 400) : '')); };
let A = await open('gm'); await login(A.page, 'OFFICE', D.login.gm);
let txt = await openCard(A.page);
ok('カードが出る（Totoya）', /アップグレード率に入れるもの/.test(txt), txt.slice(0, 200));
ok('まだ設定がない', /まだ設定がありません/.test(txt));
ok('モディファイヤーの候補（直近 30 日・ID ごと）', /Crab Miso/.test(txt) && /Udon Miso/.test(txt) && /CHAZUKE/.test(txt));
ok('Aosa は分母だけ（選べない）', await A.page.evaluate(() => { const l = [...document.querySelectorAll('#ups-card label')].find(x => /Aosa/.test(x.innerText)); return !!(l && l.querySelector('input').disabled && /分母だけ/.test(l.innerText)); }));
ok('アラカルトの候補にこの店の品', txt.includes(REC));
ok('トッピング比率のカードは名前が変わった', await A.page.evaluate(() => /トッピング\/アップセル比率の対象商品/.test(document.getElementById('main-content').innerText)));
await A.page.evaluate(name => { const l = [...document.querySelectorAll('#ups-card label')].find(x => x.innerText.includes(name)); l.querySelector('input').click(); }, REC);
await A.page.click('#ups-card [onclick^="FUNERGY_UPS.save"]');
await A.page.waitForFunction(() => /保存しました|未保存/.test((document.getElementById('ups-card') || {}).innerText || ''), null, { timeout: 20000 }).catch(() => {});
txt = await A.page.evaluate(() => document.getElementById('ups-card').innerText);
ok('保存しました（クラウドに書けたあと）', /保存しました/.test(txt), txt.slice(-300));
const c1 = await cloud(A.page);
const v = (c1 && c1.upsell) || [];
ok('クラウド：店ごとの版 2026-11・アラカルト 1・モディファイヤーは Aosa 以外の 3', v.length === 1 && v[0].from === '2026-11' && v[0].ala.length === 1 && v[0].mods.length === 3 && !v[0].mods.includes('M-AOSA'), c1);
await A.page.waitForFunction(() => { try { const m = FUNERGY_UPS.month('F04-K', '2026-11'); return m.st === 'ok'; } catch (e) { return false; } }, null, { timeout: 20000, polling: 300 }).catch(() => {});
const m = await A.page.evaluate(() => { const m = FUNERGY_UPS.month('F04-K', '2026-11'); return { st: m.st, all: m.all, M: m.M, alaRaw: m.alaRaw, overlap: m.overlap, succ: m.succ, nopp: m.nopp, rate: m.rate, re: m.n.reimport }; });
ok('月の数：分母 130・モディファイヤー 52・アラカルト成立 13（重複 13・機会なし 13）・50%・取り込み直し 1 日', m.all === 130 && m.M === 52 && m.alaRaw === 26 && m.overlap === 13 && m.succ === 65 && m.nopp === 13 && m.rate === 50 && m.re === 1, m);
const tk = await A.page.evaluate(() => { const k = totoyaKpiCalc('F04-K', '2026.11'); return { rate: k.misoRate, src: k.src.misoUp }; });
ok('KPI（totoyaKpiCalc）も同じ 50%・出どころ「アップセル設定（一部の日だけ・取り込み直し待ち 1 日）」', tk.rate === 50 && tk.src === 'アップセル設定（一部の日だけ・取り込み直し待ち 1 日）', tk);
txt = await openCard(A.page);
ok('カードの内訳：50.0%・式・機会なし・取り込み直しの日', /50\.0%/.test(txt) && /\(52＋26−13\)÷130/.test(txt) && /機会なし/.test(txt) && /v1176 より前に取り込んだ日が 1 日/.test(txt), txt.slice(txt.indexOf('この月'), txt.indexOf('この月') + 600));
const up = await A.page.evaluate(() => { const days = []; for (let i = 1; i <= 14; i++) days.push('2026-11-' + String(i).padStart(2, '0')); const s = FUNERGY_UP.stats(['F04-K'], days); const id = FUNERGY_UP.ctx(['F04-K'], days, { misoRate: 50, misoUp: s.up, misoAll: s.all }); const div = document.createElement('div'); div.innerHTML = FUNERGY_UP.html(id); return { all: s.all, up: s.up, rate: s.rate, t: div.innerText.slice(0, 1500) }; });
ok('日次進捗の内訳（FUNERGY_UP）も同じ数', up.all === 130 && up.up === 65 && up.rate === 50, up);
ok('内訳の画面に新しい数え方', /アップセル対象での数え方/.test(up.t) && /1 つの機会は 1 回だけ/.test(up.t), up.t.slice(0, 500));
// 別の端末（読み込み直し）でも同じ
await A.ctx.close();
let B = await open('gm2'); await login(B.page, 'OFFICE', D.login.gm);
txt = await openCard(B.page);
ok('別の端末：保存した版が出る（2026/11 から）', /2026\/11 から/.test(txt) && /アラカルト 1/.test(txt), txt.slice(0, 600));
// 店ごとの下書き（Codex #174 の P2-2）：店を替えて戻っても、保存していない変更が残る・ほかの店の下書きにならない
await B.page.evaluate(() => { FUNERGY_UPS.setFrom('2026-12'); window._kpiStore = 'F04-P'; renderPage('kpi_master'); }); await sleep(600);
const pTxt = await B.page.evaluate(() => (document.getElementById('ups-card') || {}).innerText || '');
await B.page.evaluate(() => { window._kpiStore = 'F04-K'; renderPage('kpi_master'); }); await sleep(600);
const kTxt = await B.page.evaluate(() => (document.getElementById('ups-card') || {}).innerText || '');
ok('店を替えて戻っても、保存していない変更が残る（ほかの店には出ない）', /まだ保存していない変更があります/.test(kTxt) && !/まだ保存していない変更があります/.test(pTxt), { p: pTxt.slice(-200), k: kTxt.slice(-200) });
const sel = await B.page.evaluate(() => { const o = document.querySelector('#ups-card select option[selected]'); return o ? o.value : ''; });
ok('戻った店の下書きは 2026-12 のまま', sel === '2026-12', sel);
// 業務用アカウントのタブ
await B.page.evaluate(() => { window._kpiTab = 'sysacct'; window._kpiStore = 'F01'; go('kpi_master'); }); await sleep(1200);
const sa = await B.page.evaluate(() => document.getElementById('main-content').innerText);
ok('業務用アカウントのタブが開く（GM は変えられる）', /業務用アカウント/.test(sa) && !/変えられるのは/.test(sa.slice(0, 2000)) , sa.slice(0, 600));
// 一覧の引き継ぎ（Claude #174 の P3-2）：クラウドを読んでから作る → クラウドに F01 の一覧ができ、画面も一覧を出す
const sysCloud = async page => page.evaluate(async () => { const r = await fetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.kpi_config&select=value', { headers: supaHeaders() }); const j = await r.json(); const v = j && j[0] && j[0].value; const u = (v && v.__st) ? v.v : v; return (((u && u.byStore) || {}).F01 || {}).sysAcct || null; });
let sc = null; for (let i = 0; i < 30 && !sc; i++) { await sleep(500); sc = await sysCloud(B.page); }
const sa2 = await B.page.evaluate(() => document.getElementById('main-content').innerText);
ok('一覧はクラウドを読んでから作られ、クラウドに入る', !!sc && typeof sc === 'object' && !/一覧を作っています/.test(sa2), { sc, t: sa2.slice(0, 300) });
await B.ctx.close();
// スマホ（390px・タッチ）：カードがはみ出さない
let S = await open('sp', 390, true); await login(S.page, 'OFFICE', D.login.gm);
const stxt = await openCard(S.page);
const ov = await S.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, card: (document.getElementById('ups-card') || {}).scrollWidth }));
ok('390px：カードが出て横にはみ出さない', /2026\/11 から/.test(stxt) && ov.sw <= ov.cw + 1, ov);
ok('pageerror 0', !A.errors.length && !B.errors.length && !S.errors.length, [...A.errors, ...B.errors, ...S.errors]);
await S.ctx.close();
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ res, m, tk }, null, 1));
process.exit(res.every(r => r.ok) ? 0 : 1);
