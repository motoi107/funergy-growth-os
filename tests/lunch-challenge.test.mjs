// v1080 Tenkichi Lunch Challenge (UI案49, Moto 2026-10-14: decisions 1-7 = A).
// Runs the real module from index.html in a VM, with the real day helpers (closures, lunch-off, guests) taken from index.html.
// Synthetic data only. No network, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MOD = html.slice(html.indexOf('/* FUNERGY_LUNCH_CHALLENGE_BEGIN */'), html.indexOf('/* FUNERGY_LUNCH_CHALLENGE_END */'));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A top-level function from index.html, cut out by matching braces (strings and comments are skipped).
function fnSrc(name) {
  const start = html.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, 'function ' + name);
  let i = html.indexOf('{', start), depth = 0, q = null;
  for (; i < html.length; i++) {
    const ch = html[i], nx = html[i + 1];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '/' && nx === '/') { i = html.indexOf('\n', i); continue; }
    if (ch === '/' && nx === '*') { i = html.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start + 1, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const REAL = ['salesActualForDay', 'ldGuests', 'dayGuestValue', 'guestCountType', 'dayClosureMode', 'getStoreClosures', 'tipHoursWindowFor', 'getTipHoursCfg',
  'dowLabelForDate', 'empStoresOf', 'mergeMapByTime', '_recAt', 'obImgSrc'].map(fnSrc).join('\n');

function app({ role = 'crew', user = 'Aki', today = '2026-10-13', days = {}, closures = {}, tipHours = null, bizDays = { '日':'closed' }, store = null, api = () => [], login = null } = {}) {
  const mem = { lunch_challenge: {}, store_closures: { F02: closures }, tip_hours_config: tipHours ? { F02: tipHours } : {} };
  const c = {
    calls: [], toasts: [], pages: [], upserts: [], curLang: 'ja', curRole: role, curUserName: user, curStore: login || 'F02', curStoreLogin: !!login, curPage: 'lunch_challenge',
    escapeHtml: esc, t: (ja, en) => (c.curLang === 'en' ? en : ja), DOW_SHIFT: ['日','月','火','水','木','金','土'],
    STORES: [{ id: 'F02', name: 'Tenkichi', brand: 'Tenkichi', bizDays }, { id: 'F01', name: 'ToriTon', brand: 'ToriTon' }, { id: 'F04-K', name: 'Totoya K', brand: 'Totoya' }],
    getStoresAll: () => c.STORES, amStoresOf: n => (n === 'Ami' ? ['F02'] : []),
    getEmployees: () => [{ name: 'Aki', store: 'F02', role: 'crew' }, { name: 'Ben', store: 'F01', support: ['F02'], role: 'crew' }, { name: 'Cy', store: 'F01', role: 'crew' },
      { name: 'Ami', store: 'F01', role: 'am' }, { name: 'Gone', store: 'F02', role: 'crew', status: '退職' }],
    ls: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), lsSet: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); c.saves = (c.saves || 0) + 1; return true; },
    _daRO: sid => (sid === 'F02' ? days : {}), bizToday: () => c.today, today,
    myName: () => c.curUserName, showToast: (m, k) => c.toasts.push([m, k]), openModal: () => {}, closeModalDirect: () => {},
    renderPage: p => c.pages.push(p), go: p => { c.curPage = p; c.pages.push(p); }, setTimeout: () => 0, clearTimeout: () => {},
    SUPABASE_URL: 'https://example.invalid', supaHeaders: () => ({}),
    supaUpsert: async (t, rows) => { c.upserts.push([t, rows]); return true; },
    fetch: async url => { c.calls.push(url); const r = await api(url); return { ok: true, json: async () => r }; },
    localStorage: store || { getItem: () => null, setItem: () => {} }, window: {}, document: {},
  };
  vm.createContext(c);
  vm.runInContext(REAL + '\n' + MOD + '\nthis.M = { _lc };', c);
  c.mem = mem;
  if (!store) c.M._lc.lang = 'ja';   // most checks read the Japanese page; the English first look is checked on its own
  return c;
}
const fn = (c, n) => vm.runInContext(n, c);
const J = v => JSON.parse(JSON.stringify(v));
// One day of synthetic Toast numbers for Tenkichi (lunch guests include takeout, as in the meeting tab).
const day = (lunchGuests, extra = {}) => ({ actual: 3000, lunchSales: 1500, dinnerSales: 1500, lunchGuests, dinnerGuests: 40, guests: lunchGuests + 40, ...extra });
const tiers = (a = '60', b = '70', c = '80') => [{ t: a, rest: 'Restaurant A', meal: 'Set lunch' }, { t: b, rest: 'Restaurant B', meal: 'Dinner course', budget: '45', tax: 'incl' }, { t: c, rest: 'Restaurant C', meal: 'Omakase' }];
const setCfg = (c, ym, tr = tiers(), who = 'Lunch team') => { c.mem.lunch_challenge['cfg:' + ym] = { ym, state: 'set', tiers: tr, who, _at: 1, by: 'GM' }; };

