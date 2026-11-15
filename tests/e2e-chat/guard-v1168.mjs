// v1168（UI案79 の答えの残り）：チャットの守りを本物のブラウザ（Chrome）と本物の work-requests（SQL・handler・PGlite）で通す。合成データだけ。本番にはつながない。
// 完了の条件 ④ の残り（依頼書）：暗証番号だけ・キーだけ・両方・両方オフ・キーを変えた、をそれぞれ確かめる。あわせて
//  ・暗証番号を忘れた（ログインの PIN で本人を確かめて外す）・ロック・ログアウト（サーバーの開けた印も消える）
//  ・サーバーが断る（暗証番号・キーを開けていない頼みは 423）
//  ・プッシュ通知：Service Worker は届いた中身を使わず「新着メッセージがあります」だけ・1 つにまとまる・押すとアプリへ（本物の Chrome の Service Worker・CDP で push を届ける）
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/guardshots] node tests/e2e-chat/guard-v1168.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
process.env.WR_UI79 = '1'; process.env.WR_GUARD = '1';
const { startWorld } = await import('../e2e-wr/world.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const W = await startWorld({ vendor: process.env.VENDOR_DIR, cert: process.env.CERT_DIR, appPort: 8094 });
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || '';
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }).catch(() => {}); } };

async function device(width, height, touch, sw = 'block') {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, serviceWorkers: sw, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message().slice(0, 200)); d.accept(); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  return { ctx, page, errors, dialogs };
}
async function login(D, store, name) {
  const { page } = D;
  await page.goto(W.url);
  await page.waitForFunction(() => document.querySelectorAll('#login-store-grid .store-btn').length >= 2, null, { timeout: 60000 });
  await page.evaluate(s => loginPickLocation(s), store); await sleep(400);
  await page.locator('#login-name-grid .store-btn', { hasText: name }).first().click();
  await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false, null, { timeout: 120000 }).catch(() => {});
  await sleep(4500);   // チャットはログインの 3 秒あと
}
const api = (D, body) => D.page.evaluate(b => chatAPI(b).then(j => ({ ok: true, j }), e => ({ ok: false, code: e.code, status: e.status })), body);
const rootText = D => D.page.evaluate(() => ((document.getElementById('chat-root') || {}).innerText || '').replace(/\s+/g, ' '));
const openChat = async D => { await D.page.evaluate(() => { if (!document.getElementById('chat-root')) chatFab(); }); await sleep(700); };
const sync = async D => { await D.page.evaluate(() => chatRetrySync()); await sleep(1500); };

const GM = await device(1280, 800, false);    // Gabe Gm（グループを作ってキーを決める）
const LEE = await device(390, 844, true);     // Lee Two（スマホ・暗証番号を決める）
const CAM = await device(1280, 800, false);   // Cam Crew（キーで開ける）
const SAM = await device(1280, 800, false);   // Sam Three（両方オフ）
await login(GM, 'OFFICE', 'Gabe Gm');
await login(LEE, 'F01', 'Lee Two');
await login(CAM, 'F01', 'Cam Crew');
await login(SAM, 'F01', 'Sam Three');
const me = await api(GM, { action: 'whoami' });
ok('environment: the function is fn 10 and the chat SQL is 4', me.ok && me.j.fn === 10 && me.j.chat === 4, me.ok ? { fn: me.j.fn, chat: me.j.chat, push: me.j.push } : me);

// ---------------------------------------------------------------- 両方オフ（v1167 と同じ）
await SAM.page.evaluate(() => chatAPI({ action: 'chat_open_dm', to: 'e10' }).then(r => chatGo(r.id))); await sleep(1500);
await SAM.page.fill('#chat-ta', 'ふつうの DM です'); await SAM.page.evaluate(() => chatSend()); await sleep(1200);
const offDm = await SAM.page.evaluate(() => _chatState().open);
ok('both off: a DM is sent and read as before (no mark sent)', /ふつうの DM です/.test(await rootText(SAM)), offDm);

