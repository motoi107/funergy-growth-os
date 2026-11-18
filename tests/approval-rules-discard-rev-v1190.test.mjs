// v1190 の直し（#191 6974382593・#192 6974534579 の Codex の P2）：前の ②（8b1ddec まで）は捨てた下書きの行を消していた。
// そのあと下書きを作り直すと（今の ② でも、② の流し直しで初めの下書きが入り直しても）、版の番号も回数も同じになり、
// 消す前から開いていた古い画面の「有効にする・捨てる・保存」が、別の中身の新しい下書きに当たっていた。
// 直し：新しい下書きの回数は、その種類のいちばん大きい回数と 1000000 の大きいほう ＋ 1（ar_rule_rev_next）。
// 今ある下書き（回数 1000000 以下）は ② が 1 回だけ繰り上げる。本物の SQL（PGlite）と本物の handler、合成データだけ。
// 前の ②（8b1ddec）と今の本番の ②（main 29985b6）が無いとき（浅い clone）は理由を出して落ちる（CI は取ってくる）。
// AR_MUT_FILE で ② を差し替えられる（わざと壊す試験・直す前の ② で落ちることを見る）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { setup, AR, G, C, STAGE } from './approval-rules-world.mjs';

const OLD_DELETE = '8b1ddeca02ebc91a64a4ef6da896ebce6bb94a0d';   // 捨てた下書きの行を消していた ②
const PROD_NOW = '29985b63112460fbeb21698e17abe4c347dddc61';     // 今の本番の ②（main・回数は 1 から）
const show = (sha, label) => {
  try { return execSync('git show ' + sha + ':supabase/migrations/20261209090000_approval_rules.sql', { cwd: new URL('..', import.meta.url), maxBuffer: 16 << 20 }).toString('utf8'); }
  catch { assert.fail(label + '（' + sha + '）が取れません（浅い clone）。CI のように git fetch してから流してください'); }
};
const D3 = fs.readFileSync(new URL('../deploy/approval-rules-v1190/3_確認_読むだけ.sql', import.meta.url), 'utf8');
const run = async (s, sql) => { await s.pg.exec('reset role'); await s.pg.exec(sql); await s.pg.exec('set role service_role'); };
const post = async s => { await s.pg.exec('reset role'); try { return (await s.pg.exec(D3)).pop().rows; } finally { await s.pg.exec('set role service_role'); } };
const res = (list, start) => list.find(r => r.check_name.startsWith(start))?.result;
const X = { default: { stages: [STAGE(G)] } };          // 古い画面が見ていた下書きの中身
const Y = { default: { stages: [STAGE(C), STAGE(G)] } }; // 作り直した別の中身
const plan = async s => (await s.state()).kinds.find(k => k.kind === 'plan');
// 古い画面（開いたまま）：見ていた版と回数で、有効にする・捨てる・保存を押す。どれも 409 で、何も変わらないこと
async function oldScreenIsRefused(s, seen, label) {
  for (const op of ['ar_rule_activate', 'ar_rule_discard']) {
    const x = await s.call('E1', { action: op, kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev, note: '古い画面' });
    assert.equal(x.status, 409, label + ' ' + op + ' ' + JSON.stringify(x.body));
  }
  const sv = await s.call('E1', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: seen.ver, expect_rev: seen.rev, base_ver: seen.base, note: '古い画面' });
  assert.equal(sv.status, 409, label + ' save ' + JSON.stringify(sv.body));
}