test('the request example: 624 guests over 10 days, 24 planned, target 70 → average 62.4, 1,680 needed, 1,056 to go, 76 a day for 14 days', () => {
  // October 2026: Sundays are the weekly day off (4, 11, 18, 25), plus a closure on the 20th–22nd → 31 − 4 − 3 = 24 lunch days.
  const g = [58, 62, 64, 57, 63, 65, 60, 62, 65, 68];   // 624 over Oct 1–3, 5–10, 12
  const dates = ['2026-10-01','2026-10-02','2026-10-03','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-12'];
  const days = Object.fromEntries(dates.map((d, i) => [d, day(g[i])]));
  days['2026-10-13'] = day(99);   // today: not counted yet
  const c = app({ days, closures: { '2026-10-20': { mode: 'closed' }, '2026-10-21': { mode: 'closed' }, '2026-10-22': { mode: 'lclose' } } });
  setCfg(c, '2026-10');
  const o = fn(c, 'lcCompute')('2026-10');
  assert.deepEqual([o.C, o.d, o.D, o.R, o.pending, o.avg10, o.reached, o.next], [624, 10, 24, 14, 0, 624, 0, 1]);
  assert.deepEqual(J(o.pace[1]), { need: 1680, rem: 1056, per: 76 });   // 1056 / 14 = 75.43 → 76
  assert.deepEqual(J(o.pace[2]), { need: 1920, rem: 1296, per: 93 });
  assert.equal(o.prev10, 617);   // 556 / 9 = 61.78 → shown 61.7 (rounded down like every average) through Oct 10
  c.M._lc.lang = 'en';
  const h = fn(c, 'renderLunchChallenge')();
  assert.match(h, /<div class="lc-big">62\.4<\/div>/);
  assert.match(h, /624 guests over 10 lunch days \(Oct 1–12\)/);
  assert.match(h, />▲ 0\.7</);
  assert.match(h, /Change since the day before \(61\.7 through Oct 10\)/);
  assert.match(h, /NEXT GOAL/);
  assert.match(h, /★★ 2 Stars · 70\.0 avg/);
  assert.match(h, /<div style="font-size:44px;font-weight:800;line-height:1">76<\/div>/);
  assert.match(h, /for each of the 14 lunch days left \(Oct 13–31\) to finish the month at 70\.0\./);
  assert.match(h, /<b>\+7\.6<\/b>/); assert.match(h, /<b>1,056<\/b>/); assert.match(h, /<b>1,680<\/b>/);
  assert.match(h, /★★★ 3 Stars \(80\.0\) needs 93 a day\. Lunch days planned this month: 24\./);
  assert.match(h, /Now at ★ 1 Star line/);
  assert.match(h, /Best day: <\/span>|Best day: <b>68<\/b>/);
  // Japanese.
  c.M._lc.lang = 'ja';
  const j = fn(c, 'renderLunchChallenge')();
  assert.match(j, /ランチ 10 日で 624 名（10\/1〜10\/12）/);
  assert.match(j, /残りのランチ 14 日（10\/13〜10\/31）で、毎日この人数なら月末に 70\.0 名。/);
});

test('days that count: closures, lunch off, today and later are not counted; a day not loaded is waiting, not 0; 0 guests waits for a manager', () => {
  const days = { '2026-10-01': day(70), '2026-10-02': day(0), '2026-10-05': day(50), '2026-10-04': day(30), '2026-10-12': day(66), '2026-10-13': day(80) };
  // Tuesdays have lunch off in the tip hours (lunch moves to dinner, as in the meeting tab).
  const tipHours = { mode: 'hours', l1: '11:00', l2: '14:00', d1: '17:00', d2: '22:00', dow: { '火': { lOn: false, dOn: true } } };
  const c = app({ days, tipHours, closures: { '2026-10-07': { mode: 'closed' }, '2026-10-08': { mode: 'dclose' } } });
  setCfg(c, '2026-10');
  const o = fn(c, 'lcCompute')('2026-10');
  const st = Object.fromEntries(o.days.map(r => [r.date.slice(8), r.st]));
  assert.equal(st['01'], 'count'); assert.equal(st['02'], 'zero'); assert.equal(st['03'], 'wait');
  assert.equal(st['04'], 'weekly', 'Sunday off (store master)'); assert.equal(st['06'], 'loff', 'Tuesday lunch off (tip hours)');
  assert.equal(st['07'], 'temp', 'closure'); assert.equal(st['08'], 'wait', 'a dinner-only closure keeps lunch');
  assert.equal(st['13'], 'loff', 'today (a Tuesday) has lunch off'); assert.equal(st['14'], 'future');
  // Lunch off counts only when the tip hours are set by the hour (as in the meeting tab); a day with no sales is waiting even if guests are written.
  const all = app({ days: { '2026-10-06': day(40), '2026-10-01': { actual: 0, lunchGuests: 30 } }, tipHours: { ...tipHours, mode: 'all' } });
  const ao = fn(all, 'lcCompute')('2026-10');
  assert.equal(ao.days.find(r => r.date === '2026-10-06').st, 'count');
  assert.equal(ao.days.find(r => r.date === '2026-10-01').st, 'wait');
  assert.deepEqual([o.C, o.d], [70 + 50 + 66, 3]);
  assert.ok(o.days.find(r => r.date === '2026-10-04').conflict, 'guests on a day that is closed in the settings are flagged');
  assert.deepEqual([...o.zero], ['2026-10-02']);
  assert.ok(o.wait.includes('2026-10-03') && o.wait.includes('2026-10-09'));
  // With waiting days the pace is not shown as a fixed number.
  const h = fn(c, 'renderLunchChallenge')();
  assert.match(h, /1 日あたりの必要ペースは、集計待ちの日がそろってから出します。/);
  assert.match(h, /暫定/);
  assert.match(h, /未集計 \d+ 日（10\/3・/);
  assert.match(h, /ランチ 0 名の日 1 日（10\/2）は確かめ中で、平均から外しています。/);
  // A manager decides the 0-guest day and the waiting days.
  const gm = app({ role: 'gm', user: 'GM', days, tipHours, closures: { '2026-10-07': { mode: 'closed' }, '2026-10-08': { mode: 'dclose' } } });
  setCfg(gm, '2026-10');
  fn(gm, 'lcMarkDay')('2026-10-02', 'zero'); fn(gm, 'lcMarkDay')('2026-10-03', 'closed');
  let p = fn(gm, 'lcCompute')('2026-10');
  assert.deepEqual([p.C, p.d, p.D - o.D], [186, 4, -1]);
  fn(gm, 'lcMarkDay')('2026-10-03', 'none');
  p = fn(gm, 'lcCompute')('2026-10');
  assert.ok(p.wait.includes('2026-10-03'));
  // Only GM/CEO mark days; never today or later.
  const crew = app({ days }); fn(crew, 'lcMarkDay')('2026-10-02', 'zero');
  assert.equal(crew.saves, undefined);
  fn(gm, 'lcMarkDay')('2026-10-13', 'closed');
  assert.equal(fn(gm, 'lcMark')('2026-10-13'), '');
});

