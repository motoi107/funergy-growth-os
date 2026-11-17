// v1184（Moto さん 11/16 の依頼 1・2）を本物のブラウザ（Chromium）と模擬サーバー（合成データ）で確かめる。本番にはつながない。
//   1. 予実 › KPI設定 で「使う」を外す・足すと、会議タブ（タイル・一覧・年間の表）が同じになる。ON で実績の無い KPI は「—」。全部 OFF は「表示するKPIが設定されていません」。
//      ほかの端末（ログインしたまま）でも会議タブを開くとクラウドの設定になる（古い写しで戻さない）。読めないときは帯で知らせる。
//      年間の表の 7 月からの目標も KPI設定の目標（前に会議タブで手入力した目標は使わない・Codex #182 の P2）。
//   2. 本部所属（従業員マスターの所属＝Office）の人は店舗のスキルマトリクス（店舗別・従業員別・ポジション別）に出ない。全店・未設定の人は残して一行で知らせる。
// この台本が模擬サーバー（tests/perf/server.mjs）を立てる。合成データ（DATA_FILE・gen-data.mjs の出力）の写しを作り、何人かの所属だけを変える。
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert DATA_FILE=/tmp/pcsp/data.json node tests/e2e-pcsp/three-fixes-v1184.mjs [結果の JSON]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const APP = 'http://localhost:8080/';
const SRC = JSON.parse(fs.readFileSync(process.env.DATA_FILE || '/tmp/pcsp/data.json', 'utf8'));
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 合成データの写し：F01 のクルー 2 人と Head Chef の所属だけを変える（本部・未設定） */
const D = JSON.parse(JSON.stringify(SRC));
const emps = D.tables.employees;
const f01crew = emps.filter(e => e.data.store === 'F01' && e.data.role === 'crew' && e.data.status !== '退職');
const HQ = f01crew[0], NONE = f01crew[1], CHEF = emps.find(e => e.data.role === 'chef');
HQ.data.store = 'OFFICE'; HQ.data.support = ['F01'];   // 本部所属で F01 を応援（前は F01 の表に出ていた）
NONE.data.store = ''; NONE.data.support = ['F01'];     // 所属なし（確認対象として残す）
if (CHEF) { CHEF.data.store = 'OFFICE'; }               // Head Chef（role chef は全店に出ていた）を本部所属に
for (const e of [HQ, NONE, CHEF].filter(Boolean)) { if ('store' in e) e.store = e.data.store; }
const WORK = '/tmp/e2e3'; fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'data.json'), JSON.stringify(D));

/* ---- 模擬サーバー */
const srv = spawn(process.execPath, [path.join(ROOT, 'tests/perf/server.mjs')], { env: Object.assign({}, process.env, { APP_DIR: process.env.APP_DIR || ROOT, DATA_FILE: path.join(WORK, 'data.json'), APP_PORT: '8080' }), stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { srv.kill(); } catch (e) { } });
process.on('uncaughtException', e => { console.error(e); try { srv.kill(); } catch (x) { } process.exit(2); });
process.on('unhandledRejection', e => { console.error(e); try { srv.kill(); } catch (x) { } process.exit(2); });
let srvLog = ''; srv.stdout.on('data', d => (srvLog += d)); srv.stderr.on('data', d => (srvLog += d));
for (let i = 0; i < 100; i++) { try { const r = await fetch(APP + 'sw.js'); if (r.ok) break; } catch (e) { } await sleep(200); }
if (srv.exitCode != null) { console.error('模擬サーバーが動いていません（ほかの模擬サーバーが 8080・443 を使っていないか）\n' + srvLog); process.exit(2); }
await sleep(800); if (srv.exitCode != null) { console.error('模擬サーバーが止まりました\n' + srvLog); process.exit(2); }

