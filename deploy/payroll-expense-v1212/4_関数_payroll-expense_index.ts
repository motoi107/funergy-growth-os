// @ts-nocheck
// payroll-expense（v1212・B-2）：Supabase の Edge Functions に貼る 1 ファイル。中身は supabase/functions/payroll-expense/handler.mjs と index.ts の Deno.serve の行をつないだだけ（鍵は入っていない）。
// 新しい関数 payroll-expense として作り、Verify JWT は OFF（関数の中で確かめる）。先に ② の SQL を流す。

// payroll-expense（v1212・B-2）：Payroll 別のガソリン代・立替経費。仕様：docs/PAYROLL_EXPENSE_V1212_JA.md
// ・だれか：PIN のログインの印（本文の pin_session）を関数 work-requests の whoami に確かめてもらう（PIN を確かめるコードは入れない）。
//   店のタブレット（店舗の PIN）は whoami が断る。読める・出せる・支給済みにできるのは CEO・GM・経理・事務Crew（確かめた PIN の事務Crew も）。
//   この関数でも、SQL（pe_actor＝申請の SQL の wr_actor）でも確かめる。
// ・中身は SQL（20261218090000_payroll_expense.sql）：期間（1〜15 日／16 日〜末日・ハワイ時間）・支給日・割当・出力の版・支給済み。
//   給与・Tip・賞与は読まない・返さない。鍵は無い（Supabase の SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY・SUPABASE_ANON_KEY だけ）。
export const FN = 1;
export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^pe_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 400)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

