// v1169：Codex の blocked の P2（#163・#164）のチャットの画面の直し。index.html の FUNERGY_CHAT を VM で動かし、
// 本物の handler と本物の SQL（PGlite・v1169 の直しまで）につなぐ。合成データだけ。仕様：docs/FIXES_V1169_JA.md
// 直す前のコードで落ちることを確かめるとき：FUNERGY_INDEX=<v1168 の index.html>
import test from 'node:test';
import assert from 'node:assert/strict';
import { server, app, start, openDm, text, el, rowsOf, busy, fakeDevice, NAME } from './chat-guard-harness.mjs';

const JPG = n => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(Math.max(0, n - 4)).fill(7)]);
const file = (name, bytes, type = '') => new File([bytes], name, { type });
const subs = async srv => (await rowsOf(srv, `select emp_id from public.chat_push_subs order by emp_id`)).map(r => r.emp_id);
const toastHas = (a, re) => a.toasts.some(t => re.test(t[1]));

// 許可を聞いているあいだ止めておける端末（押したあと「許可」を押すまで待つ）
function slowDevice() {
  const dev = fakeDevice();
  let release = null;
  dev.Notification.requestPermission = () => { dev.asked++; return new Promise(r => { release = () => { dev.perm = 'granted'; r('granted'); }; }); };
  return { dev, allow: () => release && release() };
}

test('(#164) push: if the login changes while the permission is being asked, the device is not registered for the next person (nor for the first)', async () => {
  const srv = await server();
  // ① ログアウトして別の人がログイン
  const { dev, allow } = slowDevice();
  const a = await app(srv, 'E7', { dev }); await start(a);
  a.ctx.chatGuard(); await a.idle();
  a.ctx.chatPushOn(); await a.idle();
  assert.equal(dev.asked, 1);
  a.ctx.doLogout(); a.ctx._hwSession = 'pin-E6'; a.ctx.curUserName = NAME.E6; await start(a);
  allow(); await a.idle();
  assert.deepEqual(await subs(srv), [], 'not registered for E6 (who never asked) nor for E7 (logged out)');
  assert.ok(!a.calls.includes('chat_push_sub'));
  assert.ok(!toastHas(a, /この端末で通知を受け取ります/));
  // ② 同じ画面のまま、ログインの印だけ替わった（ほかのタブで別の人がログイン）
  const d2 = slowDevice();
  const b = await app(srv, 'E8', { dev: d2.dev }); await start(b);
  b.ctx.chatGuard(); await b.idle(); b.ctx.chatPushOn(); await b.idle();
  b.ctx._hwSession = 'pin-E9'; b.ctx.curUserName = NAME.E9;
  d2.allow(); await b.idle();
  assert.deepEqual(await subs(srv), []);
  assert.ok(!b.calls.includes('chat_push_sub'));
  // ③ 登録の答えを待つあいだに替わった：前の人の登録を取り消す（この端末に前の人の通知が来ないように）
  const d3 = fakeDevice();
  const c = await app(srv, 'E8', { dev: d3 }); await start(c);
  const h0 = srv.handler;
  srv.handler = async req => { const body = await req.clone().json(); const r = await h0(req); if (body.action === 'chat_push_sub') { c.ctx._hwSession = 'pin-E9'; c.ctx.curUserName = NAME.E9; } return r; };
  c.ctx.chatGuard(); await c.idle(); c.ctx.chatPushOn(); await c.idle();
  srv.handler = h0;
  assert.deepEqual(await subs(srv), [], 'E8’s registration was taken back');
  assert.ok(c.calls.includes('chat_push_unsub'));
  assert.equal(c.S().push.on, false);
  // ふだんは今までどおり受け取れる
  const d4 = fakeDevice();
  const e = await app(srv, 'E8', { dev: d4 }); await start(e);
  e.ctx.chatGuard(); await e.idle(); e.ctx.chatPushOn(); await e.idle();
  assert.deepEqual(await subs(srv), ['E8']);
  assert.ok(toastHas(e, /この端末で通知を受け取ります/));
});

test('(#163) when someone is taken off a group, that device also drops the file list, the open photo and the small-picture links of that conversation', async () => {
  const srv = await server();
  const a = await app(srv, 'E7'), b = await app(srv, 'E6');
  await start(a);
  a.ctx.chatNew('group'); await a.idle(); a.ctx.chatNewTitle('Prep'); a.ctx.chatNewSel('E6', true); a.ctx.chatCreateGroup(); await a.idle();
  const tid = a.S().open;
  await a.attach(file('レジ.jpg', JPG(50), 'image/jpeg')); await a.type('写真です'); await a.send();
  const ph = a.S().msgs[tid].list.at(-1).files[0];
  await start(b); b.ctx.chatOpen(tid); await b.idle(); b.show(); await b.idle();
  b.ctx.chatFilesList(); await b.idle();
  assert.ok(b.S().flist && b.S().flist.tid === tid && b.S().flist.items.length === 1, 'the list is open');
  b.ctx.chatFileOpen(ph.id); await b.idle();
  assert.ok(b.S().view, 'the photo is open');
  assert.ok(Object.keys(b.S().furl).some(k => k === 't:' + ph.id), 'a small-picture link is kept for it');
  a.ctx.chatMembers(); await a.idle(); a.ctx.chatRemove('E6'); await a.idle();
  b.ctx.chatRetrySync(); await b.idle();
  const C = b.S();
  assert.equal(C.flist, null, 'the file list is gone');
  assert.equal(C.view, null, 'the photo is closed');
  assert.ok(!Object.keys(C.furl).some(k => k === 't:' + ph.id), 'no link of that conversation kept');
  assert.ok(!C.fneed[ph.id]);
  assert.doesNotMatch(text(b.D.modal) + text(el(b, 'chat-viewer')), /レジ\.jpg/);
});

