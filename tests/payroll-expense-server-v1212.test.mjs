// v1212（B-2）：Payroll 別のガソリン代・立替経費。本物の SQL（申請の SQL の上に 20261217・20261218 を・PGlite）と本物の関数 payroll-expense・
// 本物の関数 work-requests（whoami・申請・確認・支払）。合成データだけ（名前・金額は架空）。本番にはつながない。仕様：docs/PAYROLL_EXPENSE_V1212_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, M, NAME } from './approval-rules-world.mjs';
import { createHandler } from '../supabase/functions/payroll-expense/handler.mjs';

const PE = M('20261218090000_payroll_expense');
const EXTRA = [['E15', 'Pia Pin', 'office_crew', 'Office Crew', 'OFFICE'], ['E16', 'Quinn Pin', 'office_crew', 'Office Crew', 'OFFICE']];

async function world({ withPe = true, grant = true } = {}) {
  const s = await setup({});
  await s.pg.exec('reset role');
  await s.pg.exec(M('20261213090000_wr_lost'));
  for (const [id, nm, role, title, store] of EXTRA) {
    await s.pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, nm, role, title, store, JSON.stringify({ name: nm, status: '在籍' })]);
    NAME[id] = nm;
  }
  await s.pg.exec(M('20261217090000_wr_actor_crew_grant'));
  if (withPe) await s.pg.exec(PE);
  await s.pg.exec('set role service_role');
  if (grant) assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: null, reimburse: null, crew: true, expect_rev: 0 })).status, 200);
  // G1 の店のスタッフ（E8・E9）にもガソリン代・立替経費を出せる権限（v1184）
  for (const t of ['E8', 'E9']) assert.equal((await s.call('E2', { action: 'exp_grant_save', target: t, mileage: true, reimburse: true, expect_rev: 0 })).status, 200);
  // 関数 payroll-expense：whoami は本物の work-requests の handler へ
  const wrWho = async tok => { const r = await s.handler(new Request('https://fn.test/work-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'whoami', pin_session: tok }) }));
    if (r.status !== 200) return null; const j = await r.json(); return j.me; };
  let clock = Date.now();
  const h = createHandler({ env: k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' })[k], db: s.db, now: () => clock,
    whoami: async tok => { const me = await wrWho(tok); return me && { emp: me.emp, role: me.role, name: me.name }; } });
  const pe = async (who, body) => {
    const r = await h(new Request('https://fn.test/payroll-expense', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://funergy-plus.com' },
      body: JSON.stringify({ pin_session: 'pin-' + who, ...body }) }));
    return { status: r.status, body: await r.json() };
  };
  const peOk = async (who, body) => { const r = await pe(who, body); assert.equal(r.status, 200, who + ' ' + body.action + ' ' + JSON.stringify(r.body)); return r.body; };
  return { ...s, pe, peOk, tick: ms => { clock += ms; } };
}
// 精算確定（経理が「確認した」）まで。checked_at をハワイの日 day の正午に（日付を決めるため）
async function checked(s, who, kind, cents, day, store = ({ E9: 'S2' })[who] || 'S1') {
  const r = await s.subOk(who, kind, store, kind === 'reimburse' ? { amount_cents: Math.max(cents, 1) } : { one_way_miles: 1 });
  assert.equal((await s.approve('E2', r)).status, 200);
  const f = await s.fresh(r);
  const c = await s.act('E3', f, 'check');
  assert.equal(c.status, 200, 'check ' + JSON.stringify(c.body));
  await s.q(`update wr_requests set amount_cents = $2, checked_at = ($3 || ' 12:00')::timestamp at time zone 'Pacific/Honolulu' where id = $1`, [r.id, cents, day]);
  return r.id;
}
// 前の画面から写した記録（legacy）
async function legacy(s, { kind, status = 'paid', who = 'E8', cents, paidAt = '', method = null, archivedMonth = null, use = '2026-11-03' }) {
  const rows = await s.q(`insert into wr_requests (code, kind, status, store_id, requester_emp, requester_name, amount_cents, use_date, pay_method, legacy, legacy_ref, legacy_info)
    values ('LG-' || substr(md5(random()::text), 1, 10), $1, $2, 'S1', $3, $4, $5, $6::date, $7, true, 'lg:' || md5(random()::text), $8) returning id`,
    [kind, status, who, NAME[who], cents, use, method, JSON.stringify({ src: kind === 'mileage' ? 'mileage_requests' : 'reimbursements', id: 'x' + Math.random(), paidAt, archivedMonth })]);
  return rows[0].id;
}
const row = (v, emp) => v.rows.find(x => x.emp === emp);
const P = (b, per) => b.periods.find(x => x.period === per);

