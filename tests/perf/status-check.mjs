// v1137（UI案69 ⑨・決めてほしいこと 12）を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない）。
// ・右上の保存・同期・診断（どの画面でも）・押したときの中身・「詳しく」→「設定 › 診断と記録」
// ・一般の画面から「最新に更新」「最新情報を取得」「同期」「診断」が消えている・「自動同期 OFF」「全データリセット」が無い
// ・送れない保存（送信待ち・保存できなかった）・オフライン・自動の同期（ほかの端末の変更を取り込む）
// ・シフトの表・給与と連絡先の保存が、届かなかったときに「保存しました」を出さない
// 使い方：模擬サーバー（server.mjs）を動かしてから  DATA_FILE=<合成データ> node status-check.mjs [出力の JSON]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync(process.env.DATA_FILE || '/tmp/mnrun/data.json', 'utf8')).login;
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = p => fetch(new URL(p, APP)).then(r => r.text());
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

async function open(tag, width, lang) {
  const dir = '/tmp/stcheck-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: width || 1280, height: 860 }, locale: lang === 'en' ? 'en-US' : 'ja-JP' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', d => { (page.__dialogAccept ? d.accept() : d.dismiss()).catch(() => {}); });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors };
}
const appShown = page => page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 50 });
async function login(page, who) {
  if (who === 'sl') { await page.evaluate(s => loginPickLocation(s), DATA.slStore); await page.locator('#login-name-grid .store-btn', { hasText: DATA.sl }).first().click(); }
  else { await page.evaluate(() => loginPickLocation('OFFICE')); await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click(); }
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn'); await appShown(page);
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(1500);
}
const segs = page => page.evaluate(() => {
  const b = document.getElementById('ux-save');
  return { hidden: !b || b.hidden, segs: b ? [...b.querySelectorAll('.ux-seg')].map(s => ({ seg: s.getAttribute('data-seg'), st: (s.className.match(/is-(\w+)/) || [])[1], text: s.textContent.trim() })) : [] };
});
const seg = async (page, name) => (await segs(page)).segs.find(s => s.seg === name) || {};
const waitSeg = (page, name, st, ms) => page.waitForFunction(([n, s]) => { const e = document.querySelector('#ux-save .ux-seg[data-seg="' + n + '"]'); return e && e.classList.contains('is-' + s); }, [name, st], { timeout: ms || 20000, polling: 100 }).then(() => true, () => false);
const popText = page => page.evaluate(() => { const p = document.getElementById('ux-save-pop'); return p && p.classList.contains('on') ? p.textContent : ''; });

await ctl('/__reset'); await ctl('/__net?rtt=0&bps=0');

