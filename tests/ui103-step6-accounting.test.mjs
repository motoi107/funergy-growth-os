// UI案103 step ⑥：経理ホームの並び、経理レビューは 1 つの一覧と左の絞り込み、取り込みの段階。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function grab(start) {
  const i0 = SRC.indexOf(start);
  if (i0 < 0) throw new Error('missing ' + start);
  let i = SRC.indexOf('{', i0), depth = 0, q = null;
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(i0, i + 1); }
  }
  throw new Error('unterminated ' + start);
}

test('版は 1228 以上で揃っている', () => {
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  assert.ok(Number(v) >= 1228);
  assert.match(SW, new RegExp("const SW_BUILD = '" + v + "'"));
});

test('経理ホームはあなたの作業が先、締め・出力・取り込み、本日の勤怠は右', () => {
  const d = grab('function renderOfficeDash(inCenter)');
  const iWork = d.indexOf('あなたの作業');
  const iGrp = d.indexOf('締め・出力・取り込み');
  const iClock = d.indexOf('本日の勤怠');
  assert.ok(iWork > 0 && iGrp > iWork && iClock > iGrp);
  assert.match(d, /if \(inCenter\)/);
  assert.match(d, /setOfficeMgrTab\('report'\)/);
  assert.match(d, /invInGoIntake\(\)/);
  assert.match(d, /officeClockCard\(\)/);
  assert.match(d, /renderOfficeCloseCard\(\)/);
});

test('今の 10 個の中タブは、種類か過去の記録から同じ関数で開ける', () => {
  const ids = ['all', 'receipt', 'reimb', 'check', 'lost', 'gas', 'vac', 'exp', 'acctrev', 'appr'];
  const tabs = SRC.slice(SRC.indexOf('var AC_TABS'), SRC.indexOf('function acSubsOf'));
  for (const id of ids) assert.match(tabs, new RegExp("id:'" + id + "'"));
  const rc = grab('function renderAcctCenter()');
  assert.match(rc, /過去の記録/);
  assert.match(rc, /acctrev:1, appr:1/);
  assert.match(rc, /acSetSub\(\\'/);
  assert.match(rc, /window\[sub\.fn\]/);
  assert.match(grab('function acrOpen(key)'), /wrOpen\(r\.id\)/);
  assert.match(grab('function acrOpen(key)'), /arOpenBox\(r\.id\)/);
  assert.match(grab('function acrOpen(key)'), /openCheckReview\(r\.id\)/);
});

test('取り込みの段階は今の数。やり直すは今の retry', () => {
  const band = grab('function invInStageBand(H)');
  for (const label of ['提出フォルダ', '取り込み・読み取り', '判定', 'QuickBooks', '照合']) assert.match(band, new RegExp(label));
  assert.match(band, /H\.pending/);
  assert.match(band, /H\.review/);
  assert.match(band, /_invIn\.recon/);
  const retry = grab('async function invInRetry(fileId)');
  assert.match(retry, /action:'retry', file_id:fileId/);
  assert.match(retry, /retryPhase = 'run'/);
  assert.match(retry, /retryPhase = 'done'/);
  assert.match(SRC, /target="_blank"/);
});
