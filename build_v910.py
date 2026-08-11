# -*- coding: utf-8 -*-
"""v910: 会計PLの取り込み（セキュアページ）

  やること
    ・簡易PLタブに「PLブックを取り込む」を追加。xlsx を選ぶ → 解析 → 確認表 → 保存
    ・解析はブラウザ側（SheetJS を必要になった時だけ CDN から読む）。
      アプリ本体は重くならず、PWA のオフライン動作にも影響しない
      （取り込みはどのみち通信が要る画面なので）
    ・保存先を2つに分ける
        pl_actual … 全項目（netop/opex を含む）。従来どおり。同期しない＝端末内
        pl_public … sales / cogs / payroll だけ。全端末へ同期する
      利益は sales-cogs-payroll-opex なので、opex を出さなければ復元できない。
      会議タブ（店長も見る）は pl_public だけを見る。

  ★取り込みの安全側
    ・確認表を出してから保存。黙って入れない
    ・列位置も行位置も決め打ちしない。月見出し（Jan 2026）と合計行のラベルで探す
      → 2026年PLは店ごとに合計行の位置が違う（Tori Ton r16 / Waikiki r13 など）
    ・検算（sales-cogs-payroll-opex=netop）が合わない行は取り込まない
    ・Waikiki シートは FSP と WGS の合算。分離できないので合算のまま持ち、
      F03/F03-G 個別の確定値は作らない（按分＝推計を確定値と呼ばないため）

  ★pl_public は同期キーなので4点セットを同時に入れる（v832 の事故の形を避ける）
      ① SUPA_SETTING_KEYS  ② 合流ルール  ③ LS_NEVER_FREE  ④ merge_probe の SAMPLE
"""
import io

def rd(p):
    with io.open(p, 'r', newline='', encoding='utf-8') as f: return f.read()
def wr(p, s):
    with io.open(p, 'w', newline='', encoding='utf-8') as f: f.write(s)
def _crlf(t): return t.replace('\r\n', '\n').replace('\n', '\r\n')
def rep(s, old, new, why):
    if '\r\n' in s: old, new = _crlf(old), _crlf(new)
    n = s.count(old); assert n == 1, u'アンカーが %d 件: %s' % (n, why)
    return s.replace(old, new)

src = rd('index.html')