test('the average is rounded down to one decimal; the star uses the exact value', () => {
  // 1,749 over 25 days = 69.96 → shown 69.9, ★2 (70) not reached.
  const days = {}; const dates = [];
  for (let d = 1; d <= 31 && dates.length < 25; d++) { const iso = '2026-07-' + String(d).padStart(2, '0'); if (new Date(iso + 'T00:00:00').getDay() !== 0) dates.push(iso); }
  dates.forEach((d, i) => { days[d] = day(i < 24 ? 70 : 69); });   // 24 × 70 + 69 = 1,749
  const c = app({ days, today: '2026-08-02' });
  setCfg(c, '2026-07');
  const o = fn(c, 'lcCompute')('2026-07');
  assert.deepEqual([o.C, o.d, o.avg10, o.reached], [1749, 25, 699, 0]);
  assert.equal(fn(c, 'lcAvgL')(o.avg10), '69.9');
  // The month total is rounded up (70.5 × 25 = 1,762.5 → 1,763) and so is the daily pace.
  assert.deepEqual(J(fn(c, 'lcPace')({ D: 25, C: 1000, R: 4 }, 705)), { need: 1763, rem: 763, per: 191 });
  // Saved targets that do not go up are treated as not set.
  setCfg(c, '2026-07', tiers('70', '60', '80'));
  assert.equal(fn(c, 'lcCompute')('2026-07').cfg, null);
  setCfg(c, '2026-07');
  // Exactly on the line counts.
  days[dates[24]] = day(70);
  const p = fn(c, 'lcCompute')('2026-07');
  assert.deepEqual([p.avg10, p.reached], [700, 1]);
});

