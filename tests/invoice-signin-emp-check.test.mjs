// v1063: db/invoice-signin-emp-check.sql (read-only) shows which Invoice accounts can be remembered on a device:
// the email account's manager_auth.emp_id must name an employee. Synthetic data on PGlite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const SQL = fs.readFileSync(new URL('../db/invoice-signin-emp-check.sql', import.meta.url), 'utf8');

test('the emp_id check lists the Invoice accounts and what to fix, and changes nothing', async () => {
  const pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, data jsonb);
    insert into auth.users values ('00000000-0000-4000-8000-0000000000c1','gm@example.invalid'),('00000000-0000-4000-8000-0000000000c2','office@example.invalid'),
     ('00000000-0000-4000-8000-0000000000c3','crew@example.invalid'),('00000000-0000-4000-8000-0000000000c4','am@example.invalid'),('00000000-0000-4000-8000-0000000000c5','left@example.invalid'),
     ('00000000-0000-4000-8000-0000000000c6','ghost@example.invalid');
    insert into public.employees values ('E1','{"id":"E1","name":"Gm Sample"}'),('E2','{"id":"E2","name":"Akane Sample"}'),('E5','{"id":"E5","name":"Left Sample","status":"退職"}');
    insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000c1','gm','E1'),('00000000-0000-4000-8000-0000000000c2','office','E2'),
     ('00000000-0000-4000-8000-0000000000c3','office_crew',null),('00000000-0000-4000-8000-0000000000c4','am','E1'),('00000000-0000-4000-8000-0000000000c5','office','E5'),
     ('00000000-0000-4000-8000-0000000000c6','ceo','E404');`);
  const before = JSON.stringify((await pg.query('select * from manager_auth order by user_id')).rows);
  const out = await pg.exec(SQL);
  const rows = out[out.length - 1].rows.map(r => [r.email, r.role, r.result.split('：')[0]]);
  assert.deepEqual(rows.sort(), [
    ['crew@example.invalid', 'office_crew', 'NG'], ['ghost@example.invalid', 'ceo', 'NG'], ['gm@example.invalid', 'gm', 'OK'],
    ['left@example.invalid', 'office', 'NG'], ['office@example.invalid', 'office', 'OK']].sort(), 'other roles are not listed');
  assert.match(out[out.length - 1].rows.find(r => r.email === 'crew@example.invalid').result, /emp_id が空/);
  assert.equal(JSON.stringify((await pg.query('select * from manager_auth order by user_id')).rows), before, 'nothing is changed');
  assert.ok(!/^\s*(update|insert|delete|alter|drop|create|grant|revoke)\b/im.test(SQL.replace(/--.*$/gm, '')), 'read-only (the fix is a comment)');
});
