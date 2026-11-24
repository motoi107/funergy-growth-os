// v1211（B-1）：事務Crew が、経理リーダー・経理マネージャー・GM と同じ経理レビューの申請・精算を見られるか。
// 本物の SQL（本番の順・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E15' は社員 E15）。
// 仕様：docs/ACCT_VIEW_V1211_JA.md。直す前（20261217090000 なし）と直したあとを同じ手順で比べる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, M, NAME, KINDS16 } from './approval-rules-world.mjs';

const LOST = M('20261213090000_wr_lost');
const FIX = M('20261217090000_wr_actor_crew_grant');
const ACCT_KINDS = ['mileage', 'reimburse', 'expense_pre', 'lost'];
// PIN だけの事務Crew（manager_auth なし）：E15 は GM が「事務Crew と確かめた」・E16 はまだ
const EXTRA = [['E15', 'Pia Pin', 'office_crew', 'Office Crew', 'OFFICE'], ['E16', 'Quinn Pin', 'office_crew', 'Office Crew', 'OFFICE']];

async function world({ fix = true, live = false, grant = true } = {}) {
  const s = await setup({});
  await s.pg.exec('reset role');
  await s.pg.exec(LOST);
  for (const [id, nm, role, title, store] of EXTRA) {
    await s.pg.query(`insert into employees values($1,$2,$3,$4,$5,'[]','在籍',$6)`, [id, nm, role, title, store, JSON.stringify({ name: nm, status: '在籍' })]);
    NAME[id] = nm;
  }
  if (fix) await s.pg.exec(FIX);
  await s.pg.exec('set role service_role');
  if (grant) {
    const g = await s.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: null, reimburse: null, crew: true, expect_rev: 0 });
    assert.equal(g.status, 200, 'grant ' + JSON.stringify(g.body));
  }
  if (live) { await s.activate(KINDS16.concat(['lost'])); await s.live(); }
  return s;
}

// 店のスタッフの申請 4 件（GM が承認 → 経理の確認待ち）
async function four(s) {
  const reqs = [];
  for (const [who, kind, st] of [['E6', 'reimburse', 'S1'], ['E7', 'mileage', 'S1'], ['E13', 'expense_pre', 'S3'], ['E14', 'reimburse', 'S2']]) {
    const r = await s.subOk(who, kind, st);
    const a = await s.approve('E2', r);
    assert.equal(a.status, 200, 'approve ' + JSON.stringify(a.body));
    reqs.push(r);
  }
  return reqs;
}

async function view(s, who, reqs) {
  const w = await s.call(who, { action: 'whoami' });
  const l = await s.call(who, { action: 'list', scope: 'team', state: 'open', limit: 500 });
  const rows = (l.body.rows || []).filter(r => ACCT_KINDS.includes(r.kind) && (r.status === 'approved' || r.status === 'checked'))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const gets = [];
  for (const r of reqs) gets.push((await s.get(who, r)).status);
  return {
    role: w.body.me && w.body.me.role, grade: w.body.me && w.body.me.grade, list: l.status,
    ids: rows.map(r => r.id), cents: rows.reduce((t, r) => t + (r.amount_cents || 0), 0),
    can: rows.map(r => (r.can || []).slice().sort().join('|')), get: gets.join(','),
  };
}
const same = v => ({ ids: v.ids, cents: v.cents, can: v.can, get: v.get });

test('直す前：GM が「事務Crew と確かめた」PIN だけの事務Crew は、経理レビューの申請を見られなかった（原因）', async () => {
  for (const live of [false, true]) {
    const s = await world({ fix: false, live });
    const reqs = await four(s);
    const e4 = await view(s, 'E4', reqs), e15 = await view(s, 'E15', reqs);
    assert.equal(e4.ids.length, 4, 'メールのアカウントの事務Crew は 4 件');
    assert.equal(e15.role, 'staff');
    assert.ok(e15.can.every(c => !c.split('|').includes('check')), 'live=' + live + '：確認した が出ない');
    if (!live) { assert.equal(e15.ids.length, 0); assert.equal(e15.get, '404,404,404,404'); }
  }
});