const res = []; const ok = (n, c, i) => { res.push({ n, ok: !!c, i }); console.log((c ? 'OK  ' : 'NG  ') + n + (i !== undefined ? '  ' + JSON.stringify(i).slice(0, 400) : '')); };
async function open(tag, width, lang = 'ja-JP') {
  const dir = '/tmp/bprobe-3f-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width, height: 900 }, locale: lang, timezoneId: 'Pacific/Honolulu', hasTouch: width < 600, isMobile: width < 600 });
  const page = ctx.pages()[0] || await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160))); page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(APP); await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 }); return { ctx, page, errors };
}
async function login(page, loc, name) {
  await page.evaluate(s => loginPickLocation(s), loc); await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 180000 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 180000, polling: 100 }); await sleep(1500);
}
/* 会議タブ（1 店）。KPI設定の照らし合わせ（meetCfgSync）が終わるまで待つ */
async function meeting(page, sid) {
  await page.evaluate(s => { _budgetStore = s; go('meeting'); }, sid);
  await page.waitForFunction(() => { const e = document.querySelector('[data-meet-cfgsync]'); return e && e.getAttribute('data-meet-cfgsync') !== 'wait'; }, null, { timeout: 30000 }).catch(() => {});
  await sleep(600);
  return page.evaluate(() => {
    const m = document.getElementById('main-content');
    const tiles = [...m.querySelectorAll('[data-meet-tiles] [data-meet-kpi]')].map(e => e.getAttribute('data-meet-kpi'));
    const mat = m.querySelector('[data-meet-matrix]');
    const tileAct = {}; m.querySelectorAll('[data-meet-tiles] [data-meet-kpi]').forEach(e => { tileAct[e.getAttribute('data-meet-kpi')] = e.innerText.replace(/\s+/g, ' ').slice(0, 160); });
    return { tiles, rows: mat ? mat.getAttribute('data-meet-rows').split(',') : [], nokpi: !!m.querySelector('[data-meet-nokpi]'), kpierr: !!m.querySelector('[data-meet-kpierr]'),
      sync: (m.querySelector('[data-meet-cfgsync]') || {}).getAttribute ? m.querySelector('[data-meet-cfgsync]').getAttribute('data-meet-cfgsync') : null,
      google: m.querySelectorAll('.card-title .ti-brand-google').length, tileAct, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      text: m.innerText.slice(0, 200) };
  });
}
/* KPI設定で「使う」を変えて、その月を保存（画面のチェックを押してから保存のボタン） */
async function setUse(page, sid, changes) {
  await page.evaluate(s => { window._kpiTab = 'store'; window._kpiStore = s; window._k2Ym = null; go('kpi_master'); }, sid); await sleep(1200);
  for (const [k, v] of Object.entries(changes)) {
    const cur = await page.evaluate(k => { const e = document.getElementById('k2o-' + k); return e ? e.checked : null; }, k);
    if (cur === null) throw new Error('no checkbox ' + k);
    if (cur !== v) await page.click('#k2o-' + k);
  }
  await page.evaluate(s => { const b = [...document.querySelectorAll('button')].find(x => /k2SaveMonth/.test(x.getAttribute('onclick') || '')); b.click(); }, sid);
  await sleep(2500);   // 送るのを待つ（kpi_man_ は cas）
  return page.evaluate(s => { const out = {}; K2_DEFS.forEach(d => { out[d.key] = k2On(s, curYm(), d.key); }); return out; }, sid);
}
const cloudKpi = page => page.evaluate(async () => {
  const k = kpiManualKey(k2Period(curYm()));
  const r = await fetch(SUPABASE_URL + '/rest/v1/app_state?key=eq.' + encodeURIComponent(k) + '&select=value', { headers: supaHeaders() }); const j = await r.json();
  const v = j && j[0] && j[0].value; const u = (v && v.__st) ? v.v : v; return (u && u.F01) || null;
});
const out = {};
const M2K = { guests: 'guests', ppa: 'ppa', repeat: 'repeatRate', fc: 'foodCost', labor: 'laborPct', hours: 'laborHours', drink: 'drinkRate', miso: 'misoUpgradeRate', ikura: 'ikuraShowerRate', google: 'reviewScore' };
const ALLK = ['guests', 'ppa', 'repeatRate', 'foodCost', 'laborPct', 'laborHours', 'drinkRate', 'misoUpgradeRate', 'ikuraShowerRate', 'reviewScore'];

