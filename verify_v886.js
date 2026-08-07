/* verify_v886.js — 経理センターの登録漏れ・未定義参照を機械的に見張る。
   バージョン番号はファイルから読む（ピン留めしない）。
   各チェックは個別に try/catch する（1つの例外で PASS=0 にしない）。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'latin1');   // バイト保持
const utf = fs.readFileSync('index.html', 'utf8');
const sw  = fs.readFileSync('sw.js', 'utf8');

let PASS = 0, FAIL = 0;
function chk(name, fn) {
  try {
    const r = fn();
    if (r === true) { PASS++; console.log('  PASS  ' + name); }
    else { FAIL++; console.log('  FAIL  ' + name + (r ? '  → ' + r : '')); }
  } catch (e) { FAIL++; console.log('  FAIL  ' + name + '  → 例外: ' + (e && e.message)); }
}

/* ---------- 0. 版とバイト衛生 ---------- */
const APP = (utf.match(/const APP_VERSION = '(\d+)'/) || [])[1];
const SWB = (sw.match(/const SW_BUILD = '(\d+)'/) || [])[1];
console.log('APP_VERSION=' + APP + '  SW_BUILD=' + SWB + '\n');

chk('APP_VERSION と SW_BUILD が一致', () => APP === SWB || ('APP=' + APP + ' SW=' + SWB));
chk('lone LF = 0', () => {
  const crlf = (src.match(/\r\n/g) || []).length, lf = (src.match(/\n/g) || []).length;
  return lf - crlf === 0 || ('lone LF=' + (lf - crlf));
});

/* ---------- 1. 新ページの登録先ぜんぶ（HANDOFF 第3章の表） ---------- */
const PAGE = 'acct_center';
chk("renderPage の switch に case がある", () => new RegExp("case '" + PAGE + "'").test(utf));
chk("NAV_ITEMS に登録",        () => new RegExp("\\b" + PAGE + "\\s*:\\s*\\{").test(utf) || utf.includes("'" + PAGE + "':"));
chk("MENU_GROUPS の children", () => /children:\[[^\]]*'acct_center'/.test(utf.replace(/\s+/g, ' ')));
chk("OFFICE_GROUPS の children", () => {
  const m = utf.match(/const OFFICE_GROUPS = \[[\s\S]*?\n\]/);
  return (m && m[0].includes("'" + PAGE + "'")) || 'OFFICE_GROUPS に無い';
});
chk("OFFICE_OK_PAGES に登録", () => {
  const m = utf.match(/var OFFICE_OK_PAGES = \[[\s\S]*?\];/);
  return (m && m[0].includes("'" + PAGE + "'")) || 'OFFICE_OK_PAGES に無い';
});
chk("SKEL_LIGHT_PAGES に登録", () => {
  const m = utf.match(/var SKEL_LIGHT_PAGES = \{[^}]*\}/);
  return (m && m[0].includes(PAGE)) || 'SKEL_LIGHT_PAGES に無い（起動直後だけ反応しない）';
});

/* ---------- 2. 経理センターが参照する識別子が全部定義されているか ---------- */
const NEEDED = ['AC_TABS', '_acCat', '_acSub', '_acF', 'AC_ST'];
NEEDED.forEach(id => chk('宣言がある: ' + id, () =>
  new RegExp('\\b(var|let|const|function)\\s+' + id + '\\b').test(utf) || '未定義（実行時 ReferenceError）'));

/* ---------- 3. AC_TABS の中身を実際に評価して整合を見る ---------- */
let TABS = null;
chk('AC_TABS を評価できる', () => {
  const m = utf.match(/var AC_TABS = (\[[\s\S]*?\n\];)/);
  if (!m) return 'AC_TABS の定義が見つからない';
  TABS = new Function('return ' + m[1].replace(/;$/, ''))();
  return Array.isArray(TABS) && TABS.length > 0 || '配列でない';
});

