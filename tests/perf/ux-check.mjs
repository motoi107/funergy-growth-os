// v1127 の操作感（FUNERGY_UX）を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない）。
// 同じ台本を前の版（v1126）でも流して、前と後を比べる（前の版では NG になるものがあるのは想定どおり）。
// 使い方：模擬サーバー（server.mjs）を確かめたい版の index.html で動かしてから
//   DATA_FILE=<合成データ> node ux-check.mjs [出力の JSON]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync(process.env.DATA_FILE || '/home/claude/mnrun/data.json', 'utf8')).login;
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = p => fetch(new URL(p, APP)).then(r => r.text());
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

async function open(tag, width) {
  const dir = '/tmp/uxcheck-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: width || 390, height: 844 }, hasTouch: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message().slice(0, 80)); (page.__dialogAccept ? d.accept() : d.dismiss()).catch(() => {}); });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors, dialogs };
}
async function pickGm(page) {
  await page.evaluate(() => loginPickLocation('OFFICE'));
  await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click();
}
const appShown = page => page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 50 });
async function login(page) {
  await pickGm(page); await page.fill('#login-pin-input', '1234');
  await page.click('#login-pin-btn'); await appShown(page);
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(1500);
}
/* 保存の確かめに使うキー（クラウドの app_state にそのまま書くもの・売上・予算ではないもの） */
async function testKey(page) {
  return page.evaluate(() => {
    /* どの画面も読まないキー（運用データの頭に、ない店の印 UXTEST を付けたもの）。アプリの設定・Office のキーは使わない */
    const all = (typeof OP_SYNC_PREFIX !== 'undefined' ? OP_SYNC_PREFIX : []).filter(p => !/office|ocs|mr_|bonus|karte|^spl_|^daily_actuals|budget/i.test(p)).map(p => p + 'UXTEST');
    for (const k of all) { try { if (isOpSyncKey(k) && !_opMergeDef(k) && !/^(daily_actuals_|spl_budgets_v2_|budgets_v2)/.test(k) && !(typeof _SPLIT_KEYS !== 'undefined' && _SPLIT_KEYS[k]) && !(typeof SUPA_MASTER_MAP !== 'undefined' && SUPA_MASTER_MAP[k])) return k; } catch (e) { } }
    return null;
  });
}
/* 本文に置いた試験用のボタン（押すと端末に保存してクラウドへ送り、「保存しました」を出す。実際の画面の保存と同じ道） */
async function addSaveButton(page, key) {
  await page.evaluate((k) => {
    const m = document.body;   // 本文の外に置く（裏の描き直しで消えないように）
    const d = document.createElement('div'); d.id = 'uxt-wrap'; d.style.cssText = 'position:fixed;left:10px;top:200px;z-index:120';
    d.innerHTML = '<button class="btn btn-primary" id="uxt-save" onclick="window.__saves=(window.__saves||0)+1; lsSet(\'' + k + '\', {n: window.__saves, at: Date.now()}); showToast(\'保存しました\',\'success\')">保存する</button>';
    m.appendChild(d);
  }, key);
}
const toastTexts = page => page.evaluate(() => {
  const box = document.getElementById('ux-toasts');
  const list = box ? [...box.children].filter(x => !x._uxGone) : [...document.body.children].filter(x => x.style && x.style.position === 'fixed' && /bottom:\s*22px/.test(x.getAttribute('style') || ''));
  return list.map(x => (x.textContent || '').trim());
});

const t00 = Date.now();
await ctl('/__reset'); await ctl('/__net?rtt=0&bps=0');

