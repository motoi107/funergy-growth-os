// v1105（UI案60 ②）：Job確認（16:30 基準）。合成データだけ（名前・ID はすべて作りもの）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const J = await import('../bot/job-check.mjs');
const { createHandler, formatResponsibleMorningReports, laborFindings } = await import(process.env.BOT_HANDLER_PATH || '../supabase/functions/ops-bot/handler.mjs');

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PREP = id(501), SERVER = id(502), KITCHEN = id(503), DEFAULT = id(504), HOST2 = id(505);
const scfg = (over = {}) => ({ enabled: true, cutoff: '16:30', from: '2026-10-16', g1p: 'exclude', straddle: { enabled: false, minutes: 30 },
  jobs: { [PREP]: { name: 'Prep', cls: 'prep' }, [SERVER]: { name: 'Server', cls: 'service' }, [KITCHEN]: { name: 'Kitchen', cls: 'service' }, [DEFAULT]: { name: 'Server Default', cls: 'exclude' } }, ...over });
const store = { store_id: 'F06', name: 'LaLa' };
const te = (n, inClock, job, extra = {}) => ({ guid: id(n), employeeReference: { guid: id(900) }, jobReference: job ? { guid: job } : undefined,
  inDate: inClock === null ? null : '2026-10-20T' + inClock + (inClock.includes('.') ? '' : '.000') + '-10:00', outDate: '2026-10-20T22:00:00.000-10:00', businessDate: '20261020', ...extra });
const toastEmployees = [{ guid: id(900), firstName: 'Synthetic', lastName: 'Crew' }];
const app = (over = {}) => [{ name: 'Synthetic Crew', title: 'Crew', role: 'crew', ...over }];
const find = (entries, opts = {}) => J.jobFindings({ entries, toastEmployees: opts.toast || toastEmployees, appEmployees: opts.app || app(), scfg: opts.scfg || scfg(), store, date: opts.date || '2026-10-20', isSystemAccount: opts.sys || (() => false) });
const kinds = (clock, job, opts) => { const f = find([te(1, clock, job)], opts); return f.length ? f[0].payload.kinds : []; };

test('the required boundary examples (normal G1, LaLa, Hawaii time)', () => {
  assert.deepEqual(kinds('15:00:00', PREP), []);
  assert.deepEqual(kinds('15:00:00', SERVER), ['job_before']);
  assert.deepEqual(kinds('16:29:59', PREP), []);
  assert.deepEqual(kinds('16:30:00', PREP), ['job_after']);
  assert.deepEqual(kinds('16:30:00', SERVER), []);
  assert.deepEqual(kinds('17:00:00', PREP), ['job_after']);
  assert.deepEqual(kinds('17:00:00', KITCHEN), []);
  assert.deepEqual(kinds('16:29:59.999', SERVER), ['job_before'], 'no rounding: 16:29:59.999 is before');
  assert.deepEqual(kinds(null, PREP), ['job_start_unknown']);
  assert.deepEqual(kinds('15:00:00', HOST2), ['job_unknown'], 'a job not classified is never treated as fine');
  assert.deepEqual(kinds('15:00:00', null), ['job_unknown']);
  assert.deepEqual(kinds('15:00:00', DEFAULT), [], 'excluded jobs are not judged');
});

