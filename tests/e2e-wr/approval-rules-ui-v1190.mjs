// v1190（UI案93）：承認・閲覧設定の画面・ルートの表示・例外・GM のまとめて承認を、本物のブラウザ（Chrome）と
//   本物の work-requests（SQL・handler・PGlite）で確かめる。合成データだけ（本番にはつながない）。
//   ・GM（PC 1440px）：設定 › 承認・閲覧設定に 16 種類（初めはどれも下書き）・横にはみ出さない
//     建て替え経費の既定に「段 2：CEO」を足す → 下書きに保存 → 有効にする（クラウドの表を確かめる）
//     試す：店と申請した人を選ぶと、段ごとに承認する人の名前が出る（何も保存しない）
//     残りの 15 種類を有効にして「共通ルールで動かす」
//   ・G2（スマホ 390px）：建て替え経費を出す
//   ・GM：申請の明細に「承認のルート」（段 1：GM か CEO・段 2：CEO）と、例外の欄（本人の申請ではない・CEO・GM だけ）
//     まとめて承認：段 1 だけが済み、結果は「次の段へ」・一括の記録は 1 行
//   ・CEO（スマホ 390px・英語）：同じ申請の明細にルート（英語）・段 2 を承認すると承認済み
//   ・店長（G4）：設定の画面に入れない（メニューに無い・開いても何も出ない）
//   ・pageerror 0
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert node tests/e2e-wr/approval-rules-ui-v1190.mjs（SHOTS=フォルダ で画面の写真）
process.env.WR_UI79 = '1'; process.env.WR_GUARD = '1'; process.env.WR_V1184 = '1'; process.env.WR_V1190 = '1';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const { startWorld } = await import('./world.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const W = await startWorld({ vendor: process.env.VENDOR_DIR, cert: process.env.CERT_DIR, appDir: process.env.APP_DIR || undefined });
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [], all = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : '')); };
const shot = async (D, name) => { if (process.env.SHOTS) await D.page.screenshot({ path: process.env.SHOTS + '/' + name + '.png', fullPage: false }).catch(() => {}); };

async function device(width = 390, lang) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 }, serviceWorkers: 'block' });
  if (lang) await ctx.addInitScript(l => { try { localStorage.setItem('funergy_lang', l); } catch (e) { } }, lang);
  const page = await ctx.newPage();
  const D = { ctx, page, toasts: [], errors: [] };
  await page.exposeFunction('__toast', (m, k) => D.toasts.push([k, String(m).slice(0, 240)]));
  page.on('dialog', d => { D.toasts.push(['dialog', d.message().slice(0, 200)]); d.accept(); });
  page.on('pageerror', e => D.errors.push(String(e.message).slice(0, 200)));
  all.push(D);
  return D;
}
async function login(D, store, name) {
  const { page } = D;
  await page.goto(W.url);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await page.evaluate(s => loginPickLocation(s), store); await sleep(400);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false, null, { timeout: 120000 }).catch(() => {});
  await sleep(1500);
  await page.evaluate(() => { const o = window.showToast; window.showToast = function (m, k) { try { window.__toast(m, k); } catch (e) { } return o && o.apply(this, arguments); }; });
}
const overflow = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
const fits = o => o.doc <= o.win + 1;
const arText = page => page.evaluate(() => (document.getElementById('ar-root') || {}).innerText || '');
const apiAs = (D, body) => D.page.evaluate(async b => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/work-requests', { method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, b, { pin_session: window._hwSession })) });
  return { st: r.status, j: await r.json().catch(() => null) };
}, body);
const clickText = (D, sel, re) => D.page.evaluate(([s, src]) => { const re = new RegExp(src); const b = [...document.querySelectorAll(s)].reverse().find(x => re.test(x.innerText) && !x.disabled); if (!b) return false; b.click(); return true; }, [sel, re.source]);
const openArSettings = async D => {
  await D.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } go('ar_settings'); });
  await D.page.waitForFunction(() => document.querySelectorAll('#ar-root .ar-k').length >= 16 && !/読み込み中|Loading/.test((document.getElementById('ar-root') || {}).innerText || ''), null, { timeout: 20000 }).catch(() => {});
  await sleep(400);
};
const rule = async kind => (await W.q(`select ver, status, def from public.ar_rules where kind = $1 order by ver`, [kind]));
const openWr = async (D, id, waitFor) => {
  await D.page.evaluate(i => wrOpen(i), id);
  await D.page.waitForFunction(w => { const d = document.getElementById('wr-detail'); return d && !/読み込み中|Loading/.test(d.innerText) && (!w || new RegExp(w).test(d.innerText)); }, waitFor || '', { timeout: 15000 }).catch(() => {});
  await sleep(400);
  return D.page.evaluate(() => (document.getElementById('wr-detail') || {}).innerText || '');
};

