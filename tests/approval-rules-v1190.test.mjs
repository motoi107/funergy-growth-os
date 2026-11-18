// v1190：承認・閲覧の共通ルール（Moto さんの依頼 11/17・UI案93）。仕様：docs/APPROVAL_RULES_JA.md
// 本物の SQL（申請の本番の順＋20261209090000・PGlite）と本物の handler、合成データだけ。PIN の確かめは代わり（'pin-E7' は社員 E7）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, AR, ROLLBACK, KINDS16, G, C, AMm, STAGE, ALLS } from './approval-rules-world.mjs';

test('v1190 installing changes nothing: roles come from the employee master and accounts, drafts follow the answers, the switch is off, the old GM proxy still works', async () => {
  const s = await setup({ twice: true });
  const w = await s.ok('E8', { action: 'whoami' });
  assert.equal(w.fn, 13); assert.equal(w.sql, 8); assert.equal(w.ar.live, false); assert.equal(w.ar.admin, false);
  assert.equal((await s.ok('E2', { action: 'whoami' })).ar.admin, true);
  assert.deepEqual((await s.ok('E5', { action: 'whoami' })).ar.roles, ['am']);
  const rl = await s.ok('E2', { action: 'ar_role_list' });
  const got = rl.people.flatMap(p => p.roles.map(r => [p.emp, r.role, r.stores.join(',')])).sort();
  assert.deepEqual(got, [['E1', 'ceo', ''], ['E10', 'am', 'S3'], ['E11', 'chef', ''], ['E2', 'gm', ''], ['E3', 'acct_mgr', ''], ['E4', 'office_crew', ''], ['E5', 'am', 'S1']].sort());
  assert.deepEqual(rl.wait.map(x => [x.emp, x.role, x.why]), [['E12', 'acct_lead', 'account']], 'the title alone does not give the accounting role');
  assert.equal((await s.q(`select count(*)::int n from pg_class where relname in ('ar_roles','ar_role_log')`))[0].n, 0, 'no separate role table (1B)');
  const st = await s.state();
  assert.equal(st.kinds.length, 16); assert.ok(st.kinds.every(k => k.draft && !k.active)); assert.equal(st.ready, false); assert.equal(st.live, false);
  const hire = st.kinds.find(k => k.kind === 'hire').draft.def;
  assert.equal(hire.default.stages.length, 1, '2B: GM・CEO only'); assert.equal(hire.branches, undefined); assert.equal(hire.self, 'gm');
  assert.deepEqual(hire.viewers.map(v => v.who.role), ['am', 'acct_mgr', 'acct_lead', 'office_crew']);
  assert.deepEqual(st.kinds.find(k => k.kind === 'leave').draft.def.default.stages[0].slots.map(x => x.role), ['am', 'gm', 'ceo']);
  for (const who of ['E5', 'E3', 'E4', 'E6']) assert.equal((await s.call(who, { action: 'ar_state' })).status, 403, who);
  for (const who of ['E5', 'E3']) assert.equal((await s.call(who, { action: 'ar_role_list' })).status, 403, who);
  // 社員の表だけで AM・Head Chef にしても役割は付かない（GM・CEO が確かめるまで）
  await s.q(`update employees set role = 'am', title = 'Area Manager' where id = 'E14'`);
  await s.q(`update stores set am = 'Pat Two' where id = 'S2'`);
  const rl2 = await s.ok('E2', { action: 'ar_role_list' });
  assert.ok(!rl2.people.some(p => p.emp === 'E14' && p.roles.some(r => r.role === 'am')), 'not an AM until confirmed');
  assert.ok(rl2.wait.some(x => x.emp === 'E14' && x.role === 'am' && x.why === 'confirm'), JSON.stringify(rl2.wait));
  assert.deepEqual((await s.ok('E14', { action: 'whoami' })).ar.roles ?? [], []);
  // 確かめた店と今の店の重なりだけ（社員の表で店を足しても広がらない）
  await s.q(`update stores set am = 'Ami Area' where id = 'S3'`);
  assert.deepEqual((await s.ok('E2', { action: 'ar_role_list' })).people.find(p => p.emp === 'E5').roles.map(r => r.stores), [['S1']]);
  await s.q(`update stores set am = 'Bea Area' where id = 'S3'`);
  assert.equal((await s.call('E2', { action: 'ar_role_save', emp: 'E8', role: 'am' })).status, 400, 'roles are not edited here (1B)');
  // スイッチが切れているあいだは今までどおり：GM が AM の段も代わりに承認する
  const r = await s.subOk('E8', 'hire', 'S1');
  assert.equal(r.route, undefined); assert.equal(r.step, 'am');
  const a = await s.approve('E2', r);
  assert.equal(a.status, 200); assert.equal(a.body.status, 'approved', 'the old proxy approval still works while the switch is off');
  assert.equal((await s.q(`select count(*)::int n from wr_requests where route is not null`))[0].n, 0);
});

