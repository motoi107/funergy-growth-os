// v1190 の直し（PR #192 の Codex のレビュー 6972640225・66608b3 の再レビューの 3 件）。本物の SQL（PGlite）と本物の handler、合成データだけ。
// 1. 捨てた下書きを消さずに discarded で残す → 下書きを作り直しても版の番号が変わり、古い画面の版と回数では当たらない（保存・有効化・捨てる）
// 2. 「全員」の段は、枠に別々の人を 1 人ずつ当てられるかで確かめる（「役割の全員」を 1 人ずつに分けた枠と名前の枠が同じ 1 人・CEO に回る枠が 2 つ）。
//    兼任の人は、残りの枠をほかの人で埋められる枠を取る
// 3. 「全員」の段でほかの枠が残るとき、承認しても段は進まない → 画面に「この段のほかの承認を待つ」（my.after = same）、一括承認の結果は stage
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, G, C, STAGE, ALLS } from './approval-rules-world.mjs';

test('v1190 PR #192 fix 1: a discarded draft keeps its version number — an old screen cannot save, activate or discard the draft made after it', async () => {
  const s = await setup();
  const st0 = await s.state();
  const seen = st0.kinds.find(k => k.kind === 'plan').draft;              // 画面 A が見た下書き（GM の 1 段）
  assert.ok(seen && seen.ver >= 1);
  // 画面 B：捨てて、別の中身（CEO の 1 段）で作り直す
  await s.ok('E1', { action: 'ar_rule_discard', kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev });
  const st1 = await s.state(); const k1 = st1.kinds.find(k => k.kind === 'plan');
  assert.equal(k1.draft, undefined, 'no draft after discarding');
  assert.deepEqual(k1.history.map(h => [h.ver, h.status]), [[seen.ver, 'discarded']], 'the discarded draft stays in the history');
  const re = await s.ok('E1', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(C)] } }, expect_ver: 0, expect_rev: 0, base_ver: 0, note: '作り直し' });
  assert.equal(re.draft.ver, seen.ver + 1, 'the new draft gets a new version number (before: the same number and count again)');
  assert.ok(re.draft.rev > seen.rev && re.draft.rev > 1000000, 'and a count no earlier draft of the kind had');
  // 画面 A（古い版と回数）：どれも 409・何も変わらない
  for (const op of ['ar_rule_activate', 'ar_rule_discard']) {
    const x = await s.call('E2', { action: op, kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev, note: '古い画面' });
    assert.equal(x.status, 409, op + ' ' + JSON.stringify(x.body));
  }
  const sv = await s.call('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: seen.ver, expect_rev: seen.rev, base_ver: 0, note: '古い画面' });
  assert.equal(sv.status, 409, JSON.stringify(sv.body));
  const st2 = await s.state(); const k2 = st2.kinds.find(k => k.kind === 'plan');
  assert.equal(k2.active, undefined, 'nothing was activated');
  assert.deepEqual(k2.draft.def, { default: { stages: [STAGE(C)] } }, 'the new draft is unchanged');
  assert.equal(k2.draft.rev, re.draft.rev);
  // 捨てた版の番号は使い直さない（もう一度捨てて作っても番号は進む）・有効にできるのは今の下書きだけ
  await s.ok('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: k2.draft.ver, expect_rev: k2.draft.rev });
  const re2 = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: { default: { stages: [STAGE(G)] } }, expect_ver: 0, expect_rev: 0, base_ver: 0, note: '3 回目' });
  assert.equal(re2.draft.ver, seen.ver + 2);
  const act = await s.ok('E2', { action: 'ar_rule_activate', kind: 'plan', expect_ver: re2.draft.ver, expect_rev: re2.draft.rev, note: '有効' });
  assert.equal(act.active.ver, seen.ver + 2);
  const st3 = await s.state(); const k3 = st3.kinds.find(k => k.kind === 'plan');
  assert.deepEqual(k3.history.map(h => h.status), ['active', 'discarded', 'discarded']);
  // 捨てた版を指定して当てる・ルートを作ることはできない（有効な版と前の版だけ）
  assert.equal((await s.q(`select count(*)::int as n from ar_rules where kind = 'plan' and status = 'discarded'`))[0].n, 2);
  const bad = await s.q(`select count(*)::int as n from ar_rules where kind = 'plan' and status in ('active','old')`);
  assert.equal(bad[0].n, 1);
  // 表の決まり：状態は 4 つだけ
  await assert.rejects(s.q(`update ar_rules set status = 'gone' where kind = 'plan' and ver = $1`, [seen.ver]));
});