// ---------------------------------------------------------------- GM（PC 1440px）：承認・閲覧設定
const GM = await device(1440);
await login(GM, 'OFFICE', 'Gabe Gm');
const navHas = await GM.page.evaluate(() => (typeof NAV_ITEMS !== 'undefined' ? JSON.stringify(NAV_ITEMS) : '').includes('ar_settings'));
await openArSettings(GM);
const kinds0 = await GM.page.evaluate(() => [...document.querySelectorAll('#ar-root .ar-k')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
ok('A-1 GM：設定 › 承認・閲覧設定に 16 種類（初めはどれも下書き・有効な版はまだない）', navHas && kinds0.length === 16 && kinds0.every(t => /下書き/.test(t)), { navHas, n: kinds0.length, sample: kinds0.slice(0, 3) });
const of1 = await overflow(GM.page);
ok('A-2 PC 1440px で横にはみ出さない', fits(of1), of1);
await shot(GM, '1_GM_承認閲覧設定_PC');

await GM.page.locator('#ar-root .ar-k', { hasText: '建て替え' }).first().click(); await sleep(500);
const ed0 = await arText(GM.page);
ok('A-3 建て替え経費を選ぶ：既定は「段 1：GM か CEO」・閲覧者・自分の申請の決まり', /既定/.test(ed0) && /段 1/.test(ed0) && /閲覧者/.test(ed0) && /自分の申請/.test(ed0), ed0.slice(0, 300));
await clickText(GM, '#ar-root button', /段を足す/); await sleep(300);
await GM.page.evaluate(() => { const s = [...document.querySelectorAll('#ar-root .ar-pick select')].find(x => [...x.options].some(o => o.value === 'ceo')); s.value = 'ceo'; s.dispatchEvent(new Event('change')); }); await sleep(200);
await clickText(GM, '#ar-root .ar-pick button', /足す/); await sleep(300);
await GM.page.fill('#ar-root input[placeholder*="AM の段"]', 'CEO の段を足した');
await clickText(GM, '#ar-root button', /下書きに保存/); await sleep(1500);
let rs = await rule('reimburse');
const dr = rs.find(r => r.status === 'draft');
ok('A-4 段 2 に CEO を足して「下書きに保存」：クラウドの下書きの既定が 2 段（段 2 は CEO）', dr && dr.def.default.stages.length === 2 && dr.def.default.stages[1].slots[0].role === 'ceo', rs.map(r => [r.ver, r.status, r.def && r.def.default && r.def.default.stages.length]));
await GM.page.fill('#ar-root input[placeholder*="AM の段"]', 'CEO の段を足した');
await clickText(GM, '#ar-root button', /この下書きを有効にする/); await sleep(1500);
rs = await rule('reimburse');
ok('A-5 「この下書きを有効にする」：その版が有効（ほかの種類は下書きのまま）', rs.some(r => r.status === 'active' && r.def.default.stages.length === 2) && (await W.q(`select count(*)::int n from public.ar_rules where status = 'active'`))[0].n === 1, rs.map(r => [r.ver, r.status]));

/* 試す：店と申請した人を選ぶと、段ごとに承認する人の名前が出る（何も保存しない） */
const nRules0 = (await W.q('select count(*)::int n from public.ar_rules'))[0].n;
await GM.page.evaluate(() => { const box = document.querySelector('#ar-root .ar-side'); const ss = box.querySelectorAll('select'); ss[0].value = 'F01'; ss[0].dispatchEvent(new Event('change')); const o = [...ss[1].options].find(x => /Lee Two/.test(x.textContent)); ss[1].value = o.value; ss[1].dispatchEvent(new Event('change')); });
await clickText(GM, '#ar-root .ar-side button', /この条件で試す/);
await GM.page.waitForFunction(() => /段 2/.test((document.querySelector('#ar-root .ar-side') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
const pv = await GM.page.evaluate(() => document.querySelector('#ar-root .ar-side').innerText);
ok('A-6 試す：段 1 に Gabe Gm と Cora Ceo・段 2 に Cora Ceo の名前（何も保存しない）', /段 1[\s\S]*Gabe Gm[\s\S]*段 2[\s\S]*Cora Ceo/.test(pv) && (await W.q('select count(*)::int n from public.ar_rules'))[0].n === nRules0, pv.slice(0, 400));
await shot(GM, '2_GM_建て替え経費の編集と試す_PC');

/* 残り 15 種類を有効にする（画面の操作は A-5 と同じなので API で）→「使い始め」タブで共通ルールで動かす */
const st1 = (await apiAs(GM, { action: 'ar_state' })).j;
for (const k of st1.kinds) if (!k.active && k.draft) await apiAs(GM, { action: 'ar_rule_activate', kind: k.kind, expect_ver: k.draft.ver, expect_rev: k.draft.rev, note: '確かめた' });
await GM.page.evaluate(() => FUNERGY_AR.h.reload()); await sleep(1200);
await GM.page.locator('#ar-root .seg-tab', { hasText: '使い始め' }).first().click(); await sleep(500);
const lv0 = await arText(GM.page);
ok('A-7 「使い始め」：16 種類とも有効な版がある（足りない種類の注意が出ない）', /共通ルールで動かす/.test(lv0) && !/有効な版がない種類/.test(lv0), lv0.slice(0, 300));
await clickText(GM, '#ar-root button', /共通ルールで動かす/); await sleep(2000);
const live = (await W.q(`select live from public.ar_settings limit 1`))[0];
ok('A-8 「共通ルールで動かす」（確かめのあと）：サーバーの共通ルールが動いている', live && live.live === true && GM.toasts.some(([k, m]) => k === 'dialog' && /共通ルールで動かしますか/.test(m)), live);
await shot(GM, '3_GM_使い始め_PC');

// ---------------------------------------------------------------- G2（スマホ 390px）：建て替え経費を出す
const G2 = await device(390);
await login(G2, 'F01', 'Lee Two');
await G2.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } go('mypage'); }); await sleep(1200);
await G2.page.waitForFunction(() => !!document.querySelector('#wr-myexp [data-wr-exp="reimburse"]'), null, { timeout: 15000 }).catch(() => {});
await G2.page.evaluate(() => document.querySelector('#wr-myexp [data-wr-exp="reimburse"]').click());
await G2.page.waitForFunction(() => { const f = document.getElementById('wr-form'); return f && /申請する|Submit/.test(f.innerText); }, null, { timeout: 15000 });
await G2.page.evaluate(() => { const set = (id, v) => { const e = document.getElementById('wrf-' + id); if (e) e.value = v; }; set('vendor', 'Costco'); set('amount', '80'); });
await G2.page.evaluate(() => wrSend());
await G2.page.waitForFunction(() => !!document.getElementById('wr-sent-code'), null, { timeout: 15000 }).catch(() => {});
const code = await G2.page.evaluate(() => { const e = document.getElementById('wr-sent-code'); return e ? e.textContent : null; });
const req = (await W.q(`select id, status, route from public.wr_requests where code = $1`, [code]))[0];
ok('B-1 G2 が建て替え経費を出した：共通ルールのルート（段 2 つ）が付いている', req && req.route && req.route.stages && req.route.stages.length === 2, { code, st: req && req.status });
await G2.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
const g2d = await openWr(G2, req.id, '承認のルート');
ok('B-2 本人の明細にもルート（段と承認する人）・例外の欄は出ない（本人・G2）', /承認のルート/.test(g2d) && /段 1/.test(g2d) && !/例外/.test(g2d), g2d.slice(0, 300));
const ofG2 = await overflow(G2.page);
ok('B-3 スマホ 390px で明細が横にはみ出さない', fits(ofG2), ofG2);
await shot(G2, '4_G2_明細のルート_スマホ');

// ---------------------------------------------------------------- GM：明細のルートと例外・まとめて承認
await GM.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } workTab = 'wr'; go('tasks'); }); await sleep(2500);
const gmd = await openWr(GM, req.id, '承認のルート');
ok('C-1 GM の明細：「承認のルート」に段 1（今の段：Gabe Gm・Cora Ceo の名前）と段 2（CEO）・「あなたが承認すると：段 2 へ」', /承認のルート[\s\S]*段 1[\s\S]*Gabe Gm[\s\S]*段 2[\s\S]*CEO/.test(gmd) && /あなたが承認すると：段 2 へ/.test(gmd), gmd.slice(0, 500));
ok('C-2 GM の明細に「例外（この申請だけ・CEO・GM）」の欄・社員 ID は出ない', /例外/.test(gmd) && !/\be\d{1,2}\b/.test(gmd), null);
await shot(GM, '5_GM_明細のルートと例外_PC');
await GM.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } }); await sleep(300);
await GM.page.evaluate(() => { workTab = 'wr'; go('tasks'); }); await sleep(2000);
await GM.page.evaluate(id => wrSel(id, true), req.id); await sleep(500);
const nBulk0 = (await W.q('select count(*)::int n from public.ar_bulk'))[0].n;
await GM.page.evaluate(() => wrBulkAsk()); await sleep(600);
const ask = await GM.page.evaluate(() => (document.getElementById('wr-bulk') || {}).innerText || '');
ok('C-3 まとめて承認の確かめ：GM の段だけを承認すること（次の段がある）が出る', /1 件を承認/.test(ask) && /次の段|段 2|CEO/.test(ask), ask.slice(0, 400));
await shot(GM, '6_GM_まとめて承認の確かめ_PC');
await GM.page.evaluate(() => { wrBulkGo(); wrBulkGo(); }); await sleep(3000);
const res = await GM.page.evaluate(() => (document.getElementById('wr-bulk') || {}).innerText || '');
const after = (await W.q(`select status, route from public.wr_requests where id = $1`, [req.id]))[0];
const nBulk1 = (await W.q('select count(*)::int n from public.ar_bulk'))[0].n;
ok('C-4 結果：「次の段へ」・申請はまだ承認待ち（段 2：CEO）・二度押しでも一括の記録は 1 行', /次の段/.test(res) && after.status !== 'approved' && nBulk1 === nBulk0 + 1, { st: after.status, nBulk: nBulk1 - nBulk0, res: res.slice(0, 300) });
await shot(GM, '7_GM_まとめて承認の結果_PC');

