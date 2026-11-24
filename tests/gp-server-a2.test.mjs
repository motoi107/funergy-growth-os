// キャリア・育成 A-2（サーバー）：育成計画・OJT の表と関数（SQL 20261219090000・関数 secure-state の gp_*）。合成データだけ（本番には接続しない）。
// 確かめること（docs/GRADE_UNIFY_A_JA.md の 7・統合実装プロンプトの A-6・A-7・A-9）：
//  1. SQL（PGlite の本物の PostgreSQL）：公開の鍵は表・関数を使えない・サーバーの鍵でも消せない・最初の確かめ・確認の SQL・戻す SQL・形の違う表で STOP・
//     2 回流しても同じ・開いている計画は 1 人 1 つ・版の違う保存は書かない・状態の進み方・習得確認には根拠・旧の記録の写し（元は変えない・同じ中身は 1 つ・
//     全部「旧として保存」・理由つき・人の地図は 1 件ずつ）
//  2. 関数（本物の handler と PGlite）：だれが読む・作る・直す・指導者・確認者・本人・取りやめ・閉じる・記録の種類・同時の保存・SQL の前・答えにいつも gpfn:1・
//     計画は app_state・社員の表・Career Score の表を書かない
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MIG, mkdb, as, table, snap, setup, okj, fail } from './lib/gp-world.mjs';

const rd = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PRE = rd('db/gp-precheck.sql');
const POST = rd('db/gp-postcheck.sql');
const BACK = rd('db/gp-rollback.sql');
const TABLES = ['gp_plans', 'gp_tasks', 'gp_notes', 'gp_log', 'gp_runs', 'gp_legacy'];
// ---------- 1. SQL ----------
test('SQL: keys and permissions, precheck/postcheck/rollback, run twice, STOP on a different table, one active plan, versions, states', async () => {
  const db = await mkdb();
  const pre = await table(db, PRE);
  assert.ok(pre.length >= 4 && pre.every(r => !/^STOP/.test(r.ok)), JSON.stringify(pre));
  await db.exec(MIG); await db.exec(MIG);
  for (const t of TABLES) {
    for (const r of ['anon', 'authenticated']) await assert.rejects(() => as(db, r, `select * from public.${t}`), /permission denied/, r + ' ' + t);
    await assert.rejects(() => as(db, 'service_role', `delete from public.${t}`), /permission denied/, 'no delete ' + t);
    await assert.rejects(() => as(db, 'service_role', `truncate public.${t}`), /permission denied/, 'no truncate ' + t);
  }
  for (const t of ['gp_notes', 'gp_log', 'gp_legacy']) await assert.rejects(() => as(db, 'service_role', `update public.${t} set id = id`), /permission denied/, 'append only ' + t);
  await assert.rejects(() => as(db, 'anon', "select public.gp_legacy_copy('sql', 'x', null, null)"), /permission denied/);
  const q = async (sql, p) => (await as(db, 'service_role', sql, p)).rows[0].r;
  const f = { system: 'G', grade: 'G2', type: 'Kitchen中心', csq4_ver: 'CAREER_2026_Q4_V1', guide_ver: 'ROLE_GUIDE_2026_Q4_V1' };
  const p1 = await q('select public.gp_plan_save(null, null, $1, $2, $3, $4, $5, $6) r', ['E-1', 'Kai One', JSON.stringify(f), 'E-GM', 'Gina', 'gm']);
  assert.equal(p1.ok, true);
  assert.deepEqual(await q('select public.gp_plan_save(null, null, $1, $2, $3, null, null, null) r', ['E-1', 'Kai One', JSON.stringify(f)]), { ok: false, error: 'open', ids: [String(p1.id)] });
  await assert.rejects(() => as(db, 'service_role', "insert into public.gp_plans(emp_id, system, grade, csq4_ver, guide_ver) values ('E-1', 'G', 'G1', 'c', 'g')"), /duplicate key/);
  await assert.rejects(() => q('select public.gp_plan_save(null, null, $1, $2, $3, null, null, null) r', ['E-9', 'X', JSON.stringify({ ...f, grade: 'G7' })]), /check constraint|violates/);
  await assert.rejects(() => q('select public.gp_plan_save(null, null, $1, $2, $3, null, null, null) r', ['E-9', 'X', JSON.stringify({ ...f, bonus: 1 })]), /gp_bad_value/);
  assert.equal((await q('select public.gp_plan_save($1, 1, null, null, $2, null, null, null) r', [p1.id, '{"wish":"仕込みを任されたい"}'])).ver, 2);
  assert.equal((await q('select public.gp_plan_save($1, 1, null, null, $2, null, null, null) r', [p1.id, '{"wish":"x"}'])).conflict, true, 'a stale version does not write');
  const t1 = await q('select public.gp_task_save($1, null, null, $2, null, null, null) r', [p1.id, JSON.stringify({ title: '仕込み表', items: ['04-03'], checker_emp: 'E-4' })]);
  const ver = async () => (await db.query('select ver from public.gp_tasks where id = $1', [t1.id])).rows[0].ver;
  const act = async (a, n) => q('select public.gp_task_act($1, $2, $3, $4, $5, $6, $7) r', [t1.id, await ver(), a, n, 'E-4', 'Leo', 'staff']);
  assert.equal((await act('master', 'x')).error, 'state', 'not_started cannot be mastered');
  assert.equal((await act('start')).state, 'in_progress');
  assert.equal((await act('ask')).state, 'waiting');
  assert.equal((await act('master', '  ')).error, 'reason_required');
  assert.equal((await act('master', '別の日 3 回')).state, 'mastered');
  const m = (await db.query('select * from public.gp_tasks where id = $1', [t1.id])).rows[0];
  assert.ok(m.mastered_at && m.mastered_basis === '別の日 3 回');
  assert.equal((await act('drop', 'x')).error, 'state', 'a mastered task is not dropped');
  await assert.rejects(() => q('select public.gp_task_act($1, $2, $3, $4, null, null, null) r', [t1.id, 99, 'master', 'x']), /gp_bad_value/, 'a confirmation needs who confirmed');
  assert.equal((await act('reopen', '確認の取り違え')).state, 'in_progress');
  assert.equal((await db.query('select mastered_at from public.gp_tasks where id = $1', [t1.id])).rows[0].mastered_at, null);
  const lg = (await db.query("select detail from public.gp_log where action = 'task_reopen'")).rows[0].detail;
  assert.equal(lg.prev_mastered.basis, '別の日 3 回', 'the earlier confirmation stays in the log');
  const post = await table(db, POST);
  assert.ok(post.length >= 5 && post.every(r => !/^STOP|^NG/.test(r.ok)), JSON.stringify(post));
  // 戻す SQL：関数だけ外す・表と行は残す（2 回）
  await db.exec(BACK); await db.exec(BACK);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'gp\\_%'")).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from public.gp_plans')).rows[0].n, 1);
  await db.exec(MIG);
  // 形の違う表は STOP（何も変えない）
  const d2 = await mkdb(); await d2.exec('create table public.gp_plans(id int)');
  await assert.rejects(() => d2.exec(MIG), /STOP: public\.gp_plans/);
  assert.equal((await d2.query("select count(*)::int n from pg_proc where proname like 'gp\\_%'")).rows[0].n, 0);
});

