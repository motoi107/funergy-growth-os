// v1165（UI案77）：申請/承認を本物のブラウザ（Chrome）と本物の work-requests（SQL・handler）で通す。合成データだけ（作りものの人・店・金額）。本番・支払にはつながない。
// G2 が出す（事前経費 $100・建て替え $120・建て替え $80）→ GM（PC）は「申請/承認」1 つ・一覧の列・明細の［選んで次へ］で 3 件を選んでまとめて承認
// → 経理（スマホ 390px）は 確認待ち／確認済み・処理待ち／処理済み（今月）・ボタンは画面の下・事前経費を確認 → 実費 $120 を事前経費に結ぶ（予定を超える → GM に戻る）
// → GM がもう一度承認 → 経理が確認・精算 → 処理済み（今月）に出る。
// 使い方：VENDOR_DIR=… CERT_DIR=… node tests/e2e-wr/approve-v1165.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { startWorld } from './world.mjs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const W = await startWorld({ vendor: process.env.VENDOR_DIR, cert: process.env.CERT_DIR, appPort: 8091 });
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

async function device(width) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const toasts = [], errors = [], dialogs = [];
  await page.exposeFunction('__toast', (m, k) => toasts.push([k, String(m).slice(0, 200)]));
  page.on('dialog', d => { dialogs.push(d.message().slice(0, 300)); d.accept(); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  return { ctx, page, toasts, errors, dialogs };
}
async function login(D, store, name) {
  const { page } = D;
  await page.goto(W.url);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await page.evaluate(s => loginPickLocation(s), store); await sleep(400);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false, null, { timeout: 120000 }).catch(() => {});
  await sleep(1500);
  await page.evaluate(() => { const o = window.showToast; window.showToast = function (m, k) { try { window.__toast(m, k); } catch (e) { } return o && o.apply(this, arguments); }; });
}
async function submit(D, kind, amt) {
  const { page } = D;
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } go('mypage'); }); await sleep(900);
  await page.waitForFunction(k => !!document.querySelector('#wr-myexp [data-wr-exp="' + k + '"]'), kind, { timeout: 15000 }).catch(() => {});
  await page.evaluate(k => document.querySelector('#wr-myexp [data-wr-exp="' + k + '"]').click(), kind);
  await page.waitForFunction(() => { const f = document.getElementById('wr-form'); return f && /申請する|Submit/.test(f.innerText); }, null, { timeout: 15000 });
  await page.evaluate(([kind, amt]) => {
    const set = (id, v) => { const e = document.getElementById('wrf-' + id); if (e) e.value = v; };
    if (kind === 'reimburse') { set('vendor', 'Costco ' + amt); set('amount', String(amt)); }
    if (kind === 'expense_pre') { set('purpose', 'Team dinner'); set('total', String(amt)); }
  }, [kind, amt]);
  await page.evaluate(() => wrSend());
  await page.waitForFunction(() => !!document.getElementById('wr-sent-code'), null, { timeout: 15000 }).catch(() => {});
  const code = await page.evaluate(() => { const e = document.getElementById('wr-sent-code'); return e ? e.textContent : null; });
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  return code;
}
const row = async code => (await W.q(`select id, code, kind, status, amount_cents, to_jsonb(r)->>'pre_id' as pre_id from public.wr_requests r where code = $1`, [code]))[0];
const openWr = async (D, id, waitFor) => {
  await D.page.evaluate(i => wrOpen(i), id);
  await D.page.waitForFunction(w => { const d = document.getElementById('wr-detail'); return d && !/読み込み中/.test(d.innerText) && (!w || d.innerHTML.includes(w)); }, waitFor || '', { timeout: 15000 }).catch(() => {});
  return D.page.evaluate(() => document.getElementById('wr-detail').innerHTML);
};

// ---------------------------------------------------------------- G2：出す
const G2 = await device(390);
await login(G2, 'F01', 'Lee Two');
const exCode = await submit(G2, 'expense_pre', 100), rb120 = await submit(G2, 'reimburse', 120), rb80 = await submit(G2, 'reimburse', 80);
ok('G2 が事前経費 $100・建て替え $120・建て替え $80 を出せた', exCode && rb120 && rb80, [exCode, rb120, rb80]);

