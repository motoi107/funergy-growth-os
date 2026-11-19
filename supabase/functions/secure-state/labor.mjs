// v1192：人件費の合計をサーバーで出す（Moto さん 11/18「サーバーで合計を出す（推奨）」）。
// 仕様：docs/LABOR_TOTALS_V1192_JA.md。
//
// ・経理・AM の端末には、v1192 の emp-private から全員の時給・月給が届かなくなる。その端末の人件費（予実・会議・ダッシュボード・
//   勤怠・労働時間）は、お金の部分だけをこの関数の答えに置き換える（人ごとの時間は端末で数えたまま）。
// ・計算は index.html の関数そのもの（labor-core.gen.mjs。`node scripts/build-labor-core.mjs` で作る・手で直さない）。
//   ここでは、CEO・GM の端末が持っているのと同じデータ（店・従業員と時給・設定・勤怠）をサーバーの鍵で読んで並べるだけ。
// ・返すのは店ごと・月ごとの合計（時給の人の合計・月給の日割り・休みの日の分・週ごとの同じもの・日ごとの合計・G1／G2 以上の分け）。
//   人ごとの額は返さない（限界：店の合計と人ごとの時間から、1 人だけの日の時給は割り出せる。docs の「限界」）。

import { laborCore } from './labor-core.gen.mjs';

// v1192（Codex 6986713362 の P2-1）：md_all_viewers は計算に使わないので読まない（全店で返すかは handler が app_state の md_all_viewers_gm で決める）
export const LT_SETTINGS = ['m_titlewage', 'kpi_config', 'tip_window', 'tip_hours_basis'];
export const LT_STATE = ['tip_hours_config', 'store_closures', 'prep_tables', 'prep_certs'];
// 端末が取り込むときの合流（端末に何も無い所へ合流した形）：mergeMapByTime のキーは「オブジェクトなら浅い写し・そうでなければ {}」
const LT_MAP_KEYS = ['prep_tables', 'prep_certs'];
export const LT_MAX_ASKS = 40;
const YM_RE = /^20\d\d-(0[1-9]|1[0-2])$/;
const DATE_RE = /^20\d\d-\d\d-\d\d$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 端末の app_settings／app_state の 1 行の値（文字）を、端末が localStorage に置く文字と同じにする
export function ltKvString(key, value) {
  let v = value;
  if (LT_MAP_KEYS.includes(key)) v = (v && typeof v === 'object') ? Object.assign({}, v) : {};
  else if (key.startsWith('att_fix_')) v = isObj(v) ? v : {};   // mergeLocalRecMap（_lrObj）：オブジェクトでなければ {}
  if (v === undefined) return null;
  return JSON.stringify(v);
}

// 店の表の行 → 端末の getStoresAll() と同じ形（並びは使わないので id の順のまま）
export function ltStores(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = r && r.data;
    if (!isObj(x) || x._deleted === true) continue;
    const s = Object.assign({}, x);
    if (s.active === undefined) s.active = true;
    if (!s.brand) s.brand = s.name;
    if (s.toastGuid) s.toastGuid = String(s.toastGuid).trim().toLowerCase();
    if (s.format === undefined) s.format = (s.brand === 'Tenkichi' || s.brand === 'Marujuu') ? 'izakaya' : 'dining';
    if (s.lunchHours === undefined) s.lunchHours = '11:00-14:30';
    if (s.dinnerHours === undefined) s.dinnerHours = '17:00-22:00';
    if (s.takeout === undefined) s.takeout = true;
    out.push(s);
  }
  return out;
}

// 従業員の表の行と保護の表（時給・月給） → CEO・GM の端末の getEmployees() と同じ形
export function ltEmployees(rows, privRows) {
  const priv = new Map();
  for (const p of Array.isArray(privRows) ? privRows : []) if (p && p.emp_id != null) priv.set(String(p.emp_id), p);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = r && r.data;
    if (!isObj(x)) continue;
    if (x.isTest === true || String(x.id || '').indexOf('tst_') === 0) continue;   // _stripTestRows と同じ
    const e = Object.assign({}, x);
    if (e.coef === undefined) e.coef = 1.0;
    const p = priv.get(String(e.id));
    if (p) {
      // emp-private の rowToPriv と getEmployees の重ね方：wage は Number(…)||0、月給は null でなければ
      e.wage = Number(p.wage) || 0;
      const ms = p.monthly_salary == null ? null : Number(p.monthly_salary);
      if (ms !== undefined && ms !== null) e.monthlySalary = ms;
    }
    out.push(e);
  }
  return out;
}

