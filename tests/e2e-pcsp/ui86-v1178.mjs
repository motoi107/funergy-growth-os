// v1178（UI案86・Moto さん 11/15 16:33 HST「全部A」）：本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs）と合成データ（tests/perf/gen-data.mjs）だけ。本番にはつながない。
// 確かめること：
//   1A 経理レビュー › 書類：PC は表と右のパネル・50 件ずつのページ・行を押すとパネルが変わる・確認済みのあと次の未確認へ・絞り込みで 1 ページ目
//      スマホは 1 行の一覧から全画面の箱（題と下のボタンを固定・48px）・状態の数は 1 行・絞り込みは 2×2／そのあいだ（768px）は今のカードを 50 件ずつ
//   2A 設定：上と下の 3 枚・承認ルーティングと No Tip・グレード × 画面の表（PC は 2 つ横・スマホはチェック 44px で名前が折れない）
//   3A 経理出力：PC は店ごとの表と下の 2 列。押すボタン（onclick と押せるか）は PC とスマホで同じ
//   4A 診断と記録：PC は 2 列・スマホは 1 列
//   5A 月次サマリー：スマホのグラフの文字 11px 以上・日付が重ならない
//   幅をまたいだら描き直す（1440 → 390）・横のはみ出し・pageerror
// 使い方：模擬サーバーを立てて（tests/perf/pcsp/README_JA.md）、node tests/e2e-pcsp/ui86-v1178.mjs
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

async function open(W, who, lang) {
  const mobile = W < 768;
  const dir = '/tmp/ui86-' + W + '-' + who + '-' + lang; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
    viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  await page.evaluate(l => { setLang(l); }, lang);
  const p = who === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : { loc: DATA.slStore, name: DATA.sl };
  await page.evaluate(l => loginPickLocation(l), p.loc);
  await page.locator('#login-name-grid .store-btn', { hasText: p.name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 100 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(2000);
  return { ctx, page, errors };
}
const run = (page, code, arg) => page.evaluate(code, arg).then(() => sleep(1100));
/* ページの横のはみ出し。動いている途中（知らせが入ってくるなど）を数えないよう、はみ出したら 1.5 秒あとにもう一度測る。それでもはみ出していたら、どの要素かを出す */
const over1 = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
const over = async page => {
  let v = await over1(page); if (v <= 1) return v;
  await sleep(1500); v = await over1(page); if (v <= 1) return v;
  /* どの要素を隠すとはみ出しが消えるかを、上から順にたどる（疑似要素の ::after も見つかる） */
  const who = await page.evaluate(() => {
    const ov = () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth;
    const path = []; let cur = document.body;
    for (let d = 0; d < 30; d++) {
      let hit = null;
      for (const ch of [...cur.children]) { const old = ch.style.display; ch.style.display = 'none'; const v = ov(); ch.style.display = old; if (v <= 1) { hit = ch; break; } }
      if (!hit) break;
      path.push(hit.tagName + '.' + String(hit.className || '').slice(0, 40) + (hit.id ? '#' + hit.id : '') + (hit.hasAttribute('data-hit') ? '[hit ' + hit.style.getPropertyValue('--ht') + '/' + hit.style.getPropertyValue('--hw') + ']' : '') + ' r=' + Math.round(hit.getBoundingClientRect().right));
      cur = hit;
    }
    const tb = document.querySelector('.topbar'); const kids = tb ? [...tb.querySelectorAll(':scope > *, :scope > * > *')].map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + ':' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 24)) : [];
    return path.slice(-4).concat(['topbar ' + (tb ? tb.scrollWidth + '/' + tb.clientWidth : '-')], kids);
  });
  console.log('    はみ出し ' + v + 'px：' + JSON.stringify(who));
  return v;
};
/* 画面全体の写真。スマホの真似では fullPage の写真のあと文字の大きさ（Chrome の文字の自動拡大）が変わったままになり、
   それ以降の測り方が狂う（Playwright の都合・アプリではない）。写真は確かめが全部終わってから、その幅の最後にまとめて撮る */
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + '/' + name + '.jpg', type: 'jpeg', quality: 60, fullPage: true }).catch(() => {}); };
/* SVG の中の文字：見た目の大きさ（文字の大きさ × 描いた幅 ÷ viewBox の幅）の最小と、同じ行の文字が重なっていないか */
const svgText = (page, sel) => page.evaluate(sel => {
  const out = [];
  document.querySelectorAll(sel).forEach(svg => {
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), r = svg.getBoundingClientRect();
    if (!(vb[2] > 0) || r.width < 1) return;
    const k = r.width / vb[2];
    const ts = [...svg.querySelectorAll('text')].filter(t => (t.textContent || '').trim()).map(t => ({ fs: parseFloat(t.getAttribute('font-size') || getComputedStyle(t).fontSize) * k, b: t.getBoundingClientRect() }));
    let minFs = 99, overlap = 0;
    ts.forEach(t => { if (t.fs < minFs) minFs = t.fs; });
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = ts[i].b, b = ts[j].b; if (Math.abs(a.top - b.top) < 2 && a.left < b.right - 1 && b.left < a.right - 1) overlap++; }
    out.push({ n: ts.length, minFs: +minFs.toFixed(2), overlap, w: Math.round(r.width), vbw: vb[2], phw: svg.hasAttribute('data-phw') });
  });
  return out;
}, sel);

