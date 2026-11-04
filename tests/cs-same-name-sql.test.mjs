// db/cs-same-name-check.sql（読むだけ）が、①の 9 行目と同じ数え方（社員の表の名前・確かめた写しの名前・退職した人も）で
// 同じ名前の人を 1 人ずつ出し、在籍・退職・確かめた写しだけ・別の 2 人を見分けられるか（合成データ・PGlite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SQL = fs.readFileSync(new URL('../db/cs-same-name-check.sql', import.meta.url), 'utf8');
const CHECK1 = fs.readFileSync(new URL('../deploy/secure-cs-v1140/1_確かめ_読むだけ.sql', import.meta.url), 'utf8');
const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');

test('同じ名前の人：1 人ずつ・在籍と退職・確かめた写しだけ・別の 2 人・点の行', async () => {
  assert.doesNotMatch(SQL.replace(/--.*$/gm, ''), /\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i, 'read only');
  const pg = new PGlite();
  await pg.exec(`
    create table public.app_state(key text primary key, value jsonb not null, updated_at timestamptz default now());
    create table public.manager_auth(user_id uuid primary key default gen_random_uuid(), role text, emp_id text);
    create table public.employees(id text primary key, name text, role text, title text, store text, support jsonb, status text, data jsonb);
    create table public.wr_people(emp_id text primary key, name text not null, role text not null, grade integer not null);
    insert into public.employees values
      ('e1','Aki Sample','staff','Crew','F01','[]','在籍','{"hireDate":"2026-03-01","empCode":"101"}'),
      ('e2','Aki Sample','staff','Crew','F01','[]',null,'{"status":"退職","hireDate":"2024-05-01","resignDate":"2025-12-31","empCode":"101"}'),
      ('e3','Ben Sample','staff','Crew','F01','["F04-K"]','在籍','{"startDate":"2025-01-10"}'),
      ('e4','Ben Sample','chef','Head Chef','F04-K','[]',null,'{"osDisabled":"true"}'),
      ('e7','Ben Sample','staff','Crew','F02','[]','退職','{}'),
      ('e5','Cara Sample','sl','Store Leader','F02','[]','在籍','{}'),
      ('e6','Dan Sample','staff','Crew','F03','[]','在籍','{}');
    insert into public.wr_people values ('e5','Cara Sample','staff',3), ('x9','Cara Sample','am',5), ('e6','Dan Sample Old','staff',3);
    insert into public.manager_auth(role, emp_id) values ('gm','e4');
    insert into public.app_state(key, value, updated_at) values ('lss_emp_Aki Sample','{}','2026-10-02T05:00:00Z');`);
  const rows = (await pg.query(SQL)).rows;
  const by = n => rows.filter(r => r['名前'] === n);
  assert.deepEqual([...new Set(rows.map(r => r['名前']))], ['Aki Sample', 'Ben Sample', 'Cara Sample'], 'only names held by two or more people (Dan has one id)');
  const aki = by('Aki Sample');
  assert.deepEqual(aki.map(r => [r['ID'], r['在籍'], r['入社日'], r['退職日'], r['社員番号']]),
    [['e2', '退職', '2024-05-01', '2025-12-31', '101'], ['e1', '在籍', '2026-03-01', '', '101']].sort((a, b) => a[1] < b[1] ? -1 : 1));
  assert.ok(aki.every(r => r['この名前の点（最後の保存）'] === '2026-10-01'), 'the shared score row, in Hawaii time');
  const ben = by('Ben Sample');
  assert.deepEqual(ben.map(r => r['在籍']).sort(), ['OS 無効', '在籍', '退職']);
  assert.equal(ben.find(r => r['ID'] === 'e3')['応援店'], '["F04-K"]');
  assert.equal(ben.find(r => r['ID'] === 'e4')['メールのアカウント'], 'gm');
  assert.equal(ben.find(r => r['ID'] === 'e4')['役割 / 肩書き'], 'chef / Head Chef');
  assert.ok(ben.every(r => r['この名前の点（最後の保存）'] === '（無し）'));
  const cara = by('Cara Sample');
  assert.equal(cara.find(r => r['ID'] === 'x9')['ある場所'], '確かめた写しだけ（社員の表に行が無い）');
  assert.equal(cara.find(r => r['ID'] === 'x9')['在籍'], '—');
  assert.equal(cara.find(r => r['ID'] === 'x9')['確かめた写し'], 'am G5');
  assert.equal(cara.find(r => r['ID'] === 'e5')['ある場所'], '社員の表・確かめた写し');
  assert.equal(cara.find(r => r['ID'] === 'e5')['確かめた写し'], 'staff G3');
  // ①の 9 行目と同じ名前・同じ人数
  const m = CHECK1.match(/select 9,[\s\S]*?having count\(distinct x\.id\) > 1\) q/);
  assert.ok(m, 'row 9 of the first check');
  const r9 = (await pg.query(m[0], [], { rowMode: 'array' })).rows[0];
  const n9 = [...String(r9[2]).matchAll(/([^・（]+)（(\d+) 人）/g)].map(x => [x[1], Number(x[2])]);
  const mine = [...new Set(rows.map(r => r['名前']))].map(n => [n, new Set(by(n).map(r => r['ID'])).size]);
  assert.deepEqual(n9, mine);
});