test('(#163) while the chat is locked, the panel bar shows only “チャット” (not the DM partner or the number of people)', async () => {
  const srv = await server();
  const a = await app(srv, 'E7');
  a.ctx.chatStart(); await a.idle(); busy(a);
  a.ctx.chatFab(); await a.idle();
  a.ctx.chatNew('dm'); await a.idle(); a.ctx.chatStartDm('E6'); await a.idle();
  assert.match(el(a, 'chat-fbar').innerHTML, /Sam Store/);
  a.ctx.chatLockNow(); await a.idle();
  const bar = el(a, 'chat-fbar').innerHTML;
  assert.doesNotMatch(bar, /Sam Store|参加者/, 'no name while locked');
  assert.match(bar, /チャット/);
  assert.doesNotMatch(el(a, 'chat-fbody').innerHTML, /Sam Store/);
});

test('(#163) a request chat nobody can read any more: the next person is told it starts again (the earlier one stays hidden) and can start it', async () => {
  const srv = await server();
  const r7 = await app(srv, 'E7', { role: 'sl' });
  r7.ctx.chatStart(); await r7.idle(); busy(r7);
  const sub = await r7.ctx.chatAPI({ action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'wr-v1169-0001',
    payload: { date: '2026-11-03', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 4321 } });
  r7.ctx.chatOpenCase(sub.id); await r7.idle();
  for (const e of ['E1', 'E2', 'E3']) r7.ctx.chatCaseSel(e, false);
  r7.ctx.chatCaseCreate(); await r7.idle();
  const old = r7.S().open; assert.ok(old);
  await r7.type('前の会話'); await r7.send();
  // ひとりだけの参加者は抜けられない（だれも読めない会話になる）
  assert.equal((await r7.ctx.chatAPI({ action: 'chat_remove', thread: old, emp: 'E7' }).catch(e => e)).code, 'last_member');
  await rowsOf(srv, `update public.employees set status = '退職' where id = 'E7'`);
  const gm = await app(srv, 'E2', { role: 'gm' });
  gm.ctx.chatStart(); await gm.idle(); busy(gm);
  gm.ctx.chatOpenCase(sub.id); await gm.idle();
  const dlg = text(el(gm, 'chat-case'));
  assert.match(dlg, /この申請のチャットは前にありましたが、いま読める参加者がいません。新しく始めます/);
  gm.ctx.chatCaseCreate(); await gm.idle();
  const tid = gm.S().open;
  assert.ok(tid && tid !== old, 'a new conversation');
  assert.doesNotMatch(text(el(gm, 'chat-msgs')), /前の会話/);
});

test('v1170 fix (Codex #166 6891496601): the only manager of a request chat retires → the participant left opens the chat on the normal screen → “add people” is there → adds someone → can then leave', async () => {
  const srv = await server();
  const r7 = await app(srv, 'E7', { role: 'sl' });
  r7.ctx.chatStart(); await r7.idle(); busy(r7);
  const sub = await r7.ctx.chatAPI({ action: 'submit', kind: 'reimburse', store_id: 'S1', client_key: 'wr-v1170-0001',
    payload: { date: '2026-11-03', payer: NAME.E7, payer_is_employee: true, vendor: 'Costco', purpose: '仕入れ', amount_cents: 4321 } });
  r7.ctx.chatOpenCase(sub.id); await r7.idle();
  for (const e of ['E1', 'E2', 'E3', 'E5']) r7.ctx.chatCaseSel(e, false);
  r7.ctx.chatCaseSel('E6', true);
  r7.ctx.chatCaseCreate(); await r7.idle();
  const tid = r7.S().open; assert.ok(tid);
  assert.deepEqual((await rowsOf(srv, `select emp_id, admin from public.chat_members where thread_id = $1 and left_at is null order by emp_id`, [tid])),
    [{ emp_id: 'E6', admin: false }, { emp_id: 'E7', admin: true }], 'E7 is the only manager; E6 is a member');
  await rowsOf(srv, `update public.employees set status = '退職' where id = 'E7'`);
  const e6 = await app(srv, 'E6', { role: 'sl' });
  await start(e6); e6.ctx.chatOpen(tid); await e6.idle(); e6.show(); await e6.idle();
  e6.ctx.chatMembers(); await e6.idle();
  const dlg = text(el(e6, 'chat-mem'));
  assert.match(dlg, /人を加える/, 'the add section is on the normal screen');
  assert.doesNotMatch(dlg, /人を加える・外すのは、この会話を管理する人だけです/);
  e6.ctx.chatMemSel('E8', true); e6.ctx.chatMemAdd(); await e6.idle();
  assert.ok(e6.toasts.some(t => /加えました/.test(t[1])), 'added');
  assert.deepEqual((await rowsOf(srv, `select emp_id from public.chat_members where thread_id = $1 and left_at is null and emp_id <> 'E7' order by emp_id`, [tid])).map(r => r.emp_id), ['E6', 'E8']);
  e6.ctx.chatMembers(); await e6.idle(); e6.ctx.chatRemove('E6'); await e6.idle();
  assert.deepEqual((await rowsOf(srv, `select emp_id, admin from public.chat_members where thread_id = $1 and left_at is null and emp_id <> 'E7' order by emp_id`, [tid])),
    [{ emp_id: 'E8', admin: true }], 'E6 could leave after adding E8; E8 manages it');
  // 参加者でない人には今までどおり見せない
  const e9 = await app(srv, 'E9');
  await start(e9);
  assert.equal(e9.S().threads[tid], undefined);
});
