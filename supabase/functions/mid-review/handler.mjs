// mid-review: the 中間レビュー API (private edition for CEO / GM / AM).
// Every call needs a Supabase Auth sign-in; the database (mr_members) decides the role
// and, for an AM, the stores. The browser's own idea of its role is never used.
// Store publication and notices are not available in this edition.

const ROLES = ['ceo', 'gm', 'am'];

export function postgrestDb({ fetch, url, key }) {
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async rpc(name, p) {
      if (!/^mr_[a-z_]+$/.test(name)) throw new Error('bad_rpc');
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify({ p: p ?? {} }) });
      const t = await r.text();
      if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* keep text */ } const e = new Error(String(m).slice(0, 200)); e.status = r.status; throw e; }
      return t ? JSON.parse(t) : null;
    },
  };
}

// Error text that may reach logs: no tokens or keys.
const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer)[^\s]*/gi, '$1:***').slice(0, 200);

// ---------------------------------------------------------------- demo (fictional company, the same data as UI案43)
// Day of the demo month as an ISO date.
const dd = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
export function demoData(ym) {
  const D = d => dd(ym, d);
  const dl = { submit: D(15), reply: D(17), decide: D(19), consult_from: D(20), consult_to: D(22) };
  const k = (act, tgt, unit) => ({ act, tgt, unit });
  const stores = [
    { store_id: 'D1', name: '港町（デモ）', am_name: 'AM 佐藤（デモ）', sort: 1, demo: { pl: { state: 'final', at: D(9) },
      kpi: { sales: k(80800, 82400, '$'), guests: k(3230, 3280), ppa: k(25.02, 25.12, '$'), repeat: k(31.0, 30.0, '%'), fc: k(33.2, 30.5, '%'), labor: k(25.8, 26.0, '%'), drink: k(18.4, 20.0, '%') } } },
    { store_id: 'D2', name: '丘の上（デモ）', am_name: 'AM 佐藤（デモ）', sort: 2, demo: { pl: { state: 'final', at: D(9) },
      kpi: { sales: k(61200, 58500, '$'), guests: k(2450, 2400), ppa: k(24.98, 24.38, '$'), fc: k(29.4, 30.0, '%'), labor: k(25.1, 25.5, '%') } } },
    { store_id: 'D3', name: '駅前（デモ）', am_name: 'AM 佐藤（デモ）', sort: 3, demo: { pl: { state: 'prov', note: '原価は棚卸前' },
      kpi: { sales: k(49800, 56400, '$'), guests: k(1990, 2300), ppa: k(25.03, 24.52, '$'), fc: k(31.2, 31.0, '%'), labor: k(30.4, 27.0, '%') } } },
    { store_id: 'D4', name: '海岸（デモ）', am_name: 'AM Lee（デモ）', sort: 4, demo: { pl: { state: 'final', at: D(9) },
      kpi: { sales: k(70300, 72000, '$'), guests: k(2610, 2870), ppa: k(26.93, 25.09, '$'), fc: k(30.1, 30.5, '%'), labor: k(26.8, null, '%') } } },
    { store_id: 'D5', name: '公園通り（デモ）', am_name: 'AM Lee（デモ）', sort: 5, demo: { pl: { state: 'prov', note: 'PL 未取込' },
      kpi: { sales: { act: null, tgt: 64100, unit: '$', missing: [D(16), D(17)] }, guests: { act: null, tgt: 2560, missing: [D(16), D(17)] }, fc: k(30.9, 31.0, '%'), labor: k(28.6, 27.5, '%') } } },
    { store_id: 'D6', name: '川沿い（デモ）', am_name: null, sort: 6, demo: { pl: { state: 'none' },
      kpi: { sales: k(66500, 65600, '$'), guests: k(2700, 2650), ppa: k(24.63, 24.75, '$'), fc: k(31.5, 30.5, '%'), labor: k(26.2, 26.5, '%') } } },
  ];
  const f = (id, title, owner, due, status, extra = {}) => ({ id, title, owner, due_orig: due, due_now: extra.due_now || due, status, ...extra });
  const snap = (pl, kpiTo) => ({ period: { from: D(1), to: D(kpiTo) }, pl });
  const reviews = [
    { store_id: 'D1', ym, status: 'submitted', next_actor: 'AM 佐藤（デモ）', next_due: D(17), deadlines: dl, submitted_no: 1, submitted_at: `${D(14)}T07:12:00Z`,
      updated_at: `${D(14)}T07:12:00Z`, updated_by: '店長 田中（デモ）',
      body: { reporter: '店長 田中（デモ）', consult: 'yes',
        focus: [f('f1', 'ランチのピークの提供を平均 8 分以内に', '田中', D(15), 'late', { due_now: D(31) }), f('f2', '刺身の廃棄を週 $150 以下に', '小林', D(31), 'ok'), f('f3', 'Google レビューに 48 時間以内に返信', '森', D(15), 'done')],
        issues: [{ id: 'i1', severity: 'watch', title: '原価率が目標より高い', direct: false, urgent: false }] },
      submissions: [{ no: 1, at: `${D(14)}T07:12:00Z`, by: '店長 田中（デモ）', snapshot: snap({ ym: prevYm(ym), state: 'final', at: D(9) }, 13) }] },
    { store_id: 'D2', ym, status: 'done', next_actor: null, next_due: null, deadlines: dl, submitted_no: 1, submitted_at: `${D(13)}T04:00:00Z`, done_at: `${D(16)}T20:00:00Z`,
      updated_at: `${D(16)}T20:00:00Z`, updated_by: 'AM 佐藤（デモ）',
      body: { reporter: '店長 Park（デモ）', consult: 'none', done_reason: '全項目が目標どおり。重点 3 件とも順調。相談なし（確認済み）。',
        focus: [f('f1', '平日ディナーのセット比率 40%', 'Park', D(31), 'ok'), f('f2', '新人 1 名のレジ研修', 'Park', D(20), 'ok'), f('f3', '冷蔵庫の温度記録を毎日', '小川', D(31), 'ok')], issues: [] },
      submissions: [{ no: 1, at: `${D(13)}T04:00:00Z`, by: '店長 Park（デモ）', snapshot: snap({ ym: prevYm(ym), state: 'final', at: D(9) }, 12) }],
      replies: [{ target: 'summary', author_name: 'AM 佐藤（デモ）', author_role: 'am', decision: 'no_action', data: { reason: '全項目が目標どおり。' }, sent_at: `${D(16)}T20:00:00Z` }] },
    { store_id: 'D3', ym, status: 'decision', decision_by: 'both', next_actor: 'GM 山本（デモ）', next_due: D(19), deadlines: dl, submitted_no: 1, submitted_at: `${D(15)}T06:30:00Z`,
      updated_at: `${D(17)}T22:00:00Z`, updated_by: 'AM 佐藤（デモ）',
      body: { reporter: '店長 鈴木（デモ）', consult: 'yes',
        focus: [f('f1', '夜のシフトの穴をなくす', '鈴木', D(15), 'help', { due_now: D(31) }), f('f2', '平日ランチの客数 +10%', '鈴木', D(31), 'late'), f('f3', '食材ロスを毎日記録', '鈴木', D(31), 'ok')],
        issues: [{ id: 'i1', severity: 'high', title: '夜の人手：港町から週 2 回の応援', direct: false, urgent: false },
          { id: 'i2', severity: 'high', title: '求人広告の追加費用', direct: false, urgent: false }] },
      submissions: [{ no: 1, at: `${D(15)}T06:30:00Z`, by: '店長 鈴木（デモ）', snapshot: snap({ ym: prevYm(ym), state: 'prov' }, 14) }],
      replies: [
        { target: 'issue:i1', author_name: 'AM 佐藤（デモ）', author_role: 'am', decision: 'escalate', escalate_to: 'gm',
          data: { title: '夜の人手：港町から週 2 回の応援', due: D(19), severity: 'high', cross_store: true }, sent_at: `${D(17)}T22:00:00Z` },
        { target: 'issue:i2', author_name: 'AM 佐藤（デモ）', author_role: 'am', decision: 'escalate', escalate_to: 'ceo',
          data: { title: '求人広告の追加費用', due: D(22), severity: 'high' }, sent_at: `${D(17)}T22:00:00Z` }] },
    { store_id: 'D4', ym, status: 'followup', next_actor: '店長 Kim（デモ）', next_due: D(19), deadlines: dl, submitted_no: 1, submitted_at: `${D(15)}T03:00:00Z`,
      updated_at: `${D(16)}T19:00:00Z`, updated_by: 'AM Lee（デモ）',
      body: { reporter: '店長 Kim（デモ）', consult: 'yes',
        focus: [f('f1', 'テイクアウトの事前注文を案内', 'Kim', D(20), 'ok'), f('f2', '駐車場の案内板', 'Kim', D(12), 'late', { due_now: D(25) }), f('f3', '朝の仕込みの時間を 30 分短く', '中村', D(31), 'ok')],
        issues: [{ id: 'i1', severity: 'watch', title: '客数 9% 減（店の前の工事）', direct: false, urgent: false }] },
      submissions: [{ no: 1, at: `${D(15)}T03:00:00Z`, by: '店長 Kim（デモ）', snapshot: snap({ ym: prevYm(ym), state: 'final', at: D(9) }, 14) }],
      replies: [{ target: 'issue:i1', author_name: 'AM Lee（デモ）', author_role: 'am', decision: 'followup',
        data: { title: '工事はいつまでか・テイクアウトの割合', due: D(19), severity: 'watch' }, sent_at: `${D(16)}T19:00:00Z` }] },
    { store_id: 'D5', ym, status: 'consult', next_actor: 'AM Lee（デモ）', next_due: D(21), deadlines: dl, submitted_no: 1, submitted_at: `${D(14)}T05:00:00Z`,
      consult: { date: D(21), time: '15:00', minutes: 30, people: ['店長 Garcia（デモ）', 'AM Lee（デモ）'], topics: ['夜のリーダーを誰にするか', '締め作業の分担'] },
      updated_at: `${D(16)}T21:00:00Z`, updated_by: 'AM Lee（デモ）',
      body: { reporter: '店長 Garcia（デモ）', consult: 'yes',
        focus: [f('f1', '夜のリーダーを決める', 'Garcia', D(20), 'help'), f('f2', '週 2 回の在庫チェック', 'Garcia', D(31), 'ok'), f('f3', 'クレームの記録を毎日', '原田', D(31), 'ok')],
        issues: [{ id: 'i1', severity: 'high', title: '夜のリーダーと締め作業', direct: true, urgent: false }] },
      submissions: [{ no: 1, at: `${D(14)}T05:00:00Z`, by: '店長 Garcia（デモ）', snapshot: snap({ ym: prevYm(ym), state: 'prov' }, 13) }],
      replies: [{ target: 'issue:i1', author_name: 'AM Lee（デモ）', author_role: 'am', decision: 'consult',
        data: { title: '夜のリーダーと締め作業（店長が直接話したい）', due: D(21), severity: 'high' }, sent_at: `${D(16)}T21:00:00Z` }] },
    { store_id: 'D6', ym, status: 'draft', next_actor: '店長 Nguyen（デモ）', next_due: D(15), deadlines: dl,
      updated_at: `${D(13)}T02:00:00Z`, updated_by: '店長 Nguyen（デモ）',
      body: { reporter: '店長 Nguyen（デモ）', consult: null, focus: [f('f1', 'ドリンクの提案をメニューに', 'Nguyen', D(31), 'none'), f('f2', '清掃チェック表', 'Nguyen', D(31), 'none')], issues: [] } },
  ];
  return { stores, reviews };
}
function prevYm(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const origins = ['https://funergy-plus.com', ...String(env('MR_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];

  async function actorOf(req) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ' + anon || auth.length > 4000) return null;
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && typeof u.id === 'string' ? u.id : null;
  }

  const str = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));
  const ACTIONS = {
    whoami: a => db.rpc('mr_whoami', { actor: a }),
    list: (a, b) => db.rpc('mr_list', { actor: a, env: str(b.env, 8), ym: str(b.ym, 8) }),
    settings_save: (a, b) => db.rpc('mr_settings_save', { actor: a, key: str(b.key, 20), value: b.value }),
    members_list: a => db.rpc('mr_members_list', { actor: a }),
    stores_save: (a, b) => db.rpc('mr_stores_save', { actor: a, stores: Array.isArray(b.stores) ? b.stores.slice(0, 61).map(s => ({
      store_id: str(s && s.store_id, 30), name: str(s && s.name, 80), am_user: s && s.am_user ? str(s.am_user, 40) : null,
      sort: Number.isInteger(s && s.sort) ? s.sort : 0, active: !(s && s.active === false) })) : null }),
    demo_reset: async a => {
      const w = await db.rpc('mr_whoami', { actor: a });
      const ym = w && w.demo && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(w.demo.ym || '') ? w.demo.ym : '2026-10';
      return db.rpc('mr_demo_reset', { actor: a, ...demoData(ym) });
    },
  };
  const ERR = { forbidden: 403, disabled: 403, actor_required: 401, conflict: 409, not_found: 404, bad_value: 400, bad_key: 400, not_available: 409 };

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin' }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    const json = (v, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 100000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object') return json({ error: 'bad_json' }, 400);
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const actor = await actorOf(req);
      if (!actor) return json({ error: 'unauthorized' }, 401);
      return json(await fn(actor, body));
    } catch (e) {
      const code = String(e.message || 'error').split(/[\s:]/)[0];
      const status = ERR[code] || 500;
      if (status === 500) console.error('mid-review', body && body.action, safeErr(e));
      return json({ error: status === 500 ? 'error' : code }, status);
    }
  };
}
export { ROLES };