// ---------------------------------------------------------------- GM（PC）：申請/承認・一覧の列・選んで次へ・まとめて承認
const GM = await device(1280);
await login(GM, 'OFFICE', 'Gabe Gm');
await GM.page.evaluate(() => { workTab = 'wr'; go('tasks'); }); await sleep(2500);
await GM.page.waitForFunction(() => /要対応/.test(document.body.innerText) && document.querySelectorAll('table.tbl thead th').length > 5, null, { timeout: 20000 }).catch(() => {});
const tabs = await GM.page.evaluate(() => Array.from(document.querySelectorAll('.phase-tab')).map(e => e.innerText.trim().replace(/\s+\d+$/, '')));
ok('ワークセンターのタブは「申請/承認」1 つ（「承認」タブは無い）', tabs.some(x => /^申請\/承認/.test(x)) && !tabs.some(x => /^承認\s*$|^承認\s*\d/.test(x)), tabs);
const heads = await GM.page.evaluate(() => Array.from(document.querySelectorAll('table.tbl thead th')).map(e => e.innerText.trim()));
ok('要対応の表の列：種別・申請した人・店舗・用途・対象日・月・金額（変更前後）・添付', ['種別', '申請した人', '店舗', '用途', '対象日・月', '金額（変更前後）', '添付'].every(h => heads.includes(h)), heads);
const order = await GM.page.evaluate(() => _wrState().lastTodo.slice());
let d = await openWr(GM, order[0], 'wrPickNext');
ok('一覧から開いた明細に［選択に戻る］［選んで次へ］［この 1 件を承認］', /選択に戻る/.test(d) && /選んで次へ/.test(d) && /この 1 件を承認/.test(d));
for (let i = 0; i < order.length; i++) {
  await GM.page.evaluate(id => wrPickNext(id), order[i]);
  await sleep(1200);
}
const sel = await GM.page.evaluate(() => Object.keys(_wrState().sel).length);
ok('［選んで次へ］で 3 件を順に選び、最後は一覧に戻る', sel === 3 && GM.toasts.some(([k, m]) => k === 'success' && /選択 3 件/.test(m)), { sel, toasts: GM.toasts.slice(-2) });
await GM.page.evaluate(() => wrBulkAsk()); await sleep(600);
await GM.page.evaluate(() => wrBulkGo()); await sleep(3000);
const afterBulk = await Promise.all([exCode, rb120, rb80].map(row));
ok('まとめて承認 → 3 件とも承認済み（経理の確認待ち）', afterBulk.every(r => r.status === 'approved'), afterBulk.map(r => r.status));

