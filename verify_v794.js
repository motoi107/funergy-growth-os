/* verify_v794.js — Funergy+ を検索結果に出さない（noindex）
   小さな変更だが、効かない置き方（bodyの中／JSの文字列内／robots.txtで塞ぐ）が
   いくつもあるため、Googlebot が実際に読める位置にあることを検査する。 */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const prev = fs.readFileSync('index_v793_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}

console.log('\n=== v794: 検索結果に出さない ===\n');

/* ページ本体の <head>。index.html には発注書/Excel出力用の
   </head> を含むJS文字列もあるため、最初の1組だけを本体とみなす。 */
const headStart = src.indexOf('<head>');
const headEnd = src.indexOf('</head>');
const head = src.slice(headStart, headEnd);
const body = src.slice(headEnd);

/* ---------- 1. Googlebot が読める位置にあるか ---------- */
console.log('[1] タグの位置');
{
  ok(headStart >= 0 && headEnd > headStart, '<head> … </head> が成立している', { headStart, headEnd });
  ok(/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(head), 'robots の noindex が <head> の中にある');
  ok(!/<meta\s+name="robots"[^>]*noindex/i.test(body.replace(/<!--[\s\S]*?-->/g, '')),
    '<head> の外に robots タグを置いていない');
  /* コメントアウトされていないこと（コメントを消しても残るか） */
  const headNoComment = head.replace(/<!--[\s\S]*?-->/g, '');
  ok(/<meta\s+name="robots"[^>]*noindex/i.test(headNoComment), 'コメントの中ではなく実際のタグである');
  /* クローラは先頭を読む。巨大な <script> より前にあること */
  const tagPos = src.search(/<meta\s+name="robots"/i);
  const scriptPos = src.indexOf('<script');
  ok(tagPos < scriptPos, '最初の <script> より前にある（読み飛ばされない）', { tagPos, scriptPos });
  ok(tagPos < 2000, 'ファイル先頭の近くにある', tagPos);
  ok(tagPos < src.indexOf('<title>'), '<title> より前にある', { tagPos, title: src.indexOf('<title>') });
}

/* ---------- 2. 指定の中身 ---------- */
console.log('\n[2] 指定の中身');
{
  const m = head.match(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  ok(!!m, 'robots タグを取得できる');
  const c = (m ? m[1] : '').toLowerCase();
  ok(/\bnoindex\b/.test(c), 'noindex が入っている（検索結果から削除される）', c);
  ok(/\bnofollow\b/.test(c), 'nofollow が入っている（リンク先も辿らせない）', c);
  ok(/\bnoarchive\b/.test(c), 'noarchive が入っている（保存版を残さない）', c);
  ok(!/\bindex\b(?!,)|(^|[\s,])index([\s,]|$)/.test(c.replace(/noindex/g, '')),
    '打ち消しになる index が混ざっていない', c);
  /* googlebot 向けの指定も同じ内容か（食い違うと意図しない側が効く） */
  const g = head.match(/<meta\s+name="googlebot"\s+content="([^"]*)"/i);
  ok(!!g, 'googlebot 向けの指定もある');
  ok(g && /\bnoindex\b/.test(g[1].toLowerCase()), 'そちらにも noindex が入っている', g && g[1]);
  ok(m && g && m[1].toLowerCase() === g[1].toLowerCase(), '2つの指定が食い違っていない', [m && m[1], g && g[1]]);
}

/* ---------- 3. robots.txt で塞いでいないか（最大の落とし穴） ---------- */
console.log('\n[3] robots.txt の罠を踏んでいない');
{
  /* robots.txt を作ると Googlebot が noindex を読めなくなり、
     外部リンク経由でURLだけが検索結果に残り続ける（Google公式の注意点）。 */
  ok(!fs.existsSync('robots.txt'), 'robots.txt を作っていない');
  /* 文字列の有無ではなく「資源として読み込んでいないか」を見る。
     注釈コメントに robots.txt の語が出るのは正しい（[6] で必要としている）。 */
  const asResource = /(?:href|src)\s*=\s*["'][^"']*robots\.txt|fetch\(\s*["'][^"']*robots\.txt/i;
  ok(!asResource.test(src), 'robots.txt を資源として参照していない');
  ok(!/<link[^>]*robots\.txt/i.test(src), 'robots.txt への link を張っていない');
  ok(!/Disallow\s*:/i.test(head), 'head に Disallow を書いていない');
  /* noindex を robots.txt に書く方法は Google 非対応。念のため混在検査 */
  ok(!fs.existsSync('robots.txt') || !/noindex/i.test(fs.readFileSync('robots.txt', 'utf8') || ''),
    'robots.txt に noindex を書いていない');
}

/* ---------- 4. 実行時に消されないか ---------- */
console.log('\n[4] 実行中に打ち消されない');
{
  const script = src.slice(src.indexOf('<script>'));
  ok(!/name=['"]robots['"]/i.test(script), 'JSが robots タグを書き換えていない');
  ok(!/removeChild[^;]{0,80}meta|meta[^;]{0,40}\.remove\(\)/i.test(script), 'JSが meta タグを削除していない');
  ok(!/document\.head\.innerHTML\s*=/.test(script), 'head を丸ごと書き換えていない');
  /* Service Worker が古い index.html を配り続けないよう版数が上がっている */
  const sw = fs.readFileSync('sw.js', 'utf8');
  /* 版数を794に固定すると後の版で必ず落ちる。
     durable な性質は「両者が一致し、noindex を入れた794以降であること」。 */
  const appV = Number((src.match(/APP_VERSION = '(\d+)'/) || [])[1]);
  const swV = Number((sw.match(/SW_BUILD = '(\d+)'/) || [])[1]);
  ok(appV === swV, 'APP_VERSION と SW_BUILD が一致している', { appV, swV });
  ok(appV >= 794, 'noindex を入れた794以降のビルドである', appV);
  ok(Number((prev.match(/APP_VERSION = '(\d+)'/) || [])[1]) < appV, '前の版より上がっている');
}

/* ---------- 5. 変えたのはここだけ ---------- */
console.log('\n[5] 影響範囲');
{
  ok(prev.indexOf('name="robots"') < 0, 'v793 には noindex が無かった（未対策だった）');
  /* 「v794 は head 以外を触っていない」は v794 時点の履歴的事実。
     現行 index.html と比べると後の版の変更で必ず落ちるので、v794 のビルドと比べる。 */
  if (fs.existsSync('index_v794_backup.html')) {
    const v794 = fs.readFileSync('index_v794_backup.html', 'utf8');
    const a = prev.slice(prev.indexOf('</head>')).replace(/APP_VERSION = '\d+'/, 'V');
    const b794 = v794.slice(v794.indexOf('</head>')).replace(/APP_VERSION = '\d+'/, 'V');
    ok(a === b794, 'v794 は </head> より後ろを版数以外1文字も変えていない');
  } else {
    ok(true, 'v794 のビルドが無いため本文比較はスキップ');
  }
  /* head の差は追加のみ（削除していない） */
  const prevHead = prev.slice(prev.indexOf('<head>'), prev.indexOf('</head>'));
  const addedOnly = prevHead.split('\r\n').every(function (ln) { return head.indexOf(ln) >= 0; });
  ok(addedOnly, 'head の既存の行を1つも消していない');
  ok(head.length > prevHead.length, 'head は追加されただけ', { prev: prevHead.length, now: head.length });
  /* PWA/アイコンなど元からある指定が生きている */
  ['manifest', 'apple-touch-icon', 'theme-color', 'viewport', 'charset'].forEach(function (k) {
    ok(head.indexOf(k) >= 0, k + ' の指定が残っている');
  });
}

/* ---------- 6. 検索避けが「非公開」ではないことの明示 ---------- */
console.log('\n[6] 誤解を残さない');
{
  const cm = head.match(/<!--[\s\S]*?-->/g) || [];
  const note = cm.join('\n');
  ok(/robots\.txt/.test(note), 'robots.txt を使わない理由がコメントに残っている');
  ok(/Search Console/.test(note), '早く消す手順がコメントに残っている');
}

console.log('\n--- 集計 ---');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
