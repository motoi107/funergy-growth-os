// v1205（UI案98・段階 4・Moto さんの答え 5A・6A）：本物の Chromium で確かめる。模擬サーバー（tests/perf/server.mjs・SS_REAL=1）と合成データだけ。本番にはつながない。
// 確かめること：
//   スマホ（390 × 日英 × G3・GM・経理・Head Chef）：④ ⑤ ⑥ は見出しだけ（押すボタン・aria-expanded）・押すと開く・マイページを開き直しても開いたまま・
//   もう一度押すと閉じる・① ② ③ は開いている・たたんだ形の縦の長さ（全部開いたときより短い）
//   PC（1440 × 日本語）：たたまない
//   本部の人（GM・経理・事務Crew・Head Chef）の対応可能ポジションは所属・応援の店だけ（合成データでは無い＝出さない）・AM は今のまま（担当の店）
//   横のはみ出し・pageerror
// 使い方：PCSP_DIR=/tmp/pcsp SHOTS=/tmp/fold-shots node tests/e2e-pcsp/mypage-fold-v1205.mjs
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

async function pinStep(page) {
  await sleep(400);
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.waitForFunction(() => { const p = document.getElementById('login-step-pin'); return p && p.style.display !== 'none'; }, null, { timeout: 60000 });
}
async function open(W, lang, loc, who) {
  const mobile = W < 768;
  const dir = '/tmp/my1205-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
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
const look = page => page.evaluate(() => {
  const mc = document.getElementById('main-content');
  const secs = [...mc.querySelectorAll('.mp-sec')].map(s => { const b = s.querySelector('.mp-fold'), body = s.querySelector('.mp-secb');
    return { n: Number(s.getAttribute('data-mps')), fold: !!b, exp: b ? b.getAttribute('aria-expanded') : null, hidden: body ? body.hidden : null, vis: body ? body.getBoundingClientRect().height > 0 : true, h: Math.round(b ? b.getBoundingClientRect().height : 0) }; });
  const pos = [...mc.querySelectorAll('.card-title')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(x => /対応可能ポジション|Positions by store/.test(x));
  return { secs, pos, posTbl: !!mc.querySelector('table.pgd-pos'), height: document.documentElement.scrollHeight };
});
const PEOPLE = [['sl', 'F02', 'Uma Doi'], ['gm', 'OFFICE', 'Yui Yano'], ['office', 'OFFICE', 'Zen Sato'], ['chef', 'OFFICE', 'Gina Sato'], ['oc', 'OFFICE', 'Cora Wada'], ['am', 'OFFICE', 'Emi Wada']];
const HQ = ['gm', 'office', 'chef', 'oc'];
const heights = {};
for (const [W, lang] of [[390, 'ja'], [390, 'en'], [1440, 'ja']]) {
  for (const [key, loc, who] of PEOPLE) {
    if (ONLY && !ONLY.includes(key)) continue;
    if (W === 1440 && !['sl', 'gm', 'am'].includes(key)) continue;
    const tag = W + ' ' + lang + ' ' + key;
    const { ctx, page, errors } = await open(W, lang, loc, who);
    await goMy(page);
    let L = await look(page);
    if (W >= 1024) {
      ok(tag + ': PC はたたまない', L.secs.length >= 4 && L.secs.every(s => !s.fold), L.secs);
    } else {
      ok(tag + ': ① ② ③ は開いている・④ ⑤ ⑥ は見出しだけ（閉じたボタン）', L.secs.every(s => s.n <= 3 ? !s.fold : (s.fold && s.exp === 'false' && s.hidden && !s.vis)) && L.secs.some(s => s.n >= 4), L.secs);
      ok(tag + ': 見出しのボタンは押しやすい高さ（44px 以上）', L.secs.filter(s => s.fold).every(s => s.h >= 44), L.secs.map(s => s.h));
      const folded = L.height;
      await page.click('.mp-sec[data-mps="4"] .mp-fold'); await sleep(400);
      L = await look(page);
      const s4 = L.secs.find(s => s.n === 4);
      ok(tag + ': ④ を押すと開く', s4.exp === 'true' && !s4.hidden && s4.vis, s4);
      await goMy(page);
      L = await look(page);
      ok(tag + ': マイページを開き直しても ④ は開いたまま（この端末が覚える）・⑤ ⑥ は閉じたまま', L.secs.find(s => s.n === 4).exp === 'true' && L.secs.filter(s => s.n >= 5).every(s => s.exp === 'false'), L.secs);
      for (const n of [5, 6]) { if (L.secs.some(s => s.n === n)) await page.click('.mp-sec[data-mps="' + n + '"] .mp-fold'); await sleep(250); }
      const all = (await look(page)).height;
      if (lang === 'ja') heights[key] = { folded, all };
      ok(tag + ': たたんだ形の縦は全部開いたときより短い（' + folded + 'px ／ ' + all + 'px）', folded < all, { folded, all });
      await page.click('.mp-sec[data-mps="4"] .mp-fold'); await sleep(300);
      L = await look(page);
      ok(tag + ': もう一度押すと閉じる', L.secs.find(s => s.n === 4).exp === 'false' && L.secs.find(s => s.n === 4).hidden, L.secs.find(s => s.n === 4));
      await page.evaluate(() => { try { localStorage.removeItem('mp_open_v1205'); } catch (e) { } });
    }
    // 5A
    if (HQ.includes(key)) ok(tag + ': 本部の人の対応可能ポジションは所属・応援の店だけ（合成データでは無い＝出さない）', L.pos.length === 0 && !L.posTbl, L.pos);
    else if (key === 'am') ok(tag + ': AM の対応可能ポジションは今のまま（担当の店' + (W >= 1024 ? '・PC は店ごとの 1 つの表＝v1177' : '') + '）', W >= 1024 ? L.posTbl : L.pos.length >= 2, { pos: L.pos, tbl: L.posTbl });   /* G3 はスタッフの形（Your Skill Progress）で、このカードは前から無い */
    ok(tag + ': 横にはみ出さない', (await over(page)) <= 1, await over(page));
    await shot(page, 'fold-' + key + '-' + W + '-' + lang);
    ok(tag + ': pageerror なし', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
console.log('heights (390 ja, folded / all open): ' + JSON.stringify(heights));
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
if (ng.length) { console.log('NG:\n' + ng.map(r => '  ' + r.name).join('\n')); process.exit(1); }