test('states: before the first number, targets not set, keeping the top star, month end waiting and confirmed', () => {
  // Nov 1 is a Sunday (closed): before any number the page says so and never shows 0.
  const c = app({ today: '2026-11-01' });
  setCfg(c, '2026-11');
  let h = fn(c, 'renderLunchChallenge')();
  assert.match(h, /集計開始前/);
  assert.match(h, /最初のランチ営業日 11\/2 の数字が入ると、平均が出ます。0 名とは出しません。/);
  assert.doesNotMatch(h, /lc-big">0/);
  assert.match(h, /★1 60\.0・★2 70\.0・★3 80\.0/);
  assert.match(h, /営業予定 25 日・★2 なら 1 日 70 名ペース/);
  assert.doesNotMatch(h, /次の目標|平均の差/);
  // Targets not set: only the average.
  const n = app({ days: { '2026-10-01': day(60) }, today: '2026-10-02' });
  h = fn(n, 'renderLunchChallenge')();
  assert.match(h, /今月の目標とごほうびは、まだ決まっていません。平均客数だけ出します。/);
  // Top star kept to month end: the pace to keep ★3.
  const days = {}; for (let d = 1; d <= 25; d++) { const iso = '2026-10-' + String(d).padStart(2, '0'); if (new Date(iso + 'T00:00:00').getDay() !== 0) days[iso] = day(81); }
  const k = app({ days, today: '2026-10-26' }); setCfg(k, '2026-10');
  const ko = fn(k, 'lcCompute')('2026-10');
  assert.equal(ko.reached, 2); assert.equal(ko.next, -1);
  h = fn(k, 'renderLunchChallenge')();
  assert.match(h, /月末までキープ/);
  assert.match(h, /★3 より上/);
  // Month end, all days in: waiting for a manager; after confirming, the star is won.
  const e = app({ role: 'gm', user: 'GM', days, today: '2026-11-02' }); setCfg(e, '2026-10');
  const eo = fn(e, 'lcCompute')('2026-10');
  assert.ok(eo.ended && eo.wait.length > 0, 'days after the 25th have no numbers');
  eo.wait.forEach(d => fn(e, 'lcMarkDay')(d, 'closed'));
  e.M._lc.ym = '2026-10'; e.M._lc.view = 'admin';
  h = fn(e, 'renderLunchChallenge')();
  assert.match(h, /<button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="lcConfirm\(\)">★3 で確定する<\/button>/);
  fn(e, 'lcConfirm')();
  const conf = J(e.mem.lunch_challenge['conf:2026-10']);
  assert.equal(conf.state, 'done'); assert.equal(conf.tier, 2); assert.equal(conf.avg10, 810); assert.equal(conf.by, 'GM');
  assert.deepEqual(conf.tiers.map(x => x.rest), ['Restaurant A', 'Restaurant B', 'Restaurant C']);
  e.M._lc.view = 'staff';
  h = fn(e, 'renderLunchChallenge')();
  assert.match(h, /★3 獲得！/);
  // Later changes to the targets do not change a confirmed month; a correction of the guests is shown, never rewritten.
  setCfg(e, '2026-10', tiers('90', '95', '99'));
  h = fn(e, 'renderLunchChallenge')();
  assert.match(h, /★3 獲得！/);
  assert.match(h, /★3 80\.0/); assert.doesNotMatch(h, /99\.0/);
  days['2026-10-05'] = day(10);
  h = fn(e, 'renderLunchChallenge')();
  assert.match(h, /確定のあとで客数が直りました（訂正あり・再確認）/);
  assert.equal(J(e.mem.lunch_challenge['conf:2026-10']).avg10, 810);
});

test('who can see it: Tenkichi staff and support (G1 up), Tenkichi store login and HQ; other stores cannot; settings are GM/CEO only', () => {
  const see = o => fn(app(o), 'lcCanSee')();
  assert.equal(see({ role: 'crew', user: 'Aki' }), true, 'Tenkichi staff');
  assert.equal(see({ role: 'crew', user: 'Ben' }), true, 'support at Tenkichi');
  assert.equal(see({ role: 'crew', user: 'Cy' }), false, 'another store');
  assert.equal(see({ role: 'crew', user: 'Gone' }), false, 'left the company');
  assert.equal(see({ role: 'am', user: 'Ami' }), true, 'the AM of Tenkichi');
  assert.equal(see({ role: 'sl', user: 'Nobody' }), false);
  for (const r of ['ceo', 'gm', 'office', 'office_crew']) assert.equal(see({ role: r, user: 'HQ' }), true, r);
  assert.equal(see({ role: 'crew', user: 'Kiosk', login: 'F02' }), true, 'Tenkichi store login');
  assert.equal(see({ role: 'crew', user: 'Kiosk', login: 'F01' }), false, 'another store login');
  const other = app({ role: 'crew', user: 'Cy' });
  assert.equal(fn(other, 'lcEntryCard')('mypage'), '');
  assert.match(fn(other, 'renderLunchChallenge')(), /Tenkichi の人だけが見られるページです|This page is for the Tenkichi team/);
  // Budgets and settings: GM/CEO only.
  const crew = app({ days: { '2026-10-01': day(60) } }); setCfg(crew, '2026-10');
  let h = fn(crew, 'renderLunchChallenge')();
  assert.doesNotMatch(h, /\$45|45 per person|1 人あたり \$/);
  assert.doesNotMatch(h, /lcSetView\('admin'\)/);
  fn(crew, 'lcSetView')('admin');
  assert.equal(crew.M._lc.view, 'staff');
  const gm = app({ role: 'gm', user: 'GM', days: { '2026-10-01': day(60) } }); setCfg(gm, '2026-10');
  h = fn(gm, 'renderLunchChallenge')();
  assert.match(h, /1 人あたり \$45（税・チップ込み）・管理者だけに表示/);
  assert.match(h, /lcSetView\('admin'\)/);
});

test('settings: targets must go up; after the month starts a reason is needed; the change and who made it are kept', () => {
  const c = app({ role: 'gm', user: 'GM', today: '2026-10-20' });
  c.M._lc.ym = '2026-11';
  const f = fn(c, 'lcFormFor')('2026-11');
  fn(c, 'lcFormSet')(0, 't', '60'); fn(c, 'lcFormSet')(1, 't', '60'); fn(c, 'lcFormSet')(2, 't', '80');
  fn(c, 'lcSaveCfg')();
  assert.match(c.toasts.at(-1)[0], /★1 ＜ ★2 ＜ ★3/);
  fn(c, 'lcFormSet')(1, 't', '70.55');
  fn(c, 'lcSaveCfg')();
  assert.match(c.toasts.at(-1)[0], /0\.1 名きざみ/);
  fn(c, 'lcFormSet')(1, 't', '70'); fn(c, 'lcFormSet')(1, 'rest', 'Restaurant <b>B</b>'); fn(c, 'lcFormSet')(1, 'budget', '45');
  fn(c, 'lcSaveCfg')();
  const cfg = J(c.mem.lunch_challenge['cfg:2026-11']);
  assert.deepEqual(cfg.tiers.map(x => x.t), ['60.0', '70.0', '80.0']);
  assert.equal(cfg.by, 'GM');
  const hist = Object.entries(J(c.mem.lunch_challenge)).filter(([k]) => k.startsWith('h:')).map(([, v]) => v);
  assert.equal(hist.length, 1); assert.match(hist[0].what, /段階とごほうびを作成/);
  // The month has started: a change needs a reason, and the history shows before → after.
  c.today = '2026-11-03';
  fn(c, 'lcFormFor')('2026-11'); fn(c, 'lcFormSet')(1, 'rest', 'Restaurant B2');
  fn(c, 'lcSaveCfg')();
  assert.match(c.toasts.at(-1)[0], /理由を入れてください/);
  c.M._lc.reason = '予約が取れない';
  fn(c, 'lcSaveCfg')();
  const h2 = Object.values(J(c.mem.lunch_challenge)).filter(v => v && v.what && /B2/.test(v.what));
  assert.equal(h2.length, 1); assert.match(h2[0].what, /★★ レストラン：Restaurant <b>B<\/b> → Restaurant B2/); assert.equal(h2[0].why, '予約が取れない');
  // Escaped on the page (staff page and settings).
  c.M._lc.view = 'staff'; c.M._lc.ym = '2026-11'; c.mem.lunch_challenge['cfg:2026-11'].tiers[0].rest = 'Shop <img src=x onerror=alert(1)>';
  const sh = fn(c, 'renderLunchChallenge')();
  assert.ok(sh.includes('Shop &lt;img src=x onerror=alert(1)&gt;') && !sh.includes('<img src=x'));
  c.M._lc.view = 'admin';
  const h = fn(c, 'renderLunchChallenge')();
  assert.ok(h.includes('Restaurant &lt;b&gt;B&lt;/b&gt; → Restaurant B2') && !h.includes('<b>B</b>'));
  // Copy the previous month's settings.
  c.M._lc.ym = '2026-12'; fn(c, 'lcFormFor')('2026-12'); fn(c, 'lcCopyPrev')();
  assert.deepEqual(J(c.M._lc.form.tiers.map(x => x.rest)), ['Shop <img src=x onerror=alert(1)>', 'Restaurant B2', '']);
  // A confirmed month cannot be changed.
  c.mem.lunch_challenge['conf:2026-11'] = { ym: '2026-11', state: 'done', _at: 5 };
  c.M._lc.ym = '2026-11'; fn(c, 'lcFormFor')('2026-11'); fn(c, 'lcFormSet')(0, 'rest', 'X'); const before = c.saves;
  fn(c, 'lcSaveCfg')();
  assert.equal(c.saves, before); assert.match(c.toasts.at(-1)[0], /確定した月の設定は変えられません/);
  // Only GM/CEO save.
  const crew = app({ today: '2026-10-20' }); crew.M._lc.ym = '2026-11'; fn(crew, 'lcFormFor')('2026-11');
  fn(crew, 'lcFormSet')(0, 't', '60'); fn(crew, 'lcFormSet')(1, 't', '70'); fn(crew, 'lcFormSet')(2, 't', '80'); fn(crew, 'lcSaveCfg')();
  assert.equal(crew.saves, undefined);
});

test('confirming needs the month to end, every day decided and the settings; undo needs a reason', () => {
  const days = { '2026-09-01': day(70) };
  const c = app({ role: 'ceo', user: 'CEO', days, today: '2026-09-15' }); setCfg(c, '2026-09'); c.M._lc.ym = '2026-09';
  fn(c, 'lcConfirm')();
  assert.equal(c.mem.lunch_challenge['conf:2026-09'], undefined, 'not before the month ends');
  const early = app({ role: 'ceo', user: 'CEO', days, today: '2026-09-02' }); setCfg(early, '2026-09'); early.M._lc.ym = '2026-09';
  assert.equal(fn(early, 'lcCompute')('2026-09').pending, 0);
  fn(early, 'lcConfirm')();
  assert.equal(early.mem.lunch_challenge['conf:2026-09'], undefined, 'not before the month ends, even with every day so far in');
  c.today = '2026-10-02';
  fn(c, 'lcConfirm')();
  assert.equal(c.mem.lunch_challenge['conf:2026-09'], undefined, 'not while days are waiting');
  const o = fn(c, 'lcCompute')('2026-09'); o.wait.forEach(d => fn(c, 'lcMarkDay')(d, 'closed'));
  fn(c, 'lcConfirm')();
  assert.equal(J(c.mem.lunch_challenge['conf:2026-09']).state, 'done');
  fn(c, 'lcMarkDay')('2026-09-01', 'closed');
  assert.match(c.toasts.at(-1)[0], /確定した月は日の印を変えられません/);
  fn(c, 'lcUnconfirm')();
  assert.match(c.toasts.at(-1)[0], /理由を入れてください/);
  c.M._lc.confWhy = '客数の訂正';
  fn(c, 'lcUnconfirm')();
  assert.equal(J(c.mem.lunch_challenge['conf:2026-09']).state, 'none');
  assert.equal(fn(c, 'lcCompute')('2026-09').conf, null);
});

test('saved records merge one by one (two managers on different things keep both); history entries never collide', () => {
  const c = app({ role: 'gm', user: 'GM', days: { '2026-10-02': day(0) } });
  const merge = fn(c, 'mergeMapByTime');
  const a = { 'cfg:2026-11': { tiers: tiers(), _at: 10 }, 'mark:2026-10-02': { k: 'zero', _at: 20 } };
  const b = { 'cfg:2026-11': { tiers: tiers('61'), _at: 30 }, 'mark:2026-10-03': { k: 'closed', _at: 25 } };
  const m = J(merge(a, b));
  assert.equal(m['cfg:2026-11'].tiers[0].t, '61');
  assert.equal(m['mark:2026-10-02'].k, 'zero'); assert.equal(m['mark:2026-10-03'].k, 'closed');
  // A removed mark is saved as "none" (a tombstone would win every merge and could never be set again).
  fn(c, 'lcMarkDay')('2026-10-02', 'zero'); fn(c, 'lcMarkDay')('2026-10-02', 'none'); fn(c, 'lcMarkDay')('2026-10-02', 'closed');
  assert.equal(c.mem.lunch_challenge['mark:2026-10-02'].k, 'closed');
  assert.ok(Object.values(c.mem.lunch_challenge).every(v => !v._deleted));
  const t1 = c.mem.lunch_challenge['mark:2026-10-02']._at;
  fn(c, 'lcMarkDay')('2026-10-02', 'none');
  assert.ok(c.mem.lunch_challenge['mark:2026-10-02']._at > t1, 'always newer than the saved one');
  // Even when this device's clock is behind the device that saved last.
  vm.runInContext('Date.now = function(){ return 1000; }', c);
  c.mem.lunch_challenge['mark:2026-10-02'] = { k: 'closed', _at: 5000 };
  fn(c, 'lcMarkDay')('2026-10-02', 'none');
  assert.equal(c.mem.lunch_challenge['mark:2026-10-02']._at, 5001);
  assert.equal(c.mem.lunch_challenge['mark:2026-10-02'].k, 'none');
  assert.equal(c.mem.lunch_challenge['mark:2026-10-02'].k, 'none'); assert.equal(c.mem.lunch_challenge['mark:2026-10-02']._deleted, undefined);
  assert.equal(Object.keys(c.mem.lunch_challenge).filter(k => k.startsWith('h:')).length, 5);
  // The key is synced, merged and never freed (checked in the source).
  assert.match(html, /'q_budgets','fv_config','lunch_challenge'\];/);
  assert.match(html, /  lunch_challenge:    \{ merge: mergeMapByTime, covers: _coversMapByTime \},/);
  assert.match(html, /\n  'lunch_challenge',   \/\* v1080/);
});

