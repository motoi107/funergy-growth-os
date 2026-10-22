// 速さの計測用の合成データ。本番のデータは使わない（名前・金額はすべて作りもの）。
// 行の数と大きさは、Moto さんが流した読むだけの SQL（db/perf-data-size-check.sql・2026-10-20）の結果に合わせた。
//   app_state：ログインで読む 786 行・22,659,688 バイト（JSON の文字）。種類ごとの行の数と大きさも同じにした。
//   app_settings 22 行・145,552 バイト／employees 164／stores 10／ingredients 1,372／recipes 911／vendors 70／categories 21
//   toast_item_sales（今月・店ごと 697・396・2,204・2,524・380・381 行）・toast_sales（今月 140 行）・tip_labor（今月 146 行・362,034 バイト）
// 使い方：node gen-data.mjs out.json [today=2026-10-20]
import fs from 'node:fs';

const OUT = process.argv[2] || 'data.json';
const TODAY = process.argv[3] || '2026-10-20';
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ri(0, 15).toString(16));
const iso = d => d.toISOString().slice(0, 10);
const ymOf = d => iso(d).slice(0, 7);
const T = new Date(TODAY + 'T12:00:00Z');
const daysBack = n => { const d = new Date(T); d.setUTCDate(d.getUTCDate() - n); return d; };

const STORES = [
  ['F01', 'Store A', 'Brand A'], ['F02', 'Store B', 'Brand B'], ['F03', 'Store C', 'Brand C'], ['F03-G', 'Store D', 'Brand D'],
  ['F04-K', 'Store E', 'Totoya'], ['F04-P', 'Store F', 'Totoya'], ['F04-A', 'Store G', 'Totoya'], ['F05', 'Store H', 'Brand H'],
  ['F06', 'Store I', 'Brand I'], ['KAP', 'Store J', 'Totoya']
].map(([id, name, brand], i) => ({ id, name, brand, color: '#' + (0x335577 + i * 0x101010).toString(16).slice(0, 6), am: 'Area Manager', toastGuid: i < 8 && id !== 'F03-G' ? uuid() : '', hours: '11:00-22:00', days: '毎日', active: i < 9 }));
const toastStores = STORES.filter(s => s.toastGuid);

// ---- 従業員（164 人・作りものの名前）
const FIRST = ['Aki', 'Ben', 'Cora', 'Dai', 'Emi', 'Finn', 'Gina', 'Hiro', 'Ivy', 'Jun', 'Kai', 'Lea', 'Mio', 'Noa', 'Oto', 'Pia', 'Ren', 'Sora', 'Taro', 'Uma', 'Vic', 'Wes', 'Yui', 'Zen'];
const LAST = ['Abe', 'Baba', 'Chiba', 'Doi', 'Endo', 'Fujii', 'Goto', 'Hara', 'Ito', 'Kato', 'Mori', 'Noda', 'Ota', 'Sato', 'Ueda', 'Wada', 'Yano'];
const employees = [];
const roles = [['ceo', 1], ['gm', 1], ['am', 1], ['office', 2], ['office_crew', 1], ['chef', 1], ['g4', 8], ['sl', 16], ['g2', 30], ['crew', 103]];
let eid = 1; const usedNames = new Set();
for (const [role, n] of roles) for (let i = 0; i < n; i++) {
  let name; do { name = pick(FIRST) + ' ' + pick(LAST) + (usedNames.size > 300 ? ' ' + eid : ''); } while (usedNames.has(name));
  usedNames.add(name);
  const st = ['ceo', 'gm', 'am', 'office', 'office_crew', 'chef'].includes(role) ? 'ALL' : pick(STORES.slice(0, 9)).id;
  employees.push({ id: 'e' + (eid++), name, role, store: st, support: [], emp: role === 'crew' ? 'パート' : '正社員', step: 2, status: '在籍', perms: 'staff', coef: 1, title: role === 'gm' ? 'GM' : role === 'ceo' ? 'CEO' : '', isSL: role === 'sl', firstWorkDate: iso(daysBack(ri(100, 900))), startDate: iso(daysBack(ri(100, 900))), lang: 'ja', note: 'x'.repeat(ri(80, 160)) });
}
const GM = employees.find(e => e.role === 'gm');
const CEO = employees.find(e => e.role === 'ceo');
const CREW = employees.find(e => e.role === 'crew' && e.store === 'F01');
const SL = employees.find(e => e.role === 'sl');

