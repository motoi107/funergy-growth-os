// v1186 入れる一式（deploy/pin-off-v1186）：2 の SQL は migration と同じ・①③・PIN_を戻す.sql を PGlite で流す（合成データ・架空の名前）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const D = f => fs.readFileSync(new URL('../deploy/pin-off-v1186/' + f, import.meta.url), 'utf8');
const R = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIG83 = R('20261203090000_device_login.sql'), MIG85 = R('20261205090000_email_login.sql'), MIG = R('20261206090000_top_pin_off.sql');
const STOP85 = fs.readFileSync(new URL('../deploy/email-login-v1185/止める.sql', import.meta.url), 'utf8');

async function base({ v1185 = true, links } = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    insert into public.employees values
     ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{"role":"office"}'),
     ('E5','Former GM','退職','gm','OFFICE','{}'),('E9','Crew Sample','在籍','crew','F01','{}'),('E11','Split Sample','在籍','crew','F01','{"role":"gm"}');`);
  for (const [i, [r, e]] of (links || [['ceo', 'E1'], ['gm', 'E2'], ['office', 'E3'], ['gm', 'E11']]).entries())
    await pg.query('insert into manager_auth values($1,$2,$3)', ['00000000-0000-4000-8000-00000000000' + i, r, e]);
  await pg.exec(MIG83);
  if (v1185) await pg.exec(MIG85);
  return pg;
}
const rows = async (pg, sql) => { const r = await pg.exec(sql); return r[r.length - 1].rows; };
const row = (rs, no) => rs.find(r => r.no === no);

test('2 の SQL は migration と同じ', () => { assert.equal(D('2_SQL.sql'), MIG); });

test('1 の確認：v1185 がまだなら STOP・結ばれていない人は STOP と名前・まだメールで入っていない人・列と中身・経理の試し', async () => {
  const pg0 = await base({ v1185: false });
  assert.equal(row(await rows(pg0, D('1_最初に確認_読むだけ.sql')), 1).result, 'STOP');
  await assert.rejects(pg0.exec(D('2_SQL.sql')), /STOP: 先に 20261205090000/);

  const pgN = await base({ links: [['ceo', 'E1'], ['suspended', 'E2']] });
  const n = await rows(pgN, D('1_最初に確認_読むだけ.sql'));
  assert.equal(row(n, 4).result, 'STOP（3 人）');
  assert.match(row(n, 4).detail, /^GM Sample、Office Sample、Split Sample：/);
  await assert.rejects(pgN.exec(D('2_SQL.sql')), /STOP: GM・CEO・経理のうち 3 人/);

  const pg = await base();
  await pg.exec(`insert into public.dl_trial(emp_id, added_by) values ('E3','admin:x'),('E9','admin:x'),('E2','admin:x'); insert into public.manager_auth values ('00000000-0000-4000-8000-0000000000e2','office','E2')`);
  await pg.exec(`select public.dl_log('email_start','E1',null,'admin:x','ok',null,null,null); select public.dl_log('email_start','E2',null,'admin:x','fail','bad',null,null)`);
  const b = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.equal(b.length, 8);
  assert.ok(!b.some(r => r.result.startsWith('STOP')), JSON.stringify(b));
  assert.match(row(b, 3).result, /まだ/);
  assert.equal(row(b, 4).result, 'OK（0 人）');
  assert.equal(row(b, 5).result, '注意（3 人）', 'CEO はメールで入った・GM は失敗だけ');
  assert.match(row(b, 5).detail, /^GM Sample、Office Sample、Split Sample：/);
  assert.equal(row(b, 6).result, 'info（1 人）');
  assert.match(row(b, 6).detail, /Split Sample（列 crew・中身 gm）/);
  assert.equal(row(b, 7).result, 'info（1 人）');
  assert.match(row(b, 7).detail, /^Office Sample：/);
  assert.equal(row(b, 8).result, 'まだ無い');
  assert.ok(!JSON.stringify(b).includes('Former GM'), '退職した人は出さない');
  assert.ok(!JSON.stringify(b).includes('Crew Sample'), 'GM・CEO・経理でない人は出さない');

  await pg.exec(D('2_SQL.sql'));
  const a = await rows(pg, D('1_最初に確認_読むだけ.sql'));
  assert.match(row(a, 3).result, /もう入っています/);
  assert.match(row(a, 8).result, /入っている/);
  await pg.exec(D('PIN_を戻す.sql'));
  assert.match(row(await rows(pg, D('1_最初に確認_読むだけ.sql')), 8).result, /外している/);

  const pg2 = new PGlite(); await pg2.exec('create table public.employees(id text primary key)');
  const s = await rows(pg2, D('1_最初に確認_読むだけ.sql'));
  assert.equal(row(s, 1).result, 'STOP'); assert.equal(row(s, 2).result, 'STOP'); assert.equal(row(s, 4).result, '—');
});

test('3 の確認：入れたあと NG なし・2 回流しても同じ・公開の鍵・definer・スイッチ・並べ替え・入れる前は NG', async () => {
  const pg = await base();
  await pg.exec(D('2_SQL.sql')); await pg.exec(D('2_SQL.sql'));
  const r = await rows(pg, D('3_確認_読むだけ.sql'));
  assert.ok(!r.some(x => x.result === 'NG'), JSON.stringify(r));
  assert.equal(r.length, 10);
  assert.equal(row(r, 10).detail, '2 回・戻した 0 回');
  const r85 = await rows(pg, fs.readFileSync(new URL('../deploy/email-login-v1185/3_確認_読むだけ.sql', import.meta.url), 'utf8'));
  assert.ok(!r85.some(x => x.result === 'NG'), 'v1186 のあとも v1185 の ③ は NG なし：' + JSON.stringify(r85));
  const r83 = await rows(pg, fs.readFileSync(new URL('../deploy/device-login-v1183/3_確認_読むだけ.sql', import.meta.url), 'utf8'));
  assert.ok(!r83.some(x => x.result === 'NG'), 'v1186 のあとも v1183 の ③ は NG なし：' + JSON.stringify(r83));
  const no = async n => row(await rows(pg, D('3_確認_読むだけ.sql')), n).result;
  await pg.exec('grant select on public.dl_flags to anon'); assert.equal(await no(3), 'NG');
  await pg.exec('revoke select on public.dl_flags from anon; grant execute on function public.dl_stage() to authenticated');
  assert.equal(await no(5), 'NG', 'v1186 で足した関数でなくても、dl_ の関数を公開の鍵で呼べれば NG');
  await pg.exec(`do $$ declare f record; begin for f in select p.oid::regprocedure s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'dl\\_%' loop execute format('revoke execute on function %s from anon, authenticated', f.s); end loop; end $$`);
  assert.equal(await no(5), 'OK');
  await pg.exec('alter function public.dl_pin_blocked(jsonb) security definer'); assert.equal(await no(7), 'NG');
  await pg.exec('alter function public.dl_pin_blocked(jsonb) security invoker'); assert.equal(await no(7), 'OK');
  await pg.exec(D('PIN_を戻す.sql'));
  const off = row(await rows(pg, D('3_確認_読むだけ.sql')), 8);
  assert.equal(off.result, 'NG'); assert.match(off.detail, /外れています/);
  assert.equal(row(await rows(pg, D('3_確認_読むだけ.sql')), 10).detail, '2 回・戻した 1 回');
  const pg0 = await base();
  const none = await rows(pg0, D('3_確認_読むだけ.sql'));
  assert.equal(none.filter(x => x.result === 'NG').length, 6, '入れる前は NG：' + JSON.stringify(none));
});

test('PIN_を戻す.sql：入れる前は STOP・入れたあと止めない → 2 で入れ直す／v1185 の止める.sql で PIN も戻る', async () => {
  const pg0 = await base();
  await assert.rejects(pg0.exec(D('PIN_を戻す.sql')), /STOP: v1186 の SQL/);
  const pg = await base();
  await pg.exec(D('2_SQL.sql'));
  const blocked = async () => (await rows(pg, `select public.dl_pin_blocked('{"emp_id":"E2"}'::jsonb)->>'blocked' as b`))[0].b;
  assert.equal(await blocked(), 'true');
  assert.deepEqual((await rows(pg, D('PIN_を戻す.sql')))[0], { pin_off_now: false });
  assert.equal(await blocked(), 'false');
  assert.equal((await rows(pg, `select (public.dl_emp('E3')->>'top') as t`))[0].t, 'false', '戻すと経理はまた試せる');
  await pg.exec(D('PIN_を戻す.sql'));   // 2 回流しても同じ
  await pg.exec(D('2_SQL.sql'));
  assert.equal(await blocked(), 'true');
  assert.equal((await rows(pg, `select (public.dl_emp('E3')->>'top') as t`))[0].t, 'true');
  await pg.exec(STOP85);
  assert.equal(await blocked(), 'false', 'メールのログインを止めると PIN は自動で戻る');
  assert.equal((await rows(pg, `select public.dl_top_pin_off() as v`))[0].v, false);
});
