// work-requests: ワークセンターの申請の API（v1131・1 段目＝経費 3 種／v1132・2 段目＝評価の変更 3 種と表示設定／v1133・反映の押さえ）。仕様：docs/WORK_REQUESTS_V1131_JA.md・docs/WORK_REQUESTS_V1132_JA.md・docs/WORK_REQUESTS_V1133_JA.md
// 入り方は PIN のログインの印だけ（deps.verifyPin が確かめて { emp_id, name } を返す）。アプリが送る役割・名前・承認した人は使わない。
// 役割・店・できることは SQL（wr_actor・wr_actions）が決める。この関数は形を整えて渡すだけ。

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^wr_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 400)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer)[^\s]*/gi, '$1:***').slice(0, 200);
const bad = () => { const e = new Error('bad_value'); e.code = 'bad_value'; return e; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// 文字は黙って切らない（長すぎれば断る・画面も同じ長さで止める）
const TS = (v, n) => { if (v == null) return ''; if (typeof v !== 'string') throw bad(); const x = v.replace(CTRL, '').trim(); if (x.length > n) throw bad(); return x; };
const isDate = v => {
  if (typeof v !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
const DT = v => { if (!isDate(v)) throw bad(); return v; };
const DTO = v => (v == null || v === '' ? '' : DT(v));
const CENTS = v => { if (!Number.isInteger(v) || v <= 0 || v > 100000000) throw bad(); return v; };
const KEY = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(v)) throw bad(); return v; };
const STORE = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_\-]{1,30}$/.test(v)) throw bad(); return v; };
const REV = v => { if (!Number.isInteger(v) || v < 1 || v > 1e9) throw bad(); return v; };
const ID = v => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null);
const CODE = v => (typeof v === 'string' && /^[A-Z]{2}-\d{4}-\d{4,6}$/.test(v) ? v : null);

export const KINDS = ['mileage', 'reimburse', 'expense_pre'];
// v1132：評価の変更（G4 → GM）。スキル Lv・Career Score・Tip Rate
export const EVAL_KINDS = ['skill', 'cs', 'tiprate'];
export const ALL_KINDS = [...KINDS, ...EVAL_KINDS];
export const TIP_RATES = [80, 90, 100];
const EMP = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(v)) throw bad(); return v; };
const LV = (v, max, nullable) => { if (v == null && nullable) return null; if (!Number.isInteger(v) || v < 0 || v > max) throw bad(); return v; };
const NUMN = (v, max) => { if (v == null) return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw bad(); return Math.round(v * 100) / 100; };
export const MILEAGE_PURPOSES = ['買い出し', 'ミーティング', '銀行・郵便', '店舗間移動', 'その他'];
export const LIMITS = { text: 200, long: 600, note: 400, method: 60, name: 80 };

