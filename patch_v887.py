# -*- coding: utf-8 -*-
"""v887 — シフトリーダーの出力に「誰にいくら払うか」を出す ＋ 画面の視認性向上。
   透過置換。CRLF 保持。アンカーは必ず 1 件だけであることを assert する。"""

P = 'index.html'
d = open(P, 'rb').read()
orig_crlf = d.count(b'\r\n')


def rep(old_s, new_s, note):
    global d
    old, new = old_s.encode('utf-8'), new_s.encode('utf-8')
    n = d.count(old)
    assert n == 1, 'anchor count=%d (expected 1): %s' % (n, note)
    d = d.replace(old, new, 1)
    print('OK  ', note)


def rep_span(start_s, end_s, new_s, note):
    """start から end の直前までを置き換える。end 自体は残す。"""
    global d
    start, end = start_s.encode('utf-8'), end_s.encode('utf-8')
    assert d.count(start) == 1, 'start not unique: ' + note
    i = d.find(start)
    j = d.find(end, i)
    assert j > i, 'end not found after start: ' + note
    d = d[:i] + new_s.encode('utf-8') + d[j:]
    print('OK  ', note)


# =====================================================================
# 1) 支給額の唯一の計算元。slPeriodSummary() を包むだけで、条件を作り直さない。
# =====================================================================
HELPERS = (
"/* ===== v887: シフトリーダー手当「誰にいくら払うか」 =====\r\n"
"   Motoさん依頼。出力に回数だけでなく単価と支給額まで出す。\r\n"
"   金額の計算は slPeriodSummary() が唯一の正。ここでは包むだけで条件を作り直さない\r\n"
"   （画面とCSVで数字が食い違うのを防ぐ。同じ class の事故を何度も出しているため）。\r\n"
"   ・対象は G1 のみ（slDayRecords が除外側に回す）\r\n"
"   ・単価は sl_config.amount の全店共通。店ごとには持たない\r\n"
"   ・制度対象外の店は enabled:false を返し、金額を一切出さない\r\n"
"     （slCountsInRange は店を見ないので、金額を出すこちらで必ず塞ぐ） */\r\n"
"function slPayrollData(storeId, fromISO, toISO){\r\n"
"  var empty = { enabled:false, rows:[], excluded:[], total:0, amount:0, days:0,\r\n"
"                from:fromISO, to:toISO, store:storeId };\r\n"
"  try{\r\n"
"    if(typeof slStoreEnabled==='function' && !slStoreEnabled(storeId)) return empty;\r\n"
"    var s = slPeriodSummary(storeId, fromISO, toISO);\r\n"
"    s.enabled = true; s.store = storeId;\r\n"
"    return s;\r\n"
"  }catch(e){ console.warn('slPayrollData', e); return empty; }\r\n"
"}\r\n"
"function _slRecLabel(x){\r\n"
"  return String(x.date||'').slice(5) + x.period + (x.src==='manual' ? '(手)' : '');\r\n"
"}\r\n"
"/* CSV の共通ブロック。Tip一覧・配分表・専用出力の3か所から同じものを呼ぶ。 */\r\n"
"function slPayrollRows(storeId, fromISO, toISO){\r\n"
"  var p = slPayrollData(storeId, fromISO, toISO);\r\n"
"  var nm = (typeof _owStoreName==='function') ? _owStoreName(storeId) : storeId;\r\n"
"  var rows = [];\r\n"
"  rows.push(['【シフトリーダー手当】', nm, fromISO + ' 〜 ' + toISO]);\r\n"
"  if(!p.enabled){\r\n"
"    rows.push([nm + ' は Shift Leader 制度の対象外です']);\r\n"
"    return rows;\r\n"
"  }\r\n"
"  rows.push(['単価', '$' + p.amount.toFixed(2) + ' / 1回', '対象は G1 のみ',\r\n"
"             '該当日数 ' + p.days + '日']);\r\n"
"  rows.push(['氏名','ランチ(回)','ディナー(回)','回数計','単価($)','支給額($)','該当日']);\r\n"
"  var tl=0, td=0, tc=0;\r\n"
"  (p.rows||[]).forEach(function(r){\r\n"
"    tl += (r.L||0); td += (r.D||0); tc += (r.count||0);\r\n"
"    rows.push([r.name, (r.L||0), (r.D||0), (r.count||0),\r\n"
"      p.amount.toFixed(2), (r.amount||0).toFixed(2),\r\n"
"      (r.recs||[]).map(_slRecLabel).join(' ')]);\r\n"
"  });\r\n"
"  rows.push(['合計', tl, td, tc, '', p.total.toFixed(2), (p.rows||[]).length + '名']);\r\n"
"  if((p.excluded||[]).length){\r\n"
"    var uniq={}; p.excluded.forEach(function(x){ uniq[x.name]=x.reason; });\r\n"
"    rows.push([]);\r\n"
"    rows.push(['【対象外】','理由','','','','','手当は G1 のみが対象です']);\r\n"
"    Object.keys(uniq).forEach(function(n){ rows.push([n, uniq[n]]); });\r\n"
"  }\r\n"
"  return rows;\r\n"
"}\r\n"
"/* 単独出力。給与にそのまま渡せる形にする。 */\r\n"
"function exportSlPayrollCSV(storeId, anyDate){\r\n"
"  var per = _p4Period(anyDate);\r\n"
"  var p = slPayrollData(storeId, per.from, per.to);\r\n"
"  var nm = _owStoreName(storeId);\r\n"
"  if(!p.enabled){ showToast(nm + ' は Shift Leader 制度の対象外です','warning'); return; }\r\n"
"  if(!p.rows.length){ showToast('この期間の Shift Leader 記録がありません','danger'); return; }\r\n"
"  downloadCSV(slPayrollRows(storeId, per.from, per.to),\r\n"
"    'シフトリーダー手当_' + nm + '_' + per.from + '_' + per.to + '.csv');\r\n"
"  showToast(nm + '（' + per.label + '）' + _money(p.total) + ' を出力しました','success');\r\n"
"}\r\n"
"function exportAllSlPayrollCSV(d1, d2){\r\n"
"  var rows = [], grand = 0, hit = 0;\r\n"
"  (getVisibleStores()||[]).forEach(function(s){\r\n"
"    if(typeof slStoreEnabled==='function' && !slStoreEnabled(s.id)) return;\r\n"
"    [d1, d2].forEach(function(dt){\r\n"
"      var per = _p4Period(dt);\r\n"
"      var p = slPayrollData(s.id, per.from, per.to);\r\n"
"      if(!p.enabled || !p.rows.length) return;\r\n"
"      rows = rows.concat(slPayrollRows(s.id, per.from, per.to));\r\n"
"      rows.push([]);\r\n"
"      grand += p.total; hit++;\r\n"
"    });\r\n"
"  });\r\n"
"  if(!hit){ showToast('対象期間の Shift Leader 記録がありません','danger'); return; }\r\n"
"  rows.push(['【総合計】','', '', '', '', grand.toFixed(2), hit + '件']);\r\n"
"  downloadCSV(rows, 'シフトリーダー手当_全店_' + acctMonthLabel() + '.csv');\r\n"
"  showToast('全店のシフトリーダー手当 ' + _money(grand) + ' を出力しました','success');\r\n"
"}\r\n"
)

