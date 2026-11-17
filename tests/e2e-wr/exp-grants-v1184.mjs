// v1184（Moto さん 11/16 の依頼 3）：経費の申請の権限を、本物のブラウザ（Chrome）と本物の work-requests（SQL・handler・PGlite）で確かめる。合成データだけ。
//   ・本部所属の事務Crew（従業員マスターだけ・PIN）は、GM・CEO が「事務Crew と確かめる」まで出せない（確かめ待ちの案内）。Codex #182 の P1
//     確かめたら、マイページからガソリン代・立替経費を出せる（店舗＝本部）。事前経費は出せない。承認はできない
//   ・G1 の従業員マスター（役割・肩書き）を事務Crew に書き換えても（公開の鍵で書ける）、確かめるまで出せない
//   ・G1（クルー）は初期値で出せない。GM が「経費の申請の権限」で ON にすると出せる（変更の記録）。CEO も変えられる。経理・AM は画面が出ない
//   ・GM が OFF にすると、開いたままの用紙からの送信もサーバーが断る（no_exp_right）。出せるものを読み直す
//   ・二度押し（同じ鍵）でも 1 件だけ。種類を書き換えた直接の送信はサーバーが断る
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert node tests/e2e-wr/exp-grants-v1184.mjs
process.env.WR_V1184 = '1';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const { startWorld } = await import('./world.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const W = await startWorld({ vendor: process.env.VENDOR_DIR, cert: process.env.CERT_DIR, appDir: process.env.APP_DIR || undefined });
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); };

async function device(width = 390) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const toasts = [], errors = [];
  await page.exposeFunction('__toast', (m, k) => toasts.push([k, String(m).slice(0, 240)]));
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
/* マイページの「経費の申請」のカード：出せる種類のボタン */
async function cardKinds(D) {
  const { page } = D;
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } go('mypage'); }); await sleep(900);
  await page.waitForFunction(() => { const c = document.getElementById('wr-myexp'); return !c || !/読み込み中/.test(c.innerText); }, null, { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => { const c = document.getElementById('wr-myexp'); if (!c || c.style.display === 'none') return []; return [...c.querySelectorAll('[data-wr-exp]')].map(b => b.getAttribute('data-wr-exp')); });
}
async function openForm(D, kind) {
  const { page } = D;
  await page.evaluate(k => document.querySelector('#wr-myexp [data-wr-exp="' + k + '"]').click(), kind);
  await page.waitForFunction(() => { const f = document.getElementById('wr-form'); return f && /申請する|Submit/.test(f.innerText); }, null, { timeout: 15000 });
  return page.evaluate(() => ({ stores: [...document.querySelectorAll('#wrf-store option')].map(o => o.value), store: (document.getElementById('wrf-store') || {}).value }));
}
async function fill(page, kind, amt, store) {
  await page.evaluate(([kind, amt, store]) => {
    const set = (id, v) => { const e = document.getElementById('wrf-' + id); if (e) { e.value = v; e.dispatchEvent(new Event('change')); } };
    if (store) set('store', store);
    if (kind === 'mileage') { set('origin', 'Office'); set('destination', 'Bank'); set('miles', String(amt)); }
    if (kind === 'reimburse') { set('vendor', 'Office Depot'); set('amount', String(amt)); }
  }, [kind, amt, store]);
}
async function send(D, twice) {
  const { page } = D; const n0 = W.calls.length, t0 = D.toasts.length;
  await page.evaluate(tw => { wrSend(); if (tw) wrSend(); }, !!twice);
  await page.waitForFunction(() => !!document.getElementById('wr-sent-code') || !document.getElementById('wr-form'), null, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  const sub = W.calls.slice(n0).filter(x => x.action === 'submit');
  const code = await page.evaluate(() => { const e = document.getElementById('wr-sent-code'); return e ? e.textContent : null; });
  const st = await page.evaluate(() => { const e = document.getElementById('wr-sent-st'); return e ? e.textContent : null; });
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  return { code, shown: st, http: sub.map(x => x.status), err: (sub.find(x => x.err) || {}).err || null, toasts: D.toasts.slice(t0).map(x => x[1]) };
}
const rowsOf = async who => W.q(`select code, kind, status, store_id, requester_emp from public.wr_requests where requester_emp = $1 order by id`, [who]);

const apiAs = (D, body) => D.page.evaluate(async b => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/work-requests', { method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, b, { pin_session: window._hwSession })) });
  return { st: r.status, j: await r.json().catch(() => null) };
}, body);
const openGrants = async D => {
  await D.page.evaluate(() => wrExpGrants());
  await D.page.waitForFunction(() => document.querySelectorAll('#wr-grants [data-eg]').length > 0, null, { timeout: 15000 });
  return D.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#wr-grants [data-eg]')].map(r => [r.getAttribute('data-eg'), r.innerText.replace(/\s+/g, ' ').slice(0, 260)])));
};