test('支給日：1〜15 日は 22 日・16 日〜末日は翌月 7 日。土日は前の金曜・平日の祝日は前の営業日（米国の銀行の休日）・設定で足す／外す', async () => {
  const s = await world();
  const pd = async per => (await s.q(`select public.pe_pay_day($1)::text d`, [per]))[0].d;
  assert.equal(await pd('2026-11-1'), '2026-11-20', '11/22 は日曜 → 金曜');
  assert.equal(await pd('2026-11-2'), '2026-12-07');
  assert.equal(await pd('2027-02-1'), '2027-02-22');
  assert.equal(await pd('2026-05-2'), '2026-06-05', '6/7 は日曜 → 金曜');
  assert.equal(await pd('2026-08-1'), '2026-08-21', '8/22 は土曜 → 金曜');
  assert.equal(await pd('2027-08-2'), '2027-09-07');
  assert.equal(await pd('2027-06-1'), '2027-06-22');
  // 平日の祝日：2027/12/7（火）ではなく … 合成：12/22 を休日に足すと前の営業日
  assert.equal(await pd('2027-12-1'), '2027-12-22');
  const g = await s.peOk('E3', { action: 'get', ym: '2027-12' });
  const save = await s.peOk('E3', { action: 'cfg_save', day_first: 22, day_second: 7, add: ['2027-12-22', '2027-12-21'], off: [], expect_rev: g.settings.rev });
  assert.equal(save.rev, g.settings.rev + 1);
  assert.equal(await pd('2027-12-1'), '2027-12-20', '22・21 が休日 → 20（月）');
  // 米国の銀行の休日：2027/7/5（月）は独立記念日（7/4 が日曜）・2026/10/12 コロンブスデー
  assert.equal(await pd('2027-06-2'), '2027-07-07');
  await s.peOk('E3', { action: 'cfg_save', day_first: 5, day_second: 7, add: [], off: [], expect_rev: save.rev });
  assert.equal(await pd('2027-07-1'), '2027-07-02', '7/5 は祝日（独立記念日の振替）→ 前の金曜');
  assert.equal(await pd('2026-10-1'), '2026-10-05');
  // 外す
  const g2 = await s.peOk('E3', { action: 'get', ym: '2027-07' });
  await s.peOk('E3', { action: 'cfg_save', day_first: 5, day_second: 7, add: [], off: ['2027-07-05'], expect_rev: g2.settings.rev });
  assert.equal(await pd('2027-07-1'), '2027-07-05');
  // 事務Crew は設定を変えられない・古い rev は conflict・形が違えば bad_value
  assert.equal((await s.pe('E15', { action: 'cfg_save', day_first: 22, day_second: 7, add: [], off: [], expect_rev: g2.settings.rev + 1 })).body.error, 'forbidden');
  assert.equal((await s.pe('E3', { action: 'cfg_save', day_first: 22, day_second: 7, add: [], off: [], expect_rev: 0 })).body.error, 'conflict');
  assert.equal((await s.pe('E3', { action: 'cfg_save', day_first: 29, day_second: 7, expect_rev: g2.settings.rev + 1 })).body.error, 'bad_value');
  assert.equal((await s.pe('E3', { action: 'cfg_save', day_first: 22, day_second: 7, add: ['2027-13-01'], expect_rev: g2.settings.rev + 1 })).body.error, 'bad_value');
});