// ---------------------------------------------------------------- 暗証番号だけ（Lee Two・スマホ）
await openChat(LEE);
await LEE.page.evaluate(() => chatAPI({ action: 'chat_open_dm', to: 'e2' }).then(r => chatGo(r.id))); await sleep(1500);
await LEE.page.fill('#chat-ta', '暗証番号の前のメッセージ'); await LEE.page.evaluate(() => chatSend()); await sleep(1200);
const leeDm = await LEE.page.evaluate(() => _chatState().open);
await LEE.page.evaluate(() => chatGuard()); await sleep(800);
await shot(LEE.page, '01_phone_guard_off.png');
await LEE.page.evaluate(() => chatPinMode('set')); await sleep(300);
await LEE.page.fill('#chat-gd-new', '2468'); await LEE.page.fill('#chat-gd-new2', '2468');
await LEE.page.click('#chat-gd-ok'); await sleep(1500);
const gdText = await LEE.page.evaluate(() => (document.getElementById('chat-gd') || {}).innerText || '');
ok('PIN only: Lee sets a chat PIN on the protection screen (now on)', /オン/.test(gdText) && /暗証番号を変える/.test(gdText), gdText.replace(/\s+/g, ' ').slice(0, 120));
await shot(LEE.page, '02_phone_guard_on.png');
const stored = (await W.q(`select pin_hash, pin_salt, pin_iter from public.chat_guard where emp_id = 'e11'`))[0];
ok('PIN only: the server keeps only a PBKDF2 mark (not 2468)', stored && /^[0-9a-f]{64}$/.test(stored.pin_hash) && stored.pin_iter === 150000 && !JSON.stringify(stored).includes('2468'), { iter: stored && stored.pin_iter });
await LEE.page.evaluate(() => chatDlgClose());
await LEE.page.evaluate(() => chatLockNow()); await sleep(900);
const leeLocked = await rootText(LEE);
ok('PIN only: lock asks for the chat PIN (and hides the messages)', /チャットの暗証番号を入れてください/.test(leeLocked) && !/暗証番号の前のメッセージ/.test(leeLocked), leeLocked.slice(0, 120));
await shot(LEE.page, '03_phone_pin_lock.png');
const relock = W.calls.filter(c => c.action === 'chat_relock' && c.who === 'e11').length;
ok('PIN only: the lock also cleared the PIN part on the server', relock >= 1, relock);
const refused = await api(LEE, { action: 'chat_messages', thread: leeDm });
ok('PIN only: while locked the server refuses the messages (423)', !refused.ok && refused.status === 423 && refused.code === 'chat_pin_required', refused);
await LEE.page.fill('#chat-lock-pin', '1111'); await LEE.page.evaluate(() => chatUnlock()); await sleep(1200);
ok('PIN only: a wrong PIN says how many tries are left', /暗証番号が違います（あと 4 回で止まります）/.test(await rootText(LEE)));
await LEE.page.fill('#chat-lock-pin', '2468'); await LEE.page.evaluate(() => chatUnlock()); await sleep(2000);
await LEE.page.evaluate(id => chatGo(id), leeDm); await sleep(1500);
ok('PIN only: the right PIN opens it again', /暗証番号の前のメッセージ/.test(await rootText(LEE)));
// another device of Lee: only the count until the PIN
const LEE2 = await device(1280, 800, false);
await GM.page.evaluate(id => chatAPI({ action: 'chat_send', thread: id, body: 'GM から Lee へ', client_key: 'e2e-guard-gm-0001' }), leeDm); await sleep(300);
await login(LEE2, 'F01', 'Lee Two');
const st2 = await LEE2.page.evaluate(() => ({ guard: _chatState().guard, n: Object.keys(_chatState().threads).length, token: _chatState().token, unread: chatUnread() }));
ok('PIN only: another device gets no list and no realtime mark, only the count', st2.guard.pin && !st2.guard.unlocked && st2.n === 0 && !st2.token && st2.unread >= 1, st2);
await openChat(LEE2);
ok('PIN only: the other device shows the PIN lock (no names, no text)', /チャットの暗証番号を入れてください/.test(await rootText(LEE2)) && !/GM から Lee へ/.test(await rootText(LEE2)));
await shot(LEE2.page, '04_pc_other_device_pin.png');
// forgot the PIN on the other device: the login PIN removes it
await LEE2.page.evaluate(() => chatPinForgot(true)); await sleep(300);
await LEE2.page.fill('#chat-lock-pin', '9999'); await LEE2.page.evaluate(() => chatUnlock()); await sleep(1200);
ok('forgot: a wrong login PIN does not remove it', /ログインの PIN が違います/.test(await rootText(LEE2)));
await LEE2.page.fill('#chat-lock-pin', '1234'); await LEE2.page.evaluate(() => chatUnlock()); await sleep(2000);
const pinAfter = (await W.q(`select pin_hash from public.chat_guard where emp_id = 'e11'`))[0];
ok('forgot: the login PIN (checked on the server) removed the chat PIN; the list comes', pinAfter.pin_hash === null && await LEE2.page.evaluate(() => Object.keys(_chatState().threads).length > 0), pinAfter);
// set it again from the phone (it is off now)
const reset = await api(LEE, { action: 'chat_pin_set', pin: '1357' });
ok('PIN only: set again (1357)', reset.ok && reset.j.ok, reset.ok ? reset.j : reset);
await LEE.page.evaluate(() => chatRetrySync()); await sleep(1500);

