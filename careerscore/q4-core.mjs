// Career Score 2026 Q4（新制度・CAREER_2026_Q4_V1）の計算の芯。
// 画面・サーバー（関数）・試験が同じ計算を使う。依存なし。数は BigInt の分数で正確に持ち、表示だけ小数 1 桁に丸める。
// 決まりの出どころ：Moto さんの Excel（careerscore/cs-q4-v1.json に写した）の「GM実装仕様」「配点・基準点案」と 2026Q4 の指示書。
//   - G カテゴリー＝点数合計 ÷ [3 ×（採点数＋未担当数）] × 配点。未担当は 0 点で分母に入る。完全非該当・会社都合の今回非該当は除外
//   - S カテゴリー＝採点済みの平均 ÷ 3 × 配点（未担当は無い）
//   - 理念は 5 分類を等しく。分類ごとの平均 ÷ 3 を、対象の分類で平均して × 配点（G は未担当 0 点を含める）
//   - S Office の技術・専門実務は Office・経理・人事の領域ごとの平均 ÷ 3 を、採点対象のある領域で等しく平均
//   - 全項目が除外のカテゴリーは対象配点から外す。G で未担当だけのカテゴリーは 0 点で配点を残す
//   - 総合点＝カテゴリー得点の合計 ÷ 対象配点の合計 × 100。基準点の判定は丸める前の値で。未評価が残る・対象配点 0 なら判定しない
//   - 配点 0 のカテゴリーも計算して持つ（得点 0・対象配点 0）。未評価なら確定を止める

export const CSQ4_VERSION = 'CAREER_2026_Q4_V1';
export const STATUS = Object.freeze({ SCORED: 'SCORED', UNASSIGNED: 'UNASSIGNED', NOT_APPLICABLE: 'NOT_APPLICABLE', UNASSESSED: 'UNASSESSED' });
export const NA_REASON = Object.freeze({ ROLE: 'ROLE_NOT_APPLICABLE', COMPANY: 'COMPANY_UNASSIGNED_THIS_PERIOD' });

// ---------- 分数 ----------
const ZERO = BigInt(0), ONE = BigInt(1), TEN = BigInt(10), TWO = BigInt(2);
function gcd(a, b) { if (a < ZERO) a = -a; if (b < ZERO) b = -b; while (b) { const t = a % b; a = b; b = t; } return a; }
export function frac(n, d) {
  n = BigInt(n); d = d === undefined ? ONE : BigInt(d);
  if (d === ZERO) throw new Error('frac: zero denominator');
  if (d < ZERO) { n = -n; d = -d; }
  const g = gcd(n, d) || ONE;
  return { n: n / g, d: d / g };
}
const F0 = frac(0), F1 = frac(1);
export const fadd = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const fmul = (a, b) => frac(a.n * b.n, a.d * b.d);
export const fdiv = (a, b) => { if (b.n === ZERO) throw new Error('frac: divide by zero'); return frac(a.n * b.d, a.d * b.n); };
export const fcmp = (a, b) => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
// 10 進の文字列か数から分数（0.8 → 4/5）。指数表記・非有限は断る
export function fdec(x) {
  if (typeof x === 'bigint') return frac(x);
  const s = typeof x === 'number' ? (Number.isFinite(x) ? String(x) : '') : String(x == null ? '' : x).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error('fdec: not a plain decimal: ' + s);
  const fr = m[3] || '';
  return frac((m[1] ? '-' : '') + m[2] + fr, TEN ** BigInt(fr.length));
}
export const fnum = (a) => Number(a.n) / Number(a.d);
export const fstr = (a) => a.n.toString() + '/' + a.d.toString();
// 表示用：小数 1 桁・四捨五入（0 以上だけ）。84.96 → "85.0"
export function fixed1(a) {
  if (a.n < ZERO) throw new Error('fixed1: negative');
  const k = (a.n * TEN * TWO + a.d) / (TWO * a.d);
  return (k / TEN).toString() + '.' + (k % TEN).toString();
}
const fsum = (arr) => arr.reduce((s, x) => fadd(s, x), F0);
const fmean = (arr) => fdiv(fsum(arr), frac(arr.length));
function val(a) { return a ? { exact: fstr(a), value: fnum(a), display: fixed1(a) } : null; }

