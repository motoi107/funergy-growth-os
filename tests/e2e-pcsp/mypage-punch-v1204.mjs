// v1204（UI案98・段階 4・Moto さんの答え 3A）：本部の打刻をマイページ ① でも押せることを本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs・SS_REAL=1）と合成データだけ（loc-v1196.mjs と同じ data2.json）。本番にはつながない。
// 確かめること（1440・390 × 日英 × Head Chef・経理・事務Crew、出さない人：GM・AM・G3）：
//   ① の初めのカードが本日の勤怠（打刻）・「今日やることはありません」は出さない／出勤・休憩・退勤を押してもマイページのまま・
//   状態が変わる・サーバーの同じ記録（office_attend_<名前>）に入る・新しい端末（言語ごとに別の端末）でも 2 つ目の出勤を作らない／経理（経理ホーム）で同じ人の本部タイムカードに出る（日本語 1440 だけ）／
//   経理ホームの打刻は今までどおり／横のはみ出し・pageerror
// 使い方：PCSP_DIR=/tmp/pcsp SHOTS=/tmp/punch-shots node tests/e2e-pcsp/mypage-punch-v1204.mjs
async function loadChromium() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of tries) { try { const mod = await import(m); if (mod.chromium) return mod.chromium; } catch (e) { /* 次を試す */ } }
  throw new Error('Playwright が見つかりません（PLAYWRIGHT_MODULE に index.mjs の場所を入れてください）');
}
const chromium = await loadChromium();
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'];
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
try { await fetch(APP + '__reset'); } catch (e) { /* 模擬サーバーだけ */ }


const PEOPLE = [['chef', 'OFFICE', 'Gina Sato', true], ['office', 'OFFICE', 'Zen Sato', true], ['oc', 'OFFICE', 'Cora Wada', true],
  ['gm', 'OFFICE', 'Yui Yano', false], ['am', 'OFFICE', 'Emi Wada', false], ['sl', 'F02', 'Uma Doi', false]];
