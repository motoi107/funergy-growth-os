// 上のバー・グループのナビ・ページのナビ（全画面に共通）を幅ごとに測る
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const DATA = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/data.json', 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
for (const WHO of ['gm', 'sl', 'crew']) for (const W of [390, 768, 1440]) {
  const mobile = W < 768;
  const dir = '/tmp/pcsp-nav-' + WHO + W; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: W, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile || W === 768, deviceScaleFactor: mobile ? 2 : 1 });
  const page = ctx.pages()[0]; page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  const who = WHO === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : WHO === 'sl' ? { loc: DATA.slStore, name: DATA.sl } : { loc: DATA.crewStore, name: DATA.crew };
  const login = await page.evaluate(() => { const b = document.getElementById('login-pin-btn'); const r = b ? b.getBoundingClientRect() : null; return { ov: document.documentElement.scrollWidth - innerWidth }; });
  await page.evaluate(l => loginPickLocation(l), who.loc);
  await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
  const pinScreen = await page.evaluate(() => { const b = document.getElementById('login-pin-btn'), i = document.getElementById('login-pin-input'); const rb = b.getBoundingClientRect(), ri = i.getBoundingClientRect(); return { btnH: Math.round(rb.height), inH: Math.round(ri.height), ov: document.documentElement.scrollWidth - innerWidth }; });
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(2000);
  if (WHO === 'gm') { await page.evaluate(() => switchStore('ALL')); await sleep(1000); }
  const groups = await page.evaluate(() => groupsForRole().map(g => g.id));
  const res = { login, pinScreen, groups: [] };
  for (const g of groups) {
    await page.evaluate(g => { const gr = groupsForRole().find(x => x.id === g); const c = (gr.children || []).filter(x => typeof navChildAllowed !== 'function' || navChildAllowed(x)); if (c[0]) go(c[0]); }, g);
    await sleep(500);
    const m = await page.evaluate(() => {
      const nb = document.querySelector('.nav-bar'), sb = document.querySelector('.subnav-bar'), tb = document.querySelector('.topbar') || document.querySelector('header');
      const vis = (bar, sel) => { if (!bar) return null; const br = bar.getBoundingClientRect(); const items = [...bar.querySelectorAll(sel)]; const hid = items.filter(i => { const r = i.getBoundingClientRect(); return r.right > br.right + 1 || r.left < br.left - 1; }).map(i => i.innerText.trim()); const act = bar.querySelector('.active'); const ar = act ? act.getBoundingClientRect() : null; return { n: items.length, hidden: hid, activeHidden: !!(ar && (ar.right > br.right + 1 || ar.left < br.left - 1)), minH: Math.min(...items.map(i => Math.round(i.getBoundingClientRect().height))) }; };
      const store = document.getElementById('topbar-store'); const sr = store ? store.getBoundingClientRect() : null;
      const tbItems = tb ? [...tb.querySelectorAll('button, [onclick]')].map(b => b.getBoundingClientRect()).filter(r => r.width) : [];
      const fab = [...document.querySelectorAll('body > *')].find(e => getComputedStyle(e).position === 'fixed' && /チャット|chat/i.test(e.innerText || e.className || ''));
      return { nav: vis(nb, '.nav-btn'), sub: vis(sb, '.subnav-chip'), storeClipped: store ? store.scrollWidth > store.clientWidth + 1 : null, storeW: sr ? Math.round(sr.width) : null, topbarMinH: tbItems.length ? Math.min(...tbItems.map(r => Math.round(r.height))) : null, ov: document.documentElement.scrollWidth - innerWidth, fab: fab ? (() => { const r = fab.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(innerHeight - r.bottom) }; })() : null };
    });
    res.groups.push({ g, ...m });
  }
  out[WHO + '-' + W] = res;
  console.log(WHO, W, JSON.stringify(res.groups.map(x => [x.g, x.nav && x.nav.hidden.length, x.sub && x.sub.hidden.length, x.sub && x.sub.activeHidden])));
  await ctx.close();
}
fs.writeFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/nav.json', JSON.stringify(out, null, 1));
