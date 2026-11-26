// v1204（UI案98・段階 4・Moto さんの答え 3A）：本部の打刻（経理・事務Crew・Head Chef）をマイページ ① でも。経理ホームの「本日の勤怠」・本部タイムカードと
// 同じ記録・同じ関数。本物の関数を index.html から切り出して VM で動かす。合成データだけ。仕様：docs/UNIFIED_UI_V1191_JA.md の 27b。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function prevSig(i) { let j = i - 1; while (j >= 0 && /\s/.test(SRC[j])) j--; return j < 0 ? ';' : SRC[j]; }
function skipRegex(i) { let cls = false; for (let j = i + 1; j < SRC.length; j++) { const ch = SRC[j]; if (ch === '\\') { j++; continue; } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) return j; else if (ch === '\n') return i; } return i; }
function block(start) {
  let i = SRC.indexOf('{', start), depth = 0, q = null, tpl = [];
  for (; i < SRC.length; i++) {
    const ch = SRC[i], nx = SRC[i + 1];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (q === '`' && ch === '$' && nx === '{') { tpl.push(depth); depth++; q = null; i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { i = SRC.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && /[(,=:[!&|?{};+]/.test(prevSig(i))) { i = skipRegex(i); continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unterminated');
}
function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  return SRC.slice(m.index, block(m.index));
}

const FNS = ['nowHM', 'officeAttendKey', 'getOfficeAttend', 'setOfficeAttend', 'officeCalcHours', 'officeOpenRec', 'hmDiffMin', 'officeSumBreaks', 'getOfficeAttendCfg',
  'officePunchRerender', 'mpHqPunch', 'officeAttendReady', 'officeClockRepaint', 'officeNotReadyToast', 'officeClockIn', 'officeBreakStart', 'officeBreakEnd', 'officeClockOut', 'officeClockCard', 'officeTodayStr', 'escapeHtml'];
const BLK = SRC.slice(SRC.indexOf('/* ===== v1203（UI案98・段階 4'), SRC.indexOf('function renderMypage() {'));
const MYPAGE = SRC.slice(SRC.indexOf('function renderMypage() {'), SRC.indexOf('\n/* ============================================================\n   SETTINGS'));

function app({ page = 'mypage', me = 'Gina Sato', role = 'chef', lang = 'ja', emps, fetched = true, pull } = {}) {
  const store = {}, pages = [], toasts = [], pulls = [], timers = [], els = {};
  let hm = '09:00';
  const ctx = {
    _ofPull: {}, _LS_FETCHED: fetched ? { ['office_attend_' + me]: 1 } : {},
    pullOpKey: k => { pulls.push(k); return pull ? pull(k) : new Promise(() => {}); },
    setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; },
    document: { getElementById: id => els[id] || null },
    console, Math, JSON, Object, Array, String, Number, Date,
    curPage: page, curUserName: me, curLang: lang, t: (ja, en) => (ctx.curLang === 'en' ? en : ja),
    ls: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d), lsSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    renderPage: p => pages.push(p), showToast: (m, k) => toasts.push([k, m]), tsNow: () => '2026-11-19 ' + hm, isoDateStr: () => '2026-11-19', todayISO: () => '2026-11-19',
    myName: () => me, openOfficeStaleShiftModal: () => { throw new Error('no stale shift here'); },
    getEmployees: () => emps || [{ name: 'Gina Sato', role: 'chef', status: '在籍' }, { name: 'Zen Sato', role: 'office', status: '在籍' }, { name: 'Cora Wada', role: 'office_crew', status: '在籍' },
      { name: 'Yui Yano', role: 'gm', status: '在籍' }, { name: 'Emi Wada', role: 'am', status: '在籍' }, { name: 'Uma Doi', role: 'sl', status: '在籍' }, { name: 'Old Hand', role: 'office', status: '退職' }],
  };
  ctx._curEmp = () => ctx.getEmployees().find(x => x.name === ctx.curUserName) || null;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FNS.map(fnSrc).join('\n') + '\nfunction nowHM(){ return HM(); }', ctx);
  ctx.HM = () => hm;
  vm.runInContext(BLK.slice(BLK.indexOf('function mpTodayRow('), BLK.indexOf('/* 申請の行が読み終わったら')), ctx);
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  return { ctx, store, pages, toasts, pulls, timers, els, settle, at: v => { hm = v; } };
}

test('who gets the punch on My Page: the people who punch on the HQ time card (accounting, office crew, Head Chef); not GM / AM / store staff / someone who left', () => {
  const ok = n => app({ me: n }).ctx.mpHqPunch();
  assert.equal(ok('Gina Sato'), true, 'Head Chef (could not open the time card before)');
  assert.equal(ok('Zen Sato'), true); assert.equal(ok('Cora Wada'), true);
  for (const n of ['Yui Yano', 'Emi Wada', 'Uma Doi', 'Old Hand', 'Nobody']) assert.equal(ok(n), false, n);
});

test('punching on My Page: clock in → break → end break → clock out are saved in the same record (office_attend_<name>) and My Page stays; from the accounting center it still redraws office_mgr', () => {
  const a = app();
  a.ctx.officeClockIn();
  assert.deepEqual(a.pages, ['mypage'], 'stays on My Page (before: renderPage(office_mgr) moved to the accounting center / was refused for Head Chef)');
  let r = a.store['office_attend_Gina Sato'];
  assert.equal(r.length, 1); assert.equal(r[0].in, '09:00'); assert.equal(r[0].status, '勤務中');
  a.at('12:00'); a.ctx.officeBreakStart(); a.at('12:30'); a.ctx.officeBreakEnd(); a.at('17:30'); a.ctx.officeClockOut();
  r = a.store['office_attend_Gina Sato'];
  assert.equal(r[0].out, '17:30'); assert.equal(r[0].breakMin, 30); assert.equal(r[0].hours, 8);
  assert.deepEqual(a.pages, ['mypage', 'mypage', 'mypage', 'mypage']);
  const b = app({ page: 'acct_center', me: 'Zen Sato' });
  b.ctx.officeClockIn();
  assert.deepEqual(b.pages, ['office_mgr'], 'the accounting home / time card keep their redraw (the router keeps the current tab)');
  assert.equal(b.store['office_attend_Zen Sato'][0].in, '09:00');
});

test('the punch card: the same buttons (officeClockIn …); on My Page the note says it is the same HQ time card; English words on the English screen (Japanese unchanged)', () => {
  const a = app();
  let h = a.ctx.officeClockCard();
  assert.match(h, /id="office-clock"/);
  for (const f of ['officeClockIn()', 'officeBreakStart()', 'officeBreakEnd()', 'officeClockOut()']) assert.ok(h.includes('onclick="' + f + '"'), f);
  assert.match(h, /未出勤/); assert.match(h, /本部タイムカードの月次タイムシートと同じ記録/);
  assert.match(h, />[^<]*出勤<\/button>/);
  const ac = app({ page: 'acct_center', me: 'Zen Sato' });
  assert.match(ac.ctx.officeClockCard(), /打刻・休憩は「本部タイムカード」タブの月次タイムシートに自動反映されます/, 'the accounting home note is as before');
  const en = app({ lang: 'en' });
  h = en.ctx.officeClockCard();
  for (const w of ['Not clocked in', 'Clock in', 'Start break', 'End break', 'Clock out', 'same HQ time card']) assert.ok(h.includes(w), w);
  assert.doesNotMatch(h, /未出勤|休憩開始/);
  en.ctx.officeClockIn(); assert.match(en.ctx.officeClockCard(), /Working 09:00/);
  assert.deepEqual(en.toasts[0], ['success', 'Clocked in']);
});

test('① Today: with only the punch card in ①, the “Nothing to do today” card is hidden; with rows it shows them', () => {
  const a = app();
  assert.match(a.ctx.mpTodayHtml({ punch: true }), /id="mp-today"[^>]*style="display:none"/);
  assert.doesNotMatch(a.ctx.mpTodayHtml({ punch: false }), /id="mp-today"[^>]*display:none/);
  assert.match(a.ctx.mpTodayHtml({ punch: true, consult: 1 }), /相談に返事があります/);
  assert.doesNotMatch(a.ctx.mpTodayHtml({ punch: true, consult: 1 }), /id="mp-today"[^>]*display:none/);
});

test('renderMypage: the punch card is the first card of ① for those people (manager side); the same function as the accounting home', () => {
  const mg = MYPAGE.slice(MYPAGE.indexOf('  if (!isCrewView) {\n    /* v1203'), MYPAGE.indexOf("    return mpSecLayout(html) + legalLinksHtml('mypage');"));
  assert.match(mg, /var _punch = false; try \{ _punch = mpHqPunch\(\); \} catch\(e\) \{\}\n\s*if \(_punch\) html \+= _ms\(1,5\) \+ officeClockCard\(\);/);
  assert.match(mg, /mpTodayHtml\(\{ shifts:_mgSh\.today, shiftGo:_mgSh\.go, helps:helps\.length, punch:_punch \}\)/);
  assert.ok(mg.indexOf('_ms(1,5)') < mg.indexOf('_ms(1,10)'));
  // 打刻のあとの描き直し：出勤・退勤・休憩・打刻もれの締め
  for (const f of ['officeClockIn', 'officeClockOut', 'officeBreakStart', 'officeBreakEnd', 'officeCloseStaleShift']) assert.match(fnSrc(f), /officePunchRerender\(\)/, f);
});

test('a new device: until my own HQ time card is read, the punch card says “Loading…” with every button off and a tap does not punch; it reads once, then the card alone is drawn again', async () => {
  let done; const a = app({ fetched: false, pull: k => new Promise(r => { done = ok => { if (ok) a.ctx._LS_FETCHED[k] = 1; r(ok); }; }) });
  a.store['office_attend_Gina Sato'] = [];   // 手元にはまだ無い（前の打刻はクラウドだけ）
  let h = a.ctx.officeClockCard();
  assert.match(h, /data-loading="1"/); assert.match(h, /読み込み中…/);
  assert.equal((h.match(/<button[^>]*disabled/g) || []).length, 4, 'all 4 buttons off');
  a.ctx.officeClockIn(); a.ctx.officeBreakStart(); a.ctx.officeClockOut();
  assert.equal(a.store['office_attend_Gina Sato'].length, 0, 'no punch while loading (it made a 2nd clock-in before)');
  assert.match(a.toasts[0][1], /読み込み中/);
  a.ctx.officeClockCard(); a.ctx.officeClockCard(); await a.settle();
  assert.deepEqual(a.pulls, ['office_attend_Gina Sato'], 'read once');
  // 読み終わった：クラウドにあった今日の出勤が届いた → カードだけ描き直す
  const el = { outerHTML: '' }; a.els['office-clock'] = el;
  a.store['office_attend_Gina Sato'] = [{ date: '2026-11-19', in: '08:55', out: '', status: '勤務中', log: [] }];
  done(true); await a.settle();
  assert.match(el.outerHTML, /勤務中 08:55/); assert.doesNotMatch(el.outerHTML, /data-loading/);
  assert.deepEqual(a.pages, [], 'the screen is not drawn again (only the card)');
  a.ctx.officeClockIn();
  assert.equal(a.store['office_attend_Gina Sato'].length, 1, 'already clocked in: no 2nd record');
});

test('when it cannot read (offline: false, an error, or no answer in 8 s) it punches on the device as before; a key read before is ready at once', async () => {
  const a = app({ fetched: false, pull: () => Promise.resolve(false) });
  assert.equal(a.ctx.officeAttendReady('Gina Sato'), false); await a.settle();
  assert.equal(a.ctx.officeAttendReady('Gina Sato'), true);
  a.ctx.officeClockIn(); assert.equal(a.store['office_attend_Gina Sato'][0].in, '09:00');
  const b = app({ fetched: false, pull: () => Promise.reject(new Error('net')) });
  b.ctx.officeAttendReady('Gina Sato'); await b.settle(); assert.equal(b.ctx.officeAttendReady('Gina Sato'), true);
  const c = app({ fetched: false });   // 答えが来ない
  assert.equal(c.ctx.officeAttendReady('Gina Sato'), false);
  const tm = c.timers.find(x => x[1] === 8000); assert.ok(tm, '8 s limit'); tm[0]();
  assert.equal(c.ctx.officeAttendReady('Gina Sato'), true);
  const d = app({ fetched: true });
  assert.equal(d.ctx.officeAttendReady('Gina Sato'), true); assert.equal(d.pulls.length, 0, 'no read when it was read before');
});

test('Codex #209 P2: the read answers after the 8 s limit (the server has an open 08:55 shift) → the card is drawn again from it and clock-out works; tapping clock-in on a stale card redraws it', async () => {
  let done; const a = app({ fetched: false, pull: k => new Promise(r => { done = ok => { if (ok) a.ctx._LS_FETCHED[k] = 1; r(ok); }; }) });
  a.store['office_attend_Gina Sato'] = [];   // 新しい端末：手元にはまだ無い
  const el = { outerHTML: '' }; a.els['office-clock'] = el;
  assert.equal(a.ctx.officeAttendReady('Gina Sato'), false); await a.settle();   // 読み込みが始まった（まだ答えない）
  const tm = a.timers.find(x => x[1] === 8000); tm[0]();   // 8 秒：待つのをやめる（手元で打てる）
  assert.match(el.outerHTML, /未出勤/, 'after the limit the card shows the device data (nothing yet)');
  assert.match(el.outerHTML, /<button[^>]*disabled[^>]*onclick="officeClockOut\(\)"/, 'clock-out is off while it looks not clocked in');
  // 遅れて答えが届く：サーバーにあった 08:55 の未退勤の記録（pullOpKey が手元に保存）
  a.store['office_attend_Gina Sato'] = [{ date: '2026-11-19', in: '08:55', out: '', status: '勤務中', log: [] }];
  done(true); await a.settle();
  assert.match(el.outerHTML, /勤務中 08:55/, 'the late answer is used (before: thrown away, still 未出勤)');
  assert.doesNotMatch(el.outerHTML, /<button[^>]*disabled[^>]*onclick="officeClockOut\(\)"/, 'clock-out can be pressed');
  a.at('17:30'); a.ctx.officeClockOut();
  const rec = a.store['office_attend_Gina Sato'][0];
  assert.equal(rec.out, '17:30'); assert.equal(rec.in, '08:55', 'the same record (no 2nd clock-in)');
  // カードが古いまま出勤を押した（記録はもう勤務中）：断って、今の記録でカードを描き直す
  const b = app({ fetched: true });
  b.store['office_attend_Gina Sato'] = [{ date: '2026-11-19', in: '08:55', out: '', status: '勤務中', log: [] }];
  const el2 = { outerHTML: '<div id="office-clock">未出勤</div>' }; b.els['office-clock'] = el2;
  b.ctx.officeClockIn();
  assert.match(b.toasts[0][1], /先に退勤してください/);
  assert.match(el2.outerHTML, /勤務中 08:55/, 'the stale card is drawn again');
  assert.equal(b.store['office_attend_Gina Sato'].length, 1);
});
