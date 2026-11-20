// v1177（UI案85・Moto さん 11/15 15:46 HST「１ A ２ 今のまま ３ A ４ A ５ A ６ A」）：本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs）と合成データ（tests/perf/gen-data.mjs）だけ。本番にはつながない。
// 確かめること：
//   1A 日次進捗：KPI のタイル（PC は 1 行・スマホは 2 列・「›」の印で押すと内訳）・この先の日をたたむ行（端末に覚える）・PC の見出しの固定
//   3A マイページ PC の 2 列（仕事／成長）・4A GM の店ごとの表・5A 月間行動計画 › 設定の表（PC だけ）
//   6A スマホのグラフ（施策分析 › ランチ・ランチチャレンジ・マイページのスキル）の文字 11px 以上・日付が重ならない
//   どの案でも直す所：スマホのランチ・ディナーのまとめ（予実管理・会議）・会議の KPI推移の名前の列・キャッシュチップの箱の文字・箱の中の × の押す範囲
//   幅をまたいだら描き直す（1440 → 390）・横のはみ出し・pageerror
// 使い方：模擬サーバーを立てて（tests/perf/pcsp/README_JA.md）、node tests/e2e-pcsp/ui85-v1177.mjs
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
  const dir = '/tmp/ui85-' + W + '-' + who + '-' + lang; fs.rmSync(dir, { recursive: true, force: true });
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
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
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