test('前の ② で捨てた（消えた）下書きのあと、直した ② で作り直す：古い画面の版と回数は新しい下書きに当たらない', async () => {
  const s = await setup({ ar: false });
  await run(s, show(OLD_DELETE, '前の ②'));
  await s.activate();                                                    // 16 種類とも版 1 が有効
  const v1 = (await plan(s)).active.ver;
  const made = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: 0, expect_rev: 0, base_ver: v1, note: '画面 A が見る下書き' });
  const seen = { ver: made.draft.ver, rev: made.draft.rev, base: v1 };  // 画面 A（開いたまま）
  await s.ok('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev });
  assert.equal((await s.q(`select count(*)::int as n from ar_rules where kind = 'plan' and ver = $1`, [seen.ver]))[0].n, 0, 'the old ② deleted the discarded draft');
  await run(s, AR);                                                      // 直した ②
  const re = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: Y, expect_ver: 0, expect_rev: 0, base_ver: v1, note: '作り直し' });
  assert.equal(re.draft.ver, seen.ver, 'the deleted version number is used again (the old ② left no row)');
  assert.ok(re.draft.rev > 1000000, 'but the count starts above 1000000: ' + re.draft.rev);
  await oldScreenIsRefused(s, seen, 'after the fixed ②');
  const k = await plan(s);
  assert.equal(k.active.ver, v1, 'nothing was activated');
  assert.deepEqual(k.draft.def, Y, 'the new draft is unchanged');
  assert.equal(k.draft.rev, re.draft.rev);
  // 読み直した画面なら有効にできる
  const act = await s.ok('E2', { action: 'ar_rule_activate', kind: 'plan', expect_ver: k.draft.ver, expect_rev: k.draft.rev, note: '確かめた' });
  assert.deepEqual(act.active.def, Y);
});

test('今の本番（前の ② で消えたあと今の ② で作り直した下書き）：直した ② が繰り上げる・③ の 10 が NG → OK・古い画面は 409', async () => {
  const s = await setup({ ar: false });
  await run(s, show(OLD_DELETE, '前の ②'));
  await s.activate();
  const v1 = (await plan(s)).active.ver;
  const made = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: 0, expect_rev: 0, base_ver: v1, note: '画面 A が見る下書き' });
  const seen = { ver: made.draft.ver, rev: made.draft.rev, base: v1 };
  await s.ok('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev });
  await run(s, show(PROD_NOW, '今の本番の ②'));                         // 11/18 に流し直した今の ②
  const re = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: Y, expect_ver: 0, expect_rev: 0, base_ver: v1, note: '作り直し' });
  assert.deepEqual([re.draft.ver, re.draft.rev], [seen.ver, seen.rev], 'premise: on the current production ② the new draft has the same version and count as the old screen');
  assert.match(res(await post(s), '10.'), /^NG/, '③ の 10 finds the old way');
  await run(s, AR);                                                      // 直した ② を流す
  const after = await post(s);
  assert.ok(!after.some(r => /NG/.test(r.result)), JSON.stringify(after));
  const k = await plan(s);
  assert.deepEqual(k.draft.def, Y, 'the draft content is kept');
  assert.equal(k.draft.ver, seen.ver);
  assert.ok(k.draft.rev > 1000000, 'the existing draft count is raised: ' + k.draft.rev);
  await oldScreenIsRefused(s, seen, 'after raising');
  assert.equal((await plan(s)).active.ver, v1, 'nothing was activated');
  // ほかの種類の下書きは無い（16 種類とも有効）・有効と前の版の回数は変えない
  assert.equal((await s.q(`select count(*)::int as n from ar_rules where status = 'active' and rev > 1000000`))[0].n, 0);
  await s.ok('E2', { action: 'ar_rule_activate', kind: 'plan', expect_ver: k.draft.ver, expect_rev: k.draft.rev, note: '確かめた' });
  // あとで今の本番の ② を流し直してしまったら：③ の 10 が NG（新しい下書きがまた 1 から）→ 直した ② をもう一度で OK
  await run(s, show(PROD_NOW, '今の本番の ②'));
  assert.match(res(await post(s), '10.'), /^NG/);
  await run(s, AR);
  assert.equal(res(await post(s), '10.'), 'OK');
  // 繰り上がっていない下書き（回数 1000000 以下）が残っていても NG
  const nd = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: 0, expect_rev: 0, base_ver: k.draft.ver, note: 'x' });
  await run(s, `update public.ar_rules set rev = 7 where kind = 'plan' and ver = ${nd.draft.ver}`);
  assert.match(res(await post(s), '10.'), /^NG/);
  await run(s, AR);
  assert.equal(res(await post(s), '10.'), 'OK', 're-running the fixed ② raises it');
});

