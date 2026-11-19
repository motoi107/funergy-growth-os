// v1196（UI案96 の段階 2 の ②③④）：本物の Chromium で確かめる。模擬サーバー（tests/perf/server.mjs・SS_REAL=1＝本物の関数 secure-state）と合成データだけ。本番にはつながない。
// 合成データ（gen-data.mjs の出力）に、確かめた所属（表 aff_people）と、マスターの所属を足してから流す（下の「使い方」）。
// 確かめること（PC 1440・スマホ 390 × 日英）：
//   GM（本部所属・確かめ済み）：左上が「オフィス・本部」・ナビは 1 つの木（予実に月間行動計画）・切り替えに Office が無い・店を選ぶと店の名前・OFFICE を頼んでもオフィス・本部
//   事務Crew（本部所属）：ログイン直後が経理センター（4A）・左上がオフィス・本部・店を選んでも経理センターの入口がある（3A）
//   店の SL（F02・応援 F03）：左上は F02・切り替えは F02 と F03 だけ・見える店は 1 店
//   経理（本部所属だが確かめた所属とマスターが違う）：今までどおり（左上「全店舗」・切り替えに Office）
//   横のはみ出し・pageerror
// 使い方：
//   node tests/perf/gen-data.mjs /tmp/pcsp/data.json 2026-11-19
//   （data.json の employees の e2・e4・e6 の data.store を OFFICE、e16 の data.support を ["F03"] にし、tables.aff_people に
//     e2・e6（hq）・e16（store F02・応援 F03）の行を足す。e4 は行を足さない＝今までどおりの人。login に oc: 事務Crew の名前・of: 経理の名前）
//   APP_DIR=<repo> VENDOR_DIR=<node_modules> CERT_DIR=<pem> DATA_FILE=/tmp/pcsp/data2.json SS_REAL=1 node tests/perf/server.mjs
//   PCSP_DIR=/tmp/pcsp node tests/e2e-pcsp/loc-v1196.mjs
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

async function pinStep(page) {   /* GM・CEO・経理はメールの段が出ることがある（v1185）。ほかの e2e と同じく PIN の段へ */
  await sleep(400);
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.waitForFunction(() => { const p = document.getElementById('login-step-pin'); return p && p.style.display !== 'none'; }, null, { timeout: 60000 });
}
async function open(W, lang, who, loc) {
  const mobile = W < 768;
  const dir = '/tmp/loc1196-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
    viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  await page.evaluate(l => { setLang(l); }, lang);
  await page.evaluate(l => loginPickLocation(l), loc);
  await page.locator('#login-name-grid .store-btn', { hasText: who }).first().click();
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 100 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(1500);
  return { ctx, page, errors };
}
const over = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {}); };
const state = page => page.evaluate(() => ({
  top: document.getElementById('topbar-store').innerText.replace(/\s+/g, ' ').trim(), store: curStore, page: curPage, mode: window.FUNERGY_LOC ? FUNERGY_LOC.mode() : null,
  nav: [...document.querySelectorAll('#nav-bar .nav-btn')].map(b => b.innerText.replace(/\s+/g, ' ').trim()),
  groups: groupsForRole().map(g => g.id + ':' + g.children.filter(navChildAllowed).join(',')), vis: getVisibleStores().map(s => s.id),
}));
const switcher = async page => { await page.click('#topbar-store'); await sleep(400);
  const r = await page.evaluate(() => { const mo = document.getElementById('modal-overlay'); const open = !!(mo && mo.classList.contains('open'));
    return { open, items: open ? [...document.querySelectorAll('#modal-body .store-btn')].map(b => (b.getAttribute('onclick') || '').replace(/^switchStore\('|'\)$/g, '')) : [], text: open ? document.getElementById('modal-body').innerText.replace(/\s+/g, ' ').slice(0, 160) : '' }; });
  return r; };
const pick = async (page, id) => { await page.evaluate(id => switchStore(id), id); await sleep(800); };