// HST（ハワイ）の今日
function hstToday(nowMs) {
  const d = new Date(nowMs - 10 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
const dayMs = s => Date.parse(s + 'T00:00:00Z');

// 端末の「今日（ハワイ）」を使う（端末と同じ締め＝今月は昨日まで）。サーバーの今日と 1 日より離れていたらサーバーの今日
export function ltToday(to, nowMs) {
  const srv = hstToday(nowMs);
  if (typeof to === 'string' && DATE_RE.test(to) && Number.isFinite(dayMs(to)) && Math.abs(dayMs(to) - dayMs(srv)) <= 86400000) return to;
  return srv;
}

// 頼まれた店・月ごとの合計を出す。data＝{ stores, employees, kv（キー → 端末と同じ文字）, today, jobs（勤怠の行） }
export function ltCompute(data, asks) {
  const kv = data.kv;
  const parsed = new Map();
  const ls = (k, def) => { const v = kv.has(k) ? kv.get(k) : null; try { return v ? JSON.parse(v) : def; } catch { return def; } };
  const lrRead = k => {
    if (parsed.has(k)) return parsed.get(k);
    let v = null; const raw = kv.has(k) ? kv.get(k) : null;
    try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
    parsed.set(k, v); return v;
  };
  let keys = null;
  const memo = {};
  const today = data.today;
  const core = laborCore({
    window: {},
    STORES: data.stores,
    _lrRead: lrRead,
    _lsRaw: ls,
    _mdMemo: (ns, key, make) => { const b = memo[ns] || (memo[ns] = {}); if (Object.prototype.hasOwnProperty.call(b, key)) return b[key]; b[key] = make(); return b[key]; },
    bizToday: () => today,
    curYm: () => today.slice(0, 7),
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    getEmployees: () => data.employees,
    ls,
    lsKeys: p => { const pre = p == null ? '' : String(p); if (!keys) keys = [...kv.keys()]; return keys.filter(k => k.indexOf(pre) === 0); },
    t: ja => ja,
    v1136Moved: () => true,
  });
  const emps = data.employees;
  // 読んだ勤怠を、端末が取り込むときと同じ関数（tipLaborBuildDay）・同じ設定で tip_labor_<店>_<日> の形にする
  const aidx = core.toastAliasIndex(emps);
  for (const j of data.jobs || []) {
    for (const row of j.rows || []) {
      const list = row && row.data;
      if (!Array.isArray(list) || !list.length) continue;   // 端末も中身の無い日は書かない
      const bd = core.normalizeBusinessDate(row.business_date);
      if (!bd || !DATE_RE.test(bd) || bd < j.from || bd > j.to) continue;
      for (const sid of j.sids) kv.set('tip_labor_' + sid + '_' + bd, JSON.stringify(core.tipLaborBuildDay(sid, bd, list, emps, aidx)));
    }
  }
  keys = null; parsed.clear();
  for (const k of Object.keys(memo)) delete memo[k];
  const out = {};
  const salCache = {};
  for (const { s: sid, m: ym } of asks) {
    const P = core._laborWageParts(sid, ym, {});
    const w = {};
    for (const wk of core.laborMonthWeeks(ym)) {
      const q = core._laborWageParts(sid, ym, { weekSun: wk.sun });
      w[wk.sun] = { hourly: q.hourly, leave: q.leave, leaveDays: q.leaveDays, salary: q.salary };
    }
    const d = {};
    for (const dd of core.daysOfYm(ym)) {
      const dt = dd.date;
      if (core.getTipLabor(sid, dt) == null) continue;
      const ml = core._meetLaborLDDay(sid, dt), ld = core.ldLaborDay(sid, dt);
      d[dt] = { c: core.toastLaborCostForDate(sid, dt), ml: ml.lc, md: ml.dc, ll: ld.cL, ld: ld.cD };
    }
    if (!(sid in salCache)) salCache[sid] = core.storeSalaryMonthly(sid);
    const g = core._laborGradeSplit(sid, ym, P, emps);
    out[sid + '|' + ym] = { p: { hourly: P.hourly, leave: P.leave, leaveDays: P.leaveDays, salary: P.salary }, w, d, sal: salCache[sid], g: { g1: g.g1, g2: g.g2, has: g.has } };
  }
  return out;
}

// 頼みの形を確かめる（店は文字・月は YYYY-MM・40 件まで・同じものは 1 つに）
export function ltAsks(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > LT_MAX_ASKS) return null;
  const seen = new Set(), out = [];
  for (const a of raw) {
    if (!isObj(a) || typeof a.s !== 'string' || !a.s || a.s.length > 40 || !/^[A-Za-z0-9@_.-]+$/.test(a.s) || typeof a.m !== 'string' || !YM_RE.test(a.m)) return null;
    const k = a.s + '|' + a.m;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ s: a.s, m: a.m });
  }
  return out;
}