test('v1190 going live needs every kind active; pending requests get a route and keep the AM approval they already have', async () => {
  const s = await setup();
  const r1 = await s.subOk('E8', 'hire', 'S1');
  const a1 = await s.approve('E5', r1); assert.equal(a1.body.status, 'pending'); assert.equal(a1.body.step, 'gm');
  const r2 = await s.subOk('E8', 'leave', 'S1');
  const r3 = await s.subOk('E8', 'shift', 'S1'); await s.approve('E5', r3);
  await s.activate(KINDS16.filter(k => !['plan', 'shift'].includes(k)));
  // シフト変更は AM → GM の 2 段のルールのまま使う（AM の承認を写す）
  await s.setRule('shift', { branches: [{ label: 'AM あり', when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] }, self: 'gm' });
  const st = await s.state(); assert.equal(st.ready, false);
  assert.equal((await s.call('E2', { action: 'ar_go_live', expect_rev: st.rev })).body.error, 'rules_missing');
  assert.equal((await s.call('E5', { action: 'ar_go_live', expect_rev: st.rev })).status, 403);
  await s.activate(['plan']);
  const on = await s.live();
  assert.equal(on.live, true); assert.equal(on.attached, 3); assert.deepEqual(on.blocked, []);
  const f1 = await s.fresh(r1);
  assert.equal(f1.route.label, 'GM・CEO'); assert.equal(f1.route.cur, 1); assert.equal(f1.route.stages.length, 1, '2B');
  const f3 = await s.fresh(r3);
  assert.equal(f3.route.cur, 2, 'the AM approval from before is kept (stage 1 done)');
  assert.equal(f3.route.stages[0].signs[0].via, 'copied'); assert.equal(f3.route.stages[0].signs[0].name, 'Ami Area');
  const f2 = await s.fresh(r2); assert.equal(f2.route.cur, 1); assert.equal(f2.route.label, '担当 AM・GM・CEO の誰か');
  assert.equal((await s.ok('E8', { action: 'whoami' })).ar.live, true);
  assert.equal((await s.approve('E2', f1)).body.status, 'approved');
  assert.equal((await s.approve('E2', f3)).body.status, 'approved');
  assert.equal((await s.call('E2', { action: 'ar_go_live', expect_rev: (await s.state()).rev })).status, 409);
});

test('v1190 live routes: GM・CEO one stage (2B) with the AM as a viewer; leave by the AM or GM・CEO; a two-stage rule never lets the GM sign the AM stage', async () => {
  const s = await setup(); await s.activate(); await s.live();
  const h = await s.subOk('E8', 'hire', 'S1');
  assert.equal(h.route.label, 'GM・CEO'); assert.equal(h.route.stages.length, 1);
  const am = await s.get('E5', h); assert.equal(am.status, 200, 'the AM sees it as a viewer'); assert.ok(!am.body.can.includes('approve'));
  assert.equal((await s.get('E10', h)).status, 404, 'not the AM of another store');
  assert.equal((await s.get('E3', h)).status, 200, 'accounting sees it from the start (viewer)');
  const g = await s.approve('E2', h); assert.equal(g.body.status, 'approved'); assert.ok(g.body.route.final);
  const lv = await s.subOk('E8', 'leave', 'S1');
  assert.equal((await s.approve('E5', lv)).body.status, 'approved');
  const lv2 = await s.subOk('E9', 'leave', 'S2');
  assert.equal((await s.approve('E1', lv2)).body.status, 'approved', 'no AM at S2: GM・CEO');
  await s.setRule('hire', { branches: [{ label: '店に AM がいる', when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] }, self: 'gm' });
  const h2 = await s.subOk('E8', 'hire', 'S1');
  const gmRow = await s.fresh(h2);
  assert.ok(!gmRow.can.includes('approve'), 'the GM cannot approve the AM stage');
  assert.ok(gmRow.can.includes('reject'), 'the GM can still reject');
  assert.equal((await s.act('E2', gmRow, 'approve')).status, 403);
  const a = await s.approve('E5', h2); assert.equal(a.body.status, 'pending'); assert.equal(a.body.route.cur, 2); assert.equal(a.body.step, 'gm');
  const g2 = await s.approve('E2', h2); assert.equal(g2.body.status, 'approved');
  const ev = (await s.fresh(h2)).events.filter(e => e.action === 'approve');
  assert.deepEqual(ev.map(e => [e.by, e.detail.stage]), [['Ami Area', 1], ['Gabe GM', 2]]);
  const h3 = await s.subOk('E9', 'hire', 'S2'); assert.equal(h3.route.stages.length, 1);
});