// 申請の中身（種類ごとに決まった欄だけ。ほかは捨てる）
export function normPayload(kind, p) {
  p = obj(p);
  const L = LIMITS;
  if (kind === 'mileage') {
    const miles = p.one_way_miles;
    if (typeof miles !== 'number' || !Number.isFinite(miles) || miles <= 0 || miles > 1000) throw bad();
    const purpose = TS(p.purpose, 40);
    if (!MILEAGE_PURPOSES.includes(purpose)) throw bad();
    return { date: DT(p.date), purpose, origin: TS(p.origin, L.text), destination: TS(p.destination, L.text), one_way_miles: Math.round(miles * 10) / 10,
      round_trip: p.round_trip === true, memo: TS(p.memo, L.long) };
  }
  if (kind === 'reimburse') {
    const payer = TS(p.payer, L.name), vendor = TS(p.vendor, L.text);
    if (!payer || !vendor) throw bad();
    const rc = obj(p.receipt);
    const path = TS(rc.path, 300), drive = TS(rc.drive_url, 400);
    if (path && !/^[A-Za-z0-9_\-./]+$/.test(path)) throw bad();
    if (drive && !/^https:\/\/(drive|docs)\.google\.com\//.test(drive)) throw bad();
    return { date: DT(p.date), payer, payer_is_employee: p.payer_is_employee === true, vendor, purpose: TS(p.purpose, 40), purpose_memo: TS(p.purpose_memo, L.long),
      amount_cents: CENTS(p.amount_cents), receipt: path || drive ? { path, drive_url: drive } : null, memo: TS(p.memo, L.long) };
  }
  if (kind === 'expense_pre') {
    const purpose = TS(p.purpose, L.text);
    if (!purpose) throw bad();
    const pp = p.per_person_cents == null ? null : CENTS(p.per_person_cents);
    const n = p.participants == null ? null : (Number.isInteger(p.participants) && p.participants > 0 && p.participants <= 1000 ? p.participants : (() => { throw bad(); })());
    return { date: DT(p.date), dept: TS(p.dept, 60), project: TS(p.project, L.text), purpose, description: TS(p.description, L.long), location: TS(p.location, L.text),
      participants: n, per_person_cents: pp, total_cents: CENTS(p.total_cents), memo: TS(p.memo, L.long) };
  }
  // v1132：評価の変更。対象の人・今の値 → 申請する値・理由（必ず）。対象・店・グレードはサーバー（wr_norm_eval）がもう一度確かめる。
  if (EVAL_KINDS.includes(kind)) {
    const reason = TS(p.reason, L.long);
    if (!reason) throw bad();
    const base = { target_emp: EMP(p.target_emp), target_name: TS(p.target_name, L.name), reason };
    if (kind === 'tiprate') {
      if (!TIP_RATES.includes(p.rate_to)) throw bad();
      return { ...base, rate_from: LV(p.rate_from, 100, true), rate_to: p.rate_to, from_day: DT(p.from_day) };
    }
    const max = kind === 'skill' ? 30 : 200, top = kind === 'skill' ? 5 : 3;
    if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > max) throw bad();
    const seen = new Set();
    const items = p.items.map(x => {
      x = obj(x);
      const k = kind === 'skill' ? TS(x.pos, 60) : TS(x.key, 40);
      if (!k || seen.has(k)) throw bad();
      seen.add(k);
      const from = LV(x.from, top, true), to = LV(x.to, top, kind === 'cs');   // Career Score は「未採点に戻す」（null）もある
      return kind === 'skill' ? { pos: k, from, to } : { key: k, label: TS(x.label, 120), from, to };
    });
    if (kind === 'skill') return { ...base, items };
    const lss = TS(p.lss_req, 80);
    if (!lss || !/^[A-Za-z0-9_.:-]+$/.test(lss)) throw bad();
    return { ...base, items, lss_req: lss, quarter: TS(p.quarter, 20), total_from: NUMN(p.total_from, 10000), total_to: NUMN(p.total_to, 10000) };
  }
  throw bad();
}