// ---------------------------------------------------------------- CEO（スマホ 390px・英語）：段 2 を承認
const CEO = await device(390, 'en');
await login(CEO, 'OFFICE', 'Cora Ceo');
await CEO.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } workTab = 'wr'; go('tasks'); }); await sleep(2500);
const ced = await openWr(CEO, req.id, 'Approval route');
ok('D-1 CEO（英語）：明細に「Approval route」・Step 1 は済み（Gabe Gm・bulk）・Step 2 が今', /Approval route/.test(ced) && /Step 1/.test(ced) && /Gabe Gm[^\n]*bulk/.test(ced) && /Step 2/.test(ced) && !/\bself\b/.test(ced), ced.slice(0, 400));
const ofC = await overflow(CEO.page);
ok('D-2 スマホ 390px（英語）で横にはみ出さない', fits(ofC), ofC);
await shot(CEO, '8_CEO_明細のルート_スマホ_英語');
const rCeo = await apiAs(CEO, { action: 'act', id: req.id, op: 'approve', expect_rev: (await W.q('select rev from public.wr_requests where id = $1', [req.id]))[0].rev, client_key: 'k-ceo-' + Date.now() });
const fin = (await W.q(`select status from public.wr_requests where id = $1`, [req.id]))[0];
ok('D-3 CEO が段 2 を承認すると承認済み（経理の確認へ）', rCeo.st === 200 && fin.status === 'approved', { http: rCeo.st, st: fin.status, e: rCeo.j && rCeo.j.error });
await openArSettings(CEO);
const ofCs = await overflow(CEO.page);
const ceoSet = await arText(CEO.page);
ok('D-4 CEO（スマホ・英語）でも設定が開ける・横にはみ出さない', /Rules \(16\)/.test(ceoSet) && /Go live/.test(ceoSet) && fits(ofCs), { ofCs, t: ceoSet.slice(0, 120) });
await shot(CEO, '9_CEO_承認閲覧設定_スマホ_英語');

// ---------------------------------------------------------------- 店長（G4）：設定に入れない
const G4 = await device(390);
await login(G4, 'F01', 'Mia Four');
await G4.page.evaluate(() => { try { closeModalDirect(); } catch (e) { } go('ar_settings'); }); await sleep(1500);
const g4t = await G4.page.evaluate(() => ({ ar: !!document.getElementById('ar-root') && /承認・閲覧設定/.test(document.getElementById('ar-root').innerText), k: document.querySelectorAll('#ar-root .ar-k').length }));
const g4api = await apiAs(G4, { action: 'ar_state' });
ok('E-1 店長（G4）：設定の画面は出ない・API も断る', !g4t.k && g4api.st === 403, { g4t, st: g4api.st });

const errs = all.flatMap(d => d.errors);
ok('pageerror 0', !errs.length, errs);
const bad = W.calls.filter(c => c.status >= 500);
ok('関数の 500 が無い', !bad.length, bad.slice(0, 3));
await browser.close(); W.close();
console.log(results.filter(r => r.ok).length + '/' + results.length);
process.exit(results.every(r => r.ok) ? 0 : 1);
