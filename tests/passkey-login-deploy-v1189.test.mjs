// v1189 入れる一式（deploy/passkey-login-v1189）：2 の SQL は migration と同じ・①③・送り手・止める.sql を PGlite で流す（合成データ・架空の名前とメール）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = f => fs.readFileSync(new URL('../deploy/passkey-login-v1189/' + f, import.meta.url), 'utf8');
const R = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIGS = ['20261203090000_device_login.sql', '20261205090000_email_login.sql', '20261206090000_top_pin_off.sql', '20261207090000_pin_blocked_id_first.sql'].map(R);
const MIG = R('20261208090000_passkey_login.sql');

async function base({ upto = 4 } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    insert into public.employees values ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{}'),
     ('E9','Crew Nine','在籍','crew','F01','{}'),('E10','Crew Ten','在籍','crew','F02','{}');
    insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000c1','ceo','E1'),('00000000-0000-4000-8000-0000000000c2','gm','E2'),('00000000-0000-4000-8000-0000000000c3','office','E3');`);
  for (const m of MIGS.slice(0, upto)) await pg.exec(m);
  return pg;
}
const rows = async (pg, sql) => { const r = await pg.exec(sql); return r[r.length - 1].rows; };
const row = (rs, no) => rs.find(r => r.no === no);
const SENDER = (a) => D('4_送り手_SQL.sql').replace("btrim('ここに送り手のメールアドレス')", "btrim('" + a + "')");
const fn = async (pg, name, p) => (await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p)])).rows[0].v;

test('2 の SQL は migration と同じ・送り手のメールはリポジトリに無い', () => {
  assert.equal(D('2_SQL.sql'), MIG);
  for (const f of ['手順.md', '1_最初に確認_読むだけ.sql', '2_SQL.sql', '3_確認_読むだけ.sql', '4_送り手_SQL.sql', '止める.sql']) {
    const s = D(f);
    const mails = [...s.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)].map(m => m[0]).filter(m => !/@(yourcompany\.com|example\.(com|test))$/.test(m));
    assert.deepEqual(mails, [], f);
  }
});

test('1 の確認：v1186 がまだなら STOP・GM のアカウント・ログインの試し・送り手', async () => {
  const pg0 = await base({ upto: 2 });
  assert.equal(row(await rows(pg0, D('1_最初に確認_読むだけ.sql')), 1).result, 'STOP');
  await assert.rejects(pg0.exec(D('2_SQL.sql')), /STOP: 先に v1183・v1185・v1186/);
  const pg1 = await base({ upto: 3 });
  assert.equal(row(await rows(pg1, D('1_最初に確認_読むだけ.sql')), 1).result, 'STOP', '20261207 がまだ');
  await assert.rejects(pg1.exec(D('2_SQL.sql')), /STOP: 先に 20261207090000/);

  const pgN = await base();
  await pgN.exec(`update public.manager_auth set emp_id = 'E404' where role = 'gm'`);   // 社員と結ばれていない
  assert.equal(row(await rows(pgN, D('1_最初に確認_読むだけ.sql')), 3).result, 'STOP（0 人）');

  const pg = await base();
  await pg.exec(`insert into public.dl_trial(emp_id, added_by) values ('E9','admin:x')`);
  const b = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.equal(b.length, 5);
  assert.ok(!b.some(r => r.result.startsWith('STOP')), JSON.stringify(b));
  assert.equal(row(b, 2).result, 'まだ（初めて）');
  assert.equal(row(b, 3).result, 'OK（1 人）');
  assert.match(row(b, 4).result, /^info（端末 0・招待 0・試す人 1）$/);
  assert.match(row(b, 5).result, /^まだ（2 のあと/);
  assert.ok(!JSON.stringify(b).match(/Sample|Crew/), '名前は出さない');

  await pg.exec(D('2_SQL.sql'));
  const a = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.match(row(a, 2).result, /もう入っています/);
  assert.match(row(a, 4).result, /^info（端末 0・招待 0・試す人 0）$/, '試しは止まった');
  assert.match(row(a, 5).result, /^まだ（4_送り手_SQL\.sql）$/);
  await pg.exec(D('2_SQL.sql'));   // 2 回流しても同じ
});

