// v1105（UI案60 ②・Moto さんの回答 10/21）：Job確認（16:30 基準）。
// 店ごとの設定（bot_settings の job_check）で、打刻（Toast の time entry＝Job の区間 1 つ）の開始が
// 基準の時刻より前なら Prep の Job、ちょうど・以降なら Prep 以外の Job かを確かめる。
// ・時刻は営業日の 0 時（ハワイ時間・UTC-10）から数える。日をまたいだ 0:30 は 24:30＝「以降」。秒まで比べ、丸めない。
// ・Job は Toast の Job の ID で分ける（名前の一部では決めない）。分けていない Job は「判定不能（Job 要確認）」。
// ・だれを見るかは、判定したときの従業員マスター（グレード）。案件に残し、あとで昇格・異動しても変えない（指紋に入れない）。
// ・Bot は打刻・Job・時給を直さない。今の勤怠の案件（打刻漏れなど）とは別のキー（labor_job:…）で、今の案件を開き直さない。

export const JOB_CHECK = 'job_1630';
export const JOB_CLASSES = ['prep', 'service', 'exclude'];
export const G1P_MODES = ['exclude', 'check', 'unset'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// アプリの GRADE_TITLES・empGrade と同じ（tests/bot-job-check.test.mjs がアプリのものと同じかを見張る）
export const GRADE_TITLES = {
  G1: ['Crew', 'Office Crew', 'Office Staff'],
  'G1-P': ['Prep', 'Prep Specialist'],
  G2: ['Crew Leader', 'Office Crew Leader'],
  G3: ['Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader'],
  G4: ['Store Manager', 'Head Chef', 'Office Manager', 'Accountant'],
  G5: ['Area Manager', 'Corporate Chef', 'Customer Service Manager'],
  G6: ['General Manager'],
};
export function empGrade(e) {
  const title = e && e.title;
  if (title) for (const [g, list] of Object.entries(GRADE_TITLES)) if (list.includes(title)) return g;
  const r = e && e.role;
  if (r === 'gm') return 'G6'; if (r === 'am') return 'G5'; if (r === 'g4' || r === 'chef') return 'G4'; if (r === 'sl') return 'G3'; if (r === 'g2') return 'G2';
  if (r === 'crew' || r === 'office_crew') return 'G1';
  return '';
}
// 通常 G1＝グレード G1 で Prep の印なし。G1-P＝Prep の肩書き、または G1 で Prep の印あり。それ以外は見ない。
export function gradeClass(e) {
  const g = empGrade(e), prep = e?.prep === true || e?.data?.prep === true;
  if (g === 'G1-P') return 'g1p';
  if (g === 'G1') return prep ? 'g1p' : 'g1';
  return 'other';
}
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function toastName(e) { return (((e?.firstName || '') + ' ' + (e?.lastName || '')).trim()) || e?.name || ''; }
// Toast の名前 → 従業員マスターの人。そのまま同じ名前 → 表記をそろえて同じ名前（1 人だけのとき）。名前の一部では結ばない。
// 在籍の人（status が「退職」でない）から先に探す（同じ名前の退職した人がいても在籍の人で決まる）。在籍の人に無いときだけ退職した人も見る。
export function matchEmployee(name, employees) {
  const all = Array.isArray(employees) ? employees.filter(Boolean) : [];
  const active = all.filter(e => e.status !== '退職');
  const first = matchIn(name, active);
  return first.error === 'not_found' && active.length < all.length ? matchIn(name, all.filter(e => e.status === '退職')) : first;
}
function matchIn(name, list) {
  const exact = list.filter(e => e && e.name === name);
  if (exact.length === 1) return { emp: exact[0] };
  if (exact.length > 1) return { error: 'ambiguous' };
  const n = norm(name); if (!n) return { error: 'not_found' };
  const loose = list.filter(e => e && norm(e.name) === n);
  if (loose.length === 1) return { emp: loose[0] };
  return { error: loose.length ? 'ambiguous' : 'not_found' };
}
const isoDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const ymd = s => /^\d{8}$/.test(String(s || '')) ? String(s).slice(0, 4) + '-' + String(s).slice(4, 6) + '-' + String(s).slice(6, 8) : null;
// Toast の時刻（+0000 の形も）→ ミリ秒
export function parseToastTime(v) {
  if (typeof v !== 'string' || !v) return NaN;
  return Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}
// 営業日の 0 時（ハワイ時間）からの秒（小数のまま）
export function secondsFromBizMidnight(inDate, businessDate) {
  const t = parseToastTime(inDate), base = Date.parse(businessDate + 'T00:00:00-10:00');
  return Number.isFinite(t) && Number.isFinite(base) ? (t - base) / 1000 : null;
}
const cutoffSeconds = cutoff => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cutoff || ''); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
export function clockText(seconds) {
  if (!Number.isFinite(seconds)) return '時刻不明';
  if (seconds < 0) return '前日 ' + clockText(seconds + 86400);   // 営業日の 0 時より前に始めた打刻
  const s = Math.floor(seconds), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// 設定（GM・CEO が保存する）。店ごと。足りない・形の違う値は保存しない。
export function validJobCheck(input, storeIds = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.stores || typeof input.stores !== 'object' || Array.isArray(input.stores)) throw Error('invalid_job_check');
  const out = { stores: {} };
  const ids = Object.keys(input.stores);
  if (ids.length > 20) throw Error('invalid_job_check');
  for (const id of ids) {
    if (!/^[A-Z0-9-]{2,10}$/.test(id) || (storeIds && !storeIds.includes(id))) throw Error('invalid_store');
    const s = input.stores[id];
    if (!s || typeof s !== 'object' || typeof s.enabled !== 'boolean' || cutoffSeconds(s.cutoff) === null || !isoDate(s.from) || !G1P_MODES.includes(s.g1p)) throw Error('invalid_job_check');
    const straddle = s.straddle && typeof s.straddle === 'object' ? { ...s.straddle } : { enabled: false, minutes: 30 };
    const okMinutes = Number.isInteger(straddle.minutes) && straddle.minutes >= 1 && straddle.minutes <= 600;
    if (typeof straddle.enabled !== 'boolean' || (straddle.enabled && !okMinutes)) throw Error('invalid_job_check');
    if (!okMinutes) straddle.minutes = 30;   // 補助の確認を使わないときは、分の欄が空でも保存できる（前の 30 分に戻す）
    const jobs = {};
    const entries = Object.entries(s.jobs || {});
    if (entries.length > 300) throw Error('invalid_job_check');
    for (const [guid, j] of entries) {
      if (!UUID.test(guid) || !j || typeof j !== 'object') throw Error('invalid_job_check');
      const name = String(j.name || '').slice(0, 120);
      if (j.cls !== null && j.cls !== undefined && !JOB_CLASSES.includes(j.cls)) throw Error('invalid_job_check');
      jobs[guid.toLowerCase()] = { name, cls: JOB_CLASSES.includes(j.cls) ? j.cls : null, deleted: j.deleted === true };
    }
    out.stores[id] = { enabled: s.enabled, cutoff: s.cutoff, from: s.from, g1p: s.g1p, straddle: { enabled: straddle.enabled, minutes: straddle.minutes }, jobs };
  }
  return out;
}
export function storeJobCheck(config, storeId) {
  const s = config?.stores?.[storeId];
  if (!s) return null;
  try { return validJobCheck({ stores: { [storeId]: s } }).stores[storeId]; } catch { return null; }
}

