// v1181（Codex #173・#174 の P3）：保存の答えを待つあいだに足したチェックが、答えのあとの描き直しで消えないことを本物のブラウザ（Chromium）で確かめる。
// 模擬サーバーと合成データだけ（本番にはつながない）。クラウドへの設定の書き込み（app_settings）だけを 4 秒遅らせて「答えを待つあいだ」を作る。
// 使い方：模擬サーバー（tests/perf/server.mjs）を DATA_FILE=<合成データ> で動かしてから  DATA_FILE=<合成データ> node kpi-p3-v1181.mjs [結果の JSON]
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP = 'http://localhost:8080/';
const D = JSON.parse(fs.readFileSync(process.env.DATA_FILE || '/tmp/pcsp/data.json', 'utf8'));
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(tag) {
  const dir = '/tmp/bprobe-' + tag; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: ARGS, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 }, locale: 'ja-JP', timezoneId: 'Pacific/Honolulu' });
  const page = ctx.pages()[0] || await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 160))); page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(APP); await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length > 2, null, { timeout: 120000 }); return { ctx, page, errors };
}
async function login(page, loc, name) {
  await page.evaluate(s => loginPickLocation(s), loc); await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => { const a = document.getElementById('app-shell'); return a && getComputedStyle(a).display !== 'none' && document.getElementById('main-content').children.length > 0; }, null, { timeout: 180000 });
  await page.waitForFunction(() => window._heavyPending === false && !window._uxOpsBusy, null, { timeout: 180000, polling: 100 }); await sleep(2000);
}
async function openUpsell(page, sid) {
  await page.evaluate(s => { window._kpiTab = 'manual'; window._kpiStore = s; go('kpi_master'); }, sid); await sleep(1500);
  return view(page);
}
const view = page => page.evaluate(() => ({
  checked: [...document.querySelectorAll('.kpi-upsell:checked')].map(c => c.value),
  note: /保存していない変更があります/.test((document.getElementById('main-content') || {}).innerText || ''),
}));
const cloud = page => page.evaluate(async () => {
  try { const r = await window.__realFetch(SUPABASE_URL + '/rest/v1/app_settings?key=eq.kpi_config&select=value', { headers: supaHeaders() }); const j = await r.json(); const v = j && j[0] && j[0].value; const u = (v && v.__st) ? v.v : v; return ((u && u.byStore) || {}).F02 ? u.byStore.F02.upsellGuids || null : null; } catch (e) { return String(e); }
});
const out = {};
const A = await open('p3-gm'); await login(A.page, 'OFFICE', D.login.gm);
/* クラウドへの設定の書き込み（app_settings の POST・PATCH）だけを 4 秒遅らせる。読むのはそのまま */
await A.page.evaluate(() => {
  window.__realFetch = window.fetch.bind(window);
  window.fetch = function (u, o) { const m = ((o && o.method) || 'GET').toUpperCase(); const s = String(u && u.url || u);
    if (m !== 'GET' && /\/rest\/v1\/app_settings/.test(s)) return new Promise(r => setTimeout(r, 4000)).then(() => window.__realFetch(u, o));
    return window.__realFetch(u, o); };
});
out.before = await openUpsell(A.page, 'F02');
const vals = await A.page.evaluate(() => [...document.querySelectorAll('.kpi-upsell')].slice(0, 2).map(c => c.value));
await A.page.evaluate(v => { document.querySelectorAll('.kpi-upsell').forEach(c => { c.checked = (c.value === v[0]); }); }, vals);
await A.page.click('[onclick^="saveUpsellGuids"]');
await sleep(800);
await A.page.evaluate(v => { document.querySelectorAll('.kpi-upsell').forEach(c => { if (c.value === v[1]) c.checked = true; }); }, vals);   // 答えを待つあいだに 2 つ目も選ぶ
await sleep(6000);
out.afterFirst = await view(A.page); out.cloud1 = await cloud(A.page);
await A.page.click('[onclick^="saveUpsellGuids"]'); await sleep(6000);
out.afterSecond = await view(A.page); out.cloud2 = await cloud(A.page);
/* 3 つ目を待つあいだに選んでからログアウト → もう一度ログインすると下書きは残らない（保存した 2 つだけ） */
await A.page.evaluate(() => { const cs = [...document.querySelectorAll('.kpi-upsell')]; if (cs[2]) cs[2].checked = false; });
await A.page.click('[onclick^="saveUpsellGuids"]'); await sleep(800);
await A.page.evaluate(() => { const cs = [...document.querySelectorAll('.kpi-upsell')]; if (cs[2]) cs[2].checked = true; });
await sleep(6000);
out.beforeLogout = await view(A.page);
out.draftBeforeLogout = await A.page.evaluate(() => !!window._upsellDraft);
await A.page.evaluate(() => doLogout()); await sleep(1500);
out.draftAfterLogout = await A.page.evaluate(() => window._upsellDraft);
out.errors = A.errors;
await A.ctx.close();
const res = []; const ok = (n, c, i) => { res.push({ n, ok: !!c }); console.log((c ? 'OK  ' : 'NG  ') + n + (i !== undefined ? '  ' + JSON.stringify(i) : '')); };
ok('店の画面にチェックが 2 つ以上ある（合成データ）', vals.length === 2, vals);
ok('① 保存したのは押したときの 1 つ（クラウド）', JSON.stringify(out.cloud1) === JSON.stringify([vals[0]]), out.cloud1);
ok('① 答えのあとの描き直しでも、待つあいだに足した 2 つ目が残る', JSON.stringify(out.afterFirst.checked.slice().sort()) === JSON.stringify(vals.slice().sort()), out.afterFirst.checked);
ok('① 「保存していない変更があります」と出る', out.afterFirst.note === true);
ok('もう一度「保存」で 2 つともクラウドに入り、知らせは消える', JSON.stringify((out.cloud2 || []).slice().sort()) === JSON.stringify(vals.slice().sort()) && out.afterSecond.note === false, { cloud: out.cloud2, note: out.afterSecond.note });
ok('ログアウトで下書きを捨てる', out.draftBeforeLogout === true && out.draftAfterLogout === null, { before: out.draftBeforeLogout, after: out.draftAfterLogout });
ok('pageerror 0', !out.errors.length, out.errors);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ out, res }, null, 1));
process.exit(res.every(r => r.ok) ? 0 : 1);