// ---------------------------------------------------------------- 0. 事務Crew（従業員マスターだけ・PIN）は GM・CEO の確かめ待ち（Codex #182 の P1）
const OC = await device(390);
await login(OC, 'OFFICE', 'Oda Office');
const ocK0 = await cardKinds(OC);
const ocWait = await OC.page.evaluate(() => { const c = document.getElementById('wr-myexp'); return !!c && c.style.display !== 'none' && !!c.querySelector('[data-wr-crew-wait]') && /確かめると出せる/.test(c.innerText); });
ok('0-1 事務Crew（従業員マスターだけ・PIN）は確かめ待ち：ボタンは出ず「GM・CEO が確かめると出せる」の案内', ocK0.length === 0 && ocWait, { ocK0, ocWait });
const oc0 = await apiAs(OC, { action: 'submit', kind: 'mileage', store_id: '---', client_key: 'k-oc0-' + Date.now(), payload: { date: '2026-11-16', purpose: '銀行・郵便', origin: 'Office', destination: 'Bank', one_way_miles: 3 } });
ok('0-2 確かめ待ちのあいだは API を直接呼んでも断る（no_exp_right）', oc0.st === 403 && oc0.j && oc0.j.error === 'no_exp_right' && (await rowsOf('e15')).length === 0, oc0);
const GM = await device(1440);
await login(GM, 'OFFICE', 'Gabe Gm');
await GM.page.evaluate(() => { try { window._wcTab = 'wr'; } catch (e) { } go('workcenter'); }); await sleep(1500);
const L0 = await openGrants(GM);
ok('0-3 GM の一覧：Oda Office は「事務Crew（確かめ待ち）」で出せない・「事務Crew と確かめる」のボタン', /確かめ待ち/.test(L0.e15 || '') && /出せない/.test(L0.e15 || '') && !/出せる/.test(L0.e15 || '')
  && await GM.page.evaluate(() => !!document.querySelector('#wr-grants [data-eg="e15"] [data-eg-crew="on"]')), L0.e15);
await GM.page.evaluate(() => document.querySelector('#wr-grants [data-eg="e15"] [data-eg-crew="on"]').click());
await GM.page.waitForFunction(() => { const r = document.querySelector('#wr-grants [data-eg="e15"]'); return r && /確かめ済み/.test(r.innerText); }, null, { timeout: 15000 }).catch(() => {});
const g15c = await W.q(`select crew, mileage, reimburse, updated_emp from public.wr_exp_grants where emp_id = 'e15'`);
const log15c = await W.q(`select kind, before_eff, after_eff, by_emp from public.wr_exp_grant_log where emp_id = 'e15' order by id`);
const L1 = await GM.page.evaluate(() => (document.querySelector('#wr-grants [data-eg="e15"]') || {}).innerText || '');
ok('0-4 GM が「事務Crew と確かめる」：クラウドに確かめ（ON／OFF は初期値のまま）と変更の記録（ガソリン代・立替経費・確かめの 3 行）', g15c[0] && g15c[0].crew === true && g15c[0].mileage === null && g15c[0].reimburse === null && g15c[0].updated_emp === 'e2'
  && JSON.stringify(log15c.map(x => x.kind).sort()) === JSON.stringify(['crew', 'mileage', 'reimburse']) && log15c.every(x => x.after_eff === true && x.before_eff === false && x.by_emp === 'e2'), { g15c, log15c });