test('前の ② で初めの下書きを捨てたあと ② を流し直す（初めの下書きが入り直す）：古い画面は入り直した下書きに当たらない', async () => {
  const s = await setup({ ar: false });
  await run(s, show(OLD_DELETE, '前の ②'));
  const d0 = (await plan(s)).draft;                                      // 初めの下書き（版 1・回数 1）を見ている画面 A
  const seen = { ver: d0.ver, rev: d0.rev, base: 0 };
  await s.ok('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: seen.ver, expect_rev: seen.rev });
  assert.equal((await s.q(`select count(*)::int as n from ar_rules where kind = 'plan'`))[0].n, 0);
  // 今の本番の ② を流し直すと、初めの下書きが同じ版・同じ回数でまた入る（直す前の穴）
  await run(s, show(PROD_NOW, '今の本番の ②'));
  const back = (await plan(s)).draft;
  assert.deepEqual([back.ver, back.rev], [seen.ver, seen.rev], 'premise: re-running the current production ② seeds the same version and count');
  await run(s, AR);
  const k = await plan(s);
  assert.equal(k.draft.ver, seen.ver);
  assert.ok(k.draft.rev > 1000000, String(k.draft.rev));
  await oldScreenIsRefused(s, seen, 'reseeded draft');
});

test('直した ② を初めて入れる・2 回流す：初めの下書きの回数は 1000001 から・2 回目は変えない・保存は 1 ずつ・開いていた画面は 1 回だけ読み直す', async () => {
  const s = await setup();                                               // 直した ② から（setup が流す）
  const first = await s.q(`select kind, rev from ar_rules where status = 'draft' order by kind`);
  assert.equal(first.length, 16);
  assert.ok(first.every(r => r.rev === 1000001), JSON.stringify(first));
  assert.ok(!(await post(s)).some(r => /NG/.test(r.result)));
  await run(s, AR);
  assert.deepEqual(await s.q(`select kind, rev from ar_rules where status = 'draft' order by kind`), first, 're-running ② changes nothing');
  // 保存は 1 ずつ・捨てて作り直すとその種類のいちばん大きい回数 ＋ 1（前の下書きの回数と当たらない）
  const d = (await plan(s)).draft;
  const s1 = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: d.ver, expect_rev: d.rev, base_ver: 0, note: '1' });
  assert.equal(s1.draft.rev, d.rev + 1);
  await s.ok('E2', { action: 'ar_rule_discard', kind: 'plan', expect_ver: s1.draft.ver, expect_rev: s1.draft.rev });
  const s2 = await s.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: Y, expect_ver: 0, expect_rev: 0, base_ver: 0, note: '2' });
  assert.equal(s2.draft.ver, s1.draft.ver + 1);
  assert.equal(s2.draft.rev, s1.draft.rev + 1, 'the next count of the kind, above the discarded draft');
  // 前の作り方の下書きを開いていた画面（回数 3）：直した ② を流したあと 1 回だけ 409 → 読み直すと通る
  const t = await setup({ ar: false });
  await run(t, show(PROD_NOW, '今の本番の ②'));
  let dd = (await plan(t)).draft;
  for (let i = 0; i < 2; i++) dd = (await t.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: i ? Y : X, expect_ver: dd.ver, expect_rev: dd.rev, base_ver: 0, note: String(i) })).draft;
  assert.equal(dd.rev, 3);
  await run(t, AR);
  const stale = await t.call('E2', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: dd.ver, expect_rev: dd.rev, base_ver: 0, note: '開いていた画面' });
  assert.equal(stale.status, 409, 'an open settings screen is asked to reload once');
  const fresh = (await plan(t)).draft;
  assert.deepEqual(fresh.def, Y, 'nothing was rewritten');
  const ok = await t.ok('E2', { action: 'ar_rule_save', kind: 'plan', def: X, expect_ver: fresh.ver, expect_rev: fresh.rev, base_ver: 0, note: '読み直した画面' });
  assert.equal(ok.draft.rev, fresh.rev + 1);
  // 関数（handler）が受ける回数の上限（10 億）より十分小さい
  assert.ok(ok.draft.rev < 1e9);
});