const GRADE_JA = { g1: '通常G1', g1p: 'G1-P' };
// 1 つの打刻（Job の区間）を判定する。{skip:true} は見ない（対象外）。kinds が空でなければ指摘または判定不能。
export function jobVerdict(te, { grade, employeeError = null }, scfg, businessDate) {
  const bd = ymd(te?.businessDate) || businessDate;
  const secs = secondsFromBizMidnight(te?.inDate, bd), cut = cutoffSeconds(scfg.cutoff);
  const jobGuid = String(te?.jobReference?.guid || '').toLowerCase(), job = jobGuid ? scfg.jobs[jobGuid] : null;
  const base = { seconds: secs, job_guid: jobGuid || null, job_name: job?.name || null, job_class: job?.cls || null, cutoff: scfg.cutoff, business_date: bd };
  if (job?.cls === 'exclude') return { ...base, skip: true, reason: 'job_excluded' };
  const expected = secs === null ? null : secs < cut ? 'prep' : 'service';
  if (employeeError) return { ...base, kinds: ['job_emp_unknown'], expected, employee_error: employeeError };
  // 見ない人（G2 以上・G1-P を見ない設定）は、開始時刻が読めなくても案件にしない
  if (grade === 'other' || !grade) return { ...base, skip: true, reason: 'grade_out_of_scope' };
  if (grade === 'g1p' && scfg.g1p === 'exclude') return { ...base, skip: true, reason: 'g1p_excluded' };
  if (secs === null) return { ...base, kinds: ['job_start_unknown'], expected: null };
  if (grade === 'g1p' && scfg.g1p === 'unset') return { ...base, kinds: ['job_class_unset'], expected };
  if (!jobGuid || !job || !job.cls) return { ...base, kinds: ['job_unknown'], expected };
  const kinds = [];
  if (job.cls !== expected) kinds.push(expected === 'prep' ? 'job_before' : 'job_after');
  else if (scfg.straddle?.enabled && job.cls === 'prep') {
    const out = secondsFromBizMidnight(te?.outDate, bd);
    if (out !== null && out > cut + scfg.straddle.minutes * 60) kinds.push('job_straddle');
  }
  return { ...base, kinds, expected };
}