ok('0-5 GM の一覧も「確かめ済み」・出せる', /確かめ済み/.test(L1) && /出せる/.test(L1), L1.replace(/\s+/g, ' ').slice(0, 200));
await GM.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });

// ---------------------------------------------------------------- 1. 確かめた本部所属の事務Crew（PIN だけ）
await login(OC, 'OFFICE', 'Oda Office');   /* ログインし直す（カードの読み直しは 60 秒ごと） */
const ocKinds = await cardKinds(OC);
ok('1-1 事務Crew（本部所属・PIN）のマイページ：ガソリン代・立替経費のボタン（事前経費は出ない）', JSON.stringify(ocKinds.slice().sort()) === JSON.stringify(['mileage', 'reimburse']), ocKinds);
const f1 = await openForm(OC, 'reimburse');
ok('1-2 店舗に「本部」（---）を選べる・初めから本部', f1.stores.includes('---') && f1.store === '---', f1);
await fill(OC.page, 'reimburse', 42.5, '---');
const s1 = await send(OC, true);   // 二度押し
const r1 = await rowsOf('e15');
ok('1-3 本部で立替経費を出せた（番号・GM 承認待ち）', !!s1.code && /RB-/.test(s1.code) && /GM/.test(s1.shown || ''), s1);
ok('1-4 二度押しでも 1 件（店舗は本部・本人）', r1.length === 1 && r1[0].store_id === '---' && r1[0].kind === 'reimburse', r1);
await cardKinds(OC); await openForm(OC, 'mileage'); await fill(OC.page, 'mileage', 6.5, '---');
const s2 = await send(OC);
ok('1-5 ガソリン代も出せた', !!s2.code && /GS-/.test(s2.code), s2);
/* 事務Crew は承認できない（サーバー） */
const r1row = (await W.q(`select id, rev from public.wr_requests where code = $1`, [s1.code]))[0];
const apr = await OC.page.evaluate(async r => {
  const x = await fetch(SUPABASE_URL + '/functions/v1/work-requests', { method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'act', id: r.id, op: 'approve', expect_rev: r.rev, client_key: 'k-apr-' + Date.now(), pin_session: window._hwSession }) });
  return { st: x.status, j: await x.json().catch(() => null) };
}, r1row);
ok('1-6 事務Crew は承認できない（サーバーが断る）', apr.st === 403 && (await W.q(`select status from public.wr_requests where code = $1`, [s1.code]))[0].status === 'pending', apr);
/* 種類を書き換えた直接の送信（事前経費）はサーバーが断る */
const tam = await OC.page.evaluate(async () => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/work-requests', { method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit', kind: 'expense_pre', store_id: '---', client_key: 'k-tamper-' + Date.now(), payload: { date: '2026-11-16', purpose: 'Team lunch', total_cents: 1000 }, pin_session: window._hwSession }) });
  return { st: r.status, j: await r.json().catch(() => null) };
});
ok('1-7 種類を書き換えた直接の送信（事前経費）はサーバーが断る', tam.st === 403 && tam.j && tam.j.error === 'no_exp_right', tam);