async function pinStep(page) {
  await sleep(400);
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.waitForFunction(() => { const p = document.getElementById('login-step-pin'); return p && p.style.display !== 'none'; }, null, { timeout: 60000 });
}
async function open(W, lang, loc, who) {
  const mobile = W < 768;
  const dir = '/tmp/my1204-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
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
const over = async page => {
  const one = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
  let v = await one(); if (v <= 1) return v; await sleep(1500); return one();
};
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {}); };
const goMy = async page => { await page.evaluate(() => go('mypage')); await sleep(1500); };
const clock = page => page.evaluate(() => {
  const c = document.getElementById('office-clock'); const s1 = document.querySelector('.mp-sec[data-mps="1"]');
  const first = s1 ? s1.querySelector(':scope > .card:not([style*="display:none"]), :scope > .card') : null;
  const today = document.getElementById('mp-today');
  return { page: curPage, has: !!c, first: !!(c && s1 && s1.querySelector(':scope > .card') === c), inSec1: !!(c && c.closest('.mp-sec[data-mps="1"]')),
    status: c ? c.innerText.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 3).join(' | ') : '', todayShown: !!(today && getComputedStyle(today).display !== 'none'),
    btn: c ? [...c.querySelectorAll('button')].map(b => (b.disabled ? '-' : '+') + b.getAttribute('onclick')) : [] };
});
const server = (page, name) => page.evaluate(async n => {
  const r = await fetch(SUPABASE_URL + '/rest/v1/app_state?select=key,value&key=eq.' + encodeURIComponent('office_attend_' + n), { headers: supaHeaders() });
  const j = await r.json(); return (j && j[0] && j[0].value) || null;
}, name);
let punched = null; const firstIn = {};
for (const [W, lang] of [[1440, 'ja'], [390, 'ja'], [1440, 'en'], [390, 'en']]) {
  for (const [key, loc, who, hq] of PEOPLE) {
    if (ONLY && !ONLY.includes(key)) continue;
    const tag = W + ' ' + lang + ' ' + key;
    const { ctx, page, errors } = await open(W, lang, loc, who);
    await goMy(page);
    let c = await clock(page);
    if (!hq) { ok(tag + ': 本部の打刻の人でなければ出さない', !c.has, c); }
    else {
      ok(tag + ': ① の初めのカードが本日の勤怠（打刻）', c.has && c.inSec1 && c.first, c);
      ok(tag + ': 打刻のカードだけなら「今日やることはありません」は出さない', !c.todayShown, c);
      ok(tag + ': 言葉（' + lang + '）', lang === 'en' ? /Not clocked in|Working|Clocked out/.test(c.status) && /Clock in/.test(await page.evaluate(() => document.getElementById('office-clock').innerText)) : /未出勤|勤務中|退勤済/.test(c.status), c.status);
      // 押す（毎回新しい端末なので、その日の記録は前の言語の回のもの）
      const tap = async f => { await page.click('#office-clock button[onclick="' + f + '"]'); await sleep(900); return clock(page); };
      if (c.btn.includes('+officeClockIn()')) { c = await tap('officeClockIn()'); ok(tag + ': 出勤を押してもマイページのまま・勤務中', c.page === 'mypage' && c.has && /勤務中|Working/.test(c.status), c); }
      if (c.btn.includes('+officeBreakStart()')) { c = await tap('officeBreakStart()'); ok(tag + ': 休憩開始：マイページのまま・休憩中', c.page === 'mypage' && /休憩中|On break/.test(c.status), c); }
      if (c.btn.includes('+officeBreakEnd()')) { c = await tap('officeBreakEnd()'); ok(tag + ': 休憩終了：マイページのまま・勤務中', c.page === 'mypage' && /勤務中|Working/.test(c.status), c); }
      const today = await page.evaluate(() => bizToday());
      await sleep(2500);
      const sv = await server(page, who);
      ok(tag + ': サーバーの同じ記録（office_attend_' + who + '）に今日の出勤', Array.isArray(sv) && sv.some(r => r.date === today && r.in), sv && sv.slice(-1));
      const rin = Array.isArray(sv) && (sv.find(r => r.date === today) || {}).in;
      if (firstIn[who]) ok(tag + ': 新しい端末でも 2 つ目の出勤を作らない（前の端末の出勤 ' + firstIn[who] + ' のまま）', rin === firstIn[who], rin);
      else firstIn[who] = rin;
      if (key === 'chef' && W === 1440 && lang === 'ja') punched = { who, today };
    }
    ok(tag + ': 横にはみ出さない', (await over(page)) <= 1, await over(page));
    await shot(page, 'punch-' + key + '-' + W + '-' + lang);
    ok(tag + ': pageerror なし', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
// 経理（経理ホーム）：打刻のカードは今までどおり・Head Chef がマイページで押した記録が本部タイムカードに出る
if (!ONLY || ONLY.includes('office')) {
  const { ctx, page, errors } = await open(1440, 'ja', 'OFFICE', 'Zen Sato');
  await page.evaluate(() => { _acCat = 'dash'; _acSub = 'dash'; go('acct_center'); }); await sleep(1200);
  ok('経理ホームの打刻のカードは今までどおり', await page.evaluate(() => !!document.querySelector('#main-content #office-clock button[onclick="officeClockIn()"]')));
  if (punched) {
    await page.evaluate(n => { try { pullOpKey('office_attend_' + n); } catch (e) { } }, punched.who); await sleep(2500);
    await page.evaluate(n => { officeAttendName = n; acSetCat('attend'); }, punched.who); await sleep(1500);
    const sheet = await page.evaluate(([n, d]) => { const recs = getOfficeAttend(n) || []; return { rec: recs.find(r => r.date === d) || null, shown: document.getElementById('main-content').innerText.includes(n) }; }, [punched.who, punched.today]);
    ok('経理の端末で Head Chef の本部タイムカードに今日の出勤（同じ記録）', sheet.rec && sheet.rec.in && sheet.shown, sheet);
    await shot(page, 'punch-office-timecard-chef');
  }
  ok('経理：pageerror なし', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
if (ng.length) { console.log('NG:\n' + ng.map(r => '  ' + r.name).join('\n')); process.exit(1); }