rep("/* ---- 画面 ---- */\r\nfunction renderTipShiftLeader(){\r\n",
    HELPERS + "/* ---- 画面 ---- */\r\nfunction renderTipShiftLeader(){\r\n",
    "slPayrollData / slPayrollRows / 単独CSV出力 を追加")


# =====================================================================
# 2) 画面：集計タイル（色＋アイコン）
# =====================================================================
STATS = (
"  /* v887: 数字だけ並んでいて何が重要か分からなかったので、色とアイコンを付ける。\r\n"
"     支給合計は払う金額なので一番大きく緑で出す。 */\r\n"
"  var _slTiles = [\r\n"
"    { ic:'ti-users',        c:'var(--accent2)', k:t('対象人数','People'),  v:String(sum.rows.length),\r\n"
"      s:t('名','') },\r\n"
"    { ic:'ti-repeat',       c:'var(--accent)',  k:t('回数','Shifts'),\r\n"
"      v:String(sum.rows.reduce(function(a,b){return a+b.count;},0)), s:t('回','') },\r\n"
"    { ic:'ti-cash-banknote',c:'var(--green)',   k:t('支給合計','Total pay'), v:_money(sum.total),\r\n"
"      s:t('この期間','this period'), big:true },\r\n"
"    { ic:'ti-tag',          c:'var(--muted)',   k:t('単価','Rate'),        v:_money(sum.amount),\r\n"
"      s:t('1回あたり','per shift') }\r\n"
"  ];\r\n"
"  h+='<div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:9px\">'\r\n"
"    +_slTiles.map(function(x){\r\n"
"      return '<div style=\"border:1px solid '+(x.big?x.c+'44':'var(--border)')+';border-radius:11px;padding:8px 10px;'\r\n"
"        +'background:'+(x.big?x.c+'0f':'var(--surface)')+'\">'\r\n"
"        +'<div style=\"display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);font-weight:700\">'\r\n"
"        +'<i class=\"ti '+x.ic+'\" style=\"color:'+x.c+';font-size:12px\"></i>'+x.k+'</div>'\r\n"
"        +'<div style=\"font-size:'+(x.big?'21':'18')+'px;font-weight:800;color:'+(x.big?x.c:'var(--tm)')+';line-height:1.25\">'+x.v+'</div>'\r\n"
"        +'<div style=\"font-size:9.5px;color:var(--muted)\">'+x.s+'</div></div>';\r\n"
"    }).join('') + '</div>';\r\n"
"  /* 出力（給与にそのまま渡せる形） */\r\n"
"  if(sum.rows.length){\r\n"
"    h+='<button class=\"btn btn-secondary btn-sm\" style=\"width:100%;margin-top:8px\" '\r\n"
"      +'onclick=\"exportSlPayrollCSV(\\''+escapeHtml(storeId)+'\\',\\''+per.to+'\\')\">'\r\n"
"      +'<i class=\"ti ti-file-download\" style=\"color:var(--green)\"></i> '\r\n"
"      +t('支給一覧をCSV出力','Export payout list')+'（'+_money(sum.total)+'）</button>';\r\n"
"  }\r\n"
)
rep_span("  h+='<div style=\"display:flex;gap:14px;margin-top:8px;flex-wrap:wrap\">'",
         "  if(!hasJob){", STATS, "集計タイルを色＋アイコン付きに")