/* ============ A. ログイン ============ */
{
  const { ctx, page, errors } = await open('login');
  // 1 回目（端末に写しを作る）→ ログアウト
  await login(page); await page.evaluate(() => doLogout()); await sleep(800);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 60000 });
  // A1 違う PIN：エラーが出て、PIN は消える。ボタンは元に戻る
  await pickGm(page);
  await page.fill('#login-pin-input', '9999'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const e = document.getElementById('login-pin-err'); return e && getComputedStyle(e).display !== 'none'; }, null, { timeout: 60000 });
  const a1 = await page.evaluate(() => ({ pin: document.getElementById('login-pin-input').value, btn: document.getElementById('login-pin-btn').disabled, err: document.getElementById('login-pin-err').textContent.slice(0, 20) }));
  ok('A1 違う PIN：エラーを出し、PIN を消してすぐ打ち直せる', a1.pin === '' && a1.btn === false, a1);
  // A2 Enter とボタンを続けて押しても、照合は 1 回。前のエラーは押した時点で消える
  await page.evaluate(() => { window.__apc = 0; const o = window.authPinCheck; window.authPinCheck = function () { window.__apc++; return o.apply(this, arguments); }; });
  await page.fill('#login-pin-input', '1234');
  const tClick = Date.now();
  await page.press('#login-pin-input', 'Enter');
  const errHidden = await page.evaluate(() => getComputedStyle(document.getElementById('login-pin-err')).display === 'none');
  await page.press('#login-pin-input', 'Enter').catch(() => { });
  await page.click('#login-pin-btn', { force: true, noWaitAfter: true }).catch(() => { });
  const fb = await page.evaluate(() => document.getElementById('login-pin-btn').textContent.trim());
  await appShown(page);
  const tApp = Date.now() - tClick;
  const opsBusyAtShow = await page.evaluate(() => !!window._uxOpsBusy);
  const a2 = await page.evaluate(() => ({ calls: window.__apc, pin: document.getElementById('login-pin-input').value }));
  ok('A2 Enter・ボタンを続けて押しても照合は 1 回', a2.calls === 1, a2.calls);
  ok('A3 押した時点で前のエラーを消し、「確認中…」を出す', errHidden && /確認中|Checking/.test(fb), { errHidden, fb });
  ok('A4 ログインのあと、入れた PIN を画面に残さない', a2.pin === '', a2.pin);
  ok('A5 売上・勤怠の取り込みを待たずに最初の画面を出す', opsBusyAtShow, { clickToApp_ms: tApp, opsStillRunning: opsBusyAtShow });
  await page.waitForFunction(() => !window._uxOpsBusy, null, { timeout: 120000 });
  // A6 同期の画面：消している途中にもう一度出しても見える・押せる。消したら隠れる
  const a6 = await page.evaluate(async () => {
    showSyncSplash('x'); await new Promise(r => setTimeout(r, 50)); hideSyncSplash(); await new Promise(r => setTimeout(r, 100)); showSyncSplash('y');
    await new Promise(r => setTimeout(r, 450));
    const o = document.getElementById('sync-splash'); const shown = { d: o.style.display, op: getComputedStyle(o).opacity, pe: getComputedStyle(o).pointerEvents };
    hideSyncSplash(); await new Promise(r => setTimeout(r, 450));
    return { shown, after: o.style.display };
  });
  ok('A6 同期の画面を続けて出しても透明のまま残らない', a6.shown.d === 'flex' && a6.shown.op === '1' && a6.shown.pe !== 'none' && a6.after === 'none', a6);
  // A7 ログアウト：モーダル・画面・知らせ・成長カルテの解錠を残さない
  const a7 = await page.evaluate(async () => {
    openModal('<div class="modal-title">t</div><input class="form-input" id="uxlm">'); showToast('前の人の知らせ', 'info'); window._karteUnlocked = true;
    doLogout(); await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('ux-toasts');
    return { modal: document.getElementById('modal-overlay').classList.contains('open'), main: document.getElementById('main-content').innerHTML.length,
      toasts: box ? box.children.length : [...document.body.children].filter(x => /前の人/.test(x.textContent || '')).length, karte: !!window._karteUnlocked };
  });
  ok('A7 ログアウトで前の人の画面・モーダル・知らせ・解錠を残さない', !a7.modal && a7.main === 0 && a7.toasts === 0 && !a7.karte, a7);
  ok('A8 ページの JavaScript のエラーなし（ログイン）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

/* ============ B. 描き直し・入力・変換・画面の行き来（スマホ 390px） ============ */
{
  const { ctx, page, errors } = await open('render');
  await login(page);
  // B1 打つたびに描き直す検索欄（食材マスター › 新マスター）：入力欄・カーソル位置を保つ
  await page.evaluate(() => { window._ingTab = 'v2'; window._v2q = ''; go('ingredient_master'); });
  const sel = 'input[placeholder="商品名・読取名・業者で検索"]';
  await page.waitForSelector(sel, { timeout: 30000 });
  await page.click(sel);
  await page.keyboard.type('abc', { delay: 60 });
  const b1 = await page.evaluate((s) => { const a = document.activeElement; return { focused: !!(a && a.matches && a.matches(s)), v: (document.querySelector(s) || {}).value, caret: a && a.selectionStart }; }, sel);
  ok('B1 打つたびに描き直す欄でも、入力欄とカーソルを保つ', b1.focused && b1.v === 'abc' && b1.caret === 3, b1);
  // 画面を描いた回数（#main-content の中身が入れ替わった回数）
  await page.evaluate(() => { window.__mc = 0; new MutationObserver(() => { window.__mc++; }).observe(document.getElementById('main-content'), { childList: true }); });
  // B2 打つたびに値を覚える欄（検索）で打っているときも、裏の描き直し（検索の待ち・通信の答え）はそのまま描き、欄とカーソルを保つ
  const b2 = await page.evaluate(async (s) => {
    const c0 = window.__mc; setTimeout(() => { renderPage('ingredient_master'); }, 0); await new Promise(r => setTimeout(r, 150));
    const p = document.getElementById('ux-fresh'), a = document.activeElement;
    return { rendered: window.__mc > c0, pill: !!(p && p.classList.contains('on')), focused: !!(a && a.matches && a.matches(s)), v: (document.querySelector(s) || {}).value, caret: a && a.selectionStart };
  }, sel);
  ok('B2 検索欄で打っているときも、裏の描き直しで検索の結果を出し、欄とカーソルを保つ', b2.rendered && !b2.pill && b2.focused && b2.v === 'abc' && b2.caret === 3, b2);
  // 試験用の画面（店舗オペレーション設定の描き方を差し替える。値を覚えない欄・id のある欄と無い欄）
  await page.evaluate(() => {
    window.__hn = 0;
    window.renderStoreOpsSettings = () => '<div id="uxt-n">' + (++window.__hn) + '</div><input id="uxt-a" class="form-input" value=""><input class="form-input uxt-b" value="">'
      + '<input id="uxt-ime" class="form-input" oninput="window.__draft=this.value"><button id="uxt-btn" class="btn btn-secondary" onclick="window.__clicked=window.__draft">次へ</button>';
    go('store_ops_settings');
  });
  await page.waitForSelector('#uxt-a');
  // B2b id のある欄で打っているとき：裏の描き直しのあと、打った文字・欄・カーソルを戻す
  await page.click('#uxt-a'); await page.keyboard.type('xyz', { delay: 30 });
  const b2b = await page.evaluate(async () => {
    const n0 = document.getElementById('uxt-n').textContent; setTimeout(() => renderPage(curPage), 0); await new Promise(r => setTimeout(r, 150));
    const a = document.activeElement;
    return { rendered: document.getElementById('uxt-n').textContent !== n0, v: document.getElementById('uxt-a').value, focused: !!a && a.id === 'uxt-a', caret: a && a.selectionStart };
  });
  ok('B2b 値を覚えない欄（id あり）：裏の描き直しのあと、打った文字・欄・カーソルを戻す', b2b.rendered && b2b.v === 'xyz' && b2b.focused && b2b.caret === 3, b2b);
  // B2c id の無い欄で打っているとき：描き直さずに「表示を更新」。押すと描き直す
  await page.click('.uxt-b'); await page.keyboard.type('q');
  const b2c = await page.evaluate(async () => {
    const n0 = document.getElementById('uxt-n').textContent; setTimeout(() => renderPage(curPage), 0); await new Promise(r => setTimeout(r, 150));
    const p = document.getElementById('ux-fresh');
    return { rendered: document.getElementById('uxt-n').textContent !== n0, pill: !!(p && p.classList.contains('on')), v: document.querySelector('.uxt-b').value };
  });
  ok('B2c 戻す先が決められない欄では描き直さずに「表示を更新」（打った文字は消えない）', !b2c.rendered && b2c.pill && b2c.v === 'q', b2c);
  if (b2c.pill) { await page.click('#ux-fresh button'); await sleep(200); }
  const b2d = await page.evaluate(() => { const p = document.getElementById('ux-fresh'); return { hidden: !(p && p.classList.contains('on')), n: document.getElementById('uxt-n').textContent }; });
  ok('B2d 「表示を更新」を押すと描き直して消える', b2d.hidden, b2d);
  // B2e ほかを押したあと（iPhone では欄から外れない）：裏の描き直しはそのまま描く。打った文字（id あり）は戻す
  await page.click('#uxt-a'); await page.keyboard.type('k'); await page.click('#uxt-n');
  const b2e = await page.evaluate(async () => {
    const n0 = document.getElementById('uxt-n').textContent; setTimeout(() => renderPage(curPage), 0); await new Promise(r => setTimeout(r, 150));
    const p = document.getElementById('ux-fresh');
    return { rendered: document.getElementById('uxt-n').textContent !== n0, pill: !!(p && p.classList.contains('on')), v: document.getElementById('uxt-a').value };
  });
  ok('B2e ほかを押したあとは止めずに描き直し、まだ保存していない文字は残す', b2e.rendered && !b2e.pill && b2e.v === 'k', b2e);
  // B3 日本語の変換中は描き直さない（変換が切れない）。確定したら 1 回描き直す
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => { window._ingTab = 'v2'; window._v2q = ''; go('ingredient_master'); });
  await page.waitForSelector(sel); await page.click(sel);
  const c0 = await page.evaluate(() => window.__mc);
  await cdp.send('Input.imeSetComposition', { text: 'し', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'しお', selectionStart: 2, selectionEnd: 2 });
  await sleep(100);
  const during = await page.evaluate((c) => window.__mc - c, c0);
  await cdp.send('Input.insertText', { text: '塩' });
  await sleep(200);
  const b3 = await page.evaluate((s) => { const a = document.activeElement; return { renders: window.__mc, v: (document.querySelector(s) || {}).value, q: window._v2q, focused: !!(a && a.matches && a.matches(s)) }; }, sel);
  ok('B3 変換中は描き直さず、確定したら描き直す（変換が途中で切れない）', during === 0 && b3.renders > c0 && b3.v === '塩' && b3.q === '塩' && b3.focused, { during, ...b3 });
  // B3b 変換中にボタンを押しても（押すと変換が確定する）、押した処理は打った文字をすべて読む
  await page.evaluate(() => go('store_ops_settings')); await page.waitForSelector('#uxt-ime');
  await page.click('#uxt-ime');
  await cdp.send('Input.imeSetComposition', { text: 'すし', selectionStart: 2, selectionEnd: 2 });
  await page.click('#uxt-btn'); await sleep(150);
  const b3b = await page.evaluate(() => ({ clicked: window.__clicked, v: (document.getElementById('uxt-ime') || {}).value }));
  ok('B3b 変換中にボタンを押しても、押した処理は打った文字をすべて読む（独立レビュー P2）', b3b.clicked === 'すし', b3b);
  // B3c 変換中の欄が消えても（描き直し）、変換中のまま残らない（ほかの描き直しを止めない）
  await page.click('#uxt-ime'); await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
  const b3c = await page.evaluate(async () => {
    document.getElementById('uxt-ime').remove();
    const n0 = document.getElementById('uxt-n').textContent; setTimeout(() => renderPage(curPage), 0); await new Promise(r => setTimeout(r, 150));
    return { rendered: document.getElementById('uxt-n').textContent !== n0, composing: !!(window.FUNERGY_UX && FUNERGY_UX.composing) };
  });
  ok('B3c 変換中の欄が消えたら変換中を解き、描き直しを止めない（独立レビュー P2）', b3c.rendered && !b3c.composing, b3c);
  // B4 日本語の変換を確定する Enter では動かさない。英字の予測変換の Enter・ふつうの Enter は動く
  const b4 = await page.evaluate(() => {
    const i = document.createElement('input'); i.id = 'uxt-enter'; i.setAttribute('onkeydown', "if(event.key==='Enter')window.__ent=(window.__ent||0)+1"); document.getElementById('main-content').appendChild(i);
    const enter = (comp) => i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: comp, bubbles: true, cancelable: true }));
    i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); i.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'しお', bubbles: true }));
    enter(true); const ja = window.__ent || 0; i.dispatchEvent(new CompositionEvent('compositionend', { data: '塩', bubbles: true }));
    i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); i.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'hello', bubbles: true }));
    enter(true); const en = (window.__ent || 0) - ja; i.dispatchEvent(new CompositionEvent('compositionend', { data: 'hello', bubbles: true }));
    enter(false); const normal = (window.__ent || 0) - ja - en;
    i.remove(); return { ja, en, normal };
  });
  ok('B4 日本語の変換確定の Enter では動かさず、英字の予測変換・ふつうの Enter では動く', b4.ja === 0 && b4.en === 1 && b4.normal === 1, b4);
  // B5 同じ画面を開き直しても（保存のあと・取り直しのあとなど）スクロール位置を変えない（中身をあとから描く画面でも）
  await page.evaluate(() => go('staff_master')); await page.waitForSelector('#emp-search'); await sleep(500);
  const b5 = await page.evaluate(async () => { window.scrollTo(0, 900); await new Promise(r => setTimeout(r, 50)); const y0 = window.scrollY; go(curPage); await new Promise(r => setTimeout(r, 1200)); return { y0, y1: window.scrollY }; });
  ok('B5 同じ画面を開き直してもスクロール位置を保つ', b5.y0 > 300 && Math.abs(b5.y1 - b5.y0) < 4, b5);
  // B6 ナビでいまの画面を押したときは上へ（今までどおり）
  const b6 = await page.evaluate(async () => { window.scrollTo(0, 900); await new Promise(r => setTimeout(r, 50)); return true; });
  await page.locator('#subnav-bar .subnav-chip.active').first().click(); await sleep(800);
  const b6y = await page.evaluate(() => window.scrollY);
  ok('B6 ナビでいまの画面を押したときは上へ（今までどおり）', b6 && b6y < 4, b6y);
  // B6b 画面の中のボタンで同じ画面のタブを切り替えたときも、今までどおり上へ（独立レビュー P3）
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'uxt-tab'; b.className = 'btn btn-secondary'; b.textContent = 'タブ'; b.setAttribute('onclick', 'go(curPage)'); b.style.cssText = 'position:fixed;left:10px;top:300px;z-index:120'; document.body.appendChild(b); window.scrollTo(0, 900); });
  await sleep(60); await page.click('#uxt-tab'); await sleep(400);
  const b6b = await page.evaluate(() => { document.getElementById('uxt-tab').remove(); return window.scrollY; });
  ok('B6b 押して同じ画面を開き直したときは、今までどおり上へ', b6b < 4, b6b);
  // B7 描くたびに同じ要素へ処理を足さない
  const b7 = await page.evaluate(() => {
    const d = document.createElement('div'); d.setAttribute('data-phase', 'uxt'); document.getElementById('main-content').appendChild(d);
    let n = 0; const o = window.filterPhase; window.filterPhase = function () { n++; };
    attachPageEvents(); attachPageEvents(); attachPageEvents(); d.click(); window.filterPhase = o; d.remove(); return n;
  });
  ok('B7 描き直しのたびに同じ処理を足さない（押すと 1 回）', b7 === 1, b7);
  // B8 従業員マスターの検索欄：打った文字を HTML として入れない
  await page.evaluate(() => go('staff_master')); await page.waitForSelector('#emp-search');
  await page.click('#emp-search'); await page.keyboard.type('"><i class=uxinj>x', { delay: 20 });
  const b8 = await page.evaluate(() => ({ inj: document.querySelectorAll('#main-content i.uxinj').length, v: document.getElementById('emp-search').value }));
  ok('B8 検索欄に打った記号が画面を壊さない', b8.inj === 0 && b8.v === '"><i class=uxinj>x', b8);
  ok('B9 ページの JavaScript のエラーなし（描き直し）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

/* ============ C. 保存・二度押し・知らせ（スマホ 390px） ============ */
{
  const { ctx, page, errors } = await open('save');
  await login(page);
  const key = await testKey(page);
  ok('C0 試験に使えるキーがある', !!key, key);
  await addSaveButton(page, key);
  // C1 クラウドが遅いとき：押したらすぐ「保存中…」。届いてから「保存しました」。右上も「保存中…」→「保存済み」
  await ctl('/__delay?path=/rest/v1/app_state&ms=1500');
  const t0 = Date.now();
  await page.click('#uxt-save');
  const firstToast = (await toastTexts(page))[0] || '';
  const tFirst = Date.now() - t0;
  await sleep(500);
  const mid = await page.evaluate(() => { const b = document.getElementById('ux-save'); return b && !b.hidden ? b.getAttribute('aria-label') : null; });
  let tDone = null;
  for (let i = 0; i < 60; i++) { await sleep(100); const tt = await toastTexts(page); if (tt.some(x => /保存しました/.test(x))) { tDone = Date.now() - t0; break; } }
  const end = await page.evaluate(() => { const b = document.getElementById('ux-save'); return b && !b.hidden ? b.getAttribute('aria-label') : null; });
  ok('C1 押したらすぐ「保存中…」、クラウドに届いてから「保存しました」', /保存中/.test(firstToast) && tDone != null && tDone >= 1400, { firstToast, feedback_ms: tFirst, saved_ms: tDone });
  ok('C2 右上：保存中… → 保存済み（時刻）', /保存中/.test(mid || '') && /保存済み/.test(end || ''), { mid, end });
  // C2b 「保存しました」が出ているあいだに、もう一度保存（遅い）：同じ知らせを「保存中…」に戻し、届いてから「保存しました」（独立レビュー P2）
  await sleep(1300);
  await page.click('#uxt-save');
  const c2b0 = (await toastTexts(page)).join('|');
  let c2bDone = null; for (let i = 0; i < 40; i++) { await sleep(100); const tt = await toastTexts(page); if (tt.some(x => /保存しました/.test(x))) { c2bDone = (i + 1) * 100; break; } }
  ok('C2b 同じ知らせの 2 回目の保存も、届いてから「保存しました」', /保存中/.test(c2b0) && !/保存しました/.test(c2b0) && c2bDone >= 1300, { first: c2b0, saved_ms: c2bDone });
  await ctl('/__delay?path=/rest/v1/app_state&ms=0');
  await sleep(2500);
  // C3 送れないとき：知らせは「この端末に保存（送信待ち）」。右上は「送信待ち N 件」。つながったら「今すぐ送る」で送れる
  await ctl('/__wfail?path=/rest/v1/app_state&n=20&status=503');
  await page.click('#uxt-save');
  let warn = null; for (let i = 0; i < 80; i++) { await sleep(100); const tt = await toastTexts(page); const w = tt.find(x => /この端末に保存/.test(x)); if (w) { warn = w; break; } }
  await sleep(300);
  const q = await page.evaluate(() => { const b = document.getElementById('ux-save'); return { label: b && !b.hidden ? b.getAttribute('aria-label') : null, n: typeof outboxCount === 'function' ? outboxCount() : null }; });
  ok('C3 送れないときは「保存しました」と出さず、この端末に保存（送信待ち）と出す', !!warn, warn);
  ok('C4 右上：送信待ち N 件', /送信待ち/.test(q.label || '') && q.n > 0, q);
  await ctl('/__wfail?path=/rest/v1/app_state&n=0');
  if (q.label) {
    await page.click('#ux-save'); await page.waitForSelector('#ux-save-send', { timeout: 5000 }).catch(() => { });
    await page.click('#ux-save-send').catch(() => { });
    await page.waitForFunction(() => typeof outboxCount === 'function' && outboxCount() === 0, null, { timeout: 30000 }).catch(() => { });
    await sleep(400);
  }
  const c5 = await page.evaluate(() => { const b = document.getElementById('ux-save'); return { label: b && !b.hidden ? b.getAttribute('aria-label') : null, n: typeof outboxCount === 'function' ? outboxCount() : null }; });
  ok('C5 「今すぐ送る」で送れたら 保存済み・送信待ち 0', c5.n === 0 && /保存済み/.test(c5.label || ''), c5);
  await page.keyboard.press('Escape');
  // C6 二度押し：保存は 1 回
  await sleep(1500);
  const s0 = await page.evaluate(() => window.__saves || 0);
  await page.dblclick('#uxt-save'); await sleep(300);
  const s1 = await page.evaluate(() => window.__saves || 0);
  ok('C6 保存ボタンを二度押ししても 1 回だけ', s1 - s0 === 1, s1 - s0);
  // C7 押すと描き直されるボタン：同じ場所を続けて押しても、次に出たボタンを押さない（承認の一覧など）
  const c7 = await page.evaluate(() => {
    window.__ap = 0; const w = document.getElementById('uxt-wrap');
    w.insertAdjacentHTML('beforeend', '<div id="uxt-list"><button class="btn btn-success" id="uxt-ap" onclick="window.__ap++; this.outerHTML=this.outerHTML">承認</button></div>');
    return true;
  });
  await page.click('#uxt-ap'); await sleep(150); await page.click('#uxt-ap');
  const ap = await page.evaluate(() => window.__ap);
  ok('C7 描き直しで同じ場所に来た次のボタンを続けて押さない', c7 && ap === 1, ap);
  await sleep(800); await page.click('#uxt-ap');
  const ap2 = await page.evaluate(() => window.__ap);
  ok('C8 間をあければ次も押せる', ap2 === 2, ap2);
  // C9 知らせ：重ねずに並べる（最大 3）。同じ知らせは 1 つ
  const c9 = await page.evaluate(async () => {
    ['一つ目の知らせ', '二つ目の知らせ', '三つ目の知らせ', '四つ目の知らせ', '四つ目の知らせ'].forEach((m, i) => showToast(m, i % 2 ? 'warning' : 'info'));
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('ux-toasts');
    const els = box ? [...box.children].filter(x => !x._uxGone) : [...document.body.children].filter(x => /つ目の知らせ/.test(x.textContent || ''));
    const rects = els.map(e => e.getBoundingClientRect()).map(r => [Math.round(r.top), Math.round(r.bottom)]);
    let overlap = false; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rects[i][0] < rects[j][1] && rects[j][0] < rects[i][1]) overlap = true;
    return { n: els.length, overlap, texts: els.map(e => e.textContent.trim()) };
  });
  ok('C9 知らせは重ならず最大 3 つ・同じ知らせは 1 つ', c9.n <= 3 && !c9.overlap && new Set(c9.texts).size === c9.texts.length, c9);
  ok('C10 ページの JavaScript のエラーなし（保存）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

/* ============ D. モーダル・キーボード（PC 1280px） ============ */
{
  const { ctx, page, errors, dialogs } = await open('modal', 1280);
  await login(page);
  await page.evaluate(() => {
    const b = document.createElement('button'); b.id = 'uxt-open'; b.className = 'btn btn-secondary'; b.textContent = 'モーダルを開く';
    b.onclick = () => openModal('<div class="modal-title">試験</div><input class="form-input" id="uxm1"><textarea class="form-textarea" id="uxm2"></textarea><div class="btn-row"><button class="btn btn-secondary" onclick="closeModalDirect()">キャンセル</button></div>');
    b.style.cssText = 'position:fixed;left:10px;top:200px;z-index:120'; document.body.appendChild(b);
  });
  await page.click('#uxt-open'); await sleep(250);
  const d1x = await page.evaluate(() => { const a = document.activeElement; return { id: a && a.id, tag: a && a.tagName, cls: a && String(a.className).slice(0, 40), open: document.getElementById('modal-overlay').classList.contains('open') }; });
  const d1 = d1x.id;
  ok('D1 開いたら最初の欄に（PC）', d1 === 'uxm1', d1x);
  await page.keyboard.type('memo');
  page.__dialogAccept = false;
  await page.keyboard.press('Escape'); await sleep(200);
  const d2 = await page.evaluate(() => document.getElementById('modal-overlay').classList.contains('open'));
  ok('D2 入力の途中で Esc：閉じる前に確かめる（やめれば開いたまま・入力も残る）', d2 && dialogs.length === 1 && await page.evaluate(() => document.getElementById('uxm1').value === 'memo'), { open: d2, dialogs });
  page.__dialogAccept = true;
  await page.keyboard.press('Escape'); await sleep(250);
  const d3 = await page.evaluate(() => ({ open: document.getElementById('modal-overlay').classList.contains('open'), back: document.activeElement && document.activeElement.id }));
  ok('D3 確かめて閉じると、開いたボタンに戻る', !d3.open && d3.back === 'uxt-open', d3);
  // D4 何も入れていなければ Esc ですぐ閉じる
  const nd = dialogs.length;
  await page.evaluate(() => closeModalDirect());   // 前の版では Esc で閉じないので、次の確かめの前に閉じておく
  await page.click('#uxt-open'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);
  const d4 = await page.evaluate(() => document.getElementById('modal-overlay').classList.contains('open'));
  ok('D4 入力が無ければ Esc ですぐ閉じる', !d4 && dialogs.length === nd, { open: d4 });
  // D5 入力の途中で外側を押すと確かめる
  page.__dialogAccept = false;
  await page.evaluate(() => closeModalDirect());
  await page.click('#uxt-open'); await sleep(200); await page.click('#uxm1'); await page.keyboard.type('x');
  await page.mouse.click(5, 5); await sleep(200);
  const d5 = await page.evaluate(() => document.getElementById('modal-overlay').classList.contains('open'));
  ok('D5 入力の途中で外側を押しても、確かめずに閉じない', d5 && dialogs.length === nd + 1, { open: d5 });
  page.__dialogAccept = true; await page.evaluate(() => closeModalDirect());
  // D6 キーボードで選んでいる場所が見える・押せないボタンの見た目
  await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn btn-primary'; b.id = 'uxt-dis'; b.disabled = true; b.textContent = 'x'; document.body.appendChild(b); });
  await page.focus('#uxt-open'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  const d6 = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.id, outline: cs.outlineStyle, dis: getComputedStyle(document.getElementById('uxt-dis')).opacity }; });
  ok('D6 キーボードで選んだボタンに枠が出る・押せないボタンは薄い', d6.outline !== 'none' && Number(d6.dis) < 0.6, d6);
  ok('D7 ページの JavaScript のエラーなし（モーダル）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}
await ctl('/__delay?path=/rest/v1/app_state&ms=0'); await ctl('/__wfail?path=/rest/v1/app_state&n=0');
const ver = await fetch(APP).then(r => r.text()).then(h => (h.match(/APP_VERSION = '(\d+)'/) || [])[1]);
console.log(`\n${results.filter(r => r.ok).length}/${results.length} OK  (v${ver}, ${Math.round((Date.now() - t00) / 1000)}s)`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ version: ver, results }, null, 1));
