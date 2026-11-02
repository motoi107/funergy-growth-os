// v1129（LaLa の依頼 10/31）：リピート率の「本当の 0%（初回だけでリピート 0）」と「データなし」を分ける。index.html の本物の関数を VM で。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fn = name => { let i = html.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); return html.slice(i + 1, html.indexOf('\n}', i + 1) + 2); };
function ctx(extra) {
  const c = Object.assign({ t: (ja, en) => ja, escapeHtml: s => String(s), ls: (k, d) => d, fmtUSD2: v => '$' + v, fmtK: v => String(v), CH: { H: 140 },
    _meetKpiDef: () => ({ label: 'リピート率', labelEn: 'Repeat', icon: 'ti-repeat', lower: false, defG: 100, defY: 90 }), _meetInputBlock: () => '', _msEmpty: () => 'EMPTY',
    _msX: (W, n) => ({ x0: 30, y1: 120, top: 10, slot: (W - 40) / n }) }, extra || {});
  vm.createContext(c);
  for (const n of ['getMeetThreshold', '_meetStatus', '_meetJudge', '_meetDiffStr', '_meetStatColor', '_meetStatTint', '_meetStatLabel', '_meetKpiTile', 'mrJudgeOf', '_msLDLine', 'repeatStats'])
    vm.runInContext(fn(n), c);
  vm.runInContext('var MR_LOWER = { fc:true, labor:true };', c);
  return c;
}

test('リピート率の 0% は「未達」、データなし（null）は判定しない。ほかの KPI の 0 は今までどおり', () => {
  const c = ctx();
  assert.equal(c._meetStatus('repeat', 0, 35, false), 'miss');
  assert.equal(c._meetStatus('repeat', null, 35, false), 'none');
  assert.equal(c._meetStatus('repeat', 40, 35, false), 'ok');
  assert.equal(c._meetStatus('fc', 0, 30, true), 'none', '原価率の 0 はデータなし（今までどおり）');
  assert.equal(c._meetStatus('guests', 0, 100, false), 'none');
  assert.equal(c._meetJudge({ key: 'repeat', act: 0, tgt: 35 }), false);
  assert.equal(c._meetJudge({ key: 'repeat', act: null, tgt: 35 }), null);
  assert.equal(c.mrJudgeOf('repeat', 0, 35), 'miss', '中間レビュー：本当の 0% は「データなし」ではなく未達');
  assert.equal(c.mrJudgeOf('repeat', null, 35), 'missing');
  assert.equal(c.mrJudgeOf('repeat', 0, null), 'unset');
  assert.equal(c.mrJudgeOf('labor', 0, 28), 'missing');
  assert.equal(c._meetDiffStr('repeat', 0, 35, false, '%', false), '−35pt');
  assert.equal(c._meetDiffStr('repeat', null, 35, false, '%', false), '');
});

test('会議タブのリピート率のタイル：0% は 0%、データなしは —', () => {
  const c = ctx();
  const zero = c._meetKpiTile('F06', '2026-10', 'repeat', 0, 35, { unit: '%' });
  assert.match(zero, />0%<\/span>/);
  assert.match(zero, /未達/);
  const none = c._meetKpiTile('F06', '2026-10', 'repeat', null, 35, { unit: '%' });
  assert.match(none, />—<\/span>/);
  assert.ok(!/未達/.test(none));
  assert.match(html, /_meetKpiTile\(store\.id, ym, it\.key, \(it\.key==='repeat' && it\.act==null\) \? null : \(it\.act\|\|0\)/, '呼ぶ所でデータなしを 0 にしない');
});

test('ランチ／ディナー別のグラフ：データの無い点は描かない（0% にしない）。全部 0% なら 0% の線を描く', () => {
  const c = ctx();
  const svg = c._msLDLine(['1', '2', '3'], [{ label: 'L', color: 'Y', values: [null, null, null] }, { label: 'D', color: 'A', values: [10, null, 20] }]);
  assert.equal((svg.match(/<circle/g) || []).length, 2, 'データのある 2 点だけ');
  assert.equal((svg.match(/<polyline/g) || []).length, 0, '間にデータの無い点があれば線をつながない');
  assert.equal(c._msLDLine(['1'], [{ values: [null] }]), 'EMPTY');
  const zeros = c._msLDLine(['1', '2'], [{ color: 'A', values: [0, 0] }]);
  assert.notEqual(zeros, 'EMPTY', '本当の 0% は空にしない');
  assert.equal((zeros.match(/<circle/g) || []).length, 2);
  assert.match(html, /return t>0\?Math\.round\(p\.ld\.lunch\.repeat\/t\*1000\)\/10:null;/);
});

test('リピート率の式：期間の数を足してから割る（RP の数に SR を含む前提）。0 件はデータなし', () => {
  const days = [{ date: '2026-10-01' }, { date: '2026-10-02' }];
  const run = rows => { const c = ctx({ _daRO: () => rows }); return c.repeatStats([{ id: 'F06' }], days); };
  /* FT 20・RP 12・SR 8：repeat_count は RP＋SR＝20（取込の前提・hyper-worker で確かめる） */
  let s = run({ '2026-10-01': { firstTimeBowls: 15, repeatBowls: 5, superRegular: 3 }, '2026-10-02': { firstTimeBowls: 5, repeatBowls: 15, superRegular: 5 } });
  assert.deepEqual([s.first, s.repeat, s.sr, s.total], [20, 20, 8, 40]);
  assert.equal(Math.round(s.repeat / s.total * 1000) / 10, 50, 'FT 20・RP 12・SR 8 → 50%');
  /* 日ごと 10% と 0% → 日ごとの率の平均なら 5%。合計から 2/(20+2)=9.1% */
  s = run({ '2026-10-01': { firstTimeBowls: 18, repeatBowls: 2 }, '2026-10-02': { firstTimeBowls: 2, repeatBowls: 0 } });
  assert.equal(Math.round(s.repeat / s.total * 1000) / 10, 9.1);
  /* FT 20・RP＋SR 0 → 0%（データあり） */
  s = run({ '2026-10-01': { firstTimeBowls: 20, repeatBowls: 0, superRegular: 0 } });
  assert.equal(s.has && s.total > 0, true); assert.equal(Math.round(s.repeat / s.total * 1000) / 10, 0);
  /* FT＝RP＝SR＝0 → 対象データなし（画面は率を出さない） */
  s = run({ '2026-10-01': { firstTimeBowls: 0, repeatBowls: 0, superRegular: 0 } });
  assert.equal(s.total, 0);
  /* 取込の行が無い → データなし */
  s = run({});
  assert.equal(s.has, false);
});