# =====================================================================
# 3) 画面：支給明細（表 → 誰にいくらが一目で分かるカード）
# =====================================================================
LIST = (
"    /* v887: 表だと横に流れて金額が読めなかった。1人1枚にして、\r\n"
"       支給額を右に大きく緑で出す。順位・L/D・該当日を色分けする。 */\r\n"
"    var _slMax = sum.rows.reduce(function(a,b){ return Math.max(a, b.amount||0); }, 0) || 1;\r\n"
"    var _slChip = function(ic, lbl, n, col){\r\n"
"      if(!n) return '';\r\n"
"      return '<span style=\"display:inline-flex;align-items:center;gap:3px;border-radius:6px;padding:2px 7px;'\r\n"
"        +'font-weight:800;color:'+col+';background:'+col+'14;border:1px solid '+col+'33\">'\r\n"
"        +'<i class=\"ti '+ic+'\" style=\"font-size:11px\"></i>'+lbl+' '+n+'</span>';\r\n"
"    };\r\n"
"    h+='<div class=\"card\" style=\"padding:10px 11px\">'\r\n"
"      +'<div style=\"display:flex;align-items:center;gap:7px;margin-bottom:9px;flex-wrap:wrap\">'\r\n"
"      +'<i class=\"ti ti-cash-banknote\" style=\"color:var(--green);font-size:16px\"></i>'\r\n"
"      +'<span style=\"font-size:12.5px;font-weight:800\">'+t('支給明細','Payout')+'</span>'\r\n"
"      +'<span style=\"font-size:10.5px;color:var(--muted)\">'+t('誰にいくら払うか','who gets paid what')+'</span>'\r\n"
"      +'<span style=\"margin-left:auto;font-size:16px;font-weight:800;color:var(--green)\">'+_money(sum.total)+'</span>'\r\n"
"      +'</div>';\r\n"
"    sum.rows.forEach(function(r, i){\r\n"
"      var rank=i+1;\r\n"
"      var medal = rank===1?'#d4a017' : rank===2?'#9aa0a6' : rank===3?'#b87333' : '';\r\n"
"      var pct = Math.max(4, Math.round(((r.amount||0)/_slMax)*100));\r\n"
"      h+='<div style=\"border:1px solid var(--border);border-radius:11px;padding:9px 10px;margin-bottom:7px\">'\r\n"
"        +'<div style=\"display:flex;align-items:center;gap:8px\">'\r\n"
"        +'<span style=\"flex-shrink:0;width:21px;height:21px;border-radius:50%;display:inline-flex;'\r\n"
"        +'align-items:center;justify-content:center;font-size:10.5px;font-weight:800;'\r\n"
"        +'color:'+(medal?'#fff':'var(--muted)')+';background:'+(medal||'var(--surface2)')+'\">'+rank+'</span>'\r\n"
"        +'<span style=\"font-size:13.5px;font-weight:800;min-width:0;overflow:hidden;'\r\n"
"        +'text-overflow:ellipsis;white-space:nowrap\">'+escapeHtml(r.name)+'</span>'\r\n"
"        +'<span style=\"margin-left:auto;font-size:18px;font-weight:800;color:var(--green);'\r\n"
"        +'white-space:nowrap\">'+_money(r.amount)+'</span></div>'\r\n"
"        +'<div style=\"height:5px;border-radius:3px;background:var(--surface2);margin:7px 0 6px;overflow:hidden\">'\r\n"
"        +'<div style=\"height:100%;width:'+pct+'%;background:var(--green);opacity:.85\"></div></div>'\r\n"
"        +'<div style=\"display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:10.5px\">'\r\n"
"        +_slChip('ti-sun','L', r.L, 'var(--accent2)')\r\n"
"        +_slChip('ti-moon','D', r.D, 'var(--accent)')\r\n"
"        +'<span style=\"color:var(--muted);font-weight:700\">'+r.count+t('回','')+' × '+_money(sum.amount)+'</span>'\r\n"
"        +'</div>'\r\n"
"        +'<div style=\"margin-top:6px;font-size:10px;line-height:2\">'\r\n"
"        +(r.recs||[]).slice().sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); })\r\n"
"          .map(function(x){\r\n"
"            var c = (x.period==='D') ? 'var(--accent)' : 'var(--accent2)';\r\n"
"            return '<span style=\"display:inline-flex;align-items:center;gap:2px;border-radius:5px;'\r\n"
"              +'padding:1px 5px;margin:0 4px 3px 0;font-weight:700;white-space:nowrap;'\r\n"
"              +'color:'+c+';background:'+c+'12;border:1px solid '+c+'2e\">'\r\n"
"              +escapeHtml(String(x.date).slice(5))+' '+x.period\r\n"
"              +(x.src==='manual'?'<i class=\"ti ti-hand-finger\" style=\"font-size:9px\" title=\"手入力\"></i>':'')\r\n"
"              +'</span>';\r\n"
"          }).join('')\r\n"
"        +'</div></div>';\r\n"
"    });\r\n"
"    h+='<div style=\"display:flex;align-items:center;gap:6px;border-top:2px solid var(--border);'\r\n"
"      +'padding-top:9px;margin-top:2px\">'\r\n"
"      +'<i class=\"ti ti-sum\" style=\"color:var(--green)\"></i>'\r\n"
"      +'<span style=\"font-size:12px;font-weight:800\">'+t('支給合計','Total')+'</span>'\r\n"
"      +'<span style=\"font-size:10.5px;color:var(--muted)\">'+sum.rows.length+t('名','')+'</span>'\r\n"
"      +'<span style=\"margin-left:auto;font-size:19px;font-weight:800;color:var(--green)\">'\r\n"
"      +_money(sum.total)+'</span></div>';\r\n"
"    h+='</div>';\r\n"
)
rep_span("    h+='<div class=\"card\" style=\"padding:8px\"><div style=\"overflow:auto\"><table style=\"border-collapse:collapse;font-size:11.5px;width:100%\">'",
         "  }\r\n  if(sum.excluded.length){", LIST, "支給明細を1人1枚のカードに（色・アイコン付き）")


