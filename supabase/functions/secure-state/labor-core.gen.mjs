// 自動で作ったファイル。手で直さない（index.html を直して `node scripts/build-labor-core.mjs` を流す）。
// v1192：関数 secure-state の labor（人件費の合計）が使う計算。中身は index.html の関数そのまま（93 個）。
// サーバーが用意するもの（env）：STORES・_lrRead・_lsRaw・_mdMemo・bizToday・curYm・escapeHtml・getEmployees・ls・lsKeys・t・v1136Moved
/* eslint-disable */
export const LABOR_CORE_STOPS = ["STORES","_lrRead","_lsRaw","_mdMemo","bizToday","curYm","escapeHtml","getEmployees","ls","lsKeys","ltServerDay","ltServerGrade","ltServerSalary","t","v1136Moved"];
export function laborCore(env) {
  var window = env.window || {};
  var STORES = env.STORES;
  var _lrRead = env._lrRead;
  var _lsRaw = env._lsRaw;
  var _mdMemo = env._mdMemo;
  var bizToday = env.bizToday;
  var curYm = env.curYm;
  var escapeHtml = env.escapeHtml;
  var getEmployees = env.getEmployees;
  var ls = env.ls;
  var lsKeys = env.lsKeys;
  var ltServerDay = undefined;   // サーバーでは上書きしない（端末だけ）
  var ltServerGrade = undefined;   // サーバーでは上書きしない（端末だけ）
  var ltServerSalary = undefined;   // サーバーでは上書きしない（端末だけ）
  var t = env.t;
  var v1136Moved = env.v1136Moved;
var TIP_HOURS_FIX_FROM = '2026-09-16';
var TIP_BIZDAY_END_H = 28;
var DEFAULT_TIP_WINDOW = { lunchStart:10.5, lunchEnd:16, dinnerStart:16, dinnerEnd:23 };
var DOW_SHIFT = ['日','月','火','水','木','金','土'];
var WAGE = { gm:0, ceo:0, office:0, am:28, sl:24, crew:16 };
var JOB_TITLES = [
  {key:'Crew',           label:'Crew',           payType:'hourly',  permRole:'crew', defWage:16},
  {key:'Prep Specialist',label:'Prep Specialist', payType:'hourly', permRole:'crew', defWage:16},
  {key:'Crew Leader',    label:'Crew Leader',    payType:'hourly',  permRole:'crew', defWage:17},
  {key:'Server Leader',  label:'Server Leader',  payType:'hourly',  permRole:'sl',   defWage:18.5},
  {key:'Kitchen Leader', label:'Kitchen Leader', payType:'hourly',  permRole:'sl',   defWage:18.5},
  {key:'Operation Leader',label:'Operation Leader',payType:'hourly', permRole:'sl',   defWage:20},
  {key:'Store Leader',   label:'Store Leader',   payType:'hourly',  permRole:'sl',   defWage:20},
  {key:'Store Manager',  label:'Store Manager',  payType:'monthly', permRole:'sl',   defMonthly:6000},   /* v952: 現場時給を外した。自店は月給の日割り、他店も付けない（Motoさん指示） */
  {key:'Head Chef',      label:'Head Chef',      payType:'monthly', permRole:'sl',   defMonthly:6000, defSiteWage:17},   /* v915: 現場に出たぶんの店舗配賦単価 */
  {key:'Area Manager',   label:'Area Manager',   payType:'monthly', permRole:'am',   defMonthly:7000, defSiteWage:17},
  {key:'Corporate Chef', label:'Corporate Chef', payType:'monthly', permRole:'am',   defMonthly:7000, defSiteWage:17},
  {key:'Customer Service Manager', label:'Customer Service Manager', payType:'monthly', permRole:'am', defMonthly:7000, defSiteWage:17},
  {key:'General Manager',label:'General Manager',payType:'monthly', permRole:'gm',   defMonthly:8000, defSiteWage:17},
  {key:'Office Crew',    label:'事務Crew',       en:'Office Crew', payType:'hourly',  permRole:'office_crew', defWage:18},
  {key:'Office Crew Leader', label:'事務Crew Leader', en:'Office Crew Leader', payType:'hourly'},   /* v1103（回答 4・6）：経理の G2・時給（事務Crew と同じ）。既定の権限ロール・時給は決めない（Score管理 の専門職 × グレードで決めるまで、選んでもロールを変えない） */
  {key:'Accounting Leader', label:'Accounting Leader', payType:'hourly'},   /* v1103（回答 6）：経理の G3・時給 */
  {key:'Accountant',     label:'Accountant',     payType:'monthly', permRole:'office',defMonthly:6000},
  {key:'Office Manager', label:'Accounting Manager', payType:'monthly', permRole:'office',defMonthly:6000},   /* v1103（回答 5 C）：表示名を Accounting Manager に。保存のキーは 'Office Manager' のまま（今の人の記録・給与表・グレード・権限はそのまま） */
  {key:'CEO',            label:'CEO',            payType:'monthly', permRole:'ceo',  defMonthly:10000},
];
var GRADE_TITLES = {
  G1: ['Crew','Office Crew','Office Staff'],
  'G1-P': ['Prep','Prep Specialist'],
  G2: ['Crew Leader','Office Crew Leader'],   /* v1103：事務Crew Leader＝経理の G2 */
  G3: ['Server Leader','Kitchen Leader','Operation Leader','Store Leader','Accounting Leader'],   /* v1103：Accounting Leader＝経理の G3 */
  G4: ['Store Manager','Head Chef','Office Manager','Accountant'],
  G5: ['Area Manager','Corporate Chef','Customer Service Manager'],
  G6: ['General Manager'],
};
var PM_CFG='prep_cfg', PM_TBL='prep_tables', PM_CERT='prep_certs', PM_AP='プレップ認定', PM_LALA='F06';
function toastNameKey(s){ return String(s==null?'':s).normalize('NFKC').toLowerCase().replace(/[\s\-\u2010-\u2015\u2212.,\u0027\u2019_\u30FB@]/g,''); }
function toastAliasField(n, store){ return 'toastAlias_' + toastNameKey(n) + (store ? '@' + store : ''); }
function _toastAliasRec(a){
  if(!a || typeof a!=='object' || typeof a.n!=='string' || !a.n.trim()) return null;
  return { n:a.n.trim(), from:(typeof a.from==='string' && /^\d{4}-\d{2}-\d{2}$/.test(a.from)) ? a.from : '', at:String(a.at||''), by:String(a.by||''), via:String(a.via||''), off:a.off===true,
           store:(typeof a.store==='string' && a.store.length<=60 && a.store.trim()===a.store) ? a.store : '' };   /* 店の ID は店舗マスターで自由に入れられる（独立レビュー 7d234a4 P3-2） */
}
function empToastAliases(e){
  var out=[]; if(!e || typeof e!=='object') return out;
  Object.keys(e).forEach(function(k){ if(k.indexOf('toastAlias_')!==0) return; var a=_toastAliasRec(e[k]); if(!a || a.off || !toastNameKey(a.n) || k!==toastAliasField(a.n, a.store)) return; a.f=k; out.push(a); });
  out.sort(function(a,b){ return a.at.localeCompare(b.at) || a.n.localeCompare(b.n) || a.store.localeCompare(b.store); });
  return out;
}
function toastAliasIndex(staff){
  var idx={};
  (staff||[]).forEach(function(e){ empToastAliases(e).forEach(function(a){ var k=toastNameKey(a.n); if(!k) return; (idx[k]=idx[k]||[]).push({ emp:e, from:a.from, store:a.store }); }); });
  return idx;
}
function toastAliasFind(idx, toastName, date, storeId){
  var list=(idx||{})[toastNameKey(toastName)]; if(!list) return null;
  var ok=list.filter(function(a){ return a.emp && !(a.from && date && String(date)<a.from) && (!a.store || a.store===storeId); });   /* 店ごとの別名はその店の打刻だけ */
  var act=ok.filter(function(a){ return a.emp.status!=='退職'; }), pool=act.length ? act : ok, ids={};
  pool.forEach(function(a){ ids[a.emp.id]=1; });
  return Object.keys(ids).length===1 ? pool[0].emp : null;   /* 2 人に当たるときは、どちらか決められないので結ばない */
}
function toastAliasResolve(m, toastName, date, idx, storeId){
  var nm=toastName, same=!!(m && (m.name===nm || (nm && String(m.name).toLowerCase()===String(nm).toLowerCase())));
  if(same && m.status!=='退職') return { emp:m, conf:true };
  var a=toastAliasFind(idx, nm, date, storeId);
  if(a) return { emp:a, conf:true, alias:true };          /* 退職した人と同じ名前でも、在籍の人の別名を先に（もう一度入った人） */
  if(same) return { emp:m, conf:true };
  return { emp:m||null, conf:false };
}
function _toastShiftsOverlap(a, b){
  var A=(a||[]).filter(function(x){ return x && x.inDate && x.outDate; }), B=(b||[]).filter(function(x){ return x && x.inDate && x.outDate; });
  for(var i=0;i<A.length;i++) for(var j=0;j<B.length;j++){
    var a1=new Date(A[i].inDate).getTime(), a2=new Date(A[i].outDate).getTime(), b1=new Date(B[j].inDate).getTime(), b2=new Date(B[j].outDate).getTime();
    if(isFinite(a1)&&isFinite(a2)&&isFinite(b1)&&isFinite(b2) && a1<b2 && b1<a2) return true;
  }
  return false;
}
function tipLaborWithGuid(rec, emp){ var g=emp && emp.guid ? String(emp.guid) : ''; if(g && g!=='unknown') rec.toastGuid=g;
  /* v1176（2A）：退勤の打刻が無い勤務（hyper-worker v1176 が openShifts に残す）。時間には入れない。KPI はこの日を「未集計」にする */
  var op=(emp && Array.isArray(emp.openShifts)) ? emp.openShifts.filter(function(x){ return x && x.inDate; }).map(function(x){ return { inDate:String(x.inDate) }; }) : [];
  if(op.length) rec.openShifts=op;
  return rec; }
function tipLaborPut(labor, conf, key, add, r){
  var cur=labor[key];
  if(cur && r && r.conf && conf[key]){
    var names=(Array.isArray(cur.toastNames) && cur.toastNames.length ? cur.toastNames.slice() : [cur.toastName]).concat([add.toastName]);
    var hasA=(cur.shifts||[]).length>0, hasB=(add.shifts||[]).length>0;
    /* 片方だけ打刻の時刻があるときは時刻を持たない（読むときに時刻から Tip 時間を数え直すと、時刻の無い方の時間が落ちるため） */
    var sh=(hasA && hasB) ? cur.shifts.concat(add.shifts).sort(function(x,y){ return String(x&&x.inDate||'').localeCompare(String(y&&y.inDate||'')); }) : [];
    var out={ lunch:(+cur.lunch||0)+(+add.lunch||0), dinner:(+cur.dinner||0)+(+add.dinner||0), rawLunch:(+cur.rawLunch||0)+(+add.rawLunch||0), rawDinner:(+cur.rawDinner||0)+(+add.rawDinner||0),
              shifts:sh, toastName:cur.toastName, toastNames:names };
    var gs=(Array.isArray(cur.toastGuids) ? cur.toastGuids.slice() : (cur.toastGuid ? [cur.toastGuid] : []));   /* v1153：Toast のアカウント ID */
    if(add.toastGuid && gs.indexOf(add.toastGuid)<0) gs.push(add.toastGuid);
    if(gs.length){ out.toastGuid=gs[0]; out.toastGuids=gs; }
    if(cur.overlap || _toastShiftsOverlap(cur.shifts, add.shifts)) out.overlap=true;
    var op=(Array.isArray(cur.openShifts)?cur.openShifts:[]).concat(Array.isArray(add.openShifts)?add.openShifts:[]);   /* v1176 */
    if(op.length) out.openShifts=op;
    labor[key]=out;
    return;
  }
  labor[key]=add; conf[key]=!!(r && r.conf);
}
function tipLaborPut(labor, conf, key, add, r){
  var cur=labor[key];
  if(cur && r && r.conf && conf[key]){
    var names=(Array.isArray(cur.toastNames) && cur.toastNames.length ? cur.toastNames.slice() : [cur.toastName]).concat([add.toastName]);
    var hasA=(cur.shifts||[]).length>0, hasB=(add.shifts||[]).length>0;
    /* 片方だけ打刻の時刻があるときは時刻を持たない（読むときに時刻から Tip 時間を数え直すと、時刻の無い方の時間が落ちるため） */
    var sh=(hasA && hasB) ? cur.shifts.concat(add.shifts).sort(function(x,y){ return String(x&&x.inDate||'').localeCompare(String(y&&y.inDate||'')); }) : [];
    var out={ lunch:(+cur.lunch||0)+(+add.lunch||0), dinner:(+cur.dinner||0)+(+add.dinner||0), rawLunch:(+cur.rawLunch||0)+(+add.rawLunch||0), rawDinner:(+cur.rawDinner||0)+(+add.rawDinner||0),
              shifts:sh, toastName:cur.toastName, toastNames:names };
    var gs=(Array.isArray(cur.toastGuids) ? cur.toastGuids.slice() : (cur.toastGuid ? [cur.toastGuid] : []));   /* v1153：Toast のアカウント ID */
    if(add.toastGuid && gs.indexOf(add.toastGuid)<0) gs.push(add.toastGuid);
    if(gs.length){ out.toastGuid=gs[0]; out.toastGuids=gs; }
    if(cur.overlap || _toastShiftsOverlap(cur.shifts, add.shifts)) out.overlap=true;
    var op=(Array.isArray(cur.openShifts)?cur.openShifts:[]).concat(Array.isArray(add.openShifts)?add.openShifts:[]);   /* v1176 */
    if(op.length) out.openShifts=op;
    labor[key]=out;
    return;
  }
  labor[key]=add; conf[key]=!!(r && r.conf);
}
function tipLaborBuildDay(storeId, _bdA, list, staff, _aidx){
  var labor = {}, _conf = {};
  list.forEach(emp=>{
    /* Order Only（注文専用アカウント）はレイバー/チップから除外（getTipLabor が名前で外す）。
       v1175（Codex #173 の指摘）：勤怠の写しには Toast の名前のまま残す（従業員には結ばない）。Toast から直接取ったときと同じ形。
       総労働時間の KPI が、業務用アカウントの一覧（4A）で「外すのをやめた」Order Only を数えられるように。給与・Tip は変わらない */
    if (isOrderOnlyAccount(emp.name)) {
      var _oos = emp.shifts||[], _ooh = _oos.length ? tipHoursFromShifts(storeId, _oos) : { lunch: emp.lunchHours||0, dinner: emp.dinnerHours||0 };
      tipLaborPut(labor, _conf, String(emp.name), tipLaborWithGuid({ lunch: _ooh.lunch, dinner: _ooh.dinner, rawLunch: emp.lunchHours||0, rawDinner: emp.dinnerHours||0, shifts: _oos, toastName: emp.name }, emp), { conf:true });
      return;
    }
    var m = staff.find(s=>s.name===emp.name || (emp.name&&s.name.toLowerCase()===emp.name.toLowerCase()) || (emp.name&&s.name.includes(emp.name)) || (emp.name&&emp.name.includes(s.name)));
    var _r = toastAliasResolve(m, emp.name, _bdA, _aidx, storeId);   /* v1111：別名（店ごとの別名はこの店だけ）・同じ日の 2 つを足す */
    var key = _r.emp ? _r.emp.name : emp.name;
    var shifts = emp.shifts||[];
    var hrs = shifts.length ? tipHoursFromShifts(storeId, shifts) : { lunch: emp.lunchHours||0, dinner: emp.dinnerHours||0 };
    tipLaborPut(labor, _conf, key, tipLaborWithGuid({ lunch: hrs.lunch, dinner: hrs.dinner, rawLunch: emp.lunchHours||0, rawDinner: emp.dinnerHours||0, shifts: shifts, toastName: emp.name }, emp), _r);   /* v1153：Toast のアカウント ID（hyper-worker は前から保存していた） */
  });
  return labor;
}
function normalizeBusinessDate(bd) {
  if (bd==null) return '';
  var s = String(bd);
  // 既に YYYY-MM-DD
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1]+'-'+m[2]+'-'+m[3];
  // YYYYMMDD
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1]+'-'+m[2]+'-'+m[3];
  // フォールバック: Dateとして解釈しローカル日付化
  try { var d=new Date(s); if(!isNaN(d)) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } catch(e){}
  return s;
}
function k2YmAdd(ym, d){ var p=String(ym).split('-'), n=parseInt(p[0],10)*12+parseInt(p[1],10)-1+(d||0); return Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0'); }
function k2RecGuids(e){ if(!e) return []; if(Array.isArray(e.toastGuids) && e.toastGuids.length) return e.toastGuids.filter(Boolean); return e.toastGuid ? [String(e.toastGuid)] : []; }
function k2SysGuids(sid, ym){
  var make=function(){
    var out={}, lo=k2YmAdd(ym, -13)+'-01', pre='tip_labor_'+sid+'_';
    var keys=(typeof lsKeys==='function') ? lsKeys(pre) : [];
    keys.forEach(function(k){
      var d=k.slice(pre.length); if(!(d>=lo)) return;
      var lab=null; try{ lab=(typeof _lsRaw==='function') ? _lsRaw(k, null) : ls(k, null); }catch(e){ lab=null; }
      if(!lab || typeof lab!=='object') return;
      Object.keys(lab).forEach(function(n){
        var e=lab[n]; if(!e) return;
        var nm=[n, e.toastName].concat(Array.isArray(e.toastNames)?e.toastNames:[]);
        if(!nm.some(function(x){ return x && toastSystemAccount(x, sid); })) return;
        k2RecGuids(e).forEach(function(g){ out[g]=n; });
      });
    });
    return out;
  };
  return (typeof _mdMemo==='function') ? _mdMemo('k2sys', sid+'|'+ym, make) : make();
}
function k2MonthGuids(sid, ym){
  var make=function(){
    var out={};
    daysOfYm(ym).forEach(function(d){
      var lab=null; try{ lab=getTipLabor(sid, d.date); }catch(e){ lab=null; }
      if(!lab) return;
      Object.keys(lab).forEach(function(n){ k2RecGuids(lab[n]).forEach(function(g){ (out[n]=out[n]||{})[g]=1; }); });
    });
    return out;
  };
  return (typeof _mdMemo==='function') ? _mdMemo('k2mg', sid+'|'+ym, make) : make();
}
function k2SysNameWhy(sid, ym, n){
  if(typeof toastSystemAccount==='function' && toastSystemAccount(n, sid)) return 'rule';
  var sys=k2SysGuids(sid, ym), mg=k2MonthGuids(sid, ym)[n]||{};
  return Object.keys(mg).some(function(g){ return Object.prototype.hasOwnProperty.call(sys, g); }) ? 'guid' : '';
}
function k2NormAcctName(n){ return String(n==null?'':n).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim(); }
function k2SysAcctList(sid){
  var c=(typeof getKpiConfig==='function') ? (getKpiConfig()||{}) : {};
  var s=c && c.byStore && c.byStore[sid];
  var m=s && s.sysAcct;
  return (m && typeof m==='object' && !Array.isArray(m)) ? m : null;
}
function k2SysWhy(sid, ym){
  var list=k2SysAcctList(sid);
  var nmOf=function(n, e){ return [n].concat(e && e.toastName ? [e.toastName] : []).concat(e && Array.isArray(e.toastNames) ? e.toastNames : []); };
  var oldRule=function(nm){
    var w='';
    for(var i=0;i<nm.length;i++){ try{ w=k2SysNameWhy(sid, ym, nm[i]); }catch(_e){ w=''; } if(w) return w; }
    return '';
  };
  if(list){
    var ids={}, names={};
    Object.keys(list).forEach(function(id){ var r=list[id]; if(!r || r.on===false) return; ids[id]=1; if(r.name) names[k2NormAcctName(r.name)]=1; });
    var offNames={};
    Object.keys(list).forEach(function(id){ var r=list[id]; if(r && r.on===false && r.name){ var k=k2NormAcctName(r.name); if(names[k]!==1 && !offNames[k]) offNames[k]=id; } });
    return function(n, e){
      var gs=k2RecGuids(e);
      if(gs.length){ var hit=null; gs.some(function(g){ if(ids[g]===1){ hit=g; return true; } return false; }); return hit ? { ex:true, by:'id', why:'id_on', id:hit } : { ex:false, by:'id', why:'id_none', id:gs[0] }; }
      var nm=nmOf(n, e);
      if(nm.some(function(x){ return names[k2NormAcctName(x)]===1; })) return { ex:true, by:'name', why:'list_name' };
      var off=null; nm.some(function(x){ var v=offNames[k2NormAcctName(x)]; if(v){ off=v; return true; } return false; });
      if(off) return { ex:false, by:'name', why:'off_name', id:off };
      /* v1176（Claude #174 の P3-1）：ID の無い前の勤怠の写しは、一覧の名前に無ければ前の名前の決まり（k2IsSysName）も見る。
         一覧を作っても、直近 2 か月に出ていない名前・この端末に無い月の記録で、過去の月の総労働時間が増えないように。
         一覧で「外すのをやめた」名前は外さない */
      var w=oldRule(nm);
      return w ? { ex:true, by:'name', why:'sys_'+w } : { ex:false, by:'name', why:'none' };
    };
  }
  return function(n){ var w=''; try{ w=k2SysNameWhy(sid, ym, n); }catch(_e){ w=''; } return w ? { ex:true, by:'name', why:'sys_'+w } : { ex:false, by:'name', why:'none' }; };
}
function k2SysMatcher(sid, ym){
  var why=k2SysWhy(sid, ym);
  return function(n, e){ return why(n, e).ex; };
}
function getKpiConfig(){ return ls('kpi_config', {drinkCats:[], upsellGuids:[], alcoholCats:[]}); }
function isOrderOnlyAccount(name){
  if(!name) return false;
  var n = String(name).toLowerCase().replace(/[\s_\-\.]/g,'');
  return n.indexOf('orderonly')>=0 || n==='order';
}
function toastSystemAccount(name, storeId){
  if(!name) return false;
  if(isOrderOnlyAccount(name) || (typeof ceIsSystemAccount==='function' && ceIsSystemAccount(name))) return true;
  var n=String(name).normalize('NFKC').toLowerCase().replace(/[\s_\-.*]+/g,' ').trim();
  return /(?:^| )toast generic login(?: |$)/.test(n) || (storeId==='F06' && n==='server default');
}
function getTipHoursCfg(sid){ var c=ls('tip_hours_config',{})||{}; return c[sid]||{mode:'all'}; }
function tipSplitHourFor(sid){ var v=Number((getTipHoursCfg(sid)||{}).splitHour); return (v>=0&&v<=24)?v:16; }
function _thToMin(t){ var m=String(t||'').match(/^(\d{1,2}):(\d{2})$/); return m?(+m[1]*60+ +m[2]):null; }
function tipHoursFixOn(date){ return /^\d{4}-\d{2}-\d{2}$/.test(String(date||'')) && String(date) >= TIP_HOURS_FIX_FROM; }
function _hstMidnightMs(date){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||''));
  return m ? Date.UTC(+m[1], +m[2]-1, +m[3], 10, 0, 0) : NaN;   /* ハワイの0:00＝UTC 10:00 */
}
function _tipOverlapBizH(inIso, outIso, date, startH, endH){
  var base = _hstMidnightMs(date); if(isNaN(base)) return 0;
  var inMs = new Date(inIso).getTime(), outMs = new Date(outIso).getTime();
  if(!(outMs > inMs)) return 0;
  var lo = Math.max(inMs, base + startH*3600000), hi = Math.min(outMs, base + endH*3600000);
  return hi > lo ? (hi - lo)/3600000 : 0;
}
function _thOverlapH(inDate, outDate, date, t1, t2){
  var a=_thToMin(t1), b=_thToMin(t2); if(a==null||b==null) return null;
  var di=new Date(inDate), doo=new Date(outDate); if(isNaN(di)||isNaN(doo)) return null;
  /* v1033: 9/16 以降は窓の起点をハワイの0時に（端末の時刻の0時だと、日本の端末で19時間ずれていた） */
  var base = tipHoursFixOn(date) ? new Date(_hstMidnightMs(date)) : new Date(date+'T00:00:00');
  var w1=new Date(base.getTime()+a*60000), w2=new Date(base.getTime()+b*60000);
  if (b<=a) w2=new Date(w2.getTime()+86400000);
  var st=Math.max(di.getTime(), w1.getTime()), en=Math.min(doo.getTime(), w2.getTime());
  return Math.max(0,(en-st)/3600000);
}
function applyTipHoursClip(storeId, date, data){
  try{
    var cfg=getTipHoursCfg(storeId);
    if(!cfg || cfg.mode!=='hours' || !data) return data;
    var win=tipHoursWindowFor(storeId, date); // その日のL/D窓（曜日別）。{lOn,l1,l2,dOn,d1,d2}
    Object.keys(data).forEach(function(nm){
      var e=data[nm]||{}; var sh=e.shifts;
      if(!sh || !sh.length || !sh[0].inDate) return;
      var L=0, D=0, ok=true;
      sh.forEach(function(x){
        if(!x.inDate||!x.outDate){ ok=false; return; }
        var lv = win.lOn ? _thOverlapH(x.inDate,x.outDate,date,win.l1,win.l2) : 0;
        var dv = win.dOn ? _thOverlapH(x.inDate,x.outDate,date,win.d1,win.d2) : 0;
        if(lv==null||dv==null){ ok=false; return; }
        L+=lv; D+=dv;
      });
      if(ok){ e.lunch=Math.round(L*100)/100; e.dinner=Math.round(D*100)/100; }
    });
  }catch(err){}
  return data;
}
function applyTipSplit(storeId, date, data){
  try{
    var cfg = getTipHoursCfg(storeId);
    if(!cfg || cfg.mode === 'hours' || !data) return data;   /* 営業時間のみは clip 側が担当 */
    var sp = tipSplitHourFor(storeId);
    if(!(sp >= 0 && sp <= 24)) return data;
    Object.keys(data).forEach(function(nm){
      var e = data[nm] || {}; var sh = e.shifts;
      if(!sh || !sh.length) return;
      var L = 0, D = 0, ok = true;
      var fix = tipHoursFixOn(date);   /* v1033: 9/16 以降は営業日のハワイ0時から。0時を過ぎた分も D（締め 4:00 まで） */
      sh.forEach(function(x){
        if(!x.inDate || !x.outDate){ ok = false; return; }
        if(fix){
          L += _tipOverlapBizH(x.inDate, x.outDate, date, 0, sp);
          D += _tipOverlapBizH(x.inDate, x.outDate, date, sp, TIP_BIZDAY_END_H);
        } else {
          L += overlapHours(x.inDate, x.outDate, 0, sp);
          D += overlapHours(x.inDate, x.outDate, sp, 24);
        }
      });
      if(ok){ e.lunch = Math.round(L*100)/100; e.dinner = Math.round(D*100)/100; }
    });
  }catch(err){}
  return data;
}
function tipHoursWindowFor(storeId, date){
  var cfg=getTipHoursCfg(storeId);
  var dow=(typeof dowLabelForDate==='function')?dowLabelForDate(date):null;
  var base={ lOn:true, l1:cfg.l1, l2:cfg.l2, dOn:true, d1:cfg.d1, d2:cfg.d2 };
  if(cfg.dow && dow && cfg.dow[dow]){
    var w=cfg.dow[dow];
    return { lOn:(w.lOn!==false), l1:w.l1||cfg.l1, l2:w.l2||cfg.l2,
             dOn:(w.dOn!==false), d1:w.d1||cfg.d1, d2:w.d2||cfg.d2 };
  }
  return base;
}
function attFixKey(storeId, date){ return 'att_fix_'+storeId+'_'+String(date||'').slice(0, 7); }
function getAttOverride(storeId, date) {
  var m=_lrRead(attFixKey(storeId, date)), r=(m && typeof m==='object' && !Array.isArray(m)) ? m[date] : null;
  if(r && typeof r==='object') return r._deleted ? null : JSON.parse(JSON.stringify(r));   /* 写しを返す（読んだ入れ物を書き換えさせない） */
  if(!v1136Moved()) return ls('att_override_'+storeId+'_'+date, null);   /* この端末の前の名前の記録（移し替えが済むまで） */
  return null;
}
function getTipLabor(storeId, date) {
  var _ovr = getAttOverride(storeId, date);
  var _useOvr = !!(_ovr && _ovr.data);
  var d = _useOvr ? JSON.parse(JSON.stringify(_ovr.data)) : ls('tip_labor_'+storeId+'_'+date, null);
  if (d && typeof d==='object') {
    // Order Only（注文専用アカウント）はレイバー/チップ計算から除外
    var out={}, removed=false;
    Object.keys(d).forEach(function(k){
      var e = d[k];
      if (isOrderOnlyAccount(k) || (e && isOrderOnlyAccount(e.toastName))) { removed=true; return; }
      out[k] = e;
    });
    var _res = removed ? out : d;
    if (!_useOvr) {
      _res = applyTipHoursClip(storeId, date, _res); // 手動修正日はクリップしない（修正値が正）
      _res = applyTipSplit(storeId, date, _res);     /* v862: 勤怠時間すべてのときの L/D 境目 */
    }
    return _res;
  }
  return d;
}
function getTipHoursBasis(storeId) {
  var cfg = ls('tip_hours_basis', {});
  return cfg[storeId] || 'all';
}
function getTipWindow(storeId) {
  var cfg = ls('tip_window', {});
  return Object.assign({}, DEFAULT_TIP_WINDOW, cfg[storeId]||{});
}
function overlapHours(inIso, outIso, startH, endH) {
  if (!inIso || !outIso) return 0;
  var inMs = new Date(inIso).getTime(), outMs = new Date(outIso).getTime();
  if (outMs<=inMs) return 0;
  // HSTローカルのその日の0:00を求める
  var inLocal = new Date(inMs - 10*3600*1000);
  var y=inLocal.getUTCFullYear(), mo=inLocal.getUTCMonth(), d=inLocal.getUTCDate();
  var midnightUTC = Date.UTC(y,mo,d,10,0,0); // HST 0:00 = UTC 10:00
  var winStart = midnightUTC + startH*3600*1000;
  var winEnd = midnightUTC + endH*3600*1000;
  var lo = Math.max(inMs, winStart), hi = Math.min(outMs, winEnd);
  return hi>lo ? (hi-lo)/3600000 : 0;
}
function tipHoursFromShifts(storeId, shifts) {
  var basis = getTipHoursBasis(storeId);
  var win = getTipWindow(storeId);
  var lunch=0, dinner=0;
  (shifts||[]).forEach(s=>{
    if (basis==='window') {
      lunch += overlapHours(s.inDate, s.outDate, win.lunchStart, win.lunchEnd);
      dinner += overlapHours(s.inDate, s.outDate, win.dinnerStart, win.dinnerEnd);
    } else {
      lunch += overlapHours(s.inDate, s.outDate, 0, 16);
      dinner += overlapHours(s.inDate, s.outDate, 16, 24);
    }
  });
  return { lunch, dinner };
}
function empWage(name) {
  var e = getEmployees().find(x=>x.name===name);
  return e ? empWageOf(e) : 0;
}
function e3(s){ return escapeHtml(s); }
function _laborGradeSplit(sid, ym, core, emps){
  var _sv=(typeof ltServerGrade==='function') ? ltServerGrade(sid, ym) : null;
  if(_sv) return _sv;
  var g1=0, g2=0, has=false;
  var gradeOf=function(n){ var e=emps.find(function(x){return x.name===n && x.store===sid;})||emps.find(function(x){return x.name===n;}); return e?(empGradeNum(e)||0):0; };
  var mNames={};
  var mStaff=(typeof storeMonthlyStaff==='function')?(storeMonthlyStaff(sid)||[]):[];
  mStaff.forEach(function(e){
    var m=(typeof empMonthlyOf==='function')?empMonthlyOf(e):0; if(!(m>0)) return;
    mNames[e.name]=1;
    var cost=(core.dim>0)?(m*core.periodDays/core.dim):0;
    if(cost>0){ has=true; if((empGradeNum(e)||0)>=2) g2+=cost; else g1+=cost; }
  });
  Object.keys(core.byName||{}).forEach(function(n){
    if(mNames[n]) return;
    var a=core.byName[n]; var cost=0;
    try{ cost=laborForEmployee(n,{regular:a.reg,ot:a.ot,pay:a.pay}).total; }catch(e){}
    if(cost>0){ has=true; if(gradeOf(n)>=2) g2+=cost; else g1+=cost; }
  });
  return {g1:g1, g2:g2, has:has};
}
function toastLaborCostForDate(storeId, dateISO){
  var _sv = (typeof ltServerDay==='function') ? ltServerDay(storeId, dateISO) : null;   /* v1192：経理・AM の端末はサーバーの合計（全員の時給を持たない） */
  if (_sv) return _sv.c;
  var labor = getTipLabor(storeId, dateISO);
  if(!labor) return 0;
  var cost = 0;
  Object.keys(labor).forEach(function(n){
    var e = labor[n];
    var h = _laborHrs(e);
    if (h>0) cost += h*(empWageAt(n, storeId, dateISO)||0);   /* v1106: プレップの認定はその店・その日の時給 */
  });
  return cost;
}
function daysInMonthOf(ym){
  var p = String(ym||'').split('-'); var y=+p[0], m=+p[1];
  if(!y||!m){ var n=new Date(); y=n.getFullYear(); m=n.getMonth()+1; }
  return new Date(y, m, 0).getDate();
}
function storeSalaryMonthly(storeId){
  var _sv = (typeof ltServerSalary==='function') ? ltServerSalary(storeId) : null;   /* v1192：経理・AM の端末はサーバーの合計（月給を持たない） */
  if (_sv!=null) return _sv;
  var sum = 0;
  getEmployees().forEach(function(e){
    if (!e || e.store!==storeId) return;
    if (e.status==='退職') return;
    if (empPayType(e)!=='monthly') return;
    sum += empMonthlyOf(e);
  });
  return sum;
}
function storeMonthlyStaff(storeId){
  return getEmployees().filter(function(e){ return e && e.store===storeId && e.status!=='退職' && empPayType(e)==='monthly'; });
}
function _meetLaborLDDay(storeId, date){
  var _sv=(typeof ltServerDay==='function') ? ltServerDay(storeId, date) : null;
  if(_sv) return {lc:_sv.ml, dc:_sv.md};
  var lc=0, dc=0, lab=null; try{ lab=getTipLabor(storeId, date); }catch(e){}
  if(!lab) return {lc:0, dc:0};
  Object.keys(lab).forEach(function(n){
    var e=lab[n]; if(!e) return;
    var rL=Number(e.rawLunch)||0, rD=Number(e.rawDinner)||0;
    var wL=Number(e.lunch)||0,    wD=Number(e.dinner)||0;
    /* _laborHrs と同じ選び方（合計が大きい側を採用）にそろえる */
    var useRaw=(rL+rD)>=(wL+wD);
    var w=0; try{ w=empWageAt(n, storeId, date)||0; }catch(e2){}   /* v1106 */
    lc+=(useRaw?rL:wL)*w; dc+=(useRaw?rD:wD)*w;
  });
  return {lc:lc, dc:dc};
}
function isoOf(d){ d=(d instanceof Date)?d:new Date(d); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function daysOfYm(ym){
  var p=ym.split('-'), y=parseInt(p[0],10), m=parseInt(p[1],10)-1;
  var nd=new Date(y,m+1,0).getDate(), arr=[];
  for(var d=1; d<=nd; d++){ arr.push({date:y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0')}); }
  return arr;
}
function ldLaborDay(storeId, date){
  var r={hL:0, hD:0, cL:0, cD:0}, lab=null; try{ lab=getTipLabor(storeId, date); }catch(e){}
  if(!lab) return r;
  /* v1176（11/15 の依頼の A）：業務用アカウントの時間は人時売上高にも入れない（KPI の総労働時間と同じ決まり）。人件費の額は変えない */
  var _ym=String(date||'').slice(0,7), isSys=null;
  try{ isSys=(typeof _mdMemo==='function') ? _mdMemo('k2sysm', storeId+'|'+_ym, function(){ return k2SysMatcher(storeId, _ym); }) : k2SysMatcher(storeId, _ym); }catch(e){ isSys=null; }
  Object.keys(lab).forEach(function(n){
    var e=lab[n]; if(!e) return;
    if(isSys){ try{ if(isSys(n, e)) return; }catch(e3){} }
    var rL=Number(e.rawLunch)||0, rD=Number(e.rawDinner)||0, wL=Number(e.lunch)||0, wD=Number(e.dinner)||0;
    var useRaw=(rL+rD)>=(wL+wD), hL=useRaw?rL:wL, hD=useRaw?rD:wD, w=0; try{ w=(pmHasAt(n, storeId)?empWageAt(n, storeId, date):_ldWage(n))||0; }catch(e2){}   /* v1048・v1106: プレップの認定はその日の時給 */
    r.hL+=hL; r.hD+=hD; r.cL+=hL*w; r.cD+=hD*w;
  });
  var _sv=(typeof ltServerDay==='function') ? ltServerDay(storeId, date) : null;   /* v1192：時間は端末で数えたまま、お金だけサーバーの合計 */
  if(_sv){ r.cL=_sv.ll; r.cD=_sv.ld; }
  return r;
}
function _ldWage(name){
  var m=_mdMemo('ldwage', '', function(){ var o={}; try{ getEmployees().forEach(function(e){ if(e && e.name!=null && !Object.prototype.hasOwnProperty.call(o, e.name)) o[e.name]=empWageOf(e); }); }catch(e){} return o; });
  return Object.prototype.hasOwnProperty.call(m, name) ? (m[name]||0) : 0;
}
function dowLabelForDate(dateISO) {
  var d = new Date(dateISO+'T00:00:00');
  return DOW_SHIFT[d.getDay()];
}
function laborWeekRange(weekSunISO) {
  var sun = new Date(weekSunISO+'T00:00:00');
  var sat = new Date(sun); sat.setDate(sun.getDate()+6);
  return { from: weekSunISO, to: isoOf(sat),
    label: `${sun.getMonth()+1}/${sun.getDate()}〜${sat.getMonth()+1}/${sat.getDate()}` };
}
function isoLocalDate(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function laborWeekDays(sunISO){
  var sun = new Date(sunISO+'T00:00:00'); var arr=[];
  for(var i=0;i<7;i++){ var d=new Date(sun); d.setDate(sun.getDate()+i); arr.push(isoLocalDate(d)); }
  return arr;
}
function laborMonthWeeks(ym){
  var y=+String(ym).split('-')[0], m=+String(ym).split('-')[1];
  var first=new Date(y, m-1, 1), last=new Date(y, m, 0);
  var s=new Date(first); s.setDate(s.getDate()-s.getDay()); // 直前(以前)の日曜
  var weeks=[];
  for(var cur=new Date(s); cur<=last; cur.setDate(cur.getDate()+7)){
    var sunISO = isoLocalDate(cur);
    weeks.push({ sun:sunISO, range:laborWeekRange(sunISO) });
  }
  return weeks;
}
function laborForEmployee(name, entry) {
  // entry: {regular, ot} があればそれを使う（Toast/手入力）。無ければ0
  var reg = (entry && entry.regular!=null) ? entry.regular : 0;
  var ot = (entry && entry.ot!=null) ? entry.ot : 0;
  /* v1106: 日によって時給が変わる人（プレップの認定）は、共通コアが週ごとに計算した額（pay）。wage はならした時給（表示用） */
  if (entry && entry.pay!=null && isFinite(Number(entry.pay))) {
    var _pay=Number(entry.pay), _u=reg+ot*1.5, _w=(_u>0)?Math.round(_pay/_u*100)/100:empWage(name);
    var _rp=(_u>0)?_pay*reg/_u:0;
    return { wage:_w, reg:reg, ot:ot, regPay:_rp, otPay:_pay-_rp, total:_pay, mixed:true };
  }
  var wage = empWage(name);
  var regPay = reg*wage;
  var otPay = ot*wage*1.5;
  return { wage, reg, ot, regPay, otPay, total: regPay+otPay };
}
function _laborHrs(e){ if(!e) return 0; var raw=(Number(e.rawLunch)||0)+(Number(e.rawDinner)||0); var win=(Number(e.lunch)||0)+(Number(e.dinner)||0); return Math.max(raw, win); }
function _laborWageParts(storeId, ym, opts){
  opts = opts||{};
  var cutoff = (opts.endBefore!==undefined) ? opts.endBefore : (ym===curYm() ? bizToday() : null);
  var weeks = laborMonthWeeks(ym).filter(function(w){ return !opts.weekSun || w.sun===opts.weekSun; });
  var inRange = function(dt){ return String(dt).slice(0,7)===ym && (!cutoff || dt<cutoff); };
  var byName = {};
  var certPay = {}, certUsed = {};   /* v1106: この店でプレップの認定がある人だけ。週ごとに Σ(その日の時間×その日の時給)、40h 超は週の平均の時給×1.5。
                                       この月に認定の時給の日が 1 日も無ければ使わない（今までと同じ計算） */
  weeks.forEach(function(w){
    var weekHours = {}, weekPay = {};
    laborWeekDays(w.sun).forEach(function(dt){
      if(!inRange(dt)) return;
      var labor = getTipLabor(storeId, dt); if(!labor) return;
      Object.keys(labor).forEach(function(n){ var e=labor[n]; var h=_laborHrs(e); if(h>0){ weekHours[n]=(weekHours[n]||0)+h;
        if(pmHasAt(n, storeId)){ var _cw=pmCertWage(n, storeId, dt); if(_cw!=null) certUsed[n]=1; weekPay[n]=(weekPay[n]||0)+h*(_cw!=null?_cw:(empWage(n)||0)); } } });
    });
    Object.keys(weekHours).forEach(function(n){
      var wh=weekHours[n]; var ot=Math.max(0, wh-40), reg=wh-ot;
      if(!byName[n]) byName[n]={reg:0, ot:0, hours:0};
      byName[n].reg+=reg; byName[n].ot+=ot; byName[n].hours+=wh;
      if(weekPay[n]!=null){ var _avg=weekPay[n]/wh; certPay[n]=(certPay[n]||0)+reg*_avg+ot*_avg*1.5; }
    });
  });
  Object.keys(byName).forEach(function(n){ byName[n].reg=Math.round(byName[n].reg*100)/100; byName[n].ot=Math.round(byName[n].ot*100)/100; byName[n].hours=Math.round(byName[n].hours*100)/100; if(certUsed[n] && certPay[n]!=null) byName[n].pay=Math.round(certPay[n]*100)/100; });
  var monthlyNames = {};
  var mStaff = (typeof storeMonthlyStaff==='function') ? (storeMonthlyStaff(storeId)||[]) : [];
  mStaff.forEach(function(e){ if((typeof empMonthlyOf==='function'?empMonthlyOf(e):0)>0) monthlyNames[e.name]=1; });
  var hourly = 0;
  Object.keys(byName).forEach(function(n){ if(monthlyNames[n]) return; var a=byName[n]; hourly += laborForEmployee(n, {regular:a.reg, ot:a.ot, pay:a.pay}).total; });
  // ★ 有給消化中の時給者: 期間内の営業日 × 標準時間 × 時給 を店舗Laborに加算（月給者は月額按分で計上済みのため対象外）
  var leavePay = 0, leaveDays = 0;
  try {
    var _ymDays = daysOfYm(ym);
    (getEmployees()||[]).forEach(function(le){
      if(!le || le.store!==storeId) return;
      if(!le.leaveStart || !le.leaveEnd) return;
      if((typeof empPayType==='function'?empPayType(le):'hourly')==='monthly') return;
      var lh = (le.leaveHrs!=null && le.leaveHrs!=='') ? Number(le.leaveHrs) : 8;
      if(!(lh>0)) return;
      var lw = (typeof empWage==='function') ? (Number(empWage(le.name))||0) : 0;
      var _lwp = pmHasAt(le.name, storeId);   /* v1106: プレップの認定がある人は、その日の時給 */
      if(!(lw>0) && !_lwp) return;
      _ymDays.forEach(function(dd){
        var dt=dd.date;
        if(dt<le.leaveStart || dt>le.leaveEnd) return;
        if(!inRange(dt)) return; // 当月・前日まで（cutoff整合）
        var dow=new Date(dt+'T00:00:00').getDay(); // 0=日..6=土（店休判定と同規約）
        if((typeof dayClosureMode==='function') && dayClosureMode(storeId, dt, dow)==='closed') return; // 全休日はスキップ
        var _lwd = _lwp ? (Number(empWageAt(le.name, storeId, dt))||0) : lw;
        if(!(_lwd>0)) return;
        leaveDays++; leavePay += lh*_lwd;
      });
    });
  } catch(e){}
  leavePay = Math.round(leavePay*100)/100;
  var dim = daysInMonthOf(ym);
  var periodDays=0, seen={};
  weeks.forEach(function(w){ laborWeekDays(w.sun).forEach(function(dt){ if(!inRange(dt) || seen[dt]) return; seen[dt]=1; periodDays++; }); });
  var salary = 0;
  mStaff.forEach(function(e){ var m=(typeof empMonthlyOf==='function')?empMonthlyOf(e):0; if(m>0 && dim>0) salary += m*periodDays/dim; });
  salary = Math.round(salary*100)/100;
  return { cutoff:cutoff, weeks:weeks, byName:byName, hourly:hourly, leave:leavePay, leaveDays:leaveDays, salary:salary, periodDays:periodDays, dim:dim };
}
function ceIsSystemAccount(name){
  var n=String(name||'').normalize('NFKC').toLowerCase().replace(/[\s_\-.]+/g,' ').trim();
  return n==='order' || /(?:^| )(?:order ?only|kiosk(?: ?mode)?)(?: |$)/.test(n);
}
function jobTitle(key){ return JOB_TITLES.find(t=>t.key===key); }
function isMonthlyTitle(key){ var t=jobTitle(key); return !!(t && t.payType==='monthly'); }
function getTitleWageTable() {
  var saved = ls('m_titlewage', null);
  var base = {};
  JOB_TITLES.forEach(t=>{ base[t.key] = (t.payType==='monthly') ? {monthly:t.defMonthly} : {wage:t.defWage}; if(t.defSiteWage!=null) base[t.key].siteWage = t.defSiteWage; });   /* v915 */
  if (saved) Object.keys(saved).forEach(k=>{ base[k] = Object.assign(base[k]||{}, saved[k]); });
  return base;
}
function empPayType(e){
  if (e && e.payTypeOverride) return e.payTypeOverride; // 個別上書き（例: 事務Crewは時給）
  if (e && e.monthlySalary!=null && e.monthlySalary!=='' && parseFloat(e.monthlySalary)>0) return 'monthly'; // 月給額が設定されていれば月給者（固定給を人件費に反映）
  return isMonthlyTitle(e.title) ? 'monthly' : 'hourly';
}
function empSiteWageOf(e) {
  if (!e || empPayType(e)!=='monthly') return 0;
  var tbl = getTitleWageTable();
  var sw = (e.title && tbl[e.title] && tbl[e.title].siteWage!=null) ? Number(tbl[e.title].siteWage) : 0;
  return (sw > 0) ? sw : 0;
}
function empWageOf(e) {
  if (empPayType(e)==='monthly') return empSiteWageOf(e);   /* v915: 未設定は0（従来どおり） */
  if (e.wage!=null && e.wage!=='') return parseFloat(e.wage);   // 個別上書き
  var tbl = getTitleWageTable();
  if (e.title && tbl[e.title] && tbl[e.title].wage!=null) return tbl[e.title].wage;
  return WAGE[e.role]||16;
}
function empMonthlyOf(e) {
  if (empPayType(e)!=='monthly') return 0;
  if (e.monthlySalary!=null && e.monthlySalary!=='') return parseFloat(e.monthlySalary); // 個別上書き
  var tbl = getTitleWageTable();
  if (e.title && tbl[e.title] && tbl[e.title].monthly!=null) return tbl[e.title].monthly;
  return 0;
}
function getStoreClosures(storeId){ try{ var c=ls('store_closures',{})||{}; return c[storeId]||{}; }catch(e){ return {}; } }
function dayClosureMode(storeId, dateISO, dow){
  var sp=getStoreClosures(storeId)[dateISO];
  if(sp && sp.mode) return sp.mode;
  try{ var st=STORES.find(function(x){return x.id===storeId;}); var v=st&&st.bizDays?st.bizDays[dow]:null; if(v && v!=='open') return v; }catch(e){}
  return null;
}
function empGradeNum(e){ return (e && typeof gradeNum==='function' && typeof empGrade==='function') ? gradeNum(empGrade(e)) : 0; }
function gradeOf(title){
  if(!title) return '';
  var keys=Object.keys(GRADE_TITLES);
  for(var i=0;i<keys.length;i++){ if(GRADE_TITLES[keys[i]].indexOf(title)>=0) return keys[i]; }
  return '';
}
function gradeNum(grade){ return grade ? (parseInt(String(grade).replace('G',''))||0) : 0; }
function empGrade(e){
  var g=gradeOf(e&&e.title);
  if(g) return g;
  var r=e&&e.role;
  if(r==='gm') return 'G6'; if(r==='am') return 'G5'; if(r==='g4'||r==='chef') return 'G4'; if(r==='sl') return 'G3'; if(r==='g2') return 'G2';   /* v766: chef=G4 */
  if(r==='crew'||r==='office_crew') return 'G1';
  return '';
}
function pmAddDay(d, n){ var p=String(d).split('-'); var x=new Date(Date.UTC(+p[0], +p[1]-1, +p[2]+n)); return x.toISOString().slice(0,10); }
function pmDateOk(d){ return /^\d{4}-\d{2}-\d{2}$/.test(String(d||'')) && pmAddDay(d, 0)===d; }
function pmMap(k){ var m=ls(k, {}); return (m && typeof m==='object' && !Array.isArray(m)) ? m : {}; }
function pmTablesAll(){ var m=pmMap(PM_TBL); return Object.keys(m).map(function(id){ return Object.assign({}, m[id], {id:id}); }); }
function pmTableValid(r){
  return !!(r && pmDateOk(r.from) && Array.isArray(r.levels) && r.levels.length===5 && r.levels.every(function(L, i){ return L && Number(L.lv)===i+1 && Number(L.cents)>0; }));
}
function pmTables(sid){
  return pmTablesAll().filter(function(r){ return r.store===sid && !r.void && pmTableValid(r); })
    .sort(function(a,b){ return a.from<b.from?-1:a.from>b.from?1:((Number(a._at)||0)-(Number(b._at)||0)) || (a.id<b.id?-1:1); });
}
function pmTblFirst(a, b){ return ((Number(a._at)||0)-(Number(b._at)||0)) || (a.id<b.id?-1:a.id>b.id?1:0); }
function pmLvCents(tbl, lv){ var L=((tbl&&tbl.levels)||[]).find(function(x){ return Number(x.lv)===Number(lv); }); return L ? Number(L.cents) : null; }
function pmTableNo(sid, id){ var l=pmTables(sid); for(var i=0;i<l.length;i++) if(l[i].id===id) return i+1; return 0; }
function pmCertsAll(){ var m=pmMap(PM_CERT); return Object.keys(m).map(function(id){ return Object.assign({}, m[id], {id:id}); }).filter(function(r){ return r && r.emp && r.store; }); }
function pmDecCmp(a, b){ return ((Number(a.dt)||0)-(Number(b.dt)||0)) || ((Number(a._at)||0)-(Number(b._at)||0)) || (a.id<b.id?-1:a.id>b.id?1:0); }
function pmSetsLv(c){ return c.kind!=='switch' || c.src==='legacy'; }
function pmIdx(){
  return _mdMemo('pmidx', '', function(){
    var tbl={}, rank={};
    pmTablesAll().forEach(function(r){ if(!r.void && pmTableValid(r)) tbl[r.id]=r; });
    Object.keys(tbl).forEach(function(id){ rank[id]=pmTableNo(tbl[id].store, id); });
    /* v1106（Codex 6340525082 の P2）: 同じ店・同じ適用開始日の版が 2 つ以上ある（2 台が同時に作った など）ときは、先に作った版（_at・id の順）の
       額と順位を、どちらの版で承認された人にも使う（人によって違う時給にしない）。その日の版での承認・切り替え・認定は、取り消して 1 つにするまで止める。
       取り消した版が残した版を指していれば（alias）、その版で承認した人は残した版の額 */
    var grp={}, conflict={};
    Object.keys(tbl).forEach(function(id){ var r=tbl[id], k=r.store+'|'+r.from; (grp[k]=grp[k]||[]).push(r); });
    Object.keys(grp).forEach(function(k){
      var l=grp[k].sort(pmTblFirst); if(l.length<2) return;
      conflict[k]=l.map(function(r){ return r.id; });
      l.slice(1).forEach(function(r){ tbl[r.id]=l[0]; rank[r.id]=rank[l[0].id]; });
    });
    for(var ap=0; ap<3; ap++) pmTablesAll().forEach(function(r){
      if(r.void && r.alias && !tbl[r.id] && tbl[r.alias] && tbl[r.alias].store===r.store && tbl[r.alias].from===r.from){ tbl[r.id]=tbl[r.alias]; rank[r.id]=rank[r.alias]; }
    });
    var by={};
    pmCertsAll().forEach(function(c){
      if(c.state!=='approved' || !pmDateOk(c.from)) return;
      if(c.kind!=='end' && !(Number(c.lv)>=1 && Number(c.lv)<=5)) return;
      (by[c.emp+'|'+c.store]=by[c.emp+'|'+c.store]||[]).push(c);
    });
    var seg={}, emps={}, sup={};
    Object.keys(by).forEach(function(k){
      var l=by[k].sort(function(a,b){ return a.from<b.from?-1:a.from>b.from?1:pmDecCmp(a, b); });
      l.forEach(function(c){ if(!pmSetsLv(c)) return; if(l.some(function(d){ return d!==c && pmSetsLv(d) && d.from<=c.from && pmDecCmp(d, c)>0; })) sup[c.id]=1; });
      seg[k]=l; emps[k.split('|')[0]]=1;
    });
    var byName={}, empObj={};
    getEmployees().forEach(function(e){ if(e && e.name!=null && !Object.prototype.hasOwnProperty.call(byName, e.name)){ byName[e.name]=e.id; } if(e && e.id!=null) empObj[e.id]=e; });
    return { tbl:tbl, rank:rank, seg:seg, sup:sup, emps:emps, byName:byName, empObj:empObj, conflict:conflict };
  });
}
function pmSegOn(empId, sid, date){
  var x=pmIdx(), l=x.seg[empId+'|'+sid]; if(!l) return null;
  var best=null, tb=null, rk=0;
  l.forEach(function(c){
    if(c.from>date || x.sup[c.id]) return;
    if(pmSetsLv(c) && (!best || pmDecCmp(c, best)>0)) best=c;
    if(c.kind!=='end'){ var r=x.rank[c.tbl]||0; if(r>rk && x.tbl[c.tbl] && x.tbl[c.tbl].store===c.store){ rk=r; tb=c.tbl; } }
  });
  if(!best && !tb) return null;
  return { from:best?best.from:null, lv:(best && best.kind!=='end')?Number(best.lv):null, tbl:tb, cert:best?best.id:null, kind:best?best.kind:null };
}
function pmWageOn(e, sid, date){
  if(!e) return null;
  var s=pmSegOn(e.id, sid, date); if(!s || s.lv==null || !s.tbl) return null;
  var c=pmLvCents(pmIdx().tbl[s.tbl], s.lv);
  return (c==null) ? null : { cents:c, lv:s.lv, tbl:s.tbl, from:s.from, cert:s.cert };
}
function pmHasAt(name, sid){ try{ var x=pmIdx(), id=x.byName[name]; return !!(id!=null && x.seg[id+'|'+sid]); }catch(e){ return false; } }
function pmCertWage(name, sid, date){
  try{
    if(!(sid && date && pmHasAt(name, sid))) return null;
    var x=pmIdx(), e=x.empObj[x.byName[name]];
    if(!e || (typeof empPayType==='function' && empPayType(e)==='monthly')) return null;
    var w=pmWageOn(e, sid, date); return w ? w.cents/100 : null;
  }catch(err){ return null; }
}
function empWageAt(name, sid, date){ var w=pmCertWage(name, sid, date); return (w!=null) ? w : empWage(name); }
  return { getTipLabor, tipLaborBuildDay, toastAliasIndex, normalizeBusinessDate, _laborWageParts, toastLaborCostForDate, _meetLaborLDDay, ldLaborDay, storeSalaryMonthly, _laborGradeSplit, laborMonthWeeks, daysOfYm, laborWeekDays };
}