// ---------------------------------------------------------------- 2. G1 は初期値で出せない
const G1 = await device(390);
await login(G1, 'F01', 'Cam Crew');
const g1At = Date.now();
const g1k0 = await cardKinds(G1);
ok('2-1 G1（クルー）は初期値で出せない（ボタンなし）', g1k0.length === 0, g1k0);
const g1api = await G1.page.evaluate(async () => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/work-requests', { method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit', kind: 'mileage', store_id: 'F01', client_key: 'k-g1-' + Date.now(), payload: { date: '2026-11-16', purpose: '銀行・郵便', origin: 'Store A', destination: 'Bank', one_way_miles: 3 }, pin_session: window._hwSession }) });
  return { st: r.status, j: await r.json().catch(() => null) };
});
ok('2-2 G1 が API を直接呼んでも断る（no_exp_right）', g1api.st === 403 && g1api.j && g1api.j.error === 'no_exp_right', g1api);
/* Codex #182 の P1：従業員マスター（役割・肩書き）は公開の鍵で書ける。G1 が自分を事務Crew に書き換えても、GM・CEO が確かめるまで出せない */
await W.q(`update public.employees set role = 'office_crew', title = 'Office Crew', data = data || '{"role":"office_crew","title":"Office Crew"}'::jsonb where id = 'e10'`);
const spoofWho = await apiAs(G1, { action: 'whoami' });
const spoofSub = await apiAs(G1, { action: 'submit', kind: 'mileage', store_id: 'F01', client_key: 'k-spoof-' + Date.now(), payload: { date: '2026-11-16', purpose: '銀行・郵便', origin: 'Store A', destination: 'Bank', one_way_miles: 3 } });
ok('2-3 G1 が従業員マスターで自分を事務Crew に書き換えても出せない（確かめ待ち・サーバーが断る）', spoofWho.j && Array.isArray(spoofWho.j.exp_kinds) && spoofWho.j.exp_kinds.length === 0 && spoofWho.j.exp_base === 'crew_wait'
  && spoofSub.st === 403 && spoofSub.j && spoofSub.j.error === 'no_exp_right' && (await rowsOf('e10')).length === 0, { who: spoofWho.j && { k: spoofWho.j.exp_kinds, b: spoofWho.j.exp_base }, sub: spoofSub });
const Lsp = await openGrants(GM);
ok('2-4 GM の一覧には「確かめ待ち」で出る（GM が気づける）', /確かめ待ち/.test(Lsp.e10 || '') && /出せない/.test(Lsp.e10 || ''), Lsp.e10);
await GM.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
await W.q(`update public.employees set role = 'crew', title = 'Crew', data = data || '{"role":"crew","title":"Crew"}'::jsonb where id = 'e10'`);   /* 元に戻す */