test('v1190 own requests: the GM may approve their own (answer 3); others never; self → CEO or stuck', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('hire', { branches: [{ when: { stores: ['S1'] }, stages: [STAGE(AMm, G)] }], default: { stages: [STAGE(G, C)] }, self: 'gm' });
  const own = await s.subOk('E5', 'hire', 'S1');
  assert.ok(!(await s.call('E5', { action: 'get', id: own.id })).body.can.includes('approve'), 'the AM does not approve their own');
  assert.deepEqual(own.route.stages[0].slots.map(x => x.names), [['Cora CEO'], ['Gabe GM']], 'the CEO covers the AM slot of the AM\'s own request');
  const g = await s.subOk('E2', 'budget', 'S1');
  const gr = await s.fresh(g); assert.ok(gr.can.includes('approve'), 'the GM can approve their own budget');
  const ga = await s.act('E2', gr, 'approve'); assert.equal(ga.body.status, 'approved'); assert.equal(ga.body.route.stages[0].signs[0].via, 'own');
  const c = await s.subOk('E1', 'budget', 'S1');
  assert.ok(!(await s.call('E1', { action: 'get', id: c.id })).body.can.includes('approve'), 'the CEO does not approve their own');
  assert.equal((await s.approve('E2', c)).body.status, 'approved');
  const AM_S1 = self => ({ branches: [{ when: { stores: ['S1'] }, stages: [STAGE(AMm)] }], default: { stages: [STAGE(G, C)] }, self });
  await s.setRule('resign', { branches: [{ label: 'AM あり', when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { label: 'GM・CEO', stages: [STAGE(G, C)] } });
  const viaHasAm = await s.subOk('E5', 'resign', 'S1');
  assert.equal(viaHasAm.route.label, 'GM・CEO', 'has_am does not count the requester: the AM\'s own request goes to GM・CEO (as before)');
  await s.setRule('shift', AM_S1('gm'));
  const sh = await s.subOk('E5', 'shift', 'S1');
  assert.deepEqual(sh.route.stages[0].slots[0].names, ['Cora CEO'], 'the requester is the only AM → CEO');
  assert.equal((await s.approve('E2', sh)).status, 403, 'not the GM');
  const cc = await s.approve('E1', sh); assert.equal(cc.body.status, 'approved'); assert.equal(cc.body.route.stages[0].signs[0].via, 'self_ceo');
  await s.setRule('budget', { default: { stages: [STAGE(G, C)] }, self: 'ceo' });
  const g2 = await s.fresh(await s.subOk('E2', 'budget', 'S1', { ym: '2027-01', days: { '2027-01-01': 100, '2027-01-02': 100 } }));
  assert.ok(!g2.can.includes('approve'), 'self: ceo → the GM does not approve their own');
  await s.setRule('shift', AM_S1('block'));
  const sh2 = await s.subOk('E5', 'shift', 'S1');
  assert.equal(sh2.route.stuck, true, 'self: block → stuck, not skipped');
  assert.equal((await s.approve('E1', sh2)).status, 403);
});

test('v1190 one person with two roles signs once per stage; in an "all" stage they take the slot nobody else can fill; another stage is fine (7B)', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.q(`insert into wr_exp_grants(emp_id, crew) values ('E3', true)`);   // E3：経理マネージャー（アカウント）＋事務Crew（GM・CEO が確かめた）
  assert.deepEqual((await s.ok('E2', { action: 'ar_role_list' })).people.find(p => p.emp === 'E3').roles.map(r => [r.role, r.src]), [['acct_mgr', 'account'], ['office_crew', 'confirmed']]);
  const ALL2 = ALLS({ t: 'role', role: 'office_crew', scope: 'all' }, { t: 'role', role: 'acct_mgr', scope: 'all' });
  await s.setRule('shift', { default: { stages: [ALL2] } });
  const r = await s.subOk('E6', 'shift', 'S1');
  const a = await s.approve('E3', r);
  assert.equal(a.body.status, 'pending');
  assert.equal(a.body.route.stages[0].signs[0].k, '2', 'E3 fills the manager slot (only E3 can), leaving the office crew slot for E4');
  assert.equal((await s.approve('E3', r)).status, 403, 'E3 does not fill a second slot in the same stage');
  assert.equal((await s.approve('E4', r)).body.status, 'approved');
  // 7B：段が違えば同じ人でよい
  await s.setRule('plan', { default: { stages: [STAGE(G), STAGE(G, C)] } });
  const pl = await s.subOk('E6', 'plan', 'S1');
  assert.equal((await s.approve('E2', pl)).body.route.cur, 2);
  assert.equal((await s.approve('E2', pl)).body.status, 'approved', 'the GM signs both stages');
  // E4 がいないと止まる（同じ 1 人が 2 枠を埋めない）・設定の確かめが知らせる
  await s.q(`delete from manager_auth where emp_id = 'E4'`);
  const r2 = await s.subOk('E6', 'shift', 'S1');
  const a2 = await s.approve('E3', r2); assert.equal(a2.body.status, 'pending'); assert.equal(a2.body.route.stuck, true);
  const sv = await s.saveRule('shift', { default: { stages: [ALL2] } });
  assert.ok(sv.body.check.errors.some(e => e.code === 'same_person'), JSON.stringify(sv.body.check));
  assert.equal((await s.call('E2', { action: 'ar_rule_activate', kind: 'shift', expect_ver: sv.body.draft.ver, expect_rev: sv.body.draft.rev, note: 'x' })).body.error, 'rule_invalid');
});