test('3 の確認：入れたあと OK・前の SQL を流し直すと 9 が NG・送り手の状態', async () => {
  const pg = await base();
  const before = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(before.some(r => r.result === 'NG'), 'まだなら NG');
  await pg.exec(D('2_SQL.sql'));
  const a = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.deepEqual(a.filter(r => r.result === 'NG'), [], JSON.stringify(a));
  assert.equal(row(a, 4).detail, '40');
  assert.equal(row(a, 11).result, 'まだ');
  assert.match(row(a, 11).detail, /4_送り手_SQL/);
  // 送り手：書き換えないと止まる・書き換えると入る（ここでは架空のアドレス）
  await assert.rejects(pg.exec(D('4_送り手_SQL.sql')), /STOP: 送り手のメールアドレスに書き換えて/);
  await pg.exec(SENDER(' Sender@Example.test '));
  assert.equal((await pg.query('select from_addr from public.dl_mail where id = 1')).rows[0].from_addr, 'sender@example.test');
  assert.equal(row(await rows(pg, D('3_確認_読むだけ.sql')), 11).result, 'まだつないでいない');
  await pg.exec(`update public.dl_mail set state = 'ok', account = from_addr, refresh_token = 'r' where id = 1`);
  assert.equal(row(await rows(pg, D('3_確認_読むだけ.sql')), 11).result, 'つながっている');
  // 送り手を変えると前のつなぎは外れる・同じなら外れない
  await pg.exec(SENDER('sender@example.test'));
  assert.equal((await pg.query('select state from public.dl_mail')).rows[0].state, 'ok');
  await pg.exec(SENDER('other@example.test'));
  assert.deepEqual((await pg.query('select state, refresh_token, account from public.dl_mail')).rows[0], { state: 'none', refresh_token: null, account: null });
  // 前の SQL（v1186 の ②）をあとで流し直した
  await pg.exec(MIGS[3]);
  assert.equal(row(await rows(pg, D('3_確認_読むだけ.sql')), 9).result, 'NG');
});

test('止める.sql：パスキーの人も PIN に戻る・ログインのあいだと招待を止める・表は残す・② でまた始まる', async () => {
  const pg = await base();
  await assert.rejects(pg.exec(D('止める.sql')), /STOP: パスキーのログイン（2_SQL\.sql）は入っていません/);
  await pg.exec('rollback');   // SQL Editor では止まったところで終わる
  await pg.exec(D('2_SQL.sql'));
  await pg.exec(`insert into public.dl_people(emp_id, mode, email, email_norm, confirmed_at) values ('E9','passkey','nine@example.test','nine@example.test', now()), ('E10','passkey','ten@example.test','ten@example.test', null);
    insert into public.dl_pk_sessions(emp_id, token_hash, ver, via, keep, expires_at) values ('E9','h1',1,'code',true, now() + interval '12 hours');
    insert into public.dl_pk_invites(emp_id, token_hash, purpose, email, email_norm, ver, created_by, expires_at) values ('E10','h2','invite','ten@example.test','ten@example.test',1,'admin:x', now() + interval '7 days');`);
  assert.equal((await fn(pg, 'dl_pin_blocked', { emp_id: 'E9', name: 'Crew Nine' })).blocked, true);
  assert.equal((await fn(pg, 'dl_pin_blocked', { name: 'Crew Ten' })).blocked, true);
  assert.equal((await fn(pg, 'dl_top_pin_info', {})).pk, true);
  const r = await rows(pg, D('止める.sql'));
  assert.deepEqual(r[0], { stopped: true, passkey_people_kept: 2, live_logins: 0 });
  assert.equal((await fn(pg, 'dl_pin_blocked', { emp_id: 'E9', name: 'Crew Nine' })).blocked, false, 'PIN でまた入れる');
  assert.equal((await fn(pg, 'dl_pin_blocked', { emp_id: 'E2', name: 'GM Sample' })).blocked, true, 'GM・CEO・経理は今までどおり止める');
  const info = await fn(pg, 'dl_top_pin_info', {});
  assert.deepEqual(Object.keys(info), ['top_pin_off'], 'パスキーの入口を出さない');
  assert.equal((await pg.query(`select count(*)::int as n from pg_proc where proname like 'dl\\_pk\\_%'`)).rows[0].n, 0);
  assert.equal((await pg.query(`select count(*)::int as n from public.dl_pk_invites where revoked_at is null`)).rows[0].n, 0);
  for (const r2 of ['anon', 'authenticated']) {
    assert.equal((await pg.query(`select has_function_privilege($1, 'public.dl_pin_blocked(jsonb)', 'EXECUTE') as x`, [r2])).rows[0].x, false);
    assert.equal((await pg.query(`select has_function_privilege($1, 'public.dl_top_pin_info(jsonb)', 'EXECUTE') as x`, [r2])).rows[0].x, false);
  }
  // 止めた関数は 20261207 と同じ中身
  const src = (await pg.query(`select prosrc from pg_proc where proname = 'dl_pin_blocked'`)).rows[0].prosrc;
  assert.ok(MIGS[3].includes(src.trim().slice(0, 200)), 'the v1186 fix body');
  assert.match(D('止める.sql'), /'pk_stopped'/);
  // また始める
  await pg.exec(D('2_SQL.sql'));
  assert.equal((await fn(pg, 'dl_pin_blocked', { emp_id: 'E9', name: 'Crew Nine' })).blocked, true);
  assert.deepEqual((await rows(pg, D('3_確認_読むだけ.sql'))).filter(x => x.result === 'NG'), []);
});

test('手順：関数を前に戻す前に止める・端末を 1189 にしてから・アドレスを書かない', () => {
  const s = D('手順.md');
  assert.match(s, /関数を前（v1186）に戻すときは、先に `止める\.sql`/);
  assert.match(s, /全部の端末を 1189 にしてから/);
  assert.match(s, /アドレスはリポジトリ・GitHub に書かない/);
  assert.match(s, /funergy-plus\.com/);
});
