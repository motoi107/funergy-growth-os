// UI案103 step ⑤：ワークセンターのタブと申請・承認の配置。承認の関数は今のまま。
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

test('版は 1227', () => {
  assert.match(SRC, /const APP_VERSION = '1227'/);
  assert.match(SW, /const SW_BUILD = '1227'/);
});

test('タブは申請・承認、通知とチャット、自動チェック、業務Bot。今日タブは無い', () => {
  const wc = grab('function renderWorkCenter()');
  assert.doesNotMatch(wc, /setWorkTab\('today'\)/);
  assert.doesNotMatch(wc, /> 今日</);
  const labels = [...wc.matchAll(/t\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(labels.slice(0, 4), ['申請・承認', '通知とチャット', '自動チェック', '業務Bot']);
  assert.match(SRC, /var workTab = 'wr'/);
  assert.match(wc, /workTab==='today' \|\| workTab==='mgmt' \|\| workTab==='requests' \|\| workTab==='tasks'\) workTab='wr'/);
  assert.match(wc, /workTab==='announce'\) workTab='chat'/);
  assert.match(wc, /if \(workTab==='error'\) return bar \+ renderErrorCenter\(true\)/);
  assert.match(wc, /if \(workTab==='chat' \|\| workTab==='announce'\) return bar \+ renderNoticeChat\(\)/);
});

test('今日タブにあったものは、ほかのタブから開ける', () => {
  const tile = SRC.slice(SRC.indexOf('W.wrTodayTile = function'), SRC.indexOf('W.wrTodayTile = function') + 500);
  const chatTile = SRC.slice(SRC.indexOf('W.chatTodayTile = function'), SRC.indexOf('W.chatTodayTile = function') + 600);
  assert.ok(tile.includes("setWorkTab(\\'wr\\')") || tile.includes("setWorkTab('wr')"));
  assert.ok(chatTile.includes("setWorkTab(\\'chat\\')") || chatTile.includes("setWorkTab('chat')"));
  const old = grab('function oldNote(');
  assert.ok(old.includes("setWorkTab(\\'approval\\')") || old.includes("setWorkTab('approval')"));
  const note = grab('function renderNoticeChat()');
  assert.match(note, /data-nc="notice"/);
  assert.match(note, /t\('通知'/);
  assert.match(note, /renderNotifications\(\)/);
  assert.match(note, /renderAnnounce\(\)/);
  assert.match(note, /data-nc="chat"/);
  assert.match(note, /t\('チャット'/);
  assert.match(note, /chatWorkTab\(\)/);
  assert.match(SRC, /if \(page === 'chat' && navPageAllowed\('tasks'\)\)/);
  assert.match(SRC, /children:\['tasks','lala'\]/);
  assert.match(SRC, /\{id:'g_chat', label:'チャット', icon:'ti-messages', children:\['chat'\]\}/);
  assert.doesNotMatch(SRC, /children:\['tasks','chat'/);
});

test('PC は 3 列。却下は離して置き、理由が空なら今の関数が止める', () => {
  const pack = grab('function wrPack(');
  assert.match(pack, /wr-3-l/);
  assert.match(pack, /wr-3-c/);
  assert.match(pack, /id="wr-side"/);
  assert.match(pack, /\(W\.innerWidth \|\| 1024\) >= 1024 && S\.rows/);
  const open = grab('W.wrOpen = function(id)');
  assert.match(open, /getElementById\('wr-side'\)/);
  assert.match(open, /openModal\(/);
  assert.match(open, /api\(\{ action:'get', id:id \}\)/);
  const bt = grab('function buttons(r)');
  assert.match(bt, /a !== 'reject'/);
  assert.ok(bt.includes('class="wr-rej"'));
  assert.ok(bt.includes("wrAsk(\\'"));
  assert.match(SRC, /var NEEDS_NOTE = \{ 'return':1, reject:1, undo:1, dup_ok:1, apply_fail:1 \}/);
  assert.match(grab('W.wrAskGo = function()'), /NEEDS_NOTE\[op\] && !note\.trim\(\)/);
});

test('承認・却下・確認は今の doAct。まとめて承認の引数は変えていない', () => {
  const ask = grab('W.wrAsk = function(op)');
  assert.match(ask, /doAct\(op, \{\}\)/);
  const act = grab('function doAct(op, extra)');
  assert.match(act, /action:'act', id:r\.id, op:op, expect_rev:r\.rev, client_key:keyFor\(r, op\)/);
  const bulk = grab('W.wrBulkGo = function()');
  assert.match(bulk, /action:'act', id:x\.id, op:'approve', expect_rev:x\.rev, client_key:keyFor\(x, 'approve'\), note:T\('まとめて承認','Bulk approval'\)/);
  assert.match(SRC, /action:'bulk_approve'/);
  assert.match(SRC, /phase:'ask'/);
  assert.match(SRC, /b\.phase === 'ask'/);
  assert.match(SRC, /b\.phase = 'run'/);
  assert.match(SRC, /b\.phase = 'done'/);
});

test('却下は空の理由では doAct を呼ばず、理由があれば今の doAct に渡す。承認と確認は同じ doAct', () => {
  const calls = [];
  const toasts = [];
  let note = '';
  const ctx = {
    W: {},
    S: { d: { id: 'r1' }, busy: '', ask: null },
    NEEDS_NOTE: { return: 1, reject: 1, undo: 1, dup_ok: 1, apply_fail: 1 },
    doAct(op, extra) { calls.push([op, extra]); },
    drawDetail() {},
    evalApply() { throw new Error('apply'); },
    closeModalDirect() {},
    showToast(m) { toasts.push(m); },
    errText() { return 'reason'; },
    go() {},
    document: { getElementById() { return { value: note }; } },
  };
  vm.createContext(ctx);
  vm.runInContext(grab('W.wrAsk = function(op)') + '\n' + grab('W.wrAskGo = function()'), ctx);
  ctx.W.wrAsk('approve');
  ctx.W.wrAsk('check');
  ctx.W.wrAsk('reject');
  assert.equal(ctx.S.ask.op, 'reject');
  note = '   ';
  ctx.W.wrAskGo();
  note = ' 領収書が違う ';
  ctx.W.wrAskGo();
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'approve');
  assert.equal(JSON.stringify(calls[0][1]), '{}');
  assert.equal(calls[1][0], 'check');
  assert.equal(JSON.stringify(calls[1][1]), '{}');
  assert.equal(calls[2][0], 'reject');
  assert.equal(calls[2][1].note, '領収書が違う');
  assert.deepEqual(toasts, ['reason']);
});