test('v1190 retirement, suspension and role changes are read at approval time: the stage stops, never auto-skips; a delegate or an exception fixes it', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('leave', { branches: [{ when: { has_am: true }, stages: [STAGE(AMm)] }], default: { stages: [STAGE(G, C)] }, self: 'gm' });
  const lv = await s.subOk('E8', 'leave', 'S1');
  // 社員の表で AM でなくなる → 役割が無くなる → 止まる
  await s.q(`update employees set role = 'sl', title = 'Store Manager' where id = 'E5'`);
  let f = await s.fresh(lv); assert.equal(f.route.stuck, true); assert.ok(!f.can.includes('approve'));
  assert.equal((await s.approve('E5', lv)).status, 403, 'no longer an approver (still sees it as a store G4+)');
  const stuck = await s.ok('E2', { action: 'ar_stuck' }); assert.deepEqual(stuck.rows.map(x => x.id), [lv.id]);
  assert.equal(f.next.stuck, true);
  await s.q(`update employees set role = 'am', title = 'Area Manager' where id = 'E5'`);
  assert.ok(!(await s.fresh(lv)).route.stuck, 'back');
  const end = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  assert.equal((await s.call('E2', { action: 'ar_delegate_save', from: 'E5', to: 'E6', kinds: ['leave'], stores: [], starts: s.today, ends: end })).body.error, 'reason_required');
  const dg = await s.ok('E2', { action: 'ar_delegate_save', from: 'E5', to: 'E6', kinds: ['leave'], stores: [], starts: s.today, ends: end, note: '休暇' });
  assert.equal((await s.call('E5', { action: 'ar_delegate_save', from: 'E5', to: 'E7', kinds: [], stores: [], starts: s.today, ends: end, note: 'x' })).status, 403);
  assert.equal((await s.call('E2', { action: 'ar_delegate_save', from: 'E6', to: 'E5', kinds: [], stores: [], starts: s.today, ends: end, note: 'x' })).body.error, 'delegate_cycle');
  const d1 = await s.approve('E6', lv);
  assert.equal(d1.body.status, 'approved'); assert.equal(d1.body.route.stages[0].signs[0].via, 'delegate'); assert.equal(d1.body.route.stages[0].signs[0].for_name, 'Ami Area');
  await s.ok('E2', { action: 'ar_delegate_end', id: dg.id, note: '戻った' });
  const lv2 = await s.subOk('E8', 'leave', 'S1');
  assert.equal((await s.approve('E6', lv2)).status, 403, 'the delegate ended (E6 still sees it as the store manager)');
  await s.retire('E5');
  f = await s.fresh(lv2); assert.equal(f.route.stuck, true);
  await s.q(`update employees set status = '退職', data = data || '{"status":"退職"}' where id = 'E1'`);   // アカウントは残ったまま退職
  const h9 = await s.subOk('E9', 'hire', 'S2');
  assert.deepEqual(h9.route.stages[0].slots.map(x => x.names), [['Gabe GM'], undefined], 'a retired CEO is not an approver even with the account left');
  await s.q(`update employees set status = '在籍', data = data || '{"status":"在籍"}' where id = 'E1'`);
  assert.equal((await s.call('E2', { action: 'ar_exception', id: lv2.id, op: 'set_stage', stage: 1, def: STAGE(G), expect_rev: f.rev })).body.error, 'reason_required');
  assert.equal((await s.call('E6', { action: 'ar_exception', id: lv2.id, op: 'set_stage', stage: 1, def: STAGE(G), expect_rev: f.rev, note: 'x' })).status, 403);
  const ex = await s.ok('E1', { action: 'ar_exception', id: lv2.id, op: 'set_stage', stage: 1, def: STAGE(G), expect_rev: f.rev, note: 'AM が退職' });
  assert.ok(!ex.route.stuck); assert.equal(ex.route.ex[0].op, 'set_stage'); assert.equal(ex.route.ex[0].note, 'AM が退職');
  assert.ok(ex.route.ex[0].before && ex.route.ex[0].after);
  assert.equal((await s.approve('E2', lv2)).body.status, 'approved');
  assert.ok((await s.fresh(lv2)).events.some(e => e.action === 'route_exception' && e.note === 'AM が退職'));
});