/* ===== 端末 B（GM・先にログインしておく＝KPI設定の古い写しを持つ） */
const B = await open('b', 1440); await login(B.page, 'OFFICE', SRC.login.gm);
out.b0 = await meeting(B.page, 'F01');

/* ===== 端末 A（CEO・PC 1440）：KPI設定で変える → 会議タブ */
const A = await open('a', 1440); await login(A.page, 'OFFICE', SRC.login.ceo);
out.a0 = await meeting(A.page, 'F01');
ok('1-0 前：会議の行＝KPI設定の「使う」（売上のほか ON の KPI がタイルに出る・Google は下のカード）', out.a0.tiles.length > 0 && !out.a0.nokpi && !out.a0.kpierr && out.a0.rows[0] === 'sales', { tiles: out.a0.tiles, rows: out.a0.rows });
out.onA0 = await A.page.evaluate(() => { const o = {}; K2_DEFS.forEach(d => { o[d.key] = k2On('F01', curYm(), d.key); }); return o; });
ok('1-0b 前：会議の年間の表の行は KPI設定で ON の KPI と同じ（並びも KPI設定）', JSON.stringify(out.a0.rows) === JSON.stringify(['sales'].concat(Object.keys(M2K).filter(m => out.onA0[M2K[m]]))), { rows: out.a0.rows, on: out.onA0 });
/* 原価率とリピート率を外し、アップグレード率（F01 は丼の店でない＝実績なし）を使う */
out.setA1 = await setUse(A.page, 'F01', { foodCost: false, repeatRate: false, misoUpgradeRate: true });
out.a1 = await meeting(A.page, 'F01');
ok('1-1 外した原価率・リピート率は会議のタイルにも年間の表にも出ない', !out.a1.tiles.includes('fc') && !out.a1.tiles.includes('repeat') && !out.a1.rows.includes('fc') && !out.a1.rows.includes('repeat'), { tiles: out.a1.tiles, rows: out.a1.rows });
ok('1-2 使うにしたアップグレード率は出る（KPI設定の並びの位置）', out.a1.tiles.includes('miso') && out.a1.rows.includes('miso') && out.a1.rows.indexOf('miso') > out.a1.rows.indexOf('labor'), out.a1.rows);
ok('1-3 ON で実績の無い KPI は「—」（0 と出さない）', /—/.test(out.a1.tileAct.miso || '') && !/\b0(\.0)?%/.test(out.a1.tileAct.miso || ''), out.a1.tileAct.miso);
const AL = await A.page.evaluate(() => { const o = {}; K2_DEFS.forEach(d => { const r = (k2Actuals('F01', curYm()) || { rows: [] }).rows.find(x => x.key === d.key); o[d.key] = r ? r.label : null; }); return o; });
const tileLabels = await A.page.evaluate(() => [...document.querySelectorAll('[data-meet-tiles] [data-meet-kpi]')].map(e => e.innerText.split('\n').map(s => s.trim()).filter(Boolean)[0]));
ok('1-4 名前は KPI設定と同じ', tileLabels.every(l => Object.values(AL).some(v => v && l.indexOf(v) === 0)), { tileLabels, AL });
out.cloud1 = await cloudKpi(A.page);
ok('1-5 設定はクラウド（app_state の kpi_man_）に入った', out.cloud1 && out.cloud1.off_foodCost === true && out.cloud1.off_repeatRate === true && out.cloud1.off_misoUpgradeRate === false, out.cloud1);