for (const [W, lang] of [[1440, 'ja'], [390, 'ja'], [390, 'en'], [1440, 'en']]) {
  const tag = W + ' ' + lang;
  // ---- GM（本部所属・確かめ済み）
  { const { ctx, page, errors } = await open(W, lang, DATA.gm, 'OFFICE');
    let s = await state(page);
    ok(tag + ' GM: 新しい見え方（本部）', s.mode && s.mode.kind === 'hq', s.mode);
    ok(tag + ' GM: 左上がオフィス・本部', s.store === 'ALL' && (lang === 'ja' ? /オフィス・本部|本部/ : /Office \/ HQ|HQ/).test(s.top), s.top);
    ok(tag + ' GM: 1 つの木（GM の形）', s.groups[0].startsWith('g_dash:') && !s.groups.some(g => /^go_/.test(g)), s.groups.map(g => g.split(':')[0]));
    ok(tag + ' GM: 月間行動計画は予実', s.groups.some(g => g.startsWith('g_budget:') && g.includes('cc_plan')));
    ok(tag + ' GM: 経理センターの入口', s.groups.some(g => g.startsWith('g_acct_center:acct_center')));
    await shot(page, 'gm-' + W + '-' + lang + '-top');
    const sw = await switcher(page);
    ok(tag + ' GM: 切り替え＝オフィス・本部＋店（Office なし）', sw.open && sw.items[0] === 'ALL' && !sw.items.includes('OFFICE') && sw.items.length >= 9, sw.items);
    await shot(page, 'gm-' + W + '-' + lang + '-switcher');
    await page.evaluate(() => closeModalDirect());
    await pick(page, 'F02'); s = await state(page);
    ok(tag + ' GM: 店を選ぶと店', s.store === 'F02' && s.vis.join() === 'F02', [s.store, s.top, s.vis]);
    ok(tag + ' GM: 店でも同じ木', s.groups[0].startsWith('g_dash:') && s.groups.some(g => g.startsWith('g_acct_center:')));
    await pick(page, 'OFFICE'); s = await state(page);
    ok(tag + ' GM: 前の値 OFFICE はオフィス・本部', s.store === 'ALL' && s.page !== 'office_mgr', [s.store, s.page]);
    ok(tag + ' GM: はみ出しなし', (await over(page)) <= 1, await over(page));
    ok(tag + ' GM: pageerror なし', errors.length === 0, errors);
    await ctx.close(); }
  // ---- 事務Crew（本部所属・確かめ済み）
  { const { ctx, page, errors } = await open(W, lang, DATA.oc, 'OFFICE');
    let s = await state(page);
    ok(tag + ' 事務Crew: ログイン直後は経理センター（4A）', s.page === 'acct_center', s.page);
    ok(tag + ' 事務Crew: 左上がオフィス・本部', s.store === 'ALL', s.top);
    ok(tag + ' 事務Crew: 1 つの木', !s.groups.some(g => /^ga_/.test(g)) && s.groups.some(g => g.startsWith('g_acct_center:acct_center')), s.groups.map(g => g.split(':')[0]));
    await shot(page, 'oc-' + W + '-' + lang + '-landing');
    await pick(page, 'F03'); s = await state(page);
    ok(tag + ' 事務Crew: 店を選んでも経理センターの入口（3A）', s.store === 'F03' && s.groups.some(g => g.startsWith('g_acct_center:acct_center')), s.store);
    ok(tag + ' 事務Crew: はみ出しなし', (await over(page)) <= 1, await over(page));
    ok(tag + ' 事務Crew: pageerror なし', errors.length === 0, errors);
    await ctx.close(); }
  // ---- 店の SL（F02・応援 F03）
  { const { ctx, page, errors } = await open(W, lang, DATA.sl, 'F02');
    let s = await state(page);
    ok(tag + ' SL: 新しい見え方（店・F02 と F03）', s.mode && s.mode.kind === 'store' && s.mode.opts.join() === 'F02,F03', s.mode);
    ok(tag + ' SL: 左上は F02・見える店は 1 店', s.store === 'F02' && s.vis.join() === 'F02', [s.store, s.vis]);
    const sw = await switcher(page);
    ok(tag + ' SL: 切り替えは F02・F03 だけ', sw.open && sw.items.join() === 'F02,F03', sw.items);
    await shot(page, 'sl-' + W + '-' + lang + '-switcher');
    await page.evaluate(() => closeModalDirect());
    await pick(page, 'F03'); s = await state(page);
    ok(tag + ' SL: F03 を選ぶと F03 だけ', s.store === 'F03' && s.vis.join() === 'F03', [s.store, s.vis]);
    await pick(page, 'ALL'); s = await state(page);
    ok(tag + ' SL: 全店を頼んでも所属の店', s.store === 'F02', s.store);
    ok(tag + ' SL: はみ出しなし', (await over(page)) <= 1, await over(page));
    ok(tag + ' SL: pageerror なし', errors.length === 0, errors);
    await ctx.close(); }
  // ---- 経理（確かめた所属が無い＝今までどおり）
  if (W === 1440 && lang === 'ja') { const { ctx, page, errors } = await open(W, lang, DATA.of, 'OFFICE');
    const s = await state(page);
    ok(tag + ' 経理（未確認）: 今までどおり', s.mode === null && /全店舗/.test(s.top), [s.mode, s.top]);
    const sw = await switcher(page);
    ok(tag + ' 経理（未確認）: 切り替えに Office', sw.items.includes('OFFICE') && sw.items.includes('ALL'), sw.items);
    ok(tag + ' 経理（未確認）: pageerror なし', errors.length === 0, errors);
    await ctx.close(); }
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);
