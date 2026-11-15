// v1168 チャットの守りの画面：個人のチャット暗証番号（決める・ロック・ほかの端末・忘れた）・グループのキー（開ける・変わったらもう一度）・
// プッシュ通知（受け取る・前の人の送り先を消す・押したら開く・ログアウトでやめる）。index.html の FUNERGY_CHAT を VM で動かし、
// 本物の handler と本物の SQL（PGlite）につなぐ。合成データだけ。仕様：docs/CHAT_GUARD_V1168_JA.md
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { server, app, start, openDm, text, el, rowsOf, fakeDevice, VAPID_PUB, NAME } from './chat-guard-harness.mjs';

const host = a => a.D.getElementById('chat-host-page').innerHTML;
const sentWithUnlock = a => a.bodies.filter(b => typeof b.unlock === 'string' && /^[0-9a-f]{64}$/.test(b.unlock));
const toastHas = (a, re) => a.toasts.some(t => re.test(t[1]));

async function group(a, title, members, key) {
  a.ctx.chatNew('group'); await a.idle();
  a.ctx.chatNewTitle(title);
  for (const m of members) a.ctx.chatNewSel(m, true);
  if (key) { el(a, 'chat-new-key').value = key[0]; el(a, 'chat-new-key2').value = key[1] ?? key[0]; }
  a.ctx.chatCreateGroup(); await a.idle(); a.show(); await a.idle();
  return a.S().open;
}

test('chat PIN: set it in the protection screen; lock asks for it (any device kind, checked by the server); another device gets only the count until it is entered', async () => {
  const srv = await server();
  const a = await app(srv, 'E7'); await start(a);
  const tid = await openDm(a, 'E6');
  await a.type('秘密の相談'); await a.send();
  a.ctx.chatGuard(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /チャットの暗証番号（あなた）/);
  assert.match(text(el(a, 'chat-gd')), /オフ/);
  a.ctx.chatPinMode('set'); await a.idle();
  el(a, 'chat-gd-new').value = '2468'; el(a, 'chat-gd-new2').value = '2469'; a.ctx.chatPinSave(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /2 回とも同じではありません/);
  el(a, 'chat-gd-new').value = '2468'; el(a, 'chat-gd-new2').value = '２４６８'; a.ctx.chatPinSave(); await a.idle();
  assert.ok(toastHas(a, /暗証番号を決めました/), JSON.stringify(a.toasts));
  assert.equal(a.S().guard.pin, true);
  assert.ok(!a.bodies.some(b => JSON.stringify(b).includes('"unlock"') && b.action === 'chat_pin_set'), 'the first set had no mark yet');
  a.ctx.chatDlgClose();
  // the next requests carry the mark the server gave (memory only)
  a.ctx.chatRetrySync(); await a.idle();
  assert.ok(sentWithUnlock(a).length > 0);
  // even "my own device" asks for the chat PIN once one is set
  a.ctx.chatSetDev('personal');
  a.ctx.chatLockNow(); await a.idle();
  assert.ok(a.calls.includes('chat_relock'), 'the PIN part of the mark is cleared on the server');
  assert.match(host(a), /チャットの暗証番号を入れてください/); assert.doesNotMatch(host(a), /秘密の相談/);
  el(a, 'chat-lock-pin').value = '1111'; a.ctx.chatUnlock(); await a.idle();
  assert.match(host(a), /暗証番号が違います（あと 4 回で止まります）/);
  el(a, 'chat-lock-pin').value = '2468'; a.ctx.chatUnlock(); await a.idle();
  a.ctx.chatOpen(tid); await a.idle();
  assert.match(text(el(a, 'chat-msgs')), /秘密の相談/);
  // another device of E7: only the counts, no list, no realtime mark
  const b = await app(srv, 'E7');
  const e6 = await app(srv, 'E6'); await start(e6); e6.ctx.chatOpen(tid); await e6.idle();
  await e6.type('もう一つ'); await e6.send();
  await start(b);
  assert.deepEqual(JSON.parse(JSON.stringify(b.S().guard)), { pin: true, unlocked: false });
  assert.deepEqual(Object.keys(b.S().threads), []); assert.equal(b.S().token, '');
  assert.equal(b.ctx.chatUnread(), 1, 'the count only');
  assert.match(host(b), /チャットの暗証番号を入れてください/);
  assert.doesNotMatch(host(b), /もう一つ|秘密の相談/);
  el(b, 'chat-lock-pin').value = '2468'; b.ctx.chatUnlock(); await b.idle();
  assert.ok(b.S().threads[tid], 'the list comes after the PIN');
  b.ctx.chatOpen(tid); await b.idle();
  assert.match(text(el(b, 'chat-msgs')), /もう一つ/);
  // nothing about the PIN or the mark is kept outside this tab's memory
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const mod = html.slice(html.indexOf('/* ==== FUNERGY_CHAT（v1156）'), html.indexOf('/* ==== FUNERGY_CHAT end ==== */'));
  assert.ok(!/(localStorage|sessionStorage|indexedDB|_smallSet|lsSet)[^\n]*(utok|unlock|chat-gd-|chat-lock-pin|chat-key-in|chat-kset)/.test(mod));
});

