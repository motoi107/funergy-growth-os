// v1202（8B）：入れる一式（deploy/wr-lost-v1202）。② と戻す SQL は SQL の正本と同じ・① と ③ は本物の SQL（PGlite）で前と後に流して答えを確かめる。合成データだけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, M } from './approval-rules-world.mjs';

const D = f => fs.readFileSync(new URL('../deploy/wr-lost-v1202/' + f, import.meta.url), 'utf8');
const LOST = M('20261213090000_wr_lost');

test('② is the migration and 戻す is db/wr-lost-drop.sql (byte for byte); the steps name the files and say the function is private', () => {
  assert.equal(D('2_SQL_紛失届.sql'), LOST);
  assert.equal(D('戻す_SQL.sql'), fs.readFileSync(new URL('../db/wr-lost-drop.sql', import.meta.url), 'utf8'));
  const h = D('手順.md');
  for (const f of ['1_最初に確認_読むだけ.sql', '2_SQL_紛失届.sql', '3_確認_読むだけ.sql', '戻す_SQL.sql', 'handler.mjs', '非公開', 'fn 14', '段 9']) assert.ok(h.includes(f), f);
});

test('① before: approval rules OK, stage 8, no lost; ③ after ②: all OK', async () => {
  const s = await setup();
  const rows = async sql => { await s.pg.exec('reset role'); try { return (await s.pg.query(sql)).rows; } finally { await s.pg.exec('set role service_role'); } };
  const pre = await rows(D('1_最初に確認_読むだけ.sql'));
  assert.deepEqual(pre.map(r => r['結果']), ['OK', '8', '0']);
  let post = await rows(D('3_確認_読むだけ.sql'));
  assert.ok(post.some(r => r['結果'] === 'NG'), 'before ② some are NG');
  await s.pg.exec('reset role'); await s.pg.exec(D('2_SQL_紛失届.sql')); await s.pg.exec('set role service_role');
  post = await rows(D('3_確認_読むだけ.sql'));
  assert.deepEqual(post.map(r => r['結果']), ['OK', 'OK', 'OK', 'OK', 'OK']);
  assert.equal((await rows(D('1_最初に確認_読むだけ.sql')))[1]['結果'], '9', 'after: stage 9');
});