// ---------------------------------------------------------------- 3. GM が人ごとに決める（PC 1440）
await GM.page.evaluate(() => { try { window._wcTab = 'wr'; } catch (e) { } go('workcenter'); }); await sleep(1500);
const hasCard = async D => D.page.evaluate(async () => { try { if (typeof wrRefresh === 'function') await wrRefresh(); } catch (e) { } await new Promise(r => setTimeout(r, 1200)); try { document.getElementById('main-content').innerHTML = renderWrTab(); } catch (e) { return 'err:' + e.message; } return !!document.getElementById('wr-grants-card'); });
ok('3-1 GM：申請の画面に「経費の申請の権限」のカード', await hasCard(GM) === true);
await GM.page.evaluate(() => wrExpGrants());
await GM.page.waitForFunction(() => document.querySelectorAll('#wr-grants [data-eg]').length > 0, null, { timeout: 15000 });
const list = await GM.page.evaluate(() => [...document.querySelectorAll('#wr-grants [data-eg]')].map(r => ({ emp: r.getAttribute('data-eg'), t: r.innerText.replace(/\s+/g, ' ').slice(0, 140) })));
const L = Object.fromEntries(list.map(x => [x.emp, x.t]));
ok('3-2 一覧：確かめた事務Crew は初期値で ON・G1 は OFF（G2 以上・退職の人は出ない）', L.e15 && /出せる/.test(L.e15) && /確かめ済み/.test(L.e15) && L.e10 && /出せない/.test(L.e10) && !/確かめ/.test(L.e10) && !L.e11 && !L.e12 && !L.e2, list);
/* Cam Crew（e10）のガソリン代を ON にして保存 */
await GM.page.evaluate(() => { const s = document.querySelector('#wr-grants [data-eg="e10"] [data-eg-sel="mileage"]'); s.value = 'on'; s.dispatchEvent(new Event('change')); });
await sleep(300);
await GM.page.evaluate(() => document.querySelector('#wr-grants [data-eg="e10"] [data-eg-save]').click()); await sleep(1500);
const g10 = await W.q(`select mileage, reimburse, rev, updated_emp from public.wr_exp_grants where emp_id = 'e10'`);
const log10 = await W.q(`select kind, before_eff, after_eff, by_emp, by_role from public.wr_exp_grant_log where emp_id = 'e10' order by id`);
ok('3-3 保存はクラウドの表に入り、変更の記録（だれが・だれの・どれを・いつ）が残る', g10[0] && g10[0].mileage === true && g10[0].reimburse === null && log10.length === 1 && log10[0].kind === 'mileage' && log10[0].after_eff === true && log10[0].by_emp === 'e2', { g10, log10 });
const logShown = await GM.page.evaluate(() => document.querySelectorAll('#wr-grants [data-eg-log]').length);
ok('3-4 画面にも変更の記録が出る', logShown >= 1, logShown);
/* G1：ログインし直さなくても、前に読んでから 60 秒たってマイページを開くと出る（カードは whoami を読み直す） */
const wait1 = 62000 - (Date.now() - g1At); if (wait1 > 0) await sleep(wait1);
await cardKinds(G1);
await G1.page.waitForFunction(() => !!document.querySelector('#wr-myexp [data-wr-exp]'), null, { timeout: 15000 }).catch(() => {});
const g1k1 = await G1.page.evaluate(() => [...document.querySelectorAll('#wr-myexp [data-wr-exp]')].map(b => b.getAttribute('data-wr-exp')));
ok('3-5 G1：ログインし直さずに、ON にしたガソリン代だけ出る（立替経費は出ない）', JSON.stringify(g1k1) === JSON.stringify(['mileage']), g1k1);
await openForm(G1, 'mileage'); await fill(G1.page, 'mileage', 3.2);
const s3 = await send(G1);
ok('3-6 G1 がガソリン代を出せた', !!s3.code && /GS-/.test(s3.code), s3);

// ---------------------------------------------------------------- 4. 取り消し：開いたままの用紙からの送信も断る
await cardKinds(OC); await openForm(OC, 'reimburse'); await fill(OC.page, 'reimburse', 15, '---');   // 用紙を開いたまま
await GM.page.evaluate(() => { const s = document.querySelector('#wr-grants [data-eg="e15"] [data-eg-sel="reimburse"]'); s.value = 'off'; s.dispatchEvent(new Event('change')); });
await sleep(300); await GM.page.evaluate(() => document.querySelector('#wr-grants [data-eg="e15"] [data-eg-save]').click()); await sleep(1500);
const g15 = await W.q(`select mileage, reimburse from public.wr_exp_grants where emp_id = 'e15'`);
ok('4-1 事務Crew の立替経費を明示の OFF に（ガソリン代は初期値のまま）', g15[0] && g15[0].reimburse === false && g15[0].mileage === null, g15);
const n15 = (await rowsOf('e15')).length;
const s4 = await send(OC);
ok('4-2 開いたままの用紙から送ってもサーバーが断る（no_exp_right）・件数は増えない', !s4.code && s4.http.includes(403) && /no_exp_right/.test(s4.err || '') && (await rowsOf('e15')).length === n15, s4);
ok('4-3 画面は理由を出す', s4.toasts.some(t => /権限がありません/.test(t)), s4.toasts);
const ocK2 = await cardKinds(OC);
ok('4-4 読み直すと立替経費のボタンは出ない（ガソリン代は出る）', JSON.stringify(ocK2) === JSON.stringify(['mileage']), ocK2);
ok('4-5 前に出した申請は残る（消さない）', (await rowsOf('e15')).filter(r => r.kind === 'reimburse').length === 1);