test('1 B：精算確定の日（ハワイ）の期間に割当を保存・1 人 1 行・セント・6 列（ガソリン代・立替経費・精算額合計・既払・今回 Payroll）', async () => {
  const s = await world();
  const a1 = await checked(s, 'E8', 'mileage', 1234, '2026-11-03');
  const a2 = await checked(s, 'E8', 'reimburse', 5001, '2026-11-15');
  const a3 = await checked(s, 'E9', 'reimburse', 799, '2026-11-16');
  const a4 = await checked(s, 'E8', 'mileage', 2, '2026-11-30');
  const g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  const p1 = P(g, '2026-11-1'), p2 = P(g, '2026-11-2');
  assert.equal(p1.state, 'open'); assert.equal(p1.pay_day, '2026-11-20');
  assert.deepEqual(p1.rows.map(r => [r.name, r.gas, r.reimb, r.total, r.other, r.payroll]), [['Cam Crew', 1234, 5001, 6235, 0, 6235]]);
  assert.deepEqual(p2.rows.map(r => [r.name, r.gas, r.reimb, r.total, r.other, r.payroll]).sort(), [['Cam Crew', 2, 0, 2, 0, 2], ['Kai Kitchen', 0, 799, 799, 0, 799]]);
  assert.equal(p1.totals.payroll, 6235); assert.equal(p2.totals.payroll, 801);
  assert.deepEqual(p1.lines.map(l => l.id).sort(), [a1, a2].sort(), '行から元の申請へ（id・code）');
  assert.ok(p1.lines.every(l => /^[A-Z]/.test(l.code)));
  assert.deepEqual(p2.lines.map(l => l.id).sort(), [a3, a4].sort());
  const al = await s.q(`select request_id, period, how, basis from pe_alloc where off_at is null order by period, basis`);
  assert.equal(al.length, 4); assert.ok(al.every(x => x.how === 'auto'));
  assert.equal(al.find(x => x.request_id === a2).basis, 'checked:2026-11-15');
  // 二度読んでも同じ（割当を増やさない）
  await s.peOk('E15', { action: 'get', ym: '2026-11' });
  assert.equal((await s.q(`select count(*)::int n from pe_alloc`))[0].n, 4);
  // ほかの月には入らない
  const oct = await s.peOk('E3', { action: 'get', ym: '2026-10' });
  assert.equal(P(oct, '2026-10-2').lines.length, 0);
});

test('3 B：前に精算済み（支払日）・前の画面の支払済（日本時間 → ハワイ）は既払。境目をまたぐ日付だけ「支給期間要確認」・月末処理は「支払状況要確認」', async () => {
  const s = await world();
  const c1 = await checked(s, 'E8', 'reimburse', 3000, '2026-11-04');
  // このシステムで「支払」を記録したもの（支払日 11/10）：既払・他経路
  const p1 = await checked(s, 'E8', 'reimburse', 700, '2026-11-02');
  const f = await s.fresh({ id: p1 });
  assert.equal((await s.act('E3', f, 'pay', { pay_date: '2026-11-10', pay_method: 'check' })).status, 200);
  // 前の画面：日本時間 11/16 09:00 → ハワイ 11/15 14:00（前の期間）
  const l1 = await legacy(s, { kind: 'reimburse', cents: 450, paidAt: '2026/11/16 09:00' });
  // 日付だけ 11/16 → ハワイでは 11/15 か 11/16（境目）→ 要確認
  const l2 = await legacy(s, { kind: 'reimburse', cents: 990, paidAt: '2026/11/16' });
  // 日付だけ 11/20 → どちらでも 16〜末日
  const l3 = await legacy(s, { kind: 'reimburse', cents: 120, who: 'E9', paidAt: '2026/11/20' });
  // ガソリン代の月末処理
  const l4 = await legacy(s, { kind: 'mileage', cents: 3300, method: '月末処理', archivedMonth: '2026-11' });
  const g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  const a = P(g, '2026-11-1'), b = P(g, '2026-11-2');
  const cam = row(a, 'E8');
  assert.deepEqual([cam.reimb, cam.total, cam.other, cam.payroll], [3000 + 700 + 450, 4150, 1150, 3000], '既払（支払日・日本時間 → ハワイ）は払わない');
  assert.deepEqual(a.lines.filter(l => l.state === 'other').map(l => l.id).sort(), [p1, l1].sort());
  assert.deepEqual(b.rows.map(r => [r.emp, r.other, r.payroll]), [['E9', 120, 0]]);
  assert.ok(!a.lines.concat(b.lines).some(l => l.id === l2 || l.id === l4), '要確認は支給に入れない');
  const rv = g.review.map(x => [x.type, x.id]).sort();
  assert.deepEqual(rv, [['month_end', l4], ['unsure', l2]].sort());
  assert.equal(g.review.find(x => x.id === l2).why, 'legacy_border');
  void c1;
  // 要確認を理由つきで期間に入れる（既払として）
  const as = await s.peOk('E3', { action: 'assign', ids: [l2], period: '2026-11-2', reason: '送金の記録で 11/16 と確かめた' });
  assert.equal(as.n, 1);
  const g2 = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.equal(row(P(g2, '2026-11-2'), 'E8').other, 990);
  assert.deepEqual(g2.review.map(x => x.id), [l4]);
});

