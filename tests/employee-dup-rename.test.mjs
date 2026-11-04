// db/employee-dup-rename.sql と db/employee-dup-rename-undo.sql（同じ人の記録が 2 つ・片方が退職のとき、退職の記録の名前に「（重複）」）を
// 本番と同じ見張り（退職の守り 20261023090000・変更記録 20261029090000）の上で流す。合成データ（架空の名前）・PGlite。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const GUARD = rd('supabase/migrations/20261023090000_employee_resign_guard.sql');
const FLOG = rd('supabase/migrations/20261029090000_employee_field_log.sql');
const SQL = rd('db/employee-dup-rename.sql');
const UNDO = rd('db/employee-dup-rename-undo.sql');
const CHECK1 = rd('deploy/secure-cs-v1140/1_確かめ_読むだけ.sql');
const SAME = rd('db/cs-same-name-check.sql');

const WANT = /with want\(id\) as \(values[\s\S]*?\n\), cand/;
const fill = (sql, ids) => {
  assert.match(sql, WANT, 'the want block is where the IDs go');
  return sql.replace(WANT, 'with want(id) as (values\n' + ids.map(i => "  ('" + i + "')").join(',\n') + '\n), cand');
};

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.employees(id text primary key, name text, emp_code text, role text, perms text, title text, store text, support jsonb, status text, emp_type text, email text, phone text, data jsonb);
    create table public.auth_pins(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.bot_users(user_id uuid primary key, enabled boolean not null default true, created_at timestamptz not null default now());
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz default now());
    create table public.wr_people(emp_id text primary key, name text not null, role text not null, grade integer not null);`);
  const E = [
    ['e1', 'Aki Sample', '在籍', { status: '在籍', empCode: '101', hireDate: '2026-03-01' }],
    ['e2', 'Aki Sample', null, { status: '退職', empCode: '101', resignDate: '2026-10-22', toastAlias_x: { n: 'Aki S' } }],   // same code, retired the day it was made
    ['e3', 'Ben Sample', '在籍', { status: '在籍', empCode: '202' }],
    ['e4', 'Ben Sample', '退職', { status: '退職', resignDate: '2026-07-03' }],                                            // an import duplicate
    ['e5', 'Cara Sample', '退職', { status: '退職' }], ['e6', 'Cara Sample', '在籍', { status: '在籍', osDisabled: true }], // no one in service holds it
    ['e7', 'Dan Sample', '在籍', { status: '在籍' }],                                                                        // in service: never renamed
    ['e8', 'Eve Sample', '退職', { status: '退職' }], ['e9', 'Eve Sample', '在籍', { status: '在籍' }],                      // a confirmed copy of e8 exists
    ['e10', 'Fay Sample', '退職', { status: '退職', name: 'Fay Old' }], ['e11', 'Fay Sample', '在籍', { status: '在籍' }],    // column and data names differ
    ['e12', 'Gus Sample', '退職', null], ['e13', 'Gus Sample', '在籍', { status: '在籍' }],                                  // no data
  ];
  for (const [id, name, status, d] of E) {
    await pg.query('insert into employees(id,name,role,store,status,data) values($1,$2,$3,$4,$5,$6)',
      [id, name, 'crew', 'F04-P', status, d === null ? null : JSON.stringify({ id, name, ...d })]);
  }
  await pg.query(`insert into wr_people values ('e8','Eve Sample','staff',1)`);
  await pg.query(`insert into auth_pins(id, data) values ('staff', $1)`, [JSON.stringify({ 'Aki Sample': '1111', 'Ben Sample': '2222' })]);
  await pg.query(`insert into app_state(key, value) values ('lss_emp_Aki Sample', '{"scores":{"A-1":2}}')`);
  await pg.exec(GUARD);
  await pg.exec(FLOG);
  return pg;
}
const ALL = ['e2', 'e4', 'e5', 'e7', 'e8', 'e10', 'e12', 'nope'];
const rows = async pg => (await pg.query('select id, name, status, data from employees order by id')).rows;
// one statement updates the rows in no set order: sort by person, keep the time order within a person
const flog = async pg => (await pg.query("select emp_id, field, old_value, new_value, writer from employee_field_log order by emp_id, id")).rows;
const row9 = async pg => {
  const m = CHECK1.match(/select 9,[\s\S]*?having count\(distinct x\.id\) > 1\) q/);
  assert.ok(m, 'row 9 of the first check');
  const r = (await pg.query(m[0], [], { rowMode: 'array' })).rows[0];
  return [...String(r[2]).matchAll(/([^・（]+)（(\d+) 人）/g)].map(x => x[1]);
};

test('only a retired record whose name an in-service record also holds is renamed; the state and the rest stay; the change is logged; a second run changes nothing', async () => {
  assert.doesNotMatch(SQL.replace(/--.*$/gm, ''), /\b(insert|delete|alter|drop|create|truncate|grant|revoke)\b/i);
  assert.equal((SQL.replace(/--.*$/gm, '').match(/\bupdate\b/gi) || []).length, 1, 'one update, of employees');
  assert.match(SQL, /update public\.employees e/);
  const pg = await setup();
  assert.deepEqual(await row9(pg), ['Aki Sample', 'Ben Sample', 'Cara Sample', 'Eve Sample', 'Fay Sample', 'Gus Sample']);
  const before = await rows(pg);
  // as written in the repo (the placeholder IDs): nothing
  const r0 = (await pg.query(SQL)).rows;
  assert.deepEqual(r0.map(r => r['結果']), ['変えない：社員の表に無い']);
  assert.deepEqual(await rows(pg), before);
  const res = (await pg.query(fill(SQL, ALL))).rows;
  assert.deepEqual(Object.fromEntries(res.map(r => [r['ID'], r['結果']])), {
    e2: '変えた', e4: '変えた', e5: '変えない：同じ名前の在籍の記録が無い', e7: '変えない：退職していない',
    e8: '変えない：GM・CEO が確かめた写しがある（Claude に）', e10: '変えない：列の name と data の name が違う',
    e12: '変えない：社員の表の中身（data）が無い', nope: '変えない：社員の表に無い',
  });
  assert.equal(res.find(r => r['ID'] === 'e2')['新しい名前'], 'Aki Sample（重複）');
  const after = await rows(pg);
  const by = (a, id) => a.find(r => r.id === id);
  for (const [id, nm] of [['e2', 'Aki Sample（重複）'], ['e4', 'Ben Sample（重複）']]) {
    const o = by(before, id), n = by(after, id);
    assert.equal(n.name, nm); assert.equal(n.data.name, nm);
    // the resign guard (v1085) fills an empty column status from data on any update (it did before too): null → 退職 for e2
    assert.equal(n.status, o.status ?? o.data.status, id + ' column status');
    assert.deepEqual({ ...n.data, name: o.data.name }, o.data, id + ': only the name changed (state, resign date, code, alias, version)');
  }
  for (const r of before) if (!['e2', 'e4'].includes(r.id)) assert.deepEqual(by(after, r.id), r, r.id + ' untouched');
  // the change log (10/29): one row each, written by the SQL Editor
  const fl = await flog(pg);
  assert.deepEqual(fl.filter(r => r.field === 'name').map(r => [r.emp_id, r.old_value, r.new_value, r.writer]),
    [['e2', 'Aki Sample', 'Aki Sample（重複）', 'admin'], ['e4', 'Ben Sample', 'Ben Sample（重複）', 'admin']]);
  assert.deepEqual(fl.filter(r => r.field !== 'name').map(r => [r.emp_id, r.field, r.old_value, r.new_value]), [['e2', 'col:status', null, '退職']],
    'and the empty column status the guard filled, nothing else');
  // the person in service keeps their PIN and the score row stays under the name
  const pins = (await pg.query(`select data from auth_pins where id='staff'`)).rows[0].data;
  assert.equal(pins['Aki Sample'], '1111'); assert.equal(pins['Ben Sample'], '2222');
  assert.equal(pins['Aki Sample（重複）'], '!blocked', 'the new name of a retired record gets the stopped mark (the guard, as for any retired name)');
  assert.equal((await pg.query(`select count(*)::int as c from app_state where key='lss_emp_Aki Sample'`)).rows[0].c, 1);
  // ① row 9 and the same-name check no longer list them
  assert.deepEqual(await row9(pg), ['Cara Sample', 'Eve Sample', 'Fay Sample', 'Gus Sample']);
  assert.ok(!(await pg.query(SAME)).rows.some(r => ['Aki Sample', 'Ben Sample'].includes(r['名前'])));
  // second run: nothing changes, nothing logged
  const res2 = (await pg.query(fill(SQL, ALL))).rows;
  assert.equal(res2.find(r => r['ID'] === 'e2')['結果'], '変えない：もう付いている');
  assert.equal(res2.find(r => r['ID'] === 'e4')['結果'], '変えない：もう付いている');
  assert.deepEqual(await rows(pg), after);
  assert.equal((await flog(pg)).length, 3);
});

test('undo puts the names back (logged), and a second undo changes nothing; it never touches a record it did not rename', async () => {
  assert.doesNotMatch(UNDO.replace(/--.*$/gm, ''), /\b(insert|delete|alter|drop|create|truncate|grant|revoke)\b/i);
  const pg = await setup();
  // a record named with （重複） by hand on one side only (column vs data): undo leaves it alone
  await pg.query(`insert into employees(id,name,status,data) values ('e14','Hal Sample（重複）','退職','{"id":"e14","name":"Hal Sample","status":"退職"}')`);
  const before = await rows(pg);
  await pg.query(fill(SQL, ['e2', 'e4']));
  const u = (await pg.query(fill(UNDO, [...ALL, 'e1', 'e14']))).rows;
  assert.deepEqual(Object.fromEntries(u.map(r => [r['ID'], r['結果']])), {
    e1: '戻さない：退職していない', e2: '戻した', e4: '戻した', e5: '戻さない：付いていない', e7: '戻さない：退職していない',
    e8: '戻さない：付いていない', e10: '戻さない：付いていない', e12: '戻さない：社員の表の中身（data）が無い', nope: '戻さない：社員の表に無い',
    e14: '戻さない：列の name と data の name が違う',
  });
  const back = before.map(r => r.id === 'e2' ? { ...r, status: '退職' } : r);   // the column status the guard filled stays
  assert.deepEqual(await rows(pg), back, 'back to the same rows');
  assert.deepEqual((await flog(pg)).filter(r => r.field === 'name' && r.emp_id !== 'e14').map(r => [r.emp_id, r.old_value, r.new_value]),
    [['e2', 'Aki Sample', 'Aki Sample（重複）'], ['e2', 'Aki Sample（重複）', 'Aki Sample'], ['e4', 'Ben Sample', 'Ben Sample（重複）'], ['e4', 'Ben Sample（重複）', 'Ben Sample']]);
  assert.deepEqual(await row9(pg), ['Aki Sample', 'Ben Sample', 'Cara Sample', 'Eve Sample', 'Fay Sample', 'Gus Sample']);
  const u2 = (await pg.query(fill(UNDO, ['e2', 'e4']))).rows;
  assert.deepEqual(u2.map(r => r['結果']), ['戻さない：付いていない', '戻さない：付いていない']);
  assert.deepEqual(await rows(pg), back);
});
