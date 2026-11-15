// v1172：点検一覧（docs/PC_SP_INVENTORY_JA.csv）を、v1172 で測り直した値で更新する（合成データ・模擬サーバー・GM の表示）
// 使い方：node update_v1172.mjs <inventory.csv> <after_pc1440.json> <after_sp390.json> > new.csv
// ・測り直した行（GM・同じ画面への経路）は、v1172 の値で「対応状況」「検証結果」を決め、「現状の問題」は v1171 のときと v1172 の残りを並べる
// ・押すところの残り（となりと近い・文中のリンク・表の中）は「改修済み」の行にも数を残す（UI案82 の 5：見た目は変えず押せる範囲だけ）
// ・測り直していない行（G3・G1 の表示・開いていない箱・共通の行）はそのまま（共通の行は別に書く）
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [csvPath, pcPath, spPath] = process.argv.slice(2);
const here = new URL('.', import.meta.url).pathname;
const parse = (txt) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < txt.length; i++) { const c = txt[i];
  if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
  else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  if (cur.length || row.length) { row.push(cur); rows.push(row); } return rows; };
const csv = parse(fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
const head = csv[0]; const H = k => head.indexOf(k);
const after = JSON.parse(execFileSync('node', [here + 'analyze.mjs', pcPath, spPath], { maxBuffer: 1 << 28 }).toString());
const byPath = new Map(after.filter(r => r.who.startsWith('GM')).map(r => [r.path, r]));
const isTap = s => /押すところ/.test(s);
let changed = 0; const cnt = {};
for (const r of csv.slice(1)) {
  if (r.length < head.length) continue;
  const a = byPath.get(r[H('画面への経路')]);
  if (!a || !r[H('見た役割')].startsWith('GM') || r[H('対応状況')] === '未検証') { cnt[r[H('対応状況')]] = (cnt[r[H('対応状況')]] || 0) + 1; continue; }
  const pcLeft = a.pc, spLeft = a.sp.filter(s => !isTap(s)), taps = a.sp.filter(isTap);
  const before = r[H('対応状況')];
  let st;
  if (!pcLeft.length && !spLeft.length) st = before === '点検済み・改修不要' ? before : '改修済み';
  else st = '未対応';
  const m = a.metrics, sp = m.sp;
  const left = [pcLeft.length ? 'PC：' + pcLeft.join('・') : '', spLeft.length ? 'スマホ：' + spLeft.join('・') : ''].filter(Boolean).join('／');
  const huge = sp && (sp.win || sp.tapTotal > 1500);   /* 要素がとても多い画面（2 万より多い）：アプリは見えている所の上下 1 画面だけを直す。ここの数はページ全体 */
  r[H('現状の問題')] = 'v1171：' + r[H('現状の問題')].replace(/^v1171：/, '') + (left ? '　→ v1172 の残り：' + left : '　→ v1172：解消' + (taps.length ? '（押すところは押せる範囲を広げた。広げられない分は「検証結果」）' : ''));
  r[H('対応状況')] = st;
  r[H('検証結果')] = `v1172（合成データ・GM）1440：主の幅 ${m.pc.mainW}px・横はみ出し ${m.pc.docOv > 2 ? '+' + m.pc.docOv : 'なし'}・枠の中で横に送る表 ${m.pc.tablesScroll}` +
    (sp ? `／390：横はみ出し ${sp.docOv > 2 ? '+' + sp.docOv : 'なし'}・44px に届かない押すところ ${sp.tapSmall}/${sp.tapTotal}（となりと近い・文中のリンク・表の中）・11px 未満の文字 ${sp.fontSmall}${sp.fontSmall && !huge ? '（グラフの中の文字）' : ''}・表の固定 ${sp.stick1 || 0}${sp.mfull ? '・全画面の箱' : ''}${huge ? '（とても大きい画面：アプリは見えている所の上下 1 画面だけを直し、スクロールが止まったら見直す。この数はページ全体）' : ''}` : '／390：測れず');
  if (taps.length && st === '改修済み') r[H('検証結果')] += '　残り：' + taps.join('・');
  changed++; cnt[st] = (cnt[st] || 0) + 1;
}
const esc = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
process.stdout.write('﻿' + csv.filter(r => r.length >= head.length).map(r => r.map(esc).join(',')).join('\n'));
console.error('updated', changed, JSON.stringify(cnt));
