// まとめての手順（deploy/all-v1141-v1152/）：まとめて確かめる SQL（0_まとめ確かめ_読むだけ.sql）が、
// それぞれの版の ①（1_確かめ_読むだけ.sql）を 1 つずつ流したときと同じ行を返す（本物の PostgreSQL＝PGlite・合成データだけ）。
// 何も書き換えない（流す前とあとで app_state・manager_auth・employees・stores が同じ）。手順.md が使うファイルがある。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from './runtime/node_modules/@electric-sql/pglite/dist/index.js';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const D = 'deploy/all-v1141-v1152/';
const V = [['v1141', 'secure-settings-v1141'], ['v1142', 'secure-hr-v1142'], ['v1143', 'secure-settings-v1143'], ['v1144', 'secure-pii-v1144'],
  ['v1145', 'secure-grade-hist-v1145'], ['v1146', 'secure-tip-prep-v1146'], ['v1147', 'secure-tip-cf-v1147'], ['v1148', 'secure-grade-bonus-read-v1148'],
  ['v1151', 'change-signal-v1151'], ['v1152', 'secure-notifications-v1152']];
const MIG = n => rd('supabase/migrations/' + fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).find(f => f.startsWith(n)));

async function mkdb(extra) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.stores(id text primary key, name text, brand text, am text, active boolean, data jsonb);
    insert into public.stores(id, name) values ('S1', 'Store One'), ('S2', 'Store Two');
    insert into public.manager_auth(role, emp_id) values ('gm','E-GM'), ('ceo', null), ('office', 'E-OF');
    insert into public.employees(id, name, role, title, store, status, data) values
      ('E-GM','Gina M','gm','General Manager','HQ','',null), ('E-AM','Amy Area','am','Area Manager','S1','',null),
      ('E-3','Sal Three','sl','Store Leader','S1','',null), ('E-2','Lee Two','g2','Crew Leader','S2','','{"birthday":"1990-01-02","cardLast4":"1234"}'),
      ('E-CH','Chef Ken',null,'','S1','','{"role":"chef","title":"Head Chef"}'), ('E-1','Kai One','crew','Crew','S1','',null),
      ('E-OF','Ona Office','office','Accountant','HQ','',null), ('E-OUT','Gone','sl','Store Leader','S1','退職',null);`);
  await db.exec(MIG('20261104090000'));   // ワークセンター（wr_people）
  if (extra) await extra(db);
  await db.exec(`alter table public.app_state enable row level security; create policy app_all on public.app_state for all to public using (true) with check (true);`);
  for (const [k, v] of [['mileage_config', { rate: 0.7 }], ['career_cfg', { x: 1 }], ['applicants', [{ id: 'a1', store: 'S1' }]], ['reject_log', []],
    ['growthhub', []], ['grade_hist', { 'E-3': [] }], ['spl_tip_requests_Kai One', [{ id: 't1' }]], ['tip_cf_S1_2026', { a: 1 }], ['warnings_S1', []],
    ['bonus_ovr', {}], ['bonus_track', {}], ['notifications', [{ id: 'n1', title: 'x', toRoles: ['sl'] }]], ['prep_tables', {}], ['prep_certs', {}],
    ['growth_karte', {}], ['lss_emp_Kai One', {}], ['tasks_all', []]]) await db.query('insert into public.app_state(key, value) values ($1, $2)', [k, JSON.stringify(v)]);
  await db.exec(MIG('20261027090000'));   // app_state_index
  await db.exec(MIG('20261108090000'));   // v1139（本番に入っている）
  return db;
}
const resRows = async (db, sql) => (await db.exec(sql)).filter(r => r.fields && r.fields.some(f => f.name === 'what')).pop().rows;
// まとめた表は人の名前を伏せる（Codex #146 6849760483 P2-1）。SQL の最後の select と同じ決まり（試験の中で独立に書いた写し）
const names = async db => (await db.query(`select btrim(coalesce(nullif(btrim(name), ''), data->>'name', '')) n from public.employees`)).rows.map(r => r.n).filter(n => [...n].length >= 2);
const masked = (nm, v, n, val) => {
  if (v === 'v1142' && n === 11) return String(val ?? '').split('：')[0] + (String(val ?? '').includes('：') ? '（名前は出しません）' : '');
  if (val != null && nm.some(x => String(val).includes(x))) return /^[0-9]+：/.test(val) ? String(val).split('：')[0] + '（名前は出しません）' : '（名前を含むので出しません）';
  return val;
};
const snap = async db => JSON.stringify([(await db.query('select key, value::text from public.app_state order by key')).rows,
  (await db.query('select * from public.manager_auth order by user_id')).rows.length, (await db.query('select * from public.employees order by id')).rows,
  (await db.query('select * from public.stores order by id')).rows]);

test('the combined check returns exactly the rows of each version\'s ① run one by one (with people\'s names hidden), and changes nothing', async () => {
  const all = rd(D + '0_まとめ確かめ_読むだけ.sql');
  for (const extra of [null, async db => { await db.exec(MIG('20261113080000')); await db.exec(MIG('20261116080000')); }]) {
    const db = await mkdb(extra);
    const one = [], nm = await names(db);
    for (const [v, d] of V) {
      const rows = await resRows(db, rd('deploy/' + d + '/1_確かめ_読むだけ.sql'));
      assert.ok(rows.length >= 5, v + ' returns its rows');
      for (const r of rows) one.push([v, Number(r.n), String(r.what), masked(nm, v, Number(r.n), r.value == null ? null : String(r.value)), r.ok == null ? null : String(r.ok)]);
    }
    const before = await snap(db);
    const got = (await resRows(db, all)).map(r => [r.v, Number(r.n), r.what, r.value, r.ok]);
    assert.equal(await snap(db), before, 'nothing is changed');
    const key = a => a[0] + '|' + String(a[1]).padStart(3, '0') + '|' + a[2];
    one.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    got.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    assert.deepEqual(got, one);
    assert.deepEqual([...new Set(got.map(r => r[0]))], V.map(x => x[0]), 'every version is in it');
    await db.close();
  }
});

test('the combined check is made of each version\'s ① as it is (nothing rewritten)', () => {
  const all = rd(D + '0_まとめ確かめ_読むだけ.sql');
  for (const [v, d] of V) {
    const s = rd('deploy/' + d + '/1_確かめ_読むだけ.sql').trimEnd();
    if (v === 'v1146') {
      const body = s.split('\n').filter(l => l.trim() !== 'begin;' && l.trim() !== 'rollback;' && !l.startsWith('select n, what, value, ok from tp_pre')).join('\n');
      assert.ok(all.includes(body), v);
    } else assert.ok(all.includes(s.slice(0, -1) + '\n) x;'), v);
  }
  assert.match(all, /^begin;$/m); assert.match(all, /^rollback;$/m); assert.ok(!/^commit;/m.test(all), 'never commits');
});

test('the combined procedure names every file it uses, and they exist', () => {
  const how = rd(D + '手順.md');
  for (const [, d] of V) for (const f of fs.readdirSync(new URL('../deploy/' + d + '/', import.meta.url)).filter(f => /^[1-4]/.test(f))) {
    assert.ok(how.includes(d + '/' + f) || how.includes(f), '手順.md names ' + d + '/' + f);
  }
  assert.ok(how.includes('deploy/secure-notifications-v1152/2_関数_secure-state_index.ts'));
  assert.ok(how.includes('0_まとめ確かめ_読むだけ.sql'));
  // A-5 で関数を入れ替えるので、A の前の関数（v1140・main 2d83214 の本番と同じ）に戻す道も書く（Codex #146 6849760483 の限界）
  assert.ok(how.includes('deploy/secure-cs-v1140/2_関数_secure-state_index.ts'));
  assert.ok(fs.existsSync(new URL('../deploy/secure-cs-v1140/2_関数_secure-state_index.ts', import.meta.url)));
  assert.ok(!how.includes('1140 のまま。何も変わりません'), 'A changes the scope of not-yet-confirmed leaders (A-4)');
});

test('Codex #146 6849760483 P2-1: the combined check never shows a person\'s name (the unconfirmed AM is a count only; any value with an employee name is hidden); the procedure says what is shown', async () => {
  const all = rd(D + '0_まとめ確かめ_読むだけ.sql');
  const db = await mkdb(async db => {
    // 名前が値に混ざる行を作る：社員の名前が「ON」（v1141 の 2 行目の値）・名前が data にだけある人・退職した人
    await db.exec(`insert into public.employees(id, name, role, title, store, status, data) values
      ('E-ON', 'ON', 'crew', 'Crew', 'S1', '', null), ('E-DATA', '', 'g4', 'Store Manager', 'S2', '', '{"name":"Dana Data"}'),
      ('E-G4', 'Gus Four', 'g4', 'Store Manager', 'S1', '', null)`);
  });
  const one = await resRows(db, rd('deploy/secure-hr-v1142/1_確かめ_読むだけ.sql'));
  const raw11 = String(one.find(r => Number(r.n) === 11).value);
  assert.match(raw11, /Amy Area/, 'the single v1142 ① shows names (by design)');
  assert.match(raw11, /Gus Four/);
  const got = await resRows(db, all);
  const nm = await names(db);
  assert.ok(nm.includes('Dana Data') && nm.includes('Gone') && nm.includes('ON'));
  for (const r of got) for (const x of nm) assert.ok(!String(r.value ?? '').includes(x), r.v + '/' + r.n + ' shows ' + x + ': ' + r.value);
  const r11 = got.find(r => r.v === 'v1142' && Number(r.n) === 11);
  assert.equal(r11.value, raw11.split('：')[0] + '（名前は出しません）', 'a count only');
  assert.equal(Number(raw11.split('：')[0]), 3, 'Amy, Gus and the person whose name is only in data');
  assert.equal(got.find(r => r.v === 'v1141' && Number(r.n) === 2).value, '（名前を含むので出しません）', 'any other value with a name is hidden (the safety net)');
  assert.equal(got.find(r => r.v === 'v1141' && Number(r.n) === 2).ok, 'OK', 'the verdict stays');
  await db.close();
  // 誰も確かめ待ちでないとき：数だけ（伏せた印も付かない）
  const db2 = await mkdb(async db => { await db.exec(`update public.employees set role = 'crew' where role in ('am', 'g4')`); });
  const g2 = await resRows(db2, all);
  assert.equal(g2.find(r => r.v === 'v1142' && Number(r.n) === 11).value, '0');
  await db2.close();
  // 手順と SQL の案内：名前は出さない・単価は出る・公開の場所に貼らない（前は「名前・中身・金額は出ません」）
  const how = rd(D + '手順.md');
  for (const t of [all, how]) {
    assert.ok(!t.includes('名前・中身・金額は出ません'), 'the old promise is gone');
    assert.match(t, /ガソリン代の単価/); assert.match(t, /公開の PR・Issue/); assert.match(t, /承認・閲覧の権限の確かめ/);
  }
});