BLOCK = r"""/* ============================================================
   v910: 会計PLブック(.xlsx)の取り込み

   ★行も列も決め打ちしない。
     2026年PLは店ごとに経費項目の数が違い、合計行の位置がずれる
     （Tori Ton: 売上r16 / Tenkichi: r15 / Waikiki: r13 …）。
     行を固定すると静かに違う数字が入る。ラベルで探すこと。
     月も 2025年形式は D 列始まり、2026年形式は B 列始まりで違うので、
     「Jan 2026」形式の見出しを探して列→月の対応を作る。
   ============================================================ */
var PL_SHEET_MAP = {
  'tori ton':'F01', 'toriton':'F01',
  'tenkichi':'F02',
  /* FSPとWGSはPL上合算（Motoさん確認済み）。分離できないので合算のまま持つ。 */
  'waikiki':'F03+F03-G',
  't-kaimuki':'F04-K', 'kaimuki':'F04-K',
  't-piikoi':'F04-P',  'piikoi':'F04-P',
  't-aiea':'F04-A',    'aiea':'F04-A',
  'marujuu':'F05'
};
var PL_LABELS = {
  sales:   'total for income',
  cogs:    'total for cost of goods sold',
  payroll: 'total for 1.payroll expenses',
  opex:    'total for 2. operating expenses',
  netop:   'net operating income'
};
var PL_MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
var PL_MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/i;

function _plCell(ws, r, c){ var a = XLSX.utils.encode_cell({r:r, c:c}); var v = ws[a]; return v ? v.v : null; }
function _plFindMonthCols(ws, maxR, maxC){
  for (var r=0; r<=Math.min(maxR,12); r++){
    var cols = {}, n = 0;
    for (var c=0; c<=maxC; c++){
      var v = _plCell(ws, r, c);
      if (typeof v !== 'string') continue;
      var m = v.trim().match(PL_MONTH_RE);
      if (m){ cols[c] = m[2] + '-' + String(PL_MONTHS.indexOf(m[1].toLowerCase().slice(0,3))+1).padStart(2,'0'); n++; }
    }
    if (n >= 2) return { row:r, cols:cols };
  }
  return null;
}
function _plFindRows(ws, maxR){
  var found = {};
  for (var r=0; r<=maxR; r++){
    var v = _plCell(ws, r, 0);
    if (typeof v !== 'string') continue;
    var k = v.trim().toLowerCase();
    for (var key in PL_LABELS) if (PL_LABELS[key] === k) found[key] = r;
  }
  return found;
}
function parsePLWorkbook(wb){
  var out = { months:[], rows:[], warnings:[] }, seen = {};
  wb.SheetNames.forEach(function(name){
    var sid = PL_SHEET_MAP[String(name).trim().toLowerCase()];
    if (!sid){ out.warnings.push('シート「'+name+'」は対応する店舗が不明のため取り込みません'); return; }
    var ws = wb.Sheets[name];
    var ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    var mc = _plFindMonthCols(ws, ref.e.r, ref.e.c);
    if (!mc){ out.warnings.push('シート「'+name+'」に月の見出し（例: Jan 2026）が見つかりません'); return; }
    var rr = _plFindRows(ws, ref.e.r);
    var miss = Object.keys(PL_LABELS).filter(function(k){ return rr[k]==null; });
    if (miss.length){ out.warnings.push('シート「'+name+'」に合計行が見つかりません: '+miss.join(', ')); return; }
    Object.keys(mc.cols).forEach(function(cs){
      var c = +cs, ym = mc.cols[cs], v = {}, allNull = true;
      Object.keys(PL_LABELS).forEach(function(k){
        var raw = _plCell(ws, rr[k], c);
        var n = (typeof raw === 'number') ? raw : null;
        if (n !== null) allNull = false;
        v[k] = (n === null) ? 0 : Math.round(n);
      });
      if (allNull) return;                        /* 未来の月は空。取り込まない */
      seen[ym] = 1;
      out.rows.push({ storeKey:sid, ym:ym, sheet:name, v:v });
    });
  });
  out.months = Object.keys(seen).sort();
  out.rows.forEach(function(r){
    var lhs = r.v.sales - r.v.cogs - r.v.payroll - r.v.opex;
    r.ok = Math.abs(lhs - r.v.netop) <= 2;
    if (!r.ok) out.warnings.push(r.sheet+' '+r.ym+': 検算が合わないため取り込みません（'+lhs+' vs '+r.v.netop+'）');
  });
  return out;
}

/* SheetJS は取り込みのときだけ読む。アプリ本体には持たない。 */
function _plLoadXlsx(){
  return new Promise(function(res, rej){
    if (window.XLSX) return res(window.XLSX);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = function(){ window.XLSX ? res(window.XLSX) : rej(new Error('XLSXの読み込みに失敗しました')); };
    s.onerror = function(){ rej(new Error('XLSXの読み込みに失敗しました（通信を確認してください）')); };
    document.head.appendChild(s);
  });
}

var _plImport = null;   /* 解析結果の一時置き場。保存を押すまでどこにも書かない */

function openPlImport(){
  openModal('<div class="modal-title">'+t('PLブックの取り込み','Import PL workbook')
    +' <button class="modal-close" onclick="closeModalDirect()">×</button></div>'
    +'<div style="font-size:11.5px;color:var(--muted);line-height:1.7;margin-bottom:10px">'
    +t('会計事務所のPL（.xlsx）を選ぶと、店舗×月の確定値を読み取ります。<br>読み取った内容を確認してから保存します。選んだだけでは保存されません。',
       'Pick the accounting PL (.xlsx). You will review before anything is saved.')+'</div>'
    +'<input type="file" id="pl-file" accept=".xlsx,.xls" style="font-size:12px" onchange="plFilePicked(this)">'
    +'<div id="pl-preview" style="margin-top:12px"></div>');
}
function plFilePicked(el){
  var f = el && el.files && el.files[0];
  if (!f) return;
  var box = document.getElementById('pl-preview');
  if (box) box.innerHTML = '<div style="font-size:12px;color:var(--muted)"><i class="ti ti-loader"></i> '+t('読み込み中…','Reading…')+'</div>';
  _plLoadXlsx().then(function(){
    var fr = new FileReader();
    fr.onload = function(){
      var r;
      try { r = parsePLWorkbook(XLSX.read(new Uint8Array(fr.result), {type:'array'})); }
      catch(e){ if(box) box.innerHTML = '<div style="color:var(--red);font-size:12px">'+escapeHtml(t('解析できませんでした','Could not parse'))+': '+escapeHtml(String(e && e.message || e))+'</div>'; return; }
      _plImport = r;
      if (box) box.innerHTML = _plPreviewHtml(r);
    };
    fr.onerror = function(){ if(box) box.innerHTML = '<div style="color:var(--red);font-size:12px">'+t('ファイルを読めませんでした','Could not read file')+'</div>'; };
    fr.readAsArrayBuffer(f);
  }).catch(function(e){
    if (box) box.innerHTML = '<div style="color:var(--red);font-size:12px">'+escapeHtml(String(e && e.message || e))+'</div>';
  });
}
function _plPreviewHtml(r){
  var good = r.rows.filter(function(x){ return x.ok; });
  var h = '';
  if (!good.length){
    h += '<div style="color:var(--red);font-size:12px;font-weight:700;margin-bottom:8px">'+t('取り込める行がありません','Nothing to import')+'</div>';
  } else {
    h += '<div style="font-size:12px;margin-bottom:6px"><b>'+good.length+t('件','')+'</b> '
      +  t('を取り込みます','ready')+'（'+escapeHtml(r.months[0]||'')+' 〜 '+escapeHtml(r.months[r.months.length-1]||'')+'）</div>';
    var by = {};
    good.forEach(function(x){ (by[x.storeKey] = by[x.storeKey] || []).push(x); });
    h += '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;min-width:100%">'
      +  '<thead><tr><th style="text-align:left;padding:4px 6px;color:var(--muted)">'+t('店舗','Store')+'</th>'
      +  r.months.map(function(m){ return '<th style="padding:4px 8px;color:var(--muted);white-space:nowrap">'+escapeHtml(m.slice(5))+t('月','')+'</th>'; }).join('')
      +  '</tr></thead><tbody>';
    Object.keys(by).forEach(function(sk){
      var m2 = {}; by[sk].forEach(function(x){ m2[x.ym] = x.v.sales; });
      h += '<tr><td style="padding:4px 6px;white-space:nowrap"><b>'+escapeHtml(_plStoreLabel(sk))+'</b></td>'
        +  r.months.map(function(m){ return '<td style="padding:4px 8px;text-align:right;white-space:nowrap">'+(m2[m]!=null?fmtK(m2[m]):'—')+'</td>'; }).join('')
        +  '</tr>';
    });
    h += '</tbody></table></div>'
      +  '<div style="font-size:10px;color:var(--muted);margin-top:6px;line-height:1.6">'
      +  t('表は売上（消費税を除く額）。原価・人件費・経費・営業利益も同時に取り込みます。','Sales shown (excl. tax). Cost, payroll, opex and operating income are imported too.')
      +  '<br>'+t('営業利益と経費はこの端末にだけ保存します（他の端末・店長には出ません）。','Operating income and opex stay on this device only.')+'</div>';
  }
  if (r.warnings.length){
    h += '<div style="margin-top:9px;border:1px solid var(--yellow);border-radius:8px;padding:8px;font-size:10.5px;line-height:1.7">'
      +  '<b style="color:var(--yellow)"><i class="ti ti-alert-triangle"></i> '+t('取り込まないもの','Skipped')+'</b><br>'
      +  r.warnings.map(function(w){ return escapeHtml(w); }).join('<br>')+'</div>';
  }
  h += '<div class="btn-row" style="margin-top:12px"><button class="btn btn-secondary" onclick="closeModalDirect()">'+t('キャンセル','Cancel')+'</button>'
    +  (good.length ? '<button class="btn btn-primary" onclick="plImportSave()"><i class="ti ti-download"></i> '+t('取り込む','Import')+'</button>' : '')+'</div>';
  return h;
}
function _plStoreLabel(sk){
  if (sk === 'F03+F03-G') return 'Waikiki（FSP+WGS 合算）';
  try { var st = STORES.find(function(x){ return x.id === sk; }); if (st) return st.name; } catch(e){}
  return sk;
}
/* 保存。pl_actual（全項目・端末内）と pl_public（率の材料のみ・同期）に分ける。 */
function plImportSave(){
  var r = _plImport;
  if (!r || !r.rows.length){ showToast(t('取り込む内容がありません','Nothing to import'),'info'); return; }
  var good = r.rows.filter(function(x){ return x.ok; });
  var act = ls('pl_actual', {}) || {};
  var pub = ls('pl_public', {}) || {};
  var now = Date.now(), n = 0;
  good.forEach(function(x){
    if (!act[x.ym]) act[x.ym] = {};
    if (!pub[x.ym]) pub[x.ym] = {};
    act[x.ym][x.storeKey] = { sales:x.v.sales, cogs:x.v.cogs, payroll:x.v.payroll, opex:x.v.opex, netop:x.v.netop };
    /* ★ opex と netop は入れない。利益 = sales-cogs-payroll-opex なので、
       opex を出すと引き算で利益が分かってしまう。 */
    pub[x.ym][x.storeKey] = { sales:x.v.sales, cogs:x.v.cogs, payroll:x.v.payroll, _at:now };
    n++;
  });
  if (!act._src) act._src = {};
  r.months.forEach(function(m){ act._src[m] = 'PL取込 ' + (typeof todayJP==='function' ? todayJP() : ''); });
  pub._at = now;
  lsSet('pl_actual', act);
  lsSet('pl_public', pub);
  _plImport = null;
  try { closeModalDirect(); } catch(e){}
  showToast(n + t('件を取り込みました','rows imported'), 'success');
  try { _secRerender(); } catch(e){}
}
"""