test('v1190 exceptions are one request only, CEO/GM, not on their own request, never on a finished stage, and cannot leave a stage with nobody', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('hire', { branches: [{ when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] } });
  const h = await s.subOk('E8', 'hire', 'S1');
  await s.approve('E5', h);
  let f = await s.fresh(h);
  assert.equal((await s.call('E2', { action: 'ar_exception', id: h.id, op: 'set_stage', stage: 1, def: STAGE(G), expect_rev: f.rev, note: 'x' })).status, 400, 'stage 1 is done');
  assert.equal((await s.call('E2', { action: 'ar_exception', id: h.id, op: 'set_stage', stage: 2, def: STAGE({ t: 'role', role: 'acct_lead', scope: 'all' }), expect_rev: f.rev, note: 'x' })).body.error, 'no_approver', 'nobody holds the role');
  assert.equal((await s.call('E2', { action: 'ar_exception', id: h.id, op: 'remove_stage', stage: 2, expect_rev: f.rev, note: 'x' })).status, 400, 'the last open stage stays');
  assert.equal((await s.call('E2', { action: 'ar_exception', id: h.id, op: 'add_stage', stage: 2, def: STAGE({ t: 'emp', emp: 'E11' }), expect_rev: f.rev - 1, note: 'x' })).status, 409, 'old screen');
  const x = await s.ok('E2', { action: 'ar_exception', id: h.id, op: 'add_stage', stage: 2, def: STAGE({ t: 'emp', emp: 'E11' }), expect_rev: f.rev, note: '料理の確認' });
  assert.equal(x.route.stages.length, 3); assert.equal(x.route.cur, 2); assert.deepEqual(x.route.stages[1].slots[0].names, ['Hal Head']);
  assert.equal((await s.approve('E2', h)).status, 403, 'the GM stage moved to 3');
  assert.equal((await s.approve('E11', h)).body.route.cur, 3);
  f = await s.fresh(h);
  const v = await s.ok('E2', { action: 'ar_exception', id: h.id, op: 'add_viewer', who: { t: 'emp', emp: 'E13' }, from: 'submit', expect_rev: f.rev, note: '共有' });
  assert.equal(v.route.viewers.length, 1);
  assert.equal((await s.get('E13', h)).status, 200, 'the added viewer sees it');
  assert.ok(!(await s.get('E13', h)).body.can.includes('approve'));
  const own = await s.subOk('E2', 'budget', 'S1');
  assert.equal((await s.call('E2', { action: 'ar_exception', id: own.id, op: 'set_stage', stage: 1, def: STAGE(C), expect_rev: own.rev, note: 'x' })).status, 403, 'not on their own request');
});

test('v1190 a new version applies to new requests only; applying it to pending ones is explicit and keeps the same leading stages', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('hire', { branches: [{ label: 'AM', when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] } });
  const old1 = await s.subOk('E8', 'hire', 'S1'); await s.approve('E5', old1);
  const old2 = await s.subOk('E8', 'hire', 'S1');
  await s.setRule('hire', { branches: [{ label: 'AM', when: { has_am: true }, stages: [STAGE(AMm), STAGE({ t: 'role', role: 'chef', scope: 'all' }), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] },
    viewers: [{ who: AMm, from: 'submit' }] });
  const n = await s.subOk('E8', 'hire', 'S1'); assert.equal(n.route.rule.ver, 3); assert.equal(n.route.stages.length, 3);
  assert.equal((await s.fresh(old1)).route.rule.ver, 2, 'pending requests keep their version');
  const st = await s.state(); assert.equal(st.kinds.find(k => k.kind === 'hire').old_routes, 2);
  const pv = await s.ok('E2', { action: 'ar_apply_preview', kind: 'hire' });
  assert.deepEqual(pv.rows.map(r => r.keep).sort(), [0, 1]);
  const f1 = await s.fresh(old1), f2 = await s.fresh(old2);
  assert.equal((await s.call('E2', { action: 'ar_apply', kind: 'hire', ver: pv.ver, items: [{ id: f1.id, rev: f1.rev }] })).body.error, 'reason_required');
  const ap = await s.ok('E2', { action: 'ar_apply', kind: 'hire', ver: pv.ver, items: [{ id: f1.id, rev: f1.rev }, { id: f2.id, rev: f2.rev + 5 }], note: '料理の段を足した' });
  assert.deepEqual(ap.results.map(r => r.outcome), ['applied', 'stale']);
  const g1 = await s.fresh(old1);
  assert.equal(g1.route.rule.ver, 3); assert.equal(g1.route.cur, 2, 'the AM approval is kept (same stage)'); assert.equal(g1.route.stages[0].signs[0].name, 'Ami Area');
  assert.ok(g1.route.ex.some(e => e.op === 'apply' && e.from_ver === 2 && e.to_ver === 3));
  assert.equal((await s.approve('E2', old1)).status, 403, 'the chef stage comes first now');
  assert.equal((await s.fresh(old2)).route.rule.ver, 2, 'not applied (stale)');
});

