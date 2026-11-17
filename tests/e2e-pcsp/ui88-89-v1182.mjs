// v1182（UI案88・UI案89・Moto さん 11/16 08:13 HST「全部Aで」）：本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs）と合成データ（tests/perf/gen-data.mjs）だけ。本番にはつながない。
// チップの配分表は合成の計算（calcTipDistribution をこの試験の中だけ置き換える）で描く。
// 確かめること：
//   UI案88：採用・オンボーディング（入社手続き 1 行 1 人・タブ・パネル／箱）・Handbook › 進捗管理・チップ › 配分表（たたむ・止める・スマホは 1 日ずつ）
//           シフト作成（スマホは曜日のタブ）・責任マトリクス（スマホは見るだけ・押すと箱）
//   UI案89：食材マスター（凍結中）・新マスター・原価登録・仕入明細・レシート管理 › レシート／建て替え経費・業者マスター・メニュー › メニュー別（50 品ずつ）
//   PC（1440）は表と右のパネル、そのあいだ（900）は今の形、スマホ（390・日英）は 1 行の一覧と全画面の箱
//   横のはみ出し・pageerror
// 使い方：模擬サーバーを立てて（tests/perf/pcsp/README_JA.md）、node tests/e2e-pcsp/ui88-89-v1182.mjs
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
const SHOTS = process.env.SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
try { await fetch(APP + '__reset'); } catch (e) { /* 前の回の保存を消す（模擬サーバーだけ） */ }

async function open(W, lang) {
  const mobile = W < 768;
  const dir = '/tmp/ui8889-' + W + '-' + lang; fs.rmSync(dir, { recursive: true, force: true });
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
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 100 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(2000);
  /* チップの配分表：合成の計算（この試験の中だけ） */
  await page.evaluate(() => { window.calcTipDistribution = function(sid, d){ var n = +d.slice(8); return { tip:{ lunchCredit:100 + n, dinnerCredit:200 + n, lunchCash:10, dinnerCash:20, lunchTotal:106.5 + n, dinnerTotal:213 + n },
    list:[{ name:'Aki Test', lunch:30, dinner:60, lunchHours:4, dinnerHours:5, by:'rate', rate:90 }, { name:'Ben Sample', lunch:20, dinner:40, lunchHours:3, dinnerHours:4, by:'rate', rate:100 }],
    unmatched:(n % 2 ? [{ name:'Dan Missing', reason:'master' }, { name:'Eve Other', reason:'store' }] : [{ name:'Dan Missing', reason:'master' }]) }; }; });
  /* 応募者：合成の 60 人（この試験の中だけ。模擬サーバーには応募者が無い） */
  await page.evaluate(() => { const st = ['ToriTon', 'Tenkichi', '未分類']; const L = Array.from({ length: 60 }, (_, i) => ({ id: 'ap' + i, name: 'Applicant ' + String(i + 1).padStart(2, '0'), store: st[i % 3],
    status: ['新規応募', '採用', '不採用', '要確認'][i % 4], date: '2026-11-' + String(1 + (i % 15)).padStart(2, '0'), pos: 'Server', source: 'Indeed', history: [] }));
    window.getApplicants = () => L; window.visibleApplicants = () => L;
    /* レシート：合成の 60 件（模擬サーバーにはレシートが無い。読むときだけ足す＝保存しない） */
    const R = Array.from({ length: 60 }, (_, i) => ({ id: 'rc-e2e-' + i, docType: 'Receipt', vendor: 'Shop ' + (i % 7), storeId: 'F01', date: '2026-11-' + String(1 + (i % 15)).padStart(2, '0'), total: 10 + i,
      reviewStatus: ['未確認', '確認中', '確認済み', '差し戻し'][i % 4], lines: [{ name: 'Item', qty: 1, newPrice: 10 + i }], empName: 'Staff ' + (i % 5) }));
    const ls0 = window.ls; window.ls = function(k, d){ const v = ls0.apply(this, arguments); return k === 'invoices' ? (Array.isArray(v) ? v : []).concat(R) : v; }; });
  return { ctx, page, errors };
}
const go = (page, pg, pre) => page.evaluate(([p, pre]) => { if (pre) (0, eval)(pre); go(p); }, [pg, pre || '']).then(() => sleep(1300));
const over1 = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
const over = async page => { let v = await over1(page); if (v <= 1) return v; await sleep(1500); return over1(page); };
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/' + name + '.jpg', type: 'jpeg', quality: 60, fullPage: false }).catch(() => {}); };
const L = page => page.evaluate(() => {
  const m = document.getElementById('main-content'), pn = m.querySelector('.u9-panel');
  return { tb: !!m.querySelector('.u9-pc .u9-tbl'), rows: m.querySelectorAll('tr.u9-row').length, grp: m.querySelectorAll('tr.u10-grp, .u10-spg').length, pn: !!pn, pnPos: pn && getComputedStyle(pn).position,
    pnTxt: pn ? pn.innerText.slice(0, 40) : '', sp: m.querySelectorAll('.u9-sprow').length, spMinH: Math.min(...[...m.querySelectorAll('.u9-sprow')].map(b => b.getBoundingClientRect().height), 999),
    pgn: (m.querySelector('.ar-pgn') || {}).innerText || '', cnt: (m.querySelector('.u10-cnt') || {}).innerText || '', tiles: m.querySelectorAll('.u9-tile').length };
});
const box = page => page.evaluate(() => { const mb = document.getElementById('modal-body'), t = mb.querySelector(':scope > .modal-title');
  return { open: document.getElementById('modal-overlay').classList.contains('open'), full: mb.hasAttribute('data-mfull'), back: !!(t && /一覧へ|List/.test(t.innerText)), title: t ? t.innerText.replace(/\s+/g, ' ').slice(0, 40) : '',
    sel: mb.querySelectorAll('select').length, text: (mb.querySelector('[data-u9]') || mb).innerText.slice(0, 50) }; });
