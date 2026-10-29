// 確認済み invoice の全店仕入れ集計（Moto 2026-10-14・UI案48）— the app side (v1077・v1078).
// The summary the app reads is made by the real SQL (db/invoice-intake.sql on PGlite, publish → app_state) from the fixed
// example of the request; the real app code (the FUNERGY_PURCHASE_SUMMARY block and foodCostOf, _invDayCostMap,
// monthInvoiceCostYm, fcBreakdownSub from index.html) runs in a VM on it. Synthetic data only; no network, no browser storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const source = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SQL = fs.readFileSync(new URL('../db/invoice-intake.sql', import.meta.url), 'utf8');
function block(a, b) { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return source.slice(i, j + b.length); }
function fn(name) {
  const start = source.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start + 1), line = source.slice(start + 1, lineEnd), code = line.replace(/\s*\/\*[^\n]*?\*\/\s*$/, '');
  if (code.trimEnd().endsWith('}') && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length) return line;   // a one-line function
  return source.slice(start + 1, source.indexOf('\n}', start + 1) + 2);
}
const MOD = block('/* FUNERGY_PURCHASE_SUMMARY_BEGIN */', '/* FUNERGY_PURCHASE_SUMMARY_END */');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- the summary, made by the real SQL
async function published(extra, { base = true, keep = false } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text); grant select on public.manager_auth to service_role;
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz); grant select, insert, update on public.app_state to service_role;
    create table public.ingredients(code text primary key, name text, unit text, vendor text, qty numeric, data jsonb); grant select on public.ingredients to service_role;
    insert into public.ingredients values ('I-MISO','Miso','BAG','Minato',1,'{"cat":1000}'),('I-GLOVE','Gloves','PK','Minato',1,'{"cat":40000}');`);
  await pg.exec(SQL);
  await pg.exec(`update invoice_settings set value=value||'{"mirror":true,"start_at":"2026-10-01T00:00:00Z"}' where key='mode';
    update invoice_settings set value=value||'{"closed_through":"2026-08"}' where key='rules';
    update invoice_settings set value=value||'{"route":"external","enabled":true,"to":"qb@example.test","since":"2026-10-13T07:00:00-10:00"}' where key='qb';
    insert into invoice_stores(store_id,label,active) values('F06','LaLa',true),('F01','ToriTon',true);
    insert into invoice_vendor_rules(vendor_key,display_name,food_kind) values('minato','Minato <b>Seika</b> "Q''s"','food'),('clean','Clean Co','nonfood');`);
  await pg.exec('set role service_role');
  let n = 0;
  const doc = async ({ store = 'F06', vk = 'minato', type = 'invoice', status = 'posted', total, recon = 'reconciled', qb = 'sent', lines, related = null, date = '2026-10-05', ingested = '2026-10-14T00:00:00Z', mode = 'manual', reasons = [] }) => {
    n++; const sha = n.toString(16).padStart(64, '0');
    const f = (await pg.query(`insert into invoice_files(drive_file_id,store_id,source,original_name,current_name,drive_created_at,current_sha256,intake_status,ingested_at)
      values($1,$2,'drive',$3,$3,$5,$4,'posted',$5) returning id`, ['1AbCdEfGhIjKlMnOp' + n, store, 'scan ' + n + '.pdf', sha, ingested])).rows[0].id;
    const d = (await pg.query(`insert into invoice_docs(source_key,file_id,sha256,internal_no,store_id,doc_type,posting_kind,vendor_key,vendor_name,food_kind,invoice_no,invoice_date,effective_date,currency,total_cents,status,recon_status,related_doc_id,relation,posted_mode,posted_at,reasons)
      values($1,$2,$3,$4,$5,$6,'purchase',$7,$7,(select food_kind from invoice_vendor_rules where vendor_key=$7),$8,$9,$9,'USD',$10,$11,$12,$13,$14,$15,now(),$16) returning id`,
      ['k' + n, f, sha, 'INT-' + n, store, type, vk, String(48200 + n), date, total, status, recon, related, related ? 'credit_for' : null, mode, JSON.stringify(reasons.map(code => ({ code })))])).rows[0].id;
    let i = 0; for (const [amt, code] of lines) { i++; await pg.query(`insert into invoice_lines(doc_id,line_no,raw_name,raw,qty,amount_cents,ingredient_code) values($1,$2,$3,'{}',2,$4,$5)`, [d, i, i === 1 ? 'Shiro <img src=x onerror=alert(1)> miso' : 'item ' + i, amt, code]); }
    if (qb) await pg.query(`insert into invoice_qb_outbox(file_id,sha256,to_address,route,state,attempt_key,sent_at) values($1,$2,'qb@example.test','external',$3,$4,case when $3='sent' then now() end)`, [f, sha, qb, 'qb-' + n]);
    return d;
  };
  // the fixed example of the request (8): $1,400 = food $1,200 + supplies $200; a $100 food credit; $500 and $400 posted automatically and
  // not reconciled ($500 not forwarded either). Since 2026-10-29 what a person posted counts without reconciling (tests below).
  const ids = {};
  if (base) {
    ids.inv = await doc({ total: 140000, lines: [[120000, 'I-MISO'], [20000, 'I-GLOVE']] });
    ids.cm = await doc({ type: 'credit_memo', total: 10000, lines: [[10000, 'I-MISO']], related: ids.inv });
    ids.b = await doc({ total: 50000, lines: [[50000, null]], qb: 'pending', recon: 'unreconciled', mode: 'auto' });
    ids.c = await doc({ total: 40000, lines: [[40000, null]], recon: 'unreconciled', mode: 'auto' });
  }
  if (extra) await extra(doc, ids, pg);
  const publish = async () => (await pg.query(`select public.invoice_purchase_publish('{}') v`)).rows[0].v;
  const read = async () => Object.fromEntries((await pg.query(`select key, value from app_state`)).rows.map(r => [r.key, r.value]));
  await publish();
  const rows = await read();
  if (keep) return { rows, ids, pg, doc, publish, read };   // the caller closes pg
  await pg.close();
  return { rows, ids };
}

// ---------------------------------------------------------------- the app in a VM
function app({ state = {}, role = 'gm', visible = ['F06', 'F01'], lang = 'ja', fc = {}, sales = {}, transfers = {}, api = () => ({ ok: true }) } = {}) {
  const STORE = JSON.parse(JSON.stringify(state));
  const c = {
    console, STORE, calls: [], pulled: [], toasts: [], modals: [], rendered: 0, curLang: lang, curRole: role, curPage: 'budget', dailyMonthOffset: 0,
    t: (ja, en) => (c.curLang === 'en' ? en : ja), escapeHtml: esc,
    STORES: [{ id: 'F06', name: 'LaLa' }, { id: 'F01', name: 'ToriTon' }, { id: 'F99', name: 'Closed' }],
    getStoresAll: () => c.STORES, getVisibleStores: () => c.STORES.filter(s => visible.includes(s.id)),
    ls: (k, d) => (Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : d),
    _lsStoreGet: k => (Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.stringify(STORE[k]) : null),
    pullOpKey: async k => { c.pulled.push(k); return true; }, _lsRerenderSoon: () => { c.rendered++; },
    _fetchOpValue: async k => (Object.prototype.hasOwnProperty.call(STORE, k) ? JSON.parse(JSON.stringify(STORE[k])) : null),
    renderPage: () => { c.rendered++; }, showToast: (m, k) => c.toasts.push([m, k]), openModal: h => c.modals.push(h), closeModalDirect: () => {},
    curYm: () => '2026-10', bizToday: () => '2026-10-14', ymFromOffset: o => (o === -1 ? '2026-09' : '2026-10'),
    cumulativeToToday: (sid, ym) => ({ actToToday: sales[sid] || 0, actMonth: sales[sid] || 0 }),
    getFcMonthly: (sid, ym) => (fc[sid + '|' + ym] || {}), monthTransferNetYm: (sid, ym) => (transfers[sid + '|' + ym] || { inAmt: 0, outAmt: 0, net: 0 }),
    getPurchases: sid => STORE['purchases_' + sid] || [], bStoreChips: (cur, setter, o) => '<chips ' + cur + ' ' + (o && o.stores ? o.stores.map(s => s.id).join(',') : '') + '>',
    invInCanEdit: () => ['ceo', 'gm', 'office', 'office_crew'].includes(c.curRole), invInCan: () => ['ceo', 'gm', 'office', 'office_crew'].includes(c.curRole),
    invInSigned: () => true, invInAPI: async b => { c.calls.push(b); const r = await api(b); if (r && r.error) throw new Error(r.error); return r; },
    invInOpen: () => {}, go: () => {}, setTimeout: () => 0, window: { innerWidth: 1280 },
    document: { getElementById: k => (c.dom || {})[k] || null, querySelector: q => (c.dom || {})[q] || null },
    _kpiMiniChip: (label, big, sub) => '<chip>' + label + ':' + big + (sub ? '(' + sub + ')' : '') + '</chip>', monthInvoiceTotalYm: () => 0, monthPurchaseTotalYm: () => 0,
  };
  vm.createContext(c);
  vm.runInContext(['parseJaDate', '_invDate', '_invStoreIds', 'fcCostPurposes', '_fcInCost', 'dateInYm', 'monthInvoiceCostYm', 'monthPurchaseCostYm', 'foodCostOf',
    '_invDayCostMap', 'fcBreakdownSub', 'budPage', 'lsSplitRO'].map(fn).join('\n') + '\n' + MOD, c);   // v1084: 仕入れは独立したページ（budPage が描き直す先を決める）
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
// What the app has had all along: Drive copies (src drive-intake) of the posted invoices, and an invoice registered in the app by hand.
const appInvoices = () => [
  { id: 'drv_INT-1', src: 'drive-intake', storeId: 'F06', vendor: 'Minato', docType: 'Invoice', date: '2026/10/14', docDate: '2026/10/05', total: 1400, purpose: '仕入れ・仕込み' },
  { id: 'drv_INT-3', src: 'drive-intake', storeId: 'F06', vendor: 'Minato', docType: 'Invoice', date: '2026/10/14', docDate: '2026/10/05', total: 500, purpose: '仕入れ・仕込み' },
  { id: 'drv_INT-4', src: 'drive-intake', storeId: 'F06', vendor: 'Minato', docType: 'Invoice', date: '2026/10/14', docDate: '2026/10/05', total: 400, purpose: '仕入れ・仕込み' },
  { id: 'drv_SEP', src: 'drive-intake', storeId: 'F06', vendor: 'Minato', docType: 'Invoice', date: '2026/10/02', docDate: '2026/09/28', total: 300, purpose: '仕入れ・仕込み' },
  { id: 'hand-1', storeId: 'F06', vendor: 'Old Hand Co', docType: 'Invoice', date: '2026/10/03', docDate: '2026/10/03', total: 80, purpose: '仕入れ・仕込み', invoiceNo: 'H-1' },
  { id: 'rcpt', storeId: 'F06', vendor: 'Shop', docType: 'Receipt', date: '2026/10/04', total: 999, purpose: '仕入れ・仕込み' },
];

test('the fixed example in the app: 仕入率 11.0%, cost $1,350 and 13.5% with stocktake, shown as provisional; food cost links to the confirmed purchases', async () => {
  const P = await published();
  const c = app({ state: { ...P.rows, invoices: appInvoices().filter(v => v.id !== 'hand-1') }, fc: { 'F06|2026-10': { beginInv: 2000, endInv: 1800 } },
    sales: { F06: 10000 }, transfers: { 'F06|2026-10': { inAmt: 100, outAmt: 50, net: 50 } }, visible: ['F06'] });
  const r = run(c, `foodCostOf('F06', '2026-10', 10000)`);
  assert.equal(r.basis, 'confirmed_invoices');
  assert.equal(r.invoice, 1100, 'confirmed (cost) only: the Drive copies ($1,400 + $500 + $400) are replaced, never added');
  assert.deepEqual([r.purch, r.cost, r.rate, r.mode], [1150, 1350, 13.5, 'confirmed']);
  const h = run(c, `renderPurchaseTab()`);
  assert.match(h, /確認済みの仕入れ（原価対象）<\/div><div class="v">\$1,100\.00/);
  assert.match(h, /原本の純額 \$1,300\.00・原価対象外 \$200\.00/);
  assert.match(h, /確認済みのうち QuickBooks 未転送<\/div><div class="v">\$0\.00 <span style="font-size:12px">0件<\/span><\/div><div class="s">原価には入っています（この画面からは送りません）/);
  assert.doesNotMatch(h, /確認済み・未転送/, 'no "confirmed, not forwarded" tile for a month made with the 2026-10-29 rule');
  assert.match(h, /経理の確認待ち<\/div><div class="v">\$900\.00 <span style="font-size:12px">2件/);
  assert.match(h, /確認済み＝経理などが Invoice取込で反映したもの（「この内容で反映する」・まとめて反映）と、経理の照合済みのもの。/);
  assert.match(h, /仕入率（棚卸未反映）<\/div><div class="v">11\.0%/);
  assert.match(h, /原価（棚卸反映後）<\/div><div class="v">\$1,350\.00 <span style="font-size:12px">13\.5%/);
  assert.match(h, /暫定/); assert.doesNotMatch(h, />確定</, 'not final: $500 not forwarded and $400 not reconciled remain');
  assert.match(h, /まだ入っていない invoice 2 件/);
  assert.match(h, /返品・クレジット −\$100\.00/);
  // the KPI tile's breakdown on 予実管理 shows what goes in and what the previous count would be
  const kb = run(c, `fcBreakdownSub([{id:'F06'}], [{date:'2026-10-01'}])`);
  assert.match(kb, /確認済みの invoice（原価対象）<\/span><b>\$1,100/);
  assert.match(kb, /当月仕入:\$1,100/, 'the purchases chip is the same as in food cost');
  assert.match(kb, /今までの数え方（Drive の写しを含む invoice）なら \$2,300/);
  assert.match(kb, /まだ入っていない：確認待ち \$900・保留 \$0/);
});

test('one count per purchase: app invoices outside Drive still count; months before October 2026, stores outside Drive, no summary and a stopped summary keep the previous count', async () => {
  const P = await published(async doc => {
    await doc({ store: 'F01', vk: 'clean', total: 7000, lines: [[7000, null]] });
    await doc({ total: 99900, lines: [[99900, 'I-MISO']], date: '2026-09-28' });   // a September summary exists too
  });
  assert.ok(P.rows['invoice_purchase_2026-09'], 'September was published');
  const base = { ...P.rows, invoices: appInvoices() };
  let c = app({ state: base });
  assert.equal(run(c, `foodCostOf('F06', '2026-10').invoice`), 1100 + 80, 'confirmed + the invoice registered by hand ($80)');
  assert.equal(run(c, `foodCostOf('F06', '2026-09').invoice`), 300, 'September: the previous count (Drive copies), although its summary is there');
  assert.equal(run(c, `foodCostOf('F06', '2026-09').basis`), 'all_invoices');
  assert.equal(run(c, `foodCostOf('F01', '2026-10').invoice`), 0, 'a non-food vendor is not for cost');
  assert.equal(run(c, `foodCostOf('F99', '2026-10').basis`), 'all_invoices', 'a store outside the Drive intake');
  c = app({ state: { invoices: appInvoices() } });
  assert.equal(run(c, `foodCostOf('F06', '2026-10').invoice`), 1400 + 500 + 400 + 80, 'no summary yet: the previous count');
  assert.deepEqual(JSON.parse(JSON.stringify(run(c, `foodCostOf('F06', '2026-10').ips`))), { ok: false, why: 'not_loaded' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(c.pulled, ['invoice_purchase_status'], 'it asks for the list of summaries once, not for every month');
  c = app({ state: { ...base, invoice_purchase_status: { ...P.rows['invoice_purchase_status'], off: true } } });   // stopped, even with months listed
  assert.equal(run(c, `foodCostOf('F06', '2026-10').invoice`), 1400 + 500 + 400 + 80, 'stopped: the previous count everywhere');
  assert.match(run(c, `renderPurchaseTab()`), /止めてあります/);
});

test('daily cost: Drive copies from October are replaced by the confirmed invoices on their invoice date; earlier months stay', async () => {
  const P = await published();
  const c = app({ state: { ...P.rows, invoices: appInvoices() } });
  const m = run(c, `_invDayCostMap()`);
  assert.equal(m.F06['2026-10-14'], undefined, 'the copies (dated by intake) are not counted in October');
  assert.equal(m.F06['2026-10-05'], 1100, 'confirmed $1,200 − $100 credit on the invoice date');
  assert.equal(m.F06['2026-10-02'], 300, 'a September invoice copy taken in on 10/2 keeps the previous count');
  assert.equal(m.F06['2026-10-03'], 80);
  // the cache is rebuilt when the summary changes (the list then names the new version)
  c.STORE['invoice_purchase_2026-10'] = { ...c.STORE['invoice_purchase_2026-10'], generated_at: '2026-10-15T00:00:00Z', stores: {} };
  c.STORE.invoice_purchase_status.months['2026-10'].at = '2026-10-15T00:00:00Z';
  assert.equal(run(c, `_invDayCostMap()`).F06['2026-10-14'], 2300, 'the store is no longer in the summary: its copies count again');
});

test('the 仕入れ tab: stores the person may see only, vendors, invoices, lines with tax shares, and every value escaped', async () => {
  const P = await published(async doc => { await doc({ store: 'F01', vk: 'clean', total: 3333, lines: [[3000, null]] }); });
  const state = { ...P.rows, invoices: appInvoices() };
  // a store manager sees only their store, also with ALL in the chips
  let c = app({ state, role: 'sl', visible: ['F01'], sales: { F01: 5000 } });
  let h = run(c, `renderPurchaseTab()`);
  assert.doesNotMatch(h, /Minato|LaLa|1,100/, 'nothing of the other store');
  assert.match(h, /\$33\.33/);
  assert.doesNotMatch(h, /記録<\/button>/, 'a store manager does not record the statement check');
  // GM: all stores, store table and vendor table. A store key that is not a store id (the rows can be written from a browser) is never shown.
  const bad = JSON.parse(JSON.stringify(state['invoice_purchase_2026-10'])); bad.stores["F98');alert(1);('"] = bad.stores.F01;
  c = app({ state: { ...state, 'invoice_purchase_2026-10': bad }, sales: { F06: 10000, F01: 5000 } });
  h = run(c, `renderPurchaseTab()`);
  assert.doesNotMatch(h, /alert\(1\)/);
  assert.match(h, /<chips ALL F06,F01>/);
  assert.match(h, /店舗別/); assert.match(h, /業者別/);
  assert.match(h, /Minato &lt;b&gt;Seika&lt;\/b&gt; &quot;Q's&quot;/); assert.doesNotMatch(h, /<b>Seika<\/b>/);
  assert.match(h, /確認済みの仕入れ（原価対象）<\/div><div class="v">\$1,100\.00/, 'all stores: $1,100 + $0 (a non-food vendor)');
  assert.match(h, /原本の純額 \$1,333\.33/);
  // one store: the statement check button, vendor view, invoice lines
  run(c, `ipsSetScope('F06')`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /ipsCheckOpen\('2026-10','F06','minato'\)/);
  assert.match(h, /アプリで登録した invoice（Drive の取込の外）/); assert.match(h, /Old Hand Co/);
  const ref = /ipsOpenVendor\((\d+)\)/.exec(h)[1];
  run(c, `ipsOpenVendor(${ref})`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /業者の一覧へ/);
  for (const no of ['48201', '48202', '48203', '48204']) assert.match(h, new RegExp(no));
  assert.match(h, /経理の照合済み/); assert.match(h, /経理の照合を待っている/);
  assert.match(h, /href="https:\/\/drive\.google\.com\/file\/d\/1AbCdEfGhIjKlMnOp1\/view"/);
  await run(c, `ipsOpenDoc('2026-10', 'F06', '${P.ids.inv}')`);
  const m = c.modals[c.modals.length - 1];
  assert.match(m, /原価対象 \$1,200\.00・原価対象外 \$200\.00/);
  assert.match(m, /Shiro &lt;img src=x onerror=alert\(1\)&gt; miso/); assert.doesNotMatch(m, /<img/);
  assert.match(m, /<td class="r">\$1,200\.00<\/td><td class="r">\$1,200\.00<\/td><td>食材 <span[^>]*>商品<\/span>/);
  assert.match(m, /照合済み/); assert.match(m, /送った/);
  // English
  c.curLang = 'en';
  run(c, `ipsBack()`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /Confirmed purchases \(cost\)/); assert.match(h, /By vendor/); assert.doesNotMatch(h, /確認済みの仕入れ/);
});

test('statement check: recorded through the server with the email sign-in; a missing one needs a note; bad totals are refused', async () => {
  const P = await published();
  const c = app({ state: { ...P.rows }, role: 'office' });
  run(c, `ipsCheckOpen('2026-10', 'F06', 'minato')`);
  assert.match(c.modals.at(-1), /請求明細との照合/); assert.match(c.modals.at(-1), /\$2,200\.00/, 'the registered invoices of the month (confirmed $1,300 + not in yet $900)');
  const err = { textContent: '' };
  const set = (state, note, sc) => { c.dom = { 'ips-ck-err': err, 'ips-ck-note': { value: note }, 'ips-ck-sc': { value: sc }, 'input[name="ips-ck"]:checked': state ? { value: state } : null }; };
  set('missing', '', '');
  await run(c, `ipsCheckSave('2026-10', 'F06', 'minato')`);
  assert.match(err.textContent, /何が足りないか/); assert.equal(c.calls.length, 0);
  set('complete', '', '12.345');
  await run(c, `ipsCheckSave('2026-10', 'F06', 'minato')`);
  assert.match(err.textContent, /1234\.56/); assert.equal(c.calls.length, 0);
  set('complete', '', '$1,300.00');
  await run(c, `ipsCheckSave('2026-10', 'F06', 'minato')`);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[0])), { action: 'purchase_check', store_id: 'F06', vendor_key: 'minato', ym: '2026-10', state: 'complete', note: '', statement_cents: 130000 });
  assert.ok(c.pulled.includes('invoice_purchase_2026-10'), 'the summary is read again after recording');
  // values that do not look like ids never reach a call
  run(c, `ipsCheckOpen("2026-10", "F06');alert(1);('", 'minato')`);
  assert.equal(c.modals.filter(m => /alert/.test(m)).length, 0);
});

test('a summary not checked for hours is pointed out; months without a summary say so and keep the previous count', async () => {
  const P = await published();
  const st = { ...P.rows['invoice_purchase_status'], checked_at: new Date(Date.now() - 5 * 3600000).toISOString() };
  let c = app({ state: { ...P.rows, invoice_purchase_status: st } });
  assert.match(run(c, `renderPurchaseTab()`), /確かめられていません/);
  c = app({ state: { ...P.rows } });
  c.dailyMonthOffset = -1;   // September: no summary was published for it
  const h = run(c, `renderPurchaseTab()`);
  assert.match(h, /この月の集計はまだ届いていません/);
  assert.doesNotMatch(h, /届くまで、予実管理の原価率は今までの数え方/, 'September is before the switch');
});

test('only months the list names are used; closed from either side; keys like __proto__ change nothing; a month is fetched again only for a newer version', async () => {
  const P = await published();
  const tick = () => new Promise(r => setTimeout(r, 0));
  // a month the list (status) does not name is not used, even with its summary on the device: monthly and daily agree
  const st = JSON.parse(JSON.stringify(P.rows['invoice_purchase_status'])); delete st.months['2026-10'];
  let c = app({ state: { ...P.rows, invoice_purchase_status: st, invoices: appInvoices() } });
  assert.equal(run(c, `foodCostOf('F06', '2026-10').basis`), 'all_invoices');
  assert.equal(run(c, `_invDayCostMap()`).F06['2026-10-14'], 2300, 'the copies count, as in the month');
  // closed: the list says so, although the summary was written before the month was closed
  const st2 = JSON.parse(JSON.stringify(P.rows['invoice_purchase_status'])); st2.months['2026-10'].closed = true;
  c = app({ state: { ...P.rows, invoice_purchase_status: st2 }, role: 'office' });
  run(c, `ipsSetScope('F06')`);
  let h = run(c, `renderPurchaseTab()`);
  assert.doesNotMatch(h, /ipsCheckOpen/, 'no recording in a closed month'); assert.doesNotMatch(h, /月の締めがまだ/);
  assert.equal(run(c, `ipsLink('F06', '2026-10').closed`), true);
  // keys like __proto__ in the rows (which a browser can write) add nothing to every object and change no number
  const bad = JSON.parse(JSON.stringify(P.rows['invoice_purchase_2026-10']));
  bad.stores = JSON.parse('{"__proto__":{"tot":{"A":{"cost":999999}}},"constructor":{"tot":{}},' + JSON.stringify(bad.stores).slice(1));
  bad.stores.F06.tot.E = JSON.parse('{"n":1,"c":5,"by":{"__proto__":{"n":7},"constructor":{"n":3},"toString":{"n":2}}}');
  bad.stores.F06.vendors.push(JSON.parse('{"k":"__proto__","n":"Proto Vendor","a":{"n":1,"c":1}}'));
  bad.stores.F06.cls = JSON.parse('{"__proto__":{"x":1},"food":110000}');
  c = app({ state: { ...P.rows, 'invoice_purchase_2026-10': bad, invoices: appInvoices() }, sales: { F06: 10000 } });
  h = run(c, `renderPurchaseTab()`);
  assert.equal(run(c, `({}).n === undefined && ({}).x === undefined && ({}).tot === undefined`), true, 'nothing added to every object');
  assert.equal(run(c, `Object.getPrototypeOf(ipsMonth('2026-10').stores)`), null);
  assert.equal(run(c, `foodCostOf('F06', '2026-10').invoice`), 1100 + 80);
  assert.match(h, /Proto Vendor/); assert.doesNotMatch(h, /toString|native code|undefined|NaN/);
  run(c, `ipsSetScope('F06')`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /集計保留<\/div><div class="v">\$0\.05/); assert.doesNotMatch(h, /undefined|NaN|native code/);
  // the list is read again every 10 minutes; a month only when the list names a newer version than the one on the device
  c = app({ state: { ...P.rows } });
  run(c, `ipsMonth('2026-10')`); run(c, `ipsMonth('2026-10')`); await tick();
  assert.deepEqual(c.pulled, ['invoice_purchase_status', 'invoice_purchase_2026-10'], 'same version: fetched once to verify, in this session');
  run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(c.pulled.length, 2, 'then not again for 6 hours');
  run(c, `_ipsGot['invoice_purchase_2026-10'] = Date.now() - 6 * 3600000 - 1`); run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(c.pulled.filter(k => k === 'invoice_purchase_2026-10').length, 2, 'after 6 hours, once more');
  c.pulled = [];
  c.STORE.invoice_purchase_status.months['2026-10'].at = '2099-01-01T00:00:00Z';
  run(c, `ipsMonth('2026-10')`); run(c, `ipsMonth('2026-10')`); await tick(); run(c, `ipsMonth('2026-10')`); await tick();
  assert.deepEqual(c.pulled, ['invoice_purchase_2026-10'], 'a newer version: fetched once (not on every look when the row has not caught up)');
  c.pulled = [];
  run(c, `_ipsStatusAt = Date.now() - 600001`); run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(c.pulled.filter(k => k === 'invoice_purchase_status').length, 1, 'the list again after 10 minutes');
  // reload draws the page again only on the 仕入れ page (or when something changed). v1084: 仕入れは予実管理のタブから独立したページ
  c = app({ state: { ...P.rows } }); c.curPage = 'budget'; c.rendered = 0;
  await run(c, `ipsRefresh('2026-10', true)`); await run(c, `ipsRefresh('2026-10')`);
  assert.equal(c.rendered, 0);
  c.curPage = 'purchase';
  await run(c, `ipsRefresh('2026-10')`);
  assert.equal(c.rendered, 1);
});

test('the purchases chip uses one count per month for every store; English has no Japanese punctuation; logins leave the summaries out; the bonus lock reads them again', async () => {
  const P = await published();
  const inv = [...appInvoices(), { id: 'f99', storeId: 'F99', vendor: 'Other', docType: 'Invoice', date: '2026/10/03', docDate: '2026/10/03', total: 70, purpose: '仕入れ・仕込み' }];
  let c = app({ state: { ...P.rows, invoices: inv } });
  assert.match(run(c, `fcBreakdownSub([{id:'F99'}], [{date:'2026-10-01'}])`), /当月仕入:\$70/, 'a store outside Drive: the count food cost uses');
  assert.match(run(c, `fcBreakdownSub([{id:'F99'}], [{date:'2026-09-01'}])`), /当月仕入:\$0/, 'before October: as before (the totals)');
  c = app({ state: { ...P.rows, invoices: appInvoices() }, lang: 'en', fc: { 'F06|2026-10': { beginInv: 2000, endInv: 1800 } }, sales: { F06: 10000, F01: 1 } });
  const h = run(c, `renderPurchaseTab()`) + run(c, `fcBreakdownSub([{id:'F06'}], [{date:'2026-10-01'}])`);
  run(c, `ipsCheckOpen('2026-10', 'F06', 'minato')`);
  assert.doesNotMatch(h.replace(/<style>[\s\S]*?<\/style>/g, '') + c.modals.at(-1).replace(/<style>[\s\S]*?<\/style>/g, ''), /[・：（）、。　]/);
  // the login pull (all of app_state) leaves out the summaries; they are fetched by month
  // (assert.ok, not assert.match: a failed match would print the whole 7 MB page)
  // (v1080: other heavy rows may be left out too, e.g. lunch_photo_*; the summaries must stay out)
  // (v1098: the pull reads only the changed rows; every way it reads app_state takes the rows it leaves out from KV_SKIP_PREFIX)
  const skipM = /var KV_SKIP_PREFIX = (\[[^\]]*\]);/.exec(source);
  assert.ok(skipM && JSON.parse(skipM[1].replace(/'/g, '"')).includes('invoice_purchase_'), 'the login pull leaves the summaries out');
  assert.ok(/body:JSON\.stringify\(\{ p_skip_prefix:KV_SKIP_PREFIX \}\)/.test(source), 'the index of rows leaves them out');
  assert.ok(/var f=KV_SKIP_PREFIX\.map\(function\(p\)\{ return 'key=not\.like\.'\+p\+'\*'; \}\)\.join\('&'\);[\s\S]{0,600}rows=await supaFetchAll\('app_state', 'key,value', f\)/.test(source), 'the full read leaves them out');
  assert.ok(/async function supaFetchAll\(table, select, filter\)[\s\S]{0,800}encodeURIComponent\(select\|\|'\*'\)\+\(filter\?'&'\+filter:''\)/.test(source), 'supaFetchAll takes the filter');
  // the bonus lock reads the summaries of the quarter again before it locks
  const k = { IPS_START: '2026-10', _bonusQParse: () => ({ y: 2026, q: 4 }), _quarterMonths: () => ['2026-10', '2026-11', '2026-12'], _ymToOffset: ym => (ym <= '2026-11' ? 0 : 1),
    kbCfg: () => ({}), karteEligibleEmps: () => [], kevStoresExtra: () => [] };
  vm.createContext(k); vm.runInContext(fn('kevLockSyncKeys'), k);
  const keys = vm.runInContext(`kevLockSyncKeys('2026-Q4')`, k);
  assert.ok(keys.includes('invoice_purchase_status') && keys.includes('invoice_purchase_2026-10') && keys.includes('invoice_purchase_2026-11'));
  assert.ok(!keys.includes('invoice_purchase_2026-09') && !keys.includes('invoice_purchase_2026-12'), 'before October and future months are not read');
});

test('held invoices the app entry counts are not "not in yet"; lines follow the month version; a failed fetch is tried again', async () => {
  const P = await published(async doc => {
    await doc({ total: 7000, lines: [[7000, 'I-MISO']], ingested: '2026-09-30T00:00:00Z' });   // taken in before the start: the app entry counts it
  });
  const s = P.rows['invoice_purchase_2026-10'].stores.F06;
  assert.deepEqual(s.ap, { n: 1, c: 7000, u: 0 });
  let c = app({ state: { ...P.rows, invoices: appInvoices() }, sales: { F06: 10000 }, visible: ['F06'] });
  let h = run(c, `renderPurchaseTab()`);
  assert.match(h, /集計保留<\/div><div class="v">\$70\.00/);
  assert.match(h, /うちアプリでの登録で数えるもの 1件/);
  assert.match(h, /まだ入っていない \$900\.00/, '$500 not forwarded + $400 waiting; not the $70 the app entry counts');
  assert.match(h, /まだ入っていない invoice 2 件/);
  const kb = run(c, `fcBreakdownSub([{id:'F06'}], [{date:'2026-10-01'}])`);
  assert.match(kb, /保留 \$0/);
  const vrow = /<tr class="ips-row" onclick="ipsOpenVendor\(\d+\)"><td><b>Minato[\s\S]*?<\/tr>/.exec(h)[0];
  assert.match(vrow, /\$900\.00<div class="ips-sub">2件/, 'the vendor\'s "not in yet" too');
  // lines: the popup uses the lines of the month version on the device, and reads them again for a newer version
  let reads = 0; const f0 = c._fetchOpValue; c._fetchOpValue = async k => { reads++; return f0(k); };
  await run(c, `ipsOpenDoc('2026-10', 'F06', '${P.ids.inv}')`); await run(c, `ipsOpenDoc('2026-10', 'F06', '${P.ids.inv}')`);
  assert.equal(reads, 1);
  c.STORE['invoice_purchase_2026-10'].generated_at = '2026-10-15T01:00:00Z';
  c.STORE['invoice_purchase_lines_2026-10_F06'].generated_at = '2026-10-15T01:00:00Z';
  await run(c, `ipsOpenDoc('2026-10', 'F06', '${P.ids.inv}')`);
  assert.equal(reads, 2);
  c.STORE['invoice_purchase_lines_2026-10_F06'].generated_at = '2026-10-15T02:00:00Z';   // the lines are newer than the month here
  c.pulled = []; run(c, `_ipsLines = {}`);   // not read on this device yet
  await run(c, `ipsOpenDoc('2026-10', 'F06', '${P.ids.inv}')`); await new Promise(r => setTimeout(r, 0));
  assert.ok(c.pulled.includes('invoice_purchase_2026-10'), 'the month on the device is old: read it again');
  // a fetch that failed is tried again on the next look (a newer version than the device has)
  c = app({ state: { ...P.rows } });
  c.STORE.invoice_purchase_status.months['2026-10'].at = '2099-01-01T00:00:00Z';
  let fail = true; c.pullOpKey = async k => { c.pulled.push(k); if (k === 'invoice_purchase_2026-10' && fail) { fail = false; return false; } return true; };
  const tick = () => new Promise(r => setTimeout(r, 0));
  run(c, `ipsMonth('2026-10')`); await tick(); await tick();
  run(c, `ipsMonth('2026-10')`); await tick(); await tick();
  assert.equal(c.pulled.filter(k => k === 'invoice_purchase_2026-10').length, 1, 'not again within a minute of the failure (offline: no request on every look)');
  run(c, `Object.keys(_ipsAsked).forEach(function(k){ if (_ipsAsked[k] && _ipsAsked[k].fail) _ipsAsked[k].fail -= 60001; })`);
  run(c, `ipsMonth('2026-10')`); await tick(); await tick();
  run(c, `ipsMonth('2026-10')`); await tick(); await tick();
  assert.equal(c.pulled.filter(k => k === 'invoice_purchase_2026-10').length, 2, 'tried again after a minute, then not again for the same version');
  // a closed month of the same version is not taken again in the session (it changes only with a new version)
  c = app({ state: { ...P.rows } });
  c.STORE.invoice_purchase_status.months['2026-10'].closed = true;
  run(c, `ipsMonth('2026-10')`); await tick();
  assert.deepEqual(c.pulled, ['invoice_purchase_status']);
  // the cost card (原価管理) says the invoices are the confirmed ones and how much is not in yet
  c = app({ state: { ...P.rows, invoices: appInvoices() }, fc: { 'F06|2026-10': { beginInv: 2000, endInv: 1800 } } });
  vm.runInContext(['invCogsBreakdown', 'renderInvCogsCard'].map(fn).join('\n'), c);
  Object.assign(c, { monthSalesOfYm: () => ({ sales: 10000, days: 13 }), monthEventSalesYm: () => ({ sales: 0, count: 0 }), monthNonCostYm: () => ({ total: 0, byPurpose: {} }),
    _fcPrevYm: () => '2026-09', _fcMoney: v => '$' + Number(v).toFixed(2) });
  const card = run(c, `renderInvCogsCard('F06', '2026-10', null)`);
  assert.match(card, /確認済みの invoice（経理の反映・照合済み・原価対象）\$1,100\.00＋アプリで登録した invoice \$80\.00。まだ入っていない 2 件 \$900\.00/);
  assert.doesNotMatch(card, /原価外を含む全伝票/);
  const sep = run(c, `renderInvCogsCard('F06', '2026-09', null)`);
  assert.doesNotMatch(sep, /確認済みの invoice/, 'September: as before');
  // v1084: 原価率(FC)の日次画面（renderFcDaily）は廃止したので、その画面の月累計の確かめはここから外した。
});

test('a summary changed from outside with the same version is put right on devices that took it (Codex PR #58 P2-1)', async () => {
  const E = await published(null, { keep: true });
  const server = await E.read();
  // the device reads the server's rows (pullOpKey → app_state); the summary of October was changed with the same version
  const bad = JSON.parse(JSON.stringify(server['invoice_purchase_2026-10']));
  bad.stores.F06.tot.A.cost = 990000;
  bad.stores.F06.docs.filter(x => x.cat === 'A').forEach(x => { x.cost = 495000; });
  await E.pg.query(`update app_state set value=$1 where key='invoice_purchase_2026-10'`, [JSON.stringify(bad)]);
  await E.pg.query(`update app_state set value=jsonb_set(value, '{docs}', '{}'::jsonb) where key='invoice_purchase_lines_2026-10_F06'`);
  let srv = await E.read();
  const c = app({ state: { ...srv, invoices: appInvoices() } });
  c.pullOpKey = async k => { c.pulled.push(k); const r = (await E.read())[k]; if (r !== undefined) c.STORE[k] = JSON.parse(JSON.stringify(r)); return true; };
  c._fetchOpValue = async k => { const r = (await E.read())[k]; return r === undefined ? null : JSON.parse(JSON.stringify(r)); };
  const tick = () => new Promise(r => setTimeout(r, 5));
  assert.equal(run(c, `ipsLink('F06', '2026-10').confirmed`), 9900, 'the device has the changed row');
  assert.equal(run(c, `_invDayCostMap()`).F06['2026-10-05'], 9900);
  await tick();
  // the server writes the rows again as a new version; the device looks again after the list's 10 minutes
  const r = await E.publish();
  assert.deepEqual(r.repaired, ['2026-10']);
  run(c, `_ipsStatusAt = Date.now() - 600001; _ipsGot = {}`);
  run(c, `ipsMonth('2026-10')`); await tick(); run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(run(c, `ipsLink('F06', '2026-10').confirmed`), 1100, 'the device took the rows again');
  assert.equal(run(c, `_invDayCostMap()`).F06['2026-10-05'], 1100, 'and its daily cost');
  await run(c, `ipsOpenDoc('2026-10', 'F06', '${E.ids.inv}')`);
  assert.match(c.modals.at(-1), /Shiro &lt;img/, 'the lines of the new version');
  // a row changed and changed back before the server looked: the device that took it is put right within its session check
  bad.generated_at = (await E.read())['invoice_purchase_2026-10'].generated_at;
  const good = JSON.parse(JSON.stringify((await E.read())['invoice_purchase_2026-10']));
  const c2 = app({ state: { ...(await E.read()), 'invoice_purchase_2026-10': bad, invoices: appInvoices() } });
  c2.pullOpKey = async k => { c2.pulled.push(k); const v = (await E.read())[k]; if (v !== undefined) c2.STORE[k] = JSON.parse(JSON.stringify(v)); return true; };
  assert.equal(run(c2, `ipsLink('F06', '2026-10').confirmed`), 9900);
  assert.equal(run(c2, `_invDayCostMap()`).F06['2026-10-05'], 9900, 'its daily cost has the changed row too');
  // it also holds the lines of this version as they were changed (no invoice on them)
  run(c2, `_ipsLines['invoice_purchase_lines_2026-10_F06'] = { v:1, ym:'2026-10', store:'F06', generated_at:${JSON.stringify(bad.generated_at)}, docs:{} }`);
  let gets = 0;
  c2._fetchOpValue = async k => { gets++; const v = (await E.read())[k]; return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  const stamp0 = run(c2, `ipsStamp()`);
  await tick(); await tick();
  assert.equal(run(c2, `ipsLink('F06', '2026-10').confirmed`), 1100, 'checked once in this session although the version is the same');
  assert.equal(good.generated_at, bad.generated_at);
  // Codex PR #58 (f44d1aa): the daily cost and the lines follow the row's content, not only its version
  assert.notEqual(run(c2, `ipsStamp()`), stamp0, 'the daily cost cache key moves with the content');
  assert.equal(run(c2, `_invDayCostMap()`).F06['2026-10-05'], 1100, 'the daily cost is put right with the same version');
  await run(c2, `ipsOpenDoc('2026-10', 'F06', '${E.ids.inv}')`);
  assert.equal(gets, 1, 'the lines of the month are read again after the month is taken again');
  assert.match(c2.modals.at(-1), /Shiro &lt;img/, 'and they are the right ones');
  await run(c2, `ipsOpenDoc('2026-10', 'F06', '${E.ids.inv}')`);
  assert.equal(gets, 1, 'then kept until the month is taken again');
  // the same content written again (another pull of an unchanged row) does not move the key; a change and a change back does
  const s1 = run(c2, `ipsStamp()`);
  c2.STORE['invoice_purchase_2026-10'] = JSON.parse(JSON.stringify(c2.STORE['invoice_purchase_2026-10']));
  assert.equal(run(c2, `ipsStamp()`), s1, 'an unchanged row keeps the key');
  c2.STORE['invoice_purchase_2026-10'] = JSON.parse(JSON.stringify(bad));
  assert.equal(run(c2, `_invDayCostMap()`).F06['2026-10-05'], 9900);
  c2.STORE['invoice_purchase_2026-10'] = JSON.parse(JSON.stringify(good));
  assert.equal(run(c2, `_invDayCostMap()`).F06['2026-10-05'], 1100, 'changed and changed back: rebuilt each time');
  await E.pg.close();
});

test('a month fetch that never answers is treated as failed after two minutes, so the month is taken again (Codex PR #58)', async () => {
  const { rows } = await published();
  const c = app({ state: { ...rows, invoices: appInvoices() } });
  let hang = true;
  c.pullOpKey = k => { c.pulled.push(k); return (hang && k === 'invoice_purchase_2026-10') ? new Promise(() => {}) : Promise.resolve(true); };
  const tick = () => new Promise(r => setTimeout(r, 5));
  run(c, `ipsMonth('2026-10')`); await tick(); run(c, `ipsMonth('2026-10')`); await tick();
  const n = () => c.pulled.filter(k => k === 'invoice_purchase_2026-10').length;
  assert.equal(n(), 1, 'asked once, no answer yet');
  run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(n(), 1, 'not asked again while it may still answer');
  // two minutes on: asked again; when that answers, the month is not asked again in the session
  run(c, `Object.keys(_ipsAsked).forEach(function(f){ if (_ipsAsked[f].busy) _ipsAsked[f].busy -= 120001; })`);
  hang = false;
  run(c, `ipsMonth('2026-10')`); await tick(); run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(n(), 2, 'asked again after two minutes without an answer');
  run(c, `ipsMonth('2026-10')`); await tick();
  assert.equal(n(), 2, 'answered: not asked again in the session');
});

test('a vendor with no invoice and a "missing" statement keeps the month provisional until the invoice is in and checked (Codex PR #58 P2-2)', async () => {
  const E = await published(async (doc, ids, pg) => {
    ids.a = await doc({ total: 100000, lines: [[100000, 'I-MISO']] });
    await pg.query(`insert into invoice_purchase_checks(store_id,vendor_key,ym,state,note,checked_by) values
      ('F06','minato','2026-10','complete','','00000000-0000-4000-8000-0000000000c1'), ('F06','clean','2026-10','missing','1 枚届いていない','00000000-0000-4000-8000-0000000000c1')`);
    await pg.query(`update invoice_settings set value=value||'{"closed_through":"2026-10"}' where key='rules'`);
  }, { base: false, keep: true });
  const fc = { 'F06|2026-10': { beginInv: 2000, endInv: 1800 } };
  let c = app({ state: { ...E.rows }, fc, sales: { F06: 10000 }, visible: ['F06'], role: 'office' });
  let h = run(c, `renderPurchaseTab()`);
  assert.match(h, /足りない/, 'the vendor shows "missing"');
  assert.match(h, /請求明細で足りない invoice がある業者 1/);
  assert.match(h, /暫定/); assert.doesNotMatch(h, />確定</, 'not final while an invoice on the statement is not in');
  // the invoice arrives and is confirmed; still missing on record → provisional
  await E.pg.query(`update invoice_settings set value=value||'{"closed_through":"2026-09"}' where key='rules'`);
  await E.doc({ vk: 'clean', total: 3000, lines: [[3000, null]] });
  await E.publish();
  c = app({ state: { ...(await E.read()) }, fc, sales: { F06: 10000 }, visible: ['F06'], role: 'office' });
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /暫定/); assert.doesNotMatch(h, />確定</);
  // checked again: all here, month closed → final
  await E.pg.query(`insert into invoice_purchase_checks(store_id,vendor_key,ym,state,note,checked_by) values ('F06','clean','2026-10','complete','','00000000-0000-4000-8000-0000000000c1')`);
  await E.pg.query(`update invoice_settings set value=value||'{"closed_through":"2026-10"}' where key='rules'`);
  await E.publish();
  c = app({ state: { ...(await E.read()) }, fc, sales: { F06: 10000 }, visible: ['F06'], role: 'office' });
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, />確定</, 'every statement checked, nothing pending, month closed, stocktake in');
  assert.doesNotMatch(h, /足りない invoice がある業者/);
  // the store table and the all-stores vendor column count the 0-invoice "missing" vendor too
  const P2 = await published(async (doc, ids, pg) => {
    await doc({ total: 1000, lines: [[1000, 'I-MISO']] }); await doc({ store: 'F01', total: 1000, lines: [[1000, 'I-MISO']] });
    await pg.query(`insert into invoice_purchase_checks(store_id,vendor_key,ym,state,note,checked_by) values ('F06','minato','2026-10','complete','','00000000-0000-4000-8000-0000000000c1'),
      ('F01','minato','2026-10','complete','','00000000-0000-4000-8000-0000000000c1'), ('F06','clean','2026-10','missing','x','00000000-0000-4000-8000-0000000000c1')`);
  }, { base: false });
  c = app({ state: { ...P2.rows }, sales: { F06: 10000, F01: 10000 } });
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /<td class="r ips-hide-m">1\/2<\/td><\/tr>/, 'LaLa: 1 of 2 statements done (the missing one counts)');
  assert.match(h, /0\/1 店/, 'the vendor with no invoice: 0 of 1 store');
  await E.pg.close();
});

// 2026-10-29（Moto）：経理の確認＝人が反映したもの（または照合済み）。QuickBooks へ送ったかは条件にしない（未転送は別に出す・送り直さない）。
test('2026-10-29: posted by a person is in the cost before reconciling; "not sent to QuickBooks" is shown apart; an older month keeps its tile', async () => {
  const P = await published(async doc => {
    await doc({ total: 140000, lines: [[120000, 'I-MISO'], [20000, 'I-GLOVE']], recon: 'unreconciled' });           // a person posted it, not reconciled
    await doc({ total: 50000, lines: [[50000, 'I-MISO']], qb: 'pending' });                                         // reconciled, not sent yet
    await doc({ total: 30000, lines: [[30000, 'I-MISO']], recon: 'unreconciled', qb: 'error' });                      // posted, not sent (failed, will retry)
    await doc({ total: 40000, lines: [[40000, 'I-MISO']], recon: 'unreconciled', mode: 'auto' });                     // automatic: waits for reconciling
    await doc({ total: 20000, lines: [[20000, 'I-MISO']], recon: 'unreconciled', reasons: ['app_duplicate_candidate'] });   // may be in the app: waits
    await doc({ store: 'F01', total: 10000, lines: [[10000, 'I-MISO']], recon: 'unreconciled' });
  }, { base: false });
  const app0 = [{ id: 'drv_INT-1', src: 'drive-intake', storeId: 'F06', docType: 'Invoice', docDate: '2026/10/05', total: 1400, purpose: '仕入れ・仕込み' }];
  let c = app({ state: { ...P.rows, invoices: app0 }, sales: { F06: 10000, F01: 10000 }, visible: ['F06'] });
  const r = run(c, `foodCostOf('F06', '2026-10', 10000)`);
  assert.equal(r.invoice, 1200 + 500 + 300, 'cost = what a person posted or reconciled ($1,200 + $500 + $300), whether sent to QuickBooks or not; the Drive copy is replaced');
  run(c, `ipsSetScope('F06')`);   // GM: the tab opens on all stores with invoices; this part looks at LaLa
  let h = run(c, `renderPurchaseTab()`);
  assert.match(h, /確認済みの仕入れ（原価対象）<\/div><div class="v">\$2,000\.00/);
  assert.match(h, /うち経理が反映（照合はまだ） 2件/);
  assert.match(h, /確認済みのうち QuickBooks 未転送<\/div><div class="v">\$800\.00 <span style="font-size:12px">2件<\/span><\/div><div class="s">QuickBooks へ送る順番待ち 1件<br>QuickBooks へ送れなかった（やり直し待ち） 1件<br>原価には入っています（この画面からは送りません）/);
  assert.match(h, /経理の確認待ち<\/div><div class="v">\$600\.00 <span style="font-size:12px">2件/);
  assert.match(h, /アプリでの登録と同じかもしれない invoice が 1 件（\$200\.00）/);
  assert.equal(c.calls.length, 0, 'nothing is sent from the tab');
  // the invoice list says how each was confirmed
  const ref = /ipsOpenVendor\((\d+)\)/.exec(h)[1];
  run(c, `ipsOpenVendor(${ref})`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /経理が反映した（照合はまだ）/); assert.match(h, /経理の照合済み・QuickBooks へ送る順番待ち/);
  assert.match(h, /経理が反映した（照合はまだ）・QuickBooks へ送れなかった（やり直し待ち）/);
  assert.match(h, /経理の照合を待っている・アプリでの登録と同じかもしれない（照合で確かめる）/);
  // all stores: the store table's column is "not sent to QuickBooks"
  c = app({ state: { ...P.rows, invoices: app0 }, sales: { F06: 10000, F01: 10000 } });
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /<th class="r">QuickBooks 未転送<\/th>/);
  assert.match(h, /<td class="r">\$800\.00<div class="ips-sub">2件<\/div><\/td>/);
  assert.match(h, /確認済みの仕入れ（原価対象）<\/div><div class="v">\$2,100\.00/, 'with ToriTon\'s $100 posted by a person');
  // English
  c = app({ state: { ...P.rows, invoices: app0 }, sales: { F06: 10000 }, visible: ['F06'], lang: 'en' });
  run(c, `ipsSetScope('F06')`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /Confirmed, not sent to QuickBooks/); assert.match(h, /Already in the cost \(nothing is sent from here\)/);
  assert.match(h, /Posted by accounting, not reconciled yet 2/); assert.match(h, /Confirmed = posted by accounting in invoice intake/);
  // a month made with the earlier rule (no qbn, a B tile): shown as it was
  const old = JSON.parse(JSON.stringify(P.rows['invoice_purchase_2026-10']));
  delete old.rule; for (const s of Object.values(old.stores)) delete s.qbn;
  old.stores.F06.tot.B = { n: 1, c: 50000, u: 0, cost: 50000, non: 0, unc: 0, pc: 0, pn: 0, by: { qb_pending: { n: 1, c: 50000, u: 0 } } };
  c = app({ state: { ...P.rows, 'invoice_purchase_2026-10': old, invoices: app0 }, sales: { F06: 10000 }, visible: ['F06'] });
  run(c, `ipsSetScope('F06')`);
  h = run(c, `renderPurchaseTab()`);
  assert.match(h, /確認済み・未転送<\/div><div class="v">\$500\.00 <span style="font-size:12px">1件/);
  assert.doesNotMatch(h, /確認済みのうち QuickBooks 未転送/);
});
