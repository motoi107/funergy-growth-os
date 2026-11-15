// PC・スマホの棚卸し：全ページ・全タブを開いて、幅ごとに崩れを測る（模擬サーバー・合成データだけ）。
// 使い方：WIDTH=1440 WHO=gm STORE=ALL node crawl.mjs out.json
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data.json', 'utf8')).login;
const W = Number(process.env.WIDTH || 1440);
const WHO = process.env.WHO || 'gm';
const STORE = process.env.STORE || 'ALL';
const ONLY = (process.env.PAGES || '').split(',').filter(Boolean);
const OUT = process.argv[2];
const SHOTS = process.env.SHOTS || '';
const mobile = W < 768;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dir = '/tmp/pcsp-' + WHO + '-' + W + '-' + STORE; fs.rmSync(dir, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true,
  viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
page.on('dialog', d => d.dismiss().catch(() => {}));
ctx.on('page', p => { if (p !== page) p.close().catch(() => {}); });
await page.goto(APP);
await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
const who = WHO === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : WHO === 'sl' ? { loc: DATA.slStore, name: DATA.sl } : { loc: DATA.crewStore, name: DATA.crew };
await page.evaluate(l => loginPickLocation(l), who.loc);
await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 120000, polling: 100 });
await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
await sleep(2500);
if (WHO === 'gm' && STORE !== 'OFFICE') { await page.evaluate(s => switchStore(s), STORE); await sleep(1500); }