# =====================================================================
# 4) Tip一覧CSV：単価・手当・受取＋手当 の列を足す
# =====================================================================
OLD_TIP = (
"  var _slc = (typeof slCountsInRange==='function') ? slCountsInRange(storeId, range.from, range.to) : {};\r\n"
"  rows.push(['氏名','区分','労働時間','日次配分計($)','SL拠出($)','再分配受取($)','最終受取($)',\r\n"
"    'シフトリーダー ランチ(回)','シフトリーダー ディナー(回)','シフトリーダー 計(回)']);\r\n"
"  settle.rows.forEach(r=>{\r\n"
"    var _c=_slc[r.name]||{L:0,D:0,total:0};\r\n"
"    rows.push([r.name, r.isSL?'Store Leader':'スタッフ',\r\n"
"      r.hours.toFixed(2), r.base.toFixed(2), r.contribution.toFixed(2), r.redistrib.toFixed(2), r.final.toFixed(2),\r\n"
"      _c.L, _c.D, _c.total]);\r\n"
"  });\r\n"
"  /* 精算表に出てこない人（配分ゼロでもSLを務めた人）を落とさない */\r\n"
"  Object.keys(_slc).forEach(function(nm){\r\n"
"    if(settle.rows.some(function(r){ return r.name===nm; })) return;\r\n"
"    var c=_slc[nm];\r\n"
"    rows.push([nm,'スタッフ','0.00','0.00','0.00','0.00','0.00', c.L, c.D, c.total]);\r\n"
"  });\r\n"
"  var totalFinal = settle.rows.reduce((a,r)=>a+r.final,0);\r\n"
"  rows.push(['合計','','','','','', totalFinal.toFixed(2)]);\r\n"
"  return rows;\r\n"
)
NEW_TIP = (
"  /* v887: 回数だけでは支給できないので、単価・手当・受取＋手当まで出す（Motoさん依頼）。\r\n"
"     金額は slPayrollData()＝slPeriodSummary() が正。slCountsInRange() は数えるだけで\r\n"
"     単価を持たず、制度対象外の店も数えてしまうので、金額を出すこちらでは使わない。 */\r\n"
"  var _slp = slPayrollData(storeId, range.from, range.to);\r\n"
"  var _slc = {}; (_slp.rows||[]).forEach(function(x){ _slc[x.name]=x; });\r\n"
"  var _slRate = _slp.enabled ? _slp.amount.toFixed(2) : '';\r\n"
"  rows.push(['氏名','区分','労働時間','日次配分計($)','SL拠出($)','再分配受取($)','最終受取($)',\r\n"
"    'シフトリーダー ランチ(回)','シフトリーダー ディナー(回)','シフトリーダー 計(回)',\r\n"
"    'シフトリーダー 単価($)','シフトリーダー 手当($)','受取＋手当($)']);\r\n"
"  settle.rows.forEach(r=>{\r\n"
"    var _c=_slc[r.name], _amt=_c?(_c.amount||0):0;\r\n"
"    rows.push([r.name, r.isSL?'Store Leader':'スタッフ',\r\n"
"      r.hours.toFixed(2), r.base.toFixed(2), r.contribution.toFixed(2), r.redistrib.toFixed(2), r.final.toFixed(2),\r\n"
"      _c?_c.L:0, _c?_c.D:0, _c?_c.count:0,\r\n"
"      _c?_slRate:'', _amt.toFixed(2), (r.final+_amt).toFixed(2)]);\r\n"
"  });\r\n"
"  /* 精算表に出てこない人（配分ゼロでもSLを務めた人）を落とさない */\r\n"
"  Object.keys(_slc).forEach(function(nm){\r\n"
"    if(settle.rows.some(function(r){ return r.name===nm; })) return;\r\n"
"    var c=_slc[nm];\r\n"
"    rows.push([nm,'スタッフ','0.00','0.00','0.00','0.00','0.00', c.L, c.D, c.count,\r\n"
"      _slRate, (c.amount||0).toFixed(2), (c.amount||0).toFixed(2)]);\r\n"
"  });\r\n"
"  var totalFinal = settle.rows.reduce((a,r)=>a+r.final,0);\r\n"
"  rows.push(['合計','','','','','', totalFinal.toFixed(2), '','','','',\r\n"
"    (_slp.total||0).toFixed(2), (totalFinal+(_slp.total||0)).toFixed(2)]);\r\n"
"  /* 給与担当が1枚で完結できるよう、支給明細（該当日つき）も同じCSVに付ける。 */\r\n"
"  if(_slp.enabled && (_slp.rows||[]).length){\r\n"
"    rows.push([]);\r\n"
"    rows = rows.concat(slPayrollRows(storeId, range.from, range.to));\r\n"
"  }\r\n"
"  return rows;\r\n"
)
rep(OLD_TIP, NEW_TIP, "Tip一覧CSV に 単価・手当・受取＋手当 と支給明細を追加")