test('who is checked: normal G1 only by default; G1-P follows its setting; other grades never', () => {
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ title: 'Prep Specialist' }) }), [], 'G1-P excluded (answer 3 A)');
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ title: 'Crew', prep: true }) }), [], 'G1 with the Prep mark counts as G1-P');
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ title: 'Prep' }), scfg: scfg({ g1p: 'check' }) }), ['job_before']);
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ title: 'Prep' }), scfg: scfg({ g1p: 'unset' }) }), ['job_class_unset']);
  for (const title of ['Crew Leader', 'Server Leader', 'Store Manager']) assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ title }) }), [], title);
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ title: '', role: 'crew' }) }), ['job_before'], 'no title: role crew is G1');
  assert.deepEqual(kinds('15:00:00', SERVER, { app: [] }), ['job_emp_unknown'], 'a Toast name not in the master is shown as undetermined');
  assert.deepEqual(kinds('15:00:00', SERVER, { app: [...app(), ...app()] }), ['job_emp_unknown'], 'two people with the same name are not guessed');
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ name: '  synthetic   CREW ' }) }), ['job_before'], 'spacing and case are aligned');
  assert.deepEqual(kinds('15:00:00', SERVER, { app: app({ name: 'Synthetic Crew Jr' }) }), ['job_emp_unknown'], 'a partial name never matches');
  assert.deepEqual(kinds('15:00:00', SERVER, { sys: () => true }), [], 'system accounts are left out as in the attendance check');
});

test('application start date, disabled setting, other stores', () => {
  assert.equal(find([te(1, '15:00:00', SERVER)], { date: '2026-10-15' }).length, 0, 'before 10/16 (answer 4)');
  assert.equal(find([te(1, '15:00:00', SERVER)], { date: '2026-10-16' }).length, 1);
  assert.equal(find([te(1, '15:00:00', SERVER)], { scfg: scfg({ enabled: false }) }).length, 0);
  assert.equal(J.storeJobCheck({ stores: { F06: scfg() } }, 'F01'), null, 'no setting for another store');
});

test('several punches, job switch after a break, and after-midnight starts', () => {
  const day = [te(1, '14:00:00', PREP), te(2, '16:30:00', SERVER), te(3, '18:00:00', PREP)];
  const f = find(day);
  assert.deepEqual(f.map(x => [x.payload.time_entry_guid, x.payload.kinds]), [[id(3), ['job_after']]]);
  const night = te(4, '00:30:00', PREP, { inDate: '2026-10-21T00:30:00.000-10:00' });
  assert.deepEqual(find([night]).map(x => x.payload.kinds), [['job_after']], '00:30 the next morning is 24:30 of the business day');
  assert.deepEqual(find([te(5, '15:00:00', PREP, { inDate: '2026-10-21T01:00:00.000+0000' })]).map(x => x.payload.kinds), [], 'Toast +0000 form: 15:00 HST');
  assert.deepEqual(find([te(6, '15:00:00', SERVER, { deleted: true })]), [], 'deleted entries are ignored');
});

test('the straddle check stays off unless switched on, and is a separate kind', () => {
  const long = te(7, '15:00:00', PREP, { outDate: '2026-10-20T17:30:00.000-10:00' });
  assert.deepEqual(find([long]), []);
  assert.deepEqual(find([long], { scfg: scfg({ straddle: { enabled: true, minutes: 30 } }) }).map(x => x.payload.kinds), [['job_straddle']]);
  assert.deepEqual(find([te(8, '15:00:00', PREP, { outDate: '2026-10-20T16:59:00.000-10:00' })], { scfg: scfg({ straddle: { enabled: true, minutes: 30 } }) }), []);
});

test('the result is the same on a Japan-time device or server clock (explicit Hawaii offset)', () => {
  const code = "import('" + new URL('../bot/job-check.mjs', import.meta.url).href + "').then(J=>console.log(J.secondsFromBizMidnight('2026-10-20T16:30:00.000-10:00','2026-10-20')))";
  for (const TZ of ['Asia/Tokyo', 'Pacific/Honolulu', 'UTC']) assert.equal(execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ } }).toString().trim(), '59400', TZ);
});