// ---------------------------------------------------------------- 経理（スマホ 390px）：経理レビュー › 申請
const AC = await device(390);
await login(AC, 'OFFICE', 'Ann Acct');
await AC.page.evaluate(() => { window._arTab = 'req'; go('acct_review'); }); await sleep(2500);
await AC.page.waitForFunction(() => /確認待ち/.test(document.body.innerText) && !/読み込み中/.test((document.getElementById('main-content') || document.body).innerText), null, { timeout: 20000 }).catch(() => {});
const acTabs = await AC.page.evaluate(() => Array.from(document.querySelectorAll('.phase-tab')).map(e => e.innerText.trim()));
ok('経理レビューは 確認待ち 3 ／ 確認済み・処理待ち 0 ／ 処理済み（今月）', acTabs.some(x => /^確認待ち\s*3$/.test(x)) && acTabs.some(x => /^確認済み・処理待ち\s*0$/.test(x)) && acTabs.some(x => /^処理済み（今月）/.test(x)), acTabs);
const ex = await row(exCode), r120 = await row(rb120);
await openWr(AC, ex.id, "wrAsk('check')");
await AC.page.evaluate(() => wrAsk('check')); await sleep(400); await AC.page.evaluate(() => { if (typeof wrAskGo === 'function' && document.getElementById('wr-note')) wrAskGo(); }); await sleep(1500);
ok('経理が事前経費を確認 → 事前承認済み（支払には入れない）', (await row(exCode)).status === 'done', (await row(exCode)).status);
await AC.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
d = await openWr(AC, r120.id, 'wrPreOpen');
const bar = await AC.page.evaluate(() => {
  const b = document.getElementById('wr-btns'); if (!b) return null;
  let sc = b.parentElement; while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  if (sc && sc !== document.body) sc.scrollTop = 0;
  const r = b.getBoundingClientRect(), btn = b.querySelector('button').getBoundingClientRect();
  return { pos: getComputedStyle(b).position, bottom: Math.round(r.bottom), vh: window.innerHeight, h: Math.round(btn.height), scrolls: !!sc && sc !== document.body };
});
ok('スマホ：明細のボタンは画面の下に固定（押せる高さ 44px）', bar && bar.pos === 'sticky' && bar.bottom <= bar.vh && bar.h >= 44, bar);
await AC.page.evaluate(() => wrPreOpen());
await AC.page.waitForFunction(c => (document.getElementById('wr-detail') || {}).innerHTML.includes(c), exCode, { timeout: 15000 }).catch(() => {});
d = await AC.page.evaluate(() => document.getElementById('wr-detail').innerHTML);
ok('実費 $120 の明細で、同じ人の事前経費 $100 が候補に出る（予定を超える印）', d.includes(exCode) && /予定を超える/.test(d));
await AC.page.evaluate(() => wrPreLink()); await sleep(2500);
const linked = await row(rb120);
ok('結ぶ前に「予定を超えています」と聞き、結ぶと GM の承認待ちに戻る', AC.dialogs.some(m => /超えています/.test(m)) && linked.status === 'pending' && linked.pre_id === ex.id, { dialogs: AC.dialogs, status: linked.status });
await AC.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });

// ---------------------------------------------------------------- GM：もう一度承認
await GM.page.evaluate(() => wrRefresh()); await sleep(2500);
d = await openWr(GM, r120.id, "wrAsk('approve')");
ok('GM の明細に「予定を超えています」と事前経費の番号', /予定を超えています/.test(d) && d.includes(exCode));
await GM.page.evaluate(() => wrAsk('approve')); await sleep(400); await GM.page.evaluate(() => { if (document.getElementById('wr-note')) wrAskGo(); }); await sleep(1500);
ok('GM がもう一度承認 → 経理の確認待ち', (await row(rb120)).status === 'approved', (await row(rb120)).status);
await GM.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });

// ---------------------------------------------------------------- 経理：確認・精算 → 処理済み（今月）
await AC.page.evaluate(() => wrAcctRefresh()); await sleep(2000);
let x = await row(rb120);
await openWr(AC, x.id, "wrAsk('check')");
await AC.page.evaluate(() => wrAsk('check')); await sleep(400); await AC.page.evaluate(() => { if (document.getElementById('wr-note')) wrAskGo(); }); await sleep(1500);
await AC.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
x = await row(rb120);
await openWr(AC, x.id, "wrAsk('pay')");
await AC.page.evaluate(() => wrAsk('pay')); await sleep(400); await AC.page.evaluate(() => wrAskGo()); await sleep(1500);
await AC.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
ok('経理が確認・精算（実費 $120 だけ）', (await row(rb120)).status === 'paid' && (await row(exCode)).status === 'done', [(await row(rb120)).status, (await row(exCode)).status]);
await AC.page.evaluate(() => { wrAcctRefresh(); wrAcctTab('done'); }); await sleep(2500);
const doneTxt = await AC.page.evaluate(() => (document.getElementById('main-content') || document.body).innerText);
ok('処理済み（今月）に精算した実費と確認した事前経費が出る', doneTxt.includes(rb120) && doneTxt.includes(exCode) && !doneTxt.includes(rb80), doneTxt.slice(0, 300));

const errs = [G2, GM, AC].flatMap(q => q.errors);
ok('画面のエラー（pageerror）が無い', errs.length === 0, errs.slice(0, 5));
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} OK`);
await browser.close(); W.close();
process.exit(fails ? 1 : 0);