test('v1190 changing the content picks the route again with the same version and takes the approvals again', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('reimburse', { branches: [{ label: '$500 以上', when: { min_cents: 50000 }, stages: [STAGE(G), STAGE(C)] }], default: { stages: [STAGE(G, C)] } });
  const r = await s.subOk('E6', 'reimburse', 'S1', { amount_cents: 60000 });
  assert.equal(r.route.label, '$500 以上');
  const a = await s.approve('E2', r); assert.equal(a.body.route.cur, 2);
  // 本人が金額を直す（承認待ちのあいだの直し）→ 同じ版で選び直し・承認は取り直し
  const f = await s.call('E6', { action: 'get', id: r.id });
  const e = await s.call('E6', { action: 'act', id: r.id, op: 'edit', kind: 'reimburse', expect_rev: f.body.rev, client_key: s.key(),
    payload: { date: s.today, payer: 'x', vendor: 'Costco', purpose: 'その他', amount_cents: 7000 } });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.route.label, '既定'); assert.equal(e.body.route.cur, 1);
  assert.equal(e.body.route.stages[0].signs.length, 0);
  assert.equal(e.body.route.rule.ver, (await s.fresh(r)).route.rule.ver);
  assert.equal((await s.approve('E2', r)).body.status, 'approved');
});

test('v1190 GM bulk approval: only the GM stage, per-case results, the same operation sent again gives the same results, no proxy', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('hire', { branches: [{ when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] } });
  await s.setRule('plan', { default: { stages: [STAGE(G, C)] }, self: 'ceo' });
  const amStage = await s.subOk('E8', 'hire', 'S1');                         // AM の段
  const gmStage = await s.subOk('E8', 'hire', 'S1'); await s.approve('E5', gmStage);   // GM の段
  const budget = await s.subOk('E9', 'shift', 'S2');                          // GM の段（1 段）
  const stale = await s.subOk('E9', 'hire', 'S2');
  const own = await s.subOk('E2', 'plan', 'S2');                              // 自分の申請（self: ceo）
  const ownGm = await s.subOk('E2', 'budget', 'S2');                          // 自分の申請（self: gm＝答え 3）
  const fs_ = await Promise.all([amStage, gmStage, budget, stale, own, ownGm].map(s.fresh));
  const items = fs_.map((r, i) => ({ id: r.id, rev: i === 3 ? r.rev + 7 : r.rev }));
  assert.equal((await s.call('E5', { action: 'bulk_approve', items, client_key: 'bulk-0001' })).status, 403, 'not an AM');
  const b = await s.ok('E2', { action: 'bulk_approve', items, client_key: 'bulk-0001' });
  assert.deepEqual(b.results.map(r => [r.outcome, r.reason || '']), [['skip', 'not_your_stage'], ['final', ''], ['final', ''], ['skip', 'stale'], ['skip', 'own'], ['final', '']]);
  assert.deepEqual(b.counts, { final: 3, next: 0, skip: 3, failed: 0 });
  assert.equal((await s.fresh(amStage)).route.cur, 1, 'the AM stage was not signed by the GM');
  assert.equal((await s.fresh(amStage)).status, 'pending');
  const again = await s.ok('E2', { action: 'bulk_approve', items, client_key: 'bulk-0001' });
  assert.equal(again.replay, true); assert.deepEqual(again.results, b.results);
  assert.equal((await s.call('E2', { action: 'bulk_approve', items: items.slice(0, 2), client_key: 'bulk-0001' })).status, 409, 'the same number with other items');
  assert.equal((await s.call('E1', { action: 'bulk_approve', items, client_key: 'bulk-0001' })).status, 409, 'another person');
  const ev = (await s.fresh(gmStage)).events.find(e => e.action === 'approve' && e.by === 'Gabe GM');
  assert.equal(ev.bulk, 'bulk-0001');
  const sg = (await s.fresh(budget)).route.stages[0].signs[0]; assert.equal(sg.bulk, 'bulk-0001');
  await s.setRule('shift', { default: { stages: [STAGE(G), STAGE(C)] } });
  const two = await s.fresh(await s.subOk('E13', 'shift', 'S3'));
  const b2 = await s.ok('E2', { action: 'bulk_approve', items: [{ id: two.id, rev: two.rev }], client_key: 'bulk-0002' });
  assert.equal(b2.results[0].outcome, 'next'); assert.equal(b2.results[0].next.stage, 2);
  assert.equal((await s.call('E2', { action: 'bulk_approve', items: [{ id: two.id, rev: two.rev }, { id: two.id, rev: two.rev }], client_key: 'bulk-0003' })).status, 400, 'twice in one list');
});