test('出力は版を作る（同じ中身なら前の版）・出力しただけでは支給済みにしない・あとで変われば「変わった」→ 次の版', async () => {
  const s = await world();
  const a = await checked(s, 'E8', 'mileage', 1500, '2026-11-05');
  const x1 = await s.peOk('E15', { action: 'export', period: '2026-11-1' });
  assert.equal(x1.ver, 1); assert.equal(x1.same, false); assert.equal(x1.totals.payroll, 1500);
  const x2 = await s.peOk('E3', { action: 'export', period: '2026-11-1' });
  assert.equal(x2.ver, 1); assert.equal(x2.same, true, '同じ中身');
  let g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.equal(P(g, '2026-11-1').state, 'exported');
  assert.equal((await s.q(`select status from wr_requests where id = $1`, [a]))[0].status, 'checked', '出力しただけでは精算済みにしない');
  // 出力のあとに精算確定が増えた（出力済み・未支給の期間に足す）
  await checked(s, 'E9', 'reimburse', 250, '2026-11-14');
  g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.equal(P(g, '2026-11-1').state, 'changed');
  assert.equal(P(g, '2026-11-1').totals.payroll, 1750);
  const x3 = await s.peOk('E3', { action: 'export', period: '2026-11-1' });
  assert.equal(x3.ver, 2);
  // 前の版の写しはそのまま
  const v1 = await s.peOk('E3', { action: 'ver', period: '2026-11-1', ver: 1 });
  assert.equal(v1.totals.payroll, 1500); assert.equal(v1.lines.length, 1);
  g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.deepEqual(g.versions.map(v => [v.period, v.ver]), [['2026-11-1', 2], ['2026-11-1', 1]]);
});

