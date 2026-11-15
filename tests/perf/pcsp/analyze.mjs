// 棚卸し：測った値から、画面ごとの「今の問題」「PC での対応」「スマホでの対応」「状況」「検証」を作る
// 使い方：node analyze.mjs <pc.json> <sp.json> [<pc.json> <sp.json> ...]（WHO・STORE の組ごと）> rows.json
import fs from 'node:fs';
const { names, groups } = JSON.parse(fs.readFileSync((process.env.PCSP_DIR || '/tmp/pcsp') + '/names.json', 'utf8'));
const EXTRA = {
  lunch_challenge: ['ダッシュボード', 'ランチチャレンジ', 'マイページ・店舗オペレーションのカードから（Tenkichi）'],
  store_ops_settings: ['ダッシュボード', '店舗オペレーションの設定', '店舗オペレーション › 設定'],
  monthly: ['経理センター', '月次サマリー', '経理センター／経理メニュー › 月次サマリー'],
  store_power: ['ダッシュボード', '店舗総合力', 'ナビに入口なし（コードだけ残る）'],
  costsheet: ['食材管理', '原価シート', 'ナビに入口なし（コードだけ残る）'],
  dailyops: ['ダッシュボード', '日次オペレーション', 'ナビに入口なし（コードだけ残る）'],
  office_export: ['経理センター', '出力センター', '経理 申請・承認 › 出力センター（経理のメニュー）'],
  error_center: ['ワークセンター', 'エラーセンター', 'ワークセンター › エラー'],
  announce: ['ワークセンター', 'アナウンス', 'ワークセンター › アナウンス'],
  approval: ['ワークセンター', '承認センター', 'ワークセンター › 申請/承認'],
  attendance: ['予実', '勤怠データ', '予実 › 人件費・勤怠 › 勤怠データ'],
  onboarding: ['人材管理', 'オンボーディング', '人材管理 › 採用・オンボーディング › オンボーディング'],
  goals: ['ダッシュボード', '目標', 'マイページ・店長の画面の「管理」から'],
  office_career: ['育成・評価', 'オフィス Career Score', '育成・評価 › Career Score › オフィス'],
  growth_karte: ['育成・評価', '成長カルテ', '成長管理・設定から（PIN で開く）'],
  acct_export: ['経理センター', '経理出力', '経理センター ③ から'],
  company_msg_edit: ['設定', '会社メッセージ', 'ナビに入口なし（コードだけ残る）'],
  notifications: ['ダッシュボード', '通知', '上のベルから'],
  tiprate: ['人材管理', 'チップ率', 'スタッフのメニュー（G1・G3）'],
  ojtmap: ['育成・評価', 'OJTマップ', 'スタッフのメニュー（G1・G3）'],
  shift_staff: ['人材管理', 'マイシフト', 'スタッフのメニュー（G1・G3）'],
  lost_receipt: ['食材管理', 'レシート紛失届', 'スタッフ・経理のメニュー'],
  expense: ['ワークセンター', '事前経費申請', '経理 申請・承認・スタッフのメニュー'],
  cc_plan: ['ダッシュボード', '月間行動計画', '本部（GM・CEO・Head Chef）'],
  biz_guide: ['ダッシュボード', '業務ガイド', '本部（経理）のメニュー'],
};
const ORDER = ['予実', '人材管理', '育成・評価', 'ワークセンター', 'ダッシュボード', '食材管理', '経理センター', '経理レビュー', '設定'];
const PRIO = { '予実': 1, '人材管理': 2, '育成・評価': 2 };

function issues(m, wide) {
  const pc = [], sp = [], pcFix = new Set(), spFix = new Set();
  return { pc, sp, pcFix, spFix };
}
function judgePC(m) {
  const out = [], fix = [];
  if (!m) return { out: ['測れなかった'], fix: [] };
  if (m.modal) {
    const big = m.inputs >= 5 || m.tables > 0 || m.textLen > 700;
    if (big && m.rootW <= 560) { out.push(`PC でもスマホ用の小さな箱（幅 ${m.rootW}px・入力 ${m.inputs}・表 ${m.tables}）`); fix.push('中・大の箱（720／960px）か一覧の横の詳細パネル'); }
  } else {
    if (m.mainMax === '900px') { out.push(`幅 900px の制限（左右に約 ${Math.max(0, m.vw - m.mainW)}px の空白）`); fix.push('共通の幅（表・一覧・分析は横幅いっぱい、文章と短いフォームは読みやすい幅）'); }
    if (m.side <= 1 && m.blocks >= 3 && m.heightScreens >= 2.5) { out.push(`1 列に積まれて縦に長い（約 ${m.heightScreens} 画面）`); fix.push('関連する塊を 2〜3 列に'); }
  }
  if (m.tablesScroll > 0) { out.push(`表が枠の中で横にスクロール（${m.tablesScroll}）`); fix.push('表を広げる・項目列と見出しを固定'); }
  if (m.docOv > 2 || m.overflowN > 0) { out.push(`横にはみ出す（${m.docOv > 2 ? 'ページ +' + m.docOv + 'px' : ''}${m.overflowN ? ' 要素 ' + m.overflowN : ''}）`); fix.push('はみ出す要素を枠に収める'); }
  if (m.clippedN > 0) { out.push(`見切れ（${m.clippedN}）`); fix.push('見切れをなくす'); }
  return { out, fix };
}
function judgeSP(m) {
  const out = [], fix = [];
  if (!m) return { out: ['測れなかった'], fix: [] };
  if (m.docOv > 2) { out.push(`ページ全体が横にスクロール（+${m.docOv}px）`); fix.push('ページの横スクロールをなくす（表は表の中だけ）'); }
  else if (m.overflowN > 0) { out.push(`画面からはみ出す要素（${m.overflowN}）`); fix.push('はみ出す要素を折り返す・カードに'); }
  if (m.clippedN > 0) { out.push(`見切れ（${m.clippedN}）`); fix.push('見切れをなくす'); }
  if (m.tapTiny > 0) { out.push(`とても小さい押すところ ${m.tapTiny}（28px 未満）`); }
  if (m.tapSmall > 0) { out.push(`44px 未満の押すところ ${m.tapSmall}／${m.tapTotal}`); fix.push('押すところを 44px 以上に'); }
  if (m.fontSmall > 0) { out.push(`11px 未満の文字 ${m.fontSmall}`); fix.push('文字を 11px 以上に'); }
  if ((m.tabbars || []).some(t => t.hidden)) { out.push('タブが横に隠れて気づけない'); fix.push('タブの端に続きの印・今のタブを見える位置に'); }
  if (m.modal && (m.inputs >= 5 || m.tables > 0)) { out.push(`入力の多い箱（入力 ${m.inputs}）`); fix.push('全画面で開き、保存・閉じるを上下に固定'); }
  if (m.tablesScroll > 0) { out.push(`表の横スクロール（${m.tablesScroll}・固定列なし）`); fix.push('項目列を固定・月や期間で切り替え・詳細の展開'); }
  return { out, fix };
}

