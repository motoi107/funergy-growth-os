// v1105 ②：業務Bot の画面の Job確認（16:30 基準）。index.html の業務Bot のブロックを VM で動かす（合成データ）。
// 判定は ops-bot（bot/job-check.mjs）。画面の文・時刻の数え方が ops-bot と同じか、設定の保存が版つきかを見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as J from '../bot/job-check.mjs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PREP = 'aaaaaaaa-0000-4000-8000-000000000001', SERVER = 'aaaaaaaa-0000-4000-8000-000000000002', HOST = 'aaaaaaaa-0000-4000-8000-000000000003';

function context({ role = 'gm', lang = 'ja' } = {}) {
  const els = {};
  const ctx = {
    curRole: role, curLang: lang, Date, console, setTimeout: () => {}, window: {}, Object, JSON, Number, String, Math, Promise,
    t: (ja, en) => ctx.curLang === 'en' ? en : ja,
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    openModal: s => { ctx.modal = s; }, closeModalDirect: () => {}, renderPage: () => {}, lsSet: () => {}, toasts: [],
    showToast: (m, k) => ctx.toasts.push([m, k]), bizToday: () => '2026-10-22',
    _ceKindTags: () => { throw Error('Job cases must not use the attendance tags'); }, _ceClock: v => String(v), CE_ERROR_KINDS: [], CE_KIND_LABEL: {},
    els,
    document: {
      getElementById: k => els[k] || null,
      querySelector: q => { const m = /name="([^"]+)"\]:checked/.exec(q); return m ? (els[m[1] + ':checked'] || null) : null; }
    }
  };
  vm.createContext(ctx);
  const start = source.indexOf('/* FUNERGY_BOT_CENTER_BEGIN'), end = source.indexOf('/* FUNERGY_BOT_CENTER_END */', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), ctx);
  ctx._botShared.data = { actor: { role }, line: {}, stores: [{ store_id: 'F06', name: 'LaLa' }, { store_id: 'F01', name: 'ToriTon' }], groups: [], owners: [], intakes: [], cases: [], runs: [] };
  ctx.botAPI = async () => ({ events: [], outbox: [] });
  return ctx;
}
const te = (n, hms, job, over = {}) => ({ guid: id(n), businessDate: '20261020', inDate: '2026-10-20T' + hms + '.000-1000', outDate: '2026-10-20T21:48:03.000-1000', employeeReference: { guid: id(500 + n) }, jobReference: job ? { guid: job } : null, deleted: false, ...over });
const scfg = (o = {}) => ({ enabled: true, cutoff: '16:30', from: '2026-10-16', g1p: 'exclude', straddle: { enabled: false, minutes: 30 }, jobs: { [PREP]: { name: 'Prep', cls: 'prep' }, [SERVER]: { name: 'Server', cls: 'service' } }, ...o });
const app = [{ name: 'Staff <A>', title: 'Crew', role: 'crew', status: 'active' }, { name: 'Staff B', title: 'Prep', role: 'crew', status: 'active' }];
const toast = [{ guid: id(501), firstName: 'Staff', lastName: '<A>' }, { guid: id(502), firstName: 'Staff', lastName: 'B' }, { guid: id(503), firstName: 'Nobody', lastName: 'Here' }];
function caseOf(entry, over = {}) {
  const f = J.jobFindings({ entries: [entry], toastEmployees: toast, appEmployees: app, scfg: J.validJobCheck({ stores: { F06: scfg() } }).stores.F06, store: { store_id: 'F06', name: 'LaLa' }, date: '2026-10-20' })[0];
  assert.ok(f, 'synthetic finding');
  return { id: id(10), code: '#41', kind: 'labor', store_id: 'F06', business_date: '2026-10-20', subject: f.subject, status: 'review', version: 1, assignee: '', payload: f.payload, ...over };
}

