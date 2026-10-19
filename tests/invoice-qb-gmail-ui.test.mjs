// QuickBooks からすぐ（アプリ v1094・Moto 2026-10-18・UI案56）— the app side. The real code from index.html in a VM: the status card,
// the Gmail connection, the notices switches, the single invoice's forwarding block, the app notices and the return from Google.
// The end-to-end part runs the screen against the real invoice-intake handler and SQL (PGlite) with a stand-in Gmail. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL(process.env.FUNERGY_INDEX || '../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return html.slice(i, j); };
const MOD = cut('/* ===================================================================== v1094（UI案56', 'async function invInRetry(fileId){');
const bodyOf = name => { let i = html.indexOf('\nfunction ' + name + '('); if (i < 0) i = html.indexOf('\nasync function ' + name + '('); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n}', i) + 2); };
const varOf = name => { const i = html.indexOf('\nvar ' + name + ' = '); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n};', i) + 3); };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function app({ role = 'office', api = null, lang = 'ja', config = null, notifs = [], cloud = null } = {}) {
  const mem = { notifications: notifs };
  const c = {
    calls: [], toasts: [], modals: [], renders: 0, curLang: lang, curRole: role, curStoreLogin: null, location: { search: '', pathname: '/', hash: '', href: '' },
    history: { replaceState: (a, b, u) => { c.replaced = u; c.location.search = ''; } }, sessionStorage: { setItem: () => {} },
    window: { location: { set href(v) { c.navigated = v; } } },
    escapeHtml: esc, t: (ja, en) => (c.curLang === 'en' ? en : ja),
    ls: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), lsSet: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); return true; },
    getNotifs: () => (mem.notifications || []).slice(), renderNotifBell: () => {}, mem,
    showToast: (m, k) => c.toasts.push([m, k]), openModal: h => { c.modals.push(h); }, closeModalDirect: () => {},
    invInRerender: () => { c.renders++; }, invInStoreHtml: id => '<span>' + esc(id) + '</span>', invInId: v => String(v), invInTime: v => String(v || '—'),
    invInSaveSetting: async (k, v) => { c.calls.push({ action: 'settings_save', key: k, value: v }); },
    invInCanEdit: () => ['ceo', 'gm', 'office', 'office_crew'].includes(c.curRole),
    _invIn: { loaded: {}, config, busy: false }, _acCat: 'dash', _acSub: 'dash', go: p => { c.went = p; },
    invInDo: async (fn, ok) => { try { const r = await fn(); if (ok) c.toasts.push([ok, 'success']); return r; } catch (e) { c.toasts.push([String(e.message), 'warning']); throw e; } },
    invInAPI: async body => { c.calls.push(JSON.parse(JSON.stringify(body))); const r = api ? await api(body, c) : {}; if (r && r.__error) throw new Error(r.__error); return r; },
    _fetchOpValue: async k => (k === 'invoice_qb_alerts' ? cloud : null), document: { visibilityState: 'visible' },
    setTimeout: f => { (c.later = c.later || []).push(f); return 0; }, setInterval: () => 1, clearInterval: () => {}, Date, JSON, Number, String, Object, Array, Promise, isNaN,
  };
  vm.createContext(c);
  vm.runInContext([varOf('INVIN_ERR'), bodyOf('invInL'), bodyOf('invInChip'), 'var INVIN_COL = { green:"#15A66A", yel:"#B7791F", red:"#D64545", blue:"#0E78C4", gray:"#7a7a72", org:"#F0661F" };',
    bodyOf('invInRouteText'), bodyOf('invInQbSinceLocal'), bodyOf('invInQbSinceText'), bodyOf('invInHstLocal'), bodyOf('invQbApplyNotifFocus'), MOD].join('\n'), c);
  c.fn = n => vm.runInContext(n, c);
  c.run = async () => { for (let k = 0; k < 4; k++) { const l = c.later || []; c.later = []; for (const f of l) await f(); await new Promise(r => setImmediate(r)); } };
  return c;
}

