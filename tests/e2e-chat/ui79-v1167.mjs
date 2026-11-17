// v1167（UI案79）：チャット改修を本物のブラウザ（Chrome）と本物の work-requests（SQL・handler・PGlite）で通す。合成データだけ（作りものの人・店・金額）。本番にはつながない。
// 完了の条件（依頼書）①〜⑤ のうち、この環境で確かめられるもの：
//  ① DM（Lee Two ↔ Gabe Gm）は Cam Crew と CEO に出ない・添付のリンクも取れない
//  ② 申請から Lee Two・Gabe Gm・Ann Acct（＋ Sam Three）のチャット → もう一度開くと同じ会話 → 2 人に同時に @
//  ③ PC（1280px）で年間計画を開いたまま右下の「チャット」→ パネル → 別ウィンドウ（いつも前面が使えなければ、ふつうの別ウィンドウ）→
//     画面の写真を貼り付けて丸と矢印・説明「この累計差は何月からですか？」→ スマホ（390px）で拡大・返信。PC の業務の入力は残る。スマホも画面・下書きが戻る
//  ④ メンバー削除（外された GM の別ウィンドウから会話が消え、サーバーも断る）・今すぐロック・違う PIN・ログインの PIN で続ける・ログアウトで別ウィンドウも閉じる（個人の PIN・グループのキーは v1168）
// 使い方：VENDOR_DIR=/tmp/e2e/vendor CERT_DIR=/tmp/e2e/cert [SHOTS=/tmp/ui79shots] node tests/e2e-chat/ui79-v1167.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
process.env.WR_UI79 = '1';
const { startWorld } = await import('../e2e-wr/world.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const W = await startWorld({ vendor: process.env.VENDOR_DIR, cert: process.env.CERT_DIR, appPort: 8093 });
const ARGS = ['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1', '--ignore-certificate-errors'];
const browser = await chromium.launch({ headless: true, args: ARGS, executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || '';
const results = [];
const ok = (name, cond, info) => { results.push({ name, ok: !!cond, info }); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }).catch(() => {}); } };

async function device(width, height, touch) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, serviceWorkers: 'block', hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: touch ? 2 : 1 });
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
  await pinStep(page); await page.fill('#login-pin-input', '1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(() => window._heavyPending === false, null, { timeout: 120000 }).catch(() => {});
  await sleep(4500);   // チャットはログインの 3 秒あと
}
const api = (D, body) => D.page.evaluate(b => chatAPI(b).then(j => ({ ok: true, j }), e => ({ ok: false, code: e.code, status: e.status })), body);

const PC = await device(1280, 800, false);
const PH = await device(390, 844, true);
const CC = await device(1280, 800, false);   // Cam Crew（関係のない人）
const CE = await device(1280, 800, false);   // CEO
await login(PC, 'OFFICE', 'Gabe Gm');
await login(PH, 'F01', 'Lee Two');
await login(CC, 'F01', 'Cam Crew');
await login(CE, 'OFFICE', 'Cora Ceo');
const pip = await PC.page.evaluate(() => !!window.documentPictureInPicture);
ok('environment: Document Picture-in-Picture in this Chrome', true, { pip, ua: await PC.page.evaluate(() => navigator.userAgent.replace(/\s+/g, ' ').slice(0, 120)) });