test('forgot the chat PIN: the login PIN (auth-pin on the server) removes it; change and remove need the current PIN', async () => {
  const srv = await server();
  const a = await app(srv, 'E8'); await start(a);
  await a.ctx.chatAPI({ action: 'chat_pin_set', pin: '1357' });
  a.ctx.chatGuard(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /暗証番号を変える/);
  a.ctx.chatPinMode('change'); await a.idle();
  el(a, 'chat-gd-cur').value = '0000'; el(a, 'chat-gd-new').value = '2468'; el(a, 'chat-gd-new2').value = '2468'; a.ctx.chatPinSave(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /暗証番号が違います/);
  el(a, 'chat-gd-cur').value = '1357'; el(a, 'chat-gd-new').value = '2468'; el(a, 'chat-gd-new2').value = '2468'; a.ctx.chatPinSave(); await a.idle();
  assert.ok(toastHas(a, /暗証番号を変えました/));
  a.ctx.chatDlgClose();
  a.ctx.chatLockNow(); await a.idle();
  a.ctx.chatPinForgot(true); await a.idle();
  assert.match(host(a), /ログインの PIN で本人を確かめると/);
  el(a, 'chat-lock-pin').value = '0000'; a.ctx.chatUnlock(); await a.idle();
  assert.match(host(a), /ログインの PIN が違います/);
  el(a, 'chat-lock-pin').value = '4321'; a.ctx.chatUnlock(); await a.idle();
  assert.ok(toastHas(a, /暗証番号を外しました/));
  assert.equal(a.S().guard.pin, false);
  assert.equal((await rowsOf(srv, `select pin_hash from public.chat_guard where emp_id = 'E8'`))[0].pin_hash, null);
  assert.ok(a.bodies.some(b => b.action === 'chat_pin_reset' && b.login_pin === '4321'));
  // remove
  await a.ctx.chatAPI({ action: 'chat_pin_set', pin: '9753' });
  a.ctx.chatGuard(); await a.idle();
  a.ctx.chatPinMode('clear'); await a.idle();
  el(a, 'chat-gd-cur').value = '9753'; a.ctx.chatPinSave(); await a.idle();
  assert.ok(toastHas(a, /暗証番号を外しました/)); assert.equal(a.S().guard.pin, false);
});

