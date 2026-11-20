// v1203（UI案98・段階 4・Moto さんの答え 1A・2A・4A・7B・8A）：G2〜CEO・本部のマイページを 6 つの段に。
// 本物の関数（index.html の v1203 のかたまり）を VM で動かす。申請の行（wrMyTodayHtml）は本物の画面のモジュール（FUNERGY_WR）を
// 本物の handler と本物の SQL（申請の本番の順＋承認・閲覧の共通ルール・PGlite）につなぐ。合成データだけ。仕様：docs/UNIFIED_UI_V1191_JA.md の 27。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { setup } from './approval-rules-world.mjs';

const html = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BLK = html.slice(html.indexOf('/* ===== v1203（UI案98・段階 4'), html.indexOf('function renderMypage() {'));
const MOD = html.slice(html.indexOf('/* ==== FUNERGY_WR（v1131'), html.indexOf('/* ==== FUNERGY_WR end ==== */'));
const ESC = html.slice(html.indexOf('function escapeHtml(s){'), html.indexOf('\n', html.indexOf('function escapeHtml(s){')));
const MYPAGE = html.slice(html.indexOf('function renderMypage() {'), html.indexOf('\n/* ============================================================\n   SETTINGS'));

function fakeEl(id) {
  let ih = ''; const attrs = {};
  return { id, style: {}, get innerHTML() { return ih; }, set innerHTML(v) { ih = v; }, getAttribute: k => (k in attrs ? attrs[k] : null), _attrs: attrs, scrolled: 0, scrollIntoView() { this.scrolled++; } };
}
function blk(over = {}) {
  const els = {};
  const ctx = {
    console, Math, JSON, Object, Array, String, Number, Date,
    curLang: 'ja', t: (ja, en) => (ctx.curLang === 'en' ? en : ja), tStatus: s => s,
    empSmIsPc: () => false, uiPcWatch1177: () => { ctx._watch = (ctx._watch || 0) + 1; },
    navGuardAllows: p => !(ctx._deny || []).includes(p), ls: (k, d) => (k in ctx._ls ? ctx._ls[k] : d), _ls: {},
    canSubmitExpense: () => false, canSubmitMileage: () => false, getExpenseRequests: () => [], getMileageRequests: () => [],
    FUNERGY_PV: null, STORES: [{ id: 'F01', name: 'Store A' }, { id: 'F02', name: 'Store B' }],
    empAnyStore: v => v === 'ALL' || /^office$/i.test(String(v || '')),
    DOW_SHIFT: ['日', '月', '火', '水', '木', '金', '土'], bizToday: () => '2026-11-19', isoDateStr: d => d.toISOString().slice(0, 10),   // 11/19 は木
    getWeekStr: () => '11/15', getShiftPlan: () => null, maybePullStaffShift: (st, w) => { (ctx._pulls = ctx._pulls || []).push(st + '|' + w); },
    document: { getElementById: id => els[id] || null, querySelector: sel => { const m = /data-mps="(\d+)"/.exec(sel); return m ? (els['sec' + m[1]] || null) : null; } },
    ...over,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ESC + '\n' + BLK, ctx);
  return { ctx, els };
}
const M = (c, o) => '<!--MPC:' + c + ':' + o + '-->', S = (s, o) => '<!--MPS:' + s + ':' + o + '-->';
const card = n => '<div class="card">' + n + '</div>';
// v1205 から：スマホの ④⑤⑥ は見出しがボタン（たたむ）。どちらの形でも段の番号・名前・カードを読む
const secsOf = h => [...h.matchAll(/<section class="mp-sec[^"]*" data-mps="(\d)"><h2 class="mp-sech">(?:<button[^>]*>)?<span class="mp-secn">.<\/span>([^<]*)(?:<i[^>]*><\/i><\/button>)?<\/h2>([\s\S]*?)<\/section>/g)]
  .map(m => ({ n: Number(m[1]), name: m[2], cards: [...m[3].matchAll(/<div class="card">([^<]*)<\/div>/g)].map(x => x[1]) }));

test('six sections: the current marks go to their section and order; an unknown mark stays (end of ⑤); empty sections are left out; the header stays first', () => {
  const { ctx } = blk();
  const body = '<div class="mypage-header">HEAD</div>'
    + M('g', 10) + card('focus') + M('g', 20) + card('lunch') + M('t', 10) + S(5, 20) + card('times') + M('g', 35) + card('nom')
    + M('w', 15) + card('help') + M('t', 20) + card('pin') + card('device') + M('g', 45) + card('ocs') + M('t', 30) + card('lang') + M('t', 40) + card('msg')
    + M('g', 40) + card('badges') + M('g', 30) + card('voice') + M('w', 10) + card('shift') + card('att') + M('w', 40) + card('goal')
    + M('g', 50) + card('skillprog') + M('g', 60) + card('cs') + M('g', 70) + card('journey') + M('g', 80) + card('radar') + M('w', 30) + card('pay')
    + S(2, 10) + card('req') + M('g', 90) + card('past') + M('x', 1) + card('stray') + S(9, 1) + card('stray2') + S(1, 10) + card('today') + M('g', 99) + '<!-- only a comment -->';
  const out = ctx.mpSecLayout(body);
  assert.ok(out.startsWith('<div class="mypage-header">HEAD</div><section'), 'header first, then the sections');
  assert.doesNotMatch(out, /<!--MP[CS]:/, 'no marks left');
  const s = secsOf(out);
  assert.deepEqual(s.map(x => x.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(s.map(x => x.name), ['今日やること', '申請', '仕事', '成長', '会社から', '自分の設定']);
  assert.deepEqual(s[0].cards, ['today', 'help']);
  assert.deepEqual(s[1].cards, ['req']);
  assert.deepEqual(s[2].cards, ['shift', 'att', 'pay', 'goal', 'focus']);
  assert.deepEqual(s[3].cards, ['nom', 'skillprog', 'cs', 'journey', 'radar', 'ocs', 'badges']);
  assert.deepEqual(s[4].cards, ['stray2', 'msg', 'times', 'lunch', 'voice', 'past', 'stray'], 'an unknown mark (x:1) or section (9) is not dropped: it goes to ⑤');
  assert.ok(out.indexOf('>stray<') > out.indexOf('>past<'));
  assert.deepEqual(s[5].cards, ['pin', 'device', 'lang']);
  // 英語の画面
  ctx.curLang = 'en';
  assert.deepEqual(secsOf(ctx.mpSecLayout(body)).map(x => x.name), ['Today', 'Requests', 'Work', 'Growth', 'From the company', 'My settings']);
  // 段が空なら出さない（③ が無い管理者）
  const mg = ctx.mpSecLayout('<div class="mypage-header"></div>' + S(2, 10) + card('req') + S(1, 10) + card('today') + S(4, 80) + card('pgd') + M('t', 20) + card('pin') + M('w', 10) + '  <!-- empty -->' + M('w', 30));
  assert.deepEqual(secsOf(mg).map(x => x.n), [1, 2, 4, 6]);
});

test('PC: two columns (left ① ② ③, right ④ ⑤ ⑥) in .mp-pc (the v1177 grid); phone: one column in order; the width watcher is on', () => {
  const { ctx } = blk({ empSmIsPc: () => true });
  const body = '<div class="mypage-header"></div>' + S(1, 10) + card('today') + S(4, 1) + card('grow') + S(2, 1) + card('req') + S(6, 1) + card('pin') + S(3, 1) + card('work') + S(5, 1) + card('co');
  const pc = ctx.mpSecLayout(body);
  const m = /<div class="mp-pc mp-pc6" data-pcv="pc"><div class="mp-col">([\s\S]*?)<\/div><div class="mp-col">([\s\S]*)<\/div><\/div>$/.exec(pc);
  assert.ok(m, pc);
  assert.deepEqual(secsOf(m[1]).map(x => x.n), [1, 2, 3]);
  assert.deepEqual(secsOf(m[2]).map(x => x.n), [4, 5, 6]);
  assert.ok(ctx._watch >= 1);
  const ph = blk().ctx.mpSecLayout(body);
  assert.doesNotMatch(ph, /mp-pc/);
  assert.deepEqual(secsOf(ph).map(x => x.n), [1, 2, 3, 4, 5, 6]);
});

test('① Today: today’s shift and a consultation reply are rows; nothing → “Nothing to do today”; only a help request → the card is hidden (the help card is in ①); the request rows come from the request module', () => {
  const { ctx, els } = blk();
  let h = ctx.mpTodayHtml({ shifts: ['Lunch Server', 'Dinner Host'], shiftGo: "go('shift_staff')", consult: 1, helps: 0 });
  assert.match(h, /今日のシフト[\s\S]*Lunch Server · Dinner Host[\s\S]*onclick="go\('shift_staff'\)"/);
  assert.match(h, /相談に返事があります[\s\S]*onclick="mpGoSec\(5\)"/);
  assert.match(h, /id="mp-today-none" style="display:none"/);
  h = ctx.mpTodayHtml({});
  assert.doesNotMatch(h, /mp-trow/); assert.match(h, /id="mp-today-none">今日やることはありません/);
  assert.doesNotMatch(h, /id="mp-today"[^>]*display:none/);
  h = ctx.mpTodayHtml({ helps: 2 });
  assert.match(h, /id="mp-today"[^>]*style="display:none"/, 'only the help card shows in ①');
  // 申請の行（読み込みのあとで描き直す）
  ctx.wrMyTodayHtml = () => ctx.mpTodayRow('申請の対応待ち 2 件', 'あなたの番', 'wrGoTodo()', '開く');
  h = ctx.mpTodayHtml({ helps: 1 });
  assert.match(h, /<div id="mp-today-wr"><div class="mp-trow">[\s\S]*申請の対応待ち 2 件[\s\S]*onclick="wrGoTodo\(\)"/);
  assert.doesNotMatch(h, /id="mp-today"[^>]*display:none/);
  // mpTodayPaint：あとから届いた行で「ありません」を消す・行が無くなったら戻す
  const c = els['mp-today'] = fakeEl('mp-today'); c._attrs['data-rows'] = '0'; c._attrs['data-helps'] = '0';
  els['mp-today-wr'] = fakeEl('mp-today-wr'); els['mp-today-none'] = fakeEl('mp-today-none');
  ctx.mpTodayPaint();
  assert.match(els['mp-today-wr'].innerHTML, /申請の対応待ち 2 件/); assert.equal(els['mp-today-none'].style.display, 'none'); assert.equal(c.style.display, '');
  ctx.wrMyTodayHtml = () => '';
  ctx.mpTodayPaint();
  assert.equal(els['mp-today-wr'].innerHTML, ''); assert.equal(els['mp-today-none'].style.display, '');
  c._attrs['data-helps'] = '1'; ctx.mpTodayPaint(); assert.equal(c.style.display, 'none');
  // 人の書いた文字はエスケープ
  assert.match(ctx.mpTodayRow('<b>x</b>', 'a"b', 'wrOpenMine(this.dataset.a)', '直す', 'R-1"x'), /&lt;b&gt;x&lt;\/b&gt;[\s\S]*a&quot;b[\s\S]*data-a="R-1&quot;x"/);
  // mpGoSec：その段へ
  els.sec5 = fakeEl('sec5'); ctx.mpGoSec(5); assert.equal(els.sec5.scrolled, 1);
});

test('my shifts (8A): only a published plan of my own store this week; HQ / all-store people get none; today’s rows by the business day', () => {
  const plan = { status: '公開済', cells: { '木_Lunch_Server': 'Wes Doi', '木_Dinner_Host': 'Wes Doi', '金_Lunch_Server': 'Wes Doi', '木_Lunch_Cook': 'Other' } };
  const { ctx } = blk({ getShiftPlan: (st, w) => (w === '11/15' ? plan : null) });   // どの店でも同じ表を返す（店の無い人に出さないのは店で決める）
  let r = ctx.mpMyShifts('Wes Doi', { store: 'F02' });
  assert.deepEqual([...r.keys].sort(), ['木_Dinner_Host', '木_Lunch_Server', '金_Lunch_Server']);
  assert.deepEqual([...r.today].sort(), ['Dinner Host', 'Lunch Server']);
  assert.equal(r.go, "go('shift_staff')");
  assert.deepEqual(ctx._pulls, ['F02|11/15'], 'reads the plan of my store');
  ctx._deny = ['shift_staff']; assert.equal(ctx.mpMyShifts('Wes Doi', { store: 'F02' }).go, "go('shift_admin')");
  ctx._deny = ['shift_staff', 'shift_admin']; assert.equal(ctx.mpMyShifts('Wes Doi', { store: 'F02' }).go, '');
  for (const st of ['ALL', 'OFFICE', '', 'F99']) assert.deepEqual(ctx.mpMyShifts('Wes Doi', { store: st }).keys.length, 0, st);
  assert.equal(ctx.mpMyShifts('Wes Doi', null).keys.length, 0);
  plan.status = '下書き'; assert.equal(ctx.mpMyShifts('Wes Doi', { store: 'F02' }).keys.length, 0, 'a draft plan is not shown');
  const h = ctx.mpShiftCardHtml(['木_Lunch_Server<x>']);
  assert.match(h, /今週のシフト/); assert.match(h, /Server&lt;x&gt;/); assert.doesNotMatch(h, /onclick="go\(/, 'no Details button when no shift page opens');
});

test('② one request card (4A): the server expense card (or the earlier entries), lost receipt and time off where the page opens, and my 2 newest time-off requests; nothing → no card', () => {
  const { ctx } = blk();
  ctx.wrMyExpCard = w => '<div class="card" id="wr-myexp" data-where="' + w + '"><div class="card-title">経費の申請</div>BTN</div>';
  ctx._ls.my_vacations = [{ employee: 'Me', startDate: '2026-10-01', endDate: '2026-10-02', status: '承認', type: '有給' },
    { employee: 'Other', startDate: '2026-11-01', endDate: '2026-11-01', status: '申請中' },
    { employee: 'Me', startDate: '2026-12-24', endDate: '2026-12-26', status: '申請中', type: '有給' }, { employee: 'Me', startDate: '2026-09-01', endDate: '2026-09-01', status: '却下' }];
  ctx._ls.my_vacations = [ctx._ls.my_vacations[3], ctx._ls.my_vacations[0], ctx._ls.my_vacations[1], ctx._ls.my_vacations[2]];
  let h = ctx.mpReqCardHtml('Me');
  assert.match(h, /^<div class="card mp-req" id="mp-req"><div class="card" id="wr-myexp" data-where="mypage">/, 'one card; its name is the section heading “② 申請”');
  assert.match(h, /data-mp-req="lost" onclick="openLostReceiptForm\(\)"/); assert.match(h, /data-mp-req="vacation" onclick="go\('vacation'\)"/);
  assert.deepEqual([...h.matchAll(/approval-title">([^<]*)</g)].map(m => m[1]), ['2026-12-24〜2026-12-26', '2026-10-01〜2026-10-02'], 'my 2 newest only (not others)');
  // 「画面の表示」で経費の申請を出さない → 前の入口（出せる人だけ）
  ctx.FUNERGY_PV = { cardShown: k => k !== 'exp' };
  ctx.canSubmitMileage = () => true; ctx.getMileageRequests = () => [{ employee: 'Me', date: '2026-11-02', purpose: '買い出し', status: '承認' }, { employee: 'X', date: '2026-11-03', purpose: 'x', status: '承認' }];
  h = ctx.mpReqCardHtml('Me');
  assert.doesNotMatch(h, /wr-myexp/); assert.match(h, /ガソリン代[\s\S]*onclick="go\('mileage'\)"[\s\S]*2026-11-02 買い出し/); assert.doesNotMatch(h, /事前経費申請/);
  ctx.canSubmitExpense = () => true; ctx.getExpenseRequests = () => [{ employee: 'Me', project: 'Party', total: 120, status: '申請中' }];
  h = ctx.mpReqCardHtml('Me'); assert.match(h, /事前経費申請[\s\S]*Party[\s\S]*\$120\.00[\s\S]*ガソリン代/);
  // 開けない画面のボタンは出さない（「画面の表示」などで紛失届の画面を開けない人）
  ctx._deny = ['lost_receipt']; h = ctx.mpReqCardHtml('Me'); assert.doesNotMatch(h, /data-mp-req="lost"/); assert.match(h, /data-mp-req="vacation"/);
  ctx._deny = ['lost_receipt', 'vacation']; ctx.canSubmitExpense = () => false; ctx.canSubmitMileage = () => false;
  assert.equal(ctx.mpReqCardHtml('Me'), '', 'nothing to send → no card');
});

test('renderMypage: G1 (crew) and the store account keep the v1177 layout; everyone else gets the six sections; the Staff ID card becomes a button on the name band (2A); the names stay (7B)', () => {
  assert.match(MYPAGE, /var _newF = curRole !== 'crew' && !\(typeof curStoreLogin !== 'undefined' && curStoreLogin\);/);
  assert.match(MYPAGE, /\$\{_newF\?`<button class="btn btn-sm mp-pass" onclick="openStaffPass\(\)">/);
  assert.match(MYPAGE, /if \(!_newF\) html \+= `<div class="card" style="display:flex;align-items:center;gap:10px;padding:12px;cursor:pointer" onclick="openStaffPass\(\)">/);
  assert.match(MYPAGE, /if \(_newF\) html \+= _ms\(5,20\);[^\n]*\n\s*try \{ if \(!window\.FUNERGY_PV \|\| FUNERGY_PV\.cardShown\('times'\)\) html \+= timesCardHtml\(\)/);
  // 管理者の側（G4 以上・本部）：② 申請・⑤ 会社から・③ 自分のシフト（8A）・① 今日やること・④ Personal Growth Dashboard（名前はそのまま）
  const mg = MYPAGE.slice(MYPAGE.indexOf('  if (!isCrewView) {\n    /* v1203'), MYPAGE.indexOf('    return mpSecLayout(html);\n  }\n') + 30);
  assert.match(mg, /html \+= _ms\(2,10\) \+ mpReqCardHtml\(me\);/);
  assert.match(mg, /if \(_mgSh\.keys\.length\) html \+= _ms\(3,5\) \+ mpShiftCardHtml\(_mgSh\.keys\);/);
  assert.match(mg, /_ms\(1,10\) \+ mpTodayHtml\(\{ shifts:_mgSh\.today, shiftGo:_mgSh\.go, helps:helps\.length[^}]*\}\)/);
  assert.match(mg, /_ms\(4,80\)[^\n]*Personal Growth Dashboard/);
  assert.doesNotMatch(mg.replace(/\/\*[\s\S]*?\*\//g, ''), /mpLayout\(html, true\)/);
  // スタッフの側（G2・G3）：前の休暇と申請の 2 枚は G1 だけ・最後に ① と 6 つの段・G1 は mpLayout
  assert.match(MYPAGE, /if \(_newF\) html \+= _ms\(2,10\) \+ mpReqCardHtml\(me\);\n  if \(!_newF\) \{\n  html \+= _mp\('w',50\);/);
  assert.match(MYPAGE, /if \(_newF\) \{\n[^\n]*\n\s*var _todayKeys = mpTodayShiftLabels\(myShifts\);[\s\S]*?return mpSecLayout\(html\);\n  \}\n  html = mpLayout\(html\);/);
  assert.match(MYPAGE, /p\.author===me && \(p\.status\|\|'未対応'\)!=='解決' && rs\.length && rs\[rs\.length-1\]\.byMgr/, 'a reply counts only while the manager wrote last and it is not resolved');
  for (const name of ["t('今月の勤怠記録',", "t('Your Skill Progress',", "Personal Growth Dashboard", "t('休暇申請','Time Off')"]) assert.ok(MYPAGE.includes(name), '7B: ' + name);
});

/* ---- 申請の行（本物のモジュール・handler・SQL） ---- */
function wrApp(s, emp, { role = 'sl', live = true, storeLogin = false } = {}) {
  const els = {}, pages = [], paints = [];
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, Uint8Array, setTimeout: (f) => { f(); return 0; }, encodeURI,
    crypto: webcrypto, SUPABASE_URL: 'https://db.test', SUPABASE_ANON: 'anon-key', _hwSession: 'pin-' + emp, innerWidth: 1024,
    curPage: 'mypage', workTab: 'x', curRole: role, curRealRole: '', curStoreLogin: storeLogin, curStore: 'S1', STORES: [{ id: 'S1', name: 'Store One' }],
    t: (ja) => ja, bizNow: () => new Date(), kpi: (l, v) => `[${l}:${v}]`, mrAuthKey: () => 'p|' + emp,
    renderPage: p => pages.push(p), go: p => pages.push('go:' + p), showToast: () => {}, openModal: () => {}, closeModalDirect: () => {},
    confirm: () => true, prompt: (_m, d) => d, groupsForRole: () => [{ children: ['dashboard', 'tasks'] }], ls: (k, d) => d,
    localStorage: { _m: new Map(live ? [['_wr_live_v1', JSON.stringify({ live: true, at: '2026-11-14T00:00:00Z', s2: false })]] : []), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
    fetch: async (url, init) => s.handler(new Request(url, init)),
    document: { getElementById: id => els[id] || null },
    mpTodayPaint: () => paints.push(1),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ESC + '\n' + BLK.slice(BLK.indexOf('function mpTodayRow('), BLK.indexOf('/* ① 今日やること：')), ctx);   // 本物の mpTodayRow
  ctx.mpTodayPaint = () => paints.push(1);
  vm.runInContext(MOD, ctx);
  const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };
  const mount = h => { if (/id="wr-myexp"/.test(h)) { const el = els['wr-myexp'] || (els['wr-myexp'] = { style: {}, innerHTML: '' }); el.innerHTML = h; } };
  const load = async () => { mount(ctx.wrMyExpCard('mypage')); await settle(); mount(ctx.wrMyExpCard('mypage')); await settle(); };
  return { ctx, els, pages, paints, settle, load, today: () => ctx.wrMyTodayHtml() };
}

test('① request rows (real module, handler and SQL): my returned request with a “Fix” button; the to-handle count is the work-center count; a GM sees the approvals to do', async () => {
  const s = await setup();
  const r1 = await s.subOk('E6', 'reimburse', 'S1');
  await s.subOk('E6', 'mileage', 'S1');
  const back = await s.act('E2', await s.fresh(r1), 'return', { note: '領収書を付けて' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const me = wrApp(s, 'E6');
  assert.equal(me.today(), '', 'nothing before reading');
  await me.load();
  me.today(); await me.settle();   // Codex #208 の P2：① の「戻ってきた申請」は ① を描いたときに別に読む（読み終わったら ① を描き直す）
  const h = me.today();
  assert.match(h, /戻ってきた申請/);
  assert.match(h, new RegExp('data-a="' + r1.code + '" onclick="wrOpenMine\\(this\\.dataset\\.a\\)">直す'));
  assert.equal((h.match(/戻ってきた申請/g) || []).length, 1, 'only the returned one (not the pending mileage)');
  assert.match(h, /申請の対応待ち 1 件[\s\S]*onclick="wrGoTodo\(\)"/, 'resubmitting counts as my turn (same as the work center)');
  assert.ok(me.paints.length >= 1, 'paintMyExp also paints ① (mpTodayPaint)');
  const gm = wrApp(s, 'E2', { role: 'gm' });
  await gm.load();
  const g = gm.today();
  assert.match(g, /申請の対応待ち 1 件/, 'the pending mileage waits for the GM');
  assert.doesNotMatch(g, /戻ってきた申請/);
  // 「開く」：ワークセンター › 申請 の要対応
  gm.ctx._wrState().view = 'mine';
  gm.ctx.wrGoTodo();
  assert.equal(gm.ctx._wrState().view, 'todo'); assert.equal(gm.ctx.workTab, 'wr'); assert.deepEqual(gm.pages.slice(-1), ['go:tasks']);
  // 承認すると次の読み込みで消える（マイページの読み込みで件数も新しくなる）
  await s.approve('E2', (await s.ok('E2', { action: 'list', scope: 'todo', state: 'open' })).rows[0]);
  gm.ctx._wrState().load = 'done';
  const st = gm.ctx._wrState(); st.counts = { todo: 7 };   // ワークセンターで前に読んだ古い件数
  gm.ctx.wrMyExpRetry(); await gm.settle();
  assert.doesNotMatch(gm.today(), /申請の対応待ち/, 'the count read with my requests wins over an older work-center count');
});

test('① request rows are empty when the server requests are not in use, for the store account, and before reading; paintMyExp paints ① even without the expense card', async () => {
  const s = await setup();
  await s.subOk('E6', 'reimburse', 'S1');
  const off = wrApp(s, 'E2', { role: 'gm', live: false });
  await off.load(); assert.equal(off.today(), '');
  const store = wrApp(s, 'E2', { role: 'sl', storeLogin: true });
  await store.load(); store.ctx.wrRefresh(); await store.settle();
  assert.ok(store.ctx._wrState().me, 'read'); assert.equal(store.today(), '', 'the store account (shared tablet) has no rows');
  // サーバーの申請を使っていない（live でない）とき：前に読んだ件数があっても出さない
  await s.pg.exec('reset role'); await s.pg.exec('update public.wr_settings set live = false'); await s.pg.exec('set role service_role');
  const nl = wrApp(s, 'E2', { role: 'gm' });
  nl.ctx.wrRefresh(); await nl.settle();
  assert.equal(nl.ctx._wrState().live, false); nl.ctx._wrState().counts = { todo: 3 };
  assert.equal(nl.today(), '');
  await s.pg.exec('reset role'); await s.pg.exec('update public.wr_settings set live = true'); await s.pg.exec('set role service_role');
  const gm = wrApp(s, 'E2', { role: 'gm' });
  gm.ctx.wrRefresh(); await gm.settle();   // 経費のカードを描かずに読む（「画面の表示」で経費の申請を出さないとき）
  assert.ok(gm.paints.length >= 1);
  assert.match(gm.today(), /申請の対応待ち 1 件/, 'the work-center count is used when my requests were not read');
});

test('Codex #208 P2: today’s shift and “This week’s shifts” read this business week, not the week picked on the shift screen (_shiftWeekOff stays after going back to My Page)', () => {
  const thisWeek = { status: '公開済', cells: { '木_Lunch_Server': 'Wes Doi' } };
  const nextWeek = { status: '公開済', cells: { '木_Dinner_Cook': 'Wes Doi' } };   // 11/22 の週の木曜（11/26）
  const { ctx } = blk({ getShiftPlan: (st, w) => (w === '11/15' ? thisWeek : w === '11/22' ? nextWeek : null) });
  // シフトの画面の週の選び方（本物と同じ：off を省くと _shiftWeekOff）
  ctx._shiftWeekOff = 1;
  ctx.getWeekSundayISO = off => ((off === undefined ? ctx._shiftWeekOff : off) === 1 ? '2026-11-22' : '2026-11-15');
  ctx.getWeekStr = () => { const d = new Date(ctx.getWeekSundayISO() + 'T00:00:00'); return (d.getMonth() + 1) + '/' + d.getDate(); };
  assert.equal(ctx.getWeekStr(), '11/22', 'the shift screen picked next week');
  const r = ctx.mpMyShifts('Wes Doi', { store: 'F02' });
  assert.deepEqual(r.keys, ['木_Lunch_Server'], 'this week’s plan, not next week’s');
  assert.deepEqual(r.today, ['Lunch Server']);
  assert.deepEqual(ctx._pulls, ['F02|11/15']);
  // G1〜G3 の「今週のシフト」と ① も、マイページでは営業日の今週
  assert.match(MYPAGE, /var emp = getEmployees\(\)\.find\(e=>e\.name===me\);\n  var week = mpThisWeekStr\(\);/);
  assert.doesNotMatch(MYPAGE, /var week = getWeekStr\(\);/, 'My Page never uses the picked week');
});

test('Codex #208 P2: ① “Returned request” is read on its own (all my open requests, every kind), so a returned one is not lost behind 5 newer requests', async () => {
  const s = await setup();
  const r1 = await s.subOk('E6', 'reimburse', 'S1');
  const back = await s.act('E2', await s.fresh(r1), 'return', { note: '領収書を付けて' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  for (let i = 0; i < 5; i++) await s.subOk('E6', i % 2 ? 'mileage' : 'reimburse', 'S1');   // あとから新しい 5 件（② のカードは新しい 5 件だけ）
  const me = wrApp(s, 'E6');
  await me.load();
  me.today(); await me.settle();
  const h = me.today();
  assert.equal(me.ctx._wrState().me != null, true);
  assert.match(h, /戻ってきた申請/, 'the returned one is still in ① even though it is not among the 5 newest');
  assert.match(h, new RegExp('data-a="' + r1.code + '"'));
  assert.match(h, /申請の対応待ち 1 件/, 'the count was right before, too');
});