for (const live of [false, true]) {
  test(`直したあと（共通ルール ${live ? '使用中' : 'まだ'}）：確かめた事務Crew は事務Crew のアカウント・経理・GM と同じ申請・件数・金額・1 件・ボタン`, async () => {
    const s = await world({ live });
    const reqs = await four(s);
    const e15 = await view(s, 'E15', reqs), e4 = await view(s, 'E4', reqs), e3 = await view(s, 'E3', reqs), e2 = await view(s, 'E2', reqs);
    assert.equal(e15.role, 'office_crew');
    assert.equal(e15.grade, 1);
    assert.equal(e15.list, 200);
    assert.equal(e15.ids.length, 4);
    assert.deepEqual(same(e15), same(e4), '事務Crew のアカウントと同じ');
    assert.deepEqual({ ids: e15.ids, cents: e15.cents, get: e15.get }, { ids: e3.ids, cents: e3.cents, get: e3.get }, '経理マネージャーと同じ申請と金額');
    assert.deepEqual({ ids: e15.ids, cents: e15.cents, get: e15.get }, { ids: e2.ids, cents: e2.cents, get: e2.get }, 'GM と同じ申請と金額');
    for (const c of e15.can) { assert.ok(c.split('|').includes('check'), c); assert.ok(!c.split('|').includes('approve'), c); }
  });
}

test('直したあと：確かめた事務Crew の「確認した」「支払」は事務Crew のアカウントと同じに通り、処理済み（今月）にも同じ件が出る', async () => {
  const s = await world();
  const [r] = await four(s);
  const f1 = await s.fresh(r);
  const c = await s.act('E15', f1, 'check');
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const f2 = await s.fresh(r);
  assert.equal(f2.status, 'checked');
  const p = await s.act('E15', f2, 'pay', { pay_date: s.today, pay_method: 'check' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const done = {};
  for (const who of ['E15', 'E4', 'E3', 'E2']) {
    const d = await s.call(who, { action: 'acct_done', month: null, limit: 200 });
    assert.equal(d.status, 200, who + ' ' + JSON.stringify(d.body));
    done[who] = (d.body.rows || []).map(x => x.id).sort();
  }
  assert.ok(done.E15.includes(r.id));
  assert.deepEqual(done.E15, done.E4);
  assert.deepEqual(done.E15, done.E3);
});

test('直したあと：申請に付けた領収書（チャットのファイル）を確かめた事務Crew も開ける・ほかの店のスタッフは開けない', async () => {
  const s = await world();
  const [r] = await four(s);
  const fid = '11111111-2222-4333-8444-555555555555';
  await s.q(`insert into chat_threads(id, kind, title, created_by) values ('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'group', 'receipt', 'E6')`);
  await s.q(`insert into chat_files(id, thread_id, owner_emp, client_key, name, ext, kind, mime, path, status, wr_id)
    values ($1, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'E6', 'ck-receipt-1', 'receipt.pdf', 'pdf', 'pdf', 'application/pdf', 'aaaa/receipt', 'sent', $2)`, [fid, r.id]);
  await s.q(`update wr_requests set payload = jsonb_set(payload, '{receipt}', jsonb_build_object('chat_file', $1::text)) where id = $2`, [fid, r.id]);
  const open = async who => { try { return await s.db.rpc('wr_receipt_file', { emp_id: who, name: NAME[who], id: r.id }); } catch (e) { return { err: String(e.message || e) }; } };
  for (const who of ['E15', 'E4', 'E3', 'E2']) assert.equal((await open(who)).path, 'aaaa/receipt', who);
  for (const who of ['E16', 'E9', 'E14']) assert.ok((await open(who)).err, who + ' は開けない');
});

test('直したあと：広げない（確かめていない事務Crew・店のスタッフ・メールのアカウントの無い経理は今までと同じ・GM だけの操作は断る）', async () => {
  const before = await world({ fix: false });
  const rb = await four(before);
  const after = await world();
  const ra = await four(after);
  for (const who of ['E16', 'E8', 'E9', 'E12', 'E6', 'E5']) {
    const b = await view(before, who, rb), a = await view(after, who, ra);
    assert.equal(a.role, b.role, who);
    assert.equal(a.ids.length, b.ids.length, who);
    assert.equal(a.get, b.get, who);
  }
  assert.equal((await view(after, 'E16', ra)).ids.length, 0, '確かめていない事務Crew は 0 件のまま');
  assert.equal((await view(after, 'E8', ra)).ids.length, 0, '店のスタッフは 0 件のまま');
  for (const body of [{ action: 'exp_grant_list' }, { action: 'exp_grant_save', target: 'E16', mileage: null, reimburse: null, crew: true, expect_rev: 0 }]) {
    const r = await after.call('E15', body);
    assert.equal(r.status, 403, body.action);
  }
  const f = await after.fresh(ra[0]);
  assert.ok(!(f.can || []).includes('approve'));
});

test('直したあと：確かめを外す・事務Crew でなくなる・退職で、次の呼び出しから元に戻る（変更の記録も正しい）', async () => {
  const s = await world();
  const reqs = await four(s);
  assert.equal((await view(s, 'E15', reqs)).role, 'office_crew');
  // 1) GM が確かめを外す
  const row = (await s.call('E2', { action: 'exp_grant_list' })).body.rows.find(x => x.emp === 'E15');
  const off = await s.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: null, reimburse: null, crew: null, expect_rev: row.rev });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const v1 = await view(s, 'E15', reqs);
  assert.equal(v1.role, 'staff'); assert.equal(v1.ids.length, 0);
  const log = await s.q(`select before_eff, after_eff from wr_exp_grant_log where emp_id = 'E15' and kind = 'crew' order by at desc, id desc limit 1`);
  assert.deepEqual(log[0], { before_eff: true, after_eff: false });
  // 2) 確かめ直して、従業員マスターで事務Crew でなくなる
  const row2 = (await s.call('E2', { action: 'exp_grant_list' })).body.rows.find(x => x.emp === 'E15');
  assert.equal((await s.call('E2', { action: 'exp_grant_save', target: 'E15', mileage: null, reimburse: null, crew: true, expect_rev: row2.rev })).status, 200);
  assert.equal((await view(s, 'E15', reqs)).role, 'office_crew');
  await s.q(`update employees set role = 'crew', title = 'Crew' where id = 'E15'`);
  const v2 = await view(s, 'E15', reqs);
  assert.equal(v2.role, 'staff'); assert.equal(v2.ids.length, 0);
  // 3) 戻して、退職
  await s.q(`update employees set role = 'office_crew', title = 'Office Crew' where id = 'E15'`);
  assert.equal((await view(s, 'E15', reqs)).role, 'office_crew');
  await s.retire('E15');
  assert.equal((await s.call('E15', { action: 'whoami' })).status, 403);
});

