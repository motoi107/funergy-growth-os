// v1180：#177（v1179）の Codex の P2 2 つ（スキルの評価コメント）を本物の Chromium で確かめる。
// 模擬サーバー（tests/perf/server.mjs）と合成データ（tests/perf/gen-data.mjs）だけ。本番にはつながない。
// 1. PC：書きかけのコメントは、ほかの人を開く・ページ送り・名前で探す・店の切り替え・幅をまたいだ描き直しで消えない（聞かない）。記録・削除・ログアウト
// 2. スマホ：箱の中で記録・削除すると箱の中（履歴と欄）も新しくなる・同じ文を二度送らない・書きかけは閉じても残る（日英）
// 使い方：模擬サーバーを立てて（tests/perf/pcsp/README_JA.md）、node tests/e2e-pcsp/skill-comment-v1180.mjs
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
  const dir = '/tmp/sc1180-' + W + '-' + who + '-' + lang; fs.rmSync(dir, { recursive: true, force: true });
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


const logN = (page, n) => page.evaluate(n => ((ls('skill_eval_log', {}) || {})[n] || []).length, n);
const panelTa = page => page.evaluate(() => { const t = document.querySelector('#u9p-skill textarea[id^="sevn-"]'); return t ? t.value : null; });
const boxTa = page => page.evaluate(() => { const t = document.querySelector('#modal-body textarea[id^="sevn-"]'); return t ? t.value : null; });
const toastsOf = page => page.evaluate(() => [...document.querySelectorAll('.toast, #toast-wrap > *, [class*="toast"]')].map(e => e.innerText).join(' | '));