const closeBox = async page => { await page.evaluate(() => { const b = [...document.querySelectorAll('#modal-body .modal-title button')].find(b => /一覧へ|List/.test(b.innerText)); if (b) b.click(); else closeModalDirect(); }); await sleep(500); };
const tapFirst = async page => { await page.evaluate(() => document.querySelector('#main-content .u9-sprow').click()); await sleep(600); };

const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
for (const [W, lang] of [[1440, 'ja'], [900, 'ja'], [390, 'ja'], [390, 'en']].filter(([W]) => !ONLY || ONLY.includes(W))) {
  const tag = W + 'px ' + lang;
  const pc = W >= 1024, phone = W < 768;
  const { ctx, page, errors } = await open(W, lang);
  const shape = async (name, x) => {
    if (pc) ok(tag + '：' + name + '：PC は表と右のパネル（止まる）', x.tb && x.rows > 0 && x.pn && x.pnPos === 'sticky', x);
    else if (phone) ok(tag + '：' + name + '：スマホは 1 行の一覧（押す範囲 44px 以上）', !x.tb && x.sp > 0 && x.spMinH >= 43.5, x);
    else ok(tag + '：' + name + '：あいだは今の形（表とパネル・1 行の一覧は出さない）', !x.tb && x.sp === 0, x);
    ok(tag + '：' + name + '：横にはみ出さない', await over(page) <= 1);
  };

  /* ===== UI案88 ===== */
  await go(page, 'hiring', "hiringTab='main';window._u11HrTab='ob';window._u9=null");
  let x = await L(page);
  ok(tag + '：入社手続き：初めは「進行中」・50 人ずつ', /1〜50/.test(x.pgn), x.pgn);
  await shape('入社手続き', x);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#main-content .u10-seg [role="tab"]')].map(b => b.getAttribute('aria-selected') + ':' + b.innerText.trim().slice(0, 12)));
  ok(tag + '：入社手続き：タブ 4 つ（進行中・登録完了・中止・応募者）', tabs.length === 4 && tabs[0].startsWith('true'), tabs);
  if (pc) {
    const id = await page.evaluate(() => { const tr = document.querySelectorAll('#main-content tr.u9-row')[3]; tr.click(); return tr.getAttribute('data-u9id'); }); await sleep(400);
    const pn = await page.evaluate(() => ({ sel: document.querySelector('#main-content tr.u9-row.sel').getAttribute('data-u9id'), card: !!document.querySelector('#main-content .u9-panel .u11-obcard') }));
    ok(tag + '：入社手続き：行を押すと右に今のカード', pn.sel === id && pn.card, pn);
    const heads = await page.evaluate(() => [...document.querySelectorAll('#main-content .u9-tbl thead th')].map(t => t.innerText.trim()).filter(Boolean));
    ok(tag + '：入社手続き：列（名前・店・職種・勤務開始予定・状態・進み具合・次にすること・日数）', heads.length === 8, heads);
  }
  if (phone) { await tapFirst(page); const b = await box(page); ok(tag + '：入社手続き：押すと全画面の箱（‹ 一覧へ）', b.open && b.full && b.back, b); await closeBox(page); }
  await page.evaluate(() => u11HrTab('apps')); await sleep(1200);
  x = await L(page);
  ok(tag + '：応募者：タブで切り替え・同じ形（50 人ずつ）', /1〜50/.test(x.pgn) && (pc ? (x.tb && x.rows === 50) : phone ? x.sp === 50 : (!x.tb && x.sp === 0)), x);
  if (phone) { await tapFirst(page); const b = await box(page); ok(tag + '：応募者：押すと全画面の箱', b.open && b.back, b); await closeBox(page); }
  ok(tag + '：応募者：横にはみ出さない', await over(page) <= 1);
  await shot(page, 'hiring-' + W + '-' + lang);

  await go(page, 'crew_handbook', "_hbTab='admin';_hbView=null");
  x = await L(page);
  ok(tag + '：Handbook 進捗管理：4 つの数・50 人ずつ', x.tiles === 4 && /1〜50/.test(x.pgn), { t: x.tiles, p: x.pgn });
  if (pc) ok(tag + '：Handbook：PC は表とパネル（章ごと）', x.tb && x.pn && /章ごと|By chapter/.test(await page.evaluate(() => document.querySelector('#main-content .u9-panel').innerText)), x);
  else {
    const st = await page.evaluate(() => { const th = document.querySelector('#main-content table.u11-hbt thead th'); return th ? getComputedStyle(th).position + '/' + th.style.left : 'none'; });
    ok(tag + '：Handbook：今の表・名前の列を止める', st.startsWith('sticky'), st);
    if (phone) { await page.evaluate(() => document.querySelector('#main-content .u11-hbn').click()); await sleep(600); const b = await box(page); ok(tag + '：Handbook：名前を押すと章ごとの箱', b.open && b.back, b); await closeBox(page); }
  }
  ok(tag + '：Handbook：横にはみ出さない', await over(page) <= 1);

  await go(page, 'tip', "tipPeriodView='matrix';window._u11TipUm=false;window._u11TipDay=null");
  const tp = await page.evaluate(() => { const m = document.getElementById('main-content'); const b = m.querySelector('.u11-umb');
    return { umb: !!b, umbTxt: b ? b.innerText.replace(/\s+/g, ' ').slice(0, 240) : '', exp: b && b.getAttribute('aria-expanded'), names: /Dan Missing/.test(b ? b.closest('.card').innerText : ''), tipm: !!m.querySelector('table.u11-tipm'), day: !!m.querySelector('.u11-tipday'), nav: !!m.querySelector('.u11-dnav') }; });
  ok(tag + '：配分表：配分に出ていない出勤者は 1 行にたたむ（人数と理由ごとの数・名前は出さない）', tp.umb && tp.exp === 'false' && !tp.names && /（[12]/.test(tp.umbTxt) && /1/.test(tp.umbTxt), tp);
  await page.evaluate(() => document.querySelector('#main-content .u11-umb').click()); await sleep(900);
  ok(tag + '：配分表：押すと開く（名前と理由）', await page.evaluate(() => { const b = document.querySelector('#main-content .u11-umb'); return b.getAttribute('aria-expanded') === 'true' && /Dan Missing/.test(b.closest('.card').innerText); }));
  if (phone) {
    ok(tag + '：配分表：スマホは 1 日ずつ（‹ 日 ›）', tp.day && tp.nav && !tp.tipm, tp);
    const d0 = await page.evaluate(() => (document.querySelector('#main-content .u11-dnav select') || {}).value);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#main-content .u11-dnav button')].pop(); b.click(); }); await sleep(900);
    const d1 = await page.evaluate(() => (document.querySelector('#main-content .u11-dnav select') || {}).value);
    ok(tag + '：配分表：› で次の日', d0 && d1 && d0 !== d1, { d0, d1 });
  } else {
    ok(tag + '：配分表：PC・あいだは期間の表', tp.tipm && !tp.day, tp);
    const st = await page.evaluate(() => { const tr = document.querySelector('#main-content table.u11-tipm tr.u11-st'); const c = tr && tr.querySelector('th,td'); return c ? getComputedStyle(c).position : 'none'; });
    ok(tag + '：配分表：見出しと ①〜④ を止める', st === 'sticky', st);
  }
  ok(tag + '：配分表：横にはみ出さない', await over(page) <= 1);
  await shot(page, 'tip-' + W + '-' + lang);

  await go(page, 'shift_admin', "shiftAdminTab='build';curStore='F01'");
  const sh = await page.evaluate(() => { const m = document.getElementById('main-content'); return { tabs: m.querySelectorAll('.u11-shtabs [role="tab"]').length, sel: [...m.querySelectorAll('.u11-shtabs [role="tab"]')].findIndex(b => b.getAttribute('aria-selected') === 'true') }; });
  if (phone) {
    ok(tag + '：シフト作成：スマホは曜日のタブ 7 つ', sh.tabs === 7 && sh.sel >= 0, sh);
    await page.evaluate(i => document.querySelectorAll('#main-content .u11-shtabs [role="tab"]')[(i + 1) % 7].click(), sh.sel); await sleep(900);
    const s2 = await page.evaluate(() => [...document.querySelectorAll('#main-content .u11-shtabs [role="tab"]')].findIndex(b => b.getAttribute('aria-selected') === 'true'));
    ok(tag + '：シフト作成：タブで次の曜日', s2 === (sh.sel + 1) % 7, s2);
  } else ok(tag + '：シフト作成：PC・あいだは今の週の表（タブを出さない）', sh.tabs === 0, sh);
  ok(tag + '：シフト作成：横にはみ出さない', await over(page) <= 1);
  for (const tab of ['rules', 'opt']) {
    await go(page, 'shift_admin', "shiftAdminTab='" + tab + "'");
    ok(tag + '：シフト作成 › ' + tab + '：横にはみ出さない', await over(page) <= 1);
    if (tab === 'opt') {
      /* □ だけのマス：スマホ（タッチ）はマスの端を押しても □ が切り替わる（マスは 44px）・PC はマスを押しても変わらない */
      const cell = await page.evaluate(() => { const i = [...document.querySelectorAll('#main-content .u11-touch td > input[type="checkbox"]:only-child')][0]; if (!i) return null;
        const td = i.parentElement, r = td.getBoundingClientRect(), ir = i.getBoundingClientRect(); td.scrollIntoView({ block: 'center' });
        const r2 = td.getBoundingClientRect(); return { key: i.getAttribute('onchange'), on: i.checked, h: Math.round(r.height), x: r2.left + 3, y: r2.top + 3, inside: ir.left <= r2.left + 3 }; });
      if (cell) {
        const st = async () => page.evaluate(k => { const i = [...document.querySelectorAll('#main-content input[type="checkbox"]')].find(x => x.getAttribute('onchange') === k); return i ? i.checked : null; }, cell.key);
        if (phone) await page.touchscreen.tap(cell.x, cell.y); else await page.mouse.click(cell.x, cell.y);
        await sleep(900);
        const after = await st();
        if (phone) {
          ok(tag + '：最適化設定：□ のマスは 44px・マスの端を押すと □ が切り替わる', cell.h >= 43.5 && !cell.inside && after === !cell.on, { h: cell.h, before: cell.on, after });
          if (after !== cell.on) { await page.evaluate(k => { const i = [...document.querySelectorAll('#main-content input[type="checkbox"]')].find(x => x.getAttribute('onchange') === k); if (i) i.click(); }, cell.key); await sleep(700); }
        } else ok(tag + '：最適化設定：PC・あいだはマスを押しても □ は変わらない（今のまま）', after === cell.on, { before: cell.on, after });
      } else ok(tag + '：最適化設定：□ のマスがある', false);
    }
    if (tab === 'rules' && phone) {
      const tg = await page.evaluate(() => [...document.querySelectorAll('#main-content .u11-touch span.tag[onclick]')].map(e => Math.round(e.getBoundingClientRect().height)));
      ok(tag + '：特別ルール：名前の札（押すと切り替え）は 44px', tg.length > 0 && Math.min(...tg) >= 43.5, tg.slice(0, 5));
    }
  }

  for (const [mode, name] of [['respmatrix', '責任マトリクス'], ['totoya_g2', 'G2']]) {
    await go(page, 'hiring', "hiringTab='career';window._ceMode='" + mode + "';window._respEdit=true");
    const rm = await page.evaluate(() => { const m = document.getElementById('main-content'); return { rows: m.querySelectorAll('.u11-rmrow').length, sel: m.querySelectorAll('table.u11-rmt select, table select').length }; });
    if (phone) {
      ok(tag + '：' + name + '：スマホは GM も表示モード（表の中に選ぶ欄を出さない）', rm.rows > 0 && rm.sel === 0, rm);
      await page.evaluate(() => document.querySelector('#main-content .u11-rmrow').click()); await sleep(700);
      const b = await box(page); ok(tag + '：' + name + '：業務を押すと全画面の箱で直す', b.open && b.back && b.sel >= 7, b);
      await closeBox(page);
      ok(tag + '：' + name + '：閉じても同じ画面（業務ガイドへ移らない）', await page.evaluate(() => curPage === 'hiring'));
    } else ok(tag + '：' + name + '：PC・あいだは今の編集の表', rm.rows === 0 && rm.sel > 0, rm);
    ok(tag + '：' + name + '：横にはみ出さない', await over(page) <= 1);
  }

  /* ===== UI案89 ===== */
  for (const [pg, pre, name, key] of [
    ['ingredient_master', "curStore='ALL';window._ingTab='master'", '食材マスター（凍結中）', 'ing'],
    ['recipe', "window._u9=null", '原価登録', 'rc'],
    ['purchase_detail', "_pdMonthOff=0", '仕入明細', 'pd'],
    ['invoice', "window._invMainView='list';window._u10RcTab='rc'", 'レシート', 'rcl'],
    ['invoice', "window._invMainView='list';window._u10RcTab='rb'", '建て替え経費', 'rbl'],
    ['vendor_master', "vmView='all'", '業者マスター', 'vm']]) {
    await go(page, pg, pre);
    x = await L(page);
    ok(tag + '：' + name + '：数と 50 件ずつ', key === 'rbl' ? /1〜50/.test(x.pgn) : (/[1-9]/.test(x.cnt) && (/\b50\b|1〜50/.test(x.cnt + x.pgn) || !x.pgn)), { cnt: x.cnt, pgn: x.pgn });
    await shape(name, x);
    if (pc) {
      const r = await page.evaluate(() => { const rs = document.querySelectorAll('#main-content tr.u9-row'); const tr = rs[Math.min(2, rs.length - 1)]; if (!tr) return null; tr.click(); return tr.getAttribute('data-u9id'); }); await sleep(400);
      ok(tag + '：' + name + '：行を押すとパネルが変わる', r != null && await page.evaluate(id => document.querySelector('#main-content tr.u9-row.sel').getAttribute('data-u9id') === id && document.querySelector('#main-content .u9-panel').innerText.trim().length > 0, r));
    }
    if (phone && x.sp) { await tapFirst(page); const b = await box(page); ok(tag + '：' + name + '：押すと全画面の箱', b.open && b.full && b.back, b); await closeBox(page); }
    if (key === 'rc') ok(tag + '：原価登録：3 つの数', x.tiles === 3, x.tiles);
    if (key === 'pd') ok(tag + '：仕入明細：日ごとの見出し', pc || phone ? x.grp > 0 : true, x.grp);
    await shot(page, key + '-' + W + '-' + lang);
  }
  const vmg = await page.evaluate(() => { const f = document.querySelector('#main-content .u10-fold'); return { fold: !!f, open: !!(f && f.classList.contains('on')) }; });
  ok(tag + '：業者マスター：業者の統合は 1 行にたたむ', vmg.fold && !vmg.open, vmg);

  await go(page, 'ingredient_master', "window._ingTab='v2';window._u9=null");
  const v2 = await page.evaluate(() => { const m = document.getElementById('main-content'); return { vrows: m.querySelectorAll('.u10-vrow').length, on: m.querySelectorAll('.u10-vrow.on').length, items: m.querySelectorAll('tr.u9-row, .u9-sprow, .v2-row, [data-u9list="v2"] > *').length }; });
  if (pc) ok(tag + '：新マスター：左に業者（初めに 1 社目）・右に品', v2.vrows > 0 && v2.on === 1, v2);
  else if (phone) ok(tag + '：新マスター：スマホは業者の一覧から', v2.vrows > 0 && v2.on === 0, v2);
  else ok(tag + '：新マスター：あいだは業者の一覧から', v2.vrows > 0, v2);
  ok(tag + '：新マスター：横にはみ出さない', await over(page) <= 1);

  await go(page, 'menu', "mnState().tab='items'");
  x = await L(page);
  ok(tag + '：メニュー › メニュー別：50 品ずつ', /1〜50/.test(x.pgn), x.pgn);
  ok(tag + '：メニュー：横にはみ出さない', await over(page) <= 1);

  ok(tag + '：pageerror 0', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);
