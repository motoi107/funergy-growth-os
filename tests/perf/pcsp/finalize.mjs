import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('rows.json','utf8'));
const nav = JSON.parse(fs.readFileSync('nav.json','utf8'));
const mp = JSON.parse(fs.readFileSync('modal_pages.json','utf8'));
const names = JSON.parse(fs.readFileSync('names.json','utf8'));
const rest = JSON.parse(fs.readFileSync('modals_rest.json','utf8'));
// ---- concrete proposals for the priority screens (予実・人材) ----
const P = [
 // [page, state-regex on path, pc[], sp[]]
 ['budget', /日次進捗$|^予実 › 予実管理$/, ['今の広い幅（1500px）のまま','上の数字の小さい文字（10px）を 11px 以上に'], ['店・月の切り替えと日送りを 44px に','数字のタイルは 2 列']],
 ['budget', /Qコミットビュー/, ['広い幅（1440px まで）','6 つの指標を左の一覧、右に月別の表と推移を並べる'], ['進み具合の棒の下の数字が重ならないように（2 段に）','指標の切り替えは横に送るタブ（44px・今の指標が見える位置へ）','月別の表は項目の列と見出しを固定','10px の文字を 11px 以上に']],
 ['budget', /年間計画/, ['広い幅で全部の列を 1 画面に（横スクロールなし・試作で確認）'], ['今の月ごとの行（v1166）のまま、押すところを 44px に']],
 ['budget', /予算設定/, ['広い幅で 店 × 月の入力を 1 画面に','日別予算・予算根拠の箱は大きい箱で 2 列'], ['1 店ずつ','日別予算・予算根拠の箱は全画面で、保存を下に固定']],
 ['budget', /施策分析/, ['一覧と詳しい内容を 2 列に'], ['一覧 → 詳しい内容','ランチの表は項目の列を固定']],
 ['meeting', /^予実 › 会議$/, ['今の広い幅のまま','表の見出しを固定'], ['表の項目の列を固定','小さい文字を 11px 以上に']],
 ['purchase', /仕入れ$/, ['広い幅で店の表を 1 画面に'], ['店ごとのカード','押すところを 44px に']],
 ['labor', /./, ['広い幅で上の数字を 3〜4 列に','日別の表を広い表に（縦の長さを半分以下に）'], ['日別の表は項目の列を固定','ページ全体の横はみ出し（労働時間 +5px）をなくす']],
 ['attendance', /./, ['広い幅で上の数字を 3〜4 列に','日別の表を広い表に（縦の長さを半分以下に）'], ['日別の表は項目の列を固定','ページ全体の横はみ出し（労働時間 +5px）をなくす']],
 ['kpi_master', /./, ['広い幅で 店 × KPI の表を 1 画面に'], ['実績入力は 1 店 × 1 KPI ずつのカード（入力欄 44px）','小さい文字を 11px 以上に']],
 ['staff_master', /従業員マスター$/, ['一覧を表に（名前・肩書き・店と応援・雇用形態・Grade／Lv・状態。給与と PIN は今と同じく見られる人だけ）','押すと右に詳しい内容のパネル・編集は大きい箱'], ['今のカードの形のまま、押すところを 44px に','編集は全画面の箱で、保存を下に固定']],
 ['staff_master', /⧉/, ['大きい箱（1000px）・表は 1 画面に・入力があれば 2 列'], ['全画面の箱・見出しと保存を固定','表は項目の列を固定']],
 ['leadership', /Career Score$|› Career Score › Career Score$/, ['一覧（左）と詳しい内容（右）の 2 列','カードは 2〜3 列'], ['一覧 → 詳しい内容','カテゴリーの切り替えは横に送るタブ（44px）']],
 ['leadership', /育成パイプライン/, ['広い幅で全部の列を 1 画面に','表の見出しと名前の列を固定'], ['名前の列を固定','小さい文字（448）を 11px 以上に']],
 ['leadership', /Score管理/, ['広い幅で基準点の表を 1 画面に'], ['表の項目の列を固定','押すところを 44px に']],
 ['skill', /従業員別/, ['人 × ポジションの表（名前の列と見出しを固定）で、45 画面の縦長をなくす'], ['1 人ずつのカード（今の形）・押すところを 44px に']],
 ['skill', /./, ['広い幅','一覧と詳しい内容を 2 列に'], ['押すところを 44px に']],
 ['growth_mgr', /スタッフ別|成長管理$/, ['スタッフのカードを 2〜3 列に（20 画面の縦長を半分以下に）'], ['小さい文字（484）を 11px 以上に','カードは開いたときに詳しい内容']],
 ['ojt_admin', /G3 Kitchen|G3 Operation|G3 Server|G1→G2|OJT管理$/, ['人 × 項目の表（名前の列と見出しを固定）'], ['1 人ずつ・項目は分類ごとに折りたたみ','チェックを 44px に']],
 ['tip', /配分表|チップ管理$/, ['広い幅で配分表を 1 画面に（枠の中の横スクロールなし）'], ['配分表は名前の列を固定','押すところを 44px に']],
 ['shift_admin', /./, ['今の広い幅のまま'], ['盤面の押すところを 44px に','小さい文字を 11px 以上に']],
 ['hiring', /採用・オンボーディング$|› 採用・オンボーディング › 採用・オンボーディング$/, ['応募者の表と右の詳しい内容のパネル'], ['状態ごとに折りたたみ・押すところを 44px に']],
 ['onboarding', /オンボーディング$|› オンボーディング › 採用・オンボーディング$/, ['応募者の表と右の詳しい内容のパネル'], ['状態ごとに折りたたみ・押すところを 44px に']],
];
for (const r of rows) {
  if (r.status !== '未対応') continue;
  for (const [pg, re, pc, sp] of P) {
    if (r.page === pg && re.test(r.path)) { if (r.pc.length) r.pcFix = pc; r.spFix = sp.concat(r.spFix.filter(f=>/11px/.test(f) && !sp.some(s=>/11px/.test(s)) ? true : false)); break; }
  }
}
// ---- common rows ----
const g = nav['gm-390'], g7 = nav['gm-768'], s3 = nav['sl-390'], c3 = nav['crew-390'];
const hiddenMax = (o)=> Math.max(...o.groups.map(x=>x.nav.hidden.length));
const subMax = (o)=> Math.max(...o.groups.map(x=>x.sub.hidden.length));
const common = [
 ['上のバー（店の切り替え・言語・保存の状態・ログアウト）', 'すべての画面', ['PC：問題なし'], [`スマホ：店の切り替えのボタンが切れる（幅 約 ${g.groups[0].storeW}px）`, `ボタンの高さ ${g.groups[0].topbarMinH}px（44px 未満）`], ['今のまま'], ['店の切り替えは店名を短く（略称）して切れないように','ボタンを 44px に（見た目の大きさはそのまま、押せる範囲を広げる）']],
 ['グループのナビ（ダッシュボード・予実・人材管理…）', 'すべての画面', ['PC：問題なし'], [`スマホで画面の外に隠れるグループ：GM ${hiddenMax(g)}／9・G3 ${hiddenMax(s3)}／7・G1 ${hiddenMax(c3)}／7（横に送れる印がない）`, `768px でも GM は ${hiddenMax(g7)} つ隠れる`, '今のグループが画面の外のことがある（人材管理など）'], ['今のまま'], ['右端をうすくして「横に送れる」と分かるように','開いたとき・切り替えたときに今のグループが見える位置へ']],
 ['ページのナビ（グループの中の画面）', 'すべての画面', ['PC：問題なし'], [`スマホで隠れる画面：最大 ${subMax(g)}（人材管理）`, `高さ ${g.groups[0].sub.minH}px（44px 未満）`], ['今のまま'], ['右端をうすく・今の画面が見える位置へ','高さを 44px に']],
 ['画面の幅（.main の 900px）', 'すべての画面', ['PC：216 の状態で幅 900px の制限（1440px で左右に約 450px の空白）','画面ごとに別々の広げ方（md-wide・shift-wide など 9 種類）'], ['スマホ：問題なし'], ['画面ごとに 3 つの幅から選ぶ：表・一覧・分析＝広い（1024px 以上で 1440px、1440px 以上で 1880px）／ふつう＝1180px／文章と短いフォーム＝読みやすい幅（900px）','9 種類の広げ方を 1 つの決まりにまとめる'], ['今のまま（画面いっぱい）']],
 ['箱（モーダル）の大きさ', 'すべての箱', ['PC：ほとんどの箱が 480px（12 の大きい箱がスマホ用の小さな箱のまま）'], ['スマホ：入力の多い箱・表のある箱が小さいまま（見出しと保存が流れて見えなくなる）'], ['中身で大きさを選ぶ：ふつう 480px／中 760px（入力 6 つ以上・表）／大 1000px（広い表）','入力は 2 列に'], ['入力 3 つ以上・表のある箱は全画面で、見出しと保存・閉じるを上下に固定（iPhone の下の余白も）']],
 ['押すところ（ボタン・タブ・チェック）', 'すべての画面', ['PC：問題なし（マウス）'], ['スマホ：229 の状態で 44px 未満の押すところ（とくに小さい 28px 未満も多い）'], ['今のまま'], ['ボタン・タブ・チェック・小さい ✕ を 44px に（見た目の大きさは変えず、押せる範囲を広げる。並びがつまる所は間をあける）']],
 ['文字の大きさ', 'すべての画面', ['PC：問題なし（PC は 1.1 倍で表示）'], ['スマホ：232 の状態で 11px 未満の文字（9〜10px の補足・数字）'], ['今のまま'], ['いちばん小さい文字を 11px に（補足の文字・表の数字）']],
 ['表', 'すべての表', ['PC：15 の状態で表が枠の中で横にスクロール'], ['スマホ：39 の状態で表が横にスクロール（項目の列が固定されていない）・3 の状態でページ全体が横にスクロール'], ['広い幅で 1 画面に','見出しを固定'], ['横スクロールは表の中だけ・項目（名前）の列と見出しを固定','ページ全体は横にスクロールさせない']],
 ['チャットの丸いボタン', 'すべての画面', ['PC：問題なし'], [`スマホ：${g.groups[0].fab.w}×${g.groups[0].fab.h}px・下から ${g.groups[0].fab.bottom}px（画面の下の保存ボタンと重なることがある）`], ['今のまま'], ['全画面の箱を開いているときは隠す','下に固定したボタンがある画面では、その上に出す']],
 ['ログイン画面・PIN', 'ログインのとき', ['PC：問題なし'], [`スマホ：問題なし（ボタン ${g.pinScreen.btnH}px・入力 ${g.pinScreen.inH}px・はみ出しなし）`], ['今のまま（ログインの作り直しは別の作業・UI案80）'], ['今のまま']],
];
const out = [];
common.forEach(([name, path, pcP, spP, pcF, spF]) => out.push({ prio: 0, grp: '共通', page: '', name, kind: '共通', who: 'GM・G3・G1', path, pc: pcP, sp: spP, pcFix: pcF, spFix: spF, status: '未対応', check: nav['gm-768'] && /グループ|ページのナビ/.test(name) ? '390・768・1440 で測った（GM・G3・G1）' : '390・1440 で測った（GM・G3・G1）' }));
for (const r of rows) { if (/Qコミットビュー$/.test(r.path) && r.who.startsWith('GM')) r.sp.push('進み具合の棒の下の数字（着地見込み・経過目標・Q目標）が重なる（390px の画像で確認）'); if (/Invoice（閲覧）$/.test(r.path)) { r.status = '未検証'; r.pc = ['未確認（合成データで一覧が描けなかった）']; r.sp = ['未確認']; r.pcFix = ['共通の幅（広い）']; r.spFix = ['共通の決まり']; r.check = '合成データの請求書に品目（lines）が無く、一覧の途中で止まった（invCardHtml の inv.lines.length）。本番の請求書で起きるかは未確認。本物に近いデータで測り直す'; } out.push(r); }
// ---- modals not opened (未検証) ----
const opened = new Set(); rows.forEach(r=>{ if (r.kind==='モーダル' && r.metrics && r.metrics.pc && r.metrics.pc.fn) opened.add(r.metrics.pc.fn); });
for (const f of ['gm2-1440-ALL.json','sl-1440.json','crew-1440.json']) { const j = JSON.parse(fs.readFileSync(f,'utf8')); for (const v of Object.values(j.pages)) for (const s of (v.states||[])) if (s.fn) opened.add(s.fn); }
const byPage = {};
for (const [fn, v] of Object.entries(mp.res)) { if (opened.has(fn)) continue; const pages = v.pages.length ? v.pages : ['?']; const p = pages[0]; (byPage[p] = byPage[p] || []).push({ fn, title: (v.title||'').replace(/['+\\]|\s+/g,' ').replace(/…\s*—\s*/,'').trim(), also: pages.slice(1) }); }
const pathOf = (p) => { const r = rows.find(x=>x.page===p && x.kind==='画面'); return r ? r.path : (names.names[p] || p); };
const grpOf = (p) => { const r = rows.find(x=>x.page===p); return r ? r.grp : 'そのほか'; };
const prioOf = (p) => { const r = rows.find(x=>x.page===p); return r ? r.prio : 3; };
for (const [p, list] of Object.entries(byPage)) {
  const label = list.map(x => x.title && x.title.length > 1 && !/^[\s…'"]+$/.test(x.title) && !/t\(|u[0-9a-f]{4}|\(…\)|^…/.test(x.title) ? x.title.slice(0, 18) : x.fn).slice(0, 12).join('、') + (list.length > 12 ? ` ほか ${list.length-12}` : '');
  out.push({ prio: p==='?'?3:prioOf(p), grp: p==='?'?'そのほか':grpOf(p), page: p==='?'?'':p, name: p==='?' ? 'どの画面から開くか特定できなかった箱' : `その他の箱 ${list.length} 個`, kind: 'モーダル', who: '—', path: p==='?' ? '（コードの呼び出し元をたどれなかった）' : pathOf(p) + ' ⧉ その他', pc: ['未確認（自動の点検で開いていない）'], sp: ['未確認'], pcFix: ['共通の箱の決まり（中・大の箱・2 列）'], spFix: ['共通の箱の決まり（全画面・見出しと保存を固定）'], status: '未検証', check: `開いていない：${label}`, count: list.length });
}
// ---- numbering & csv ----
out.sort((a,b)=> (a.prio-b.prio) || 0);
out.forEach((r,i)=> r.no = i+1);
const esc = (s) => '"' + String(s ?? '').replace(/"/g,'""') + '"';
const head = ['番号','優先','グループ','画面名','種類','見た役割','画面への経路','現状の問題','PC での対応','スマホでの対応','対応状況','検証結果'];
const prioName = (p) => p===0?'共通':p===1?'1 予実':p===2?'2 人材・育成':'3 そのほか';
const fixT = (t) => String(t).replace(/（左右に約 (\d+)px の空白）/g,'（1440px で左右の空白が合わせて約 $1px）');
const line0 = (r) => [r.no, prioName(r.prio), r.grp, r.name, r.kind, r.who, r.path, ['PC：'+(r.pc.length?r.pc.join('・'):'問題なし'), 'スマホ：'+(r.sp.length?r.sp.join('・'):'問題なし')].map(s=>s.replace(/^(PC：|スマホ：)\1/,'$1').replace(/^PC：PC：/,'PC：').replace(/^スマホ：スマホ：/,'スマホ：')).join('／'), r.pcFix.join('・')||'今のまま', r.spFix.join('・')||'今のまま', r.status, r.check];
const line = (r) => line0(r).map(fixT);
fs.writeFileSync('inventory.csv', '﻿' + [head, ...out.map(line)].map(a=>a.map(esc).join(',')).join('\n'));
fs.writeFileSync('inventory.json', JSON.stringify(out.map(r=>({no:r.no,prio:prioName(r.prio),grp:r.grp,name:r.name,kind:r.kind,who:r.who,path:r.path,problem:line(r)[7],pc:line(r)[8],sp:line(r)[9],status:r.status,check:r.check})),null,1));
const cnt = {}; out.forEach(r=>cnt[r.status]=(cnt[r.status]||0)+1);
const cntK = {}; out.forEach(r=>cntK[r.kind]=(cntK[r.kind]||0)+1);
const unver = out.filter(r=>r.status==='未検証').reduce((a,r)=>a+(r.count||0),0);
console.log('rows', out.length, cnt, cntK, '未検証の箱', unver);
