// v1174：会議タブの「KPI推移」。1〜6 月の Excel のデータ（seed）が無い店（9 月開店の LaLa＝F06 など）も、
// 7 月以降に目標か実績がある KPI を行に出す（前は原価率・人件費率の行が出ず、会計 PL の数字が見えなかった）。Moto さん 11/15。
// seed のある店の行は変えない。keyKpiStats は 1 回の描画で月ごとに 1 回だけ。合成データだけ（本番の数は使わない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.INDEX || new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function fnSrc(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let d = 0, k = html.indexOf('{', i);
  for (; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) break; } }
  return html.slice(i, k + 1);
}
function line(prefix, end = '\n') { const i = html.indexOf(prefix); assert.ok(i >= 0, prefix); return html.slice(i, html.indexOf(end, i) + end.length); }

// 合成の店の数（月ごと）。fc・labor は アプリの速報の率。
function stats(ym) {
  const m = Number(ym.slice(5));
  return { sales: 100000 + m * 1000, budget: 120000, guests: 4000, ppa: 25, opDays: 30, guestBudget: null, ppaBudget: null,
    repeatRate: null, repeatTgt: null, drinkRate: null, drinkTgt: null, fcRate: 31.5, laborRate: 38.2,
    fcBudgetRate: 30, laborBudgetRate: 35, misoRate: null, misoTgt: null, ikuraRate: null, ikuraTgt: null };
}
function load({ seed = {}, pub = {}, now = '2026-11-15' } = {}) {
  const calls = [];
  const store = { pl_public: pub };
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, RegExp, Date,
    t: (ja) => ja, escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtK: v => '$' + Math.round(v), ls: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d),
    guestCountType: () => 'guest', qbCanEdit: () => false, getKgiEdits: () => ({}),
    keyKpiStats: (stores, days) => { const ym = days[0].date.slice(0, 7); calls.push(ym); return stats(ym); },
    daysOfYm: ym => [{ date: ym + '-01' }],
    bizNow: () => new Date(now + 'T12:00:00'),
    k2ExplicitTarget: () => null, grMonthOf: () => null, getKpiManual: () => ({}), k2Period: ym => ym, _k2Num: () => null,
    _plPrevYear: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext([line('var MEET_KPI_DEF', '\n];'), line('var MEETING_KGI_SEED_UNTIL'), 'var MEETING_KGI_SEED = ' + JSON.stringify(seed) + ';',
    ...['_ymToOffset', '_meetKpiDef', 'getMeetThreshold', '_meetStatus', '_meetStatColor', '_meetStatTint', '_meetDiffStr',
      '_meetIsConfirmed', '_meetPlProv', '_meetConfirmSrc', '_meetConfirmBadge', '_meetPlKpi', '_meetConfirmState', '_meetApplyPl', '_meetYearMatrix'].map(fnSrc)].join('\n'), ctx);
  return Object.assign(ctx, { calls });
}
function rowsOf(h) {
  // 表の各行の最初のセル（KPI 名・目標・実績・速報）と、その行のセル
  return [...h.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
}
const kpiNames = h => rowsOf(h).map(r => r[0]).filter(x => /目標$/.test(x)).map(x => x.replace(/目標$/, '').trim());
const PUB = { '2026-09': { F06: { sales: 20000, cogs: 6000, payroll: 9000 } }, '2026-10': { F06: { sales: 60000, cogs: 18000, payroll: 21000, prov: 1 } } };

test('版：APP_VERSION と SW_BUILD は 1174 以上で同じ', () => {
  const a = Number((/const APP_VERSION = '(\d+)';/.exec(html) || [])[1]), b = Number((/const SW_BUILD = '(\d+)';/.exec(sw) || [])[1]);
  assert.ok(a >= 1174, String(a)); assert.equal(a, b);
});

test('seed の無い店（LaLa）：原価率・人件費率の行が出て、会計 PL の 9・10 月の率に PL の印', () => {
  const c = load({ pub: PUB });
  const h = c._meetYearMatrix({ id: 'F06', name: 'LaLa' }, 2026);
  const names = kpiNames(h);
  assert.ok(names.some(x => /売上/.test(x)), names.join(','));
  assert.ok(names.some(x => /原価率/.test(x)), '原価率の行 ' + names.join(','));
  assert.ok(names.some(x => /人件費率/.test(x)), '人件費率の行 ' + names.join(','));
  // 目標か実績が無い KPI（リピート率・ドリンク比率・アップグレード率など）は出さない
  assert.ok(!names.some(x => /リピート|ドリンク|アップグレード|いくら/.test(x)), names.join(','));
  const rows = rowsOf(h);
  const fcAct = rows[rows.findIndex(r => /原価率/.test(r[0])) + 1];
  assert.equal(fcAct[0], '実績');
  assert.match(fcAct[9], /^30% ?PL/, '9 月の原価率は PL の 6000/20000');
  assert.match(fcAct[10], /^30% ?PL/, '10 月の原価率は PL の 18000/60000');
  assert.match(fcAct[8], /^31\.5%/, '8 月は PL が無いのでアプリの速報');
  const lbAct = rows[rows.findIndex(r => /人件費率/.test(r[0])) + 1];
  assert.match(lbAct[9], /^45% ?PL/);
  assert.match(lbAct[10], /^35% ?PL/);
  // 月の下の印：9 月は確定・10 月は暫定（ファイル名に「暫定」のある PL から）
  const head = rowsOf(h)[0];
  assert.match(head[9], /確定/); assert.match(head[10], /暫定/);
});

test('seed のある店：行は今までどおり（seed の KPI と売上・客数・客単価・Google だけ）', () => {
  const seed = { F01: { sales: { t: Array(12).fill(1), a: Array(12).fill(1) }, repeat: { t: Array(12).fill(60), a: Array(12).fill(null) } } };
  const c = load({ seed, pub: PUB });
  const names = kpiNames(c._meetYearMatrix({ id: 'F01', name: 'ToriTon' }, 2026));
  assert.deepEqual(names.map(x => x.replace(/\s/g, '')), ['売上', '客数', '客単価', 'リピート率', 'Googleレビュー'].map(x => x));
});

test('keyKpiStats は 1 回の描画で月ごとに 1 回だけ', () => {
  const c = load({ pub: PUB });
  c._meetYearMatrix({ id: 'F06', name: 'LaLa' }, 2026);
  const per = {}; c.calls.forEach(ym => { per[ym] = (per[ym] || 0) + 1; });
  assert.ok(Object.values(per).every(n => n === 1), JSON.stringify(per));
  assert.ok(c.calls.length <= 12, String(c.calls.length));
});

test('seed の無い店で 7 月以降に目標も実績も無い KPI は出さない（行を増やしすぎない）', () => {
  const c = load({ pub: {} });
  c.keyKpiStats = () => Object.assign(stats('2026-08'), { fcRate: null, laborRate: null, fcBudgetRate: null, laborBudgetRate: null });
  const names = kpiNames(c._meetYearMatrix({ id: 'F06', name: 'LaLa' }, 2026));
  assert.ok(!names.some(x => /原価率|人件費率/.test(x)), names.join(','));
});