test('the screen counts time exactly like ops-bot (business-day midnight in Hawaii, +0000, after midnight)', () => {
  const ctx = context();
  const days = ['2026-10-20', '2026-03-08', '2026-11-01', '2026-12-31'];
  let n = 0;
  for (const bd of days) for (let s = 0; s < 40 * 3600; s += 997) {
    const at = new Date(Date.parse(bd + 'T00:00:00-10:00') + s * 1000);
    const forms = [at.toISOString(), at.toISOString().replace('Z', '+0000'), at.toISOString().replace('.000Z', '.000+00:00')];
    for (const v of forms) { assert.equal(ctx.botJobSecs(v, bd), J.secondsFromBizMidnight(v, bd), v); n++; }
  }
  assert.ok(n > 1000);
  assert.equal(ctx.botJobSecs(null, '2026-10-20'), null);
  assert.equal(ctx.botJobSecs('2026-10-20T16:30:00.000-1000', 'bad'), null);
  assert.equal(ctx.botJobClock(ctx.botJobSecs('2026-10-21T00:30:00.000-1000', '2026-10-20')), '24:30:00');
});

test('case line, labels and draft match ops-bot; undeterminable cases are not violations', () => {
  const ctx = context();
  const cases = [caseOf(te(1, '15:00:12', SERVER)), caseOf(te(1, '16:30:00', PREP)), caseOf(te(1, '15:30:05', HOST)), caseOf(te(3, '14:58:31', SERVER, { employeeReference: { guid: id(503) } }))];
  for (const c of cases) {
    const line = vm.runInContext('botJobLine', ctx)(c, 'ja');
    assert.equal(line, J.jobCaseLine({ ...c, store_name: 'LaLa', kinds: c.payload.kinds, shifts: c.payload.shifts, cfg: c.payload.cfg }), 'same line as the 9:00 report');
    for (const k of c.payload.kinds) assert.equal(ctx.botJobKindText(k, '16:30', 'ja'), J.jobKindLabel(k, '16:30'));
  }
  assert.equal(ctx.botJobLine(cases[0], 'ja'), 'LaLa／通常G1／15:00:12開始／Server → 16:30前のためPrepか確認');
  assert.equal(ctx.botJobLine(cases[1], 'ja'), 'LaLa／通常G1／16:30:00開始／Prep → 16:30以降のため営業用Jobか確認', '16:30:00 exactly is "at or after"');
  assert.equal(ctx.botJobUnsure(cases[0]), false); assert.equal(ctx.botJobUnsure(cases[2]), true); assert.equal(ctx.botJobUnsure(cases[3]), true);
  assert.equal(ctx.botKindText(['job_before'], 'ja'), '16:30前のためPrepか確認');
  assert.equal(ctx.botKindText(['job_after'], 'en'), 'Started at or after 16:30: should be a service Job');
  assert.equal(ctx.botKindText(['long'], 'en'), 'Long shift', 'the attendance labels are unchanged');
  const draft = ctx.botSuggestedDraft(cases[0]);
  assert.match(draft, /15:00:12開始／Server → 16:30前のためPrepか確認/); assert.match(draft, /Toast で直し/); assert.match(draft, /#41 修正済み/);
  assert.match(ctx.botSuggestedDraft(cases[2]), /判定できなかった打刻/);
  ctx.curLang = 'en';
  assert.match(ctx.botSuggestedDraft(cases[0]), /Regular G1 \/ started 15:00:12 \/ Server → Started before 16:30: should be Prep/);
});

test('case modal shows the Job details, escapes names and never edits punches', async () => {
  for (const lang of ['ja', 'en']) {
    const ctx = context({ lang });
    const c = caseOf(te(1, '15:00:12', SERVER)); ctx._botShared.data.cases = [c];
    await ctx.botCaseModal(c.id);
    assert.match(ctx.modal, lang === 'ja' ? /15:00:12 〜 21:48:03/ : /15:00:12 〜 21:48:03/);
    assert.match(ctx.modal, /Staff &lt;A&gt;/); assert.doesNotMatch(ctx.modal, /Staff <A>/);
    assert.match(ctx.modal, lang === 'ja' ? /Bot は打刻・Job・時給を直しません/ : /never edits punches, Jobs or wages/);
    assert.match(ctx.modal, lang === 'ja' ? /通常G1/ : /Regular G1/);
    assert.match(ctx.modal, /bot-case-draft/);
    const list = ctx.renderBotCenter();
    assert.match(list, lang === 'ja' ? /勤怠・Job確認/ : /Attendance · Job check/);
    ctx._botShared.data.cases = [caseOf(te(1, '15:30:05', HOST))];
    assert.match(ctx.renderBotCenter(), lang === 'ja' ? /判定不能/ : /Cannot judge/);
  }
});

test('the case list filters Job checks; attendance still includes them', () => {
  const ctx = context();
  const job = caseOf(te(1, '15:00:12', SERVER)), plain = { id: id(11), code: '#42', kind: 'labor', store_id: 'F06', business_date: '2026-10-20', subject: 'Plain attendance', status: 'review', version: 1, payload: { kinds: ['long'] } };
  ctx._botShared.data.cases = [job, plain];
  ctx.botSetFilter('kind', 'job'); let html = ctx.renderBotCenter();
  assert.match(html, /#41/); assert.doesNotMatch(html, /#42 Plain/);
  ctx.botSetFilter('kind', 'labor'); html = ctx.renderBotCenter();
  assert.match(html, /#41/); assert.match(html, /#42 Plain/);
});

test('settings: GM/CEO only; form merges Toast Jobs with saved classes; saved config passes the server validation', async () => {
  let ctx = context({ role: 'office' });
  assert.doesNotMatch(ctx.renderBotCenter(), /botJobCheckModal/);
  ctx.botJobCheckModal(); assert.equal(ctx.modal, undefined, 'office cannot open it');
  ctx = context({ role: 'ceo' });
  assert.match(ctx.renderBotCenter(), /botJobCheckModal\(\)/);
  const calls = [];
  ctx.botAPI = async body => {
    calls.push(body);
    if (body.action === 'job_list') return { store_id: 'F06', read_at: '2026-10-22T19:12:00.000Z', rev: 2, updated_at: null,
      jobs: [{ guid: PREP, title: 'Prep', deleted: false }, { guid: SERVER, title: 'Server <x>', deleted: false }, { guid: HOST, title: 'Host 2', deleted: false }],
      config: { ...scfg({ jobs: { [PREP]: { name: 'Prep', cls: 'prep' }, ['aaaaaaaa-0000-4000-8000-000000000009']: { name: 'Old', cls: 'service', deleted: true } } }) } };
    if (body.action === 'job_check') return { ok: true, rev: 3, updated_at: '2026-10-22T19:20:00.000Z' };
    throw Error('unexpected');
  };
  ctx.botJobCheckModal();
  await new Promise(r => setImmediate(r));
  assert.equal(calls[0].store_id, 'F06', 'LaLa is the default store');
  assert.match(ctx.modal, /Server &lt;x&gt;/); assert.match(ctx.modal, /Toast の一覧に無い/);
  const f = ctx._botJob.form;
  assert.equal(f.jobs[SERVER].cls, '', 'a Toast Job without a saved class is unclassified');
  assert.equal(f.jobs[PREP].cls, 'prep'); assert.equal(f.rev, 2); assert.equal(f.from, '2026-10-16');
  ctx.botJobSetCls(SERVER, 'service'); ctx.botJobSetCls(HOST, 'exclude'); ctx.botJobSetCls(HOST, 'boss');
  assert.equal(f.jobs[HOST].cls, 'exclude', 'an unknown class is ignored');
  await ctx.botJobSave();
  const sent = calls.find(c => c.action === 'job_check');
  assert.equal(sent.expect_rev, 2, 'the version that was read is sent');
  const ok = J.validJobCheck({ stores: { F06: sent.config } }, ['F06']).stores.F06;
  assert.equal(ok.jobs[SERVER].cls, 'service'); assert.equal(ok.jobs[HOST].cls, 'exclude'); assert.equal(ok.g1p, 'exclude');
  assert.equal(ctx._botJob.form.rev, 3);
  assert.doesNotMatch(JSON.stringify(sent), /wage|Wage/);
});

test('settings: bad input is not sent; a conflict reloads without saving', async () => {
  const ctx = context({ role: 'gm' });
  const calls = [];
  let conflict = true;
  ctx.botAPI = async body => {
    calls.push(body);
    if (body.action === 'job_list') return { store_id: 'F06', jobs: [], rev: 1, config: scfg(), read_at: null };
    if (conflict) throw Error('他の担当者が更新しました。再読込してください');
    return { ok: true, rev: 2 };
  };
  ctx.botJobCheckModal(); await new Promise(r => setImmediate(r));
  ctx.els['bot-job-cutoff'] = { value: '9' };
  await ctx.botJobSave(); assert.equal(calls.filter(c => c.action === 'job_check').length, 0);
  ctx.els['bot-job-cutoff'] = { value: '16:30' }; ctx.els['bot-job-straddle'] = { checked: true }; ctx.els['bot-job-straddle-min'] = { value: '0' };
  await ctx.botJobSave(); assert.equal(calls.filter(c => c.action === 'job_check').length, 0, 'the minutes are checked while the extra check is on');
  // v1105（独立レビュー P3）：補助の確認を使わないときは、分の欄が空でも保存できる（30 分に戻す）
  ctx.els['bot-job-straddle'] = { checked: false }; ctx.els['bot-job-straddle-min'] = { value: '' }; ctx.els['bot-job-g1p:checked'] = { value: 'check' };
  await ctx.botJobSave();
  assert.equal(calls.filter(c => c.action === 'job_check').length, 1);
  assert.equal(calls.filter(c => c.action === 'job_check')[0].config.g1p, 'check');
  assert.equal(JSON.stringify(calls.filter(c => c.action === 'job_check')[0].config.straddle), JSON.stringify({ enabled: false, minutes: 30 }));
  assert.equal(calls.filter(c => c.action === 'job_list').length, 2, 'a conflict reads the store again');
  assert.ok(ctx.toasts.some(([m]) => /先にこの店の設定を保存/.test(m)));
});

test('the attendance detector region is untouched by the Job check', () => {
  const start = source.indexOf('var CE_DEFAULT_CFG ='), end = source.indexOf('/* 1週(日〜土)。', start);
  assert.doesNotMatch(source.slice(start, end), /job_|botJob/);
});

// ---- v1105 独立レビュー（a9b2e32c4894cb2e1・cc7830c）の指摘
test('review P3: a start before business-day midnight shows as the previous day (same as ops-bot)', () => {
  const ctx = context();
  const v = '2026-10-19T23:00:00.000-1000';
  assert.equal(ctx.botJobSecs(v, '2026-10-20'), J.secondsFromBizMidnight(v, '2026-10-20'));
  assert.equal(ctx.botJobClock(ctx.botJobSecs(v, '2026-10-20')), '前日 23:00:00');
  assert.equal(J.clockText(J.secondsFromBizMidnight(v, '2026-10-20')), '前日 23:00:00');
  const c = caseOf(te(1, '15:00:00', SERVER, { inDate: v }));
  const html = ctx.botJobCaseHtml(c);
  assert.match(html, /前日 23:00:00/); assert.doesNotMatch(html, /-1:00/);
});

test('review P3: a broken stored setting is shown as stopped (not as a silent default); the matching text is right', async () => {
  const ctx = context({ role: 'gm' });
  ctx.botAPI = async body => body.action === 'job_list' ? { store_id: 'F06', jobs: [], rev: 2, config: null, config_invalid: true, read_at: null } : {};
  ctx.botJobCheckModal(); await new Promise(r => setImmediate(r));
  assert.match(ctx.modal, /設定の形が読めないため、この店の Job確認は止まっています/);
  ctx.botAPI = async body => body.action === 'job_list' ? { store_id: 'F06', jobs: [], rev: 2, config: scfg(), config_invalid: false, read_at: null } : {};
  ctx.botJobCheckModal(); await new Promise(r => setImmediate(r));
  assert.doesNotMatch(ctx.modal, /設定の形が読めない/);
  assert.doesNotMatch(ctx.modal, /ほかの店の人は見ない/, 'matching uses the whole employee master');
  assert.match(ctx.modal, /従業員マスター全体（ほかの店の人も）/);
});