# =====================================================================
# 5) 配分表CSV：単価・支給額の列と合計行を足す
# =====================================================================
OLD_MTX = (
"  var _slc = (typeof slCountsInRange==='function') ? slCountsInRange(storeId, info.from, info.to) : {};\r\n"
"  var _slNames = Object.keys(_slc).sort();\r\n"
"  if(_slNames.length){\r\n"
"    rows.push([]);\r\n"
"    rows.push(['【シフトリーダー】']);\r\n"
"    var _slHead=['従業員＼日付',''];\r\n"
"    dists.forEach(function(x){ _slHead.push(md(x.date)+' ランチ'); _slHead.push(md(x.date)+' ディナー'); });\r\n"
"    _slHead.push('期間合計(回)');\r\n"
"    rows.push(_slHead);\r\n"
"    var _slDay={};\r\n"
"    dists.forEach(function(x){ try{ _slDay[x.date]=slDayRecords(storeId, x.date); }catch(e){ _slDay[x.date]={ok:[]}; } });\r\n"
"    _slNames.forEach(function(nm){\r\n"
"      var row=[nm,''], tot=0;\r\n"
"      dists.forEach(function(x){\r\n"
"        var ok=(_slDay[x.date]||{}).ok||[];\r\n"
"        var hasL=ok.some(function(z){ return z.name===nm && z.period!=='D'; });\r\n"
"        var hasD=ok.some(function(z){ return z.name===nm && z.period==='D'; });\r\n"
"        row.push(hasL?'SL':''); row.push(hasD?'SL':'');\r\n"
"        if(hasL) tot++; if(hasD) tot++;\r\n"
"      });\r\n"
"      row.push(tot); rows.push(row);\r\n"
"    });\r\n"
"  }\r\n"
)
NEW_MTX = (
"  /* v887: 回数の右に単価と支給額を足す（Motoさん依頼）。金額は slPayrollData() が正。 */\r\n"
"  var _slp = slPayrollData(storeId, info.from, info.to);\r\n"
"  var _slPay = _slp.rows||[];\r\n"
"  if(_slPay.length){\r\n"
"    rows.push([]);\r\n"
"    rows.push(['【シフトリーダー】','単価 $'+_slp.amount.toFixed(2)+' / 1回','対象は G1 のみ']);\r\n"
"    var _slHead=['従業員＼日付',''];\r\n"
"    dists.forEach(function(x){ _slHead.push(md(x.date)+' ランチ'); _slHead.push(md(x.date)+' ディナー'); });\r\n"
"    _slHead.push('期間合計(回)'); _slHead.push('単価($)'); _slHead.push('支給額($)');\r\n"
"    rows.push(_slHead);\r\n"
"    var _slDay={};\r\n"
"    dists.forEach(function(x){ try{ _slDay[x.date]=slDayRecords(storeId, x.date); }catch(e){ _slDay[x.date]={ok:[]}; } });\r\n"
"    _slPay.forEach(function(p){\r\n"
"      var nm=p.name, row=[nm,''], tot=0;\r\n"
"      dists.forEach(function(x){\r\n"
"        var ok=(_slDay[x.date]||{}).ok||[];\r\n"
"        var hasL=ok.some(function(z){ return z.name===nm && z.period!=='D'; });\r\n"
"        var hasD=ok.some(function(z){ return z.name===nm && z.period==='D'; });\r\n"
"        row.push(hasL?'SL':''); row.push(hasD?'SL':'');\r\n"
"        if(hasL) tot++; if(hasD) tot++;\r\n"
"      });\r\n"
"      row.push(tot); row.push(_slp.amount.toFixed(2)); row.push((p.amount||0).toFixed(2));\r\n"
"      rows.push(row);\r\n"
"    });\r\n"
"    var _slTot=['合計','']; dists.forEach(function(){ _slTot.push(''); _slTot.push(''); });\r\n"
"    _slTot.push(_slPay.reduce(function(a,x){ return a+(x.count||0); },0));\r\n"
"    _slTot.push(''); _slTot.push(_slp.total.toFixed(2));\r\n"
"    rows.push(_slTot);\r\n"
"  }\r\n"
)
rep(OLD_MTX, NEW_MTX, "配分表CSV に 単価・支給額・合計行を追加")

