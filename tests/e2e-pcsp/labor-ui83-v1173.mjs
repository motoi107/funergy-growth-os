// v1173（UI案83・Moto さん 11/15 10:59 HST「全部Aで」）：予実 › 人件費・勤怠を本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs）と合成データ（tests/perf/gen-data.mjs）だけ。本番にはつながない。
// 確かめること：PC（1440・1024）の全店の表・労働時間の左右・勤怠明細の表と右のパネル・勤怠データの日の一覧と右の表、
// スマホ（390）の日の一覧と全画面の箱、月の切り替えが 1 つ、「NaN」が出ない、見出しと値の位置、横のはみ出し、pageerror、日英。
// 使い方：模擬サーバーを立てて（tests/perf/pcsp/README_JA.md）、node tests/e2e-pcsp/labor-ui83-v1173.mjs
async function loadChromium() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of tries) { try { const mod = await import(m); if (mod.chromium) return mod.chromium; } catch (e) { /* 次を試す */ } }
  throw new Error('Playwright が見つかりません（PLAYWRIGHT_MODULE に index.mjs の場所を入れてください）');
}
const chromium = await loadChromium();
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data.json', 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

async function open(W, lang) {
  const mobile = W < 768;
  const dir = '/tmp/ui83-' + W + '-' + lang; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
    viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  await page.evaluate(l => { setLang(l); }, lang);
  await page.evaluate(l => loginPickLocation(l), 'OFFICE');
  await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click();
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 100 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(2000);
  return { ctx, page, errors };
}
/* 描いたあと：横のはみ出し（ページ）・NaN・見えている印 */
const state = page => page.evaluate(() => {
  try { if (window.FUNERGY_LAYOUT && window.FUNERGY_LAYOUT.run) window.FUNERGY_LAYOUT.run(); } catch (e) { }
  const mc = document.getElementById('main-content'), mb = document.getElementById('modal-body'), ov = document.getElementById('modal-overlay');
  const open = ov && ov.classList.contains('open');
  const txt = (mc.innerText || '') + (open ? (mb.innerText || '') : '');
  return { lbv: (document.querySelector('[data-lbv]') || {}).getAttribute ? document.querySelector('[data-lbv]').getAttribute('data-lbv') : null,
    over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
    nan: /NaN/.test(txt), open, mfull: open && mb.hasAttribute('data-mfull') };
});
const go = (page, code) => page.evaluate(code).then(() => sleep(900));