// ---- マスター
const ingredients = [];
for (let i = 0; i < 1372; i++) ingredients.push({ code: 10000 + i, name: 'Ingredient ' + i + ' ' + 'q'.repeat(ri(5, 20)), cat: pick(['10000', '20000', '30000', '40000']), unit: pick(['lb', 'cs', 'ea', 'oz']), vendor: 'Vendor ' + ri(1, 70), price: ri(100, 9000) / 100, qty: ri(1, 40), yield: 100, uc: ri(1, 900) / 100, legacyCode: 'L' + i, spec: 's'.repeat(ri(40, 120)), stores: ['F01', 'F02'] });
const recipes = [];
for (let i = 0; i < 911; i++) { const s = toastStores[i % toastStores.length]; recipes.push({ id: 'r' + i, name: 'Menu ' + i, category: pick(['Bowl', 'Side', 'Drink', 'Set']), storeId: s.id, toastGuid: uuid(), price: ri(300, 2800) / 100, sellPrice: ri(300, 2800) / 100, ings: [{ code: 10000 + ri(0, 1371), qty: ri(1, 9) / 10 }], note: 'n'.repeat(ri(20, 90)) }); }
const vendors = Array.from({ length: 70 }, (_, i) => ({ id: 'v' + i, name: 'Vendor ' + (i + 1), contact: 'Rep ' + i, phone: '808-000-' + String(1000 + i), email: '', method: pick(['email', 'phone', 'web']), cat: 'food', note: 'v'.repeat(ri(100, 200)) }));
const categories = Array.from({ length: 21 }, (_, i) => ({ code: String(10000 + i * 1000), name: 'Cat ' + i, cls: pick(['food', 'liquor', 'supply']) }));