rep("showToast('配分表（①〜④＋各スタッフ／Tip Rate／シフトリーダー付き）をCSV出力しました','success');",
    "showToast('配分表（①〜④＋各スタッフ／Tip Rate／シフトリーダー支給額つき）をCSV出力しました','success');",
    "配分表の出力メッセージを実態に合わせる")


# =====================================================================
# 6) 出力センター：シフトリーダー手当カード（店ごとの支給額を出してから出力）
# =====================================================================
SL_CARD = (
"  /* v887: 出力する前に「どの店にいくら出るか」が見えるようにする。Motoさん依頼。 */\r\n"
"  var _slStores = stores.filter(function(s){\r\n"
"    return (typeof slStoreEnabled==='function') && slStoreEnabled(s.id);\r\n"
"  });\r\n"
"  if(_slStores.length){\r\n"
"    var _slGrand = 0, _slCards = '';\r\n"
"    _slStores.forEach(function(s){\r\n"
"      var a = slPayrollData(s.id, _p4Period(d1).from, _p4Period(d1).to);\r\n"
"      var b = slPayrollData(s.id, _p4Period(d2).from, _p4Period(d2).to);\r\n"
"      var mo = (a.total||0) + (b.total||0);\r\n"
"      var ppl = {}; (a.rows||[]).concat(b.rows||[]).forEach(function(r){ ppl[r.name]=1; });\r\n"
"      _slGrand += mo;\r\n"
"      _slCards += '<div style=\"padding:9px 0;border-bottom:1px solid var(--border)\">'\r\n"
"        + '<div style=\"display:flex;align-items:center;gap:6px;flex-wrap:wrap\">'\r\n"
"        + '<span class=\"store-dot\" style=\"background:'+s.color+'\"></span>'\r\n"
"        + '<span style=\"font-weight:700;font-size:13px\">'+escapeHtml(s.name)+'</span>'\r\n"
"        + '<span style=\"font-size:10.5px;color:var(--muted)\"><i class=\"ti ti-users\"></i> '\r\n"
"        + Object.keys(ppl).length + '名</span>'\r\n"
"        + '<span style=\"margin-left:auto;font-size:15px;font-weight:800;color:'\r\n"
"        + (mo>0?'var(--green)':'var(--muted)')+'\">'+_money(mo)+'</span></div>'\r\n"
"        + '<div style=\"display:flex;gap:6px;margin-top:6px\">'\r\n"
"        + '<button class=\"btn btn-secondary btn-sm\" style=\"flex:1\" '\r\n"
"        + 'onclick=\"exportSlPayrollCSV(\\''+s.id+'\\',\\''+d1+'\\')\">1〜15日 '+_money(a.total||0)+'</button>'\r\n"
"        + '<button class=\"btn btn-secondary btn-sm\" style=\"flex:1\" '\r\n"
"        + 'onclick=\"exportSlPayrollCSV(\\''+s.id+'\\',\\''+d2+'\\')\">16〜末 '+_money(b.total||0)+'</button>'\r\n"
"        + '</div></div>';\r\n"
"    });\r\n"
"    html += '<div class=\"card\"><div class=\"card-title\">'\r\n"
"      + '<i class=\"ti ti-crown\" style=\"color:#d4a017\"></i>シフトリーダー手当'\r\n"
"      + '<span class=\"tag tag-green\" style=\"margin-left:auto\">'+_money(_slGrand)+'</span></div>'\r\n"
"      + '<p style=\"font-size:12px;color:var(--muted);margin-bottom:6px\">'\r\n"
"      + '誰が何回務めて、いくら払うかを出力します（該当日つき）。対象は G1 のみ・'\r\n"
"      + '単価は Shift Leader 設定の $'+ (typeof slCfg==='function'? slCfg().amount.toFixed(2) : '0.00') +'/回。</p>'\r\n"
"      + _slCards\r\n"
"      + '<button class=\"btn btn-primary\" style=\"width:100%;margin-top:10px\" '\r\n"
"      + 'onclick=\"exportAllSlPayrollCSV(\\''+d1+'\\',\\''+d2+'\\')\">'\r\n"
"      + '<i class=\"ti ti-download\"></i> 全店まとめて出力（両期間）</button></div>';\r\n"
"  }\r\n"
"\r\n"
)
rep("  html += `<div class=\"card\"><div class=\"card-title\"><i class=\"ti ti-clipboard-list\" style=\"color:var(--accent)\"></i>月次棚卸一覧</div>\r\n",
    SL_CARD + "  html += `<div class=\"card\"><div class=\"card-title\"><i class=\"ti ti-clipboard-list\" style=\"color:var(--accent)\"></i>月次棚卸一覧</div>\r\n",
    "出力センターにシフトリーダー手当カードを追加")