const browser0 = null;
for (const [W, lang] of [[1440, 'ja'], [1024, 'en'], [390, 'ja'], [390, 'en']]) {
  const tag = W + 'px ' + lang;
  const { ctx, page, errors } = await open(W, lang);
  const pc = W >= 1024;
  await go(page, () => { attMonthOffset = 0; _laborStore = 'ALL'; laborTab = 'overview'; go('labor'); });
  let s = await state(page);
  ok(tag + '：印 data-lbv', s.lbv === (pc ? 'pc' : 'sp'), s.lbv);
  ok(tag + '：全店で横にはみ出さない', s.over <= 1, s.over);
  if (pc) {
    const n = await page.evaluate(() => ({ rows: document.querySelectorAll('.lb-tbl > tbody > tr').length, stores: (typeof getVisibleStores === 'function' ? getVisibleStores() : STORES).filter(x => x.id !== 'ALL').length,
      head: [...document.querySelectorAll('.lb-tbl > thead th')].map(th => th.innerText.trim()).join('|') }));
    ok(tag + '：全店は 1 つの表（店の数の行）', n.rows >= 1 && n.rows <= n.stores + 1, n);
    /* 店を押すとその店の労働時間 */
    await page.locator('.lb-tbl > tbody > tr.lb-row').first().click(); await sleep(900);
    const h = await page.evaluate(() => ({ tab: laborTab, store: _laborStore, grid: !!document.querySelector('.lb-grid'), navs: document.querySelectorAll('#main-content button[onclick="shiftAttMonth(-1)"]').length }));
    ok(tag + '：店を押すと、その店の「労働時間」（左右）', h.tab === 'hours' && h.store !== 'ALL' && h.grid, h);
    ok(tag + '：月の切り替えは 1 つ（不具合 2）', h.navs === 1, h.navs);
  } else {
    await go(page, () => { _laborStore = (getVisibleStores().find(x => x.id !== 'ALL') || {}).id; laborTab = 'hours'; renderPage('labor'); });
    const navs = await page.evaluate(() => document.querySelectorAll('#main-content button[onclick="shiftAttMonth(-1)"]').length);
    ok(tag + '：月の切り替えは 1 つ（不具合 2）', navs === 1, navs);
  }
  s = await state(page);
  ok(tag + '：労働時間で横にはみ出さない・NaN なし', s.over <= 1 && !s.nan, s);

  /* 労働時間の日付を押すと勤怠データ（PC） */
  if (pc) {
    const has = await page.locator('.lb-tbl .lb-link').count();
    if (has) {
      const d = await page.locator('.lb-tbl .lb-link').first().getAttribute('onclick');
      await page.locator('.lb-tbl .lb-link').first().click(); await sleep(900);
      const a = await page.evaluate(() => ({ tab: laborTab, sel: !!document.querySelector('.lb-day.lb-sel') }));
      ok(tag + '：労働時間の日付を押すと、その日の勤怠データ', a.tab === 'attendance' && a.sel, { a, d });
    } else ok(tag + '：労働時間の日付（日が無い）', false, 'no rows');
  }

  /* 勤怠データ */
  await go(page, () => setLaborTab('attendance'));
  s = await state(page);
  ok(tag + '：勤怠データで横にはみ出さない・NaN なし（不具合 1）', s.over <= 1 && !s.nan, s);
  const att = await page.evaluate(() => ({ days: document.querySelectorAll('.lb-day').length, grid: !!document.querySelector('.lb-att'), tables: document.querySelectorAll('#main-content table.inv-table').length,
    bad: document.querySelectorAll('#main-content [style*="color:var(--red)"]').length }));
  if (pc) ok(tag + '：PC は日の一覧と右の 1 日の表', att.grid && att.days > 0 && att.tables === 1, att);
  else ok(tag + '：スマホは日の一覧（1 日 1 枚の表を並べない）', !att.grid && att.days > 0 && att.tables === 0, att);
  if (pc) {
    /* 見出しと値の位置（不具合 3） */
    const al = await page.evaluate(() => { const t = document.querySelector('#main-content table.inv-table'); if (!t) return null;
      const th = [...t.querySelectorAll('thead th')].map(x => getComputedStyle(x).textAlign), tr = t.querySelector('tbody tr'); const td = tr ? [...tr.children].map(x => getComputedStyle(x).textAlign) : [];
      return { th, td }; });
    ok(tag + '：1 日の表の見出しと値の位置がそろう（不具合 3）', al && al.th.length === al.td.length && al.th.every((x, i) => i === 0 || x === al.td[i]), al);
    /* 絞り込みと別の日 */
    await page.locator('.lb-chip', { hasText: lang === 'ja' ? '未承認' : 'Not approved' }).first().click().catch(() => {}); await sleep(700);
    const f = await page.evaluate(() => window._attFilter); ok(tag + '：絞り込み（未承認）', f === 'open', f);
    await go(page, () => attSetFilter('all'));
    const n2 = await page.locator('.lb-day').count();
    if (n2 > 1) { await page.locator('.lb-day').nth(1).click(); await sleep(700); }
    const sel = await page.evaluate(() => (document.querySelector('.lb-day.lb-sel .lb-dd') || {}).innerText);
    ok(tag + '：日を押すと右がその日', !!sel, sel);
  } else {
    await page.locator('.lb-day').first().click(); await sleep(900);
    s = await state(page);
    const box = await page.evaluate(() => { const mb = document.getElementById('modal-body'); const t = mb.querySelector(':scope > .modal-title'), f = mb.querySelector(':scope > [data-mfoot]');
      return { title: t ? getComputedStyle(t).position : null, foot: f ? getComputedStyle(f).position : null, footTxt: f ? f.innerText.replace(/\s+/g, ' ') : null, staff: mb.querySelectorAll('.lb-staff').length,
        w: Math.round(mb.getBoundingClientRect().width), vw: innerWidth }; });
    ok(tag + '：日を押すと全画面の箱（題と下のボタンを固定）', s.open && s.mfull && box.title === 'sticky' && box.foot === 'sticky' && box.staff > 0 && box.w >= box.vw - 1, box);
    ok(tag + '：箱に NaN なし・横にはみ出さない', !s.nan && s.over <= 1, s);
    /* 次の日 */
    const nx = page.locator('#modal-body .modal-title button[aria-label]').nth(1);
    if (await nx.isEnabled().catch(() => false)) { await nx.click(); await sleep(600); }
    s = await state(page); ok(tag + '：次の日でも全画面', s.open && s.mfull, s);
    await page.evaluate(() => closeModalDirect()); await sleep(400);
  }

  /* 勤怠明細（GM） */
  await go(page, () => setLaborTab('detail'));
  s = await state(page);
  ok(tag + '：勤怠明細で横にはみ出さない・NaN なし', s.over <= 1 && !s.nan, s);
  if (pc) {
    const d = await page.evaluate(() => ({ rows: document.querySelectorAll('#ld-tbl > tbody > tr[data-n]').length, side: !!document.querySelector('aside.lb-side'), fold: !!document.querySelector('aside.lb-side details.lb-fold'),
      sum: /Labor/.test((document.querySelector('aside.lb-side') || {}).innerText || ''), stick: getComputedStyle(document.querySelector('#ld-tbl thead th')).position,
      foot: (document.querySelector('#ld-tbl tfoot') || {}).innerText }));
    ok(tag + '：勤怠明細は従業員の表と右のパネル（打刻エラー・Grade別はたたむ・人件費）', d.rows > 0 && d.side && d.fold && d.sum, d);
    ok(tag + '：表の見出しは止まる（sticky）', d.stick === 'sticky', d.stick);
    /* 名前で探す（描き直さずに行を出し入れ） */
    const first = await page.evaluate(() => document.querySelector('#ld-tbl > tbody > tr[data-n]').getAttribute('data-n'));
    await page.fill('#ld-q', first.slice(0, 4));
    const vis = await page.evaluate(q => { const tr = [...document.querySelectorAll('#ld-tbl > tbody > tr[data-n]')]; return { shown: tr.filter(x => !x.hidden).length, all: tr.length, ok: tr.filter(x => !x.hidden).every(x => x.getAttribute('data-n').includes(q)), cnt: document.getElementById('ld-cnt').innerText, focus: document.activeElement && document.activeElement.id }; }, first.slice(0, 4));
    ok(tag + '：名前で探す（打っているあいだ入力欄から外れない）', vis.shown >= 1 && vis.ok && vis.focus === 'ld-q', vis);
    await page.fill('#ld-q', ''); await sleep(200);
    /* 行を押すと内訳 */
    const rx = page.locator('#ld-tbl > tbody > tr.lb-row').first();
    if (await rx.count()) { await rx.click(); await sleep(200);
      const x = await page.evaluate(() => { const tr = document.querySelector('#ld-tbl > tbody > tr.lb-row'); return { exp: tr.getAttribute('aria-expanded'), shown: !tr.nextElementSibling.hidden }; });
      ok(tag + '：行を押すと賃金の内訳', x.exp === 'true' && x.shown, x); }
    /* 並べ替え（時間の多い順） */
    await go(page, () => { window._ldSort = 'hours'; renderPage('labor'); });
    const srt = await page.evaluate(() => [...document.querySelectorAll('#ld-tbl > tbody > tr[data-n]')].map(tr => (parseFloat(tr.children[2].innerText) || 0) + (parseFloat(tr.children[3].innerText) || 0)));
    ok(tag + '：時間の多い順', srt.every((v, i) => i === 0 || srt[i - 1] >= v - 1e-9), srt.slice(0, 6));
    await go(page, () => { window._ldSort = ''; renderPage('labor'); });
    /* 打刻エラーの「すべて見る」→ 箱 */
    await page.locator('aside.lb-side button', { hasText: lang === 'ja' ? 'すべて見る' : 'See all' }).first().click().catch(() => {}); await sleep(700);
    s = await state(page); ok(tag + '：打刻エラーの一覧（箱）', s.open, s); await page.evaluate(() => closeModalDirect()); await sleep(300);
  }
  /* 幅をまたぐと描き直す（PC → スマホの幅） */
  if (W === 1440) {
    await page.setViewportSize({ width: 900, height: 900 }); await sleep(1200);
    s = await state(page); ok('1440 → 900px：スマホの形に描き直す', s.lbv === 'sp' && s.over <= 1, s);
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(1200);
    s = await state(page); ok('900 → 1440px：PC の形に戻る', s.lbv === 'pc', s);
  }
  /* 単独の「勤怠データ」ページも同じ形 */
  await go(page, () => { go('attendance'); });
  s = await state(page);
  const sa = await page.evaluate(() => ({ grid: !!document.querySelector('.lb-att'), days: document.querySelectorAll('.lb-day').length }));
  ok(tag + '：勤怠データのページ（単独）も同じ形', (pc ? sa.grid : !sa.grid) && sa.days > 0 && s.over <= 1 && !s.nan, { sa, s });
  ok(tag + '：pageerror 0', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
process.exit(ng.length ? 1 : 0);

// v1185：GM・CEO・経理は名前を選ぶとメールとパスワードの段が出る。試しのあいだは「PIN でログイン」で今までどおり PIN の段へ（ほかの人は何もしない）
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