src = rep(src,
    "/* v908: その月・その店の数字が「確定(会計PL取込)」か「速報(アプリの日次実績)」か。",
    BLOCK + "\n/* v908: その月・その店の数字が「確定(会計PL取込)」か「速報(アプリの日次実績)」か。",
    u'PL取り込みの追加')

# ---- 確定判定は pl_public を先に見る（会議タブは全端末で同じ印になる） ----
src = rep(src,
    "function _meetIsConfirmed(storeId, ym){\n"
    "  try {\n"
    "    var a = ls('pl_actual', null);\n"
    "    return !!(a && a[ym] && a[ym][storeId]);\n"
    "  } catch(e){ return false; }\n"
    "}",
    "function _meetIsConfirmed(storeId, ym){\n"
    "  try {\n"
    "    /* v910: 全端末に届くのは pl_public。会議タブはこれを見る。\n"
    "       pl_actual は利益を含むためセキュアページの端末にしか無い。 */\n"
    "    var p = ls('pl_public', null);\n"
    "    if (p && p[ym] && p[ym][storeId]) return true;\n"
    "    /* FSPとWGSはPL上合算。個別の確定値は作れないので、合算の行があれば両方に印を出す。 */\n"
    "    if ((storeId === 'F03' || storeId === 'F03-G') && p && p[ym] && p[ym]['F03+F03-G']) return true;\n"
    "    var a = ls('pl_actual', null);\n"
    "    if (a && a[ym] && a[ym][storeId]) return true;\n"
    "    if ((storeId === 'F03' || storeId === 'F03-G') && a && a[ym] && a[ym]['F03+F03-G']) return true;\n"
    "    return false;\n"
    "  } catch(e){ return false; }\n"
    "}",
    u'確定判定を pl_public 対応へ')