/* ============ A. GM・PC（1280px） ============ */
{
  const { ctx, page, errors } = await open('gm', 1280);
  await login(page, 'gm');
  const s0 = await segs(page);
  ok('A1 右上に 保存・同期・診断 の 3 つ', !s0.hidden && s0.segs.map(x => x.seg).join() === 'save,sync,diag', s0);
  const ob0 = await page.evaluate(() => ({ ob: _outboxMine().map(x => ({ k: x.key, a: x.attempts, e: x.lastErr, busy: _pushBusy(x.key) })), extra: FUNERGY_STATUS.extraPending(), st: FUNERGY_UX.saveState() }));
  ok('A2 ふだんは 3 つとも ✅（is-ok）', s0.segs.every(x => x.st === 'ok'), { segs: s0.segs, ob0 });
  ok('A3 言葉は 保存・同期・診断', /保存/.test(s0.segs[0] && s0.segs[0].text) && /同期/.test(s0.segs[1] && s0.segs[1].text) && /診断/.test(s0.segs[2] && s0.segs[2].text));
  const top = await page.evaluate(() => ({ sync: !!document.getElementById('topbar-sync'), strip: (document.querySelector('.fst-strip') || {}).textContent || '', main: document.getElementById('main-content').textContent }));
  ok('A4 右上の「最新に更新」が無い', !top.sync);
  ok('A5 ダッシュボードの帯に「最新情報を取得」「診断」が無い（取得の状態は残る）', !/最新情報を取得|同期診断/.test(top.strip) && !/最新情報を取得/.test(top.main), top.strip.slice(0, 120));
  // ほかの画面にも右上の 3 つ
  for (const p of ['budget', 'tip', 'shift_admin', 'staff_master', 'settings', 'approval', 'menu', 'acct_review']) {
    await page.evaluate(pg => go(pg), p); await sleep(700);
    const st = await segs(page), m = await page.evaluate(() => document.getElementById('main-content').textContent);
    ok('A6 ' + p + '：右上の 3 つ・画面に「最新に更新」「最新情報を取得」「最新を読む」「最新を取得」が無い', !st.hidden && st.segs.length === 3 && !/最新に更新|最新情報を取得|最新を読む|最新を取得/.test(m), (m.match(/最新に更新|最新情報を取得|最新を読む|最新を取得/) || [])[0]);
  }
  await page.evaluate(() => go('tip')); await sleep(600);
  ok('A7 チップ管理：「Tip診断」「最終同期」が無い・Toast の取り直しは「取り直す」', await page.evaluate(() => { const m = document.getElementById('main-content').textContent; return !/Tip診断|最終同期/.test(m) && /取り直す/.test(m); }));
  await page.evaluate(() => go('settings')); await sleep(600);
  const set = await page.evaluate(() => document.getElementById('main-content').textContent);
  ok('A8 設定：「全データリセット」「自動同期」「マスター自動同期」が無い・「診断と記録を開く」がある', !/全データリセット|自動同期|マスター自動同期/.test(set) && /診断と記録を開く/.test(set));
  // 押したときの中身
  await page.click('#ux-save'); await sleep(300);
  const pt = await popText(page);
  ok('A9 押すと 保存・同期・診断 の中身と「詳しく」', /保存/.test(pt) && /同期/.test(pt) && /診断/.test(pt) && /詳しく/.test(pt) && /問題なし/.test(pt), pt.slice(0, 200));
  await page.locator('#ux-save-pop [data-st-act="more"]').click(); await sleep(800);
  const dc = await page.evaluate(() => ({ page: curPage, text: document.getElementById('main-content').textContent }));
  ok('A10 「詳しく」→「設定 › 診断と記録」', dc.page === 'diag_center' && /この端末の状態/.test(dc.text) && /Toast の取り直し/.test(dc.text) && /画面ごとの診断/.test(dc.text) && /この端末の記録/.test(dc.text) && /クラウドの取り込み・書き直し/.test(dc.text));
  ok('A11 診断と記録に「自動同期 OFF」「ログイン時同期」が無い', !/自動同期 OFF|ログイン時同期/.test(dc.text));
  ok('A12 診断と記録：記録に「ログインして取り込んだ」', /ログインして取り込んだ/.test(dc.text));
  ok('A13 ナビに「診断と記録」', await page.evaluate(() => [...document.querySelectorAll('.subnav-bar, .nav-bar')].some(e => /診断と記録/.test(e.textContent))));

  /* B. 送れない保存（送信待ち）→ 今すぐ送る */
  /* どの画面も読まないキー（ux-check と同じ選び方） */
  const key = await page.evaluate(() => {
    const all = (typeof OP_SYNC_PREFIX !== 'undefined' ? OP_SYNC_PREFIX : []).filter(p => !/office|ocs|mr_|bonus|karte|^spl_|^daily_actuals|budget/i.test(p)).map(p => p + 'STTEST');
    for (const k of all) { try { if (isOpSyncKey(k) && !_opMergeDef(k) && !/^(daily_actuals_|spl_budgets_v2_|budgets_v2)/.test(k) && !(typeof _SPLIT_KEYS !== 'undefined' && _SPLIT_KEYS[k]) && !(typeof SUPA_MASTER_MAP !== 'undefined' && SUPA_MASTER_MAP[k])) return k; } catch (e) { } }
    return null;
  });
  ok('B0 試験に使うキーがある', !!key, key);
  await ctl('/__wfail?path=/rest/v1/app_state&n=50&status=503');
  await page.evaluate(k => lsSet(k, { at: Date.now() }), key);
  const q = await waitSeg(page, 'save', 'warn', 30000);
  ok('B1 送れないと「保存 ⚠ N」（送信待ち）', q, await seg(page, 'save'));
  await page.click('#ux-save'); await sleep(300);
  const pt2 = await popText(page);
  ok('B2 中身に「送れていない」と「今すぐ送る」', /送れていない/.test(pt2) && /今すぐ送る/.test(pt2), pt2.slice(0, 160));
  await ctl('/__wfail?path=/rest/v1/app_state&n=0');
  await page.locator('#ux-save-pop [data-st-act="send"]').click();
  ok('B3 「今すぐ送る」で送れて ✅ に戻る', await waitSeg(page, 'save', 'ok', 30000), await seg(page, 'save'));
  await page.keyboard.press('Escape'); await page.mouse.click(600, 600); await sleep(200);

  /* C. 給与と連絡先（emp-private）が保存できなかった → 「保存 ⚠」・「もう一度」 */
  await ctl('/__wfail?path=/functions/v1/emp-private&n=1&status=500');
  const r1 = await page.evaluate(() => { const e = getEmployees().find(x => x.status !== '退職'); return saveEmpPrivate(e.id, 20, 'x@example.invalid', '000', null); });
  ok('C1 保存できなかったら \'failed\'（前は答えを見なかった）', r1 === 'failed', r1);
  ok('C2 右上が「保存 ⚠ 1」', await waitSeg(page, 'save', 'warn', 5000), await seg(page, 'save'));
  await page.click('#ux-save'); await sleep(300);
  ok('C3 中身に「保存できなかったもの」「給与・連絡先」「もう一度」', /保存できなかったもの/.test(await popText(page)) && /給与・連絡先/.test(await popText(page)) && /もう一度/.test(await popText(page)));
  await page.locator('#ux-save-pop [data-st-act="retry"]').click();
  ok('C4 「もう一度」で保存できて ✅', await waitSeg(page, 'save', 'ok', 15000), await seg(page, 'save'));
  await page.mouse.click(600, 600); await sleep(200);
  // 知らせ：従業員の保存の知らせと一緒に、届かなかったら「保存できなかったもの」
  await ctl('/__wfail?path=/functions/v1/emp-private&n=1&status=500');
  const toast = await page.evaluate(async () => {
    const e = getEmployees().find(x => x.status !== '退職');
    window.__uxLastAct = 1; document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    saveEmpPrivate(e.id, 20, 'x@example.invalid', '000', null); showToast('従業員情報を更新しました', 'success');
    await new Promise(r => setTimeout(r, 2500));
    const box = document.getElementById('ux-toasts'); return box ? [...box.children].filter(x => !x._uxGone).map(x => x.textContent.trim()) : [];
  });
  ok('C5 届かなかったら「従業員情報を更新しました」ではなく「クラウドに保存できなかったもの」', toast.some(t => /保存できなかったもの/.test(t)) && !toast.some(t => /^従業員情報を更新しました$/.test(t)), toast);
  await page.evaluate(() => FUNERGY_STATUS.retryFailed()); await sleep(800);

  /* D. シフトの表（shift_plans）：送れなかったら送信待ち → 送り直す */
  const sid = await page.evaluate(() => (getVisibleStores()[0] || {}).id);
  await ctl('/__wfail?path=/rest/v1/shift_plans&n=1&status=503');
  const r2 = await page.evaluate(([s]) => { const w = getWeekStr(); const plan = { status: '下書き', cells: { 'mon_L_1': 'Test Person' } }; lsSet('shiftplan_' + s + '_' + w, plan); return pushShiftPlan(s, w, plan); }, [sid]);
  ok('D1 送れなかったら \'deferred\'（送信待ち）', r2 === 'deferred', r2);
  ok('D2 送信待ちに 1 件・右上「保存 ⚠」', (await page.evaluate(() => shiftPlanPendingList().length)) === 1 && await waitSeg(page, 'save', 'warn', 5000));
  const pulled = await page.evaluate(([s]) => pullShiftPlan(s, getWeekStr()), [sid]);
  ok('D3 送信待ちのあいだはクラウドから読んでも端末の値を上書きしない', pulled === 'pending', pulled);
  await page.evaluate(() => FUNERGY_STATUS.sendNow()); await sleep(1000);
  const cloud = await page.evaluate(async ([s]) => { const r = await fetch(SUPABASE_URL + '/rest/v1/shift_plans?store_id=eq.' + s + '&week=eq.' + encodeURIComponent(getWeekStr()) + '&select=cells', { headers: supaHeaders() }); return r.json(); }, [sid]);
  ok('D4 送り直してクラウドに入った・送信待ち 0・✅', Array.isArray(cloud) && cloud[0] && cloud[0].cells && cloud[0].cells.mon_L_1 === 'Test Person' && (await page.evaluate(() => shiftPlanPendingList().length)) === 0 && await waitSeg(page, 'save', 'ok', 8000));
  // 公開：届かなかったら「公開しました」と出さず、スタッフにも知らせない。届いたら知らせる
  // （自動の同期の送り直しが途中で走っても落ちたままになるよう、つながらないあいだは何度でも断る）
  await ctl('/__wfail?path=/rest/v1/shift_plans&n=50&status=503');
  const pub = await page.evaluate(async ([s]) => {
    const w = getWeekStr(); const n0 = (ls('notifications', []) || []).length;
    try { localStorage.setItem('_test_noalert', '1'); } catch (e) { }
    const plan = { status: '下書き', cells: { 'mon_L_1': 'Test Person' } }; lsSet('shiftplan_' + s + '_' + w, plan);
    const r = await publishShiftPlan(s, w);
    await new Promise(res => setTimeout(res, 300));
    const box = document.getElementById('ux-toasts'); const toasts = box ? [...box.children].filter(x => !x._uxGone).map(x => x.textContent.trim()) : [];
    return { r, toasts, n: (ls('notifications', []) || []).length - n0, pending: shiftPlanPendingList().map(x => x.notify) };
  }, [sid]);
  ok('D5 公開が届かなかったら「公開しました」ではなく「まだ送れていません」・知らせない・送信待ちに知らせの印', pub.r === 'deferred' && pub.toasts.some(t => /まだ送れていません/.test(t)) && !pub.toasts.some(t => /^シフトを公開しました$/.test(t)) && pub.n === 0 && pub.pending.join() === '1', pub);
  await ctl('/__wfail?path=/rest/v1/shift_plans&n=0');
  await page.evaluate(() => FUNERGY_STATUS.sendNow()); await sleep(1200);
  ok('D6 送れたらスタッフに「シフトが公開されました」', (await page.evaluate(() => (ls('notifications', []) || []).filter(n => n && n.title === 'シフトが公開されました').length)) >= 1);

  /* E. オフライン → つながると自動で最新 */
  await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await sleep(400);
  ok('E1 オフラインで「同期 ⚠ オフライン」', (await seg(page, 'sync')).st === 'warn' && /オフライン/.test((await seg(page, 'sync')).text) || (await page.evaluate(() => /オフライン/.test(document.getElementById('ux-save').title))), await seg(page, 'sync'));
  await ctl('/__mutate');
  const n0 = await page.evaluate(() => FUNERGY_STATUS.auto.n);
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(n => FUNERGY_STATUS.auto.n > n && !FUNERGY_STATUS.auto.running, n0, { timeout: 60000, polling: 200 }).catch(() => {});
  ok('E2 つながったら自動の同期が動き、ほかの端末の変更（purchases_NEW）を取り込む', await page.evaluate(() => !!_lsStoreGet('purchases_NEW')), await page.evaluate(() => FUNERGY_STATUS.auto.n));
  ok('E3 同期 ✅ に戻る', await waitSeg(page, 'sync', 'ok', 30000), await seg(page, 'sync'));

  /* F. 取り込めない → 同期 ⚠ → 2 回続けば 診断 ⚠ */
  await ctl('/__wfail?path=/rest/v1/app_settings&n=0');
  await page.evaluate(() => { window.__origFetch = window.__origFetch || window.fetch; window.fetch = function (u, o) { if (String(u).indexOf('/rest/v1/app_settings') >= 0) return Promise.resolve(new Response('{}', { status: 503 })); return window.__origFetch.apply(this, arguments); }; });
  await page.evaluate(() => FUNERGY_STATUS.autoSync('test', { manual: true }));
  ok('F1 取り込めないと「同期 ⚠ 設定」', (await seg(page, 'sync')).st === 'warn' && /設定/.test((await seg(page, 'sync')).text), await seg(page, 'sync'));
  await page.evaluate(() => FUNERGY_STATUS.autoSync('test', { manual: true }));
  ok('F2 続けて取り込めないと「診断 ⚠」', (await seg(page, 'diag')).st === 'warn', await seg(page, 'diag'));
  await page.evaluate(() => { window.fetch = window.__origFetch; });
  await page.evaluate(() => FUNERGY_STATUS.autoSync('test', { manual: true }));
  ok('F3 取り込めたら 同期・診断 とも ✅', (await seg(page, 'sync')).st === 'ok' && (await seg(page, 'diag')).st === 'ok', await segs(page));
  await page.evaluate(() => go('diag_center')); await sleep(500);
  ok('F4 記録に「取り込めなかった：設定」', /取り込めなかった：設定/.test(await page.evaluate(() => document.getElementById('main-content').textContent)));

  /* G. 入力中は自動の同期を待つ */
  await page.evaluate(() => { openModal('<div class="modal-title">t</div><input id="stx">'); });
  const busy = await page.evaluate(() => FUNERGY_STATUS.autoSync('timer'));
  ok('G1 モーダルを開いているあいだは自動の同期をしない（あとでやり直す）', busy === 'busy', busy);
  await page.evaluate(() => closeModalDirect());
  ok('A99 pageerror 0（GM・PC）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

/* ============ H. スマホ（390px）・G3（SL） ============ */
{
  await ctl('/__reset');
  const { ctx, page, errors } = await open('sl', 390);
  await login(page, 'sl');
  const st = await segs(page);
  const obH = await page.evaluate(() => ({ ob: _outboxMine().map(x => ({ k: x.key, a: x.attempts, e: x.lastErr, busy: _pushBusy(x.key) })), extra: FUNERGY_STATUS.extraPending(), st: FUNERGY_UX.saveState() }));
  ok('H1 スマホでも右上に 3 つ（is-ok）', !st.hidden && st.segs.length === 3 && st.segs.every(x => x.st === 'ok'), { st, obH });
  const lay = await page.evaluate(() => {
    const b = document.getElementById('ux-save').getBoundingClientRect(), tb = document.querySelector('.topbar').getBoundingClientRect();
    const lo = [...document.querySelectorAll('.topbar-right .topbar-icon-btn')].pop().getBoundingClientRect();
    return { right: b.right, w: b.width, lo: lo.right, sw: document.documentElement.scrollWidth, tb: tb.width };
  });
  ok('H2 スマホで右上がはみ出さない（ログアウトのボタンまで見える・横スクロールなし）', lay.lo <= 390 && lay.right <= 390 && lay.sw <= 390, lay);
  await page.click('#ux-save'); await sleep(300);
  const pt = await popText(page);
  /* 独立レビュー P2-4：店長（SL）・AM は前の同期センターの復旧の道具だけ（画面ごとの診断・クラウドの書き直しは無い） */
  ok('H3 店長には「詳しく」があり、押すと「診断と記録」（復旧の道具だけ）', /保存/.test(pt) && /詳しく/.test(pt), pt.slice(0, 120));
  await page.locator('#ux-save-pop [data-st-act="more"]').click(); await sleep(900);
  const sl = await page.evaluate(() => ({ page: curPage, nav: navPageAllowed('diag_center'), text: document.getElementById('main-content').textContent, tip: !!document.querySelector('#main-content [onclick*="openTipDateDebug"]'), push: !!document.querySelector('#main-content [onclick*="runSupaPushAllConfirm"]') }));
  ok('H4 店長の「診断と記録」：この端末の状態と前の同期センターの道具（前と同じ：クラウドの取り込み・アップロードを含む）・画面ごとの診断は無い', sl.page === 'diag_center' && sl.nav && /この端末の状態/.test(sl.text) && /Toast の取り直し/.test(sl.text) && !sl.tip && sl.push, { page: sl.page, nav: sl.nav, tip: sl.tip, push: sl.push });
  const slw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('H4b 店長の「診断と記録」：390px で横スクロールなし', slw <= 390, slw);
  await page.mouse.click(200, 600);
  await page.evaluate(() => go('shift_admin')); await sleep(800);
  ok('H5 シフト作成に「最新に更新」「診断」「保存状況チェック」が無い', await page.evaluate(() => !/最新に更新|保存状況チェック/.test(document.getElementById('main-content').textContent) && !document.querySelector('#main-content [onclick*="availDiag"]')));
  await page.evaluate(() => go('mypage')); await sleep(800);
  ok('H6 マイページのスキルの「診断」ボタンが無い', await page.evaluate(() => !document.querySelector('#main-content [onclick*="openMySkillDiag"]')));
  ok('H99 pageerror 0（SL・390px）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

/* ============ I. 英語 ============ */
{
  await ctl('/__reset');
  const { ctx, page, errors } = await open('en', 1280, 'en');
  await page.evaluate(() => { try { setLang('en'); } catch (e) { curLang = 'en'; } });
  await login(page, 'gm');
  await page.evaluate(() => { try { setLang('en'); } catch (e) { } FUNERGY_UX.paintSave(); });
  const st = await segs(page);
  ok('I1 英語：Save・Sync・Check', /Save/.test(st.segs[0] && st.segs[0].text) && /Sync/.test(st.segs[1] && st.segs[1].text) && /Check/.test(st.segs[2] && st.segs[2].text), st.segs.map(x => x.text));
  ok('I99 pageerror 0（英語）', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

const ng = results.filter(r => !r.ok);
console.log('\n' + (results.length - ng.length) + '/' + results.length + ' OK');
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(ng.length ? 1 : 0);
