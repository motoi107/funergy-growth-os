// secure-state（v1139・段階 2b の 1 つ目）：成長カルテ・賞与のキーを、公開の鍵（anon）ではなくこの関数を通して読み書きする。
// 仕様：docs/SECURE_STATE_V1139_JA.md。
//
// ・データは今までどおり app_state の行（移さない・書き換えない）。この関数はサーバーの鍵（service role）で読み書きする。
//   公開の鍵で読めなくするのは、全部の端末を v1139 にしたあとの SQL（20261108090000：app_state の RLS）。
// ・だれか：PIN のログインの印（本文の pin_session）を work-requests の whoami に確かめてもらう（PIN を確かめるコードは
//   公開しないので、この関数は持たない）。または、メールのログイン（Authorization の Bearer）＋ manager_auth。
//   PIN の印があればそれを使う（その端末の前にいる人）。役割はサーバーが決める（端末の言う役割・名前は使わない）。
// ・CEO・GM（manager_auth の役割）：全部（full）。今までの画面と同じ（成長カルテ・賞与の画面は GM・CEO だけ）。
// ・それ以外の在籍の人（社員と結ばれた印）：画面が使う形だけ（proj）。
//     growth_karte → 全員の入社日（hireDate）と、本人（AM は担当の店・G4 以上は自分の店の人も）の「次期の目標」（終わっていないもの）
//                    （Career Score の強みのカードの「伸ばしていること」と、グレードの区間の入社日に使う）
//     karte_bonus_config → 査定の四半期（quarter）だけ（Career Score の基準点の四半期）
//   ほかのキーは返さない。書けない。
// ・PIN のログインの印が無い・確かめられない人：何も返さない（401）。

export const SS_KEYS = ['growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra'];
export const SS_PREFIX = ['spl_bonus_q_'];
export const SS_PROJ = ['growth_karte', 'karte_bonus_config'];
export const SS_FULL_ROLES = ['ceo', 'gm'];
const MGR_ROLES = ['ceo', 'gm', 'office', 'office_crew'];
export const SS_PREFIX_RE = /^spl_bonus_q_[0-9A-Za-z_-]{1,40}$/;   // spl_bonus_q_<四半期>（アプリ・SQL と同じ決まり）
export function ssIsKey(k) {
  if (typeof k !== 'string' || !k || k.length > 200) return false;
  if (SS_KEYS.includes(k)) return true;
  return SS_PREFIX_RE.test(k);
}

const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer|pin)[^\s]*/gi, '$1:***').slice(0, 200);
const err = (code, status) => { const e = new Error(code); e.code = code; e.status = status; return e; };
const bad = () => err('bad_value', 400);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x && x.length <= 64) : []);
const te = new TextEncoder();
const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', te.encode(String(s)))); }

// PostgREST の updated_at（小数 0〜6 桁）→ マイクロ秒。読めなければ null（アプリの _tsMicro と同じ）
export function tsMicro(s) {
  if (s == null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(s).trim());
  if (!m) return null;
  let off = m[4] || 'Z';
  if (off !== 'Z' && off !== 'z') { let o = off.replace(':', ''); if (o.length === 3) o += '00'; off = o.slice(0, 3) + ':' + o.slice(3, 5); } else off = 'Z';
  const sec = Date.parse(m[1] + 'T' + m[2] + off);
  if (!Number.isFinite(sec)) return null;
  return sec * 1000 + Number(((m[3] || '') + '000000').slice(0, 6));
}