// ---------- 期間（Pacific/Honolulu）----------
// 実入力の日時（ISO の文字列・Date・ミリ秒）からハワイの日付（YYYY-MM-DD）を出す。日時そのものは書き換えない
const HNL_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu', year: 'numeric', month: '2-digit', day: '2-digit' });
export function csq4HnlDate(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const x of HNL_FMT.formatToParts(d)) p[x.type] = x.value;
  return p.year + '-' + p.month + '-' + p.day;
}
// その日時が新制度の期間（start 以上・endExclusive 未満のハワイの日付）に入るか
export function csq4InPeriod(master, t) {
  const day = csq4HnlDate(t);
  return !!day && day >= master.period.start && day < master.period.endExclusive;
}

// ---------- マスター ----------
export function csq4System(master, sys) {
  const s = master && master.systems && master.systems[sys];
  if (!s) throw new Error('unknown system: ' + sys);
  return s;
}
function itemMap(s) { const m = new Map(); for (const it of s.items) m.set(it.id, it); return m; }

// ---------- 1 項目の確かめ（サーバーも同じ決まり）----------
// entry = { status, score, naReasonType, naReason, unassignedReason, periodOnly, periodFrom, periodTo }
// 戻り値：エラーのコードの配列（空なら OK）
export function csq4CheckEntry(master, sys, id, e) {
  const s = csq4System(master, sys);
  const errs = [];
  if (!itemMap(s).has(id)) return ['unknown_item'];
  if (!e || typeof e !== 'object') return ['bad_entry'];
  const st = e.status;
  const isG = !!s.unassigned;
  const allowed = isG ? [STATUS.SCORED, STATUS.UNASSIGNED, STATUS.NOT_APPLICABLE, STATUS.UNASSESSED] : [STATUS.SCORED, STATUS.NOT_APPLICABLE, STATUS.UNASSESSED];
  if (!allowed.includes(st)) return [st === STATUS.UNASSIGNED ? 'unassigned_only_g' : 'bad_status'];
  const txt = (v) => typeof v === 'string' && v.trim().length > 0;
  if (st === STATUS.SCORED) {
    if (!Number.isInteger(e.score) || e.score < 0 || e.score > 3) errs.push('bad_score');
  } else if (st === STATUS.UNASSIGNED) {
    if (e.score !== 0 && e.score !== null && e.score !== undefined) errs.push('unassigned_score_is_0');
    if (!txt(e.unassignedReason)) errs.push('unassigned_reason_required');
  } else if (st === STATUS.NOT_APPLICABLE) {
    if (e.score !== null && e.score !== undefined) errs.push('na_score_is_null');
    if (!txt(e.naReason)) errs.push('na_reason_required');
    const rt = e.naReasonType;
    if (isG) {
      if (rt !== NA_REASON.ROLE && rt !== NA_REASON.COMPANY) errs.push('na_reason_type_required');
    } else if (rt !== undefined && rt !== null && rt !== NA_REASON.ROLE) {
      errs.push('na_reason_type_g_only');   // 会社都合の今回非該当は G の未担当から変える特例（S・Prep には広げない）
    }
    if (rt === NA_REASON.COMPANY) {
      if (e.periodOnly !== true) errs.push('company_na_period_only');
      const p = master.period;
      const d = /^\d{4}-\d{2}-\d{2}$/;
      if (!d.test(e.periodFrom || '') || !d.test(e.periodTo || '')) errs.push('company_na_period_required');
      else if (e.periodFrom > e.periodTo || e.periodFrom < p.start || e.periodTo >= p.endExclusive) errs.push('company_na_period_out_of_quarter');
    } else if (e.periodOnly === true) {
      errs.push('period_only_company_only');
    }
  } else if (st === STATUS.UNASSESSED) {
    if (e.score !== null && e.score !== undefined) errs.push('unassessed_score_is_null');
  }
  return errs;
}

// 項目の状態を数えやすい形に
function kind(e) {
  if (!e || e.status === STATUS.UNASSESSED || !e.status) return 'U';           // 未評価（入っていない項目も）
  if (e.status === STATUS.SCORED) return 'S';
  if (e.status === STATUS.UNASSIGNED) return 'A';                              // 未担当（G だけ・0 点で分母に入る）
  if (e.status === STATUS.NOT_APPLICABLE) return e.naReasonType === NA_REASON.COMPANY ? 'C' : 'R';
  return 'U';
}