test('photos: made small, saved as their own rows, never in the bulk pull, fetched only when shown and only as images', async () => {
  assert.match(html, /supaFetchAll\('app_state', 'key,value', 'key=not\.like\.invoice_purchase_\*&key=not\.like\.lunch_photo_\*'\)/);
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(64);
  const c = app({ role: 'gm', user: 'GM', days: { '2026-10-01': day(60) }, api: url => [{ key: 'lunch_photo_abc123', value: { img } }, { key: 'lunch_photo_bad999', value: { img: 'javascript:alert(1)' } }] });
  setCfg(c, '2026-10', [{ t: '60', photo: 'lunch_photo_abc123' }, { t: '70', photo: 'lunch_photo_bad999' }, { t: '80', photo: '../x' }]);
  let h = fn(c, 'renderLunchChallenge')();
  assert.match(h, /読み込み中…/);
  await fn(c, 'lcFetchPhotos')();
  assert.equal(c.calls.length, 1);
  assert.match(c.calls[0], /app_state\?select=key,value&key=in\.\((lunch_photo_abc123,lunch_photo_bad999|lunch_photo_bad999,lunch_photo_abc123)\)$/);
  h = fn(c, 'renderLunchChallenge')();
  assert.ok(h.includes('<img src="' + img + '"'));
  assert.doesNotMatch(h, /javascript:/);
  // Asked once only.
  await fn(c, 'lcFetchPhotos')();
  assert.equal(c.calls.length, 1);
  // Uploading needs GM/CEO; the row holds only the image, the month, the time and who.
  c.lcCompress = (file, cb) => cb(img);
  vm.runInContext('lcCompress = this.lcCompress', c);
  const id = await fn(c, 'lcUploadPhoto')({ name: 'x.jpg' }, '2026-10');
  assert.match(id, /^lunch_photo_[a-z0-9]{6,40}$/);
  assert.equal(c.upserts.length, 1);
  assert.deepEqual(Object.keys(c.upserts[0][1][0].value).sort(), ['at', 'by', 'img', 'ym']);
  const crew = app({}); crew.lcCompress = (file, cb) => cb(img); vm.runInContext('lcCompress = this.lcCompress', crew);
  assert.equal(await fn(crew, 'lcUploadPhoto')({ name: 'x.jpg' }, '2026-10'), '');
  assert.equal(crew.upserts.length, 0);
  // Not an image: refused.
  const bad = app({ role: 'gm', user: 'GM' }); bad.lcCompress = (file, cb) => cb('data:text/html;base64,AAAA'); vm.runInContext('lcCompress = this.lcCompress', bad);
  assert.equal(await fn(bad, 'lcUploadPhoto')({ name: 'x' }, '2026-10'), '');
  assert.equal(bad.upserts.length, 0);
});

