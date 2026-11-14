// @ts-nocheck
// google-reviews（v1157）：Supabase の Edge Functions に貼る 1 ファイル。中身は supabase/functions/google-reviews/handler.mjs と index.ts の Deno.serve の行をつないだだけ（鍵は入っていない）。
// Verify JWT は OFF（関数の中で確かめる）。鍵は Supabase の Secrets：GOOGLE_PLACES_API_KEY・GBP_OAUTH_CLIENT_ID／SECRET（無ければ GMAIL_OAUTH_CLIENT_ID／SECRET）。

// google-reviews（v1157・UI案73）：Google の口コミ。仕様：docs/GOOGLE_REVIEWS_V1157_JA.md
// ・Places API（新）：店の総合評価・件数・Google が返す口コミ（最大 5 件）は、見るときにここで取る。Google の決まり
//   （place ID のほかは残してはいけない）に合わせ、残すのは店と place ID だけ（SQL の gr_places）。
// ・Business Profile API：自分の店の口コミ（自分のデータ）を毎日 4:30（ハワイ）に取り、gr_reviews に残す。月はハワイ時間の投稿日。
//   Google の審査が要る。審査が通るまでは「審査待ち」（つなぐことはできる・口コミは取れない）。
// ・だれか：PIN のログインの印（本文の pin_session）を関数 work-requests の whoami に確かめてもらう（PIN を確かめるコードは入れない）。
//   店のタブレット（店舗の PIN）は whoami が断る。決める・つなぐのは GM・CEO だけ。
// ・鍵（Places の API キー・Business Profile の refresh token）は画面にも答えにも出さない。

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^gr_[a-z0-9_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 400)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

export const SCOPES = ['https://www.googleapis.com/auth/business.manage', 'https://www.googleapis.com/auth/userinfo.email'];
const PLACES = 'https://places.googleapis.com/v1';
const BP_ACCT = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const BP_INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1/';
const BP_REV = 'https://mybusiness.googleapis.com/v4/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const MGR = ['ceo', 'gm'];