chk('大タブは6つ', () => { if (!TABS) return '未評価'; return TABS.length === 6 || ('実際=' + TABS.length); });
chk('既定の _acCat / _acSub が AC_TABS に存在する', () => {
  if (!TABS) return '未評価';
  const c = TABS.find(x => x.id === 'dash');
  if (!c) return "id='dash' の大タブが無い（起動時に fallback される）";
  return !!c.subs.find(s => s.id === 'dash') || "dash に id='dash' の中タブが無い";
});
chk('経理レビューの中タブは13', () => {
  if (!TABS) return '未評価';
  const c = TABS.find(x => x.id === 'review');
  return (c && c.subs.length === 13) || ('実際=' + (c ? c.subs.length : 'なし'));
});
chk('sub.id が重複していない', () => {
  if (!TABS) return '未評価';
  const seen = {}, dup = [];
  TABS.forEach(c => c.subs.forEach(s => { if (seen[s.id]) dup.push(s.id); seen[s.id] = 1; }));
  return dup.length === 0 || ('重複: ' + dup.join(','));
});

/* _acPend が返す sub は必ず AC_TABS に存在すること（バッジの飛び先） */
chk('_acPend の飛び先が全部存在する', () => {
  if (!TABS) return '未評価';
  const body = (utf.match(/function _acPend\(\)\{[\s\S]*?\n\}/) || [''])[0];
  const wants = [...body.matchAll(/add\('([a-z_]+)'/g)].map(m => m[1]);
  const have = {}; TABS.forEach(c => c.subs.forEach(s => have[s.id] = 1));
  const miss = [...new Set(wants)].filter(w => !have[w]);
  return miss.length === 0 || ('AC_TABS に無い sub.id: ' + miss.join(','));
});

/* sub.list は _acRows が受け取る kind のみ */
chk('sub.list が _acRows の対応 kind だけ', () => {
  if (!TABS) return '未評価';
  const body = (utf.match(/function _acRows\(kind\)\{[\s\S]*?\n\}/) || [''])[0];
  const kinds = [...body.matchAll(/kind===?'([a-z_]+)'/g)].map(m => m[1]);
  const bad = [];
  TABS.forEach(c => c.subs.forEach(s => { if (s.list && kinds.indexOf(s.list) < 0) bad.push(s.id + ':' + s.list); }));
  return bad.length === 0 || ('_acRows が知らない kind: ' + bad.join(','));
});

/* fn / more で指す関数が実在するか。無いと黙って空表示になる */
chk('sub.fn / sub.more の関数が実在する', () => {
  if (!TABS) return '未評価';
  const miss = [];
  TABS.forEach(c => c.subs.forEach(s => {
    [s.fn, s.more].forEach(n => {
      if (n && !new RegExp('function\\s+' + n + '\\s*\\(').test(utf)) miss.push(s.id + '→' + n);
    });
  }));
  return miss.length === 0 || ('未定義: ' + miss.join(', '));
});

/* 引数が必要な関数を素で載せていないか（window[fn]() は引数なし呼び出し） */
chk('引数が要る関数を直接載せていない', () => {
  if (!TABS) return '未評価';
  const bad = [];
  TABS.forEach(c => c.subs.forEach(s => {
    [s.fn, s.more].forEach(n => {
      if (!n) return;
      const m = utf.match(new RegExp('function\\s+' + n + '\\s*\\(([^)]*)\\)'));
      if (m && m[1].trim()) bad.push(s.id + '→' + n + '(' + m[1].trim() + ')');
    });
  }));
  return bad.length === 0 || ('要ラッパー: ' + bad.join(', '));
});

/* ---------- 4. 描画失敗が画面に出るか ---------- */
chk("case 'acct_center' が try/catch で包まれている", () => {
  const m = utf.match(/case 'acct_center':[\s\S]{0,900}?break;/);
  return (m && /try\s*\{[\s\S]*?catch/.test(m[0])) || '未包装（落ちると前の画面が残る）';
});

console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL);
process.exit(FAIL ? 1 : 0);