// ---- app_state（行の数と大きさを本番に合わせる）
const app_state = [];
const nowIso = new Date(T.getTime() - 3600e3).toISOString();
function put(key, value) { app_state.push({ key, value, updated_at: new Date(T.getTime() - ri(60, 400000) * 1000).toISOString() }); }
const sizeOf = v => JSON.stringify(v).length;
// 決まった大きさまで記録を足していく
function fillArr(target, make) { const a = []; let sz = 2; while (sz < target) { const r = make(a.length); sz += sizeOf(r) + 1; a.push(r); } return a; }
function fillObj(target, makeK, makeV) { const o = {}; let sz = 2, i = 0; while (sz < target) { const k = makeK(i), v = makeV(i); o[k] = v; sz += k.length + sizeOf(v) + 4; i++; } return o; }
const invRec = (sid, i) => ({ id: 'inv_' + sid + '_' + i, storeId: sid, date: iso(daysBack(ri(0, 300))), vendor: 'Vendor ' + ri(1, 70), invNo: String(ri(10000, 99999)), total: ri(1000, 900000) / 100, cat: 'food', status: pick(['確認済み', '未確認']), items: Array.from({ length: ri(2, 8) }, () => ({ name: 'Item ' + ri(1, 900), qty: ri(1, 20), price: ri(100, 9000) / 100, code: 10000 + ri(0, 1371) })), memo: 'm'.repeat(ri(10, 60)), by: 'Staff', _mut: T.getTime() - ri(0, 9e9) });
const taskRec = (st, i) => ({ id: 'tk_' + st + '_' + i, title: 'Task ' + i + ' ' + 't'.repeat(ri(10, 60)), assignee: 'Staff', store: st, priority: '中', due: iso(daysBack(ri(-10, 300))), progress: ri(0, 100), status: pick(['完了', '進行中']), created: iso(daysBack(ri(0, 400))), refId: 'ctip_' + st + '_' + iso(daysBack(ri(0, 300))), _mut: T.getTime() - ri(0, 9e9) });
const daStores = STORES.slice(0, 9);
// spl_invoices_ 11 行 4,563,888（最大 1,075,371）と、前の統合行 invoices 1 行 4,194,824（中身は分割と同じ記録）
{
  const ids = daStores.map(s => s.id).concat(['ALL', 'OFFICE']);
  const sizes = [1075371, 900000, 700000, 600000, 450000, 300000, 200000, 150000, 100000, 60000, 28517];
  const all = [];
  ids.forEach((sid, i) => { const arr = fillArr(sizes[i], n => invRec(sid, n)); all.push(...arr); put('spl_invoices_' + sid, arr); });
  put('invoices', fillArr(4194824, n => all[n % all.length]));
}
{
  const ids = daStores.map(s => s.id).concat(['ALL', 'OFFICE']);
  const sizes = [586496, 500000, 450000, 400000, 350000, 300000, 250000, 150000, 100000, 50000, 27893];
  const all = [];
  ids.forEach((sid, i) => { const arr = fillArr(sizes[i], n => taskRec(sid, n)); all.push(...arr); put('spl_tasks_all_' + sid, arr); });
  put('tasks_all', fillArr(3088199, n => all[n % all.length]));
}
put('m_ingredients_v2', fillArr(1850068, i => ({ id: 'N' + i, name: 'New ingredient ' + i, nameEn: 'NI ' + i, cat: pick(['food', 'liquor', 'supply']), spec: 'x'.repeat(ri(60, 200)), units: [{ u: 'cs', q: ri(1, 40) }], vendor: 'Vendor ' + ri(1, 70), legacyCode: 10000 + (i % 1372), price: ri(100, 9000) / 100, _ts: T.getTime() - ri(0, 9e9) })));
// daily_actuals_ 9 行 1,442,952（最大 192,925）
daStores.forEach((s, i) => {
  const target = i === 0 ? 192925 : Math.round((1442952 - 192925) / 8);
  put('daily_actuals_' + s.id, fillObj(target, k => iso(daysBack(k)), () => ({ actual: ri(100000, 900000) / 100, guests: ri(80, 400), lunchSales: ri(30000, 300000) / 100, dinnerSales: ri(50000, 600000) / 100, lunchGuests: ri(30, 200), dinnerGuests: ri(40, 220), bowls: ri(0, 300), takeout: ri(0, 80), toLunchSales: ri(0, 50000) / 100, toDinnerSales: ri(0, 60000) / 100, budget: ri(100000, 900000) / 100, lunchCreditTip: ri(0, 30000) / 100, dinnerCreditTip: ri(0, 60000) / 100, toastSrc: true, repeat: ri(0, 100), newCust: ri(0, 100) })));
});
put('ec_log', fillArr(808375, i => ({ d: iso(daysBack(ri(0, 200))), k: 'kind' + ri(1, 7), store: pick(daStores).id, t: 'Error title ' + i, key: 'k' + i, fp: 'f' + ri(1, 1e6) })));
for (let i = 0; i < 34; i++) { const s = daStores[i % 9]; const d = new Date(T); d.setUTCMonth(d.getUTCMonth() - Math.floor(i / 9) + 1); put('budget_approved_' + s.id + '_' + ymOf(d), fillObj(461380 / 34, k => 'd' + k, () => ({ sales: ri(1000, 9000), guests: ri(50, 300), spend: ri(10, 40) }))); }
for (let i = 0; i < 27; i++) put('spl_inv_hist_' + daStores[i % 9].id + '_' + ymOf(daysBack(i * 30)), fillArr(412787 / 27, n => ({ ym: ymOf(daysBack(i * 30)), date: iso(daysBack(i * 30)), code: 10000 + n, qty: ri(0, 50), amt: ri(0, 90000) / 100 })));
// 分割の行は、アプリの分け方（onboardings は名前ごと）と同じにする。前の統合行は分割に入っている記録だけ（本番の落ち着いた状態）
const OB = [];
for (let i = 0; i < 5; i++) { const nm = 'New hire ' + ['A', 'B', 'C', 'D', 'E'][i]; const arr = fillArr(i === 0 ? 227408 : (301153 - 227408) / 4, n => ({ id: 'ob' + i + '_' + n, name: nm, storeName: 'Store', pos: 'Crew', plannedStart: iso(daysBack(n)), docs: 'd'.repeat(300) })); OB.push(...arr); put('spl_onboardings_' + nm, arr); }
daStores.concat([STORES[9]]).forEach((s, i) => put('purchases_' + s.id, fillArr(i === 0 ? 62129 : (215535 - 62129) / 9, n => ({ id: 'p' + n, date: iso(daysBack(n)), store: s.id, amt: ri(100, 90000) / 100, memo: 'buy ' + n }))));
for (let i = 0; i < 38; i++) { const s = toastStores[i % toastStores.length]; const d = daysBack(i * 10); put('menu_mix_' + s.id + '_' + d.getUTCFullYear() + '.' + (d.getUTCMonth() + 1) + (i >= 6 ? '_' + i : ''), { items: fillObj(215415 / 38 - 80, k => 'r' + k, () => ri(0, 400)), sales: ri(1e5, 9e5), savedAt: nowIso, toastSrc: true }); }
put('notifications', fillArr(193952, n => ({ id: 'n' + n, to: pick(['gm', 'office', 'am']), title: 'Notice ' + n, body: 'b'.repeat(ri(40, 160)), at: new Date(T.getTime() - n * 6e5).toISOString(), readBy: [] })));
const SH = []; for (let i = 0; i < 110; i++) { const arr = fillArr(171461 / 110, n => ({ id: 'sh' + i + '_' + n, name: employees[i].name, pos: 'Hall', level: ri(1, 4), at: nowIso, by: 'Staff' })); SH.push(...arr); put('spl_skill_history_' + employees[i].name, arr); }
daStores.concat([STORES[9]]).forEach((s, i) => put('spl_budgets_v2_' + s.id, [{ storeId: s.id, period: '2026.10', status: '承認済み', actual: 0, months: fillObj(137471 / 10 - 120, k => '2026-' + String((k % 12) + 1).padStart(2, '0') + (k >= 12 ? '_' + k : ''), () => ({ sales: ri(1e5, 9e5), guests: ri(1000, 9000), days: fillObj(300, d => 'd' + d, () => ri(1000, 9000)) })), _ts: T.getTime() - ri(0, 9e9) }]));   // v1104：本番と同じく分割の行は [予算 1 件]（v1101 の保護が形を確かめる）
daStores.forEach((s, i) => put('skills_st_' + s.id, fillObj(i === 0 ? 42292 : (129922 - 42292) / 8, k => 'Person ' + k, () => ({ Hall: { level: ri(1, 4), status: '承認', _at: T.getTime() - ri(0, 9e9) }, Kitchen: { level: ri(1, 4), status: '承認', _at: 1 } }))));
for (let i = 0; i < 7; i++) put('cash_tips_' + toastStores[i % toastStores.length].id + (i >= 6 ? '_x' : ''), fillObj(i === 0 ? 21934 : (121626 - 21934) / 6, k => iso(daysBack(k)), () => ({ lunch: ri(0, 9000) / 100, dinner: ri(0, 12000) / 100, entered: true, by: 'Staff', at: nowIso })));
put('inv_ALL', fillArr(114161, n => ({ code: 10000 + n, qty: ri(0, 50) }))); put('inv_x', [1, 2, 3]);
put('handbook_chapters', fillObj(104031, k => 'ch' + k, k => ({ v: 1, title: 'Chapter ' + k, body: 'h'.repeat(900), _t: T.getTime() })));
for (let i = 0; i < 6; i++) put('inv_hist_' + daStores[i].id, fillArr(88606 / 6, n => ({ ym: '2026-0' + ri(1, 9), code: 10000 + n, qty: ri(0, 40) })));
for (let i = 0; i < 33; i++) put('inv_count_' + daStores[i % 9].id + '_' + ymOf(daysBack(i * 30)), fillObj(87299 / 33, k => 'c' + k, () => ri(0, 90)));
put('office_attend_2026-10', fillObj(43266, k => 'p' + k, () => ({ in: '09:00', out: '18:00' }))); put('office_attend_2026-09', fillObj(83075 - 43266, k => 'p' + k, () => ({ in: '09:00', out: '18:00' })));
put('spl_offboardings_A', fillArr(67768, n => ({ id: 'of' + n, name: 'Former ' + n, status: '完了', checks: 'c'.repeat(200) })));
put('onboardings', fillArr(52848, n => OB[n % OB.length]));
put('approvals', fillArr(44986, n => ({ id: 'ap' + n, type: pick(['expense', 'mileage', 'vacation']), status: pick(['承認', '却下', '承認待ち']), _stT: T.getTime() - ri(0, 9e9), roles: { am: 'ok' } })));
put('skill_history', []);   // 前の統合行（中身は分割に入っている記録だけ。下で埋める）
for (let i = 0; i < 124; i++) put('spl_skill_snapshots_' + i, { at: nowIso, n: ri(1, 9), s: 'x'.repeat(250) });
put('evaluations', fillArr(34386, n => ({ id: 'ev' + n, name: 'Person ' + n, score: ri(1, 5) })));
put('spl_cc_actions_2026-10', fillArr(26669, n => ({ id: 'cc' + n, ym: '2026-10', t: 'Action ' + n }))); put('spl_cc_actions_2026-09', fillArr(31239 - 26669, n => ({ id: 'cd' + n, ym: '2026-09', t: 'Action ' + n })));
put('pl_actual', fillObj(30696, k => 'k' + k, () => ri(0, 1e6)));
put('hq_budget', fillObj(23283, k => 'k' + k, () => ri(0, 1e6)));
for (let i = 0; i < 15; i++) put('dailyops_' + daStores[i % 9].id + '_' + iso(daysBack(i)), fillArr(22887 / 15, n => ({ t: 'Check ' + n, done: true })));
for (let i = 0; i < 22; i++) put('lss_emp_' + employees[i].id, fillObj(22504 / 22, k => 'k' + k, () => ri(0, 5)));
for (let i = 0; i < 6; i++) put('spl_reimbursements_' + daStores[i].id, fillArr(21677 / 6, n => ({ id: 'rb' + i + '_' + n, storeId: daStores[i].id, amt: ri(100, 9000) / 100 })));
put('reimbursements', fillArr(20527, n => ({ id: 'rb' + (n % 6) + '_' + n, storeId: daStores[n % 6].id, amt: ri(100, 9000) / 100 })));
put('menu_log', fillArr(20482, n => ({ at: nowIso, t: 'Menu change ' + n })));
const IT = {}; for (let i = 0; i < 6; i++) { const v = fillArr(13726 / 6, n => ({ code: 10000 + n })); IT[daStores[i].id] = v; put('spl_inv_templates_' + daStores[i].id, { __st: 1, v, _at: T.getTime(), _by: 'Staff' }); }
put('inv_templates', Object.fromEntries(Object.entries(IT).map(([k, v]) => [k, v.slice(0, Math.floor(v.length * 0.98))])));
put('resp_matrix', fillObj(13463, k => 'r' + k, () => 'x'.repeat(40)));
put('spl_cc_scores_2026-10', fillArr(12587, n => ({ id: 's' + n, ym: '2026-10', v: ri(0, 5) })));
// 残り：本番の行の数と大きさに合わせる小さな行（種類はばらばら）
{
  const now = app_state.length, have = app_state.reduce((a, r) => a + sizeOf(r.value), 0);
  const left = 786 - now, bytes = 22659688 - have;
  for (let i = 0; i < left; i++) put('misc_' + pick(['sl_manual_', 'att_approve_', 'att_day_approve_', 'tip_exclude_', 'help_requests_', 'ot_approvals_', 'shift_fixed_', 'fc_monthly_', 'warnings_', 'fav_', 'ocs_ev_', 'fv_count_']) + i, fillArr(Math.max(20, bytes / left), n => ({ i: n, v: 'x'.repeat(30) })));
}
// ログインで読まない行（17 行・388,056）
put('invoice_purchase_2026-10', fillObj(231629, k => 'k' + k, () => ri(0, 1e6)));
for (let i = 0; i < 16; i++) put('invoice_purchase_lines_2026-10_' + i, fillArr((388056 - 231629) / 16, n => ({ n, v: 'x'.repeat(40) })));

