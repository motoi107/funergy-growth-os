// device-login（v1183・ログインの試し・段階 1）。仕様：docs/DEVICE_LOGIN_V1183_JA.md。
// GM・CEO が選んだ社員だけ：招待の URL（48 時間・1 回だけ）とその人の PIN（auth-pin が確かめる）で端末を登録し、
// そのあとは端末の鍵（取り出せない ECDSA P-256。ここには公開鍵だけ）の署名で PIN なしで入る。
// 入ったときに渡す「ログインの印」は PIN のログインと同じ形（ほかの関数がそのまま確かめる）。印を作る部品（signMark）は
// 公開しない 1 ファイルにだけ入れる（リポジトリの index.ts は null → 印が要る操作は 503 sign_missing）。
// GM・CEO の操作（試す人・招待・端末を外す）はメールのログイン（Supabase Auth）と manager_auth の役割（ceo・gm）。
// アプリが送る名前・役割・社員の ID は使わない。記録に PIN・招待の値・印・鍵の中身は残さない。

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^dl_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 400)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer|pin)[^\s]*/gi, '$1:***').slice(0, 200);
// SQL と関数が返す理由（ほかは error）
export const CODES = ['unauthorized', 'forbidden', 'bad_value', 'not_found', 'not_trial', 'top_not_allowed', 'inactive', 'invite_gone',
  'device_gone', 'challenge_gone', 'too_many', 'bad_signature', 'pin_wrong', 'locked', 'pin_server', 'sign_missing', 'email_required',
  'device_revoked', 'device_expired', 'reauth', 'pin_default'];
const STATUS = { unauthorized: 401, email_required: 401, forbidden: 403, not_found: 404, not_trial: 403, top_not_allowed: 409, inactive: 403,
  invite_gone: 410, device_gone: 410, device_revoked: 410, device_expired: 410, challenge_gone: 409, too_many: 429, bad_signature: 401,
  pin_wrong: 401, pin_default: 409, locked: 423, pin_server: 503, sign_missing: 503, reauth: 401, bad_value: 400 };