test('v1190 bulk approval while the switch is off: the GM does not sign an AM step either', async () => {
  const s = await setup();
  const amStep = await s.fresh(await s.subOk('E8', 'hire', 'S1'));
  const gmStep = await s.subOk('E8', 'hire', 'S1'); await s.approve('E5', gmStep);
  const g = await s.fresh(gmStep);
  const b = await s.ok('E2', { action: 'bulk_approve', items: [{ id: amStep.id, rev: amStep.rev }, { id: g.id, rev: g.rev }], client_key: 'bulk-off-01' });
  assert.deepEqual(b.results.map(r => r.outcome), ['skip', 'final']);
  assert.equal(b.results[0].reason, 'not_your_stage');
  assert.equal((await s.fresh(amStep)).step, 'am');
});

test('v1190 who can see: requester, CEO/GM, store G4+, approvers up to the current stage, viewers by timing, accounting after the final approval', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('hire', { branches: [{ when: { has_am: true }, stages: [STAGE(AMm), STAGE(G, C)] }], default: { stages: [STAGE(G, C)] },
    viewers: [{ who: { t: 'emp', emp: 'E14' }, from: 'stage:2' }, { who: { t: 'emp', emp: 'E7' }, from: 'final' }] });
  const h = await s.subOk('E8', 'hire', 'S1');
  const see = async who => (await s.get(who, h)).status === 200;
  const names = ['E8', 'E1', 'E2', 'E6', 'E5', 'E10', 'E14', 'E7', 'E3', 'E4', 'E13'];
  assert.deepEqual(Object.fromEntries(await Promise.all(names.map(async n => [n, await see(n)]))),
    { E8: true, E1: true, E2: true, E6: true, E5: true, E10: false, E14: false, E7: false, E3: false, E4: false, E13: false });
  await s.approve('E5', h);
  assert.equal(await see('E14'), true, 'from stage 2'); assert.equal(await see('E7'), false); assert.equal(await see('E3'), false, 'accounting waits for the final approval');
  await s.approve('E2', h);
  assert.equal(await see('E7'), true); assert.equal(await see('E3'), true); assert.equal(await see('E4'), true);
  const list = async who => (await s.ok(who, { action: 'list', scope: 'team', state: 'all' })).rows.map(r => r.id);
  assert.ok((await list('E7')).includes(h.id)); assert.ok(!(await list('E10')).includes(h.id));
  await s.setRule('shift', { default: { stages: [STAGE(G), STAGE({ t: 'emp', emp: 'E13' })] } });
  const sh = await s.subOk('E8', 'shift', 'S1');
  assert.equal((await s.get('E13', sh)).status, 404);
  await s.approve('E2', sh);
  assert.equal((await s.get('E13', sh)).status, 200);
  assert.equal((await s.approve('E13', sh)).body.status, 'approved');
});