test('SQL: old OJT and growth records are copied as "saved as old" with a reason; the source never changes; each person entry is a row', async () => {
  const db = await mkdb(); await db.exec(MIG);
  const before = await snap(db);
  const cp = async () => (await as(db, 'service_role', "select public.gp_legacy_copy('sql', '11/24 5B', null, null) r")).rows[0].r;
  const r1 = await cp();
  assert.equal(r1.added, 5); assert.equal(r1.missing, 0); assert.equal(r1.src, 5);
  assert.deepEqual(Object.keys(r1.keys).sort(), ['ojt_def_g3', 'ojt_enroll', 'trainees']);
  assert.equal((await cp()).added, 0, 'the same content is copied once');
  assert.deepEqual(await snap(db), before, 'app_state is not changed');
  const rows = (await db.query('select src_key, src_part, emp_id, decision, reason from public.gp_legacy order by src_key, src_part')).rows;
  assert.deepEqual(rows.map(r => [r.src_key, r.src_part, r.emp_id]), [['ojt_def_g3', 'k1', null], ['ojt_enroll', 'Dup Name', null], ['ojt_enroll', 'E-1', 'E-1'], ['ojt_enroll', 'Kai One', 'E-1'], ['trainees', '', null]]);
  assert.ok(rows.every(r => r.decision === 'saved_as_old' && r.reason === '11/24 5B'));
  assert.ok(!rows.some(r => ['skills', 'growth_karte'].includes(r.src_key)), 'skills (Tip) and the growth karte (pay) are not copied');
  await db.query(`update public.app_state set value = '{"Kai One":{"phase":3}}' where key = 'ojt_enroll'`);
  const r3 = await cp();
  assert.equal(r3.added, 1, 'a changed entry adds a row'); assert.equal((await db.query('select count(*)::int n from public.gp_legacy')).rows[0].n, 6, 'earlier rows stay');
  await assert.rejects(() => as(db, 'service_role', "select public.gp_legacy_copy('sql', ' ', null, null)"), /gp_bad_value/);
});