// ページの一覧：renderPage の switch にある名前すべて（別名・転送は外す）
const pages = await page.evaluate(() => {
  const src = String(renderPage);
  const ids = []; const re = /case '([a-z_0-9]+)':/g; let m;
  while ((m = re.exec(src))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  const nav = []; try { groupsForRole().forEach(g => (g.children || []).forEach(c => { if (nav.indexOf(c) < 0) nav.push(c); })); } catch (e) { }
  return { ids, nav };
});
const list = (ONLY.length ? ONLY : (WHO === 'gm' ? pages.ids : pages.nav)).filter(p => ['mgmt_dash', 'office_mgr'].indexOf(p) < 0);

const measure = (label) => page.evaluate((label) => {
  /* v1172：重い画面は描き終わる直後に測ることがある。FUNERGY_LAYOUT の待っている印付け（描いて 120ms のあと）を先に走らせて、人が見る状態で測る */
  try { if (window.FUNERGY_LAYOUT && window.FUNERGY_LAYOUT.run) window.FUNERGY_LAYOUT.run(); } catch (e) { }
  const vw = innerWidth, vh = innerHeight;
  const main = document.querySelector('.main'); const mc = document.getElementById('main-content');
  const ov = document.getElementById('modal-overlay'); const modalOpen = ov && ov.classList.contains('open');
  const root = modalOpen ? document.getElementById('modal-body') : mc;
  const mr = main.getBoundingClientRect(); const rr = root.getBoundingClientRect();
  const docOv = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth;
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null; return r; };
  const clipAnc = el => { let a = el.parentElement; while (a && a !== document.body) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return a; a = a.parentElement; } return null; };
  const desc = el => { const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30); return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '') + (t ? '「' + t + '」' : ''); };
  let overflow = [], clipped = [], scrollers = [], tapSmall = 0, tapTiny = 0, tapTotal = 0, tapEx = [], fontSmall = 0, fontEx = [], tables = 0, tablesScroll = 0, inputs = 0;
  const all = root.querySelectorAll('*');
  const right = Math.min(vw, modalOpen ? rr.right : vw);
  for (const el of all) {
    const r = vis(el); if (!r) continue;
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 2) scrollers.push({ el: desc(el), sw: el.scrollWidth, cw: el.clientWidth });
    if (el.tagName === 'TABLE') { tables++; const a = clipAnc(el); if (a && a.scrollWidth > a.clientWidth + 2) tablesScroll++; }
    if (r.right > right + 1.5 && r.left < right) {
      const a = clipAnc(el);
      if (!a) overflow.push(desc(el));
      else { const ar = a.getBoundingClientRect(); const sx = getComputedStyle(a).overflowX; if (/(hidden|clip)/.test(sx) && r.right > ar.right + 1.5 && r.left < ar.right) clipped.push(desc(el)); }
    }
    const inter = el.matches('button, a[href], [onclick], input:not([type=hidden]), select, textarea, [role=button], label[for]') && !(el.parentElement && el.parentElement.closest('button, a[href], [onclick]'));
    if (inter) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) inputs++;
      tapTotal++;
      /* v1172：押せる範囲を広げた所（data-hit の ::after）は、広げた範囲で測る（はみ出しを切る親で切る） */
      let er = r;
      if (el.hasAttribute('data-hit')) {
        const v = k => parseFloat(el.style.getPropertyValue(k)) || 0;
        let L0 = r.left - v('--hl'), R0 = r.right + v('--hr'), T0 = r.top - v('--ht'), B0 = r.bottom + v('--hb');
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const st = getComputedStyle(a); if (st.overflowX !== 'visible' || st.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); L0 = Math.max(L0, ar.left); R0 = Math.min(R0, ar.right); T0 = Math.max(T0, ar.top); B0 = Math.min(B0, ar.bottom); } }
        er = { width: Math.max(0, R0 - L0), height: Math.max(0, B0 - T0) };
      }
      if (er.width < 43.5 || er.height < 43.5) { tapSmall++; if (er.width < 32 || er.height < 28) { tapTiny++; if (tapEx.length < 6) tapEx.push(desc(el) + ' ' + Math.round(er.width) + '×' + Math.round(er.height)); } }
    }
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText && parseFloat(s.fontSize) < 11) { fontSmall++; if (fontEx.length < 4) fontEx.push(desc(el) + ' ' + s.fontSize); }
  }
  // PC：横に並んでいる塊があるか（.card などの塊の左端の位置の数）
  const blocks = [...root.querySelectorAll('.card, .kpi-card, .md-card, section, .stat-card, table')].map(vis).filter(r => r && r.width > 140 && r.height > 40);
  let side = 1; const rows = {};
  blocks.forEach(r => { const k = Math.round(r.top / 24); (rows[k] = rows[k] || []).push(r); });
  Object.values(rows).forEach(rs => { const xs = new Set(rs.map(r => Math.round(r.left / 20))); side = Math.max(side, xs.size); });
  const wide = blocks.filter(r => r.width > rr.width * 0.85).length;
  // タブの列（隠れているタブ）
  const tabbars = [...root.querySelectorAll('.phase-tabs, .seg-tabs, .mm-tabs, .mn-tabs, .up-tabs, [role=tablist]')].map(t => ({ n: t.children.length, hidden: t.scrollWidth > t.clientWidth + 2 && !/(wrap)/.test(getComputedStyle(t).flexWrap) }));
  const title = (root.querySelector('.section-title, h2, .modal-title, h3') || {}).innerText || '';
  return {
    label, modal: !!modalOpen, vw, vh, title: title.replace(/\s+/g, ' ').trim().slice(0, 60),
    mainW: Math.round(mr.width), mainMax: getComputedStyle(main).maxWidth, rootW: Math.round(rr.width), zoom: getComputedStyle(document.body).zoom,
    docOv, overflowN: overflow.length, overflowEx: [...new Set(overflow)].slice(0, 5), clippedN: clipped.length, clippedEx: [...new Set(clipped)].slice(0, 4),
    scrollers: scrollers.slice(0, 6), tables, tablesScroll, tapTotal, tapSmall, tapTiny, tapEx, fontSmall, fontEx, inputs,
    side, wideBlocks: wide, blocks: blocks.length, heightScreens: +(document.documentElement.scrollHeight / vh).toFixed(1),
    tabbars, textLen: (root.innerText || '').length,
    /* v1172 の印：表の名前の列の固定・表の中の横送り・全画面の箱・箱の大きさ */
    stick1: root.querySelectorAll('table[data-stick1]').length, ovx: root.querySelectorAll('table[data-ovx]').length,
    mfull: modalOpen && rr.width >= vw - 2 ? 1 : 0, msize: modalOpen ? (document.getElementById('modal-body').getAttribute('data-msize') || '') : '', hits: root.querySelectorAll('[data-hit]').length,
    fns: [...new Set([...root.querySelectorAll('[onclick]')].map(e => ((e.getAttribute('onclick') || '').match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/) || [])[1]).filter(Boolean))].slice(0, 200)
  };
}, label);