const E = (code, status) => { const e = new Error(code); e.code = code; e.status = status || 400; e.gr = true; return e; };
const bad = () => E('bad_value', 400);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const STORE = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,30}$/.test(v)) throw bad(); return v; };
const PLACE = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{10,300}$/.test(v)) throw bad(); return v; };
const LOC = v => { if (typeof v !== 'string' || !/^locations\/[0-9]{1,30}$/.test(v)) throw bad(); return v; };
const ACCT = v => { if (typeof v !== 'string' || !/^accounts\/[0-9]{1,30}$/.test(v)) throw bad(); return v; };
const YM = v => { if (typeof v !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) throw bad(); return v; };
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const txt = (v, n) => (typeof v === 'string' ? v.replace(CTRL, '').slice(0, n) : '');
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Text(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
export function b64url(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function pkcePair() {
  const v = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const c = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(v))));
  return { verifier: v, challenge: c };
}
const randomState = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
function keyMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// ハワイ時間の月（YYYY-MM）と、その月の初めの時刻（UTC・ハワイは夏時間なしの -10:00）
export function hstYm(ms) { const d = new Date(ms - 10 * 3600000); return d.toISOString().slice(0, 7); }
export function hstMonthStart(ms) { const ym = hstYm(ms); return Date.parse(ym + '-01T10:00:00Z'); }
// 前の月の初め（初めて取る店は、会議で見る前の月から取る）
export function hstPrevMonthStart(ms) { const [y, m] = hstYm(ms).split('-').map(Number); const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return Date.parse(py + '-' + String(pm).padStart(2, '0') + '-01T10:00:00Z'); }

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const now = deps.now || (() => Date.now());
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const wrUrl = env('GR_WR_URL') || (url + '/functions/v1/work-requests');
  const origins = ['https://funergy-plus.com', ...String(env('GR_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const appUrl = () => env('GR_APP_URL') || origins[0] + '/';
  const redirectUri = () => env('GBP_OAUTH_REDIRECT_URI') || (url + '/functions/v1/google-reviews');
  const client = () => ({ id: env('GBP_OAUTH_CLIENT_ID') || env('GMAIL_OAUTH_CLIENT_ID') || '', secret: env('GBP_OAUTH_CLIENT_SECRET') || env('GMAIL_OAUTH_CLIENT_SECRET') || '' });
  const placesKey = () => env('GOOGLE_PLACES_API_KEY') || '';
  const cache = new Map();   // sha256(印) → { a, exp }（60 秒。同じ印で何度も work-requests を呼ばない）
  const hits = new Map();    // 社員 ID → [時刻…]（Places を取る回数：1 分に 30 回まで。費用の守り）

  // 1 つの要求（本文まで・時間の上限つき。本文が来ないのも時間切れ）
  async function timed(u, init, ms) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(u, { ...init, signal: ac.signal });
      const body = await r.text();
      let j = null; try { j = body ? JSON.parse(body) : null; } catch { j = null; }
      return { ok: r.ok, status: r.status, j };
    } catch { return { ok: false, status: 0, j: null }; }
    finally { clearTimeout(t); }
  }

  // ---- だれか（work-requests の whoami）
  async function actorOf(body) {
    const tok = body.pin_session;
    if (typeof tok !== 'string' || !tok || tok.length > 4000) return { deny: 'none' };
    const h = await sha256Text(tok);
    const c = cache.get(h);
    if (c && c.exp > now()) return c.a;
    let a;
    if (typeof deps.whoami === 'function') {
      try { a = await deps.whoami(tok); } catch { return { err: 'auth_unavailable' }; }
      a = a ? { emp: a.emp, role: a.role, name: a.name || '' } : { deny: 'pin' };
    } else {
      const r = await timed(wrUrl, { method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', pin_session: tok }) }, 8000);
      if (r.status === 401 || r.status === 403) a = { deny: 'pin' };
      else if (!r.ok) return { err: 'auth_unavailable' };   // work-requests が無い・PIN を確かめられない（503）・通信の失敗
      else {
        const me = obj(r.j && r.j.me);
        a = me && typeof me.emp === 'string' && me.emp && me.emp.length <= 64
          ? { emp: me.emp, role: typeof me.role === 'string' ? me.role : '', name: typeof me.name === 'string' ? me.name.slice(0, 120) : '' }
          : { deny: 'pin' };
      }
    }
    if (a && !a.deny && (typeof a.emp !== 'string' || !a.emp)) a = { deny: 'pin' };
    if (cache.size > 300) cache.clear();
    cache.set(h, { a, exp: now() + (a.deny ? 30000 : 60000) });
    return a;
  }
  const who = a => ({ emp: a.emp, name: a.name || '' });
  const mgrOnly = a => { if (!MGR.includes(a.role)) throw E('forbidden', 403); };

  // ---- Places API（新）：見るときに取る（残さない）
  function placesErr(status) {
    if (status === 400) return 'places_bad';
    if (status === 403 || status === 401) return 'places_denied';   // 鍵の制限・API が有効でない
    if (status === 404) return 'place_not_found';
    if (status === 429) return 'places_busy';
    return 'places_failed';
  }
  function rate(a) {
    const t = now(), xs = (hits.get(a.emp) || []).filter(x => t - x < 60000);
    if (xs.length >= 30) throw E('too_many', 429);
    xs.push(t); hits.set(a.emp, xs);
    if (hits.size > 500) hits.clear();
  }
  async function placesNow(a, b) {
    const store = STORE(b.store), key = placesKey();
    if (!key) throw E('places_not_configured', 503);
    const pid = await db.rpc('gr_place_of', { store });
    if (!pid) return { store, linked: false };
    rate(a);
    const r = await timed(PLACES + '/places/' + encodeURIComponent(pid), { headers: { 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews,googleMapsUri' } }, 15000);
    if (!r.ok || !obj(r.j)) throw E(placesErr(r.status), 502);
    const p = r.j;
    const reviews = (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 5).map(x => {
      const t = obj(x.originalText) || obj(x.text) || {}, au = obj(x.authorAttribution) || {};
      const rt = Number(x.rating);
      return { rating: Number.isFinite(rt) ? Math.max(1, Math.min(5, Math.round(rt))) : null, text: txt(t.text, 2000),
        time: typeof x.publishTime === 'string' && Number.isFinite(Date.parse(x.publishTime)) ? x.publishTime : null,
        author: txt(au.displayName, 120), author_uri: typeof au.uri === 'string' && /^https:\/\//.test(au.uri) ? au.uri.slice(0, 500) : '' };
    }).filter(x => x.rating);
    const rating = Number(p.rating), count = Number(p.userRatingCount);
    return { store, linked: true, name: txt(obj(p.displayName) ? p.displayName.text : '', 200), address: txt(p.formattedAddress, 300),
      rating: Number.isFinite(rating) ? Math.round(rating * 10) / 10 : null, count: Number.isInteger(count) ? count : null,
      uri: typeof p.googleMapsUri === 'string' && /^https:\/\//.test(p.googleMapsUri) ? p.googleMapsUri.slice(0, 500) : '',
      reviews, at: new Date(now()).toISOString() };
  }
  async function placesSearch(a, b) {
    mgrOnly(a);
    const key = placesKey();
    if (!key) throw E('places_not_configured', 503);
    const q = txt(b.q, 120).trim();
    if (q.length < 2) throw bad();
    rate(a);
    const r = await timed(PLACES + '/places:searchText', { method: 'POST', headers: { 'X-Goog-Api-Key': key, 'content-type': 'application/json',
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount' },
      body: JSON.stringify({ textQuery: q, maxResultCount: 5 }) }, 15000);
    if (!r.ok || !obj(r.j)) throw E(placesErr(r.status), 502);
    const items = (Array.isArray(r.j.places) ? r.j.places : []).filter(x => typeof x.id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(x.id)).slice(0, 5)
      .map(x => ({ place_id: x.id, name: txt(obj(x.displayName) ? x.displayName.text : '', 200), address: txt(x.formattedAddress, 300),
        rating: Number.isFinite(Number(x.rating)) ? Math.round(Number(x.rating) * 10) / 10 : null,
        count: Number.isInteger(Number(x.userRatingCount)) ? Number(x.userRatingCount) : null }));
    return { items };
  }
  async function placeSet(a, b) {
    mgrOnly(a);
    const store = STORE(b.store);
    const pid = b.place_id === null ? null : PLACE(b.place_id);
    return db.rpc('gr_place_set', { ...who(a), store, place_id: pid });
  }

  // ---- Business Profile：つなぐ
  async function exchange(code, verifier) {
    const c = client();
    const r = await timed(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, code, code_verifier: verifier, redirect_uri: redirectUri(), grant_type: 'authorization_code' }).toString() }, 20000);
    if (!r.ok || !r.j) return { ok: false, error: 'exchange_failed' };
    if (!r.j.refresh_token) return { ok: false, error: 'no_refresh_token' };
    return { ok: true, refresh: r.j.refresh_token, access: r.j.access_token, scopes: String(r.j.scope || '').split(/\s+/).filter(Boolean) };
  }
  async function access() {
    const cr = await db.rpc('gr_bp_creds', {});
    if (!cr || !cr.refresh_token) return { ok: false, error: 'bp_not_connected' };
    const c = client();
    if (!c.id || !c.secret) return { ok: false, error: 'not_configured' };
    const r = await timed(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: cr.refresh_token, grant_type: 'refresh_token' }).toString() }, 20000);
    if (r.ok && r.j && r.j.access_token) return { ok: true, token: r.j.access_token };
    if (r.status === 400 && r.j && /invalid_grant|unauthorized_client/.test(String(r.j.error))) return { ok: false, expired: true, error: 'bp_auth_revoked' };
    return { ok: false, error: 'bp_token_' + r.status };
  }
  async function emailOf(token) {
    const r = await timed('https://oauth2.googleapis.com/tokeninfo', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }).toString() }, 15000);
    return r.ok && r.j && typeof r.j.email === 'string' ? r.j.email.slice(0, 200) : '';
  }
  // Google の審査が通っていないと、Business Profile の API は 403（使えない）か 429（割り当て 0）を返す
  const pendingStatus = s => s === 403 || s === 429;
  async function accounts(token) {
    const r = await timed(BP_ACCT + '?pageSize=20', { headers: { authorization: 'Bearer ' + token } }, 20000);
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, items: (Array.isArray(r.j && r.j.accounts) ? r.j.accounts : []).map(x => x && x.name).filter(n => typeof n === 'string' && /^accounts\/[0-9]{1,30}$/.test(n)).slice(0, 20) };
  }
  async function bpConnect(a) {
    mgrOnly(a);
    const c = client();
    if (!c.id || !c.secret) throw E('not_configured', 503);
    const state = randomState(), pk = await pkcePair();
    await db.rpc('gr_oauth_start', { ...who(a), state_hash: await sha256Text(state), verifier: pk.verifier });
    const p = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state, code_challenge: pk.challenge, code_challenge_method: 'S256' });
    return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString(), redirect_uri: redirectUri() };
  }
  // Google から戻ってきたとき（GET）。鍵は画面に返さず、短い結果だけを付けてアプリへ戻す
  async function bpCallback(u) {
    const back = code => new Response(null, { status: 302, headers: { location: appUrl() + (appUrl().includes('?') ? '&' : '?') + 'google_bp=' + encodeURIComponent(code), 'cache-control': 'no-store' } });
    let taken;
    try { taken = await db.rpc('gr_oauth_take', { state_hash: await sha256Text(u.searchParams.get('state') || '') }); } catch { return back('bad_state'); }
    const code = u.searchParams.get('code');
    if (u.searchParams.get('error') || !code) return back('denied');
    const c = client();
    if (!c.id || !c.secret) return back('not_configured');
    const ex = await exchange(code, taken.verifier);
    if (!ex.ok) return back(ex.error);
    if (!ex.scopes.includes(SCOPES[0])) return back('scope_missing');
    const account = await emailOf(ex.access);
    const ac = await accounts(ex.access);
    const status = ac.ok ? 'ok' : (pendingStatus(ac.status) ? 'pending' : 'error');
    try {
      await db.rpc('gr_bp_save', { refresh_token: ex.refresh, scopes: ex.scopes, account, status, error: ac.ok ? null : 'accounts_' + ac.status,
        emp: taken.emp, name: taken.name });
    } catch { return back('save_failed'); }
    return back(status);
  }
  async function bpLocations(a) {
    mgrOnly(a);
    const t = await access();
    if (!t.ok) { if (t.expired) await db.rpc('gr_bp_mark', { status: 'expired', error: t.error }); throw E(t.error, t.error === 'bp_not_connected' ? 409 : 502); }
    const ac = await accounts(t.token);
    if (!ac.ok) {
      await db.rpc('gr_bp_mark', { status: pendingStatus(ac.status) ? 'pending' : 'error', error: 'accounts_' + ac.status });
      throw E(pendingStatus(ac.status) ? 'bp_pending' : 'bp_failed', 502);
    }
    const items = [];
    for (const acct of ac.items) {
      let token = '';
      for (let i = 0; i < 10; i++) {
        const r = await timed(BP_INFO + acct + '/locations?' + new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100', ...(token ? { pageToken: token } : {}) }).toString(),
          { headers: { authorization: 'Bearer ' + t.token } }, 20000);
        if (!r.ok) {
          await db.rpc('gr_bp_mark', { status: pendingStatus(r.status) ? 'pending' : 'error', error: 'locations_' + r.status });
          throw E(pendingStatus(r.status) ? 'bp_pending' : 'bp_failed', 502);
        }
        for (const l of (Array.isArray(r.j && r.j.locations) ? r.j.locations : [])) {
          if (!l || typeof l.name !== 'string' || !/^locations\/[0-9]{1,30}$/.test(l.name)) continue;
          const ad = obj(l.storefrontAddress) || {};
          items.push({ account: acct, location: l.name, title: txt(l.title, 200),
            address: [...(Array.isArray(ad.addressLines) ? ad.addressLines : []), ad.locality].filter(s => typeof s === 'string' && s).join(', ').slice(0, 300) });
        }
        token = r.j && typeof r.j.nextPageToken === 'string' ? r.j.nextPageToken : '';
        if (!token) break;
      }
    }
    await db.rpc('gr_bp_mark', { status: 'ok', error: null });
    return { items: items.slice(0, 200) };
  }
  async function bpLink(a, b) {
    mgrOnly(a);
    const store = STORE(b.store);
    if (b.location === null) return db.rpc('gr_loc_set', { ...who(a), store, location: null });
    return db.rpc('gr_loc_set', { ...who(a), store, location: LOC(b.location), account: ACCT(b.account), title: txt(b.title, 200) });
  }
  async function bpDisconnect(a) { mgrOnly(a); return db.rpc('gr_bp_disconnect', who(a)); }

  // ---- Business Profile：口コミを取る（毎日・GM・CEO の「今すぐ取る」）
  //   新しく直された順に読む。取り終えたとみなす所（since）：初めての店は前の月の初め（ハワイ）、そのあとは最後に取れた時刻の 3 日前。
  //   #151 のレビュー：いつも前の月の初め（ハワイ）までは読む（rec）。そこまで最後まで読めたら、その間に直された・投稿された口コミで
  //   いま Google に無いもの（消されたもの）を消す（gr_reviews_prune）。途中で失敗・ページの上限で止まったときは消さない。
  //   1 回に 1 店 20 ページ＝1,000 件まで。since まで読めなければ synced_at を進めず、次の回に同じところから。
  async function syncAll(kind) {
    const t = await access();
    if (!t.ok) {
      if (t.expired) await db.rpc('gr_bp_mark', { status: 'expired', error: t.error });
      const r = { ok: false, error: t.error, stores: [] };
      if (t.error !== 'bp_not_connected') await db.rpc('gr_run_log', { kind, ok: false, info: { error: t.error } });
      return r;
    }
    const locs = await db.rpc('gr_locs', {});
    const out = [];
    let pending = false;
    for (const l of (Array.isArray(locs) ? locs : [])) {
      const prevStart = hstPrevMonthStart(now());
      const since = l.synced_at ? Date.parse(l.synced_at) - 3 * 86400000 : prevStart;
      const rec = Math.min(since, prevStart);
      let token = '', put = 0, done = false, recDone = false, rating = null, total = null, err = '', pruned = null;
      const names = [];
      for (let i = 0; i < 20; i++) {
        const r = await timed(BP_REV + l.account + '/' + l.location + '/reviews?' + new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(token ? { pageToken: token } : {}) }).toString(),
          { headers: { authorization: 'Bearer ' + t.token } }, 20000);
        if (!r.ok) { err = 'reviews_' + r.status; if (pendingStatus(r.status)) pending = true; break; }
        const j = r.j || {};
        if (i === 0) { const ar = Number(j.averageRating), tc = Number(j.totalReviewCount); rating = Number.isFinite(ar) ? ar : null; total = Number.isInteger(tc) ? tc : null; }
        const items = [];
        let older = false, olderRec = false;
        for (const x of (Array.isArray(j.reviews) ? j.reviews : [])) {
          const st = STARS[x && x.starRating];
          const ct = x && Date.parse(x.createTime), ut1 = x && Date.parse(x.updateTime || x.createTime);
          if (!st || !Number.isFinite(ct) || typeof x.name !== 'string') continue;
          const ut = Number.isFinite(ut1) ? ut1 : ct;
          if (ut < since) older = true;
          if (ut < rec) { olderRec = true; if (ct < rec) continue; }
          names.push(x.name);
          const rv = obj(x.reviewer) || {};
          items.push({ name: x.name, rating: st, comment: txt(x.comment, 6000), reviewer: rv.isAnonymous ? '' : txt(rv.displayName, 200),
            created: new Date(ct).toISOString(), updated: new Date(ut).toISOString(), replied: !!obj(x.reviewReply) });
        }
        token = typeof j.nextPageToken === 'string' ? j.nextPageToken : '';
        const end = !token;
        if (older || end) done = true;
        if (olderRec || end) recDone = true;
        try {
          const res = await db.rpc('gr_reviews_put', { store: l.store, location: l.location, items, done: done && recDone, ...(i === 0 ? { rating, total } : {}),
            ...(l.synced_at ? {} : { from_ym: hstYm(since) }) });
          put += (res && res.put) || 0;
        } catch (e) { err = String(e.message || 'put_failed').split(/[\s:]/)[0].slice(0, 40); break; }
        if (recDone) break;
      }
      if (!err && done && !recDone) {
        // since までは読めた（ページの上限で前の月の初めまでは届かなかった）：取り終えたことにする。消された口コミは今回は見ない
        try { await db.rpc('gr_reviews_put', { store: l.store, location: l.location, items: [], done: true, ...(l.synced_at ? {} : { from_ym: hstYm(since) }) }); }
        catch (e) { err = String(e.message || 'put_failed').split(/[\s:]/)[0].slice(0, 40); }
      }
      if (!err && recDone) {
        try { const pr = await db.rpc('gr_reviews_prune', { store: l.store, location: l.location, since: new Date(rec).toISOString(), names }); pruned = (pr && pr.pruned) || 0; }
        catch (e) { err = 'prune_' + String(e.message || 'failed').split(/[\s:]/)[0].slice(0, 30); }
      }
      if (!done && !err) err = 'too_many_pages';
      out.push({ store: l.store, ok: done && !err, put, ...(pruned != null ? { pruned } : {}), ...(!err && done && !recDone ? { note: 'prune_skipped' } : {}), error: err || undefined });
    }
    const allOk = out.every(x => x.ok);
    await db.rpc('gr_bp_mark', { status: pending ? 'pending' : (allOk ? 'ok' : 'error'), error: allOk ? null : (out.find(x => !x.ok) || {}).error || null, synced: allOk && out.length > 0 });
    await db.rpc('gr_run_log', { kind, ok: allOk, info: { stores: out.map(x => ({ store: x.store, ok: x.ok, put: x.put, pruned: x.pruned, note: x.note, error: x.error })) } });
    return { ok: allOk, stores: out };
  }

  // ---- 読む
  async function status(a) { return db.rpc('gr_status', { mgr: MGR.includes(a.role) }); }
  async function kpi() { return db.rpc('gr_kpi', {}); }
  // #151 のレビュー：200 件ずつ。続きは before（gr_month が返した next）
  const BEFORE = v => { if (v == null) return null; if (!obj(v) || typeof v.c !== 'string' || !Number.isFinite(Date.parse(v.c)) || typeof v.h !== 'string' || !/^[0-9a-f]{32}$/.test(v.h)) throw bad(); return { c: v.c, h: v.h }; };
  async function month(a, b) { const before = BEFORE(b.before); return db.rpc('gr_month', { store: STORE(b.store), ym: YM(b.ym), ...(before ? { before } : {}) }); }

  const ACTIONS = {
    whoami: async a => ({ me: { emp: a.emp, role: a.role, name: a.name }, fn: 1, places: !!placesKey(), oauth: !!(client().id && client().secret) }),
    status: a => status(a), kpi: () => kpi(), month: (a, b) => month(a, b),
    places_now: (a, b) => placesNow(a, b), places_search: (a, b) => placesSearch(a, b), places_set: (a, b) => placeSet(a, b),
    bp_connect: a => bpConnect(a), bp_locations: a => bpLocations(a), bp_link: (a, b) => bpLink(a, b), bp_disconnect: a => bpDisconnect(a),
    sync_now: async a => { mgrOnly(a); return syncAll('manual'); },
  };
  const ERR = { bad_value: 400, forbidden: 403, not_found: 404, conflict: 409, bad_state: 400, too_many: 429, bp_not_connected: 409 };

  return async function handler(req) {
    const origin = req.headers.get('origin');
    const okOrigin = origin && origins.includes(origin) ? origin : null;
    const cors = okOrigin ? { 'access-control-allow-origin': okOrigin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
      if (req.method === 'GET') {
        const u = new URL(req.url);
        if (u.searchParams.has('state')) return await bpCallback(u);
        return json({ error: 'method' }, 405);
      }
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      if (origin && !okOrigin) return json({ error: 'origin' }, 403);
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad_value' }, 400); }
      if (!obj(body)) return json({ error: 'bad_value' }, 400);
      // 毎日の取り込み（cron・鍵）
      if (body.action === 'worker') {
        if (!keyMatches(req.headers.get('x-gr-worker-key') || '', String(await db.rpc('gr_worker_key', {}) || ''))) return json({ error: 'unauthorized' }, 401);
        return json(await syncAll('daily'));
      }
      const fn = ACTIONS[body.action];
      if (!fn) return json({ error: 'unknown_action' }, 400);
      const a = await actorOf(body);
      if (a.err) return json({ error: a.err }, 503);
      if (a.deny) return json({ error: 'unauthorized' }, 401);
      return json(await fn(a, body));
    } catch (e) {
      if (e && e.gr) return json({ error: e.code }, e.status);
      const code0 = String((e && e.message) || 'error').split(/[\s:]/)[0];
      if (ERR[code0]) return json({ error: code0 }, ERR[code0]);
      if (/gr_[a-z_]+|function public\.gr_|relation .*gr_/.test(String(e && e.message || '')) || (e && e.status === 404)) return json({ error: 'gr_missing' }, 503);
      console.error('google-reviews', code0.slice(0, 80));
      return json({ error: 'server_error' }, 500);
    }
  };
}

Deno.serve(createHandler({ env: (key) => Deno.env.get(key) }));