/* 押すボタンの一覧（onclick と押せるか）。経理出力の PC とスマホで同じかを比べる */
const btnSet = page => page.evaluate(() => [...document.querySelectorAll('#main-content button[onclick]')].map(b => b.getAttribute('onclick').replace(/\s+/g, '') + (b.disabled ? '|off' : '')).sort());
const sameTop = els => new Set(els.map(r => Math.round(r.top))).size === 1;
let exportSets = {};

for (const [W, lang] of [[1440, 'ja'], [1024, 'en'], [768, 'ja'], [390, 'ja'], [390, 'en']]) {
  const tag = W + 'px ' + lang + ' GM';
  const pc = W >= 1024, phone = W < 768;
  const { ctx, page, errors } = await open(W, 'gm', lang);

  /* ---- 1A 経理レビュー › 書類 ---- */
  await run(page, () => { window._arPage = 1; window._arSel = null; window._arType = window._arStore = window._arMonth = window._arStatus = 'ALL'; window._arTab = 'docs'; go('acct_review'); });
  await sleep(800);
  const r0 = await page.evaluate(() => {
    const tb = document.querySelector('#main-content .ar-pc .ar-tbl'), pn = document.getElementById('ar-panel'), sp = document.querySelector('#main-content .ar-sp');
    const rows = tb ? tb.querySelectorAll('tr.ar-row').length : 0, srows = sp ? [...sp.querySelectorAll('.ar-sprow')] : [];
    const cards = [...document.querySelectorAll('#main-content .card > .approval-header')].length;
    const pgn = (document.querySelector('#main-content .ar-pgn') || {}).innerText || '';
    const stat = [...document.querySelectorAll('#main-content .ar-stat > *')].map(e => e.getBoundingClientRect());
    const flt = [...document.querySelectorAll('#main-content .ar-flt > select')].map(e => e.getBoundingClientRect());
    return { tb: !!tb, rows, pn: !!pn, pnPos: pn && getComputedStyle(pn).position, pnLeft: pn && Math.round(pn.getBoundingClientRect().left), tbRight: tb && Math.round(tb.closest('.card').getBoundingClientRect().right),
      sp: !!sp, srows: srows.length, sMinH: srows.length ? Math.min(...srows.map(b => b.getBoundingClientRect().height)) : 0, cards, pgn,
      statTop: new Set(stat.map(r => Math.round(r.top))).size, statN: stat.length, fltRows: new Set(flt.map(r => Math.round(r.top))).size, fltCols: new Set(flt.map(r => Math.round(r.left))).size, fltMinH: flt.length ? Math.min(...flt.map(r => r.height)) : 0,
      sel: (document.querySelector('#main-content tr.ar-row.sel') || {}).getAttribute ? document.querySelector('#main-content tr.ar-row.sel').getAttribute('data-aid') : null };
  });
  ok(tag + '：経理レビューの件数とページ「1〜50 件目」', /1〜50/.test(r0.pgn) || /1–50|1〜50/.test(r0.pgn), r0.pgn);
  if (pc) {
    ok(tag + '：PC：表が 50 行・右にパネル（止まる）', r0.tb && r0.rows === 50 && r0.pn && r0.pnPos === 'sticky' && r0.pnLeft >= r0.tbRight - 1, r0);
    ok(tag + '：PC：最初は未確認の行を選んでいる', !!r0.sel, r0.sel);
    const fit = await page.evaluate(() => { const c = document.querySelector('#main-content .ar-tbl-card'); return { sw: c.scrollWidth, cw: c.clientWidth }; });
    ok(tag + '：PC：表がカードに入る（横に送らない）', fit.sw <= fit.cw + 1, fit);
    const second = await page.evaluate(() => { const tr = document.querySelectorAll('#main-content tr.ar-row')[3]; tr.click(); return tr.getAttribute('data-aid'); });
    await sleep(300);
    const p1 = await page.evaluate(() => ({ sel: document.querySelector('#main-content tr.ar-row.sel').getAttribute('data-aid'), n: document.querySelectorAll('#main-content tr.ar-row.sel').length, btn: document.querySelector('#ar-panel .ar-acts [data-aid]').getAttribute('data-aid') }));
    ok(tag + '：PC：行を押すとその書類がパネルに', p1.sel === second && p1.n === 1 && p1.btn === second, p1);
    // 確認済みのあと次の未確認へ
    await page.evaluate(id => arApprove(id), second); await sleep(1500);
    const p2 = await page.evaluate(id => { const inv = arReviewList().find(x => String(x.id) === String(id)); const s = document.querySelector('#main-content tr.ar-row.sel'); const sid = s && s.getAttribute('data-aid'); const nx = arReviewList().find(x => String(x.id) === String(sid));
      return { st: inv && inv.reviewStatus, sel: sid, nxSt: nx && (nx.reviewStatus || '未確認') }; }, second);
    ok(tag + '：PC：確認済みにすると次の未確認の行へ', p2.st === '確認済み' && p2.sel && p2.sel !== second && p2.nxSt === '未確認', p2);
    // ページ
    await page.evaluate(() => { const b = [...document.querySelectorAll('#main-content .ar-pager button')].find(x => x.textContent.trim() === '2'); b.click(); }); await sleep(800);
    const p3 = await page.evaluate(() => ({ pgn: document.querySelector('#main-content .ar-pgn').innerText, rows: document.querySelectorAll('#main-content tr.ar-row').length, cur: (document.querySelector('#main-content .ar-pager [aria-current]') || {}).textContent }));
    ok(tag + '：PC：2 ページ目は 51〜100', /51〜100/.test(p3.pgn) && p3.rows === 50 && p3.cur === '2', p3);
    await page.evaluate(() => arSetFilter('Status', '未確認')); await sleep(800);
    ok(tag + '：PC：絞り込みを変えると 1 ページ目', await page.evaluate(() => /^1〜/.test(document.querySelector('#main-content .ar-pgn').innerText) && window._arPage === 1));
    await page.evaluate(() => arSetFilter('Status', 'ALL')); await sleep(600);
    const fs = await page.evaluate(() => { const v = document.querySelector('#ar-panel .ar-pv'), a = document.querySelector('#ar-panel .ar-pa'); return { v: parseFloat(getComputedStyle(v).fontSize), a: parseFloat(getComputedStyle(a).fontSize) }; });
    ok(tag + '：PC：パネルの業者 18px・金額 26px', fs.v === 18 && fs.a === 26, fs);
  } else if (phone) {
    ok(tag + '：スマホ：1 行の一覧（44px 以上）', r0.sp && r0.srows === 50 && r0.sMinH >= 44, r0);
    ok(tag + '：スマホ：状態の数は 1 行に 4 つ', r0.statN === 4 && r0.statTop === 1, r0);
    ok(tag + '：スマホ：絞り込みは 2×2（44px 以上）', r0.fltRows === 2 && r0.fltCols === 2 && r0.fltMinH >= 44, r0);
    await page.evaluate(() => document.querySelectorAll('#main-content .ar-sprow')[2].click()); await sleep(900);
    const bx = await page.evaluate(() => { const mb = document.getElementById('modal-body'); const t = mb.querySelector(':scope > .modal-title'), f = mb.querySelector(':scope > [data-mfoot]');
      const bs = f ? [...f.querySelectorAll('button')] : [];
      return { open: document.getElementById('modal-overlay').classList.contains('open'), mfull: mb.hasAttribute('data-mfull'), title: t && getComputedStyle(t).position, foot: f && getComputedStyle(f).position,
        nb: bs.length, minH: bs.length ? Math.min(...bs.map(b => b.getBoundingClientRect().height)) : 0, cols: new Set(bs.map(b => Math.round(b.getBoundingClientRect().left))).size,
        back: !!(t && /一覧へ|List/.test(t.innerText)), w: Math.round(mb.getBoundingClientRect().width), vw: innerWidth }; });
    ok(tag + '：スマホ：押すと全画面の箱（題と下のボタンを固定・2 列・48px）', bx.open && bx.mfull && bx.title === 'sticky' && bx.foot === 'sticky' && bx.nb >= 3 && bx.minH >= 47.5 && bx.cols === 2 && bx.back && bx.w >= bx.vw - 1, bx);
    ok(tag + '：スマホ：箱で横にはみ出さない', (await over(page)) <= 1);
    await page.evaluate(() => [...document.querySelectorAll('#modal-body .modal-title button')].find(b => /一覧へ|List/.test(b.innerText)).click()); await sleep(400);
    ok(tag + '：スマホ：「一覧へ」で閉じる', await page.evaluate(() => !document.getElementById('modal-overlay').classList.contains('open')));
  } else {
    ok(tag + '：あいだの幅：今のカードを 50 件ずつ', !r0.tb && !r0.sp && r0.cards === 50, r0);
  }
  ok(tag + '：経理レビューで横にはみ出さない', (await over(page)) <= 1, await over(page));

  /* ---- 2A 設定 ---- */
  await run(page, () => go('settings'));
  const st = await page.evaluate(() => {
    const top = [...document.querySelectorAll('#main-content .st-row.st-top > .card')].map(e => e.getBoundingClientRect());
    const bot = [...document.querySelectorAll('#main-content .st-row.st-bot > .card')].map(e => e.getBoundingClientRect());
    const mid = [...document.querySelectorAll('#main-content .st-row.st-mid > .card')].map(e => e.getBoundingClientRect());
    const gts = [...document.querySelectorAll('#main-content .st-gh table.st-gt')].map(e => e.getBoundingClientRect());
    const cbs = [...document.querySelectorAll('#main-content .st-gh .st-cb')].map(e => e.getBoundingClientRect());
    const wraps = [...document.querySelectorAll('#main-content .st-gh td.nm')].filter(td => td.getBoundingClientRect().height > (cbs.length ? Math.max(...cbs.map(r => r.height)) : 30) + 4).map(td => td.innerText.trim());
    const rt = document.querySelector('#main-content table.st-rt');
    return { top: top.length, topSame: new Set(top.map(r => Math.round(r.top))).size, bot: bot.length, botSame: new Set(bot.map(r => Math.round(r.top))).size, mid: mid.length, midSame: new Set(mid.map(r => Math.round(r.top))).size,
      gts: gts.length, gtSame: new Set(gts.map(r => Math.round(r.top))).size, cbMin: cbs.length ? Math.min(...cbs.map(r => Math.min(r.width, r.height))) : 0, cbs: cbs.length, wraps, rt: !!rt, rtCb: rt ? rt.querySelectorAll('input[type=checkbox]').length : 0 };
  });
  ok(tag + '：設定：上 3 枚・下 3 枚・承認ルーティングと No Tip・グレードの表 2 つ', st.top === 3 && st.bot === 3 && st.mid === 2 && st.gts === 2 && st.rt && st.rtCb > 0, st);
  if (pc) ok(tag + '：PC：上・下・真ん中・グレードの表が横に並ぶ', st.topSame === 1 && st.botSame === 1 && st.midSame === 1 && st.gtSame === 1, st);
  else ok(tag + '：' + (phone ? 'スマホ' : 'あいだの幅') + '：1 列に積む', st.topSame === 3 && st.gtSame === 2, st);
  if (phone) ok(tag + '：スマホ：チェック 44px・画面の名前が折れない', st.cbMin >= 43.5 && st.wraps.length === 0, st);
  ok(tag + '：設定で横にはみ出さない', (await over(page)) <= 1, await over(page));

  /* ---- 3A 経理出力 ---- */
  await run(page, () => go('acct_export'));
  await page.waitForFunction(() => !document.querySelector('#main-content [data-acct-busy]'), null, { timeout: 60000, polling: 300 }).catch(() => {});
  await sleep(500);
  const ex = await page.evaluate(() => {
    const tb = document.querySelector('#main-content table.ax-tbl'), cols = [...document.querySelectorAll('#main-content .ax-pc2 > .ax-col')].map(e => e.getBoundingClientRect());
    const sum = document.querySelector('#main-content .ax-sum'), sb = sum && sum.querySelector(':scope > .btn');
    return { tb: !!tb, rows: tb ? tb.querySelectorAll('tbody tr').length : 0, all: !!(tb && tb.querySelector('tr.ax-all')), cols: cols.length, colsSame: new Set(cols.map(r => Math.round(r.top))).size,
      leftOffice: !!document.querySelector('#main-content .ax-pc2 > .ax-col:first-child .ti-clock-dollar'), rightInv: !!document.querySelector('#main-content .ax-pc2 > .ax-col:last-child .ti-file-invoice'),
      sumRow: sum && sb ? (sb.getBoundingClientRect().left > sum.getBoundingClientRect().left + sum.getBoundingClientRect().width / 2) : false };
  });
  if (pc) ok(tag + '：PC：経理出力は店ごとの表（全店まとめての行）・まとめて出力は横長・下は 2 列（左 Office・右 集計）', ex.tb && ex.rows >= 3 && ex.all && ex.cols === 2 && ex.colsSame === 1 && ex.leftOffice && ex.rightInv && ex.sumRow, ex);
  else ok(tag + '：経理出力は今の形（表も 2 列も無い）', !ex.tb && ex.cols === 0 && !ex.sumRow, ex);
  if (pc) { const f2 = await page.evaluate(() => { const w = document.querySelector('#main-content table.ax-tbl').parentElement; return { sw: w.scrollWidth, cw: w.clientWidth }; }); ok(tag + '：PC：店ごとの表が横に送られない', f2.sw <= f2.cw + 1, f2); }
  exportSets[W + lang] = await btnSet(page);
  ok(tag + '：経理出力で横にはみ出さない', (await over(page)) <= 1, await over(page));

  /* ---- 4A 診断と記録 ---- */
  await run(page, () => go('diag_center'));
  const dc = await page.evaluate(() => { const cols = [...document.querySelectorAll('#main-content .dc-pc > .dc-col')].map(e => e.getBoundingClientRect());
    return { cols: cols.length, same: new Set(cols.map(r => Math.round(r.top))).size, chk: !!document.querySelector('#main-content .dc-chk'), refused: /送れていない保存の一覧|unsent/.test(document.getElementById('main-content').innerText) }; });
  if (pc) ok(tag + '：PC：診断と記録は 2 列', dc.cols === 2 && dc.same === 1 && dc.chk, dc);
  else ok(tag + '：診断と記録は 1 列', dc.cols === 0, dc);
  ok(tag + '：診断と記録で横にはみ出さない', (await over(page)) <= 1, await over(page));

  /* ---- 5A 月次サマリー ---- */
  await run(page, () => go('monthly'));
  const ms = await svgText(page, '#main-content .ms-trend svg, #main-content svg');
  if (phone) {
    const tr = await svgText(page, '#main-content .ms-trend svg');
    ok(tag + '：スマホ：月次サマリーのグラフの文字は 11px 以上・重ならない', tr.length >= 1 && tr.every(x => x.minFs >= 10.95 && x.overlap === 0), tr);
  }
  ok(tag + '：月次サマリーで横にはみ出さない', (await over(page)) <= 1, await over(page));
  if (phone) {
    /* 5A のつづき：要因分解・リピーター・コスト・メニュー・売上分析・KPI推移のグラフも 11px 以上。入らない本数はカードの中で横に流す（ページは横に出ない） */
    for (const st of ['decomp', 'repeat', 'cost', 'menu', 'sales', 'kpi']) {
      await run(page, s => msSetSubTab(s), st); await sleep(400);
      const g = await svgText(page, '#main-content svg');
      const bad = g.filter(x => x.n > 0 && (x.minFs < 10.95 || x.overlap > 0));
      ok(tag + '：スマホ：月次サマリー › ' + st + ' のグラフの文字は 11px 以上・重ならない', bad.length === 0, { charts: g.length, bad });
      ok(tag + '：月次サマリー › ' + st + ' で横にはみ出さない', (await over(page)) <= 1, await over(page));
    }
    await run(page, () => msSetSubTab('summary'));
  }

  /* 幅をまたいだら描き直す（PC → スマホ） */
  if (W === 1440) {
    await run(page, () => go('acct_review'));
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
    const sw = await page.evaluate(() => ({ sp: !!document.querySelector('#main-content .ar-sp'), pc: !!document.querySelector('#main-content .ar-pc') }));
    ok(tag + '：1440 → 390 で経理レビューがスマホの形に描き直る', sw.sp && !sw.pc, sw);
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(1500);
    ok(tag + '：390 → 1440 で PC の形に戻る', await page.evaluate(() => !!document.querySelector('#main-content .ar-pc')));
  }
  ok(tag + '：pageerror なし', errors.length === 0, errors.slice(0, 3));
  /* 写真は確かめが全部終わってから（スマホの真似では fullPage の写真のあと文字の大きさが変わったままになる。Playwright の都合） */
  if (SHOTS) for (const p of ['acct_review', 'settings', 'acct_export', 'diag_center', 'monthly']) { await run(page, p => go(p), p); await shot(page, p + '-' + W + '-' + lang); }
  await ctx.close();
}

/* 経理出力：PC とスマホで押すボタンは同じ（並べ方だけ違う） */
for (const lang of ['ja']) {
  const a = exportSets['1440' + lang] || [], b = exportSets['390' + lang] || [];
  const onlyA = a.filter(x => !b.includes(x)), onlyB = b.filter(x => !a.includes(x));
  const uniq = arr => [...new Set(arr)];
  ok('経理出力：PC とスマホで押すボタンの種類（onclick・押せるか）が同じ', a.length > 10 && onlyA.length === 0 && onlyB.length === 0 && JSON.stringify(uniq(a)) === JSON.stringify(uniq(b)), { onlyA: onlyA.slice(0, 5), onlyB: onlyB.slice(0, 5), a: a.length, b: b.length });
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);