// ---------------------------------------------------------------- ③ PC：年間計画を開いたまま
await PC.page.evaluate(() => { _apMetric = 'sales'; budgetTab = 'annual'; go('budget'); });
await sleep(1500);
const fabPC = await PC.page.evaluate(() => { const b = document.getElementById('chat-fab'); return b && !b.hidden ? b.innerText.trim() : null; });
ok('③ PC: a chat button on the annual plan screen (count only)', fabPC && /チャット/.test(fabPC), fabPC);
// 業務の入力（年間計画の画面の上に、入力中の欄があるとする）
await PC.page.evaluate(() => { const i = document.createElement('input'); i.id = 'biz-note'; i.value = '7月の差を確認中'; (document.getElementById('main-content')).prepend(i); });
const scroll0 = await PC.page.evaluate(() => { window.scrollTo(0, 120); return window.scrollY; });
await PC.page.click('#chat-fab'); await sleep(800);
const panel = await PC.page.evaluate(() => { const f = document.getElementById('chat-float'); const r = f && f.getBoundingClientRect(); return f && !f.hidden ? { cls: f.className, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null; });
ok('③ PC: the panel opens over the annual plan (the screen stays)', panel && /panel/.test(panel.cls), panel);
ok('③ PC: the business input and scroll stay', await PC.page.evaluate(() => document.getElementById('biz-note').value === '7月の差を確認中' && /年間計画|Annual/.test(document.getElementById('main-content').innerText)), { scroll0 });
// DM を始める（Lee Two へ）
await PC.page.evaluate(() => chatNew('dm')); await sleep(500);
await PC.page.evaluate(() => { const r = [...document.querySelectorAll('#chat-new-list .chat-row')].find(x => /Lee Two/.test(x.innerText)); r && r.click(); });
await sleep(1200);
const head = await PC.page.evaluate(() => (document.getElementById('chat-head') || {}).innerText || '');
ok('③ PC: the destination and member count are shown in a small panel', /送り先：Lee Two ・ 参加者 2 人/.test(head), head.replace(/\s+/g, ' '));
// 動かす・大きさを変える
const bar = await PC.page.locator('#chat-fbar .chat-fbar-t').boundingBox();
await PC.page.mouse.move(bar.x + 30, bar.y + 10); await PC.page.mouse.down(); await PC.page.mouse.move(bar.x - 300, bar.y - 60, { steps: 6 }); await PC.page.mouse.up();
const rz = await PC.page.locator('#chat-rz').boundingBox();
await PC.page.mouse.move(rz.x + 8, rz.y + 8); await PC.page.mouse.down(); await PC.page.mouse.move(rz.x + 120, rz.y + 40, { steps: 6 }); await PC.page.mouse.up();
const moved = await PC.page.evaluate(() => { const r = document.getElementById('chat-float').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
ok('③ PC: the panel can be moved and resized', moved.x < panel.x - 200 && moved.w > panel.w + 80, moved);
await PC.page.click('#chat-fbar button[onclick="chatPin()"]'); await sleep(200);
ok('③ PC: pin on top inside the app', await PC.page.evaluate(() => /pinned/.test(document.getElementById('chat-float').className) && getComputedStyle(document.getElementById('chat-float')).zIndex === '10050'));
await PC.page.click('#chat-fbar button[onclick="chatPin()"]'); await sleep(200);
await shot(PC.page, '01_pc_panel_on_annual_plan.png');

// 画面の写真を貼り付ける（本物の ClipboardEvent・本物の canvas）
const png = await PC.page.screenshot({ type: 'png', clip: { x: 0, y: 90, width: 760, height: 420 } });
await PC.page.evaluate(b64 => {
  const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const f = new File([u], 'annual-plan.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  const ta = document.getElementById('chat-ta'); ta.focus();
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, png.toString('base64'));
await PC.page.waitForFunction(() => !!document.getElementById('chat-shot-cv') && document.getElementById('chat-shot-cv').width > 10, null, { timeout: 10000 }).catch(() => {});
const shotOk = await PC.page.evaluate(() => { const l = document.getElementById('chat-layer'); return l && !l.hidden ? l.innerText.replace(/\s+/g, ' ') : ''; });
ok('③ PC: ⌘V/Ctrl+V of a screenshot opens “send an image” (preview, circle, arrow, undo, clear, note)', /画像を送る（Lee Two へ）/.test(shotOk) && /丸/.test(shotOk) && /矢印/.test(shotOk) && /元に戻す/.test(shotOk) && /印を全部消す/.test(shotOk), shotOk.slice(0, 120));
const cv = await PC.page.locator('#chat-shot-cv').boundingBox();
// 丸
await PC.page.mouse.move(cv.x + cv.width * 0.18, cv.y + cv.height * 0.2); await PC.page.mouse.down(); await PC.page.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.5, { steps: 8 }); await PC.page.mouse.up();
// 矢印
await PC.page.evaluate(() => chatShotTool('arrow'));
const cv2 = await PC.page.locator('#chat-shot-cv').boundingBox();
await PC.page.mouse.move(cv2.x + cv2.width * 0.85, cv2.y + cv2.height * 0.85); await PC.page.mouse.down(); await PC.page.mouse.move(cv2.x + cv2.width * 0.55, cv2.y + cv2.height * 0.55, { steps: 8 }); await PC.page.mouse.up();
// もう 1 本 → 元に戻す
const cv3 = await PC.page.locator('#chat-shot-cv').boundingBox();
await PC.page.mouse.move(cv3.x + 10, cv3.y + 10); await PC.page.mouse.down(); await PC.page.mouse.move(cv3.x + 60, cv3.y + 60, { steps: 4 }); await PC.page.mouse.up();
await PC.page.evaluate(() => chatShotUndo());
const marks = await PC.page.evaluate(() => _chatShot().marks.map(m => m.t));
ok('③ PC: a circle and an arrow drawn with the mouse, the third undone', JSON.stringify(marks) === '["circle","arrow"]', marks);
await PC.page.fill('#chat-shot-desc', 'この累計差は何月からですか？');
await PC.page.evaluate(() => chatShotDesc(document.getElementById('chat-shot-desc').value));
await shot(PC.page, '02_pc_image_marks.png');

// 別ウィンドウ（いつも前面 → 無ければふつうの別ウィンドウ）。画像と印と説明を引き継ぐ
let extKind = null, extPage = null;
const popupP = PC.ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
await PC.page.click('#chat-fbar button[onclick="chatDetach()"]').catch(() => {});
await sleep(1500);
extKind = await PC.page.evaluate(() => { try { return document.getElementById('chat-float').closest('body') === document.body ? 'panel' : 'ext'; } catch (e) { return 'gone'; } });
extPage = await popupP;
const extInfo = extPage ? await extPage.evaluate(() => ({ title: document.title, bar: (document.getElementById('chat-fbar') || {}).innerText || '', shot: !!document.getElementById('chat-shot-cv'), desc: (document.getElementById('chat-shot-desc') || {}).value || '' })).catch(e => ({ err: String(e) })) : null;
ok('③ PC: the separate window opens with the image, marks and note carried over (or stays a panel)', extPage ? (/チャット/.test(extInfo.title) && extInfo.shot && extInfo.desc === 'この累計差は何月からですか？') : extKind === 'panel',
  { pipApi: pip, opened: extPage ? 'window' : 'none', where: extKind, ext: extInfo });
if (extPage) await extPage.screenshot({ path: SHOTS ? path.join(SHOTS, '03_pc_separate_window.png') : '/dev/null' }).catch(() => {});
const sendIn = extPage || PC.page;
await sendIn.evaluate(() => chatShotSend()); await sleep(2500);
const sentRow = (await W.q(`select m.body, (select count(*)::int from public.chat_files f where f.message_id = m.id and f.status = 'sent') files from public.chat_messages m order by m.created_at desc limit 1`))[0];
ok('③ PC: one message with the photo and the note', sentRow && sentRow.body === 'この累計差は何月からですか？' && sentRow.files === 1, sentRow);
ok('③ PC: the business input is still there after sending', await PC.page.evaluate(() => document.getElementById('biz-note').value === '7月の差を確認中'));
const sendMeta = await sendIn.evaluate(() => (document.getElementById('chat-msgs') || {}).innerText || '');
ok('③ PC: no “not sent” left', !/送れませんでした/.test(sendMeta));

// ---------------------------------------------------------------- ③ スマホ：下から半画面・拡大・返信・下書きと画面が戻る
await PH.page.evaluate(() => go('mypage')); await sleep(1200);
const phScroll = await PH.page.evaluate(() => { window.scrollTo(0, 300); return Math.round(window.scrollY); });
await PH.page.tap('#chat-fab'); await sleep(900);
const sheet = await PH.page.evaluate(() => { const f = document.getElementById('chat-float'), r = f.getBoundingClientRect(); return { cls: f.className, top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight }; });
ok('③ phone: the chat opens as a half sheet from the bottom', /sheet/.test(sheet.cls) && sheet.h < sheet.vh * 0.7 && sheet.top > sheet.vh * 0.3, sheet);
await PH.page.evaluate(() => chatRetrySync()); await sleep(1200);
const dmId = await PH.page.evaluate(() => { const s = _chatState(); return Object.keys(s.threads).find(k => s.threads[k].kind === 'dm'); });
await PH.page.evaluate(id => chatOpen(id), dmId); await sleep(1500);
await shot(PH.page, '04_phone_half_sheet.png');
await PH.page.waitForFunction(() => !!document.querySelector('#chat-msgs .chat-ph-i img[src^="https://"]'), null, { timeout: 8000 }).catch(() => {});
await PH.page.tap('#chat-msgs .chat-ph-i'); await sleep(1500);
const viewer = await PH.page.evaluate(() => { const v = document.getElementById('chat-viewer'); const im = document.getElementById('chat-vw-img'); const r = v && v.getBoundingClientRect(); return v ? { full: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, bg: getComputedStyle(v).backgroundColor, img: !!(im && im.naturalWidth > 0), reply: /返信する/.test(v.innerText) } : null; });
ok('③ phone: the photo opens dark and full screen, with reply', viewer && viewer.full && viewer.img && viewer.reply, viewer);
// 2 回たたいて拡大
const st = await PH.page.locator('#chat-vw-stage').boundingBox();
await PH.page.mouse.click(st.x + st.width / 2, st.y + st.height / 2); await sleep(80); await PH.page.mouse.click(st.x + st.width / 2, st.y + st.height / 2); await sleep(300);
const zoomed = await PH.page.evaluate(() => (document.getElementById('chat-vw-img') || {}).style.transform || '');
ok('③ phone: double tap zooms in', /scale\(2\.5\)/.test(zoomed), zoomed);
await shot(PH.page, '05_phone_viewer_zoom.png');
await PH.page.tap('.chat-vw-bot .btn-primary'); await sleep(400);
await PH.page.fill('#chat-ta', '7月からです（店の共通設定の月を除く）');
await PH.page.evaluate(() => chatInput(document.getElementById('chat-ta')));
await PH.page.evaluate(() => chatSend()); await sleep(1500);
const reply = (await W.q(`select body from public.chat_messages order by created_at desc limit 1`))[0];
ok('③ phone: the reply is sent', reply && /7月から/.test(reply.body), reply);
// 下書き → 閉じる → 業務の画面とスクロールはそのまま → 開くと下書きが戻る
await PH.page.fill('#chat-ta', '書きかけのメモ'); await PH.page.evaluate(() => chatInput(document.getElementById('chat-ta')));
await PH.page.evaluate(() => chatSheet(true)); await sleep(300);
const fullSheet = await PH.page.evaluate(() => { const r = document.getElementById('chat-float').getBoundingClientRect(); return Math.round(r.top) <= 1 && Math.round(r.height) >= innerHeight - 2; });
ok('③ phone: expand to full screen', fullSheet);
await PH.page.evaluate(() => chatSheet(false)); await sleep(200);
await PH.page.evaluate(() => chatMin()); await sleep(300);
const back = await PH.page.evaluate(() => ({ y: Math.round(window.scrollY), page: curPage, sheetHidden: document.getElementById('chat-float').hidden, bodyEmpty: document.getElementById('chat-fbody').innerHTML === '' }));
ok('③ phone: closing returns to the same screen and scroll; nothing of the chat stays on the screen', back.page === 'mypage' && Math.abs(back.y - phScroll) <= 2 && back.sheetHidden && back.bodyEmpty, { ...back, phScroll });
await PH.page.tap('#chat-fab'); await sleep(700);
ok('③ phone: the draft comes back', await PH.page.evaluate(() => (document.getElementById('chat-ta') || {}).value === '書きかけのメモ'));
await shot(PH.page, '06_phone_draft_back.png');
await PH.page.evaluate(() => chatMin());

// ---------------------------------------------------------------- ① DM はほかの人に出ない・添付のリンクも取れない
const fileId = (await W.q(`select id from public.chat_files where status = 'sent' order by sent_at desc limit 1`))[0].id;
for (const [D, who] of [[CC, 'Cam Crew'], [CE, 'CEO']]) {
  const sy = await api(D, { action: 'chat_sync', since: 0 });
  ok('① ' + who + ': the DM is not in the list', sy.ok && !sy.j.threads.some(t => t.id === dmId), { n: sy.ok ? sy.j.threads.length : sy.code });
  const m = await api(D, { action: 'chat_messages', thread: dmId });
  ok('① ' + who + ': reading the DM is refused', !m.ok && m.status === 404, m.code);
  const fu = await api(D, { action: 'chat_file_url', id: fileId });
  ok('① ' + who + ': the photo link is refused', !fu.ok && (fu.status === 404 || fu.status === 403), fu.code);
}

// ---------------------------------------------------------------- ② 申請のチャット：参加者を選んで作る・同じ会話・同時に @
const sub = await api(PH, { action: 'submit', kind: 'reimburse', store_id: 'F01', client_key: 'wr-e2e-ui79-0001', payload: { date: '2026-11-10', payer: 'Lee Two', payer_is_employee: true, vendor: 'Costco 1167', purpose: '仕入れ', amount_cents: 12000 } });
ok('② Lee Two submits a reimbursement', sub.ok, sub.ok ? sub.j.code : sub.code);
await PH.page.evaluate(id => chatOpenCase(id), sub.j.id); await sleep(1200);
const startDlg = await PH.page.evaluate(() => (document.getElementById('chat-case') || {}).innerText || '');
ok('② the first opener sees the related people already picked', /この申請のチャットを始める/.test(startDlg) && /Gabe Gm/.test(startDlg) && /Ann Acct/.test(startDlg), startDlg.replace(/\s+/g, ' ').slice(0, 200));
await shot(PH.page, '07_phone_case_start.png');
await PH.page.evaluate(() => { chatCaseSel('e12', true); chatCaseSel('e1', false); chatCaseCreate(); }); await sleep(1500);
const caseId = await PH.page.evaluate(() => _chatState().open);
const mem = (await W.q(`select emp_id, admin from public.chat_members where thread_id = $1 and left_at is null order by emp_id`, [caseId]));
ok('② members: Lee Two (manager), Gabe Gm, Ann Acct, Sam Three; not the CEO', JSON.stringify(mem.map(m => m.emp_id + (m.admin ? '*' : ''))) === JSON.stringify(['e11*', 'e12', 'e2', 'e3']), mem);
await PH.page.fill('#chat-ta', '@Gabe Gm @Ann Acct 領収書を付けました');
await PH.page.evaluate(() => { const s = _chatState(); s.ment[s.open] = { e2: 'Gabe Gm', e3: 'Ann Acct' }; chatSend(); }); await sleep(1500);
const ment = (await W.q(`select mentions from public.chat_messages where thread_id = $1 order by seq desc limit 1`, [caseId]))[0];
ok('② one message mentions two people at once', ment && JSON.stringify([...ment.mentions].sort()) === '["e2","e3"]', ment);
await PC.page.evaluate(id => chatOpenCase(id), sub.j.id); await sleep(1500);
const pcCase = await PC.page.evaluate(() => _chatState().open);
ok('② the GM opening the request gets the same conversation', pcCase === caseId, { pcCase, caseId });
await CE.page.evaluate(id => chatOpenCase(id), sub.j.id); await sleep(1200);
ok('② the CEO (sees the request, not a member) gets no chat and no start dialog', await CE.page.evaluate(() => _chatState().open === '' && !document.getElementById('chat-case')));
const threads = (await W.q(`select count(*)::int n from public.chat_threads where ref_id = $1`, [sub.j.id]))[0].n;
ok('② one chat for the request', threads === 1, threads);

// ---------------------------------------------------------------- ④ メンバー削除：外された人の画面（別ウィンドウも）から消え、サーバーも断る
const rm = await api(PH, { action: 'chat_remove', thread: caseId, emp: 'e2' });
ok('④ the manager removes Gabe Gm from the request chat', rm.ok, rm.code);
await PC.page.evaluate(() => chatRetrySync()); await sleep(1500);
const goneSt = await PC.page.evaluate(id => ({ open: _chatState().open, row: !!_chatState().threads[id], msgs: !!_chatState().msgs[id] }), caseId);
const goneText = await (extPage || PC.page).evaluate(() => /領収書を付けました/.test((document.getElementById('chat-root') || {}).innerText || ''));
ok('④ removed: the chat closes (in the separate window too) and its messages are gone', goneSt.open !== caseId && !goneSt.row && !goneSt.msgs && !goneText, { ...goneSt, goneText });
const again = await api(PC, { action: 'chat_messages', thread: caseId, limit: 10 });
ok('④ removed: the server refuses reading it', !again.ok && again.status === 404, again.code);

// ---------------------------------------------------------------- ④ 今すぐロック・PIN・ログアウト
const lockIn = extPage || PC.page;
await lockIn.evaluate(() => chatLockNow()); await sleep(500);
const locked = await lockIn.evaluate(() => { const r = document.getElementById('chat-root'); return r ? { text: r.innerText.replace(/\s+/g, ' ').slice(0, 160), msgs: !!document.getElementById('chat-msgs') } : null; });
ok('④ lock now hides the chat (no messages on the screen)', locked && /ロック中（Gabe Gm）/.test(locked.text) && !locked.msgs, locked);
if (extPage) await extPage.screenshot({ path: SHOTS ? path.join(SHOTS, '08_pc_locked_window.png') : '/dev/null' }).catch(() => {});
else await shot(PC.page, '08_pc_locked.png');
await lockIn.fill('#chat-lock-pin', '9999'); await lockIn.evaluate(() => chatUnlock()); await sleep(700);
ok('④ a wrong login PIN does not unlock', await lockIn.evaluate(() => /PIN が違います/.test(document.getElementById('chat-root').innerText)));
await lockIn.fill('#chat-lock-pin', '1234'); await lockIn.evaluate(() => chatUnlock()); await sleep(900);
ok('④ the login PIN unlocks (checked by the server)', await lockIn.evaluate(() => !!document.getElementById('chat-msgs') || !!document.getElementById('chat-list')), W.authCalls.slice(-2));
await PC.page.evaluate(() => doLogout()); await sleep(1200);
const after = await PC.page.evaluate(() => ({ fab: (document.getElementById('chat-fab') || { hidden: true }).hidden, float: (document.getElementById('chat-float') || { hidden: true }).hidden, body: (document.getElementById('chat-fbody') || { innerHTML: '' }).innerHTML.length }));
ok('④ logout hides the panel and the button and keeps nothing of the chat on the screen', after.fab && after.float && after.body === 0, after);
if (extPage) ok('④ logout closes the separate window', extPage.isClosed() || await extPage.evaluate(() => !document.getElementById('chat-float')).catch(() => true));

// ---------------------------------------------------------------- まとめ
for (const [name, D] of [['PC', PC], ['phone', PH], ['crew', CC], ['CEO', CE]]) ok(name + ': no page errors', D.errors.length === 0, D.errors.slice(0, 3));
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length}/${results.length} OK`);
await browser.close(); W.close();
process.exit(ng.length ? 1 : 0);

// v1185：GM・CEO・経理は名前を選ぶとメールとパスワードの段が出る。試しのあいだは「PIN でログイン」で今までどおり PIN の段へ（ほかの人は何もしない）
async function pinStep(page) {
  const mail = await page.evaluate(() => { const m = document.getElementById('login-step-mail'); return !!(m && m.style.display !== 'none'); }).catch(() => false);
  if (mail) await page.click('#ml-pin');
}