const enc = encodeURIComponent;
function ymRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [ym + '-01', ym + '-' + String(last).padStart(2, '0')];
}
function ymAdd(ym, d) { const [y, m] = ym.split('-').map(Number); const n = y * 12 + m - 1 + d; return Math.floor(n / 12) + '-' + String(n % 12 + 1).padStart(2, '0'); }
// 端末の k2SysGuids（業務用アカウントの Toast ID）が見る勤怠の範囲：その月の 13 か月前の 1 日から、端末にあるいちばん新しい日まで
export const LT_SYS_BACK = 13;
export const LT_PAGE = 1000, LT_MAX_PAGES = 60;

// v1192（Codex 6986713362 の確認）：limit を付けて 1 回で読むと、サーバーの上限（Supabase は既定で 1 回 1,000 行）で黙って切れる。
// 並びを決めて 1,000 行ずつ、空のページが来るまで読む（上限が 1,000 より小さくても切れない）。読み切れなければ失敗（途中までで合計を出さない）
export async function ltReadAll(rest, path) {
  const out = [];
  for (let page = 0; page < LT_MAX_PAGES; page++) {
    const rows = await rest(path + '&limit=' + LT_PAGE + '&offset=' + out.length);
    if (!Array.isArray(rows)) { const e = new Error('db'); e.code = 'db'; throw e; }
    if (!rows.length) return out;
    for (const r of rows) out.push(r);
  }
  const e = new Error('db'); e.code = 'db'; e.detail = 'too_many_rows'; throw e;
}

// サーバーの鍵でデータを読む（rest＝handler の rest）。読めなければ失敗（途中までのデータで合計を出さない）
export async function ltLoad(rest, asks, today) {
  const [storeRows, empRows, privRows, setRows, stRows] = await Promise.all([
    ltReadAll(rest, 'stores?select=id,data&order=id.asc'),
    ltReadAll(rest, 'employees?select=id,data&order=id.asc'),
    ltReadAll(rest, 'employees_private?select=emp_id,wage,monthly_salary&order=emp_id.asc'),
    rest('app_settings?select=key,value&key=in.(' + LT_SETTINGS.map(enc).join(',') + ')'),
    rest('app_state?select=key,value&key=in.(' + [...LT_STATE, ...[...new Set(asks.map(a => 'att_fix_' + a.s + '_' + a.m))]].map(enc).join(',') + ')'),
  ]);
  if (![storeRows, empRows, privRows, setRows, stRows].every(Array.isArray)) { const e = new Error('db'); e.code = 'db'; throw e; }
  const stores = ltStores(storeRows), employees = ltEmployees(empRows, privRows);
  const kv = new Map();
  for (const r of [...setRows, ...stRows]) { if (r && typeof r.key === 'string') { const s = ltKvString(r.key, r.value); if (s != null) kv.set(r.key, s); } }
  // 勤怠（店の Toast の GUID ごとに 1 回）。v1192（Codex 6986713362 の P2）：前は頼まれた月だけを読んだので、業務用アカウントの
  // Toast ID（k2SysGuids・その月の 13 か月前から）が頼む月の組み合わせで変わり、L/D の合計も変わった（11 月だけ／10・11 月で違う）。
  // いまは頼みによらず、いちばん前の月の 13 か月前の 1 日から、今月（頼まれた月があとならその月）の終わりまでを読む
  const ymsAsked = asks.map(a => a.m).sort();
  const todayYm = String(today).slice(0, 7);
  const lastYm = ymsAsked[ymsAsked.length - 1] > todayYm ? ymsAsked[ymsAsked.length - 1] : todayYm;
  const from = ymAdd(ymsAsked[0], -LT_SYS_BACK) + '-01', to = ymRange(lastYm)[1];
  const byStore = new Map(stores.map(s => [s.id, s]));
  const jobs = new Map();
  for (const a of asks) {
    const st = byStore.get(a.s); const guid = st && st.toastGuid;
    if (!guid) continue;
    if (!jobs.has(guid)) jobs.set(guid, { guid, from, to, sids: new Set() });
    jobs.get(guid).sids.add(a.s);
  }
  const list = [...jobs.values()];
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async j => {
      j.rows = await ltReadAll(rest, 'tip_labor?select=business_date,data&restaurant_guid=eq.' + enc(j.guid) + '&business_date=gte.' + from + '&business_date=lte.' + to + '&order=business_date.asc');
    }));
  }
  return { stores, employees, kv, today, jobs: list };
}
