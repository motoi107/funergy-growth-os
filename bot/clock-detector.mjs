// Generated from the Funergy+ clock-error block. Do not edit rules here.
// Regenerate with node scripts/extract-bot-clock.cjs.
// Providers must supply the app-equivalent effective labor and explicit settings.
export function createClockDetector({ getTipLabor, getCeCfg }) {
  if (typeof getTipLabor !== 'function' || typeof getCeCfg !== 'function')
    throw new TypeError('Effective labor and configuration providers are required');
var CE_DEFAULT_CFG = { nightFrom:'03:00', nightTo:'05:00', longH:12, shortMin:15 };
var CE_KIND_LABEL = {
  auto:'自動クロックアウト疑い', reverse:'IN/OUT逆転', bad:'時刻不正',
  long:'長時間', short:'極端に短い', overlap:'打刻重複'
};
var CE_ERROR_KINDS = ['auto','reverse','bad'];   /* 確実（赤）。それ以外は疑い（黄） */
/* ハワイ時刻での「その日の何分目か」。splitHours と同じ -10h の作法にそろえる
   （新しい時差ロジックを作らない。ここを自前で書くと必ずずれる）。 */
function _ceMinOfDay(iso){
  if(!iso) return null;
  var ms = new Date(iso).getTime(); if(isNaN(ms)) return null;
  var d = new Date(ms - 10*3600*1000);
  return d.getUTCHours()*60 + d.getUTCMinutes();
}
function _ceHm(str){ var m=String(str||'').match(/^(\d{1,2}):(\d{2})$/); return m?(+m[1]*60 + +m[2]):null; }
function _ceClock(iso){
  var m=_ceMinOfDay(iso); if(m==null) return '--:--';
  return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
}
function _ceHours(sh){
  if(!sh || !sh.inDate || !sh.outDate) return null;
  var a=new Date(sh.inDate).getTime(), b=new Date(sh.outDate).getTime();
  if(isNaN(a)||isNaN(b)) return null;
  return (b-a)/3600000;
}
/* 窓は日付をまたぐことがある（例 23:00〜05:00）ので両方に対応する */
function _ceInNight(min, cfg){
  var a=_ceHm(cfg.nightFrom), b=_ceHm(cfg.nightTo);
  if(min==null || a==null || b==null) return false;
  return (a<=b) ? (min>=a && min<=b) : (min>=a || min<=b);
}
/* 打刻1本の判定。確実(error)と疑い(warn)を分ける。 */
function ceCheckShift(sh, cfg){
  cfg = cfg || getCeCfg();
  var kinds = [];
  if(!sh || !sh.inDate) return { level:null, kinds:kinds, hours:0 };
  var h = _ceHours(sh);
  if(h==null){ kinds.push('bad'); return { level:'error', kinds:kinds, hours:0 }; }
  if(h<=0) kinds.push('reverse');
  if(_ceInNight(_ceMinOfDay(sh.outDate), cfg)) kinds.push('auto');
  if(kinds.length) return { level:'error', kinds:kinds, hours:h };
  /* ★ここから下は「疑い」。深夜帯でない12hは正常な長時間勤務でありうる。 */
  if(h > cfg.longH) kinds.push('long');
  else if(h*60 < cfg.shortMin) kinds.push('short');
  return { level: kinds.length?'warn':null, kinds:kinds, hours:h };
}
function _ceOverlap(shifts){
  var a=(shifts||[]).filter(function(x){ return x && x.inDate && x.outDate; })
    .map(function(x){ return { s:new Date(x.inDate).getTime(), e:new Date(x.outDate).getTime() }; })
    .filter(function(x){ return !isNaN(x.s) && !isNaN(x.e) && x.e>x.s; })
    .sort(function(p,q){ return p.s-q.s; });
  for(var i=1;i<a.length;i++){ if(a[i].s < a[i-1].e) return true; }
  return false;
}
/* 1日ぶん。人ごとにまとめる。 */
function ceScanDay(storeId, date, cfg){
  cfg = cfg || getCeCfg();
  var out = { date:date, rows:[], nError:0, nWarn:0 };
  var labor = getTipLabor(storeId, date);
  if(!labor) return out;
  Object.keys(labor).forEach(function(n){
    var e = labor[n]||{}, shifts = e.shifts||[];
    if(!shifts.length) return;
    var kinds={}, level=null, det=[];
    shifts.forEach(function(sh){
      var r = ceCheckShift(sh, cfg);
      if(!r.kinds.length) return;
      r.kinds.forEach(function(k){ kinds[k]=1; });
      if(r.level==='error') level='error';
      else if(r.level==='warn' && level!=='error') level='warn';
      det.push({ inClock:_ceClock(sh.inDate), outClock:_ceClock(sh.outDate),
                 hours:Math.round((r.hours||0)*100)/100, kinds:r.kinds });
    });
    if(_ceOverlap(shifts)){ kinds['overlap']=1; if(level!=='error') level='warn'; }
    if(!level) return;
    out.rows.push({ name:n, date:date, level:level, kinds:Object.keys(kinds), det:det });
    if(level==='error') out.nError++; else out.nWarn++;
  });
  return out;
}
return { ceCheckShift, ceScanDay, _ceOverlap, _ceClock, CE_DEFAULT_CFG, CE_KIND_LABEL, CE_ERROR_KINDS };
}
