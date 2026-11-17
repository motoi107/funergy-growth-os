// v1179（UI案87・Moto さん 11/15 20:51 HST「次は全部Aいきます」）：本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs）と合成データ（tests/perf/gen-data.mjs）だけ。本番にはつながない。
// 確かめること：
//   1A Career Score：PC は表と右のパネル（50 人ずつ・4 つの数で絞る・グレード・店・名前）／スマホは 1 行の一覧 → 全画面の箱／あいだは今のカードを 50 人ずつ
//   2A 育成パイプライン：組織図はたたむ（開いたかを覚える）・リーダー不在の店・候補の表とパネル（担当軸）
//   3A スキル（従業員別）：表とパネル・書きかけのコメントは人ごとに残る（v1180 から聞かない）
//   4A 成長管理：スタッフ別は表と右の成長ジャーニー・「全画面で開く」から戻ると位置が戻る／OJT進捗一覧の並び・絞り込み
//   5A OJT管理：PC は章の一覧と 1 章・スマホは章の一覧 → 1 章（前・次・保存を下に止める）・保存していない変更・移る前に聞く
//      選択式の正解（前は押しても入らなかった）・「×」と正解の丸の押す範囲（タッチ 44px・となりと重ならない）
//   幅をまたいだら描き直す（1440 → 390）・横のはみ出し・スマホの 11px 未満の文字・pageerror
// 使い方：模擬サーバーを立てて（tests/perf/pcsp/README_JA.md）、node tests/e2e-pcsp/ui87-v1179.mjs
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

async function open(W, who, lang) {
  const mobile = W < 768;
  const dir = '/tmp/ui87-' + W + '-' + who + '-' + lang; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
    viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); (page._acceptNext ? d.accept() : d.dismiss()).catch(() => {}); });
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
  return { ctx, page, errors, dialogs };
}
const run = (page, code, arg) => page.evaluate(code, arg).then(() => sleep(1100));
const over1 = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
const over = async page => { let v = await over1(page); if (v <= 1) return v; await sleep(1500); return over1(page); };
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + '/' + name + '.jpg', type: 'jpeg', quality: 60, fullPage: true }).catch(() => {}); };
/* スマホ：画面の中の見えている文字で 11px 未満のもの（v1172 の決まり） */
const smallText = page => page.evaluate(() => {
  const out = []; const w = document.createTreeWalker(document.getElementById('main-content'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.nodeValue.trim()) continue; const e = n.parentElement; if (!e) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (e.closest('details:not([open])') && !e.closest('summary')) continue;
    if (e.closest('svg')) continue;
    const fs = parseFloat(cs.fontSize); if (fs < 10.95) out.push(fs + ':' + n.nodeValue.trim().slice(0, 16)); }
  return out;
});
/* 一覧の情報 */
const L = page => page.evaluate(() => {
  const m = document.getElementById('main-content');
  const tb = m.querySelector('.u9-pc .u9-tbl'), pn = m.querySelector('.u9-panel'), card = m.querySelector('.u9-pc .ar-tbl-card');
  const sp = [...m.querySelectorAll('.u9-sprow')];
  return { tb: !!tb, rows: tb ? tb.querySelectorAll('tr.u9-row').length : 0, pn: !!pn, pnPos: pn && getComputedStyle(pn).position,
    pnLeft: pn && Math.round(pn.getBoundingClientRect().left), tbRight: card && Math.round(card.getBoundingClientRect().right), fit: card ? card.scrollWidth <= card.clientWidth + 1 : null,
    pnName: pn ? (pn.querySelector('b, [style*="font-size:15px"], .u9-ph, .card-title') || pn).innerText.split('\n')[0].trim() : '',
    sel: (m.querySelector('tr.u9-row.sel') || { getAttribute(){ return null; } }).getAttribute('data-u9id'),
    sp: sp.length, spMinH: sp.length ? Math.min(...sp.map(b => b.getBoundingClientRect().height)) : 0,
    pgn: (m.querySelector('.ar-pgn') || {}).innerText || '', tiles: m.querySelectorAll('.u9-tile').length,
    cards: m.querySelectorAll(':scope .card').length };
});
const box = page => page.evaluate(() => {
  const mb = document.getElementById('modal-body'); const t = mb.querySelector(':scope > .modal-title'), f = mb.querySelector(':scope > [data-mfoot]');
  const bs = f ? [...f.querySelectorAll('button')] : [];
  return { open: document.getElementById('modal-overlay').classList.contains('open'), mfull: mb.hasAttribute('data-mfull'), title: t && getComputedStyle(t).position, foot: f && getComputedStyle(f).position,
    nb: bs.length, minH: bs.length ? Math.min(...bs.map(b => b.getBoundingClientRect().height)) : 0, back: !!(t && /一覧へ|List/.test(t.innerText)), w: Math.round(mb.getBoundingClientRect().width), vw: innerWidth,
    text: (mb.querySelector('[data-u9]') || {}).innerText ? mb.querySelector('[data-u9]').innerText.slice(0, 60) : '' };
});
const closeBox = async page => { await page.evaluate(() => { const b = [...document.querySelectorAll('#modal-body .modal-title button')].find(b => /一覧へ|List/.test(b.innerText)); if (b) b.click(); }); await sleep(400); };
const pickRow = async (page, i) => { const id = await page.evaluate(i => { const tr = document.querySelectorAll('#main-content tr.u9-row')[i]; tr.click(); return tr.getAttribute('data-u9id'); }, i); await sleep(300); return id; };
/* 押せる高さ：見た目の高さ＋FUNERGY_LAYOUT が広げた分（data-hit の --ht・--hb。v1172 の決まり「44px は押せる範囲だけ」） */
const hit44 = (page, sel) => page.evaluate(sel => { const els = [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width > 0);
  const hh = e => e.getBoundingClientRect().height + (e.hasAttribute('data-hit') ? (parseFloat(e.style.getPropertyValue('--ht')) || 0) + (parseFloat(e.style.getPropertyValue('--hb')) || 0) : 0);
  return { n: els.length, min: els.length ? Math.min(...els.map(e => Math.round(hh(e)))) : 0, low: els.filter(e => hh(e) < 43.5).map(e => e.className.split(' ').pop() + ':' + Math.round(hh(e))).slice(0, 4) }; }, sel);

