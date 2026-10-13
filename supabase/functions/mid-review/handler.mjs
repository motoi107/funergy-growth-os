// mid-review: the 中間レビュー API, v2 (段階 4・UI案44 B案). Spec: docs/MID_REVIEW_V2_JA.md.
// Two ways in, decided here and nowhere else: a Supabase Auth sign-in (via 'email') or the PIN sign-in's mark checked by
// deps.verifyPin (via 'pin'). The database (mr_members, mr_can) decides the role, the stores and every permission.
// The browser's own idea of its role, its sign-in or its actor is never used. Store publication and notices stay off.

const ROLES = ['ceo', 'gm', 'am', 'chef', 'staff'];

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^mr_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      // (long enough for the list of missing items after 'incomplete')
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 4000)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

// Error text that may reach logs: no tokens or keys.
const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer)[^\s]*/gi, '$1:***').slice(0, 200);

// ---------------------------------------------------------------- shapes (the screen sends the same; the SQL checks again)
const bad = () => { const e = new Error('bad_value'); e.code = 'bad_value'; return e; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const TX = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n) : '');
// Text is never cut quietly: too long is refused (the screen stops at the same lengths).
const TS = (v, n) => { const x = TX(v, 100000); if (x.length > n) throw bad(); return x; };
// A real calendar date (11-31 and 02-30 are not), or '' when empty. Anything else is refused.
const isDate = v => {
  if (typeof v !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
const DTS = v => { if (v == null || v === '') return ''; if (!isDate(v)) throw bad(); return v; };
const ID = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
const FKEY = /^[a-z][a-z0-9_]{0,23}$/;
const RID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM = v => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10 ? v : null);
const EVAL = v => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

export const KPI_PREV = ['sales', 'guests', 'ppa', 'repeat', 'labor', 'fc'];
export const KPI_CUR = ['sales', 'guests', 'ppa', 'repeat', 'labor'];
export const FOCUS_STATUS = ['ok', 'late', 'done', 'help'];
export const FOCUS_FIELDS = ['status', 'done', 'remaining', 'next', 'owner'];
export const SEVERITY = ['low', 'watch', 'high'];
export const JUDGE = ['ok', 'warn', 'miss', 'unset', 'missing'];
export const LIMITS = { comment: 400, improve: 400, measure: 400, cause: 400, inv_check: 400, owner: 60, done: 400, remaining: 400, next: 400,
  what: 200, ask: 400, proposal: 400, text: 1000, issues: 10, focus: 12 };
export const KINDS = ['reply', 'note', 'done'];
export const DECISIONS = ['as_proposed', 'modify', 'followup', 'escalate', 'consult', 'no_action'];

// 本文 v2 (spec §3). Every KPI key is always there; cur.fc is never kept; issues only with consult 'yes'.
export function normBody(b) {
  b = obj(b);
  const L = LIMITS;
  const out = { v: 2, prev: {}, cur: {}, focus: {}, consult: b.consult === 'yes' || b.consult === 'none' ? b.consult : '', issues: [] };
  for (const k of KPI_PREV) { const x = obj(obj(b.prev)[k]); out.prev[k] = { eval: EVAL(x.eval), comment: TS(x.comment, L.comment), improve: TS(x.improve, L.improve) }; }
  for (const k of KPI_CUR) {
    const x = obj(obj(b.cur)[k]);
    out.cur[k] = { eval: EVAL(x.eval), comment: TS(x.comment, L.comment), measure: TS(x.measure, L.measure), cause: TS(x.cause, L.cause),
      investigating: x.investigating === true, inv_check: TS(x.inv_check, L.inv_check), owner: TS(x.owner, L.owner), due: DTS(x.due) };
  }
  const fe = Object.entries(obj(b.focus));
  if (fe.length > L.focus) throw bad();
  for (const [k, v] of fe) {
    if (!FKEY.test(k)) throw bad();
    const x = obj(v);
    out.focus[k] = { status: FOCUS_STATUS.includes(x.status) ? x.status : '', done: TS(x.done, L.done), remaining: TS(x.remaining, L.remaining),
      next: TS(x.next, L.next), owner: TS(x.owner, L.owner) };
  }
  if (out.consult === 'yes') {
    const list = Array.isArray(b.issues) ? b.issues : [];
    if (list.length > L.issues) throw bad();
    const seen = new Set();
    for (const x0 of list) {
      const x = obj(x0), id = ID(x.id);
      if (!id || seen.has(id)) throw bad();
      seen.add(id);
      out.issues.push({ id, what: TS(x.what, L.what), ask: TS(x.ask, L.ask), proposal: TS(x.proposal, L.proposal), ask_by: DTS(x.ask_by),
        severity: SEVERITY.includes(x.severity) ? x.severity : '' });
    }
  }
  return out;
}

// The numbers seen when submitting (snapshot v2, spec §3).
export function normSnap(sn) {
  sn = obj(sn);
  const row = v => { v = obj(v); return { act: NUM(v.act), tgt: NUM(v.tgt), unit: TX(v.unit, 8), judge: JUDGE.includes(v.judge) ? v.judge : 'missing' }; };
  const p0 = obj(sn.prev), c0 = obj(sn.cur), f0 = obj(sn.focus);
  const prevRows = {}, curRows = {};
  for (const k of KPI_PREV) prevRows[k] = row(obj(p0.rows)[k]);
  for (const k of KPI_CUR) curRows[k] = row(obj(c0.rows)[k]);
  const fr = c0.fc_ref && typeof c0.fc_ref === 'object' ? { act: NUM(c0.fc_ref.act), tgt: NUM(c0.fc_ref.tgt), unit: TX(c0.fc_ref.unit, 8), judge: JUDGE.includes(c0.fc_ref.judge) ? c0.fc_ref.judge : 'missing' } : null;
  const keys = [];
  for (const k of Array.isArray(f0.keys) ? f0.keys : []) { if (typeof k !== 'string' || !FKEY.test(k)) throw bad(); if (!keys.includes(k)) keys.push(k); }
  if (keys.length > LIMITS.focus) throw bad();
  const frows = {};
  for (const k of keys) {
    const x = obj(obj(f0.rows)[k]);
    frows[k] = { label: TX(x.label, 60), mode: x.mode === 'auto' ? 'auto' : 'manual', now: NUM(x.now), prev: NUM(x.prev), unit: TX(x.unit, 8), lower: x.lower === true };
  }
  const th = {};
  for (const k of KPI_PREV) { const x = obj(obj(sn.thresholds)[k]); if (NUM(x.green) != null || NUM(x.yellow) != null) th[k] = { green: NUM(x.green), yellow: NUM(x.yellow) }; }
  const y = Number.isInteger(f0.y) && f0.y >= 2000 && f0.y <= 2099 ? f0.y : null, q = Number.isInteger(f0.q) && f0.q >= 1 && f0.q <= 4 ? f0.q : null;
  return { v: 2, period: { from: isDate(obj(sn.period).from) ? sn.period.from : '', to: isDate(obj(sn.period).to) ? sn.period.to : '' }, updated: TX(sn.updated, 40),
    prev: { ym: /^20\d{2}-(0[1-9]|1[0-2])$/.test(p0.ym || '') ? p0.ym : '', state: ['final', 'prov', 'none'].includes(p0.state) ? p0.state : 'none',
      at: isDate(p0.at) ? p0.at : '', rows: prevRows },
    cur: { rows: curRows, fc_ref: fr }, focus: { y, q, keys, rows: frows }, thresholds: th };
}

// What is still missing before a submission (spec §4). The SQL function mr_missing_v2 is the same rule; the screen uses this.
const blank = v => v == null || !String(v).trim();
export function missingV2(b, sn) {
  b = obj(b); sn = obj(sn);
  const out = []; let holds = 0;
  const prev = obj(sn.prev), final = prev.state === 'final';
  for (const k of KPI_PREV) {
    const j = obj(obj(prev.rows)[k]).judge, x = obj(obj(b.prev)[k]);
    if (final && ['ok', 'warn', 'miss'].includes(j)) {
      if (EVAL(x.eval) == null) out.push(`prev:${k}:eval`);
      if (blank(x.comment)) out.push(`prev:${k}:comment`);
    } else holds++;
  }
  for (const k of KPI_CUR) {
    if (obj(obj(obj(sn.cur).rows)[k]).judge !== 'miss') continue;
    const x = obj(obj(b.cur)[k]);
    if (EVAL(x.eval) == null) out.push(`cur:${k}:eval`);
    if (blank(x.measure)) out.push(`cur:${k}:measure`);
  }
  for (const k of Array.isArray(obj(sn.focus).keys) ? sn.focus.keys : []) {
    if (typeof k !== 'string') continue;
    const x = obj(obj(b.focus)[k]);
    if (!FOCUS_STATUS.includes(x.status)) out.push(`focus:${k}:status`);
    for (const f of ['done', 'remaining', 'next', 'owner']) if (blank(x[f])) out.push(`focus:${k}:${f}`);
  }
  const issues = Array.isArray(b.issues) ? b.issues : [];
  if (!['yes', 'none'].includes(b.consult) || (b.consult === 'yes' && !issues.length)) out.push('consult');
  else if (b.consult === 'yes') for (const x0 of issues) {
    const x = obj(x0), id = x.id == null ? '?' : String(typeof x.id === 'object' ? JSON.stringify(x.id) : x.id);
    if (blank(x.what)) out.push(`issue:${id}:what`);
    if (blank(x.ask)) out.push(`issue:${id}:ask`);
  }
  return { missing: out, holds };
}

// ---------------------------------------------------------------- demo (a fictional company; nothing here is a real person or store)
const dd = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
function prevYm(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
// The meeting tab's default thresholds (the screen uses the company's saved ones; the demo is made with the defaults).
export const DEMO_THRESHOLDS = { sales: { green: 100, yellow: 95 }, guests: { green: 100, yellow: 95 }, ppa: { green: 100, yellow: 95 },
  repeat: { green: 100, yellow: 90 }, labor: { green: 100, yellow: 108 }, fc: { green: 100, yellow: 108 } };
const LOWER = { fc: true, labor: true };
export function demoJudge(key, act, tgt) {
  if (!(typeof tgt === 'number' && tgt > 0)) return 'unset';
  if (!(typeof act === 'number' && act > 0)) return 'missing';
  const r = act / tgt * 100, y = DEMO_THRESHOLDS[key] ? DEMO_THRESHOLDS[key].yellow : 95;
  return LOWER[key] ? (r <= 100 ? 'ok' : r <= y ? 'warn' : 'miss') : (r >= 100 ? 'ok' : r >= y ? 'warn' : 'miss');
}
// A demo store's numbers as the screen would snapshot them (the server checks act / tgt, last month's state and the keys).
export function demoSnapshot(ym, demo) {
  const D = d => dd(ym, d);
  const judged = rows => Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { ...v, judge: demoJudge(k, v.act, v.tgt) }]));
  return { v: 2, period: { from: D(1), to: D(17) }, updated: demo.updated,
    prev: { ym: demo.prev.ym, state: demo.prev.state, at: demo.prev.at || '', rows: judged(demo.prev.rows) },
    cur: { rows: judged(demo.cur.rows), fc_ref: demo.cur.fc_ref ? { ...demo.cur.fc_ref, judge: demoJudge('fc', demo.cur.fc_ref.act, demo.cur.fc_ref.tgt) } : null },
    focus: { y: demo.focus.y, q: demo.focus.q, keys: demo.focus.keys, rows: demo.focus.rows }, thresholds: DEMO_THRESHOLDS };
}
const FOCUS_DEF = { newcust: ['新規客獲得', 'auto', '', false], repeat: ['リピート強化', 'auto', '%', false], ppa: ['客単価UP', 'auto', '$', false],
  dinner: ['ディナー強化', 'auto', '$', false], lunch: ['ランチ強化', 'auto', '$', false], takeout: ['テイクアウト強化', 'auto', '$', false],
  foodcost: ['原価改善', 'auto', '%', true], labor: ['人件費最適化', 'auto', '%', true], menu: ['メニュー・商品力', 'manual', '', false],
  cs: ['接客・CS向上', 'manual', '', false], staff: ['スタッフ育成', 'manual', '', false], review: ['レビュー・口コミ', 'manual', '', false] };
