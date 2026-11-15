// v1164：経費の申請の 6 経路（マイページ・レシート管理 × ガソリン代・建て替え経費・事前経費）を、本物のブラウザ（Chrome）と本物の work-requests（SQL・handler）で通す。
// G2 が出す → 読み込み直して本人の履歴 → 別の GM のログインで承認 → 別の経理のログインで確認（・精算）。G1 は出せない・G3〜G6 は出せる・G2 は承認できない。
// 合成データだけ（作りものの人・店・金額）。本番・支払にはつながない。
// 使い方：VENDOR_DIR=… CERT_DIR=… node tests/e2e-wr/expense-paths.mjs   （直す前：WR_FIX=0 APP_DIR=<v1162 の index.html のあるフォルダ>）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { startWorld } from './world.mjs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const W = await startWorld({ vendor: process.env.VENDOR_DIR, cert: process.env.CERT_DIR, appDir: process.env.APP_DIR || undefined, confirmPeople: process.env.CONFIRM !== '0' });
const BEFORE = process.env.WR_FIX === '0';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

async function device(width = 390) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const toasts = [], errors = [];
  await page.exposeFunction('__toast', (m, k) => toasts.push([k, String(m).slice(0, 200)]));
  page.on('dialog', d => { toasts.push(['dialog', d.message().slice(0, 200)]); d.accept(); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  return { ctx, page, toasts, errors };
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
const formText = page => page.evaluate(() => { const f = document.getElementById('wr-form'); return f ? f.innerText : null; });
async function fill(page, kind, amt) {
  await page.evaluate(([kind, amt]) => {
    const set = (id, v) => { const e = document.getElementById('wrf-' + id); if (e) e.value = v; };
    if (kind === 'mileage') { set('origin', 'Store A'); set('destination', 'Costco'); set('miles', String(amt)); }
    if (kind === 'reimburse') { set('vendor', 'Costco'); set('amount', String(amt)); }
    if (kind === 'expense_pre') { set('purpose', 'Team dinner'); set('total', String(amt)); }
  }, [kind, amt]);
}
// 入口のボタンを押す → 用紙 → 送る。返す：{ entry, form, code, status, err }
async function viaCard(D, where, kind, amt) {
  const { page } = D;
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  await page.evaluate(p => go(p), where); await sleep(900);
  await page.waitForFunction(() => { const c = document.getElementById('wr-myexp'); return c && !/読み込み中/.test(c.innerText); }, null, { timeout: 15000 }).catch(() => {});
  const entry = await page.evaluate(k => { const c = document.getElementById('wr-myexp'); const b = c && c.style.display !== 'none' && c.querySelector('[data-wr-exp="' + k + '"]'); return !!b; }, kind);
  if (!entry) return { entry: false };
  await page.evaluate(k => document.querySelector('#wr-myexp [data-wr-exp="' + k + '"]').click(), kind);
  await page.waitForFunction(() => { const f = document.getElementById('wr-form'); return f && /申請する|Submit/.test(f.innerText); }, null, { timeout: 15000 }).catch(() => {});
  const ft = await formText(page);
  if (!ft) return { entry: true, form: false };
  const picked = await page.evaluate(k => !!Array.from(document.querySelectorAll('#wr-form button.btn-primary')).find(b => (b.getAttribute('onclick') || '') === "wrPick('" + k + "')"), kind);
  await fill(page, kind, amt);
  return send(D, { entry: true, form: true, picked });
}
async function send(D, r) {
  const { page } = D; const n0 = W.calls.length, t0 = D.toasts.length;
  await page.evaluate(() => wrSend());
  await page.waitForFunction(() => !!document.getElementById('wr-sent-code') || !document.getElementById('wr-form') || /送っています|Sending/.test(document.getElementById('wr-form').innerText) === false, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  const sub = W.calls.slice(n0).filter(x => x.action === 'submit');
  const code = await page.evaluate(() => { const e = document.getElementById('wr-sent-code'); return e ? e.textContent : null; });
  const st = await page.evaluate(() => { const e = document.getElementById('wr-sent-st'); return e ? e.textContent : null; });
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  return Object.assign(r, { code, shown: st, http: sub.map(x => x.status).join(','), err: (sub.find(x => x.err) || {}).err || D.toasts.slice(t0).filter(x => x[0] === 'error').map(x => x[1])[0] });
}
const row = async code => (await W.q(`select id, code, kind, status, requester_name, store_id, amount_cents, payload from public.wr_requests where code = $1`, [code]))[0];

// ---------------------------------------------------------------- G2：6 経路
const G2 = await device(390);
await login(G2, 'F01', 'Lee Two');
ok('G2 は PIN でログインしている（役割 sl・本当の役割 g2）', await G2.page.evaluate(() => curRealRole === 'g2' && !!window._hwSession), await G2.page.evaluate(() => ({ role: curRole, real: curRealRole })));
const PATHS = [['mypage', 'mileage', 12.5], ['mypage', 'reimburse', 80], ['mypage', 'expense_pre', 100], ['invoice', 'mileage', 7], ['invoice', 'reimburse', 45.5], ['invoice', 'expense_pre', 250]];
const sent = [];
for (const [where, kind, amt] of PATHS) {
  const r = await viaCard(G2, where, kind, amt);
  const db = r.code ? await row(r.code) : null;
  sent.push({ where, kind, amt, ...r, db });
  ok(`G2 ${where}×${kind}：入口 → 用紙 → 送れた（番号・GM 承認待ち）`, r.entry && r.form && r.code && db && db.kind === kind && db.status === 'pending' && db.requester_name === 'Lee Two' && db.store_id === 'F01' && /GM/.test(r.shown || ''),
    { entry: r.entry, form: r.form, code: r.code, shown: r.shown, http: r.http, err: r.err, status: db && db.status });
}
const pre = sent.find(x => x.kind === 'expense_pre' && x.db);
ok('事前経費は予定額だけで出せる（領収書・実費なし）', pre && pre.db.amount_cents === 10000 && !pre.db.payload.receipt, pre && pre.db && { cents: pre.db.amount_cents });
// 前の画面の「建て替え経費」の用紙（開いていた）で「申請する」：入れた中身を写して新しい用紙へ（前は「移りました」と出して捨てた）
await G2.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } go('invoice'); });
await sleep(800);
await G2.page.evaluate(() => {
  openModal('<div id="old-rb"><select id="invoice-store"><option value="F01" selected>F01</option></select><input id="inv-payer" value="Lee Two"><input id="inv-reimburse-amount" value="33.25"><input id="inv-vendor" value="Safeway"><input id="inv-purpose-memo" value="ice"></div>');
  saveReimbursement();
});
await G2.page.waitForFunction(() => { const f = document.getElementById('wr-form'); return f && /申請する|Submit/.test(f.innerText); }, null, { timeout: 15000 }).catch(() => {});
const carried = await G2.page.evaluate(() => ({ amount: (document.getElementById('wrf-amount') || {}).value, vendor: (document.getElementById('wrf-vendor') || {}).value, payer: (document.getElementById('wrf-payer') || {}).value, note: /写しました|copied/.test((document.getElementById('wr-form') || {}).innerText || '') }));
ok('前の画面の建て替えの用紙で押したら、入れた中身（金額・支払先・支払った人）が新しい用紙に写る', carried.amount === '33.25' && carried.vendor === 'Safeway' && carried.payer === 'Lee Two' && carried.note, carried);
const rc = await send(G2, { entry: true, form: true });
ok('写した用紙をそのまま送れる', rc.code && (await row(rc.code)).amount_cents === 3325, { code: rc.code, err: rc.err });
// レシート管理の登録画面で種別「建て替え経費」を選ぶ → 新しい用紙（前の用紙に入れさせない）
await G2.page.evaluate(() => { invReceiptAdd(); }); await sleep(500);
await G2.page.evaluate(() => setInvDocType('Reimburse'));
await G2.page.waitForFunction(() => { const f = document.getElementById('wr-form'); return f && /申請する|Submit/.test(f.innerText); }, null, { timeout: 15000 }).catch(() => {});
ok('レシート管理の登録で種別「建て替え経費」を選ぶと、新しい用紙（建て替え経費）が開く', await G2.page.evaluate(() => !!document.getElementById('wrf-amount') && !document.getElementById('inv-reimburse-amount')));
await G2.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });

// 読み込み直したあと：本人の履歴（カード・ワークセンターの自分の申請）
await login(G2, 'F01', 'Lee Two');
await G2.page.evaluate(() => go('mypage')); await sleep(1500);
await G2.page.waitForFunction(() => { const c = document.getElementById('wr-myexp'); return c && c.querySelectorAll('[data-wr-mine]').length > 0; }, null, { timeout: 15000 }).catch(() => {});
const cardCodes = await G2.page.evaluate(() => Array.from(document.querySelectorAll('#wr-myexp [data-wr-mine]')).map(e => e.getAttribute('data-wr-mine')));
const allCodes = sent.filter(x => x.code).map(x => x.code).concat(rc.code ? [rc.code] : []);
ok('読み込み直したあと、マイページの自分の申請に新しい 5 件が出る', cardCodes.length === 5 && cardCodes.every(c => allCodes.includes(c)), cardCodes);
await G2.page.evaluate(() => wrOpenMine()); await sleep(2500);
const mine = await G2.page.evaluate(() => document.getElementById('main-content') ? document.getElementById('main-content').innerText : document.body.innerText);
ok('ワークセンターの「自分の申請」に 7 件ぜんぶ（番号）', allCodes.length === 7 && allCodes.every(c => mine.includes(c)), allCodes.filter(c => !mine.includes(c)));

