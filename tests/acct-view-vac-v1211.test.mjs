// v1211（B-1・Moto さん 11/23）：経理・事務Crew は経理センター › 休暇で GM と同じ一覧を見る（見るだけ）。
// 本物の renderVacation・vacAcctViewHtml・canManageVacations・canApproveVacation・vacManagerGrade（index.html）を VM で動かす。
// 合成データだけ。本番にはつながない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SW = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function fnSrc(name) {
  const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('function not found: ' + name);
  let i = SRC.indexOf('{', m.index), depth = 0, q = null, tpl = [];
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
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); q = '`'; continue; }
      if (depth === 0) return SRC.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return SRC.slice(i, j + b.length); };
const run = (c, code) => vm.runInContext(code, c);

const TODAY = '2026-11-23';
const EMPS = [
  { name: 'Dee', title: 'Office Crew', role: 'office_crew', store: 'ALL' },
  { name: 'Eve', title: 'Accounting Manager', role: 'office', store: 'ALL' },
  { name: 'Lia', title: 'Accounting Leader', role: 'office', store: 'ALL' },
  { name: 'Moto', title: 'GM', role: 'gm', store: 'ALL' },
  { name: 'Sam', title: 'Store Manager', role: 'sl', store: 'F01' },
  { name: 'Ann', title: 'Crew', role: 'crew', store: 'F01' },
  { name: 'Bo', title: 'Crew', role: 'crew', store: 'F02' },
];
const VACS = [
  { id: 'v1', employee: 'Ann', storeId: 'F01', type: '有給', startDate: '2026-12-01', endDate: '2026-12-02', reason: '<img src=x onerror=alert(1)>', status: '申請中' },
  { id: 'v2', employee: 'Bo', storeId: 'F02', type: '無給', startDate: '2026-11-25', endDate: '2026-11-26', reason: '', status: '承認' },
  { id: 'v3', employee: 'Bo', storeId: 'F02', type: '無給', startDate: '2026-11-01', endDate: '2026-11-02', reason: '', status: '承認' },   // 終わった休み（出さない）
  { id: 'v4', employee: 'Ann', storeId: 'F01', type: '有給', startDate: '2026-12-10', endDate: '2026-12-10', reason: '', status: '却下' },  // 却下（出さない）
  { id: 'v5', employee: 'Ghost', storeId: 'F01', type: '有給', startDate: '2026-12-11', endDate: '2026-12-11', reason: '', status: '申請中', _deleted: true },
  { id: 'v6', employee: 'Dee', storeId: 'ALL', type: '有給', startDate: '2026-12-20', endDate: '2026-12-21', reason: '', status: '申請中' },
];

function device(o) {
  const c = { console: { log() {}, warn() {}, error() {} }, EMPS, VACS, ROLE: o.role, USER: o.user, SLOGIN: !!o.storeLogin, LANG: o.lang || 'ja', TODAY };
  vm.createContext(c);
  run(c, [between('const ROLE_CONFIG = {', '\n};').replace('const ', 'var '), between('var GRADE_TITLES = {', '\n};'),
    ...['gradeOf', 'gradeNum', 'empGrade', 'vacManagerGrade', 'canManageVacations', 'canApproveVacation', 'renderVacation', 'vacAcctViewHtml', 'tStatus'].map(fnSrc)].join('\n') + `
    var curLang = LANG, curRole = ROLE, curUserName = USER, curStoreLogin = SLOGIN, curStore = SLOGIN ? 'F01' : 'ALL';
    var STORES = [{ id:'F01', name:'ToriTon' }, { id:'F02', name:'Tenkichi' }];
    function t(ja, en){ return curLang==='en' ? en : ja; }
    function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    function todayISO(){ return TODAY; }
    function getEmployees(){ return EMPS; }
    function getVacations(){ return JSON.parse(JSON.stringify(VACS)); }
    function maybePullVacations(){}
    function myAmStores(){ return ['F01']; }
  `);
  return c;
}
const page = (o) => run(device(o), 'renderVacation()');
const acctPart = (h) => { const i = h.indexOf('vac-acct-view'); return i < 0 ? '' : h.slice(i, h.indexOf('自分の申請', i) < 0 ? undefined : h.indexOf('自分の申請', i)); };

