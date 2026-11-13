// v1139（2b-1）の試験の土台：合成のクラウド（app_state の行・Auth・manager_auth・employees・work-requests の whoami）。
// PostgREST は、アプリと関数 secure-state が使う問い合わせだけ答える偽物。rls を true にすると、公開の鍵（anon）は
// 成長カルテ・賞与のキーの行を読めない・書けない（SQL 20261108090000 と同じ）。rlsCs も true にすると Career Score のキーも（v1140 の SQL 20261109090000）。
// サーバーの鍵（service）は通る。rlsSw を true にすると、公開の鍵はガソリン代の単価・Score管理（v1141 の SQL 20261110090000）を読めるが書けない。
// rlsHr を true にすると、公開の鍵は採用（応募者・不採用ログ）・お悩み相談室の行を読めない・書けない（v1142 の SQL 20261111090000）。stores は店の表。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ssIsKey, csIsKey, swIsKey, hrIsKey, tpIsKey, scIsKey, gbIsKey } from '../../supabase/functions/secure-state/handler.mjs';

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
    rows: new Map(), users: o.users || {}, wrPeople: o.wrPeople || [], fieldLog: o.fieldLog || [], fieldLogMissing: !!o.fieldLogMissing, fieldLogMaxRows: o.fieldLogMaxRows || 0, fieldLogFailAt: o.fieldLogFailAt || 0, mgr: o.mgr || {}, emps: o.emps || [], pins: o.pins || {},
    wrDown: false, wrLive: o.wrLive, wrNoChef: !!o.wrNoChef, ignoreNot: !!o.ignoreNot, indexMissing: !!o.indexMissing, rls: !!o.rls, rlsCs: !!o.rlsCs, rlsSw: !!o.rlsSw, rlsHr: !!o.rlsHr, rlsPii: !!o.rlsPii, rlsTp: !!o.rlsTp, rlsSc: !!o.rlsSc, rlsGb: !!o.rlsGb, stores: o.stores || [], ssHandler: null, ssDown: !!o.ssDown,
    calls: { wr: 0, rest: 0, patch: 0, post: 0, ss: 0, anonSecret: 0, anonCs: 0, anonHr: 0 }, log: [], reads: [], maxRows: o.maxRows || 0, cfg: o.cfg || null,
    actors: [], changeLog: o.changeLog || [], clReads: [],   // v1151：書き込みに付いた x-fp-actor（キー・中身）と、変更の記録（change_log）の偽物
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
      // wrDown：true（＝404）・'503'・'throw'（通信の失敗）・'badjson'（200 で読めない本文）・'nome'（200 で me が無い）
      if (W.wrDown === true || W.wrDown === '404') return new Response('not found', { status: 404 });
      if (W.wrDown === '503') return J({ error: 'pin_check_missing' }, 503);
      if (W.wrDown === 'throw') throw new TypeError('fetch failed');
      if (W.wrDown === 'badjson') return new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (W.wrDown === 'nome') return J({ live: true, fn: 3 });
      const b = JSON.parse(opt.body);
      const me = W.pins[b.pin_session];
      if (!me || me === 'deny') return J({ error: 'unauthorized' }, 401);
      if (me === 'gone') return J({ error: 'forbidden' }, 403);
      // wrLive：ワークセンターを使い始めたか（v1146 の Tip Rate を決める G4・Head Chef）。初めは true。'none'：答えに live が無い
      return J({ me, ...(W.wrLive === 'none' ? {} : { live: W.wrLive === undefined ? true : W.wrLive }), fn: 3, sql: 4 });
    }
    if (p === '/auth/v1/user') {
      const uid = W.users[jwtSub((h.authorization || '').replace(/^Bearer /, ''))];
      return uid ? J({ id: uid }) : J({ msg: 'bad jwt' }, 401);
    }
    const role = h.apikey === SERVICE ? 'service' : h.apikey === ANON ? 'anon' : null;
    assert.ok(role, 'a known key');
    const hide = key => role !== 'service' && ((W.rls && ssIsKey(key)) || (W.rlsCs && csIsKey(key)) || (W.rlsHr && hrIsKey(key)) || (W.rlsPii && key === 'emp_pii') || (W.rlsSc && scIsKey(key)) || (W.rlsGb && gbIsKey(key)));   // rlsPii：v1144 の SQL 20261113090000。rlsSc：v1147 の SQL 20261116090000（Tip の期間の確定・注意ログ）。rlsGb：v1148 の SQL 20261117090000（グレード履歴・賞与の個人設定・G3 の職種）
    const noWrite = key => role !== 'service' && ((W.rlsSw && swIsKey(key)) || (W.rlsTp && tpIsKey(key)));   // v1141：読めるが書けない。rlsTp：v1146 の SQL 20261115090000（Tip Rate・プレップ）
    const anonCount = key => { if (role !== 'anon') return; if (ssIsKey(key)) W.calls.anonSecret++; if (csIsKey(key)) W.calls.anonCs++; if (hrIsKey(key)) W.calls.anonHr++; if (scIsKey(key)) W.calls.anonSc = (W.calls.anonSc || 0) + 1; if (gbIsKey(key)) W.calls.anonGb = (W.calls.anonGb || 0) + 1; };
    W.calls.rest++;
    const q = url.searchParams;
    // v1151：変更の記録（サーバーの鍵でだけ読める）。関数が使う条件だけ答える
    if (p === '/rest/v1/change_log') {
      assert.equal(m, 'GET'); assert.equal(role, 'service');
      W.clReads.push(url.search);
      let out = W.changeLog.slice();
      for (const [k, v] of q.entries()) {
        if (k === 'select' || k === 'order' || k === 'limit') continue;
        if (k === 'last_at' && v.startsWith('gte.')) { const t = Date.parse(v.slice(4)); out = out.filter(r => Date.parse(r.last_at) >= t); continue; }
        if (k === 'at' && v.startsWith('lte.')) { const t = Date.parse(v.slice(4)); out = out.filter(r => Date.parse(r.at) <= t); continue; }
        if (k === 'id' && v.startsWith('lt.')) { const n = Number(v.slice(3)); out = out.filter(r => r.id < n); continue; }
        if (['by_emp', 'src', 'via'].includes(k) && v.startsWith('eq.')) { out = out.filter(r => r[k] === v.slice(3)); continue; }
        if (k === 'key' && v.startsWith('ilike.*') && v.endsWith('*')) { const t = v.slice(7, -1).toLowerCase(); out = out.filter(r => r.key.toLowerCase().includes(t)); continue; }
        throw new Error('change_log filter ' + k + '=' + v);
      }
      assert.equal(q.get('order'), 'id.desc');
      out.sort((x, y) => y.id - x.id);
      return J(out.slice(0, Number(q.get('limit') || out.length)));
    }
    // 試験だけ：書けた直後（答えを返す前）にほかの操作を流す。afterWrite(keys) が Promise を返したら 1 回だけで、終わるまで待つ
    const afterWrite = async keys => { if (!W.afterWrite) return; const v = W.afterWrite(keys); if (v && typeof v.then === 'function') { W.afterWrite = null; await v; } else if (v) W.afterWrite = null; };
    // v1151（Codex #145 6848717787）：まとめての取り込み（supaPullAllMasters）が読む設定の表。試験では空（読めた）
    if (p === '/rest/v1/app_settings' && m === 'GET') return J(W.settings || []);
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
      if (W.mgrDown) return J({ message: 'down' }, 500);
      if (!q.get('user_id')) return J(Object.values(W.mgr).map(m => ({ emp_id: m.emp_id, role: m.role })));
      const r = W.mgr[q.get('user_id').replace(/^eq\./, '')]; return J(r ? [r] : []);
    }
    if (p === '/rest/v1/wr_people') {
      // 本物と同じく、頼まれた列だけ返す（name は NOT NULL：試験で名前を入れていない行は空）
      const sel = (q.get('select') || 'emp_id,role,grade').split(',');
      // v1144（Codex #138 P1-1）：列 chef（SQL 20261113080000）。wrNoChef：その SQL の前（列が無い＝PostgREST は 400）
      if (W.wrPeopleDown) return J({ message: 'down' }, 500);
      if (W.wrNoChef && sel.includes('chef')) return J({ code: '42703', message: 'column wr_people.chef does not exist' }, 400);
      const row = x => ({ emp_id: x.emp_id, name: x.name || '', role: x.role, grade: x.grade, chef: x.chef === true, stores: x.stores || [], am_stores: x.am_stores || [] });
      return J((W.wrPeople || []).filter(x => (!q.get('role') || x.role === q.get('role').replace(/^eq\./, '')) && (!q.get('emp_id') || x.emp_id === q.get('emp_id').replace(/^eq\./, '')))
        .map(x => Object.fromEntries(sel.map(c => [c, row(x)[c]]))));
    }
    if (p === '/rest/v1/employee_field_log') {
      // v1147（Codex #141 P2-2）：社員の変更記録（サーバーだけの表）。fieldLogMissing：表が無い（SQL 20261029090000 の前）
      if (W.fieldLogMissing) return J({ code: 'PGRST205', message: "Could not find the table 'public.employee_field_log'" }, 404);
      const emp = (q.get('emp_id') || '').replace(/^eq\./, ''), f = q.get('field') || '';
      const fs = f.startsWith('in.(') ? splitList(f.slice(4, -1)) : null;
      const sel = (q.get('select') || 'emp_id,field,old_value,new_value,emp_name').split(',');
      // 本物（PostgREST）と同じ：id は足した順（bigserial）・order=id.asc|id.desc・id=gt.・limit・offset・サーバーの 1 回の上限（fieldLogMaxRows＝max-rows）
      W.fieldLogCalls = (W.fieldLogCalls || 0) + 1;
      if (W.fieldLogFailAt && W.fieldLogCalls >= W.fieldLogFailAt) return J({ message: 'down' }, 500);
      let rows = W.fieldLog.map((x, i) => ({ id: x.id == null ? i + 1 : x.id, ...x })).filter(x => x.emp_id === emp && (!fs || fs.includes(x.field)));
      const gt = W.fieldLogIgnoreGt ? null : q.get('id'); if (gt && gt.startsWith('gt.')) rows = rows.filter(x => Number(x.id) > Number(gt.slice(3)));
      rows.sort((x, y) => Number(x.id) - Number(y.id)); if ((q.get('order') || '') === 'id.desc') rows.reverse();
      const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || Infinity), W.fieldLogMaxRows || Infinity);
      return J(rows.slice(off, off + lim).map(x => Object.fromEntries(sel.map(c => [c, x[c] === undefined ? null : x[c]]))));
    }
    if (p === '/rest/v1/stores') {
      if (W.storesDown) return J({ message: 'down' }, 500);
      return J(W.stores.map(x => ({ id: x.id, name: x.name == null ? null : x.name, brand: x.brand == null ? null : x.brand, data: x.data == null ? null : x.data })));
    }
    if (p === '/rest/v1/employees') {
      if (W.empsDown) return J({ message: 'down' }, 500);   // v1147：社員の表を読めない（見られる店を決められない）
      const sel = (q.get('select') || 'id,store').split(',');
      const full = e => ({ id: e.id, name: e.name, store: e.store, support: e.support || [], role: e.role || null, title: e.title || null, status: e.status || '', data: e.data || {} });
      if (q.get('id')) return J(W.emps.filter(e => e.id === q.get('id').replace(/^eq\./, '')).map(e => Object.fromEntries(sel.map(c => [c, full(e)[c]]))));
      return J(W.emps.map(e => Object.fromEntries(sel.map(c => [c, full(e)[c]]))));
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
          anonCount(key);
          out.push({ key, value: JSON.parse(r.value), updated_at: r.updated_at });
        }
        const off = Number(q.get('offset') || 0), lim = Math.min(q.get('limit') ? Number(q.get('limit')) : out.length, W.maxRows || Infinity);   // PostgREST の max-rows
        out = out.slice(off, off + lim);
        const sel = (q.get('select') || 'key,value,updated_at').split(',');
        const res = J(out.map(r => Object.fromEntries(sel.map(c => [c, r[c]]))));
        // 試験だけ：読んだ直後にほかの端末が書く（true を返したら 1 回で終わり）。Promise を返したら 1 回だけで、終わるまで待つ
        // （そのあいだにほかの操作を最後まで流す：Codex #136 6738169923 の順番の再現）
        if (W.afterGet) { const v = W.afterGet(url); if (v && typeof v.then === 'function') { W.afterGet = null; await v; } else if (v) W.afterGet = null; }
        return res;
      }
      if (m === 'POST') {
        W.calls.post++;
        const body = JSON.parse(opt.body);
        const list = Array.isArray(body) ? body : [body];
        if (list.some(b => hide(b.key) || noWrite(b.key))) return J({ code: '42501', message: 'new row violates row-level security policy' }, 401);
        const merge = String(h.prefer || '').includes('merge-duplicates');
        if (!merge && list.some(b => W.rows.has(b.key))) return J({ code: '23505', message: 'duplicate key' }, 409);
        const out = [];
        for (const b of list) {
          anonCount(b.key);
          const at = ts6(b.updated_at ? Date.parse(b.updated_at) : Date.now());
          W.rows.set(b.key, { value: JSON.stringify(b.value), updated_at: at });
          W.log.push(['write', role, b.key]);
          W.actors.push([b.key, h['x-fp-actor'] || null]);
          out.push({ key: b.key, updated_at: at });
        }
        await afterWrite(list.map(b => b.key));
        return String(h.prefer || '').includes('return=representation') ? J(out, 201) : new Response(null, { status: 201 });
      }
      if (m === 'PATCH') {
        W.calls.patch++;
        const b = JSON.parse(opt.body);
        const key = q.get('key').replace(/^eq\./, ''), cond = q.get('updated_at');
        const r = W.rows.get(key);
        if (!r || hide(key) || noWrite(key)) return J([]);
        const ok = cond === 'is.null' ? r.updated_at == null : r.updated_at === cond.replace(/^eq\./, '');
        if (!ok) return J([]);
        anonCount(key);
        const at = ts6(Date.parse(b.updated_at));
        W.rows.set(key, { value: JSON.stringify(b.value), updated_at: at });
        W.log.push(['write', role, key]);
        W.actors.push([key, h['x-fp-actor'] || null]);
        await afterWrite([key]);
        return J([{ key, updated_at: at }]);
      }
    }
    throw new Error('unexpected request ' + m + ' ' + p);
  };
  return W;
}