/* ===== 端末 B：ログインしたまま会議タブを開き直す → クラウドの設定（古い写しで戻さない） */
await B.page.evaluate(() => { try { _meetCfg.at = 0; } catch (e) { } }); out.b1 = await meeting(B.page, 'F01');
ok('1-6 ほかの端末（ログインしたまま）でも会議タブを開くとクラウドの設定になる', !out.b1.tiles.includes('fc') && !out.b1.tiles.includes('repeat') && out.b1.tiles.includes('miso') && out.b1.sync === 'ok', { tiles: out.b1.tiles, sync: out.b1.sync });
ok('1-6b 会議の行（端末 A と B）が同じ', JSON.stringify(out.b1.rows) === JSON.stringify(out.a1.rows), { a: out.a1.rows, b: out.b1.rows });
out.cloudAfterB = await cloudKpi(B.page);
ok('1-7 B が開いたあともクラウドの設定はそのまま（古い写しで上書きしない）', JSON.stringify(out.cloudAfterB) === JSON.stringify(out.cloud1), out.cloudAfterB);
/* 読み込み直しても同じ */
await B.page.reload(); await B.page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
await login(B.page, 'OFFICE', SRC.login.gm); out.b2 = await meeting(B.page, 'F01');
ok('1-8 読み込み直しても同じ', JSON.stringify(out.b2.rows) === JSON.stringify(out.a1.rows) && JSON.stringify(out.b2.tiles) === JSON.stringify(out.a1.tiles), { b2: out.b2.rows });

/* ===== 読めないとき（KPI設定のクラウドの読み取りだけ止める） */
await B.page.evaluate(() => { window.__realFetch3 = window.__realFetch3 || window.fetch.bind(window); window.fetch = function (u, o) { const s = String(u && u.url || u); if (/\/rest\/v1\/app_state\?key=in\./.test(s)) return Promise.resolve(new Response('{}', { status: 503 })); return window.__realFetch3(u, o); }; });
await B.page.evaluate(() => { try { meetCfgRetry(curYm()); } catch (e) { } }); await sleep(2500);
out.b3 = await meeting(B.page, 'F01');
ok('1-9 KPI設定をクラウドから読めないときは帯で知らせる（この端末の設定で出していると書く）', out.b3.sync === 'err' && await B.page.evaluate(() => /KPI設定をクラウドから読めませんでした/.test(document.getElementById('main-content').innerText)), out.b3.sync);
ok('1-9b 読めなくても KPI を黙って消さない（この端末の設定で出す）', JSON.stringify(out.b3.tiles) === JSON.stringify(out.a1.tiles), out.b3.tiles);
await B.page.evaluate(() => { window.fetch = window.__realFetch3; });
await B.page.evaluate(() => { try { meetCfgRetry(curYm()); } catch (e) { } }); await sleep(2500); out.b4 = await meeting(B.page, 'F01');
ok('1-9c 「もう一度」で戻る', out.b4.sync === 'ok', out.b4.sync);

/* ===== 全部 OFF（売上のほか） → 「表示するKPIが設定されていません」 */
const offAll = Object.fromEntries(ALLK.map(k => [k, false]));
out.setA2 = await setUse(A.page, 'F01', offAll);
out.a2 = await meeting(A.page, 'F01');
ok('1-10 全部 OFF は「表示するKPIが設定されていません」（既定の KPI に戻さない）', out.a2.nokpi && out.a2.tiles.length === 0 && JSON.stringify(out.a2.rows) === '["sales"]', out.a2);
ok('1-10b Google の口コミのカードも出さない（KPI設定で使っていない）', out.a2.google === 0 && out.a1.google >= 1, { before: out.a1.google, after: out.a2.google });
/* 全店の一覧（店を選ばない） */
await A.page.evaluate(() => { _budgetStore = 'ALL'; go('meeting'); }); await sleep(2500);
out.aAll = await A.page.evaluate(() => ({ f01: !!document.querySelector('[data-meet-kpilist="F01"]'), nokpi: document.querySelectorAll('[data-meet-nokpi]').length, lists: document.querySelectorAll('[data-meet-kpilist]').length }));
ok('1-11 全店の一覧：F01 は「表示するKPIが設定されていません」・ほかの店は KPI 名の一覧', !out.aAll.f01 && out.aAll.nokpi >= 1 && out.aAll.lists >= 1, out.aAll);
/* 戻す（ほかの試験のため・全部 ON に） */
await setUse(A.page, 'F01', Object.fromEntries(ALLK.map(k => [k, true])));