test('4 A・7 A：支給済みは期間ごとに 1 回（いちばん新しい版・変わっていないとき）・申請は精算済み（Payroll・支給日）・そのあとは割当を変えない・次の精算確定は次の期間', async () => {
  const s = await world();
  const a = await checked(s, 'E8', 'mileage', 1500, '2026-11-05');
  const b = await checked(s, 'E9', 'reimburse', 2500, '2026-11-06');
  // 出していない・古い版・指紋が違う → 断る
  assert.equal((await s.pe('E3', { action: 'paid', period: '2026-11-1', ver: 1, fp: '0'.repeat(32) })).body.error, 'not_exported');
  const x = await s.peOk('E3', { action: 'export', period: '2026-11-1' });
  assert.equal((await s.pe('E3', { action: 'paid', period: '2026-11-1', ver: 1, fp: '0'.repeat(32) })).body.error, 'conflict');
  // 出したあとで中身が変わった → changed（もう一度出す）
  const c = await checked(s, 'E8', 'reimburse', 100, '2026-11-07');
  assert.equal((await s.pe('E3', { action: 'paid', period: '2026-11-1', ver: x.ver, fp: x.fp })).body.error, 'changed');
  const x2 = await s.peOk('E3', { action: 'export', period: '2026-11-1' });
  // 店のスタッフ・AM は断る
  assert.equal((await s.pe('E8', { action: 'paid', period: '2026-11-1', ver: x2.ver, fp: x2.fp })).status, 403);
  assert.equal((await s.pe('E5', { action: 'get', ym: '2026-11' })).status, 403);
  // 確かめた PIN の事務Crew が支給済みにする
  const pd = await s.peOk('E15', { action: 'paid', period: '2026-11-1', ver: x2.ver, fp: x2.fp, note: '11/20 の Payroll' });
  assert.equal(pd.pay_day, '2026-11-20'); assert.equal(pd.paid_requests, 3);
  const st = await s.q(`select id, status, pay_method, pay_date::text, paid_emp from wr_requests where id = any($1::uuid[]) order by id`, [[a, b, c]]);
  assert.ok(st.every(r => r.status === 'paid' && r.pay_method === 'Payroll' && r.pay_date === '2026-11-20' && r.paid_emp === 'E15'), JSON.stringify(st));
  const ev = await s.q(`select count(*)::int n from wr_events where request_id = any($1::uuid[]) and action = 'pay' and note like 'Payroll の期間 2026-11-1%'`, [[a, b, c]]);
  assert.equal(ev[0].n, 3);
  // 2 回目は断る・出し直しは断る（写しは ver で）
  assert.equal((await s.pe('E3', { action: 'paid', period: '2026-11-1', ver: x2.ver, fp: x2.fp })).body.error, 'paid_period');
  assert.equal((await s.pe('E3', { action: 'export', period: '2026-11-1' })).body.error, 'paid_period');
  // 支給済みの期間は写しのまま・既払に数え直さない（二重に数えない）
  let g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  const p1 = P(g, '2026-11-1');
  assert.equal(p1.state, 'paid'); assert.equal(p1.totals.payroll, 4100); assert.deepEqual(p1.late, []);
  assert.equal(p1.paid.by, 'Pia Pin');
  assert.equal(P(g, '2026-11-2').lines.length, 0, '精算済みになった申請を 3 B（支払日）で 12/7 の期間に入れ直さない');
  // 支給済みの期間の割当は変えない・支給済みの期間へも入れない
  assert.equal((await s.pe('E3', { action: 'assign', ids: [a], period: '2026-11-2', reason: 'x' })).body.error, 'paid_period');
  const d = await checked(s, 'E8', 'mileage', 900, '2026-11-08');
  assert.equal((await s.pe('E3', { action: 'assign', ids: [d], period: '2026-11-1', reason: 'x' })).body.error, 'paid_period');
  // 11/8 に精算確定（11/1〜15 の期間はもう支給済み）→ 次の期間
  g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.deepEqual(P(g, '2026-11-2').lines.map(l => l.id), [d]);
});

