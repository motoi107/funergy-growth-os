// v1177（UI案85）：点検一覧で「開いていない」だった予実・マイページ・本部の箱 24 個を開いて測る（模擬サーバー・合成データだけ）。
// 画面とそのタブを回り、onclick にその関数がある押すところを見つけたら、その onclick をそのまま実行して開く。
// 見つからない箱は、合成データの値で直接開く（FALLBACK）。保存・送信・削除は押さない。
// 使い方：模擬サーバーを立ててから WIDTH=390 node boxes-v1177.mjs out.json   （SHOTS=<フォルダ> で画像も）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data.json', 'utf8')).login;
const W = Number(process.env.WIDTH || 390), OUT = process.argv[2], SHOTS = process.env.SHOTS || '';
const mobile = W < 768;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 箱：[点検一覧の行, 名前, 関数, 直接開くときの式] */
const BOXES = [
  [67, '保存状況の確認', 'openBudgetSaveDiag', "openBudgetSaveDiag()"],
  [67, 'KPI の内訳', 'openKpiDetail', null],
  [67, '予算の考え方（提出前・必須）', 'submitBudget', "submitBudget('F01')"],
  [67, '施策の編集', 'initEdit', null],
  [67, 'イベント', 'openEventModal', "openEventModal('F01', bizToday())"],
  [67, '日のメモ', 'openDayMemo', "openDayMemo('F01', bizToday(), 1)"],
  [67, '日の実績', 'openDailyActualModal', "openDailyActualModal('F01', bizToday(), 1)"],
  [68, '仕入れの書類', 'ipsOpenDoc', "var U='11111111-1111-4111-8111-111111111111', ym=bizYm(); window.__ipsM0=window.__ipsM0||ipsMonth; ipsMonth=function(y){ return { generated_at:'g1', stores:{ F01:{ docs:[{ id:U, vn:'合成の業者', no:'A-100', d:ym+'-03', c:12345, cost:12000, non:345, cat:'A', why:[], rc:'reconciled', qb:'sent', qat:ym+'-04', st:'posted', pm:'auto', fn:'synthetic.pdf' }], vendors:[{ k:'v_syn', n:'合成の業者', a:{c:1}, p:{c:0} }] } } }; }; _ipsLines['invoice_purchase_lines_'+ym+'_F01']={ generated_at:'g1', docs:{} }; _ipsLines['invoice_purchase_lines_'+ym+'_F01'].docs[U]={ h:{ sub:12000, tax:345 }, l:[[1,'合成の品目 A',2,'CS',6000,6000,'food','m'],[2,'合成の品目 B',1,'EA',6000,6000,'food','v']] }; ipsOpenDoc(ym, 'F01', U)"],
  [68, '仕入れの照合', 'ipsCheckOpen', "var U='11111111-1111-4111-8111-111111111111', ym=bizYm(); window.__ipsM0=window.__ipsM0||ipsMonth; ipsMonth=function(y){ return { generated_at:'g1', stores:{ F01:{ docs:[{ id:U, vn:'合成の業者', no:'A-100', d:ym+'-03', c:12345, cost:12000, non:345, cat:'A', why:[], rc:'reconciled', qb:'sent', qat:ym+'-04', st:'posted', pm:'auto', fn:'synthetic.pdf' }], vendors:[{ k:'v_syn', n:'合成の業者', a:{c:1}, p:{c:0} }] } } }; }; _ipsLines['invoice_purchase_lines_'+ym+'_F01']={ generated_at:'g1', docs:{} }; _ipsLines['invoice_purchase_lines_'+ym+'_F01'].docs[U]={ h:{ sub:12000, tax:345 }, l:[[1,'合成の品目 A',2,'CS',6000,6000,'food','m'],[2,'合成の品目 B',1,'EA',6000,6000,'food','v']] }; ipsCheckOpen(ym, 'F01', 'v_syn')"],
  [69, '勤怠の修正', 'openAttFixModal', "openAttFixModal('F01', (function(){ var d=new Date(bizToday()+'T12:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })())"],
  [69, '残業の上限', 'openOwLimitsModal', "openOwLimitsModal()"],
  [69, '勤怠入力', 'openLaborHourModal', "openLaborHourModal('F01', (getEmployees().filter(function(e){ return e.store==='F01'; })[0]||{}).name)"],
  [70, 'エラーの解除', 'ecOpenResolve', null],
  [71, '丼カウント対象商品', 'openBowlCatModal', "openBowlCatModal('F04-K')"],
  [71, 'モディファイヤーの中身', 'showStoreModifiers', "showStoreModifiers('F04-K')"],
  [408, 'Tip の内訳', 'showMyTipDetail', "showMyTipDetail('F01', (getEmployees().filter(function(e){ return e.store==='F01' && e.role==='crew'; })[0]||{}).name)"],
  [408, 'Tip Rate の申請', 'openTipApplyFromSkill', "openTipApplyFromSkill('F01', 90)"],
  [408, 'Leader を目指す', 'openSelfAspiration', "openSelfAspiration()"],
  [419, '採点', 'openCcScoreModal', "openCcScoreModal(bizYm(), 'F01', (ccMetrics().filter(function(m){ return m.type!=='check'; })[0]||{}).id)"],
  [419, '行動の記録', 'openCcDohModal', "openCcDohModal(bizYm(), 'F01', (ccMetrics().filter(function(m){ return m.type==='check'; })[0]||ccMetrics()[0]||{}).id)"],
  [419, '指標', 'openCcMetricModal', null],
  [419, '結果報告', 'openCcResultModal', "window.__ccA0=window.__ccA0||ccActions; ccActions=function(){ return [{ id:'syn1', what:'合成の行動（テスト）', due:bizYm()+'-25', result:'', resultNote:'' }]; }; openCcResultModal(bizYm(), 'syn1')"],
  [419, '目標', 'openCcGoalModal', null],
  [419, '行動', 'openCcActionModal', "openCcActionModal(bizYm())"],
];
/* 回る所：[画面, 店, 先に実行する式（タブ）] */
const STOPS = [
  ['budget', 'F01', "setBudgetTab('daily')"], ['budget', 'F01', null], ['budget', 'F01', "setBudgetTab('initiative')"],
  ['budget', 'F01', "setBudgetTab('setup')"], ['budget', 'F01', "setBudgetTab('meeting')"],
  ['purchase', 'F01', null], ['labor', 'F01', null], ['attendance', 'F01', null], ['labor', 'F01', "laborTab='hours';renderPage('labor')"],
  ['mid_review', 'ALL', null], ['error_center', 'ALL', null],
  ['kpi_master', 'F04-K', null], ['kpi_master', 'F04-K', "window._kpiTab='manual';renderPage('kpi_master')"],
  ['mypage', 'ALL', null],
  ['cc_plan', 'F01', null], ['cc_plan', 'F01', "setCcTab('actual')"], ['cc_plan', 'F01', "setCcTab('review')"], ['cc_plan', 'F01', "setCcTab('setting')"],
];