// ---------- 2. 関数 ----------
test('who manages whom (the Career Score Q4 scorers), creating a plan, the person writes only their wish, stale saves, forms from the Q4 master', async () => {
  const { pin, email, db, W } = await setup();
  const emps = async r => okj(await r, 'roster').rows.map(x => x.emp).sort();
  assert.deepEqual(await emps(email('gm', { action: 'gp_roster' })), ['E-1', 'E-1B', 'E-2', 'E-22', 'E-3', 'E-4', 'E-AM', 'E-CEO']);
  assert.deepEqual(await emps(pin('am', { action: 'gp_roster' })), ['E-1', 'E-1B', 'E-22', 'E-3', 'E-4'], 'the AM: their store');
  assert.deepEqual(await emps(pin('g4', { action: 'gp_roster' })), ['E-1', 'E-1B', 'E-22', 'E-3'], 'G4: lower grades of their store');
  assert.deepEqual(await emps(pin('g3', { action: 'gp_roster' })), ['E-22'], 'G3: G2 of their store');
  assert.deepEqual(await emps(pin('g1', { action: 'gp_roster' })), []);
  const app0 = JSON.stringify([...W.rows.entries()]), emp0 = JSON.stringify(W.emps || null);
  const make = (who, emp, f) => pin(who, { action: 'gp_plan_save', emp, f });
  fail(await make('g1', 'E-1', { system: 'G', grade: 'G1', type: 'Kitchen中心' }), 403, 'forbidden', 'the person does not create their own plan');
  fail(await make('g4', 'E-2', { system: 'G', grade: 'G1', type: 'Kitchen中心' }), 403, 'forbidden', 'another store');
  fail(await make('g3', 'E-22', { system: 'S_CHEF', grade: 'S2' }), 403, 'forbidden', 'G3 only for the G form');
  fail(await make('g4', 'E-1', { system: 'G', grade: 'G7', type: 'Kitchen中心' }), 400, 'bad_value', 'G7 is not part of the system');
  fail(await make('g4', 'E-1', { system: 'G', grade: 'G4', type: 'Kitchen中心' }), 400, 'bad_value', 'the type must be one of that grade');
  fail(await make('g4', 'E-1', { system: 'G', grade: 'G1', type: 'Kitchen中心', wish: 'x' }), 400, 'bad_value', 'the manager does not write the wish');
  fail(await make('g4', 'E-1', { system: 'G', grade: 'G1', type: 'Kitchen中心', score: 3 }), 400, 'bad_value');
  const p = okj(await make('g4', 'E-1', { system: 'G', grade: 'G1', type: 'Kitchen中心', target_grade: 'G2', target: 'G2 Crew Leader', strengths: '工程を守る', support: [{ who: 'Leo', when: '火・木', what: '仕込み表', how: '時刻と量' }] }), 'create');
  fail(await make('gm', 'E-1', { system: 'G', grade: 'G1', type: 'Kitchen中心' }), 409, 'open', 'one open plan per person');
  const row = (await db.query('select * from public.gp_plans where id = $1', [p.id])).rows[0];
  assert.equal(row.csq4_ver, 'CAREER_2026_Q4_V1'); assert.equal(row.guide_ver, 'ROLE_GUIDE_2026_Q4_V1'); assert.equal(row.emp_name, 'Kai One');
  fail(await pin('g1', { action: 'gp_plan_save', emp: 'E-1', id: p.id, expect: 1, f: { strengths: 'x' } }), 400, 'bad_value', 'the person writes only the wish');
  const w = okj(await pin('g1', { action: 'gp_plan_save', emp: 'E-1', id: p.id, expect: 1, f: { wish: '段取りを任されたい' } }), 'wish');
  fail(await pin('g4', { action: 'gp_plan_save', emp: 'E-1', id: p.id, expect: 1, f: { issues: '逆算' } }), 409, 'conflict', 'a stale version');
  okj(await pin('g4', { action: 'gp_plan_save', emp: 'E-1', id: p.id, expect: w.ver, f: { issues: '逆算' } }), 'issues');
  fail(await pin('g1b', { action: 'gp_get', emp: 'E-1' }), 403, 'forbidden', 'a coworker does not read the plan');
  fail(await pin('s2', { action: 'gp_get', emp: 'E-1' }), 403, 'forbidden');
  const me = okj(await pin('g1', { action: 'gp_me' }), 'me');
  assert.equal(me.plan.wish, '段取りを任されたい'); assert.equal(me.plan.issues, '逆算');
  assert.equal(JSON.stringify([...W.rows.entries()]), app0, 'app_state is not written'); assert.equal(JSON.stringify(W.emps || null), emp0);
  assert.equal((await db.query('select count(*)::int n from public.csq4_evals')).rows[0].n, 0, 'no evaluation rows');
});