// ---------------------------------------------------------------- キーだけ（Gabe Gm のグループ・Cam Crew）
await openChat(GM);
const fit = await GM.page.evaluate(() => { const r = document.getElementById('chat-float').getBoundingClientRect(); return { right: Math.round(r.right), bottom: Math.round(r.bottom), iw: innerWidth, ih: innerHeight, zoom: getComputedStyle(document.body).zoom }; });
ok('PC: the panel fits on the screen with the PC zoom (1.1) (v1167 put it partly off the right edge)', fit.right <= fit.iw && fit.bottom <= fit.ih, fit);
await GM.page.evaluate(() => chatNew('group')); await sleep(600);
await GM.page.fill('#chat-new-title', 'Kitchen'); await GM.page.evaluate(() => chatNewTitle('Kitchen'));
await GM.page.evaluate(() => { chatNewSel('e10', true); chatNewSel('e11', true); });
await GM.page.evaluate(() => { const d = document.querySelector('#chat-new details'); if (d) d.open = true; }); await sleep(200);
await GM.page.fill('#chat-new-key', 'night-shift'); await GM.page.fill('#chat-new-key2', 'night-shift');
await shot(GM.page, '05_pc_new_group_with_key.png');
await GM.page.evaluate(() => chatCreateGroup()); await sleep(1800);
const gid = await GM.page.evaluate(() => _chatState().open);
const gRow = await GM.page.evaluate(id => { const r = _chatState().threads[id]; return { keyed: r.keyed, key_ok: r.key_ok }; }, gid);
ok('key only: the GM makes a group with a key and stays open', gRow.keyed && gRow.key_ok, gRow);
await GM.page.fill('#chat-ta', '明日の仕込みは 8 時から'); await GM.page.evaluate(() => chatSend()); await sleep(1200);
const keyStored = (await W.q(`select key_hash, key_rev from public.chat_threads where id = $1`, [gid]))[0];
ok('key only: the server keeps only a PBKDF2 mark of the key', /^[0-9a-f]{64}$/.test(keyStored.key_hash) && !JSON.stringify(keyStored).includes('night'), keyStored.key_rev);
await openChat(CAM); await sync(CAM);
const camList = await CAM.page.evaluate(() => (document.getElementById('chat-list') || {}).innerText || '');
ok('key only: the member sees the name, not the last message', /Kitchen/.test(camList) && /キーで守られています/.test(camList) && !/仕込み/.test(camList), camList.replace(/\s+/g, ' ').slice(0, 160));
await CAM.page.evaluate(id => chatOpen(id), gid); await sleep(1200);
const gate = await CAM.page.evaluate(() => ({ key: !!document.getElementById('chat-key-in'), ta: !!document.getElementById('chat-ta'), text: ((document.getElementById('chat-pane') || {}).innerText || '').replace(/\s+/g, ' ') }));
ok('key only: opening it asks for the key (no messages, no message box)', gate.key && !gate.ta && !/仕込み/.test(gate.text), gate.text.slice(0, 120));
await shot(CAM.page, '06_pc_key_gate.png');
const kref = await api(CAM, { action: 'chat_messages', thread: gid });
ok('key only: the server refuses the messages without the key (423)', !kref.ok && kref.status === 423 && kref.code === 'chat_key_required', kref);
await CAM.page.fill('#chat-key-in', 'night-shirt'); await CAM.page.evaluate(() => chatKeyOpen()); await sleep(1200);
ok('key only: a wrong key says how many tries are left', /キーが違います（あと 4 回で止まります）/.test(await rootText(CAM)));
await CAM.page.fill('#chat-key-in', 'night-shift'); await CAM.page.evaluate(() => chatKeyOpen()); await sleep(1800);
ok('key only: the right key opens it', /明日の仕込みは 8 時から/.test(await rootText(CAM)));
const outsider = await api(SAM, { action: 'chat_key_verify', thread: gid, key: 'night-shift' });
ok('key only: a non-member with the right key cannot get in (404)', !outsider.ok && outsider.status === 404, outsider);

// ---------------------------------------------------------------- 両方（Lee Two：暗証番号 1357 ＋ グループのキー）
await LEE.page.evaluate(() => chatLockNow()); await sleep(600);
await openChat(LEE);
await LEE.page.fill('#chat-lock-pin', '1357'); await LEE.page.evaluate(() => chatUnlock()); await sleep(2000);
await LEE.page.evaluate(id => chatGo(id), gid); await sleep(1500);
ok('both: after the PIN, the keyed group still asks for its key', await LEE.page.evaluate(() => !!document.getElementById('chat-key-in') && !document.getElementById('chat-ta')));
await shot(LEE.page, '07_phone_key_gate_after_pin.png');
await LEE.page.fill('#chat-key-in', 'night-shift'); await LEE.page.evaluate(() => chatKeyOpen()); await sleep(1800);
ok('both: the key opens it', /明日の仕込みは 8 時から/.test(await rootText(LEE)));
const leeMarks = (await W.q(`select count(*)::int n from public.chat_sess s join public.chat_sess_keys k on k.sess_id = s.id where s.emp_id = 'e11' and s.pin_at is not null`))[0].n;
ok('both: one mark on the server holds the PIN and the key', leeMarks === 1, leeMarks);

