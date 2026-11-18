// v1190 の直し（PR #191 の Codex のレビュー 6970104461 の P2 4 件）。本物の SQL（PGlite）と本物の handler、合成データだけ。
// 1. 「役割の全員」から 1 人ずつに分けた枠は、その人が今もその役割・範囲にいるときだけ承認できる（GM を外した・AM の担当の店が変わった・代理も）
// 2. ルールの保存・有効化・捨てるは、見た下書きの版と回数の両方で確かめる（版ごとに回数が 1 から始まる）。新しい下書きは見た有効な版も確かめる
// 3. 進行中の申請に当てるのは、確かめの画面で見た版だけ（あいだに別の版を有効にしたら何もしない）
// 4. 止めているあいだに差し戻し → 直して出し直した申請は、使い始めに段 1 から取り直す（前の中身への承認を引き継がない）
// 5.（Claude のレビュー P2-1）一覧が遅い → 役割の一覧を 1 回の呼び出しの中で 1 回だけ作る（ar_role_cache）。元の表が変われば同じ取引の中でも作り直す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, G, C, AMm, STAGE, ALLS } from './approval-rules-world.mjs';

test('v1190 fix 1: an "each" slot is checked against the role and scope now — removing the GM role, changing the AM stores or a delegate does not keep the right', async () => {
  const s = await setup(); await s.activate(); await s.live();
  // GM の全員（1 人ずつの枠）→ E2 だけ。GM のアカウントを外すと E2 は承認できない（止まる）
  await s.setRule('shift', { default: { stages: [ALLS({ t: 'role', role: 'gm', scope: 'all', each: true })] } });
  const r = await s.subOk('E8', 'shift', 'S1');
  assert.equal(r.route.stages[0].slots[0].t, 'emp'); assert.equal(r.route.stages[0].slots[0].emp, 'E2');
  await s.q(`delete from manager_auth where emp_id = 'E2'`);
  assert.equal((await s.get('E2', r)).status, 404, 'the former GM no longer sees it');
  const a = await s.act('E2', await s.ok('E1', { action: 'get', id: r.id }), 'approve');
  assert.ok([403, 404].includes(a.status), 'the former GM cannot sign the slot made from the GM role: ' + JSON.stringify(a.body));
  assert.equal((await s.ok('E1', { action: 'get', id: r.id })).status, 'pending');
  const f = await s.ok('E1', { action: 'get', id: r.id });
  assert.equal(f.status, 'pending'); assert.equal(f.route.stuck, true, 'nobody is left in the stage: it stops (never auto-skips)');
  assert.equal(f.route.stages[0].slots[0].names, undefined, 'no eligible names are shown');
  await s.q(`insert into manager_auth(role, emp_id) values ('gm', 'E2')`);
  assert.equal((await s.approve('E2', r)).body.status, 'approved', 'given back the role, the same person can sign again');

  // AM の全員（担当店舗）→ E5（S1）。S1 の担当から外れると承認できない。E5 の代理（E6）も同じ
  await s.setRule('hire', { branches: [{ label: 'AM', when: { has_am: true }, stages: [STAGE({ t: 'role', role: 'am', scope: 'mine', each: true })] }], default: { stages: [STAGE(G, C)] } });
  const h = await s.subOk('E8', 'hire', 'S1');
  assert.deepEqual(h.route.stages[0].slots.map(x => x.emp), ['E5']);
  const end = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await s.ok('E2', { action: 'ar_delegate_save', from: 'E5', to: 'E6', kinds: ['hire'], stores: [], starts: s.today, ends: end, note: '休暇' });
  await s.q(`update stores set am = null where id = 'S1'`);
  const hf = await s.ok('E1', { action: 'get', id: h.id });
  assert.ok([403, 404].includes((await s.act('E5', hf, 'approve')).status), 'no longer the AM of S1');
  assert.ok([403, 404].includes((await s.act('E6', hf, 'approve')).status), 'the delegate of a person who lost the role cannot sign either');
  assert.equal((await s.ok('E1', { action: 'get', id: h.id })).status, 'pending');
  assert.equal((await s.ok('E1', { action: 'get', id: h.id })).route.stuck, true);
  // 名前で決めた枠（of なし）は役割と関係なく、在籍ならそのまま
  await s.setRule('plan', { default: { stages: [STAGE({ t: 'emp', emp: 'E5' })] } });
  const p = await s.subOk('E8', 'plan', 'S1');
  assert.equal((await s.approve('E5', p)).body.status, 'approved', 'a person named in the rule keeps the slot');
});