export function demoData(ym) {
  const D = d => dd(ym, d), P = prevYm(ym), [yy, mm] = ym.split('-').map(Number), Q = Math.ceil(mm / 3);
  const k = (act, tgt, unit = '') => ({ act, tgt, unit });
  const focus = (keys, vals) => ({ y: yy, q: Q, keys, rows: Object.fromEntries(keys.map(key => {
    const [label, mode, unit, lower] = FOCUS_DEF[key], v = vals[key] || [];
    return [key, { label, mode, now: mode === 'auto' ? (v[0] ?? null) : null, prev: mode === 'auto' ? (v[1] ?? null) : null, unit, lower }];
  })) });
  const prevBlock = (state, rows) => ({ ym: P, state, ...(state === 'final' ? { at: D(9) } : {}), rows });
  const upd = `${D(18)}T15:40:00Z`;
  const stores = [
    { store_id: 'D1', name: '港町（デモ）', am_name: 'AM 佐藤（デモ）', sort: 1, input_emp: 'DEMO-1', demo: { updated: upd, input_name: '店長 田中（デモ）',
      prev: prevBlock('final', { sales: k(141200, 145000, '$'), guests: k(5620, 5700), ppa: k(25.12, 25.44, '$'), repeat: k(31.2, 30.0, '%'), labor: k(26.4, 26.0, '%'), fc: k(32.1, 30.5, '%') }),
      cur: { rows: { sales: k(80800, 82400, '$'), guests: k(3230, 3280), ppa: k(25.02, 25.12, '$'), repeat: k(31.0, 30.0, '%'), labor: k(25.8, 26.0, '%') }, fc_ref: k(33.2, 30.5, '%') },
      focus: focus(['repeat', 'foodcost', 'cs'], { repeat: [31.0, 29.4], foodcost: [33.2, 32.1] }) } },
    { store_id: 'D2', name: '丘の上（デモ）', am_name: 'AM 佐藤（デモ）', sort: 2, input_emp: 'DEMO-2', demo: { updated: upd, input_name: '店長 Park（デモ）',
      prev: prevBlock('final', { sales: k(132000, 128000, '$'), guests: k(5300, 5200), ppa: k(24.91, 24.62, '$'), repeat: k(30.4, 30.0, '%'), labor: k(25.2, 25.5, '%'), fc: k(29.8, 30.0, '%') }),
      cur: { rows: { sales: k(61200, 58500, '$'), guests: k(2450, 2400), ppa: k(24.98, 24.38, '$'), repeat: k(30.6, 30.0, '%'), labor: k(25.1, 25.5, '%') }, fc_ref: k(29.4, 30.0, '%') },
      focus: focus(['dinner', 'staff'], { dinner: [38200, 36100] }) } },
    { store_id: 'D3', name: '駅前（デモ）', am_name: 'AM 佐藤（デモ）', sort: 3, input_emp: 'DEMO-3', demo: { updated: upd, input_name: '店長 鈴木（デモ）',
      prev: prevBlock('prov', { sales: k(51200, 56000, '$'), guests: k(2050, 2280), ppa: k(24.98, 24.56, '$'), repeat: k(28.0, 30.0, '%'), labor: k(29.5, 27.0, '%'), fc: k(31.0, 31.0, '%') }),
      cur: { rows: { sales: k(49800, 56400, '$'), guests: k(1990, 2300), ppa: k(25.03, 24.52, '$'), repeat: k(28.5, 30.0, '%'), labor: k(30.4, 27.0, '%') }, fc_ref: k(31.2, 31.0, '%') },
      focus: focus(['lunch', 'staff', 'labor'], { lunch: [18200, 19900], labor: [30.4, 29.5] }) } },
    { store_id: 'D4', name: '海岸（デモ）', am_name: 'AM Lee（デモ）', sort: 4, input_emp: 'DEMO-4', demo: { updated: upd, input_name: '店長 Kim（デモ）',
      prev: prevBlock('final', { sales: k(152000, 150000, '$'), guests: k(5640, 5600), ppa: k(26.95, 26.79, '$'), repeat: k(30.1, 30.0, '%'), labor: k(26.0, null, '%'), fc: k(30.2, 30.5, '%') }),
      cur: { rows: { sales: k(70300, 72000, '$'), guests: k(2610, 2870), ppa: k(26.93, 25.09, '$'), repeat: k(30.2, 30.0, '%'), labor: k(26.8, null, '%') }, fc_ref: k(30.1, 30.5, '%') },
      focus: focus(['takeout', 'review'], { takeout: [9800, 8200] }) } },
    { store_id: 'D5', name: '公園通り（デモ）', am_name: 'AM Lee（デモ）', sort: 5, input_emp: 'DEMO-5', demo: { updated: upd, input_name: 'Operation Leader 原田（デモ・G3）',
      prev: prevBlock('final', { sales: k(118000, 124000, '$'), guests: k(4720, 4900), ppa: k(25.0, 25.3, '$'), repeat: k(29.0, 30.0, '%'), labor: k(27.9, 27.5, '%'), fc: k(31.2, 31.0, '%') }),
      cur: { rows: { sales: k(null, 64100, '$'), guests: k(null, 2560), ppa: k(25.2, 25.0, '$'), repeat: k(29.5, 30.0, '%'), labor: k(28.6, 27.5, '%') }, fc_ref: k(30.9, 31.0, '%') },
      focus: focus(['newcust', 'menu'], { newcust: [610, 640] }) } },
    { store_id: 'D6', name: '川沿い（デモ）', am_name: null, sort: 6, input_emp: 'DEMO-6', demo: { updated: upd, input_name: '店長 Nguyen（デモ）',
      prev: prevBlock('final', { sales: k(98000, 100000, '$'), guests: k(3980, 4000), ppa: k(24.62, 25.0, '$'), repeat: k(30.5, 30.0, '%'), labor: k(26.2, 26.5, '%'), fc: k(31.5, 30.5, '%') }),
      cur: { rows: { sales: k(66500, 65600, '$'), guests: k(2700, 2650), ppa: k(24.63, 24.75, '$'), repeat: k(26.0, 30.0, '%'), labor: k(26.2, 26.5, '%') }, fc_ref: k(31.5, 30.5, '%') },
      focus: focus(['ppa', 'cs'], { ppa: [24.63, 24.62] }) } },
  ];
  const S = Object.fromEntries(stores.map(s => [s.store_id, s.demo]));
  const pv = (ev, comment, improve = '') => ({ eval: ev, comment, improve });
  const cv = (ev, comment, measure = '', extra = {}) => ({ eval: ev, comment, measure, cause: '', investigating: false, inv_check: '', owner: '', due: '', ...extra });
  const emptyPrev = () => Object.fromEntries(KPI_PREV.map(x => [x, pv(null, '')]));
  const emptyCur = () => Object.fromEntries(KPI_CUR.map(x => [x, cv(null, '')]));
  const fo = (status, done, remaining, next, owner) => ({ status, done, remaining, next, owner });
  // D1: submitted, with replies from a Head Chef, the AM, the GM and the CEO, and the input person's note on the same item.
  const b1 = { v: 2, prev: { sales: pv(3, '雨の週末が 2 回あり、9 月後半の客数が落ちた。', '雨の日のテイクアウト告知を前日に出す。'), guests: pv(3, '売上と同じ（雨の週末）。'),
      ppa: pv(4, 'セットの比率が少し下がった。'), repeat: pv(5, 'スタンプカードの 2 回目が増えた。'), labor: pv(4, '新人研修の時間が入った。'),
      fc: pv(2, '9/25 からの米の値上げと、刺身の廃棄。', '盛り付けの計量と廃棄の記録を毎日。') },
    cur: { ...emptyCur(), sales: cv(3, '雨の 3 日（10/6〜10/8）で客数が落ちた。週末は予算どおり。'), guests: cv(3, '売上と同じ（雨の 3 日）。'),
      ppa: cv(4, ''), repeat: cv(5, ''), labor: cv(4, '') },
    focus: { repeat: fo('ok', 'スタンプカードを全員に渡している。', '2 回目の来店の案内。', 'レシートに次回の案内を入れる（10/20）', '田中'),
      foodcost: fo('late', '盛り付けの計量を始めた。', '米の業者の見直し。', '本部と業者を比べる（相談 1）', '小林'),
      cs: fo('done', 'Google レビューに 48 時間以内に返信（10/1 から全件）。', 'なし', '続ける', '森') },
    consult: 'yes', issues: [{ id: 'i1', what: '米の仕入単価が 9/25 から約 12% 上がった（業者の値上げ）', ask: '本部で米の業者を比べてほしい', proposal: '2 社の見積りを取る', ask_by: D(24), severity: 'watch' }] };
  // D2: all fine, 確認完了.
  const b2 = { v: 2, prev: { sales: pv(5, '予算を上回った。'), guests: pv(5, '予算を上回った。'), ppa: pv(5, 'セットが伸びた。'), repeat: pv(4, '目標どおり。'),
      labor: pv(5, 'シフトどおり。'), fc: pv(4, '目標どおり。') }, cur: emptyCur(),
    focus: { dinner: fo('ok', '平日ディナーのセットを出した。', '週末の告知。', 'SNS で週末の告知（毎週木曜）', 'Park'),
      staff: fo('ok', '新人 1 名のレジ研修 3 回。', 'あと 2 回。', 'ひとりでレジ締め（10/20）', 'Park') }, consult: 'none', issues: [] };
  // D3: last month not final (評価保留 6), three 未達 this month, a focus item that needs help, two questions.
  const b3 = { v: 2, prev: emptyPrev(),
    cur: { ...emptyCur(), sales: cv(2, '夜の人手が足りず、21 時以降の席を止めた日が 4 日。', '夜のシフトを埋める（応援を頼む）'), guests: cv(2, '売上と同じ。', 'ランチのチラシを駅で配る'),
      labor: cv(2, '応援と残業が増えた。', '求人を出す（相談 2）', { cause: '夜のリーダーが 9 月末で辞めた', investigating: true, inv_check: '残業の内訳（1 週間）', owner: '鈴木', due: D(24) }) },
    focus: { lunch: fo('late', '平日ランチの呼び込みを始めた。', '夜に人を回していて続かない。', 'チラシを駅で配る（10/24）', '鈴木'),
      staff: fo('help', '面接 1 件。', '夜のリーダー候補がいない。', '港町から週 2 回の応援がほしい（相談 1）', '鈴木'),
      labor: fo('late', '残業の記録を毎日。', '応援の時間が多い。', '求人（相談 2）', '鈴木') },
    consult: 'yes', issues: [{ id: 'i1', what: '夜の人手：港町から週 2 回の応援がほしい', ask: '11 月まで港町から週 2 回の応援を出してほしい', proposal: '火・金の夜に 1 名', ask_by: D(19), severity: 'high' },
      { id: 'i2', what: '求人広告の追加費用（月 $600）', ask: '追加の求人広告費 月 $600 を 2 か月出してよいか', proposal: '応募が増えなければ止める', ask_by: D(22), severity: 'high' }] };
  // D4: a KPI without a target (last month 評価保留 1; this month 目標未設定), one 未達 this month.
  const b4 = { v: 2, prev: { sales: pv(4, '予算を少し上回った。'), guests: pv(4, '予算どおり。'), ppa: pv(4, '予算どおり。'), repeat: pv(4, '目標どおり。'), labor: pv(null, ''), fc: pv(4, '目標どおり。') },
    cur: { ...emptyCur(), guests: cv(2, '店の前の工事（10/5〜）で歩く人が減った。テイクアウトは増えている。', 'テイクアウトの案内を店の前に出す（10/16）'),
      labor: cv(null, '人件費の目標が未設定（本部に確認中）。') },
    focus: { takeout: fo('ok', '事前注文の案内を始めた。', '週 20 件まであと 4 件。', '店の前に案内板（10/21）', 'Kim'),
      review: fo('ok', '口コミへの返信を毎日。', 'なし', '続ける', '中村') }, consult: 'none', issues: [] };
  // D5: sales not synced yet (未取得), a late focus item, a question; nobody has replied (返信期限を過ぎている).
  const b5 = { v: 2, prev: { sales: pv(3, '9 月の後半に雨が多かった。'), guests: pv(3, '売上と同じ。'), ppa: pv(4, '目標どおり。'), repeat: pv(3, '少し下がった。'),
      labor: pv(2, '夜のリーダーがいない日に 2 人で締めている。', '夜のリーダーを決める'), fc: pv(4, '目標どおり。') },
    cur: { ...emptyCur(), labor: cv(2, '夜のリーダー不在で締めが長い。', '') },
    focus: { newcust: fo('late', 'チラシを 300 枚配った。', '新規客が目標に届かない。', '駅前で配る回数を増やす（10/25）', 'Garcia'),
      menu: fo('ok', '秋の限定メニューを出した。', 'ドリンクとのセット。', 'セットのメニュー表（10/22）', '原田') },
    consult: 'yes', issues: [{ id: 'i1', what: '夜のリーダーを誰にするか', ask: '候補 2 人のどちらにするか一緒に決めたい', proposal: '', ask_by: D(21), severity: 'high' }] };
  // D6: a draft with items still missing (相談の有無が未選択、重点が空、当月の未達に対策なし). Its submit date has passed.
  const b6 = { v: 2, prev: { ...emptyPrev(), sales: pv(4, '少し届かなかった。') }, cur: { ...emptyCur(), repeat: cv(3, 'リピートが下がった。', '') },
    focus: { ppa: fo('ok', 'ドリンクの提案を始めた。', '', '', 'Nguyen') }, consult: '', issues: [] };
  const sub = (no, at, by, body, store) => ({ no, at, by, body, snapshot: demoSnapshot(ym, S[store]) });
  const rp = (target, author_role, author_name, text, at, extra = {}) => ({ kind: 'reply', target, author_role, author_name, text, at, sub_no: 1, ...extra });
  const reviews = [
    { store_id: 'D1', ym, status: 'submitted', version: 3, submitted_no: 1, submitted_at: `${D(15)}T07:12:00Z`, deadlines: { submit: D(15), reply: D(20) },
      updated_at: `${D(15)}T07:12:00Z`, updated_by: '店長 田中（デモ）', body: b1, submissions: [sub(1, `${D(15)}T07:12:00Z`, '店長 田中（デモ）', b1, 'D1')],
      replies: [
        rp('issue:i1', 'chef', 'Head Chef 岡（デモ）', '米の炊き方で量を少し減らせる。盛り付けの計量と合わせて試してほしい。', `${D(16)}T01:00:00Z`),
        rp('issue:i1', 'am', 'AM 佐藤（デモ）', '業者の見積りは本部で取る。店は計量を続けて、10/25 に結果を教えて。', `${D(16)}T03:00:00Z`, { decision: 'modify', due: D(25) }),
        { kind: 'note', target: 'issue:i1', author_role: 'staff', author_name: '店長 田中（デモ）', text: '計量を 10/16 から始めました。1 杯あたり 8 g 減っています。', at: `${D(16)}T22:00:00Z`, sub_no: 1 },
        rp('issue:i1', 'gm', 'GM 山本（デモ）', '2 社の見積りを 10/22 までに出す。', `${D(17)}T02:00:00Z`, { decision: 'as_proposed', due: D(22) }),
        rp('prev:fc', 'ceo', 'CEO（デモ）', '廃棄の記録は良い。来月も続けて。', `${D(17)}T04:00:00Z`),
        rp('cur:sales', 'am', 'AM 佐藤（デモ）', '雨の日の告知、前日の夕方に出すと効く。', `${D(17)}T05:00:00Z`),
        { kind: 'done', target: 'focus:cs', author_role: 'staff', author_name: '店長 田中（デモ）', text: '全件 48 時間以内の返信、10 月も続けています。', at: `${D(17)}T20:00:00Z`, sub_no: 1 }] },
    { store_id: 'D2', ym, status: 'confirmed', version: 2, submitted_no: 1, submitted_at: `${D(13)}T22:00:00Z`, confirmed_at: `${D(16)}T20:00:00Z`, confirmed_by: 'AM 佐藤（デモ）',
      deadlines: {}, updated_at: `${D(16)}T20:00:00Z`, updated_by: 'AM 佐藤（デモ）', body: b2, submissions: [sub(1, `${D(13)}T22:00:00Z`, '店長 Park（デモ）', b2, 'D2')],
      replies: [rp('review', 'am', 'AM 佐藤（デモ）', '全項目が目標どおり。このまま続けてください。', `${D(16)}T19:50:00Z`, { decision: 'no_action' })] },
    { store_id: 'D3', ym, status: 'submitted', version: 2, submitted_no: 1, submitted_at: `${D(15)}T22:30:00Z`, deadlines: { submit: D(15), reply: D(17) },
      updated_at: `${D(15)}T22:30:00Z`, updated_by: '店長 鈴木（デモ）', body: b3, submissions: [sub(1, `${D(15)}T22:30:00Z`, '店長 鈴木（デモ）', b3, 'D3')],
      replies: [
        rp('issue:i1', 'am', 'AM 佐藤（デモ）', '港町と話す。GM に上げます。', `${D(17)}T01:00:00Z`, { decision: 'escalate' }),
        rp('issue:i2', 'am', 'AM 佐藤（デモ）', '予算にない費用なので CEO の判断。', `${D(17)}T01:05:00Z`, { decision: 'escalate', due: D(22) }),
        rp('issue:i2', 'ceo', 'CEO（デモ）', '2 か月だけ出す。応募の数を毎週教えて。', `${D(17)}T20:00:00Z`, { decision: 'as_proposed', due: D(31) })] },
    { store_id: 'D4', ym, status: 'submitted', version: 2, submitted_no: 1, submitted_at: `${D(16)}T03:00:00Z`, deadlines: {},
      updated_at: `${D(16)}T03:00:00Z`, updated_by: '店長 Kim（デモ）', body: b4, submissions: [sub(1, `${D(16)}T03:00:00Z`, '店長 Kim（デモ）', b4, 'D4')],
      replies: [rp('cur:guests', 'am', 'AM Lee（デモ）', '工事はいつまでか分かる？ テイクアウトの割合も教えて。', `${D(16)}T19:00:00Z`, { decision: 'followup', due: D(19) })] },
    { store_id: 'D5', ym, status: 'submitted', version: 2, submitted_no: 1, submitted_at: `${D(15)}T05:00:00Z`, deadlines: { reply: D(17) },
      updated_at: `${D(15)}T05:00:00Z`, updated_by: 'Operation Leader 原田（デモ・G3）', body: b5,
      submissions: [sub(1, `${D(15)}T05:00:00Z`, 'Operation Leader 原田（デモ・G3）', b5, 'D5')], replies: [] },
    { store_id: 'D6', ym, status: 'draft', version: 1, submitted_no: 0, deadlines: { submit: D(15) },
      updated_at: `${D(13)}T02:00:00Z`, updated_by: '店長 Nguyen（デモ）', body: b6 },
  ];
  return { stores, reviews };
}

