// device-login（v1183・ログインの試し・段階 1）。仕様：docs/DEVICE_LOGIN_V1183_JA.md。
// GM・CEO が選んだ社員だけ：招待の URL（48 時間・1 回だけ）とその人の PIN（auth-pin が確かめる）で端末を登録し、
// そのあとは端末の鍵（取り出せない ECDSA P-256。ここには公開鍵だけ）の署名で PIN なしで入る。
// 入ったときに渡す「ログインの印」は PIN のログインと同じ形（ほかの関数がそのまま確かめる）。印を作る部品（signMark）は
// 公開しない 1 ファイルにだけ入れる（リポジトリの index.ts は null → 印が要る操作は 503 sign_missing）。
// GM・CEO の操作（試す人・招待・端末を外す）はメールのログイン（Supabase Auth）と manager_auth の役割（ceo・gm）。
// v1185（段階 2）：email_login＝GM・CEO・経理が、名前を選んだあとメールとパスワード（Supabase Auth）で入り、PIN のログインと同じ印を受け取る。
//   manager_auth の行が選んだ名前の社員と結ばれていて、役割が ceo・gm・office のときだけ（SQL 20261205090000 の dl_email_login が決める）。
// v1186：login_info＝ログインの画面が GM・CEO・経理に「PIN でログイン」を出すか（PIN のログインを止めたか・SQL 20261206090000 の dl_top_pin_info）。
//   ログインの前に聞く（だれのことでもない・ログイン不要）。SQL がまだなら止めていない（false）。
// アプリが送る名前・役割・社員の ID は使わない。記録に PIN・招待の値・印・鍵の中身は残さない。
// v1189（ログインの段階 3・UI案92）：パスキーのログイン。仕様：docs/PASSKEY_LOGIN_V1189_JA.md。
//   ・GM だけ（2A）が「ログインの方式」で、スタッフを 1 人ずつメール＋パスキーにする（pk_admin_*）。招待は 7 日（4A）。
//   ・招待のリンク → メールの 6 桁のコード → ログイン（このサーバーのログインのあいだ・12 時間・本人の端末は残す＝5B）。
//     本人の端末なら、そのあと Supabase のパスキーを保存（このときだけ Supabase の利用者を作る・ログインはその場で閉じる）。
//   ・「パスキーでログイン」（8A）：端末が Supabase でパスキーを確かめ、その Bearer で pk_login。GM・CEO・経理（manager_auth）は
//     v1185 の email_login と同じ道（アプリが続ける）。ほかはこの表の人だけ。共有の端末はログインしたままにしない（9A）。
//   ・メールは GM の会社の Gmail（mail.mjs）。送り手のアドレスはデータベースだけ。トークンは Google にだけ渡す。
//   ・Supabase の利用者を消すのは、この道で作った利用者（app_metadata.fdl＝pk）だけ。管理者・業務Bot の利用者は触らない。

import { pkcePair, randomState, sha256Text, exchangeCode, refreshAccess } from '../../../invoice/gmail.mjs';
import { mailAuthUrl, mailScopesOk, accountOf, sendRaw, mime, inviteMail, codeMail, changeNoticeMail, maskEmail } from './mail.mjs';

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
  'device_revoked', 'device_expired', 'reauth', 'pin_default', 'not_linked', 'wrong_person', 'not_installed',
  // v1189
  'code_wrong', 'code_gone', 'email_taken', 'bad_email', 'already', 'not_passkey', 'pin_first', 'session_gone', 'mail_failed',
  'mail_not_connected', 'from_not_set', 'wrong_account', 'trial_off', 'bad_state', 'not_configured', 'passkey_server'];
const STATUS = { unauthorized: 401, email_required: 401, forbidden: 403, not_found: 404, not_trial: 403, top_not_allowed: 409, inactive: 403,
  invite_gone: 410, device_gone: 410, device_revoked: 410, device_expired: 410, challenge_gone: 409, too_many: 429, bad_signature: 401,
  pin_wrong: 401, pin_default: 409, locked: 423, pin_server: 503, sign_missing: 503, reauth: 401, bad_value: 400, not_linked: 403, wrong_person: 403, not_installed: 503,
  code_wrong: 401, code_gone: 410, email_taken: 409, bad_email: 400, already: 409, not_passkey: 409, pin_first: 409, session_gone: 401, mail_failed: 502,
  mail_not_connected: 409, from_not_set: 409, wrong_account: 409, trial_off: 410, bad_state: 400, not_configured: 409, passkey_server: 502 };