test('group key: made with a key; a member sees only the name until the key; wrong key counts; a key change asks again and drops the copy in memory', async () => {
  const srv = await server();
  const a = await app(srv, 'E7'); await start(a);
  const tid = await group(a, 'Kitchen', ['E6', 'E8'], ['night-shift']);
  assert.equal(a.S().threads[tid].keyed, true); assert.equal(a.S().threads[tid].key_ok, true);
  await a.type('仕込みの計画'); await a.send();
  const c = await app(srv, 'E8'); await start(c);
  const listC = text(el(c, 'chat-list'));
  assert.match(listC, /ti-key/); assert.match(listC, /キーで守られています/); assert.doesNotMatch(listC, /仕込みの計画|Lee Leader：/);
  const before = c.calls.length;
  c.ctx.chatOpen(tid); await c.idle();
  assert.ok(el(c, 'chat-key-in'), 'the key box'); assert.equal(el(c, 'chat-ta'), null, 'no message box'); assert.equal(el(c, 'chat-msgs'), null);
  assert.ok(!c.calls.slice(before).includes('chat_messages'), 'the messages are not even asked for');
  el(c, 'chat-key-in').value = 'night-shirt'; c.ctx.chatKeyOpen(); await c.idle();
  assert.match(text(el(c, 'chat-pane')), /キーが違います（あと 4 回で止まります）/);
  assert.equal(el(c, 'chat-key-in').value, '', 'the typed key is not kept');
  el(c, 'chat-key-in').value = 'ｎｉｇｈｔ-shift'; c.ctx.chatKeyOpen(); await c.idle();
  assert.match(text(el(c, 'chat-msgs')), /仕込みの計画/);
  // the manager changes the key
  a.ctx.chatKeySettings(tid); await a.idle();
  assert.match(text(el(a, 'chat-kset')), /キーを変える/);
  el(a, 'chat-kset-1').value = 'day-shift'; el(a, 'chat-kset-2').value = 'day-shift'; a.ctx.chatKeySave(); await a.idle();
  assert.ok(toastHas(a, /キーを決めました/));
  a.ctx.chatOpen(tid); await a.idle();
  assert.match(text(el(a, 'chat-msgs')), /仕込みの計画/, 'the manager stays open');
  c.ctx.chatRetrySync(); await c.idle();
  assert.ok(el(c, 'chat-key-in'), 'asks again'); assert.equal(c.S().msgs[tid].list.length, 0, 'the copy in memory is dropped');
  el(c, 'chat-key-in').value = 'night-shift'; c.ctx.chatKeyOpen(); await c.idle();
  assert.match(text(el(c, 'chat-pane')), /キーが違います/);
  el(c, 'chat-key-in').value = 'day-shift'; c.ctx.chatKeyOpen(); await c.idle();
  assert.match(text(el(c, 'chat-msgs')), /仕込みの計画/);
  // only the manager gets "set a new key" on the key screen; a member can leave without the key
  const a2 = await app(srv, 'E7'); await start(a2); a2.ctx.chatOpen(tid); await a2.idle();
  assert.match(text(el(a2, 'chat-pane')), /キーを忘れた：新しいキーを決める/);
  const e6 = await app(srv, 'E6'); await start(e6); e6.ctx.chatOpen(tid); await e6.idle();
  assert.doesNotMatch(text(el(e6, 'chat-pane')), /新しいキーを決める/);
  e6.ctx.chatLeaveGated(tid); await e6.idle();
  assert.equal(e6.S().threads[tid], undefined);
  // the manager removes the key: open for all
  a.ctx.chatKeySettings(tid); await a.idle(); a.ctx.chatKeyClear(); await a.idle();
  const c2 = await app(srv, 'E8'); await start(c2); c2.ctx.chatOpen(tid); await c2.idle();
  assert.match(text(el(c2, 'chat-msgs')), /仕込みの計画/);
});

test('both on (the PIN and a key), and both off; log out clears the mark on the server and stops push for this device', async () => {
  const srv = await server();
  const dev = fakeDevice();
  const a = await app(srv, 'E7', { dev }); await start(a);
  const tid = await group(a, 'Managers', ['E6'], ['mgr-key']);
  await a.type('予算の話'); await a.send();
  const b = await app(srv, 'E6'); await start(b);
  await b.ctx.chatAPI({ action: 'chat_pin_set', pin: '8642' });
  const b2 = await app(srv, 'E6'); await start(b2);
  assert.match(host(b2), /チャットの暗証番号を入れてください/);
  el(b2, 'chat-lock-pin').value = '8642'; b2.ctx.chatUnlock(); await b2.idle();
  b2.ctx.chatOpen(tid); await b2.idle();
  assert.ok(el(b2, 'chat-key-in'), 'then the key');
  el(b2, 'chat-key-in').value = 'mgr-key'; b2.ctx.chatKeyOpen(); await b2.idle();
  assert.match(text(el(b2, 'chat-msgs')), /予算の話/);
  const marks = new Set(sentWithUnlock(b2).map(x => x.unlock));
  assert.equal(marks.size, 1, 'one mark holds both');
  // log out: the mark is cleared on the server
  b2.ctx.doLogout(); await b2.idle();
  assert.ok(b2.bodies.some(x => x.action === 'chat_relock' && x.mode === 'all' && marks.has(x.unlock)));
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.chat_sess where emp_id = 'E6'`))[0].n, 1, 'only the other device of E6 is left');
  // both off: plain as v1167
  const c = await app(srv, 'E8'); await start(c);
  const d = await openDm(c, 'E9');
  await c.type('こんにちは'); await c.send();
  assert.match(text(el(c, 'chat-msgs')), /こんにちは/); assert.equal(sentWithUnlock(c).length, 0);
  // push on for E7, then log out stops it
  a.ctx.chatGuard(); await a.idle(); a.ctx.chatPushOn(); await a.idle();
  assert.equal(a.S().push.on, true);
  a.ctx.doLogout(); await a.idle();
  assert.ok(a.bodies.some(x => x.action === 'chat_push_unsub'));
  assert.equal(dev.sub, null, 'unsubscribed on the device');
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.chat_push_subs`))[0].n, 0);
  void d;
});