// 項目の集まりの平均（0〜3 のどこか）。counted＝分母に入る数
function groupAvg(items, entries) {
  let sum = 0, counted = 0, unassessed = 0, scored = 0, unassigned = 0, naRole = 0, naCompany = 0;
  for (const it of items) {
    const e = entries[it.id];
    const k = kind(e);
    if (k === 'S') { sum += e.score; counted++; scored++; }
    else if (k === 'A') { counted++; unassigned++; }
    else if (k === 'R') naRole++;
    else if (k === 'C') naCompany++;
    else unassessed++;
  }
  return { avg: counted ? frac(sum, counted) : null, sum, counted, unassessed, scored, unassigned, naRole, naCompany, total: items.length };
}

// カテゴリーの「率」（0〜1）。理念は分類ごと、S Office の技術は領域ごと
function categoryRate(cat, items, entries, sysDef) {
  if (cat === 'PHILO') {
    const parts = [];
    for (const c of csq4PhiloClasses(sysDef)) {
      const g = groupAvg(items.filter((i) => i.cls === c.key), entries);
      parts.push({ key: c.key, name: c.name, ...g, rate: g.avg ? fdiv(g.avg, frac(3)) : null, state: g.counted ? 'counted' : (g.unassessed ? 'pending' : 'excluded') });
    }
    const counted = parts.filter((p) => p.rate);
    return { rate: counted.length ? fmean(counted.map((p) => p.rate)) : null, parts, partKind: 'class' };
  }
  if (cat === 'TECH' && sysDef.domains) {
    const parts = [];
    for (const d of sysDef.domains) {
      const g = groupAvg(items.filter((i) => i.domain === d.key), entries);
      parts.push({ key: d.key, name: d.name, ...g, rate: g.avg ? fdiv(g.avg, frac(3)) : null, state: g.counted ? 'counted' : (g.unassessed ? 'pending' : 'excluded') });
    }
    const counted = parts.filter((p) => p.rate);
    return { rate: counted.length ? fmean(counted.map((p) => p.rate)) : null, parts, partKind: 'domain' };
  }
  const g = groupAvg(items, entries);
  return { rate: g.avg ? fdiv(g.avg, frac(3)) : null, parts: null };
}
function csq4PhiloClasses(sysDef) { return sysDef._philoClasses; }

function gradeNum(sys, grade) {
  const m = /^([GS])([1-6])$/.exec(String(grade || ''));
  if (!m) return null;
  if ((sys === 'G') !== (m[1] === 'G')) return null;
  return m[2];
}

