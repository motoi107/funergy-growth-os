// v1201（段階 3 の 3 歩目・UI案97・9A）：③ インボイス取り込みの「明細」「前の経路の書類」と、経理センターの中の画面の描き直しを本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs・SS_REAL=1）と合成データだけ（loc-v1196.mjs と同じ data2.json）。
// 確かめること（1440・390 × 日英 × 経理・事務Crew・GM）：③ の小タブ・明細で月・店を変えても経理センターの中・前の経路の書類は読むだけ・
//   経理出力で月を変えても経理センターの中・横のはみ出し・pageerror
// 使い方：PCSP_DIR=/tmp/pcsp SHOTS=/tmp/intake-shots node tests/e2e-pcsp/acct-intake-v1201.mjs
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
  const dir = '/tmp/ai1201-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
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

const inCenter = async (page, cat, sub) => { const b = await bar(page); const nav = await page.evaluate(() => !!document.querySelector('#main-content .ac-nav')); return { ok: b.page === 'acct_center' && b.cat === cat && (!sub || b.sub === sub) && nav && !b.fail, b }; };
for (const [W, lang] of [[1440, 'ja'], [390, 'ja'], [1440, 'en']]) {
  for (const [role, who] of [['office', DATA.of], ['office_crew', DATA.oc], ['gm', DATA.gm]]) {
    const tag = W + ' ' + lang + ' ' + role;
    const { ctx, page, errors } = await open(W, lang, who);
    await page.evaluate(() => { _acCat = 'dash'; _acSub = 'dash'; go('acct_center'); }); await sleep(800);
    await page.click('.ac-main .ac-btn[onclick="acSetCat(\'drive\')"]'); await sleep(900);
    let b = await bar(page);
    ok(tag + ': ③ に明細と前の経路の書類（9A）', b.subs.length === 6 && /明細|Purchase lines/.test(b.subs[4]) && /前の経路の書類|Earlier-route documents/.test(b.subs[5]), b.subs);
    await page.click('.ac-subs .mm-tab[onclick="acSetSub(\'purchase\')"]'); await sleep(900);
    let r = await inCenter(page, 'drive', 'purchase');
    ok(tag + ': 明細が開く', r.ok && await page.evaluate(() => /仕入明細|Purchase details/.test(document.getElementById('main-content').innerText)), r.b.sub);
    await shot(page, 'intake-' + role + '-' + W + '-' + lang + '-purchase');
    await page.locator('#main-content [onclick="pdNavMonth(-1)"]').first().click(); await sleep(800);
    r = await inCenter(page, 'drive', 'purchase');
    ok(tag + ': 明細で月を変えても経理センター › ③ › 明細', r.ok, [r.b.page, r.b.cat, r.b.sub]);
    const st = page.locator('#main-content button[onclick^="pdSetStore("]');
    if (await st.count() > 1) { await st.nth(1).click(); await sleep(700); r = await inCenter(page, 'drive', 'purchase'); ok(tag + ': 明細で店を変えても ③ › 明細', r.ok, [r.b.page, r.b.sub]); }
    await page.evaluate(() => { _pdMonthOff = 0; _pdStore = null; });
    await page.click('.ac-subs .mm-tab[onclick="acSetSub(\'invoice\')"]'); await sleep(900);
    r = await inCenter(page, 'drive', 'invoice');
    const note = await page.evaluate(() => (document.querySelector('#main-content .ac-note') || {}).innerText || '');
    ok(tag + ': 前の経路の書類（読むだけの知らせ）', r.ok && /読むだけ|Read only/.test(note), note.slice(0, 40));
    const entry = await page.evaluate(() => /登録・承認の画面を開く|Open the entry \/ approval view/.test(document.getElementById('main-content').innerText));
    ok(tag + ': 前の経路の書類に登録・承認の画面は出さない', !entry);
    await shot(page, 'intake-' + role + '-' + W + '-' + lang + '-old');
    // ⑥ 経理出力の月（経理・GM）も経理センターのまま
    if (role !== 'office_crew') {
      await page.click('.ac-main .ac-btn[onclick="acSetCat(\'reports\')"]'); await sleep(700);
      await page.click('.ac-subs .mm-tab[onclick="acSetSub(\'export\')"]'); await sleep(1200);
      const mb = page.locator('#main-content [onclick="setAcctMonth(-1)"]');
      if (await mb.count()) { await mb.first().click(); await sleep(1200); r = await inCenter(page, 'reports', 'export'); ok(tag + ': 経理出力で月を変えても ⑥ › 経理出力', r.ok, [r.b.page, r.b.cat, r.b.sub]); await page.locator('#main-content [onclick="setAcctMonth(1)"]').first().click().catch(() => {}); await sleep(800); }
      else ok(tag + ': 経理出力に月の切り替えがある', false);
    }
    const o = await over(page); ok(tag + ': 横のはみ出しなし', o <= 0, o);
    ok(tag + ': pageerror なし', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + ' / ' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);