test('OJT: trainer, checker, the person; mastery needs a manager who is the checker (or GM/CEO) and a basis; notes keep who wrote them', async () => {
  const { pin, email, db } = await setup();
  const p = okj(await pin('g4', { action: 'gp_plan_save', emp: 'E-1', f: { system: 'G', grade: 'G1', type: 'Kitchen中心' } }), 'plan');
  fail(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: 'x', items: ['99-99'] } }), 400, 'bad_value', 'items must be in the Q4 master');
  fail(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: 'x', items: ['CF-01'] } }), 400, 'bad_value', 'items of another system');
  fail(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: 'x', trainer: 'E-1' } }), 400, 'bad_value', 'the person is not their own trainer');
  fail(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: 'x', trainer: 'E-OUT' } }), 400, 'bad_value', 'a retired person');
  fail(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: 'x', due: '2026-02-30' } }), 400, 'bad_value');
  fail(await pin('g1', { action: 'gp_task_save', plan: p.id, f: { title: 'x' } }), 403, 'forbidden', 'the person does not make tasks');
  const t = okj(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: '仕込み表', items: ['04-03', '04-02'], trainer: 'E-1B', checker: 'E-3', due: '2026-12-12', standard: '完成時刻', method: '別の日 3 回' } }), 'task');
  const tv = async () => (await db.query('select ver from public.gp_tasks where id = $1', [t.id])).rows[0].ver;
  const act = async (who, a, note) => pin(who, { action: 'gp_task_act', id: t.id, expect: await tv(), act: a, note });
  // 指導者（G1 の同僚）は読めて、実施中・確認待ちにできる。習得確認はできない
  const g = okj(await pin('g1b', { action: 'gp_get', emp: 'E-1' }), 'trainer reads'); assert.equal(g.role, 'helper');
  assert.equal(okj(await act('g1b', 'start'), 'start').state, 'in_progress');
  fail(await act('g1', 'master', '自分でできた'), 403, 'forbidden', 'the person cannot confirm mastery');
  assert.equal(okj(await act('g1', 'ask'), 'the person asks for a check').state, 'waiting');
  fail(await act('g1b', 'master', 'ok'), 403, 'forbidden', 'the trainer is not a manager');
  fail(await act('g3', 'master', 'ok'), 403, 'forbidden', 'the checker G3 does not manage a G1 (Career Score scope)');
  fail(await act('am', 'master', 'ok'), 403, 'forbidden', 'a manager who is not the named checker');
  fail(await act('g4', 'master', 'ok'), 403, 'forbidden');
  fail(await email('gm', { action: 'gp_task_act', id: t.id, expect: await tv(), act: 'master', note: '' }), 400, 'reason_required');
  assert.equal(okj(await act('g1b', 'retry', '時刻を書いてから'), 'trainer retry').state, 'retry');
  okj(await act('g1', 'ask'), 'ask again');
  assert.equal(okj(await email('gm', { action: 'gp_task_act', id: t.id, expect: await tv(), act: 'master', note: '別の日 3 回・写真 2 枚' }), 'GM confirms').state, 'mastered');
  fail(await act('g1b', 'reopen', 'x'), 403, 'forbidden', 'only managers reopen');
  okj(await act('g4', 'reopen', '確認の取り違え'), 'reopen');
  // 確認者を G4 にすれば G4 が確かめられる
  const t2 = okj(await pin('g4', { action: 'gp_task_save', plan: p.id, f: { title: '洗い場', checker: 'E-4' } }), 'task2');
  const v2 = async () => (await db.query('select ver from public.gp_tasks where id = $1', [t2.id])).rows[0].ver;
  okj(await pin('g1', { action: 'gp_task_act', id: t2.id, expect: await v2(), act: 'start' }), 's'); okj(await pin('g1', { action: 'gp_task_act', id: t2.id, expect: await v2(), act: 'ask' }), 'a');
  const m2 = okj(await pin('g4', { action: 'gp_task_act', id: t2.id, expect: await v2(), act: 'master', note: '3 回' }), 'G4 checker'); assert.equal(m2.state, 'mastered');
  fail(await pin('g4', { action: 'gp_task_save', plan: p.id, id: t2.id, expect: m2.ver, f: { title: 'y' } }), 409, 'state', 'a mastered task is not edited');
  // 記録：だれが書いたかで種類が決まる（画面の言う種類は使わない）
  assert.equal(okj(await pin('g1', { action: 'gp_note', plan: p.id, task: t.id, step: 'do', body: '量は合ったが 10 分遅れた', kind: 'manager' }), 'self note').kind, 'self');
  assert.equal(okj(await pin('g1b', { action: 'gp_note', plan: p.id, task: t.id, step: 'demo', body: '玉ねぎを先に' }), 'trainer note').kind, 'trainer');
  fail(await pin('g1b', { action: 'gp_note', plan: p.id, body: '計画全体へ' }), 403, 'forbidden', 'the trainer writes on their task only');
  assert.equal(okj(await pin('g4', { action: 'gp_note', plan: p.id, body: '来週から火・木' }), 'manager note').kind, 'manager');
  fail(await pin('g1', { action: 'gp_note', plan: p.id, step: 'x', body: 'y' }), 400, 'bad_value');
  const all = okj(await pin('g1', { action: 'gp_me' }), 'me');
  assert.equal(all.tasks.length, 2); assert.ok(all.notes.some(n => n.kind === 'checker' && /写真/.test(n.body)), 'the basis is a checker note');
  // 閉じる（理由が要る）→ 書けない・読める
  const ver = (await db.query('select ver from public.gp_plans where id = $1', [p.id])).rows[0].ver;
  fail(await pin('g1', { action: 'gp_close', id: p.id, expect: ver, reason: 'x' }), 403, 'forbidden');
  fail(await pin('g4', { action: 'gp_close', id: p.id, expect: ver, reason: ' ' }), 400, 'reason_required');
  okj(await pin('g4', { action: 'gp_close', id: p.id, expect: ver, reason: '異動' }), 'close');
  fail(await pin('g1', { action: 'gp_note', plan: p.id, body: 'x' }), 409, 'state');
  const me2 = okj(await pin('g1', { action: 'gp_me' }), 'me after close'); assert.equal(me2.plan, null); assert.equal(me2.closed.length, 1);
  okj(await pin('g4', { action: 'gp_plan_save', emp: 'E-1', f: { system: 'G', grade: 'G1', type: 'Server中心' } }), 'a new plan after closing');
});