// ---------- G・S Chef・S Office の計算 ----------
// input = { system, grade: 'G3'|'S2'..., type: 'Kitchen中心' など（G だけ）, entries: { [id]: entry } }
export function csq4Score(master, input) {
  const sys = input.system;
  if (sys === 'PREP') throw new Error('use csq4Prep for PREP');
  const sysDef = Object.assign({}, csq4System(master, sys), { _philoClasses: master.philoClasses });
  const gn = gradeNum(sys, input.grade);
  if (!gn) return { ok: false, error: 'bad_grade' };
  const wrow = sys === 'G' ? (sysDef.weights['G' + gn] || {})[input.type] : sysDef.weights['S' + gn];
  if (!wrow) return { ok: false, error: sys === 'G' ? 'bad_type' : 'bad_grade' };
  const entries = input.entries || {};
  const ids = itemMap(sysDef);
  const unknown = Object.keys(entries).filter((id) => !ids.has(id));
  const entryErrors = {};
  for (const id of Object.keys(entries)) {
    if (!ids.has(id)) continue;
    const e = entries[id];
    if (!e || e.status === undefined || e.status === STATUS.UNASSESSED) continue;
    const er = csq4CheckEntry(master, sys, id, e);
    if (er.length) entryErrors[id] = er;
  }
  // 入力に誤りのある項目は、計算では未評価として扱う（確定は止まる）
  const eff = {};
  for (const id of ids.keys()) eff[id] = entryErrors[id] ? undefined : entries[id];

  const cats = [];
  let sumScore = F0, sumTarget = F0;
  const counts = { items: sysDef.items.length, scored: 0, unassigned: 0, naRole: 0, naCompany: 0, unassessed: 0 };
  for (const c of sysDef.categories) {
    const items = sysDef.items.filter((i) => i.cat === c.key);
    const g = groupAvg(items, eff);
    for (const k of ['scored', 'unassigned', 'naRole', 'naCompany', 'unassessed']) counts[k] += g[k];
    const weight = frac(wrow.weights[c.key]);
    const r = categoryRate(c.key, items, eff, sysDef);
    // 対象：分母に入る項目が 1 つでもある（G の未担当だけでも対象・0 点）
    let state, target = F0, score = null;
    if (r.rate) {
      state = g.unassessed ? 'partial' : 'counted';
      target = weight;
      score = fmul(r.rate, weight);
    } else if (g.unassessed) {
      state = 'pending';           // まだ採点がない（仮の計算では外す）
    } else {
      state = 'excluded';          // 全項目が完全非該当・会社都合の今回非該当
    }
    if (score) { sumScore = fadd(sumScore, score); sumTarget = fadd(sumTarget, target); }
    cats.push({
      key: c.key, name: c.name, weight: Number(wrow.weights[c.key]), targetWeight: fnum(target), state,
      score: val(score), rate: val(r.rate ? fmul(r.rate, frac(100)) : null),
      avg: g.avg ? val(g.avg) : null,
      counts: { items: g.total, scored: g.scored, unassigned: g.unassigned, naRole: g.naRole, naCompany: g.naCompany, unassessed: g.unassessed },
      parts: r.parts ? r.parts.map((p) => ({ key: p.key, name: p.name, state: p.state, avg: p.avg ? val(p.avg) : null, counts: { items: p.total, scored: p.scored, unassigned: p.unassigned, naRole: p.naRole, naCompany: p.naCompany, unassessed: p.unassessed } })) : null,
    });
  }
  const anyInvalid = Object.keys(entryErrors).length > 0 || unknown.length > 0;
  const total = sumTarget.n > ZERO ? fmul(fdiv(sumScore, sumTarget), frac(100)) : null;
  let state;
  if (counts.unassessed > 0 || anyInvalid) state = counts.scored + counts.unassigned ? 'in_progress' : 'not_started';
  else state = total ? 'complete' : 'not_calculable';
  const base = Number(master.base[sys === 'G' ? 'G' : 'S'][gn]);
  const baseMet = state === 'complete' ? fcmp(total, frac(base)) >= 0 : null;
  const minimum = csq4Minimum(master, sys, gn, input.type, eff, sysDef);
  const lists = csq4Lists(sysDef, eff);   // 入力に誤りのある項目は一覧にも載せない（計算と同じく未評価）
  return {
    ok: true, version: master.version, system: sys, grade: input.grade, type: sys === 'G' ? input.type : null,
    state, confirmable: state === 'complete' && !anyInvalid,
    total: val(total), totalProvisional: state !== 'complete',
    targetWeight: fnum(sumTarget), baseWeight: 100, scoreSum: val(sumScore),
    base, baseMet,
    counts, categories: cats, minimum,
    unassignedList: lists.unassigned, roleNaList: lists.roleNa,
    entryErrors, unknownItems: unknown,
  };
}

// 本人向けの一覧：未担当と会社都合の今回非該当（G）／完全非該当は別枠
// master と sys を渡すと、入力に誤りのある項目は載せない（csq4Score と同じく未評価として扱う）
export function csq4Lists(sysDef, entries, master, sys) {
  const unassigned = [], roleNa = [];
  for (const it of sysDef.items) {
    let e = entries[it.id];
    if (e && master && sys && csq4CheckEntry(master, sys, it.id, e).length) e = undefined;
    const k = kind(e);
    const row = { id: it.id, cat: it.cat, name: it.name };
    if (k === 'A') unassigned.push({ ...row, status: STATUS.UNASSIGNED, reason: e.unassignedReason || '', feedback: e.feedbackComment || '' });
    else if (k === 'C') unassigned.push({ ...row, status: STATUS.NOT_APPLICABLE, naReasonType: NA_REASON.COMPANY, reason: e.naReason || '', periodFrom: e.periodFrom || null, periodTo: e.periodTo || null, feedback: e.feedbackComment || '' });
    else if (k === 'R') roleNa.push({ ...row, reason: e.naReason || '' });
  }
  return { unassigned, roleNa };
}