// 店・日の打刻から指摘を作る（scan から呼ぶ）。appEmployees は従業員マスター（name・title・role・prep）。
export function jobFindings({ entries, toastEmployees, appEmployees, scfg, store, date, isSystemAccount = () => false, now = new Date() }) {
  if (!scfg || !scfg.enabled || !isoDate(date) || date < scfg.from) return [];
  const names = new Map((toastEmployees || []).map(e => [e.guid, toastName(e) || e.guid]));
  const out = [];
  for (const te of entries || []) {
    const id = te?.employeeReference?.guid;
    if (!te || te.deleted || !te.guid || !id || isSystemAccount(names.get(id), store.store_id)) continue;
    const name = names.get(id) || id, m = matchEmployee(name, appEmployees);
    const grade = m.emp ? gradeClass(m.emp) : null;
    const v = jobVerdict(te, { grade, employeeError: m.error || null }, scfg, date);
    if (v.skip || !v.kinds.length) continue;
    // 打刻の ID は time_entry_guid だけに置く（shifts[].guid は前の版の確かめ直し（勤怠の決まり）が読むので入れない＝ops-bot を前に戻しても Job の案件を「直った」で閉じない）
    const shift = { inDate: te.inDate ?? null, outDate: te.outDate ?? null, employee_guid: id, job_guid: v.job_guid, job_name: v.job_name, job_class: v.job_class };
    const cfg = { check: JOB_CHECK, cutoff: scfg.cutoff, expected: v.expected, grade, grade_name: GRADE_JA[grade] || null, app_employee: m.emp?.name || null, employee_error: v.employee_error || null, from: scfg.from };
    out.push({
      source_key: 'labor_job:' + store.store_id + ':' + date + ':' + te.guid, kind: 'labor', store_id: store.store_id, business_date: date,
      subject: name + ' / Job確認（' + scfg.cutoff + '）',
      payload: {
        check: JOB_CHECK, employee_guid: id, employee_name: name, store_name: store.name, kinds: v.kinds, shifts: [shift], cfg, time_entry_guid: te.guid,
        grade, graded_at: now.toISOString(), source: 'toast_direct', fetched_at: now.toISOString(), open_shift: false, draft: '',
        // 指紋は打刻・Job・判定だけ（区分・取得時刻は入れない＝判定した日の区分を残し、昇格・異動で開き直さない）
        fingerprint: JSON.stringify({ check: JOB_CHECK, entry: te.guid, inDate: te.inDate ?? null, job: v.job_guid, kinds: v.kinds, expected: v.expected, cutoff: scfg.cutoff, ...(v.kinds.includes('job_straddle') ? { outDate: te.outDate ?? null } : {}) })
      }
    });
  }
  return out;
}

const KIND_JA = (cutoff) => ({
  job_before: cutoff + '前のためPrepか確認',
  job_after: cutoff + '以降のため営業用Jobか確認',
  job_straddle: cutoff + 'をまたぐPrep（確認）',
  job_unknown: '判定不能：Jobが未分類（設定で選ぶ）',
  job_emp_unknown: '判定不能：従業員マスターに名前が見つからない',
  job_class_unset: '判定不能：G1-Pの扱いが未設定',
  job_start_unknown: '判定不能：開始時刻が分からない'
});
export function isJobCase(c) { return Array.isArray(c?.kinds) && c.kinds.some(k => /^job_/.test(String(k))) || c?.payload?.check === JOB_CHECK; }
// 朝の報告・LINE の文：「LaLa／通常G1／15:00:12開始／Server → 16:30前のためPrepか確認」
export function jobCaseLine(c) {
  const cfg = c.shift_cfg || c.cfg || c.payload?.cfg || {}, sh = (c.shifts || c.payload?.shifts || [])[0] || {};
  const kinds = c.kinds || c.payload?.kinds || [], cutoff = /^\d{2}:\d{2}$/.test(cfg.cutoff || '') ? cfg.cutoff : '16:30';
  const bd = c.business_date || c.payload?.business_date;
  const secs = bd ? secondsFromBizMidnight(sh.inDate, String(bd).slice(0, 10)) : null;
  const store = String(c.store_name || c.payload?.store_name || c.store_id || '').slice(0, 40);
  const labels = KIND_JA(cutoff);
  return [store, cfg.grade_name || '区分不明', (secs === null ? '開始時刻不明' : clockText(secs) + '開始'), (sh.job_name || 'Job不明') + ' → ' + kinds.map(k => labels[k] || k).join('・')].join('／');
}
export function jobKindLabel(kind, cutoff = '16:30') { return KIND_JA(cutoff)[kind] || null; }
