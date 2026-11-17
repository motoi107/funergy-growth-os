// v1178（UI案86）：経理レビュー・設定・診断と記録・経理センターの、点検一覧で「開いていない」だった箱を開いて測る（模擬サーバー・合成データだけ）。
// どれも、その画面を開いてから関数を直接呼んで開く（押すところは画面の中にあるが、箱を開くだけで保存・送信・削除は押さない）。
// 使い方：模擬サーバーを立ててから WIDTH=390 node boxes-v1178.mjs out.json   （SHOTS=<フォルダ> で画像も）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data.json', 'utf8')).login;
const W = Number(process.env.WIDTH || 390), OUT = process.argv[2], SHOTS = process.env.SHOTS || '';
const mobile = W < 768;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 箱：[点検一覧の行, 名前, 関数, 開く前の画面, 開く式] */
const DOC = "(arReviewList().find(function(x){ return (x.reviewStatus||'未確認')==='未確認'; })||{}).id";
const BOXES = [
  [418, '差し戻し（理由）', 'arRejectModal', 'acct_review', "arRejectModal(" + DOC + ")"],
  [389, '削除の確認', 'deleteInvoiceConfirm', 'acct_review', "deleteInvoiceConfirm(" + DOC + ")"],
  [389, '書類の確認（スマホの箱）', 'arOpenBox', 'acct_review', "arOpenBox(" + DOC + ")"],
  [409, '断られたものを外す', 'openRefusedDrop', 'diag_center', "openRefusedDrop()"],
  [409, 'GM承認済み予算の復元', 'openApprovedBudgetModal', 'diag_center', "openApprovedBudgetModal()"],
  [398, '送れていない保存の一覧', 'openOutboxDiag', 'diag_center', "openOutboxDiag()"],
  [398, '容量を整理', 'openStorageManager', 'diag_center', "openStorageManager()"],
  [409, '画面ごとの診断', 'openDiag', 'diag_center', "openDiag('tip')"],
  [409, 'PL の内訳（区分）', 'openPlClassModal', 'acct_center', "secTab('pl'); openPlClassModal('food')"],
  [409, 'PL の明細', 'openPlDetailModal', 'acct_center', "secTab('pl'); openPlDetailModal('F01','get')"],
  [409, 'PL の設定', 'openPlConfigModal', 'acct_center', "secTab('pl'); openPlConfigModal('F01')"],
  [409, 'PL の上書き', 'openPlOverrideModal', 'acct_center', "secTab('pl'); openPlOverrideModal('F01')"],
  [409, 'PL の実績', 'openPlActualModal', 'acct_center', "secTab('pl'); openPlActualModal('F01')"],
];

const dir = '/tmp/pcsp-boxes78-' + W; fs.rmSync(dir, { recursive: true, force: true });
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
await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
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
for (const b of BOXES) {
  await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
  await page.evaluate(p => { try { switchStore('ALL'); go(p); } catch (e) { } }, b[3]); await sleep(900);
  await page.evaluate(c => { try { (new Function(c))(); } catch (e) { window.__boxErr = String(e && e.message || e); } }, b[4]); await sleep(1800);
  const m = await measure();
  if (m) { found[b[2]] = { via: b[3] + ' → ' + b[4].slice(0, 60), ...m }; if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/box_' + b[2] + '__' + W + '.jpg', type: 'jpeg', quality: 60 }); } }
  else found[b[2]] = { notOpened: true, err: await page.evaluate(() => { const e = window.__boxErr; window.__boxErr = null; return e || null; }) };
}
await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
const result = { W, version: await page.evaluate(() => APP_VERSION), boxes: BOXES.map(b => ({ row: b[0], name: b[1], fn: b[2], ...found[b[2]] })), errors: errors.slice(0, 20) };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
for (const b of result.boxes) console.log(b.row, b.fn, b.notOpened ? 'NOT OPENED ' + (b.err || '') : `w${b.w} full${b.full} msize=${b.msize} in${b.inputs} tb${b.tables} small${b.fontSmall} ov${b.overflow} tiny${b.tiny} docOv${b.docOv} ${JSON.stringify(b.fontEx)} ${JSON.stringify(b.tinyEx)}`);
console.log('errors', JSON.stringify(result.errors.slice(0, 5)));
await ctx.close();

// v1185：GM・CEO・経理は名前を選ぶとメールとパスワードの段が出る。試しのあいだは「PIN でログイン」で今までどおり PIN の段へ（ほかの人は何もしない）
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