test('entry cards follow the app language; the page remembers its own language (English first)', () => {
  const mem = {}; const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const days = { '2026-10-01': day(62) };
  const c = app({ days, store }); setCfg(c, '2026-10');
  c.curLang = 'ja';
  let card = fn(c, 'lcEntryCard')('mypage');
  assert.match(card, /ランチチャレンジ/); assert.match(card, /ランチの客数／日/); assert.match(card, /★1 のライン/);
  assert.match(card, /onclick="lcOpen\('mypage'\)"/);
  c.curLang = 'en';
  card = fn(c, 'lcEntryCard')('store');
  assert.match(card, /LUNCH CHALLENGE/); assert.match(card, /lunch guests \/ day/); assert.match(card, /onclick="lcOpen\('store_cmd'\)"/);
  assert.equal(c.M._lc.cardLang, null, 'the card language is put back');
  // The page starts in English and remembers the choice on this device.
  assert.equal(fn(c, 'lcLang')(), 'en');
  assert.match(fn(c, 'renderLunchChallenge')(), /62 guests over 1 lunch day \(Oct 1\)/);
  fn(c, 'lcSetLang')('ja');
  assert.equal(mem._lc_lang, 'ja');
  const again = app({ days, store }); assert.equal(fn(again, 'lcLang')(), 'ja');
  // The page and the entries are wired in.
  assert.match(html, /case 'lunch_challenge': el\.innerHTML = renderLunchChallenge\(\); break;/);
  assert.match(html, /try \{ html \+= lcEntryCard\('mypage'\); \} catch\(e\) \{\}/);
  assert.match(html, /if \(storeId === LC_STORE\) \{ try \{ html \+= lcEntryCard\('store'\); \} catch\(e\) \{\} \}/);
  assert.match(html, /var OFFICE_OK_PAGES = \['lunch_challenge',/);
});

test('history lists each month with its result; past months keep their own targets; the dinner record is shown', () => {
  const days = {}; for (let d = 1; d <= 30; d++) { const iso = '2026-09-' + String(d).padStart(2, '0'); if (new Date(iso + 'T00:00:00').getDay() !== 0) days[iso] = day(72); }
  const c = app({ days, today: '2026-10-05' });
  setCfg(c, '2026-09'); setCfg(c, '2026-10');
  c.mem.lunch_challenge['conf:2026-09'] = { ym: '2026-09', state: 'done', at: '2026-10-02T18:00:00Z', by: 'GM', C: 1872, d: 26, D: 26, avg10: 720, tier: 1, tiers: tiers().map((x, i) => ({ t10: [600, 700, 800][i], rest: x.rest })), _at: 3 };
  c.mem.lunch_challenge['din:2026-09'] = { ym: '2026-09', date: '2026-10-20', place: 'Restaurant <i>B</i>', people: '12', photos: ['lunch_photo_abc123', 'x'], _at: 4 };
  c.M._lc.view = 'history';
  const h = fn(c, 'renderLunchChallenge')();
  assert.match(h, /2026年9月/); assert.match(h, /★2 獲得/); assert.match(h, /72\.0/);
  assert.match(h, /2026年10月/); assert.match(h, /進行中/);
  assert.ok(h.includes('Restaurant &lt;i&gt;B&lt;/i&gt; · 10/20 · 12 人'));
  assert.equal((h.match(/読み込み中…/g) || []).length, 1, 'only valid photo ids (the one valid photo is being loaded)');
});

test('after the review: every photo is fetched, a failed fetch is not "Loading" forever, and opening the page again retries', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => 'lunch_photo_p' + String(i).padStart(5, '0'));
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(64);
  let fail = false;
  const c = app({ api: url => { if (fail) throw new Error('offline'); const want = decodeURIComponent(url).match(/in\.\(([^)]*)\)/)[1].split(','); return want.map(k => ({ key: k, value: { img } })); } });
  const timers = []; c.setTimeout = f => { timers.push(f); return timers.length; };
  const tick = async () => { const f = timers.shift(); assert.ok(f, 'a fetch is waiting'); f(); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  ids.forEach(id => fn(c, 'lcAskPhoto')(id));
  assert.equal(timers.length, 1, 'one fetch for all the photos asked at once');
  await tick();
  assert.equal(c.calls.length, 1);
  assert.equal(decodeURIComponent(c.calls[0]).match(/in\.\(([^)]*)\)/)[1].split(',').length, 20, '20 at a time');
  assert.equal(Object.values(c.M._lc.photoAsk).filter(v => v === 1).length, 5, 'the rest are still asked for');
  await tick();   // the rest are fetched on their own (no new drawing needed)
  assert.equal(c.calls.length, 2);
  assert.equal(Object.keys(c.M._lc.photos).length, 25, 'all 25 photos are in');
  assert.equal(timers.length, 0, 'nothing more to fetch');
  // A fetch that fails shows the placeholder (never "Loading…" forever); opening the page again tries once more.
  fail = true;
  fn(c, 'lcAskPhoto')('lunch_photo_zz9999');
  await tick();
  assert.equal(timers.length, 0, 'a failed fetch is not tried again and again');
  assert.equal(c.M._lc.photoAsk.lunch_photo_zz9999, 'none');
  assert.doesNotMatch(fn(c, 'lcPhotoHtml')('lunch_photo_zz9999', 'X'), /読み込み中|Loading/);
  fn(c, 'lcOpen')('mypage');
  assert.equal(c.M._lc.photoAsk.lunch_photo_zz9999, undefined, 'asked again after reopening');
  assert.match(fn(c, 'lcPhotoHtml')('lunch_photo_zz9999', 'X'), /読み込み中/);
});

