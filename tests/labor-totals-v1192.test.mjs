// v1192（Moto さん 11/18「サーバーで合計を出す」）：経理・AM の端末の人件費は、関数 secure-state の合計（labor・ltfn:1）。
// 合成データだけ（本番には接続しない）。確かめること：
//  1. サーバーの小さな関数（頼みの形・今日・端末と同じ文字・店・従業員）
//  2. だれが読めるか（CEO・GM・経理＝全店／AM＝担当と応援の店・「全店を見る」の人は全店／ほかは 403）。答えに人の名前・ID が無い
//  3. 同じ数字：CEO の端末（全員の時給を持つ）と、経理の端末（時給なし・月給の印だけ）＋サーバーの答え が、
//     人件費の共通コア（月・週）・1 日の人件費・L/D・月給の合計・G1／G2 以上の分け で 1 セントも違わない（UTC・日本・ハワイの端末で）。
//     サーバーの答えが無いと経理の端末の数字は違う（＝サーバーの答えを使っている）
//  4. 端末の受け取り方（前の版の関数・403・通信の失敗・答えの無い店・担当外の店・ログインの変更・勤怠の手動修正・ログアウト）
//  5. 給与の保存の道（連絡先だけ）と、月給の印（_srvMs）
// 端末の関数は index.html から scripts/build-labor-core.mjs と同じ取り出し方（analyze）で取り出す（上書きの関数 ltServer* も）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../supabase/functions/secure-state/handler.mjs';
import { ltAsks, ltToday, ltKvString, ltStores, ltEmployees, LT_MAX_ASKS } from '../supabase/functions/secure-state/labor.mjs';
import { analyze, ROOTS, STOPS } from '../scripts/build-labor-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

const URL0 = 'https://db.example.test', SS = URL0 + '/functions/v1/secure-state', WR = URL0 + '/functions/v1/work-requests';
const ANON = 'anon-key', SERVICE = 'service-key';
const JWT = (sub, role = 'authenticated') => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role, sub })).toString('base64url') + '.c2ln';
const TODAY = '2026-11-18';
const NOW = Date.parse('2026-11-18T20:00:00Z');   // ハワイの 11/18 10:00
const J = v => JSON.parse(JSON.stringify(v));       // vm の中の値を比べられる形に

// ---------- 合成のクラウド ----------
const UID = { office: '11111111-1111-4111-8111-111111111111', ceo: '22222222-2222-4222-8222-222222222222', crew: '33333333-3333-4333-8333-333333333333', gone: '44444444-4444-4444-8444-444444444444' };
const GUID = { F01: 'AAAA0001-0000-4000-8000-000000000001', F02: 'aaaa0002-0000-4000-8000-000000000002', 'F04-K': 'aaaa0004-0000-4000-8000-00000000000a' };
const STORE_ROWS = [
  { id: 'F01', data: { id: 'F01', name: 'ToriTon', brand: 'ToriTon', toastGuid: GUID.F01, active: true, format: 'dining', lunchHours: '11:00-14:30', dinnerHours: '17:00-22:00', takeout: true } },
  { id: 'F02', data: { id: 'F02', name: 'Tenkichi', brand: 'Tenkichi', toastGuid: GUID.F02, active: true, format: 'izakaya', lunchHours: '11:00-14:00', dinnerHours: '17:00-23:00', takeout: true } },
  { id: 'F04-K', data: { id: 'F04-K', name: 'Totoya Kaimuki', brand: 'Totoya', toastGuid: GUID['F04-K'], active: true, format: 'dining', lunchHours: '11:00-14:30', dinnerHours: '17:00-21:30', takeout: true } },
  { id: 'F09', data: { id: 'F09', name: 'Old', _deleted: true } },
];
const STORES = STORE_ROWS.filter(r => !r.data._deleted).map(r => ({ ...r.data, toastGuid: String(r.data.toastGuid).toLowerCase() }));
const EMP_ROWS = [
  { id: 'e1', data: { id: 'e1', name: 'Aki Tanaka', store: 'F01', title: 'Crew', role: 'crew', status: '在籍' } },
  { id: 'e2', data: { id: 'e2', name: 'Ben Ono', store: 'F01', title: 'Crew Leader', role: 'crew', status: '在籍' } },
  { id: 'e3', data: { id: 'e3', name: 'Cora Lim', store: 'F01', title: 'Prep Specialist', role: 'crew', status: '在籍' } },
  { id: 'e4', data: { id: 'e4', name: 'Dan Ruiz', store: 'F01', title: 'Store Manager', role: 'sl', status: '在籍' } },
  { id: 'e5', data: { id: 'e5', name: 'Eve Park', store: 'F01', title: 'Crew', role: 'crew', status: '在籍', leaveStart: '2026-11-03', leaveEnd: '2026-11-05', leaveHrs: 6 } },
  { id: 'e6', data: { id: 'e6', name: 'Fay Wu', store: 'F01', title: 'Crew', role: 'crew', status: '在籍' } },               // 保護の表に行が無い＝役職の時給
  { id: 'e7', data: { id: 'e7', name: 'Gus Hale', store: 'F01', title: 'Head Chef', role: 'chef', status: '在籍' } },          // 役職で月給（額は役職の表）
  { id: 'e8', data: { id: 'e8', name: 'Ivy Sato', store: 'F02', title: 'Crew', role: 'crew', status: '在籍' } },              // 時給の役職だが月給の額がある
  { id: 'e9', data: { id: 'e9', name: 'Jin Ko', store: 'F02', title: 'Kitchen Leader', role: 'sl', status: '在籍' } },
  { id: 'e10', data: { id: 'e10', name: 'Kai Am', store: 'F02', title: 'Area Manager', role: 'am', status: '在籍' } },
  { id: 'e11', data: { id: 'e11', name: 'Lou Mo', store: 'F04-K', title: 'Crew', role: 'crew', status: '在籍' } },
  { id: 'e12', data: { id: 'e12', name: 'Oki Office', store: '---', title: 'Accountant', role: 'office', status: '在籍' } },
  { id: 'e13', data: { id: 'e13', name: 'Old Hand', store: 'F01', title: 'Crew', role: 'crew', status: '退職' } },
  { id: 'tst_1', data: { id: 'tst_1', name: 'Test Row', store: 'F01', title: 'Crew', isTest: true } },
];
const PRIV_ROWS = [
  { emp_id: 'e1', wage: 18.5, monthly_salary: null }, { emp_id: 'e2', wage: 21, monthly_salary: null }, { emp_id: 'e3', wage: 17, monthly_salary: null },
  { emp_id: 'e4', wage: 0, monthly_salary: 6500 }, { emp_id: 'e5', wage: 19, monthly_salary: null }, { emp_id: 'e8', wage: 0, monthly_salary: 3000 },
  { emp_id: 'e9', wage: 22.75, monthly_salary: null }, { emp_id: 'e10', wage: 0, monthly_salary: 7200 }, { emp_id: 'e11', wage: 17.25, monthly_salary: null },
  { emp_id: 'e12', wage: 0, monthly_salary: 6100 }, { emp_id: 'e13', wage: 20, monthly_salary: null },
];
const SETTINGS = {
  m_titlewage: { Crew: { wage: 16.5 }, 'Store Manager': { monthly: 6000 } },
  md_all_viewers: {},
};
const TBL_LEVELS = [1, 2, 3, 4, 5].map(lv => ({ lv, cents: 1600 + lv * 100, name: 'L' + lv }));
const STATE = {
  prep_tables: { tF01a: { store: 'F01', from: '2026-10-01', levels: TBL_LEVELS, _at: 1 } },
  prep_certs: { c1: { emp: 'e3', store: 'F01', state: 'approved', from: '2026-10-15', lv: 3, tbl: 'tF01a', kind: 'cert', dt: 1000, _at: 1000 } },
  'att_fix_F01_2026-11': { '2026-11-07': { data: { 'Aki Tanaka': { lunch: 4, dinner: 6, rawLunch: 4, rawDinner: 6 }, 'Ben Ono': { lunch: 0, dinner: 5, rawLunch: 0, rawDinner: 5 } } } },
};
const iso = (d, h) => { const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h + 10)); return x.toISOString().replace('.000Z', '-10:00').replace(/T(\d\d)/, (m, hh) => 'T' + String((+hh + 14) % 24).padStart(2, '0')); };
// 勤怠の行（tip_labor）：店・日ごと。日曜は F01 が休み。Aki は F01 で週 6 日 9 時間（週 40h 超）、ときどき F04-K の応援
function laborRows() {
  const out = { F01: [], F02: [], 'F04-K': [] };
  const days = [];
  for (let m = 10; m <= 11; m++) { const last = m === 10 ? 31 : 20; for (let d = 1; d <= last; d++) days.push('2026-' + m + '-' + String(d).padStart(2, '0')); }
  for (const dt of days) {
    const dow = new Date(dt + 'T12:00:00Z').getUTCDay(), dd = +dt.slice(8);
    if (dow !== 0) {
      const list = [
        { name: 'Aki Tanaka', lunchHours: 4, dinnerHours: 5, shifts: [{ inDate: dt + 'T10:30:00-10:00', outDate: dt + 'T14:30:00-10:00' }, { inDate: dt + 'T16:30:00-10:00', outDate: dt + 'T21:30:00-10:00' }] },
        { name: 'Ben Ono', lunchHours: dd % 3 === 0 ? 0 : 3.5, dinnerHours: 4.25 },
        { name: 'Cora Lim', lunchHours: 5, dinnerHours: 0 },
        { name: 'Dan Ruiz', lunchHours: 3, dinnerHours: 5 },
        { name: 'Gus Hale', lunchHours: 2, dinnerHours: 4 },
        { name: 'Order Only', lunchHours: 8, dinnerHours: 8 },
      ];
      if (!(dt >= '2026-11-03' && dt <= '2026-11-05')) list.push({ name: 'Eve Park', lunchHours: 0, dinnerHours: 4.5 });
      if (dd % 4 === 1) list.push({ name: 'Fay Wu', lunchHours: 3.75, dinnerHours: 0 });
      if (dt === '2026-11-12') list.push({ name: 'Old Hand', lunchHours: 2, dinnerHours: 0 });
      out.F01.push({ business_date: dt, data: list });
    }
    if (dow !== 1) out.F02.push({ business_date: dt, data: [{ name: 'Ivy Sato', lunchHours: 3, dinnerHours: 4 }, { name: 'Jin Ko', lunchHours: 4, dinnerHours: 4.5 }, { name: 'Kai Am', lunchHours: 0, dinnerHours: 2 }] });
    if (dow === 2 || dow === 4) out['F04-K'].push({ business_date: dt, data: [{ name: 'Lou Mo', lunchHours: 4, dinnerHours: 4 }, { name: 'Aki', lunchHours: 3, dinnerHours: 0 }] });
    else if (dow !== 0) out['F04-K'].push({ business_date: dt, data: [{ name: 'Lou Mo', lunchHours: 3.5, dinnerHours: 5 }] });
  }
  out.F01.push({ business_date: '2026-11-19', data: [{ name: 'Aki Tanaka', lunchHours: 4, dinnerHours: 4 }] });   // 今日より後の日（今月の締めの外）
  out.F02.push({ business_date: '2026-11-21', data: [] });                                                       // 中身の無い日
  return out;
}
const LABOR = laborRows();
void iso;