test('直したあと：GM・CEO が確かめた写し（wr_people）の決め方は変えない（AM・G3 以上は写し・G2 以下の古い写しは確かめを使う）', async () => {
  const s = await world();
  const sync = async () => { const gm = { emp_id: 'E2', name: NAME.E2 }; const d = await s.db.rpc('wr_people_diff', gm); await s.db.rpc('wr_people_sync', { ...gm, digest: d.digest }); };
  const who = async () => (await s.call('E15', { action: 'whoami' })).body.me;
  // G2（事務Crew Leader）として写しを作り、肩書きを G1 に戻す → 古い G2 の写しでも確かめが使われる
  await s.q(`update employees set title = 'Office Crew Leader' where id = 'E15'`);
  await sync();
  await s.q(`update employees set title = 'Office Crew' where id = 'E15'`);
  const m1 = await who();
  assert.equal(m1.role, 'office_crew'); assert.equal(m1.grade, 1);
  // G3（Accounting Leader）として写しを作る → 写しの決め方のまま（直す前と同じ staff）
  await s.q(`update employees set title = 'Accounting Leader' where id = 'E15'`);
  await sync();
  const m2 = await who();
  assert.equal(m2.role, 'staff');
});

test('SQL：2 回流しても同じ・前の SQL がなければ何も変えずに止まる・サーバーの鍵だけが呼べる', async () => {
  const s = await world();
  await s.pg.exec('reset role');
  await s.pg.exec(FIX);
  await s.pg.exec('set role service_role');
  const reqs = await four(s);
  assert.equal((await view(s, 'E15', reqs)).ids.length, 4);
  const acl = await s.q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
    has_function_privilege('service_role', p.oid, 'execute') sv from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wr_actor', 'wr_exp_base') order by 1`);
  assert.deepEqual(acl, [{ proname: 'wr_actor', a: false, u: false, sv: true }, { proname: 'wr_exp_base', a: false, u: false, sv: true }]);
  const { PGlite } = await import(process.env.BOT_PGLITE_MODULE || './runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
  await assert.rejects(pg.exec(FIX), /STOP: 先に 20261204090000_wr_exp_grants\.sql/);
  const fn = await pg.query(`select count(*)::int n from pg_proc where proname in ('wr_actor', 'wr_exp_base')`);
  assert.equal(fn.rows[0].n, 0);
});

// 入れる一式（deploy/acct-view-v1211）と戻す SQL
import { readFileSync } from 'node:fs';
const D = n => readFileSync(new URL('../deploy/acct-view-v1211/' + n, import.meta.url), 'utf8');
const ROLLBACK = readFileSync(new URL('../db/acct-view-crew-grant-rollback.sql', import.meta.url), 'utf8');
const fnBody = (sql, name) => {
  const i = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(i >= 0, name);
  const j = sql.indexOf('end $$;', i);
  return sql.slice(i, j + 7);
};
const table = async (s, sql) => { await s.pg.exec('reset role'); const r = (await s.pg.query(sql)).rows; await s.pg.exec('set role service_role'); return r; };

test('入れる一式：2 は migration と同じ・戻す SQL は前の 2 つの中身と同じ', () => {
  assert.equal(D('2_SQL_事務Crewの経理レビュー.sql'), FIX);
  assert.equal(D('戻す_SQL.sql'), ROLLBACK);
  assert.equal(fnBody(ROLLBACK, 'wr_actor'), fnBody(M('20261107090000_work_requests_ui68'), 'wr_actor'));
  assert.equal(fnBody(ROLLBACK, 'wr_exp_base'), fnBody(M('20261204090000_wr_exp_grants'), 'wr_exp_base'));
  assert.ok(!/crew_grant/.test(fnBody(ROLLBACK, 'wr_actor') + fnBody(ROLLBACK, 'wr_exp_base')));
});

test('入れる一式：1 → 2 → 3 の表・前の SQL を流し直すと 3 が NG・戻す SQL で前の見え方', async () => {
  const s = await world({ fix: false });
  const reqs = await four(s);
  const pre = await table(s, D('1_最初に確認_読むだけ.sql'));
  assert.ok(pre.every(r => r.result !== 'STOP'), JSON.stringify(pre));
  assert.equal(pre.find(r => r.no === 5).result, 'まだ（初めて）');
  assert.match(pre.find(r => r.no === 6).detail, /^1 人/);          // E15
  assert.match(pre.find(r => r.no === 7).detail, /^1 人/);          // E16
  assert.match(pre.find(r => r.no === 9).detail, /^1 人/);          // E12（経理のアカウントなし）
  assert.ok(!pre.some(r => /Pia|Quinn|E15|E16/.test(JSON.stringify(r))), '名前・ID は出さない');
  // 3 は入れる前なら NG
  const before = await table(s, D('3_確認_読むだけ.sql'));
  assert.deepEqual(before.filter(r => r.no <= 2).map(r => r.result), ['NG', 'NG']);
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_事務Crewの経理レビュー.sql')); await s.pg.exec('set role service_role');
  assert.equal((await view(s, 'E15', reqs)).ids.length, 4);
  const post = await table(s, D('3_確認_読むだけ.sql'));
  assert.ok(post.every(r => r.result !== 'NG'), JSON.stringify(post));
  assert.match(post.find(r => r.no === 5).detail, /^1 人/);
  assert.equal((await table(s, D('1_最初に確認_読むだけ.sql'))).find(r => r.no === 5).result, 'もう入っています（2 をもう一度流しても同じ）');
  // 前の申請の SQL（v1135 の wr_actor）・v1184 の 2 をあとで流すと 3 の 1・2 が NG（直しが外れる）
  await s.pg.exec('reset role'); await s.pg.exec(M('20261107090000_work_requests_ui68')); await s.pg.exec('set role service_role');
  assert.equal((await table(s, D('3_確認_読むだけ.sql'))).find(r => r.no === 1).result, 'NG');
  assert.equal((await view(s, 'E15', reqs)).role, 'staff');
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_事務Crewの経理レビュー.sql')); await s.pg.exec(M('20261204090000_wr_exp_grants')); await s.pg.exec('set role service_role');
  assert.deepEqual((await table(s, D('3_確認_読むだけ.sql'))).filter(r => r.no <= 2).map(r => r.result), ['OK', 'NG']);
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_事務Crewの経理レビュー.sql')); await s.pg.exec('set role service_role');
  assert.ok((await table(s, D('3_確認_読むだけ.sql'))).every(r => r.result !== 'NG'));
  // 戻す SQL：前の見え方（staff・0 件）・確かめと記録は残る・2 回流しても同じ
  for (let i = 0; i < 2; i++) { await s.pg.exec('reset role'); await s.pg.exec(D('戻す_SQL.sql')); await s.pg.exec('set role service_role'); }
  const v = await view(s, 'E15', reqs);
  assert.equal(v.role, 'staff'); assert.equal(v.ids.length, 0);
  assert.equal((await s.q(`select crew from wr_exp_grants where emp_id = 'E15'`))[0].crew, true);
  assert.equal((await view(s, 'E4', reqs)).ids.length, 4, '事務Crew のアカウントの人は前から見られる');
  const acl = await table(s, `select bool_or(has_function_privilege(r, p.oid, 'execute')) x from pg_proc p, unnest(array['anon','authenticated']) r
    where p.proname in ('wr_actor', 'wr_exp_base') and p.pronamespace = 'public'::regnamespace`);
  assert.equal(acl[0].x, false);
});