# ---- 簡易PL画面に取り込みボタン ----
src = rep(src,
    "      +'<button class=\"btn btn-secondary btn-sm\" style=\"padding:2px 8px;font-size:10px\" onclick=\"openPlActualModal(\\''+st.id+'\\')\"><i class=\"ti ti-file-spreadsheet\"></i> 実PL</button>'",
    "      +'<button class=\"btn btn-secondary btn-sm\" style=\"padding:2px 8px;font-size:10px\" onclick=\"openPlActualModal(\\''+st.id+'\\')\"><i class=\"ti ti-file-spreadsheet\"></i> 実PL</button>'",
    u'（実PLボタンは据え置き）')

src = rep(src,
    "  h += '<div style=\"font-size:10.5px;color:var(--muted);margin:-4px 2px 10px;line-height:1.6\"><i class=\"ti ti-info-circle\"></i> 簡易PL＝",
    "  /* v910: PLブックの取り込み。1ファイルで全店・全月がまとめて入る。 */\n"
    "  h += '<div style=\"display:flex;justify-content:flex-end;margin:0 2px 8px\">'\n"
    "    +  '<button class=\"btn btn-primary btn-sm\" onclick=\"openPlImport()\"><i class=\"ti ti-file-upload\"></i> '+t('PLブックを取り込む','Import PL workbook')+'</button></div>';\n"
    "  h += '<div style=\"font-size:10.5px;color:var(--muted);margin:-4px 2px 10px;line-height:1.6\"><i class=\"ti ti-info-circle\"></i> 簡易PL＝",
    u'取り込みボタンの追加')

