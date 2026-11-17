// v1186 GM・CEO・経理は PIN でログインしない（Moto さん 11/16 23:24 HST）：本物の SQL（PGlite・v1183・v1185・v1186）と本物の handler。
// 合成データだけ（架空の名前・ID）。本番にはつながない。auth-pin・emp-private（v1186・公開しない 1 ファイル）は別に確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler } from '../supabase/functions/device-login/handler.mjs';

const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
const R = f => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const MIG83 = R('20261203090000_device_login.sql'), MIG85 = R('20261205090000_email_login.sql'), MIG86 = R('20261206090000_top_pin_off.sql');
const MIG87 = R('20261207090000_pin_blocked_id_first.sql');
const U = { ceo: '00000000-0000-4000-8000-0000000000c1', gm: '00000000-0000-4000-8000-0000000000c2', office: '00000000-0000-4000-8000-0000000000c3' };
const DEV1 = '11111111-1111-4111-8111-111111111111';

async function setup(opts = {}) {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create table public.manager_auth(user_id uuid primary key, role text, emp_id text);
    create table public.employees(id text primary key, name text, status text, role text, store text, data jsonb);
    create table public.app_state(key text primary key, value jsonb, updated_at timestamptz not null default now());
    grant select, insert, update on public.app_state to service_role;
    grant select on public.manager_auth, public.employees to service_role;
    insert into public.employees values
     ('E1','CEO Sample','在籍','ceo','OFFICE','{}'),('E2','GM Sample','在籍','gm','OFFICE','{}'),('E3','Office Sample','在籍','office','OFFICE','{}'),
     ('E5','Former GM','退職','gm','OFFICE','{}'),('E7','Area Sample','在籍','am','OFFICE','{}'),('E9','Crew Sample','在籍','crew','F01','{}'),
     ('E10','Data GM','在籍','','F01','{"role":"gm"}'),('E11','Split Sample','在籍','crew','F01','{"role":"gm"}'),
     ('E12','Former GM','在籍','crew','F01','{}'),('E13','GM Sample','在籍','crew','F02','{}'),
     ('E14','Twin Off','在籍','gm','OFFICE','{"osDisabled":true}'),('E15','Twin Off','在籍','crew','F01','{}'),
     ('E16','Twin Dst','在籍','gm','OFFICE','{"status":"退職"}'),('E17','Twin Dst','在籍','crew','F01','{}');`);
  const links = opts.links || [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3'], ['dgm', 'gm', 'E10'], ['split', 'gm', 'E11']];
  for (const [k, r, e] of links) await pg.query('insert into manager_auth(user_id, role, emp_id) values($1,$2,$3)', [U[k] || '00000000-0000-4000-8000-0000000000d' + links.findIndex(x => x[0] === k), r, e]);
  if (opts.notifs !== undefined) await pg.query('insert into app_state(key, value, updated_at) values($1, $2, $3)', ['notifications', JSON.stringify(opts.notifs), '2026-11-16T00:00:00Z']);
  await pg.exec(MIG83);
  if (!opts.no85) await pg.exec(MIG85);
  let stop = null;
  if (!opts.no86) { try { await pg.exec(MIG86); } catch (e) { stop = e; } }
  if (!opts.no86 && !stop && !opts.no87) await pg.exec(MIG87);   // 20261207：社員の ID を先に見る（同じ名前の人を止めない）
  await pg.exec('set role service_role');
  const db = { async rpc(name, p) {
    try { const r = await pg.query(`select public.${name}($1::jsonb) as v`, [JSON.stringify(p ?? {})]); return r.rows[0].v; }
    catch (e) { if (/does not exist/.test(e.message)) { const x = new Error('Could not find the function'); x.status = 404; throw x; } throw e; }
  } };
  const users = Object.fromEntries(Object.entries(U).map(([k, v]) => ['tok-' + k, v]));
  const fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) { const id = users[(init.headers.authorization || '').replace('Bearer ', '')]; return id ? Response.json({ id }) : new Response('{}', { status: 401 }); }
    throw new Error('unexpected network call ' + url);
  };
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon-key' })[k];
  const handler = createHandler({ env, fetch, db, pinCheck: async () => ({ ok: false }), signMark: async ({ emp_id }) => 'mark.' + emp_id });
  const call = async (body, who) => {
    const headers = { 'content-type': 'application/json' };
    if (who) headers.authorization = who.startsWith('Bearer ') ? who : 'Bearer tok-' + who;
    const r = await handler(new Request('https://fn.test/device-login', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const sql = async q => { await pg.exec('reset role'); try { return await pg.query(q); } finally { await pg.exec('set role service_role'); } };
  const ex = async q => { await pg.exec('reset role'); try { return await pg.exec(q); } finally { await pg.exec('set role service_role'); } };
  const rpc = (n, p) => db.rpc(n, p);
  return { pg, call, sql, ex, rpc, stop };
}

test('先に止まる：メールのアカウントと結ばれていない GM・CEO・経理がいれば、何も変えない（名前と数）', async () => {
  // 経理のメールのアカウントが無い・GM のアカウントが止まっている（suspended）
  const w = await setup({ links: [['ceo', 'ceo', 'E1'], ['gm', 'suspended', 'E2'], ['dgm', 'gm', 'E10']] });
  assert.ok(w.stop, 'STOP');
  assert.match(w.stop.message, /^STOP: GM・CEO・経理のうち 3 人が、メールのアカウントと結ばれていません（GM Sample、Office Sample、Split Sample）/);
  assert.equal((await w.sql(`select to_regclass('public.dl_flags') r`)).rows[0].r, null, '表を作っていない');
  assert.equal((await w.sql(`select to_regprocedure('public.dl_pin_blocked(jsonb)') r`)).rows[0].r, null);
  // 退職した GM・AM・スタッフは数えない。中身（data）の役割が GM の人も数える
  const w2 = await setup({ links: [['ceo', 'ceo', 'E1'], ['gm', 'gm', 'E2'], ['office', 'office', 'E3']] });
  assert.match(w2.stop.message, /2 人が.*（Data GM、Split Sample）/, '列が空で中身が GM・列と中身が違う（中身が GM）も数える');
  // v1185 の SQL がまだ
  const w3 = await setup({ no85: true });
  assert.match(w3.stop.message, /^STOP: 先に 20261205090000_email_login\.sql/);
});

test('スイッチ：入れたときから止める・止める人は社員の役割（ID か名前）・戻せば止めない・メールのログインが無ければ止めない', async () => {
  const w = await setup();
  assert.equal(w.stop, null);
  assert.deepEqual(await w.rpc('dl_top_pin_info', {}), { top_pin_off: true });
  const b = p => w.rpc('dl_pin_blocked', p).then(r => r.blocked);
  for (const p of [{ emp_id: 'E1' }, { emp_id: 'E2' }, { emp_id: 'E3' }, { emp_id: 'E10' }, { name: 'GM Sample' }, { name: ' Office Sample ' }, { name: 'Data GM' },
    { emp_id: 'E2', name: 'Crew Sample' }, { emp_id: 'E11' }, { name: 'Split Sample' }, { emp_id: 'NOPE', name: 'GM Sample' }]) assert.equal(await b(p), true, JSON.stringify(p));
  // 社員の ID の行があれば、その人だけで決める（auth-pin・emp-private は名前の合う行の ID だけを送る）
  for (const p of [{ emp_id: 'E9' }, { emp_id: 'E7' }, { name: 'Crew Sample' }, { name: 'Area Sample' }, { emp_id: 'NOPE' }, { name: 'Nobody' }, { emp_id: 'E9', name: 'GM Sample' },
    { emp_id: 'NOPE', name: 'Crew Sample' }]) assert.equal(await b(p), false, JSON.stringify(p));
  await assert.rejects(() => b({}), /bad_value/);
  // 退職した GM（PIN でももう入れない＝auth-pin が断る）も「メールで」と答える側（害はない）
  assert.equal(await b({ emp_id: 'E5' }), true);
  // 戻す（PIN_を戻す.sql と同じ）→ だれも止めない
  await w.sql(`update dl_flags set value = false where key = 'top_pin_off'`);
  assert.deepEqual(await w.rpc('dl_top_pin_info', {}), { top_pin_off: false });
  assert.equal(await b({ emp_id: 'E2' }), false);
  await w.sql(`update dl_flags set value = true where key = 'top_pin_off'`);
  // メールのログイン（v1185）を止めた（v1185 の 止める.sql）→ スイッチが入っていても止めない（だれも入れなくなるのを防ぐ）
  await w.sql(`drop function public.dl_email_login(jsonb)`);
  assert.deepEqual(await w.rpc('dl_top_pin_info', {}), { top_pin_off: false });
  assert.equal(await b({ emp_id: 'E2' }), false);
});

test('同じ名前の人（#184 の Claude 6945401027・Codex 6945462615／6955376116 の P2）：社員の ID を先に・名前で探すのは在籍の人だけ', async () => {
  const w = await setup();
  const b = p => w.rpc('dl_pin_blocked', p).then(r => r.blocked);
  // 退職した GM と同じ名前の Crew（列の状態が退職）：本人の ID でも ID なしでも止めない
  for (const p of [{ emp_id: 'E12' }, { emp_id: 'E12', name: 'Former GM' }, { name: 'Former GM' }, { name: ' Former GM ' }]) assert.equal(await b(p), false, JSON.stringify(p));
  // 中身の状態が退職・OS の無効の GM と同じ名前の Crew も同じ
  for (const p of [{ emp_id: 'E15', name: 'Twin Off' }, { name: 'Twin Off' }, { emp_id: 'E17', name: 'Twin Dst' }, { name: 'Twin Dst' }]) assert.equal(await b(p), false, JSON.stringify(p));
  // 在籍の GM と同じ名前の Crew：本人の ID なら止めない。ID が無い・見つからないときは、どちらか分からないので止める（安全なほう）
  assert.equal(await b({ emp_id: 'E13', name: 'GM Sample' }), false);
  assert.equal(await b({ emp_id: 'E13' }), false);
  assert.equal(await b({ name: 'GM Sample' }), true);
  assert.equal(await b({ emp_id: 'NOPE', name: 'GM Sample' }), true);
  // GM 本人の ID は止める（同じ名前の Crew がいても）。退職した GM の ID も止める側（PIN では auth-pin がもう断る）
  assert.equal(await b({ emp_id: 'E2', name: 'GM Sample' }), true);
  assert.equal(await b({ emp_id: 'E5', name: 'Former GM' }), true);
  assert.equal(await b({ emp_id: 'E14' }), true, 'OS の無効の GM 本人の ID は止める側（名前で探すときだけ外す）');
  assert.equal((await w.sql('select public.dl_pin_stage() v')).rows[0].v, 2);
  // 前の SQL（20261206 だけ）では、同じ名前の Crew も止まっていた（P2 の再現）
  const old = await setup({ no87: true });
  const ob = p => old.rpc('dl_pin_blocked', p).then(r => r.blocked);
  for (const p of [{ emp_id: 'E12', name: 'Former GM' }, { name: 'Former GM' }, { emp_id: 'E13', name: 'GM Sample' }, { emp_id: 'E15', name: 'Twin Off' }, { emp_id: 'E17', name: 'Twin Dst' }])
    assert.equal(await ob(p), true, '前の SQL：' + JSON.stringify(p));
  assert.equal((await old.sql('select public.dl_pin_stage() v')).rows[0].v, 1);
  // 20261206 の上に 20261207 を流すと直る（本番は 20261206 がもう入っている）
  await old.ex(MIG87);
  for (const p of [{ emp_id: 'E12', name: 'Former GM' }, { emp_id: 'E13', name: 'GM Sample' }]) assert.equal(await ob(p), false, JSON.stringify(p));
  // 20261206 が無ければ 20261207 は何も変えずに止まる
  const none = await setup({ no86: true });
  await assert.rejects(() => none.ex(MIG87), /STOP: 先に 20261206090000_top_pin_off\.sql/);
  assert.equal((await none.sql(`select to_regprocedure('public.dl_pin_blocked(jsonb)') r`)).rows[0].r, null);
});

test('経理も「ログインの試し（端末＋PIN）」に入れない（止めているあいだだけ）', async () => {
  const w = await setup();
  const top = async e => (await w.rpc('dl_emp', e)).top;
  w.rpc = (n, p) => w.sql(`select public.${n}('${p}') v`).then(r => r.rows[0].v);
  assert.equal(await top('E3'), true);
  assert.equal(await top('E2'), true);
  assert.equal(await top('E9'), false);
  assert.equal(await top('E7'), false);
  await w.sql(`update dl_flags set value = false where key = 'top_pin_off'`);
  assert.equal(await top('E3'), false, '戻すと経理は前と同じ（試せる）');
  assert.equal(await top('E2'), true);
});

test('関数 device-login の login_info：ログインしなくても聞ける・人によらない答え・SQL がまだなら止めていない', async () => {
  const w = await setup();
  for (const who of [null, 'Bearer anon-key', 'gm']) assert.deepEqual(await w.call({ action: 'login_info' }, who), { status: 200, body: { top_pin_off: true } }, String(who));
  await w.sql(`update dl_flags set value = false where key = 'top_pin_off'`);
  assert.deepEqual((await w.call({ action: 'login_info' })).body, { top_pin_off: false });
  const old = await setup({ no86: true });
  assert.deepEqual(await old.call({ action: 'login_info' }), { status: 200, body: { top_pin_off: false } });
  // 止めても、メールのログインはそのまま（経理も）
  const w2 = await setup();
  const r = await w2.call({ action: 'email_login', emp_id: 'E3', device_id: DEV1, device_name: 'Mac · Safari' }, 'office');
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.role, 'office');
});

test('新しい端末の知らせ：時刻の順に並べてから新しい 500 件（ずれた時刻の知らせがあっても、新しい知らせが落ちない）', async () => {
  const old = [];
  for (let i = 0; i < 499; i++) old.push({ id: 'n' + i, at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(), toRoles: ['gm'] });
  // 並びが時刻の順でない（前の版・別の端末が足した）
  old.push({ id: 'late', at: '2026-11-10T00:00:00.000Z', toRoles: ['gm'] }, { id: 'early', at: '2026-01-01T00:00:00.000Z', toRoles: ['gm'] }, { id: 'noat', toRoles: ['gm'] });
  const w = await setup({ notifs: old });
  const r = await w.call({ action: 'email_login', emp_id: 'E2', device_id: DEV1, device_name: 'iPhone · Safari' }, 'gm');
  assert.equal(r.body.ok, true);
  const v = (await w.sql(`select value v from app_state where key = 'notifications'`)).rows[0].v;
  assert.equal(v.length, 500);
  const ats = v.map(x => x.at || '');
  assert.deepEqual(ats, [...ats].sort(), '時刻の順');
  const ids = v.map(x => x.id);
  assert.ok(!ids.includes('noat') && !ids.includes('early') && !ids.includes('n0'), 'いちばん古いものから落とす');
  assert.ok(ids.includes('late'));
  assert.deepEqual(ids.slice(-2).map(x => x.slice(-2)), ['-u', '-g'], '新しい 2 つは最後（落ちない）');
});

test('表と関数はサーバーの鍵だけ・2 回流しても同じ（スイッチは入ったまま）', async () => {
  const w = await setup();
  for (const role of ['anon', 'authenticated']) {
    await w.pg.exec('reset role'); await w.pg.exec('set role ' + role);
    await assert.rejects(() => w.pg.query(`select * from public.dl_flags`), /permission denied/, role);
    for (const f of ['dl_pin_blocked(\'{"emp_id":"E2"}\')', 'dl_top_pin_info(\'{}\')', 'dl_top_pin_off()', 'dl_emp(\'E3\')', 'dl_pin_stage()'])
      await assert.rejects(() => w.pg.query(`select public.${f}`), /permission denied/, role + ' ' + f);
  }
  await w.pg.exec('reset role');
  for (let i = 0; i < 2; i++) { await w.pg.exec(MIG86); await w.pg.exec(MIG87); }   // 入れる一式の 2（20261206＋20261207）を 2 回
  assert.equal((await w.sql('select public.dl_pin_stage() v')).rows[0].v, 2);
  assert.equal((await w.rpc('dl_pin_blocked', { emp_id: 'E12', name: 'Former GM' })).blocked, false);
  const f = await w.sql(`select value, note from dl_flags`);
  assert.deepEqual(f.rows, [{ value: true, note: 'v1186 の SQL' }]);
  const ev = await w.sql(`select kind, actor, result, reason from dl_events where kind = 'pin_off'`);
  assert.equal(ev.rows.length, 3);
  assert.deepEqual(ev.rows[0], { kind: 'pin_off', actor: 'sql', result: 'ok', reason: 'top_pin_off=true' });
  const sec = await w.sql(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dl\\_%' and (p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))`);
  assert.equal(sec.rows[0].n, 0, 'security invoker・search_path 固定');
});