// ---------------------------------------------------------------- 前の画面に残った申請（古い版の端末が前の形で保存し、ワークセンターに出ていなかった）
const oldId = 'rb' + (Date.now() - 3600e3);
await W.q(`insert into public.app_state(key, value) values ('reimbursements', $1::jsonb) on conflict (key) do update set value = excluded.value`,
  [JSON.stringify([{ id: oldId, payer: 'Lee Two', byUser: 'Lee Two', storeId: 'F01', amount: 21.5, vendor: 'Old shop', purpose: 'その他', date: new Date().toISOString().slice(0, 10), status: '申請中', payStatus: '未払い' }])]);
// ---------------------------------------------------------------- GM（別のログイン）：承認
const GM = await device(1280);
await login(GM, 'OFFICE', 'Gabe Gm');
await GM.page.evaluate(() => { try { workTab = 'wr'; } catch (e) { } go('tasks'); }); await sleep(2500);
const repaired = (await W.q(`select code, status, requester_name, amount_cents from public.wr_requests where legacy_ref = $1`, ['RB:' + oldId]))[0];
ok('前の画面に残っていた建て替え（本人に出し直しを求めない）が、GM のログインでワークセンターに写る（同じ中身・承認待ち）', repaired && repaired.status === 'pending' && repaired.amount_cents === 2150 && repaired.requester_name === 'Lee Two',
  { row: repaired, toast: (GM.toasts.find(x => /残っていた/.test(x[1])) || [])[1] });
for (const code of allCodes) {
  const r = await row(code);
  await GM.page.evaluate(id => wrOpen(id), r.id);
  await GM.page.waitForFunction(() => !!document.querySelector('[onclick="wrAsk(\'approve\')"]'), null, { timeout: 15000 }).catch(() => {});
  const can = await GM.page.evaluate(() => !!document.querySelector('[onclick="wrAsk(\'approve\')"]'));
  if (can) { await GM.page.evaluate(() => wrAsk('approve')); await sleep(1500); }
  await GM.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  const a = await row(code);
  ok(`GM が承認：${code}（${r.kind}）→ 経理の確認待ち`, can && a.status === 'approved', a.status);
}
// ---------------------------------------------------------------- 経理（別のログイン）：確認（・精算）
const AC = await device(1280);
await login(AC, 'OFFICE', 'Ann Acct');
await AC.page.evaluate(() => { try { workTab = 'wr'; } catch (e) { } go('tasks'); }); await sleep(2500);
const toPay = [];
for (const code of allCodes) {
  const r = await row(code);
  await AC.page.evaluate(id => wrOpen(id), r.id);
  await AC.page.waitForFunction(() => !!document.querySelector('[onclick="wrAsk(\'check\')"]'), null, { timeout: 15000 }).catch(() => {});
  const can = await AC.page.evaluate(() => !!document.querySelector('[onclick="wrAsk(\'check\')"]'));
  if (can) { await AC.page.evaluate(() => wrAsk('check')); await sleep(1500); }
  await AC.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  const a = await row(code);
  const want = r.kind === 'expense_pre' ? 'done' : 'checked';
  ok(`経理が確認：${code}（${r.kind}）→ ${want === 'done' ? '完了（事前承認済み・支払には入れない）' : '支払・精算待ち'}`, can && a.status === want, a.status);
  if (want === 'checked') toPay.push(code);
}
// 建て替え 1 件だけ精算（ほかはそれぞれの待ちのまま）
const payCode = rc.code;   // 本人のマイページ（新しい 5 件）に出る、いちばん新しい建て替え
{ const r = await row(payCode);
  await AC.page.evaluate(id => wrOpen(id), r.id);
  await AC.page.waitForFunction(() => !!document.querySelector('[onclick="wrAsk(\'pay\')"]'), null, { timeout: 15000 }).catch(() => {});
  await AC.page.evaluate(() => wrAsk('pay')); await sleep(400); await AC.page.evaluate(() => wrAskGo()); await sleep(1500);
  await AC.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  const st = Object.fromEntries((await W.q(`select code, status from public.wr_requests where code = any($1)`, [allCodes])).map(x => [x.code, x.status]));
  ok('経理が建て替え 1 件だけ精算 → それだけ精算済み・ほかはそれぞれの待ち', st[payCode] === 'paid' && Object.entries(st).every(([c, s]) => c === payCode || s === 'checked' || s === 'done'), st); }
