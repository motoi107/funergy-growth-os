// v1172：上のバー・グループのナビ・ページのナビを、役割 × 幅で測る（合成データ・模擬サーバー・本番にはつながない）
// 測るもの：今の場所が見えているか・横に送れるときの印（data-more）・押せる範囲（data-hit で広げた分も入れる）の高さ・店の名前が切れるか・ページの横のはみ出し
// 使い方：cd "$PCSP_DIR" && node <repo>/tests/perf/pcsp/navcheck.mjs  → navcheck.json
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const DIR = process.env.PCSP_DIR || '/tmp/pcsp';
const DATA = JSON.parse(fs.readFileSync(DIR + '/data.json', 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
const WIDTHS = (process.env.WIDTHS || '390,768,1440').split(',').map(Number);
for (const WHO of (process.env.WHOS || 'gm,sl,crew').split(',')) for (const W of WIDTHS) {
  const touch = W < 1024;   /* 768px はタブレット（タッチ）として */
  const dir = '/tmp/pcsp-navc-' + WHO + W; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: W, height: W < 768 ? 844 : 900 }, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = ctx.pages()[0]; page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto('http://localhost:8080/');
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 });
  const who = WHO === 'gm' ? { loc: 'OFFICE', name: DATA.gm } : WHO === 'sl' ? { loc: DATA.slStore, name: DATA.sl } : { loc: DATA.crewStore, name: DATA.crew };
  await page.evaluate(l => loginPickLocation(l), who.loc);
  await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 120000, polling: 200 }).catch(() => {});
  await sleep(2000);
  if (WHO === 'gm') { await page.evaluate(() => switchStore('ALL')); await sleep(1000); }
  const groups = await page.evaluate(() => groupsForRole().map(g => g.id));
  const res = [];
  for (const g of groups) {
    await page.evaluate(g => { const gr = groupsForRole().find(x => x.id === g); const c = (gr.children || []).filter(x => typeof navChildAllowed !== 'function' || navChildAllowed(x)); if (c[0]) go(c[0]); }, g);
    await sleep(700);
    res.push(Object.assign({ g }, await page.evaluate(() => {
      const eff = el => { const r = el.getBoundingClientRect(), v = k => parseFloat(el.style.getPropertyValue(k)) || 0; return { w: r.width + v('--hl') + v('--hr'), h: r.height + v('--ht') + v('--hb') }; };
      const bar = (sel, item) => {
        const b = document.querySelector(sel); if (!b || !b.getClientRects().length) return null;
        const br = b.getBoundingClientRect(), items = [...b.querySelectorAll(item)].filter(i => i.getClientRects().length);
        const act = b.querySelector('.active'), ar = act ? act.getBoundingClientRect() : null;
        return { more: b.scrollWidth > b.clientWidth + 2, mark: b.getAttribute('data-more') || '', activeSeen: ar ? (ar.left >= br.left - 1 && ar.right <= br.right + 1) : null,
          minH: items.length ? Math.round(Math.min(...items.map(i => eff(i).h))) : null };
      };
      const tb = document.querySelector('.topbar'), store = document.getElementById('topbar-store');
      const tbItems = tb ? [...tb.querySelectorAll('button, [onclick]')].filter(b => b.getClientRects().length && !(b.parentElement && b.parentElement.closest('button, [onclick]'))) : [];
      return { nav: bar('.nav-bar', '.nav-btn'), sub: bar('.subnav-bar', '.subnav-chip'),
        storeClipped: store ? store.scrollWidth > store.clientWidth + 1 : null,
        topMinH: tbItems.length ? Math.round(Math.min(...tbItems.map(b => eff(b).h))) : null,
        ov: document.documentElement.scrollWidth - innerWidth };
    })));
  }
  out[WHO + '-' + W] = res;
  const s = res.reduce((a, r) => { a.n++; if (r.nav && r.nav.more && !r.nav.mark) a.navNoMark++; if (r.nav && r.nav.activeSeen === false) a.navActHidden++; if (r.sub && r.sub.activeSeen === false) a.subActHidden++; if (r.sub && r.sub.more && !r.sub.mark) a.subNoMark++; if (r.storeClipped) a.storeClip++; if (r.ov > 2) a.ov++; a.navMinH = Math.min(a.navMinH, r.nav ? r.nav.minH ?? 99 : 99); a.subMinH = Math.min(a.subMinH, r.sub ? r.sub.minH ?? 99 : 99); a.topMinH = Math.min(a.topMinH, r.topMinH ?? 99); return a; }, { n: 0, navNoMark: 0, navActHidden: 0, subActHidden: 0, subNoMark: 0, storeClip: 0, ov: 0, navMinH: 99, subMinH: 99, topMinH: 99 });
  console.log(WHO, W, JSON.stringify(s));
  await ctx.close();
}
fs.writeFileSync(DIR + '/navcheck.json', JSON.stringify(out, null, 1));

// v1185：GM・CEO・経理は名前を選ぶとメールとパスワードの段が出る。試しのあいだは「PIN でログイン」で今までどおり PIN の段へ（ほかの人は何もしない）
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