const err = code => { const e = new Error(code); e.code = code; return e; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const EMP = v => (typeof v === 'string' && /^[A-Za-z0-9_.:@-]{1,64}$/.test(v) ? v : (() => { throw err('bad_value'); })());
const UUID = v => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : (() => { throw err('bad_value'); })());
const TOKEN = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : (() => { throw err('invite_gone'); })());
const PINV = v => { if (typeof v !== 'string') throw err('bad_value'); const x = v.normalize('NFKC').trim(); if (!/^\d{4,8}$/.test(x)) throw err('pin_wrong'); return x; };
const SIG = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{86}$/.test(v) ? v : (() => { throw err('bad_signature'); })());   // 64 バイト（r‖s）
const SESS = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : (() => { throw err('session_gone'); })());
const CODE = v => { if (typeof v !== 'string') throw err('bad_value'); const x = v.normalize('NFKC').replace(/\s+/g, ''); if (!/^\d{6}$/.test(x)) throw err('code_wrong'); return x; };
const EMAILV = v => { if (typeof v !== 'string') throw err('bad_email'); const x = v.normalize('NFKC').trim(); if (x.length > 254 || !/^[^@\s<>"',;()\[\]\\]{1,64}@[^@\s<>"',;()\[\]\\]{1,190}\.[A-Za-z]{2,24}$/.test(x)) throw err('bad_email'); return x; };
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
  const origins = [...new Set(['https://funergy-plus.com', 'capacitor://localhost', ...String(env('DL_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)])];
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


  // ===== v1189：パスキーのログイン =====
  const appUrl = () => env('DL_APP_URL') || (origins[0] + '/');
  const mailRedirect = () => env('DL_MAIL_REDIRECT_URI') || (url + '/functions/v1/device-login');
  const mailClient = () => ({ clientId: env('DL_MAIL_CLIENT_ID') || env('GMAIL_OAUTH_CLIENT_ID') || null, clientSecret: env('DL_MAIL_CLIENT_SECRET') || env('GMAIL_OAUTH_CLIENT_SECRET') || null });
  const svc = { apikey: service, authorization: 'Bearer ' + service, 'content-type': 'application/json' };
  const sbJson = async (path, init) => {
    let r; try { r = await fetch(url + path, { ...init, signal: timeout() }); } catch { return { status: 0, j: null }; }
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { status: r.status, ok: r.ok, j };
  };
  const OURS = u => !!(u && u.app_metadata && u.app_metadata.fdl === 'pk');
  // この道で作った Supabase の利用者（パスワードは無い・メールは確かめ済み）。いつも新しく作る：
  // 同じメールの利用者が残っていれば（前に消せなかった・失効のあと）、この道で作ったものだけ消してから作り直す（前のパスキーを使わせない）
  async function sbEnsure(email, emp) {
    const make = () => sbJson('/auth/v1/admin/users', { method: 'POST', headers: svc, body: JSON.stringify({ email, email_confirm: true, app_metadata: { fdl: 'pk', emp } }) });
    const taken = c => c.status === 422 || c.status === 409 || !!(c.j && /exists|already|registered/i.test(String(c.j.error_code || c.j.code || c.j.msg || c.j.message || '')));
    let c = await make();
    if (c.ok && c.j && typeof c.j.id === 'string') return c.j.id;
    if (!taken(c)) throw err('passkey_server');
    const l = await sbLink(email);
    if (!OURS(l)) throw err('email_taken');   // 管理者・業務Bot など、ほかで使っているメール
    if (!(await sbDelete(l.id))) throw err('passkey_server');
    c = await make();
    if (c.ok && c.j && typeof c.j.id === 'string') return c.j.id;
    throw err(taken(c) ? 'email_taken' : 'passkey_server');
  }
  async function sbLink(email) {
    const g = await sbJson('/auth/v1/admin/generate_link', { method: 'POST', headers: svc, body: JSON.stringify({ type: 'magiclink', email }) });
    if (!g.ok || !g.j || typeof g.j.id !== 'string') throw err('passkey_server');
    return g.j;
  }
  // パスキーを保存するあいだだけの Supabase のログイン（端末はメモリだけ・保存したら閉じる）
  async function sbSession(email, uid) {
    const l = await sbLink(email);
    if (l.id !== uid || !OURS(l)) throw err('email_taken');
    const v = await sbJson('/auth/v1/verify', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ type: l.verification_type || 'magiclink', token_hash: l.hashed_token }) });
    if (!v.ok || !v.j || typeof v.j.access_token !== 'string') throw err('passkey_server');
    return { access_token: v.j.access_token, expires_in: Number(v.j.expires_in) || 3600 };
  }
  // この道で作った利用者だけ消す（パスキーとログインがすべて消える）
  async function sbDelete(uid) {
    if (!uid) return false;
    const u = await sbJson('/auth/v1/admin/users/' + encodeURIComponent(uid), { headers: svc });
    if (u.status === 404) return true;
    if (!u.ok || !OURS(u.j)) { console.error('device-login', 'pk_delete_skip', u.status); return false; }
    const d = await sbJson('/auth/v1/admin/users/' + encodeURIComponent(uid), { method: 'DELETE', headers: svc });
    if (!d.ok && d.status !== 404) console.error('device-login', 'pk_delete_failed', d.status);
    return d.ok || d.status === 404;
  }
  // 保存したパスキー（Supabase の管理の道・その利用者の分だけ）。名前・日時だけ返す
  async function sbKeys(uid) {
    if (!uid) return [];
    const r = await sbJson('/auth/v1/admin/users/' + encodeURIComponent(uid) + '/passkeys', { headers: svc });
    if (!r.ok) throw err('passkey_server');
    const list = Array.isArray(r.j) ? r.j : (r.j && Array.isArray(r.j.passkeys) ? r.j.passkeys : []);
    return list.filter(k => k && typeof k.id === 'string').map(k => ({ id: k.id, name: String(k.friendly_name || k.name || '').slice(0, 80), created_at: k.created_at || null, last_used_at: k.last_used_at || null }));
  }
  async function sbKeyDelete(uid, id) {
    const r = await sbJson('/auth/v1/admin/users/' + encodeURIComponent(uid) + '/passkeys/' + encodeURIComponent(id), { method: 'DELETE', headers: svc });
    if (!r.ok && r.status !== 404) throw err('passkey_server');
    return { ok: true };
  }
  // メールを 1 通（GM の会社の Gmail）。送れたかを返す（投げない）
  async function sendMail(to, m) {
    const g = mailClient();
    if (!g.clientId || !g.clientSecret) return { ok: false, error: 'not_configured' };
    let c = null; try { c = await db.rpc('dl_pk_mail_creds', {}); } catch { c = null; }
    if (!c || !c.from || !c.refresh_token || c.state !== 'ok') return { ok: false, error: 'mail_not_connected' };
    const t = await refreshAccess({ fetch, ...g, refreshToken: c.refresh_token });
    if (!t.ok) { try { await db.rpc('dl_pk_mail_mark', { ok: false, error: t.error, auth: !!t.auth }); } catch { /* 記録できなくても続ける */ } return { ok: false, error: t.auth ? 'mail_not_connected' : t.error }; }
    const r = await sendRaw({ fetch, token: t.token, bytes: mime({ from: c.from, to, subject: m.subject, text: m.text }) });
    try { await db.rpc('dl_pk_mail_mark', r.ok ? { ok: true } : { ok: false, error: r.error, auth: !!r.auth }); } catch { /* 同上 */ }
    return r.ok ? { ok: true } : { ok: false, error: r.auth ? 'mail_not_connected' : r.error };
  }
  async function sendInvite(inv, token, name) {
    const link = appUrl() + (appUrl().includes('?') ? '&' : '?') + 'pk=' + token;
    const r = await sendMail(inv.to, inviteMail({ name, link, expiresAt: inv.expires_at, purpose: inv.purpose }));
    let person = null;
    try { const x = await db.rpc('dl_pk_invite_sent', { invite_id: inv.invite_id, ok: r.ok, error: r.error || null }); person = x && x.person ? x.person : null; } catch { /* 送り直せる */ }
    return { sent: r.ok, error: r.ok ? null : r.error, person };
  }
  const code6 = () => { const a = new Uint32Array(1); for (;;) { crypto.getRandomValues(a); if (a[0] < 4294000000) return String(a[0] % 1000000).padStart(6, '0'); } };
  // 招待・メール・社員の ID のどれで頼んだか（ログインの画面の 3 つの入口）
  async function codeRef(b) {
    if (b.token != null) return { token_hash: await sha256hex(TOKEN(b.token)) };
    if (b.emp_id != null) return { emp_id: EMP(b.emp_id) };
    if (b.email != null) return { email: EMAILV(b.email) };
    throw err('bad_value');
  }
  async function pkSession(emp_id, ver, via, keep, device_name, w) {
    const tok = randomB64();
    const s = await db.rpc('dl_pk_session_new', { emp_id, ver, token_hash: await sha256hex(tok), via, keep, device_name, ...w });
    const m = await mark(s.emp_id, s.name);
    return { ok: true, emp_id: s.emp_id, name: s.name, session: tok, session_exp: s.expires_at, keep, token: m.token, token_exp: m.exp };
  }
  async function sessionOf(b, mode, w) {
    const s = await db.rpc('dl_pk_session_check', { token_hash: await sha256hex(SESS(b.session)), mode, ...w });
    if (!s || s.state !== 'ok') throw err(s && CODES.includes(s.state) ? s.state : 'session_gone');
    return s;
  }
  // 端末へは返さないもの
  const strip = r => { if (r && typeof r === 'object') { delete r.old_uid; delete r.auth_uid; } return r; };
  async function mailCallback(u) {
    const back = code => new Response(null, { status: 302, headers: { location: appUrl() + (appUrl().includes('?') ? '&' : '?') + 'pkmail=' + encodeURIComponent(code), 'cache-control': 'no-store' } });
    let taken;
    try { taken = await db.rpc('dl_pk_mail_take', { state_hash: await sha256Text(u.searchParams.get('state') || '') }); } catch { return back('bad_state'); }
    const code = u.searchParams.get('code');
    if (u.searchParams.get('error') || !code) return back('denied');
    const g = mailClient();
    if (!g.clientId || !g.clientSecret) return back('not_configured');
    const ex = await exchangeCode({ fetch, ...g, code, verifier: taken.verifier, redirectUri: mailRedirect() });
    if (!ex.ok) return back(ex.error === 'no_refresh_token' ? 'no_refresh_token' : 'exchange_failed');
    if (!mailScopesOk(ex.scopes)) return back('scope_missing');
    const account = await accountOf({ fetch, token: ex.accessToken });
    if (!account) return back('profile_failed');
    try { await db.rpc('dl_pk_mail_save', { account, refresh_token: ex.refreshToken, by: taken.by }); }
    catch (e) { const c = String(e.message || '').split(/[\s:]/)[0]; return back(['wrong_account', 'from_not_set'].includes(c) ? c : 'save_failed'); }
    return back('ok');
  }

  const DEVICE = {
    // v1186：PIN のログインを止めたか（GM・CEO・経理）。人によらない答えだけ返す。SQL がまだ（関数が無い 404）なら止めていない
    login_info: async () => {
      let r;
      try { r = await db.rpc('dl_top_pin_info', {}); }
      catch (e) { if (e && e.status === 404) return { top_pin_off: false }; throw e; }
      const out = { top_pin_off: !!(r && r.top_pin_off === true) };
      // v1189：パスキーのログインが入っているか・メール＋パスキーの人（社員の ID だけ。その人には PIN の段を出さない）。SQL がまだなら足さない
      if (r && r.pk === true) {
        out.pk = true;
        out.pk_emps = Array.isArray(r.pk_emps) ? r.pk_emps.filter(x => typeof x === 'string' && /^[A-Za-z0-9_.:@-]{1,64}$/.test(x)).slice(0, 2000) : [];
      }
      return out;
    },
    // ===== v1189：招待のリンク・メールのコード・ログインのあいだ =====
    pk_invite_peek: async (b) => {
      const g = await db.rpc('dl_pk_invite_get', { token_hash: await sha256hex(TOKEN(b.token)) });
      return g.state === 'ok' ? { state: 'ok', name: g.name, email_masked: g.email_masked, expires_at: g.expires_at, purpose: g.purpose } : { state: g.state };
    },
    // 6 桁のコードをメールで（招待・メール・名前を選んだあと）。メールで頼んだときは、その人がいなくても同じ答え
    pk_code_send: async (b, w) => {
      const ref = await codeRef(b), quiet = !ref.token_hash;
      const code = code6(), salt = randomB64().slice(0, 22);
      let r;
      try { r = await db.rpc('dl_pk_code_new', { ...ref, salt, code_hash: await sha256hex(salt + '|' + code), ...w }); }
      catch (e) { if (quiet && /too_many/.test(String(e.message || ''))) return { state: 'sent' }; throw e; }
      if (r.state === 'quiet') return { state: 'sent' };
      if (r.state === 'wait') return quiet ? { state: 'sent' } : { state: 'wait', retry_after: r.retry_after };
      const m = await sendMail(r.to, codeMail({ name: r.name, code }));
      try { await db.rpc('dl_pk_code_sent', { code_id: r.code_id, ok: m.ok, error: m.error || null }); } catch { /* 送れたコードはそのまま使える */ }
      if (!m.ok) { const e = err('mail_failed'); e.extra = { reason: m.error === 'mail_not_connected' || m.error === 'not_configured' ? m.error : 'send' }; throw e; }
      return { state: 'sent' };
    },
    // コードを確かめてログイン。keep＝本人の端末（12 時間ログインしたまま）。passkey＝このあとパスキーを保存する（本人の端末だけ）
    pk_code_verify: async (b, w) => {
      if (!signMark) throw err('sign_missing');
      const ref = await codeRef(b), code = CODE(b.code), keep = b.keep === true, wantKey = keep && b.passkey === true;
      const name = b.device_name == null ? null : DNAME(b.device_name);
      const g = await db.rpc('dl_pk_code_get', ref);
      if (!g || g.state !== 'ok') throw err('code_gone');
      const r = await db.rpc('dl_pk_code_check', { code_id: g.code_id, code_hash: await sha256hex(g.salt + '|' + code), ...w });
      if (r.state === 'code_wrong') { const e = err('code_wrong'); e.extra = { left: r.left }; throw e; }
      if (r.state !== 'ok') throw err(CODES.includes(r.state) ? r.state : 'code_gone');
      if (r.old_uid) await sbDelete(r.old_uid);   // メールを変えた：前のメールのパスキーとログインを消す
      const out = await pkSession(r.emp_id, r.ver, r.via, keep, name, w);
      if (wantKey) {
        try {
          let uid = r.auth_uid;
          if (!uid) { uid = await sbEnsure(r.email, r.emp_id); await db.rpc('dl_pk_link_uid', { emp_id: r.emp_id, uid, ver: r.ver }); }
          out.supabase = await sbSession(r.email, uid);
        } catch (e) { out.passkey_error = CODES.includes(String(e && (e.code || e.message))) ? String(e.code || e.message) : 'passkey_server'; }
      }
      return out;
    },
    // 開いた（start）・裏で確かめる（refresh）：ログインのあいだ（12 時間）が続いていれば、新しい印
    pk_resume: async (b, w) => {
      if (!signMark) throw err('sign_missing');
      const s = await sessionOf(b, b.mode === 'refresh' ? 'refresh' : 'start', w);
      const m = await mark(s.emp_id, s.name);
      return { ok: true, emp_id: s.emp_id, name: s.name, session_exp: s.expires_at, keep: !!s.keep, token: m.token, token_exp: m.exp };
    },
    pk_logout: async (b, w) => db.rpc('dl_pk_session_end', { token_hash: await sha256hex(SESS(b.session)), ...w }),
    pk_keep: async (b) => { if (typeof b.keep !== 'boolean') throw err('bad_value'); return db.rpc('dl_pk_session_keep', { token_hash: await sha256hex(SESS(b.session)), keep: b.keep }); },
    // マイページ：保存したパスキー（スタッフはログインのあいだで）
    pk_my_keys: async (b, w) => { const s = await sessionOf(b, 'peek', w); return { keys: await sbKeys(s.auth_uid) }; },
    pk_my_key_delete: async (b, w) => {
      const s = await sessionOf(b, 'peek', w);
      if (!s.auth_uid) throw err('not_found');
      const id = UUID(b.id);
      if (!(await sbKeys(s.auth_uid)).some(k => k.id === id)) throw err('not_found');
      return sbKeyDelete(s.auth_uid, id);
    },
    // パスキーを保存するための Supabase のログイン（マイページから・メールのコードを確かめたあと）は pk_code_verify の passkey を使う
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
  // v1185：メールのログイン（a＝Supabase Auth の利用者 ID。メールとパスワードは Supabase Auth が確かめた）
  const EMAIL = {
    email_login: async (a, b, w) => {
      if (!signMark) throw err('sign_missing');   // 印を出せないなら、端末を覚える前・知らせを出す前に止める
      const emp = EMP(b.emp_id), dev = UUID(b.device_id);
      const mode = b.mode === 'refresh' ? 'refresh' : 'start';
      const name = b.device_name == null ? null : DNAME(b.device_name);
      let r;
      try { r = await db.rpc('dl_email_login', { actor: a, emp_id: emp, dev_hash: await sha256hex('fdl-mail1|' + emp + '|' + dev), mode, device_name: name, ...w }); }
      catch (e) { if (e && e.status === 404) throw err('not_installed'); throw e; }   // v1185 の SQL がまだ（PostgREST は関数が無いと 404）
      if (!r || r.state !== 'ok') throw err(r && CODES.includes(r.state) ? r.state : 'error');
      const m = await mark(r.emp_id, r.name);
      return { ok: true, emp_id: r.emp_id, name: r.name, role: r.role, new_device: !!r.new_device, notice: !!r.notice, token: m.token, token_exp: m.exp };
    },
    // v1189：パスキーで入った（端末が Supabase で確かめた Bearer）。GM・CEO・経理は email_login と同じ道（アプリが続ける）
    pk_login: async (a, b, w) => {
      let r;
      try { r = await db.rpc('dl_pk_login', { actor: a, ...w }); }
      catch (e) { if (e && e.status === 404) throw err('not_installed'); throw e; }
      if (r && r.state === 'manager') return { kind: 'manager', emp_id: r.emp_id };
      if (!r || r.state !== 'ok') throw err(r && CODES.includes(r.state) ? r.state : 'not_linked');
      if (!signMark) throw err('sign_missing');
      const out = await pkSession(r.emp_id, r.ver, 'passkey', b.keep === true, b.device_name == null ? null : DNAME(b.device_name), w);
      return { kind: 'staff', ...out };
    },
    pk_keys_added: (a, b, w) => db.rpc('dl_pk_keys_added', { actor: a, ...w }),
    // GM・CEO・経理（メールとパスワード）が自分で足したパスキー：ログインしている本人の分だけ
    pk_mgr_keys: async (a) => ({ keys: await sbKeys(a) }),
    pk_mgr_key_delete: async (a, b) => { const id = UUID(b.id); if (!(await sbKeys(a)).some(k => k.id === id)) throw err('not_found'); return sbKeyDelete(a, id); },
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
    // ===== v1189：GM の「ログインの方式」（SQL が GM だけに通す） =====
    pk_admin_list: (a) => db.rpc('dl_pk_admin_list', { actor: a }),
    pk_admin_detail: async (a, b) => {
      const r = await db.rpc('dl_pk_admin_detail', { actor: a, emp_id: EMP(b.emp_id) });
      let keys = null; try { keys = r.auth_uid ? await sbKeys(r.auth_uid) : []; } catch { keys = null; }   // 読めなくても、ほかは出す
      return { ...strip(r), keys };
    },
    pk_admin_set: async (a, b, w) => {
      if (b.told !== true) throw err('bad_value');
      const token = randomB64();
      const r = await db.rpc('dl_pk_admin_set', { actor: a, emp_id: EMP(b.emp_id), email: EMAILV(b.email), told: true, invite_hash: await sha256hex(token), ...w });
      const mail = await sendInvite(r.invite, token, r.name);
      return { ok: true, name: r.name, person: mail.person || r.person, mail: { sent: mail.sent, error: mail.error } };
    },
    pk_admin_invite: async (a, b, w) => {
      const token = randomB64();
      const r = await db.rpc('dl_pk_admin_invite', { actor: a, emp_id: EMP(b.emp_id), invite_hash: await sha256hex(token), ...w });
      const mail = await sendInvite(r.invite, token, r.name);
      return { ok: true, name: r.name, person: mail.person || r.person, mail: { sent: mail.sent, error: mail.error } };
    },
    pk_admin_invite_revoke: (a, b, w) => db.rpc('dl_pk_admin_invite_revoke', { actor: a, emp_id: EMP(b.emp_id), ...w }),
    pk_admin_email: async (a, b, w) => {
      const before = await db.rpc('dl_pk_admin_detail', { actor: a, emp_id: EMP(b.emp_id) });
      const token = randomB64();
      const r = await db.rpc('dl_pk_admin_email', { actor: a, emp_id: EMP(b.emp_id), email: EMAILV(b.email), invite_hash: await sha256hex(token), ...w });
      if (!r.invite) return { ok: true, name: r.name, person: r.person, mail: null };
      const mail = await sendInvite(r.invite, token, r.name);
      // 確かめが済んだメールを変えるときは、前のメールにも知らせる（届かなくても続ける）
      if (r.invite.purpose === 'email_change' && before && before.person && before.person.email) {
        await sendMail(before.person.email, changeNoticeMail({ name: r.name, newMasked: maskEmail(r.invite.to) }));
      }
      return { ok: true, name: r.name, person: mail.person || r.person, mail: { sent: mail.sent, error: mail.error } };
    },
    pk_admin_revoke: async (a, b, w) => { const r = await db.rpc('dl_pk_admin_revoke', { actor: a, emp_id: EMP(b.emp_id), ...w }); await sbDelete(r.old_uid); return strip(r); },
    // PIN に戻す：アプリが先に auth-pin で新しい PIN を入れてから（pin_set）
    pk_admin_pin: async (a, b, w) => {
      if (b.pin_set !== true) throw err('pin_first');
      const r = await db.rpc('dl_pk_admin_pin', { actor: a, emp_id: EMP(b.emp_id), pin_set: true, ...w });
      await sbDelete(r.old_uid); return strip(r);
    },
    pk_mail_status: (a) => db.rpc('dl_pk_mail_status', { actor: a }),
    // 送り手をつなぐ（GM）：Google のページ。state と PKCE の値はこのサーバーにだけ
    pk_mail_connect: async (a) => {
      const g = mailClient();
      if (!g.clientId || !g.clientSecret) throw err('not_configured');
      const state = randomState(), pk = await pkcePair();
      const st = await db.rpc('dl_pk_mail_start', { actor: a, state_hash: await sha256Text(state), verifier: pk.verifier });
      return { url: mailAuthUrl({ clientId: g.clientId, redirectUri: mailRedirect(), state, challenge: pk.challenge, loginHint: st.from }), redirect_uri: mailRedirect() };
    },
  };

  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const cors = { 'access-control-allow-origin': origins.includes(origin) ? origin : origins[0], 'access-control-allow-headers': 'authorization, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // v1189：Google が「送り手をつなぐ」から戻ってくる（人が開いたページ・鍵なし）。state がすべてを決める
    if (req.method === 'GET') {
      let u = null; try { u = new URL(req.url); } catch { u = null; }
      if (u && u.searchParams.has('state')) { try { return await mailCallback(u); } catch (e) { console.error('device-login', 'mail_cb', safeErr(e)); return json({ error: 'error' }, 500); } }
      return json({ error: 'method' }, 405);
    }
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (origin && !origins.includes(origin)) return json({ error: 'forbidden' }, 403);
    let body;
    try { const t = await req.text(); if (t.length > 20000) return json({ error: 'bad_value' }, 400); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_value' }, 400); }
    if (!obj(body) || typeof body.action !== 'string') return json({ error: 'bad_value' }, 400);
    const xff = String(req.headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
    const w = { ip: (req.headers.get('x-real-ip') || xff[xff.length - 1] || '').slice(0, 64) || null, ua: String(req.headers.get('user-agent') || '').slice(0, 200) || null };
    try {
      if (Object.prototype.hasOwnProperty.call(DEVICE, body.action)) return json(await DEVICE[body.action](body, w) ?? {});
      const own = Object.prototype.hasOwnProperty;
      if (own.call(ADMIN, body.action) || own.call(EMAIL, body.action)) {
        let a;
        try { a = await adminOf(req); } catch { a = null; }
        if (!a) return json({ error: 'email_required' }, 401);
        return json(await (own.call(EMAIL, body.action) ? EMAIL : ADMIN)[body.action](a, body, w) ?? {});
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
