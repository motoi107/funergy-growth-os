// v1190：共通ルールで動かしたあとの一覧（wr_list）と一括承認（ar_bulk）の時間（PR #191 のレビュー P2-1・合成データ・PGlite）。
// 使い方：node tests/perf/approval-rules-list.mjs [申請の数=2000] [写しの人数を足す=40]
// PGlite は 1 本の接続・WASM なので、本物の PostgreSQL より遅く出る（比べるための目安）。本番のデータでは測っていない。
import { setup, G, C, AMm, STAGE } from '../approval-rules-world.mjs';

const N = Number(process.argv[2] || 2000), EXTRA = Number(process.argv[3] || 40);
const s = await setup();
// 写し（wr_people）の人数を増やす：店を 12 に・AM を 6 人・G4 の店長と Head Chef を店ごとに
await s.q(`insert into stores select 'X' || i, 'Extra ' || i, null, true from generate_series(1, 9) i`);
for (let i = 1; i <= EXTRA; i++) {
  const st = 'X' + (1 + (i % 9)), id = 'P' + i;
  const role = i <= 6 ? 'am' : i % 3 === 0 ? 'chef' : 'sl';
  const title = role === 'am' ? 'Area Manager' : role === 'chef' ? 'Head Chef' : 'Store Manager';
  await s.q(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, 'Person ' + i, role, title, st, JSON.stringify({ name: 'Person ' + i, status: '在籍' })]);
  if (role === 'am') await s.q(`update stores set am = $1 where id in ($2, $3)`, ['Person ' + i, 'X' + (1 + (i % 9)), 'X' + (1 + ((i + 4) % 9))]);
}
const gm = { emp_id: 'E2', name: 'Gabe GM' };
const d = await s.db.rpc('wr_people_diff', gm); await s.db.rpc('wr_people_sync', { ...gm, digest: d.digest });
const people = (await s.q(`select count(*)::int as n from wr_people`))[0].n;
await s.activate(); await s.live();
await s.setRule('hire', { branches: [{ label: 'AM', when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] } });

// ひな形：種類と店をいくつか（ルートの付いた本物の申請）
const tpl = [];
for (const [who, kind, store] of [['E8', 'hire', 'S1'], ['E8', 'shift', 'S1'], ['E9', 'leave', 'S2'], ['E6', 'reimburse', 'S1'], ['E14', 'mileage', 'S2'],
  ['E13', 'resign', 'S3'], ['E8', 'tip_self', 'S1'], ['E9', 'skill_self', 'S2'], ['E6', 'expense_pre', 'S1'], ['E6', 'plan', 'S1']]) tpl.push(await s.subOk(who, kind, store));
const cols = (await s.q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'wr_requests' order by ordinal_position`)).map(r => r.column_name);
const expr = c => ({ id: 'gen_random_uuid()', code: `t.code || '-' || g`, client_key: 'null', legacy_ref: 'null', ap_id: `case when t.ap_id is null then null else t.ap_id || '-' || g end`, apply_key: 'null',
  status: `case when g % 10 < 3 then t.status when g % 10 < 6 then 'done' when g % 10 < 8 then 'rejected' else 'withdrawn' end`,
  submitted_at: `now() - (g || ' hours')::interval`, updated_at: `now() - (g || ' hours')::interval`,
  route: `case when g % 10 < 3 then t.route else t.route || jsonb_build_object('final', now()) end` }[c] || 't.' + c);
await s.q(`alter table wr_requests disable trigger ar_route_trg`);
await s.q(`insert into wr_requests(${cols.join(',')}) select ${cols.map(expr).join(',')} from wr_requests t cross join generate_series(1, ${Math.ceil(N / tpl.length)}) g where t.code = any($1)`, [tpl.map(t => t.code)]);
await s.q(`alter table wr_requests enable trigger ar_route_trg`);
const total = (await s.q(`select count(*)::int as n, count(*) filter (where status = 'pending')::int as p from wr_requests`))[0];

const time = async (label, who, body) => {
  const t0 = performance.now(); const r = await s.call(who, body); const ms = performance.now() - t0;
  console.log(`${label.padEnd(36)} ${String(Math.round(ms)).padStart(6)} ms  status ${r.status}  rows ${(r.body.rows || []).length}  todo ${r.body.counts ? r.body.counts.todo : '-'}`);
  return ms;
};
console.log(`requests ${total.n} (pending ${total.p}) · confirmed people ${people} · stores 12`);
for (const [label, who] of [['GM (E2)', 'E2'], ['AM (E5)', 'E5'], ['accounting (E3)', 'E3'], ['office crew (E4)', 'E4'], ['Head Chef (E11)', 'E11'], ['store G4 (E6)', 'E6'], ['crew (E8)', 'E8']]) {
  await time('list todo · ' + label, who, { action: 'list', scope: 'todo' });
  await time('list team open · ' + label, who, { action: 'list', scope: 'team', state: 'open' });
}
// 一括承認 200 件（GM の段の承認待ち）
const pend = await s.q(`select id::text as id, rev from wr_requests where status = 'pending' and kind in ('shift','plan','resign','tip_self','skill_self') limit 200`);
await time(`bulk_approve ${pend.length} · GM`, 'E2', { action: 'bulk_approve', items: pend.map(p => ({ id: p.id, rev: p.rev })), client_key: 'perf-bulk-0001' });
// 比べるため：スイッチを切ったとき（今までの決まり＝v1189 までと同じ道）の一覧
await s.q(`update ar_settings set live = false where id = 1`);
console.log('--- switch off (the old rules) ---');
for (const [label, who] of [['GM (E2)', 'E2'], ['AM (E5)', 'E5'], ['accounting (E3)', 'E3'], ['office crew (E4)', 'E4']]) {
  await time('list todo · ' + label, who, { action: 'list', scope: 'todo' });
  await time('list team open · ' + label, who, { action: 'list', scope: 'team', state: 'open' });
}
await s.pg.close();