rep("<div><div class=\"section-title\">経理出力</div><div class=\"section-sub\">Tip一覧・月次棚卸をCSV出力（Excelで開けます）</div></div>",
    "<div><div class=\"section-title\"><i class=\"ti ti-file-export\" style=\"color:var(--accent)\"></i> 経理出力</div>"
    "<div class=\"section-sub\">Tip一覧・シフトリーダー手当・月次棚卸をCSV出力（Excelで開けます）</div></div>",
    "出力センターの見出しを更新")


# =====================================================================
# 7) バージョン
# =====================================================================
rep("const APP_VERSION = '886';", "const APP_VERSION = '887';", "APP_VERSION 886 -> 887")

open(P, 'wb').write(d)

d2 = open(P, 'rb').read()
crlf = d2.count(b'\r\n'); lf = d2.count(b'\n')
print('\nCRLF %d (was %d) / lone LF %d' % (crlf, orig_crlf, lf - crlf))
assert lf - crlf == 0, 'lone LF detected'

s = open('sw.js', 'rb').read()
assert s.count(b"const SW_BUILD = '886';") == 1
open('sw.js', 'wb').write(s.replace(b"const SW_BUILD = '886';", b"const SW_BUILD = '887';", 1))
print('OK   SW_BUILD 886 -> 887')