for (const [W, lang] of [[1440, 'ja'], [1024, 'en'], [390, 'ja'], [390, 'en']]) {
  const tag = W + 'px ' + lang + ' GM';
  const pc = W >= 1024, phone = W < 768;
  const { ctx, page, errors } = await open(W, 'gm', lang);
  /* ---- 1A 日次進捗 ---- */
  await run(page, () => { _smallSet('_bud_fut_open', null); switchStore('F01'); setBudgetTab('daily'); go('budget'); });
  await sleep(800);
  const k = await page.evaluate(() => {
    const g = document.querySelector('.kpi-grid'); if (!g) return null;
    const ts = [...g.querySelectorAll(':scope > .kpi-tile')], tops = new Set(ts.map(t => Math.round(t.getBoundingClientRect().top))), lefts = new Set(ts.map(t => Math.round(t.getBoundingClientRect().left)));
    const click = ts.filter(t => t.hasAttribute('onclick')), go = click.filter(t => t.querySelector('.kpi-go'));
    const oldLine = /タップで内訳|Tap for breakdown/.test(g.innerText || '');
    const small = ts.flatMap(t => [...t.querySelectorAll('*')]).filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) * (parseFloat(getComputedStyle(document.body).zoom) || 1) < 10.95).length;
    return { n: ts.length, rows: tops.size, cols: lefts.size, click: click.length, go: go.length, oldLine, small };
  });
  ok(tag + '：日次進捗の KPI タイルがある', k && k.n >= 3, k);
  if (k) {
    /* 広い PC（タイルの枠が 1024px 以上）は 1 行。1024px の端末は 1 行に入らないので 4 列 × 2 行（8 枚のとき） */
    if (W >= 1280) ok(tag + '：PC はタイルが 1 行', k.rows === 1, k);
    else if (pc) ok(tag + '：1024px はタイルが 2 行まで', k.rows <= 2, k);
    else ok(tag + '：スマホはタイルが 2 列', k.cols === 2, k);
    ok(tag + '：押せるタイルにはすべて「›」の印', k.click > 0 && k.click === k.go, k);
    ok(tag + '：「タップで内訳」の行は無い', !k.oldLine, k);
    ok(tag + '：タイルの文字は 11px 以上（見た目）', k.small === 0, k);
  }
  await page.evaluate(() => { const t = document.querySelector('.kpi-grid > .kpi-tile[onclick]'); t && t.click(); });
  await sleep(900);
  ok(tag + '：タイルを押すと内訳の箱が開く', await page.evaluate(() => document.getElementById('modal-overlay').classList.contains('open')));
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } }); await sleep(300);
  const f0 = await page.evaluate(() => {
    const fold = document.querySelector('tr.bud-fold'), fut = [...document.querySelectorAll('tr.bud-fut')];
    const inner = fold && fold.querySelector('.bud-fold-in'), r = inner && inner.getBoundingClientRect(), cr = fold && fold.closest('.card').getBoundingClientRect();
    return { fold: !!fold, fut: fut.length, hidden: fut.filter(x => x.hidden).length, txt: fold ? fold.innerText.replace(/\s+/g, ' ').slice(0, 60) : '', inView: r ? (r.left >= cr.left - 1 && r.right <= Math.min(innerWidth, cr.right) + 1) : null, r: r && [Math.round(r.left), Math.round(r.right), Math.round(cr.left), Math.round(cr.right)] };
  });
  ok(tag + '：この先の日は 1 行にたたむ（最初は閉じている）', f0.fold && f0.fut > 0 && f0.hidden === f0.fut, f0);
  ok(tag + '：たたんだ行の文字が画面の中', f0.inView === true, f0);
  await page.evaluate(() => document.querySelector('tr.bud-fold').click()); await sleep(400);
  const f1 = await page.evaluate(() => ({ hidden: [...document.querySelectorAll('tr.bud-fut')].filter(x => x.hidden).length, flag: _smallGet('_bud_fut_open') }));
  ok(tag + '：押すと開いて、端末に覚える', f1.hidden === 0 && f1.flag === '1', f1);
  await run(page, () => renderPage('budget'));
  const f2 = await page.evaluate(() => ({ hidden: [...document.querySelectorAll('tr.bud-fut')].filter(x => x.hidden).length, n: document.querySelectorAll('tr.bud-fut').length }));
  ok(tag + '：描き直しても開いたまま', f2.n > 0 && f2.hidden === 0, f2);
  await page.evaluate(() => document.querySelector('tr.bud-fold').click()); await sleep(300);
  ok(tag + '：もう一度押すと閉じる', await page.evaluate(() => [...document.querySelectorAll('tr.bud-fut')].every(x => x.hidden) && _smallGet('_bud_fut_open') == null));
  if (pc) {
    const st = await page.evaluate(() => { const c = document.querySelector('.card.bud-dl'); const th = c && c.querySelector('thead th'); const tb = c && c.querySelector('table');
      return { fits: c && c.hasAttribute('data-fits'), pos: th && getComputedStyle(th).position, ovx: c && getComputedStyle(c).overflowX, tw: tb && tb.scrollWidth, cw: c && c.clientWidth }; });
    /* 表がカードに入るときだけ見出しを止める。入らない幅（1024px）は今のまま横に送る */
    if (st.tw <= st.cw + 1) ok(tag + '：PC は表の見出しを止める', st.fits && st.pos === 'sticky', st);
    else ok(tag + '：PC：表がカードに入らない幅は今のまま横に送る', !st.fits && st.ovx === 'auto', st);
  }
  ok(tag + '：日次進捗で横にはみ出さない', (await over(page)) <= 1, await over(page));
  /* 前の月は全部の日を出す（たたまない） */
  await run(page, () => shiftDailyMonth(-1));
  const pm = await page.evaluate(() => ({ fold: !!document.querySelector('tr.bud-fold'), fut: document.querySelectorAll('tr.bud-fut').length }));
  ok(tag + '：前の月はたたまない', !pm.fold && pm.fut === 0, pm);
  await run(page, () => shiftDailyMonth(1));
  /* ---- ランチ・ディナーのまとめ ---- */
  const ld = await page.evaluate(() => {
    const c = document.getElementById('ld-summary'); if (!c) return null;
    const tbl = c.querySelector('table.ld-t'), wrap = c.querySelector('.ld-tw');
    const td0 = tbl.querySelector('tbody td'), v = tbl.querySelector('.v'), s = tbl.querySelector('.s');
    let overlap = 0;
    tbl.querySelectorAll('tbody tr').forEach(tr => { const vs = [...tr.querySelectorAll('td .v')].map(x => x.getBoundingClientRect()); for (let i = 1; i < vs.length; i++) if (vs[i].left < vs[i - 1].right + 2) overlap++; });
    const small = [...c.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) * (parseFloat(getComputedStyle(document.body).zoom) || 1) < 10.95).length;
    const sht = c.querySelector('.ld-sht'), lng = c.querySelector('.ld-lng');
    /* 項目名：枠からはみ出さない・名前の最初の文字の並びが何行か（1 文字ずつ折り返していないか） */
    const label = [...tbl.querySelectorAll('tbody td:first-child')].map(x => { const tn = [...x.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      let lines = 0; if (tn) { const r = document.createRange(); r.selectNodeContents(tn); lines = new Set([...r.getClientRects()].map(q => Math.round(q.top))).size; }
      return { over: x.scrollWidth > x.clientWidth + 1, lines }; });
    return { wrap: !!wrap, pos: getComputedStyle(td0).position, v: getComputedStyle(v).fontSize, s: getComputedStyle(s).fontSize, overlap, small,
      sht: sht ? getComputedStyle(sht).display : null, lng: lng ? getComputedStyle(lng).display : null, labelOver: label.filter(x => x.over).length, maxLines: Math.max.apply(null, label.map(x => x.lines)), firstW: Math.round(td0.getBoundingClientRect().width) };
  });
  ok(tag + '：ランチ・ディナーのまとめがある（1 店）', !!ld, ld);
  if (ld) {
    ok(tag + '：まとめの数字が隣の列とくっつかない', ld.overlap === 0, ld);
    if (phone) {
      ok(tag + '：スマホ：項目の列を止める・大きい数字 14px・下の行 11px', ld.wrap && ld.pos === 'sticky' && ld.v === '14px' && ld.s === '11px', ld);
      ok(tag + '：スマホ：文字は 11px 以上', ld.small === 0, ld);
      ok(tag + '：スマホ：「人時売上」は短い名前', ld.sht === 'inline' && ld.lng === 'none', ld);
      ok(tag + '：スマホ：項目名は枠に入る・1 文字ずつ折り返さない', ld.labelOver === 0 && ld.maxLines <= (lang === 'ja' ? 1 : 2), ld);
    } else ok(tag + '：PC：「人時売上」は今のまま', ld.lng !== 'none', ld);
  }
  /* ---- 会議（2 は今のまま。スマホのまとめと KPI推移の名前の列だけ） ---- */
  await run(page, () => { switchStore('F01'); go('meeting'); });
  await sleep(1200);
  const mt = await page.evaluate(() => {
    const c = document.getElementById('ld-summary');
    let overlap = 0; if (c) c.querySelectorAll('tbody tr').forEach(tr => { const vs = [...tr.querySelectorAll('td .v')].map(x => x.getBoundingClientRect()); for (let i = 1; i < vs.length; i++) if (vs[i].left < vs[i - 1].right + 2) overlap++; });
    /* KPI推移（年の表）：横に送る表の最初の列が止まっているか */
    const kt = [...document.querySelectorAll('#main-content .card')].filter(x => /KPI推移|KPI trend/.test((x.querySelector('.card-title') || {}).innerText || ''));
    const res = kt.map(card => { const tb = card.querySelector('table'); if (!tb) return null; const sc = tb.parentElement; const td = tb.querySelector('tbody td');
      const before = td.getBoundingClientRect().left; sc.scrollLeft = 300; const after = td.getBoundingClientRect().left; sc.scrollLeft = 0;
      const k = (document.body.getBoundingClientRect().width / document.body.offsetWidth) || 1;
      return { scrolls: sc.scrollWidth > sc.clientWidth + 2, stays: Math.abs(before - after) < 1.5, nameW: Math.round(Math.max.apply(null, [...tb.querySelectorAll('td.mkt-n')].map(x => x.getBoundingClientRect().width)) / k), boxW: Math.round(sc.clientWidth) }; }).filter(Boolean);
    return { ld: !!c, overlap, kpi: res };
  });
  ok(tag + '：会議のまとめの数字がくっつかない', mt.ld && mt.overlap === 0, mt);
  ok(tag + '：会議の KPI推移：横に送っても名前の列が止まる', mt.kpi.length > 0 && mt.kpi.every(x => !x.scrolls || x.stays), mt.kpi);
  if (phone) ok(tag + '：スマホ：KPI推移の名前の列は 120px まで（月の列が見える）', mt.kpi.every(x => x.nameW <= 120 && x.boxW - x.nameW >= 150), mt.kpi);
  ok(tag + '：会議で横にはみ出さない', (await over(page)) <= 1, await over(page));
  /* ---- 6A グラフ ---- */
  await run(page, () => { switchStore('F02'); setBudgetTab('initiative'); setInitMode('lunch'); });
  await sleep(800);
  const lc1 = await svgText(page, '#main-content svg');
  ok(tag + '：施策分析 › ランチにグラフがある', lc1.length >= 2, lc1.length);
  if (phone) {
    ok(tag + '：スマホ：グラフは画面の幅で描く', lc1.filter(x => x.phw).length >= 2, lc1);
    ok(tag + '：スマホ：グラフの文字は 11px 以上・重ならない', lc1.filter(x => x.phw).every(x => x.minFs >= 10.95 && x.overlap === 0), lc1);
  } else ok(tag + '：PC：グラフは今の描き方', lc1.every(x => !x.phw), lc1);
  await run(page, () => { switchStore('F02'); go('lunch_challenge'); });
  await sleep(1500);
  const lc2 = await svgText(page, '#main-content svg[role=img]');
  ok(tag + '：ランチチャレンジのグラフ', lc2.length >= 1, lc2);
  if (phone) ok(tag + '：スマホ：ランチチャレンジの文字は 11px 以上・重ならない', lc2.length && lc2.every(x => x.phw && x.minFs >= 10.95 && x.overlap === 0), lc2);
  /* ---- 5A 月間行動計画 › 設定 ---- */
  await run(page, () => { switchStore('ALL'); go('cc_plan'); setCcTab('setting'); });
  const cc = await page.evaluate(() => ({ mx: !!document.querySelector('table.cc-mx'), inputs: document.querySelectorAll('table.cc-mx input[id^="ct-"]').length, dash: [...document.querySelectorAll('table.cc-mx td')].filter(td => td.innerText.trim() === '—').length, cards: document.querySelectorAll('#main-content input[id^="ct-"]').length }));
  if (pc) ok(tag + '：PC：設定は 1 つの表（指標 × 店）', cc.mx && cc.inputs > 0, cc); else ok(tag + '：スマホ：設定は今のまま（表にしない）', !cc.mx && cc.cards > 0, cc);
  ok(tag + '：月間行動計画で横にはみ出さない', (await over(page)) <= 1, await over(page));
  /* ---- 4A マイページ（GM） ---- */
  await run(page, () => go('mypage'));
  /* v1203（UI案98）：管理者のマイページも 6 つの段（PC は 2 列 .mp-pc6・前の「証明と PIN を横に」は無い）。tests/e2e-pcsp/mypage-v1203.mjs */
  const my = await page.evaluate(() => ({ pos: !!document.querySelector('table.pgd-pos'), pc6: !!document.querySelector('.mp-pc6'), multi: (function(){ try { return empStoresOf(getEmployees().find(e => e.name === curUserName) || {}).length; } catch (e) { return -1; } })() }));
  if (pc) {
    /* v1205（UI案98・5A）：本部の GM の自分のマイページは所属・応援の店だけ（合成データの GM は本部所属で応援なし＝表もカードも無い）。
       店が 2 つ以上の人（AM）の PC の表は tests/e2e-pcsp/mypage-fold-v1205.mjs */
    ok(tag + '：PC：本部の GM に全店の対応可能ポジションの表を出さない（v1205）', !my.pos, my);
    ok(tag + '：PC：管理者のマイページは 2 列の段（v1203）', my.pc6, my);
  } else ok(tag + '：スマホ：マイページは 1 列（表・2 列なし）', !my.pos && !my.pc6, my);
  ok(tag + '：マイページで横にはみ出さない', (await over(page)) <= 1, await over(page));
  /* ---- 箱：× の押す範囲（スマホ）・キャッシュチップの文字 ---- */
  await run(page, () => openSelfAspiration());
  const bx = await page.evaluate(() => { try { FUNERGY_LAYOUT.run(); } catch (e) { } const b = document.querySelector('#modal-body .modal-close'); return { hit: b && b.hasAttribute('data-hit'), ht: b && b.style.getPropertyValue('--ht') }; });
  if (phone) ok(tag + '：スマホ：箱の × に押す範囲が付く', bx.hit, bx);
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  await run(page, () => { const d = new Date(bizToday() + 'T12:00:00'); d.setDate(d.getDate() - 1); openCashTipModal('F01', d.toISOString().slice(0, 10)); });
  const ct = await page.evaluate(() => { const ts = [...document.querySelectorAll('#modal-body .form-label .tag')]; return { n: ts.length, fs: ts.map(t => getComputedStyle(t).fontSize) }; });
  ok(tag + '：キャッシュチップの箱の札は 11px', ct.n > 0 && ct.fs.every(x => parseFloat(x) >= 11), ct);
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  /* ---- 幅をまたいだら描き直す（PC → スマホ） ---- */
  if (W === 1440) {
    await run(page, () => go('mypage'));
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
    const rs = await page.evaluate(() => ({ pc6: !!document.querySelector('.mp-pc6'), pos: !!document.querySelector('table.pgd-pos') }));
    ok(tag + '：1440 → 390 にするとマイページを描き直す', !rs.pc6 && !rs.pos, rs);
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(1500);
    ok(tag + '：390 → 1440 に戻すと PC の形', await page.evaluate(() => !!document.querySelector('.mp-pc6')));
    /* #175 の Codex・Claude の P2-1：月間行動計画 › 設定で、まだ保存していない目標・必須のチェックを、幅をまたいだ描き直しで消さない（フォーカスあり・なし・両方向） */
    await run(page, () => { switchStore('ALL'); go('cc_plan'); setCcTab('setting'); });
    const ids = await page.evaluate(() => { const t = document.querySelector('table.cc-mx input[id^="ct-"]'), q = document.querySelector('#main-content input[id^="cq-"]'); return { t: t && t.id, q: q && q.id, tv: t && t.defaultValue, qv: q && q.defaultChecked }; });
    ok(tag + '：月間行動計画 › 設定に目標の欄と必須のチェックがある', ids.t && ids.q, ids);
    const st = () => page.evaluate(([t, q]) => { const a = document.getElementById(t), b = document.getElementById(q); return { mx: !!document.querySelector('table.cc-mx'), tv: a && a.value, td: a && a.defaultValue, qc: b && b.checked, qd: b && b.defaultChecked, foc: document.activeElement && document.activeElement.id }; }, [ids.t, ids.q]);
    if (ids.t && ids.q) {
      await page.fill('#' + ids.t, '999');
      await page.evaluate(q => { const b = document.getElementById(q); b.checked = !b.checked; }, ids.q);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      // フォーカスなしで PC → スマホ
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(2200);
      let s1 = await st();
      ok(tag + '：フォーカスなし 1440 → 390：スマホの形に描き直し、打った目標と外した必須が残る（保存はしない）', !s1.mx && s1.tv === '999' && s1.td !== '999' && s1.qc === !ids.qv && s1.qd === ids.qv, s1);
      // フォーカスあり（入力中）でスマホ → PC：入力中は描き直さず、離れたら描き直して残す
      await page.focus('#' + ids.t); await page.keyboard.press('End'); await page.keyboard.type('7');
      await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2200);
      let s2 = await st();
      ok(tag + '：フォーカスあり 390 → 1440：入力中は描き直さない（文字が消えない）', s2.tv === '9997' && s2.foc === ids.t && !s2.mx, s2);
      await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(2200);
      let s3 = await st();
      ok(tag + '：離れると PC の表に描き直し、9997 と外した必須が残る（保存はしない）', s3.mx && s3.tv === '9997' && s3.td !== '9997' && s3.qc === !ids.qv, s3);
      // フォーカスありで PC → スマホ
      await page.focus('#' + ids.t); await page.keyboard.press('End'); await page.keyboard.type('1');
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(2200);
      let s4 = await st();
      ok(tag + '：フォーカスあり 1440 → 390：入力中は描き直さない', s4.tv === '99971' && s4.mx, s4);
      await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(2200);
      let s5 = await st();
      ok(tag + '：離れるとスマホの形に描き直し、99971 と外した必須が残る', !s5.mx && s5.tv === '99971' && s5.td !== '99971' && s5.qc === !ids.qv, s5);
      // フォーカスなしでスマホ → PC
      await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2200);
      let s6 = await st();
      ok(tag + '：フォーカスなし 390 → 1440：PC の表に描き直し、値が残る', s6.mx && s6.tv === '99971' && s6.qc === !ids.qv, s6);
      // 何も打っていない画面はふつうに描き直す（前のまま）：別の画面へ移って戻ると保存済みの値
      await run(page, () => go('mypage')); await run(page, () => { go('cc_plan'); setCcTab('setting'); });
      let s7 = await st();
      ok(tag + '：保存していない値は、ほかの画面へ移ると捨てる（保存はされていない）', s7.tv === ids.tv && s7.qc === ids.qv, s7);
    }
  }
  /* #175 の Codex・Claude の P2-2：.kpi-wrap の外の .kpi-grid（採用の 4 枚など）は前の並び（600px から 4 列・それより狭いと 2 列） */
  await run(page, () => { window._u11HrTab = 'apps'; go('hiring'); }); await sleep(1500);   /* v1182（UI案88）：4 枚は「応募者」のタブ */
  const hg = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#main-content .kpi-grid')].find(x => !x.closest('.kpi-wrap') && x.children.length >= 4); if (!g) return null;
    const ts = [...g.children]; return { n: ts.length, cols: new Set(ts.map(t => Math.round(t.getBoundingClientRect().left))).size, gtc: getComputedStyle(g).gridTemplateColumns.split(' ').length };
  });
  ok(tag + '：採用：.kpi-wrap の外の .kpi-grid は前の並び（' + (W >= 600 ? '4' : '2') + ' 列）', hg && hg.cols === (W >= 600 ? 4 : 2) && hg.gtc === (W >= 600 ? 4 : 2), hg);
  /* #175：描き直す画面は、開いた直後（何も打っていない）に「変えた入力」が無い（あると幅をまたいでも描き直さずに待ってしまう） */
  for (const [pg, code] of [['mypage', () => go('mypage')], ['cc_plan', () => { switchStore('ALL'); go('cc_plan'); setCcTab('setting'); }], ['lunch_challenge', () => { switchStore('F02'); go('lunch_challenge'); }], ['budget:initiative', () => { switchStore('F02'); setBudgetTab('initiative'); go('budget'); }]]) {
    await run(page, code); await sleep(600);
    const df = await page.evaluate(() => { const d = uiDirtyFields(document.getElementById('main-content')); return { n: d.list.length, bad: d.bad, ids: d.list.map(x => x.id).slice(0, 5) }; });
    ok(tag + '：' + pg + '：開いた直後に「変えた入力」が無い（描き直しが止まらない）', df.n === 0 && !df.bad, df);
  }
  ok(tag + '：pageerror なし', errors.length === 0, errors.slice(0, 3));
  if (SHOTS) {
    await run(page, () => { switchStore('F01'); setBudgetTab('daily'); go('budget'); }); await shot(page, 'daily-' + W + '-' + lang);
    await run(page, () => { switchStore('F01'); go('meeting'); }); await sleep(800); await shot(page, 'meeting-' + W + '-' + lang);
    await run(page, () => { switchStore('ALL'); go('cc_plan'); setCcTab('setting'); }); await shot(page, 'cc-' + W + '-' + lang);
    await run(page, () => go('mypage')); await shot(page, 'mypage-gm-' + W + '-' + lang);
    await run(page, () => { switchStore('F02'); setBudgetTab('initiative'); setInitMode('lunch'); }); await sleep(600); await shot(page, 'lunch-' + W + '-' + lang);
    await run(page, () => { switchStore('F02'); go('lunch_challenge'); }); await sleep(1200); await shot(page, 'lc-' + W + '-' + lang);
  }
  await ctx.close();
}