/* ---------- PC（1440px）：書きかけは消えない（ほかの人・ページ送り・名前で探す・店の切り替え）。記録・削除 ---------- */
{
  const tag = '1440px ja GM';
  const { ctx, page, errors, dialogs } = await open(1440, 'gm', 'ja');
  await run(page, () => { window._u9 = null; window._skillView = 'staff'; go('skill'); });
  const first = await pickRow(page, 0); await sleep(300);
  await page.click('#u9p-skill textarea[id^="sevn-"]'); await page.keyboard.type('書きかけのメモ'); await sleep(200);
  const d0 = dialogs.length;
  const other = await pickRow(page, 3); await sleep(300);
  ok(tag + '：書きかけがあってもほかの人をすぐ開ける（聞かない）', dialogs.length === d0 && (await L(page)).sel === other, { sel: (await L(page)).sel, other, dialogs: dialogs.slice(d0) });
  ok(tag + '：一覧の名前に「書きかけ」の印', await page.evaluate(id => { const tr = [...document.querySelectorAll('#main-content tr.u9-row')].find(r => r.getAttribute('data-u9id') === id); return !!(tr && tr.querySelector('.u9-draft')); }, first));
  /* ページ送り → 戻る */
  await page.evaluate(() => { const b = document.querySelector('#main-content .ar-pager .nx'); if (b) b.click(); }); await sleep(1100);
  const pg2 = (await L(page)).pgn;
  await page.evaluate(() => { const b = document.querySelector('#main-content .ar-pager .pv'); if (b) b.click(); }); await sleep(1100);
  await pickRow(page, 0); await sleep(300);
  ok(tag + '：ページ送りのあと戻ると書きかけが戻る', /51〜/.test(pg2) && await panelTa(page) === '書きかけのメモ', { pg2, ta: await panelTa(page) });
  /* 名前で探す（ほかの人だけにする）→ 消す */
  await page.fill('#u9q-skill', 'zzzz'); await sleep(1300);
  await page.fill('#u9q-skill', ''); await sleep(1300);
  await pickRow(page, 3); await pickRow(page, 0); await sleep(300);
  ok(tag + '：名前で探して対象外にしても書きかけが戻る', await panelTa(page) === '書きかけのメモ', await panelTa(page));
  /* 店の切り替え → 全店に戻す */
  const sid = await page.evaluate(() => (getVisibleStores()[0] || {}).id);
  await run(page, s => { setSkillStaffStore(s); }, sid); await run(page, () => { setSkillStaffStore('ALL'); });
  await pickRow(page, 3); await pickRow(page, 0); await sleep(300);
  ok(tag + '：店を切り替えて戻しても書きかけが戻る', await panelTa(page) === '書きかけのメモ', { sid, ta: await panelTa(page) });
  /* 幅をまたいでも（描き直し）残る：1440 → 390 → 1440 */
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(2500);
  await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2500);
  await pickRow(page, 3); await pickRow(page, 0); await sleep(300);
  ok(tag + '：幅をまたいで描き直しても書きかけが戻る', await panelTa(page) === '書きかけのメモ', await panelTa(page));
  /* 記録 → 欄が空・印が消える・もう一度押しても増えない */
  const n0 = await logN(page, first);
  await page.evaluate(() => [...document.querySelectorAll('#u9p-skill button')].find(b => /記録/.test(b.innerText)).click()); await sleep(1100);
  await pickRow(page, 0); await sleep(300);
  const n1 = await logN(page, first);
  ok(tag + '：記録すると 1 件増え、欄は空・印は消える', n1 === n0 + 1 && await panelTa(page) === '' && !(await page.evaluate(() => !!document.querySelector('#main-content tr.u9-row .u9-draft'))), { n0, n1, ta: await panelTa(page) });
  await page.evaluate(() => [...document.querySelectorAll('#u9p-skill button')].find(b => /記録/.test(b.innerText)).click()); await sleep(900);
  ok(tag + '：空のまま押しても増えない', await logN(page, first) === n1);
  /* 削除（確かめで OK）→ 1 件減る */
  page._acceptNext = true;
  await page.evaluate(() => { const b = document.querySelector('#u9p-skill button[onclick="skillEvalDelBtn(this)"]'); if (b) b.click(); }); await sleep(1100);
  page._acceptNext = false;
  ok(tag + '：削除すると 1 件減る（確かめのあと）', await logN(page, first) === n0 && dialogs.some(d => /削除しますか/.test(d)), { n: await logN(page, first) });
  /* #178 の Codex の P2-1：狭い幅で箱に書く → 閉じる（箱の欄は #modal-body に残る）→ 広げて PC のパネルで追記 → ほかの人 → 戻る */
  const pickId = async id => { await page.evaluate(id => { const tr = [...document.querySelectorAll('#main-content tr.u9-row')].find(r => r.getAttribute('data-u9id') === id); tr.click(); }, id); await sleep(400); };
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(2500);
  await page.evaluate(n => { const b = [...document.querySelectorAll('#main-content .u9-sprow')].find(x => x.getAttribute('data-u9id') === n); b.click(); }, first); await sleep(900);
  await page.click('#modal-body textarea[id^="sevn-"]'); await page.keyboard.type('狭い幅の文'); await sleep(200);
  await closeBox(page); await sleep(500);
  await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2500);
  const stale = await page.evaluate(() => { const ov = document.getElementById('modal-overlay'); const t = document.querySelector('#modal-body textarea[id^="sevn-"]'); return { closed: !(ov && ov.classList.contains('open')), staleTa: t ? t.value : null }; });
  ok(tag + '：#178 前提：閉じた箱に古い欄が残っている（この試験がその道を通る）', stale.closed && stale.staleTa === '狭い幅の文', stale);
  await pickId(first);
  ok(tag + '：#178 広げるとパネルに箱で書いた文', await panelTa(page) === '狭い幅の文', await panelTa(page));
  await page.click('#u9p-skill textarea[id^="sevn-"]'); await page.keyboard.press('End'); await page.keyboard.type('・PCで追記'); await sleep(200);
  await pickRow(page, 3); await pickId(first);
  ok(tag + '：#178 P2-1：ほかの人へ移って戻っても追記が残る（閉じた箱の古い欄で戻さない）', await panelTa(page) === '狭い幅の文・PCで追記', await panelTa(page));
  await page.fill('#u9q-skill', 'zzzz'); await sleep(1300); await page.fill('#u9q-skill', ''); await sleep(1300); await pickId(first);
  ok(tag + '：#178 P2-1：名前で探して描き直しても追記が残る', await panelTa(page) === '狭い幅の文・PCで追記', await panelTa(page));
  /* #178 の Codex の P2-2：この端末に保存できないとき（容量不足など）は欄を残し、成功と言わない */
  const nB = await logN(page, first);
  await page.evaluate(() => { window._lsSetOrig178 = lsSet; window.lsSet = function (k, v) { if (k === 'skill_eval_log') return false; return window._lsSetOrig178(k, v); }; });
  await page.evaluate(() => [...document.querySelectorAll('#u9p-skill button')].find(b => /記録/.test(b.innerText)).click()); await sleep(900);
  const tf = await toastsOf(page);
  ok(tag + '：#178 P2-2：保存できないと欄も書きかけも残り、「記録しました」と出さない', await logN(page, first) === nB && await panelTa(page) === '狭い幅の文・PCで追記' && /保存できず/.test(tf) && !/記録しました/.test(tf) && await page.evaluate(id => sevnHasDraft(id), first), { n: await logN(page, first), ta: await panelTa(page), tf });
  await page.evaluate(() => { window.lsSet = window._lsSetOrig178; });
  await page.evaluate(() => [...document.querySelectorAll('#u9p-skill button')].find(b => /記録/.test(b.innerText)).click()); await sleep(1100);
  await pickId(first);
  ok(tag + '：#178 P2-2：保存できるようになったら同じ欄でもう一度押せる', await logN(page, first) === nB + 1 && await panelTa(page) === '', { n: await logN(page, first), ta: await panelTa(page) });
  /* #178 の Codex（再レビュー）の P2：端末に保存できなくても本物の lsSet は送る → 取り込んでから押し直しても 2 件にしない */
  const nS = await logN(page, first);
  await page.click('#u9p-skill textarea[id^="sevn-"]'); await page.keyboard.type('送った文'); await sleep(200);
  await page.evaluate(() => { window._lwvOrig178 = _lsWriteVerified; window._lsWriteVerified = function (k, j) { if (/^spl_skill_eval_log_/.test(k)) return false; return window._lwvOrig178(k, j); }; });
  await page.evaluate(() => [...document.querySelectorAll('#u9p-skill button')].find(b => /記録/.test(b.innerText)).click()); await sleep(1500);
  const ts = await toastsOf(page);
  ok(tag + '：#178 再レビュー P2：送ったときは「クラウドへは送っています」・欄は残す・端末の一覧は増えない', /クラウドへは送っています/.test(ts) && await panelTa(page) === '送った文' && await logN(page, first) === nS, { ts: ts.slice(0, 160), ta: await panelTa(page), n: await logN(page, first) });
  await page.evaluate(() => { window._lsWriteVerified = window._lwvOrig178; });
  await page.evaluate(async n => { await pullOpKey('spl_skill_eval_log_' + n); }, first); await sleep(500);
  ok(tag + '：#178 再レビュー P2：クラウドから取り込むと 1 件増える', await logN(page, first) === nS + 1, await logN(page, first));
  await pickId(first);
  await page.evaluate(() => [...document.querySelectorAll('#u9p-skill button')].find(b => /記録/.test(b.innerText)).click()); await sleep(1200);
  const t2 = await toastsOf(page);
  ok(tag + '：#178 再レビュー P2：取り込んだあと押し直しても 2 件にしない・欄を空に', await logN(page, first) === nS + 1 && await panelTa(page) === '' && /もう記録されています/.test(t2), { n: await logN(page, first), ta: await panelTa(page), t2: t2.slice(0, 160) });
  /* ログアウトで書きかけと選んだ人を消す */
  await page.click('#u9p-skill textarea[id^="sevn-"]').catch(() => {}); await page.keyboard.type('x');
  const lo = await page.evaluate(() => { window._forceLogout = true; doLogout(); return { d: window._sevnDraft, u: window._u9 }; });
  ok(tag + '：ログアウトで書きかけ・選んだ人を消す', lo.d === null && lo.u === null, lo);
  ok(tag + '：pageerror なし', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

/* ---------- スマホ（390px）：箱の中で記録・削除すると箱の中も新しくなる・書きかけは閉じても残る ---------- */
for (const lang of ['ja', 'en']) {
  const tag = '390px ' + lang + ' GM';
  const { ctx, page, errors, dialogs } = await open(390, 'gm', lang);
  await run(page, () => { window._u9 = null; window._skillView = 'staff'; go('skill'); });
  const name = await page.evaluate(() => { const b = document.querySelectorAll('#main-content .u9-sprow')[0]; b.click(); return b.getAttribute('data-u9id'); }); await sleep(900);
  ok(tag + '：箱が開いてコメントの欄がある', (await box(page)).open && await boxTa(page) === '');
  if (lang === 'en') ok(tag + '：英語：コメントの欄の文字', await page.evaluate(() => /Comments/.test(document.getElementById('modal-body').innerText) && [...document.querySelectorAll('#modal-body button')].some(b => /Save/.test(b.innerText))));
  const n0 = await logN(page, name), txt = 'スマホのメモ' + lang;
  await page.click('#modal-body textarea[id^="sevn-"]'); await page.keyboard.type(txt); await sleep(200);
  const saveBtn = () => page.evaluate(() => { const b = [...document.querySelectorAll('#modal-body button')].find(b => b.getAttribute('onclick') && /submitSkillEvalNote/.test(b.getAttribute('onclick'))); b.click(); });
  await saveBtn(); await sleep(1300);
  const b1 = await box(page), hist1 = await page.evaluate(t => document.getElementById('modal-body').innerText.includes(t), txt);
  ok(tag + '：記録すると箱は開いたまま・履歴に出る・欄は空（P2-1）', b1.open && hist1 && await boxTa(page) === '' && await logN(page, name) === n0 + 1, { open: b1.open, hist1, ta: await boxTa(page), n: await logN(page, name) });
  await saveBtn(); await sleep(900);
  ok(tag + '：もう一度押しても同じ文は増えない', await logN(page, name) === n0 + 1);
  page._acceptNext = true;
  await page.evaluate(() => { const b = document.querySelector('#modal-body button[onclick="skillEvalDelBtn(this)"]'); b.click(); }); await sleep(1300);
  page._acceptNext = false;
  const hist2 = await page.evaluate(t => document.getElementById('modal-body').innerText.includes(t), txt);
  ok(tag + '：削除すると箱の中の履歴からも消える（古いボタンが残らない）', (await box(page)).open && !hist2 && await logN(page, name) === n0, { hist2, n: await logN(page, name) });
  /* 書きかけ → 閉じる → 開き直すと戻る・一覧に印 */
  await page.click('#modal-body textarea[id^="sevn-"]'); await page.keyboard.type('途中'); await sleep(200);
  await closeBox(page); await sleep(500);
  ok(tag + '：閉じると一覧の行に「書きかけ」', await page.evaluate(n => { const b = [...document.querySelectorAll('#main-content .u9-sprow')].find(x => x.getAttribute('data-u9id') === n); return !!(b && b.querySelector('.u9-draft')); }, name));
  await page.evaluate(n => { const b = [...document.querySelectorAll('#main-content .u9-sprow')].find(x => x.getAttribute('data-u9id') === n); b.click(); }, name); await sleep(900);
  ok(tag + '：開き直すと書きかけが戻る', await boxTa(page) === '途中', await boxTa(page));
  ok(tag + '：箱で横にはみ出さない', (await over(page)) <= 1);
  await closeBox(page);
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