test('v1190 rules: shape and content are checked, preview shows names, only CEO/GM, old screens conflict', async () => {
  const s = await setup();
  assert.equal((await s.saveRule('plan', { default: { stages: [] } })).body.error, 'rule_invalid');
  assert.equal((await s.saveRule('plan', { default: { stages: [STAGE({ t: 'role', role: 'boss', scope: 'all' })] } })).body.error, 'rule_invalid');
  assert.equal((await s.saveRule('plan', { default: { stages: [STAGE(G)] }, extra: 1 })).body.error, 'rule_invalid');
  assert.equal((await s.saveRule('plan', { default: { stages: [STAGE(G)] }, self: 'anyone' })).body.error, 'rule_invalid');
  const v = await s.saveRule('plan', { branches: [{ label: 'A', when: { stores: ['S1'] }, stages: [STAGE({ t: 'role', role: 'office_crew', scope: 'stores', stores: ['S2'] })] },
    { label: 'B', when: { stores: ['S1'] }, stages: [STAGE(G)] }], default: { stages: [ALLS(G, { t: 'emp', emp: 'E2' })] } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const codes = v.body.check.errors.map(e => e.code).sort();
  assert.ok(codes.includes('unreachable') && codes.includes('same_person'), JSON.stringify(v.body.check));
  assert.equal((await s.call('E2', { action: 'ar_rule_activate', kind: 'plan', expect_ver: v.body.draft.ver, expect_rev: v.body.draft.rev, note: 'x' })).body.error, 'rule_invalid');
  assert.equal((await s.call('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: v.body.draft.ver, expect_rev: v.body.draft.rev - 1, base_ver: 0 })).status, 409);
  assert.equal((await s.call('E5', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: v.body.draft.ver, expect_rev: v.body.draft.rev, base_ver: 0 })).status, 403);
  const ok7 = await s.saveRule('plan', { default: { stages: [STAGE(G), STAGE(G, C)] } });
  assert.deepEqual(ok7.body.check.errors, [], '7B: the same person in two stages is fine');
  const p = await s.ok('E2', { action: 'ar_rule_preview', kind: 'leave', store_id: 'S1', requester: 'E8' });
  assert.deepEqual(p.route.stages[0].slots.map(x => x.names), [['Ami Area'], ['Gabe GM'], ['Cora CEO']]); assert.equal(p.requester_name, 'Cam Crew');
  const p2 = await s.ok('E2', { action: 'ar_rule_preview', kind: 'leave', store_id: 'S1', requester: 'E5' });
  assert.deepEqual(p2.route.stages[0].slots[0].names, ['Cora CEO'], 'the requester is not an approver of their own: the CEO covers');
  const p3 = await s.ok('E2', { action: 'ar_rule_preview', kind: 'plan', def: { branches: [{ when: { hq: true }, stages: [STAGE(G)] }], default: { block: true } }, store_id: 'S1' });
  assert.equal(p3.blocked, true);
  assert.equal((await s.call('E2', { action: 'ar_rule_preview', kind: 'nope' })).status, 400);
  const ph = await s.ok('E2', { action: 'ar_rule_preview', kind: 'hire', store_id: 'S1', requester: 'E8' });
  assert.ok(ph.viewers.some(x => x.names.includes('Ami Area')) && ph.viewers.some(x => x.names.includes('Ann Acct')));
});

test('v1190 a request with no matching branch and a blocked default cannot be sent; turning the switch off goes back to the old rules', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('plan', { branches: [{ when: { hq: true }, stages: [STAGE(G)] }], default: { block: true } });
  const r = await s.sub('E6', 'plan', 'S1');
  assert.equal(r.status, 409); assert.equal(r.body.error, 'no_route');
  assert.equal((await s.sub('E2', 'plan', '---')).status, 200);
  const h = await s.subOk('E8', 'hire', 'S1');
  const st = await s.state();
  assert.equal((await s.call('E2', { action: 'ar_go_off', expect_rev: st.rev })).body.error, 'reason_required');
  await s.ok('E2', { action: 'ar_go_off', expect_rev: st.rev, note: '戻す' });
  const f = await s.fresh(h);
  assert.equal(f.route, undefined, 'the old rules again');
  assert.deepEqual(await s.q(`select route from wr_requests where id = $1`, [h.id]), [{ route: null }], 'the route is taken off (not left to come back stale)');
  assert.ok(f.events.some(e => e.action === 'route_stop' && e.note === '戻す'));
  assert.ok(f.can.includes('approve'), 'the old GM proxy is back');
  assert.equal((await s.approve('E2', h)).body.status, 'approved');
});

test('v1190 rollback SQL restores the old functions and keeps the records', async () => {
  const s = await setup(); await s.activate(); await s.live();
  const done = await s.subOk('E6', 'budget', 'S1'); await s.approve('E2', done);
  const h = await s.subOk('E8', 'hire', 'S1');
  await s.pg.exec('reset role'); await s.pg.exec(ROLLBACK); await s.pg.exec(ROLLBACK); await s.pg.exec('set role service_role');
  const w = await s.ok('E2', { action: 'whoami' });
  assert.equal(w.sql, 7); assert.equal(w.ar, undefined);
  const f = await s.fresh(h); assert.equal(f.route, undefined); assert.ok(f.can.includes('approve'));
  assert.ok(f.events.some(e => e.action === 'route_stop'), 'the route is kept in the history');
  assert.equal((await s.approve('E2', f)).body.status, 'approved');
  const n = await s.q(`select (select count(*)::int from ar_rules) r, (select count(*)::int from wr_requests where route is not null) q, (select live from ar_settings) l`);
  assert.ok(n[0].r >= 16 && n[0].q >= 1, 'records kept'); assert.equal(n[0].l, false);
  assert.equal((await s.q(`select count(*)::int n from pg_trigger where tgname = 'ar_route_trg'`))[0].n, 0);
  const h2 = await s.subOk('E8', 'hire', 'S1'); assert.equal(h2.route, undefined);
  await s.pg.exec('reset role'); await s.pg.exec(AR); await s.pg.exec('set role service_role');
  assert.equal((await s.state()).live, false, 'stays on the old rules until CEO/GM turn it on again');
  const on = await s.live(); assert.equal(on.attached, 1);
  assert.equal((await s.fresh(h2)).route.label, 'GM・CEO');
});

test('v1190 every new function and wrapper is callable only with the server key', async () => {
  const s = await setup();
  const rows = await s.q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
    has_function_privilege('service_role', p.oid, 'execute') sr, p.prosecdef d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'ar\\_%' or p.proname like 'wr\\_%\\_v0'
      or p.proname in ('wr_visible','wr_actions','wr_next','wr_row','wr_act','wr_get','wr_whoami','wr_stage'))`);
  assert.ok(rows.length > 60, rows.length);
  for (const r of rows) { assert.equal(r.a, false, r.proname); assert.equal(r.u, false, r.proname); assert.equal(r.sr, true, r.proname); assert.equal(r.d, false, r.proname); }
  const t = await s.q(`select c.relname, c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'select') a from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'ar\\_%' and c.relkind = 'r'`);
  assert.equal(t.length, 4); for (const r of t) { assert.equal(r.rls, true, r.relname); assert.equal(r.a, false, r.relname); }
});
