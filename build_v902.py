# -*- coding: utf-8 -*-
"""v902: 中間MTGタブの更新

  ① 売上を日割りで判定・表示する（前日までの実績 vs 日割り予算）
     従来は「実績＝前日まで／予算＝満額」を並べていたので必ず未達に見え、
     しかもバッジだけ着地予測で判定していたため表示と食い違っていた。
     paceFrac は既にあり、客数にだけ掛かっていた。売上にも掛ける。
  ② リピート率にL/D内訳（既存 repeatStatsLD を呼ぶだけ）
  ③ 人件費率にL/D内訳（時給ベースのL/D比で全体人件費を按分＝案a）
  ④ ドリンク比率は現状維持（出数が月単位でL/Dの軸を持たないため）
  ⑤ 中間MTGからタスク欄を外す（月初MTGは残す）
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

# ============ ③ L/D の人件費按分ヘルパー（新規関数） ============
# _meetSegExtra の直前に置く。
src = rep(src,
    "/* 中間MTG: 区分別内訳（客数L/D/TO・客単価L/D/TO・ドリンク酒/ソフト）を目標差リンクで表示 */",
    "/* v902: 人件費率のL/D内訳。\n"
    "   時給×時間はL/Dに割れるが、残業割増（週40h超）・給与税・月給・保険は\n"
    "   週/月単位でしか出せずランチかディナーかに割り当てられない。\n"
    "   そこで「時給ベースのL/D比」で全体人件費（k.labor）を按分する。\n"
    "   注意：L/D売上（ov.lunchSales / ov.dinnerSales）は日次実績の別項目で、\n"
    "   その日の総売上（ov.actual）と必ずしも一致しない。したがってL/Dを売上で加重しても\n"
    "   全体の人件費率にぴったり戻るとは限らない（L/D売上の合計＝人件費率の分母のときだけ一致）。\n"
    "   分子（人件費の総額）は必ず全体と一致する。\n"
    "   新しい人件費の計算式は作らない（全体値は laborCoreForYm のまま）。 */\n"
    "function _meetLaborLD(storeId, ym){\n"
    "  var days=daysOfYm(ym), da={}; try{ da=getDailyActuals(storeId)||{}; }catch(e){}\n"
    "  var lc=0, dc=0, lsv=0, dsv=0;\n"
    "  days.forEach(function(d){\n"
    "    var ov=da[d.date]||{};\n"
    "    lsv+=Number(ov.lunchSales)||0; dsv+=Number(ov.dinnerSales)||0;\n"
    "    var lab=null; try{ lab=getTipLabor(storeId, d.date); }catch(e){}\n"
    "    if(!lab) return;\n"
    "    Object.keys(lab).forEach(function(n){\n"
    "      var e=lab[n]; if(!e) return;\n"
    "      var rL=Number(e.rawLunch)||0, rD=Number(e.rawDinner)||0;\n"
    "      var wL=Number(e.lunch)||0,    wD=Number(e.dinner)||0;\n"
    "      /* _laborHrs と同じ選び方（合計が大きい側を採用）にそろえる */\n"
    "      var useRaw=(rL+rD)>=(wL+wD);\n"
    "      var w=0; try{ w=empWage(n)||0; }catch(e2){}\n"
    "      lc+=(useRaw?rL:wL)*w; dc+=(useRaw?rD:wD)*w;\n"
    "    });\n"
    "  });\n"
    "  return {lunchCost:lc, dinnerCost:dc, lunchSales:lsv, dinnerSales:dsv};\n"
    "}\n"
    "/* 中間MTG: 区分別内訳（客数L/D/TO・客単価L/D/TO・ドリンク酒/ソフト）を目標差リンクで表示 */",
    u'_meetLaborLD の追加')

# ============ seg に「低いほど良い」を通す ============
# 人件費率は lower=true。従来の seg は act>=tgt を無条件に良しとしていた。
src = rep(src,
    "  var seg=function(lbl, act, tgt, money, u){ if(!(act>0) && !(tgt>0)) return '';\n"
    "    var st=(tgt>0&&act>0)?(act>=tgt*0.995):null; var col=st==null?'var(--muted)':(st?'var(--green)':'var(--red)');",
    "  /* v902: lower=true（人件費率など低いほど良い項目）を追加。\n"
    "     従来は act>=tgt を無条件に「良い」としていたため、そのまま人件費率に使うと色が逆になる。 */\n"
    "  var seg=function(lbl, act, tgt, money, u, lower){ if(!(act>0) && !(tgt>0)) return '';\n"
    "    var st=(tgt>0&&act>0)?(lower?(act<=tgt*1.005):(act>=tgt*0.995)):null; var col=st==null?'var(--muted)':(st?'var(--green)':'var(--red)');",
    u'seg に lower を追加')

# ============ ②③ repeat / labor の L/D 分岐 ============
src = rep(src,
    "  if(key==='drink'){ var mix=null;",
    "  /* v902: リピート率のL/D。日次実績の firstTimeBowls・repeatBowls の L/D 別項目から出す（既存関数）。\n"
    "     目標はL/D別に持っていないため、店舗のリピート率目標を両方に当てる。 */\n"
    "  if(key==='repeat'){\n"
    "    var rl=null; try{ rl=repeatStatsLD([{id:storeId}], daysOfYm(ym)); }catch(e){}\n"
    "    if(!rl || !rl.has) return '<div style=\"font-size:9.5px;color:var(--muted);margin-top:3px\">'+t('ランチ/ディナー別は日次実績の入力後に表示','L/D split shows after daily actuals are entered')+'</div>';\n"
    "    var lrt=(rl.lunch.total>0)?Math.round(rl.lunch.repeat/rl.lunch.total*1000)/10:null;\n"
    "    var drt=(rl.dinner.total>0)?Math.round(rl.dinner.repeat/rl.dinner.total*1000)/10:null;\n"
    "    return wrap([ seg(t('ランチ','L'), lrt, k.repeatTgt, false, '%', false),\n"
    "                  seg(t('ディナー','D'), drt, k.repeatTgt, false, '%', false) ]);\n"
    "  }\n"
    "  /* v902: 人件費率のL/D。時給ベースの比で全体人件費を按分（_meetLaborLD 参照）。 */\n"
    "  if(key==='labor'){\n"
    "    var lx=null; try{ lx=_meetLaborLD(storeId, ym); }catch(e){}\n"
    "    var lbase=lx?(lx.lunchCost+lx.dinnerCost):0;\n"
    "    if(!lx || !(lbase>0) || !((lx.lunchSales>0)||(lx.dinnerSales>0))) return '<div style=\"font-size:9.5px;color:var(--muted);margin-top:3px\">'+t('ランチ/ディナー別は勤怠とL/D売上の同期後に表示','L/D split shows after attendance and L/D sales sync')+'</div>';\n"
    "    var fct=(k.labor>0)?(k.labor/lbase):1;   /* 割増・給与税・月給・保険を含む全体へ合わせる */\n"
    "    var llr=(lx.lunchSales>0)?Math.round(lx.lunchCost*fct/lx.lunchSales*1000)/10:null;\n"
    "    var dlr=(lx.dinnerSales>0)?Math.round(lx.dinnerCost*fct/lx.dinnerSales*1000)/10:null;\n"
    "    return wrap([ seg(t('ランチ','L'), llr, k.laborBudgetRate, false, '%', true),\n"
    "                  seg(t('ディナー','D'), dlr, k.laborBudgetRate, false, '%', true) ])\n"
    "      + '<div style=\"font-size:9px;color:var(--muted);margin-top:2px\">'+t('※L/Dは時給比で全体を按分（割増・給与税・月給は日中に割れないため）','* L/D allocates the total by hourly-wage share')+'</div>';\n"
    "  }\n"
    "  if(key==='drink'){ var mix=null;",
    u'repeat / labor の L/D 分岐')

# ============ ① 売上を日割りで判定 ============
src = rep(src,
    "  var salesBase = isCurrent ? landing : (k.sales||0);\n"
    "  var salesSt=_meetStatus('sales', salesBase, k.budget, false);",
    "  /* v902: 中間は「前日までの実績 vs 日割り予算」で判定する。\n"
    "     従来は実績（前日まで）を満額の月間予算と並べていたため必ず未達に見え、\n"
    "     さらにバッジだけ着地予測で判定していたので、表示と判定が食い違っていた。\n"
    "     着地予測はこれまでどおり別行に残す。 */\n"
    "  var paceBudget = isCurrent ? Math.round((k.budget||0)*paceFrac) : (k.budget||0);\n"
    "  var salesBase = (k.sales||0);\n"
    "  var salesSt=_meetStatus('sales', salesBase, paceBudget, false);",
    u'売上の日割り判定')

# バッジの差分表示も日割り予算に合わせる
src = rep(src,
    "+_meetStatLabel(salesSt)+(_meetDiffStr('sales', salesBase, k.budget, false, '', true)?' '+_meetDiffStr('sales', salesBase, k.budget, false, '', true):'')+'</span></div>'",
    "+_meetStatLabel(salesSt)+(_meetDiffStr('sales', salesBase, paceBudget, false, '', true)?' '+_meetDiffStr('sales', salesBase, paceBudget, false, '', true):'')+'</span></div>'",
    u'売上バッジの差分')

# 予算の表示を日割りに。月間予算は小さく併記して情報を失わせない。
src = rep(src,
    "<span style=\"font-size:10.5px;color:var(--muted);font-weight:700\">'+t('予算','BUD')+'</span> <span style=\"font-size:20px;font-weight:800;color:var(--tm)\">'+fmtK(k.budget||0)+'</span></span></div>';",
    "<span style=\"font-size:10.5px;color:var(--muted);font-weight:700\">'+t('予算','BUD')+(isCurrent?t('（前日まで）',' (to date)'):'')+'</span> <span style=\"font-size:20px;font-weight:800;color:var(--tm)\">'+fmtK(paceBudget)+'</span></span>'\n"
    "    +(isCurrent?'<span style=\"white-space:nowrap;font-size:9.5px;color:var(--muted)\">'+t('月間予算','Month')+' '+fmtK(k.budget||0)+'</span>':'')+'</div>';",
    u'予算表示を日割りに')

# ============ ① サマリーも同じ基準に ============
src = rep(src,
    "    var lj=(isCurrent&&mode==='mid'&&dp>0)?Math.round((k.sales||0)/dp*mdn):(k.sales||0);\n"
    "    var sm=0;\n"
    "    rows.forEach(function(it){ var st;\n"
    "      if(it.isSales){ st=_meetStatus('sales', lj, k.budget, false); }",
    "    /* v902: サマリーの売上も店舗カードと同じ「前日まで vs 日割り予算」にそろえる。\n"
    "       ここだけ着地予測で判定していると、カードと未達件数が合わなくなる。 */\n"
    "    var _pf=(isCurrent&&mode==='mid'&&mdn>0)?Math.min(1,dp/mdn):1;\n"
    "    var _pb=Math.round((k.budget||0)*_pf);\n"
    "    totPaceBud+=_pb;\n"
    "    var sm=0;\n"
    "    rows.forEach(function(it){ var st;\n"
    "      if(it.isSales){ st=_meetStatus('sales', (k.sales||0), _pb, false); }",
    u'サマリーの売上判定')

src = rep(src,
    "  var totSales=0, totBud=0, totMiss=0, totKpi=0, storeMiss=0;",
    "  var totSales=0, totBud=0, totMiss=0, totKpi=0, storeMiss=0, totPaceBud=0;",
    u'totPaceBud の宣言')

src = rep(src,
    "+t('売上 実績/予算','Sales act/bud')+'</div><div style=\"font-size:16px;font-weight:800;color:'+_meetStatColor(_meetStatus('sales',totSales,totBud,false))+'\">'+fmtK(totSales)+'</div><div style=\"font-size:9px;color:var(--muted)\">/ '+fmtK(totBud)+'（'+(_meetDiffStr('sales',totSales,totBud,false,'',true)||('±0'))+'）</div></div>'",
    "+t('売上 実績/予算','Sales act/bud')+(_sumPace?t('（前日まで）',' (to date)'):'')+'</div><div style=\"font-size:16px;font-weight:800;color:'+_meetStatColor(_meetStatus('sales',totSales,_sumBud,false))+'\">'+fmtK(totSales)+'</div><div style=\"font-size:9px;color:var(--muted)\">/ '+fmtK(_sumBud)+'（'+(_meetDiffStr('sales',totSales,_sumBud,false,'',true)||('±0'))+'）</div></div>'",
    u'サマリーの売上タイル')

src = rep(src,
    "  var achvAll = totBud>0?Math.round(totSales/totBud*1000)/10:0;",
    "  /* v902: サマリーの分母。中間の当月だけ日割り予算にそろえる。 */\n"
    "  var _sumPace = (isCurrent && mode==='mid');\n"
    "  var _sumBud  = _sumPace ? totPaceBud : totBud;\n"
    "  var achvAll = totBud>0?Math.round(totSales/totBud*1000)/10:0;",
    u'サマリーの分母')

# ============ ②③ カードから extra を渡す ============
src = rep(src,
    "    else if(it.key==='ppa'){ ex=_meetSegExtra(k,'ppa',store.id,ym,1,''); }",
    "    else if(it.key==='ppa'){ ex=_meetSegExtra(k,'ppa',store.id,ym,1,''); }\n"
    "    else if(it.key==='repeat'){ ex=_meetSegExtra(k,'repeat',store.id,ym,1,''); }   /* v902 */\n"
    "    else if(it.key==='labor'){ ex=_meetSegExtra(k,'labor',store.id,ym,1,''); }     /* v902 */",
    u'repeat / labor の extra 呼び出し')

# ============ ⑤ 中間MTGのタスク欄を外す ============
src = rep(src,
    "  else { ks.forEach(function(x){ html+=_meetStoreCard(x.s, x.k, ym, isCurrent)+_meetTaskSection(x.s); }); }",
    "  /* v902: 中間MTGはタスク欄を出さない（月初MTGは従来どおり）。\n"
    "     _meetTaskSection 自体は残してあるので、戻すならここに足すだけ。 */\n"
    "  else { ks.forEach(function(x){ html+=_meetStoreCard(x.s, x.k, ym, isCurrent); }); }",
    u'中間MTGのタスク欄を外す')

# ============ 版 ============
src = rep(src, "const APP_VERSION = '901';", "const APP_VERSION = '902';", u'APP_VERSION')

assert src.count('\n') - src.count('\r\n') == 0, u'lone LF が残っている'
wr('index.html', src)

sw = rd('sw.js')
wr('sw.js', rep(sw, "const SW_BUILD = '901';", "const SW_BUILD = '902';", u'SW_BUILD'))
print('OK')