test('v1190 fix 2: save, activate and discard check the draft version and its count; a new draft checks the active version the screen saw', async () => {
  const s = await setup();
  const v2 = await s.saveRule('plan', { default: { stages: [STAGE(G)] } });          // 初めの下書き（版 1）を直す
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  const seen1 = v2.body.draft;                                                       // 画面 A が見た下書き（版 1）
  await s.ok('E2', { action: 'ar_rule_activate', kind: 'plan', expect_ver: seen1.ver, expect_rev: seen1.rev, note: '版 1' });
  const d2 = await s.ok('E1', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(C)] } }, expect_ver: 0, expect_rev: 0, base_ver: seen1.ver, note: 'CEO だけ' });
  assert.equal(d2.draft.ver, 2); assert.equal(d2.draft.rev, 1);
  await s.ok('E1', { action: 'ar_rule_activate', kind: 'plan', expect_ver: 2, expect_rev: 1, note: '版 2' });
  const d3 = await s.ok('E1', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(C), STAGE(G)] } }, expect_ver: 0, expect_rev: 0, base_ver: 2, note: '2 段' });
  assert.equal(d3.draft.ver, 3); assert.equal(d3.draft.rev, 1, 'the count starts at 1 again for each version');
  // 版 2 の下書き（回数 1）を見ていた古い画面：版 3 の下書き（回数 1）には当たらない
  for (const op of ['ar_rule_activate', 'ar_rule_discard']) {
    const x = await s.call('E2', { action: op, kind: 'plan', expect_ver: 2, expect_rev: 1, note: 'x' });
    assert.equal(x.status, 409, op + ' ' + JSON.stringify(x.body));
  }
  const sv = await s.call('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: 2, expect_rev: 1, base_ver: 2, note: 'x' });
  assert.equal(sv.status, 409);
  let st = await s.state(); let k = st.kinds.find(x => x.kind === 'plan');
  assert.equal(k.active.ver, 2); assert.equal(k.draft.ver, 3); assert.deepEqual(k.draft.def.default.stages.map(x => x.slots[0].role), ['ceo', 'gm'], 'the draft is untouched');
  // 下書きが無い画面（有効は版 2 と見ていた）：あいだに版 3 が有効になったら、新しい下書きを作らない
  await s.ok('E1', { action: 'ar_rule_activate', kind: 'plan', expect_ver: 3, expect_rev: 1, note: '版 3' });
  const nd = await s.call('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: 0, expect_rev: 0, base_ver: 2, note: '古い画面' });
  assert.equal(nd.status, 409, 'a stale screen does not start a draft from an old active version');
  st = await s.state(); k = st.kinds.find(x => x.kind === 'plan'); assert.equal(k.draft, undefined); assert.equal(k.active.ver, 3);
  // 値が無い・形が違う：送る前に断る（400）
  assert.equal((await s.call('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_rev: 0, note: 'x' })).status, 400);
  assert.equal((await s.call('E2', { action: 'ar_rule_activate', kind: 'plan', expect_rev: 1, note: 'x' })).status, 400);
  assert.equal((await s.call('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: '3', expect_rev: 1 })).status, 400);
  // 正しい画面なら通る
  const ok = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: 0, expect_rev: 0, base_ver: 3, note: '新しい画面' });
  assert.equal(ok.draft.ver, 4);
  await s.ok('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: 4, expect_rev: 1 });
});

test('v1190 fix 3: applying to pending requests uses only the version the confirmation screen showed', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('hire', { default: { stages: [STAGE(G), STAGE(C)] } });                        // 版 2：GM → CEO
  const r = await s.subOk('E8', 'hire', 'S1');
  assert.equal((await s.approve('E2', r)).body.route.cur, 2);
  await s.setRule('hire', { default: { stages: [STAGE(G), STAGE(C), STAGE(G)] } });             // 版 3：GM → CEO → GM
  const pv = await s.ok('E2', { action: 'ar_apply_preview', kind: 'hire' });
  assert.equal(pv.ver, 3); assert.equal(pv.rows[0].final, false); assert.equal(pv.rows[0].keep, 1);
  await s.setRule('hire', { default: { stages: [STAGE(G)] } });                                   // 版 4：GM だけ（だれかがあいだに有効にした）
  const f = await s.fresh(r);
  const ap = await s.call('E2', { action: 'ar_apply', kind: 'hire', ver: pv.ver, items: [{ id: f.id, rev: f.rev }], note: '版 3 を当てる' });
  assert.equal(ap.status, 409, 'the screen confirmed version 3; version 4 is not applied: ' + JSON.stringify(ap.body));
  const g = await s.fresh(r);
  assert.equal(g.status, 'pending'); assert.equal(g.route.rule.ver, 2, 'nothing changed'); assert.equal(g.rev, f.rev);
  assert.equal((await s.call('E2', { action: 'ar_apply', kind: 'hire', items: [{ id: f.id, rev: f.rev }], note: 'x' })).status, 400, 'the version is required');
  // 新しく確かめれば当てられる（版 4 で段が減って最終承認になることは確かめの画面に出る）
  const pv2 = await s.ok('E2', { action: 'ar_apply_preview', kind: 'hire' });
  assert.equal(pv2.ver, 4); assert.equal(pv2.rows[0].final, true);
  const ap2 = await s.ok('E2', { action: 'ar_apply', kind: 'hire', ver: pv2.ver, items: [{ id: f.id, rev: f.rev }], note: '版 4 を当てる' });
  assert.deepEqual(ap2.results.map(x => x.outcome), ['final']);
});

test('v1190 fix 4: returned → switch off → edited and sent again → switch on: approvals start again from stage 1 (rollback too)', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('reimburse', { default: { stages: [STAGE(G), STAGE(C)] } });
  const r = await s.subOk('E6', 'reimburse', 'S1', { amount_cents: 60000 });
  assert.equal((await s.approve('E2', r)).body.route.cur, 2);
  let f = await s.fresh(r);
  const ret = await s.call('E1', { action: 'act', id: r.id, op: 'return', note: '領収書を付けて', expect_rev: f.rev, client_key: s.key() });
  assert.equal(ret.status, 200, JSON.stringify(ret.body)); assert.equal(ret.body.status, 'returned');
  const st = await s.state();
  await s.ok('E2', { action: 'ar_go_off', expect_rev: st.rev, note: '止める' });
  const stop = await s.q(`select detail from wr_events where request_id = $1 and action = 'route_stop'`, [r.id]);
  assert.equal(stop.length, 1, 'the returned route is kept in the record'); assert.equal(stop[0].detail.route.stages[0].signs[0].name, 'Gabe GM');
  assert.equal((await s.q(`select route from wr_requests where id = $1`, [r.id]))[0].route, null);
  f = await s.call('E6', { action: 'get', id: r.id });
  const rs = await s.call('E6', { action: 'act', id: r.id, op: 'resubmit', kind: 'reimburse', expect_rev: f.body.rev, client_key: s.key(),
    payload: { date: s.today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 70000 } });
  assert.equal(rs.status, 200, JSON.stringify(rs.body)); assert.equal(rs.body.status, 'pending');
  const lv = await s.live();
  assert.equal(lv.attached, 1, JSON.stringify(lv));
  const g = await s.fresh(r);
  assert.equal(g.amount_cents, 70000); assert.equal(g.route.cur, 1, 'from stage 1 again');
  assert.equal(g.route.stages[0].signs.length, 0, 'the approval of 60000 is not carried over');
  assert.equal((await s.approve('E1', r)).status, 403, 'the CEO stage is not first');

  // トリガーの念のため：止めているあいだに承認待ちに戻る申請は前のルートを持たない（記録の SQL を通らずに残っていた場合）
  const r2 = await s.subOk('E6', 'reimburse', 'S1', { amount_cents: 61000 });
  await s.approve('E2', r2);
  let f2 = await s.fresh(r2);
  await s.call('E1', { action: 'act', id: r2.id, op: 'return', note: 'x', expect_rev: f2.rev, client_key: s.key() });
  const kept = (await s.q(`select route from wr_requests where id = $1`, [r2.id]))[0].route;
  const st2 = await s.state(); await s.ok('E2', { action: 'ar_go_off', expect_rev: st2.rev, note: '止める' });
  await s.q(`update wr_requests set route = $2 where id = $1`, [r2.id, JSON.stringify(kept)]);   // わざと前のルートを戻す
  f2 = await s.fresh(r2);
  const rs2 = await s.call('E6', { action: 'act', id: r2.id, op: 'resubmit', kind: 'reimburse', expect_rev: f2.rev, client_key: s.key(),
    payload: { date: s.today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 71000 } });
  assert.equal(rs2.status, 200, JSON.stringify(rs2.body));
  assert.equal((await s.q(`select route from wr_requests where id = $1`, [r2.id]))[0].route, null, 'the trigger drops the old route while the switch is off');

  // 戻す SQL も差し戻し中のルートを外す
  const s3 = await setup(); await s3.activate(); await s3.live();
  await s3.setRule('reimburse', { default: { stages: [STAGE(G), STAGE(C)] } });
  const r3 = await s3.subOk('E6', 'reimburse', 'S1', { amount_cents: 60000 });
  await s3.approve('E2', r3); const f3 = await s3.fresh(r3);
  await s3.call('E1', { action: 'act', id: r3.id, op: 'return', note: 'x', expect_rev: f3.rev, client_key: s3.key() });
  const { ROLLBACK } = await import('./approval-rules-world.mjs');
  await s3.pg.exec('reset role'); await s3.pg.exec(ROLLBACK); await s3.pg.exec('set role service_role');
  assert.equal((await s3.q(`select route from wr_requests where id = $1`, [r3.id]))[0].route, null);
  assert.equal((await s3.q(`select count(*)::int as n from wr_events where request_id = $1 and action = 'route_stop'`, [r3.id]))[0].n, 1);
});

// 前の ar_holders（SQL・役割の一覧をそのつど作る）と同じ答えか。合成の人・店で、役割 × 範囲 × 店を全部
const REF_HOLDERS = `create or replace function pg_temp.ref_holders(p_role text, p_scope text, p_store text, p_stores text[]) returns text[]
language sql stable as $$
 select coalesce(array(select distinct y.emp_id from public.ar_role_rows() y where y.role = p_role
   and (y.role in ('ceo','gm') or case coalesce(p_scope, 'all')
     when 'all' then true
     when 'mine' then p_store = any(y.stores) or (y.role <> 'am' and cardinality(y.stores) = 0)
     when 'stores' then y.stores && coalesce(p_stores, '{}'::text[]) or (y.role <> 'am' and cardinality(y.stores) = 0)
     else false end)
   and public.ar_emp_ok(y.emp_id) order by y.emp_id), '{}'::text[]);
$$;`;
test('v1190 fix 5: ar_holders (role list made once per call) gives the same answer as before for every role, scope and store', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.pg.exec('reset role');
  try {
    await s.pg.exec(REF_HOLDERS);
    // 退職した人・AM の担当の店が無い人も入れる
    await s.pg.query(`update employees set status = '退職', data = data || '{"status":"退職"}' where id = 'E10'`);
    // 同じ人に 2 つのアカウント（同じ役割）がある：役割の一覧に 2 行出ても、承認者は 1 人
    await s.pg.query(`insert into manager_auth(role, emp_id) values ('gm', 'E2'), ('office', 'E3')`);
    const roles = ['ceo', 'gm', 'am', 'chef', 'acct_mgr', 'acct_lead', 'office_crew', 'x'];
    const scopes = ['all', 'mine', 'stores', null, 'bad'];
    const stores = [null, 'S1', 'S2', 'S3', 'S9'];
    const lists = [null, [], ['S1'], ['S2', 'S3'], ['S9']];
    let n = 0;
    for (const ro of roles) for (const sc of scopes) for (const st of stores) for (const li of lists) {
      const r = (await s.pg.query(`select public.ar_holders($1, $2, $3, $4::text[]) as a, pg_temp.ref_holders($1, $2, $3, $4::text[]) as b`, [ro, sc, st, li])).rows[0];
      assert.deepEqual(r.a, r.b, JSON.stringify({ ro, sc, st, li })); n++;
    }
    assert.equal(n, 8 * 5 * 5 * 5);
    // 何人かは出ること（空どうしで同じ、ではない）
    assert.ok((await s.pg.query(`select cardinality(public.ar_holders('am', 'mine', 'S1', null)) as c`)).rows[0].c > 0);
    assert.equal((await s.pg.query(`select count(*)::int as n from public.ar_role_rows() where role = 'gm' and emp_id = 'E2'`)).rows[0].n, 2);
    assert.deepEqual((await s.pg.query(`select public.ar_holders('gm', 'all', null, null) as a`)).rows[0].a, ['E2']);
  } finally { await s.pg.exec('set role service_role'); }
});

test('v1190 fix 5: the role list is rebuilt when accounts, confirmed people, employees, stores or expense grants change — in the same transaction too', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.pg.exec('reset role');
  const h = async (tx, role, scope = 'all', store = null) => (await tx.query(`select public.ar_holders($1, $2, $3, null) as a`, [role, scope, store])).rows[0].a;
  try {
    await s.pg.transaction(async tx => {
      assert.deepEqual(await h(tx, 'gm'), ['E2']);
      await tx.query(`delete from manager_auth where emp_id = 'E2'`);
      assert.deepEqual(await h(tx, 'gm'), [], 'manager_auth');
      const am = await h(tx, 'am', 'mine', 'S1'); assert.ok(am.length > 0);
      await tx.query(`update stores set am = null where id = 'S1'`);
      assert.deepEqual(await h(tx, 'am', 'mine', 'S1'), [], 'stores');
      await tx.query(`update employees set status = '退職', data = data || '{"status":"退職"}' where id = 'E1'`);
      assert.deepEqual(await h(tx, 'ceo'), [], 'employees');
      const crew = await h(tx, 'office_crew');
      await tx.query(`insert into wr_exp_grants(emp_id, crew) values ('E6', true) on conflict (emp_id) do update set crew = true`);
      assert.ok((await h(tx, 'office_crew')).includes('E6') && !crew.includes('E6'), 'wr_exp_grants');
      const chef = await h(tx, 'chef');
      await tx.query(`update wr_people set chef = false`);
      assert.ok(chef.length > 0); assert.deepEqual(await h(tx, 'chef'), [], 'wr_people');
      await tx.rollback();
    });
    // 取引のあとは前の写しを使わない（取り消した変更は戻っている）
    assert.deepEqual(await h(s.pg, 'gm'), ['E2']);
    assert.deepEqual(await h(s.pg, 'ceo'), ['E1']);
    assert.equal(current(await s.pg.query(`select current_setting('ar.role_cache', true) as v`)), true);
  } finally { await s.pg.exec('set role service_role'); }
});
const current = r => { const v = r.rows[0].v; return v === null || v === ''; };