const dir = '/tmp/pcsp-boxes-' + W; fs.rmSync(dir, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
  viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
page.on('dialog', d => d.dismiss().catch(() => {}));
ctx.on('page', p => { if (p !== page) p.close().catch(() => {}); });
await page.goto(APP);
await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
await page.evaluate(l => loginPickLocation(l), 'OFFICE');
await page.locator('#login-name-grid .store-btn', { hasText: DATA.gm }).first().click();
await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
await sleep(2500);

const measure = () => page.evaluate(() => {
  try { if (window.FUNERGY_LAYOUT && window.FUNERGY_LAYOUT.run) window.FUNERGY_LAYOUT.run(); } catch (e) { }
  const ov = document.getElementById('modal-overlay'); if (!ov || !ov.classList.contains('open')) return null;
  const mb = document.getElementById('modal-body'), rr = mb.getBoundingClientRect(), vw = innerWidth;
  const ZOOM = parseFloat(getComputedStyle(document.body).zoom) || 1;
  let fontSmall = 0, fontEx = [], overflow = 0, ovEx = [], tiny = 0, tinyEx = [], inputs = 0, tables = 0;
  const clipAnc = el => { let a = el.parentElement; while (a && a !== mb.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return a; a = a.parentElement; } return null; };
  for (const el of mb.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none') continue;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'hidden') inputs++;
    if (el.tagName === 'TABLE') tables++;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText && parseFloat(s.fontSize) * ZOOM < 10.95) { fontSmall++; if (fontEx.length < 5) fontEx.push(el.tagName.toLowerCase() + '「' + (el.textContent || '').trim().slice(0, 18) + '」' + s.fontSize); }
    if (r.right > Math.min(vw, rr.right) + 1.5 && !clipAnc(el)) { overflow++; if (ovEx.length < 3) ovEx.push(el.tagName.toLowerCase() + '「' + (el.textContent || '').trim().slice(0, 18) + '」'); }
    /* 押すところの大きさはスマホだけ（PC はマウスなので 44px の決まりを当てない）。label の中の印（ラジオ・チェック）は label が押す範囲 */
    const inLabel = el.matches('input') && el.closest('label') && (el.closest('label').hasAttribute('data-hit') || el.closest('label').getBoundingClientRect().height >= 28);
    if (vw < 768 && !inLabel && el.matches('button, a[href], [onclick], input, select, textarea') && (r.width < 32 || r.height < 28) && !el.hasAttribute('data-hit')) { tiny++; if (tinyEx.length < 4) tinyEx.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '') + '「' + (el.innerText || el.value || '').trim().slice(0, 12) + '」' + Math.round(r.width) + '×' + Math.round(r.height)); }
  }
  const title = ((mb.querySelector('.modal-title') || {}).innerText || '').replace(/\s+/g, ' ').replace('×', '').trim().slice(0, 40);
  return { title, w: Math.round(rr.width), vw, full: rr.width >= vw - 2 ? 1 : 0, msize: mb.getAttribute('data-msize') || '', inputs, tables, fontSmall, fontEx, overflow, ovEx, tiny, tinyEx,
    docOv: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth };
});