test('after the review: a confirmed month shows the confirmed numbers; a change is found day by day; a day marked closed that gets guests is flagged', () => {
  const days = {}; for (let d = 1; d <= 30; d++) { const iso = '2026-09-' + String(d).padStart(2, '0'); if (new Date(iso + 'T00:00:00').getDay() !== 0) days[iso] = day(72); }
  delete days['2026-09-15'];   // waiting → marked closed below
  const c = app({ role: 'gm', user: 'GM', days, today: '2026-10-02' }); setCfg(c, '2026-09'); c.M._lc.ym = '2026-09';
  fn(c, 'lcMarkDay')('2026-09-15', 'closed');
  fn(c, 'lcConfirm')();
  const conf = J(c.mem.lunch_challenge['conf:2026-09']);
  assert.equal(conf.avg10, 720); assert.equal(Object.keys(conf.days).length, conf.d);
  let o = fn(c, 'lcCompute')('2026-09');
  assert.equal(o.corrected, false);
  // Two days change by +10 and −10: the total and the number of days are the same, but the numbers changed.
  days['2026-09-01'] = day(82); days['2026-09-02'] = day(62);
  o = fn(c, 'lcCompute')('2026-09');
  assert.deepEqual([o.C, o.d], [conf.C, conf.d]);
  assert.equal(o.corrected, true, 'found day by day, not by the total');
  days['2026-09-01'] = day(72); days['2026-09-02'] = day(72);
  assert.equal(fn(c, 'lcCompute')('2026-09').corrected, false);
  // A day marked closed that later gets guests: flagged on the calendar and as a correction.
  days['2026-09-15'] = day(55);
  o = fn(c, 'lcCompute')('2026-09');
  assert.ok(o.days.find(r => r.date === '2026-09-15').conflict, 'marked closed but guests came in');
  assert.equal(o.corrected, true);
  c.M._lc.view = 'admin';
  assert.match(fn(c, 'renderLunchChallenge')(), /休み扱いなのに客数がある日：9\/15/);
  // The page shows the confirmed numbers first, and today's numbers under them when they changed.
  delete days['2026-09-15'];
  ['01', '02', '03', '04', '05'].forEach(d => { days['2026-09-' + d] = day(10); });   // 1,800 − 5 × 62 = 1,490 → 59.6, below ★1 now
  c.M._lc.view = 'staff';
  const h = fn(c, 'renderLunchChallenge')();
  assert.match(h, /<div class="lc-big">72\.0<\/div><div class="lc-mut">名<\/div><span[^>]*>確定<\/span>/);
  assert.match(h, /ランチ 25 日で 1,800 名/);
  assert.match(h, /確定のあとで客数が直りました（訂正あり・再確認）/);
  assert.match(h, /今の数字：平均 59\.6・ランチ 25 日で 1,490 名/);
  assert.match(h, /★2 のライン/); assert.doesNotMatch(h, /★1 まで あと/, 'the ladder shows the confirmed result');
  // The bar and the arrow stand at 72.0 (61.4% of the ladder from 48.0 to 87.1), not at today's 59.6 (29.7%).
  assert.match(h, /background:#f0661f;width:61\.4%/); assert.match(h, /left:61\.4%;transform:translateX\(-50%\);font-size:10px;font-weight:800">▼/);
  // Even if every counted day disappeared, the confirmed bar stays.
  Object.keys(days).forEach(k => delete days[k]);
  assert.match(fn(c, 'renderLunchChallenge')(), /★2 のライン/);
  assert.equal(J(c.mem.lunch_challenge['conf:2026-09']).avg10, 720, 'the confirmed record is never rewritten');
});

test('after the review: a settings draft is dropped when the page is opened again and cannot save over another manager\'s newer save', () => {
  const c = app({ role: 'gm', user: 'GM', today: '2026-10-20' });
  setCfg(c, '2026-11');
  c.M._lc.ym = '2026-11';
  fn(c, 'lcFormFor')('2026-11'); fn(c, 'lcFormSet')(0, 'rest', 'Mine');
  // Opening the page again forgets the draft.
  fn(c, 'lcOpen')('mypage');
  assert.equal(c.M._lc.form, null);
  c.M._lc.ym = '2026-11';
  fn(c, 'lcFormFor')('2026-11'); fn(c, 'lcFormSet')(0, 'rest', 'Mine');
  // Another manager saves first (it arrives through the sync).
  c.mem.lunch_challenge['cfg:2026-11'] = { ym: '2026-11', state: 'set', tiers: tiers('61'), who: 'Other', _at: 99, by: 'CEO' };
  const before = c.saves;
  fn(c, 'lcSaveCfg')();
  assert.equal(c.saves, before, 'not saved over the newer settings');
  assert.match(c.toasts.at(-1)[0], /ほかの人がこの月の設定を先に保存しました/);
  assert.equal(c.M._lc.form, null, 'the draft is read again from the new settings');
  assert.equal(J(c.mem.lunch_challenge['cfg:2026-11']).tiers[0].t, '61');
  // From the new settings the change can be made.
  fn(c, 'lcFormFor')('2026-11'); fn(c, 'lcFormSet')(0, 'rest', 'Mine');
  c.M._lc.reason = 'x';
  fn(c, 'lcSaveCfg')();
  assert.equal(J(c.mem.lunch_challenge['cfg:2026-11']).tiers[0].rest, 'Mine');
  // The same manager can save twice in a row.
  fn(c, 'lcFormFor')('2026-11'); fn(c, 'lcFormSet')(0, 'rest', 'Mine 2'); fn(c, 'lcSaveCfg')();
  assert.equal(J(c.mem.lunch_challenge['cfg:2026-11']).tiers[0].rest, 'Mine 2');
});

test('after the review: a waiting day can only be marked closed; the entry card at the month start shows only the state; the saved data is read once per drawing', () => {
  const days = { '2026-10-01': day(70), '2026-10-02': day(0) };   // Oct 3 waiting, Oct 2 has 0 guests
  const gm = app({ role: 'gm', user: 'GM', days, today: '2026-10-05' }); setCfg(gm, '2026-10');
  fn(gm, 'lcMarkDay')('2026-10-03', 'zero');
  assert.equal(fn(gm, 'lcMark')('2026-10-03'), '', 'a day without numbers is never 0');
  assert.match(gm.toasts.at(-1)[0], /数字が取り込まれていない日は 0 名で確定できません/);
  fn(gm, 'lcMarkDay')('2026-10-02', 'zero');
  assert.equal(fn(gm, 'lcMark')('2026-10-02'), 'zero');
  fn(gm, 'lcMarkDay')('2026-10-02', 'none');
  gm.M._lc.view = 'admin'; gm.M._lc.ym = '2026-10';
  const h = fn(gm, 'renderLunchChallenge')();
  const row = d => h.slice(h.indexOf('<b style="min-width:52px">' + d + '</b>'), h.indexOf('</div>', h.indexOf('<b style="min-width:52px">' + d + '</b>')));
  assert.match(row('10/2'), /0 名で確定/); assert.match(row('10/2'), /休業だった/);
  assert.doesNotMatch(row('10/3'), /0 名で確定/); assert.match(row('10/3'), /休業だった/); assert.match(row('10/3'), /Toast の取込を待つ/);
  // Month start: only the state, no "below ★1".
  const s = app({ today: '2026-11-02' }); setCfg(s, '2026-11');
  const card = fn(s, 'lcEntryCard')('mypage');
  assert.match(card, />集計開始前</); assert.doesNotMatch(card, /★1 まで/);
  // One read of the saved data per drawing (the page and each card).
  const r = app({ days: { '2026-10-01': day(62) } }); setCfg(r, '2026-10');
  let n = 0; const ls0 = r.ls; r.ls = (k, d) => { if (k === 'lunch_challenge') n++; return ls0(k, d); }; vm.runInContext('ls = this.ls', r);
  fn(r, 'renderLunchChallenge')();
  assert.equal(n, 1, 'the page reads once');
  n = 0; fn(r, 'lcEntryCard')('mypage'); assert.equal(n, 1, 'the card reads once');
  // A save inside a drawing is read again.
  const g2 = app({ role: 'gm', user: 'GM', days }); setCfg(g2, '2026-10');
  assert.equal(vm.runInContext('lcCached(function(){ lcSaveMany([["mark:2026-10-02", { k:"zero" }]]); return lcMark("2026-10-02"); })', g2), 'zero');
});