function makeCloud(over = {}) {
  const C = {
    emps: over.emps || EMP_ROWS, priv: over.priv || PRIV_ROWS, settings: { ...SETTINGS, ...(over.settings || {}) }, state: { ...STATE, ...(over.state || {}) },
    mgr: { [UID.office]: { role: 'office', emp_id: 'e12' }, [UID.ceo]: { role: 'ceo', emp_id: null }, [UID.crew]: { role: 'office_crew', emp_id: 'e1' }, [UID.gone]: { role: 'office', emp_id: 'e13' }, ...(over.mgr || {}) },
    pins: over.pins || {}, failTipLabor: !!over.failTipLabor, labor: over.labor || LABOR, pageCap: over.pageCap || 1000, log: [],
    trusted: 'trusted' in over ? over.trusted : true,   // rpc/md_all_viewers_gm_trusted（SQL 20261210090000 の守りがあるか）。'404'＝関数が無い・'500'・'throw'・'badjson'
  };
  const res = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  // PostgREST と同じく limit・offset で切る。サーバーの 1 回の上限（pageCap・Supabase の既定は 1,000 行）を超える分は黙って返さない
  const pageOf = (q, arr) => { const off = Number(q.get('offset')) || 0; const lim = Math.min(q.has('limit') ? Number(q.get('limit')) : Infinity, C.pageCap); return arr.slice(off, off + lim); };
  C.fetch = async (u, opt = {}) => {
    const url = new URL(u), m = (opt.method || 'GET').toUpperCase();
    if (u.startsWith(WR)) {
      const b = JSON.parse(opt.body), me = C.pins[b.pin_session];
      if (!me) return res({ error: 'unauthorized' }, 401);
      return res({ me, live: true, fn: 3 });
    }
    if (url.pathname === '/auth/v1/user') {
      const a = (opt.headers && (opt.headers.authorization || opt.headers.Authorization)) || '';
      let sub = null; try { sub = JSON.parse(Buffer.from(a.slice(7).split('.')[1], 'base64url').toString()).sub; } catch { /* */ }
      return sub ? res({ id: sub }) : res({ error: 'bad' }, 401);
    }
    assert.ok(url.pathname.startsWith('/rest/v1/'), 'only REST: ' + u);
    if (url.pathname === '/rest/v1/rpc/md_all_viewers_gm_trusted') {
      C.log.push('rpc/md_all_viewers_gm_trusted');
      assert.equal(m, 'POST');
      if (C.trusted === '404') return res({ code: 'PGRST202', message: 'Could not find the function public.md_all_viewers_gm_trusted' }, 404);
      if (C.trusted === '500') return new Response('boom', { status: 500 });
      if (C.trusted === 'throw') throw new TypeError('fetch failed');
      if (C.trusted === 'badjson') return new Response('<html>gateway</html>', { status: 200 });
      return res(C.trusted);
    }
    assert.equal(m, 'GET', 'labor only reads');
    const table = url.pathname.slice(9), q = url.searchParams;
    C.log.push(table + '?' + q.toString());
    const eq = k => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
    const inList = k => { const v = q.get(k); return v && v.startsWith('in.(') ? v.slice(4, -1).split(',') : null; };
    if (table === 'manager_auth') { const r = C.mgr[eq('user_id')]; return res(r ? [r] : []); }
    if (table === 'employees') {
      const id = eq('id');
      if (id) { const r = C.emps.find(x => x.id === id); return res(r ? [{ id: r.id, role: r.data.role, status: r.data.status, name: r.data.name, data: r.data }] : []); }
      return res(pageOf(q, C.emps.map(r => ({ id: r.id, data: r.data }))));
    }
    if (table === 'employees_private') return res(pageOf(q, C.priv));
    if (table === 'stores') return res(pageOf(q, STORE_ROWS));
    if (table === 'app_settings') {
      const one = eq('key'), list = inList('key');
      const keys = one ? [one] : list;
      return res(keys.filter(k => k in C.settings).map(k => (q.get('select') === 'value' ? { value: C.settings[k] } : { key: k, value: C.settings[k] })));
    }
    if (table === 'app_state') {
      const one = eq('key'), keys = one ? [one] : (inList('key') || []);
      return res(keys.filter(k => k in C.state).map(k => (q.get('select') === 'value' ? { value: C.state[k] } : { key: k, value: C.state[k] })));
    }
    if (table === 'tip_labor') {
      if (C.failTipLabor) return new Response('boom', { status: 500 });
      const g = eq('restaurant_guid'), [from, to] = q.getAll('business_date').map(s => s.slice(4));
      const sid = Object.keys(GUID).find(s => GUID[s].toLowerCase() === g);
      return res(pageOf(q, (C.labor[sid] || []).filter(r => r.business_date >= from && r.business_date <= to)));
    }
    throw new Error('unexpected table ' + table);
  };
  C.handler = createHandler({ env: k => ({ SUPABASE_URL: URL0, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON })[k], fetch: C.fetch, now: () => NOW });
  // アプリの ssCall と同じ答えの形（{ok:true, j}／{status, error}／{legacy:true}）
  C.call = async (who, payload) => {
    const body = { ...payload }; delete body.ms;
    if (who.pin) body.pin_session = who.pin;
    const res2 = await C.handler(new Request(SS, { method: 'POST', headers: { 'content-type': 'application/json', apikey: ANON, authorization: 'Bearer ' + (who.jwt || ANON) }, body: JSON.stringify(body) }));
    let j = null; try { j = await res2.json(); } catch { /* */ }
    if (!j || j.fn !== 1) return { legacy: true };
    if (!res2.ok) return { status: res2.status, error: typeof j.error === 'string' ? j.error : '' };
    return { ok: true, j };
  };
  return C;
}
const OFFICE = { jwt: JWT(UID.office) }, CEO = { jwt: JWT(UID.ceo) };
const AM_ME = { emp: 'e10', role: 'am', grade: 5, stores: ['F02'], am_stores: ['F04-K'], name: 'Kai Am', confirmed: true };
const ASKS = [{ s: 'F01', m: '2026-10' }, { s: 'F01', m: '2026-11' }, { s: 'F02', m: '2026-11' }, { s: 'F04-K', m: '2026-10' }, { s: 'F04-K', m: '2026-11' }];
const NAMES = EMP_ROWS.map(r => r.data.name).concat(['Aki']);