/* ONLY=1440,390 のように幅を選べる（直すあいだだけ。ふだんは全部） */
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const want = W => !ONLY || ONLY.includes(W);
for (const [W, lang] of [[1440, 'ja'], [1024, 'en'], [768, 'ja'], [390, 'ja'], [390, 'en']].filter(([W]) => want(W))) {
  const tag = W + 'px ' + lang + ' GM';
  const pc = W >= 1024, phone = W < 768;
  const { ctx, page, errors, dialogs } = await open(W, 'gm', lang);

  /* ---- 1A Career Score ---- */
  await run(page, () => { lssView = 'list'; window._u9 = null; go('leadership'); });
  const c0 = await L(page);
  ok(tag + '：Career Score：50 人ずつ（1〜50 / 57）', /1〜50/.test(c0.pgn) && /57/.test(c0.pgn), c0.pgn);
  if (pc || phone) ok(tag + '：Career Score：4 つの数', c0.tiles === 4, c0.tiles);
  else ok(tag + '：あいだの幅：Career Score は今のカード（4 つの数・表は出さない）', c0.tiles === 0 && !c0.tb && c0.cards > 0, c0);
  if (pc) {
    ok(tag + '：PC：表 50 行・右にパネル（止まる）・表はカードに入る', c0.tb && c0.rows === 50 && c0.pn && c0.pnPos === 'sticky' && c0.pnLeft >= c0.tbRight - 1 && c0.fit, c0);
    const id = await pickRow(page, 4); const c1 = await L(page);
    ok(tag + '：PC：行を押すとその人がパネルに（選んだ印は 1 つ）', c1.sel === id && c1.pnName === id && await page.evaluate(() => document.querySelectorAll('#main-content tr.u9-row.sel').length === 1), { id, c1: c1.pnName });
    await page.evaluate(() => { const b = [...document.querySelectorAll('#main-content .ar-pager button')].find(x => x.textContent.trim() === '2'); b.click(); }); await sleep(900);
    const c2 = await L(page);
    ok(tag + '：PC：2 ページ目は 51〜57', /51〜57/.test(c2.pgn) && c2.rows === 7, c2.pgn);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-tile')[0].click()); await sleep(900);
    const c3 = await page.evaluate(() => ({ pgn: (document.querySelector('#main-content .ar-pgn') || {}).innerText || '', empty: !!document.querySelector('#main-content .u9-empty'), on: document.querySelectorAll('#main-content .u9-tile[aria-pressed="true"]').length, pg: (window._u9 || {}).pg.cs }));
    ok(tag + '：PC：「基準達成」を押すとその人だけ（0 人なら空の文）・1 ページ目', c3.empty && c3.on === 1 && c3.pg === 1, c3);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-tile')[0].click()); await sleep(900);
    await page.evaluate(() => { const s = document.getElementById('u9cs-g'); s.value = 'G3'; s.dispatchEvent(new Event('change')); }); await sleep(900);
    const c4 = await page.evaluate(() => [...document.querySelectorAll('#main-content tr.u9-row')].map(tr => tr.children[1].innerText.trim()));
    ok(tag + '：PC：グレードで絞る（G3 だけ）', c4.length > 0 && c4.every(g => g === 'G3'), c4.slice(0, 5));
    await page.evaluate(() => { const s = document.getElementById('u9cs-g'); s.value = ''; s.dispatchEvent(new Event('change')); }); await sleep(900);
    await page.fill('#u9q-cs', 'aki'); await sleep(900);
    const c5 = await page.evaluate(() => [...document.querySelectorAll('#main-content tr.u9-row')].map(tr => tr.getAttribute('data-u9id')));
    ok(tag + '：PC：名前で探す', c5.length > 0 && c5.every(n => /aki/i.test(n)), c5.slice(0, 5));
    ok(tag + '：PC：探す欄は描き直しても残る', await page.evaluate(() => document.getElementById('u9q-cs').value === 'aki'));
    await page.fill('#u9q-cs', ''); await sleep(900);
  } else if (phone) {
    ok(tag + '：スマホ：1 行の一覧（44px 以上）', c0.sp === 50 && c0.spMinH >= 44 && !c0.tb, c0);
    const t44 = await hit44(page, '#main-content .u9-tile, #main-content .u9-sel, #main-content .u9-q, #main-content .ar-pager .ar-pg');
    ok(tag + '：スマホ：数・絞り込み・探す欄・ページのボタンは 44px 以上', t44.n >= 8 && t44.min >= 44, t44);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-sprow')[1].click()); await sleep(900);
    const b = await box(page);
    ok(tag + '：スマホ：押すと全画面の箱（題と下のボタンを固定・48px・「一覧へ」）', b.open && b.mfull && b.title === 'sticky' && b.foot === 'sticky' && b.nb === 1 && b.minH >= 47.5 && b.back && b.w >= b.vw - 1, b);
    ok(tag + '：スマホ：箱で横にはみ出さない', (await over(page)) <= 1);
    await closeBox(page);
    ok(tag + '：スマホ：「一覧へ」で閉じる', await page.evaluate(() => !document.getElementById('modal-overlay').classList.contains('open')));
  } else {
    ok(tag + '：あいだの幅：今のカードを 50 人ずつ（表も 1 行の一覧も無い）', !c0.tb && c0.sp === 0 && await page.evaluate(() => document.querySelectorAll('#main-content .card').length >= 50), c0);
  }
  ok(tag + '：Career Score で横にはみ出さない', (await over(page)) <= 1, await over(page));
  if (phone) { const st = await smallText(page); ok(tag + '：スマホ：Career Score に 11px 未満の文字が無い', st.length === 0, st.slice(0, 6)); }

  /* ---- 2A 育成パイプライン ---- */
  await run(page, () => { try { localStorage.removeItem('_u9_pipe_org'); } catch (e) {} lssView = 'pipeline'; go('leadership'); });
  const p0 = await L(page);
  const org = await page.evaluate(() => { const d = document.querySelector('#main-content details.u9-org'); return { has: !!d, open: d && d.open, nl: !!document.querySelector('#main-content .u9-nlc') }; });
  if (pc || phone) {
    ok(tag + '：パイプライン：組織図はたたんで始まる・リーダー不在の店', org.has && org.open === false && org.nl, org);
    await page.evaluate(() => { const s = document.querySelector('#main-content details.u9-org > summary'); s.click(); }); await sleep(300);
    await run(page, () => go('leadership'));
    ok(tag + '：パイプライン：組織図を開いたことを覚える', await page.evaluate(() => document.querySelector('#main-content details.u9-org').open === true));
    await page.evaluate(() => { const d = document.querySelector('#main-content details.u9-org'); d.open = false; }); await sleep(300);
  }
  if (pc) {
    ok(tag + '：PC：パイプラインは表 50 行と右のパネル', p0.tb && p0.rows === 50 && p0.pn && p0.fit, p0);
    const pp = await page.evaluate(() => { const p = document.querySelector('#main-content .u9-panel'); return { cand: !!p.querySelector('button[onclick*="openLssDetail"]'), note: /昇格させません|nothing is promoted/.test(p.innerText) }; });
    ok(tag + '：PC：パネルに候補の行（詳細）と説明', pp.cand && pp.note, pp);
  } else if (phone) {
    ok(tag + '：スマホ：パイプラインは 1 行の一覧', p0.sp === 50 && p0.spMinH >= 44, p0);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-sprow')[0].click()); await sleep(900);
    const b = await box(page);
    ok(tag + '：スマホ：パイプライン：押すと全画面の箱', b.open && b.mfull && b.title === 'sticky' && b.back, b);
    await closeBox(page);
  } else {
    ok(tag + '：あいだの幅：パイプラインは今の形（表も 1 行の一覧も無い）', !p0.tb && p0.sp === 0, p0);
  }
  ok(tag + '：パイプラインで横にはみ出さない', (await over(page)) <= 1, await over(page));
  if (phone) { const st = await smallText(page); ok(tag + '：スマホ：パイプラインに 11px 未満の文字が無い', st.length === 0, st.slice(0, 6)); }

  /* ---- 3A スキル（従業員別） ---- */
  await run(page, () => { window._skillView = 'staff'; go('skill'); });
  const s0 = await L(page);
  if (pc) {
    ok(tag + '：PC：スキルは表 50 行と右のパネル（今のカード）', s0.tb && s0.rows === 50 && s0.pn && s0.fit && await page.evaluate(() => /Tip/.test(document.querySelector('#main-content .u9-panel').innerText)), s0);
    const ta = await page.evaluate(() => { const t = document.querySelector('#u9p-skill textarea[id^="sevn-"]'); if (!t) return null; t.value = 'メモ'; t.dispatchEvent(new Event('input', { bubbles: true })); return t.id; });
    if (ta) {
      /* v1180（#177 の Codex の P2）：書きかけは人ごとに残すので聞かない。戻ると欄に戻る（tests/e2e-pcsp/skill-comment-v1180.mjs） */
      const before = (await L(page)).sel, d0 = dialogs.length;
      await page.evaluate(() => document.querySelectorAll('#main-content tr.u9-row')[3].click()); await sleep(400);
      const after = (await L(page)).sel;
      ok(tag + '：PC：書きかけのコメントがあっても聞かずに別の人を開く（書きかけは残る）', dialogs.length === d0 && after !== before, { before, after });
      await page.evaluate(b => [...document.querySelectorAll('#main-content tr.u9-row')].find(r => r.getAttribute('data-u9id') === b).click(), before); await sleep(400);
      ok(tag + '：PC：戻ると書きかけが欄に戻る', await page.evaluate(() => (document.querySelector('#u9p-skill textarea[id^="sevn-"]') || {}).value) === 'メモ');
    } else ok(tag + '：PC：パネルにコメントの欄がある（GM）', false);
  } else if (phone) {
    ok(tag + '：スマホ：スキルは 1 行の一覧', s0.sp === 50 && s0.spMinH >= 44, s0);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-sprow')[0].click()); await sleep(900);
    const b = await box(page); ok(tag + '：スマホ：スキル：押すと全画面の箱', b.open && b.mfull && b.back && /Tip/.test(await page.evaluate(() => document.getElementById('modal-body').innerText)), b);
    ok(tag + '：スマホ：スキルの箱で横にはみ出さない', (await over(page)) <= 1);
    await closeBox(page);
  } else {
    ok(tag + '：あいだの幅：スキルは今のカードを 50 人ずつ', !s0.tb && s0.sp === 0 && /1〜50/.test(s0.pgn), s0);
  }
  ok(tag + '：スキルで横にはみ出さない', (await over(page)) <= 1, await over(page));
  if (phone) { const st = await smallText(page); ok(tag + '：スマホ：スキルに 11px 未満の文字が無い', st.length === 0, st.slice(0, 6)); }

  /* ---- 4A 成長管理 ---- */
  await run(page, () => { growthMgrSel = null; growthMgrTab = 'staff'; go('growth_mgr'); });
  const g0 = await L(page);
  if (pc) {
    ok(tag + '：PC：成長管理は表 50 行と右の成長ジャーニー', g0.tb && g0.rows === 50 && g0.pn && g0.fit && await page.evaluate(() => /成長ジャーニー|Growth journey|Journey/i.test(document.querySelector('#main-content .u9-panel').innerText)), g0);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#main-content [data-u9="gm"] .phase-tab')][1]; b.click(); }); await sleep(900);
    const g1 = await L(page);
    ok(tag + '：PC：Leader候補 / 社員 に切り替わる', g1.tb && await page.evaluate(() => /90/.test(document.querySelector('#main-content .u9-tbl thead').innerText)), g1.rows);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#main-content [data-u9="gm"] .phase-tab')][0]; b.click(); }); await sleep(900);
    await page.evaluate(() => window.scrollTo(0, 600)); await sleep(200);
    const y0 = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => [...document.querySelectorAll('#main-content .u9-panel button')].find(b => /全画面|full screen/i.test(b.innerText)).click()); await sleep(900);
    const det = await page.evaluate(() => ({ sel: growthMgrSel, y: window.scrollY }));
    ok(tag + '：PC：「全画面で開く」でその人の画面', !!det.sel && det.y === 0, det);
    await page.evaluate(() => growthMgrBack()); await sleep(900);
    const y1 = await page.evaluate(() => window.scrollY);
    ok(tag + '：PC：一覧に戻ると前の位置', Math.abs(y1 - y0) <= 4, { y0, y1 });
  } else if (phone) {
    ok(tag + '：スマホ：成長管理は 1 行の一覧', g0.sp === 50 && g0.spMinH >= 44, g0);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-sprow')[0].click()); await sleep(900);
    ok(tag + '：スマホ：押すとその人の画面', await page.evaluate(() => !!growthMgrSel));
    await page.evaluate(() => growthMgrBack()); await sleep(900);
  } else {
    ok(tag + '：あいだの幅：成長管理は今の形', !g0.tb && g0.sp === 0, g0);
  }
  ok(tag + '：成長管理で横にはみ出さない', (await over(page)) <= 1, await over(page));
  if (phone) { const st = await smallText(page); ok(tag + '：スマホ：成長管理に 11px 未満の文字が無い', st.length === 0, st.slice(0, 6)); }
  /* OJT進捗一覧 */
  await run(page, () => { growthMgrSel = null; growthMgrTab = 'progress'; go('growth_mgr'); });
  const o0 = await L(page);
  ok(tag + '：OJT進捗一覧：50 人ずつ', /1〜50/.test(o0.pgn), o0.pgn);
  if (pc) ok(tag + '：PC：OJT進捗一覧は表と右のパネル', o0.tb && o0.rows === 50 && o0.pn && o0.fit, o0);
  else { const pr = await hit44(page, '#main-content .u9-prow'); ok(tag + '：OJT進捗一覧は今の行（44px 以上）', pr.n === 50 && pr.min >= 44, pr); }
  await page.evaluate(() => { const s = document.getElementById('u9ojtp-s'); s.value = 'high'; s.dispatchEvent(new Event('change')); }); await sleep(900);
  const pcts = await page.evaluate(() => [...document.querySelectorAll('#main-content [data-u9="ojtp"] .u9-ojt > span:last-child, #main-content .u9-prow')].length);
  const so = await page.evaluate(() => (window._u9 || {}).sort.ojtp);
  ok(tag + '：OJT進捗一覧：並びを選べる', so === 'high' && pcts > 0, { so, pcts });
  await page.evaluate(() => { const s = document.getElementById('u9ojtp-f'); s.value = 'done'; s.dispatchEvent(new Event('change')); }); await sleep(900);
  const fl = await page.evaluate(() => ({ f: (window._u9 || {}).f.ojtp, n: document.querySelectorAll('#main-content tr.u9-row, #main-content .u9-prow').length }));
  ok(tag + '：OJT進捗一覧：OJT で絞れる', fl.f === 'done', fl);
  await page.evaluate(() => { const s = document.getElementById('u9ojtp-f'); s.value = ''; s.dispatchEvent(new Event('change')); }); await sleep(600);
  ok(tag + '：OJT進捗一覧で横にはみ出さない', (await over(page)) <= 1, await over(page));

  /* ---- 5A OJT管理 ---- */
  await run(page, () => { ojtAdminKey = 'ojt_g2'; window._ojtDraftMap = null; window._u9OjtBase = null; window._u9 = null; go('ojt_admin'); });
  const j0 = await page.evaluate(() => { const m = document.getElementById('main-content'); return { ch: m.querySelectorAll('.u9-ch').length, titles: m.querySelectorAll('[data-ojted] input[onchange*="\'title\'"]').length, bar: !!m.querySelector('.u9-ojt-bar'), pcg: !!m.querySelector('.u9-ojt-pc'), mods: (window._ojtDraft || {}).modules.length }; });
  if (pc) {
    ok(tag + '：PC：OJT管理は左に章の一覧・右に 1 章・下に止めた前／次／保存', j0.pcg && j0.ch === j0.mods && j0.titles === 1 && j0.bar, j0);
    const bp = await page.evaluate(() => { const b = document.querySelector('#main-content .u9-ojt-bar'), sv = b.querySelector('.btn-primary').getBoundingClientRect(), f = document.getElementById('chat-fab'); const fr = f && !f.hidden ? f.getBoundingClientRect() : null;
      return { pos: getComputedStyle(b).position, hidden: !!(fr && sv.right > fr.left && sv.left < fr.right && sv.bottom > fr.top && sv.top < fr.bottom) }; });
    ok(tag + '：PC：下の「保存」は右下のチャットのボタンに隠れない', bp.pos === 'sticky' && !bp.hidden, bp);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-ch')[2].click()); await sleep(900);
    const j1 = await page.evaluate(() => ({ t: document.querySelector('#main-content [data-ojted] input[onchange*="\'title\'"]').value, want: window._ojtDraft.modules[2].title, on: [...document.querySelectorAll('#main-content .u9-ch')].findIndex(b => b.classList.contains('on')) }));
    ok(tag + '：PC：章を押すとその章だけ', j1.t === j1.want && j1.on === 2, j1);
  } else if (phone) {
    ok(tag + '：スマホ：OJT管理は章の一覧から（章 56px 以上・1 章も開いていない）', j0.ch === j0.mods && j0.titles === 0 && await page.evaluate(() => Math.min(...[...document.querySelectorAll('#main-content .u9-ch')].map(b => b.getBoundingClientRect().height)) >= 56), j0);
    await page.evaluate(() => document.querySelectorAll('#main-content .u9-ch')[2].click()); await sleep(900);
    const j1 = await page.evaluate(() => { const m = document.getElementById('main-content'), top = m.querySelector('.u9-ojt-top'), bar = m.querySelector('.u9-ojt-bar'), f = document.getElementById('chat-fab');
      return { t: m.querySelector('[data-ojted] input[onchange*="\'title\'"]').value, want: window._ojtDraft.modules[2].title, top: top && getComputedStyle(top).position, bar: bar && getComputedStyle(bar).position,
        btnMin: bar ? Math.min(...[...bar.querySelectorAll('button')].map(b => b.getBoundingClientRect().height)) : 0, fab: f ? getComputedStyle(f).display : 'none' }; });
    ok(tag + '：スマホ：章を押すとその章だけ（上の「章の一覧」と下の前・次・保存を止める・48px・チャットのボタンは隠す）', j1.t === j1.want && j1.top === 'sticky' && j1.bar === 'sticky' && j1.btnMin >= 47.5 && j1.fab === 'none', j1);
  } else {
    ok(tag + '：あいだの幅：OJT管理は今の形（全部の章・章の一覧なし）', j0.ch === 0 && j0.titles === j0.mods && !j0.bar, j0);
  }
  /* 保存していない変更と、移る前に聞く（どの幅でも） */
  await page.evaluate(() => { const i = document.querySelector('#main-content [data-ojted] input[onchange*="\'title\'"]'); i.value = i.value + '（試し）'; i.dispatchEvent(new Event('change')); });
  await sleep(300);
  if (pc || phone) {
    await page.evaluate(() => u9OjtGo(0)); await sleep(900);
    ok(tag + '：章を移っても直したところは残り、「保存していない変更があります」', await page.evaluate(() => /保存していない変更があります|Unsaved changes/.test(document.querySelector('#main-content .u9-ojt-bar').innerText) && /（試し）/.test(window._ojtDraft.modules.map(m => m.title).join('|'))));
  }
  dialogs.length = 0; page._acceptNext = false;
  await page.evaluate(() => go('dashboard')); await sleep(900);
  ok(tag + '：保存せずにほかの画面へ移る前に聞く（やめると OJT管理のまま）', dialogs.some(d => /OJT管理に保存していない変更|OJT admin has unsaved/.test(d)) && await page.evaluate(() => curPage === 'ojt_admin'), dialogs.slice(0, 1));
  /* 選択式の正解（前は押しても入らなかった） */
  await page.evaluate(() => { const d = window._ojtDraft; const m = d.modules.find(x => x.hasTest); ojtTestQAddChoice(m.id); window.__qm = m.id; window.__qi = d.tests[m.id].length - 1; window.__mi = d.modules.indexOf(m); if (typeof u9OjtGo === 'function' && document.querySelector('#main-content .u9-ch')) u9OjtGo(window.__mi); });
  await sleep(1000);
  const ans = await page.evaluate(() => { const q = () => window._ojtDraft.tests[window.__qm][window.__qi];
    const row = [...document.querySelectorAll('#main-content .ojt-ans')].filter(e => (e.getAttribute('onclick') || '').indexOf(',' + window.__qi + ",'a',1)") > 0)[0];
    if (!row) return { found: false }; const a0 = q().a; row.click(); return { found: true, a0, a1: q().a }; });
  await sleep(700);
  const ans2 = await page.evaluate(() => { const b = [...document.querySelectorAll('#main-content .ojt-ans')].filter(e => (e.getAttribute('onclick') || '').indexOf(',' + window.__qi + ",'a',1)") > 0)[0]; return b && b.getAttribute('aria-pressed'); });
  ok(tag + '：選択式の正解を押すと下書きに入る（B）・押した丸が選ばれた形', ans.found && ans.a0 === 0 && ans.a1 === 1 && ans2 === 'true', { ans, ans2 });
  /* 押す範囲：タッチでは「×」と正解の丸の 18px 外も押せて、となりの欄は欄のまま */
  const hx = await page.evaluate(() => {
    const x = document.querySelector('#main-content [data-ojted] .ojt-x'), a = document.querySelector('#main-content [data-ojted] .ojt-ans');
    const nm = e => e ? e.tagName + '.' + String(e.className || '').split(' ').pop() : null;
    const at = (el, dx, dy) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy); return e === el || el.contains(e) ? true : nm(e); };
    /* となりの欄は欄のまま（見える所へ動かしてから確かめる） */
    const own = (el, fx) => { if (!el) return true; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const e = document.elementFromPoint(fx(r), r.top + r.height / 2); return e === el ? true : nm(e); };
    const inp = a && a.parentElement.querySelector('input'), xin = x.previousElementSibling;
    return { x0: at(x, 0, 0), xR: at(x, 13, 0), x14: at(x, 0, 14), a14: at(a, 14, 0), a18: at(a, 0, 18),
      inpOk: inp ? own(inp, r => r.left + 30) : 'none', xinOk: own(xin, r => r.right - 8), xw: Math.round(x.getBoundingClientRect().width) };
  });
  /* PC（マウス）：32px（行どうしは近いので、上下はとなりの行が先＝となりを取らない）。タッチ：44px（行の高さも 44px にしてある） */
  if (phone) ok(tag + '：タッチ：「×」と正解の丸は 18px 外も押せる・となりの欄は欄のまま', hx.x0 === true && hx.x14 === true && hx.a14 === true && hx.a18 === true && hx.inpOk === true && hx.xinOk === true, hx);
  else ok(tag + '：「×」は横 13px 外・正解の丸は 14px 外も押せる・となりの欄は欄のまま', hx.x0 === true && hx.xR === true && hx.a14 === true && hx.inpOk === true && hx.xinOk === true, hx);
  /* 保存（どの幅でも今の「保存」で全部の章） */
  await page.evaluate(() => { if (typeof u9OjtSave === 'function' && document.querySelector('#main-content .u9-ojt-bar')) u9OjtSave(); else ojtSaveDraft(); }); await sleep(900);
  const sv = await page.evaluate(() => ({ saved: /（試し）/.test(getOjtDefK('ojt_g2').modules.map(m => m.title).join('|')), a: (getOjtDefK('ojt_g2').tests[window.__qm][window.__qi] || {}).a, dirty: u9OjtDirtyAny(),
    st: (document.querySelector('#main-content .u9-ojt-bar') || { innerText: '' }).innerText }));
  ok(tag + '：保存すると全部の章と正解が入り、「保存していない変更」は消える', sv.saved && sv.a === 1 && !sv.dirty && (!(pc || phone) || /保存していない変更はありません|No unsaved changes/.test(sv.st)), sv);
  dialogs.length = 0;
  await page.evaluate(() => go('dashboard')); await sleep(900);
  ok(tag + '：保存したあとは聞かずに移れる', dialogs.length === 0 && await page.evaluate(() => curPage === 'dashboard'), dialogs);
  /* 元に戻す（模擬サーバーの保存も） */
  await run(page, () => { ojtAdminKey = 'ojt_g2'; go('ojt_admin'); });
  await page.evaluate(() => { const d = window._ojtDraft; d.modules.forEach(m => { m.title = String(m.title).replace('（試し）', ''); }); d.tests[window.__qm].splice(window.__qi, 1); ojtSaveDraft(); }); await sleep(600);
  if (phone) {
    await run(page, () => { u9OjtList(); });
    ok(tag + '：スマホ：章の一覧に戻るとチャットのボタンが出る', await page.evaluate(() => { const f = document.getElementById('chat-fab'); return !f || f.hidden || getComputedStyle(f).display !== 'none'; }));
  }
  ok(tag + '：OJT管理で横にはみ出さない', (await over(page)) <= 1, await over(page));
  if (phone) { await page.evaluate(() => u9OjtGo(1)); await sleep(900); const st = await smallText(page); ok(tag + '：スマホ：OJT管理（1 章）に 11px 未満の文字が無い', st.length === 0, st.slice(0, 6)); }

  /* 幅をまたいだら描き直す */
  if (W === 1440) {
    await run(page, () => { lssView = 'list'; go('leadership'); });
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(1800);
    const sw = await L(page);
    ok(tag + '：1440 → 390 で Career Score がスマホの形に描き直る', !sw.tb && sw.sp > 0, sw);
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(1800);
    ok(tag + '：390 → 1440 で表の形に戻る', (await L(page)).tb);
    await run(page, () => { ojtAdminKey = 'ojt_g2'; go('ojt_admin'); });
    await page.evaluate(() => { const i = document.querySelector('#main-content [data-ojted] input[onchange*="\'title\'"]'); i.value = i.value + '★'; });   /* まだ onchange の前（打っている途中） */
    await page.setViewportSize({ width: 900, height: 900 }); await sleep(2200);
    const k1 = await page.evaluate(() => ({ pcg: !!document.querySelector('#main-content .u9-ojt-pc'), v: [...document.querySelectorAll('#main-content [data-ojted] input[onchange*="\'title\'"]')].map(i => i.value).join('|') }));
    ok(tag + '：OJT管理：打っている途中の題は幅をまたいでも消えない（描き直さずに待つか、残して描き直す）', /★/.test(k1.v), k1);
    await page.evaluate(() => { const i = [...document.querySelectorAll('#main-content [data-ojted] input[onchange*="\'title\'"]')].find(i => /★/.test(i.value)); if (i) { i.value = i.value.replace('★', ''); i.dispatchEvent(new Event('change')); } });
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2200);
  }
  /* 開いた直後に「変えた入力」が無い（あると幅をまたいでも描き直さずに待ってしまう） */
  for (const [pg, f] of [['leadership', () => { lssView = 'list'; }], ['leadership', () => { lssView = 'pipeline'; }], ['skill', () => { window._skillView = 'staff'; }], ['growth_mgr', () => { growthMgrSel = null; growthMgrTab = 'staff'; }], ['growth_mgr', () => { growthMgrTab = 'progress'; }], ['ojt_admin', () => { ojtAdminKey = 'ojt_g2'; }]]) {
    await page.evaluate(f); await run(page, p => go(p), pg); await sleep(300);
    const df = await page.evaluate(() => { const d = uiDirtyFields(document.getElementById('main-content')); return { n: d.list.length, bad: d.bad, ids: d.list.map(x => x.id).slice(0, 5) }; });
    ok(tag + '：' + pg + '：開いた直後に「変えた入力」が無い', df.n === 0 && !df.bad, df);
  }
  ok(tag + '：pageerror なし', errors.length === 0, errors.slice(0, 3));
  if (SHOTS) for (const [n, f] of [['cs', () => { lssView = 'list'; go('leadership'); }], ['pipe', () => { lssView = 'pipeline'; go('leadership'); }], ['skill', () => { window._skillView = 'staff'; go('skill'); }], ['gm', () => { growthMgrSel = null; growthMgrTab = 'staff'; go('growth_mgr'); }], ['ojt', () => { ojtAdminKey = 'ojt_g2'; go('ojt_admin'); }]]) { await run(page, f); await shot(page, n + '-' + W + '-' + lang); }
  await ctx.close();
}

/* G3（店長）：見られる範囲は今のまま。画面が壊れない・はみ出さない */
for (const W of [1440, 390].filter(want)) {
  const tag = W + 'px ja G3';
  const { ctx, page, errors } = await open(W, 'sl', 'ja');
  for (const [n, f] of [['Career Score', () => { lssView = 'list'; go('leadership'); }], ['スキル', () => { window._skillView = 'staff'; go('skill'); }], ['成長管理', () => { growthMgrSel = null; growthMgrTab = 'staff'; go('growth_mgr'); }], ['OJT管理', () => go('ojt_admin')]]) {
    await run(page, f); ok(tag + '：' + n + 'で横にはみ出さない', (await over(page)) <= 1, await over(page));
  }
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