const found = {};
const todo = () => BOXES.filter(b => !found[b[2]]).map(b => b[2]);
for (const [pg, st, pre] of STOPS) {
  if (!todo().length) break;
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  await page.evaluate(s => { try { switchStore(s); } catch (e) { } }, st); await sleep(500);
  await page.evaluate(p => { try { go(p); } catch (e) { } }, pg); await sleep(900);
  if (pre) { await page.evaluate(c => { try { (new Function(c))(); } catch (e) { } }, pre); await sleep(900); }
  const hits = await page.evaluate(fns => {
    const out = {};
    for (const el of document.querySelectorAll('#main-content [onclick]')) {
      const oc = el.getAttribute('onclick') || '';
      for (const f of fns) if (!out[f] && new RegExp('(^|[^A-Za-z0-9_$.])' + f.replace('$', '\\$') + '\\(').test(oc) && !/save|delete|remove|submit\w|approve|reject|send|post\w|apply/i.test(oc.replace(f, ''))) out[f] = oc;
    }
    return out;
  }, todo());
  for (const [fn, oc] of Object.entries(hits)) {
    await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
    await page.evaluate(oc => { try { (new Function(oc)).call(document.body); } catch (e) { } }, oc);
    await sleep(1500);
    const m = await measure();
    if (m) { found[fn] = { via: pg + (pre ? ' › ' + pre : ''), oc: oc.slice(0, 90), ...m }; if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/box_' + fn + '__' + W + '.jpg', type: 'jpeg', quality: 60 }); } }
    await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
    const cp = await page.evaluate(() => curPage); if (cp !== pg) { await page.evaluate(p => { try { go(p); } catch (e) { } }, pg); await sleep(600); if (pre) { await page.evaluate(c => { try { (new Function(c))(); } catch (e) { } }, pre); await sleep(600); } }
  }
}
for (const b of BOXES) {
  if (found[b[2]] || !b[3]) continue;
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  await page.evaluate(() => { try { switchStore('F01'); go('budget'); } catch (e) { } }); await sleep(700);
  await page.evaluate(c => { try { (new Function(c))(); } catch (e) { } }, b[3]); await sleep(1800);
  const m = await measure();
  await page.evaluate(() => { try { if (window.__ipsM0) { ipsMonth = window.__ipsM0; window.__ipsM0 = null; } if (window.__ccA0) { ccActions = window.__ccA0; window.__ccA0 = null; } } catch (e) { } });   /* 合成の値は開いたあとすぐ戻す（保存しない） */
  if (m) { found[b[2]] = { via: /ipsMonth=|ccActions=/.test(b[3]) ? 'direct（合成の値をこのページだけに入れて開いた）' : 'direct', oc: b[3], ...m }; if (SHOTS) await page.screenshot({ path: SHOTS + '/box_' + b[2] + '__' + W + '.jpg', type: 'jpeg', quality: 60 }); }
}
const result = { W, version: await page.evaluate(() => APP_VERSION), boxes: BOXES.map(b => ({ row: b[0], name: b[1], fn: b[2], ...(found[b[2]] || { notOpened: true }) })), errors: errors.slice(0, 20) };
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
for (const b of result.boxes) console.log(b.row, b.fn, b.notOpened ? 'NOT OPENED' : `w${b.w} full${b.full} msize=${b.msize} in${b.inputs} tb${b.tables} small${b.fontSmall} ov${b.overflow} tiny${b.tiny} docOv${b.docOv} ${JSON.stringify(b.fontEx)} ${JSON.stringify(b.tinyEx)}`);
console.log('errors', JSON.stringify(result.errors.slice(0, 5)));
await ctx.close();
