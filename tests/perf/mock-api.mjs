// PostgREST と Edge Function のまね（計測用・合成データだけ）。アプリが使う形だけを返す。
// 読み：select・eq/neq/gt/gte/lt/lte/like/ilike/in/is・not.・or=(…)・order・limit/offset・Range ヘッダー
// 書き：POST（upsert：merge-duplicates）・PATCH（条件つき）・DELETE。app_state の updated_at は渡された値（無ければ今）
// rpc/app_state_index：key・updated_at・md5(value::text)・バイト数（v1098 の差分の取り込みが使う。HAS_INDEX=0 なら 404）
import crypto from 'node:crypto';

const PK = { app_state: ['key'], app_settings: ['key'], employees: ['id'], stores: ['id'], ingredients: ['code'], recipes: ['id'], vendors: ['id'], categories: ['code'], tip_labor: ['restaurant_guid', 'business_date'], toast_sales: ['restaurant_guid', 'business_date'], shift_availability: ['store_id', 'week', 'name'], shift_plans: ['store_id', 'week'] };

function likeRe(pat) {
  let s = '';
  for (const ch of pat) s += ch === '*' || ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + s + '$', 's');
}
function splitTop(s) { // カンマで分ける（括弧と引用符の中は分けない）
  const out = []; let depth = 0, q = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { cur += c + s[++i]; continue; } if (c === '"') q = false; cur += c; continue; }
    if (c === '"') { q = true; cur += c; continue; }
    if (c === '(') depth++; if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur !== '') out.push(cur);
  return out;
}
const unq = v => (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v;
function cell(row, col) { const v = row[col]; return v == null ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
function test(row, col, opExpr) {
  let neg = false;
  if (opExpr.startsWith('not.')) { neg = true; opExpr = opExpr.slice(4); }
  const dot = opExpr.indexOf('.'); const op = opExpr.slice(0, dot); const val = opExpr.slice(dot + 1);
  const v = cell(row, col); let r;
  switch (op) {
    case 'eq': r = v != null && v === unq(val); break;
    case 'neq': r = v != null && v !== unq(val); break;
    case 'gt': r = v != null && v > val; break;
    case 'gte': r = v != null && v >= val; break;
    case 'lt': r = v != null && v < val; break;
    case 'lte': r = v != null && v <= val; break;
    case 'like': r = v != null && likeRe(unq(val)).test(v); break;
    case 'ilike': r = v != null && new RegExp(likeRe(unq(val)).source, 'is').test(v); break;
    case 'in': { const list = splitTop(val.replace(/^\(|\)$/g, '')).map(unq); r = v != null && list.includes(v); break; }
    case 'is': r = val === 'null' ? v == null : val === 'true' ? v === 'true' : val === 'false' ? v === 'false' : false; break;
    default: throw new Error('op ' + op);
  }
  return neg ? !r : r;
}
function orTest(row, expr) { // (a.like.x,b.eq.y)
  return splitTop(expr.replace(/^\(|\)$/g, '')).some(p => { const d = p.indexOf('.'); return test(row, p.slice(0, d), p.slice(d + 1)); });
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns']);
function filterRows(rows, u) {
  const conds = [];
  for (const [k, v] of u.searchParams) { if (!RESERVED.has(k)) conds.push([k, v]); }
  const ors = u.searchParams.getAll('or');
  return rows.filter(r => conds.every(([k, v]) => test(r, k, v)) && ors.every(o => orTest(r, o)));
}
function project(rows, sel) {
  if (!sel || sel === '*') return rows;
  const cols = sel.split(',').map(s => s.trim()).filter(Boolean);
  return rows.map(r => { const o = {}; for (const c of cols) o[c] = r[c] === undefined ? null : r[c]; return o; });
}
function nowTs() { const d = new Date(); return d.toISOString().replace('Z', '') + String(Math.floor(Math.random() * 1000)).padStart(3, '0') + '+00:00'; }

// v1104：v1101 の共有保存保護（本番は Codex が別に入れた SQL。このリポジトリに SQL は無い）のまね。
// 保護 ON（FIN_GUARD=1・既定）のとき、10 店 20 キーへの古い無条件の書き込み（POST・PATCH）は、
// 同じ要求の中のほかの行ごと断る（PostgreSQL の trigger が 1 つの文をまるごと止めるのと同じ）。
// 書けるのは rpc/financial_web_commit だけ（行全体の値と版を照らす・同じ request_id は同じ答え）。
const FIN_STORES = ['F01', 'F02', 'F03', 'F03-G', 'F04-A', 'F04-K', 'F04-P', 'F05', 'F06', 'F07'];
const FIN_KEYS = new Set(FIN_STORES.flatMap(s => ['daily_actuals_' + s, 'spl_budgets_v2_' + s]));
function finTs() { const d = new Date(); return d.toISOString().replace(/\.(\d{3})Z$/, (m, ms) => '.' + ms + String(Math.floor(Math.random() * 1000)).padStart(3, '0') + '+00:00'); }

export function createMock(data) {
  const T = {}; for (const [k, v] of Object.entries(data.tables)) T[k] = v.slice();
  const opts = { hasIndex: process.env.HAS_INDEX !== '0', toastDelay: Number(process.env.TOAST_DELAY_MS || 1500), finGuard: process.env.FIN_GUARD !== '0' };
  const receipts = new Map();
  const fin = { drop: 0, commits: 0, fail: {}, failed: 0 };   // v1104：次の保存の答えを落とす回数・書けた回数／v1107：店ごとに保存をサーバーのエラー（3 秒の上限で取り消し）にする回数
  const keyOf = (t, r) => (PK[t] || ['id']).map(c => String(r[c])).join('|');
  const idx = {}; function index(t) { if (!idx[t]) { idx[t] = new Map(); T[t].forEach((r, i) => idx[t].set(keyOf(t, r), i)); } return idx[t]; }
  const json = (status, body, headers) => ({ status, body: body === undefined ? '' : JSON.stringify(body), headers });

  function rest(method, table, u, headers, body) {
    if (!T[table]) T[table] = [];
    const rows = T[table];
    if (method === 'GET' || method === 'HEAD') {
      let out = filterRows(rows, u);
      const order = u.searchParams.get('order');
      if (order) { const [c, dir] = order.split(',')[0].split('.'); out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
      let from = 0, to = out.length - 1;
      const rg = headers['range']; if (rg) { const m = /^(\d+)-(\d+)$/.exec(rg); if (m) { from = +m[1]; to = Math.min(+m[2], to); } }
      if (u.searchParams.has('offset')) from = +u.searchParams.get('offset');
      if (u.searchParams.has('limit')) to = Math.min(to, from + +u.searchParams.get('limit') - 1);
      const page = out.slice(from, to + 1);
      return json(rg ? 206 : 200, project(page, u.searchParams.get('select')), { 'content-range': (page.length ? from + '-' + (from + page.length - 1) : '*') + '/' + out.length });
    }
    if (method === 'POST') {
      let arr = JSON.parse(body || '[]'); if (!Array.isArray(arr)) arr = [arr];
      if (table === 'app_state' && opts.finGuard && arr.some(r => FIN_KEYS.has(r && r.key)))
        return json(400, { code: 'P0001', message: 'financial_guard_legacy_write_rejected' });
      const ix = index(table); const out = [];
      for (const r of arr) {
        const rec = Object.assign({}, r);
        if (table === 'app_state' && !rec.updated_at) rec.updated_at = nowTs();
        const k = keyOf(table, rec);
        if (ix.has(k)) { const i = ix.get(k); if (/ignore-duplicates/.test(headers['prefer'] || '')) continue; rows[i] = Object.assign({}, rows[i], rec); out.push(rows[i]); }
        else { ix.set(k, rows.length); rows.push(rec); out.push(rec); }
      }
      return /return=representation/.test(headers['prefer'] || '') ? json(201, out) : json(201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(body || '{}'); const hit = filterRows(rows, u);
      if (table === 'app_state' && opts.finGuard && hit.some(r => FIN_KEYS.has(r.key)))
        return json(400, { code: 'P0001', message: 'financial_guard_legacy_write_rejected' });
      for (const r of hit) Object.assign(r, patch, table === 'app_state' && !patch.updated_at ? { updated_at: nowTs() } : {});
      return /return=representation/.test(headers['prefer'] || '') ? json(200, project(hit, u.searchParams.get('select'))) : json(204);
    }
    if (method === 'DELETE') { const hit = new Set(filterRows(rows, u)); T[table] = rows.filter(r => !hit.has(r)); delete idx[table]; return json(204); }
    return json(405, { error: 'method' });
  }
  function rpc(name, body, u) {
    if (name === 'app_state_index') {   // supabase/migrations/20261027090000_app_state_index.sql と同じ答え（印は中身の md5）
      if (!opts.hasIndex) return json(404, { code: 'PGRST202', message: 'Could not find the function' });
      const p = JSON.parse(body || '{}'); const ex = Array.isArray(p.p_skip_prefix) ? p.p_skip_prefix : [];
      let out = T.app_state.filter(r => !ex.some(x => x && String(r.key).startsWith(x))).map(r => { const s = JSON.stringify(r.value); return { key: r.key, updated_at: r.updated_at, h: crypto.createHash('md5').update(s).digest('hex'), n: Buffer.byteLength(s) }; });
      if (u.searchParams.get('order')) out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      const off = +(u.searchParams.get('offset') || 0), lim = u.searchParams.has('limit') ? +u.searchParams.get('limit') : out.length;
      return json(200, out.slice(off, off + lim));
    }
    if (name === 'employee_access_state') return json(200, { blocked: false, pin: 'ok', manager: 'none', stopped: false });
    if (name === 'financial_web_receipt') {
      const p = JSON.parse(body || '{}');
      return json(200, receipts.get(p.p_request_id) || { status: 'not-found', request_id: p.p_request_id });
    }
    if (name === 'financial_web_commit') {
      const p = JSON.parse(body || '{}');
      if (receipts.has(p.p_request_id)) return json(200, receipts.get(p.p_request_id));
      // v1107：本番の anon の statement_timeout（3 秒）で取り消されたときと同じ答え（書かない・受け取りも残さない）
      if ((fin.fail[p.p_store] || 0) > 0) { fin.fail[p.p_store]--; fin.failed++; return json(500, { code: '57014', message: 'canceling statement due to statement timeout' }); }
      const keys = Object.keys(p.p_writes || {});
      if (!keys.length || keys.some(k => !FIN_KEYS.has(k) || !k.endsWith('_' + p.p_store))) return json(400, { code: '22023', message: 'financial_guard_invalid' });
      const ix = index('app_state');
      for (const k of keys) {
        const cur = ix.has(k) ? T.app_state[ix.get(k)] : null, exp = p.p_expected ? p.p_expected[k] : undefined;
        const same = exp === null ? !cur : (cur && exp && cur.updated_at === exp.updated_at && JSON.stringify(cur.value) === JSON.stringify(exp.value));
        if (!same) return json(409, { code: '40001', message: 'financial_guard_version_conflict' });
      }
      const versions = {};
      for (const k of keys) {
        const at = finTs(); versions[k] = at;
        if (ix.has(k)) T.app_state[ix.get(k)] = { key: k, value: p.p_writes[k], updated_at: at };
        else { ix.set(k, T.app_state.length); T.app_state.push({ key: k, value: p.p_writes[k], updated_at: at }); }
      }
      const r = { status: 'committed', request_id: p.p_request_id, store_id: p.p_store, action: p.p_action, versions };
      receipts.set(p.p_request_id, r);
      fin.commits++;
      if (fin.drop > 0) { fin.drop--; return { status: 502, body: '' }; }   // 書けたが答えが届かない
      return json(200, r);
    }
    return json(404, { code: 'PGRST202', message: 'Could not find the function' });
  }
  function fn(name, body) {
    let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) { }
    switch (name) {
      case 'auth-pin': return p.action === 'verify' ? (String(p.pin) === '9999' ? json(200, { ok: false }) : json(200, { ok: true, token: 'perf-session' })) : json(200, { ok: true });   // v1127：9999 は「違う PIN」
      case 'emp-private': return json(200, { ok: true, private: {} });
      case 'hyper-worker': { const until = Date.now() + opts.toastDelay; return Object.assign(json(200, { ok: true, saved: 0, rows: [] }), { waitUntil: until, kind: 'toast' }); }
      default: return json(200, { ok: false, error: 'not_configured' });
    }
  }
  return {
    T, fin,
    handle(method, u, headers, body) {
      const m = u.pathname.match(/^\/rest\/v1\/rpc\/([\w-]+)$/); if (m) return rpc(m[1], body, u);
      const t = u.pathname.match(/^\/rest\/v1\/([\w-]+)$/); if (t) return rest(method, t[1], u, headers, body);
      const f = u.pathname.match(/^\/functions\/v1\/([\w-]+)$/); if (f) return fn(f[1], body);
      return json(404, { error: 'nf' });
    }
  };
}
