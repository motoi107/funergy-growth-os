// v1139（2b-1）の試験の土台：合成のクラウド（app_state の行・Auth・manager_auth・employees・work-requests の whoami）。
// PostgREST は、アプリと関数 secure-state が使う問い合わせだけ答える偽物。rls を true にすると、公開の鍵（anon）は
// 成長カルテ・賞与のキーの行を読めない・書けない（SQL 20261108090000 と同じ）。サーバーの鍵（service）は通る。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ssIsKey } from '../../supabase/functions/secure-state/handler.mjs';

export const URL0 = 'https://db.example.test';
export const WR = URL0 + '/functions/v1/work-requests';
export const SS = URL0 + '/functions/v1/secure-state';
export const ANON = 'anon-key', SERVICE = 'service-key';
// メールのログインの印（JWT の形・role は authenticated）。関数は JWT の role でメールのログインかを決める（公開の鍵は role anon）
export const JWT = (name, role = 'authenticated') => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role, sub: name })).toString('base64url') + '.c2ln';
const jwtSub = tok => { try { return JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString('utf8')).sub; } catch { return null; } };
export const ts6 = d => new Date(d).toISOString().replace('Z', '').replace(/\.(\d{3})$/, '.$1000') + '+00:00';

export function makeWorld(o = {}) {
  const W = {
    rows: new Map(), users: o.users || {}, wrPeople: o.wrPeople || [], mgr: o.mgr || {}, emps: o.emps || [], pins: o.pins || {},
    wrDown: false, ignoreNot: !!o.ignoreNot, indexMissing: !!o.indexMissing, rls: !!o.rls, ssHandler: null, ssDown: !!o.ssDown,
    calls: { wr: 0, rest: 0, patch: 0, post: 0, ss: 0, anonSecret: 0 }, log: [], reads: [], maxRows: o.maxRows || 0,
  };
  W.set = (key, value, at) => W.rows.set(key, { value: JSON.stringify(value), updated_at: at || ts6(Date.UTC(2026, 10, 3, 9, 0, 0)) });
  W.get = key => { const r = W.rows.get(key); return r ? JSON.parse(r.value) : undefined; };
  const J = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const unq = s => s.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const splitList = s => { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.map(unq); };
  const one = (f, key) => {
    if (W.ignoreNot && f.startsWith('not.')) return true;   // 「除く」の条件を読まないサーバー（試験だけ）
    if (f.startsWith('eq.')) return key === f.slice(3);
    if (f.startsWith('in.(')) return splitList(f.slice(4, -1)).includes(key);
    if (f.startsWith('not.in.(')) return !splitList(f.slice(8, -1)).includes(key);
    if (f.startsWith('like.')) return key.startsWith(f.slice(5).replace(/\*$/, ''));
    if (f.startsWith('not.like.')) return !key.startsWith(f.slice(9).replace(/\*$/, ''));
    throw new Error('filter ' + f);
  };
  W.fetch = async (u, opt = {}) => {
    const url = new URL(u), p = url.pathname, m = (opt.method || 'GET').toUpperCase();
    const h = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (u.startsWith(SS)) {
      W.calls.ss++;
      if (W.ssDown || !W.ssHandler) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), { status: 404 });
      const res = await W.ssHandler(new Request(u, { method: m, headers: h, body: opt.body }));
      try { W.ssLast = await res.clone().json(); } catch { W.ssLast = null; }
      return res;
    }
    if (u.startsWith(WR)) {
      W.calls.wr++;
      if (W.wrDown) return new Response('not found', { status: 404 });
      const b = JSON.parse(opt.body);
      const me = W.pins[b.pin_session];
      if (!me || me === 'deny') return J({ error: 'unauthorized' }, 401);
      if (me === 'gone') return J({ error: 'forbidden' }, 403);
      return J({ me, live: true, fn: 3, sql: 4 });
    }
    if (p === '/auth/v1/user') {
      const uid = W.users[jwtSub((h.authorization || '').replace(/^Bearer /, ''))];
      return uid ? J({ id: uid }) : J({ msg: 'bad jwt' }, 401);
    }
    const role = h.apikey === SERVICE ? 'service' : h.apikey === ANON ? 'anon' : null;
    assert.ok(role, 'a known key');
    const hide = key => W.rls && role !== 'service' && ssIsKey(key);
    W.calls.rest++;
    const q = url.searchParams;
    if (p === '/rest/v1/rpc/app_state_index') {
      if (W.indexMissing) return J({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      const skip = (JSON.parse(opt.body || '{}').p_skip_prefix || []);
      const out = [...W.rows.entries()].filter(([key]) => !hide(key) && !skip.some(s => s && key.startsWith(s))).sort(([a], [b]) => a < b ? -1 : 1)
        .map(([key, r]) => ({ key, updated_at: r.updated_at, h: crypto.createHash('md5').update(r.value).digest('hex'), n: r.value.length }));
      const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 100000), W.maxRows || Infinity);   // PostgREST の max-rows
      if (W.maxRows && !q.get('order') && (W.idxCalls = (W.idxCalls || 0) + 1) > 1) out.reverse();   // 並びを指定しないと、ページごとに並びが変わりうる（試験では 2 回目から逆に）
      return J(out.slice(off, off + lim));
    }
    if (p === '/rest/v1/manager_auth') {
      if (!q.get('user_id')) return J(Object.values(W.mgr).map(m => ({ emp_id: m.emp_id })));
      const r = W.mgr[q.get('user_id').replace(/^eq\./, '')]; return J(r ? [r] : []);
    }
    if (p === '/rest/v1/wr_people') return J((W.wrPeople || []).filter(x => !q.get('role') || x.role === q.get('role').replace(/^eq\./, '')).map(x => ({ emp_id: x.emp_id })));
    if (p === '/rest/v1/employees') {
      if (q.get('id')) return J(W.emps.filter(e => e.id === q.get('id').replace(/^eq\./, '')).map(e => ({ status: e.status || '', data: e.data || {} })));
      return J(W.emps.map(e => ({ id: e.id, store: e.store })));
    }
    if (p === '/rest/v1/app_state') {
      const keyF = q.getAll('key'), or = q.get('or');
      const match = key => {
        if (!keyF.every(f => one(f, key))) return false;
        if (or) {
          const inner = or.slice(1, -1);
          const inPart = /key\.in\.\(([^)]*)\)/.exec(inner);
          const likes = [...inner.matchAll(/key\.like\.([^,*]*)\*/g)].map(x => x[1]);
          if (!((inPart && splitList(inPart[1]).includes(key)) || likes.some(l => key.startsWith(l)))) return false;
        }
        return true;
      };
      if (m === 'GET') {
        W.reads.push(url.search);
        let out = [];
        for (const [key, r] of [...W.rows.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
          if (!match(key)) continue;
          if (hide(key)) continue;   // RLS：返さない（数えない＝公開の鍵で渡った行だけを数える）
          if (role === 'anon' && ssIsKey(key)) W.calls.anonSecret++;
          out.push({ key, value: JSON.parse(r.value), updated_at: r.updated_at });
        }
        const off = Number(q.get('offset') || 0), lim = q.get('limit') ? Number(q.get('limit')) : out.length;
        out = out.slice(off, off + lim);
        const sel = (q.get('select') || 'key,value,updated_at').split(',');
        return J(out.map(r => Object.fromEntries(sel.map(c => [c, r[c]]))));
      }
      if (m === 'POST') {
        W.calls.post++;
        const body = JSON.parse(opt.body);
        const list = Array.isArray(body) ? body : [body];
        if (list.some(b => hide(b.key))) return J({ code: '42501', message: 'new row violates row-level security policy' }, 401);
        const merge = String(h.prefer || '').includes('merge-duplicates');
        if (!merge && list.some(b => W.rows.has(b.key))) return J({ code: '23505', message: 'duplicate key' }, 409);
        const out = [];
        for (const b of list) {
          if (role === 'anon' && ssIsKey(b.key)) W.calls.anonSecret++;
          const at = ts6(b.updated_at ? Date.parse(b.updated_at) : Date.now());
          W.rows.set(b.key, { value: JSON.stringify(b.value), updated_at: at });
          W.log.push(['write', role, b.key]);
          out.push({ key: b.key, updated_at: at });
        }
        return String(h.prefer || '').includes('return=representation') ? J(out, 201) : new Response(null, { status: 201 });
      }
      if (m === 'PATCH') {
        W.calls.patch++;
        const b = JSON.parse(opt.body);
        const key = q.get('key').replace(/^eq\./, ''), cond = q.get('updated_at');
        const r = W.rows.get(key);
        if (!r || hide(key)) return J([]);
        const ok = cond === 'is.null' ? r.updated_at == null : r.updated_at === cond.replace(/^eq\./, '');
        if (!ok) return J([]);
        if (role === 'anon' && ssIsKey(key)) W.calls.anonSecret++;
        const at = ts6(Date.parse(b.updated_at));
        W.rows.set(key, { value: JSON.stringify(b.value), updated_at: at });
        W.log.push(['write', role, key]);
        return J([{ key, updated_at: at }]);
      }
    }
    throw new Error('unexpected request ' + m + ' ' + p);
  };
  return W;
}