test('事務Crew・経理リーダー・経理マネージャー（G4）は GM と同じ全店の休暇を見るだけで見る', () => {
  const gm = page({ role: 'gm', user: 'Moto' });
  for (const [role, user] of [['office_crew', 'Dee'], ['office', 'Lia'], ['office', 'Eve']]) {
    const h = page({ role, user });
    const a = acctPart(h);
    assert.ok(a, role + ' ' + user + ' に全店の一覧');
    // GM の承認待ち・今後の休みと同じ人
    for (const name of ['Ann', 'Bo', 'Dee']) assert.ok(a.includes('<b>' + name + '</b>'), user + ' が ' + name + ' を見る');
    assert.ok(gm.includes('Ann') && gm.includes('Bo'), 'GM も同じ人を見る');
    assert.ok(a.includes('ToriTon') && a.includes('Tenkichi'), '全店');
    // 終わった休み・却下・消した記録は出さない
    assert.ok(!a.includes('2026-11-01'), '終わった休みは出さない');
    assert.ok(!a.includes('2026-12-10'), '却下は出さない');
    assert.ok(!a.includes('Ghost'), '消した記録は出さない');
    // 承認・却下・取消のボタンは出さない（承認センター・GM・AM・店長だけ）
    assert.ok(!/approveVacation|rejectVacation|cancelApprovedVacation/.test(a), user + ' に決めるボタンなし');
    assert.ok(!/cancelApprovedVacation/.test(h), user + ' のページ全体にも取消なし');
    // 経理マネージャー（G4）でも空の管理の一覧は出さない
    assert.ok(!h.includes('Pending Approval') && !h.includes("承認センターで承認"), user + ' に空の管理の一覧なし');
  }
});

test('件数：承認待ち 2（Ann・Dee）・今後の休み 1（Bo）', () => {
  const a = acctPart(page({ role: 'office_crew', user: 'Dee' }));
  assert.match(a, /承認待ち <span class="tag tag-yellow">2<\/span>/);
  assert.match(a, /承認済み（今後の休み） <span class="tag tag-gray">1<\/span>/);
});

test('名前・理由はエスケープ（スクリプトは動かない）', () => {
  const a = acctPart(page({ role: 'office', user: 'Lia' }));
  assert.ok(!a.includes('<img'), '生の HTML を入れない');
  assert.ok(a.includes('&lt;img src=x onerror=alert(1)&gt;'), 'エスケープした文字で出す');
});

test('英語の画面', () => {
  const a = acctPart(page({ role: 'office_crew', user: 'Dee', lang: 'en' }));
  assert.ok(a.includes('All stores — time off (view only)') && a.includes('Approved (Upcoming)'));
});

test('ほかの人の見え方は変わらない（GM・店長・Crew・店のタブレット）', () => {
  const gm = page({ role: 'gm', user: 'Moto' });
  assert.ok(!gm.includes('vac-acct-view'), 'GM は今までの管理の一覧');
  assert.ok(gm.includes('cancelApprovedVacation'), 'GM は承認済みを取り消せる（今までどおり）');
  const sl = page({ role: 'sl', user: 'Sam' });
  assert.ok(!sl.includes('vac-acct-view'), '店長は今までの管理の一覧');
  assert.ok(sl.includes('Ann') && !sl.includes('<b>Bo</b>'), '店長は自分の店だけ（今までどおり）');
  const crew = page({ role: 'crew', user: 'Ann' });
  assert.ok(!crew.includes('vac-acct-view') && !crew.includes('<b>Bo</b>'), 'Crew はほかの人を見ない');
  const tab = page({ role: 'office_crew', user: 'Dee', storeLogin: true });
  assert.ok(!tab.includes('vac-acct-view'), '店のタブレットは今までの管理の一覧');
});

test('版 1211（ページと SW が同じ）', () => {
  const v = /const APP_VERSION = '(\d+)'/.exec(SRC)[1];
  const s = /const SW_BUILD = '(\d+)'/.exec(SW)[1];
  assert.equal(v, s);
  assert.ok(Number(v) >= 1211);
});