const err = code => { const e = new Error(code); e.code = code; return e; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const EMP = v => (typeof v === 'string' && /^[A-Za-z0-9_.:@-]{1,64}$/.test(v) ? v : (() => { throw err('bad_value'); })());
const UUID = v => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : (() => { throw err('bad_value'); })());
const TOKEN = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : (() => { throw err('invite_gone'); })());
const PINV = v => { if (typeof v !== 'string') throw err('bad_value'); const x = v.normalize('NFKC').trim(); if (!/^\d{4,8}$/.test(x)) throw err('pin_wrong'); return x; };
const SIG = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{86}$/.test(v) ? v : (() => { throw err('bad_signature'); })());   // 64 バイト（r‖s）
const DNAME = v => { if (typeof v !== 'string') throw err('bad_value'); const x = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60); if (!x) throw err('bad_value'); return x; };
// 公開鍵：EC P-256 の kty・crv・x・y だけ（ほかの欄・秘密の d は受けない）
const JWK = v => {
  const o = obj(v); if (!o) throw err('bad_value');
  const keys = Object.keys(o).sort().join(',');
  if (keys !== 'crv,kty,x,y' || o.kty !== 'EC' || o.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(o.x) || !/^[A-Za-z0-9_-]{43}$/.test(o.y)) throw err('bad_value');
  return { kty: 'EC', crv: 'P-256', x: o.x, y: o.y };
};
const b64u = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => { let t = s.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; const bin = atob(t); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const sha256hex = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x => x.toString(16).padStart(2, '0')).join('');
// 端末が署名する文（確かめの値・番号・何をするか。ほかの操作に使い回せない）
export const signText = (chalId, nonce, act) => `funergy-dl1|${chalId}|${nonce}|${act}`;
export const MARK_TTL_SEC = 12 * 3600;

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const signMark = typeof deps.signMark === 'function' ? deps.signMark : null;
  const origins = ['https://funergy-plus.com', ...String(env('DL_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined);
  const randomB64 = deps.random || (() => b64u(crypto.getRandomValues(new Uint8Array(32))));

  // その人の PIN（サーバーの auth-pin が確かめる・続けて間違えると auth-pin が止める）
  const pinCheck = typeof deps.pinCheck === 'function' ? deps.pinCheck : async (name, emp, pin) => {
    let r, j = null;
    try {
      r = await fetch(`${url}/functions/v1/auth-pin`, { method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'verify', scope: 'staff', key: name, emp, pin }), signal: timeout() });
      j = await r.json().catch(() => null);
    } catch { return { ok: false, server: true }; }
    // auth-pin は PIN が初期のままの人に印を出さない（v1061）。印が無い ok は「初期の PIN」として登録させない
    if (r.ok && j && j.ok === true) return { ok: true, mark: typeof j.token === 'string' && j.token !== '' };
    if (r.ok && j && j.error === 'locked') return { ok: false, locked: Number(j.retry_after) > 0 ? Number(j.retry_after) : 900 };
    if (r.ok && j && j.error === 'inactive') return { ok: false, inactive: true };
    if (!r.ok || (j && j.error && /db|database|unavailable|timeout|internal/i.test(String(j.error)))) return { ok: false, server: true };
    return { ok: false };
  };

  async function adminOf(req) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ' + anon || auth.length > 4000) return null;
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal: timeout() });
    if (!r.ok) return null;
    const u = await r.json();
    return u && typeof u.id === 'string' ? u.id : null;
  }
  async function mark(emp_id, name) {
    if (!signMark) throw err('sign_missing');
    const iat = Math.floor(Date.now() / 1000);
    const token = await signMark({ emp_id, name, iat, exp: iat + MARK_TTL_SEC });
    if (typeof token !== 'string' || !token) throw err('sign_missing');
    return { token, exp: iat + MARK_TTL_SEC };
  }
  // 確かめの値を使って署名を確かめる。返す：{ device_id, emp_id }
  async function proof(b, act, w) {
    const chal = UUID(b.chal_id), sig = SIG(b.sig);
    const c = await db.rpc('dl_challenge_take', { chal_id: chal });
    let ok = false;
    try {
      const key = await crypto.subtle.importKey('jwk', JWK(c.pubkey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(sig), new TextEncoder().encode(signText(chal, c.nonce, act)));
    } catch { ok = false; }
    if (!ok) {
      await db.rpc('dl_event', { kind: act.split(':')[0], emp_id: c.emp_id, device_id: c.device_id, actor: 'unknown', result: 'bad_signature', ...w });
      throw err('bad_signature');
    }
    return { device_id: c.device_id, emp_id: c.emp_id };
  }
  const authState = async (device_id, mode, w) => {
    const s = await db.rpc('dl_device_auth', { device_id, mode, ...w });
    if (s.state !== 'ok') { const e = err(s.state); e.extra = s.state === 'reauth' ? { name: s.name } : {}; throw e; }
    return s;
  };
  // PIN を確かめる（auth-pin）。間違い・止まっている・サーバーの失敗を分ける
  async function pinOrThrow(name, emp, pin, onWrong) {
    const c = await pinCheck(name, emp, pin);
    if (c.ok && c.mark === false) throw err('pin_default');   // 初期の PIN（だれでも知っている番号）では登録・確かめをしない
    if (c.ok) return;
    if (c.locked) { const e = err('locked'); e.extra = { retry_after: c.locked }; throw e; }
    if (c.inactive) throw err('inactive');
    if (c.server) throw err('pin_server');
    const left = onWrong ? await onWrong() : null;
    const e = err('pin_wrong'); if (left != null) e.extra = { left }; throw e;
  }

  const DEVICE = {
    // 招待を開いた（使わない）。名前は ok のときだけ
    invite_peek: async (b, w) => {
      const h = await sha256hex(TOKEN(b.token));
      const g = await db.rpc('dl_invite_get', { token_hash: h });
      return g.state === 'ok' ? { state: 'ok', name: g.name, expires_at: g.expires_at } : { state: g.state };
    },
    // 招待＋PIN で登録（1 回だけ）
    invite_complete: async (b, w) => {
      if (!signMark) throw err('sign_missing');
      const token = TOKEN(b.token), h = await sha256hex(token), pubkey = JWK(b.pubkey), name = DNAME(b.device_name);
      const pin = PINV(b.pin);
      const replace = b.replace == null ? undefined : (Array.isArray(b.replace) && b.replace.length <= 5 ? b.replace.map(UUID) : (() => { throw err('bad_value'); })());
      const g = await db.rpc('dl_invite_get', { token_hash: h });
      if (g.state !== 'ok') { const e = err('invite_gone'); e.extra = { state: g.state }; throw e; }
      await pinOrThrow(g.name, g.emp_id, pin, async () => (await db.rpc('dl_invite_fail', { token_hash: h, ...w })).left);
      const u = await db.rpc('dl_invite_use', { token_hash: h, pubkey, name, ...(replace ? { replace } : {}), ...w });
      if (u.need_replace) return { need_replace: true, devices: u.devices };
      const m = await mark(u.emp_id, u.name);
      return { ok: true, device_id: u.device_id, emp_id: u.emp_id, name: u.name, expires_at: u.expires_at, token: m.token, token_exp: m.exp };
    },
    // 確かめの値（2 分・1 回）。端末はこれに署名して、次の操作で送る
    challenge: async (b) => {
      const nonce = randomB64();
      const r = await db.rpc('dl_challenge_new', { device_id: UUID(b.device_id), nonce });
      return { chal_id: r.chal_id, nonce };
    },
    // 人が開いた（start）・裏で印を取り替える（refresh）
    start: async (b, w) => {
      if (!signMark) throw err('sign_missing');
      const mode = b.mode === 'refresh' ? 'refresh' : 'start';
      const p = await proof(b, mode, w);
      const s = await authState(p.device_id, mode, w);
      const m = await mark(s.emp_id, s.name);
      return { ok: true, emp_id: s.emp_id, name: s.name, device_name: s.device_name, expires_at: s.expires_at, ask_pin: s.ask_pin, pin_always: !!s.pin_always, token: m.token, token_exp: m.exp };
    },
    // この端末の本人の PIN（ログアウトのあと・30 日開かなかった・開くたびに PIN）
    reauth: async (b, w) => {
      if (!signMark) throw err('sign_missing');
      const pin = PINV(b.pin);
      const p = await proof(b, 'reauth', w);
      const s = await authState(p.device_id, 'reauth', w);
      await pinOrThrow(s.name, s.emp_id, pin, async () => { await db.rpc('dl_event', { kind: 'reauth_pin', emp_id: s.emp_id, device_id: p.device_id, actor: 'device', result: 'fail', ...w }); return null; });
      await db.rpc('dl_device_reauth_ok', { device_id: p.device_id, ...w });
      const m = await mark(s.emp_id, s.name);
      return { ok: true, emp_id: s.emp_id, name: s.name, device_name: s.device_name, expires_at: s.expires_at, ask_pin: s.ask_pin, pin_always: !!s.pin_always, token: m.token, token_exp: m.exp };
    },
    logout: async (b, w) => {
      const scope = b.scope === 'all' ? 'all' : 'this';
      const p = await proof(b, 'logout_' + scope, w);
      return db.rpc('dl_device_logout', { device_id: p.device_id, scope, ...w });
    },
    devices: async (b, w) => {
      const p = await proof(b, 'devices', w);
      await authState(p.device_id, 'peek', w);
      return db.rpc('dl_device_list', { device_id: p.device_id });
    },
    device_revoke: async (b, w) => {
      const target = UUID(b.target);
      const p = await proof(b, 'revoke:' + target, w);
      await authState(p.device_id, 'peek', w);
      return db.rpc('dl_device_revoke_own', { device_id: p.device_id, target, ...w });
    },
    setting: async (b, w) => {
      if (typeof b.ask_pin !== 'boolean') throw err('bad_value');
      const p = await proof(b, 'setting:' + (b.ask_pin ? 'ask_pin' : 'no_pin'), w);
      await authState(p.device_id, 'peek', w);
      return db.rpc('dl_device_setting', { device_id: p.device_id, ask_pin: b.ask_pin });
    },
  };
  const ADMIN = {
    admin_list: (a, b, w) => db.rpc('dl_admin_list', { actor: a }),
    admin_trial: (a, b, w) => { if (typeof b.on !== 'boolean') throw err('bad_value'); return db.rpc('dl_admin_trial', { actor: a, emp_id: EMP(b.emp_id), on: b.on, ...w }); },
    // 招待の URL の値はここで作り、1 回だけ返す（データベースには sha-256 だけ）
    admin_invite: async (a, b, w) => {
      const token = randomB64();
      const r = await db.rpc('dl_admin_invite', { actor: a, emp_id: EMP(b.emp_id), token_hash: await sha256hex(token), ...w });
      return { ...r, token };
    },
    admin_invite_revoke: (a, b, w) => db.rpc('dl_admin_invite_revoke', { actor: a, emp_id: EMP(b.emp_id), ...w }),
    admin_devices: (a, b, w) => db.rpc('dl_admin_devices', { actor: a, emp_id: EMP(b.emp_id) }),
    admin_device_revoke: (a, b, w) => db.rpc('dl_admin_device_revoke', { actor: a, emp_id: EMP(b.emp_id), device_id: b.device_id == null ? null : UUID(b.device_id), ...w }),
  };

  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const cors = { 'access-control-allow-origin': origins.includes(origin) ? origin : origins[0], 'access-control-allow-headers': 'authorization, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (origin && !origins.includes(origin)) return json({ error: 'forbidden' }, 403);
    let body;
    try { const t = await req.text(); if (t.length > 20000) return json({ error: 'bad_value' }, 400); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_value' }, 400); }
    if (!obj(body) || typeof body.action !== 'string') return json({ error: 'bad_value' }, 400);
    const xff = String(req.headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
    const w = { ip: (req.headers.get('x-real-ip') || xff[xff.length - 1] || '').slice(0, 64) || null, ua: String(req.headers.get('user-agent') || '').slice(0, 200) || null };
    try {
      if (Object.prototype.hasOwnProperty.call(DEVICE, body.action)) return json(await DEVICE[body.action](body, w) ?? {});
      if (Object.prototype.hasOwnProperty.call(ADMIN, body.action)) {
        let a;
        try { a = await adminOf(req); } catch { a = null; }
        if (!a) return json({ error: 'email_required' }, 401);
        return json(await ADMIN[body.action](a, body, w) ?? {});
      }
      return json({ error: 'bad_value' }, 400);
    } catch (e) {
      const code = [e && e.code, e && e.message].map(v => String(v || '')).find(v => CODES.includes(v)) || '';
      if (code) return json({ error: code, ...(e.extra || {}) }, STATUS[code] || 400);
      console.error('device-login', body.action, safeErr(e));
      return json({ error: 'error' }, 500);
    }
  };
}
