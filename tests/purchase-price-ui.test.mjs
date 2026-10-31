// 仕入れの単価を比べる（10/30 の依頼 ②）: the 仕入分析 tab and the dashboard alert in the app, fed by the row the real SQL writes.
// The app's module (index.html, FUNERGY_PRICE_COMPARE) in a VM; the database is PGlite with db/invoice-intake.sql. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const INDEX = process.env.FUNERGY_INDEX ? new URL(process.env.FUNERGY_INDEX, 'file://' + process.cwd() + '/') : new URL('../index.html', import.meta.url);
const html = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
const MOD = html.slice(html.indexOf('/* FUNERGY_PRICE_COMPARE_BEGIN */'), html.indexOf('/* FUNERGY_PRICE_COMPARE_END */'));
const fnSrc = name => { const st = html.indexOf('function ' + name + '('); assert.ok(st >= 0, name); const a = html.lastIndexOf('\n', st) + 1; return html.slice(a, html.indexOf('\n}\n', st) + 3); };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date(Date.now() - 10 * 3600e3).toISOString().slice(0, 10);
const day = k => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };

async function rows() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); create table public.app_state(key text primary key, value json, updated_at timestamptz);`);
  await pg.exec(SQL);
  await pg.exec(`insert into invoice_stores(store_id, label, active) values ('F01','F01',true),('F02','F02',true)`);
  let n = 0;
  const inv = async ({ store = 'F01', vendor = 'v-a', vname = 'Vendor A', date, lines }) => {
    n++;
    const f = (await pg.query(`insert into invoice_files(drive_file_id, store_id, original_name, current_name) values($1,$2,'x.pdf','x.pdf') returning id`, ['drvfile' + n, store])).rows[0].id;
    const d = (await pg.query(`insert into invoice_docs(source_key, file_id, sha256, internal_no, store_id, doc_type, posting_kind, vendor_key, vendor_name, invoice_no, invoice_no_norm,
      invoice_date, effective_date, effective_basis, status, posted_mode) values($1,$2,$1,$1,$3,'invoice','purchase',$4,$5,$6,$6,$7,$7,'invoice','posted','manual') returning id`,
      ['s' + n, f, store, vendor, vname, 'INV-' + (500 + n), date])).rows[0].id;
    let i = 0;
    for (const l of lines) {
      const lid = (await pg.query(`insert into invoice_lines(doc_id, line_no, raw_name, raw, qty, amount_cents, ingredient_code, page, spec_key, purchase_unit, unit_price)
        values($1,$2,'x','{}',$3,$4,$5,1,$6,$7,$8) returning id`, [d, ++i, l.qty, Math.round(l.qty * l.ppp * 100), l.code, l.spec || '', l.pu || 'CS', l.ppp])).rows[0].id;
      if (l.rec === false) continue;   // a confirmed line without a price record (catch weight, unreadable quantity, ...)
      await pg.query(`insert into invoice_price_history(store_id, vendor_key, ingredient_code, spec_key, purchase_unit, doc_id, line_id, effective_date, effective_basis, invoice_date,
        invoice_no_norm, price_per_purchase, price_per_count, count_unit, price_per_base, base_unit, created_by) values($1,$2,$3,$4,$5,$6,$7,$8,'invoice',$8,$9,$10,$11,$12,$13,$14,'t')`,
        [store, vendor, l.code, l.spec || '', l.pu || 'CS', d, lid, date, 'INV-' + (500 + n), l.ppp, l.pc ?? null, l.pc ? 'ea' : null, l.pb ?? null, l.pb ? 'g' : null]);
    }
  };
  await inv({ date: day(30), lines: [{ code: '101', spec: '12EA', qty: 2, ppp: 60, pc: 5 }, { code: '102', qty: 1, ppp: 40 }] });
  await inv({ date: day(6), lines: [{ code: '101', spec: '12EA', qty: 4, ppp: 60, pc: 5 }, { code: '102', qty: 3, ppp: 44 }, { code: '103', spec: '10EA', qty: 1, ppp: 20, pc: 2 }] });
  await inv({ date: day(3), lines: [{ code: '103', spec: '10EA', qty: 1, ppp: 23, pc: 2.3 }] });
  await inv({ store: 'F02', vendor: 'v-b', vname: '<b>Evil</b> Foods', date: day(40), lines: [{ code: '104', spec: '6EA', qty: 1, ppp: 30, pc: 5 }] });
  await inv({ store: 'F02', vendor: 'v-b', vname: '<b>Evil</b> Foods', date: day(2), lines: [{ code: '104', spec: '6EA', qty: 1, ppp: 48, pc: 8 }, { code: '107', spec: '4EA', qty: 1, ppp: 12, pc: 3 }] });
  // a newer purchase of the gyoza wrappers without a price record; a product bought only by catch weight; a bag priced per piece, then per gram
  await inv({ date: day(1), lines: [{ code: '101', spec: '12EA', qty: 3, ppp: 61, rec: false }, { code: '105', pu: 'CS', qty: 2, ppp: 38.4, rec: false }] });
  await inv({ date: day(20), lines: [{ code: '106', spec: 'BAG', pu: 'BAG', qty: 1, ppp: 10, pc: 2.5 }] });
  await inv({ date: day(5), lines: [{ code: '106', spec: 'BAG', pu: 'BAG', qty: 1, ppp: 10, pb: 0.01 }] });
  await pg.query(`select public.invoice_price_compare_publish('{}'::jsonb)`);
  const r = Object.fromEntries((await pg.query(`select key, value::text v from app_state`)).rows.map(x => [x.key, x.v]));
  await pg.close();
  return r;
}
const STORE = await rows();

function app({ role = 'gm', visible = ['F01', 'F02'], lang = 'ja', data = STORE } = {}) {
  const c = {
    curLang: lang, curRole: role, html: '', modals: [], pulls: [], renders: 0, console,
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc, bizToday: () => today,
    STORES: [{ id: 'F01', name: 'ToriTon' }, { id: 'F02', name: 'Tenkichi' }], getVisibleStores: () => visible.map(id => ({ id })),
    getIngredients: () => [{ code: 101, name: 'Gyoza wrappers' }, { code: 102, name: 'Mixed greens' }, { code: 103, name: 'Eggs' }, { code: 104, name: '<i>Tofu</i>' },
      { code: 105, name: 'Salmon side' }, { code: 106, name: 'Rice bag' }, { code: 107, name: 'Lemons' }],
    // this device's copy (local) and the server's rows (server): the tab reads the server row itself and keeps a copy
    local: { ...data }, server: { ...data }, failPull: false,
    _lsStoreGet: k => c.local[k] ?? null, _lsSetVerified: (k, v) => { c.local[k] = v; return true; }, _lsRawDel: k => { delete c.local[k]; return true; },
    SUPABASE_URL: 'https://db.test', supaHeaders: () => ({}),
    fetch: async url => { const k = decodeURIComponent(/key=eq\.([^&]+)/.exec(url)[1]); c.pulls.push(k); if (c.failPull) return { ok: false, status: 500 };
      return { ok: true, json: async () => (k in c.server ? [{ value: JSON.parse(c.server[k]) }] : []) }; },
    _lsRerenderSoon: () => { c.renders++; },
    invInOrig: (id, label) => '<a data-file="' + esc(id) + '">' + label + '</a>', renderPage: () => {}, openModal: h => c.modals.push(h), closeModalDirect: () => {},
    renderPurchaseAnalysisApp: () => '<div id="app-reference">app prices</div>',
  };
  vm.createContext(c);
  vm.runInContext(fnSrc('kpi') + '\n' + MOD + '\n' + fnSrc('renderPurchaseAnalysis') + fnSrc('renderPriceAlertCard'), c);
  c.run = src => vm.runInContext(src, c);
  return c;
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const rowOf = (h, name) => { const i = h.indexOf(name); assert.ok(i >= 0, name); return text(h.slice(h.lastIndexOf('<tr', i), h.indexOf('</tr>', i))); };

const tick = () => new Promise(r => setImmediate(r));
test('the tab: compared per piece / LB; buying more cases is not a rise; a real rise, 比較不可 and 要確認 are said as such; sources and dates shown', async () => {
  const c = app(); const h = c.run('renderPurchaseAnalysis()'); await tick();
  assert.ok(c.pulls.includes('invoice_purchase_prices'), 'read when the tab opens');
  // 2 cases then 4 cases of 12 at $60 a case: $5 a piece both times
  const r101 = rowOf(h, 'Gyoza wrappers');
  assert.match(r101, /\$5\.000 \/ EA .*\$5\.000 \/ EA/); assert.match(r101, /\+?0\.0%/); assert.match(r101, /変わらない/); assert.match(r101, /INV-502/);
  // no spec, bought by the case: the case price is shown, but not compared
  const r102 = rowOf(h, 'Mixed greens');
  assert.match(r102, /比較不可/); assert.match(r102, /\$44\.00 \/ CS/); assert.doesNotMatch(r102, /%/);
  const r103 = rowOf(h, 'Eggs');
  assert.match(r103, /\$2\.300 \/ EA .*\$2\.000 \/ EA .*\+15\.0%/); assert.match(r103, /値上がり/); assert.match(r103, /前回/);
  const r104 = rowOf(h, 'Tofu');
  assert.match(r104, /\+60\.0%/); assert.match(r104, /要確認（±50% 超）/);
  // the app's own prices are only a reference, folded
  assert.match(h, /<details class="card"[^>]*><summary[^>]*>.*参考：アプリで入れた invoice の価格/); assert.ok(h.includes('<div id="app-reference">app prices</div>'));
  // escaped (a vendor name and a product name from the data)
  assert.ok(!h.includes('<b>Evil</b>') && h.includes('&lt;b&gt;Evil&lt;/b&gt;')); assert.ok(!h.includes('<i>Tofu</i>') && h.includes('&lt;i&gt;Tofu&lt;/i&gt;'));
});

test('the detail: each invoice with its quantity, case price, line amount and the compared price (the amount changes with the quantity, the compared price does not)', () => {
  const c = app(); c.run('renderPurchaseAnalysis()');
  const k = JSON.parse(STORE.invoice_purchase_prices).groups.find(g => g.c === '101').k;
  c.run(`pcxOpen(${JSON.stringify(k)})`);
  const m = text(c.modals.pop());
  assert.match(m, /4 CS \$60\.00 \$240\.00 \$5\.000 \/ EA/); assert.match(m, /2 CS \$60\.00 \$120\.00 \$5\.000 \/ EA/);
  assert.match(m, /元の invoice・確認の状態・会計の記録は変えていません/);
  const k4 = JSON.parse(STORE.invoice_purchase_prices).groups.find(g => g.c === '104').k;
  c.run(`pcxOpen(${JSON.stringify(k4)})`); assert.match(text(c.modals.pop()), /±50% を超えて変わりました/);
});

test('only the stores one can see; the filters; nothing yet / stopped are said plainly', async () => {
  const g3 = app({ role: 'sl', visible: ['F01'] }); const h = g3.run('renderPurchaseAnalysis()');
  assert.ok(!h.includes('Tofu') && !h.includes('Evil'), 'F02 is not shown to someone who sees F01 only');
  const k4 = JSON.parse(STORE.invoice_purchase_prices).groups.find(g => g.c === '104').k;
  g3.run(`pcxOpen(${JSON.stringify(k4)})`); assert.equal(g3.modals.length, 0, 'nor opened by its key');
  const c = app(); c.run("_pcx.flt = 'up'"); let h2 = c.run('pcxRender()');
  assert.ok(h2.includes('Eggs') && !h2.includes('Gyoza wrappers') && !h2.includes('Tofu'));
  c.run("_pcx.flt = 'check'"); h2 = c.run('pcxRender()'); assert.ok(h2.includes('Tofu') && !h2.includes('Eggs'));
  c.run("_pcx.flt = 'all'; _pcx.store = 'F02'"); h2 = c.run('pcxRender()'); assert.ok(h2.includes('Tofu') && !h2.includes('Eggs'));
  c.run("_pcx.store = ''; _pcx.q = 'egg'"); h2 = c.run('pcxRender()'); assert.ok(h2.includes('Eggs') && !h2.includes('Tofu'));
  const none = app({ data: {} }); assert.match(none.run('pcxRender()'), /読み込み中…/); await tick(); assert.match(none.run('pcxRender()'), /まだ集計がありません/);
  const bad = app({ data: {} }); bad.failPull = true; bad.run('pcxRender()'); await tick(); await tick(); assert.match(bad.run('pcxRender()'), /読み込めませんでした/);
  const off = app({ data: { invoice_purchase_prices: '{"v":1,"off":true}' } }); assert.match(off.run('pcxRender()'), /止めています/);
});

test('the dashboard alert: confirmed changes of the last 14 days in the visible stores only, from the small row; nothing from the app’s own prices', async () => {
  const c = app(); const h = text(c.run('renderPriceAlertCard()')); await tick();
  assert.ok(c.pulls.includes('invoice_purchase_prices_alerts') && !c.pulls.includes('invoice_purchase_prices'), 'the small row only');
  assert.match(h, /値上げ1/); assert.match(h, /値下げ0/); assert.match(h, /要確認1/);
  assert.match(h, /Eggs .* \$2\.000 \/ EA → \$2\.300 \/ EA \+15\.0%/);
  assert.ok(!h.includes('Gyoza wrappers'), 'no change: not an alert');
  assert.equal(app({ role: 'crew' }).run('renderPriceAlertCard()'), '');
  assert.ok(!text(app({ role: 'sl', visible: ['F01'] }).run('renderPriceAlertCard()')).includes('Tofu'));
  assert.equal(app({ data: {} }).run('renderPriceAlertCard()'), '');
  // the app's own price changes are not used any more
  assert.doesNotMatch(fnSrc('renderPriceAlertCard'), /priceChangesRecent/);
  assert.match(fnSrc('renderPurchaseAnalysis'), /pcxRender\(\)/); assert.doesNotMatch(fnSrc('renderPurchaseAnalysis'), /priceChangesRecent/);
});

test('English', () => {
  const c = app({ lang: 'en' }); const h = text(c.run('renderPurchaseAnalysis()'));
  for (const s of ['Unit prices compared', 'per 1 LB, 1 L or 1 piece', 'Not comparable (no spec)', 'Check (over ±50%)', 'Reference: prices and totals from invoices entered in the app']) assert.ok(h.includes(s), s);
  assert.match(text(c.run('renderPriceAlertCard()')), /last 14 days · confirmed/);
});

test('review of e364f0c: a stale copy is said to be stale; a row taken back on the server is not shown any more', async () => {
  const c = app(); c.failPull = true; c.run('pcxRender()'); await tick(); await tick();
  const h = c.run('pcxRender()');
  assert.match(h, /最新を読めませんでした。この端末に前に読んだ内容を出しています/); assert.ok(h.includes('Eggs'), 'the old copy is still shown, with the notice');
  assert.match(h, /内容が変わった時刻 .*サーバーが 5 分ごとに確かめる/);
  const gone = app(); gone.server = {}; gone.run('pcxRender()'); await tick(); await tick();
  assert.equal(gone.local.invoice_purchase_prices, undefined, 'the copy on this device is removed');
  assert.match(gone.run('pcxRender()'), /まだ集計がありません/);
});

test('review of e364f0c: 要確認 first on the same day; unit changed and no price record are 比較不可 with their reason; a later purchase without a record is said; the conversion basis is shown', async () => {
  const c = app(); c.run("_pcx.store = 'F02'"); const h = c.run('pcxRender()');
  assert.ok(h.indexOf('Tofu') < h.indexOf('Lemons'), '要確認 (rank 0) before はじめて on the same date');
  const all = app().run('pcxRender()');
  const rice = rowOf(all, 'Rice bag'); assert.match(rice, /比較不可（単位が変わった）/); assert.doesNotMatch(rice, /%/);
  const salmon = rowOf(all, 'Salmon side'); assert.match(salmon, /比較不可（単価の記録なし）/); assert.match(salmon, /\$38\.40 \/ CS/);
  const gyoza = rowOf(all, 'Gyoza wrappers'); assert.match(gyoza, /この日以降に単価の記録が無い仕入れ 1/); assert.match(gyoza, /規格（入数）から/);
  const D = JSON.parse(STORE.invoice_purchase_prices);
  assert.equal(D.stats.not_recorded, 1); assert.equal(D.stats.not_recorded_lines, 2); assert.equal(D.stats.unit_changed, 1);
  const cc = app(); cc.run(`pcxOpen(${JSON.stringify(D.groups.find(g => g.c === '101').k)})`);
  const m = text(cc.modals.pop()); assert.match(m, /単価の記録が無い仕入れが 1 件あります/); assert.match(m, /比較単価の求め方：規格（入数）から/);
  cc.run(`pcxOpen(${JSON.stringify(D.groups.find(g => g.c === '105').k)})`); assert.match(text(cc.modals.pop()), /量り売り・数量や単価が読めない/);
  cc.run(`pcxOpen(${JSON.stringify(D.groups.find(g => g.c === '106').k)})`); assert.match(text(cc.modals.pop()), /前回と比べる単位が違います/);
  cc.run("_pcx.flt = 'nc'"); const nc = cc.run('pcxRender()');
  assert.ok(nc.includes('Rice bag') && nc.includes('Salmon side') && nc.includes('Mixed greens') && !nc.includes('Eggs'));
});