test('push: asks permission on the button, subscribes with the server key, rings without content; another person on the same device clears it; tapping opens the newest unread', async () => {
  const srv = await server();
  const dev = fakeDevice();
  const a = await app(srv, 'E7', { dev }); await start(a);
  const tid = await openDm(a, 'E6');
  assert.equal(dev.asked, 0, 'not asked before the button');
  a.ctx.chatGuard(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /「新着メッセージがあります」だけ/);
  a.ctx.chatPushOn(); await a.idle();
  assert.equal(dev.asked, 1);
  assert.deepEqual([...new Uint8Array(dev.subscribed[0].applicationServerKey)], [...Buffer.from(VAPID_PUB, 'base64url')]);
  assert.equal(dev.subscribed[0].userVisibleOnly, true);
  assert.equal((await rowsOf(srv, `select emp_id from public.chat_push_subs`))[0].emp_id, 'E7');
  const e6 = await app(srv, 'E6'); await start(e6); e6.ctx.chatOpen(tid); await e6.idle();
  await e6.type('新しい件'); await e6.send(); await srv.flush();
  assert.deepEqual(srv.pushed, [dev.sub.endpoint]);
  // tapping the notification: the open app opens the newest unread conversation
  a.ctx.chatBack(); a.ctx.chatMin && a.ctx.chatMin();
  a.ctx.chatRetrySync(); await a.idle();
  dev.message({ type: 'funergy-chat-open' }); await a.idle();
  assert.equal(a.S().open, tid);
  // the same device, another person (E7 did not log out): E7's endpoint is removed, not taken over
  const b = await app(srv, 'E8', { dev }); await start(b);
  assert.equal(b.S().push.on, false);
  assert.equal((await rowsOf(srv, `select count(*)::int n from public.chat_push_subs`))[0].n, 0);
  assert.equal(dev.sub, null);
  // opened from a notification with ?chat=1 (after sign-in)
  const c = await app(srv, 'E6', { search: '?chat=1' });
  await e6.type('もう一件'); await e6.send();
  const a3 = await app(srv, 'E7', { search: '?chat=1' }); await start(a3);
  assert.equal(a3.S().open, tid); assert.equal(a3.ctx.location.search, '');
  void c;
});

test('push cannot start: iPhone in Safari (not the home screen app), blocked, or no keys on the server; the protection screen says why', async () => {
  const srv = await server({ push: false });
  const ios = fakeDevice({ ios: true, noPush: true });
  const a = await app(srv, 'E7', { dev: ios }); await start(a);
  a.ctx.chatGuard(); await a.idle(); a.ctx.chatPushOn(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /ホーム画面に追加/);
  const blocked = fakeDevice({ perm: 'denied' });
  const b = await app(srv, 'E8', { dev: blocked }); await start(b);
  b.ctx.chatGuard(); await b.idle(); b.ctx.chatPushOn(); await b.idle();
  assert.match(text(el(b, 'chat-gd')), /通知が止められています/);
  const ok = fakeDevice();
  const c = await app(srv, 'E6', { dev: ok }); await start(c);
  c.ctx.chatGuard(); await c.idle(); c.ctx.chatPushOn(); await c.idle();
  assert.match(text(el(c, 'chat-gd')), /プッシュ通知のサーバーの準備がまだ/);
  assert.equal(ok.sub, null);
});

test('older servers: without the SQL the protection screen says so; an older function (fn 9) too; English labels', async () => {
  const old = await server({ guard: false });
  const a = await app(old, 'E7'); await start(a);
  a.ctx.chatGuard(); await a.idle();
  assert.match(text(el(a, 'chat-gd')), /サーバー（SQL）が v1168/);
  const srv = await server();
  const b = await app(srv, 'E7', { fail: { status: body => (body.action === 'chat_guard' ? 'unknown_action' : null) } }); await start(b);
  b.ctx.chatGuard(); await b.idle();
  assert.match(text(el(b, 'chat-gd')), /関数 work-requests）が v1168/);
  // English
  const en = await app(srv, 'E8', { lang: 'en' }); await start(en);
  await en.ctx.chatAPI({ action: 'chat_pin_set', pin: '1234' });
  en.ctx.chatRetrySync(); await en.idle();   // the guard comes back with the list (set elsewhere = like another device)
  en.ctx.chatLockNow(); await en.idle();
  assert.match(host(en), /Enter your chat PIN/);
  el(en, 'chat-lock-pin').value = '1234'; en.ctx.chatUnlock(); await en.idle();
  const e7 = await app(srv, 'E7'); await start(e7);
  const tid = await group(e7, 'Bar', ['E8'], ['bar-key']);
  en.ctx.chatRetrySync(); await en.idle(); en.ctx.chatOpen(tid); await en.idle();
  assert.match(text(el(en, 'chat-pane')), /Protected by a key/);
  assert.equal(NAME.E8, 'Cam Crew');
});