// ---------- 1. サーバーの小さな関数 ----------
test('ltAsks accepts store and month pairs only, merges duplicates and caps at 40', () => {
  assert.deepEqual(ltAsks([{ s: 'F01', m: '2026-11' }, { s: 'F01', m: '2026-11' }, { s: 'F04-K', m: '2026-10', x: 1 }]), [{ s: 'F01', m: '2026-11' }, { s: 'F04-K', m: '2026-10' }]);
  for (const bad of [null, {}, [], 'F01', [{ s: 'F01', m: '2026-13' }], [{ s: 'F 01', m: '2026-11' }], [{ s: '', m: '2026-11' }], [{ s: 'F01', m: '2026-1' }], [{ s: 'x'.repeat(41), m: '2026-11' }], [{ s: 'F01', m: '1999-11' }], ['F01|2026-11']])
    assert.equal(ltAsks(bad), null, JSON.stringify(bad));
  assert.equal(ltAsks(Array.from({ length: LT_MAX_ASKS + 1 }, (_, i) => ({ s: 'S' + i, m: '2026-11' }))), null);
  assert.equal(ltAsks(Array.from({ length: LT_MAX_ASKS }, (_, i) => ({ s: 'S' + i, m: '2026-11' }))).length, 40);
});

test('ltToday uses the device day only within one day of the Hawaii day', () => {
  assert.equal(ltToday('2026-11-18', NOW), '2026-11-18');
  assert.equal(ltToday('2026-11-19', NOW), '2026-11-19');   // 日本の端末で日付が先に進んでいても、1 日までは端末の今日（端末と同じ締め）
  assert.equal(ltToday('2026-11-17', NOW), '2026-11-17');
  assert.equal(ltToday('2026-11-20', NOW), '2026-11-18');
  assert.equal(ltToday('2026-02-30', NOW), '2026-11-18');
  assert.equal(ltToday(undefined, NOW), '2026-11-18');
  assert.equal(ltToday('x', Date.parse('2026-11-19T05:00:00Z')), '2026-11-18');   // UTC では 19 日でも、ハワイはまだ 18 日
});

test('ltKvString makes the same text the device keeps', () => {
  const v = { b: 1, a: { c: 2 } };
  assert.equal(ltKvString('prep_tables', v), JSON.stringify(v));
  assert.equal(ltKvString('prep_certs', 'x'), '{}');
  assert.equal(ltKvString('prep_certs', null), '{}');
  assert.equal(ltKvString('att_fix_F01_2026-11', [1]), '{}');
  assert.equal(ltKvString('att_fix_F01_2026-11', { '2026-11-07': { data: {} } }), '{"2026-11-07":{"data":{}}}');
  assert.equal(ltKvString('m_titlewage', { Crew: { wage: 16.5 } }), '{"Crew":{"wage":16.5}}');
  assert.equal(ltKvString('tip_window', undefined), null);
});

test('ltStores and ltEmployees build what the CEO device sees', () => {
  const s = ltStores([...STORE_ROWS, { id: 'X', data: null }, { id: 'Y', data: { id: 'Y', name: 'Plain' } }]);
  assert.deepEqual(s.map(x => x.id), ['F01', 'F02', 'F04-K', 'Y']);
  assert.equal(s[0].toastGuid, GUID.F01.toLowerCase());
  assert.deepEqual([s[3].active, s[3].brand, s[3].format, s[3].lunchHours, s[3].dinnerHours, s[3].takeout], [true, 'Plain', 'dining', '11:00-14:30', '17:00-22:00', true]);
  const e = ltEmployees(EMP_ROWS, PRIV_ROWS);
  assert.ok(!e.some(x => x.id === 'tst_1'), 'test rows are dropped');
  const by = Object.fromEntries(e.map(x => [x.id, x]));
  assert.equal(by.e1.wage, 18.5); assert.equal(by.e1.monthlySalary, undefined);
  assert.equal(by.e4.wage, 0); assert.equal(by.e4.monthlySalary, 6500);
  assert.equal(by.e6.wage, undefined, 'no private row: the title wage is used');
  assert.equal(by.e1.coef, 1);
});

