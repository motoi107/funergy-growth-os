# -*- coding: utf-8 -*-
"""v904: 中間MTGの実績カードに「差分の原因」を表示する

  v903 で作った _meetGapBreakdown を描くだけ。新しい計算はしない。

  出すもの（売上のみ。他KPIは分解できないか、既に区分別内訳がある）:
    ① どこで足りないか … 店内ランチ / 店内ディナー / テイクアウト の差を横バーで
    ② 曜日別          … 月〜日の差を縦バーで。曜日別予算がある店のみ
    ③ 客数か客単価か   … ΔS =（客数のせい）＋（客単価のせい）の恒等分解

  分解できないときは理由を1行で出す。0や — で誤魔化さない。
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

BLOCK = r"""/* v904: 差分の原因を描く。計算は _meetGapBreakdown(v903) が持つ。ここは表示だけ。 */
function _meetGapHtml(storeId, ym, key){
  var g = null;
  try { g = _meetGapBreakdown(storeId, ym, key); } catch(e){ return ''; }
  if (!g) return '';
  var muted = 'color:var(--muted);font-size:9.5px';
  if (!g.ok) {
    /* 分解できない理由は出す。黙って消すと「なぜ出ないのか」が毎回議題になる。 */
    if (g.reason==='no_budget' || g.reason==='no_actual' || g.reason==='no_days')
      return '<div style="'+muted+';margin-top:6px">'+escapeHtml(g.note)+'</div>';
    return '';
  }
  var money = (g.unit!=='count');
  var f  = function(v){ return money ? fmtK(v) : (Math.round(v)+t('名','')); };
  var fd = function(v){ var s=(v>=0?'+':'−'); return s+(money?fmtK(Math.abs(v)):Math.round(Math.abs(v))); };
  var col = function(v){ return v>=0 ? 'var(--green)' : 'var(--red)'; };

  var h = '<div style="border-top:1px solid var(--border);margin-top:9px;padding-top:8px">';

  /* ① 区分別。バーの長さは「差の絶対値」の構成比。未達の内訳を見るための図。 */
  var segs = g.segs || [];
  var neg = 0; segs.forEach(function(s){ var x=g.ld[s]; if(x && x.gap<0) neg += -x.gap; });
  h += '<div style="'+muted+';margin-bottom:5px">'+t('どこで足りないか','Where the gap is')+'</div>';
  segs.forEach(function(s){
    var x = g.ld[s]; if(!x) return;
    var share = (neg>0 && x.gap<0) ? (-x.gap/neg) : 0;
    var w = Math.max(2, Math.round(share*100));
    h += '<div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">'
      +  '<span style="font-size:10.5px;width:58px;flex-shrink:0">'+escapeHtml(x.label)+'</span>'
      +  '<div style="flex:1;height:14px;background:var(--surface2);border-radius:3px;overflow:hidden">'
      +  (x.gap<0 ? '<div style="width:'+w+'%;height:100%;background:var(--red)"></div>' : '')
      +  '</div>'
      +  '<span style="font-size:10.5px;font-weight:700;color:'+col(x.gap)+';width:74px;text-align:right;flex-shrink:0">'+fd(x.gap)+'</span>'
      +  '</div>';
  });
  /* 最大の未達区分を1行で言う */
  if (neg>0) {
    var top=null; segs.forEach(function(s){ var x=g.ld[s]; if(x && x.gap<0 && (!top || x.gap<g.ld[top].gap)) top=s; });
    if (top) {
      var pct = Math.round(-g.ld[top].gap/neg*100);
      h += '<div style="font-size:10px;color:var(--tm);margin-top:2px">'
        +  t('不足の','')+' <b style="color:var(--red)">'+pct+'%</b> '+t('が','')+escapeHtml(g.ld[top].label)+'</div>';
    }
  }

  /* ③ 客数か客単価か。恒等分解なので「どちらのせいか」を断定できる。 */
  if (g.cause) {
    var c = g.cause;
    var gp = (c.guestsTgt>0) ? Math.round(c.guestsAct/c.guestsTgt*100) : null;
    var pp = (c.ppaTgt>0)    ? Math.round(c.ppaAct/c.ppaTgt*100)       : null;
    h += '<div style="font-size:10px;color:var(--tm);margin-top:5px;line-height:1.7">'
      +  t('客数','Guests')+' <b style="color:'+(gp!=null&&gp<100?'var(--red)':'var(--green)')+'">'+(gp!=null?gp+'%':'—')+'</b>'
      +  '（'+fd(c.guestsEffect)+'）　'
      +  t('客単価','Avg check')+' <b style="color:'+(pp!=null&&pp<100?'var(--red)':'var(--green)')+'">'+(pp!=null?pp+'%':'—')+'</b>'
      +  '（'+fd(c.ppaEffect)+'）'
      +  '<br>→ '+t('主因は','Driver: ')+'<b style="color:var(--red)">'
      +  (c.driver==='guests'?t('集客','traffic'):t('客単価','avg check'))+'</b></div>';
  }

  /* ② 曜日別。曜日別予算がある店だけ。無い店では v903 が null を返す。 */
  if (g.dow && g.dow.length===7) {
    var mx = 0; g.dow.forEach(function(d){ var a=Math.abs(d.gap); if(a>mx) mx=a; });
    if (mx>0) {
      h += '<div style="'+muted+';margin:8px 0 5px">'+t('曜日別（予算との差）','By day of week')+'</div>'
        +  '<div style="display:flex;gap:3px;align-items:flex-end;height:46px">';
      g.dow.forEach(function(d){
        var hh = Math.max(3, Math.round(Math.abs(d.gap)/mx*34));
        var c2 = d.gap<0 ? 'var(--red)' : 'var(--green)';
        h += '<div style="flex:1;text-align:center" title="'+escapeHtml(d.label)+' '+fd(d.gap)+'（'+d.days+t('回','')+'）">'
          +  '<div style="height:'+hh+'px;background:'+c2+';border-radius:2px"></div>'
          +  '<div style="font-size:9.5px;color:'+(d.gap<0?'var(--red)':'var(--muted)')+';margin-top:3px">'+escapeHtml(d.label)+'</div></div>';
      });
      h += '</div>';
      /* 未達が大きい曜日を上位3つまで名指しする */
      var bad = g.dow.filter(function(d){ return d.gap<0; }).sort(function(a,b){ return a.gap-b.gap; }).slice(0,3);
      var negD = 0; g.dow.forEach(function(d){ if(d.gap<0) negD += -d.gap; });
      if (bad.length && negD>0) {
        var sh2 = Math.round(bad.reduce(function(a,d){ return a + (-d.gap); },0)/negD*100);
        h += '<div style="font-size:10px;color:var(--tm);margin-top:6px">'
          +  '<b style="color:var(--red)">'+bad.map(function(d){ return escapeHtml(d.label); }).join('・')+'</b> '
          +  t('で不足の','')+' <b>'+sh2+'%</b></div>';
      }
    }
  } else if (g.tgtMode==='prorate') {
    h += '<div style="'+muted+';margin-top:7px">'+t('曜日別は曜日別予算を設定すると表示されます（現在は月次予算の日割り）','Set a day-of-week budget to see the weekday split')+'</div>';
  }

  h += '<div style="'+muted+';margin-top:6px">'
    +  t('前日までの','')+g.days+t('日ぶん','d')+(g.hasTakeout?t('／テイクアウトは区分を分けて計上','/takeout counted separately'):'')+'</div>';
  return h + '</div>';
}
"""

src = rep(src,
    "/* 中間MTG: KPIをアイコン＋達成/未達バッジで強調表示 */",
    BLOCK + "/* 中間MTG: KPIをアイコン＋達成/未達バッジで強調表示 */",
    u'_meetGapHtml の追加')

# 売上ヒーローの中、閉じる直前に差し込む。中間（当月）でも過去月でも出す。
src = rep(src,
    "  h+='</div>';\n"
    "  h+='<div style=\"display:flex;justify-content:flex-end;margin:3px 0 2px\"><button class=\"btn btn-secondary btn-sm\" onclick=\"openBudgetReview(",
    "  /* v904: 差分の原因（区分別・曜日別・客数/客単価）。計算は v903。 */\n"
    "  try { h += _meetGapHtml(store.id, ym, 'sales'); } catch(e){}\n"
    "  h+='</div>';\n"
    "  h+='<div style=\"display:flex;justify-content:flex-end;margin:3px 0 2px\"><button class=\"btn btn-secondary btn-sm\" onclick=\"openBudgetReview(",
    u'売上ヒーローへの差し込み')

src = rep(src, "const APP_VERSION = '903';", "const APP_VERSION = '904';", u'APP_VERSION')

assert src.count('\n') - src.count('\r\n') == 0, u'lone LF が残っている'
wr('index.html', src)
sw = rd('sw.js')
wr('sw.js', rep(sw, "const SW_BUILD = '903';", "const SW_BUILD = '904';", u'SW_BUILD'))
print('OK')