/* ---- G3（スタッフのマイページ）：PC の 2 列・スマホのスキルのグラフ ---- */
for (const W of [1440, 390]) {
  const tag = W + 'px ja G3';
  const { ctx, page, errors } = await open(W, 'sl', 'ja');
  await run(page, () => go('mypage'));
  await sleep(800);
  const my = await page.evaluate(() => {
    const pcv = document.querySelector('.mp-pc'); const cols = pcv ? [...pcv.querySelectorAll(':scope > .mp-col')] : [];
    return { pcv: !!pcv, cols: cols.length, lefts: cols.map(c => Math.round(c.getBoundingClientRect().left)), heads: cols.map(c => (c.querySelector('.mp-colh, .mp-sech') || {}).innerText || ''),
      cards: document.querySelectorAll('#main-content .card').length };
  });
  /* v1203（UI案98）：G3 も 6 つの段（PC の 2 列は左 ①②③・右 ④⑤⑥＝見出しは段の名前）。G1 は前の「仕事・成長」 */
  if (W >= 1024) {
    ok(tag + '：PC：マイページは 2 列（左 ①②③・右 ④⑤⑥）', my.pcv && my.cols === 2 && my.lefts[0] < my.lefts[1] && /今日やること/.test(my.heads[0]) && /成長/.test(my.heads[1]), my);
  } else {
    ok(tag + '：スマホ：マイページは 1 列', !my.pcv && my.cards > 2, my);
    await page.evaluate(() => { try { mpFoldSet(4, false); } catch (e) { } }); await sleep(300);   /* v1205（6A）：スマホの ④ 成長 はたたんであるので開いてから測る */
    const sk = await svgText(page, '#main-content svg[data-phw]');
    ok(tag + '：スマホ：スキルのグラフの文字は 11px 以上', sk.length >= 1 && sk.every(x => x.minFs >= 10.95), sk);
  }
  ok(tag + '：マイページで横にはみ出さない', (await over(page)) <= 1, await over(page));
  await shot(page, 'mypage-sl-' + W);
  ok(tag + '：pageerror なし', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}
const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
process.exit(ng.length ? 1 : 0);

// v1185：GM・CEO・経理は名前を選ぶとメールとパスワードの段が出る。試しのあいだは「PIN でログイン」で今までどおり PIN の段へ（ほかの人は何もしない）
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