// ---------- 2. だれが読めるか ----------
test('CEO, GM and accounting read every store; the answer has no names, ids or per-person amounts', async () => {
  const C = makeCloud({ mgr: { '55555555-5555-4555-8555-555555555555': { role: 'gm', emp_id: null } } });
  for (const who of [OFFICE, CEO, { jwt: JWT('55555555-5555-4555-8555-555555555555') }]) {
    const r = await C.call(who, { action: 'labor', asks: ASKS, to: TODAY });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.j.ltfn, 1);
    assert.deepEqual(r.j.no, []);
    assert.deepEqual(Object.keys(r.j.r).sort(), ASKS.map(a => a.s + '|' + a.m).sort());
    assert.equal(r.j.today, TODAY); assert.equal(r.j.max, 40);
    const text = JSON.stringify(r.j);
    for (const n of NAMES) assert.ok(!text.includes(n), 'no name: ' + n);
    for (const id of EMP_ROWS.map(x => x.id)) assert.ok(!text.includes('"' + id + '"'), 'no employee id: ' + id);
    for (const k of Object.keys(r.j.r)) {
      const v = r.j.r[k];
      assert.deepEqual(Object.keys(v).sort(), ['d', 'g', 'p', 'sal', 'w']);
      assert.deepEqual(Object.keys(v.p).sort(), ['hourly', 'leave', 'leaveDays', 'salary']);
      for (const d of Object.values(v.d)) assert.deepEqual(Object.keys(d).sort(), ['c', 'ld', 'll', 'md', 'ml']);
    }
  }
});

// v1192（Codex 6986713362 の P2-1）：全店で返すのは、GM・CEO だけが書ける写し（app_state の md_all_viewers_gm）で ON の人だけ。
// app_settings の md_all_viewers（公開の鍵で書ける）に AM が自分の行を書き足しても、担当外の店は返さない
test('an AM reads assigned and support stores only; only the GM/CEO copy (md_all_viewers_gm) opens every store, not md_all_viewers', async () => {
  const C = makeCloud({ pins: { 'pin-am': AM_ME } });
  const r = await C.call({ pin: 'pin-am' }, { action: 'labor', asks: ASKS, to: TODAY });
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.j.r).sort(), ['F02|2026-11', 'F04-K|2026-10', 'F04-K|2026-11']);
  assert.deepEqual(r.j.no.sort(), ['F01|2026-10', 'F01|2026-11']);
  assert.ok(!C.log.some(l => l.startsWith('tip_labor') && l.includes(GUID.F01.toLowerCase())), 'the attendance of a store outside the scope is not read');
  // AM が自分で md_all_viewers（app_settings・公開の鍵で書ける）に書き足した：担当外の店は返さない（Codex の再現そのもの）
  const C1 = makeCloud({ pins: { 'pin-am': AM_ME }, settings: { md_all_viewers: { e10: { on: true, name: 'Kai Am', _at: 9 } } } });
  const r1 = await C1.call({ pin: 'pin-am' }, { action: 'labor', asks: ASKS, to: TODAY });
  assert.ok(r1.ok);
  assert.deepEqual(r1.j.no.sort(), ['F01|2026-10', 'F01|2026-11'], 'the publicly writable settings row does not open every store');
  assert.ok(!C1.log.some(l => l.startsWith('app_settings') && l.includes('md_all_viewers')), 'the server does not even read md_all_viewers');
  assert.ok(!C1.log.some(l => l.startsWith('tip_labor') && l.includes(GUID.F01.toLowerCase())));
  // GM・CEO が決めた写し（md_all_viewers_gm）で ON：全店
  const C2 = makeCloud({ pins: { 'pin-am': AM_ME }, state: { md_all_viewers_gm: { e10: { on: true, _at: 9 } } } });
  const r2 = await C2.call({ pin: 'pin-am' }, { action: 'labor', asks: ASKS, to: TODAY });
  assert.deepEqual(r2.j.no, []); assert.equal(Object.keys(r2.j.r).length, 5);
  assert.ok(C2.log.some(l => l.startsWith('app_state') && l.includes('key=eq.md_all_viewers_gm')));
  // 写しで外した（_deleted）・OFF・ほかの人の行・形の違う値：担当と応援の店だけ
  for (const gm of [{ e10: { on: true, _deleted: true } }, { e10: { on: false } }, { e99: { on: true } }, { e10: { on: 'true' } }, { e10: true }, [{ on: true }], 'on']) {
    const C3 = makeCloud({ pins: { 'pin-am': AM_ME }, state: { md_all_viewers_gm: gm }, settings: { md_all_viewers: { e10: { on: true } } } });
    const r3 = await C3.call({ pin: 'pin-am' }, { action: 'labor', asks: ASKS, to: TODAY });
    assert.deepEqual(r3.j.no.sort(), ['F01|2026-10', 'F01|2026-11'], JSON.stringify(gm));
  }
  const C4 = makeCloud({ pins: { 'pin-am': AM_ME } });
  const r4 = await C4.call({ pin: 'pin-am' }, { action: 'labor', asks: [{ s: 'F01', m: '2026-11' }], to: TODAY });
  assert.deepEqual([r4.j.r, r4.j.no], [{}, ['F01|2026-11']]);
  assert.ok(!C4.log.some(l => l.startsWith('employees_private') || l.startsWith('tip_labor')), 'nothing is loaded when no asked store is in scope');
});

// v1192（Codex 6989812896 の P2-1・P2-3）：写しを信じるのは、SQL が公開の鍵の書き込みを止めているときだけ（rpc/md_all_viewers_gm_trusted が true）。
// SQL の前（関数が無い）・戻す SQL のあと・守りが外れた（false）・読めないときは、写しで ON でも担当と応援の店だけ
test('the copy opens every store only while the SQL guards it (md_all_viewers_gm_trusted is true); missing, false or unreadable means assigned stores only', async () => {
  const ON = { md_all_viewers_gm: { e10: { on: true, _at: 9 } } };
  for (const trusted of [false, null, 'yes', 1, '404', '500', 'throw', 'badjson']) {
    const C = makeCloud({ pins: { 'pin-am': AM_ME }, state: ON, trusted });
    const r = await C.call({ pin: 'pin-am' }, { action: 'labor', asks: ASKS, to: TODAY });
    assert.ok(r.ok, String(trusted));
    assert.deepEqual(r.j.no.sort(), ['F01|2026-10', 'F01|2026-11'], 'trusted=' + String(trusted));
    assert.ok(C.log.includes('rpc/md_all_viewers_gm_trusted'));
    assert.ok(!C.log.some(l => l.startsWith('tip_labor') && l.includes(GUID.F01.toLowerCase())), 'the attendance of a store outside the scope is not read: ' + String(trusted));
  }
  const T = makeCloud({ pins: { 'pin-am': AM_ME }, state: ON, trusted: true });
  const rt = await T.call({ pin: 'pin-am' }, { action: 'labor', asks: ASKS, to: TODAY });
  assert.deepEqual(rt.j.no, []); assert.equal(Object.keys(rt.j.r).length, 5);
  // CEO・GM・経理は写しを見ない（もともと全店）：守りを聞かない
  const O = makeCloud({ trusted: '404' });
  const ro = await O.call({ jwt: JWT(UID.office) }, { action: 'labor', asks: ASKS, to: TODAY });
  assert.deepEqual(ro.j.no, []);
  assert.ok(!O.log.includes('rpc/md_all_viewers_gm_trusted'));
});