// 画面の中のタブ（タブらしい押すところ）
const findTabs = () => page.evaluate(() => {
  const mc = document.getElementById('main-content');
  const TABBOX = '.phase-tabs, .mm-tabs, .mn-tabs, .seg-tabs, [role=tablist]';
  const cand = [...mc.querySelectorAll('[onclick]')].filter(el => {
    const oc = el.getAttribute('onclick') || '';
    const inBox = !!(el.parentElement && el.parentElement.closest(TABBOX));
    const looks = /set\w*(Tab|View|Cat|Sub|Mode|Page)\s*\(|Set\('tab'|\b\w*(Tab|tab|View|Cat|Sub)\s*=\s*'/.test(oc);
    if (!inBox && !looks) return false;
    if (/(Store|Scope|Month|Days|Half|Filter|Period\(|Status|Offset|Modal|save|delete|remove|submit|approve|reject|confirm|send|post|upload|toggle)/i.test(oc.replace(/PeriodView/g, 'View'))) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  });
  const byParent = new Map();
  cand.forEach(el => { const p = el.parentElement; (byParent.get(p) || byParent.set(p, []).get(p)).push(el); });
  const out = [];
  byParent.forEach(els => { if (els.length >= 2) els.forEach(el => out.push({ oc: el.getAttribute('onclick'), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24) })); });
  return out;
});
const MODAL_FNS = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/modals.json', 'utf8')).map(m => m.fn);
const findModalOpeners = () => page.evaluate((fns) => {
  const set = new Set(fns); const mc = document.getElementById('main-content'); const seen = new Set(); const out = [];
  for (const el of mc.querySelectorAll('[onclick]')) {
    const oc = el.getAttribute('onclick') || ''; const m = oc.match(/^\s*(?:event\.stopPropagation\(\);\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/); if (!m) continue;
    const fn = m[1]; if (!set.has(fn) || seen.has(fn)) continue;
    if (/(save|delete|remove|submit|approve|reject|send|post|upload|import|export|reset|clear|sync|push|pull|run|apply|lock|close)/i.test(fn)) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    seen.add(fn); out.push({ oc, fn, text: (el.innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 24) });
  }
  return out;
}, MODAL_FNS);

const result = { W, WHO, STORE, version: await page.evaluate(() => APP_VERSION), pages: {}, errors: [] };
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + '/' + name.replace(/[^a-z0-9_.-]/gi, '_') + '.jpg', type: 'jpeg', quality: 55 }).catch(() => {}); };
for (const p of list) {
  const e0 = errors.length; const t0 = Date.now();
  try {
    await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
    const ok = await Promise.race([page.evaluate(p => { try { go(p); return curPage; } catch (e) { return 'ERR ' + e.message; } }, p), sleep(30000).then(() => 'TIMEOUT')]);
    await sleep(900);
    const states = [];
    const m0 = await measure(p); m0.cur = ok; states.push(m0); await shot(p + '__s0__' + W);
    // タブ（2 段まで）
    const seen = new Set(); const queue = (await findTabs()).map(t => ({ ...t, path: [t.text], parent: null }));
    let n = 0;
    while (queue.length && n < 24) {
      const t = queue.shift(); if (seen.has(t.oc)) continue; seen.add(t.oc); n++;
      await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
      if (t.parent) { await page.evaluate(oc => { try { (new Function(oc)).call(document.body); } catch (e) { } }, t.parent); await sleep(500); }
      const r = await Promise.race([page.evaluate(oc => { try { (new Function(oc)).call(document.body); return curPage; } catch (e) { return 'ERR ' + e.message; } }, t.oc), sleep(20000).then(() => 'TIMEOUT')]);
      await sleep(700);
      if (r !== p && !(typeof r === 'string' && r.startsWith('ERR'))) { await page.evaluate(p => { try { go(p); } catch (e) { } }, p); await sleep(600); continue; }
      const m = await measure(p + ' › ' + t.path.join(' › ')); m.oc = t.oc.slice(0, 80); m.cur = r; states.push(m);
      await shot(p + '__s' + (states.length - 1) + '__' + W);
      if (t.path.length < 2) { const more = await findTabs(); more.filter(x => !seen.has(x.oc) && !queue.some(q => q.oc === x.oc)).forEach(x => queue.push({ ...x, path: t.path.concat([x.text]), parent: t.oc })); }
    }
    if (process.env.MODALS) {
      await page.evaluate(p => { try { go(p); } catch (e) { } }, p); await sleep(700);
      const ops = (await findModalOpeners()).slice(0, 10);
      for (const o of ops) {
        await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
        await Promise.race([page.evaluate(oc => { try { (new Function(oc)).call(document.body); } catch (e) { } }, o.oc), sleep(15000)]);
        await sleep(700);
        const open = await page.evaluate(() => document.getElementById('modal-overlay').classList.contains('open'));
        if (open) { const m = await measure(p + ' ⧉ ' + (o.text || o.fn)); m.fn = o.fn; states.push(m); await shot(p + '__m' + (states.length - 1) + '__' + W); }
        await page.evaluate(() => { try { closeModalDirect(); } catch (e) { } });
        const cp = await page.evaluate(() => curPage); if (cp !== p) { await page.evaluate(p => { try { go(p); } catch (e) { } }, p); await sleep(600); }
      }
    }
    result.pages[p] = { states, errors: errors.slice(e0), ms: Date.now() - t0 };
  } catch (e) { result.pages[p] = { fail: String(e.message || e).slice(0, 200), errors: errors.slice(e0) }; }
  process.stdout.write(p + ' ' + ((result.pages[p].states || []).length) + '\n');
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
}
result.errors = errors.slice(0, 50);
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
await ctx.close();
