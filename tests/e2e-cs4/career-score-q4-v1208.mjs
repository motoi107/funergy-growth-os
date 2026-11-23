// v1208（Career Score 2026 Q4・段階 3-2・UI案99）を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない・名前はすべて作りもの）。
// 模擬サーバーは SS_REAL=1（本物の関数 secure-state）と CSQ4_DB=1（本物の SQL 20261214090000 を PGlite に流した csq4_* の表と関数）。
// ・GM（1280px・日本語）：Career Score の 3 つのタブ・状態の数 → 評価表を決める（型を選ぶ）→ 評価を開始 → 全部の項目を採点 → 保存 → 確認待ち → 確定・公開
//   → 一覧が「確定・公開済み」・賞与の ① の元（bonusRow）が確定した総合点 → 前の採点は止まる → 保存していない変更があるとほかの画面へ移る前に聞く
// ・本人（スタッフ・390px）：マイページと「フィードバック・見直し」に確定した総合点・横にはみ出ない
// ・GM（390px）：一覧と評価の画面が横にはみ出ない
// ・Moto さん 11/23「b1」と 06:59（GM は CEO と同じにすべての権限）（DATA_FILE に login.gm2 と確かめた店長があるとき＝node tests/e2e-cs4/data-b1.mjs で作った写し。無ければ飛ばして SKIP と出す）：
//   CEO が 2 人目の GM を採点して確認待ち → GM が確認して確定・公開・記録も読める／GM が店長の店の G2 の評価表を決める → 確かめた店長（390px）が採点して確認待ち → GM が確定・公開
// 使い方：模擬サーバー（tests/perf/server.mjs）を SS_REAL=1 CSQ4_DB=1 DATA_FILE=<合成データ（today は 2026 Q4 の日）> で動かしてから
//   DATA_FILE=<合成データ> node career-score-q4-v1208.mjs [結果の JSON]
//   （4〜7 は node tests/e2e-cs4/data-b1.mjs <合成データ> <写し> で作った写しを DATA_FILE にして、模擬サーバーを動かし直してから）
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = process.env.APP || 'http://localhost:8080/';
const D = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
const OUT = process.argv[2] || '';
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info: info === undefined ? null : info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const CREW = { id: D.login.crewId, name: D.login.crew, store: D.login.crewStore };

async function open(tag, vp, touch) {
  const dir = '/tmp/cs4check-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: vp || { width: 1280, height: 860 }, hasTouch: !!touch, isMobile: !!touch, locale: 'ja-JP', timezoneId: 'Pacific/Honolulu' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  // 確かめの画面：既定は OK。page._dismiss を true にしたときだけキャンセル（ほかの画面へ移る前に聞く、の確かめ）
  page.on('dialog', d => { dialogs.push(d.message().slice(0, 160)); (page._dismiss ? d.dismiss() : d.accept()).catch(() => {}); });
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  return { ctx, page, errors, dialogs };
}
async function login(page, loc, name) {
  await page.evaluate(s => loginPickLocation(s), loc);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 100 });
  await sleep(2000);
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const E = page => page.evaluate(() => { const e = FUNERGY_CS4._t.E(); return { tab: e.tab, busy: e.busy || '', cu: !!e.cu, st: e.cu ? e.cu.st : '', ev: e.cu && e.cu.ev ? { status: e.cu.ev.status, rev: e.cu.ev.rev } : null, srv: FUNERGY_CS4._t.srv() }; });
const idx = (page, emp) => page.evaluate(k => FUNERGY_CS4._t.E().ixm[String(k)], emp);
const rootText = page => page.evaluate(() => { const r = document.getElementById('cs4-root'); return r ? r.innerText : ''; });
async function toCareer(page) {
  await page.evaluate(() => go('leadership'));
  await page.waitForFunction(() => !!document.getElementById('cs4-root'), null, { timeout: 60000 });
}
async function waitIdle(page, ms = 30000) { await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return !e.busy && !(e.cu && (e.cu.ld || e.cu.st === 'saving')); }, null, { timeout: ms, polling: 100 }); await sleep(300); }
// 今のカテゴリーの「2」を押していない項目を 1 つずつ押す（押すたびに描き直すので、毎回探し直す）
async function scoreCat(page) {
  return page.evaluate(() => { let n = 0; for (let i = 0; i < 400; i++) { const b = document.querySelector('#cs4-main button.cs4-sb:not(.on):not([disabled])[onclick*="\'S2\'"]'); if (!b) break; b.click(); n++; } return n; });
}

