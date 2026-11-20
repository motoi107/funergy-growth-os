// v1203（UI案98・段階 4・Moto さんの答え 1A・2A・4A・7B・8A）：G2〜CEO・本部のマイページの 6 つの段を本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs・SS_REAL=1）と合成データだけ（loc-v1196.mjs と同じ data2.json）。本番にはつながない。
// 模擬サーバーには申請の関数が無いので、① の申請の行と ② のサーバーの経費の申請は出ない（単体の試験 tests/mypage-v1203.test.mjs で確かめる）。
// 確かめること（1440・390 × 日英 × G1・G2・G3・G4・AM・GM・Head Chef・経理・事務Crew）：
//   G1 は今のまま（段なし・従業員証明のカード）／ほかは ①〜⑥ の順・PC は 2 列（左 ①②③・右 ④⑤⑥）・スマホは 1 列／
//   従業員証明は名前の帯のボタン（押すと証明が開く）／② の 1 つの申請のカード（紛失届は開ける人だけ・休暇）／
//   公開済みのシフトがあれば ① 今日のシフト と ③ 今週のシフト（G4 も＝8A）／何も無ければ「今日やることはありません」／
//   カードの名前は今のまま（7B）／幅をまたいだら描き直す／開いた直後に変えた入力が無い／横のはみ出し・pageerror
// 使い方：PCSP_DIR=/tmp/pcsp SHOTS=/tmp/mypage-shots node tests/e2e-pcsp/mypage-v1203.mjs
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

// [キー, ログインの場所, 名前, G1 か, 紛失届の画面を開けるか（navGuardAllows）]（合成データ gen-data.mjs の人）
const PEOPLE = [['crew', 'F01', 'Taro Ota', true, true], ['g2', 'F06', 'Ben Ito', false, true], ['sl', 'F02', 'Uma Doi', false, true], ['g4', 'F02', 'Wes Doi', false, true],
  ['am', 'OFFICE', 'Emi Wada', false, true], ['gm', 'OFFICE', 'Yui Yano', false, true], ['chef', 'OFFICE', 'Gina Sato', false, true],
  ['office', 'OFFICE', 'Zen Sato', false, true], ['oc', 'OFFICE', 'Cora Wada', false, true]];