test('fingerprints: re-reading does not duplicate; the recorded grade is not part of it', () => {
  const a = find([te(1, '15:00:00', SERVER)])[0], b = find([te(1, '15:00:00', SERVER)])[0];
  assert.equal(a.source_key, 'labor_job:F06:2026-10-20:' + id(1));
  assert.equal(a.kind, 'labor');
  assert.equal(a.payload.fingerprint, b.payload.fingerprint);
  const g1pChecked = find([te(1, '15:00:00', SERVER)], { app: app({ title: 'Prep' }), scfg: scfg({ g1p: 'check' }) })[0];
  assert.equal(g1pChecked.payload.fingerprint, a.payload.fingerprint, 'a later grade change does not reopen the case');
  assert.equal(a.payload.grade, 'g1'); assert.equal(a.payload.cfg.grade_name, '通常G1');
  // the existing attendance case for the same day is unchanged by the Job check (its own key and fingerprint)
  const cfg = { nightFrom: '03:00', nightTo: '05:00', longH: 12, shortMin: 15 };
  const open = [te(1, '15:00:00', SERVER, { outDate: null })];
  const labor = laborFindings(open, toastEmployees, cfg, store, '2026-10-20');
  assert.equal(labor.length, 1); assert.match(labor[0].source_key, /^labor:F06:/);
  assert.equal(labor[0].payload.fingerprint, JSON.stringify({ shifts: [{ guid: id(1), inDate: open[0].inDate, outDate: null, employee_guid: id(900), autoClockedOut: false }], kinds: labor[0].payload.kinds, cfg, override: false }));
});

test('the bot grade rules match the app (GRADE_TITLES and empGrade)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const titles = html.match(/^var GRADE_TITLES = \{[\s\S]*?\n\};/m)[0];
  const start = html.indexOf('function gradeOf(title){'), end = html.indexOf('\n}', html.indexOf('function empGrade(e){')) + 2;
  const c = vm.createContext({}); vm.runInContext(titles + '\n' + html.slice(start, end), c);
  assert.deepEqual(JSON.parse(JSON.stringify(c.GRADE_TITLES)), J.GRADE_TITLES);
  for (const e of [{ title: 'Crew' }, { title: 'Prep' }, { title: 'Head Chef' }, { role: 'crew' }, { role: 'office_crew' }, { role: 'sl' }, { role: 'chef' }, { title: 'Unknown', role: 'g2' }, {}])
    assert.equal(J.empGrade(e), c.empGrade(e), JSON.stringify(e));
});

test('settings are validated and stored per store', () => {
  assert.throws(() => J.validJobCheck({ stores: { F06: { ...scfg(), cutoff: '25:00' } } }), /invalid_job_check/);
  assert.throws(() => J.validJobCheck({ stores: { F06: { ...scfg(), from: '2026-02-30' } } }), /invalid_job_check/);
  assert.throws(() => J.validJobCheck({ stores: { F06: { ...scfg(), g1p: 'maybe' } } }), /invalid_job_check/);
  assert.throws(() => J.validJobCheck({ stores: { F06: { ...scfg(), jobs: { 'not-a-guid': { name: 'x', cls: 'prep' } } } } }), /invalid_job_check/);
  assert.throws(() => J.validJobCheck({ stores: { F06: { ...scfg(), jobs: { [PREP]: { name: 'x', cls: 'boss' } } } } }), /invalid_job_check/);
  assert.throws(() => J.validJobCheck({ stores: { F99: scfg() } }, ['F06']), /invalid_store/);
  const ok = J.validJobCheck({ stores: { F06: { ...scfg(), jobs: { [HOST2]: { name: 'Host 2', cls: null } } } } });
  assert.equal(ok.stores.F06.jobs[HOST2].cls, null, 'an unclassified job is kept as unclassified');
});