test('v1190 PR #192 fix 2: an "all" stage needs a different person for every slot — each-role slots are split first; an overlap is caught on save, activation and approval', async () => {
  const s = await setup(); await s.activate(); await s.live();
  // GM の全員（1 人ずつの枠＝E2）と、名前の枠 E2：同じ 1 人しかいない → 保存で知らせ、有効にできない（前は通り、E2 が 1 枠を埋めたあと止まった）
  const each = { t: 'role', role: 'gm', scope: 'all', each: true };
  const sv = await s.saveRule('shift', { default: { stages: [ALLS(each, { t: 'emp', emp: 'E2' })] } });
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.ok(sv.body.check.errors.some(e => e.code === 'same_person'), JSON.stringify(sv.body.check));
  const ac = await s.call('E2', { action: 'ar_rule_activate', kind: 'shift', expect_ver: sv.body.draft.ver, expect_rev: sv.body.draft.rev, note: 'x' });
  assert.equal(ac.status, 400); assert.equal(ac.body.error, 'rule_invalid');
  // 別々の人なら通る（GM の全員＋CEO）
  const ok2 = await s.saveRule('shift', { default: { stages: [ALLS(each, C)] } });
  assert.ok(!ok2.body.check.errors.some(e => e.code === 'same_person'), JSON.stringify(ok2.body.check));
  // 申請した本人しかいない枠は CEO に回る：CEO の枠と GM の枠（GM が申請）＝どちらも CEO だけ → 出した時点で「止まっている」
  await s.setRule('plan', { default: { stages: [ALLS(C, G)] }, self: 'ceo' });
  const own = await s.subOk('E2', 'plan', 'S2');
  const f0 = await s.ok('E1', { action: 'get', id: own.id });
  assert.equal(f0.route.stuck, true, 'two slots that only the CEO can fill: stuck from the start (before: shown as fine until the CEO signed one)');
  // 兼任の人（E5 を GM にもする）：GM の枠 {E2, E5}・AM の枠 {E5, E10}・名前の枠 E10。E5 は AM の枠を取る（GM の枠を取ると AM の枠と E10 の枠が同じ 1 人になる）
  await s.q(`insert into manager_auth(role, emp_id) values ('gm', 'E5')`);
  const amAll = { t: 'role', role: 'am', scope: 'all' };
  const def = { default: { stages: [ALLS(G, amAll, { t: 'emp', emp: 'E10' })] } };
  const chk = await s.saveRule('hire', def);
  assert.ok(!chk.body.check.errors.some(e => e.code === 'same_person'), 'a valid assignment exists: ' + JSON.stringify(chk.body.check));
  await s.setRule('hire', def);
  const h = await s.subOk('E8', 'hire', 'S1');
  assert.deepEqual(h.route.stages[0].slots.map(x => x.k), ['1', '2', '3']);
  assert.equal((await s.ok('E1', { action: 'get', id: h.id })).route.stuck, false);
  const a1 = await s.approve('E5', h);
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  const st = a1.body.route.stages[0];
  assert.deepEqual(st.slots.filter(x => x.filled).map(x => x.k), ['2'], 'E5 took the AM slot, not the GM slot');
  assert.equal(a1.body.route.stuck, false, 'the rest can still be filled by different people');
  assert.equal((await s.approve('E10', h)).body.status, 'pending');
  assert.equal((await s.approve('E2', h)).body.status, 'approved', 'every slot was filled');
  // 代理（E6 が E5 の代わり）も同じ：E5 として AM の枠を取る
  const end = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await s.ok('E2', { action: 'ar_delegate_save', from: 'E5', to: 'E6', kinds: ['hire'], stores: [], starts: s.today, ends: end, note: '休暇' });
  const h2 = await s.subOk('E8', 'hire', 'S1');
  const d1 = await s.approve('E6', h2);
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.deepEqual(d1.body.route.stages[0].slots.filter(x => x.filled).map(x => x.k), ['2'], 'the delegate took the AM slot for E5');
  assert.equal(d1.body.route.stuck, false);
});

test('v1190 PR #192 fix 3: in an "all" stage the screen says "waits for the others" until every slot is filled; bulk approval reports "stage", not "next"', async () => {
  const s = await setup(); await s.activate(); await s.live();
  await s.setRule('shift', { default: { stages: [ALLS(G, C), STAGE(G)] } });
  await s.setRule('hire', { default: { stages: [STAGE(G), STAGE(C)] } });
  await s.setRule('plan', { default: { stages: [ALLS(G, C)] } });
  const sh = await s.subOk('E8', 'shift', 'S1');
  const hi = await s.subOk('E8', 'hire', 'S1');
  const pl = await s.subOk('E8', 'plan', 'S1');
  const g1 = await s.ok('E2', { action: 'get', id: sh.id });
  assert.deepEqual([g1.route.my.after, g1.route.my.left, g1.route.my.final], ['same', 1, false], 'the CEO slot is still open after the GM signs');
  assert.equal((await s.ok('E2', { action: 'get', id: hi.id })).route.my.after, 'next');
  assert.equal((await s.ok('E2', { action: 'get', id: pl.id })).route.my.after, 'same');
  const fr = await Promise.all([sh, hi, pl].map(s.fresh));
  const b = await s.ok('E2', { action: 'bulk_approve', items: fr.map(r => ({ id: r.id, rev: r.rev })), client_key: 'bulk-pr192-01' });
  assert.deepEqual(b.results.map(r => r.outcome), ['stage', 'next', 'stage'], JSON.stringify(b.results));
  assert.deepEqual(b.counts, { final: 0, next: 1, stage: 2, skip: 0, failed: 0 });
  assert.equal(b.results[0].next.stage, 1, 'still the first stage'); assert.deepEqual(b.results[0].next.names, ['Cora CEO']);
  // CEO が埋めると段が済む：shift は次の段へ、plan は最終承認
  assert.equal((await s.ok('E1', { action: 'get', id: sh.id })).route.my.after, 'next');
  const c1 = await s.ok('E1', { action: 'get', id: pl.id });
  assert.deepEqual([c1.route.my.after, c1.route.my.left, c1.route.my.final], ['final', 0, true]);
  assert.equal((await s.approve('E1', pl)).body.status, 'approved');
  // 同じ番号の送り直しは前の結果（stage も同じ）
  const again = await s.ok('E2', { action: 'bulk_approve', items: fr.map(r => ({ id: r.id, rev: r.rev })), client_key: 'bulk-pr192-01' });
  assert.equal(again.replay, true); assert.deepEqual(again.counts, b.counts);
});