// ---------------------------------------------------------------- キーを変えた（GM）→ 開いている端末はもう一度
await GM.page.evaluate(id => chatKeySettings(id), gid); await sleep(600);
await shot(GM.page, '08_pc_key_settings.png');
await GM.page.fill('#chat-kset-1', 'day-shift'); await GM.page.fill('#chat-kset-2', 'day-shift');
await GM.page.evaluate(() => chatKeySave()); await sleep(1500);
await CAM.page.evaluate(id => chatOpen(id), gid); await sync(CAM);
const camAfter = await CAM.page.evaluate(id => ({ key: !!document.getElementById('chat-key-in'), copy: (_chatState().msgs[id] || { list: [] }).list.length }), gid);
ok('key changed: the open conversation asks again and drops its copy in memory', camAfter.key && camAfter.copy === 0, camAfter);
await CAM.page.fill('#chat-key-in', 'night-shift'); await CAM.page.evaluate(() => chatKeyOpen()); await sleep(1200);
ok('key changed: the old key no longer opens it', /キーが違います/.test(await rootText(CAM)));
await CAM.page.fill('#chat-key-in', 'day-shift'); await CAM.page.evaluate(() => chatKeyOpen()); await sleep(1800);
ok('key changed: the new key opens it', /明日の仕込みは 8 時から/.test(await rootText(CAM)));
const gmStill = await GM.page.evaluate(id => _chatState().threads[id].key_ok, gid);
ok('key changed: the GM who changed it stays open', gmStill === true);

// ---------------------------------------------------------------- ログアウト：サーバーの開けた印も消える
const before = (await W.q(`select count(*)::int n from public.chat_sess where emp_id = 'e10'`))[0].n;
await CAM.page.evaluate(() => doLogout()); await sleep(1500);
const afterN = (await W.q(`select count(*)::int n from public.chat_sess where emp_id = 'e10'`))[0].n;
ok('logout: the mark of this device is removed on the server', before === 1 && afterN === 0, { before, afterN });

// ---------------------------------------------------------------- プッシュ通知の画面（本物の Service Worker）。中身は使わない・1 つにまとまる
const SWD = await device(1280, 800, false, 'allow');
await SWD.ctx.grantPermissions(['notifications'], { origin: W.url.replace(/\/$/, '') });
await SWD.page.goto(W.url);
await SWD.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined, null, { timeout: 30000 }).catch(() => {});
const reg = await SWD.page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; }).catch(e => ({ err: String(e) }));
ok('push: the app service worker runs (Chrome)', reg && reg.active, reg);
let notes = null;
try {
  const cdp = await SWD.ctx.newCDPSession(SWD.page);
  await cdp.send('ServiceWorker.enable');
  let regId = null;
  cdp.on('ServiceWorker.workerRegistrationUpdated', ev => { for (const r of ev.registrations || []) if (!r.isDeleted) regId = r.registrationId; });
  await sleep(800);
  if (!regId) { const v = await cdp.send('ServiceWorker.enable').catch(() => null); void v; await sleep(500); }
  const origin = W.url.replace(/\/$/, '');
  for (const data of ['{"title":"秘密の件名","body":"本文がもれる"}', 'plain text', '']) await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: String(regId), data });
  await sleep(1500);
  notes = await SWD.page.evaluate(async () => { const r = await navigator.serviceWorker.ready; const n = await r.getNotifications(); return n.map(x => ({ title: x.title, body: x.body, tag: x.tag })); });
} catch (e) { notes = { err: String(e && e.message || e).slice(0, 200) }; }
ok('push: the notification says only 新着メッセージがあります and pushes with content are not shown; several become one (same tag)',
  Array.isArray(notes) && notes.length === 1 && notes[0].body === '新着メッセージがあります' && notes[0].tag === 'funergy-chat' && notes[0].title === 'Funergy+', notes);

// ---------------------------------------------------------------- まとめ
for (const [name, D] of [['GM', GM], ['Lee phone', LEE], ['Lee PC', LEE2], ['Cam', CAM], ['Sam', SAM]]) ok(name + ': no page errors', D.errors.length === 0, D.errors.slice(0, 3));
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
await browser.close(); W.close();
process.exit(ng.length ? 1 : 0);