// ---------- 最低条件（配点・基準点案 40〜47 行・GM実装仕様 55 行）----------
// 状態：met｜not_met｜no_opportunity（対象がすべて除外＝実務機会なし・未確認）｜incomplete（未評価があり決まらない）｜pending_rule（資料で決まっていない）
function avgCondition(key, label, min, items, entries) {
  const g = groupAvg(items, entries);
  let state;
  if (g.unassessed) state = 'incomplete';
  else if (!g.counted) state = 'no_opportunity';
  else state = fcmp(g.avg, min) >= 0 ? 'met' : 'not_met';
  return { key, label, min: fnum(min), avg: g.avg ? val(g.avg) : null, state, counts: { items: g.total, counted: g.counted, unassessed: g.unassessed, excluded: g.naRole + g.naCompany } };
}
export function csq4Minimum(master, sys, gn, type, entries, sysDef) {
  const row = master.minimum[gn];
  const out = [];
  const items = sysDef.items;
  // 理念 5 分類の各平均
  const classes = master.philoClasses.map((c) => avgCondition('philo:' + c.key, '理念：' + c.name, fdec(row.philoClass), items.filter((i) => i.cat === 'PHILO' && i.cls === c.key), entries));
  const cs = classes.map((c) => c.state);
  out.push({
    key: 'philoClass', label: '理念 5 分類の各平均', min: Number(row.philoClass), parts: classes,
    state: cs.includes('not_met') ? 'not_met' : cs.includes('incomplete') ? 'incomplete' : cs.every((s) => s === 'no_opportunity') ? 'no_opportunity' : 'met',
  });
  if (sys === 'G') {
    out.push(avgCondition('basic', '基本業務', fdec(row.basic), items.filter((i) => i.cat === 'BASIC'), entries));
    const map = (master.systems.G.mainMap || {})[type];
    for (const [k, col, label] of [['gMain', 'main', 'G主担当'], ['gOther', 'other', 'G他部門']]) {
      if (!map) { out.push({ key: k, label, min: Number(row[k]), state: 'pending_rule', note: master.systems.G.mainMapNote }); continue; }
      const its = items.filter((i) => map[col].includes(i.cat));
      out.push(Object.assign(avgCondition(k, label, fdec(row[k]), its, entries), { cats: map[col] }));
    }
  }
  if (sys === 'S_CHEF') out.push(avgCondition('chefHygiene', 'Chef 衛生', fdec(row.chefHygiene), items.filter((i) => i.cat === 'HYGIENE'), entries));
  if (sys === 'S_CHEF' || sys === 'S_OFFICE') out.push(avgCondition('sQuality', 'S 品質管理', fdec(row.sQuality), items.filter((i) => i.cat === 'QUALITY'), entries));
  // 指定項目（G2 以上・S2 以上）：01-13・01-14・01-09・01-16 は対象の各項目が 2 点以上
  const mi = master.minimumItems;
  if (Number(gn) >= mi.fromGrade && mi.systems.includes(sys)) {
    const parts = [];
    for (const id of mi.ids) {
      const it = items.find((i) => i.id === id);
      if (!it) { parts.push({ id, state: 'no_item' }); continue; }
      const e = entries[id];
      const k = kind(e);
      let state;
      if (k === 'S') state = e.score >= mi.min ? 'met' : 'not_met';
      else if (k === 'A') state = 'not_met';            // G の未担当は 0 点
      else if (k === 'R' || k === 'C') state = 'excluded';
      else state = 'incomplete';
      parts.push({ id, state, score: k === 'S' ? e.score : k === 'A' ? 0 : null });
    }
    const ps = parts.filter((p) => p.state !== 'no_item').map((p) => p.state);
    out.push({
      key: 'items', label: '指定項目（各 2 点以上）', min: mi.min, parts,
      state: ps.includes('not_met') ? 'not_met' : ps.includes('incomplete') ? 'incomplete' : ps.every((s) => s === 'excluded') ? 'no_opportunity' : 'met',
    });
  }
  const st = out.map((c) => c.state);
  // 実務機会なし（対象がすべて非該当）の条件があれば、全体も「達成」にしない（実務機会なし・未確認）
  const overall = st.includes('not_met') ? 'not_met' : st.includes('incomplete') ? 'incomplete' : st.includes('pending_rule') ? 'pending_rule' : st.includes('no_opportunity') ? 'no_opportunity' : 'met';
  return { overall, conditions: out, noOpportunity: out.filter((c) => c.state === 'no_opportunity').map((c) => c.key) };
}