test('the service worker shows only the fixed text (never the pushed data), groups notifications with one tag, and opens the app for the chat', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const push = sw.slice(sw.indexOf("addEventListener('push'"), sw.indexOf("addEventListener('notificationclick'"));
  assert.match(push, /body: '新着メッセージがあります'/);
  assert.match(push, /tag: 'funergy-chat'/);
  assert.doesNotMatch(push, /e\.data|\.json\(\)|\.text\(\)/, 'the pushed data is not read');
  const click = sw.slice(sw.indexOf("addEventListener('notificationclick'"));
  assert.match(click, /funergy-chat-open/); assert.match(click, /\?chat=1/);
  assert.ok(Number((/const SW_BUILD = '(\d+)'/.exec(sw) || [])[1]) >= 1168, 'the service worker is 1168 or later');
});

test('a device that was open loses the realtime mark when the PIN is set on another device (it locks; only counts until the PIN)', async () => {
  const srv = await server();
  const a = await app(srv, 'E7'); await start(a);
  const tid = await openDm(a, 'E6');
  await a.type('前のメッセージ'); await a.send();
  a.ctx.chatRetrySync(); await a.idle();
  assert.ok(a.S().token, 'the realtime mark while open');
  const other = await app(srv, 'E7'); await start(other);
  await other.ctx.chatAPI({ action: 'chat_pin_set', pin: '2468' });
  a.ctx.chatRetrySync(); await a.idle();
  assert.equal(a.S().token, '', 'no realtime mark while locked');
  assert.equal(a.S().guard.unlocked, false);
  assert.match(host(a), /チャットの暗証番号を入れてください/);
  assert.ok(a.S().threads[tid], 'the copy in this tab is kept (hidden) for after the PIN');
  el(a, 'chat-lock-pin').value = '2468'; a.ctx.chatUnlock(); await a.idle();
  assert.ok(a.S().token, 'the mark comes back after the PIN');
});

test('details: a keyed row shows no sender at all; a subscription made with another key is replaced; tapping a notification opens the newest unread (not the newest)', async () => {
  const srv = await server();
  const a = await app(srv, 'E7'); await start(a);
  const kitchen = await group(a, 'Kitchen', ['E6', 'E8'], ['night-shift']);
  await a.type('仕込み'); await a.send();
  const c = await app(srv, 'E8'); await start(c);
  const row = text(el(c, 'chat-list'));
  assert.doesNotMatch(row, /undefined|：（キー|Lee Leader/, 'no name or empty name before the locked text');
  // push: an old subscription made with another server key is dropped first
  const dev = fakeDevice({ perm: 'granted' });
  const old = { endpoint: 'https://fcm.googleapis.com/fcm/send/old-key', options: { applicationServerKey: new Uint8Array([4, 1, 2, 3]).buffer }, async unsubscribe() { dev.unsubscribed.push(this.endpoint); dev.sub = null; return true; } };
  dev.sub = old;
  const b = await app(srv, 'E6', { dev }); await start(b);
  b.ctx.chatGuard(); await b.idle(); b.ctx.chatPushOn(); await b.idle();
  assert.ok(dev.unsubscribed.includes('https://fcm.googleapis.com/fcm/send/old-key'), 'the old one is dropped');
  assert.equal(dev.subscribed.length, 1); assert.notEqual(dev.sub.endpoint, old.endpoint);
  // three conversations: newest read, middle unread, oldest read → the middle one
  const e9 = await app(srv, 'E9'); await start(e9);
  const d1 = await openDm(e9, 'E6'); await e9.type('古い'); await e9.send();
  b.ctx.chatOpen(d1); await b.idle();   // E6 reads it
  const d2 = await openDm(a, 'E6'); await a.type('真ん中（未読）'); await a.send();
  const e8 = await app(srv, 'E8'); await start(e8);
  const d3 = await openDm(e8, 'E6'); await e8.type('新しい'); await e8.send();
  b.ctx.chatRetrySync(); await b.idle(); b.ctx.chatOpen(d3); await b.idle(); b.ctx.chatBack(); await b.idle();
  b.ctx.chatRetrySync(); await b.idle();
  dev.message({ type: 'funergy-chat-open' }); await b.idle();
  assert.equal(b.S().open, d2, 'the newest unread');
  void kitchen;
});