test('staff, office crew, a resigned person and a person without a login are refused', async () => {
  const C = makeCloud({ pins: { 'pin-staff': { emp: 'e9', role: 'staff', grade: 3, stores: ['F02'], am_stores: [], name: 'Jin Ko', confirmed: true }, 'pin-am-out': { ...AM_ME, emp: 'e13' } } });
  const body = { action: 'labor', asks: ASKS, to: TODAY };
  assert.deepEqual(await C.call({ pin: 'pin-staff' }, body), { status: 403, error: 'forbidden' });
  assert.deepEqual(await C.call({ jwt: JWT(UID.crew) }, body), { status: 403, error: 'forbidden' });
  assert.deepEqual(await C.call({ pin: 'pin-am-out' }, body), { status: 403, error: 'forbidden' });
  assert.equal((await C.call({ jwt: JWT(UID.gone) }, body)).status, 401);
  assert.equal((await C.call({}, body)).status, 401);
  assert.equal((await C.call({ pin: 'pin-unknown' }, body)).status, 401);
  assert.ok(!C.log.some(l => l.startsWith('employees_private')), 'no wage is read for a refused request');
});

test('bad asks are 400 and a database failure is 500 (no partial totals)', async () => {
  const C = makeCloud();
  for (const asks of [undefined, [], [{ s: 'F01', m: '2026-13' }], Array.from({ length: 41 }, (_, i) => ({ s: 'S' + i, m: '2026-11' }))])
    assert.deepEqual(await C.call(OFFICE, { action: 'labor', asks, to: TODAY }), { status: 400, error: 'bad_value' });
  const C2 = makeCloud({ failTipLabor: true });
  assert.deepEqual(await C2.call(OFFICE, { action: 'labor', asks: ASKS, to: TODAY }), { status: 500, error: 'error' });
});

// ---------- 3. 同じ数字（端末） ----------
const DEV_ROOTS = [...ROOTS, '_laborCoreForYmRaw', 'ltServerParts', 'ltServerDay', 'ltServerSalary', 'ltServerGrade', 'ltEntry', 'ltDirty', 'ltFlush', 'ltBandHtml', 'ltPaint',
  'ltAfterLogin', 'ltOnLogout', 'ltRetry', 'ltHaveWages', 'empPayType', 'empMonthlyKnown', 'officeHourly', 'empPrivSaveMode', '_empSrvMs'];
const DEV_STOPS = [...STOPS.filter(s => !/^ltServer/.test(s)), 'ssCall', 'ssToken', 'ssSess', 'ssStale', 'document', 'getVisibleStores', 'mdCacheClear', '_lsRawStr',
  'getStoresAll', 'storeInsuranceDaily', 'storeInsuranceMonthly', 'setTimeout', 'clearTimeout'];
const DEV = analyze(RAW, DEV_ROOTS, DEV_STOPS);
const DEV_SRC = DEV.constants.map(c => c.replace(/^const /, 'var ')).join('\n') + '\n' + DEV.functions.map(f => f.text).join('\n');
const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAILY = { F01: { '2026-10-06': { actual: 4100 }, '2026-11-02': { actual: 3200 }, '2026-11-09': { actual: 2800, labor: 400 }, '2026-11-08': { labor: 250 } }, F02: { '2026-11-10': { actual: 5100 } } };