test('old records: the person sees their own, managers their people, GM/CEO all; only GM/CEO copy; before the SQL: nosql / not_installed', async () => {
  const { pin, email } = await setup();
  fail(await pin('g4', { action: 'gp_copy' }), 403, 'forbidden');
  const rep = okj(await email('gm', { action: 'gp_copy' }), 'copy').report;
  assert.equal(rep.added, 5); assert.equal(rep.missing, 0);
  assert.equal(okj(await email('gm', { action: 'gp_copy' }), 'again').report.added, 0);
  const mine = okj(await pin('g1', { action: 'gp_legacy', emp: 'E-1' }), 'self').rows;
  assert.deepEqual(mine.map(r => r.src_part).sort(), ['E-1', 'Kai One']); assert.ok(mine.every(r => r.decision === 'saved_as_old' && /5 B/.test(r.reason)));
  assert.equal(okj(await pin('g4', { action: 'gp_legacy', emp: 'E-1' }), 'G4').rows.length, 2);
  fail(await pin('g1b', { action: 'gp_legacy', emp: 'E-1' }), 403, 'forbidden');
  fail(await pin('g4', { action: 'gp_legacy' }), 403, 'forbidden', 'only GM/CEO read everything');
  assert.equal(okj(await pin('ceo', { action: 'gp_legacy' }), 'CEO all').rows.length, 5);
  const n = await setup({ sql: false });
  assert.equal(okj(await n.pin('g1', { action: 'gp_me' }), 'nosql').nosql, true);
  assert.equal(okj(await n.email('gm', { action: 'gp_roster' }), 'nosql roster').nosql, true);
  fail(await n.pin('g4', { action: 'gp_plan_save', emp: 'E-1', f: { system: 'G', grade: 'G1', type: 'Kitchen中心' } }), 503, 'not_installed');
  fail(await n.email('gm', { action: 'gp_copy' }), 503, 'not_installed');
});