/* ===== Codex #182 の P2：年間の表の 7 月からの目標は KPI設定の目標（前に会議タブで手入力した目標は使わない・消さない） */
const ymNow = await A.page.evaluate(() => curYm());
await A.page.evaluate(ym => { const m = parseInt(ym.slice(5), 10), e = getKgiEdits(); e.F01 = e.F01 || {}; e.F01.fc = e.F01.fc || {}; e.F01.fc['t' + m] = 99; lsSet('meeting_kgi_edits', e); }, ymNow);
await A.page.evaluate(s => { window._kpiTab = 'store'; window._kpiStore = s; window._k2Ym = null; go('kpi_master'); }, 'F01'); await sleep(1200);
await A.page.fill('#k2t-foodCost', '30');
await A.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /k2SaveMonth/.test(x.getAttribute('onclick') || '')); b.click(); }); await sleep(2500);
out.a3 = await meeting(A.page, 'F01');
out.a3m = await A.page.evaluate(ym => {
  const m = parseInt(ym.slice(5), 10), tb = document.querySelector('[data-meet-matrix] table'); if (!tb) return null;
  const tr = [...tb.querySelectorAll('tr')].find(r => { const c = r.querySelector('td'); return c && /原価率/.test(c.innerText) && /目標/.test(c.innerText); }); if (!tr) return null;
  const td = tr.querySelectorAll('td')[m];
  return { text: td.innerText.trim(), cfg: !!td.querySelector('[data-meet-tgt-cfg]'), hand: /openMeetKgiEdit/.test(td.innerHTML) };
}, ymNow);
ok('1-13 KPI設定の原価率の目標 30%・前の手入力 99%：会議のタイルも年間の表も 30%（手入力を使わない）', /目標 30(\.0)?%/.test(out.a3.tileAct.fc || '') && out.a3m && out.a3m.text === '30%' && out.a3m.cfg && !out.a3m.hand, { tile: out.a3.tileAct.fc, cell: out.a3m });
await A.page.evaluate(ym => { const m = parseInt(ym.slice(5), 10), tb = document.querySelector('[data-meet-matrix] table');
  const tr = [...tb.querySelectorAll('tr')].find(r => { const c = r.querySelector('td'); return c && /原価率/.test(c.innerText) && /目標/.test(c.innerText); }); tr.querySelectorAll('td')[m].querySelector('[data-meet-tgt-cfg]').click(); }, ymNow);
await sleep(500);
out.a3modal = await A.page.evaluate(() => ({ info: !!document.querySelector('[data-meet-tgt-info]'), old: (document.querySelector('[data-meet-tgt-old]') || {}).innerText || '', kept: (getKgiEdits().F01 || {}).fc }));
ok('1-14 目標のマスを押すと KPI設定で直す案内と前の手入力（99・使っていない・消していない）', out.a3modal.info && /99/.test(out.a3modal.old) && /使っていません/.test(out.a3modal.old) && Object.values(out.a3modal.kept || {}).includes(99), out.a3modal);
await A.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });

/* ===== スマホ 390（日本語・英語） */
for (const lang of ['ja-JP', 'en-US']) {
  const P = await open('p-' + lang, 390, lang); await login(P.page, 'OFFICE', SRC.login.gm);
  if (lang === 'en-US') await P.page.evaluate(() => { try { setLang('en'); } catch (e) { curLang = 'en'; } });
  const r = await meeting(P.page, 'F01');
  ok('1-12 スマホ 390（' + lang + '）：会議のタイル・年間の表・横のはみ出しなし', r.tiles.length > 0 && r.rows && r.scrollX <= 1, { tiles: r.tiles.length, scrollX: r.scrollX });
  out['p_' + lang] = r; out['pe_' + lang] = P.errors; await P.ctx.close();
}

