/* verify_v887.js — シフトリーダー支給額まわりの構造チェック。
   バージョンはファイルから読む。各チェックは個別に try/catch する。 */
const fs = require('fs');
const utf = fs.readFileSync('index.html', 'utf8');
const src = fs.readFileSync('index.html', 'latin1');
const sw = fs.readFileSync('sw.js', 'utf8');

let PASS = 0, FAIL = 0;
function chk(name, fn) {
  try {
    const r = fn();
    if (r === true) { PASS++; console.log('  PASS  ' + name); }
    else { FAIL++; console.log('  FAIL  ' + name + (r ? '  → ' + r : '')); }
  } catch (e) { FAIL++; console.log('  FAIL  ' + name + '  → 例外: ' + (e && e.message)); }
}

const APP = (utf.match(/const APP_VERSION = '(\d+)'/) || [])[1];
const SWB = (sw.match(/const SW_BUILD = '(\d+)'/) || [])[1];
console.log('APP_VERSION=' + APP + '  SW_BUILD=' + SWB + '\n');

chk('APP_VERSION と SW_BUILD が一致', () => APP === SWB || ('APP=' + APP + ' SW=' + SWB));
chk('lone LF = 0', () => {
  const crlf = (src.match(/\r\n/g) || []).length, lf = (src.match(/\n/g) || []).length;
  return lf - crlf === 0 || ('lone LF=' + (lf - crlf));
});

/* ---------- 1. 関数が揃っているか ---------- */
['slPayrollData', 'slPayrollRows', 'exportSlPayrollCSV', 'exportAllSlPayrollCSV', '_slRecLabel']
  .forEach(f => chk('定義がある: ' + f, () =>
    new RegExp('function\\s+' + f + '\\s*\\(').test(utf) || '未定義'));