test('morning report line for a Job case', () => {
  const f = find([te(1, '15:00:12', SERVER)])[0];
  const detail = { code: '#41', store_id: 'F06', store_name: 'LaLa', business_date: '2026-10-20', kind: 'labor', subject: f.subject, status: 'review', employee_name: 'Synthetic Crew', kinds: f.payload.kinds, shifts: f.payload.shifts, shift_cfg: f.payload.cfg, open_shift: false };
  const snapshot = { day: '2026-10-22', from: '2026-10-01', to: '2026-10-21', expected: 21, ok: 21, failed: 0, active_stores: 1, finance_enabled: true, finance_ok: 21, details: [detail], detail_total: 1, counts: { labor: 1, void: 0, unpaid: 0 }, stores: [{ store_id: 'F06', labor: 1, void: 0, unpaid: 0 }] };
  const text = formatResponsibleMorningReports(snapshot).messages.map(m => m.text).join('\n');
  assert.match(text, /内容：Job確認（16:30 基準）\nLaLa／通常G1／15:00:12開始／Server → 16:30前のためPrepか確認/);
  assert.match(text, /案件：#41/);
});

// ---- handler：scan・確かめ直し・設定（Supabase・Toast はまね）
function harness({ setting = { stores: { F06: scfg() } }, entries = [te(1, '15:00:00', SERVER)], role = 'gm', employees = app(), recheckEntry = null, existing = null, rowDb = null } = {}) {
  const writes = [], records = [], saved = [];
  const env = k => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', TOAST_CLIENT_ID: 'x', TOAST_CLIENT_SECRET: 'y' })[k];
  const handler = createHandler({ env, fetch: async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return Response.json({ id: id(99) });
    if (u.includes('/manager_auth?')) return Response.json([{ role }]);
    if (u.includes('/store_config?')) return Response.json([{ store_id: 'F06', restaurant_guid: id(77), name: 'LaLa' }]);
    if (u.includes('/bot_settings?key=eq.clock')) return Response.json([{ value: { nightFrom: '03:00', nightTo: '05:00', longH: 12, shortMin: 15 } }]);
    if (rowDb && u.includes('/bot_settings?key=eq.job_check')) {
      if ((init.method || 'GET') === 'GET') return Response.json(rowDb.row ? [{ value: structuredClone(rowDb.row.value) }] : []);
      // PATCH：版（value->>rev）が同じ行だけ書く（PostgREST の絞り込みのまね）
      rowDb.beforeWrite?.(rowDb);
      const q = decodeURIComponent(u.split('?')[1]), rev = rowDb.row?.value?.rev;
      const ok = rowDb.row && (/value->>rev=is\.null/.test(q) ? rev === undefined || rev === null : q.includes('value->>rev=eq.' + rev));
      if (!ok) return Response.json([]);
      rowDb.row = { value: JSON.parse(init.body).value }; saved.push({ value: rowDb.row.value }); return Response.json([rowDb.row]);
    }
    if (rowDb && u.includes('/bot_settings?on_conflict=key')) {
      rowDb.beforeWrite?.(rowDb);
      assert.match(init.headers.Prefer, /ignore-duplicates/);
      if (rowDb.row) return Response.json([]);
      rowDb.row = { value: JSON.parse(init.body).value }; saved.push({ value: rowDb.row.value }); return Response.json([rowDb.row]);
    }
    if (u.includes('/bot_settings?key=eq.job_check')) return Response.json(setting ? [{ value: setting }] : []);
    if (u.includes('/bot_settings?on_conflict=key')) { saved.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
    if (u.endsWith('/rpc/bot_take_run')) return Response.json(true);
    if (u.includes('/bot_runs?')) return new Response(null, { status: 204 });
    if (u.includes('/app_state?')) return Response.json([]);
    if (u.includes('/employees?')) { if (!/select=name,title,role,status,prep:data->prep/.test(u)) console.error('EMPURL', u); return Response.json(employees); }
    if (u.endsWith('/rpc/bot_case_write')) { const b = JSON.parse(init.body); writes.push(b); return Response.json({ id: id(10), status: 'done' }); }
    if (u.endsWith('/rpc/bot_record_check')) { records.push(JSON.parse(init.body)); return Response.json({}); }
    if (u.includes('/bot_cases?id=')) return Response.json(existing ? [existing] : []);
    if (u.includes('/authentication/v1/authentication/login')) return Response.json({ token: { accessToken: 't' } });
    if (u.includes('/labor/v1/timeEntries?timeEntryIds=')) return Response.json(recheckEntry ? [recheckEntry] : []);
    if (u.includes('/labor/v1/timeEntries?businessDate=')) return Response.json(entries);
    if (u.includes('/labor/v1/employees')) return Response.json(toastEmployees);
    if (u.includes('/labor/v1/jobs')) return Response.json([{ guid: PREP.toUpperCase(), title: 'Prep', deleted: false, defaultWage: 99 }, { guid: SERVER, title: 'Server', deleted: false }, { guid: 'bad', title: 'x' }]);
    throw Error('Unexpected request ' + u);
  } });
  const call = async body => { const r = await handler(new Request('https://fn.test', { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  return { call, writes, records, saved };
}

test('scan writes Job findings next to the attendance check, only when enabled', async () => {
  const h = harness();
  const r = await h.call({ action: 'scan', store_id: 'F06', date: '2026-10-20' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const keys = h.writes.map(w => w.p_data.source_key);
  assert.ok(keys.includes('labor_job:F06:2026-10-20:' + id(1)), keys.join(','));
  const off = harness({ setting: null }); await off.call({ action: 'scan', store_id: 'F06', date: '2026-10-20' });
  assert.equal(off.writes.filter(w => /^labor_job:/.test(w.p_data.source_key)).length, 0);
});

const jobCase = (over = {}) => ({ id: id(10), version: 4, kind: 'labor', store_id: 'F06', business_date: '2026-10-20', status: 'review', payload: { ...find([te(1, '15:00:00', SERVER)])[0].payload, ...over } });
test('re-check: corrected, still wrong, deleted, setting off, G1-P later excluded', async () => {
  let h = harness({ existing: jobCase(), recheckEntry: te(1, '15:00:00', PREP) });
  let r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.verification_type, 'job_corrected'); assert.equal(h.writes[0].p_op, 'verified');
  h = harness({ existing: jobCase(), recheckEntry: te(1, '15:00:00', SERVER) });
  r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.message, 'still_flagged_or_manual_review'); assert.equal(h.writes.length, 0);
  h = harness({ existing: jobCase(), recheckEntry: te(1, '15:00:00', SERVER, { deleted: true }) });
  r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.verification_type, 'time_entry_deleted');
  h = harness({ existing: jobCase(), recheckEntry: te(1, '15:00:00', PREP), setting: { stores: { F06: scfg({ enabled: false }) } } });
  r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.message, 'job_check_disabled'); assert.equal(h.writes.length, 0);
  h = harness({ existing: jobCase({ grade: 'g1p' }), recheckEntry: te(1, '15:00:00', SERVER) });
  r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.verification_type, 'job_scope_excluded');
  h = harness({ existing: jobCase(), recheckEntry: te(1, '15:00:00', PREP, { businessDate: '20261021' }) });
  r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.message, 'still_flagged_or_manual_review', 'a moved business day is reviewed by a person');
  h = harness({ existing: jobCase(), recheckEntry: { ...te(1, '15:00:00', PREP), employeeReference: { guid: id(901) } } });
  r = await h.call({ action: 'recheck', id: id(10), version: 4 });
  assert.equal(r.body.message, 'still_flagged_or_manual_review', 'an entry moved to another person is reviewed');
});

test('settings actions: GM/CEO only, jobs listed by ID without wages, other stores kept', async () => {
  let h = harness({ role: 'office' });
  assert.equal((await h.call({ action: 'job_list', store_id: 'F06' })).status, 403);
  assert.equal((await h.call({ action: 'job_check', store_id: 'F06', config: scfg() })).status, 403);
  h = harness({ setting: { stores: { F01: scfg({ enabled: false }) } } });
  const list = await h.call({ action: 'job_list', store_id: 'F06' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.jobs, [{ guid: PREP, title: 'Prep', deleted: false }, { guid: SERVER, title: 'Server', deleted: false }]);
  assert.doesNotMatch(JSON.stringify(list.body), /defaultWage|99/);
  assert.equal(list.body.rev, 0, 'a store without a setting starts at version 0');
  assert.equal((await harness().call({ action: 'job_check', store_id: 'F06', config: { ...scfg(), cutoff: '9' }, expect_rev: 1 })).status, 400);
  assert.equal((await harness().call({ action: 'job_check', store_id: 'F06', config: scfg() })).status, 400, 'the version read is required');
});

test('settings save: version per store, other stores kept even when saved at the same time', async () => {
  // 前の形（版なし）の行：F01 だけ
  const rowDb = { row: { value: { stores: { F01: scfg({ enabled: false }) } } } };
  let h = harness({ rowDb });
  let r = await h.call({ action: 'job_check', store_id: 'F06', config: scfg(), expect_rev: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.rev, 1);
  assert.deepEqual(Object.keys(rowDb.row.value.stores).sort(), ['F01', 'F06']);
  assert.equal(rowDb.row.value.rev, 1); assert.equal(rowDb.row.value.stores.F06.rev, 1); assert.equal(rowDb.row.value.stores.F06.updated_by, id(99));
  // 古い画面（F06 を版 0 で読んだまま）の保存は断る＝先の保存を上書きしない
  r = await h.call({ action: 'job_check', store_id: 'F06', config: scfg({ cutoff: '17:00' }), expect_rev: 0 });
  assert.equal(r.status, 409); assert.equal(rowDb.row.value.stores.F06.cutoff, '16:30');
  // 前の形の店（版なし）は版 1 とみなす
  r = await h.call({ action: 'job_check', store_id: 'F01', config: scfg({ enabled: true }), expect_rev: 0 });
  assert.equal(r.status, 409);
  // 書く直前にほかの人が別の店（F01）を保存した → 読み直して F01 の変更を残したまま F06 を書く
  let once = true;
  rowDb.beforeWrite = db => { if (!once) return; once = false; db.row = { value: { ...db.row.value, rev: db.row.value.rev + 1, stores: { ...db.row.value.stores, F01: { ...scfg({ enabled: true, cutoff: '15:00' }), rev: 2 } } } }; };
  r = await h.call({ action: 'job_check', store_id: 'F06', config: scfg({ cutoff: '17:00' }), expect_rev: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(rowDb.row.value.stores.F01.cutoff, '15:00', 'the other store saved meanwhile is kept');
  assert.equal(rowDb.row.value.stores.F06.cutoff, '17:00'); assert.equal(rowDb.row.value.stores.F06.rev, 2); assert.equal(rowDb.row.value.rev, 3);
  // 書く直前に同じ店（F06）をほかの人が保存した → 読み直すと版が違うので断る
  once = true;
  rowDb.beforeWrite = db => { if (!once) return; once = false; db.row = { value: { ...db.row.value, rev: db.row.value.rev + 1, stores: { ...db.row.value.stores, F06: { ...db.row.value.stores.F06, cutoff: '18:00', rev: 3 } } } }; };
  r = await h.call({ action: 'job_check', store_id: 'F06', config: scfg({ cutoff: '16:00' }), expect_rev: 2 });
  assert.equal(r.status, 409); assert.equal(rowDb.row.value.stores.F06.cutoff, '18:00');
  // まだ行が無い：作る。作る直前にほかの人が作っていたら読み直して合わせる
  const empty = { row: null };
  once = true;
  empty.beforeWrite = db => { if (!once) return; once = false; db.row = { value: { rev: 1, stores: { F01: { ...scfg(), rev: 1 } } } }; };
  h = harness({ rowDb: empty });
  r = await h.call({ action: 'job_check', store_id: 'F06', config: scfg(), expect_rev: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(empty.row.value.stores).sort(), ['F01', 'F06']);
  // job_list は店の版を返す
  const list = await h.call({ action: 'job_list', store_id: 'F06' });
  assert.equal(list.body.rev, 1); assert.equal(list.body.config.cutoff, '16:30');
});