test('割当を分ける（理由・合計が同じ・2〜4 つ）：分けた申請は両方の期間が支給済みになるまで精算確定のまま', async () => {
  const s = await world();
  const a = await checked(s, 'E8', 'reimburse', 10000, '2026-11-05');
  // 理由が無い・合計が違う・同じ期間・形
  assert.equal((await s.pe('E3', { action: 'assign', id: a, parts: [{ period: '2026-11-1', cents: 6000 }, { period: '2026-11-2', cents: 4000 }], reason: '' })).body.error, 'reason_required');
  assert.equal((await s.pe('E3', { action: 'assign', id: a, parts: [{ period: '2026-11-1', cents: 6000 }, { period: '2026-11-2', cents: 3000 }], reason: '2 回に分ける' })).body.error, 'sum_mismatch');
  assert.equal((await s.pe('E3', { action: 'assign', id: a, parts: [{ period: '2026-11-1', cents: 6000 }, { period: '2026-11-1', cents: 4000 }], reason: 'x' })).body.error, 'bad_value');
  assert.equal((await s.pe('E3', { action: 'assign', id: a, parts: [{ period: '2026-11-1', cents: 60.5 }, { period: '2026-11-2', cents: 4000 }], reason: 'x' })).body.error, 'bad_value');
  assert.equal((await s.pe('E3', { action: 'assign', ids: ['not-a-uuid'], period: '2026-11-1', reason: 'x' })).body.error, 'bad_value');
  await s.peOk('E15', { action: 'assign', id: a, parts: [{ period: '2026-11-1', cents: 6000 }, { period: '2026-11-2', cents: 4000 }], reason: '2 回に分ける' });
  let g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.equal(row(P(g, '2026-11-1'), 'E8').payroll, 6000); assert.equal(row(P(g, '2026-11-2'), 'E8').payroll, 4000);
  const hist = await s.peOk('E3', { action: 'req', id: a });
  assert.equal(hist.alloc.length, 3, '前の割当は残す（off_at）');
  assert.equal(hist.alloc[0].how, 'auto'); assert.ok(hist.alloc[0].off_at); assert.equal(hist.alloc[0].off_reason, '2 回に分ける');
  const x = await s.peOk('E3', { action: 'export', period: '2026-11-1' });
  await s.peOk('E3', { action: 'paid', period: '2026-11-1', ver: x.ver, fp: x.fp });
  assert.equal((await s.q(`select status from wr_requests where id = $1`, [a]))[0].status, 'checked', '残りがあるので精算確定のまま');
  g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.equal(P(g, '2026-11-2').lines[0].state, 'pay'); assert.equal(P(g, '2026-11-2').lines[0].cents, 4000);
  const y = await s.peOk('E3', { action: 'export', period: '2026-11-2' });
  const pd = await s.peOk('E3', { action: 'paid', period: '2026-11-2', ver: y.ver, fp: y.fp });
  assert.equal(pd.paid_requests, 1);
  const st = (await s.q(`select status, pay_date::text from wr_requests where id = $1`, [a]))[0];
  assert.deepEqual(st, { status: 'paid', pay_date: '2026-12-07' });
});

test('負の差額は給与から引かない（今回の支給の合計に入れない・その人は要確認）。金額と日付が同じ申請は 2 件のまま', async () => {
  const s = await world();
  await checked(s, 'E8', 'reimburse', 500, '2026-11-05');
  const n = await checked(s, 'E9', 'reimburse', 500, '2026-11-05');
  await s.q(`update wr_requests set amount_cents = -800 where id = $1`, [n]);
  // 同じ人・同じ金額・同じ日（申請では重複の確かめがあるので 501 で出して、額を 500 に）
  const twin = await checked(s, 'E8', 'reimburse', 501, '2026-11-05');
  await s.q(`update wr_requests set amount_cents = 500 where id = $1`, [twin]);
  const g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  const p = P(g, '2026-11-1');
  assert.equal(row(p, 'E9').payroll, -800);
  assert.equal(p.totals.payroll, 1000, 'マイナスの人を引かない'); assert.equal(p.totals.negative, 1);
  assert.equal(row(p, 'E8').n, 2, '同じ金額・同じ日の 2 件を消さない');
  void twin;
});

test('自動の割当のまま、もう一度精算確定になった申請（差し戻し → 確認）は、新しい精算確定の日の期間へ。手で決めた割当は動かさない', async () => {
  const s = await world();
  const a = await checked(s, 'E8', 'mileage', 1000, '2026-11-05');
  const b = await checked(s, 'E9', 'mileage', 1000, '2026-11-05');
  await s.peOk('E3', { action: 'get', ym: '2026-11' });
  await s.peOk('E3', { action: 'assign', ids: [b], period: '2026-11-1', reason: 'この期間で払う' });
  await s.q(`update wr_requests set checked_at = '2026-11-18 12:00'::timestamp at time zone 'Pacific/Honolulu' where id = any($1::uuid[])`, [[a, b]]);
  const g = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.deepEqual(P(g, '2026-11-2').lines.map(l => l.id), [a]);
  assert.deepEqual(P(g, '2026-11-1').lines.map(l => l.id), [b]);
  // 精算確定でなくなった申請（取り消し）は「要確認」に出る（割当は残る）
  await s.q(`update wr_requests set status = 'approved' where id = $1`, [b]);
  const g2 = await s.peOk('E3', { action: 'get', ym: '2026-11' });
  assert.deepEqual(g2.review.filter(x => x.type === 'out').map(x => x.id), [b]);
  assert.equal(P(g2, '2026-11-1').lines.length, 0);
});

