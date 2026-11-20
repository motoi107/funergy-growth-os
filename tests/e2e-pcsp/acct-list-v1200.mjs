// v1200（段階 3 の 2 歩目・UI案97 の 3A・4A）：経理レビュー › 確認する（1 つの一覧）を本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs・SS_REAL=1）と合成データだけ（loc-v1196.mjs と同じ data2.json）。模擬サーバーには申請の関数（work-requests）が無いので、
// 申請は「読めない」の知らせになり、書類だけが並ぶ（申請の行は tests/wr-approve-v1165-app.test.mjs と tests/acct-list-v1200.test.mjs で確かめる）。
// 確かめること（PC 1440・スマホ 390 × 日英 × 経理・事務Crew・GM）：確認待ちで開く・前の画面の記録は初めは出さない・100 件ずつ・書類の行から確認の箱・
//   区分・承認も今までどおり・横のはみ出し・pageerror
// 使い方：PCSP_DIR=/tmp/pcsp SHOTS=/tmp/acr-shots node tests/e2e-pcsp/acct-list-v1200.mjs
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
  const dir = '/tmp/acr1200-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
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

for (const [W, lang] of [[1440, 'ja'], [390, 'ja'], [1440, 'en'], [390, 'en']]) {
  for (const [role, who] of [['office', DATA.of], ['office_crew', DATA.oc], ['gm', DATA.gm]]) {
    const tag = W + ' ' + lang + ' ' + role;
    const { ctx, page, errors } = await open(W, lang, who);
    await page.evaluate(() => { _acCat = 'dash'; _acSub = 'dash'; go('acct_center'); }); await sleep(800);
    await page.click('.ac-main .ac-btn[onclick="acSetCat(\'review\')"]'); await sleep(1500);
    let b = await bar(page);
    const L = () => page.evaluate(() => ({ rows: document.querySelectorAll('#main-content .acr-row').length,
      chips: [...document.querySelectorAll('.acr-sts .acr-st')].map(x => x.innerText.replace(/\s+/g, ' ').trim()),
      on: (document.querySelector('.acr-sts .acr-st.on') || {}).innerText || '', more: !!document.querySelector('.acr-more'),
      feed: ((document.querySelector('.acr-feed') || {}).innerText || '').slice(0, 80), foot: ((document.querySelector('.acr-foot') || {}).innerText || '').slice(0, 60),
      old: document.querySelectorAll('#main-content .acr-oldmark').length, st: _acr.st }));
    let l = await L();
    ok(tag + ': 経理レビューは「確認する」・確認待ちで開く（3A）', b.cat === 'review' && b.sub === 'all' && l.st === 'ck' && /確認待ち|To check/.test(l.on), { sub: b.sub, on: l.on });
    ok(tag + ': 書類が並ぶ（申請は読めないとき知らせる）', l.rows > 0 && l.rows <= 100 && l.chips.length === 4, { rows: l.rows, more: l.more, feed: l.feed });
    ok(tag + ': 前の画面の記録は初めは出さない（4A）', l.old === 0, l.foot);
    await shot(page, 'list-' + role + '-' + W + '-' + lang);
    // 前の画面の記録も出す
    await page.locator('.acr-old input').check(); await sleep(700);
    await page.evaluate(() => acrSet('st', 'all')); await sleep(800);
    l = await L();
    ok(tag + ': 「すべて」と「前の画面の記録も出す」でも落ちない', l.rows > 0 && !(await bar(page)).fail, { rows: l.rows, old: l.old });
    await page.evaluate(() => { acrSet('old', false); acrSet('st', 'ck'); }); await sleep(700);
    // 行を押すと書類の箱（今までの 1 件の画面）
    const first = await page.evaluate(() => { const r = document.querySelector('#main-content .acr-row[data-k^="d:"]'); return r ? r.getAttribute('data-k') : null; });
    if (first) {
      await page.locator('#main-content .acr-row[data-k="' + first + '"]').click(); await sleep(900);
      const m = await page.evaluate(() => { const mo = document.getElementById('modal-overlay'); return { open: !!(mo && mo.classList.contains('open')), text: mo ? mo.innerText.slice(0, 60) : '' }; });
      ok(tag + ': 書類の行 → 確認の箱', m.open && /書類の確認|Review/.test(m.text), m);
      if (W === 1440 && role === 'office') await shot(page, 'box-' + role + '-' + W + '-' + lang);
      await page.evaluate(() => closeModalDirect()); await sleep(400);
    } else ok(tag + ': 書類の行がある', false);
    const o = await over(page);
    ok(tag + ': 横のはみ出しなし', o <= 0, o);
    // 区分・承認（今までの本体）も開く
    await page.evaluate(() => acSetSub('acctrev')); await sleep(900);
    b = await bar(page);
    ok(tag + ': 区分・承認も今までどおり', b.sub === 'acctrev' && !b.fail && b.len > 40);
    // 区分・承認の中の「申請（GM 承認済み）」のタブを押しても区分・承認のまま（v1200 で「確認する」へ飛んでいた）
    const rq = page.locator('#main-content .phase-tab', { hasText: /申請（GM 承認済み）|Requests \(GM-approved\)/ });
    if (await rq.count()) { await rq.first().click(); await sleep(800); b = await bar(page); ok(tag + ': 区分・承認の中のタブを押しても区分・承認', b.sub === 'acctrev', b.sub);
      await page.locator('#main-content .phase-tab').first().click(); await sleep(500); }
    else ok(tag + ': 区分・承認に申請のタブがある', false);
    ok(tag + ': pageerror なし', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + ' / ' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);
