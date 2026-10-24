// v1107：本番 10/24 の「保存結果がまだ確認できていません」で売上・予算がすべて止まる不具合を、模擬サーバー・合成データで確かめる。
// node fin-stuck.mjs --profile <一度ログインした端末のフォルダ> --role gm [--fail F01] [--bump 1] [--wait 8000] --out result.json
//   --bump 1：Toast の売上を少し変える（ログインの取り込みが全店で保存する）
//   --fail F01：その店の保存を、サーバーのエラー（本番の anon の 3 秒の上限で取り消されたときと同じ 500・57014）にする
//   ログイン → 最初の画面 → 待つ → 下の黄色い帯・保護の状態・取得の状態の帯・クラウドの版（ほかの店に書けたか）を記録
//   --reopen 1：ログインせずに開き直す（前の版で残った記録を、この版が起動のときにどう扱うか）
// 計測のログには PIN・本文を出さない。
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APP = arg('app', 'http://localhost:8080/');
const USERDIR = arg('profile');
const ROLE = arg('role', 'gm');
const OUT = arg('out', 'fin-stuck.json');
const WAIT = Number(arg('wait', 8000));
const DATA = JSON.parse(fs.readFileSync(arg('data', process.env.PERF_DATA || 'data.json'), 'utf8')).login;
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'];
const ctl = async (p) => { const t = await (await fetch(new URL(p, APP))).text(); try { return JSON.parse(t); } catch (e) { return t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STORES = ['F01', 'F02', 'F03', 'F03-G', 'F04-A', 'F04-K', 'F04-P', 'F05', 'F06', 'F07'];
const versions = async () => { const o = {}; for (const s of STORES) { const r = await ctl('/__fin_row?key=daily_actuals_' + s); o[s] = r ? r.updated_at : null; } return o; };

const R = { role: ROLE };
if (arg('bump', '')) R.bump = await ctl('/__toast_bump');
if (arg('fail', '')) R.fail = await ctl('/__fin_fail?store=' + arg('fail') + '&n=100000');
R.cloud_before = await versions();
R.stat_before = await ctl('/__fin_stat');
const ctx = await chromium.launchPersistentContext(USERDIR, { headless: true, args: ARGS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 200)));
const t0 = Date.now();
await page.goto(APP, { waitUntil: 'domcontentloaded' });
if (!arg('reopen', '')) {
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { polling: 50, timeout: 60000 });
  await sleep(1500);
  const who = ROLE === 'ceo' ? { loc: 'OFFICE', name: DATA.ceo } : { loc: 'OFFICE', name: DATA.gm };
  await page.evaluate(loc => loginPickLocation(loc), who.loc);
  await page.locator('#login-name-grid .store-btn', { hasText: who.name }).first().click();
  await page.fill('#login-pin-input', '1234');
  await page.click('#login-pin-btn');
  await page.waitForFunction(() => {
    const ap = document.getElementById('app-shell'); const sp = document.getElementById('sync-splash'); const mc = document.getElementById('main-content');
    return ap && getComputedStyle(ap).display !== 'none' && (!sp || sp.style.display === 'none' || getComputedStyle(sp).opacity === '0') && mc && mc.children.length > 0 && !mc.querySelector('.skel');
  }, null, { polling: 50, timeout: 120000 });
}
R.t_screen = Date.now() - t0;
const snap = async () => page.evaluate(() => {
  const st = window.FUNERGY_FINANCIAL_SAVE ? FUNERGY_FINANCIAL_SAVE.getState() : null;
  const panel = document.getElementById('financial-save-status');
  const chips = document.getElementById('fst-chips');
  let rec = null; try { rec = (FUNERGY_FINANCIAL_SAVE.getRecovery() || []).map(x => x.reason); } catch (e) { rec = 'ERR ' + e.message; }
  return { version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null, state: st && { status: st.status, why: st.why || null, notFound: !!st.notFound, auto: !!st.auto, released: st.released || null },
    banner: panel ? panel.textContent.slice(0, 300) : null, chips: chips ? chips.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : null, recovery: rec };
});
R.after_screen = await snap();
await sleep(WAIT);
R.after_wait = await snap();
R.cloud_after = await versions();
R.written = STORES.filter(s => R.cloud_before[s] !== R.cloud_after[s]);
R.stat_after = await ctl('/__fin_stat');
// 帯の「もう一度」：予算（保護の記録を読み直す）
R.budget_retry = await page.evaluate(async () => { try { await fstRetry('budget', true); } catch (e) { return 'ERR ' + e.message; } return fstStatus('budget').state; });
R.errors = errors;
await ctx.close();
fs.writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify({ version: R.after_wait.version, t_screen: R.t_screen, state_screen: R.after_screen.state, state_wait: R.after_wait.state, banner: R.after_wait.banner, chips: R.after_wait.chips,
  written: R.written, failed_on_server: R.stat_after.failed - R.stat_before.failed, budget_retry: R.budget_retry, recovery: R.after_wait.recovery, errors: R.errors }, null, 1));