// ---- 1. GM（1280px・日本語）：評価表 → 開始 → 採点 → 保存 → 確認待ち → 確定・公開
let total = '';
{
  const { ctx, page, errors, dialogs } = await open('gm');
  await login(page, 'OFFICE', D.login.gm);
  await toCareer(page);
  await page.waitForSelector('#cs4-list', { timeout: 60000 });
  const t0 = await rootText(page);
  ok('GM: the Career Score page has the three tabs', /今期の評価/.test(t0) && /評価履歴/.test(t0) && /フィードバック・見直し/.test(t0));
  ok('GM: the status counts are shown (未開始・入力中・確認待ち・差戻し・確定・公開済み)', ['未開始', '入力中', '確認待ち', '差戻し', '確定・公開済み'].every(s => t0.includes(s)));
  ok('GM: the server is the new one (cs4fn:1)', (await E(page)).srv === 'new', (await E(page)).srv);
  ok('GM: the old scoring is stopped for 2026 Q4', await page.evaluate(() => !!FUNERGY_CS4.oldBlocked()), await page.evaluate(() => FUNERGY_CS4.oldBlocked()));

  // 評価表を決める（提案は G1・型は選ぶ）
  let i = await idx(page, CREW.id);
  ok('GM: the staff member is in the list', Number.isInteger(i), { emp: CREW.id, i });
  await page.click(`button[onclick="FUNERGY_CS4.h.asg(${i})"]`);
  await page.waitForSelector('#cs4-as-sys', { timeout: 10000 });
  const tsel = page.locator('select[onchange*="asgSet(\'type\'"]');
  const opts = await tsel.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
  ok('GM: the form asks for the type (G1 has types to pick)', opts.length > 0, opts);
  await tsel.selectOption(opts[0]);
  await page.click('button[onclick="FUNERGY_CS4.h.asgSave()"]');
  await page.waitForFunction(k => { const r = FUNERGY_CS4._t.E().rosMap; return r && r[k] && r[k].assign; }, CREW.id, { timeout: 30000 });
  await waitIdle(page);
  ok('GM: the evaluation form is saved on the server', await page.evaluate(k => { const r = FUNERGY_CS4._t.E().rosMap[k]; return r.assign.system === 'G' && /^G\d$/.test(r.assign.grade) && !!r.assign.type; }, CREW.id));

  // 評価を開始
  i = await idx(page, CREW.id);
  await page.click(`button[onclick="FUNERGY_CS4.h.start(${i})"]`);
  await page.waitForSelector('#cs4-main', { timeout: 30000 });
  await waitIdle(page);
  let s = await E(page);
  ok('GM: the evaluation starts as 入力中 (draft)', s.cu && s.ev && s.ev.status === 'draft', s);
  ok('GM: the evaluation page has no horizontal overflow (1280px)', (await overflow(page)) <= 0, await overflow(page));

  // カテゴリーごとに採点（全部 2）
  const cats = await page.evaluate(() => Array.from(document.querySelectorAll('#cs4-nav [onclick*="FUNERGY_CS4.h.cat("]')).map(b => b.getAttribute('onclick')));
  ok('GM: the categories are listed for jumping', cats.length >= 3, cats.length);
  let scored = 0;
  for (const oc of cats) {
    await page.click(`#cs4-nav [onclick="${oc}"]`);
    await sleep(150);
    scored += await scoreCat(page);
  }
  const left = await page.evaluate(() => { const p = FUNERGY_CS4._t.preview(); return p ? { state: p.state, counts: p.counts, total: p.total && p.total.display } : null; });
  ok('GM: every item is scored before saving (no 未評価 left)', left && left.counts && left.counts.unassessed === 0, { scored, left });
  ok('GM: unsaved changes are known before saving', await page.evaluate(() => FUNERGY_CS4.unsaved()));
  await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.save()"]');
  await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.st === 'saved' && !FUNERGY_CS4.unsaved(); }, null, { timeout: 30000, polling: 100 });
  ok('GM: 保存する writes to the server (saved, nothing unsaved)', true);
  const sum = await page.evaluate(() => (document.getElementById('cs4-sum') || {}).innerText || '');
  ok('GM: the score summary shows the total out of 100', /\/\s*100|100 点/.test(sum), sum.slice(0, 160));

  // 確認待ち → 確定・公開
  await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'submit\')"]');
  await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.status === 'submitted' && !e.busy; }, null, { timeout: 30000, polling: 100 });
  ok('GM: 確認待ちに出す moves it to 確認待ち', true);
  await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'confirm\')"]');
  await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.status === 'published' && !e.busy; }, null, { timeout: 30000, polling: 100 });
  ok('GM: 確定・公開する publishes it', true);
  await page.click('button[onclick="FUNERGY_CS4.h.back()"]').catch(() => {});
  await page.evaluate(() => FUNERGY_CS4.h.reload());
  await page.waitForFunction(k => { const r = FUNERGY_CS4._t.E().rosMap; return r && r[k] && r[k].published; }, CREW.id, { timeout: 30000, polling: 200 });
  const pub = await page.evaluate(k => FUNERGY_CS4._t.E().rosMap[k].published, CREW.id);
  total = pub && pub.total;
  ok('GM: the list shows 確定・公開済み with the total', !!(pub && pub.total && pub.exact), pub);
  // 賞与の ① の元（2026 Q4）は確定した総合点
  await page.waitForFunction(k => { const e = getEmployees().find(x => String(x.id) === k); const r = e && FUNERGY_CS4.bonusRow(e, '2026-Q4'); return r && r.code !== 'loading'; }, CREW.id, { timeout: 30000, polling: 200 });
  const br = await page.evaluate(k => { const e = getEmployees().find(x => String(x.id) === k); return FUNERGY_CS4.bonusRow(e, '2026-Q4'); }, CREW.id);
  ok('GM: the 2026 Q4 bonus ① uses the published total', br && br.ok === true && br.exact === pub.exact && br.base === pub.base, br);
  ok('GM: 2026 Q3 still uses the old Career Score', await page.evaluate(() => !FUNERGY_CS4.bonusQ('2026-Q3') && FUNERGY_CS4.bonusQ('2026-Q4')));

  // 保存していない変更があるとき、ほかの画面へ移る前に聞く（キャンセルなら移らない）
  const other = await page.evaluate(k => { const rows = FUNERGY_CS4._t.E().ros.rows || []; const r = rows.find(x => x.emp !== k && x.can && x.can.assign && !x.open && !x.published && x.suggest && x.suggest.system === 'G'); return r ? String(r.emp) : null; }, CREW.id);
  if (other) {
    let j = await idx(page, other);
    await page.click(`button[onclick="FUNERGY_CS4.h.asg(${j})"]`);
    await page.waitForSelector('#cs4-as-sys', { timeout: 10000 });
    const ts2 = page.locator('select[onchange*="asgSet(\'type\'"]');
    if (await ts2.count()) { const o2 = await ts2.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean)); await ts2.selectOption(o2[0]); }
    await page.click('button[onclick="FUNERGY_CS4.h.asgSave()"]');
    await page.waitForFunction(k => { const r = FUNERGY_CS4._t.E().rosMap; return r && r[k] && r[k].assign; }, other, { timeout: 30000 });
    await waitIdle(page);
    j = await idx(page, other);
    await page.click(`button[onclick="FUNERGY_CS4.h.start(${j})"]`);
    await page.waitForSelector('#cs4-main', { timeout: 30000 });
    await waitIdle(page);
    // (a) 理由の要らない変更は、移る前に自動で保存してから移る（聞かない）
    const it0 = await page.evaluate(() => { const b = document.querySelector('#cs4-main button.cs4-sb:not(.on)[onclick*="\'S2\'"]'); if (!b) return null; const oc = b.getAttribute('onclick'); b.click(); return oc; });
    ok('GM: one changed item is unsaved', !!it0 && await page.evaluate(() => FUNERGY_CS4.unsaved()), it0);
    const saves0 = ((await fetch(APP + '__csq4').then(r => r.json())).rpcs || []).filter(f => f === 'csq4_eval_save').length;
    let n0 = dialogs.length;
    await page.evaluate(() => go('dashboard'));
    await sleep(2500);
    const saves1 = ((await fetch(APP + '__csq4').then(r => r.json())).rpcs || []).filter(f => f === 'csq4_eval_save').length;
    ok('GM: leaving with a change that needs no reason saves it first, without asking', dialogs.length === n0 && saves1 === saves0 + 1 && (await page.evaluate(() => curPage)) === 'dashboard', { asked: dialogs.slice(n0), saves: [saves0, saves1] });
    await toCareer(page);
    await page.waitForSelector('#cs4-main, #cs4-list', { timeout: 60000 });
    const back = await page.evaluate(() => { const e = FUNERGY_CS4._t.E(); return e.cu ? String(e.cu.emp) : ''; });
    ok('GM: coming back to Career Score reopens the same evaluation', back === other, back);
    if (back !== other) {
      j = await idx(page, other);
      await page.click(`button[onclick="FUNERGY_CS4.h.open(${j})"]`);
      await page.waitForSelector('#cs4-main', { timeout: 30000 });
    }
    await page.evaluate(() => FUNERGY_CS4.h.reloadP());
    await waitIdle(page);
    ok('GM: the auto-saved score is still there after opening again', await page.evaluate(oc => !!document.querySelector('#cs4-main button.cs4-sb.on[onclick="' + oc + '"]'), it0));
    // (b) 本人に共有したあとに点を変えると理由が要る → 移る前に聞く（キャンセルなら残る・OK なら保存せずに移る）
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'share\')"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.shared_at && !e.busy; }, null, { timeout: 30000, polling: 100 });
    await page.evaluate(oc => { const b = document.querySelector('#cs4-main button.cs4-sb[onclick="' + oc.replace("'S2'", "'S3'") + '"]'); if (b) b.click(); }, it0);
    ok('GM: after sharing, changing a score needs a reason', await page.evaluate(() => FUNERGY_CS4.unsaved() && !!document.getElementById('cs4-rsn')));
    n0 = dialogs.length;
    page._dismiss = true;
    await page.evaluate(() => go('dashboard'));
    await sleep(800);
    page._dismiss = false;
    ok('GM: leaving with a change that needs a reason asks first, and cancel stays', dialogs.length === n0 + 1 && (await page.evaluate(() => curPage)) === 'leadership' && await page.evaluate(() => FUNERGY_CS4.unsaved()), { asked: dialogs.slice(n0), page: await page.evaluate(() => curPage) });
    n0 = dialogs.length;
    await page.evaluate(() => go('dashboard'));
    await sleep(800);
    ok('GM: OK on the question leaves without saving', dialogs.length === n0 + 1 && (await page.evaluate(() => curPage)) === 'dashboard', { asked: dialogs.slice(n0) });
  } else ok('GM: another staff member to try the leave guard', false);
  ok('GM: no page errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}

// ---- 2. 本人（スタッフ・390px・タッチ）：確定した総合点が見える
{
  const { ctx, page, errors } = await open('staff', { width: 390, height: 844 }, true);
  await login(page, CREW.store, CREW.name);
  await page.evaluate(() => go('mypage'));
  await page.waitForFunction(() => { const m = document.getElementById('cs4-my'); return m && /\d/.test(m.innerText) && !/読み込んで/.test(m.innerText); }, null, { timeout: 60000, polling: 300 }).catch(() => {});
  const my = await page.evaluate(() => (document.getElementById('cs4-my') || {}).innerText || '');
  const num = String(total || '').split('/')[0].trim();
  ok('staff: My page shows the published total', !!num && my.includes(num), { my: my.slice(0, 200), total });
  ok('staff: My page has no horizontal overflow (390px)', (await overflow(page)) <= 0, await overflow(page));
  // 本人は点を変えられない（採点のボタンが無い）・コメントを送れる（評価する人に見える）
  ok('staff: no scoring buttons for the own evaluation', await page.evaluate(() => !document.querySelector('#cs4-my button.cs4-sb, #cs4-my [onclick*="FUNERGY_CS4.h.st("]')));
  const cb = page.locator('#cs4-my button[onclick^="FUNERGY_CS4.h.comment("]');
  ok('staff: a comment can be sent on the published evaluation', (await cb.count()) === 1);
  if (await cb.count()) {
    await cb.click();
    await page.waitForSelector('#ipm-val', { timeout: 10000 });
    await page.fill('#ipm-val', 'e2e: 合成データのコメント');
    await page.evaluate(() => submitInputModal());
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return !e.busy; }, null, { timeout: 30000, polling: 100 });
    await sleep(1500);
  }
  const canOld = await page.evaluate(() => { try { return groupsForRole && Array.from(groupsForRole()).flatMap(g => Array.from(g.children)).some(p => p === 'leadership' && navChildAllowed(p)); } catch (e) { return null; } });
  if (canOld) {
    await toCareer(page);
    await page.evaluate(() => FUNERGY_CS4.h.tab('fb'));
    await sleep(2500);
    const fb = await rootText(page);
    ok('staff: フィードバック・見直し shows the own result', !!num && fb.includes(num), fb.slice(0, 200));
    ok('staff: the Career Score page has no horizontal overflow (390px)', (await overflow(page)) <= 0, await overflow(page));
  }
  ok('staff: no page errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}

// ---- 3. GM（390px・タッチ）：一覧と評価の画面が横にはみ出ない
{
  const { ctx, page, errors } = await open('gm390', { width: 390, height: 844 }, true);
  await login(page, 'OFFICE', D.login.gm);
  await toCareer(page);
  await page.waitForSelector('#cs4-list', { timeout: 60000 });
  ok('GM 390: the list has no horizontal overflow', (await overflow(page)) <= 0, await overflow(page));
  ok('GM 390: the staff comment shows as 申し出あり', await page.evaluate(k => { const r = FUNERGY_CS4._t.E().rosMap[k]; return !!(r && r.reqs > 0); }, CREW.id), await page.evaluate(k => (FUNERGY_CS4._t.E().rosMap[k] || {}).reqs, CREW.id));
  const i = await idx(page, CREW.id);
  await page.click(`button[onclick="FUNERGY_CS4.h.open(${i})"]`);
  await page.waitForSelector('#cs4-main', { timeout: 30000 });
  await waitIdle(page);
  ok('GM 390: the published evaluation opens one category at a time', await page.evaluate(() => document.querySelectorAll('#cs4-main .cs4-it').length > 0), await page.evaluate(() => document.querySelectorAll('#cs4-main .cs4-it').length));
  ok('GM 390: the evaluation page has no horizontal overflow', (await overflow(page)) <= 0, await overflow(page));
  ok('GM 390: no page errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}

// ---- 4〜7（Moto さん 11/23「b1」と 06:59）：合成データに確かめた店長（G3）と 2 人目の GM がいるとき（DATA_FILE に login.gm2 があるとき）だけ
// ・CEO：2 人目の GM の評価を採点して確認待ち → GM が CEO と同じに確認して確定・公開（11/23 06:59「GMは全ての閲覧、評価、変更、承認の権限」）
// ・GM：店長の店の G2 の人の評価表を決める → 確かめた店長（390px）が採点して確認待ちに出す（確定のボタンは無い）→ GM が確定・公開
async function scoreAll(page) {
  const cats = await page.evaluate(() => Array.from(document.querySelectorAll('#cs4-nav [onclick*="FUNERGY_CS4.h.cat("]')).map(b => b.getAttribute('onclick')));
  let n = 0;
  for (const oc of cats) { await page.click(`#cs4-nav [onclick="${oc}"]`); await sleep(150); n += await scoreCat(page); }
  const left = await page.evaluate(() => { const p = FUNERGY_CS4._t.preview(); return p && p.counts ? p.counts.unassessed : null; });
  return { cats: cats.length, n, left };
}
async function assignFirst(page, emp) {
  const i = await idx(page, emp);
  await page.click(`button[onclick="FUNERGY_CS4.h.asg(${i})"]`);
  await page.waitForSelector('#cs4-as-sys', { timeout: 10000 });
  const ts = page.locator('select[onchange*="asgSet(\'type\'"]');
  if (await ts.count()) { const o = await ts.locator('option').evaluateAll(os => os.map(x => x.value).filter(Boolean)); if (o.length) await ts.selectOption(o[0]); }
  await page.click('button[onclick="FUNERGY_CS4.h.asgSave()"]');
  await page.waitForFunction(k => { const r = FUNERGY_CS4._t.E().rosMap; return r && r[k] && r[k].assign; }, emp, { timeout: 30000 });
  await waitIdle(page);
}
const rowBtns = (page, i) => page.evaluate(n => Array.from(document.querySelectorAll('#cs4-list [onclick]')).map(b => b.getAttribute('onclick')).filter(s => new RegExp('^FUNERGY_CS4\\.h\\.\\w+\\(' + n + '\\)$').test(s)).map(s => s.replace(/\(.*$/, '').replace('FUNERGY_CS4.h.', '')), i);
if (D.login.gm2 && D.login.sl) {
  const GM2 = { id: D.login.gm2Id, name: D.login.gm2 };
  const SL = { id: D.login.slId, name: D.login.sl, store: D.login.slStore };
  // 4. CEO（1280px）：2 人目の GM の評価表を決めて採点し、確認待ちに出す（確定はほかの GM が行う＝5）
  {
    const { ctx, page, errors } = await open('ceo-c');
    await login(page, 'OFFICE', D.login.ceo);
    await toCareer(page);
    await page.waitForSelector('#cs4-list', { timeout: 60000 });
    ok('CEO: the other GM person can be scored by the CEO', await page.evaluate(k => { const r = FUNERGY_CS4._t.E().rosMap[k]; return !!(r && r.can && r.can.score && r.can.confirm); }, GM2.id));
    await assignFirst(page, GM2.id);
    const i = await idx(page, GM2.id);
    await page.click(`button[onclick="FUNERGY_CS4.h.start(${i})"]`);
    await page.waitForSelector('#cs4-main', { timeout: 30000 });
    await waitIdle(page);
    const sc = await scoreAll(page);
    ok('CEO: every item of the GM person is scored', sc.left === 0 && sc.n > 0, sc);
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.save()"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.st === 'saved' && !FUNERGY_CS4.unsaved(); }, null, { timeout: 30000, polling: 100 });
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'submit\')"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.status === 'submitted' && !e.busy; }, null, { timeout: 30000, polling: 100 });
    ok('CEO: the GM person\'s evaluation is 確認待ち', true);
    ok('CEO: no page errors', errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
  // 5. GM（1280px）：2 人目の GM も CEO と同じに確認して確定・公開できる（11/23 06:59）／店長の店の G2 の人の評価表を決める
  let g2 = null;
  {
    const { ctx, page, errors } = await open('gm-c');
    await login(page, 'OFFICE', D.login.gm);
    await toCareer(page);
    await page.waitForSelector('#cs4-list', { timeout: 60000 });
    const v = await page.evaluate(k => { const r = FUNERGY_CS4._t.E().rosMap[k]; return r ? { view: !!r.view, can: r.can, open: r.open ? r.open.status : null } : null; }, GM2.id);
    ok('GM (06:59): the other GM person is listed with every right (確認待ち)', !!(v && !v.view && v.open === 'submitted' && v.can && v.can.score && v.can.confirm && v.can.cancel), v);
    const t = await rootText(page);
    ok('GM (06:59): no 見るだけ chip, filter or note', !/見るだけ/.test(t));
    ok('GM (06:59): the GM person is in the 確認待ち count', /確認待ち\s*[1-9]/.test(t), (t.match(/確認待ち\s*\d+/) || [])[0]);
    const vi = await idx(page, GM2.id);
    const vb = await rowBtns(page, vi);
    ok('GM (06:59): the row offers 確認する (open)', vb.includes('open'), vb);
    await page.click(`#cs4-list button[onclick="FUNERGY_CS4.h.open(${vi})"]`);
    await page.waitForSelector('#cs4-main', { timeout: 30000 });
    await waitIdle(page);
    const ab = await page.evaluate(() => Array.from(document.querySelectorAll('#cs4-actb [onclick]')).map(b => b.getAttribute('onclick')));
    ok('GM (06:59): the opened evaluation offers 差し戻す・確定・公開する・取り消す', ['return', 'confirm', 'cancel'].every(x => ab.includes(`FUNERGY_CS4.h.act('${x}')`)), ab);
    ok('GM (06:59): the opened evaluation does not say 見るだけ', !/見るだけ/.test(await rootText(page)));
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'confirm\')"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.status === 'published' && !e.busy; }, null, { timeout: 30000, polling: 100 });
    ok('GM (06:59): the GM confirms and publishes the other GM person\'s evaluation', true);
    await page.evaluate(k => { FUNERGY_CS4.h.back(); const e = FUNERGY_CS4._t.E(); e.hsel = k; FUNERGY_CS4.h.tab('hist'); }, GM2.id);
    await page.waitForFunction(() => { const r = document.getElementById('cs4-root'); return r && /変更の記録（\d+）/.test(r.innerText); }, null, { timeout: 30000, polling: 200 }).catch(() => {});
    const ht = await rootText(page);
    ok('GM (06:59): the history of the GM person shows the change log (full read)', /変更の記録（\d+）/.test(ht) && !/見るだけ/.test(ht), (ht.match(/変更の記録（\d+）/) || [])[0]);
    await page.evaluate(() => FUNERGY_CS4.h.tab('now'));
    await page.waitForSelector('#cs4-list', { timeout: 30000 });
    await page.waitForFunction(k => { const r = FUNERGY_CS4._t.E().rosMap; return r && r[k] && r[k].published && !r[k].open; }, GM2.id, { timeout: 30000, polling: 200 }).catch(() => {});
    const pb = await rowBtns(page, await idx(page, GM2.id));
    ok('GM (06:59): after publishing, the row offers 再評価を作成', pb.includes('reeval'), pb);
    g2 = await page.evaluate(s => { const rows = FUNERGY_CS4._t.E().ros.rows || []; const r = rows.find(x => x.store === s && x.grade === 2 && x.can && x.can.assign && !x.assign && !x.open && !x.published); return r ? String(r.emp) : null; }, SL.store);
    ok('GM (b1): a G2 person of the store leader\'s store to assign', !!g2, g2);
    if (g2) {
      await assignFirst(page, g2);
      ok('GM (b1): the G2 person\'s form is saved', await page.evaluate(k => { const r = FUNERGY_CS4._t.E().rosMap[k]; return !!(r && r.assign && r.assign.system === 'G' && r.assign.grade === 'G2'); }, g2), await page.evaluate(k => (FUNERGY_CS4._t.E().rosMap[k] || {}).assign, g2));
    }
    ok('GM: no page errors', errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
  // 6. 確かめた店長（G3・390px・タッチ）：自分の店の G2 の人だけ・採点して確認待ちに出す（確定のボタンは無い）
  if (g2) {
    const { ctx, page, errors } = await open('sl-b1', { width: 390, height: 844 }, true);
    await login(page, SL.store, SL.name);
    await toCareer(page);
    await page.waitForSelector('#cs4-list', { timeout: 60000 });
    const rs = await page.evaluate(() => (FUNERGY_CS4._t.E().ros.rows || []).map(r => ({ emp: String(r.emp), store: r.store, grade: r.grade, role: r.role, can: r.can })));
    ok('SL (b1): the list has only G2 people of the own store', rs.length > 0 && rs.every(r => r.store === SL.store && r.grade === 2), rs.map(r => [r.emp, r.store, r.grade, r.role]));
    ok('SL (b1): the assigned G2 person can be scored but not confirmed', rs.some(r => r.emp === g2 && r.can && r.can.score && !r.can.confirm && !r.can.assign));
    const t = await rootText(page);
    ok('SL (b1): the list says CEO・GM confirm and publish', /CEO・GM が確認して確定・公開します/.test(t));
    ok('SL (b1): the list has no horizontal overflow (390px)', (await overflow(page)) <= 0, await overflow(page));
    const i = await idx(page, g2);
    await page.click(`button[onclick="FUNERGY_CS4.h.start(${i})"]`);
    await page.waitForSelector('#cs4-main', { timeout: 30000 });
    await waitIdle(page);
    const sc = await scoreAll(page);
    ok('SL (b1): every item is scored', sc.left === 0 && sc.n > 0, sc);
    ok('SL (b1): the evaluation page has no horizontal overflow (390px)', (await overflow(page)) <= 0, await overflow(page));
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.save()"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.st === 'saved' && !FUNERGY_CS4.unsaved(); }, null, { timeout: 30000, polling: 100 });
    ok('SL (b1): no 確定・公開 button for the store leader', await page.evaluate(() => !document.querySelector('#cs4-root [onclick="FUNERGY_CS4.h.act(\'confirm\')"]')));
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'submit\')"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.status === 'submitted' && !e.busy; }, null, { timeout: 30000, polling: 100 });
    ok('SL (b1): 確認待ちに出す moves it to 確認待ち', true);
    ok('SL (b1): no page errors', errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
  // 7. GM：店長が出した G2 の人の評価を確定・公開
  if (g2) {
    const { ctx, page, errors } = await open('gm-b1');
    await login(page, 'OFFICE', D.login.gm);
    await toCareer(page);
    await page.waitForSelector('#cs4-list', { timeout: 60000 });
    const r0 = await page.evaluate(k => { const r = FUNERGY_CS4._t.E().rosMap[k]; return r && r.open ? { status: r.open.status, by: r.open.by_name } : null; }, g2);
    ok('GM (b1): the G2 person\'s evaluation is 確認待ち (sent by the store leader)', !!(r0 && r0.status === 'submitted'), r0);
    const i = await idx(page, g2);
    await page.click(`button[onclick="FUNERGY_CS4.h.open(${i})"]`);
    await page.waitForSelector('#cs4-main', { timeout: 30000 });
    await waitIdle(page);
    await page.click('#cs4-actb button[onclick="FUNERGY_CS4.h.act(\'confirm\')"]');
    await page.waitForFunction(() => { const e = FUNERGY_CS4._t.E(); return e.cu && e.cu.ev && e.cu.ev.status === 'published' && !e.busy; }, null, { timeout: 30000, polling: 100 });
    ok('GM (b1): GM confirms and publishes it', true);
    ok('GM (b1): no page errors', errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
} else console.log('SKIP b1 / GM: the data has no confirmed store leader and second GM (make the copy with tests/e2e-cs4/data-b1.mjs)');

const st = await fetch(APP + '__csq4').then(r => r.json()).catch(() => null);
ok('server: the csq4 functions were called through the real SQL', st && st.rpcs && ['csq4_assign_save', 'csq4_eval_start', 'csq4_eval_save', 'csq4_eval_act', 'csq4_req_add'].every(f => st.rpcs.includes(f)), st && st.rpcs && [...new Set(st.rpcs)]);
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ results }, null, 1));
process.exit(ng.length ? 1 : 0);