{ const r = app_state.find(x => x.key === 'skill_history'); r.value = fillArr(44303, n => SH[n % SH.length]); }
// ---- app_settings（22 行・145,552）
const app_settings = [];
const sput = (key, value) => app_settings.push({ key, value, category: 'master' });
sput('work_conditions', fillObj(69927, k => 'k' + k, () => 'x'.repeat(60)));
sput('budgets_v2', daStores.map(s => ({ storeId: s.id, period: '2026.10', segments: null, bases: [], actual: 0, status: '下書き', note: 'x'.repeat(4800) })));
sput('skill_lv_desc', fillObj(15212, k => 'k' + k, () => 'x'.repeat(80)));
sput('pl_public', fillObj(5314, k => 'k' + k, () => ri(0, 100)));
sput('kpi_config', { lunchTarget: 0.3, laborTarget: 0.28, fcTarget: 0.3, note: 'x'.repeat(3300) });
sput('m_store_kpi', fillObj(1674, k => 'F0' + k, () => ({ fc: 0.3, labor: 0.28 })));
sput('store_positions', fillObj(1397, k => 'F0' + k, () => ['Hall', 'Kitchen']));
sput('ob_template', { items: ['a', 'b'], note: 'x'.repeat(850) });
sput('skill_rules', { note: 'x'.repeat(760) });
sput('m_titlewage', { note: 'x'.repeat(530) });
sput('staff_pins', {});
for (let i = 0; i < 11; i++) sput('setting_' + i, { v: i });