// ---------------------------------------------------------------- the handler
export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  // The PIN sign-in's mark is checked by this function (the same key and form as auth-pin). None: PIN is refused.
  const verifyPin = typeof deps.verifyPin === 'function' ? deps.verifyPin : null;
  const origins = ['https://funergy-plus.com', ...String(env('MR_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined);

  // Who is calling and how they signed in. An Auth bearer (not the anon key) is the email sign-in; otherwise the body's
  // pin_session is the PIN sign-in. Never the body's own via / actor.
  async function actorOf(req, body) {
    const auth = req.headers.get('authorization') || '';
    if (auth.startsWith('Bearer ') && auth !== 'Bearer ' + anon) {
      if (auth.length > 4000) return null;
      const r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal: timeout() });
      if (!r.ok) return null;
      const u = await r.json();
      return u && typeof u.id === 'string' ? { actor: u.id, via: 'email' } : null;
    }
    const tok = body.pin_session;
    if (typeof tok !== 'string' || !tok || tok.length > 4000 || !verifyPin) return null;
    let who = null;
    try { who = await verifyPin(tok); } catch { return null; }
    if (!who || typeof who !== 'object') return null;
    const emp_id = typeof who.emp_id === 'string' && who.emp_id && who.emp_id.length <= 64 ? who.emp_id : null;
    const name = typeof who.name === 'string' && who.name.trim() && who.name.length <= 80 ? who.name : null;
    if (!emp_id && !name) return null;
    const r = await db.rpc('mr_pin_actor', { emp_id, name });
    return r && typeof r.user_id === 'string' ? { actor: r.user_id, via: 'pin' } : null;
  }

  const str = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));
  const NO = v => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : null);
  // The version a settings screen read (v1073). Required: a screen from before v1073 sends none, and saving without it could
  // put back what someone else saved after that screen read → 'gone' (update the app). Anything else that is not a whole
  // number is refused. The SQL compares it with the version now (another version → conflict, nothing written).
  const VER = v => {
    if (v === undefined || v === null) { const e = new Error('gone'); e.code = 'gone'; throw e; }
    if (!(Number.isInteger(v) && v >= 0 && v <= 999999999)) throw bad();
    return v;
  };
  const where = b => ({ env: str(b.env, 8), ym: str(b.ym, 8), store_id: str(b.store_id, 30) });
  // An employee id from the settings screen (null: none). Anything that is not a short string is refused.
  const EMP = v => { if (v == null || v === '') return null; if (typeof v !== 'string' || v.length > 64 || /[\u0000-\u001f]/.test(v)) throw bad(); return v; };
  const rpc = (name, who, p) => db.rpc(name, { actor: who.actor, via: who.via, ...p });
  const ACTIONS = {
    whoami: (w, b) => rpc('mr_whoami', w, { ym: str(b.ym, 8) }),
    list: (w, b) => rpc('mr_list', w, { env: str(b.env, 8), ym: str(b.ym, 8) }),
    get: (w, b) => rpc('mr_get', w, where(b)),
    save: (w, b) => rpc('mr_save', w, { ...where(b), expect_version: NO(b.expect_version), body: normBody(b.body) }),
    submit: (w, b) => rpc('mr_submit', w, { ...where(b), expect_version: NO(b.expect_version), snapshot: normSnap(b.snapshot) }),
    post: (w, b) => {
      const kind = KINDS.includes(b.kind) ? b.kind : null;
      if (!kind || typeof b.text !== 'string' || typeof b.client_id !== 'string' || !RID.test(b.client_id)) throw bad();
      const decision = b.decision == null || b.decision === '' ? null : DECISIONS.includes(b.decision) ? b.decision : (() => { throw bad(); })();
      return rpc('mr_post', w, { ...where(b), kind, target: typeof b.target === 'string' ? b.target.slice(0, 60) : null, text: TS(b.text, LIMITS.text),
        decision: kind === 'reply' ? decision : null, due: kind === 'reply' ? DTS(b.due) : '', client_id: b.client_id.toLowerCase(),
        sub_no: b.sub_no == null ? null : NO(b.sub_no) ?? (() => { throw bad(); })() });
    },
    confirm: (w, b) => rpc('mr_confirm', w, { ...where(b), expect_no: NO(b.expect_no) }),
    unconfirm: (w, b) => rpc('mr_unconfirm', w, where(b)),
    deadline_save: (w, b) => rpc('mr_deadline_save', w, { ...where(b), deadlines: { submit: DTS(obj(b.deadlines).submit), reply: DTS(obj(b.deadlines).reply) } }),
    settings_save: (w, b) => rpc('mr_settings_save', w, { key: str(b.key, 20), value: obj(b.value), expect_version: VER(b.expect_version) }),
    members_list: w => rpc('mr_members_list', w, {}),
    stores_save: (w, b) => rpc('mr_stores_save', w, { stores: Array.isArray(b.stores) ? b.stores.slice(0, 61).map(s => ({
      store_id: str(s && s.store_id, 30), name: str(s && s.name, 80), am_user: s && s.am_user ? str(s.am_user, 40) : null,
      sort: Number.isInteger(s && s.sort) && s.sort >= 0 && s.sort <= 9999 ? s.sort : 0, active: !(s && s.active === false), expect_version: VER(s && s.expect_version) })) : null }),
    access_get: (w, b) => rpc('mr_access_get', w, { ym: str(b.ym, 8) }),
    access_save: (w, b) => {
      if (!Array.isArray(b.stores)) throw bad();
      return rpc('mr_access_save', w, { stores: b.stores.slice(0, 61).map(s => {
        s = obj(s);
        if (s.viewer_emps != null && !Array.isArray(s.viewer_emps)) throw bad();
        return { store_id: str(s.store_id, 30), input_emp: EMP(s.input_emp), viewer_emps: (s.viewer_emps || []).slice(0, 21).map(v => { const e = EMP(v); if (!e) throw bad(); return e; }),
          expect_version: VER(s.expect_version) };
      }) });
    },
    month_input_save: (w, b) => rpc('mr_month_input_save', w, { store_id: str(b.store_id, 30), ym: str(b.ym, 8), input_emp: EMP(b.input_emp) }),
    chef_save: (w, b) => rpc('mr_chef_save', w, { emp_id: EMP(b.emp_id), on: b.on === true }),
    demo_reset: async w => {
      const x = await rpc('mr_whoami', w, {});
      const ym = x && x.demo && /^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(x.demo.ym || '') ? x.demo.ym : '2026-10';
      return rpc('mr_demo_reset', w, demoData(ym));
    },
  };
  // The first edition's reply / completion steps (v1066–v1068) are not part of v2.
  const GONE = ['reply_save', 'reply_delete', 'reply_send', 'complete', 'result_save'];
  const ERR = { forbidden: 403, disabled: 403, email_required: 403, actor_required: 401, conflict: 409, not_found: 404, bad_value: 400, bad_key: 400,
    bad_candidate: 400, not_available: 409, locked: 409, incomplete: 422, unchanged: 409, new_version: 409, legacy: 409, not_submitted: 409,
    not_confirmed: 409, role_exists: 409, member_stopped: 409, gone: 410 };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin' }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 100000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_json' }, 400);
    if (GONE.includes(body.action)) return json({ error: 'gone' }, 410);
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const who = await actorOf(req, body);
      if (!who) return json({ error: 'unauthorized' }, 401);
      return json(await fn(who, body));
    } catch (e) {
      const msg = String(e.message || 'error'), code = msg.split(/[\s:]/)[0];
      const status = ERR[code] || 500;
      if (status === 500) console.error('mid-review', body && body.action, safeErr(e));
      // 'incomplete' carries the missing items' codes (made by the server from fixed keys).
      if (code === 'incomplete') {
        const rest = msg.slice('incomplete'.length).trim();
        return json({ error: code, missing: rest ? rest.split(',').filter(x => /^[a-z]+(:[A-Za-z0-9_?-]{1,40}){0,2}$/.test(x)).slice(0, 100) : [] }, status);
      }
      return json({ error: status === 500 ? 'error' : code }, status);
    }
  };
}
export { ROLES };