// v1133：評価の変更の反映は apply_start（押さえる）→ 書く → apply_done／apply_fail／apply_cancel（押さえたときの鍵 claim が要る）。前の版の apply は SQL が断る
export const ACTS = ['edit', 'resubmit', 'withdraw', 'approve', 'return', 'reject', 'check', 'pay', 'dup_ok', 'undo', 'apply_start', 'apply_done', 'apply_fail', 'apply_cancel'];
const CLAIMED = ['apply_done', 'apply_fail', 'apply_cancel'];

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const verifyPin = typeof deps.verifyPin === 'function' ? deps.verifyPin : null;
  const origins = ['https://funergy-plus.com', ...String(env('WR_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];

  // 呼んだ人：本文の pin_session（auth-pin が出した印）だけ。メールのログインは使わない（アプリは PIN だけ）。
  async function actorOf(body) {
    const tok = body.pin_session;
    if (tok === undefined || tok === null || tok === '') return { deny: 'none' };
    if (!verifyPin) { const e = new Error('pin_check_missing'); e.code = 'pin_check_missing'; throw e; }
    if (typeof tok !== 'string' || tok.length > 4000) return { deny: 'pin_shape' };
    let who = null;
    try { who = await verifyPin(tok); } catch { return { deny: 'pin_check_error' }; }
    if (!who || typeof who !== 'object') return { deny: 'pin_mark' };
    const emp_id = typeof who.emp_id === 'string' && who.emp_id && who.emp_id.length <= 64 ? who.emp_id : null;
    const name = typeof who.name === 'string' && who.name.trim() && who.name.length <= 80 ? who.name : null;
    // 社員 ID の無い印（auth-pin v1085 より前の名前だけの印）は断る。名前は社員の表（公開の鍵で書ける）で引くことになるため（独立レビュー 272b159 の B）。
    // v1085 からの印には社員 ID が入る。前の印は期限（14 日）を過ぎている。
    if (!emp_id) return { deny: 'pin_no_emp' };
    return { emp_id, name };
  }

  const ref = b => { const id = ID(b.id), code = CODE(b.code); if (!id && !code) throw bad(); return id ? { id } : { code }; };
  const ACTIONS = {
    // fn：関数の版（v1132 は 2・v1133 から 3）・sql：SQL の段（2 段目の SQL が無ければ 1・反映の押さえ（v1133）が無ければ 2）。アプリは評価の変更が断られたとき、これで前の版かを見分ける
    whoami: async w => {
      const [me, st] = await Promise.all([db.rpc('wr_whoami', w), db.rpc('wr_stage', {}).catch(() => null)]);
      return { ...me, fn: 3, sql: (st && Number.isInteger(st.stage)) ? st.stage : 1 };
    },
    list: (w, b) => {
      const scope = ['todo', 'mine', 'team'].includes(b.scope) ? b.scope : 'todo';
      const state = ['open', 'closed', 'all'].includes(b.state) ? b.state : 'open';
      const kind = b.kind == null || b.kind === '' ? null : (ALL_KINDS.includes(b.kind) ? b.kind : (() => { throw bad(); })());
      const store = b.store == null || b.store === '' ? null : STORE(b.store);
      const limit = Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 1000 ? b.limit : 300;
      return db.rpc('wr_list', { ...w, scope, state, kind, store, from: DTO(b.from), to: DTO(b.to), limit });
    },
    get: (w, b) => db.rpc('wr_get', { ...w, ...ref(b) }),
    submit: (w, b) => {
      if (!ALL_KINDS.includes(b.kind)) throw bad();
      return db.rpc('wr_submit', { ...w, kind: b.kind, store_id: STORE(b.store_id), payload: normPayload(b.kind, b.payload), client_key: KEY(b.client_key),
        dup_reason: TS(b.dup_reason, LIMITS.note) || null });
    },
    act: (w, b) => {
      // 本文の action は 'act'（この関数の入口）。申請に何をするかは op。
      if (!ACTS.includes(b.op)) throw bad();
      const p = { ...w, ...ref(b), action: b.op, expect_rev: REV(b.expect_rev), client_key: KEY(b.client_key), note: TS(b.note, LIMITS.note) || null };
      if (b.op === 'edit' || b.op === 'resubmit') {
        if (!ALL_KINDS.includes(b.kind)) throw bad();
        p.payload = normPayload(b.kind, b.payload);
        p.dup_reason = TS(b.dup_reason, LIMITS.note) || null;
      }
      if (b.op === 'pay') { p.pay_date = DT(b.pay_date); p.pay_method = TS(b.pay_method, LIMITS.method); if (!p.pay_method) throw bad(); p.legacy_ack = b.legacy_ack === true; }
      if (CLAIMED.includes(b.op)) p.claim = KEY(b.claim);
      return db.rpc('wr_act', p);
    },
    settings_save: (w, b) => {
      if (typeof b.live !== 'boolean') throw bad();
      return db.rpc('wr_settings_save', { ...w, live: b.live, expect_rev: REV(b.expect_rev) });
    },
    legacy_import: w => db.rpc('wr_legacy_import', w),
    // 承認・閲覧の権限の写し（GM・CEO）：違いを見る・見た一覧（digest）のとおりに合わせる
    people_diff: w => db.rpc('wr_people_diff', w),
    people_sync: (w, b) => {
      if (typeof b.digest !== 'string' || !/^[0-9a-f]{32}$/.test(b.digest)) throw bad();
      const q = { ...w, digest: b.digest };
      if (b.emps != null) {
        if (!Array.isArray(b.emps) || b.emps.length > 500 || !b.emps.every(x => typeof x === 'string' && x && x.length <= 64)) throw bad();
        q.emps = b.emps;
      }
      return db.rpc('wr_people_sync', q);
    },
    // v1132：スキルマトリクスの「自分の表示設定」（人 × 店・非表示の人の社員 ID）
    view_get: (w, b) => db.rpc('wr_view_get', { ...w, store: STORE(b.store) }),
    view_save: (w, b) => {
      if (!Array.isArray(b.hidden) || b.hidden.length > 500) throw bad();
      const hidden = [...new Set(b.hidden.map(EMP))];
      if (!Number.isInteger(b.expect_rev) || b.expect_rev < 0 || b.expect_rev > 1e9) throw bad();
      return db.rpc('wr_view_save', { ...w, store: STORE(b.store), hidden, expect_rev: b.expect_rev });
    },
  };
  const ERR = { forbidden: 403, not_live: 409, conflict: 409, not_found: 404, bad_value: 400, no_rate: 409, reason_required: 400,
    dup_unresolved: 409, legacy_paid: 409, pin_check_missing: 503 };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin' }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 60000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_json' }, 400);
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const who = await actorOf(body);
      if (!who || who.deny) { console.warn('work-requests unauthorized', body.action, (who && who.deny) || 'none'); return json({ error: 'unauthorized' }, 401); }
      return json(await fn(who, body));
    } catch (e) {
      const msg = String(e.message || 'error'), code = msg.split(/[\s:]/)[0];
      const status = ERR[code] || 500;
      if (status === 500) console.error('work-requests', body && body.action, safeErr(e));
      return json({ error: status === 500 ? 'error' : code }, status);
    }
  };
}