// ---- Toast の表（今月）と勤怠（今月と前月）
const toast_sales = [], tip_labor = [], toast_item_sales = [];
const monthStart = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth(), 1));
const prevStart = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() - 1, 1));
const perStoreItems = [697, 396, 2204, 2524, 380, 381];
let itemId = 1;
toastStores.forEach((s, si) => {
  for (let d = new Date(prevStart); d <= T; d.setUTCDate(d.getUTCDate() + 1)) {
    const bd = iso(d), cur = d >= monthStart;
    if (cur && iso(d) < TODAY) toast_sales.push({ restaurant_guid: s.toastGuid, business_date: bd, net_sales: ri(100000, 900000) / 100, guest_count: ri(80, 400), lunch_sales: ri(30000, 300000) / 100, dinner_sales: ri(50000, 600000) / 100, lunch_guests: ri(30, 200), dinner_guests: ri(30, 200), bowls_count: ri(0, 300), takeout_count: ri(0, 80), to_lunch_sales: 0, to_dinner_sales: 0, to_lunch_count: 0, to_dinner_count: 0, updated_at: nowIso });
    if (iso(d) < TODAY) {
      const staff = Array.from({ length: ri(10, 16) }, () => { const e = pick(employees); const a = ri(9, 16); return { name: e.name, guid: uuid(), jobTitle: pick(['Server', 'Cook', 'Host']), shifts: [{ inDate: bd + 'T' + String(a + 10).padStart(2, '0') + ':00:00.000Z', outDate: bd + 'T' + String(Math.min(a + 16, 23)).padStart(2, '0') + ':30:00.000Z' }], regularHours: ri(3, 9), overtimeHours: 0, tips: ri(0, 9000) / 100 }; });
      tip_labor.push({ restaurant_guid: s.toastGuid, business_date: bd, data: staff, lunch_credit_tip_adj: 0, dinner_credit_tip_adj: 0, lunch_credit_tip_adj_reason: null, dinner_credit_tip_adj_reason: null, updated_at: nowIso });
    }
  }
  const n = perStoreItems[si] || 0;
  const myRecipes = recipes.filter(r => r.storeId === s.id);
  for (let i = 0; i < n && myRecipes.length; i++) { const r = myRecipes[i % myRecipes.length]; toast_item_sales.push({ id: itemId++, restaurant_guid: s.toastGuid, business_month: ymOf(T), business_date: iso(new Date(monthStart.getTime() + (i % 19) * 864e5)), item_guid: r.toastGuid, item_name: r.name, qty: ri(1, 40), net_sales: ri(100, 9000) / 100 }); }
});