// ---- 見せる形（proj）
function goalsOf(e) {
  const g = Array.isArray(e && e.goals) ? e.goals : [];
  return g.filter(x => x && typeof x === 'object' && !x.done && String(x.text || '').trim())
    .slice(0, 50).map(x => ({ text: String(x.text).slice(0, 500), due: typeof x.due === 'string' ? x.due.slice(0, 20) : '' }));
}
export function projKarte(v, mayGoals) {
  const out = {};
  const m = obj(v); if (!m) return out;
  for (const [id, e] of Object.entries(m)) {
    if (!obj(e) || id.length > 64 || id.startsWith('__')) continue;
    const p = {};
    if (typeof e.hireDate === 'string' && e.hireDate && e.hireDate.length <= 30) p.hireDate = e.hireDate;
    if (mayGoals(id)) { const g = goalsOf(e); if (g.length) p.goals = g; }
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}
// アプリの kbCfgPlain と同じ読み方（包んだ形 __st は、外側の欄が中より先）
const KB_ST_META = { __st: 1, v: 1, _at: 1, _by: 1, _deleted: 1 };
function kbPlain(r, depth = 0) {
  if (!(obj(r) && r.__st === 1) || depth > 20) return r;
  const top = {}; for (const k of Object.keys(r)) if (!KB_ST_META[k]) top[k] = r[k];
  const inner = kbPlain(r.v, depth + 1);
  return { ...(obj(inner) || {}), ...top };
}
export function projKbCfg(v) {
  const r = obj(kbPlain(v)); if (!r) return {};
  const q = r.quarter;
  return (typeof q === 'string' && q.length <= 20) || (typeof q === 'number' && Number.isFinite(q)) ? { quarter: q } : {};
}
// メールのログインか：Bearer が JWT で role が authenticated（公開の鍵（role anon）・新しい形の鍵（JWT でない）はメールのログインでない）
export function jwtRole(tok) {
  try {
    const p = String(tok).split('.');
    if (p.length !== 3 || p[1].length > 4000) return '';
    const b = p[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '==='.slice((b.length + 3) % 4));
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    return j && typeof j.role === 'string' ? j.role : '';
  } catch { return ''; }
}

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const now = deps.now || (() => Date.now());
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const wrUrl = env('SS_WR_URL') || (url + '/functions/v1/work-requests');
  const origins = ['https://funergy-plus.com', ...String(env('SS_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const sv = { apikey: service, authorization: 'Bearer ' + service };
  const timeout = (ms = 8000) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const cache = new Map();     // sha256(印) → { a, exp }（60 秒。同じ印で何度も work-requests を呼ばない）
  const fails = new Map();     // 成長カルテの PIN の間違い：社員 ID → [時刻…]

  async function rest(path, opt = {}) {
    const r = await fetch(url + '/rest/v1/' + path, { ...opt, headers: { ...sv, 'content-type': 'application/json', ...(opt.headers || {}) }, signal: timeout(opt.ms || 20000) });
    const t = await r.text();
    if (!r.ok) { const e = err(r.status === 409 ? 'conflict' : 'db', r.status); e.detail = t.slice(0, 200); throw e; }
    return t ? JSON.parse(t) : null;
  }

  // ---- だれか
  async function pinActor(tok) {
    if (typeof tok !== 'string' || !tok || tok.length > 4000) return { deny: 'pin_shape' };
    const h = await sha256(tok);
    const c = cache.get(h);
    if (c && c.exp > now()) return c.a;
    let r;
    try {
      r = await fetch(wrUrl, { method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', pin_session: tok }), signal: timeout() });
    } catch { return { err: 'auth_unavailable' }; }
    if (r.status === 401 || r.status === 403) {
      try { await r.text(); } catch { /* */ }
      const d = { deny: 'pin' };
      cache.set(h, { a: d, exp: now() + 30000 });   // 断られた印も 30 秒覚える（同じ印で何度も work-requests を呼ばない）
      return d;
    }
    if (!r.ok) { try { await r.text(); } catch { /* */ } return { err: 'auth_unavailable' }; }   // work-requests が無い（404）・PIN を確かめられない（503）など
    let j = null; try { j = await r.json(); } catch { return { err: 'auth_unavailable' }; }
    const me = obj(j && j.me);
    if (!me || typeof me.emp !== 'string' || !me.emp || me.emp.length > 64) return { deny: 'pin' };
    const a = { via: 'pin', emp: me.emp, role: typeof me.role === 'string' ? me.role : '', grade: Number.isInteger(me.grade) ? me.grade : 0,
      stores: arr(me.stores), am: arr(me.am_stores) };
    if (cache.size > 500) { for (const [k, v] of cache) if (!(v.exp > now())) cache.delete(k); if (cache.size > 500) cache.clear(); }
    cache.set(h, { a, exp: now() + 60000 });
    return a;
  }
  async function emailActor(auth) {
    let r;
    try { r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal: timeout() }); } catch { return { err: 'auth_unavailable' }; }
    if (!r.ok) { try { await r.text(); } catch { /* */ } return (r.status >= 500 || r.status === 429) ? { err: 'auth_unavailable' } : { deny: 'email' }; }
    let u = null; try { u = await r.json(); } catch { return { deny: 'email' }; }
    const uid = u && typeof u.id === 'string' && /^[0-9a-f-]{36}$/i.test(u.id) ? u.id : null;
    if (!uid) return { deny: 'email' };
    const rows = await rest('manager_auth?user_id=eq.' + encodeURIComponent(uid) + '&select=role,emp_id');
    const m = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!m || !MGR_ROLES.includes(m.role)) return { deny: 'email_role' };
    const emp = m.emp_id == null || m.emp_id === '' ? null : String(m.emp_id);
    if (emp) {
      const es = await rest('employees?id=eq.' + encodeURIComponent(emp) + '&select=status,data');
      const e0 = Array.isArray(es) ? es[0] : null, d = e0 && obj(e0.data) ? e0.data : {};
      // work-requests の wr_emp_out と同じ：表の status・data の status が退職、または OS を止めた人
      if (e0 && (String(e0.status || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true')) return { deny: 'email_out' };
    }
    return { via: 'email', emp, role: m.role, grade: 0, stores: [], am: [] };
  }
  async function actorOf(req, body) {
    const tok = body.pin_session;
    const auth = req.headers.get('authorization') || '';
    const email = auth.startsWith('Bearer ') && auth.length <= 4000 && jwtRole(auth.slice(7)) === 'authenticated';
    // PIN の印がある要求は、その印だけで決める。確かめられない（work-requests の 404・503・通信の失敗・読めない答え）ときも
    // メールのログインへ切り替えない（Codex の P1：共有の端末に GM のメールのログインが残っていると、Crew の PIN の要求が GM の権限になっていた）
    if (tok !== undefined && tok !== null && tok !== '') return await pinActor(tok);
    if (email) return await emailActor(auth);
    return { deny: 'none' };
  }
  const levelOf = a => (SS_FULL_ROLES.includes(a.role) ? 'full' : (a.emp ? 'proj' : 'none'));

  // 目標を見せてよい人：本人。AM は担当の店（と自分の店）、G4 以上は自分の店の人（Career Score の一覧で見られる人）
  async function goalsGate(a) {
    const self = id => id === a.emp;
    self.sig = 's';
    let stores = [];
    if (a.role === 'am') stores = [...new Set([...a.am, ...a.stores])];
    else if (a.role === 'staff' && a.grade >= 4) stores = a.stores;
    if (!stores.length) return self;
    let emps = [], mgr = [], ams = [];
    try { [emps, mgr, ams] = await Promise.all([rest('employees?select=id,store&limit=5000'), rest('manager_auth?select=emp_id&limit=1000'), rest('wr_people?select=emp_id&role=eq.am&limit=1000')]); }
    catch { return self; }
    // 社員の表の店は公開の鍵で書けるので、CEO・GM・経理・事務Crew（manager_auth）と AM（GM・CEO が確かめた写し）の目標は、店を書き換えても見せない
    const top = new Set([...(Array.isArray(mgr) ? mgr : []), ...(Array.isArray(ams) ? ams : [])].map(x => String((x && x.emp_id) || '')).filter(Boolean));
    const ok = new Set((Array.isArray(emps) ? emps : []).filter(e => e && stores.includes(String(e.store || '')) && !top.has(String(e.id))).map(e => String(e.id)));
    const fn = id => self(id) || ok.has(id);
    fn.sig = 'g:' + [...ok].sort().join(',');
    return fn;
  }

  // ---- 行
  const IN = keys => 'in.(' + keys.map(k => '"' + String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
  const SEL_ALL = 'or=' + encodeURIComponent('(key.' + IN(SS_KEYS) + ',' + SS_PREFIX.map(p => 'key.like.' + p + '*').join(',') + ')');
  async function readRows(keys) {
    const q = keys ? 'key=' + encodeURIComponent(IN(keys)) : SEL_ALL;
    const rows = await rest('app_state?select=key,value,updated_at&' + q + '&limit=1000');
    return (Array.isArray(rows) ? rows : []).filter(r => r && ssIsKey(r.key) && r.key !== 'karte_pin');
  }
  // 行の一覧と印（md5）：app_state_index（v1098）があればそれ（サーバーの鍵で呼ぶ）。無ければ null
  // 独立レビュー P2-2：PostgREST は 1 回に返す行に上限（既定 1000）があるので、空のページが来るまで読む
  async function index() {
    try {
      const out = [];
      for (let off = 0, page = 0; page < 100; page++) {
        const rows = await rest('rpc/app_state_index?order=key.asc&limit=1000&offset=' + off, { method: 'POST', body: JSON.stringify({ p_skip_prefix: ['invoice_purchase_', 'lunch_photo_'] }) });
        if (!Array.isArray(rows)) return null;
        if (!rows.length) break;
        off += rows.length;
        for (const r of rows) if (r && ssIsKey(r.key) && r.key !== 'karte_pin' && /^[0-9a-f]{32}$/.test(String(r.h || ''))) out.push({ key: r.key, v: 'h:' + r.h });
        if (page === 99) return null;   // 読み切れない：中身から作る
      }
      return out;
    } catch { return null; }
  }

  async function pull(a, b) {
    const level = levelOf(a);
    if (level === 'none') return { level, index: [], rows: [] };
    const have = obj(b.have) || {};
    if (level === 'full') {
      const idx = await index();
      if (idx) {
        const need = idx.filter(x => have[x.key] !== x.v).map(x => x.key);
        const rows = need.length ? await readRows(need) : [];
        const ver = Object.fromEntries(idx.map(x => [x.key, x.v]));
        return { level, index: idx, rows: rows.map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, v: ver[r.key] || null })).filter(r => r.v) };
      }
      const rows = await readRows(null);
      const out = [];
      for (const r of rows) out.push({ key: r.key, value: r.value, updated_at: r.updated_at, v: 'x:' + await sha256(JSON.stringify(r.value)) });
      return { level, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
    }
    // proj：見せる形にしてから印を付ける。印は元の行の印（md5）と見せる範囲から作り、変わっていなければ行を読まない
    //（成長カルテは大きく、CEO・GM 以外のログインと 10 分ごとの同期のたびに読んでいた：独立レビュー P3）
    const gate = await goalsGate(a);
    const idx = await index();
    if (idx) {
      const pidx = [];
      for (const x of idx) if (SS_PROJ.includes(x.key)) pidx.push({ key: x.key, v: 'p:' + await sha256(x.v + '|' + (x.key === 'growth_karte' ? a.emp + '|' + gate.sig : '')) });
      const need = pidx.filter(x => have[x.key] !== x.v).map(x => x.key);
      const rows = need.length ? await readRows(need) : [];
      const pv = Object.fromEntries(pidx.map(x => [x.key, x.v]));
      return { level, index: pidx, rows: rows.filter(r => pv[r.key]).map(r => ({ key: r.key, value: r.key === 'growth_karte' ? projKarte(r.value, gate) : projKbCfg(r.value), updated_at: r.updated_at, v: pv[r.key] })) };
    }
    const rows = await readRows(SS_PROJ);
    const out = [];
    for (const r of rows) {
      const value = r.key === 'growth_karte' ? projKarte(r.value, gate) : projKbCfg(r.value);
      out.push({ key: r.key, value, updated_at: r.updated_at, v: 'p:' + await sha256(JSON.stringify(value)) });
    }
    return { level, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
  }

  async function get(a, b) {
    const key = b.key;
    if (!ssIsKey(key) || key === 'karte_pin') throw bad();
    const level = levelOf(a);
    if (level === 'none' || (level === 'proj' && !SS_PROJ.includes(key))) throw err('forbidden', 403);
    const rows = await readRows([key]);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    const r = rows[0];
    if (level === 'proj') return { exists: true, value: key === 'growth_karte' ? projKarte(r.value, await goalsGate(a)) : projKbCfg(r.value), updated_at: r.updated_at, proj: true };
    return { exists: true, value: r.value, updated_at: r.updated_at };
  }

  // 書く。expect が無い：今までの upsert と同じ（読んだ行によらず書く）。expect.exists=false：行が無いときだけ。expect.exists=true：updated_at が同じときだけ
  async function put(a, b) {
    const key = b.key;
    if (!ssIsKey(key) || key === 'karte_pin') throw bad();
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    const e = b.expect;
    const pref = { prefer: 'return=representation' };
    if (e === undefined || e === null) {
      const ts = new Date(now()).toISOString();
      const rows = await rest('app_state?select=key,updated_at', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ key, value: b.value, updated_at: ts }) });
      return { ok: true, updated_at: Array.isArray(rows) && rows[0] ? rows[0].updated_at : ts };
    }
    if (!obj(e) || typeof e.exists !== 'boolean') throw bad();
    if (!e.exists) {
      const ts = new Date(now()).toISOString();
      try {
        const rows = await rest('app_state?select=key,updated_at', { method: 'POST', headers: pref, body: JSON.stringify({ key, value: b.value, updated_at: ts }) });
        return { ok: true, updated_at: Array.isArray(rows) && rows[0] ? rows[0].updated_at : ts };
      } catch (x) { if (x.code === 'conflict') throw err('conflict', 409); throw x; }
    }
    const rt = e.updated_at;
    let ts;
    if (rt == null) ts = new Date(now()).toISOString();
    else {
      const base = tsMicro(rt);
      if (base == null) throw bad();
      ts = new Date(Math.max(now(), Math.floor(base / 1000) + 1)).toISOString();   // 読んだ時刻より後の、次のミリ秒の境目以降（アプリの _casTs と同じ）
    }
    const cond = rt == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(String(rt));
    const rows = await rest('app_state?key=eq.' + encodeURIComponent(key) + '&' + cond + '&select=key,updated_at', { method: 'PATCH', headers: pref,
      body: JSON.stringify({ value: b.value, updated_at: ts }) });
    if (!(Array.isArray(rows) && rows.length === 1)) throw err('conflict', 409);
    return { ok: true, updated_at: rows[0].updated_at };
  }

  // ---- 成長カルテの PIN（4 桁）。サーバーで確かめる。値は app_state の karte_pin に、PIN そのものではなく PBKDF2 の印で置く
  //   （前の版の平文の値・行が無いとき（初期値 1234）も確かめられる。合えば印に置き換える）
  const PIN_RE = /^\d{4}$/;
  async function pbkdf2(pin, saltHex, it) {
    const salt = new Uint8Array(saltHex.match(/../g).map(x => parseInt(x, 16)));
    const k = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, 256));
  }
  const same = (x, y) => { if (typeof x !== 'string' || typeof y !== 'string' || x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0; };
  async function pinRow() {
    const rows = await rest('app_state?select=value,updated_at&key=eq.karte_pin');
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  async function pinMatches(row, pin) {
    const v = row ? row.value : null;
    if (v == null || v === '') return same(pin, '1234');                         // 行が無い：今までの初期値
    if (typeof v === 'string' || typeof v === 'number') return same(pin, String(v));   // 前の版の平文
    const o = obj(v);
    if (!o || typeof o.h !== 'string' || typeof o.s !== 'string' || !/^[0-9a-f]{32}$/.test(o.s) || !Number.isInteger(o.it) || o.it < 1000 || o.it > 2000000) return false;
    return same(await pbkdf2(pin, o.s, o.it), o.h);
  }
  async function pinStore(pin, row, by) {
    const s = hex(crypto.getRandomValues(new Uint8Array(16))), it = 150000;
    const value = { h: await pbkdf2(pin, s, it), s, it, at: new Date(now()).toISOString(), by: String(by || '').slice(0, 64) };
    if (row) {
      const cond = row.updated_at == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(String(row.updated_at));
      const base = tsMicro(row.updated_at);
      const ts = new Date(Math.max(now(), base == null ? 0 : Math.floor(base / 1000) + 1)).toISOString();
      const r = await rest('app_state?key=eq.karte_pin&' + cond + '&select=key', { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ value, updated_at: ts }) });
      return Array.isArray(r) && r.length === 1;
    }
    try { await rest('app_state?select=key', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ key: 'karte_pin', value, updated_at: new Date(now()).toISOString() }) }); return true; }
    catch (x) { if (x.code === 'conflict') return false; throw x; }
  }
  function pinGuard(a) {
    const k = String(a.emp || a.role), t = now(), list = (fails.get(k) || []).filter(x => t - x < 10 * 60000);
    fails.set(k, list);
    if (list.length >= 5) throw err('locked', 429);
    return () => { list.push(t); fails.set(k, list); };
  }
  async function pinCheck(a, b) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (typeof b.pin !== 'string' || !PIN_RE.test(b.pin)) return { ok: false };
    const miss = pinGuard(a);
    const row = await pinRow();
    if (!(await pinMatches(row, b.pin))) { miss(); return { ok: false }; }
    fails.delete(String(a.emp || a.role));
    if (!row || !obj(row.value)) { try { await pinStore(b.pin, row, a.emp); } catch { /* 印に置き換えられなくても、合ったことは返す */ } }
    return { ok: true };
  }
  async function pinSet(a, b) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (typeof b.pin !== 'string' || !PIN_RE.test(b.pin) || typeof b.cur !== 'string' || !PIN_RE.test(b.cur)) throw bad();
    const miss = pinGuard(a);
    const row = await pinRow();
    if (!(await pinMatches(row, b.cur))) { miss(); return { ok: false, why: 'cur' }; }
    fails.delete(String(a.emp || a.role));
    if (!(await pinStore(b.pin, row, a.emp))) throw err('conflict', 409);
    return { ok: true };
  }

  const ACTIONS = { pull, get, put, pin_check: pinCheck, pin_set: pinSet };
  const CODES = { forbidden: 403, bad_value: 400, conflict: 409, locked: 429 };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin', fn: 1 }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    // 答えにはいつも fn:1（アプリは fn の無い答え（ゲートウェイの 401・関数が無い 404 など）を「関数が使えない」とみなす）
    const json = (v, s = 200) => new Response(JSON.stringify({ ...v, fn: 1 }), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 8000000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!obj(body)) return json({ error: 'bad_json' }, 400);
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const a = await actorOf(req, body);
      if (a.err) return json({ error: a.err }, 503);
      if (a.deny) { console.warn('secure-state unauthorized', body.action, a.deny); return json({ error: 'unauthorized' }, 401); }
      return json(await fn(a, body));
    } catch (e) {
      const code = e && e.code && CODES[e.code] ? e.code : '';
      if (code) return json({ error: code }, CODES[code]);
      console.error('secure-state', body.action, safeErr(e));
      return json({ error: 'error' }, 500);
    }
  };
}