// ---------------------------------------------------------------- 5. CEO は変えられる・経理と AM は画面が出ない
const CEO = await device(1440); await login(CEO, 'OFFICE', 'Cora Ceo');
await CEO.page.evaluate(() => go('workcenter')); await sleep(1200);
ok('5-1 CEO にもカードが出る', await hasCard(CEO) === true);
const AC = await device(1440); await login(AC, 'OFFICE', 'Ann Acct');
await AC.page.evaluate(() => go('workcenter')); await sleep(1200);
ok('5-2 経理にはカードが出ない', await hasCard(AC) === false);
const acApi = await AC.page.evaluate(async () => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/work-requests', { method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'exp_grant_save', target: 'e10', mileage: false, reimburse: null, expect_rev: 1, pin_session: window._hwSession }) });
  return { st: r.status, j: await r.json().catch(() => null) };
});
ok('5-3 経理が API を直接呼んでも変えられない', acApi.st === 403, acApi);
const AM = await device(390); await login(AM, 'OFFICE', 'Ami Area');
await AM.page.evaluate(() => go('workcenter')); await sleep(1200);
ok('5-4 AM にはカードが出ない', await hasCard(AM) === false);

// ---------------------------------------------------------------- 6. スマホの GM の画面（横のはみ出しなし）
const GMs = await device(390); await login(GMs, 'OFFICE', 'Gabe Gm');
await GMs.page.evaluate(() => go('workcenter')); await sleep(1200); await hasCard(GMs);
const doc0 = await GMs.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);   /* 開く前（タッチでない 390px の窓は上のナビで前から 4px 出る） */
await GMs.page.evaluate(() => wrExpGrants()); await GMs.page.waitForFunction(() => document.querySelectorAll('#wr-grants [data-eg]').length > 0, null, { timeout: 15000 });
const sx = await GMs.page.evaluate(() => { const vw = document.documentElement.clientWidth, m = document.getElementById('wr-grants'); const r = m ? m.getBoundingClientRect() : null;
  return { doc: document.documentElement.scrollWidth - vw, box: m ? m.scrollWidth - m.clientWidth : -1, right: r ? Math.round(r.right) : -1, vw }; });
ok('6-1 スマホ 390：権限の画面が横にはみ出さない（開く前より広げない・画面の中に収まる）', sx.doc <= doc0 && sx.box <= 1 && sx.right <= sx.vw, Object.assign({ doc0 }, sx));

/* 確かめを外すと（確かめの画面で OK）、事務Crew の初期値は OFF に戻る（人ごとに OFF にした立替経費はそのまま） */
await GM.page.evaluate(() => wrExpGrants()); await GM.page.waitForFunction(() => !!document.querySelector('#wr-grants [data-eg="e15"] [data-eg-crew="off"]'), null, { timeout: 15000 });
await GM.page.evaluate(() => document.querySelector('#wr-grants [data-eg="e15"] [data-eg-crew="off"]').click());
await GM.page.waitForFunction(() => { const r = document.querySelector('#wr-grants [data-eg="e15"]'); return r && /確かめ待ち/.test(r.innerText); }, null, { timeout: 15000 }).catch(() => {});
const g15off = await W.q(`select crew, mileage, reimburse from public.wr_exp_grants where emp_id = 'e15'`);
const offWho = await apiAs(OC, { action: 'whoami' });
ok('7-1 確かめを外す（確かめの画面）：初期値は OFF に戻る（人ごとの OFF はそのまま）・記録が残る', g15off[0] && g15off[0].crew === null && g15off[0].reimburse === false && offWho.j && offWho.j.exp_kinds.length === 0 && offWho.j.exp_base === 'crew_wait'
  && GM.toasts.some(x => x[0] === 'dialog' && /確かめを外しますか/.test(x[1])) && (await W.q(`select count(*)::int n from public.wr_exp_grant_log where emp_id = 'e15' and kind = 'crew'`))[0].n === 2, { g15off, k: offWho.j && offWho.j.exp_kinds });

const errs = [OC, G1, GM, CEO, AC, AM, GMs].flatMap(d => d.errors);
ok('pageerror 0', !errs.length, errs);
await browser.close(); W.close();
console.log(results.filter(r => r.ok).length + '/' + results.length);
process.exit(results.every(r => r.ok) ? 0 : 1);