// 一度だけの移行（新マスターへの取り込み）は、本番ではどれかの端末が済ませて記録が配られている。
// 合成データでも済みにする（無いと、食材マスター・レシート管理を開いたときに全 invoice の移行が走り、描画が落ちる）。
// 乱数の並びを変えないよう、ほかの行を作り終えたあとに足す。
app_state.push({ key: 'ing_v2_backfill_done', value: true, updated_at: T.toISOString() });
app_state.push({ key: 'ing_v2_storeprice_fix', value: true, updated_at: T.toISOString() });
const data = {
  today: TODAY, login: { ceo: CEO.name, ceoId: CEO.id, gm: GM.name, gmId: GM.id, crew: CREW.name, crewId: CREW.id, crewStore: CREW.store, sl: SL.name, slId: SL.id, slStore: SL.store },
  tables: {
    app_state, app_settings,
    employees: employees.map(e => ({ id: e.id, name: e.name, role: e.role, data: e })),
    stores: STORES.map(s => ({ id: s.id, data: s })),
    ingredients: ingredients.map(i => ({ code: i.code, data: i })),
    recipes: recipes.map(r => ({ id: r.id, data: r })),
    vendors: vendors.map(v => ({ id: v.id, data: v })),
    categories: categories.map(c => ({ code: c.code, data: c })),
    toast_sales, tip_labor, toast_item_sales,
    shift_availability: [], shift_plans: [], manager_auth: [], handbook_test_results: []
  }
};
fs.writeFileSync(OUT, JSON.stringify(data));
const st = data.tables.app_state;
const login = st.filter(r => !/^(invoice_purchase_|lunch_photo_)/.test(r.key));
console.log('app_state rows', st.length, 'login rows', login.length, 'login bytes', login.reduce((a, r) => a + sizeOf(r.value), 0));
console.log('app_settings', app_settings.length, app_settings.reduce((a, r) => a + sizeOf(r.value), 0), 'tip_labor cur', tip_labor.filter(r => r.business_date >= iso(monthStart)).length, tip_labor.filter(r => r.business_date >= iso(monthStart)).reduce((a, r) => a + sizeOf(r), 0), 'item rows', toast_item_sales.length, 'toast_sales', toast_sales.length);