const ROW = (o = {}) => ({ id: 'o1', route: 'invoice-intake', state: 'sent', attempts: 1, next_at: null, last_error: null, message_id: '18f3a91b0c7d2e55',
  created_at: '2026-10-19T19:12:06Z', reserved_at: '2026-10-19T19:12:07Z', sent_at: '2026-10-19T19:12:10Z', updated_at: '2026-10-19T19:12:10Z', result: { via: 'gmail' },
  store_id: 'F06', current_name: '2026-10-18_Aloha-Produce_48213.pdf', drive_file_id: 'F1', renamed_at: '2026-10-19T19:12:06Z', posted_at: '2026-10-19T19:12:04Z', ...o });
const STATUS = (o = {}) => ({ counts: { 'invoice-intake': { sent: 3, pending: 1, sending: 1, unknown: 1, error: 1 }, external: { sent: 125, pending: 3 } },
  stopped: 0, waiting_30: 0, external_waiting: 3, rows: [ROW(), ROW({ id: 'o2', state: 'unknown', message_id: null, sent_at: null, last_error: 'gmail_send_no_answer', current_name: '2026-10-18_Maui-Produce_33019.pdf' }),
    ROW({ id: 'o3', state: 'error', attempts: 2, next_at: '2026-10-19T19:45:00Z', message_id: null, sent_at: null, last_error: 'gmail_send_429_rateLimitExceeded' }),
    ROW({ id: 'o4', state: 'cancelled', last_error: 'content_changed', message_id: null, sent_at: null }),
    ROW({ id: 'o5', route: 'external', state: 'pending', message_id: null, sent_at: null, reserved_at: null })],
  notices_failed: 0, gmail: { status: 'ok', account: 'sender@example.test', from: 'sender@example.test', from_ok: true }, qb: { route: 'invoice-intake', enabled: true, to: 'funergy+expenses@assist.intuit.com', since: '2026-10-13T07:00:00-10:00' }, ...o });

test('取込状況: chips, rows with 反映 → 名前 → 台帳 → 送信開始 → 送信済み and the Gmail ID, unknown has 「Gmail の送信済みを調べる」', () => {
  const c = app();
  c._invIn.qbs = STATUS();
  const h = c.fn('invInQbCard({ qb_settings:{} }, null)');
  assert.match(h, /送る担当：<b>このシステム（送り元の Gmail から、台帳に積んだらすぐ送る）/);
  assert.match(h, /送り元の Gmail：.*つながっています.*sender@example\.test/);
  for (const chip of ['送信済み 128', '待ち 1', '送信中 1', '結果不明 1', 'エラー 1', '前の転送の残り 3']) assert.ok(h.includes(chip), chip);
  assert.match(h, /メール送信済み/); assert.match(h, /反映 10\/19 09:12:04 → 名前 09:12:06 → 台帳 09:12:06 → 送信開始 09:12:07 → 送信済み 09:12:10/);
  assert.match(h, /Gmail ID <span[^>]*>18f3a91b0c7d2e55/);
  assert.match(h, /結果不明[\s\S]*Gmail から答えがありませんでした[\s\S]*invInQbLookup\('o2'\)[\s\S]*Gmail の送信済みを調べる[\s\S]*確かめて、もう一度送る/);
  assert.match(h, /やり直し 2 \/ 5 · 次 09:45:00：Gmail が混んでいました/);
  assert.match(h, /原本が差し替わっていた（送っていない）/);
  assert.match(h, /前の転送（ChatGPT）/);
  assert.match(h, /QuickBooks に取り込まれたか・記帳・銀行照合は QuickBooks で確かめてください/);
  assert.ok(!/記帳済み|取り込み済み|受信済み/.test(h), 'nothing claims QuickBooks took it in');
  // a role that cannot act sees no buttons; English
  const v = app({ role: 'am' }); v._invIn.qbs = STATUS();
  assert.ok(!/invInQbLookup/.test(v.fn('invInQbCard({ qb_settings:{} }, null)')));
  const en = app({ lang: 'en' }); en._invIn.qbs = STATUS();
  assert.match(en.fn('invInQbCard({ qb_settings:{} }, null)'), /Search the sent mail[\s\S]*Email sent/);
  // an older server (no qb_status): the counts it has, said plainly
  const o = app(); o._invIn.qbs = { error: 'unknown_action' };
  assert.match(o.fn('invInQbCard({ qb:{ sent:4, pending:1 }, qb_settings:{} }, null)'), /送信済み 4[\s\S]*v1094 の前/);
  // another failure is not called an older server; while loading and on a failure the rename count stays (never 0 or "all fine")
  o._invIn.qbs = { error: 'network' };
  const fh = o.fn('invInQbCard({ qb:{ sent:4 }, qb_settings:{}, rename_waiting:3 }, null)');
  assert.match(fh, /名前を変える待ち 3[\s\S]*くわしい状況を読めませんでした（network）/); assert.doesNotMatch(fh, /v1094 の前/);
  o._invIn.qbs = null;
  assert.match(o.fn('invInQbCard({ qb:{ sent:4 }, qb_settings:{}, rename_waiting:3 }, null)'), /送信済み 4[\s\S]*名前を変える待ち 3[\s\S]*くわしい状況を読み込み中/);
  // waiting over 30 minutes, notices not delivered
  const w = app(); w._invIn.qbs = STATUS({ waiting_30: 2, notices_failed: 1 });
  assert.match(w.fn('invInQbCard({ qb_settings:{} }, null)'), /30 分以上 送れていない原本が 2 件[\s\S]*知らせ（メール・LINE）を送れなかったものが 1 件/);
});