/* ---------- 2. 金額は slPeriodSummary が唯一の正 ---------- */
chk('slPayrollData が slPeriodSummary を使っている', () => {
  const b = (utf.match(/function slPayrollData\([\s\S]*?\n\}/) || [''])[0];
  return /slPeriodSummary\(/.test(b) || '別の計算をしている（画面とCSVがずれる）';
});
chk('slPayrollData が制度対象外の店を塞いでいる', () => {
  const b = (utf.match(/function slPayrollData\([\s\S]*?\n\}/) || [''])[0];
  return /slStoreEnabled\(/.test(b) || '対象外の店にも金額が出る';
});
chk('金額の出る経路で slCountsInRange を使っていない', () => {
  /* コメント内の言及を数えないよう、先にコメントを落としてから数える */
  const code = utf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = [...code.matchAll(/slCountsInRange\s*\(/g)].length;
  return calls <= 1 || ('呼び出しが ' + calls + ' 箇所（定義の1つだけであるべき）');
});
chk('slCountsInRange に注意書きがある', () =>
  /金額を出す用途には使わないこと/.test(utf) || '再利用されると単価なしで money 経路に戻る');

/* ---------- 3. CSV に単価と支給額が載っているか ---------- */
chk('専用CSVに 単価/支給額/該当日 の列がある', () => {
  const b = (utf.match(/function slPayrollRows\([\s\S]*?\n\}/) || [''])[0];
  return ['単価($)', '支給額($)', '該当日'].every(k => b.indexOf(k) >= 0) || '列が足りない';
});
chk('専用CSVに合計行がある', () => {
  const b = (utf.match(/function slPayrollRows\([\s\S]*?\n\}/) || [''])[0];
  return /rows\.push\(\['合計'/.test(b) || '合計行が無い';
});
chk('専用CSVに対象外の注記がある', () => {
  const b = (utf.match(/function slPayrollRows\([\s\S]*?\n\}/) || [''])[0];
  return /【対象外】/.test(b) || '誰が外れたか分からない';
});

/* Tip一覧CSV：列数が全行で揃っているか（ここがずれると Excel で列が1つ横に流れる） */
function topLevelCount(txt) {
  let depth = 0, n = 1;
  for (const ch of txt) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}
chk('Tip一覧CSV の列数が全行で揃っている', () => {
  const blk = (utf.match(/rows\.push\(\['氏名','区分','労働時間'[\s\S]*?return rows;/) || [''])[0];
  const counts = [...blk.matchAll(/rows\.push\(\[([^\[\]]*(?:\[[^\]]*\][^\[\]]*)*)\]\)/g)]
    .map(m => topLevelCount(m[1])).filter(n => n > 1);
  const uniq = [...new Set(counts)];
  return (uniq.length === 1 && uniq[0] === 13) || ('列数=' + uniq.join('/') + '（13で揃うべき）');
});
chk('Tip一覧CSV に シフトリーダー 単価/手当 の列がある', () => {
  const blk = (utf.match(/rows\.push\(\['氏名','区分','労働時間'[\s\S]*?return rows;/) || [''])[0];
  return ['シフトリーダー 単価($)', 'シフトリーダー 手当($)', '受取＋手当($)']
    .every(k => blk.indexOf(k) >= 0) || '列が足りない';
});
chk('Tip一覧CSV が支給明細ブロックも付ける', () => {
  const blk = (utf.match(/rows\.push\(\['氏名','区分','労働時間'[\s\S]*?return rows;/) || [''])[0];
  return /slPayrollRows\(/.test(blk) || '該当日つきの明細が付かない';
});

/* 配分表CSV：ヘッダーの push 数と本文の push 数が同じか */
chk('配分表CSV のヘッダーと本文の列数が同じ', () => {
  const blk = (utf.match(/rows\.push\(\['【シフトリーダー】'[\s\S]*?rows\.push\(_slTot\);/) || [''])[0];
  if (!blk) return 'ブロックが見つからない';
  /* ヘッダー・本文・合計はどれも「日付ループ2つ ＋ 期間合計/単価/支給額の3つ」。
     3つの push 数が揃っていれば列はずれない。 */
  const head = (blk.match(/_slHead\.push\(/g) || []).length;
  const body = (blk.match(/row\.push\(/g) || []).length;
  const tot = (blk.match(/_slTot\.push\(/g) || []).length;
  return (head === body && body === tot && head === 5)
    || ('head=' + head + ' body=' + body + ' tot=' + tot + '（5で揃うべき）');
});
chk('配分表CSV に合計行がある', () => /rows\.push\(_slTot\);/.test(utf) || '合計行が無い');

/* ---------- 4. 画面・出力センター ---------- */
chk('シフトリーダー画面に支給明細がある', () => {
  const b = (utf.match(/function renderTipShiftLeader\(\)\{[\s\S]*?\nvar slHalf/) || [''])[0];
  return /支給明細/.test(b) || '誰にいくらが画面に出ない';
});
chk('シフトリーダー画面にCSV出力ボタンがある', () => {
  const b = (utf.match(/function renderTipShiftLeader\(\)\{[\s\S]*?\nvar slHalf/) || [''])[0];
  return /exportSlPayrollCSV\(/.test(b) || '画面から出力できない';
});
chk('シフトリーダー画面に色とアイコンが入っている', () => {
  const b = (utf.match(/function renderTipShiftLeader\(\)\{[\s\S]*?\nvar slHalf/) || [''])[0];
  const icons = ['ti-cash-banknote', 'ti-crown', 'ti-sun', 'ti-moon', 'ti-users', 'ti-sum'];
  const cols = ['var(--green)', 'var(--accent)', 'var(--accent2)'];
  const mi = icons.filter(x => b.indexOf(x) < 0), mc = cols.filter(x => b.indexOf(x) < 0);
  return (!mi.length && !mc.length) || ('欠け icon=' + mi.join(',') + ' color=' + mc.join(','));
});
chk('出力センターにシフトリーダー手当カードがある', () => {
  const b = (utf.match(/function renderAcctExport\(\)[\s\S]*?\n\}/) || [''])[0];
  return /シフトリーダー手当/.test(b) && /exportAllSlPayrollCSV\(/.test(b) || 'カードまたは全店出力が無い';
});
chk('出力センターが制度対象店だけ出す', () => {
  const b = (utf.match(/function renderAcctExport\(\)[\s\S]*?\n\}/) || [''])[0];
  return /_slStores = stores\.filter/.test(b) && /slStoreEnabled\(s\.id\)/.test(b)
    || '対象外の店にも支給カードが出る';
});

console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL);
process.exit(FAIL ? 1 : 0);
