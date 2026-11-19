// v1199（段階 3 の 1 歩目・UI案97・Moto さん 11/19 の答え）：経理センターの中タブを本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs・SS_REAL=1）と合成データだけ。本番にはつながない。データの作り方は loc-v1196.mjs と同じ（data2.json）。
// 確かめること（PC 1440・スマホ 390 × 日英）：経理・事務Crew・GM
//   中タブが 7 つ（経理ホーム・経理レビュー・インボイス取り込み・Tip＆シフトリーダー・本部タイムカード・履歴・帳票・マスター・設定）
//   どの中タブを押しても落ちない（pageerror・「読み込みに失敗」が無い）・横のはみ出しが無い
//   事務Crew には「経理出力」が無い（6A）・経理と GM にはある
//   経理ホーム：打刻のカードが残る（1）・外した入口（エラーセンター・業務Bot）からワークセンターへ（5）・「出勤中」のタイルで本部タイムカードへ
//   Invoice 取り込みの設定はマスター・設定
// 使い方：PCSP_DIR=/tmp/pcsp SHOTS=/tmp/ac-shots node tests/e2e-pcsp/acct-tabs-v1199.mjs
async function loadChromium() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of tries) { try { const mod = await import(m); if (mod.chromium) return mod.chromium; } catch (e) { /* 次を試す */ } }
  throw new Error('Playwright が見つかりません（PLAYWRIGHT_MODULE に index.mjs の場所を入れてください）');
}
const chromium = await loadChromium();
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data2.json', 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'];
const SHOTS = process.env.SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
try { await fetch(APP + '__reset'); } catch (e) { /* 模擬サーバーだけ */ }

async function pinStep(page) {
  await sleep(400);
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.waitForFunction(() => { const p = document.getElementById('login-step-pin'); return p && p.style.display !== 'none'; }, null, { timeout: 60000 });
}
async function open(W, lang, who) {
  const mobile = W < 768;
  const dir = '/tmp/ac1199-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
    viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  await page.evaluate(l => { setLang(l); }, lang);
  await page.evaluate(() => loginPickLocation('OFFICE'));
  await page.locator('#login-name-grid .store-btn', { hasText: who }).first().click();
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 100 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(1500);
  return { ctx, page, errors };
}
const over = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {}); };
const bar = page => page.evaluate(() => ({ page: curPage, cat: _acCat, sub: _acSub,
  tabs: [...document.querySelectorAll('.ac-main .ac-btn')].map(b => b.innerText.replace(/\s+/g, ' ').trim()),
  subs: [...document.querySelectorAll('.ac-subs .mm-tab')].map(b => b.innerText.replace(/\s+/g, ' ').trim()),
  fail: /読み込みに失敗|Failed to load this view|この画面を開けませんでした/.test(document.getElementById('main-content').innerText),
  len: document.getElementById('main-content').innerText.length }));
const WANT = { ja: ['経理ホーム', '経理レビュー', 'インボイス取り込み', 'Tip＆シフトリーダー', '本部タイムカード', '履歴・帳票', 'マスター・設定'],
  en: ['Accounting home', 'Accounting review', 'Invoice intake', 'Tips & shift leaders', 'HQ time card', 'Records & reports', 'Masters & settings'] };
const CATS = ['dash', 'review', 'drive', 'tip', 'attend', 'reports', 'master'];

for (const [W, lang] of [[1440, 'ja'], [390, 'ja'], [390, 'en'], [1440, 'en']]) {
  for (const [role, who] of [['office_crew', DATA.oc], ['office', DATA.of], ['gm', DATA.gm]]) {
    const tag = W + ' ' + lang + ' ' + role;
    const { ctx, page, errors } = await open(W, lang, who);
    await page.evaluate(() => { _acCat = 'dash'; _acSub = 'dash'; go('acct_center'); }); await sleep(900);
    let b = await bar(page);
    ok(tag + ': 中タブが 7 つ（名前と並び）', JSON.stringify(b.tabs.map(x => x.replace(/\s*\d+$/, ''))) === JSON.stringify(WANT[lang]), b.tabs);
    const home = await page.evaluate(() => ({ clock: !!document.querySelector('#main-content button[onclick="officeClockIn()"]'), wl: !!document.querySelector('.ac-wlinks'),
      err: !!document.querySelector('.ac-wlinks [onclick="acGoWork(\'error\')"]'), bot: !!document.querySelector('.ac-wlinks [onclick="acGoWork(\'bot\')"]') }));
    ok(tag + ': 経理ホームに打刻（1）と外した入口（5）', home.clock && home.wl && home.err && home.bot, home);
    await shot(page, role + '-' + W + '-' + lang + '-home');
    for (const id of CATS) {
      await page.click('.ac-main .ac-btn[onclick="acSetCat(\'' + id + '\')"]'); await sleep(700);
      b = await bar(page);
      const o = await over(page);
      ok(tag + ': ' + id + ' を開ける', b.page === 'acct_center' && b.cat === id && !b.fail && b.len > 40 && o <= 0, { sub: b.sub, subs: b.subs, over: o });
      if (id === 'reports') ok(tag + ': 経理出力は' + (role === 'office_crew' ? '出さない（6A）' : '出す'), (role === 'office_crew') === !b.subs.some(s => /経理出力|Accounting export/.test(s)), b.subs);
      if (id === 'master') ok(tag + ': Invoice 取り込みの設定はマスター・設定', b.subs.some(s => /Invoice 取り込みの設定|Invoice intake settings/.test(s)) && b.subs.some(s => /業者マスター|Vendor master/.test(s)), b.subs);
      if (id === 'review' && W === 390) await shot(page, role + '-' + W + '-' + lang + '-review');
      if (id === 'master' && W === 1440) await shot(page, role + '-' + W + '-' + lang + '-master');
    }
    // 経理ホームの「出勤中」のタイル → 本部タイムカード（前は経理ホームに戻るだけだった）
    await page.click('.ac-main .ac-btn[onclick="acSetCat(\'dash\')"]'); await sleep(600);
    await page.locator('#main-content [onclick="setOfficeMgrTab(\'attend\')"]').first().click(); await sleep(700);
    b = await bar(page);
    ok(tag + ': 「出勤中」のタイルで本部タイムカード', b.page === 'acct_center' && b.cat === 'attend', [b.cat, b.sub]);
    // 外した入口 → ワークセンター › エラー
    await page.click('.ac-main .ac-btn[onclick="acSetCat(\'dash\')"]'); await sleep(600);
    await page.locator('.ac-wlinks [onclick="acGoWork(\'error\')"]').click(); await sleep(900);
    const wc = await page.evaluate(() => ({ page: curPage, tab: workTab }));
    ok(tag + ': エラーセンターはワークセンター › エラー', wc.page === 'tasks' && wc.tab === 'error', wc);
    ok(tag + ': pageerror なし', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + ' / ' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);