const ROLES = ['ceo', 'gm', 'office', 'office_crew'];
const E = (code, status) => { const e = new Error(code); e.code = code; e.status = status || 400; e.pe = true; return e; };
const bad = () => E('bad_value', 400);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const YM = v => { if (typeof v !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) throw bad(); return v; };
const PER = v => { if (typeof v !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-[12]$/.test(v)) throw bad(); return v; };
const UUID = v => { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw bad(); return v.toLowerCase(); };
const INT = (v, lo, hi) => { if (!Number.isInteger(v) || v < lo || v > hi) throw bad(); return v; };
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const TXT = (v, n) => (typeof v === 'string' ? v.replace(CTRL, '').trim().slice(0, n) : '');
const DAY = v => { if (typeof v !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T00:00:00Z'))) throw bad(); return v; };
// SQL のエラー（raise exception の文）→ 答えのコード
const SQL_ERR = { forbidden: 403, bad_value: 400, not_found: 404, reason_required: 400, sum_mismatch: 400, paid_period: 409, conflict: 409, changed: 409,
  not_exported: 409, legacy_paid: 409 };

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const now = deps.now || (() => Date.now());
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const wrUrl = env('PE_WR_URL') || (url + '/functions/v1/work-requests');
  const origins = ['https://funergy-plus.com', ...String(env('PE_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const cache = new Map();   // sha256(印) → { a, exp }（60 秒。同じ印で何度も work-requests を呼ばない。権限は SQL がいつも確かめ直す）
  const enc = new TextEncoder();
  const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

  async function whoami(tok) {
    if (typeof deps.whoami === 'function') {
      let w; try { w = await deps.whoami(tok); } catch { return { err: 'auth_unavailable' }; }
      return w && typeof w.emp === 'string' && w.emp ? { emp: w.emp, role: String(w.role || ''), name: String(w.name || '').slice(0, 120) } : { deny: 'pin' };
    }
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(wrUrl, { method: 'POST', signal: ac.signal, headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', pin_session: tok }) });
      const body = await r.text();
      if (r.status === 401 || r.status === 403) return { deny: 'pin' };
      if (!r.ok) return { err: 'auth_unavailable' };
      let j = null; try { j = JSON.parse(body); } catch { return { err: 'auth_unavailable' }; }
      const me = obj(j && j.me);
      return me && typeof me.emp === 'string' && me.emp && me.emp.length <= 64
        ? { emp: me.emp, role: typeof me.role === 'string' ? me.role : '', name: typeof me.name === 'string' ? me.name.slice(0, 120) : '' } : { deny: 'pin' };
    } catch { return { err: 'auth_unavailable' }; }
    finally { clearTimeout(t); }
  }
  async function actorOf(body) {
    const tok = body.pin_session;
    if (typeof tok !== 'string' || !tok || tok.length > 4000) return { deny: 'none' };
    const h = await sha(tok);
    const c = cache.get(h);
    if (c && c.exp > now()) return c.a;
    const a = await whoami(tok);
    if (a.err) return a;
    if (cache.size > 300) cache.clear();
    cache.set(h, { a, exp: now() + (a.deny ? 30000 : 60000) });
    return a;
  }
  const W = a => ({ emp_id: a.emp, name: a.name || '' });

  const ACTIONS = {
    // 月を読む（2 つの期間・要確認・版の一覧・支給日の設定）
    get: (a, b) => db.rpc('pe_get', { ...W(a), ym: YM(b.ym) }),
    // 1 つの申請の割当の記録（内訳から）
    req: (a, b) => db.rpc('pe_req', { ...W(a), id: UUID(b.id) }),
    // 割当を変える：ids（200 件まで）をまるごと period へ／id を parts（2〜4 つ・セント）に分ける。理由は必ず
    assign: (a, b) => {
      const reason = TXT(b.reason, 200);
      if (!reason) throw E('reason_required', 400);
      if (Array.isArray(b.parts)) {
        if (b.parts.length < 2 || b.parts.length > 4) throw bad();
        const parts = b.parts.map(x => { if (!obj(x)) throw bad(); return { period: PER(x.period), cents: INT(x.cents, 1, 1e11) }; });
        return db.rpc('pe_assign', { ...W(a), id: UUID(b.id), parts, reason });
      }
      if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 200) throw bad();
      return db.rpc('pe_assign', { ...W(a), ids: [...new Set(b.ids.map(UUID))], period: PER(b.period), reason });
    },
    // 出力（版を作る。同じ中身なら前の版）
    export: (a, b) => db.rpc('pe_export', { ...W(a), period: PER(b.period) }),
    // 版の写しを読む
    ver: (a, b) => db.rpc('pe_ver', { ...W(a), period: PER(b.period), ver: INT(b.ver, 1, 1e6) }),
    // 支給済みにする（いちばん新しい版・その指紋のときだけ）
    paid: (a, b) => {
      if (typeof b.fp !== 'string' || !/^[0-9a-f]{32}$/.test(b.fp)) throw bad();
      return db.rpc('pe_mark_paid', { ...W(a), period: PER(b.period), ver: INT(b.ver, 1, 1e6), fp: b.fp, note: TXT(b.note, 200) });
    },
    // 支給日の決まり・休日（CEO・GM・経理。SQL が確かめる）
    cfg_save: (a, b) => {
      const list = v => { if (v == null) return []; if (!Array.isArray(v) || v.length > 100) throw bad(); return [...new Set(v.map(DAY))]; };
      return db.rpc('pe_cfg_save', { ...W(a), day_first: INT(b.day_first, 1, 28), day_second: INT(b.day_second, 1, 28), add: list(b.add), off: list(b.off),
        expect_rev: INT(b.expect_rev, 0, 1e9) });
    },
  };

  return async function handler(req) {
    const origin = req.headers.get('origin');
    const okOrigin = origin && origins.includes(origin) ? origin : null;
    const cors = okOrigin ? { 'access-control-allow-origin': okOrigin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify({ ...v, fn: FN }), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      if (origin && !okOrigin) return json({ error: 'origin' }, 403);
      let body;
      try { const t = await req.text(); if (t.length > 200000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_value' }, 400); }
      if (!obj(body)) return json({ error: 'bad_value' }, 400);
      const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
      if (!fn) return json({ error: 'unknown_action' }, 400);
      const a = await actorOf(body);
      if (a.err) return json({ error: a.err }, 503);
      if (a.deny) return json({ error: 'unauthorized' }, 401);
      if (!ROLES.includes(a.role)) return json({ error: 'forbidden' }, 403);   // 店のスタッフ・AM など（SQL でも断る）
      const r = await fn(a, body);
      return json(obj(r) ? r : { result: r });
    } catch (e) {
      if (e && e.pe) return json({ error: e.code }, e.status);
      const m = String((e && e.message) || '');
      const code0 = m.split(/[\s:]/)[0];
      if (Object.prototype.hasOwnProperty.call(SQL_ERR, code0)) return json({ error: code0 }, SQL_ERR[code0]);
      // SQL がまだ（関数・表が無い）のときだけ。ほかは server_error（中身はログにも出さない）
      if ((e && e.status === 404) || /(function|relation) \S*pe_[a-z_]+(\([^)]*\))?"? does not exist|Could not find the function public\.pe_/.test(m)) return json({ error: 'pe_missing' }, 503);
      console.error('payroll-expense', code0.slice(0, 80));
      return json({ error: 'server_error' }, 500);
    }
  };
}

Deno.serve(createHandler({ env: (key) => Deno.env.get(key) }));