// ---------- Prep ----------
// input = { entries: { PH1: entry, ... }, quality: { Q1: 'clear'|'not_clear'|'unconfirmed', ... },
//           measure: { trials: [{ date: 'YYYY-MM-DD', goodStd, actual }], independentStd, allStd }, currentStep: 'P1'..'P6'|null }
// 時間は秒などの同じ単位（10 進の文字列か数）。行動確認スコアは時給に掛けない
export function csq4Prep(master, input) {
  const P = csq4System(master, 'PREP');
  const entries = input.entries || {};
  const ids = itemMap(P);
  const entryErrors = {};
  for (const id of Object.keys(entries)) {
    if (!ids.has(id)) { entryErrors[id] = ['unknown_item']; continue; }
    const e = entries[id];
    if (!e || e.status === undefined || e.status === STATUS.UNASSESSED) continue;
    const er = csq4CheckEntry(master, 'PREP', id, e);
    if (er.length) entryErrors[id] = er;
  }
  let sum = 0, scored = 0, na = 0, unassessed = 0;
  for (const it of P.items) {
    const e = entryErrors[it.id] ? undefined : entries[it.id];
    const k = kind(e);
    if (k === 'S') { sum += e.score; scored++; }
    else if (k === 'R' || k === 'C') na++;
    else unassessed++;
  }
  const score = scored ? fmul(frac(sum, 3 * scored), frac(100)) : null;
  const anyInvalid = Object.keys(entryErrors).length > 0;
  const state = unassessed || anyInvalid ? (scored ? 'in_progress' : 'not_started') : (scored ? 'complete' : 'not_calculable');

  // 品質確認 Q1〜Q3（未実施・未確認をクリアにしない）
  const q = input.quality || {};
  const quality = P.quality.map((x) => ({ id: x.id, name: x.name, state: q[x.id] === 'clear' || q[x.id] === 'not_clear' ? q[x.id] : 'unconfirmed' }));
  const qualityClear = quality.every((x) => x.state === 'clear');
  const qualityState = quality.some((x) => x.state === 'not_clear') ? 'not_clear' : qualityClear ? 'clear' : 'unconfirmed';

  const meas = csq4PrepMeasure(input.measure);
  let pay;
  if (qualityState !== 'clear') pay = { state: 'quality_' + qualityState, step: null };
  else if (!meas.ok) pay = { state: 'unmeasured', step: null, reason: meas.reason };
  else {
    let step = null;
    for (const p of P.pay) {
      const smin = fdec(p.speedMin), rmin = fdec(p.rangeMin);
      const sOk = p.speedInclusive ? fcmp(meas.speed, smin) >= 0 : fcmp(meas.speed, smin) > 0;
      const rOk = fcmp(meas.range, rmin) >= 0;
      if (sOk && rOk) step = p;
    }
    pay = { state: 'judged', step: step ? step.step : null, wageUsd: step ? step.wageUsd : null };
    const order = P.pay.map((p) => p.step);
    // 今の段が文字で入っているときだけ比べる（空・null・知らない段は比べない）
    const cur = typeof input.currentStep === 'string' && input.currentStep ? order.indexOf(input.currentStep) : -1;
    if (step && cur >= 0) {
      const ni = order.indexOf(step.step);
      pay.compare = ni > cur ? 'raise' : ni === cur ? 'same' : 'keep_current';   // 自動で下げない（確認して判断）
    }
  }
  return {
    ok: true, version: master.version, system: 'PREP',
    state, confirmable: state === 'complete' && !anyInvalid,
    score: val(score), counts: { items: P.items.length, scored, na, unassessed },
    quality, qualityState,
    measure: meas.ok ? { speed: val(meas.speed), range: val(meas.range), trials: meas.trials } : { reason: meas.reason },
    pay, entryErrors,
  };
}
// スピード＝良品完成分の標準作業時間 ÷ 手直しを含む実作業時間（別日 3 回の最低値）／習得範囲＝自立して完結できる作業の標準時間 ÷ 全作業の標準時間
export function csq4PrepMeasure(m) {
  if (!m || !Array.isArray(m.trials)) return { ok: false, reason: 'no_measure' };
  const days = new Set();
  let speed = null;
  for (const t of m.trials) {
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) return { ok: false, reason: 'bad_trial_date' };
    let g, a;
    try { g = fdec(t.goodStd); a = fdec(t.actual); } catch (e) { return { ok: false, reason: 'bad_trial_value' }; }
    if (a.n <= ZERO) return { ok: false, reason: 'zero_actual' };
    if (g.n < ZERO) return { ok: false, reason: 'bad_trial_value' };
    days.add(t.date);
    const s = fdiv(g, a);
    if (!speed || fcmp(s, speed) < 0) speed = s;
  }
  if (m.trials.length < 3 || days.size < 3) return { ok: false, reason: 'need_3_days' };
  let ind, all;
  try { ind = fdec(m.independentStd); all = fdec(m.allStd); } catch (e) { return { ok: false, reason: 'no_range' }; }
  if (all.n <= ZERO) return { ok: false, reason: 'zero_all_std' };
  if (ind.n < ZERO || fcmp(ind, all) > 0) return { ok: false, reason: 'bad_range' };
  return { ok: true, speed, range: fdiv(ind, all), trials: m.trials.length };
}