/* ===== 2. スキルマトリクス（GM・PC 1440） */
const names = { hq: HQ.data.name, none: NONE.data.name, chef: CHEF && CHEF.data.name };
async function skill(page, view, store) {
  await page.evaluate(n => { window.__hqn = n.hq; window.__chefn = n.chef; }, names);
  await page.evaluate(([v, s]) => { window._skillView = v; window._skillMatrixStore = s; window._skillStaffStore = s; go('skill'); }, [view, store]); await sleep(1500);
  return page.evaluate(() => {
    const m = document.getElementById('main-content').cloneNode(true); const note = m.querySelector('[data-skill-hq]');
    /* プレップLv（時給の認定・事務Crew も候補）の欄はスキルマトリクスとは別の決まり（この依頼の外）。候補の選択肢に出るので外して見る */
    const prep = [...m.querySelectorAll('.card')].filter(c => c.querySelector(':scope > .card-title .ti-tools-kitchen-2')); prep.forEach(c => c.remove());
    const nt = note ? { hq: note.getAttribute('data-hq-n'), chk: note.getAttribute('data-chk-n'), text: note.innerText } : null; if (note) note.remove();
    const b = m.innerText; const ctx = n => { const i = b.indexOf(n); return i < 0 ? null : b.slice(Math.max(0, i - 160), i + 60); };
    return { body: b, ctxOf: { hq: ctx(window.__hqn), chef: ctx(window.__chefn) }, note: nt, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}
const S1 = await skill(A.page, 'store', 'F01');
ok('2-1 店舗別（F01）：本部所属の人・本部所属の Head Chef は表に出ない', !S1.body.includes(names.hq) && (!names.chef || !S1.body.includes(names.chef)), { names, ctx: S1.ctxOf });
ok('2-2 所属なしの人は残す（確認対象）', S1.body.includes(names.none));
ok('2-3 GM には一行で知らせる（外した人数・確認対象の人数と名前）', S1.note && +S1.note.hq >= 1 && S1.note.text.includes(names.hq) && S1.note.text.includes(names.none), S1.note);
const S2 = await skill(A.page, 'staff', 'F01');
ok('2-4 従業員別（F01）：本部所属の人は出ない', !S2.body.includes(names.hq) && (!names.chef || !S2.body.includes(names.chef)));
const S3 = await skill(A.page, 'position', 'F01');
ok('2-5 ポジション別（F01・Lv の人数）：本部所属の人は出ない', !S3.body.includes(names.hq) && (!names.chef || !S3.body.includes(names.chef)));
const S4 = await skill(A.page, 'store', 'F02');
ok('2-6 ほかの店（F02）にも本部所属の Head Chef は出ない', !names.chef || !S4.body.includes(names.chef));
/* データは消さない：本部所属の人のスキルの記録は残る */
const kept = await A.page.evaluate(n => { try { const s = getEmpSkillsStore(n, 'F01') || {}; return Object.keys(s).length; } catch (e) { return -1; } }, names.hq);
ok('2-7 本部所属の人のスキルの記録は消していない（読むだけ）', kept >= 0, kept);
const P2 = await open('p-skill', 390); await login(P2.page, 'OFFICE', SRC.login.gm);
const S5 = await skill(P2.page, 'store', 'F01');
ok('2-8 スマホ 390：店舗別（F01）に本部所属の人は出ない・横のはみ出しなし', !S5.body.includes(names.hq) && S5.scrollX <= 1, { scrollX: S5.scrollX, ctx: S5.ctxOf });
out.p2e = P2.errors; await P2.ctx.close();

ok('pageerror 0', !A.errors.length && !B.errors.length && !(out['pe_ja-JP'] || []).length && !(out['pe_en-US'] || []).length && !(out.p2e || []).length, { A: A.errors, B: B.errors, p: [out['pe_ja-JP'], out['pe_en-US'], out.p2e] });
await A.ctx.close(); await B.ctx.close();
srv.kill();
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ out, res }, null, 1));
console.log(res.filter(r => r.ok).length + '/' + res.length);
process.exit(res.every(r => r.ok) ? 0 : 1);