const pairs = [];
for (let i = 2; i < process.argv.length; i += 2) pairs.push([JSON.parse(fs.readFileSync(process.argv[i], 'utf8')), JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'))]);
const rows = []; const seen = new Set();
for (const [pc, sp] of pairs) {
  const who = pc.WHO === 'gm' ? 'GM（全店）' : pc.WHO === 'sl' ? 'G3（自店）' : 'G1（スタッフ）';
  const roleSuffix = pc.WHO === 'gm' ? '' : (pc.WHO === 'sl' ? '（G3 の表示）' : '（G1 の表示）');
  const ROLE_VIEW = ['dashboard', 'store_cmd', 'mypage', 'discount', 'skill', 'leadership', 'shift_staff', 'tiprate', 'ojtmap', 'crew_handbook', 'mileage', 'expense', 'lost_receipt', 'chat', 'tasks', 'vacation', 'tip', 'budget', 'labor', 'meeting'];
  for (const pid of Object.keys(pc.pages)) {
    const P = pc.pages[pid], S = sp.pages[pid] || {};
    const ex = EXTRA[pid];
    const grp = groups[pid] || (ex && ex[0]) || 'その他';
    const pname = names[pid] || (ex && ex[1]) || pid;
    const base = groups[pid] ? `${grp} › ${pname}` : (ex ? ex[2] : pid);
    if (P.fail || !(P.states || []).length) {
      const k = pid + '|fail'; if (seen.has(k)) continue; seen.add(k);
      rows.push({ grp, prio: PRIO[grp] || 3, page: pid, name: pname, state: '', path: base, kind: '画面', who, pc: ['合成データで描けなかった：' + String(P.fail || '').slice(0, 80)], sp: [], pcFix: [], spFix: [], status: '未検証', check: '描画が止まる（合成データの形の違いかを確かめる）', errors: (P.errors || []).slice(0, 2) });
      continue;
    }
    const spBy = new Map((S.states || []).map(s => [s.label, s]));
    P.states.forEach((m, idx) => {
      const lab = m.label; const k = pid + '|' + lab;
      if (pc.WHO !== 'gm' && seen.has(k) && ROLE_VIEW.indexOf(pid) < 0) return;
      const k2 = k + '|' + pc.WHO; if (seen.has(k2)) return; seen.add(k2); seen.add(k);
      let s = spBy.get(lab), spNote = '';
      if (!s && lab.includes(' › ')) { const par = lab.slice(0, lab.lastIndexOf(' › ')); if (spBy.get(par)) { s = spBy.get(par); spNote = '（スマホは別の切り替え・親の画面で測った）'; } }
      const sub = lab.slice(pid.length).replace(/^ › /, '').replace(/^ ⧉ /, '');
      const kind = m.modal ? 'モーダル' : (idx === 0 ? '画面' : 'タブ');
      const a = judgePC(m), b = judgeSP(s);
      const has = a.out.length + b.out.length > 0;
      const errs = idx === 0 ? (P.errors || []).concat(S.errors || []).slice(0, 2) : [];
      rows.push({
        grp, prio: PRIO[grp] || 3, page: pid, name: (m.modal ? `${pname} ⧉ ${sub}` : (sub ? `${pname} › ${sub}` : pname)) + roleSuffix,
        state: sub, path: base + (sub ? (m.modal ? ' ⧉ ' : ' › ') + sub : ''), kind, who,
        pc: a.out, sp: b.out, pcFix: [...new Set(a.fix)], spFix: [...new Set(b.fix)],
        status: !s ? '未検証' : (has ? '未対応' : '点検済み・改修不要'),
        check: `1440：主の幅 ${m.mainW}px（${m.mainMax}）${m.modal ? '・箱 ' + m.rootW + 'px' : ''}・高さ ${m.heightScreens} 画面・横はみ出し ${m.docOv > 2 ? '+' + m.docOv : 'なし'}` + spNote + (s ? `／390：横 ${s.docOv > 2 ? '+' + s.docOv : 'なし'}・44px 未満 ${s.tapSmall}/${s.tapTotal}・小さい文字 ${s.fontSmall}` : '／390：測れず'),
        errors: errs, metrics: { pc: m, sp: s || null }
      });
    });
  }
}
rows.sort((x, y) => (x.prio - y.prio) || (ORDER.indexOf(x.grp) - ORDER.indexOf(y.grp)) || 0);
process.stdout.write(JSON.stringify(rows, null, 1));