// 本人の画面にも進み具合（別の端末）
await G2.page.evaluate(() => { wrRefresh(); go('mypage'); }); await sleep(2500);
await G2.page.waitForFunction(() => /精算済み/.test((document.getElementById('wr-myexp') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
const cardTxt = await G2.page.evaluate(() => (document.getElementById('wr-myexp') || {}).innerText || '');
ok('本人のマイページに進み具合（建て替えは精算済み・ほかは支払・精算待ち・事前経費は事前承認済み）が出る', /精算済み/.test(cardTxt) && /支払・精算待ち/.test(cardTxt) && /事前承認済み/.test(cardTxt), cardTxt.slice(0, 400));

// ---------------------------------------------------------------- 権限：G2 は承認できない・G1 は出せない・G3〜G6 は出せる
const g3req = await W.db.rpc('wr_submit', { emp_id: 'e12', name: 'Sam Three', kind: 'reimburse', store_id: 'F01', client_key: 'k-g3-0000001', payload: { date: new Date().toISOString().slice(0, 10), payer: 'Sam Three', vendor: 'Shop', purpose: 'その他', amount_cents: 1000 } });
const g2act = await G2.page.evaluate(async id => { try { await wrAPI({ action: 'act', id, op: 'approve', expect_rev: 1, client_key: 'k-g2-approve-1' }); return 'ok'; } catch (e) { return e.code || String(e); } }, g3req.id);
ok('G2 はほかの人の申請を承認できない（サーバーが断る）', g2act !== 'ok', g2act);
const G1 = await device(390);
await login(G1, 'F01', 'Cam Crew');
await G1.page.evaluate(() => go('mypage')); await sleep(2500);
const g1 = await G1.page.evaluate(() => { const c = document.getElementById('wr-myexp'); return { card: !!c && c.style.display !== 'none' && !!c.querySelector('[data-wr-exp]'), kinds: typeof wrExpKinds === 'function' ? wrExpKinds() : null }; });
const g1srv = await G1.page.evaluate(async () => { try { await wrAPI({ action: 'submit', kind: 'reimburse', store_id: 'F01', client_key: 'k-g1-submit-01', payload: { date: '2026-11-14', payer: 'Cam Crew', vendor: 'X', purpose: 'その他', amount_cents: 500 } }); return 'ok'; } catch (e) { return e.code || String(e); } });
ok('G1：入口が出ない・サーバーも断る', !g1.card && Array.isArray(g1.kinds) && g1.kinds.length === 0 && g1srv === 'forbidden', { ...g1, server: g1srv });
for (const [store, name, g] of [['F01', 'Sam Three', 'G3'], ['F01', 'Mia Four', 'G4'], ['OFFICE', 'Ami Area', 'G5'], ['OFFICE', 'Gabe Gm', 'G6']]) {
  const D = await device(390); await login(D, store, name);
  const r = await viaCard(D, 'mypage', 'expense_pre', 60);
  const kinds = await D.page.evaluate(() => wrExpKinds());
  ok(`${g}（${name}）：3 種の入口があり、事前経費をマイページから出せる`, kinds && kinds.length === 3 && r.code && (await row(r.code)).status === 'pending', { kinds, code: r.code, err: r.err });
  await D.ctx.close();
}
const errs = [G2, GM, AC, G1].flatMap(d => d.errors);
ok('画面のエラー（pageerror）が無い', errs.length === 0, errs.slice(0, 5));
console.log('\n| 入口 | 種類 | 申請番号 | 送ったあと | 最後の状態 |');
for (const s of sent) console.log(`| ${s.where === 'mypage' ? 'マイページ' : 'レシート管理'} | ${s.kind} | ${s.code || '—'} | ${s.shown || s.err || (s.entry ? '' : '入口なし')} | ${s.code ? (await row(s.code)).status : '—'} |`);
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} OK`);
await browser.close(); W.close();
process.exit(fails ? 1 : 0);