async function pinStep(page) {
  await sleep(400);
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.waitForFunction(() => { const p = document.getElementById('login-step-pin'); return p && p.style.display !== 'none'; }, null, { timeout: 60000 });
}
async function open(W, lang, loc, who) {
  const mobile = W < 768;
  const dir = '/tmp/my1203-' + W + '-' + lang + '-' + who.replace(/\W/g, ''); fs.rmSync(dir, { recursive: true, force: true });
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
const goMy = async page => { await page.evaluate(() => go('mypage')); await sleep(1600); };
const look = page => page.evaluate(() => {
  const mc = document.getElementById('main-content');
  const top = el => Math.round(el.getBoundingClientRect().top), left = el => Math.round(el.getBoundingClientRect().left);
  const secs = [...mc.querySelectorAll('.mp-sec')].map(s => ({ n: Number(s.getAttribute('data-mps')), top: top(s), left: left(s), head: (s.querySelector('.mp-sech') || {}).innerText || '' }));
  const titles = [...mc.querySelectorAll('.card-title')].map(x => x.innerText.replace(/\s+/g, ' ').trim());
  const today = document.getElementById('mp-today');
  const req = document.getElementById('mp-req');
  return { page: curPage, secs, pc6: !!mc.querySelector('.mp-pc6'), pc: !!mc.querySelector('.mp-pc'), colh: [...mc.querySelectorAll('.mp-colh')].map(x => x.innerText.trim()),
    pass: !!mc.querySelector('.mypage-header .mp-pass'), idCard: [...mc.querySelectorAll('.card')].some(c => /食事割引のときにレジで提示|Show at checkout for meal discount/.test(c.innerText)),
    today: today ? { shown: getComputedStyle(today).display !== 'none', text: today.innerText.replace(/\s+/g, ' ').trim(), sec: Number((today.closest('.mp-sec') || { getAttribute: () => 0 }).getAttribute('data-mps')) } : null,
    req: req ? { lost: !!req.querySelector('[data-mp-req="lost"]'), vac: !!req.querySelector('[data-mp-req="vacation"]'), sec: Number(req.closest('.mp-sec').getAttribute('data-mps')) } : null,
    shift: !!document.getElementById('mp-shift') || titles.some(x => /^(今週のシフト|This Week's Shifts)/.test(x)),
    shiftSec: (() => { const c = [...mc.querySelectorAll('.card')].find(c => /^(今週のシフト|This Week's Shifts)/.test(((c.querySelector('.card-title') || {}).innerText || '').trim())); const s = c && c.closest('.mp-sec'); return s ? Number(s.getAttribute('data-mps')) : 0; })(),
    titles };
});
const SECJA = ['今日やること', '申請', '仕事', '成長', '会社から', '自分の設定'], SECEN = ['Today', 'Requests', 'Work', 'Growth', 'From the company', 'My settings'];

for (const [W, lang] of [[1440, 'ja'], [390, 'ja'], [1440, 'en'], [390, 'en']]) {
  const pc = W >= 1024;
  for (const [key, loc, who, g1, lostOk] of PEOPLE) {
    if (ONLY && !ONLY.includes(key)) continue;
    const tag = W + ' ' + lang + ' ' + key;
    const { ctx, page, errors } = await open(W, lang, loc, who);
    await goMy(page);
    let L = await look(page);
    if (g1) {
      ok(tag + ': G1 は今のまま（段なし・従業員証明のカード・帯のボタンなし）', L.secs.length === 0 && L.idCard && !L.pass, { secs: L.secs.length, id: L.idCard, pass: L.pass });
      if (pc) ok(tag + ': G1 の PC は前の 2 列（仕事・成長）', L.pc && !L.pc6 && L.colh.length === 2, L.colh);
    } else {
      const ns = L.secs.map(s => s.n);
      ok(tag + ': 段は ① から順（① と ② と ④ と ⑥ はいつもある）', ns.join() === [...ns].sort((a, b) => a - b).join() && [1, 2, 4, 6].every(n => ns.includes(n)), ns);
      ok(tag + ': 段の名前', L.secs.every(s => s.head.includes((lang === 'en' ? SECEN : SECJA)[s.n - 1])), L.secs.map(s => s.head));
      if (pc) {
        const l = L.secs.filter(s => s.n <= 3), r = L.secs.filter(s => s.n >= 4);
        ok(tag + ': PC は 2 列（左 ①②③・右 ④⑤⑥）', L.pc6 && l.every(s => s.left === l[0].left) && r.every(s => s.left === r[0].left) && l[0].left < r[0].left, L.secs.map(s => [s.n, s.left]));
      } else ok(tag + ': スマホは 1 列で上から ①〜⑥', !L.pc && L.secs.every((s, i, a) => i === 0 || s.top > a[i - 1].top), L.secs.map(s => [s.n, s.top]));
      ok(tag + ': 従業員証明は名前の帯のボタン（カードは無い・2A）', L.pass && !L.idCard, { pass: L.pass, id: L.idCard });
      /* v1204 から：本部の打刻の人（経理・事務Crew・Head Chef）は ① に打刻のカードがあるので「ありません」のカードは出さない（tests/e2e-pcsp/mypage-punch-v1204.mjs） */
      const punch = await page.evaluate(() => !!document.querySelector('.mp-sec[data-mps="1"] #office-clock'));
      if (punch) ok(tag + ': ① は本部の打刻（v1204）・「ありません」は出さない', L.today && L.today.sec === 1 && !L.today.shown && ['chef', 'office', 'oc'].includes(key), L.today);
      else ok(tag + ': ① 今日やること（何も無ければ「ありません」）', L.today && L.today.sec === 1 && L.today.shown && /今日やることはありません|Nothing to do today/.test(L.today.text), L.today);
      ok(tag + ': ② 1 つの申請のカード（休暇・紛失届は開ける人だけ）', L.req && L.req.sec === 2 && L.req.vac && L.req.lost === lostOk, L.req);
      ok(tag + ': 前の「休暇申請」のカードは無い（② にまとめた・4A）', !L.titles.some(x => /^(休暇申請|Time Off)/.test(x)), L.titles.filter(x => /休暇|Time Off/.test(x)));
      if (['g4', 'am', 'gm', 'chef', 'office', 'oc'].includes(key)) ok(tag + ': 名前は今のまま（Personal Growth Dashboard・7B）', await page.evaluate(() => /Personal Growth Dashboard/.test(document.getElementById('main-content').innerText)));
      // 従業員証明のボタン
      await page.click('.mypage-header .mp-pass'); await sleep(700);
      const pass = await page.evaluate(() => !!document.getElementById('fypass-overlay'));
      ok(tag + ': 帯のボタンで従業員証明が開く', pass);
      await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } try { closeStaffPass(); } catch (e) { } }); await sleep(300);
      // 公開済みのシフト（今日の分を入れる）：① 今日のシフト・③ 今週のシフト（G4 以上も＝8A）
      if (['g2', 'sl', 'g4'].includes(key)) {
        await page.evaluate(([store, me]) => {
          const dow = DOW_SHIFT[new Date(bizToday() + 'T12:00:00').getDay()];
          const cells = {}; cells[dow + '_Lunch_Server'] = me; cells[dow + '_Dinner_Host'] = 'Someone Else';
          lsSet('shiftplan_' + store + '_' + getWeekStr(), { status: '公開済', cells });
        }, [loc, who]);
        await goMy(page);
        L = await look(page);
        ok(tag + ': 公開済みのシフト：① に今日のシフト・③ に今週のシフト', L.today.shown && /今日のシフト|Today's shift/.test(L.today.text) && /Lunch Server/.test(L.today.text) && !/今日やることはありません|Nothing to do today/.test(L.today.text) && L.shiftSec === 3, { today: L.today.text, shiftSec: L.shiftSec });
        await shot(page, 'mypage-' + key + '-' + W + '-' + lang + '-shift');
      } else ok(tag + ': 店の無い人に自分のシフトのカードは出さない', !L.shift, L.titles.slice(0, 6));
      // 休暇のボタン
      await page.click('#mp-req [data-mp-req="vacation"]'); await sleep(1200);
      ok(tag + ': 休暇のボタンで休暇申請の画面', await page.evaluate(() => curPage === 'vacation'));
      await goMy(page);
      // 幅をまたいだら描き直す
      if (W === 1440 && lang === 'ja') {
        await page.setViewportSize({ width: 390, height: 844 }); await sleep(2000);
        const a = await look(page);
        await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2000);
        const b = await look(page);
        ok(tag + ': 1440 → 390 → 1440 で形を描き直す', !a.pc6 && a.secs.length === L.secs.length && b.pc6, { a: a.pc6, b: b.pc6 });
      }
      const df = await page.evaluate(() => { const d = uiDirtyFields(document.getElementById('main-content')); return { n: d.list.length, bad: d.bad }; });
      ok(tag + ': 開いた直後に「変えた入力」が無い', df.n === 0 && !df.bad, df);
    }
    ok(tag + ': 横にはみ出さない', (await over(page)) <= 1, await over(page));
    await shot(page, 'mypage-' + key + '-' + W + '-' + lang);
    ok(tag + ': pageerror なし', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
if (ng.length) { console.log('NG:\n' + ng.map(r => '  ' + r.name).join('\n')); process.exit(1); }