test('だれが：CEO・GM・経理・確かめた PIN の事務Crew は読める・出せる。確かめていない事務Crew・店のスタッフ・AM・店のタブレット・退職は断る。給与・Tip は返さない', async () => {
  const s = await world();
  await checked(s, 'E8', 'mileage', 1000, '2026-11-05');
  for (const who of ['E1', 'E2', 'E3', 'E4', 'E15']) assert.equal((await s.pe(who, { action: 'get', ym: '2026-11' })).status, 200, who);
  for (const who of ['E16', 'E8', 'E5', 'E6', 'E11']) assert.equal((await s.pe(who, { action: 'get', ym: '2026-11' })).status, 403, who);
  const r = await s.pe('store-S1', { action: 'get', ym: '2026-11' });
  assert.equal(r.status, 401);
  const txt = JSON.stringify(await s.peOk('E15', { action: 'get', ym: '2026-11' }));
  assert.ok(!/wage|salary|tip|bonus|rate_cents|hourly/i.test(txt.replace(/"(gas|reimb|total|other|payroll)"/g, '')), '給与・Tip の語が無い');
  // SQL でも確かめる（関数を通らずに呼んでも、店のスタッフは断る）
  await assert.rejects(s.db.rpc('pe_get', { emp_id: 'E8', name: 'Cam Crew', ym: '2026-11' }), /forbidden/);
  await s.retire('E15');
  assert.equal((await s.pe('E15', { action: 'get', ym: '2026-11' })).status, 403, '関数は whoami を 60 秒覚えているが、SQL（wr_actor）がすぐ断る');
  s.tick(60001);
  assert.equal((await s.pe('E15', { action: 'get', ym: '2026-11' })).status, 401, '退職：whoami が断る');
});

test('SQL がまだ：pe_missing（503）。入力の形が違えば bad_value。関数の答えはいつも fn:1', async () => {
  const s = await world({ withPe: false });
  const r = await s.pe('E3', { action: 'get', ym: '2026-11' });
  assert.equal(r.status, 503); assert.equal(r.body.error, 'pe_missing'); assert.equal(r.body.fn, 1);
  const s2 = await world();
  for (const b of [{ action: 'get', ym: '2026-13' }, { action: 'export', period: '2026-11-3' }, { action: 'ver', period: '2026-11-1', ver: 0 }, { action: 'paid', period: '2026-11-1', ver: 1, fp: 'x' },
    { action: 'assign', ids: [], period: '2026-11-1', reason: 'x' }, { action: 'req', id: '1' }])
    assert.equal((await s2.pe('E3', b)).body.error, 'bad_value', JSON.stringify(b));
  assert.equal((await s2.pe('E3', { action: 'nope' })).body.error, 'unknown_action');
  // 2 回流しても同じ（表・割当・設定を消さない）
  await checked(s2, 'E8', 'mileage', 1000, '2026-11-05');
  await s2.peOk('E3', { action: 'get', ym: '2026-11' });
  await s2.pg.exec('reset role'); await s2.pg.exec(PE); await s2.pg.exec('set role service_role');
  assert.equal((await s2.q(`select count(*)::int n from pe_alloc`))[0].n, 1);
  // サーバーの鍵だけ（anon・authenticated は表も関数も使えない）
  const g = await s2.q(`select has_table_privilege('anon', 'public.pe_alloc', 'select') a, has_table_privilege('authenticated', 'public.pe_exports', 'select') b,
    has_function_privilege('anon', 'public.pe_get(jsonb)', 'execute') c, has_function_privilege('authenticated', 'public.pe_mark_paid(jsonb)', 'execute') d`);
  assert.deepEqual(g[0], { a: false, b: false, c: false, d: false });
});