test('設定: the Gmail connection (CEO・GM act, others see), the switch check, the notices switches', async () => {
  const S = { gmail: { status: 'ok', account: 'sender@example.test', from: 'sender@example.test', from_ok: true, send_scope: true, read_scope: true,
    check_result: { ok: true, search_ok: true, history_probe: { tried: true, found: true, name: '2026-10-01_VendorA_1.pdf' } }, checked_at: 'x' },
    qb_notify: { app: true, email: true, line: false } };
  const c = app({ role: 'gm', config: { settings: S } });
  let h = c.fn('invInGmailCard(' + JSON.stringify(S) + ', true)');
  assert.match(h, /つながっています/); assert.match(h, /<b>sender@example\.test<\/b>（送り元と同じ ✓）/);
  assert.match(h, /送信 ✓ · 読み取り（送信済みを調べる）✓/); assert.match(h, /送信済みの検索<\/span><span>できる/);
  assert.match(h, /送った原本を見つける<\/span><span>見つかった ✓（2026-10-01_VendorA_1\.pdf）/);
  assert.match(h, /invInGmailConnect\(\)[\s\S]*つなぎ直す[\s\S]*invInGmailCheck\(\)[\s\S]*invInGmailDisconnect\(\)/);
  assert.ok(!/refresh|token":/i.test(h));
  assert.ok(!/invInGmailConnect/.test(c.fn('invInGmailCard(' + JSON.stringify(S) + ', false)')), 'accounting only sees');
  h = c.fn('invInGmailCard({ gmail:{ status:"none", from:"sender@example.test" } }, true)');
  assert.match(h, /まだ[\s\S]*Gmail をつなぐ（Google の画面へ）/);
  h = c.fn('invInGmailCard({ gmail:{ status:"expired", account:"sender@example.test", from:"sender@example.test", from_ok:true, problem_at:"t", last_error:"gmail_auth_revoked" } }, true)');
  assert.match(h, /許可が切れました[\s\S]*送るのを止めています（待っている原本のやり直しの回数は使いません）。台帳に積むのは続ける[\s\S]*「確かめる」/);
  assert.match(c.fn('invInGmailCard({}, true)'), /v1094 の前/);
  // the check before the switch
  h = c.fn('invInRouteCheckHtml()');
  assert.match(h, /✓ 送り元の Gmail がつながっている（sender@example\.test）/); assert.match(h, /✓ つないだあと「確かめる」を押した：送信・読み取り・送信済みの検索/);
  assert.match(h, /✓ 前に送った原本を送信済みに見つけた（見つかった ✓/);
  // connected but not checked since (the callback's result has no ok), or the sent original not found: ✗ (the server refuses too)
  for (const cr of [{ search_ok: true }, { ok: true, search_ok: true, history_probe: { tried: true, found: false, name: 'x.pdf' } }]) {
    const u = app({ config: { settings: { gmail: { ...S.gmail, check_result: cr } } } });
    assert.match(u.fn('invInRouteCheckHtml()'), /✗ <\/span>/);
  }
  const nf = app({ config: { settings: { gmail: { ...S.gmail, check_result: { ok: true, search_ok: true, history_probe: { tried: true, found: false, name: 'x.pdf' } } } } } });
  assert.match(nf.fn('invInRouteCheckHtml()'), /見つかりませんでした（切り替えないで Claude に）/);
  const none = app({ config: { settings: { gmail: { ...S.gmail, check_result: { ok: true, search_ok: true, history_probe: { tried: false } } } } } });
  assert.doesNotMatch(none.fn('invInRouteCheckHtml()'), /✗/, 'nothing sent before: nothing to find');
  assert.match(none.fn('invInRouteCheckHtml()'), /まだ（送った原本が台帳にない）/);
  assert.match(h, /前の転送（ChatGPT）がそのまま送ります/);
  const bad = app({ config: { settings: { gmail: { status: 'none' } } } });
  assert.match(bad.fn('invInRouteCheckHtml()'), /✗ <\/span>送り元の Gmail/);
  // notices: three switches, GM・CEO change them
  h = c.fn('invInNotifyCard(' + JSON.stringify(S) + ', true)');
  assert.match(h, /type="checkbox" checked onchange="invInSaveSetting\('qb_notify',\{app:this\.checked\}\)"> アプリの通知/);
  assert.match(h, /type="checkbox" onchange="invInSaveSetting\('qb_notify',\{line:this\.checked\}\)"> LINE（本部業務連絡グループ）/);
  assert.match(c.fn('invInNotifyCard(' + JSON.stringify(S) + ', false)'), /disabled/);
  // つなぐ: to Google's page (the server makes the address)
  const g = app({ role: 'gm', api: b => (b.action === 'gmail_connect' ? { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } : {}) });
  await g.fn('invInGmailConnect()');
  assert.equal(g.navigated, 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
  // 切る asks first
  g.fn('invInGmailDisconnect()');
  assert.match(g.modals.at(-1), /Drive の連携と同じアプリのときは、外すと Drive の取込も止まるので外さないでください/);
});

test('1 件の画面: 反映 and QuickBooks への転送 apart; QuickBooks での取り込み is not claimed', () => {
  const c = app();
  const G = r => JSON.stringify({ doc: { status: 'posted' }, qb: r ? [r] : [], parts: [] });
  let h = c.fn('invInQbBlock(' + G(ROW()) + ')');
  assert.match(h, /QuickBooks への転送[\s\S]*メール送信済み[\s\S]*Gmail ID[\s\S]*台帳 09:12:06 → 送信開始 09:12:07 → 送信済み 09:12:10/);
  assert.match(h, /QuickBooks での取り込み：このシステムでは分かりません（QuickBooks で確かめる）/);
  h = c.fn('invInQbBlock(' + G(ROW({ state: 'error', attempts: 2, next_at: '2026-10-19T19:45:00Z', last_error: 'gmail_send_429' })) + ')');
  assert.match(h, /送信エラー[\s\S]*やり直し 2 \/ 5 · 次 09:45:00（自動）/);
  assert.match(c.fn('invInQbBlock(' + G(null) + ')'), /まだ台帳にありません（名前を変えてから積みます）/);
  assert.equal(c.fn('invInQbBlock({ doc:{ status:"review" }, qb:[] })'), '');
  // Codex (375a985, P2-1): an unknown send can be settled from the invoice itself (accounting, 事務Crew, GM, CEO), not only from the list
  h = c.fn('invInQbBlock(' + G(ROW({ id: 'u9', state: 'unknown', message_id: null, sent_at: null, last_error: 'gmail_send_no_answer' })) + ')');
  assert.ok(h.includes("invInQbLookup('u9')") && h.includes("invInQbResolve('u9','pending')") && h.includes("invInQbResolve('u9','sent')"));
  const am = app({ role: 'am' });
  assert.ok(!/invInQbLookup/.test(am.fn('invInQbBlock(' + G(ROW({ id: 'u9', state: 'unknown' })) + ')')));
});

// Codex (375a985, P2-1): what needs a person is listed apart from the recent rows, so an old unknown is never pushed out of sight.
test('取込状況: an old unknown (and a stopped row) stay with their buttons however many newer sends come after', () => {
  const c = app();
  const recent = Array.from({ length: 30 }, (_, i) => ROW({ id: 'n' + i, updated_at: '2026-10-19T20:' + String(i).padStart(2, '0') + ':00Z' }));
  const old = ROW({ id: 'old1', state: 'unknown', message_id: null, sent_at: null, last_error: 'gmail_send_no_answer', updated_at: '2026-10-10T19:00:00Z', current_name: 'old-unknown.pdf' });
  const stop = ROW({ id: 'old2', state: 'error', attempts: 5, message_id: null, sent_at: null, last_error: 'gmail_send_429', current_name: 'old-stopped.pdf' });
  c._invIn.qbs = STATUS({ rows: recent, open: [old, stop], open_total: 3 });
  const h = c.fn('invInQbCard({ qb_settings:{} }, null)');
  assert.match(h, /対応が要るもの 3 件（古い順）[\s\S]*old-unknown\.pdf[\s\S]*invInQbLookup\('old1'\)[\s\S]*old-stopped\.pdf[\s\S]*やり直し 5 回を使い切りました[\s\S]*ほか 1 件[\s\S]*最近の転送/);
  assert.equal((h.match(/invInQbLookup\('old1'\)/g) || []).length, 1, 'shown once even when it is also among the recent rows');
  c._invIn.qbs = STATUS({ rows: [old, ...recent], open: [old], open_total: 1 });
  assert.equal((c.fn('invInQbCard({ qb_settings:{} }, null)').match(/invInQbLookup\('old1'\)/g) || []).length, 1);
  // after a look-up or a decision the card and the open invoice are read again
  assert.match(bodyOf('invInQbResolveDo'), /delete _invIn\.loaded\.qbs; delete _invIn\.loaded\.doc;/);
});

test('アプリの通知 (CEO・GM): each notice once on any device, opening Invoice取込; nothing for other roles', async () => {
  const cloud = { v: 1, rows: [{ id: 'a2', kind: 'unknown', at: '2026-10-19T20:00:00Z', data: { name: '2026-10-18_Maui-Produce_33019.pdf' } },
    { id: 'a1', kind: 'first_sent', at: '2026-10-19T19:12:12Z', data: { name: '2026-10-18_Aloha-Produce_48213.pdf', message_id: '18f3a91b0c7d2e55' } },
    { id: 'x', kind: 'not_a_kind', at: '2026-10-19T19:00:00Z', data: {} }] };
  const c = app({ role: 'gm', cloud, notifs: [{ id: 'ntf_qb_a2', at: 't', readBy: [] }] });   // another device already added one
  c.fn('invQbAlertsPull()'); await c.run(); await new Promise(r => setImmediate(r));
  const ns = c.mem.notifications;
  assert.deepEqual(ns.map(n => n.id), ['ntf_qb_a2', 'ntf_qb_a1']);
  const n = ns[1];
  assert.equal(n.title, 'QuickBooks：このシステムから初めて送れました'); assert.match(n.text, /Aloha-Produce.*18f3a91b0c7d2e55/);
  assert.deepEqual(n.toRoles, ['ceo', 'gm']); assert.equal(n.page, 'acct_center'); assert.equal(n.invTab, 'dhealth');
  c.fn('invQbAlertsPull()'); await new Promise(r => setImmediate(r));
  assert.equal(c.mem.notifications.length, 2, 'once');
  c.fn('invQbApplyNotifFocus(' + JSON.stringify(n) + ')');
  assert.deepEqual([c._acCat, c._acSub], ['drive', 'dhealth']);
  for (const role of ['office', 'am', 'crew']) { const o = app({ role, cloud }); o.fn('invQbAlertsPull()'); await new Promise(r => setImmediate(r)); assert.equal((o.mem.notifications || []).length, 0, role); }
});

test('Google から戻ってきたとき: the result said, the URL cleaned, Invoice取込 › 設定 opened', async () => {
  for (const [code, re, kind] of [['ok', /Gmail をつなぎました/, 'success'], ['wrong_account', /送り元と違うアカウント/, 'warning'], ['scope_missing', /許可が足りません/, 'warning'], ['weird', /つなげませんでした（weird）/, 'warning']]) {
    const c = app({ role: 'gm' });
    c.location.search = '?invoice_gmail=' + code;
    c.fn('invInGmailReturn()'); await c.run();
    assert.equal(c.replaced, '/'); assert.match(c.toasts.at(-1)[0], re); assert.equal(c.toasts.at(-1)[1], kind);
    assert.deepEqual([c._acCat, c._acSub, c.went], ['drive', 'dsettings', 'acct_center']);
  }
  const n = app(); n.fn('invInGmailReturn()'); await n.run(); assert.equal(n.toasts.length, 0, 'nothing without the mark');
});

test('「Gmail の送信済みを調べる」: found → sent; not found → nothing changes and the person decides', async () => {
  let found = true;
  const c = app({ api: b => (b.action === 'qb_lookup' ? (found ? { found: true, message_id: 'm1' } : { found: false }) : {}) });
  await c.fn('invInQbLookup("o2")');
  assert.match(c.toasts.at(-1)[0], /見つけました。送信済みにしました（送り直していません）/);
  found = false;
  await c.fn('invInQbLookup("o2")');
  assert.match(c.toasts.at(-1)[0], /見つかりませんでした。原本を確かめて「確かめて、もう一度送る」/);
  assert.deepEqual(c.calls.map(x => x.action), ['qb_lookup', 'qb_lookup']);
  c._invIn.loaded = { qbs: 1, doc: 1, health: 1 };
  await c.fn('invInQbLookup("o2")');
  assert.deepEqual(c._invIn.loaded, {}, 'the card and the open invoice are read again');
});

test('the page wires it in: the status tab loads qb_status, the settings show Gmail and notices, the hooks run after login, v1094', () => {
  const health = bodyOf('invInHealth'), settings = bodyOf('invInSettings');
  assert.match(health, /invInLoad\('qbs', async function\(\)\{ try \{ _invIn\.qbs = await invInAPI\(\{ action:'qb_status' \}\)/);
  assert.match(health, /h \+= invInQbCard\(H, P\);/);
  assert.match(settings, /h \+= invInGmailCard\(S, admin\) \+ invInNotifyCard\(S, admin\);/);
  assert.match(bodyOf('invInRoute'), /route==='invoice-intake' \? invInRouteCheckHtml\(\)/);
  assert.match(bodyOf('invInDetail'), /\(oPick \? '' : invInQbBlock\(G\)\)/);
  assert.match(bodyOf('invInPost'), /res\.qb && res\.qb\.sending[\s\S]*QuickBooks へ送り始めました（画面を閉じても続きます）/);
  assert.match(bodyOf('invInPost'), /res\.qb && res\.qb\.waiting==='gmail'[\s\S]*Gmail の接続を直すまで待ちます/);
  assert.match(html, /try\{ invQbAlertsStart\(\); \}catch\(e\)\{\}[^\n]*\n\s+try\{ invInGmailReturn\(\); \}catch\(e\)\{\}/);
  assert.equal((html.match(/invQbApplyNotifFocus\(n\);/g) || []).length, 2);
  assert.match(html, /const APP_VERSION = '1094';/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /const SW_BUILD = '1094';/);
});
