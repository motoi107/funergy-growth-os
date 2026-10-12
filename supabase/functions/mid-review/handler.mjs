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
  const D = d => dd(ym, d), P = prevYm(ym);
  const dl = { submit: D(15), reply: D(17), decide: D(19), consult_from: D(20), consult_to: D(22) };
  const k = (act, tgt, unit) => ({ act, tgt, unit });
  // The meeting tab's default thresholds (the screen uses the saved ones; the demo snapshots are made with the defaults).
  const LOWER = { fc: 1, labor: 1 }, YEL = { sales: 95, guests: 95, ppa: 95, repeat: 90, fc: 108, labor: 108, drink: 90, miso: 90, ikura: 90 };
  const judge = (key, act, tgt) => {
    if (!(tgt > 0)) return 'unset'; if (!(act > 0)) return 'missing';
    const r = act / tgt * 100;
    return LOWER[key] ? (r <= 100 ? 'ok' : r <= YEL[key] ? 'warn' : 'miss') : (r >= 100 ? 'ok' : r >= YEL[key] ? 'warn' : 'miss');
  };
  const rows = o => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, { ...v, judge: judge(key, v.act, v.tgt) }]));
  const pl = (state, r, extra = {}) => ({ ym: P, state, ...(state === 'final' ? { at: D(9) } : {}), rows: r ? rows(r) : {}, checked: [], ...extra });
  const stores = [
    { store_id: 'D1', name: '港町（デモ）', am_name: 'AM 佐藤（デモ）', sort: 1, demo: { updated: `${D(18)}T15:40:00Z`,
      pl: pl('final', { sales: k(141200, 145000, '$'), fc: k(32.1, 30.5, '%'), labor: k(26.4, 26.0, '%') }, { checked: ['sales', 'labor'] }),
      kpi: { sales: k(80800, 82400, '$'), guests: k(3230, 3280), ppa: k(25.02, 25.12, '$'), repeat: k(31.0, 30.0, '%'), fc: k(33.2, 30.5, '%'), labor: k(25.8, 26.0, '%'), drink: k(18.4, 20.0, '%') } } },
    { store_id: 'D2', name: '丘の上（デモ）', am_name: 'AM 佐藤（デモ）', sort: 2, demo: { updated: `${D(18)}T15:40:00Z`,
      pl: pl('final', { sales: k(132000, 128000, '$'), fc: k(29.8, 30.0, '%'), labor: k(25.2, 25.5, '%') }),
      kpi: { sales: k(61200, 58500, '$'), guests: k(2450, 2400), ppa: k(24.98, 24.38, '$'), fc: k(29.4, 30.0, '%'), labor: k(25.1, 25.5, '%') } } },
    { store_id: 'D3', name: '駅前（デモ）', am_name: 'AM 佐藤（デモ）', sort: 3, demo: { updated: `${D(18)}T15:40:00Z`,
      pl: pl('prov', { sales: k(51200, 56000, '$'), fc: k(31.0, 31.0, '%'), labor: k(29.5, 27.0, '%') }, { note: '原価は棚卸前' }),
      kpi: { sales: k(49800, 56400, '$'), guests: k(1990, 2300), ppa: k(25.03, 24.52, '$'), fc: k(31.2, 31.0, '%'), labor: k(30.4, 27.0, '%') } } },
    { store_id: 'D4', name: '海岸（デモ）', am_name: 'AM Lee（デモ）', sort: 4, demo: { updated: `${D(18)}T15:40:00Z`,
      pl: pl('final', { sales: k(152000, 150000, '$'), fc: k(30.2, 30.5, '%'), labor: k(26.0, null, '%') }),
      kpi: { sales: k(70300, 72000, '$'), guests: k(2610, 2870), ppa: k(26.93, 25.09, '$'), fc: k(30.1, 30.5, '%'), labor: k(26.8, null, '%') } } },
    { store_id: 'D5', name: '公園通り（デモ）', am_name: 'AM Lee（デモ）', sort: 5, demo: { updated: `${D(18)}T15:40:00Z`,
      pl: pl('prov', { sales: k(118000, 124000, '$'), fc: k(31.2, 31.0, '%'), labor: k(27.9, 27.5, '%') }, { note: 'PL 未取込' }),
      kpi: { sales: { act: null, tgt: 64100, unit: '$', missing: [D(16), D(17)] }, guests: { act: null, tgt: 2560, missing: [D(16), D(17)] }, fc: k(30.9, 31.0, '%'), labor: k(28.6, 27.5, '%') } } },
    { store_id: 'D6', name: '川沿い（デモ）', am_name: null, sort: 6, demo: { updated: `${D(18)}T15:40:00Z`, pl: pl('none', null),
      kpi: { sales: k(66500, 65600, '$'), guests: k(2700, 2650), ppa: k(24.63, 24.75, '$'), fc: k(31.5, 30.5, '%'), labor: k(26.2, 26.5, '%') } } },
  ];
  // Focus items decided at the start of the month (fixed: title, owner, condition and the original due date do not change).
  const f = (id, title, owner, cond, due, status, extra = {}) => ({ id, title, owner, done_cond: cond, due_orig: due, due_now: extra.due_now || due, status, fixed: true,
    note: '', reason: '', next: '', next_owner: '', next_due: '', help_what: '', help_by: '', ...extra });
  const iss = (id, sev, what, extra = {}) => ({ id, what, title: what.slice(0, 80), severity: sev, cause: '', investigating: false, inv_check: '', inv_owner: '', inv_date: '',
    action: '', ask: '', ask_by: '', direct: false, urgent: false, ...extra });
  const snap = (to, kpi, plv) => ({ period: { from: D(1), to: D(to) }, updated: `${D(to + 1)}T15:40:00Z`, kpi: rows(kpi), pl: plv });
  const S = Object.fromEntries(stores.map(s => [s.store_id, s.demo]));
  const sub = (no, at, by, body, sn) => ({ no, at, by, body, snapshot: sn });
  const b1 = { reporter: '店長 田中（デモ）', reporter_role: 'manager', consult: 'yes',
    pl: { fc: { cause: '9/25 からの米の値上げと、9 月前半の刺身の廃棄。', plan: '重点 2（刺身の廃棄）と、相談 1（米）で対応する。' } },
    kpi: { sales: { tags: ['weather'], comment: '雨の 3 日（10/6〜10/8）で客数が落ちた。週末は予算どおり。' }, guests: { tags: ['weather'], comment: '売上と同じ（雨の 3 日）。' },
      repeat: { tags: [], comment: 'スタンプカードの 2 回目が増えた。' }, fc: { tags: ['supply'], comment: '米の値上げ（9/25〜）と盛り付けのばらつき。→ 相談 1' },
      drink: { tags: [], comment: '新しいサワーを 10/20 から出す。' } },
    focus: [f('f1', 'ランチのピーク（11:30〜13:00）の提供を平均 8 分以内に', '田中', '平均 8 分以内が 2 週続く', D(15), 'late', { due_now: D(31),
        reason: '新人 2 名の研修が 1 週遅れた。今は平均 9.6 分。', next: 'ピーク時の配置表を作り直す', next_owner: '田中', next_due: D(20) }),
      f('f2', '刺身の廃棄を週 $150 以下に', '小林', '4 週続けて $150 以下', D(31), 'ok', { note: '先週 $132' }),
      f('f3', 'Google レビューに 48 時間以内に返信', '森', '月末まで全件 48 時間以内', D(15), 'done', { note: '10/1 から全件 48 時間以内' })],
    issues: [iss('i1', 'watch', '原価率が目標より高い：33.5%（10/13 まで・目標 30.5%）。9 月も 32.1%', {
      cause: '9/25 から米の仕入単価が約 12% 上がった（業者の値上げ）。盛り付け量のばらつきもあると見ている。',
      action: '田中：丼の盛り付けを計量して標準化（10/25）', ask: '本部で米の業者を比べてほしい', ask_by: D(24) })] };
  const b2 = { reporter: '店長 Park（デモ）', reporter_role: 'manager', consult: 'none', pl: {}, kpi: {},
    done_reason: '全項目が目標どおり。重点 3 件とも順調。相談なし（確認済み）。',
    focus: [f('f1', '平日ディナーのセット比率 40%', 'Park', 'セット比率 40% 以上が 2 週続く', D(31), 'ok', { note: '今 38%' }),
      f('f2', '新人 1 名のレジ研修', 'Park', 'ひとりでレジ締めができる', D(20), 'ok', { note: 'あと 2 回' }),
      f('f3', '冷蔵庫の温度記録を毎日', '小川', '月末まで記録の抜けなし', D(31), 'ok', {})], issues: [] };
  const b3 = { reporter: '店長 鈴木（デモ）', reporter_role: 'manager', consult: 'yes',
    pl: { sales: { cause: '9 月後半から夜の人手が足りず、21 時以降の席を止めた。', plan: '夜のシフトを埋める（重点 1・相談 1）' },
      labor: { cause: '応援と残業が増えた。', plan: '求人で人を増やす（相談 2）' } },
    kpi: { sales: { tags: ['staff'], comment: '夜の人手が足りず、21 時以降の席を止めた日が 4 日。' }, guests: { tags: ['staff'], comment: '売上と同じ（夜の席を止めた）。' },
      labor: { tags: ['staff'], comment: '応援の人の時間が増えた。人を採れれば下がる。→ 相談 1・2' } },
    focus: [f('f1', '夜のシフトの穴をなくす', '鈴木', '夜の 2 名体制が毎日そろう', D(15), 'help', { due_now: D(31), help_what: '港町から週 2 回の応援がほしい', help_by: D(19) }),
      f('f2', '平日ランチの客数 +10%', '鈴木', '平日ランチの客数が前月より 10% 多い', D(31), 'late', { reason: '夜に人を回していてランチの呼び込みができていない',
        next: 'ランチのチラシを駅で配る', next_owner: '鈴木', next_due: D(24) }),
      f('f3', '食材ロスを毎日記録', '鈴木', '月末まで記録の抜けなし', D(31), 'ok', { note: '毎日記録している' })],
    issues: [iss('i1', 'high', '夜の人手：港町から週 2 回の応援がほしい', { cause: '夜のリーダーが 9 月末で辞め、夜に入れる人が 2 人足りない。',
        action: '鈴木：求人を出す・今いる人のシフトを見直す（10/22）', ask: '11 月まで港町から週 2 回の応援を出してほしい（店舗をまたぐ）', ask_by: D(19) }),
      iss('i2', 'high', '求人広告の追加費用（月 $600）', { cause: '今の求人サイトでは応募が 2 週で 1 件。', action: '鈴木：別のサイトの見積りを取る（10/20）',
        ask: '追加の求人広告費 月 $600 を 2 か月出してよいか', ask_by: D(22) })] };
  const b4 = { reporter: '店長 Kim（デモ）', reporter_role: 'manager', consult: 'yes', pl: {},
    kpi: { guests: { tags: ['other'], comment: '店の前の工事（10/5〜）で歩く人が減った。テイクアウトは増えている。' }, sales: { tags: ['other'], comment: '客数と同じ。客単価は上がっている。' } },
    focus: [f('f1', 'テイクアウトの事前注文を案内', 'Kim', '事前注文が週 20 件', D(20), 'ok', { note: '先週 16 件' }),
      f('f2', '駐車場の案内板', 'Kim', '案内板を店の前に置く', D(12), 'late', { due_now: D(25), reason: '工事で置き場所が決まらない', next: '工事の会社と置き場所を決める', next_owner: 'Kim', next_due: D(21) }),
      f('f3', '朝の仕込みの時間を 30 分短く', '中村', '仕込みが 9:30 までに終わる', D(31), 'ok', {})],
    issues: [iss('i1', 'watch', '客数 9% 減（店の前の工事）', { cause: '10/5 から店の前で工事。いつまでか分からない。', action: 'Kim：テイクアウトの案内を店の前に出す（10/16）', ask: 'なし（様子を見る）' })] };
  const b5 = { reporter: 'Operation Leader 原田（デモ・G3）', reporter_role: 'op_leader', consult: 'yes',
    pl: { sales: { cause: '9 月の後半に雨の日が多かった。', plan: '週末のディナーのセットを出す。' }, fc: { cause: '鶏肉の値上げ。', plan: '仕込みの量を見直す。' },
      labor: { cause: '夜のリーダーがいない日に 2 人で締めている。', plan: '夜のリーダーを決める（相談 1）' } },
    kpi: { labor: { tags: ['staff'], comment: '夜のリーダー不在で締めが長い（→ 相談 1）' } },
    focus: [f('f1', '夜のリーダーを決める', 'Garcia', '夜のリーダーが決まり、締めを任せられる', D(20), 'help', { help_what: '候補 2 人のどちらにするか一緒に決めたい', help_by: D(21) }),
      f('f2', '週 2 回の在庫チェック', 'Garcia', '月末まで週 2 回', D(31), 'ok', {}), f('f3', 'クレームの記録を毎日', '原田', '月末まで記録の抜けなし', D(31), 'ok', {})],
    issues: [iss('i1', 'high', '夜のリーダーと締め作業', { investigating: true, inv_check: '締め作業に何分かかっているか（1 週間）', inv_owner: '原田', inv_date: D(20),
      action: 'Garcia：候補 2 人と面談（10/19）', ask: '夜のリーダーを誰にするか', ask_by: D(21), direct: true })] };
  const b6 = { reporter: '店長 Nguyen（デモ）', reporter_role: 'manager', consult: null, pl: {}, kpi: {},
    focus: [f('f1', 'ドリンクの提案をメニューに', 'Nguyen', 'メニューにおすすめのドリンクを載せる', D(31), 'none'), f('f2', '清掃チェック表', 'Nguyen', '毎日チェック表をつける', D(31), 'none')], issues: [] };
  const reviews = [
    { store_id: 'D1', ym, status: 'submitted', next_actor: 'AM 佐藤（デモ）', next_due: D(17), deadlines: dl, submitted_no: 1, submitted_at: `${D(15)}T07:12:00Z`,
      updated_at: `${D(15)}T07:12:00Z`, updated_by: '店長 田中（デモ）', body: b1,
      submissions: [sub(1, `${D(15)}T07:12:00Z`, '店長 田中（デモ）', b1, snap(13, { sales: k(63450, 65010, '$'), guests: k(2540, 2592), ppa: k(24.98, 25.08, '$'),
        repeat: k(30.8, 30.0, '%'), fc: k(33.5, 30.5, '%'), labor: k(25.9, 26.0, '%'), drink: k(18.1, 20.0, '%') }, S.D1.pl))] },
    { store_id: 'D2', ym, status: 'done', next_actor: null, next_due: null, deadlines: dl, submitted_no: 1, submitted_at: `${D(13)}T22:00:00Z`, done_at: `${D(16)}T20:00:00Z`,
      updated_at: `${D(16)}T20:00:00Z`, updated_by: 'AM 佐藤（デモ）', body: b2,
      submissions: [sub(1, `${D(13)}T22:00:00Z`, '店長 Park（デモ）', b2, snap(12, { sales: k(45300, 44100, '$'), guests: k(1820, 1800), ppa: k(24.89, 24.50, '$'),
        fc: k(29.5, 30.0, '%'), labor: k(25.0, 25.5, '%') }, S.D2.pl))],
      replies: [{ target: 'summary', author_name: 'AM 佐藤（デモ）', author_role: 'am', decision: 'no_action', data: { reason: '全項目が目標どおり。' }, sent_at: `${D(16)}T20:00:00Z` }] },
    { store_id: 'D3', ym, status: 'decision', decision_by: 'both', next_actor: 'GM 山本（デモ）', next_due: D(19), deadlines: dl, submitted_no: 1, submitted_at: `${D(15)}T22:30:00Z`,
      updated_at: `${D(17)}T22:00:00Z`, updated_by: 'AM 佐藤（デモ）', body: b3,
      submissions: [sub(1, `${D(15)}T22:30:00Z`, '店長 鈴木（デモ）', b3, snap(14, { sales: k(41200, 46100, '$'), guests: k(1650, 1880), ppa: k(24.97, 24.52, '$'),
        fc: k(31.0, 31.0, '%'), labor: k(30.8, 27.0, '%') }, S.D3.pl))],
      replies: [
        { target: 'issue:i1', author_name: 'AM 佐藤（デモ）', author_role: 'am', decision: 'escalate', escalate_to: 'gm',
          data: { title: '夜の人手：港町から週 2 回の応援', due: D(19), severity: 'high', cross_store: true, reason: '港町の人を動かすので、店舗をまたぐ。', recommend: '11/15 まで火・金の夜に港町から 1 名。' }, sent_at: `${D(17)}T22:00:00Z` },
        { target: 'issue:i2', author_name: 'AM 佐藤（デモ）', author_role: 'am', decision: 'escalate', escalate_to: 'ceo',
          data: { title: '求人広告の追加費用', due: D(22), severity: 'high', reason: '予算にない費用。', recommend: '2 か月だけ月 $600 を出す。応募が増えなければ止める。' }, sent_at: `${D(17)}T22:00:00Z` }] },
    { store_id: 'D4', ym, status: 'followup', next_actor: '店長 Kim（デモ）', next_due: D(19), deadlines: dl, submitted_no: 1, submitted_at: `${D(16)}T03:00:00Z`,
      updated_at: `${D(16)}T19:00:00Z`, updated_by: 'AM Lee（デモ）', body: b4,
      submissions: [sub(1, `${D(16)}T03:00:00Z`, '店長 Kim（デモ）', b4, snap(14, { sales: k(57100, 58400, '$'), guests: k(2110, 2330), ppa: k(27.06, 25.06, '$'),
        fc: k(30.0, 30.5, '%'), labor: k(26.9, null, '%') }, S.D4.pl))],
      replies: [{ target: 'issue:i1', author_name: 'AM Lee（デモ）', author_role: 'am', decision: 'followup',
        data: { title: '工事はいつまでか・テイクアウトの割合', due: D(19), severity: 'watch', question: '工事はいつまでか分かる？ テイクアウトは売上の何 % まで増えた？' }, sent_at: `${D(16)}T19:00:00Z` }] },
    { store_id: 'D5', ym, status: 'consult', next_actor: 'AM Lee（デモ）', next_due: D(21), deadlines: dl, submitted_no: 1, submitted_at: `${D(15)}T05:00:00Z`,
      consult: { date: D(21), time: '15:00', minutes: 30, people: ['店長 Garcia（デモ）', 'AM Lee（デモ）'], topics: ['夜のリーダーを誰にするか', '締め作業の分担'] },
      updated_at: `${D(16)}T21:00:00Z`, updated_by: 'AM Lee（デモ）', body: b5,
      submissions: [sub(1, `${D(15)}T05:00:00Z`, 'Operation Leader 原田（デモ・G3）', b5, snap(13, { sales: k(45200, 47000, '$'), guests: k(1810, 1880),
        fc: k(31.0, 31.0, '%'), labor: k(28.2, 27.5, '%') }, S.D5.pl))],
      replies: [{ target: 'issue:i1', author_name: 'AM Lee（デモ）', author_role: 'am', decision: 'consult',
        data: { title: '夜のリーダーと締め作業（店長が直接話したい）', due: D(21), severity: 'high' }, sent_at: `${D(16)}T21:00:00Z` }] },
    { store_id: 'D6', ym, status: 'draft', next_actor: '店長 Nguyen（デモ）', next_due: D(15), deadlines: dl,
      updated_at: `${D(13)}T02:00:00Z`, updated_by: '店長 Nguyen（デモ）', body: b6 },
  ];
  return { stores, reviews };
}
function prevYm(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }

// ---------------------------------------------------------------- what a store manager may write (段階 2-2)
// Only these fields are kept, with length limits. Anything else in the request is dropped.
const TX = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n) : '');
const DT = v => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? v : '');
const ID = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
const KEY = /^[a-z]{1,12}$/;
export const KPI_TAGS = ['weather', 'staff', 'supply', 'other', 'checking'];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// What the store manager writes is never cut quietly: too long is refused (the screen stops at the same lengths).
export const LIMITS = { reporter: 80, cause: 600, plan: 600, comment: 400, title: 120, owner: 60, done_cond: 200, note: 300, reason: 400, next: 300,
  next_owner: 60, help_what: 400, what: 160, inv_check: 300, inv_owner: 60, action: 400, ask: 400, answer: 600 };
const TS = (v, n) => { const x = TX(v, 100000); if (x.length > n) { const e = new Error('bad_value'); e.code = 'bad_value'; throw e; } return x; };
const TARGET = /^[a-z]+(:[A-Za-z0-9_-]{1,40})?$/;
export function normBody(b) {
  b = obj(b);
  const TX = TS;
  const out = { reporter: TX(b.reporter, 80), reporter_role: b.reporter_role === 'op_leader' ? 'op_leader' : 'manager',
    consult: b.consult === 'yes' || b.consult === 'none' ? b.consult : null, pl: {}, kpi: {}, focus: [], issues: [] };
  for (const [k, v] of Object.entries(obj(b.pl)).slice(0, 8)) if (KEY.test(k)) out.pl[k] = { cause: TX(obj(v).cause, 600), plan: TX(obj(v).plan, 600) };
  for (const [k, v] of Object.entries(obj(b.kpi)).slice(0, 16)) if (KEY.test(k)) {
    const tags = Array.isArray(obj(v).tags) ? [...new Set(obj(v).tags.filter(x => KPI_TAGS.includes(x)))].slice(0, 5) : [];
    out.kpi[k] = { comment: TX(obj(v).comment, 400), tags };
  }
  const seen = new Set();
  for (const f0 of (Array.isArray(b.focus) ? b.focus : []).slice(0, 6)) {
    const f = obj(f0), id = ID(f.id); if (!id || seen.has(id)) continue; seen.add(id);
    out.focus.push({ id, title: TX(f.title, 120), owner: TX(f.owner, 60), done_cond: TX(f.done_cond, 200), due_orig: DT(f.due_orig), due_now: DT(f.due_now),
      status: ['ok', 'late', 'help', 'done'].includes(f.status) ? f.status : 'none', note: TX(f.note, 300), reason: TX(f.reason, 400), next: TX(f.next, 300),
      next_owner: TX(f.next_owner, 60), next_due: DT(f.next_due), help_what: TX(f.help_what, 400), help_by: DT(f.help_by) });
  }
  // Questions count only when "相談がある" is chosen (switching to "相談はない" drops them).
  for (const x0 of (out.consult === 'yes' && Array.isArray(b.issues) ? b.issues : []).slice(0, 10)) {
    const x = obj(x0), id = ID(x.id); if (!id || seen.has(id)) continue; seen.add(id);
    const what = TX(x.what, 160);
    out.issues.push({ id, what, title: what.slice(0, 80), cause: TX(x.cause, 600), investigating: x.investigating === true, inv_check: TX(x.inv_check, 300),
      inv_owner: TX(x.inv_owner, 60), inv_date: DT(x.inv_date), action: TX(x.action, 400), ask: TX(x.ask, 400), ask_by: DT(x.ask_by),
      severity: ['none', 'watch', 'high'].includes(x.severity) ? x.severity : '', direct: x.direct === true, urgent: x.urgent === true });
  }
  // Answers to the AM's follow-up questions, by what the question was about (e.g. issue:i1).
  const answers = {};
  for (const [k, v] of Object.entries(obj(b.answers)).slice(0, 20)) if (TARGET.test(k) && typeof v === 'string' && v.trim()) answers[k] = TX(v, LIMITS.answer);
  if (Object.keys(answers).length) out.answers = answers;
  return out;
}
// The numbers the reporter saw when submitting (period, update time, PL month and state, each KPI and its judgement).
const NUM = v => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10 ? v : null);
const JUDGE = ['ok', 'warn', 'miss', 'unset', 'missing'];
export function normSnap(sn) {
  sn = obj(sn);
  const row = v => { v = obj(v); return { act: NUM(v.act), tgt: NUM(v.tgt), judge: JUDGE.includes(v.judge) ? v.judge : 'unset', label: TX(v.label, 40), unit: TX(v.unit, 8), money: v.money === true }; };
  const kpi = {}; for (const [k, v] of Object.entries(obj(sn.kpi)).slice(0, 16)) if (KEY.test(k)) kpi[k] = row(v);
  const pl0 = obj(sn.pl), rows = {}; for (const [k, v] of Object.entries(obj(pl0.rows)).slice(0, 8)) if (KEY.test(k)) rows[k] = row(v);
  return { period: { from: DT(obj(sn.period).from), to: DT(obj(sn.period).to) }, updated: TX(sn.updated, 40),
    kpi, pl: { ym: /^\d{4}-(0[1-9]|1[0-2])$/.test(pl0.ym || '') ? pl0.ym : '', state: ['final', 'prov', 'none'].includes(pl0.state) ? pl0.state : 'none',
      at: DT(pl0.at), rows, checked: Array.isArray(pl0.checked) ? pl0.checked.filter(k => typeof k === 'string' && KEY.test(k)).slice(0, 8) : [] } };
}

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const db = deps.db || postgrestDb({ fetch, url, key: service });
  const origins = ['https://funergy-plus.com', ...String(env('MR_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];

  async function actorOf(req) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ' + anon || auth.length > 4000) return null;
    // Do not wait forever for Auth (the request would hang until the platform's own limit).
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal });
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
      sort: Number.isInteger(s && s.sort) && s.sort >= 0 && s.sort <= 9999 ? s.sort : 0, active: !(s && s.active === false) })) : null }),
    get: (a, b) => db.rpc('mr_get', { actor: a, env: str(b.env, 8), ym: str(b.ym, 8), store_id: str(b.store_id, 30) }),
    save: (a, b) => db.rpc('mr_save', { actor: a, env: str(b.env, 8), ym: str(b.ym, 8), store_id: str(b.store_id, 30),
      expect_version: Number.isInteger(b.expect_version) && b.expect_version >= 0 && b.expect_version < 1e6 ? b.expect_version : null, body: normBody(b.body) }),
    submit: (a, b) => db.rpc('mr_submit', { actor: a, env: str(b.env, 8), ym: str(b.ym, 8), store_id: str(b.store_id, 30),
      expect_version: Number.isInteger(b.expect_version) && b.expect_version >= 0 && b.expect_version < 1e6 ? b.expect_version : null, snapshot: normSnap(b.snapshot) }),
    demo_reset: async a => {
      const w = await db.rpc('mr_whoami', { actor: a });
      const ym = w && w.demo && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(w.demo.ym || '') ? w.demo.ym : '2026-10';
      return db.rpc('mr_demo_reset', { actor: a, ...demoData(ym) });
    },
  };
  const ERR = { forbidden: 403, disabled: 403, actor_required: 401, conflict: 409, not_found: 404, bad_value: 400, bad_key: 400, not_available: 409, locked: 409, incomplete: 422, unchanged: 409 };

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
