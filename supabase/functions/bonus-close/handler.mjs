// bonus-close: ボーナスの仮締め・支給額確定・修正・支給済み・調整記録の API（v1109・UI案61 の ②）。Spec: docs/BONUS_CLOSE_V1109_JA.md.
// v1116: 人ごとの「無条件で基準額」と特別報酬（docs/BONUS_BASE_SPECIAL_V1116_JA.md）。
// One way in: a Supabase Auth sign-in (email). The database (manager_auth via bc_actor) decides the role: CEO / GM write,
// accounting (office) reads. The browser's own idea of its role or name is never used. Nothing here pays, deducts,
// sends to payroll or publishes an amount to the person; the bonus formula stays in the app.

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^bc_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 400)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

// Error text that may reach logs: no tokens or keys.
const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer)[^\s]*/gi, '$1:***').slice(0, 200);
// The codes the SQL raises (anything else is 'error').
export const CODES = ['unauthorized', 'forbidden', 'bad_value', 'conflict', 'not_editable', 'not_found', 'bad_snapshot', 'bad_amounts', 'unselected',
  'no_pool', 'why_required', 'memo_required', 'already_paid', 'fixing', 'pay_mismatch'];
const bad = () => { const e = new Error('bad_value'); e.code = 'bad_value'; return e; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const Q = v => (typeof v === 'string' && /^\d{4}-Q[1-4]$/.test(v) ? v : (() => { throw bad(); })());
const REV = v => (Number.isInteger(v) && v >= 0 && v <= 999999999 ? v : (() => { throw bad(); })());
const VER = v => (Number.isInteger(v) && v >= 1 && v <= 999999 ? v : (() => { throw bad(); })());
const TXT = (v, n) => { if (v == null) return ''; if (typeof v !== 'string' || v.length > n) throw bad(); return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); };
const DATE = v => (typeof v === 'string' && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? v : (() => { throw bad(); })());
const SIZE = (v, n) => { const o = obj(v); if (!o) throw bad(); if (JSON.stringify(o).length > n) throw bad(); return o; };
// v1116: an employee id (the same form as the snapshot's order) and a whole-dollar amount 0 … 100,000,000 ($1 units, as the bonus).
const EMP = v => (typeof v === 'string' && /^[A-Za-z0-9_.:@-]{1,64}$/.test(v) ? v : (() => { throw bad(); })());
const AMT = v => (Number.isInteger(v) && v >= 0 && v <= 100000000 ? v : (() => { throw bad(); })());
const AMT0 = v => (v == null ? null : AMT(v));

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const origins = ['https://funergy-plus.com', ...String(env('BC_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined);

  // The email sign-in only (an Auth bearer that is not the anon key). The PIN sign-in is not accepted for bonus amounts.
  async function actorOf(req) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ' + anon || auth.length > 4000) return null;
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal: timeout() });
    if (!r.ok) return null;
    const u = await r.json();
    return u && typeof u.id === 'string' ? u.id : null;
  }

  const rpc = (name, actor, p) => db.rpc(name, { actor, ...p });
  const ACTIONS = {
    get: (a, b) => rpc('bc_get', a, { quarter: Q(b.quarter) }),
    version: (a, b) => rpc('bc_version', a, { quarter: Q(b.quarter), ver: VER(b.ver) }),
    draft_save: (a, b) => rpc('bc_draft_save', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), draft: SIZE(b.draft, 600000) }),
    save: (a, b) => {
      if (b.kind !== 'provisional' && b.kind !== 'final') throw bad();
      return rpc('bc_save', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), kind: b.kind, snap: SIZE(b.snap, 6000000), why: TXT(b.why, 500) });
    },
    confirm: (a, b) => rpc('bc_confirm', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), ver: VER(b.ver), why: TXT(b.why, 500) }),
    fix_start: (a, b) => rpc('bc_fix_start', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev) }),
    fix_cancel: (a, b) => rpc('bc_fix_cancel', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev) }),
    mark_paid: (a, b) => rpc('bc_mark_paid', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), ver: VER(b.ver), paid_on: DATE(b.paid_on) }),
    // v1116: 「無条件で基準額」／「通常の評価計算に戻す」 (CEO / GM, like every write here) and 特別報酬 (CEO / GM — the SQL checks the role
    // itself). Both only while the draft can be changed; a saved version must carry them exactly (bc_save).
    pay_mode: (a, b) => {
      if (b.mode !== 'base' && b.mode !== 'normal') throw bad();
      return rpc('bc_pay_mode', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), emp_id: EMP(b.emp_id), emp_name: TXT(b.emp_name, 80), mode: b.mode,
        why: TXT(b.why, 300), amt0: AMT0(b.amt0), amt1: AMT0(b.amt1) });
    },
    sp_save: (a, b) => rpc('bc_sp_save', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), emp_id: EMP(b.emp_id), emp_name: TXT(b.emp_name, 80),
      amount: AMT(b.amount), why: TXT(b.why, 300) }),
    adjust_done: (a, b) => {
      if (!(Number.isInteger(b.id) && b.id >= 1 && b.id <= 999999999999)) throw bad();
      return rpc('bc_adjust_done', a, { quarter: Q(b.quarter), expect_rev: REV(b.expect_rev), id: b.id, memo: TXT(b.memo, 500) });
    },
  };

  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const cors = { 'access-control-allow-origin': origins.includes(origin) ? origin : origins[0], 'access-control-allow-headers': 'authorization, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (origin && !origins.includes(origin)) return json({ error: 'forbidden' }, 403);
    let body;
    try { const t = await req.text(); if (t.length > 7000000) return json({ error: 'bad_value' }, 400); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_value' }, 400); }
    if (!obj(body)) return json({ error: 'bad_value' }, 400);
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'bad_value' }, 400);
    let actor;
    try { actor = await actorOf(req); } catch { actor = null; }
    if (!actor) return json({ error: 'unauthorized' }, 401);
    try {
      return json(await fn(actor, body) ?? {});
    } catch (e) {
      // Our own refusals carry .code; the SQL's come back as the message (raise exception 'conflict' …).
      const code = [e && e.code, e && e.message].map(v => String(v || '')).find(v => CODES.includes(v)) || '';
      if (code) {
        const status = code === 'unauthorized' ? 401 : code === 'forbidden' ? 403 : code === 'conflict' ? 409 : code === 'not_found' ? 404 : 400;
        return json({ error: code }, status);
      }
      console.error('bonus-close', body.action, safeErr(e));
      return json({ error: 'error' }, 500);
    }
  };
}