# ---- 同期の4点セット ----
src = rep(src,
    "var SUPA_SETTING_KEYS = ['m_titlewage','m_store_kpi','m_format_kpi','kpi_config','store_positi",
    "var SUPA_SETTING_KEYS = ['pl_public',   /* v910: PL取込の率の材料。利益(netop/opex)は含めない */\n"
    "  'm_titlewage','m_store_kpi','m_format_kpi','kpi_config','store_positi",
    u'SUPA_SETTING_KEYS へ追加')

src = rep(src,
    "  m_store_kpi:    { merge: mergeMapByKey, covers: _coversMapByKey },",
    "  /* v910: PL取込。月をキーにした入れ物なので、月単位で新しい方を採る。\n"
    "     取り込む端末が複数あっても、別の月を入れた分は消えない。 */\n"
    "  pl_public:      { merge: mergeMapByKey, covers: _coversMapByKey },\n"
    "  m_store_kpi:    { merge: mergeMapByKey, covers: _coversMapByKey },",
    u'合流ルールへ追加')

src = rep(src,
    "var LS_NEVER_FREE = ['spl_cc_plans_','hq_goals',",
    "var LS_NEVER_FREE = ['pl_public','pl_actual',   /* v910: 会計PLの取込値。容量整理で消さない */\n"
    "  'spl_cc_plans_','hq_goals',",
    u'LS_NEVER_FREE へ追加')

src = rep(src, "const APP_VERSION = '909';", "const APP_VERSION = '910';", u'APP_VERSION')

assert src.count('\n') - src.count('\r\n') == 0, u'lone LF が残っている'
wr('index.html', src)
sw = rd('sw.js')
wr('sw.js', rep(sw, "const SW_BUILD = '909';", "const SW_BUILD = '910';", u'SW_BUILD'))
print('OK')