function makeDevice({ role, emps, kvRows, call, storeLogin = false, userName = 'Oki Office', labor = LABOR }) {
  const kv = new Map();
  const timers = [];
  let memo = {};
  const tok = { g: 1, u: userName, st: storeLogin ? 1 : 0, id: 'tok-1' };
  const D = { kv, timers, tok, calls: [], sess: { id: 's1' } };
  const parse = (k, def) => { const v = kv.get(k); if (v == null) return def; try { return JSON.parse(v); } catch { return def; } };
  const ctx = vm.createContext({
    console, window: {}, STORES: J(STORES),
    ls: parse, _lsRaw: parse, _lrRead: k => parse(k, null), _lsRawStr: k => (kv.has(k) ? kv.get(k) : null), _lsStoreGet: k => (kv.has(k) ? kv.get(k) : null),
    lsKeys: p => [...kv.keys()].filter(k => k.indexOf(p == null ? '' : String(p)) === 0), v1136Moved: () => true,
    getEmployees: () => emps, bizToday: () => TODAY, curYm: () => TODAY.slice(0, 7),
    _mdMemo: (ns, key, make) => { const b = memo[ns] || (memo[ns] = {}); if (Object.prototype.hasOwnProperty.call(b, key)) return b[key]; b[key] = make(); return b[key]; },
    mdCacheClear: () => { memo = {}; },
    getDailyActuals: sid => J(DAILY[sid] || {}), storeInsuranceDaily: () => 12.5, storeInsuranceMonthly: () => 375,
    t: ja => ja, T: ja => ja, escapeHtml, showToast: () => {}, renderPage: () => {}, getVisibleStores: () => J(STORES), getStoresAll: () => J(STORES),
    ssCall: async p => { D.calls.push(J(p)); return call ? await call(p) : { status: 500, error: 'no_call' }; },
    ssToken: () => ({ ...tok }), ssSess: () => D.sess, ssStale: t => t.g !== tok.g || t.u !== tok.u || t.st !== tok.st || t.id !== tok.id,
    document: { getElementById: () => null, createElement: () => ({}) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  vm.runInContext(DEV_SRC, ctx, { filename: 'index.html#labor-device' });
  ctx.curRealRole = role; ctx.curRole = role; ctx.curStoreLogin = storeLogin; ctx.curUserName = userName;
  for (const [k, v] of kvRows) kv.set(k, v);
  // 勤怠は端末が取り込むときと同じ関数（tipLaborBuildDay）・この端末の従業員で
  const aidx = ctx.toastAliasIndex(emps);
  for (const sid of Object.keys(labor)) for (const row of labor[sid]) {
    if (!Array.isArray(row.data) || !row.data.length) continue;
    kv.set('tip_labor_' + sid + '_' + row.business_date, JSON.stringify(ctx.tipLaborBuildDay(sid, row.business_date, row.data, emps, aidx)));
  }
  D.ctx = ctx;
  D.clear = () => { memo = {}; };
  D.runTimers = () => { const l = timers.splice(0); for (const x of l) if (x.fn) x.fn(); };
  return D;
}
const kvRowsOf = (settings, state) => [...Object.entries(settings), ...Object.entries(state)].map(([k, v]) => [k, ltKvString(k, v)]).filter(([, v]) => v != null);
function ceoEmps() {
  const priv = new Map(PRIV_ROWS.map(p => [p.emp_id, p]));
  return EMP_ROWS.filter(r => !r.data.isTest).map(r => { const e = { ...r.data, coef: 1 }; const p = priv.get(r.id); if (p) { e.wage = Number(p.wage) || 0; if (p.monthly_salary != null) e.monthlySalary = Number(p.monthly_salary); } return e; });
}
// emp-private v1192 が経理・AM に返すもの：時給・月給は無く、月給の額がある人の印（ms）だけ。端末の getEmployees の重ね方と同じ（_empSrvMs）
function officeEmps(ctx) {
  const ms = new Set(PRIV_ROWS.filter(p => Number(p.monthly_salary) > 0).map(p => p.emp_id));
  return EMP_ROWS.filter(r => !r.data.isTest).map(r => { const e = { ...r.data, coef: 1 }; if (ms.has(r.id)) ctx._empSrvMs(e); return e; });
}
function snapshot(D, emps) {
  const c = D.ctx, out = {};
  const pick = x => ({ hourly: x.hourly, salary: x.salary, leave: x.leave, leaveDays: x.leaveDays, wage: x.wage, tax: x.tax, ins: x.ins, manual: x.manual, total: x.total, sales: x.sales, rate: x.rate,
    periodDays: x.periodDays, dim: x.dim, laborDays: x.laborDays, noLaborDays: J(x.noLaborDays), hours: J(Object.fromEntries(Object.entries(x.byName).map(([n, b]) => [n, [b.reg, b.ot, b.hours]]))) });
  for (const { s, m } of ASKS) {
    D.clear();
    const core = c._laborCoreForYmRaw(s, m);
    const row = { month: pick(core), weeks: {}, days: {}, grade: J(c._laborGradeSplit(s, m, core, emps)), sal: c.storeSalaryMonthly(s) };
    for (const w of c.laborMonthWeeks(m)) row.weeks[w.sun] = pick(c._laborCoreForYmRaw(s, m, { weekSun: w.sun }));
    for (const dd of c.daysOfYm(m)) { const dt = dd.date; row.days[dt] = [c.toastLaborCostForDate(s, dt), J(c._meetLaborLDDay(s, dt)), J(c.ldLaborDay(s, dt))]; }
    out[s + '|' + m] = row;
  }
  return J(out);
}
async function serverAnswer(C, who) { return await C.call(who, { action: 'labor', asks: ASKS, to: TODAY }); }
// サーバーの答えを、端末が頼んだ店・月だけに絞って返す（関数は 1 回の頼みで頼まれたものだけを返す）
const cannedCall = ans => async p => {
  if (p.action !== 'labor') return { status: 400, error: 'unknown_action' };
  const keys = p.asks.map(a => a.s + '|' + a.m), j = J(ans.j);
  j.r = Object.fromEntries(Object.entries(j.r).filter(([k]) => keys.includes(k)));
  j.no = j.no.filter(k => keys.includes(k));
  return { ok: true, j };
};
async function flushAll(D) { for (let i = 0; i < 5 && Object.keys(D.ctx._LT.need).length; i++) await D.ctx.ltFlush(true); }

async function equivalenceIn(tz, ans, labor = LABOR) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    const kvRows = kvRowsOf(SETTINGS, STATE);
    const ceo = makeDevice({ role: 'ceo', emps: ceoEmps(), kvRows, call: null, userName: 'CEO', labor });
    const ceoSnap = snapshot(ceo, ceo.ctx.getEmployees());
    assert.equal(ceo.calls.length, 0, tz + ': the CEO device computes by itself (it has every wage)');
    let office = makeDevice({ role: 'office', emps: [], kvRows, call: cannedCall(ans), labor });
    const oe = officeEmps(office.ctx);
    office = makeDevice({ role: 'office', emps: oe, kvRows, call: cannedCall(ans), labor });
    // makeDevice は emps を作ってから中身を入れるので、印は作り直した文脈の _empSrvMs で付け直す
    const oe2 = officeEmps(office.ctx); oe.splice(0, oe.length, ...oe2);
    assert.ok(oe.some(e => e._srvMs === true) && !JSON.stringify(oe).includes('_srvMs'), 'the monthly mark is there but is never saved');
    assert.ok(oe.every(e => e.wage === undefined && e.monthlySalary === undefined), 'the accounting device has no wage');
    const before = snapshot(office, oe);
    assert.notDeepEqual(before, ceoSnap, tz + ': without the server answer the accounting device shows title wages (so the answer is used)');
    assert.ok(Object.keys(office.ctx._LT.need).length > 0, tz + ': the accounting device asked for the totals');
    await flushAll(office);
    assert.equal(office.calls.length, 1, tz + ': one request for every store and month');
    const after = snapshot(office, oe);
    assert.deepEqual(after, ceoSnap, tz + ': with the server answer the accounting device matches the CEO device to the cent');
    assert.equal(office.calls.length, 1, tz + ': no new request once the answers are in');
    return { ceoSnap, before };
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

test('the accounting device with the server totals equals the CEO device (UTC, Japan and Hawaii devices; the server runs in UTC)', async () => {
  const prev = process.env.TZ;
  process.env.TZ = 'UTC';
  let ans;
  try { ans = await serverAnswer(makeCloud(), OFFICE); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  assert.ok(ans.ok, JSON.stringify(ans));
  for (const tz of ['Asia/Tokyo', 'Pacific/Honolulu']) {
    process.env.TZ = tz;
    try { assert.deepEqual(J((await serverAnswer(makeCloud(), OFFICE)).j), J(ans.j), 'the server answer does not depend on the time zone (' + tz + ')'); }
    finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  }
  const res = {};
  for (const tz of ['UTC', 'Asia/Tokyo', 'Pacific/Honolulu']) res[tz] = await equivalenceIn(tz, ans);
  assert.deepEqual(res['Asia/Tokyo'].ceoSnap, res.UTC.ceoSnap);
  // 合成データが金額の道を通っていること（OT・プレップの認定・月給・有給・手動修正・今日より後の日・業務用アカウント）
  const nov = res.UTC.ceoSnap['F01|2026-11'];
  assert.ok(Object.values(nov.month.hours).some(h => h[1] > 0), 'overtime is in the data');
  assert.ok(nov.month.salary > 0 && nov.month.leave > 0 && nov.month.leaveDays === 3, 'monthly salary and paid leave are in the data');
  assert.ok(nov.month.manual > 0, 'a manual labor amount is in the data');
  assert.equal(nov.days['2026-11-07'][0] > 0, true);
  assert.ok(nov.days['2026-11-19'][0] > 0, 'a day after today still has its day cost');
  assert.ok(!('2026-11-19' in Object.fromEntries(nov.month.noLaborDays.map(d => [d, 1]))), 'the month stops at yesterday');
  const before = res.UTC.before['F01|2026-11'].month;
  assert.notEqual(before.hourly, nov.month.hourly, 'hourly differs before the answer');
  assert.notEqual(before.salary, nov.month.salary, 'salary differs before the answer');
  assert.notEqual(before.leave, nov.month.leave, 'leave differs before the answer');
});

// v1192（Codex 6986713362 の P2-2）：業務用アカウントの Toast ID（端末の k2SysGuids）は 13 か月前からの勤怠で決まる。
// 前の関数は頼まれた月の勤怠だけを読んだので、同じ店・月の合計が、一緒に頼む月で変わった（11 月だけ＝その人を数える／10・11 月＝数えない）
function laborWithSysGuid() {
  const L = J(LABOR);
  const oct = L.F01.find(r => r.business_date === '2026-10-15');
  oct.data.push({ name: 'Toast Generic Login', guid: 'gsys-1', lunchHours: 2, dinnerHours: 0 });
  const nov = L.F01.find(r => r.business_date === '2026-11-03');
  nov.data.find(x => x.name === 'Aki Tanaka').guid = 'gsys-1';   // Toast の業務用アカウントの ID で打刻した日（店の業務用アカウントの一覧は無い＝名前で探す前の道）
  return L;
}
test('the same store and month has the same totals whatever other months are asked with it, and equals the CEO device (Codex 6986713362 P2-2)', async () => {
  const prev = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const labor = laborWithSysGuid();
    const only = await makeCloud({ labor }).call(OFFICE, { action: 'labor', asks: [{ s: 'F01', m: '2026-11' }], to: TODAY });
    const both = await makeCloud({ labor }).call(OFFICE, { action: 'labor', asks: [{ s: 'F01', m: '2026-10' }, { s: 'F01', m: '2026-11' }], to: TODAY });
    const all = await makeCloud({ labor }).call(OFFICE, { action: 'labor', asks: ASKS, to: TODAY });
    assert.ok(only.ok && both.ok && all.ok, JSON.stringify([only, both, all]));
    assert.deepEqual(J(only.j.r['F01|2026-11']), J(both.j.r['F01|2026-11']), 'November alone and October with November give the same November');
    assert.deepEqual(J(only.j.r['F01|2026-11']), J(all.j.r['F01|2026-11']), 'and the same as every asked store and month');
    // 10 月だけを頼んでも、端末と同じく 11 月（今月）の勤怠まで見る（端末の k2SysGuids は後ろに切らない）
    const octOnly = await makeCloud({ labor }).call(OFFICE, { action: 'labor', asks: [{ s: 'F01', m: '2026-10' }], to: TODAY });
    assert.deepEqual(J(octOnly.j.r['F01|2026-10']), J(all.j.r['F01|2026-10']), 'October alone gives the same October');
    // 合成データが業務用アカウントの道を通っていること：Toast ID の無い元のデータとは 11 月の数が違う
    const plain = await makeCloud().call(OFFICE, { action: 'labor', asks: [{ s: 'F01', m: '2026-11' }], to: TODAY });
    assert.notDeepEqual(J(plain.j.r['F01|2026-11']), J(only.j.r['F01|2026-11']), 'the system account id changes November (the test data takes that path)');
    // 両方の月の勤怠を持つ CEO の端末と、1 セントまで同じ
    await equivalenceIn('UTC', all, labor);
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});
test('every table is read page by page until an empty page; too many pages fail with no partial totals', async () => {
  const prev = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const full = await makeCloud().call(OFFICE, { action: 'labor', asks: ASKS, to: TODAY });
    const C = makeCloud({ pageCap: 3 });   // サーバーの上限が小さくても（Supabase は既定で 1 回 1,000 行）、空のページまで読む
    const small = await C.call(OFFICE, { action: 'labor', asks: ASKS, to: TODAY });
    assert.deepEqual(J(small.j), J(full.j), 'the same answer when the server returns 3 rows a request');
    for (const t of ['stores?', 'employees?', 'employees_private?', 'tip_labor?'])
      assert.ok(C.log.filter(l => l.startsWith(t) && /offset=\d/.test(l)).length > 1, t + ' is read in pages');
    // 上限（60 ページ）を超える行は読み切れない＝失敗（途中までで合計を出さない）
    const L = J(LABOR);
    for (let i = 0; i < 70; i++) L.F01.push({ business_date: '2025-' + String(10 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(i % 28 + 1).padStart(2, '0'), data: [] });
    const big = await makeCloud({ labor: L, pageCap: 1 }).call(OFFICE, { action: 'labor', asks: [{ s: 'F01', m: '2026-11' }], to: TODAY });
    assert.deepEqual(big, { status: 500, error: 'error' }, 'too many pages is a failure');
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});

// ---------- 4. 端末の受け取り方 ----------
async function officeWith(call, o = {}) {
  const kvRows = kvRowsOf(SETTINGS, STATE);
  const D = makeDevice({ role: o.role || 'office', emps: [], kvRows, call, storeLogin: !!o.storeLogin });
  const emps = officeEmps(D.ctx);
  const D2 = makeDevice({ role: o.role || 'office', emps, kvRows, call, storeLogin: !!o.storeLogin });
  emps.splice(0, emps.length, ...officeEmps(D2.ctx));
  return D2;
}
const band = D => D.ctx.ltBandHtml();
let OK_ANS = null;
async function okAnswer() { if (!OK_ANS) OK_ANS = await serverAnswer(makeCloud(), OFFICE); return OK_ANS; }

test('CEO, GM, store logins and staff never ask the server', async () => {
  for (const o of [{ role: 'ceo' }, { role: 'gm' }, { role: 'sl' }, { role: 'office', storeLogin: true }]) {
    const D = await officeWith(async () => { throw new Error('must not call'); }, o);
    assert.equal(D.ctx.ltEntry('F01', '2026-11'), null);
    D.ctx._laborCoreForYmRaw('F01', '2026-11'); D.runTimers();
    assert.equal(D.calls.length, 0, JSON.stringify(o));
    assert.equal(band(D), '');
  }
});

test('an older function (unknown_action, no ltfn, legacy) keeps the device numbers for 10 minutes with a band', async () => {
  for (const r of [{ status: 400, error: 'unknown_action' }, { ok: true, j: { fn: 1, r: {} } }, { legacy: true }]) {
    const D = await officeWith(async () => r);
    assert.equal(D.ctx.ltEntry('F01', '2026-11'), null);
    await flushAll(D);
    assert.equal(D.ctx._LT.off.why, 'old', JSON.stringify(r));
    D.clear(); assert.equal(D.ctx.ltEntry('F01', '2026-11'), null);
    assert.equal(D.calls.length, 1, 'no new request within 10 minutes');
    assert.match(band(D), /前の版/);
    D.ctx._LT.off.at -= 11 * 60000; D.clear();
    assert.equal(D.ctx.ltEntry('F01', '2026-11'), null);
    assert.equal(D.ctx._LT.off, null, 'checks again after 10 minutes');
    assert.ok(D.ctx._LT.need['F01|2026-11']);
  }
});

test('no login session, 403, network failure and a missing key each show their band', async () => {
  const N = await officeWith(async () => { throw new Error('no call'); });
  N.sess = null;
  assert.equal(N.ctx.ltEntry('F01', '2026-11'), null);
  assert.equal(N.ctx._LT.off.why, 'none'); assert.equal(N.calls.length, 0);
  assert.match(band(N), /ログインの印が無い/); assert.ok(!band(N).includes('ltRetry'), 'no retry button without a session');

  const F = await officeWith(async () => ({ status: 403, error: 'forbidden' }));
  F.ctx.ltEntry('F01', '2026-11'); await flushAll(F);
  assert.equal(F.ctx._LT.off.why, 'forbidden'); assert.match(band(F), /この権限では/);

  let n = 0;
  const E = await officeWith(async () => { n++; return { net: true }; });
  E.ctx.ltEntry('F01', '2026-11'); await E.ctx.ltFlush(true);
  assert.deepEqual([E.ctx._LT.fail.wait, E.ctx._LT.fail.why], [30000, 'net']);
  assert.ok(E.ctx._LT.need['F01|2026-11'], 'the key is asked again later');
  await E.ctx.ltFlush(false); assert.equal(n, 1, 'waits before asking again');
  await E.ctx.ltFlush(true); assert.equal(E.ctx._LT.fail.wait, 60000, 'the wait doubles');
  assert.match(band(E), /通信できませんでした/); assert.match(band(E), /ltRetry/);
  const ans = await okAnswer();
  const E2 = await officeWith(cannedCall(ans));
  E2.ctx._LT.fail = { at: Date.now(), wait: 300000, why: 'net' }; E2.ctx.ltEntry('F01', '2026-11');
  E2.ctx.ltRetry(); await new Promise(r => setImmediate(r)); await flushAll(E2);
  assert.equal(E2.ctx._LT.fail, null); assert.ok(E2.ctx._LT.map['F01|2026-11'].p, 'retry reads at once');

  const M = await officeWith(async () => ({ ok: true, j: { fn: 1, ltfn: 1, r: {}, no: [] } }));
  M.ctx.ltEntry('F01', '2026-11'); await M.ctx.ltFlush(true);
  assert.equal(M.ctx._LT.fail.why, 'missing'); assert.ok(M.ctx._LT.need['F01|2026-11']);
  assert.match(band(M), /サーバーのエラー/);
});

test('a store outside the AM scope stays on device numbers and is named in the band', async () => {
  const C = makeCloud({ pins: { 'pin-am': AM_ME } });
  const D = await officeWith(p => C.call({ pin: 'pin-am' }, p), { role: 'am' });
  D.ctx._laborCoreForYmRaw('F01', '2026-11'); D.ctx._laborCoreForYmRaw('F02', '2026-11');
  await flushAll(D);
  assert.equal(D.ctx._LT.map['F01|2026-11'].no, true);
  assert.ok(D.ctx._LT.map['F02|2026-11'].p);
  D.clear(); D.ctx._LT.missAt = 0;
  assert.equal(D.ctx.ltEntry('F01', '2026-11'), null);
  assert.ok(D.ctx.ltEntry('F02', '2026-11'));
  assert.match(band(D), /担当外の店（TT）/);
  // emp-private が前の版（時給が届いている）なら、帯は出さない
  // サーバーの答えの月に無い日は 0（役職の時給で出した仮の値を混ぜない）・担当外の店は端末の計算（null）
  assert.deepEqual(J(D.ctx.ltServerDay('F02', '2026-11-30')), { c: 0, ml: 0, md: 0, ll: 0, ld: 0 });
  assert.equal(D.ctx.ltServerDay('F01', '2026-11-02'), null);
  assert.ok(D.ctx.ltServerDay('F02', '2026-11-03').c > 0, 'a worked day (F02 is closed on Mondays in this data)');
  D.ctx.window._empPrivate = { e1: { wage: 18.5 } };
  D.ctx.ltEntry('F01', '2026-11');
  assert.equal(band(D), '');
});

test('an answer that arrives after the login changed is dropped; logout clears the totals', async () => {
  let release;
  const ans = await okAnswer();
  const D = await officeWith(p => new Promise(r => { release = () => r(cannedCall(ans)(p)); }));
  D.ctx.ltEntry('F01', '2026-11');
  const pending = D.ctx.ltFlush(true);
  D.tok.id = 'tok-2';
  release(); await pending;
  assert.equal(D.ctx._LT.map['F01|2026-11'], undefined, 'the previous login answer is not kept');
  D.tok.id = 'tok-1'; D.clear();
  const D2 = await officeWith(cannedCall(ans));
  D2.ctx.ltEntry('F01', '2026-11'); await flushAll(D2);
  assert.ok(D2.ctx._LT.map['F01|2026-11']);
  D2.ctx.ltOnLogout();
  assert.deepEqual(J(D2.ctx._LT.map), {});
  D2.tok.u = 'Someone Else'; D2.clear();
  assert.equal(D2.ctx.ltEntry('F01', '2026-11'), null, 'a new login starts empty');
});

test('a manual attendance fix and old answers are read again; the after-login request covers the visible stores', async () => {
  const ans = await okAnswer();
  const D = await officeWith(cannedCall(ans));
  D.ctx.ltEntry('F01', '2026-11'); await flushAll(D);
  D.clear(); assert.ok(D.ctx.ltEntry('F01', '2026-11'));
  D.kv.set('att_fix_F01_2026-11', JSON.stringify({ '2026-11-08': { data: { 'Aki Tanaka': { lunch: 1, dinner: 1, rawLunch: 1, rawDinner: 1 } } } }));
  D.clear(); D.ctx.ltEntry('F01', '2026-11');
  assert.ok(D.ctx._LT.dirty['F01|2026-11'], 'the fix marks the month');
  D.runTimers();
  assert.ok(D.ctx._LT.need['F01|2026-11'], 'and asks again after a short wait');
  await flushAll(D);
  D.ctx._LT.map['F01|2026-11'].at -= 11 * 60000; D.clear();
  assert.ok(D.ctx.ltEntry('F01', '2026-11'), 'an old answer is still used');
  assert.ok(D.ctx._LT.need['F01|2026-11'], 'while it is read again');
  D.ctx.ltDirty('F02', '2026-11'); assert.deepEqual(J(D.ctx._LT.dirty), {}, 'a month never read is not marked');
  const A = await officeWith(cannedCall(ans));
  A.ctx.ltAfterLogin();
  assert.deepEqual(Object.keys(A.ctx._LT.need).sort(), ['F01|2026-11', 'F02|2026-11', 'F04-K|2026-11']);
});

// ---------- 5. 給与の保存の道・月給の印 ----------
test('the pay save mode, the hourly check and the monthly mark', async () => {
  const D = await officeWith(null);
  const c = D.ctx;
  assert.equal(c.empPrivSaveMode('ceo', null), 'full');
  assert.equal(c.empPrivSaveMode('gm', {}), 'full');
  assert.equal(c.empPrivSaveMode('office', null), 'none');
  const pv = {}; Object.defineProperty(pv, '_scope', { value: 'contacts', enumerable: false });
  assert.equal(c.empPrivSaveMode('office', pv), 'contacts');
  assert.equal(c.empPrivSaveMode('office', {}), 'full', 'an older emp-private (no scope) still saves everything as before');
  c.window._empPrivate = pv;
  assert.equal(c.officeHourly({ title: 'Office Crew' }), true);
  assert.equal(c.officeHourly({ title: 'Accountant' }), false);
  const ms = { title: 'Office Crew' }; c._empSrvMs(ms);
  assert.equal(c.officeHourly(ms), false);
  c.window._empPrivate = {};
  assert.equal(c.officeHourly({ title: 'Office Crew', wage: 18 }), true);
  assert.equal(c.officeHourly({ title: 'Office Crew' }), false);
  assert.equal(c.empMonthlyKnown({ title: 'Crew', monthlySalary: 3000 }), true);
  assert.equal(c.empMonthlyKnown(ms), true);
  assert.equal(c.empMonthlyKnown({ title: 'Crew' }), false);
  assert.equal(c.empPayType(ms), 'monthly');
  assert.equal(JSON.stringify(ms), '{"title":"Office Crew"}', 'the mark is never saved or sent');
});

test('the page wires the server totals, the contacts-only save and release 1192', () => {
  const overlay = RAW.match(/else if\(pr\.ms===true\) _empSrvMs\(e\)/g) || [];
  assert.equal(overlay.length, 2, 'both getEmployees overlays read the monthly mark');
  const save = RAW.slice(RAW.indexOf('function saveEmpPrivate('), RAW.indexOf('function saveEmpPrivate(') + 6000);
  assert.match(save, /empPrivSaveMode\(curRole, window\._empPrivate\)/);
  assert.match(save, /contactsOnly:true/);
  assert.match(RAW, /Object\.defineProperty\(j\.private, '_scope'/);
  assert.match(RAW, /if \(typeof ltServerParts==='function'\) P = ltServerParts\(storeId, ym, opts, P\);/);
  assert.match(RAW, /ltAfterLogin\(\)/);
  assert.match(RAW, /ltOnLogout\(\)/);
  assert.match(RAW, /const APP_VERSION = '1192';/);
  assert.match(SW, /const SW_BUILD = '1192';/);
  assert.deepEqual(DEV.free.filter(n => /^(lt|_LT)[A-Z]/.test(n)), [], 'every lt* name used by the device functions is declared');
});
