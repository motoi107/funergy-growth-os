// secure-state の 1 ファイル（Career Score Q4 段階 3-1・アプリ v1207 のまま）：Supabase › Edge Functions › secure-state に、このファイルの中身をそのまま貼って Deploy（Verify JWT は OFF のまま）。
// 作り方：node scripts/build-secure-state-one.mjs（supabase/functions/secure-state/labor-core.gen.mjs → supabase/functions/secure-state/labor.mjs → supabase/functions/secure-state/csq4.gen.mjs → supabase/functions/secure-state/handler.mjs を import の行だけ外して並べる）。手で直さない。
// ==== supabase/functions/secure-state/labor-core.gen.mjs ====
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
  if (e && e._srvMs===true) return 'monthly';   /* v1192：経理・AM の端末。額は来ないが、月給の額が入っている人（emp-private の印） */
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

// ==== supabase/functions/secure-state/labor.mjs ====
// v1192：人件費の合計をサーバーで出す（Moto さん 11/18「サーバーで合計を出す（推奨）」）。
// 仕様：docs/LABOR_TOTALS_V1192_JA.md。
//
// ・経理・AM の端末には、v1192 の emp-private から全員の時給・月給が届かなくなる。その端末の人件費（予実・会議・ダッシュボード・
//   勤怠・労働時間）は、お金の部分だけをこの関数の答えに置き換える（人ごとの時間は端末で数えたまま）。
// ・計算は index.html の関数そのもの（labor-core.gen.mjs。`node scripts/build-labor-core.mjs` で作る・手で直さない）。
//   ここでは、CEO・GM の端末が持っているのと同じデータ（店・従業員と時給・設定・勤怠）をサーバーの鍵で読んで並べるだけ。
// ・返すのは店ごと・月ごとの合計（時給の人の合計・月給の日割り・休みの日の分・週ごとの同じもの・日ごとの合計・G1／G2 以上の分け）。
//   人ごとの額は返さない（限界：店の合計と人ごとの時間から、1 人だけの日の時給は割り出せる。docs の「限界」）。


// v1192（Codex 6986713362 の P2-1）：md_all_viewers は計算に使わないので読まない（全店で返すかは handler が app_state の md_all_viewers_gm で決める）
export const LT_SETTINGS = ['m_titlewage', 'kpi_config', 'tip_window', 'tip_hours_basis'];
export const LT_STATE = ['tip_hours_config', 'store_closures', 'prep_tables', 'prep_certs'];
// 端末が取り込むときの合流（端末に何も無い所へ合流した形）：mergeMapByTime のキーは「オブジェクトなら浅い写し・そうでなければ {}」
const LT_MAP_KEYS = ['prep_tables', 'prep_certs'];
export const LT_MAX_ASKS = 40;
const YM_RE = /^20\d\d-(0[1-9]|1[0-2])$/;
const DATE_RE = /^20\d\d-\d\d-\d\d$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 端末の app_settings／app_state の 1 行の値（文字）を、端末が localStorage に置く文字と同じにする
export function ltKvString(key, value) {
  let v = value;
  if (LT_MAP_KEYS.includes(key)) v = (v && typeof v === 'object') ? Object.assign({}, v) : {};
  else if (key.startsWith('att_fix_')) v = isObj(v) ? v : {};   // mergeLocalRecMap（_lrObj）：オブジェクトでなければ {}
  if (v === undefined) return null;
  return JSON.stringify(v);
}

// 店の表の行 → 端末の getStoresAll() と同じ形（並びは使わないので id の順のまま）
export function ltStores(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = r && r.data;
    if (!isObj(x) || x._deleted === true) continue;
    const s = Object.assign({}, x);
    if (s.active === undefined) s.active = true;
    if (!s.brand) s.brand = s.name;
    if (s.toastGuid) s.toastGuid = String(s.toastGuid).trim().toLowerCase();
    if (s.format === undefined) s.format = (s.brand === 'Tenkichi' || s.brand === 'Marujuu') ? 'izakaya' : 'dining';
    if (s.lunchHours === undefined) s.lunchHours = '11:00-14:30';
    if (s.dinnerHours === undefined) s.dinnerHours = '17:00-22:00';
    if (s.takeout === undefined) s.takeout = true;
    out.push(s);
  }
  return out;
}

// 従業員の表の行と保護の表（時給・月給） → CEO・GM の端末の getEmployees() と同じ形
export function ltEmployees(rows, privRows) {
  const priv = new Map();
  for (const p of Array.isArray(privRows) ? privRows : []) if (p && p.emp_id != null) priv.set(String(p.emp_id), p);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = r && r.data;
    if (!isObj(x)) continue;
    if (x.isTest === true || String(x.id || '').indexOf('tst_') === 0) continue;   // _stripTestRows と同じ
    const e = Object.assign({}, x);
    if (e.coef === undefined) e.coef = 1.0;
    const p = priv.get(String(e.id));
    if (p) {
      // emp-private の rowToPriv と getEmployees の重ね方：wage は Number(…)||0、月給は null でなければ
      e.wage = Number(p.wage) || 0;
      const ms = p.monthly_salary == null ? null : Number(p.monthly_salary);
      if (ms !== undefined && ms !== null) e.monthlySalary = ms;
    }
    out.push(e);
  }
  return out;
}

// HST（ハワイ）の今日
function hstToday(nowMs) {
  const d = new Date(nowMs - 10 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
const dayMs = s => Date.parse(s + 'T00:00:00Z');

// 端末の「今日（ハワイ）」を使う（端末と同じ締め＝今月は昨日まで）。サーバーの今日と 1 日より離れていたらサーバーの今日
export function ltToday(to, nowMs) {
  const srv = hstToday(nowMs);
  if (typeof to === 'string' && DATE_RE.test(to) && Number.isFinite(dayMs(to)) && Math.abs(dayMs(to) - dayMs(srv)) <= 86400000) return to;
  return srv;
}

// 頼まれた店・月ごとの合計を出す。data＝{ stores, employees, kv（キー → 端末と同じ文字）, today, jobs（勤怠の行） }
export function ltCompute(data, asks) {
  const kv = data.kv;
  const parsed = new Map();
  const ls = (k, def) => { const v = kv.has(k) ? kv.get(k) : null; try { return v ? JSON.parse(v) : def; } catch { return def; } };
  const lrRead = k => {
    if (parsed.has(k)) return parsed.get(k);
    let v = null; const raw = kv.has(k) ? kv.get(k) : null;
    try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
    parsed.set(k, v); return v;
  };
  let keys = null;
  const memo = {};
  const today = data.today;
  const core = laborCore({
    window: {},
    STORES: data.stores,
    _lrRead: lrRead,
    _lsRaw: ls,
    _mdMemo: (ns, key, make) => { const b = memo[ns] || (memo[ns] = {}); if (Object.prototype.hasOwnProperty.call(b, key)) return b[key]; b[key] = make(); return b[key]; },
    bizToday: () => today,
    curYm: () => today.slice(0, 7),
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    getEmployees: () => data.employees,
    ls,
    lsKeys: p => { const pre = p == null ? '' : String(p); if (!keys) keys = [...kv.keys()]; return keys.filter(k => k.indexOf(pre) === 0); },
    t: ja => ja,
    v1136Moved: () => true,
  });
  const emps = data.employees;
  // 読んだ勤怠を、端末が取り込むときと同じ関数（tipLaborBuildDay）・同じ設定で tip_labor_<店>_<日> の形にする
  const aidx = core.toastAliasIndex(emps);
  for (const j of data.jobs || []) {
    for (const row of j.rows || []) {
      const list = row && row.data;
      if (!Array.isArray(list) || !list.length) continue;   // 端末も中身の無い日は書かない
      const bd = core.normalizeBusinessDate(row.business_date);
      if (!bd || !DATE_RE.test(bd) || bd < j.from || bd > j.to) continue;
      for (const sid of j.sids) kv.set('tip_labor_' + sid + '_' + bd, JSON.stringify(core.tipLaborBuildDay(sid, bd, list, emps, aidx)));
    }
  }
  keys = null; parsed.clear();
  for (const k of Object.keys(memo)) delete memo[k];
  const out = {};
  const salCache = {};
  for (const { s: sid, m: ym } of asks) {
    const P = core._laborWageParts(sid, ym, {});
    const w = {};
    for (const wk of core.laborMonthWeeks(ym)) {
      const q = core._laborWageParts(sid, ym, { weekSun: wk.sun });
      w[wk.sun] = { hourly: q.hourly, leave: q.leave, leaveDays: q.leaveDays, salary: q.salary };
    }
    const d = {};
    for (const dd of core.daysOfYm(ym)) {
      const dt = dd.date;
      if (core.getTipLabor(sid, dt) == null) continue;
      const ml = core._meetLaborLDDay(sid, dt), ld = core.ldLaborDay(sid, dt);
      d[dt] = { c: core.toastLaborCostForDate(sid, dt), ml: ml.lc, md: ml.dc, ll: ld.cL, ld: ld.cD };
    }
    if (!(sid in salCache)) salCache[sid] = core.storeSalaryMonthly(sid);
    const g = core._laborGradeSplit(sid, ym, P, emps);
    out[sid + '|' + ym] = { p: { hourly: P.hourly, leave: P.leave, leaveDays: P.leaveDays, salary: P.salary }, w, d, sal: salCache[sid], g: { g1: g.g1, g2: g.g2, has: g.has } };
  }
  return out;
}

// 頼みの形を確かめる（店は文字・月は YYYY-MM・40 件まで・同じものは 1 つに）
export function ltAsks(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > LT_MAX_ASKS) return null;
  const seen = new Set(), out = [];
  for (const a of raw) {
    if (!isObj(a) || typeof a.s !== 'string' || !a.s || a.s.length > 40 || !/^[A-Za-z0-9@_.-]+$/.test(a.s) || typeof a.m !== 'string' || !YM_RE.test(a.m)) return null;
    const k = a.s + '|' + a.m;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ s: a.s, m: a.m });
  }
  return out;
}

const enc = encodeURIComponent;
function ymRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [ym + '-01', ym + '-' + String(last).padStart(2, '0')];
}
function ymAdd(ym, d) { const [y, m] = ym.split('-').map(Number); const n = y * 12 + m - 1 + d; return Math.floor(n / 12) + '-' + String(n % 12 + 1).padStart(2, '0'); }
// 端末の k2SysGuids（業務用アカウントの Toast ID）が見る勤怠の範囲：その月の 13 か月前の 1 日から、端末にあるいちばん新しい日まで
export const LT_SYS_BACK = 13;
export const LT_PAGE = 1000, LT_MAX_PAGES = 60;

// v1192（Codex 6986713362 の確認）：limit を付けて 1 回で読むと、サーバーの上限（Supabase は既定で 1 回 1,000 行）で黙って切れる。
// 並びを決めて 1,000 行ずつ、空のページが来るまで読む（上限が 1,000 より小さくても切れない）。読み切れなければ失敗（途中までで合計を出さない）
export async function ltReadAll(rest, path) {
  const out = [];
  for (let page = 0; page < LT_MAX_PAGES; page++) {
    const rows = await rest(path + '&limit=' + LT_PAGE + '&offset=' + out.length);
    if (!Array.isArray(rows)) { const e = new Error('db'); e.code = 'db'; throw e; }
    if (!rows.length) return out;
    for (const r of rows) out.push(r);
  }
  const e = new Error('db'); e.code = 'db'; e.detail = 'too_many_rows'; throw e;
}

// サーバーの鍵でデータを読む（rest＝handler の rest）。読めなければ失敗（途中までのデータで合計を出さない）
export async function ltLoad(rest, asks, today) {
  const [storeRows, empRows, privRows, setRows, stRows] = await Promise.all([
    ltReadAll(rest, 'stores?select=id,data&order=id.asc'),
    ltReadAll(rest, 'employees?select=id,data&order=id.asc'),
    ltReadAll(rest, 'employees_private?select=emp_id,wage,monthly_salary&order=emp_id.asc'),
    rest('app_settings?select=key,value&key=in.(' + LT_SETTINGS.map(enc).join(',') + ')'),
    rest('app_state?select=key,value&key=in.(' + [...LT_STATE, ...[...new Set(asks.map(a => 'att_fix_' + a.s + '_' + a.m))]].map(enc).join(',') + ')'),
  ]);
  if (![storeRows, empRows, privRows, setRows, stRows].every(Array.isArray)) { const e = new Error('db'); e.code = 'db'; throw e; }
  const stores = ltStores(storeRows), employees = ltEmployees(empRows, privRows);
  const kv = new Map();
  for (const r of [...setRows, ...stRows]) { if (r && typeof r.key === 'string') { const s = ltKvString(r.key, r.value); if (s != null) kv.set(r.key, s); } }
  // 勤怠（店の Toast の GUID ごとに 1 回）。v1192（Codex 6986713362 の P2）：前は頼まれた月だけを読んだので、業務用アカウントの
  // Toast ID（k2SysGuids・その月の 13 か月前から）が頼む月の組み合わせで変わり、L/D の合計も変わった（11 月だけ／10・11 月で違う）。
  // いまは頼みによらず、いちばん前の月の 13 か月前の 1 日から、今月（頼まれた月があとならその月）の終わりまでを読む
  const ymsAsked = asks.map(a => a.m).sort();
  const todayYm = String(today).slice(0, 7);
  const lastYm = ymsAsked[ymsAsked.length - 1] > todayYm ? ymsAsked[ymsAsked.length - 1] : todayYm;
  const from = ymAdd(ymsAsked[0], -LT_SYS_BACK) + '-01', to = ymRange(lastYm)[1];
  const byStore = new Map(stores.map(s => [s.id, s]));
  const jobs = new Map();
  for (const a of asks) {
    const st = byStore.get(a.s); const guid = st && st.toastGuid;
    if (!guid) continue;
    if (!jobs.has(guid)) jobs.set(guid, { guid, from, to, sids: new Set() });
    jobs.get(guid).sids.add(a.s);
  }
  const list = [...jobs.values()];
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async j => {
      j.rows = await ltReadAll(rest, 'tip_labor?select=business_date,data&restaurant_guid=eq.' + enc(j.guid) + '&business_date=gte.' + from + '&business_date=lte.' + to + '&order=business_date.asc');
    }));
  }
  return { stores, employees, kv, today, jobs: list };
}

// ==== supabase/functions/secure-state/csq4.gen.mjs ====
// 自動で作ったファイル。手で直さない（careerscore/q4-core.mjs か careerscore/cs-q4-v1.json を直して `node scripts/gen-secure-state-csq4.mjs` を流す）。
// Career Score 2026 Q4（段階 3-1）：関数 secure-state が使う計算の芯（careerscore/q4-core.mjs のまま）と評価表マスター（careerscore/cs-q4-v1.json のまま）。
/* eslint-disable */
export const CSQ4 = (() => {
// Career Score 2026 Q4（新制度・CAREER_2026_Q4_V1）の計算の芯。
// 画面・サーバー（関数）・試験が同じ計算を使う。依存なし。数は BigInt の分数で正確に持ち、表示だけ小数 1 桁に丸める。
// 決まりの出どころ：Moto さんの Excel（careerscore/cs-q4-v1.json に写した）の「GM実装仕様」「配点・基準点案」と 2026Q4 の指示書。
//   - G カテゴリー＝点数合計 ÷ [3 ×（採点数＋未担当数）] × 配点。未担当は 0 点で分母に入る。完全非該当・会社都合の今回非該当は除外
//   - S カテゴリー＝採点済みの平均 ÷ 3 × 配点（未担当は無い）
//   - 理念は 5 分類を等しく。分類ごとの平均 ÷ 3 を、対象の分類で平均して × 配点（G は未担当 0 点を含める）
//   - S Office の技術・専門実務は Office・経理・人事の領域ごとの平均 ÷ 3 を、採点対象のある領域で等しく平均
//   - 全項目が除外のカテゴリーは対象配点から外す。G で未担当だけのカテゴリーは 0 点で配点を残す
//   - 総合点＝カテゴリー得点の合計 ÷ 対象配点の合計 × 100。基準点の判定は丸める前の値で。未評価が残る・対象配点 0 なら判定しない
//   - 配点 0 のカテゴリーも計算して持つ（得点 0・対象配点 0）。未評価なら確定を止める

const CSQ4_VERSION = 'CAREER_2026_Q4_V1';
const STATUS = Object.freeze({ SCORED: 'SCORED', UNASSIGNED: 'UNASSIGNED', NOT_APPLICABLE: 'NOT_APPLICABLE', UNASSESSED: 'UNASSESSED' });
const NA_REASON = Object.freeze({ ROLE: 'ROLE_NOT_APPLICABLE', COMPANY: 'COMPANY_UNASSIGNED_THIS_PERIOD' });

// ---------- 分数 ----------
const ZERO = BigInt(0), ONE = BigInt(1), TEN = BigInt(10), TWO = BigInt(2);
function gcd(a, b) { if (a < ZERO) a = -a; if (b < ZERO) b = -b; while (b) { const t = a % b; a = b; b = t; } return a; }
function frac(n, d) {
  n = BigInt(n); d = d === undefined ? ONE : BigInt(d);
  if (d === ZERO) throw new Error('frac: zero denominator');
  if (d < ZERO) { n = -n; d = -d; }
  const g = gcd(n, d) || ONE;
  return { n: n / g, d: d / g };
}
const F0 = frac(0), F1 = frac(1);
const fadd = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const fmul = (a, b) => frac(a.n * b.n, a.d * b.d);
const fdiv = (a, b) => { if (b.n === ZERO) throw new Error('frac: divide by zero'); return frac(a.n * b.d, a.d * b.n); };
const fcmp = (a, b) => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
// 10 進の文字列か数から分数（0.8 → 4/5）。指数表記・非有限は断る
function fdec(x) {
  if (typeof x === 'bigint') return frac(x);
  const s = typeof x === 'number' ? (Number.isFinite(x) ? String(x) : '') : String(x == null ? '' : x).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error('fdec: not a plain decimal: ' + s);
  const fr = m[3] || '';
  return frac((m[1] ? '-' : '') + m[2] + fr, TEN ** BigInt(fr.length));
}
const fnum = (a) => Number(a.n) / Number(a.d);
const fstr = (a) => a.n.toString() + '/' + a.d.toString();
// 表示用：小数 1 桁・四捨五入（0 以上だけ）。84.96 → "85.0"
function fixed1(a) {
  if (a.n < ZERO) throw new Error('fixed1: negative');
  const k = (a.n * TEN * TWO + a.d) / (TWO * a.d);
  return (k / TEN).toString() + '.' + (k % TEN).toString();
}
const fsum = (arr) => arr.reduce((s, x) => fadd(s, x), F0);
const fmean = (arr) => fdiv(fsum(arr), frac(arr.length));
function val(a) { return a ? { exact: fstr(a), value: fnum(a), display: fixed1(a) } : null; }

// ---------- 期間（Pacific/Honolulu）----------
// 実入力の日時（ISO の文字列・Date・ミリ秒）からハワイの日付（YYYY-MM-DD）を出す。日時そのものは書き換えない
const HNL_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu', year: 'numeric', month: '2-digit', day: '2-digit' });
// 暦にある日付だけ（YYYY-MM-DD・11/31・11/32・平年の 2/29 などは日付ではない。Codex #212 P3）
function csq4IsDate(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const y = +x.slice(0, 4), m = +x.slice(5, 7), d = +x.slice(8, 10);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function csq4HnlDate(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const x of HNL_FMT.formatToParts(d)) p[x.type] = x.value;
  return p.year + '-' + p.month + '-' + p.day;
}
// その日時が新制度の期間（start 以上・endExclusive 未満のハワイの日付）に入るか
function csq4InPeriod(master, t) {
  const day = csq4HnlDate(t);
  return !!day && day >= master.period.start && day < master.period.endExclusive;
}

// ---------- マスター ----------
function csq4System(master, sys) {
  const s = master && master.systems && master.systems[sys];
  if (!s) throw new Error('unknown system: ' + sys);
  return s;
}
function itemMap(s) { const m = new Map(); for (const it of s.items) m.set(it.id, it); return m; }

// ---------- 1 項目の確かめ（サーバーも同じ決まり）----------
// entry = { status, score, naReasonType, naReason, unassignedReason, periodOnly, periodFrom, periodTo }
// 戻り値：エラーのコードの配列（空なら OK）
function csq4CheckEntry(master, sys, id, e) {
  const s = csq4System(master, sys);
  const errs = [];
  if (!itemMap(s).has(id)) return ['unknown_item'];
  if (!e || typeof e !== 'object') return ['bad_entry'];
  const st = e.status;
  const isG = !!s.unassigned;
  const allowed = isG ? [STATUS.SCORED, STATUS.UNASSIGNED, STATUS.NOT_APPLICABLE, STATUS.UNASSESSED] : [STATUS.SCORED, STATUS.NOT_APPLICABLE, STATUS.UNASSESSED];
  if (!allowed.includes(st)) return [st === STATUS.UNASSIGNED ? 'unassigned_only_g' : 'bad_status'];
  const txt = (v) => typeof v === 'string' && v.trim().length > 0;
  if (st === STATUS.SCORED) {
    if (!Number.isInteger(e.score) || e.score < 0 || e.score > 3) errs.push('bad_score');
  } else if (st === STATUS.UNASSIGNED) {
    if (e.score !== 0 && e.score !== null && e.score !== undefined) errs.push('unassigned_score_is_0');
    if (!txt(e.unassignedReason)) errs.push('unassigned_reason_required');
  } else if (st === STATUS.NOT_APPLICABLE) {
    if (e.score !== null && e.score !== undefined) errs.push('na_score_is_null');
    if (!txt(e.naReason)) errs.push('na_reason_required');
    const rt = e.naReasonType;
    if (isG) {
      if (rt !== NA_REASON.ROLE && rt !== NA_REASON.COMPANY) errs.push('na_reason_type_required');
    } else if (rt !== undefined && rt !== null && rt !== NA_REASON.ROLE) {
      errs.push('na_reason_type_g_only');   // 会社都合の今回非該当は G の未担当から変える特例（S・Prep には広げない）
    }
    if (rt === NA_REASON.COMPANY) {
      if (e.periodOnly !== true) errs.push('company_na_period_only');
      const p = master.period;
      if (!csq4IsDate(e.periodFrom) || !csq4IsDate(e.periodTo)) errs.push('company_na_period_required');
      else if (e.periodFrom > e.periodTo || e.periodFrom < p.start || e.periodTo >= p.endExclusive) errs.push('company_na_period_out_of_quarter');
    } else if (e.periodOnly === true) {
      errs.push('period_only_company_only');
    }
  } else if (st === STATUS.UNASSESSED) {
    if (e.score !== null && e.score !== undefined) errs.push('unassessed_score_is_null');
  }
  return errs;
}

// 項目の状態を数えやすい形に
function kind(e) {
  if (!e || e.status === STATUS.UNASSESSED || !e.status) return 'U';           // 未評価（入っていない項目も）
  if (e.status === STATUS.SCORED) return 'S';
  if (e.status === STATUS.UNASSIGNED) return 'A';                              // 未担当（G だけ・0 点で分母に入る）
  if (e.status === STATUS.NOT_APPLICABLE) return e.naReasonType === NA_REASON.COMPANY ? 'C' : 'R';
  return 'U';
}

// 項目の集まりの平均（0〜3 のどこか）。counted＝分母に入る数
function groupAvg(items, entries) {
  let sum = 0, counted = 0, unassessed = 0, scored = 0, unassigned = 0, naRole = 0, naCompany = 0;
  for (const it of items) {
    const e = entries[it.id];
    const k = kind(e);
    if (k === 'S') { sum += e.score; counted++; scored++; }
    else if (k === 'A') { counted++; unassigned++; }
    else if (k === 'R') naRole++;
    else if (k === 'C') naCompany++;
    else unassessed++;
  }
  return { avg: counted ? frac(sum, counted) : null, sum, counted, unassessed, scored, unassigned, naRole, naCompany, total: items.length };
}

// カテゴリーの「率」（0〜1）。理念は分類ごと、S Office の技術は領域ごと
function categoryRate(cat, items, entries, sysDef) {
  if (cat === 'PHILO') {
    const parts = [];
    for (const c of csq4PhiloClasses(sysDef)) {
      const g = groupAvg(items.filter((i) => i.cls === c.key), entries);
      parts.push({ key: c.key, name: c.name, ...g, rate: g.avg ? fdiv(g.avg, frac(3)) : null, state: g.counted ? 'counted' : (g.unassessed ? 'pending' : 'excluded') });
    }
    const counted = parts.filter((p) => p.rate);
    return { rate: counted.length ? fmean(counted.map((p) => p.rate)) : null, parts, partKind: 'class' };
  }
  if (cat === 'TECH' && sysDef.domains) {
    const parts = [];
    for (const d of sysDef.domains) {
      const g = groupAvg(items.filter((i) => i.domain === d.key), entries);
      parts.push({ key: d.key, name: d.name, ...g, rate: g.avg ? fdiv(g.avg, frac(3)) : null, state: g.counted ? 'counted' : (g.unassessed ? 'pending' : 'excluded') });
    }
    const counted = parts.filter((p) => p.rate);
    return { rate: counted.length ? fmean(counted.map((p) => p.rate)) : null, parts, partKind: 'domain' };
  }
  const g = groupAvg(items, entries);
  return { rate: g.avg ? fdiv(g.avg, frac(3)) : null, parts: null };
}
function csq4PhiloClasses(sysDef) { return sysDef._philoClasses; }

function gradeNum(sys, grade) {
  const m = /^([GS])([1-6])$/.exec(String(grade || ''));
  if (!m) return null;
  if ((sys === 'G') !== (m[1] === 'G')) return null;
  return m[2];
}

// ---------- G・S Chef・S Office の計算 ----------
// input = { system, grade: 'G3'|'S2'..., type: 'Kitchen中心' など（G だけ）, entries: { [id]: entry } }
function csq4Score(master, input) {
  const sys = input.system;
  if (sys === 'PREP') throw new Error('use csq4Prep for PREP');
  const sysDef = Object.assign({}, csq4System(master, sys), { _philoClasses: master.philoClasses });
  const gn = gradeNum(sys, input.grade);
  if (!gn) return { ok: false, error: 'bad_grade' };
  const wrow = sys === 'G' ? (sysDef.weights['G' + gn] || {})[input.type] : sysDef.weights['S' + gn];
  if (!wrow) return { ok: false, error: sys === 'G' ? 'bad_type' : 'bad_grade' };
  const entries = input.entries || {};
  const ids = itemMap(sysDef);
  const unknown = Object.keys(entries).filter((id) => !ids.has(id));
  const entryErrors = {};
  for (const id of Object.keys(entries)) {
    if (!ids.has(id)) continue;
    const e = entries[id];
    if (!e || e.status === undefined || e.status === STATUS.UNASSESSED) continue;
    const er = csq4CheckEntry(master, sys, id, e);
    if (er.length) entryErrors[id] = er;
  }
  // 入力に誤りのある項目は、計算では未評価として扱う（確定は止まる）
  const eff = {};
  for (const id of ids.keys()) eff[id] = entryErrors[id] ? undefined : entries[id];

  const cats = [];
  let sumScore = F0, sumTarget = F0;
  const counts = { items: sysDef.items.length, scored: 0, unassigned: 0, naRole: 0, naCompany: 0, unassessed: 0 };
  for (const c of sysDef.categories) {
    const items = sysDef.items.filter((i) => i.cat === c.key);
    const g = groupAvg(items, eff);
    for (const k of ['scored', 'unassigned', 'naRole', 'naCompany', 'unassessed']) counts[k] += g[k];
    const weight = frac(wrow.weights[c.key]);
    const r = categoryRate(c.key, items, eff, sysDef);
    // 対象：分母に入る項目が 1 つでもある（G の未担当だけでも対象・0 点）
    let state, target = F0, score = null;
    if (r.rate) {
      state = g.unassessed ? 'partial' : 'counted';
      target = weight;
      score = fmul(r.rate, weight);
    } else if (g.unassessed) {
      state = 'pending';           // まだ採点がない（仮の計算では外す）
    } else {
      state = 'excluded';          // 全項目が完全非該当・会社都合の今回非該当
    }
    if (score) { sumScore = fadd(sumScore, score); sumTarget = fadd(sumTarget, target); }
    cats.push({
      key: c.key, name: c.name, weight: Number(wrow.weights[c.key]), targetWeight: fnum(target), state,
      score: val(score), rate: val(r.rate ? fmul(r.rate, frac(100)) : null),
      avg: g.avg ? val(g.avg) : null,
      counts: { items: g.total, scored: g.scored, unassigned: g.unassigned, naRole: g.naRole, naCompany: g.naCompany, unassessed: g.unassessed },
      parts: r.parts ? r.parts.map((p) => ({ key: p.key, name: p.name, state: p.state, avg: p.avg ? val(p.avg) : null, counts: { items: p.total, scored: p.scored, unassigned: p.unassigned, naRole: p.naRole, naCompany: p.naCompany, unassessed: p.unassessed } })) : null,
    });
  }
  const anyInvalid = Object.keys(entryErrors).length > 0 || unknown.length > 0;
  const total = sumTarget.n > ZERO ? fmul(fdiv(sumScore, sumTarget), frac(100)) : null;
  let state;
  if (counts.unassessed > 0 || anyInvalid) state = counts.scored + counts.unassigned ? 'in_progress' : 'not_started';
  else state = total ? 'complete' : 'not_calculable';
  const base = Number(master.base[sys === 'G' ? 'G' : 'S'][gn]);
  const baseMet = state === 'complete' ? fcmp(total, frac(base)) >= 0 : null;
  const minimum = csq4Minimum(master, sys, gn, input.type, eff, sysDef);
  const lists = csq4Lists(sysDef, eff);   // 入力に誤りのある項目は一覧にも載せない（計算と同じく未評価）
  return {
    ok: true, version: master.version, system: sys, grade: input.grade, type: sys === 'G' ? input.type : null,
    state, confirmable: state === 'complete' && !anyInvalid,
    total: val(total), totalProvisional: state !== 'complete',
    targetWeight: fnum(sumTarget), baseWeight: 100, scoreSum: val(sumScore),
    base, baseMet,
    counts, categories: cats, minimum,
    unassignedList: lists.unassigned, roleNaList: lists.roleNa,
    entryErrors, unknownItems: unknown,
  };
}

// 本人向けの一覧：未担当と会社都合の今回非該当（G）／完全非該当は別枠
// master と sys を渡すと、入力に誤りのある項目は載せない（csq4Score と同じく未評価として扱う）
function csq4Lists(sysDef, entries, master, sys) {
  const unassigned = [], roleNa = [];
  for (const it of sysDef.items) {
    let e = entries[it.id];
    if (e && master && sys && csq4CheckEntry(master, sys, it.id, e).length) e = undefined;
    const k = kind(e);
    const row = { id: it.id, cat: it.cat, name: it.name };
    if (k === 'A') unassigned.push({ ...row, status: STATUS.UNASSIGNED, reason: e.unassignedReason || '', feedback: e.feedbackComment || '' });
    else if (k === 'C') unassigned.push({ ...row, status: STATUS.NOT_APPLICABLE, naReasonType: NA_REASON.COMPANY, reason: e.naReason || '', periodFrom: e.periodFrom || null, periodTo: e.periodTo || null, feedback: e.feedbackComment || '' });
    else if (k === 'R') roleNa.push({ ...row, reason: e.naReason || '' });
  }
  return { unassigned, roleNa };
}

// ---------- 最低条件（配点・基準点案 40〜47 行・GM実装仕様 55 行）----------
// 状態：met｜not_met｜no_opportunity（対象がすべて除外＝実務機会なし・未確認）｜incomplete（未評価があり決まらない）｜pending_rule（資料で決まっていない）
function avgCondition(key, label, min, items, entries) {
  const g = groupAvg(items, entries);
  let state;
  if (g.unassessed) state = 'incomplete';
  else if (!g.counted) state = 'no_opportunity';
  else state = fcmp(g.avg, min) >= 0 ? 'met' : 'not_met';
  return { key, label, min: fnum(min), avg: g.avg ? val(g.avg) : null, state, counts: { items: g.total, counted: g.counted, unassessed: g.unassessed, excluded: g.naRole + g.naCompany } };
}
function csq4Minimum(master, sys, gn, type, entries, sysDef) {
  const row = master.minimum[gn];
  const out = [];
  const items = sysDef.items;
  // 理念 5 分類の各平均
  // 分類ごとの決まり（Codex #212 P2）：1 つでも未達なら未達・未評価があれば決まらない・どれかの分類の対象がすべて除外なら実務機会なし
  const classes = master.philoClasses.map((c) => avgCondition('philo:' + c.key, '理念：' + c.name, fdec(row.philoClass), items.filter((i) => i.cat === 'PHILO' && i.cls === c.key), entries));
  const cs = classes.map((c) => c.state);
  out.push({
    key: 'philoClass', label: '理念 5 分類の各平均', min: Number(row.philoClass), parts: classes,
    state: cs.includes('not_met') ? 'not_met' : cs.includes('incomplete') ? 'incomplete' : cs.includes('no_opportunity') ? 'no_opportunity' : 'met',
  });
  if (sys === 'G') {
    out.push(avgCondition('basic', '基本業務', fdec(row.basic), items.filter((i) => i.cat === 'BASIC'), entries));
    const map = (master.systems.G.mainMap || {})[type];
    if (map && map.each) {
      // 両部門育成・G4 以上：サービスとキッチンの両方が主担当。それぞれの平均を G主担当の基準で見る（G他部門は使わない）。
      // 1 つでも未達なら未達・未評価があれば決まらない・どれかの対象がすべて除外なら実務機会なし（部門ごとに分けた型と同じ）
      const names = Object.fromEntries((master.systems.G.categories || []).map((c) => [c.key, c.short || c.name]));
      const parts = map.main.map((cat) => avgCondition('gMain:' + cat, 'G主担当：' + (names[cat] || cat), fdec(row.gMain), items.filter((i) => i.cat === cat), entries));
      const ps = parts.map((p) => p.state);
      out.push({
        key: 'gMain', label: 'G主担当（' + map.main.map((c) => names[c] || c).join('・') + 'のそれぞれ）', min: Number(row.gMain), cats: map.main, each: true, parts,
        state: ps.includes('not_met') ? 'not_met' : ps.includes('incomplete') ? 'incomplete' : ps.includes('no_opportunity') ? 'no_opportunity' : 'met',
      });
    } else {
      for (const [k, col, label] of [['gMain', 'main', 'G主担当'], ['gOther', 'other', 'G他部門']]) {
        if (!map) { out.push({ key: k, label, min: Number(row[k]), state: 'pending_rule', note: master.systems.G.mainMapNote }); continue; }
        const its = items.filter((i) => map[col].includes(i.cat));
        out.push(Object.assign(avgCondition(k, label, fdec(row[k]), its, entries), { cats: map[col] }));
      }
    }
  }
  if (sys === 'S_CHEF') out.push(avgCondition('chefHygiene', 'Chef 衛生', fdec(row.chefHygiene), items.filter((i) => i.cat === 'HYGIENE'), entries));
  if (sys === 'S_CHEF' || sys === 'S_OFFICE') out.push(avgCondition('sQuality', 'S 品質管理', fdec(row.sQuality), items.filter((i) => i.cat === 'QUALITY'), entries));
  // 指定項目（G2 以上・S2 以上）：01-13・01-14・01-09・01-16 は対象の各項目が 2 点以上
  const mi = master.minimumItems;
  if (Number(gn) >= mi.fromGrade && mi.systems.includes(sys)) {
    const parts = [];
    for (const id of mi.ids) {
      const it = items.find((i) => i.id === id);
      if (!it) { parts.push({ id, state: 'no_item' }); continue; }
      const e = entries[id];
      const k = kind(e);
      let state;
      if (k === 'S') state = e.score >= mi.min ? 'met' : 'not_met';
      else if (k === 'A') state = 'not_met';            // G の未担当は 0 点
      else if (k === 'R' || k === 'C') state = 'excluded';
      else state = 'incomplete';
      parts.push({ id, state, score: k === 'S' ? e.score : k === 'A' ? 0 : null });
    }
    const ps = parts.filter((p) => p.state !== 'no_item').map((p) => p.state);
    out.push({
      key: 'items', label: '指定項目（各 2 点以上）', min: mi.min, parts,
      state: ps.includes('not_met') ? 'not_met' : ps.includes('incomplete') ? 'incomplete' : ps.every((s) => s === 'excluded') ? 'no_opportunity' : 'met',
    });
  }
  const st = out.map((c) => c.state);
  // 実務機会なし（対象がすべて非該当）の条件があれば、全体も「達成」にしない（実務機会なし・未確認）
  const overall = st.includes('not_met') ? 'not_met' : st.includes('incomplete') ? 'incomplete' : st.includes('pending_rule') ? 'pending_rule' : st.includes('no_opportunity') ? 'no_opportunity' : 'met';
  return { overall, conditions: out, noOpportunity: out.filter((c) => c.state === 'no_opportunity').map((c) => c.key) };
}

// ---------- Prep ----------
// input = { entries: { PH1: entry, ... }, quality: { Q1: 'clear'|'not_clear'|'unconfirmed', ... },
//           measure: { trials: [{ date: 'YYYY-MM-DD', goodStd, actual }], independentStd, allStd }, currentStep: 'P1'..'P6'|null }
// 時間は秒などの同じ単位（10 進の文字列か数）。行動確認スコアは時給に掛けない
function csq4Prep(master, input) {
  const P = csq4System(master, 'PREP');
  const entries = input.entries || {};
  const ids = itemMap(P);
  const entryErrors = {};
  for (const id of Object.keys(entries)) {
    if (!ids.has(id)) { entryErrors[id] = ['unknown_item']; continue; }
    const e = entries[id];
    if (!e || e.status === undefined || e.status === STATUS.UNASSESSED) continue;
    const er = csq4CheckEntry(master, 'PREP', id, e);
    if (er.length) entryErrors[id] = er;
  }
  let sum = 0, scored = 0, na = 0, unassessed = 0;
  for (const it of P.items) {
    const e = entryErrors[it.id] ? undefined : entries[it.id];
    const k = kind(e);
    if (k === 'S') { sum += e.score; scored++; }
    else if (k === 'R' || k === 'C') na++;
    else unassessed++;
  }
  const score = scored ? fmul(frac(sum, 3 * scored), frac(100)) : null;
  const anyInvalid = Object.keys(entryErrors).length > 0;
  const state = unassessed || anyInvalid ? (scored ? 'in_progress' : 'not_started') : (scored ? 'complete' : 'not_calculable');

  // 品質確認 Q1〜Q3（未実施・未確認をクリアにしない）
  const q = input.quality || {};
  const quality = P.quality.map((x) => ({ id: x.id, name: x.name, state: q[x.id] === 'clear' || q[x.id] === 'not_clear' ? q[x.id] : 'unconfirmed' }));
  const qualityClear = quality.every((x) => x.state === 'clear');
  const qualityState = quality.some((x) => x.state === 'not_clear') ? 'not_clear' : qualityClear ? 'clear' : 'unconfirmed';

  const meas = csq4PrepMeasure(input.measure);
  let pay;
  if (qualityState !== 'clear') pay = { state: 'quality_' + qualityState, step: null };
  else if (!meas.ok) pay = { state: 'unmeasured', step: null, reason: meas.reason };
  else {
    let step = null;
    for (const p of P.pay) {
      const smin = fdec(p.speedMin), rmin = fdec(p.rangeMin);
      const sOk = p.speedInclusive ? fcmp(meas.speed, smin) >= 0 : fcmp(meas.speed, smin) > 0;
      const rOk = fcmp(meas.range, rmin) >= 0;
      if (sOk && rOk) step = p;
    }
    pay = { state: 'judged', step: step ? step.step : null, wageUsd: step ? step.wageUsd : null };
    const order = P.pay.map((p) => p.step);
    // 今の段が文字で入っているときだけ比べる（空・null・知らない段は比べない）
    const cur = typeof input.currentStep === 'string' && input.currentStep ? order.indexOf(input.currentStep) : -1;
    if (step && cur >= 0) {
      const ni = order.indexOf(step.step);
      pay.compare = ni > cur ? 'raise' : ni === cur ? 'same' : 'keep_current';   // 自動で下げない（確認して判断）
    }
  }
  return {
    ok: true, version: master.version, system: 'PREP',
    state, confirmable: state === 'complete' && !anyInvalid,
    score: val(score), counts: { items: P.items.length, scored, na, unassessed },
    quality, qualityState,
    measure: meas.ok ? { speed: val(meas.speed), range: val(meas.range), trials: meas.trials } : { reason: meas.reason },
    pay, entryErrors,
  };
}
// スピード＝良品完成分の標準作業時間 ÷ 手直しを含む実作業時間（別日 3 回の最低値）／習得範囲＝自立して完結できる作業の標準時間 ÷ 全作業の標準時間
function csq4PrepMeasure(m) {
  if (!m || !Array.isArray(m.trials)) return { ok: false, reason: 'no_measure' };
  const days = new Set();
  let speed = null;
  for (const t of m.trials) {
    if (!t || !csq4IsDate(t.date)) return { ok: false, reason: 'bad_trial_date' };
    let g, a;
    try { g = fdec(t.goodStd); a = fdec(t.actual); } catch (e) { return { ok: false, reason: 'bad_trial_value' }; }
    if (a.n <= ZERO) return { ok: false, reason: 'zero_actual' };
    if (g.n < ZERO) return { ok: false, reason: 'bad_trial_value' };
    days.add(t.date);
    const s = fdiv(g, a);
    if (!speed || fcmp(s, speed) < 0) speed = s;
  }
  if (m.trials.length < 3 || days.size < 3) return { ok: false, reason: 'need_3_days' };
  let ind, all;
  try { ind = fdec(m.independentStd); all = fdec(m.allStd); } catch (e) { return { ok: false, reason: 'no_range' }; }
  if (all.n <= ZERO) return { ok: false, reason: 'zero_all_std' };
  if (ind.n < ZERO || fcmp(ind, all) > 0) return { ok: false, reason: 'bad_range' };
  return { ok: true, speed, range: fdiv(ind, all), trials: m.trials.length };
}
return { CSQ4_VERSION, STATUS, NA_REASON, frac, fadd, fmul, fdiv, fcmp, fdec, fnum, fstr, fixed1, csq4IsDate, csq4HnlDate, csq4InPeriod, csq4System, csq4CheckEntry, csq4Score, csq4Lists, csq4Minimum, csq4Prep, csq4PrepMeasure };
})();
export const CSQ4_MASTER = {"version":"CAREER_2026_Q4_V1","note":"Career Score 2026 Q4（新制度）の評価表マスター。scripts/gen-cs-q4-master.py が Excel から作る。手で直さない。","source":{"file":"Funergy_評価制度_G_P_S (4).xlsx","sha256":"380884c8095898570ce2423ef5b424266299218797333bc9ff17a8dfd8bf6174","sheets":["G評価項目","Prep評価項目","S Chef項目","S Office・経理・人事項目","配点・基準点案","GM実装仕様"]},"period":{"tz":"Pacific/Honolulu","quarter":"2026-Q4","start":"2026-10-01","endExclusive":"2027-01-01"},"scale":{"0":"できていない","1":"支援が必要・不安定","2":"合意した担当範囲で自立して安定実行","3":"安定実行に加えて改善・指導・周囲への良い影響を継続"},"philoClasses":[{"key":"ENJOY","name":"楽しむ"},{"key":"THANK","name":"感謝"},{"key":"CARE","name":"思いやる"},{"key":"GROW","name":"成長"},{"key":"SINCERE","name":"誠実"}],"systems":{"G":{"name":"G","unassigned":true,"categories":[{"key":"PHILO","name":"Funergy Philosophy","short":"理念"},{"key":"BASIC","name":"基本業務スキル","short":"基本業務"},{"key":"SERVICE","name":"サービススキル","short":"サービス"},{"key":"KITCHEN","name":"キッチン／プレップ","short":"Kitchen"},{"key":"MARKETING","name":"マーケティング","short":"Marketing"},{"key":"MGMT","name":"マネジメント","short":"管理"},{"key":"NUMBERS","name":"数字管理","short":"数字"},{"key":"DEVELOP","name":"人材育成","short":"指導・育成"}],"items":[{"id":"01-01","cat":"PHILO","sub":"楽しむ","name":"自ら仕事を楽しむ工夫をし、前向きに取り組む","desc":"受け身で待つだけでなく、仕事の意味や楽しさを見つけ、工夫や協力を自分から行う。困難な場面でも必要な支援を求めて取り組む。性格の明るさだけでは判断しない。","detail":"","row":7,"cls":"ENJOY"},{"id":"01-02","cat":"PHILO","sub":"楽しむ","name":"仲間の良い行動や成長を認め、称賛する","desc":"仲間の良い行動・工夫・成長を具体的な言葉で認め、小さな成功や達成感を共有する。役職や親しさによって称賛する相手を偏らせない。","detail":"","row":8,"cls":"ENJOY"},{"id":"01-03","cat":"PHILO","sub":"楽しむ","name":"お客様に関心を持ち、喜んでいただける行動をする","desc":"お客様の反応や希望に関心を持ち、楽しんでいただける工夫を自ら行う。会話を望まない方にも配慮する。ここでは相手を大切にする姿勢を見て、接客手順の技術はサービスで扱う。","detail":"","row":9,"cls":"ENJOY"},{"id":"01-04","cat":"PHILO","sub":"感謝","name":"お客様の来店を当たり前にしない","desc":"来店時・退店時に感謝を伝える。忙しいときや常連のお客様にも丁寧な対応を続ける。","detail":"","row":10,"cls":"THANK"},{"id":"01-05","cat":"PHILO","sub":"感謝","name":"仲間の協力に感謝を伝える","desc":"手伝いや引き継ぎに対し、何をしてくれて助かったかを言葉にする。","detail":"","row":11,"cls":"THANK"},{"id":"01-06","cat":"PHILO","sub":"感謝","name":"周囲の支えに気づき、大切に行動する","desc":"仕込み・清掃・納品などを担う人や地域・取引先にも敬意を持って接する。準備してもらったものや共有設備を丁寧に扱い、周囲の協力を当たり前にしない。","detail":"","row":12,"cls":"THANK"},{"id":"01-07","cat":"PHILO","sub":"思いやる","name":"仲間の状況を見て助け合う","desc":"自分の持ち場だけでなく、困っている仲間に声をかけ、必要な支援をする。","detail":"","row":13,"cls":"CARE"},{"id":"01-08","cat":"PHILO","sub":"思いやる","name":"仲間に関心を持ち、相手の立場を確認して行動する","desc":"決めつけず話を聞き、経験・言語・状況の違いを踏まえて伝え方や対応を調整する。仲間の困り事や変化に気づき、必要な声かけをする。","detail":"","row":14,"cls":"CARE"},{"id":"01-09","cat":"PHILO","sub":"思いやる","name":"相手を尊重した言動をする","desc":"役職や相手によって敬意を変えない。威圧的な言い方や、人を傷つける言動を避ける。","detail":"","row":15,"cls":"CARE"},{"id":"01-10","cat":"PHILO","sub":"成長","name":"素直に学び、改善に活かす","desc":"分からないことを質問し、フィードバックを行動に反映する。意見や疑問を述べること自体を低評価にしない。","detail":"","row":16,"cls":"GROW"},{"id":"01-11","cat":"PHILO","sub":"成長","name":"苦手なことや新しいことに挑戦する","desc":"課題を把握し、必要な支援を求めながら未経験の仕事や苦手な業務に取り組む。","detail":"","row":17,"cls":"GROW"},{"id":"01-12","cat":"PHILO","sub":"成長","name":"自分が改善できる行動を考え、実践する","desc":"人のせいにして終わらず、自分の判断・準備・伝え方を振り返って次の行動を変え、その後も確認する。設備・制度・人員など会社側の課題も事実として報告する。すべてを本人の責任にしない。","detail":"","row":18,"cls":"GROW"},{"id":"01-13","cat":"PHILO","sub":"誠実","name":"嘘やごまかしをせず、事実を伝える","desc":"未実施の作業を完了扱いにしない。不明なことを分かったふりで答えず確認する。","detail":"","row":19,"cls":"SINCERE"},{"id":"01-14","cat":"PHILO","sub":"誠実","name":"ミスや問題を隠さず、早めに相談する","desc":"自分に不利な内容でも報告する。対応が難しい場合や遅れそうな場合も放置せず相談する。","detail":"","row":20,"cls":"SINCERE"},{"id":"01-15","cat":"PHILO","sub":"誠実","name":"仕事に誇りと責任を持ち、約束やルールを守る","desc":"どんな仕事にも真摯に向き合い、任された仕事をやり切る。難しい場合は事情を伝え、対応や引き継ぎまで行う。役割や仕事の種類で丁寧さを変えない。","detail":"","row":21,"cls":"SINCERE"},{"id":"01-16","cat":"PHILO","sub":"楽しむ","name":"不機嫌を周囲にぶつけず、落ち着いて接する","desc":"確認の要点：忙しくても無視・威圧・物への八つ当たりをせず、必要な返事と連携を続け、難しいときは相談している。\n例：感情を仲間にぶつけず支援を求めている。異論・相談・体調の申告は不機嫌として扱わない。","detail":"忙しさや私的な感情を理由に、呼びかけを意図的に無視する、きつく当たる、物を乱暴に扱うなどの行動をしない。必要な返事・連携を続け、難しいときは相談する。気分や表情だけで決めつけず、実際の言動を見る。異論・相談・体調の申告は不機嫌として扱わない。","row":22,"cls":"ENJOY"},{"id":"02-01","cat":"BASIC","sub":"店舗運営","name":"店舗オペレーションの基本を理解し実行する","desc":"営業の流れ、自分の担当、連携先を把握し、必要な準備と引き継ぎを行う。","detail":"","row":23},{"id":"02-02","cat":"BASIC","sub":"店舗運営","name":"Opening業務を正確に完了する","desc":"手順に沿って準備し、営業開始に間に合わせる。不備や不足は報告する。","detail":"","row":24},{"id":"02-03","cat":"BASIC","sub":"店舗運営","name":"Closing業務を正確に完了する","desc":"清掃・補充・保管・締め・安全確認を行い、翌日も円滑に営業できる状態にする。","detail":"","row":25},{"id":"02-04","cat":"BASIC","sub":"店舗運営","name":"各種リストを漏れなく使用し、作業・確認・記録を行う","desc":"確認の要点：店舗で使う仕込み表・Closing List・確認リスト・清掃リストを、担当範囲で漏れなく使用している。\n例：実際に作業・確認してから記録し、未完了や異常は対応・報告している。","detail":"仕込み表・Closing List・確認リスト・清掃リストなど、店舗で使用する担当業務の各種リストを、決められたタイミングで漏れなく使用する。実際に作業・確認してから記録し、未完了や異常がある場合は対応・報告する。","row":26},{"id":"02-05","cat":"BASIC","sub":"ルール理解・遵守","name":"勤怠・シフトルールを理解し守る","desc":"打刻、変更申請、欠勤・遅刻時の連絡を定められた方法で行う。","detail":"","row":27},{"id":"02-07","cat":"BASIC","sub":"ルール理解・遵守","name":"清潔さ（QSCのC）・衛生・安全の基本を実践する","desc":"確認の要点：客席・入口・トイレ・厨房・器具の汚れや臭いなどを確認し、営業中も清潔さを保っている。\n例：清掃・補充・整頓に加え、手洗い・身だしなみ・交差汚染防止・安全作業を行い、仕上がりも確認している。","detail":"清潔さ（QSCのC）は、客席・テーブル・椅子・メニュー・入口・トイレ・厨房・器具の汚れ、べたつき、臭い、ゴミ等を担当範囲で確認し、営業中も清掃・補充・整頓して清潔な状態を保つ。手洗い・身だしなみ・交差汚染防止・安全作業も実行する。清掃したかだけでなく、実際の仕上がりを確認する。","row":28},{"id":"02-08","cat":"BASIC","sub":"基本操作・知識","name":"POS／Toastを正確に操作する","desc":"注文・変更・会計を正しく行う。取消・返金は権限と手順を確認する。","detail":"","row":29},{"id":"02-09","cat":"BASIC","sub":"基本操作・知識","name":"担当GradeのKPIを理解し、日々の行動に結びつける","desc":"確認の要点：会社が定めた担当等級のKPIの意味を理解し、自分の日常の行動と結びつけて実践している。\n例：顧客満足度や客数などの指標について、自分の仕事がどう影響するかを説明し、行動へ反映している。","detail":"G2・G3共通の顧客満足度、リピート率、客数、ドリンク比率、Googleレビューなど、会社が設定したKPIの意味と自分の行動との関係を説明し、実践する。G4は全KPI・FL・売上管理、G5は担当エリアへの適用を扱う。ここでは日常の理解・行動を見て、店舗全体の数値分析は数字管理で扱う。達成結果は別評価。指標の定義・集計方法・目標は別途設定。","row":30},{"id":"02-10","cat":"BASIC","sub":"報連相・実行力","name":"相手に伝わる報連相を行い、理解と次の行動を確認する","desc":"確認の要点：事実・影響・対応状況・必要な判断を整理して適時に伝え、相手の理解と次の行動を確認している。\n例：言語や理解度に合わせて聞き直し・図・実演・翻訳ツールを使い、業務の意思疎通を図っている。","detail":"事実・影響・対応状況・判断してほしいことを整理して適時に伝える。相手の言語・理解度に合わせ、聞き直し・実演・図・翻訳ツール等を使い、理解と次の行動を確認する。英語の流暢さではなく業務の意思疎通を評価する。緊急時に必要な伝達は担当役割に応じて実務で確認する。","row":31},{"id":"02-11","cat":"BASIC","sub":"報連相・実行力","name":"指示・期限・完成条件を確認して実行する","desc":"内容を理解し期限内に完了・報告する。難しい場合は期限前に相談する。","detail":"","row":32},{"id":"02-12","cat":"BASIC","sub":"初期対応・判断","name":"トラブル時の初期対応を行う","desc":"安全確保や状況確認など担当範囲の対応を行い、必要な責任者へつなぐ。","detail":"","row":33},{"id":"02-13","cat":"BASIC","sub":"初期対応・判断","name":"状況に応じて自分の作業の優先順位を変える","desc":"安全、お客様対応、提供遅れを確認し作業順を調整する。迷う場合は相談する。","detail":"","row":34},{"id":"02-14","cat":"BASIC","sub":"ルール理解・遵守","name":"商品・業務手順の変更を習得し、実務に反映する","desc":"メニュー・レシピ・機器操作・業務手順の変更点を理解し、実際の業務で正しく実行する。情報管理のルール遵守は別の業務ルールで扱う。","detail":"","row":35},{"id":"03-01","cat":"SERVICE","sub":"基本接客","name":"基本接客を正確に行う","desc":"案内、注文確認、提供、会計、お見送りなど担当業務を店舗基準に沿って行う。","detail":"","row":36},{"id":"03-02","cat":"SERVICE","sub":"基本接客","name":"元気な挨拶・返事・声かけで、お客様を迎え、見送る","desc":"確認の要点：お客様に届く声と表情で歓迎・感謝を伝え、返事や店舗の声かけを忙しいときも続けている。\n例：店舗の雰囲気やお客様の状況に合わせ、来店時の挨拶と元気なお見送りを行っている。","detail":"来店時はお客様に届く声と表情で歓迎を伝える。呼びかけには、聞こえたことが分かる返事をする。退店時は感謝を込めて元気にお見送りする。店舗で定めた「やまびこ」の声かけにも参加する。声量だけでなく、歓迎・感謝が伝わり、忙しいときも続けているかを見る。店舗の雰囲気とお客様の状況に合わせる。","row":37},{"id":"03-03","cat":"SERVICE","sub":"基本接客","name":"お客様の様子に気づき、必要な配慮をする","desc":"呼ばれる前に様子を確認し、子ども連れなどの状況に応じ手助けを申し出る。","detail":"","row":38},{"id":"03-04","cat":"SERVICE","sub":"基本接客","name":"客席・受け取り場所の状況を把握し、案内を調整する","desc":"客席の空き・片付け・待ち客・受け取り場所の混雑を把握し、店舗の営業形態に合う案内や誘導を行う。商品の提供順・時間管理は03-05で評価する。","detail":"","row":39},{"id":"03-05","cat":"SERVICE","sub":"基本接客","name":"注文から提供までを把握し、適切なタイミングで提供する","desc":"料理・飲み物の準備状況を確認し、店舗の提供順・基準時間に沿って提供する。遅れや提供漏れに気づいたら厨房・担当者と連携する。自分で調理順を組む力は04-12で評価する。","detail":"","row":40},{"id":"03-06","cat":"SERVICE","sub":"提案","name":"お客様に合う料理・ドリンクを提案する","desc":"好み、人数、量、予算を踏まえ理由を添えて勧める。不確かな情報は確認する。","detail":"","row":41},{"id":"03-07","cat":"SERVICE","sub":"提案","name":"適切なタイミングで追加提案する","desc":"食事の進み具合に合わせて声をかける。断られた後の繰り返しなど押し売りをしない。","detail":"","row":42},{"id":"03-08","cat":"SERVICE","sub":"ファン作り","name":"再来店につながる関係をつくる","desc":"前回の会話や好みを活かす。名前を覚えるだけでなく、心地よい対応を続ける。","detail":"","row":43},{"id":"03-09","cat":"SERVICE","sub":"ファン作り","name":"クレームにつながる兆候に気づき対応する","desc":"待ち時間や注文の行き違いを確認し、説明や責任者への連絡を早めに行う。","detail":"","row":44},{"id":"03-10","cat":"SERVICE","sub":"ファン作り","name":"クレームに誠実かつ適切に対応する","desc":"話を聞き事実確認と必要な謝罪・説明を行う。権限を超える対応は責任者へつなぐ。","detail":"","row":45},{"id":"03-11","cat":"SERVICE","sub":"体験づくり","name":"店舗コンセプトに合う雰囲気をつくる","desc":"会話、声かけ、気配りを店舗に合わせ、他のお客様への影響も考える。","detail":"","row":46},{"id":"03-12","cat":"SERVICE","sub":"体験づくり","name":"利用目的に合わせた工夫をする","desc":"記念日や家族での食事など、確認できた目的に応じ、認められた工夫を行う。","detail":"","row":47},{"id":"04-01","cat":"KITCHEN","sub":"商品・仕込み","name":"商品・メニューの知識を業務に活かす","desc":"担当商品の材料、調理方法、量、特徴に加え、メニュー全体の構成や各商品の役割を把握する。アレルゲンなど不確かな情報は確認する。","detail":"","row":48},{"id":"04-02","cat":"KITCHEN","sub":"商品・仕込み","name":"正しい工程で仕込みを行う","desc":"レシピ・分量・手順を守り完成まで進める。必要に応じ基準を確認する。","detail":"","row":49},{"id":"04-03","cat":"KITCHEN","sub":"商品・仕込み","name":"必要量と完成時刻から仕込みの段取りを組む","desc":"必要量と完成時刻から作業順を決め、同時進行・道具・動線を工夫して待ち時間や手戻りを減らす。作業速度そのものは04-20、調理中の注文順は04-12で確認する。","detail":"","row":50},{"id":"04-04","cat":"KITCHEN","sub":"商品・仕込み","name":"食材を適切に管理する","desc":"入荷状態、期限、保管場所、使用順を確認し、品質に不安があれば使用前に相談する。","detail":"","row":51},{"id":"04-05","cat":"KITCHEN","sub":"在庫・発注","name":"在庫を正確に把握する","desc":"現物を確認し数量と単位をそろえて記録する。欠品や過剰在庫を共有する。","detail":"","row":52},{"id":"04-06","cat":"KITCHEN","sub":"在庫・発注","name":"棚卸を正確に実施する","desc":"決められた時点・方法で数え、漏れや二重計上を防ぐ。推測で記入しない。","detail":"","row":53},{"id":"04-07","cat":"KITCHEN","sub":"在庫・発注","name":"必要量を考えて発注・納品確認する","desc":"在庫、使用予定、納品日、締切を確認する。納品内容を照合し違いを報告する。","detail":"","row":54},{"id":"04-08","cat":"KITCHEN","sub":"原価・ロス","name":"歩留まりと規定分量を守り、食材を活用する","desc":"指定のカット・計量・分量を守り、可食部と廃棄部分を適切に扱う。切り落とし過多や盛りすぎを確認し、品質・安全を保ちながら歩留まりを改善する。","detail":"","row":55},{"id":"04-09","cat":"KITCHEN","sub":"原価・ロス","name":"ロスを把握し、削減に取り組む","desc":"廃棄量と理由を共有し、仕込み量や保管を見直す。安全性を犠牲にしない。","detail":"","row":56},{"id":"04-10","cat":"KITCHEN","sub":"品質・オペレーション","name":"味・食感・温度など調理品質を維持する","desc":"レシピと調理基準に沿い、味・食感・火入れ・温度等を安定させ、提供前に不適合を修正する。盛り付けの仕上げは04-19で確認する。","detail":"","row":57},{"id":"04-11","cat":"KITCHEN","sub":"品質・オペレーション","name":"衛生・温度管理を実行する","desc":"食品・設備を基準に沿って確認・記録し、異常時は定められた手順で対応する。","detail":"","row":58},{"id":"04-12","cat":"KITCHEN","sub":"品質・オペレーション","name":"注文と調理時間を踏まえ、調理の順番を組み立てる","desc":"注文順、商品ごとの調理時間、同時提供、温かい・冷たい商品の状態を考えて着手・仕上げの順番を調整する。単なる速さではなく、提供時に必要な状態をそろえる判断を評価する。","detail":"","row":59},{"id":"04-13","cat":"KITCHEN","sub":"品質・オペレーション","name":"ピーク時の遅れや不足に対応する","desc":"負荷がかかる箇所を把握し、応援や作業順の調整を相談する。","detail":"","row":60},{"id":"04-14","cat":"KITCHEN","sub":"商品・工程改善","name":"既存商品の品質や作業工程を改善する","desc":"味・見た目・残食・提供時間・作業負担などから既存商品の課題を整理し、レシピや工程の改善を提案する。承認を得て試し、品質と負担の変化を確認する。","detail":"","row":61},{"id":"04-15","cat":"KITCHEN","sub":"品質・オペレーション","name":"明確な返事・声出しで、活気と連携をつくる","desc":"確認の要点：明確な返事と声かけで、料理の完成・提供遅れ・欠品などを自ら伝え、連携を保っている。\n例：忙しいときも相手に届く声で共有し、店舗に応じてお出迎え・お見送り・やまびこにも参加している。","detail":"注文や依頼には、相手へ届く声ではっきり返事をする。料理の完成、提供の遅れ、欠品などを自ら伝える。オープンキッチンなどでは、お出迎え・お見送りや「やまびこ」の声かけにも参加する。声量だけでなく、相手に届く・連携につながる・忙しくても続けているかを見る。店舗の雰囲気やお客様の状況に合わせる。","row":62},{"id":"04-16","cat":"KITCHEN","sub":"原価・ロス","name":"商品ごとの原価を理解し、材料と分量を扱う","desc":"担当商品の主要材料とレシピ原価を確認し、分量・材料・仕入価格の変化が商品原価へ与える影響を説明する。指定外の代替材料や分量変更は承認を得る。店舗全体のFood Cost分析は数字管理で扱う。","detail":"","row":63},{"id":"04-17","cat":"KITCHEN","sub":"商品・工程改善","name":"新商品・メニューを提案する","desc":"店舗コンセプトとお客様の要望を踏まえ、新しい商品を提案する。試作時は味、分量、材料、原価、設備、仕込み・提供負担を確認し、承認を得て進める。新商品提案を任されている人のみ対象。","detail":"","row":64},{"id":"04-18","cat":"KITCHEN","sub":"商品・仕込み","name":"販売構成を把握し、仕込みや商品見直しに活かす","desc":"商品別の販売数や残数を確認し、よく出る商品・出ない商品を把握する。品切れや露出の違いも確認し、仕込み量やメニュー見直しに活かす。単なる売上順位の暗記では評価しない。","detail":"","row":65},{"id":"04-19","cat":"KITCHEN","sub":"品質・仕上げ","name":"分量・配置・見た目の基準を守り、丁寧に盛り付ける","desc":"指定の分量・配置・見本に沿って盛り付け、器の汚れ・こぼれ・崩れ・乱れを確認して提供前に整える。味・火入れ等の調理品質は04-10で評価する。","detail":"","row":66},{"id":"04-20","cat":"KITCHEN","sub":"スピード","name":"品質を保ち、仕込み・調理を会社の基準時間内に完了する","desc":"商品・数量・工程・設備条件をそろえ、指定の仕込み・調理を基準時間内に完成する。やり直し時間を含め、品質不合格品は完成量に数えない。作業順・同時進行の工夫は04-03／04-12で確認する。","detail":"","row":67},{"id":"05-01","cat":"MARKETING","sub":"店舗理解","name":"強み・コンセプト・ターゲットを施策に活かす","desc":"誰にどんな価値を提供する店か説明し、その方向に合う施策を考える。価格訴求・投稿・イベントが店舗の信頼やブランド価値を損なわないか確認する。","detail":"","row":68},{"id":"05-02","cat":"MARKETING","sub":"集客・販売施策","name":"売上課題を整理して施策を提案する","desc":"客数、客単価、時間帯など、どこに課題があるか確認してから考える。","detail":"","row":69},{"id":"05-03","cat":"MARKETING","sub":"集客・販売施策","name":"新規来店につながる施策を考える","desc":"地域、客層、利用場面を踏まえ、誰に何をどう届けるか具体化する。","detail":"","row":70},{"id":"05-04","cat":"MARKETING","sub":"集客・販売施策","name":"商品の組み合わせ・メニュー構成を見直し、客単価向上につなげる","desc":"主力商品・価格帯・セット構成・選びやすさを検討し、購入内容と客単価の変化を確認する。ドリンク・トッピング等の追加注文の仕組みは05-13で評価し、同じ施策を同じ観点で重複加点しない。","detail":"","row":71},{"id":"05-05","cat":"MARKETING","sub":"集客・販売施策","name":"お客様に喜ばれる施策を考え、実行し、顧客満足の向上につなげる","desc":"お客様の声・様子・店舗の状況から需要や困り事を捉え、店舗に合う商品・接客・利便性の施策を実行する。反応・意見・顧客満足度の指標を確認し、改善する。テイクアウト実施の有無を一律に求めない。","detail":"","row":72},{"id":"05-06","cat":"MARKETING","sub":"SNS・口コミ","name":"店舗や商品の魅力を自ら発信し、お客様の関心や来店につなげる","desc":"確認の要点：Google Business・SNS等で写真や文章を工夫し、店舗や商品の魅力を継続的に発信している。\n例：閲覧・反応・問い合わせ・確認できた来店とのつながりを振り返り、次の発信へ活かしている。","detail":"Google Business・SNS等で写真・文章・投稿内容を工夫して継続的に発信する。閲覧・反応・問い合わせ・確認できた来店とのつながりを振り返り、次の発信に活かす。旧05-07の写真・文章を統合。","row":73},{"id":"05-08","cat":"MARKETING","sub":"SNS・口コミ","name":"レビューの声を改善につなげる","desc":"繰り返される指摘や評価される点を整理して共有する。返信は会社の運用に従う。","detail":"","row":74},{"id":"05-09","cat":"MARKETING","sub":"企画・ブランド","name":"再来店につながる施策を考え、実行・検証する","desc":"再来店のきっかけや利用し続けやすさを考え、次回来店の案内・継続利用の仕組み等を実行し、確認できる再来店状況を検証する。今回の満足は05-05、紹介・投稿は05-14で分ける。","detail":"","row":75},{"id":"05-10","cat":"MARKETING","sub":"企画・ブランド","name":"お客様向けイベント・キャンペーンを企画・実行する","desc":"確認の要点：お客様に楽しんでいただく目的・対象・内容・費用・担当・日程を決め、店舗と連携して企画を実行している。\n例：店舗に合う催しを提案し、お客様の反応や現場の負担を振り返って次の企画へ活かしている。","detail":"顧客向けの集客・満足につながる企画を評価する。G5は管轄店舗、G6は全社の方向性や横断企画を支援する。社内の交流・楽しむ文化を目的とする06-21とは分ける。同じイベントの効果を05-05/09/12等と同じ観点で重複加点しない。","row":76},{"id":"05-11","cat":"MARKETING","sub":"企画・ブランド","name":"インフルエンサーや地域メディアとの連携で認知・来店につなげる","desc":"店舗の客層や魅力に合う相手を選び、紹介企画を提案・実行する。発信内容・反応・確認できた来店・費用対効果を確認して改善する。正式に担当した範囲で評価する。","detail":"","row":77},{"id":"05-12","cat":"MARKETING","sub":"企画・ブランド","name":"施策を振り返り、次の判断につなげる","desc":"指標を事前に決め、結果と費用を振り返る。継続・変更・終了の理由を説明する。","detail":"","row":78},{"id":"05-13","cat":"MARKETING","sub":"集客・販売施策","name":"追加注文につながる商品提案や販売の仕組みを考え、実行する","desc":"ドリンク・トッピング・デザート・サイド等、店舗に合う追加商品の組み合わせ・見せ方・提案のタイミングを工夫する。注文率・客単価・反応を確認して改善する。個々の接客提案とは分け、店舗の仕組みを評価する。","detail":"","row":79},{"id":"05-14","cat":"MARKETING","sub":"SNS・口コミ","name":"口コミや紹介が生まれるきっかけをつくり、実行する","desc":"人に伝えたくなる商品・接客・店内の工夫や、感想を共有しやすい仕組みを実行する。反応や紹介・投稿の状況を確認して改善する。顧客満足・再来店と同じ成果を重複加点しない。","detail":"","row":80},{"id":"06-01","cat":"MGMT","sub":"方針・実行","name":"目標や方針を具体的な行動にする","desc":"何を、誰が、いつまでに行うか決め、進捗と完了を確認する。","detail":"","row":81},{"id":"06-02","cat":"MGMT","sub":"方針・実行","name":"目的を伝え、スタッフの協力を得る","desc":"背景と狙いを説明し、現場の意見を聞き、役割を明確にして進める。","detail":"","row":82},{"id":"06-03","cat":"MGMT","sub":"方針・実行","name":"相手に伝わる指示を出し、理解と実行を確認する","desc":"内容・優先順位・期限・求める状態を、相手の言語・理解度に合わせて説明・実演等で伝え、相手の理解と実行を確認する。02-10の報連相とは、部門・チームへの具体的な指示という観点で分ける。","detail":"","row":83},{"id":"06-04","cat":"MGMT","sub":"方針・実行","name":"優先順位を判断し、チームの動きを調整する","desc":"安全、品質、お客様対応、人員状況を踏まえ、人と作業を調整する。","detail":"","row":84},{"id":"06-05","cat":"MGMT","sub":"問題解決","name":"問題を発見し、解決まで進める","desc":"繰り返すミスや滞りを把握し、原因、対応者、期限を決める。指摘だけで終わらせない。","detail":"","row":85},{"id":"06-06","cat":"MGMT","sub":"問題解決","name":"現場の意見を聞き、改善に反映する","desc":"当事者から状況を確認して実行可能な方法を考える。不採用の提案にも理由を伝える。","detail":"","row":86},{"id":"06-07","cat":"MGMT","sub":"人員・配置","name":"週ごとの売上・繁閑を予測し、必要な人員とスキルをそろえたシフトを作成する","desc":"過去売上・曜日傾向・予約・イベント等から翌週の日別・時間帯別の売上と忙しさを予測する。必要労働時間とスキルを見積もり、人件費とのバランスを踏まえて編成する。G3は委任された部門の予測・作成範囲。","detail":"","row":87},{"id":"06-08","cat":"MGMT","sub":"人員・配置","name":"実際の営業状況に応じ、品質と人件費を踏まえて人員を調整する","desc":"実際の繁閑・提供時間・負担・休憩・品質を見て、応援・勤務時間・人員体制を権限内で調整する。06-07の事前編成、06-09の持ち場配置とは分ける。","detail":"","row":88},{"id":"06-09","cat":"MGMT","sub":"人員・配置","name":"ピーク時の担当ポジション・作業分担を調整し、滞りを解消する","desc":"その場にいるスタッフの技能と負荷を見て、誰をどの持ち場・作業へ回すか判断する。人数や勤務時間の調整は06-08で評価する。","detail":"","row":89},{"id":"06-10","cat":"MGMT","sub":"MTG・情報共有","name":"店舗MTGを行動につながる場にする","desc":"課題、意見、決定事項、担当、期限を整理し、欠席者にも共有する。","detail":"","row":90},{"id":"06-11","cat":"MGMT","sub":"MTG・情報共有","name":"相談や意見を出しやすいチームをつくる","desc":"報告を受けたら状況を確認する。発言が少ない人にも意見を伝える機会をつくる。","detail":"","row":91},{"id":"06-12","cat":"MGMT","sub":"MTG・情報共有","name":"上長への報告とスタッフへの伝達を行う","desc":"判断が必要な事項を適時に上げ、会社方針を現場の行動に結びつけて説明する。","detail":"","row":92},{"id":"06-13","cat":"MGMT","sub":"判断・定着","name":"トラブル時に必要な対応を指揮する","desc":"安全と影響を確認し、権限内で判断する。権限外は上長へつなぐ。","detail":"","row":93},{"id":"06-14","cat":"MGMT","sub":"判断・定着","name":"改善を継続・仕組み化する","desc":"手順、担当、確認方法を決め、担当者が変わっても続く状態にする。","detail":"","row":94},{"id":"06-15","cat":"MGMT","sub":"判断・定着","name":"有効な改善を他店舗へ展開する","desc":"実施条件と結果を整理し、他店での適用条件を確認して共有する。","detail":"","row":95},{"id":"07-01","cat":"NUMBERS","sub":"売上・予実","name":"売上予算と前提を理解する","desc":"金額だけでなく営業日数、客数、客単価など予算の成り立ちを説明する。","detail":"","row":96},{"id":"07-02","cat":"NUMBERS","sub":"売上・予実","name":"日次の売上と営業状況を確認する","desc":"売上、客数、客単価を確認し、欠品、予約、営業時間などと照合する。","detail":"","row":97},{"id":"07-03","cat":"NUMBERS","sub":"売上・予実","name":"予算と実績の差を把握する","desc":"差額・達成率を確認し、差につながった要素を整理する。不明な原因は断定しない。","detail":"","row":98},{"id":"07-04","cat":"NUMBERS","sub":"売上・予実","name":"客数・客単価・来店動機を読み取る","desc":"客数と客単価を分け、来店動機は確認できた情報に基づき整理する。","detail":"","row":99},{"id":"07-05","cat":"NUMBERS","sub":"FL・コスト管理","name":"Food Costと変動要因を理解する","desc":"会社の計算方法を使い、仕入価格、棚卸、ロス、販売構成の影響を確認する。","detail":"","row":100},{"id":"07-06","cat":"NUMBERS","sub":"FL・コスト管理","name":"Labor %と変動要因を理解する","desc":"売上と人件費を確認し、売上減と労働時間増による比率上昇を区別する。","detail":"","row":101},{"id":"07-07","cat":"NUMBERS","sub":"販売機会・改善","name":"欠品・提供遅れ等の販売機会損失を把握し、改善する","desc":"確認の要点：欠品・注文取消・提供遅れ・受注停止の件数・時間・原因を記録し、販売機会の損失を減らしている。\n例：発生傾向から仕込み量・発注・提供体制を改善し、対策後の変化を確認している。","detail":"欠品、注文取消、提供遅れ、受注停止等について、確認できた件数・発生時間・原因を記録し、仕込み量・発注・提供体制等の改善につなげる。日次の売上確認とは分けて、発生傾向と対策効果を確認する。売れたはずの金額を推測で確定しない。G4以上の担当範囲で評価し、G2・G3の店舗全体の数字責任には追加しない。","row":102},{"id":"07-08","cat":"NUMBERS","sub":"分析・改善","name":"条件をそろえて数値を比較する","desc":"前年・前月・前週の曜日、営業日数、休業、イベントの違いを確認する。","detail":"","row":103},{"id":"07-09","cat":"NUMBERS","sub":"分析・改善","name":"異常値や集計の誤りに気づく","desc":"大きな増減があれば入力・集計・計上時期を確認してから原因を調べる。","detail":"","row":104},{"id":"07-10","cat":"NUMBERS","sub":"分析・改善","name":"数字から改善案を出す","desc":"どの数値をどの行動で改善するか説明し、費用、品質、スタッフへの影響も確認する。","detail":"","row":105},{"id":"07-11","cat":"NUMBERS","sub":"分析・改善","name":"改善の結果を検証する","desc":"実施前後と他の変化を踏まえて判断し、売上増だけで成功と決めない。","detail":"","row":106},{"id":"07-12","cat":"NUMBERS","sub":"分析・改善","name":"売上・Food Cost・Laborの関係を理解する","desc":"確認の要点：売上・Food Cost・Laborの金額と比率を確認し、変動の理由や相互の関係を説明している。\n例：売上・仕入・ロス・労働時間が食材原価と人件費に与える影響を、FL合計だけでなく分けて捉えている。","detail":"G4では売上、食材原価（Food Cost）、人件費（Labor）の金額と比率を確認し、売上変動や仕入・ロス・労働時間がF・Lそれぞれに与える影響を説明する。FL合計だけで判断しない。利益管理・利益目標の達成はG4の評価対象に含めない。","row":107},{"id":"08-01","cat":"DEVELOP","sub":"教え方","name":"業務とルールを順序立てて教える","desc":"理由と完成基準を説明し、見本、一緒に実施、本人の実施、確認と進める。理念やルールの意味も説明する。","detail":"","row":108},{"id":"08-02","cat":"DEVELOP","sub":"教え方","name":"相手の習熟度に合わせて指導する","desc":"習熟度を確認して説明量、練習方法、任せる範囲を調整する。伝わらなければ教え方を変える。","detail":"","row":109},{"id":"08-03","cat":"DEVELOP","sub":"教え方","name":"良い行動や成長を具体的に認める","desc":"何がどう良かったか伝え、本人が次も再現できるようにする。","detail":"","row":110},{"id":"08-04","cat":"DEVELOP","sub":"教え方","name":"改善点を伝え、習得まで支援する","desc":"事実、基準、次の行動を伝えて再確認する。人格否定や威圧的な指導をしない。","detail":"","row":111},{"id":"08-05","cat":"DEVELOP","sub":"見極め・目標設定","name":"強みと課題を具体的に捉える","desc":"印象ではなく実際の仕事から説明し、本人の認識も確認する。","detail":"","row":112},{"id":"08-06","cat":"DEVELOP","sub":"見極め・目標設定","name":"スキルを基準に沿って判断する","desc":"スキルマトリクスや実演で確認する。好き嫌いや勤続年数だけで判断しない。","detail":"","row":113},{"id":"08-07","cat":"DEVELOP","sub":"見極め・目標設定","name":"習熟度と希望を踏まえ、仕事を任せる機会をつくり、自立を支える","desc":"確認の要点：習熟度と希望を踏まえ、教える・任せる・実行を確認する段階を通じ、担当できる仕事を広げている。\n例：発注の手順を教えて本人に任せ、内容と実行を確認し、自立できるよう支えている。","detail":"G2・G3にも発注等の実務機会を設ける。習得する仕事・到達状態・確認時期を本人と共有し、習熟度・希望・現場の安全や品質を踏まえて任せる。担当を広げた後も実行を確認し、必要な助言と振り返りで自立を支える。任せた件数だけで評価せず、抱え込みを減らし実務機会と自立をつくれているかを見る。G3の日常指導にも適用し、G4以上のリーダー・後継者育成は08-11で評価する。","row":114},{"id":"08-08","cat":"DEVELOP","sub":"見極め・目標設定","name":"Tip Rate申請を根拠に基づいて判断する","desc":"会社基準に沿って習熟状況を確認し、申請理由を説明する。権限のある人のみ対象。","detail":"","row":115},{"id":"08-09","cat":"DEVELOP","sub":"育成・定着","name":"意欲や困り事を確認し、支援する","desc":"負担、目標、困り事を聞き、必要な対応を考える。気持ちを決めつけない。","detail":"","row":116},{"id":"08-10","cat":"DEVELOP","sub":"育成・定着","name":"定着を妨げる問題を把握し、対応につなげる","desc":"発言や勤務状況の変化をきっかけに話を聞き、必要なら上長と連携する。退職の有無だけで採点しない。","detail":"","row":117},{"id":"08-11","cat":"DEVELOP","sub":"育成・定着","name":"次のリーダー候補に成長機会をつくる（G4以上）","desc":"確認の要点：リーダー・後継者候補に段階的に役割を任せ、振り返りと支援を通じて自立を促している。\n例：判断・実行・他者への指導を任せ、習得状況と担当できる範囲の広がりを確認している。","detail":"G4以上を対象とし、リーダー・後継者候補へ段階的に役割を任せ、振り返りと支援を行う。人数だけでなく、判断・実行・他者への指導を自立して行える範囲の広がりを見る。G1〜G3では本項目を必須にせず、担当機会がない場合は上司が「該当しない」を選択する。G3の日常の業務指導・習得確認は08-01〜07等で評価する。 G4は次のリーダー、G5は店長、G6はAM等の管轄責任者・後継者に判断・実行・教育を段階的に任せ、自立と定着を確認する。本人が抱え込み続けるのではなく、必要な権限・支援・振り返りを整える。","row":118},{"id":"06-16","cat":"MGMT","sub":"現場把握・予防","name":"現場を訪れ、小さな違和感や問題の兆候を捉える（G5・G6中心）","desc":"確認の要点：現場で営業・QSC・人の動きを見て、スタッフの話と照合し、小さな変化や違和感を早めに確かめている。\n例：訪問時に提供の遅れや会話の減少に気づき、店長と状況を確認して対応につなげている。","detail":"G5は管轄店舗、G6は会社全体のリスクに応じた現場把握を担う。平常時も現場接点を継続し、繁忙帯を含む観察・対話・記録から兆候を確認する。訪問回数や滞在時間だけで評価せず、何に気づき、何を確かめ、誰へつないだかを見る。聞いた話や印象だけで人を断定しない。数字の兆候は07-15、個別の支援計画は06-17、横断支援の調整は06-19で評価し、同じ事実を同じ観点で重複加点しない。","row":119},{"id":"06-17","cat":"MGMT","sub":"店舗支援・信頼","name":"店舗の責任者・スタッフの声を聞き、課題の解決まで継続して支える（G5・G6中心）","desc":"確認の要点：店舗の責任者・スタッフの負担や困り事を聞き、必要な支援と次の行動を一緒に決め、対応後も確認している。\n例：店長不在の店舗でも、現場の相談相手と連絡体制を明確にし、必要な支援を手配して解消したか確かめている。","detail":"G5は管轄店舗、G6はAM等の管轄責任者を通じた全社の支援体制と、必要に応じた店舗支援を担う。店長の在籍を前提にせず、責任者・リーダー・スタッフとの定期的な対話や相談機会を持つ。店長不在店では連絡窓口・判断する人・支援担当を明確にし、現場の負担や問題を放置しない。相手の話を聞き、事実・困り事・会社側の課題を分けて捉える。支援内容・担当・期限を決め、回答や約束を守り、解決まで確認して信頼を築く。何でも引き受けることや好かれることを評価せず、必要な指摘も敬意を持って伝える。相談件数の少なさだけで良好と判断しない。理念01-07/08/09の姿勢とは、支援の継続・完了という観点で分ける。","row":120},{"id":"06-18","cat":"MGMT","sub":"協力体制・合意","name":"店舗の責任者・スタッフが納得して協力できる方針・役割・連携体制をつくる（G5・G6中心）","desc":"確認の要点：目的・判断理由・役割・必要な支援を伝え、店舗の責任者・スタッフの意見や現場事情を踏まえて協力体制を整えている。\n例：新しい取組を現場と相談し、担当と期限を合意して実行を確認し、難しい点は調整している。","detail":"G5は管轄店舗間、G6はAM・店舗の責任者・スタッフ・Office等を含む全社の協力体制を担う。店長不在店も含め、会社方針の背景・守る基準・担当・判断する人・期限を明確にし、必要な権限・情報・支援をそろえる。異論や懸念を聞き、採用しない意見にも理由を伝える。威圧・一方的な押付けや表面的な賛成を協力の証拠にしない。合意後に各人が必要な行動を実行できているか確認する。単店舗スタッフへの説明06-02と同じ観点で重複加点しない。","row":121},{"id":"06-19","cat":"MGMT","sub":"店舗横断支援","name":"支援が必要な店舗へ、人員・教育・運営の支援を調整する（G5・G6中心）","desc":"確認の要点：課題の深刻さと現場の負担から支援の優先順位を決め、他店への影響も確認して必要な応援・教育・運営支援を届けている。\n例：不足する技能や人員を店長と確認し、応援元の体制も守って支援を組み、終了後の自立状況を確かめている。","detail":"G5は管轄内、G6は全社の資源配分を調整する。数字や現場観察から見つけた課題について、支援目的・担当・期限・見直し時期を決めて実行する。実際の配分と支援効果を確認し、同じ店舗への恒常的なしわ寄せや受け手の依存を防ぐ。赤字や目標未達の店舗だけに限らず、品質・人員・負担の悪化を未然に防ぐ支援も評価する。単店の人員調整06-08、数字による早期発見07-15、個別対話06-17とは観点を分ける。","row":122},{"id":"06-20","cat":"MGMT","sub":"部門連携・解決","name":"Office・Chef等と連携し、店舗だけで解決できない課題を完結させる（G5・G6中心）","desc":"確認の要点：店舗・Office・Chef等の間で事実と課題を共有し、担当・判断者・期限を明確にして解決まで進めている。\n例：設備や仕入れ、手続きの課題を適切な相手へつなぎ、引き渡し後も現場で解消したか確認している。","detail":"G5は管轄店に必要な連携、G6は全社の部門間連携と繰り返す課題の解消を担う。自分の権限外を抱え込まず、権限内の調整と上申を適時に行う。連絡しただけで完了とせず、実行・現場での解決・必要な引き継ぎを確認する。専門領域の作業そのものは各担当の評価とし、管理者は連携・完結を評価する。06-19の人員等の店舗横断配分とは分ける。","row":123},{"id":"06-21","cat":"MGMT","sub":"楽しむ文化・交流","name":"仲間が楽しみ、店舗間のつながりが生まれる企画を提案・実行する（G5・G6中心）","desc":"確認の要点：仲間の声や店舗事情を踏まえ、楽しさ・交流・学びにつながる企画を提案し、無理なく参加できる運営と振り返りを行っている。\n例：店舗を越えた交流や称賛の場をつくり、参加者の声から次の企画や日常の連携へ活かしている。","detail":"G5は管轄の交流・学び、G6は全社の楽しむ文化の継続と店舗を越えるつながりを担う。目的・対象・費用・負担・担当を整理し、関係者と相談して企画・実行・振り返りを行う。イベントの派手さ・開催回数・参加人数だけで評価せず、日常の声かけ・称賛・協力にどうつながったかを見る。参加しない人を意欲不足と決めつけない。顧客向け集客企画05-10や理念上の姿勢01-01/02とは観点を分ける。","row":124},{"id":"07-13","cat":"NUMBERS","sub":"管轄・全社の計画","name":"管轄・全社の売上・FLの計画と見通しを立て、見直す（G5・G6中心）","desc":"確認の要点：会社の目標と店舗条件から売上・食材原価・人件費の計画を立て、実績や環境変化から見通しと対応を見直している。\n例：営業日数・客数・採用や価格の変化を店長と確認し、達成に必要な行動や支援を具体化している。","detail":"G5は管轄店舗の計画、G6は会社全体の計画・店舗間の整合・経営への提案を担う。会社が定めたKGI・予算の前提を使い、店長と営業条件・人員・原価の根拠を確認する。一律の削減や根拠のない目標を押し付けない。必要に応じ会社が定める利益目標も担当権限の範囲で扱う。G4には既存07-12の範囲を維持し、この全社計画を自動で必須にしない。実績の分析は07-14/15、現場支援の実行は06-17/19で分ける。","row":125},{"id":"07-14","cat":"NUMBERS","sub":"管轄・全社のFL分析","name":"管轄・全社のFLを店別に分析し、改善課題と優先順位を示す（G5・G6中心）","desc":"確認の要点：管轄・全社と店別のFood Cost・Laborを金額と比率で確認し、売上・単価・使用量・労働時間等に分けて課題を説明している。\n例：全体のFLが良くても悪化店舗を見落とさず、原因と優先課題を店長・関係者と共有している。","detail":"G5は管轄合計と店別、G6は会社全体・管轄別・店別を分析する。会社の集計定義と対象期間をそろえ、合計比率は原価額または人件費の合計÷同じ範囲の売上合計で求める。各店の比率を単純平均しない。仕入価格・営業条件・売上変動等の本人が動かしにくい要因も分け、品質・サービス・衛生・現場負担を犠牲にした削減を求めない。単店舗の理解07-05/06/12とは分析範囲を分ける。改善策の実行・検証は07-10/11、支援配分は06-19で評価する。","row":126},{"id":"07-15","cat":"NUMBERS","sub":"KGI・KPIの予兆管理","name":"KGI・KPIから問題の兆候を捉え、支援すべき店舗を見つける（G5・G6中心）","desc":"確認の要点：会社が定めた最終目標と途中の指標を継続して確認し、未達の結果だけでなく悪化の兆候から支援が必要な店舗を見つけている。\n例：売上・FL・お客様の声などの変化を現場で確かめ、店長と課題・対応期限を決めて改善状況を追っている。","detail":"KGI＝会社が定める最終目標、KPI＝進み具合を確認する指標。G5は管轄、G6は全社を対象とする。定例確認に加え、異常や急な悪化が見られる場合は早めに確認する。水準・推移・予算との差・営業条件を踏まえ、全体平均に隠れた店舗の課題も捉える。指標の種類・定義・確認頻度は会社の設定に従い、無関係な指標を一律に増やさない。指標悪化を本人の責任と断定せず現場で原因を確認し、支援の優先順位と改善状況を記録する。FLの要因分析は07-14、支援行動そのものは06-17/19として同じ事実を同じ観点で重複加点しない。","row":127},{"id":"08-12","cat":"DEVELOP","sub":"店長評価・育成の公平性","name":"店長・管理者の評価根拠を確認し、評価と育成のばらつきを整える（G5・G6中心）","desc":"確認の要点：店長・管理者の評価を実績と基準に照らして確認し、評価者や店舗による甘辛・実務機会の違いを整理している。\n例：非該当の理由や指導内容を確認し、具体的な根拠と次の成長目標をそろえて本人へ説明できるよう支えている。","detail":"G5は担当店長の評価・育成支援、G6はAM等の評価と全社の評価基準の運用を担う。点数を一律にそろえるのではなく、事実・期待水準・担当機会から判断理由の整合を確認する。上司が仕事を任せていないことを本人の低評価にしない。具体的な実務機会と支援を整え、評価後の進捗も確認する。人材の技能見極め08-06、後継者へ役割を任せる08-11とは、評価制度運用の公平性という観点で分ける。","row":128}],"weights":{"G1":{"Kitchen中心":{"weights":{"PHILO":20,"BASIC":30,"SERVICE":15,"KITCHEN":25,"MARKETING":0,"MGMT":0,"NUMBERS":5,"DEVELOP":5},"row":24},"Server中心":{"weights":{"PHILO":20,"BASIC":30,"SERVICE":25,"KITCHEN":15,"MARKETING":0,"MGMT":0,"NUMBERS":5,"DEVELOP":5},"row":25},"両部門育成":{"weights":{"PHILO":20,"BASIC":30,"SERVICE":20,"KITCHEN":20,"MARKETING":0,"MGMT":0,"NUMBERS":5,"DEVELOP":5},"row":26}},"G2":{"Kitchen中心":{"weights":{"PHILO":20,"BASIC":25,"SERVICE":15,"KITCHEN":25,"MARKETING":0,"MGMT":5,"NUMBERS":5,"DEVELOP":5},"row":27},"Server中心":{"weights":{"PHILO":20,"BASIC":25,"SERVICE":25,"KITCHEN":15,"MARKETING":0,"MGMT":5,"NUMBERS":5,"DEVELOP":5},"row":28},"両部門育成":{"weights":{"PHILO":20,"BASIC":25,"SERVICE":20,"KITCHEN":20,"MARKETING":0,"MGMT":5,"NUMBERS":5,"DEVELOP":5},"row":29}},"G3":{"Kitchen中心":{"weights":{"PHILO":20,"BASIC":10,"SERVICE":10,"KITCHEN":30,"MARKETING":5,"MGMT":10,"NUMBERS":5,"DEVELOP":10},"row":30},"Server中心":{"weights":{"PHILO":20,"BASIC":10,"SERVICE":30,"KITCHEN":10,"MARKETING":5,"MGMT":10,"NUMBERS":5,"DEVELOP":10},"row":31},"両部門育成":{"weights":{"PHILO":20,"BASIC":10,"SERVICE":20,"KITCHEN":20,"MARKETING":5,"MGMT":10,"NUMBERS":5,"DEVELOP":10},"row":32}},"G4":{"店長":{"weights":{"PHILO":20,"BASIC":10,"SERVICE":15,"KITCHEN":15,"MARKETING":5,"MGMT":15,"NUMBERS":10,"DEVELOP":10},"row":33}},"G5":{"管轄責任":{"weights":{"PHILO":20,"BASIC":10,"SERVICE":5,"KITCHEN":5,"MARKETING":10,"MGMT":20,"NUMBERS":15,"DEVELOP":15},"row":34}},"G6":{"全社責任":{"weights":{"PHILO":20,"BASIC":10,"SERVICE":5,"KITCHEN":5,"MARKETING":10,"MGMT":20,"NUMBERS":15,"DEVELOP":15},"row":35}}},"mainMap":{"Kitchen中心":{"main":["KITCHEN"],"other":["SERVICE"]},"Server中心":{"main":["SERVICE"],"other":["KITCHEN"]},"両部門育成":{"main":["SERVICE","KITCHEN"],"each":true},"店長":{"main":["SERVICE","KITCHEN"],"each":true},"管轄責任":{"main":["SERVICE","KITCHEN"],"each":true},"全社責任":{"main":["SERVICE","KITCHEN"],"each":true}},"mainMapNote":"主担当で分けるのは G1〜G3 の Kitchen中心・Server中心だけ。両部門育成と G4 以上（店長・管轄責任・全社責任）はサービスとキッチンの両方が主担当で、それぞれの平均を G主担当の基準で見る（G他部門は使わない）。ほかの型は決まっていないので判定を保留"},"S_CHEF":{"name":"S Chef","unassigned":false,"categories":[{"key":"PHILO","name":"理念","short":"理念"},{"key":"TECH","name":"技術・専門実務","short":"技術実務"},{"key":"HYGIENE","name":"衛生・安全","short":"衛生安全"},{"key":"QUALITY","name":"品質・管理","short":"品質管理"},{"key":"PRODUCT","name":"商品開発","short":"商品開発"},{"key":"COST_DESIGN","name":"原価設計","short":"原価設計"},{"key":"COST_IMPROVE","name":"原価改善","short":"原価改善"},{"key":"EFFICIENCY","name":"効率・改善","short":"効率改善"},{"key":"TEACH","name":"技術共有・育成","short":"指導・育成"}],"items":[{"id":"01-01","field":"理念：楽しむ","name":"自ら仕事を楽しむ工夫をし、前向きに取り組む","desc":"確認の要点：仕事の意味や楽しさを見つけ、自分から工夫・協力し、困難な場面も必要な支援を求めて取り組んでいる。\n例：忙しい日も作業の工夫を提案し、仲間と協力して前向きに進めている。","detail":"受け身で待つだけでなく、仕事の意味や楽しさを見つけ、工夫や協力を自分から行う。困難な場面でも必要な支援を求めて取り組む。性格の明るさだけでは判断しない。","row":7,"cat":"PHILO","cls":"ENJOY"},{"id":"01-02","field":"理念：楽しむ","name":"仲間の良い行動や成長を認め、称賛する","desc":"確認の要点：仲間の良い行動・工夫・成長を具体的に認め、役職や親しさに偏らず称賛している。\n例：仲間の確認や工夫で仕事が進んだとき、何が良かったかを言葉で伝えている。","detail":"仲間の良い行動・工夫・成長を具体的な言葉で認め、小さな成功や達成感を共有する。役職や親しさによって称賛する相手を偏らせない。","row":8,"cat":"PHILO","cls":"ENJOY"},{"id":"01-03","field":"理念：楽しむ","name":"お客様に関心を持ち、喜んでいただける行動をする","desc":"確認の要点：お客様の反応や希望に関心を持ち、相手の状況に配慮して喜ばれる工夫を自ら行っている。\n例：店舗に届いたお客様の要望を確認し、自分の担当業務で役立つ対応を行っている。","detail":"お客様の反応や希望に関心を持ち、楽しんでいただける工夫を自ら行う。会話を望まない方にも配慮する。ここでは相手を大切にする姿勢を見て、接客手順の技術はサービスで扱う。","row":9,"cat":"PHILO","cls":"ENJOY"},{"id":"01-16","field":"理念：楽しむ","name":"不機嫌を周囲にぶつけず、落ち着いて接する","desc":"確認の要点：忙しくても無視・威圧・物への八つ当たりをせず、必要な返事と連携を続け、難しいときは相談している。\n例：感情を仲間にぶつけず支援を求めている。異論・相談・体調の申告は不機嫌として扱わない。","detail":"忙しさや私的な感情を理由に、呼びかけを意図的に無視する、きつく当たる、物を乱暴に扱うなどの行動をしない。必要な返事・連携を続け、難しいときは相談する。気分や表情だけで決めつけず、実際の言動を見る。異論・相談・体調の申告は不機嫌として扱わない。","row":10,"cat":"PHILO","cls":"ENJOY"},{"id":"01-04","field":"理念：感謝","name":"お客様の来店を当たり前にしない","desc":"確認の要点：来店への感謝を忘れず、忙しいときや常連のお客様にも丁寧な対応を続けている。\n例：来店・退店時に感謝を伝え、お客様からの要望や店舗からの問い合わせにも丁寧に応じている。","detail":"来店時・退店時に感謝を伝える。忙しいときや常連のお客様にも丁寧な対応を続ける。","row":11,"cat":"PHILO","cls":"THANK"},{"id":"01-05","field":"理念：感謝","name":"仲間の協力に感謝を伝える","desc":"確認の要点：手伝いや引き継ぎを当たり前にせず、仲間の協力に具体的な言葉で感謝を伝えている。\n例：急な依頼を手伝ってくれた仲間へ、何をしてくれて助かったかを伝えている。","detail":"手伝いや引き継ぎに対し、何をしてくれて助かったかを言葉にする。","row":12,"cat":"PHILO","cls":"THANK"},{"id":"01-06","field":"理念：感謝","name":"周囲の支えに気づき、大切に行動する","desc":"確認の要点：仕込み・清掃・納品を担う人や地域・取引先を尊重し、準備されたものや共有物を丁寧に扱っている。\n例：周囲の協力を当たり前にせず感謝を伝え、食材・資料・設備を大切に扱っている。","detail":"仕込み・清掃・納品などを担う人や地域・取引先にも敬意を持って接する。準備してもらったものや共有設備を丁寧に扱い、周囲の協力を当たり前にしない。","row":13,"cat":"PHILO","cls":"THANK"},{"id":"01-07","field":"理念：思いやる","name":"仲間の状況を見て助け合う","desc":"確認の要点：自分の持ち場だけでなく仲間の状況を見て、困っている人に声をかけ、必要な支援をしている。\n例：締切や作業が重なった仲間へ状況を確認し、自分が対応できる仕事を手伝っている。","detail":"自分の持ち場だけでなく、困っている仲間に声をかけ、必要な支援をする。","row":14,"cat":"PHILO","cls":"CARE"},{"id":"01-08","field":"理念：思いやる","name":"仲間に関心を持ち、相手の立場を確認して行動する","desc":"確認の要点：決めつけずに話を聞き、相手の経験・言語・状況に合わせて伝え方や対応を調整している。\n例：説明が伝わらない場合は図や実演を使い、仲間の困り事や変化にも声をかけている。","detail":"決めつけず話を聞き、経験・言語・状況の違いを踏まえて伝え方や対応を調整する。仲間の困り事や変化に気づき、必要な声かけをする。","row":15,"cat":"PHILO","cls":"CARE"},{"id":"01-09","field":"理念：思いやる","name":"相手を尊重した言動をする","desc":"確認の要点：役職や相手によって敬意を変えず、威圧的な言い方や人を傷つける言動を避けている。\n例：意見が違う場合も話を聞き、人前で責めず、事実と改善点を落ち着いて伝えている。","detail":"役職や相手によって敬意を変えない。威圧的な言い方や、人を傷つける言動を避ける。","row":16,"cat":"PHILO","cls":"CARE"},{"id":"01-10","field":"理念：成長","name":"素直に学び、改善に活かす","desc":"確認の要点：分からないことを質問し、フィードバックを受け止めて改善を続けている。\n例：指摘された作業を見直して実行し、その後も同じ抜けがないか確認している。","detail":"分からないことを質問し、フィードバックを行動に反映する。意見や疑問を述べること自体を低評価にしない。","row":17,"cat":"PHILO","cls":"GROW"},{"id":"01-11","field":"理念：成長","name":"苦手なことや新しいことに挑戦する","desc":"確認の要点：自分の課題を把握し、必要な支援を求めながら未経験の仕事や苦手な業務に挑戦している。\n例：練習や確認の機会を相談し、実際に取り組んで自立してできる範囲を広げている。","detail":"課題を把握し、必要な支援を求めながら未経験の仕事や苦手な業務に取り組む。","row":18,"cat":"PHILO","cls":"GROW"},{"id":"01-12","field":"理念：成長","name":"自分が改善できる行動を考え、実践する","desc":"確認の要点：人のせいにして終わらず、自分の判断・準備・伝え方も振り返り、次の行動を変えて確認している。\n例：連携が遅れた原因を確かめ、自分の準備や伝え方を改善し、会社側の課題も事実として報告している。","detail":"人のせいにして終わらず、自分の判断・準備・伝え方を振り返って次の行動を変え、その後も確認する。設備・制度・人員など会社側の課題も事実として報告する。すべてを本人の責任にしない。","row":19,"cat":"PHILO","cls":"GROW"},{"id":"01-13","field":"理念：誠実","name":"嘘やごまかしをせず、事実を伝える","desc":"確認の要点：嘘やごまかしをせず、実施状況や分からないことを事実どおりに伝えている。\n例：未完了の仕事を完了と報告せず、不明な数字や状況は確認してから伝えている。","detail":"未実施の作業を完了扱いにしない。不明なことを分かったふりで答えず確認する。","row":20,"cat":"PHILO","cls":"SINCERE"},{"id":"01-14","field":"理念：誠実","name":"ミスや問題を隠さず、早めに相談する","desc":"確認の要点：自分に不利なミスや問題も隠さず報告し、難しい対応や遅れを放置せず早めに相談している。\n例：気づいた時点で影響する相手へ事実・対応案・必要な支援を伝えている。","detail":"自分に不利な内容でも報告する。対応が難しい場合や遅れそうな場合も放置せず相談する。","row":21,"cat":"PHILO","cls":"SINCERE"},{"id":"01-15","field":"理念：誠実","name":"仕事に誇りと責任を持ち、約束やルールを守る","desc":"確認の要点：仕事の種類で丁寧さを変えず、任された仕事を責任を持って完了・引き継ぎまで行っている。\n例：約束や期限を守り、難しい場合は期限前に相談して対応と引き継ぎを済ませている。","detail":"どんな仕事にも真摯に向き合い、任された仕事をやり切る。難しい場合は事情を伝え、対応や引き継ぎまで行う。役割や仕事の種類で丁寧さを変えない。","row":22,"cat":"PHILO","cls":"SINCERE"},{"id":"CF-01","field":"技術・専門実務","name":"食材の状態を見極め、適切に加工する","desc":"確認の要点：食材の鮮度・特性・用途を確認し、適切に下処理・カットしている。\n例：加工後の仕上がりと歩留まりを確認し、食材の状態に応じて扱い方を調整している。","detail":"食材の特性・鮮度・用途を確認して必要な下処理・カットを行う。","row":23,"cat":"TECH"},{"id":"CF-02","field":"技術・専門実務","name":"必要な調理技術を正しく実行する","desc":"確認の要点：担当商品に必要な火入れ・揚げ・焼きなどを、店舗の基準に沿って実行している。\n例：同じ商品を繰り返し調理しても、指定の仕上がりを安定して再現している。","detail":"担当商品に必要な火入れ・揚げ・焼き・生食等の技術を店舗基準で実行する。","row":24,"cat":"TECH"},{"id":"CF-03","field":"技術・専門実務","name":"味・食感・温度を安定して仕上げる","desc":"確認の要点：味・食感・温度を確認し、基準どおりの仕上がりを安定して保っている。\n例：提供前に味見や温度確認を行い、ずれがあれば修正・相談して再確認している。","detail":"同条件で必要な仕上がりを繰り返し再現し、不適合を修正・相談する。","row":25,"cat":"TECH"},{"id":"CF-04","field":"技術・専門実務","name":"品質を保ち、基準時間内に仕込み・調理を完成する","desc":"確認の要点：商品・数量・設備条件をそろえ、手直しを含む時間で品質と基準時間を満たしている。\n例：同条件で完成時間と良品の量を確認し、不合格品を完成量に含めず判定している。","detail":"商品・量・設備・応援条件をそろえ、会社の基準時間と良品完成量を確認する。手直し時間を含め、品質不合格品は完成量に数えない。","row":26,"cat":"TECH"},{"id":"CF-05","field":"衛生・安全","name":"日常の衛生状態を保ち、検査の不備を予防・改善する","desc":"確認の要点：厨房・設備・器具の清掃と現物確認を続け、衛生上の不備を予防・改善している。\n例：検査の有無にかかわらず日常点検を行い、不備や指摘があれば直し、その後の維持も確認している。","detail":"厨房・設備・器具・床の清掃と現物確認を続け、衛生上の不備を事前に発見・改善する。検査がない期間も日常点検・維持状況で確認する。衛生局等の指摘を受けた場合は、担当範囲の是正・再点検・再発防止を確認する。検査結果だけで本人の担当外の問題を一律採点しない。","row":27,"cat":"HYGIENE"},{"id":"CF-06","field":"衛生・安全","name":"温度・保管・手洗いを正しく実行する","desc":"確認の要点：手洗い・冷却・温度・保管期限・交差汚染防止の基準を守り、必要な記録を残している。\n例：器具の切替えと保管温度を確認し、基準外なら食材の使用可否を相談して対応・再確認している。","detail":"温度・保管期限・冷却・交差汚染防止・手洗いを日常作業で実行・記録する。清掃・検査の是正体制CF-05、資格と配置CF-11とは区別する。","row":28,"cat":"HYGIENE"},{"id":"CF-07","field":"衛生・安全","name":"アレルギー・異物混入を予防する","desc":"確認の要点：材料・アレルギー情報・器具を確認し、ホールと連携して混入を防いでいる。\n例：不明な材料は提供前に確認し、混入の疑いがあれば提供を止めて報告している。","detail":"確認・器具管理・情報連携を行い、不明な場合は提供前に確認する。","row":29,"cat":"HYGIENE"},{"id":"CF-08","field":"衛生・安全","name":"食中毒などの衛生事故に備え、発生時や疑いがある場合は初動対応・再発防止を行う","desc":"確認の要点：食中毒・異物混入・アレルギー事故に備え、手順確認や訓練を続けている。発生時や疑いがある場合は安全確保・提供停止・報告と再発防止を行う。\n例：連絡先と役割を共有して動ける状態を保ち、発生時は関係者と原因・対策・その後の実施状況を確認している。","detail":"食中毒・その疑い、異物混入、アレルギー事故などに備え、対応手順・連絡先・役割を共有し、訓練や手順確認で安全確保・提供停止・報告を実行できる状態を保つ。発生時や疑いがある場合は速やかに報告・連携し、被害拡大の防止、原因確認、権限内の対策、その後の実施確認を行う。事故がない期間も備えと訓練で確認し、事故の発生自体を評価の前提にしない。日常の衛生実行はCF-06/07、清掃・検査対応はCF-05で扱う。","row":30,"cat":"HYGIENE"},{"id":"CF-09","field":"品質・管理","name":"レシピどおりの味・分量・盛付を自分で再現する","desc":"確認の要点：指定レシピの材料・計量・工程・完成量・一食分・盛付を守り、自分で安定して再現している。\n例：別の日も味・重量・見た目を確認し、基準内の品質と分量にそろえている。","detail":"指定した材料・計量・工程・完成量・一食分の量・盛付基準を守り、自分で繰り返し再現する。調理技法CF-02、味の判断CF-03、レシピ文書CF-10、他者への教育CF-31と区別する。","row":31,"cat":"QUALITY"},{"id":"CF-10","field":"品質・管理","name":"材料・量・手順が分かる正確なレシピを整備する","desc":"確認の要点：材料・重量・工程・加熱冷却条件・完成量・一食分・保存方法を明記し、レシピを最新に保っている。\n例：分かりにくい記載を直し、変更履歴と最新版の保存先を関係者へ共有している。","detail":"材料名・単位・重量・下処理・工程・加熱や冷却条件・完成量・一食分・保存方法を明記し、版と変更履歴を管理する。文書の正確さ・使いやすさを評価し、原価計算CF-17、指導後の再現CF-31と分ける。","row":32,"cat":"QUALITY"},{"id":"CF-11","field":"衛生・安全","name":"Food Handlerを取得し、有資格者の配置を確認する","desc":"確認の要点：自身のFood Handler資格の有効期限を管理し、担当範囲で更新支援と必要な有資格者の配置確認を行っている。\n例：不在時間や更新漏れを事前に見つけ、店長等と代替配置・取得更新を調整して解消を確認している。","detail":"自身の有効なFood Handler資格を確認する。担当等級の範囲で取得・更新を支援し、仕込みを含む営業中の必要な有資格責任者の配置を、店長・シフト作成者と確認する。不足時の代替・連絡・再確認を記録する。取得だけと配置体制の成果を区別する。","row":33,"cat":"HYGIENE"},{"id":"CF-12","field":"品質・管理","name":"品質のばらつきを予防し、ずれがあれば改善する","desc":"確認の要点：完成品を見本や許容範囲と定期的に照合し、品質のばらつきを予防・改善している。\n例：味・重量・盛付のずれがあれば材料や工程を調べて修正し、後日も基準内か確認している。","detail":"完成品を見本・許容範囲と定期的に照合し、品質がそろった状態を維持する。ずれがあれば材料・計量・工程・設備等の原因を確認し、修正・再点検・定着確認を行う。S1〜S3は担当店舗、S4以上は会社全体の店舗間差も確認する。自分の再現CF-09や教育CF-31と同じ事実を同じ観点で重複加点しない。","row":34,"cat":"QUALITY"},{"id":"CF-13","field":"商品開発","name":"季節性とお客様の好みを踏まえ、新商品開発に主体的に取り組む","desc":"確認の要点：季節や店舗のお客様の好みを踏まえ、新商品を自ら提案し、関係者と協力して試作・改良している。\n例：旬の食材とお客様の声から商品を提案し、試食の反応をもとに味や分量を調整している。","detail":"季節・旬の食材・季節行事と、その店舗のお客様の好み・要望を踏まえ、喜ばれる商品を自ら考えて提案し、企画・試作・改良に取り組む。店舗のコンセプトに合わせ、店長・Kitchen Leader・他Chefと協力し、担当・期限・試作結果を共有する。S1〜S3は等級に応じた参加又は担当店の開発、S4以上は会社全体の商品開発を主導する。定期的な商品構成の更新はCF-14、導入・販売後の確認はCF-16で扱う。","row":35,"cat":"PRODUCT"},{"id":"CF-14","field":"商品開発","name":"お客様の好みに合わせ、メニューを定期的・主体的に更新する","desc":"確認の要点：販売状況やお客様の声を定期的に確認し、好みに合うメニューの改良・入れ替えを自ら提案・実行している。\n例：好評な定番を大切にしながら、反応の弱い商品やおすすめ商品の構成を見直している。","detail":"お客様に飽きられず、繰り返し来店を楽しんでいただけるよう、店舗で決めた周期で販売状況・お客様の声・好みの変化を確認し、指示を待たずにメニューの継続・改良・入れ替えを提案する。店長・Kitchen Leader等と連携して更新を実行する。人気の定番商品を大切にし、変更自体を目的にしない。新商品の企画・試作はCF-13、導入調整・販売後の検証はCF-16で扱い、同じ行動を同じ観点で重複評価しない。","row":36,"cat":"PRODUCT"},{"id":"CF-15","field":"商品開発","name":"仕込み負担と提供時間を踏まえて商品を設計する","desc":"確認の要点：味・価値・原価に加え、設備・仕込み負担・提供時間を踏まえ、現場で無理なく再現できる商品を設計している。\n例：試作時にピーク中の工程と提供時間を確かめ、負担の大きい作業を仕込みへ振り分けて再確認している。","detail":"新商品について、味・価値・原価・設備・仕込み工程・提供時間・技能で無理なく再現できるか試験する。既存営業の工程改善CF-28や指導CF-30とは区別する。","row":37,"cat":"PRODUCT"},{"id":"CF-16","field":"商品開発","name":"商品導入を連携して進め、販売後も改善する","desc":"確認の要点：導入前のレシピ・原価・仕込み・提供方法をそろえ、販売後も売れ方・品質・負担・原価を検証している。\n例：関係者と準備を進め、販売後に注文率やロス・提供時間を確認し、課題を改善している。","detail":"レシピ・原価・仕込み・提供方法の準備を関係者と確認し、販売開始後の売れ方・品質・作業負担・原価を検証する。S4以上は会社全体の導入・定着を確認する。レシピ教育の成果自体はCF-31で評価する。","row":38,"cat":"PRODUCT"},{"id":"CF-17","field":"原価設計","name":"レシピの原価を計算する","desc":"確認の要点：材料の単価・単位・使用量を確認し、商品や一食当たりの原価を正しく計算している。\n例：完成量と分量を照合し、仕入条件やレシピが変わった際も原価を更新している。","detail":"材料単価・単位・使用量を確認し、商品原価を正しく算出する。","row":39,"cat":"COST_DESIGN"},{"id":"CF-18","field":"原価設計","name":"歩留まりを設計へ反映する","desc":"確認の要点：加工前後の重量を実測し、実際の歩留まりを材料必要量と原価に反映している。\n例：歩留まりが変わった場合は原因を確認し、使用量や原価の設計を見直している。","detail":"仕入量と可食・使用量を確認し、実測した歩留まりを原価へ反映する。","row":40,"cat":"COST_DESIGN"},{"id":"CF-19","field":"原価設計","name":"仕入条件を比較する","desc":"確認の要点：品質・価格・規格・配送・安定供給を比較し、担当権限の範囲で仕入先の選択肢を示している。\n例：価格だけで決めず、納期や供給が途切れるリスクも含めて比較・提案している。","detail":"品質・価格・規格・配送・安定供給を比較し、権限内で選定案を示す。","row":41,"cat":"COST_DESIGN"},{"id":"CF-20","field":"原価設計","name":"売価・代替食材の選択肢を示す","desc":"確認の要点：品質・分量・商品価値を保ちながら、原価と利益を確認して売価や代替食材を提案している。\n例：候補ごとに品質と費用への影響を比較し、採用する場合の利点や注意点を示している。","detail":"品質と商品価値を保ち、原価と利益を確認して価格・材料の変更案を示す。","row":42,"cat":"COST_DESIGN"},{"id":"CF-21","field":"原価改善","name":"Food Costの実績と変動要因を把握する","desc":"確認の要点：会社の計算方法でFood Costを確認し、仕入価格・販売構成・使用量・棚卸の違いに分けて変化を説明している。\n例：原価上昇の兆候を捉え、優先して確認する原因を関係者へ伝えている。","detail":"会社の計算方法でFood Costの実績を読み、仕入価格・販売構成・使用量・棚卸差異等へ分けて説明する。S1〜S3は担当店舗、S4以上は会社全体の店別課題を把握する。対策の実行・検証はCF-23/24で分ける。","row":43,"cat":"COST_IMPROVE"},{"id":"CF-22","field":"原価改善","name":"棚卸数値の誤りを予防し、差異があれば調査・修正する","desc":"確認の要点：棚卸の数量・単位・単価・計上時期を確認し、誤った数字の確定を防いでいる。\n例：違いや異常があれば実在庫や使用量と照合し、原因を調べて修正・再確認している。","detail":"数量・単位・単価・計上時期を照合し、誤った棚卸数値の確定を防ぐ。差異や異常がある場合は実在庫・使用量等と照合し、原因確認・修正・再確認を行う。日常の発注・棚卸実行CF-27や対策効果CF-24と区別する。","row":44,"cat":"COST_IMPROVE"},{"id":"CF-23","field":"原価改善","name":"加工・作り過ぎ・廃棄のロスを予防・削減する","desc":"確認の要点：販売見込み・在庫・歩留まりから加工方法や仕込み量を調整し、不要なロスを予防・削減している。\n例：廃棄が増えた原因を調べ、品質・衛生や欠品を悪化させず対策と効果確認を続けている。","detail":"販売見込み・在庫・歩留まりに応じて加工方法・仕込み量・保管を調整し、不要なロスを防ぐ。ロスの種類・量を確認し、増加や無駄があれば原因を調べて改善・効果確認を続ける。品質・衛生を落として原価を下げない。個別対策を評価し、全体の改善活動CF-24と分ける。","row":45,"cat":"COST_IMPROVE"},{"id":"CF-24","field":"原価改善","name":"原価改善の対策を実行し、継続して検証する","desc":"確認の要点：課題・目標・担当・期限を決め、品質と提供量を守りながら原価改善を実行・検証している。\n例：仕入価格など外部要因と取組の効果を分けて確認し、結果を次の対策へつなげている。","detail":"課題・目標・担当・期限を定め、品質と提供量を守りながら原価改善を実行する。取組の具体性・継続・結果の検証・次の修正を確認する。仕入価格など本人が動かせない変化を分け、原価率の達否や努力したという申告だけで採点しない。S1〜S3は担当店舗、S4以上は会社全体。","row":46,"cat":"COST_IMPROVE"},{"id":"CF-25","field":"効率・改善","name":"必要量と完成時刻からPrepの工程・分担を組む","desc":"確認の要点：販売予測・在庫・必要量・完成時刻から、仕込みの順序・同時進行・分担を組んでいる。\n例：進捗と不足を確認し、見込みが変わった場合も計画や分担を調整して遅れを防いでいる。","detail":"販売予測・在庫・必要量・完成時刻から仕込み表を作り、調理順・同時進行・作業分担を整える。完了状況と不足を確認する。技術自立はCF-34、実作業の速さはCF-04で分ける。","row":47,"cat":"EFFICIENCY"},{"id":"CF-26","field":"効率・改善","name":"厨房とホールを連携し、提供の流れを改善する","desc":"確認の要点：注文順・調理時間・同卓提供・お客様の要望を踏まえ、厨房とホールの連携を整えている。\n例：提供の見通しを共有し、滞りがあれば優先順位を調整して流れが戻ったか確認している。","detail":"注文順・調理時間・同卓提供・お客様の要望から、その営業中の優先順位と連携を整え、提供遅れを減らす。事前のPrep計画CF-25、恒常的な工程変更CF-28、教え方CF-30と分ける。","row":48,"cat":"EFFICIENCY"},{"id":"CF-27","field":"効率・改善","name":"発注・在庫・棚卸を運用する","desc":"確認の要点：在庫・使用予定・納期・保管を確認し、担当範囲の発注・在庫・棚卸を完結している。\n例：欠品や過剰在庫を防ぎ、納品の数量・品質に違いがあれば取引先等と調整して処理を終えている。","detail":"数量・納期・保管・消費を確認し、担当範囲の発注在庫業務を完了する。","row":49,"cat":"EFFICIENCY"},{"id":"CF-28","field":"効率・改善","name":"調理工程・動線を見直し、効率を改善する","desc":"確認の要点：移動・待機・重複作業・手戻りを見直し、道具配置・作業順・工程を改善している。\n例：変更前後の品質と完成時間を比べ、無駄の削減が効果につながったか確認している。","detail":"移動・待機・重複作業・手戻りを見つけ、道具配置・作業順・同時進行・工程を変更し、品質と完成時間を前後比較する。工程の改善を評価し、実技教育CF-30と区別する。","row":50,"cat":"EFFICIENCY"},{"id":"CF-29","field":"技術共有・育成","name":"スタッフの仕込み習熟度を把握し、次の目標を定める","desc":"確認の要点：スタッフの仕込みを実技で確認し、品質・正確さ・丁寧さ・時間・自立範囲を把握している。\n例：習熟状況に合う次の目標と練習機会を決め、無理な作業割当てを防ぎながら進捗を確認している。","detail":"仕込み別に品質・正確さ・丁寧さ・時間・自立範囲を実技で確認し、次に習得する作業と練習機会を決める。技能の見極めと目標設定を評価し、教える行動CF-30やレシピ再現CF-31と分ける。","row":51,"cat":"TEACH"},{"id":"CF-30","field":"技術共有・育成","name":"効率的な仕込み・調理を教え、習得を確認する","desc":"確認の要点：実演・本人の実施・助言を通じ、品質を保つ段取りや同時進行を教え、自立してできる作業を増やしている。\n例：別の日も同じ品質・基準時間で完結できるか確認し、難しい工程は教え方や練習を見直している。","detail":"実演・本人の実施・助言・別日の再確認を通じ、品質を保つ段取り・同時進行・道具の使い方を教える。本人が自立してできる仕込みを増やす。工程設計CF-28、診断CF-29と同じ観点で重複加点しない。","row":52,"cat":"TEACH"},{"id":"CF-31","field":"技術共有・育成","name":"レシピと分量をスタッフへ教え、再現を確認する","desc":"確認の要点：最新版レシピの材料・計量・工程・分量・盛付・保管を教え、スタッフの再現と定着を確認している。\n例：品質や量にばらつきがあれば理解や工程を確認し、再指導後も基準どおりに作れるか確かめている。","detail":"最新版レシピの材料・単位・計量・工程・完成量・一食分・盛付・保管を教え、別の人が同じ品質・量で再現できるか実技確認する。レシピ文書CF-10と教える技術CF-30ではなく、標準商品の再現・定着を評価する。","row":53,"cat":"TEACH"},{"id":"CF-32","field":"技術共有・育成","name":"Kitchen Leaderの判断力・指導力を育てる（S4以上）","desc":"確認の要点：Kitchen Leaderに仕込み計画・衛生・原価・スタッフ指導を段階的に任せ、自分で判断・実行・教育できる状態へ育てている。\n例：難しい点は助言し、任せた後も自立状況を確認して次の成長機会をつくっている。","detail":"S4以上を対象とし、会社全体のKitchen Leader等へ技術・Prep計画・衛生・原価・スタッフ指導を段階的に任せ、本人が判断・実行・他者を教育できる状態へ育てる。S1〜S3では本項目を必須にせず、担当機会がない場合は上司が「該当しない」を選択する。S3 Head Chefは同格のG3 Kitchen Leaderと協力し、日常の仕込み・調理・効率・レシピの指導と習得確認をCF-29〜31で評価する。人事権を自動で含めない。","row":54,"cat":"TEACH"},{"id":"CF-33","field":"技術・専門実務","name":"担当ポジションの習得範囲を実技で示す","desc":"確認の要点：期首に決めた担当持ち場で、レシピ・火入れ・盛付・速度を実技確認し、自立して任せられる範囲を示している。\n例：代表商品の実技と習得表で、任せられる商品・技能・完成時間を把握している。","detail":"期首に店舗で必要な持ち場と担当範囲を指定する。各持ち場でレシピ・火入れ・盛付・速度を実技確認し、自立して任せられる範囲を記録する。店舗の持ち場数だけで有利不利をつけない。","row":55,"cat":"TECH"},{"id":"CF-34","field":"技術・専門実務","name":"担当の仕込みを準備から保管まで自立して完結する","desc":"確認の要点：必要量を確認し、材料準備・下処理・加工・調理・分量と品質の確認・保管まで自立して完結している。\n例：担当の仕込みを、準備から保管まで安定した品質でやり切っている。","detail":"必要量を確認し、材料準備・下処理・加工・調理・分量確認・品質確認・保管まで、自分の担当範囲を完結する。技術自立の幅を評価し、速さCF-04と工程計画CF-25を重複加点しない。","row":56,"cat":"TECH"},{"id":"CF-35","field":"効率・改善","name":"営業開始までに厨房の準備を完了する","desc":"確認の要点：指定リストと現物を確認し、営業開始までに仕込み・在庫・設備・器具・温度・清掃の準備を整えている。\n例：不足や不具合は営業への影響と対応を共有し、準備が完了したか確認している。","detail":"仕込み・在庫・設備・器具・温度・清掃の指定リストを使い、営業開始時刻までに担当厨房を準備する。不足や不具合は営業への影響と対応を共有する。","row":57,"cat":"EFFICIENCY"},{"id":"CF-36","field":"効率・改善","name":"閉店作業と翌日の準備・引き継ぎを完了する","desc":"確認の要点：Closing Listで食材保管・日付・補充・清掃・設備停止を確認し、翌日の準備と引き継ぎを完了している。\n例：仕込み量・在庫不足・注意点を共有し、漏れがあれば補って次回の確認にも反映している。","detail":"食材の保管・日付・補充・片付け・清掃・設備停止を指定リストで確認し、翌日の仕込み量・在庫不足・注意点を引き継ぐ。終業時刻と完成状態を確認する。衛生そのものはCF-05〜08で分ける。","row":58,"cat":"EFFICIENCY"}],"weights":{"S1":{"weights":{"PHILO":20,"TECH":25,"HYGIENE":10,"QUALITY":15,"PRODUCT":5,"COST_DESIGN":5,"COST_IMPROVE":5,"EFFICIENCY":10,"TEACH":5},"row":61},"S2":{"weights":{"PHILO":20,"TECH":20,"HYGIENE":10,"QUALITY":15,"PRODUCT":5,"COST_DESIGN":5,"COST_IMPROVE":5,"EFFICIENCY":10,"TEACH":10},"row":62},"S3":{"weights":{"PHILO":20,"TECH":10,"HYGIENE":10,"QUALITY":10,"PRODUCT":10,"COST_DESIGN":10,"COST_IMPROVE":10,"EFFICIENCY":10,"TEACH":10},"row":63},"S4":{"weights":{"PHILO":20,"TECH":5,"HYGIENE":10,"QUALITY":10,"PRODUCT":15,"COST_DESIGN":5,"COST_IMPROVE":15,"EFFICIENCY":10,"TEACH":10},"row":64},"S5":{"weights":{"PHILO":20,"TECH":5,"HYGIENE":10,"QUALITY":10,"PRODUCT":15,"COST_DESIGN":5,"COST_IMPROVE":15,"EFFICIENCY":10,"TEACH":10},"row":65},"S6":{"weights":{"PHILO":20,"TECH":5,"HYGIENE":10,"QUALITY":10,"PRODUCT":15,"COST_DESIGN":5,"COST_IMPROVE":15,"EFFICIENCY":10,"TEACH":10},"row":66}},"sourceNotes":{"row67":"S1〜S3の「指導・育成」は学習共有・日常の技術指導・習得確認（CF-29〜31）を等級に応じて評価し、CF-32は除外。S4以上はCF-32を含め、会社全体の商品開発・原価改善・リーダー育成を主導する。","applied":"CF-32 は等級で自動除外しない（指示書 5-1・GM実装仕様が優先）"}},"S_OFFICE":{"name":"S Office・経理・人事","unassigned":false,"categories":[{"key":"PHILO","name":"理念","short":"理念"},{"key":"TECH","name":"技術・専門実務","short":"技術実務"},{"key":"QUALITY","name":"品質・管理","short":"品質管理"},{"key":"EFFICIENCY","name":"効率・改善","short":"効率改善"},{"key":"TEACH","name":"技術共有・育成","short":"指導・育成"}],"domains":[{"key":"OFFICE","name":"Office","prefixes":["OF-T-"]},{"key":"ACCOUNTING","name":"経理","prefixes":["AC-T-"]},{"key":"HR","name":"人事","prefixes":["HR-T-"]}],"items":[{"id":"01-01","field":"理念：楽しむ","name":"自ら仕事を楽しむ工夫をし、前向きに取り組む","desc":"確認の要点：仕事の意味や楽しさを見つけ、自分から工夫・協力し、困難な場面も必要な支援を求めて取り組んでいる。\n例：忙しい日も作業の工夫を提案し、仲間と協力して前向きに進めている。","detail":"受け身で待つだけでなく、仕事の意味や楽しさを見つけ、工夫や協力を自分から行う。困難な場面でも必要な支援を求めて取り組む。性格の明るさだけでは判断しない。","row":7,"cat":"PHILO","cls":"ENJOY"},{"id":"01-02","field":"理念：楽しむ","name":"仲間の良い行動や成長を認め、称賛する","desc":"確認の要点：仲間の良い行動・工夫・成長を具体的に認め、役職や親しさに偏らず称賛している。\n例：仲間の確認や工夫で仕事が進んだとき、何が良かったかを言葉で伝えている。","detail":"仲間の良い行動・工夫・成長を具体的な言葉で認め、小さな成功や達成感を共有する。役職や親しさによって称賛する相手を偏らせない。","row":8,"cat":"PHILO","cls":"ENJOY"},{"id":"01-03","field":"理念：楽しむ","name":"店舗や働く仲間に関心を持ち、役立つ行動をする","desc":"確認の要点：店舗や仲間の困り事・必要な支援に関心を持ち、自分の担当業務で役立つ行動をしている。\n例：店舗の状況を聞き、必要な情報や準備を整えて現場の仕事を支えている。","detail":"現場の状況や困り事に関心を持ち、必要な支援を考えて行動する。Officeの都合だけで判断せず、相手が使いやすく、仕事を進めやすい対応を心がける。ここでは相手への関心と配慮を確認し、対応スピードや問題解決力とは分ける。","row":9,"cat":"PHILO","cls":"ENJOY"},{"id":"01-16","field":"理念：楽しむ","name":"不機嫌を周囲にぶつけず、落ち着いて接する","desc":"確認の要点：忙しくても無視・威圧・物への八つ当たりをせず、必要な返事と連携を続け、難しいときは相談している。\n例：感情を仲間にぶつけず支援を求めている。異論・相談・体調の申告は不機嫌として扱わない。","detail":"忙しさや私的な感情を理由に、呼びかけを意図的に無視する、きつく当たる、物を乱暴に扱うなどの行動をしない。必要な返事・連携を続け、難しいときは相談する。気分や表情だけで決めつけず、実際の言動を見る。異論・相談・体調の申告は不機嫌として扱わない。","row":10,"cat":"PHILO","cls":"ENJOY"},{"id":"01-05","field":"理念：感謝","name":"店舗や仲間の協力を当たり前にせず、感謝を伝える","desc":"確認の要点：店舗からの資料提出や仲間の引き継ぎなどを当たり前にせず、協力へ感謝を伝えている。\n例：情報や資料をそろえてくれた相手へ、何が助かったかを具体的に伝えている。","detail":"忙しい現場が資料提出・確認・情報共有などに協力していることを理解し、手伝いや引き継ぎも含め、何をしてくれて助かったかを具体的に伝える。","row":11,"cat":"PHILO","cls":"THANK"},{"id":"01-06","field":"理念：感謝","name":"地域・取引先を尊重し、信頼関係を大切にする","desc":"確認の要点：地域・取引先へ敬意を持ち、相手の事情にも配慮した丁寧なやり取りを続けている。\n例：納品や依頼への協力に感謝し、連絡や調整を丁寧に行って信頼関係を大切にしている。","detail":"会社を支える地域や取引先に敬意を持ち、相手の事情にも配慮して、丁寧な連絡・対応を続ける。支払期日の管理とは分け、日頃の接し方と相手への配慮を確認する。","row":12,"cat":"PHILO","cls":"THANK"},{"id":"01-07","field":"理念：思いやる","name":"仲間の状況を見て助け合う","desc":"確認の要点：自分の持ち場だけでなく仲間の状況を見て、困っている人に声をかけ、必要な支援をしている。\n例：締切や作業が重なった仲間へ状況を確認し、自分が対応できる仕事を手伝っている。","detail":"自分の持ち場だけでなく、困っている仲間に声をかけ、必要な支援をする。","row":13,"cat":"PHILO","cls":"CARE"},{"id":"01-08","field":"理念：思いやる","name":"仲間に関心を持ち、相手の立場を確認して行動する","desc":"確認の要点：決めつけずに話を聞き、相手の経験・言語・状況に合わせて伝え方や対応を調整している。\n例：説明が伝わらない場合は図や実演を使い、仲間の困り事や変化にも声をかけている。","detail":"決めつけず話を聞き、経験・言語・状況の違いを踏まえて伝え方や対応を調整する。仲間の困り事や変化に気づき、必要な声かけをする。","row":14,"cat":"PHILO","cls":"CARE"},{"id":"01-09","field":"理念：思いやる","name":"相手を尊重した言動をする","desc":"確認の要点：役職や相手によって敬意を変えず、威圧的な言い方や人を傷つける言動を避けている。\n例：意見が違う場合も話を聞き、人前で責めず、事実と改善点を落ち着いて伝えている。","detail":"役職や相手によって敬意を変えない。威圧的な言い方や、人を傷つける言動を避ける。","row":15,"cat":"PHILO","cls":"CARE"},{"id":"01-10","field":"理念：成長","name":"素直に学び、改善に活かす","desc":"確認の要点：分からないことを質問し、フィードバックを受け止めて改善を続けている。\n例：指摘された作業を見直して実行し、その後も同じ抜けがないか確認している。","detail":"分からないことを質問し、フィードバックを行動に反映する。意見や疑問を述べること自体を低評価にしない。","row":16,"cat":"PHILO","cls":"GROW"},{"id":"01-11","field":"理念：成長","name":"苦手なことや新しいことに挑戦する","desc":"確認の要点：自分の課題を把握し、必要な支援を求めながら未経験の仕事や苦手な業務に挑戦している。\n例：練習や確認の機会を相談し、実際に取り組んで自立してできる範囲を広げている。","detail":"課題を把握し、必要な支援を求めながら未経験の仕事や苦手な業務に取り組む。","row":17,"cat":"PHILO","cls":"GROW"},{"id":"01-12","field":"理念：成長","name":"自分が改善できる行動を考え、実践する","desc":"確認の要点：人のせいにして終わらず、自分の判断・準備・伝え方も振り返り、次の行動を変えて確認している。\n例：連携が遅れた原因を確かめ、自分の準備や伝え方を改善し、会社側の課題も事実として報告している。","detail":"人のせいにして終わらず、自分の判断・準備・伝え方を振り返って次の行動を変え、その後も確認する。設備・制度・人員など会社側の課題も事実として報告する。すべてを本人の責任にしない。","row":18,"cat":"PHILO","cls":"GROW"},{"id":"01-13","field":"理念：誠実","name":"嘘やごまかしをせず、事実を伝える","desc":"確認の要点：嘘やごまかしをせず、実施状況や分からないことを事実どおりに伝えている。\n例：未完了の仕事を完了と報告せず、不明な数字や状況は確認してから伝えている。","detail":"未実施の作業を完了扱いにしない。不明なことを分かったふりで答えず確認する。","row":19,"cat":"PHILO","cls":"SINCERE"},{"id":"01-14","field":"理念：誠実","name":"ミスや問題を隠さず、早めに相談する","desc":"確認の要点：自分に不利なミスや問題も隠さず報告し、難しい対応や遅れを放置せず早めに相談している。\n例：気づいた時点で影響する相手へ事実・対応案・必要な支援を伝えている。","detail":"自分に不利な内容でも報告する。対応が難しい場合や遅れそうな場合も放置せず相談する。","row":20,"cat":"PHILO","cls":"SINCERE"},{"id":"01-15","field":"理念：誠実","name":"仕事に誇りと責任を持ち、約束やルールを守る","desc":"確認の要点：仕事の種類で丁寧さを変えず、任された仕事を責任を持って完了・引き継ぎまで行っている。\n例：約束や期限を守り、難しい場合は期限前に相談して対応と引き継ぎを済ませている。","detail":"どんな仕事にも真摯に向き合い、任された仕事をやり切る。難しい場合は事情を伝え、対応や引き継ぎまで行う。役割や仕事の種類で丁寧さを変えない。","row":21,"cat":"PHILO","cls":"SINCERE"},{"id":"OF-T-01","field":"技術・専門実務","name":"書類・台帳・データの整備","desc":"確認の要点：資料と照合して台帳やデータを更新し、保存先・更新日・最新版を明確にしている。\n例：古い情報の使用を防ぎ、不一致があれば訂正して関係者への共有まで確認している。","detail":"根拠資料から情報を登録し、更新日・保存先・最新版を明確にして古い情報の使用を防ぐ。変更や不一致があれば更新し、関係者への共有まで確認する。","row":22,"cat":"TECH","domain":"OFFICE"},{"id":"OF-T-02","field":"技術・専門実務","name":"正確さを保ち、優先順位を判断して迅速に対応する","desc":"確認の要点：現場への影響・緊急度・期限から優先順位を決め、正確さを保って迅速に対応している。\n例：依頼の内容と完了条件を確認して回答予定を伝え、待ち時間や手戻りを減らしている。","detail":"店舗・社内からの依頼は、現場への影響・緊急度・期限から優先順位を決め、効率よく進める。内容と完了条件を確認して早めに返答し、すぐに完了できない場合も対応予定を伝える。処理時間・滞留・手戻りを確認し、正確さを落とさず対応を早める。課題の捉え方と解決の完結はOF-Q-04、ここでは対応速度・優先順位・作業効率を確認する。","row":23,"cat":"TECH","domain":"OFFICE"},{"id":"OF-T-03","field":"技術・専門実務","name":"品質と価格を比較し、仕入れ・購入コストを適正化する","desc":"確認の要点：店舗・Officeの購入品を、品質・価格・送料・納期・使い勝手で比較し、必要な品質を保ってコストを抑えている。\n例：購入先や代替品を提案し、採用後も品質・費用を確認する。手配や契約・更新情報も管理している。","detail":"店舗・Officeの購入品について、品質・価格・送料・納期・使い勝手を定期的に比較し、必要な品質を保てる購入先や代替品を提案する。採用後も品質と削減効果を確認する。取引先・備品の手配と契約・更新情報も管理する。経費全体の変化はOF-M-05で扱い、同じ比較・削減を同じ観点で重複評価しない。","row":24,"cat":"TECH","domain":"OFFICE"},{"id":"OF-T-04","field":"技術・専門実務","name":"申請・更新・外部窓口対応","desc":"確認の要点：申請・更新の必要資料と期限を事前に把握し、提出・受付・完了まで管理している。\n例：許認可や保険の期限切れを防ぎ、追加資料や不備にも対応して完了を確認している。","detail":"申請・更新の必要資料と期限を先に把握し、窓口確認・提出・受付・完了を管理して期限切れや手続き漏れを防ぐ。不備があれば補正し、完了まで追跡する。","row":25,"cat":"TECH","domain":"OFFICE"},{"id":"OF-Q-01／HR-Q-01","field":"品質・管理","name":"成果物の精度を保ち、誤りを予防・改善する","desc":"確認の要点：送付・確定前に宛先・数字・添付・最新版を確認し、根拠資料と照らし合わせて誤りを防いでいる。\n例：従業員情報や書類に誤りがあれば、影響範囲を確認して訂正・連絡し、確認手順を見直している。","detail":"送付・確定前に宛先・数字・添付・版を確認し、従業員情報・人事書類も根拠資料と照らし合わせて確認する。誤りがあれば影響範囲を確認して訂正・連絡し、確認手順へ反映する。","row":26,"cat":"QUALITY"},{"id":"OF-Q-02／HR-Q-02","field":"品質・管理","name":"期限・優先順位・進捗管理","desc":"確認の要点：期限・重要度・作業のつながり・進捗を管理し、手続きや給与連携の遅延を防いでいる。\n例：遅れる兆候があれば早めに相談して日程・分担を調整し、完了まで確認している。","detail":"期限・重要度・依存作業・完了状況を管理し、手続きや給与連携の遅延を防ぐ。遅れの兆候があれば早めに相談して日程・分担を調整し、未完了を放置しない。","row":27,"cat":"QUALITY"},{"id":"OF-Q-03／HR-Q-03","field":"品質・管理","name":"個人情報・機密情報を守り、情報漏洩を防ぐ","desc":"確認の要点：個人情報・会社情報の共有先・保存先・送付先・利用権限を確認し、不要な共有や漏洩を防いでいる。\n例：給与や相談記録の共有先を限定する。不審な動きや漏洩の疑いは会社へ報告・相談し、拡大防止と是正・再確認を行っている。","detail":"従業員・応募者・給与・相談内容などを、業務上必要な権限のある相手に限って共有し、私的な会話や不要な共有をしない。契約等の会社情報も含め、保存先・送付先・アクセス権限・利用するツールを確認する。セキュリティ上の懸念は会社へ相談して対応する。漏洩やその疑いがある場合は速やかに報告し、権限内で拡大防止・是正・その後の確認を行う。必要な報告・相談まで止めない。","row":28,"cat":"QUALITY"},{"id":"OF-Q-04","field":"品質・管理","name":"状況と課題を的確に捉え、解決・完了まで導く","desc":"確認の要点：依頼の目的・事実・原因を整理し、担当・期限・完了条件を決めて解決まで進めている。\n例：自分で解決できない場合は相談・連携し、引き渡し後も現場の問題が解消したか確認している。","detail":"依頼の目的・事実・原因・必要な対応を整理し、担当者・期限・完了条件を明確にして行動する。表面的な処理だけで終わらず、自分だけで解決できない場合は適切な相手へ相談・連携する。引き渡した後も対応状況と現場の解決・完了を確認する。対応速度そのものはOF-T-02と区別する。","row":29,"cat":"QUALITY"},{"id":"AC-T-01","field":"技術・専門実務","name":"取引を正しく記録し、請求書・領収書などを確認・整理する","desc":"確認の要点：請求書・領収書・納品書で取引内容・日付・金額・承認を確認し、二重登録や漏れなく記録・保存している。\n例：誤りがあれば理由と修正履歴を残して直し、関連する数字や資料への影響も確認している。","detail":"請求書・領収書・納品書などで、取引内容・日付・金額・承認内容を確認し、正しい項目で記録する。同じ取引の二重登録や記録漏れを防ぎ、資料を後から確認できるよう整理・保存する。誤りがあれば修正内容と理由を残し、ほかの数字や資料への影響も確認する。","row":30,"cat":"TECH","domain":"ACCOUNTING"},{"id":"AC-T-02","field":"技術・専門実務","name":"数字を照らし合わせ、違いの原因を確認して整える","desc":"確認の要点：売上・入金・支払・管理表・口座の数字を定期的に照合し、違いの原因を確認して整えている。\n例：POSと入金が合わない場合は手数料や入金日を調べ、処理後の残高を再確認して理由を説明している。","detail":"売上・入金・支払・管理表・口座などの残高を定期的に照らし合わせ、数字が正しくつながっているか確認する。違いがあれば手数料・入金時期・記録内容などの原因を調べ、必要な処理後に再確認し、理由を説明する。","row":31,"cat":"TECH","domain":"ACCOUNTING"},{"id":"AC-T-03","field":"技術・専門実務","name":"支払・請求・毎月の集計と確認を期限内に終える","desc":"確認の要点：必要な資料と承認をそろえ、支払・請求・毎月の集計と確認を期限内に完了している。\n例：未処理や未承認を確かめて漏れ・二重支払を防ぎ、不備があれば調整して反映まで確認している。","detail":"必要な資料と承認をそろえ、支払・請求・毎月の数字の集計と確認を期限内に完了する。まだ処理や承認が済んでいないものを確認し、支払漏れや二重支払を防ぐ。問題があれば影響する範囲を確認して対応を終える。","row":32,"cat":"TECH","domain":"ACCOUNTING"},{"id":"AC-T-04","field":"技術・専門実務","name":"会社や店舗のお金の状況を理解し、変化の理由を説明する","desc":"確認の要点：売上・費用・利益、財産・借入、店舗別利益、予算と実績の違いを確認し、変化の理由を説明している。\n例：食材費や人件費などに分けて原因を確かめ、気になる変化を関係者へ共有して追加確認につなげている。","detail":"担当等級の範囲で、損益計算書（売上・費用・利益の状況）や貸借対照表（財産・借入などの状況）、店舗別の利益、予算と実績の違いを定期確認する。数字の根拠と変化の理由を説明し、気になる変化があれば関係者へ共有して追加確認につなげる。","row":33,"cat":"TECH","domain":"ACCOUNTING"},{"id":"AC-Q-01","field":"品質・管理","name":"計算と記録を確認して誤りを防ぎ、見つかった場合は直して繰り返しを防ぐ","desc":"確認の要点：数字を確定する前に再計算・二重登録の確認・元資料との比較を行い、誤りを防いでいる。\n例：ミスが見つかった場合は関連資料と履歴も確認して直し、確認方法を見直して次回も実施している。","detail":"数字を確定する前に、再計算・二重登録の確認・元の資料との比較を行う。誤りがあれば、影響する範囲と修正履歴を確認し、確認方法を見直して次回も実施する。取引の記録作業AC-T-01と同じ行動を同じ観点で重複評価しない。","row":34,"cat":"QUALITY"},{"id":"AC-Q-02","field":"品質・管理","name":"支払などの期日を守り、取引先との信頼関係を維持する","desc":"確認の要点：支払・集計・申告の期限から日程を組み、未処理・未承認を事前に確認して遅延を防いでいる。\n例：遅れるおそれがあれば早めに相談し、取引先と対応予定を共有して完了まで追っている。","detail":"業者への支払、毎月の数字の集計と確認、申告の期限から資料回収・承認・確認の日程を組み、未処理・未承認を期日前に確認して遅延を防ぐ。支払いに影響する問題があれば早めに上長へ相談し、取引先へ必要な連絡・調整を行って完了まで追跡する。実際の処理はAC-T-03、ここでは期限管理と連絡・調整を確認し、同じ行動を同じ観点で重複評価しない。","row":35,"cat":"QUALITY"},{"id":"AC-Q-03","field":"品質・管理","name":"担当・承認の役割と、会社のお金・資料の管理を徹底する","desc":"確認の要点：処理する人と確認・承認する人の役割を分け、現金・会社カード・資料・情報へのアクセスを適切に管理している。\n例：承認記録・請求書・送金内容を照合し、不備や異常は報告・修正してその後も確認している。","detail":"担当者と確認・承認する人の役割を分け、現金・会社カード・資料の保存・情報を見たり操作したりできる範囲を管理する。請求書・領収書などを支払内容と照らし合わせ、間違った処理や不正を防ぐ。不備や異常があれば報告し、自分で対応できる範囲は直して、その後も確認する。","row":36,"cat":"QUALITY"},{"id":"AC-Q-04","field":"品質・管理","name":"税理士などと連携し、申告などに必要な資料をそろえて対応する","desc":"確認の要点：申告等の必要資料・期限・不明点を早めに整理し、税理士などと社内承認者に確認して対応している。\n例：追加資料や修正にも対応し、提出や対応が完了したかまで確認している。","detail":"税金の申告などに必要な資料・期限・不明点を早めに整理し、税理士などへの確認と社内の承認を経て対応する。追加資料や修正が必要な場合は内容を整え、提出・対応が終わったかまで確認する。","row":37,"cat":"QUALITY"},{"id":"HR-T-01","field":"技術・専門実務","name":"採用業務の実行・進捗管理","desc":"確認の要点：募集条件に沿って応募対応・選考調整・記録を進め、連絡や選考の漏れを防いでいる。\n例：応募者・店舗との行き違いや日程変更を調整し、双方へ連絡して変更後の予定も確認している。","detail":"合意した募集条件で応募対応・選考調整・記録を進め、連絡や選考の漏れを防ぐ。応募者・店舗との行き違い等があれば事実を確認して調整し、対応方法へ反映する。","row":38,"cat":"TECH","domain":"HR"},{"id":"HR-T-02","field":"技術・専門実務","name":"入社・異動・退社の手続き","desc":"確認の要点：入社・異動・退社に必要な書類・期限・店舗との連携を整え、手続き漏れを防いでいる。\n例：変更や不足書類があれば関係者と訂正・追加対応し、完了まで確認している。","detail":"入社・異動・退社に必要な書類・期日・情報連携を事前に整え、手続き漏れを防ぐ。変更や不備があれば関係者と訂正・追加対応し、完了まで確認する。","row":39,"cat":"TECH","domain":"HR"},{"id":"HR-T-03","field":"技術・専門実務","name":"勤怠・給与連携・従業員情報の管理","desc":"確認の要点：勤怠・従業員情報を締切前に確認し、承認手順に沿って正しい情報を給与担当等へ渡している。\n例：誤りがあれば根拠を残して訂正・連携し、給与などに反映されたかまで確認している。","detail":"勤怠・従業員情報を締切前に照らし合わせて確認し、正しい情報を承認手順に沿って給与担当等へ渡す。誤りや漏れがあれば根拠を確認して訂正・連携し、給与等への反映を確認する。","row":40,"cat":"TECH","domain":"HR"},{"id":"HR-T-04","field":"技術・専門実務","name":"従業員相談・制度運用の支援","desc":"確認の要点：相談窓口を案内し、相談内容の事実・守秘・担当権限を確認して、必要な相手と連携している。\n例：対応状況を追って放置や問題の拡大を防ぎ、必要な改善を行っている。","detail":"相談できる窓口と連携先を明確にし、受けた相談の事実・守秘・権限を確認して対応を追跡する。問題が生じた場合は適切な担当へつなぎ、放置・拡大を防ぐ確認と必要な改善を行う。相談がないことだけで良好と判断しない。","row":41,"cat":"TECH","domain":"HR"},{"id":"HR-Q-04","field":"品質・管理","name":"ルールを公平に運用し、現場と協力して店舗運営を支える","desc":"確認の要点：ルール・期限・判断理由を明確に伝え、現場の事情も聞きながら公平な運用と必要な支援を行っている。\n例：提出が遅れた原因を確認して準備を支援し、例外は上長へ相談して同じ条件の店舗にも公平に対応している。","detail":"全店舗を支えるOfficeとして、必要なルール・期限・判断理由を明確に伝える。現場の事情や困り事にも耳を傾け、実行できる方法や必要な支援を一緒に考える。判断根拠と適用条件をそろえ、不公平な扱いを防ぐ。不明点や例外対応は上長・専門家等へ相談し、確認した内容を共有する。扱いの不一致があれば是正し、その後の運用を確認する。","row":42,"cat":"QUALITY"},{"id":"OF-M-01／AC-M-01／HR-M-01","field":"効率・改善","name":"マニュアルを最新に保ち、同じ基準で判断・行動できる状態を整える","desc":"確認の要点：上長と決定した内容をマニュアルへ反映し、判断基準・手順・担当・更新履歴・保存先を明確にしている。\n例：最新版と変更点を共有し、担当者が変わっても同じ判断・行動ができるか確認して修正している。","detail":"上長と相談して決定した内容を速やかにOfficeのマニュアルへ反映し、判断基準・手順・担当・確認点を明確にする。更新日・変更履歴・保存先・最新版をそろえ、関係者へ正確に共有する。担当者が変わっても同じ判断・対応ができるか確認する。判断が分かれた場合は上長と確認して記載を見直す。","row":43,"cat":"EFFICIENCY"},{"id":"OF-M-02／AC-M-02／HR-M-02","field":"効率・改善","name":"AI・システムを活用し、Office全体の業務効率化を進める","desc":"確認の要点：手入力や転記などを見直し、自らAI・ツールを使うほか、同僚への相談や会社への提案で効率化を進めている。\n例：導入後も正確さ・処理時間・使いやすさを確認し、必要な人の確認と情報保護を保って改善している。","detail":"繰り返し作業・手入力・転記を見直し、自動化や省力化できる仕事を継続的に探す。自分でAI・ツールを使って改善するほか、同僚への相談や会社への提案を通じて仕組みを作成・導入してもらう。導入後も正確さ・処理時間・使いやすさを確認し、必要な人の確認を保って改善する。個人情報・機密情報はOF-Q-03の共有・利用範囲を守る。","row":44,"cat":"EFFICIENCY"},{"id":"OF-M-03／AC-M-03／HR-M-03","field":"効率・改善","name":"課題・リスクを把握し、改善効果を確認する","desc":"確認の要点：実績・進捗・リスクから問題の兆候を捉え、予防策や改善策の効果と定着を確認している。\n例：手配・入金・書類回収の遅れを早めに防ぎ、問題があれば原因と対策を確認してその後も効果を追っている。","detail":"日常の実績・進捗・リスクを確認し、問題の兆候を早めに把握して予防する。課題があれば原因を整理し、権限内で対策を実行して効果と定着を確認する。問題が起きていない期間も予防策の運用と維持を確認する。","row":45,"cat":"EFFICIENCY"},{"id":"OF-M-04／AC-M-04／HR-M-04","field":"効率・改善","name":"引き継ぎ・業務継続の整備","desc":"確認の要点：業務の進捗・保存先・例外・次の対応を整理し、別の担当者が引き継いでも続けられる状態を保っている。\n例：未完了の依頼・会計処理・入退社手続きなどの状況と次の行動を、必要な資料とともに引き継いでいる。","detail":"担当業務の進捗・保存先・例外・次の行動を整理し、代替できる状態にする。","row":46,"cat":"EFFICIENCY"},{"id":"OF-M-05","field":"効率・改善","name":"店舗経費の変化を捉え、必要な品質を守りながら無駄を減らす","desc":"確認の要点：店舗経費を使用量・単価・売上規模・請求内容から確認し、不明な増加は放置せず報告・相談している。\n例：現場と協力して無駄を減らし、品質・衛生・安全・営業に必要な支出を守りながら削減効果を確認している。","detail":"店舗ごとの変動費・経費を定期確認し、使用量・単価・売上規模・請求内容などから変動の理由を確かめる。不明な増加や疑問は放置せず、速やかに報告・相談する。現場と協力して無駄や不要な費用の削減策を提案・実行し、効果を確認する。品質・衛生・安全・営業に必要な支出は確保する。購入先・購入条件の比較はOF-T-03、財務全体の分析はAC-T-04と区別する。","row":47,"cat":"EFFICIENCY"},{"id":"OF-K-01／AC-K-01／HR-K-01","field":"技術共有・育成","name":"根拠・判断理由の説明","desc":"確認の要点：処理の根拠と判断理由を、相手が資料で確認できるよう説明している。\n例：手配方法・会計処理・制度の適用などについて、参照した資料と判断の理由を具体的に伝えている。","detail":"自分の処理の根拠と判断理由を、相手が確認できるよう説明する。","row":48,"cat":"TEACH"},{"id":"OF-K-02／AC-K-02／HR-K-02","field":"技術共有・育成","name":"専門知識・手順を伝える","desc":"確認の要点：担当作業の要点と注意点を伝え、相手の理解と実行を確認している。\n例：台帳更新・数字の照合・入社書類の確認などを実際の資料で説明し、相手にも実施してもらっている。","detail":"担当する作業の要点・注意点を相手に伝え、理解と実行を確認する。","row":49,"cat":"TEACH"},{"id":"OF-K-03／AC-K-03／HR-K-03","field":"技術共有・育成","name":"専門的な相互確認・助言で品質を保つ","desc":"確認の要点：担当範囲の成果物と根拠を相互確認し、誤りが関係先へ渡るのを防いでいる。\n例：修正点と理由を具体的に伝え、訂正後の内容と次回の確認への反映も確かめている。","detail":"任された範囲の成果物と根拠を相互確認し、誤りの流出を防ぐ。修正が必要な場合は箇所と理由を具体的に伝え、訂正後も確認する。日常的な確認・助言も評価する。","row":50,"cat":"TEACH"},{"id":"OF-K-04／AC-K-04／HR-K-04","field":"技術共有・育成","name":"学習成果・事例の共有","desc":"確認の要点：新しい知識・例外事例・注意点を整理して必要な相手へ共有し、仕事で活用されたか確認している。\n例：更新手続き・会計処理・制度運用で分かったことを共有し、その後の対応に役立っているか確かめている。","detail":"新しい知識・例外事例・注意点を整理し、必要な相手に共有して活用を確認する。","row":51,"cat":"TEACH"},{"id":"OF-K-05","field":"技術共有・育成","name":"仕事を適切に分担・依頼し、相手を信頼して任せる","desc":"確認の要点：担当・得意分野・業務量を踏まえ、目的・期限・完成基準を共有して仕事を分担・依頼している。\n例：任せた後も必要な支援と途中確認を行い、問題があれば自分の伝え方・任せ方も見直している。","detail":"仲間の担当・得意分野・業務量を踏まえ、目的・期限・完成基準を共有して仕事を分担・依頼する。部下には習熟度と役割に応じて判断の範囲も任せ、必要な支援と途中確認を行う。問題があれば相手だけを責めず、自分の伝え方・任せ方・支援も振り返って改善する。仕事を任せることと、実技・手順を教えるOF-K-02は区別する。","row":52,"cat":"TEACH"}],"weights":{"S1":{"weights":{"PHILO":20,"TECH":40,"QUALITY":20,"EFFICIENCY":15,"TEACH":5},"row":71},"S2":{"weights":{"PHILO":20,"TECH":35,"QUALITY":20,"EFFICIENCY":15,"TEACH":10},"row":72},"S3":{"weights":{"PHILO":20,"TECH":30,"QUALITY":20,"EFFICIENCY":20,"TEACH":10},"row":73},"S4":{"weights":{"PHILO":20,"TECH":25,"QUALITY":20,"EFFICIENCY":20,"TEACH":15},"row":74},"S5":{"weights":{"PHILO":20,"TECH":25,"QUALITY":20,"EFFICIENCY":20,"TEACH":15},"row":75},"S6":{"weights":{"PHILO":20,"TECH":25,"QUALITY":20,"EFFICIENCY":20,"TEACH":15},"row":76}}},"PREP":{"name":"Prep","unassigned":false,"items":[{"id":"PH1","cat":"PHILO","catName":"理念","name":"前向き・落ち着いた対応","desc":"確認の要点：仕事に前向きに取り組み、不機嫌を理由に無視・威圧等を向けない。\n例：忙しいときも返事と連携を続け、困ったときは落ち着いて相談する。","row":26},{"id":"PH2","cat":"PHILO","catName":"理念","name":"協力・助け合い","desc":"確認の要点：必要な連携・引き継ぎ・助け合いを勤務中に行う。\n例：仕込みの遅れを共有し、必要な引き継ぎや仲間の作業支援を行う。","row":27},{"id":"PH3","cat":"PHILO","catName":"理念","name":"尊重・感謝","desc":"確認の要点：相手を尊重し、協力に感謝を伝える。\n例：作業を手伝ってくれた仲間へ、何が助かったかを具体的に伝える。","row":28},{"id":"PH4","cat":"PHILO","catName":"理念","name":"学習・自責・改善","desc":"確認の要点：指摘から学び、問題が起きたとき、人や環境のせいにして終わらず、自分の判断・準備・行動も振り返り、技術・速度・効率など、自分が改善できることを実践する。\n例：作業が遅れたとき、自分の準備・手順を振り返り、次回の段取りを変える。","row":29},{"id":"PH5","cat":"PHILO","catName":"理念","name":"誠実・責任","desc":"確認の要点：ミス・遅れを隠さず相談し、任された仕事を完了・引き継ぎまで行う。\n例：仕込みのミスや遅れを隠さず伝え、残った作業を確実に引き継ぐ。","row":30},{"id":"H1","cat":"HYGIENE","catName":"衛生安全","name":"食材・保管","desc":"確認の要点：鮮度・温度・期限・保管場所を確認し、不明な食材は使用前に相談。\n例：使用前に鮮度・温度・期限を確認し、不明な食材は使用せず相談する。","row":31},{"id":"H2","cat":"HYGIENE","catName":"衛生安全","name":"清潔・汚染防止","desc":"確認の要点：作業開始前・トイレ後・生食材の取扱い後など、必要なタイミングで所定の手洗いを行う。清掃・器具管理で交差汚染を防ぎ、汚れ・ゴミを残さない。\n例：生食材を扱った後は必要な手洗い・器具の切り替えを行い、作業場所を清潔に戻す。","row":32},{"id":"H3","cat":"HYGIENE","catName":"衛生安全","name":"道具・設備の安全","desc":"確認の要点：道具を安全に使い、不具合を報告。作業終了時のガス・水・機器等を確認。\n例：機器の異常を報告し、終了時にガス・水・機器の状態を確認する。","row":33},{"id":"B1","cat":"BASIC","catName":"基本","name":"時間を守る","desc":"確認の要点：始業時刻に作業を始められるよう準備し、休憩から時間どおりに戻る。遅刻・欠勤や遅れが見込まれる場合は、分かった時点で連絡する。\n例：始業時刻に作業を始められるよう準備し、遅れる見込みが分かった時点で連絡する。","row":34},{"id":"B2","cat":"BASIC","catName":"基本","name":"約束・期限を守る","desc":"確認の要点：合意した担当作業・期限・引き継ぎを守る。間に合わない場合は期限前に相談し、変更した約束を確認して実行する。\n例：担当する仕込みを期限までに終え、間に合わない場合は期限前に相談・引き継ぎする。","row":35},{"id":"B3","cat":"BASIC","catName":"基本","name":"清潔感・身だしなみ","desc":"確認の要点：清潔な制服・エプロンを着用し、髪が作業や食品に触れないようまとめ、店舗指定の帽子等を使う。爪・装飾品なども作業前に確認する。\n例：作業前に制服・エプロン・爪などを確認し、髪をまとめて店舗指定の帽子等を使う。","row":36}],"quality":[{"id":"Q1","name":"分量・数量","desc":"確認の要点：指定材料・重量・個数・分量が会社の許容範囲内。\n例：指定重量を計量し、材料・個数・分量を確認して仕上げる。","row":7},{"id":"Q2","name":"仕上がり","desc":"確認の要点：大きさ・形・味・見た目が見本・仕上がり基準に適合。\n例：カットの大きさ・形や味・見た目を見本と照合する。","row":8},{"id":"Q3","name":"丁寧な扱い・仕上げ","desc":"確認の要点：不要なつぶれ・崩れ・傷みがなく、容器・保管まで整っている。\n例：食材をつぶさず扱い、崩れや傷みがない状態で容器に入れ、保管まで整える。","row":9}],"pay":[{"step":"P1","wageUsd":17,"speedMin":0,"speedInclusive":true,"rangeMin":0,"note":"見習い・最低段階。P2の条件に未到達","row":43},{"step":"P2","wageUsd":18,"speedMin":0.8,"speedInclusive":false,"rangeMin":0.6,"note":"速度0.80超かつ範囲60%以上","row":44},{"step":"P3","wageUsd":19,"speedMin":1,"speedInclusive":true,"rangeMin":0.7,"note":"速度1.00以上かつ範囲70%以上","row":45},{"step":"P4","wageUsd":20,"speedMin":1.2,"speedInclusive":true,"rangeMin":0.8,"note":"速度1.20以上かつ範囲80%以上","row":46},{"step":"P5","wageUsd":21,"speedMin":1.3,"speedInclusive":true,"rangeMin":0.9,"note":"速度1.30以上かつ範囲90%以上","row":47},{"step":"P6","wageUsd":22,"speedMin":1.5,"speedInclusive":true,"rangeMin":0.9,"note":"速度1.50以上かつ範囲90%以上","row":48}],"payNotes":{"speed":"スピード＝良品完成分の標準作業時間合計 ÷ 手直しを含む実作業時間。別日3回の最低値を使用し、会社の作業基準を1.00とする。","range":"習得範囲＝自立して安定完結できる作業の標準時間合計 ÷ 店舗で必要な全作業の標準時間合計。標準時間・品質基準は会社が実測・確認する。"}}},"base":{"G":{"1":55,"2":65,"3":75,"4":85,"5":90,"6":95},"S":{"1":65,"2":70,"3":75,"4":85,"5":90,"6":95}},"minimum":{"1":{"philoClass":1.5,"basic":1.5,"gMain":1.5,"gOther":1,"chefHygiene":1.5,"sQuality":1.5,"row":41},"2":{"philoClass":2,"basic":2,"gMain":2,"gOther":1.5,"chefHygiene":2,"sQuality":2,"row":42},"3":{"philoClass":2,"basic":2,"gMain":2,"gOther":1.5,"chefHygiene":2,"sQuality":2,"row":43},"4":{"philoClass":2.25,"basic":2,"gMain":2,"gOther":2,"chefHygiene":2.25,"sQuality":2.25,"row":44},"5":{"philoClass":2.5,"basic":2,"gMain":2.25,"gOther":2.25,"chefHygiene":2.5,"sQuality":2.5,"row":45},"6":{"philoClass":2.75,"basic":2,"gMain":2.5,"gOther":2.5,"chefHygiene":2.75,"sQuality":2.75,"row":46}},"minimumItems":{"fromGrade":2,"ids":["01-13","01-14","01-09","01-16"],"min":2,"systems":["G","S_CHEF","S_OFFICE"]}};

// ==== supabase/functions/secure-state/handler.mjs ====
// secure-state（v1139・段階 2b の 1 つ目）：成長カルテ・賞与のキーを、公開の鍵（anon）ではなくこの関数を通して読み書きする。
// 仕様：docs/SECURE_STATE_V1139_JA.md。
//
// ・データは今までどおり app_state の行（移さない・書き換えない）。この関数はサーバーの鍵（service role）で読み書きする。
//   公開の鍵で読めなくするのは、全部の端末を v1139 にしたあとの SQL（20261108090000：app_state の RLS）。
// ・だれか：PIN のログインの印（本文の pin_session）を work-requests の whoami に確かめてもらう（PIN を確かめるコードは
//   公開しないので、この関数は持たない）。または、メールのログイン（Authorization の Bearer）＋ manager_auth。
//   PIN の印があればそれを使う（その端末の前にいる人）。役割はサーバーが決める（端末の言う役割・名前は使わない）。
// ・CEO・GM（manager_auth の役割）：全部（full）。今までの画面と同じ（成長カルテ・賞与の画面は GM・CEO だけ）。
// ・それ以外の在籍の人（社員と結ばれた印）：画面が使う形だけ（proj）。
//     growth_karte → 全員の入社日（hireDate）と、本人（AM は担当の店・G4 以上は自分の店の人も）の「次期の目標」（終わっていないもの）
//                    （Career Score の強みのカードの「伸ばしていること」と、グレードの区間の入社日に使う）
//     karte_bonus_config → 査定の四半期（quarter）だけ（Career Score の基準点の四半期）
//   ほかのキーは返さない。書けない。
// ・PIN のログインの印が無い・確かめられない人：何も返さない（401）。
// ・v1140（段階 2b の 2 つ目）：Career Score の点・申請・履歴も（下の「v1140」の節・docs/SECURE_CS_V1140_JA.md）。取り込みは cs_have を送った
//   アプリ（v1140）にだけ cs の部分を付ける。答えにはいつも csfn:1（前の版の関数でないことの印）。
// ・v1141（段階 2b の 3 つ目）：ガソリン代の単価（mileage_config）と Score管理（career_cfg）は、決めた人だけがこの関数で書く（下の「v1141」の節・
//   docs/SECURE_SETTINGS_V1141_JA.md）。読むのは今までどおり公開の鍵で。答えにはいつも swfn:1。
// ・v1142（段階 2b の 4 つ目）：採用（応募者・不採用ログ）とお悩み相談室も、この関数で読み書きする（hr_get・hr_op・hr_match。
//   見られる範囲の分だけ返し、書くのは 1 件ずつ。docs/SECURE_HR_V1142_JA.md）。答えにはいつも hrfn:1。
// ・v1143（段階 2b の 5 つ目）：GM・CEO だけが変える賞与・Career Score の設定 8 つ（スコア基準・係数・係数の幅・G3 の職種・4 項目の設定・個人設定・
//   強みの決まり・評価基準・例）も、GM・CEO だけがこの関数で書く（v1141 と同じ道・SW2_KEYS・docs/SECURE_SETTINGS_V1143_JA.md）。答えにはいつも sw2:1。
// ・v1144（段階 2b の 6 つ目）：従業員の表の個人の欄（生年月日・会社カードの下 4 桁・保険の加入・保険料）を、app_state の emp_pii に置いて
//   この関数で読み書きする（pii_get・pii_op・card_match・ins_totals。下の「v1144」の節・docs/SECURE_PII_V1144_JA.md）。答えにはいつも piifn:1。
// ・v1145（段階 2b の 7 つ目）：グレード履歴（grade_hist）も、GM・CEO だけがこの関数で書く（Moto さん 11/10「GM,CEOです」。v1143 と同じ道・GH_KEYS・
//   docs/SECURE_GRADE_HIST_V1145_JA.md）。読むのは今までどおり公開の鍵で。答えにはいつも ghfn:1。
// ・v1146（段階 2b の 8 つ目）：Tip Rate の申請・決定（spl_tip_requests_<名前>）とプレップの時給の表・認定（prep_tables・prep_certs）も、
//   この関数で書く（今の画面で決められる人だけ。下の「v1146」の節・docs/SECURE_TIP_PREP_V1146_JA.md）。読むのは今までどおり公開の鍵で。答えにはいつも tpfn:1。
// ・v1147（段階 2b の 9 つ目）：Tip の期間の確定（tip_cf_<店>_<年>）と注意ログ（warnings_<店>）も、この関数で読み書きする（見られる店の行だけ。
//   取り込みは sc_have を送ったアプリにだけ sc の部分を付ける。下の「v1147」の節・docs/SECURE_TIP_CF_V1147_JA.md）。答えにはいつも scfn:1。
// ・v1148（段階 2b の 10 個目）：グレード履歴（grade_hist）・賞与の個人設定（bonus_eval_ovr）・G3 の職種（bonus_track）も、読むのはこの関数で
//   （Moto さん 11/10「Career Score と同じ範囲に」：GM・CEO 以外は Career Score で見られる人と本人の記録だけ。経理・事務Crew のグレード履歴は全部＝HR・福利厚生の画面）。
//   書くのは今までどおり GM・CEO だけ（swPut）。取り込みは gb_have を送ったアプリにだけ gb の部分を付ける。下の「v1148」の節・
//   docs/SECURE_GRADE_BONUS_READ_V1148_JA.md）。答えにはいつも gbfn:1。
// ・v1192：人件費の合計（labor）。経理・AM の端末には全員の時給が届かなくなる（emp-private v1192）ので、店・月ごとのお金の合計だけを
//   この関数が出す（計算は index.html の関数そのもの＝labor-core.gen.mjs・labor.mjs。人ごとの額は返さない。docs/LABOR_TOTALS_V1192_JA.md）。答えにはいつも ltfn:1。
// ・v1193（UI案95）：画面の表示の設定（どの役職・グレードの人にどの画面を出すか）。表 pv_doc の 1 行を、GM・CEO だけが書く（pv_full・pv_save・pv_log）。
//   ログインした人には、自分の列（グレード・役職ごと）と自分の例外と「指定スタッフ限定」に自分が入っているかだけを返す（pv_get。ほかの人の例外は返さない）。
//   画面の出し分けだけで、データを読める範囲は変えない（読める範囲は今までどおり、ほかの頼みが決める）。docs/PAGE_VIEW_V1193_JA.md。答えにはいつも pvfn:1。
// ・v1195（UI案96 の段階 2 の ①）：所属の確認。表 aff_people（人ごとに、GM・CEO が確かめた所属＝本部か店か・応援）を GM・CEO だけが書く（aff_full・aff_save）。
//   ログインした人には自分の行だけ（aff_get）。この版では見え方は変えない（v1196 から）。docs/UNIFIED_UI_V1191_JA.md の 18。答えにはいつも affn:1。


export const SS_KEYS = ['growth_karte', 'karte_pin', 'karte_bonus_config', 'bonus_q', 'bonus_eval', 'bonus_store_q', 'bonus_rules', 'bonus_pool_extra'];
export const SS_PREFIX = ['spl_bonus_q_'];
export const SS_PROJ = ['growth_karte', 'karte_bonus_config'];
export const SS_FULL_ROLES = ['ceo', 'gm'];
const MGR_ROLES = ['ceo', 'gm', 'office', 'office_crew'];
// v1151：変更の記録（change_log）を見られる役割・読める表・道・端末の種類
export const CL_ROLES = ['ceo', 'gm', 'office', 'office_crew'];
export const CL_SRC = ['app_state', 'app_settings', 'stores', 'employees', 'ingredients', 'recipes', 'vendors', 'categories'];
export const CL_VIA = ['app', 'fn', 'old', 'server', 'sql'];
export const FP_KINDS = ['pc', 'iphone', 'ipad', 'android', 'tablet', 'other'];
export const SS_PREFIX_RE = /^spl_bonus_q_[0-9A-Za-z_-]{1,40}$/;   // spl_bonus_q_<四半期>（アプリ・SQL と同じ決まり）
export function ssIsKey(k) {
  if (typeof k !== 'string' || !k || k.length > 200) return false;
  if (SS_KEYS.includes(k)) return true;
  return SS_PREFIX_RE.test(k);
}

// ---- v1140（段階 2b の 2 つ目）：Career Score の点・申請・履歴（仕様：docs/SECURE_CS_V1140_JA.md）
//   lss_emp_<名前>（点）・spl_lss_requests_<名前>（申請）・spl_lss_history_<名前>（履歴・開いたときだけ取る）と、前の統合行
//   lss_scores・lss_requests・lss_history。名前はアプリの従業員の名前そのまま（空白・日本語もある）。
//   CEO・GM：全部（full）。ほかの在籍の人：見られる人の行だけ（scoped・行は丸ごと）。前の統合行は見られる人の分だけ（見せる形・書けない）。
//   見られる人（Moto さん 11/04 の回答）：AM＝担当の店（応援も）・G4＝自分の店の G4 以下・G3＝自分の店の G1・G2・Crew Leader（G2）＝自分の店の G1・
//   Head Chef＝全店の G1（申請は全店）・経理・事務Crew＝本部の人（Office管理のメンバー）・それ以外＝自分だけ。Score管理（career_cfg）で
//   見る・付ける・承認する役にした人も。店のログインなど＝なし。
//   v1144（Codex #138 P1-1）：Head Chef の広い範囲は、GM・CEO が確かめた写しでも Head Chef の人だけ（確かめるまでは G4 の範囲）。
export const CS_PREFIX = ['lss_emp_', 'spl_lss_requests_', 'spl_lss_history_'];
export const CS_LEGACY = ['lss_scores', 'lss_requests', 'lss_history'];
export function csIsKey(k) {
  if (typeof k !== 'string' || !k || k.length > 400) return false;
  if (CS_LEGACY.includes(k)) return true;
  return CS_PREFIX.some(p => k.length > p.length && k.startsWith(p));
}
// { kind: emp|req|hist|legacy, name }
export function csParse(k) {
  if (!csIsKey(k)) return null;
  if (CS_LEGACY.includes(k)) return { kind: 'legacy', name: '' };
  if (k.startsWith('lss_emp_')) return { kind: 'emp', name: k.slice(8) };
  if (k.startsWith('spl_lss_requests_')) return { kind: 'req', name: k.slice(17) };
  return { kind: 'hist', name: k.slice(16) };
}
// 公開の鍵から外すキー（SQL の ss_secret_key と同じ：成長カルテ・賞与＋Career Score）
export const secretKey = k => ssIsKey(k) || csIsKey(k);

// ---- v1141（段階 2b の 3 つ目）：決めた人だけが書ける設定（docs/SECURE_SETTINGS_V1141_JA.md）
//   サーバーが値を信じて使うキー。読むのは今までどおり公開の鍵で（どの画面も読む）。書くのはこの関数だけ（SQL 20261110090000 で
//   公開の鍵の足す・直す・消すを止める）。
//     mileage_config：ガソリン代の単価（work-requests の wr_mileage_rate が精算の金額に使う）・地図の鍵・往復の既定 → CEO・GM・経理（Moto さん 11/04）
//     career_cfg：Score管理（専門職 × グレードの権限。この関数の Career Score の範囲に使う）→ GM・CEO（今の画面と同じ）
//   役割はサーバーが決める（PIN の印は work-requests の whoami・メールのログインは manager_auth）。端末の言う役割は使わない。
// v1143（段階 2b の 5 つ目・docs/SECURE_SETTINGS_V1143_JA.md）：GM・CEO だけが変える賞与・Career Score の設定（今の画面と同じ）。
//   どれもアプリが計算・表示に使う（サーバーは読まない）。公開の鍵で書けると、賞与の係数・基準・個人の設定を書き換えられた。読むのは今までどおり。
//     cs_criteria：スコア基準（昇格の判定と賞与 ① の基準ライン）／bonus_coef・bonus_coef_rng：グレード・職種の係数と幅／
//     bonus_track：その四半期に選んだ G3 の職種／bonus_eval_rule：4 項目の設定（会社共通・グレード・職種）／bonus_eval_ovr：個人設定／
//     cs_strength_rule：強みの決まり（表示）／cs_guide：評価基準・例の文
export const SW2_KEYS = ['cs_criteria', 'bonus_coef', 'bonus_coef_rng', 'bonus_track', 'bonus_eval_rule', 'bonus_eval_ovr', 'cs_strength_rule', 'cs_guide'];
// v1145（Moto さん 11/10「GM,CEOです」・docs/SECURE_GRADE_HIST_V1145_JA.md）：グレード履歴（社員ごとの確定日・前後のグレード・前のグレードの期間の評価）。
//   賞与の日割り（区間ごとのグレード）にアプリが使う。公開の鍵で書けると、確定日・グレード・確定した評価を書き換えられた。
//   形は v1143 の 8 つと同じ「キー（社員 ID）→ 記録（オブジェクトか null）」の地図。前の関数（v1144 以前）は「知らないキー」と断るだけで何も書かない
export const GH_KEYS = ['grade_hist'];
// v1192（Codex 6986713362 の P2-1）：ダッシュボードで全店を見る AM（GM・CEO が「管轄の割り当て」で決める）の、GM・CEO だけが書ける写し。
//   人件費の合計（labor）を全店で返すかは、これだけで決める。前は app_settings の md_all_viewers（公開の鍵で書ける）で決めていたので、
//   AM が自分の行を書き足すと、担当外の店の人件費の合計まで受け取れた。形は grade_hist と同じ「社員 ID → 記録（オブジェクトか null）」の地図。
//   公開の鍵で書けなくするのは SQL 20261210090000（ss_guard_key に足す・今の md_all_viewers を 1 回だけ写す）
export const LV_KEYS = ['md_all_viewers_gm'];
export const SW_WRITE = { mileage_config: ['ceo', 'gm', 'office'], career_cfg: ['ceo', 'gm'], ...Object.fromEntries(SW2_KEYS.map(k => [k, ['ceo', 'gm']])),
  ...Object.fromEntries(GH_KEYS.map(k => [k, ['ceo', 'gm']])), ...Object.fromEntries(LV_KEYS.map(k => [k, ['ceo', 'gm']])) };
export function swIsKey(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(SW_WRITE, k); }
// 値の形（決めた人が書くときに確かめる：おかしな単価で、ガソリン代の申請が全部止まらないように）
//   mileage_config：アプリが書く形（包まない）だけ。包んだ形（{__st:…}）は断る（wr_mileage_rate は中身を読み、アプリの画面は外を読むので、
//     外と中で違う単価になる。アプリは書かない＝独立レビュー P3-1）。単価は 0.01〜5（それより小さいと短い距離が 0 セントになり申請が止まる）。
//   career_cfg：'<部門>|<G>' ごとの記録（オブジェクトか null）の地図。おかしな記録は、クラウドにもうある同じ記録だけ通す
//     （ほかの人が前に入れたものが残っていても、GM・CEO の保存が止まらないように＝独立レビュー P2-1。新しく入れることはできない）。
//   v1143 の 8 つ・v1145 の grade_hist：career_cfg と同じ「キー → 記録（オブジェクトか null）」の地図（キーは 200 字まで）。おかしな記録は、クラウドにもうある同じ記録だけ通す。
export function swCgEntryOk(k, x, max = 100) { return typeof k === 'string' && k.length <= max && (x === null || (typeof x === 'object' && !Array.isArray(x))); }
export function swCgBadKeys(value, max = 100) { return (value && typeof value === 'object' && !Array.isArray(value)) ? Object.keys(value).filter(k => !swCgEntryOk(k, value[k], max)) : []; }
const swMapMax = key => (key === 'career_cfg' ? 100 : 200);
const swMapKey = key => key === 'career_cfg' || SW2_KEYS.includes(key) || GH_KEYS.includes(key) || LV_KEYS.includes(key);
export function swShapeOk(key, value, cloud) {
  let s;
  try { s = JSON.stringify(value === undefined ? null : value); } catch { return false; }
  if (key === 'mileage_config') {
    if (s.length > 20000) return false;
    const v = value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (Object.prototype.hasOwnProperty.call(v, '__st')) return false;   // 包んだ形は書かない（上）
    const r = v.ratePerMile;
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0.01 || r > 5) return false;   // 0.01〜5（wr_mileage_rate が使える単価で、短い距離も 1 セント以上）
    if (v.gmapsKey !== undefined && v.gmapsKey !== null && (typeof v.gmapsKey !== 'string' || v.gmapsKey.length > 300)) return false;
    if (v.roundTripDefault !== undefined && typeof v.roundTripDefault !== 'boolean') return false;
    return true;
  }
  if (swMapKey(key)) {
    if (s.length > (key === 'career_cfg' ? 1000000 : 6000000)) return false;   // v1143 の 8 つ・grade_hist は 600 万字まで（本文の上限 800 万字の内側。履歴を持つ評価基準・例・個人設定・グレード履歴が大きくなっても GM・CEO の保存を止めない）
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const c = (cloud && typeof cloud === 'object' && !Array.isArray(cloud)) ? cloud : null;
    return swCgBadKeys(value, swMapMax(key)).every(k => !!c && Object.prototype.hasOwnProperty.call(c, k) && canon(c[k]) === canon(value[k]));
  }
  return false;
}
// ---- v1146（段階 2b の 8 つ目・Moto さん 11/10「Tip Rate とプレップから」・docs/SECURE_TIP_PREP_V1146_JA.md）
//   Tip Rate の申請・決定（spl_tip_requests_<名前>・前の統合行 tip_requests）、プレップの時給の表（prep_tables）と認定（prep_certs）。
//   チップの配分（v1092 から Tip Rate で）と時給（v1106 から認定の Lv × 表）にアプリが使う。公開の鍵で書けると、自分の Tip Rate を「承認」にする・
//   時給の表を書き換える・自分の認定を足す、ができた。読むのは今までどおり公開の鍵で（どの端末も配分と人件費を計算する）。書くのはこの関数だけ。
//   だれが何を変えてよいかは、今の画面で決められる人と同じ（Moto さん 11/10「今の画面で決められる人だけ」）：
//     Tip Rate の承認・却下・引き上げ（自分の Tip Rate は決めない・店では分けない＝今の画面と同じ）：
//       CEO・GM・確かめた AM（いつも）。役割 g4 の人・Head Chef（GM・CEO が確かめた G4）は、ワークセンターを使い始めるまで（使い始めたら GM に申請＝v1135）。
//       Corporate Chef（GM・CEO が確かめた G5 の Head Chef の印）はいつも（画面の決まりと同じ）。役割は今の社員の表（画面と同じ）・グレードは確かめた写しとの狭いほう。
//     Tip Rate の申請（申請中を足す）：本人だけ。決めたものは消さない・申請中に戻さない（決め直しは、前の決定より新しい決定だけ＝v1091 の合流と同じ）。
//     承認センターが記録に付ける印（_dG・_stK・_stT・_dT・_mut：率・状態・決めた人は変えない。v1087）は、だれでも付け直せる（古い写しの端末が外すことも＝今までの合流と同じ）。
//     本人かは、名前をそろえて（全角・空白・大文字）この人の名前（PIN の印・確かめた写し・社員の表の自分の行）と比べる。名前が分からない人は決めない・申請しない。
//     前の統合行（tip_requests）：だれも変えない（読むだけ。v720 からアプリは書かない。Codex #140 6766283780）。
//     プレップの時給の表：GM・CEO。プレップの認定：GM・CEO（申請・承認・却下・直接決める・表の切り替え・指定を外す）。「反映した」の印だけは経理も。
//   決めた人でなくても、クラウドと同じ値なら書かずに通す（v1141 と同じ）。前の決定より古い写しの送り直しも（covers：アプリが書かない）。
//   書くのは、確かめた行が変わっていないときだけ（読んだ行で確かめ、その行に条件を付けて書く。違えば 409）。
export const TP_KEYS = ['prep_tables', 'prep_certs', 'tip_requests'];
export const TP_TIP_PRE = 'spl_tip_requests_';
// spl_tip_requests_ で始まる名前は長さによらず（SQL の ss_guard_key と同じ。アプリはこの名前で始まる行をすべて Tip Rate として読む）。書くのは 200 字までの名前だけ（tpPut）
export function tpIsKey(k) { return typeof k === 'string' && (TP_KEYS.includes(k) || (k.startsWith(TP_TIP_PRE) && k.length > TP_TIP_PRE.length)); }
export const TIP_DECIDE = ['ceo', 'gm', 'am'];
// 社員の変更記録（前の名前）を読む 1 回の件数と、読む回数の上限（Codex #141 6784041763 の P2。読み切れなければ決めない）
export const TIP_PAST_PAGE = 1000, TIP_PAST_PAGES = 200;
const TIP_ST = ['申請中', '承認', '却下'];
const TIP_DEC_FIELDS = ['approver', 'approvedDate', 'decAt', 'decDay', 'decHst', 'fromDay', 'prevRate'];
// 承認センターの印（v1087 の _apSyncRecStamp・_apRecordState）。率・状態・決めた時刻（decAt）ではない（配分にも Tip Rate にも使わない）
export const TIP_STAMPS = ['_dG', '_stK', '_stT', '_dT', '_mut'];
function tipStampsOk(r) {
  for (const k of TIP_STAMPS) {
    if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
    const v = r[k];
    if (v === null || v === undefined || v === '') continue;
    if (k === '_stK') { if (typeof v !== 'string' || v.length > 120) return false; continue; }
    const n = typeof v === 'string' && v.length <= 20 ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false;
  }
  return true;
}
const hasV = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null && o[k] !== '';
// 名前をそろえる（本人かを見るため）：NFKC・空白を 1 つに・前後の空白を取る・小文字
export const tipNk = s => typeof s === 'string' ? s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() : '';
const tipDecT = r => { const t = Number(r && r.decAt); return Number.isFinite(t) && t > 0 ? t : 0; };
const tipId = r => (r && (typeof r.id === 'string' || typeof r.id === 'number')) ? String(r.id) : null;
const omit = (o, ks) => { const x = {}; for (const k of Object.keys(o || {})) if (!ks.includes(k)) x[k] = o[k]; return x; };
// 1 件の形（Tip Rate）：id・名前（行の名前と同じ）・状態・率（0〜100）
function tipEntryOk(r, name) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const id = tipId(r); if (!id || id.length > 80) return false;
  if (r.name !== name) return false;
  if (!TIP_ST.includes(r.status)) return false;
  const rt = Number(r.rate); if (!Number.isFinite(rt) || rt < 0 || rt > 100) return false;
  return true;
}
// 書いてよいか：'ok'・'forbidden'（この人は変えられない）・'bad'（形がおかしい）。cloud はいまのクラウドの値（無ければ null）
//   a：{ role, name, dec }（name は社員の表・GM・CEO が確かめた写し。本人かどうかに使う。dec：Tip Rate を決められる人か＝関数の tipDecider）
export function tpCheck(key, cloud, value, a) {
  let s; try { s = JSON.stringify(value === undefined ? null : value); } catch { return 'bad'; }
  if (s.length > 4000000) return 'bad';
  const role = a && a.role, top = role === 'ceo' || role === 'gm';
  if (key === 'prep_tables' || key === 'prep_certs') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'bad';
    const c = (cloud && typeof cloud === 'object' && !Array.isArray(cloud)) ? cloud : {};
    // 形のおかしな記録は、クラウドにもうある同じ記録だけ（v1143 と同じ）
    if (!swCgBadKeys(value, 200).every(k => Object.prototype.hasOwnProperty.call(c, k) && canon(c[k]) === canon(value[k]))) return 'bad';
    if (top) return 'ok';
    if (key === 'prep_tables' || role !== 'office') return 'forbidden';
    // 経理：承認した認定に「反映した」の印を付けるだけ（中身はそのまま。時刻 _at は進む）
    for (const id of new Set([...Object.keys(c), ...Object.keys(value)])) {
      const o = c[id], n = value[id];
      if (canon(o === undefined ? null : o) === canon(n === undefined ? null : n)) continue;
      if (!o || !n || typeof o !== 'object' || typeof n !== 'object') return 'forbidden';
      if (o.state !== 'approved' || n.state !== 'approved' || (o.toast && o.toast.at)) return 'forbidden';
      const tt = n.toast;
      if (!tt || typeof tt !== 'object' || Array.isArray(tt) || typeof tt.at !== 'string' || !tt.at || tt.at.length > 40 || typeof tt.by !== 'string' || tt.by.length > 120 || Object.keys(tt).some(k => k !== 'at' && k !== 'by')) return 'forbidden';
      if (canon(omit(o, ['toast', '_at'])) !== canon(omit(n, ['toast', '_at']))) return 'forbidden';
    }
    return 'ok';
  }
  if (key === 'tip_requests') {
    // 前の統合行（全員の分）：読むだけ（Codex #140 6766283780 の P2）。v720 から、アプリは人ごとの行に書き、この行には書かない
    // （統合行にしか無い記録を人ごとの行へ移すのは端末の中だけ。クラウドの統合行には触らない）。アプリはこの行の記録も読む（_splitRead）ので、
    // 変えられると人ごとの行の決まり（自分の Tip Rate は決めない・申請は本人だけ・決めたものは消さない）を通らずに Tip Rate を変えられた。
    // クラウドと同じ値は tpPut が書かずに通す。それ以外はだれも変えない（GM・CEO も）
    if (!Array.isArray(value)) return 'bad';
    return canon(cloud === undefined ? null : cloud) === canon(value) ? 'ok' : 'forbidden';
  }
  // spl_tip_requests_<名前>
  const name = key.slice(TP_TIP_PRE.length);
  if (!Array.isArray(value) || value.length > 2000) return 'bad';
  const C = Array.isArray(cloud) ? cloud : [];
  const cBy = new Map(); for (const r of C) { const id = tipId(r); if (id != null) cBy.set(id, r); }
  const nBy = new Map();
  for (const r of value) {
    const id = tipId(r);
    if (id == null || nBy.has(id)) return 'bad';
    nBy.set(id, r);
    if (!tipEntryOk(r, name) && !(cBy.has(id) && canon(cBy.get(id)) === canon(r))) return 'bad';   // 形のおかしな記録は、クラウドにもうある同じ記録だけ
  }
  // 本人か（Codex #140 6766283780 の P3）：名前の書き方の違い（全角・空白・大文字）をそろえ、この人の名前（PIN の印・確かめた写し・社員の表の
  // 自分の行：tpPut の tipActorNames）のどれかと同じなら本人。名前が 1 つも分からない人は、本人かを決められないので決めない・申請もしない
  const mine = new Set([a && a.name, ...((a && Array.isArray(a.names)) ? a.names : [])].map(tipNk).filter(Boolean));
  const self = mine.has(tipNk(name));
  // 決める人が自分の分かを見るときは、前の名前（社員の変更記録 employee_field_log：サーバーだけの表）も本人の名前とみなす。
  // 社員の表の名前は公開の鍵で書けるので、名前を変えてから前の名前の申請を承認する道を止める（Codex #141 6781928056 の P2-2）。
  // 申請（本人だけ）は今の名前だけ（前の名前で、いまその名前のほかの人の申請を足さない）
  const past = new Set(((a && Array.isArray(a.past)) ? a.past : []).map(tipNk).filter(Boolean));
  const decider = !!(a && a.dec) && mine.size > 0 && !self && !past.has(tipNk(name));
  for (const [id, o] of cBy) {
    const n = nBy.get(id);
    if (!n) return 'forbidden';   // 消さない（だれも）
    if (canon(o) === canon(n)) continue;
    if (!tipStampsOk(n)) return 'bad';
    // 承認センターの印だけが違う：だれでも（付け直す・古い写しが外す。率・状態・決めた時刻は同じ）
    if (canon(omit(o, TIP_STAMPS)) === canon(omit(n, TIP_STAMPS))) continue;
    if (!decider) return 'forbidden';
    if (!tipEntryOk(n, name) || n.name !== o.name || Number(n.rate) !== Number(o.rate)) return 'forbidden';
    if (o.status === '申請中') continue;   // 承認・却下（決める）・申請中のまま（決める人だけが直す）
    // 決めたもの：前の決定より新しい決定だけ（v1091 の合流と同じ。時刻の無い前の記録に時刻を付けるのも）。申請中には戻さない
    if (n.status === '申請中' || !(tipDecT(n) > tipDecT(o))) return 'forbidden';
  }
  for (const [id, n] of nBy) {
    if (cBy.has(id)) continue;
    if (!tipStampsOk(n)) return 'bad';
    if (n.status === '申請中') {   // 申請：本人だけ・決めた印なし
      if (!self || TIP_DEC_FIELDS.some(k => hasV(n, k))) return 'forbidden';
      continue;
    }
    // 引き上げ（決める人が、ほかの人の）。前の統合行にだけあった前の決定（時刻なし）を人ごとの行へ移すのも（v720 の畳み込み）
    if (decider) continue;
    return 'forbidden';
  }
  return 'ok';
}
// ---- v1142（段階 2b の 4 つ目）：採用（応募者・不採用ログ）とお悩み相談室（docs/SECURE_HR_V1142_JA.md）
//   applicants・reject_log・growthhub は、どれも app_state の 1 行（配列）。読むのも書くのもこの関数で（公開の鍵から外すのは、全部の端末を
//   1142 にしたあとの SQL 20261111090000）。見られる範囲はサーバーが決め、範囲の分だけ返す。書くのは 1 件ずつ（hr_op）：
//   サーバーが行を読み、その 1 件だけを直して、読んだ行が変わっていないときだけ書く（一部だけの写しで全体を上書きしない）。
//     応募者：CEO・GM・経理＝全部／AM＝確かめた担当の店＋「未分類」／G4＝自分の店＋「未分類」／店長・リーダー（SL・G2）＝自分の店／ほか＝なし
//     不採用ログ：応募者と同じ範囲（Moto さん 11/04：全部は CEO・GM・経理だけ）。足すのは「不採用にする」（hr_op reject）だけ
//     応募の入力の「前に不採用」の確かめ（hr_match）：全店の不採用ログから、当たった分だけ（日付・店・理由・メモ）
//     お悩み相談室：CEO・GM・経理＝全部／AM＝担当の店／G4・店長（SL の Store Manager）＝自分の店／ほか＝自分の相談だけ（今の画面と同じ）
export const HR_KEYS = ['applicants', 'reject_log', 'growthhub'];
export function hrIsKey(k) { return typeof k === 'string' && HR_KEYS.includes(k); }
const HR_ALL = ['ceo', 'gm', 'office'];
const HR_LABEL = { ceo: 'CEO', gm: 'GM', office: '経理' };
const HR_UNSORTED = '未分類';
const HR_CID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const AP_ACTIVE = ['応募中', '新規応募', '要確認'];
const HR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function hrStr(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : (typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : ''); }
// 前に不採用の人か（アプリの findPriorRejects と同じ：名前・電話（7 桁以上）・メールのどれかが同じ）
export function hrMatches(probe, log) {
  const name = String((probe && probe.name) || '').trim().toLowerCase();
  const phone = String((probe && probe.phone) || '').replace(/[^0-9]/g, '');
  const email = String((probe && probe.email) || '').trim().toLowerCase();
  return (Array.isArray(log) ? log : []).filter(r => {
    if (!r || typeof r !== 'object') return false;
    const rn = String(r.name || '').trim().toLowerCase(), rp = String(r.phone || '').replace(/[^0-9]/g, ''), re = String(r.email || '').trim().toLowerCase();
    return (!!name && rn === name) || (!!phone && phone.length >= 7 && rp === phone) || (!!email && re === email);
  });
}
// 当たった不採用の記録から見せる分（名前・電話・メールは出さない＝入れた人がもう知っている）
export function hrPrior(r) { return { rejectDate: hrStr(r.rejectDate, 40), store: hrStr(r.store, 80), reason: hrStr(r.reason, 300), memo: hrStr(r.memo, 2000) }; }
// 応募者の 1 件（アプリが送る形）。_ で始まる欄（_prior など、この関数が付けたもの）は落とす
export function hrApClean(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const x = {};
  for (const [k, v] of Object.entries(rec)) if (k.charAt(0) !== '_') x[k] = v;
  if (typeof x.id !== 'string' || !HR_ID_RE.test(x.id)) return null;
  if (typeof x.store !== 'string' || !x.store.trim() || x.store.length > 80) return null;
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 200) return null;
  if (typeof x.status !== 'string' || x.status.length > 40) return null;
  let s; try { s = JSON.stringify(x); } catch { return null; }
  if (s.length > 50000) return null;
  return x;
}
export function hrApStrip(rec) {
  const x = {};
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) for (const [k, v] of Object.entries(rec)) if (k.charAt(0) !== '_') x[k] = v;
  return x;
}
// ---- v1144（段階 2b の 6 つ目）：従業員の表の個人の欄（docs/SECURE_PII_V1144_JA.md）
//   生年月日（dob）・会社カードの下 4 桁（cardLast4）・医療／歯科保険の加入（insurance・dental）・会社負担の保険料（月額・insuranceAmt）は、
//   従業員の表（公開の鍵で読める）から外し、app_state の 1 行 emp_pii（社員 ID → 欄）に置く。読み書きはこの関数で（pii_get・pii_op）。
//   SQL 20261113090000 が、従業員の表に残っている欄を emp_pii に写して消す（それまでは、emp_pii に無い人は従業員の表の値を読む）。
//   見られる人（Moto さん 11/09：今の従業員マスターと同じ）：CEO・GM＝全員の 5 つ／経理・Head Chef＝全員の 4 つ（保険料を除く）／
//   AM＝担当の店（応援も）と全店（ALL）の人の 4 つ（本部（OFFICE）の人は応援が担当の店のときだけ。v1207 で一覧には出すが、個人の欄は出さない＝Moto さん 11/23「C」）／
//   事務Crew＝生年月日があるかだけ（エラーセンターの確かめ）／ほか＝なし。全員ではない人（AM）には、見られる人の社員 ID（ids）も返す（アプリが個人の欄を止める）。
//   Head Chef は、今の社員の表と GM・CEO が確かめた写し（wr_people.chef・SQL 20261113080000）の両方で Head Chef の人だけ（Codex #138 P1-1）。
//   保険料（人ごと）は GM・CEO だけ（今の画面で直せる人）。店ごとの合計（人件費に入れる）はだれにでも返す（ins_totals・ログイン不要。
//   店舗の PIN のタブレットでも人件費が今と同じになるように。Moto さん 11/09）。
//   カードの下 4 桁の照合（card_match）：レシート管理を使える人（自分の PIN・メールのログイン）に、当たった人の ID と名前だけ（Moto さん 11/09）。
export const PII_KEY = 'emp_pii';
export const PII_FIELDS = ['dob', 'cardLast4', 'insurance', 'dental', 'insuranceAmt'];
export const PII_HR = ['dob', 'cardLast4', 'insurance', 'dental'];
const PII_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function piiIsKey(k) { return k === PII_KEY; }
// 比べるための形（空・無い・false をそろえる。アプリの piiCmp と同じ）
export function piiCmp(k, v) {
  if (k === 'insurance' || k === 'dental') return v === true || v === 'true';
  if (k === 'insuranceAmt') { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  return v == null ? '' : String(v).trim();
}
// 書くときの形（おかしな値は undefined＝断る）
export function piiValid(k, v) {
  if (k === 'dob') {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const [y, m, d] = v.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
    if (y < 1900 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined;
    return v;
  }
  if (k === 'cardLast4') {
    if (v === '' || v === null || v === undefined) return '';
    return typeof v === 'string' && /^\d{4}(,\d{4}){0,9}$/.test(v) ? v : undefined;
  }
  if (k === 'insurance' || k === 'dental') return typeof v === 'boolean' ? v : undefined;
  if (k === 'insuranceAmt') {
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : undefined;
  }
  return undefined;
}
// 返すときの形（前からの値は形を問わず、短い文字・真偽・数だけ）
function piiOut(v) {
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 200);
  return null;
}
// 退職・OS を止めた人（work-requests の wr_emp_out と同じ）
const empOut = e => { const d = obj(e && e.data) || {}; return String((e && e.status) || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true'; };
// 肩書きと役割からのグレード（SQL の wr_grade と同じ。大きいほう）
const TITLE_G = { 'General Manager': 6, 'Area Manager': 5, 'Corporate Chef': 5, 'Customer Service Manager': 5, 'Store Manager': 4, 'Head Chef': 4, 'Office Manager': 4, 'Accountant': 4,
  'Server Leader': 3, 'Kitchen Leader': 3, 'Operation Leader': 3, 'Store Leader': 3, 'Accounting Leader': 3, 'Crew Leader': 2, 'Office Crew Leader': 2,
  'Crew': 1, 'Office Crew': 1, 'Office Staff': 1, 'Prep': 1, 'Prep Specialist': 1 };
const ROLE_G = { ceo: 7, gm: 6, am: 5, g4: 4, chef: 4, sl: 3, g2: 2 };
export function wrGrade(title, role) {
  const t = Object.prototype.hasOwnProperty.call(TITLE_G, String(title == null ? '' : title).trim()) ? TITLE_G[String(title).trim()] : 0;
  const r = Object.prototype.hasOwnProperty.call(ROLE_G, String(role || '')) ? ROLE_G[role] : 1;
  return Math.max(t, r);
}
// アプリの empGrade（肩書きが先・無ければ役割）と cgPermOf（専門職 × グレードの権限の行）
const APP_TITLE_G = { G1: ['Crew', 'Office Crew', 'Office Staff', 'Prep', 'Prep Specialist'], G2: ['Crew Leader', 'Office Crew Leader'],
  G3: ['Server Leader', 'Kitchen Leader', 'Operation Leader', 'Store Leader', 'Accounting Leader'], G4: ['Store Manager', 'Head Chef', 'Office Manager', 'Accountant'],
  G5: ['Area Manager', 'Corporate Chef', 'Customer Service Manager'], G6: ['General Manager'] };
const APP_ROLE_G = { gm: 'G6', am: 'G5', g4: 'G4', chef: 'G4', sl: 'G3', g2: 'G2', crew: 'G1', office_crew: 'G1' };
export function appGrade(title, role) {
  for (const g of Object.keys(APP_TITLE_G)) if (title && APP_TITLE_G[g].includes(title)) return g;
  return APP_ROLE_G[role] || '';
}
const SPEC_DEPTS = ['経理', '調理', 'サービス', 'マーケ'];
const TITLE_DEPT = { 'Accountant': '経理', 'Office Manager': '経理', 'Office Crew Leader': '経理', 'Accounting Leader': '経理', 'Head Chef': '調理', 'Corporate Chef': '調理', 'Customer Service Manager': 'サービス' };
const CHEF_TITLES = ['Head Chef', 'Corporate Chef'];
// 社員の表（今）で Head Chef か：役割 chef か、肩書きが Head Chef・Corporate Chef（列、無ければ中身）。SQL の wr_chef と同じ決まり（列で見る）
const liveChef = e => { const d = obj(e && e.data) || {}; return String((e && e.role) || d.role || '') === 'chef' || CHEF_TITLES.includes(String((e && e.title) || d.title || '').trim()); };
const HQ_ROLES = ['office', 'office_crew', 'chef'];   // 経理・事務Crew が見る本部の人（Office管理のメンバー）
const OFFICE_ROLES = ['office', 'office_crew'];
// キーの順によらない文字（クラウドの jsonb はキーを並べ替えて返す）
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const pendingSt = s => s == null || s === '申請中';

const safeErr = e => String((e && (e.code || e.message)) || e || 'error').replace(/(key|token|secret|bearer|pin)[^\s]*/gi, '$1:***').slice(0, 200);
const err = (code, status) => { const e = new Error(code); e.code = code; e.status = status; return e; };
const bad = () => err('bad_value', 400);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x && x.length <= 64) : []);
const te = new TextEncoder();
const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', te.encode(String(s)))); }

// ================================================================ v1147：Tip の期間の確定（tip_cf_<店>_<年>）・注意ログ（warnings_<店>）（docs/SECURE_TIP_CF_V1147_JA.md）
// 店ごとの行（丸ごと）。見られる店の行だけを返し、書くのも見られる店の行だけ（今の画面と同じ。Moto さん 11/10「読む人も書く人も絞る」）。
// キーの決まり（アプリの scIsKey・SQL の ss_secret_key と同じ）：tip_cf_ か warnings_ で始まり、その後ろに 1 文字以上（200 字まで）。
export const SC_TIP_PRE = 'tip_cf_', SC_WN_PRE = 'warnings_';
export function scIsKey(k) {
  return typeof k === 'string' && k.length <= 200
    && ((k.startsWith(SC_TIP_PRE) && k.length > SC_TIP_PRE.length) || (k.startsWith(SC_WN_PRE) && k.length > SC_WN_PRE.length));
}
// { kind: 'tip'|'wn', store, year }。tip_cf_ の形（tip_cf_<店>_<4 桁の年>）でなければ store は null（全店を見られる人にだけ見える・だれも書かない）
export function scParse(k) {
  if (!scIsKey(k)) return null;
  if (k.startsWith(SC_TIP_PRE)) { const m = /^tip_cf_(.+)_(\d{4})$/.exec(k); return { kind: 'tip', store: m ? m[1] : null, year: m ? m[2] : null }; }
  return { kind: 'wn', store: k.slice(SC_WN_PRE.length), year: null };
}
// 見られるか（sc：scScope の答え）
export function scCanRead(k, sc) {
  const p = scParse(k);
  if (!p || !sc) return false;
  if (!(p.kind === 'tip' ? sc.tip : sc.wn)) return false;
  return sc.all || (p.store != null && sc.stores.includes(p.store));
}
const asVal = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; };   // 前の版が JSON の文字で書いた行
// Tip の期間の確定：{ 初日（YYYY-MM-DD）: 記録 }。記録は確定（status 確定済み・初日 from）か、解除の印（_deleted:true）。
// 消さない（解除は印）。変えた記録だけを見る：確定＝見られる人（確定のボタンは画面を開ける人みんな）／解除・例外承認（forced）＝CEO・GM・経理（画面と同じ）
function tcfRecOk(day, r) {
  if (!obj(r) || JSON.stringify(r).length > 300000) return false;
  if (r._deleted === true) return true;
  if (r.status !== '確定済み') return false;
  if (r.from !== undefined && r.from !== day) return false;
  if (r.rows !== undefined && (!Array.isArray(r.rows) || r.rows.length > 2000)) return false;
  return true;
}
export function tcfCheck(year, cloud, value, sc) {
  value = asVal(value);
  if (!obj(value) || !year) return 'bad';
  const cur = obj(asVal(cloud)) || {};
  for (const d of Object.keys(cur)) if (!Object.prototype.hasOwnProperty.call(value, d)) return 'forbidden';   // 記録を消さない（解除は取り消しの印）
  for (const [d, r] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d.slice(0, 4) !== year) return 'bad';
    if (Object.prototype.hasOwnProperty.call(cur, d) && canon(cur[d]) === canon(r)) continue;
    if (!tcfRecOk(d, r)) return 'bad';
    // 解除・例外承認と、確定済みの記録を別の中身にする（解除して確定し直すのと同じ）は、解除できる人（画面でも確定済みは「確定解除」だけ）
    const live = Object.prototype.hasOwnProperty.call(cur, d) && obj(cur[d]) && cur[d]._deleted !== true;
    if (r._deleted === true || r.forced === true || live) { if (!sc.unlock) return 'forbidden'; }
    else if (!sc.confirm) return 'forbidden';
  }
  return 'ok';
}
// 注意ログ：[{ date, by, reason, id, _mut }]。足すだけ（消さない・書き換えない。保存の印 _mut と、id の無い前の記録に付ける id は変えてよい）。
// 足せるのは記録のボタンを押せる人（wnWrite）。鍵はアプリの _wnKey と同じ（id、無ければ中身から）
export function wnKey(w) {
  if (w && w.id != null) return String(w.id);
  const s = String((w && w.date) || '') + '|' + String((w && w.by) || '') + '|' + String((w && w.reason) || '');
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'w' + h.toString(36);
}
const WN_FIELDS = new Set(['date', 'by', 'reason', 'id', '_mut']);
function wnRecOk(x) {
  if (!obj(x)) return false;
  for (const k of Object.keys(x)) if (!WN_FIELDS.has(k)) return false;
  const s = (v, n) => v === undefined || v === null || (typeof v === 'string' && v.length <= n);
  if (!s(x.date, 60) || !s(x.by, 120) || !s(x.reason, 4000)) return false;
  if (x.id !== undefined && x.id !== null && !((typeof x.id === 'string' && x.id.length <= 80) || (typeof x.id === 'number' && Number.isFinite(x.id)))) return false;
  if (x._mut !== undefined && !(typeof x._mut === 'number' && Number.isFinite(x._mut))) return false;
  return true;
}
export function wnCheck(cloud, value, sc) {
  value = asVal(value);
  if (!Array.isArray(value) || value.length > 5000) return 'bad';
  if (!value.every(x => obj(x))) return 'bad';
  const cur = (Array.isArray(asVal(cloud)) ? asVal(cloud) : []).filter(x => obj(x));
  // 比べる形：保存の印 _mut と id は除く（同じ鍵の中で比べる。鍵は id から、id の無い前の記録は中身から作るので、id が違えば鍵も違う。
  // id の無い前の記録に、アプリが中身から作った鍵を id として付けるのは書き換えではない）
  const form = x => { const y = { ...x }; delete y._mut; delete y.id; return canon(y); };
  const group = list => { const m = new Map(); for (const x of list) { const k = wnKey(x); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(form(x)); } return m; };
  const curBy = group(cur), valBy = group(value);
  for (const [k, forms] of curBy) {
    const v = valBy.get(k);
    if (!v) return 'forbidden';                                                  // 消さない
    for (const f of forms) if (!v.has(f)) return 'forbidden';                    // 書き換えない
    for (const f of v) if (!forms.has(f)) return 'forbidden';                    // 同じ鍵（id）で中身の違う記録を足さない（記録しない人が鍵を借りて足す道にしない）
  }
  let added = false;
  for (const x of value) {
    if (curBy.has(wnKey(x))) continue;
    if (!wnRecOk(x)) return 'bad';
    added = true;
  }
  if (added && !sc.wnWrite) return 'forbidden';
  return 'ok';
}

// ================================================================ v1148：グレード履歴・賞与の個人設定・G3 の職種を読む人（docs/SECURE_GRADE_BONUS_READ_V1148_JA.md）
// 3 つとも app_state の 1 行（人ごとの記録の地図）。書くのは前から GM・CEO だけ（v1143・v1145 の swPut）。v1148 で読むのも絞る（Moto さん 11/10「Career Score と同じ範囲に」）：
//   CEO・GM＝全部／ほかの人＝Career Score で見られる人（csScope の see）と本人の分だけ（地図をその人の記録だけにして返す）／
//   経理・事務Crew のグレード履歴だけ全部（HR・福利厚生の画面が全員の「その日のグレード」を見る＝今の画面と同じ。Moto さんに伝える）。
export const GB_KEYS = ['grade_hist', 'bonus_eval_ovr', 'bonus_track'];
export function gbIsKey(k) { return typeof k === 'string' && GB_KEYS.includes(k); }
// 記録のキー → 従業員 ID（アプリの ghAll・kevPutVer・btrKey と同じ形）。読めなければ null（その記録はだれにも分けない＝狭いほう）
//   grade_hist：<従業員>／bonus_eval_ovr：<従業員>|<適用開始の四半期>／bonus_track：<四半期>|<従業員>
export function gbEntryId(key, k) {
  if (typeof k !== 'string' || !k) return null;
  if (key === 'grade_hist') return k;
  if (key === 'bonus_eval_ovr') { const i = k.lastIndexOf('|'); return i > 0 ? k.slice(0, i) : null; }
  if (key === 'bonus_track') { const i = k.indexOf('|'); return i >= 0 && i < k.length - 1 ? k.slice(i + 1) : null; }
  return null;
}
// 見られる人（ids：従業員 ID の Set）の記録だけの地図。地図でない値（前の版の文字・配列など）は {}（狭いほう）
export function gbProject(key, value, ids) {
  const m = obj(asVal(value));
  const o = {};
  if (!m || !ids) return o;
  for (const [k, v] of Object.entries(m)) { const id = gbEntryId(key, k); if (id && ids.has(id)) o[k] = v; }
  return o;
}
// そのキーを読む形（gb：gbScope の答え）：'all'（全部）／'scoped'（見られる人の分だけ）／'none'
export function gbLevel(gb, key) {
  if (!gb || !gbIsKey(key)) return 'none';
  if (gb.all.includes(key)) return 'all';
  return gb.ids ? 'scoped' : 'none';
}

// PostgREST の updated_at（小数 0〜6 桁）→ マイクロ秒。読めなければ null（アプリの _tsMicro と同じ）
export function tsMicro(s) {
  if (s == null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(s).trim());
  if (!m) return null;
  let off = m[4] || 'Z';
  if (off !== 'Z' && off !== 'z') { let o = off.replace(':', ''); if (o.length === 3) o += '00'; off = o.slice(0, 3) + ':' + o.slice(3, 5); } else off = 'Z';
  const sec = Date.parse(m[1] + 'T' + m[2] + off);
  if (!Number.isFinite(sec)) return null;
  return sec * 1000 + Number(((m[3] || '') + '000000').slice(0, 6));
}

// ---- 見せる形（proj）
function goalsOf(e) {
  const g = Array.isArray(e && e.goals) ? e.goals : [];
  return g.filter(x => x && typeof x === 'object' && !x.done && String(x.text || '').trim())
    .slice(0, 50).map(x => ({ text: String(x.text).slice(0, 500), due: typeof x.due === 'string' ? x.due.slice(0, 20) : '' }));
}
export function projKarte(v, mayGoals) {
  const out = {};
  const m = obj(v); if (!m) return out;
  for (const [id, e] of Object.entries(m)) {
    if (!obj(e) || id.length > 64 || id.startsWith('__')) continue;
    const p = {};
    if (typeof e.hireDate === 'string' && e.hireDate && e.hireDate.length <= 30) p.hireDate = e.hireDate;
    if (mayGoals(id)) { const g = goalsOf(e); if (g.length) p.goals = g; }
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}
// アプリの kbCfgPlain と同じ読み方（包んだ形 __st は、外側の欄が中より先）
const KB_ST_META = { __st: 1, v: 1, _at: 1, _by: 1, _deleted: 1 };
function kbPlain(r, depth = 0) {
  if (!(obj(r) && r.__st === 1) || depth > 20) return r;
  const top = {}; for (const k of Object.keys(r)) if (!KB_ST_META[k]) top[k] = r[k];
  const inner = kbPlain(r.v, depth + 1);
  return { ...(obj(inner) || {}), ...top };
}
export function projKbCfg(v) {
  const r = obj(kbPlain(v)); if (!r) return {};
  const q = r.quarter;
  return (typeof q === 'string' && q.length <= 20) || (typeof q === 'number' && Number.isFinite(q)) ? { quarter: q } : {};
}
// メールのログインか：Bearer が JWT で role が authenticated（公開の鍵（role anon）・新しい形の鍵（JWT でない）はメールのログインでない）
export function jwtRole(tok) {
  try {
    const p = String(tok).split('.');
    if (p.length !== 3 || p[1].length > 4000) return '';
    const b = p[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '==='.slice((b.length + 3) % 4));
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    return j && typeof j.role === 'string' ? j.role : '';
  } catch { return ''; }
}

// ================================================================ v1152：通知（app_state の notifications・段階 2b の最後）
//   前：1 つの行（新しい 500 件の配列）を公開の鍵でだれでも読めて書けた（退職の理由・採用した人の名前・相談の題名・個人あての知らせ）。
//   いま：読むのはこの関数の nt だけで、ログインした人の宛先の分（画面の notifForMe と同じ決まり）と自分が出した分。
//     書くのは「足す」と「自分の既読・確認の印」だけ（ほかの人の印・中身は変えない・消さない）。読んだ行が変わっていないときだけ書く。
//     足すのは、ログインを確かめられない端末（店舗の PIN のタブレット・PIN が初期の人）からもできる（今までどおりだれでも足せる。読めない）。
//   Moto さん 11/12：店のタブレットには通知を出さない（各自の PIN で見る）。docs/SECURE_NOTIFICATIONS_V1152_JA.md
export const NT_KEY = 'notifications';
export const NT_MAX = 500;            // 残す数（アプリの mergeNotifs と同じ。新しい順に 500）
export const NT_ADD_MAX = 20;         // 1 回に足す数
export const NT_MARK_MAX = 500;       // 1 回に付ける既読・確認の印の数
export const NT_ALL_ROLES = ['ceo', 'gm', 'office', 'office_crew'];   // 全店（画面の notifForMe と同じ）
// 社員の表の役割（公開の鍵で書ける）を宛先の役割に使うのは、GM・CEO が確かめた写し（wr_people）のグレードが足りるときだけ（v1147 と同じ考え）
export const NT_STAFF_NEED = { g2: 2, sl: 3, g4: 4, chef: 4 };
// 宛先の役割：アプリはログインで g2 を sl、g4 を am として扱う（index.html の ROLE_ALIAS・_applyRole）。通知の宛先（toRoles）もその名前なので、
// 確かめた役割を同じ名前にそろえる（Codex #146 6845284151・6846844817 P2：前は g2・g4 のまま比べ、確かめた G2・G4 に役割あての通知が届かなかった）
export const NT_ROLE_ALIAS = { g2: 'sl', g4: 'am' };
export const NT_SYS = 'システム';
const NT_ID_RE = /^[A-Za-z0-9_:.-]{1,100}$/;
const NT_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const NT_STR = { type: 40, title: 300, text: 2000, toUser: 120, toStore: 40, page: 60, refId: 200, by: 120 };
export function ntIsKey(k) { return k === NT_KEY; }
// 足す通知の形を確かめて整える（合わなければ null＝足さない）。既読・確認の印と「_」で始まる欄はサーバーが決める
export function ntClean(x, nowMs) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const id = typeof x.id === 'string' ? x.id : (typeof x.id === 'number' && Number.isSafeInteger(x.id) ? String(x.id) : '');
  if (!NT_ID_RE.test(id)) return null;
  const out = { id };
  for (const [k, v] of Object.entries(x)) {
    if (k === 'id' || k === 'readBy' || k === 'ackBy' || k === 'at' || k.startsWith('_')) continue;
    if (!NT_FIELD_RE.test(k)) return null;
    if (v === undefined) continue;
    if (k === 'toRoles') {
      if (!Array.isArray(v) || v.length > 12 || v.some(r => typeof r !== 'string' || !/^[a-z_]{1,20}$/.test(r))) return null;
      out.toRoles = [...new Set(v)]; continue;
    }
    if (Object.prototype.hasOwnProperty.call(NT_STR, k)) {
      if (v === null) continue;
      if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return null;
      out[k] = String(v).slice(0, NT_STR[k]); continue;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, 500); continue; }
    if (typeof v === 'object') { const sj = JSON.stringify(v); if (sj.length > 1000) return null; out[k] = JSON.parse(sj); continue; }   // rbFocus など小さな入れ物
    return null;
  }
  if (JSON.stringify(out).length > 6000) return null;
  const t = typeof x.at === 'string' && x.at.length <= 40 ? Date.parse(x.at) : NaN;
  // 時計の進んだ端末の時刻はいつまでも一番上に出るので、先の時刻（5 分より先）と古すぎる時刻は今にする
  out.at = new Date(Number.isFinite(t) && t <= nowMs + 300000 && t >= nowMs - 400 * 86400000 ? t : nowMs).toISOString();
  out.readBy = []; out.ackBy = [];
  return out;
}
// この人に見せる通知か（画面の notifForMe と同じ決まり。自分が出した分も返す＝同じものを二度足さないため。画面は自分の分を出さない）
//   c：{ name, role（宛先の役割）, all（全店）, stores（Set）, sm（Store Manager） }
export function ntVisible(n, c) {
  if (!n || typeof n !== 'object' || Array.isArray(n) || !c) return false;
  const nm = c.nameOk === false ? '' : c.name;   // 同じ名前の人がほかにいる（退職の人も）：名前あての通知・自分が出した通知は返さない（だれのものか分からない）
  if (nm && n.by === nm) return true;
  if (n.toUser) return !!nm && n.toUser === nm;
  const roles = Array.isArray(n.toRoles) ? n.toRoles : [];
  const rm = () => !!c.role && (roles.includes(c.role) || (c.sm === true && roles.includes('sm')));
  if (n.toStore) {
    if (!(c.all || (c.stores && c.stores.has(String(n.toStore))))) return false;
    return roles.length ? rm() : true;
  }
  return roles.length ? rm() : false;
}

// ================================================================ v1193：画面の表示（UI案95・docs/PAGE_VIEW_V1193_JA.md）
// 中身：{ v:1, off:bool, cols:{ <列>:{ <ノード>:'s'|'h' } }, people:{ <社員ID>:{ <ノード>:'s'|'h' } }, only:{ 'p:<画面>':[社員ID…] } }
//   列：g1〜g6（店の人のグレード）・am・chef（Head Chef）・acct（経理・事務共通）。CEO・GM はいつも全部（固定）なので列が無い。
//   v1197（UI案96 の 6B）：tab（店のタブレット＝店舗の PIN の共有ログイン）。中タブ（p:）だけ。人の例外・指定スタッフ限定は無い（人ではないため）。
//   ノード：p:<画面の ID>（中タブ）・c:<カードの ID>（マイページのカード）・g1:<グループの ID>（G1 の画面の大タブ。g1 の列と人の例外だけ）。
//   固定のもの（承認・閲覧設定・成長カルテ・中間レビュー・承認センター・セキュアページのカード）は中身に入れられない（画面がいつもの決まりで出す）。
export const PV_COLS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'am', 'chef', 'acct', 'tab'];
export const PV_NEVER = ['p:ar_settings', 'p:growth_karte', 'p:mid_review', 'p:approval', 'c:secure'];
export const PV_NODE_RE = /^(?:p|c|g1):[a-z][a-z0-9_]{0,48}$/;
export const PV_EMP_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
export const PV_MAX = 400000;
function pvNodes(m, allow) {
  if (!obj(m)) return null;
  const ks = Object.keys(m);
  if (ks.length > 800) return null;
  const o = {};
  for (const k of ks) {
    if (!PV_NODE_RE.test(k) || PV_NEVER.includes(k) || !allow(k.slice(0, k.indexOf(':')))) return null;
    if (m[k] !== 's' && m[k] !== 'h') return null;
    o[k] = m[k];
  }
  return o;
}
// 形を確かめて整える（合わなければ null）。off はいつも true／false で持つ（同じ中身を同じ文字にする）
export function pvCheck(doc) {
  if (!obj(doc)) return null;
  if (Object.keys(doc).some(k => !['v', 'off', 'cols', 'people', 'only'].includes(k))) return null;
  if (doc.v !== 1) return null;
  if (doc.off !== undefined && typeof doc.off !== 'boolean') return null;
  const cols = doc.cols === undefined ? {} : doc.cols, people = doc.people === undefined ? {} : doc.people, only = doc.only === undefined ? {} : doc.only;
  if (!obj(cols) || !obj(people) || !obj(only)) return null;
  const out = { v: 1, off: doc.off === true, cols: {}, people: {}, only: {} };
  for (const c of Object.keys(cols)) {
    if (!PV_COLS.includes(c)) return null;
    const n = pvNodes(cols[c], c === 'g1' ? (t => t === 'g1' || t === 'c') : c === 'tab' ? (t => t === 'p') : (t => t === 'p' || t === 'c'));
    if (!n) return null;
    out.cols[c] = n;
  }
  const pk = Object.keys(people);
  if (pk.length > 3000) return null;
  for (const e of pk) {
    if (!PV_EMP_RE.test(e)) return null;
    const n = pvNodes(people[e], () => true);
    if (!n) return null;
    if (Object.keys(n).length) out.people[e] = n;
  }
  const ok = Object.keys(only);
  if (ok.length > 300) return null;
  for (const k of ok) {
    if (!PV_NODE_RE.test(k) || !k.startsWith('p:') || PV_NEVER.includes(k)) return null;
    const l = only[k];
    if (!Array.isArray(l) || l.length < 1 || l.length > 500) return null;
    if (l.some(e => typeof e !== 'string' || !PV_EMP_RE.test(e)) || new Set(l).size !== l.length) return null;
    out.only[k] = l.slice();
  }
  if (JSON.stringify(out).length > PV_MAX) return null;
  return out;
}
// ログインした人に返す形：列は全部（どの画面をどの列に出すかは秘密ではない）・人の例外は自分の分だけ・指定スタッフ限定は自分が入っているかだけ
export function pvProject(doc, emp) {
  const mine = emp && obj(doc.people[emp]) ? doc.people[emp] : {};
  const only = {};
  for (const k of Object.keys(doc.only)) only[k] = !!(emp && doc.only[k].includes(emp));
  return { cols: doc.cols, mine, only };
}

// ---- Career Score 2026 Q4（新制度・段階 3-1）：評価表・評価・本人への共有・見直しの申し出・今までの記録の写し（docs/CAREER_SCORE_Q4_JA.md の 7）。
//   表は csq4_*（SQL 20261214090000。公開の鍵では読めない・書けない）。計算は careerscore/q4-core.mjs そのもの（csq4.gen.mjs）で、
//   端末が送った総合点・状態は使わない（明細から毎回計算し直して SQL に渡す）。だれが何をできるかは下の cs4Ctx（Claude が決めた・Moto さんに確かめる）。
export const CS4_PERIOD = CSQ4_MASTER.period.quarter;
export const CS4_VERSION = CSQ4_MASTER.version;
const CS4_SYSTEMS = ['G', 'S_CHEF', 'S_OFFICE', 'PREP'];
const CS4_ITEMS = Object.fromEntries(CS4_SYSTEMS.map(s => [s, new Set(CSQ4.csq4System(CSQ4_MASTER, s).items.map(i => i.id))]));
const CS4_STATUS = Object.values(CSQ4.STATUS);
const CS4_NA = CSQ4.NA_REASON;
// 端末が書ける欄・サーバーが付ける欄（送られてきても使わない）・変えたら理由が要る欄・文字の欄・本人に共有する欄
const CS4_EDIT = ['status', 'score', 'naReasonType', 'naReason', 'unassignedReason', 'periodOnly', 'periodFrom', 'periodTo', 'evidence', 'feedbackComment', 'changeReason'];
const CS4_SERVER = ['prevStatus', 'byEmp', 'byName', 'at'];
const CS4_CORE = ['status', 'score', 'naReasonType', 'periodOnly', 'periodFrom', 'periodTo'];
const CS4_TEXT = ['naReason', 'unassignedReason', 'evidence', 'feedbackComment', 'changeReason'];
const CS4_KEEP = CS4_TEXT.filter(k => k !== 'changeReason');   // 明細に残す文（変えた理由は記録（csq4_log）にだけ。#214 のレビュー：前の理由を次の変更に使わせない）
const CS4_SHARE = ['status', 'score', 'naReasonType', 'naReason', 'periodFrom', 'periodTo', 'unassignedReason', 'feedbackComment'];
// 形の誤り（保存しない）。理由・期間の書き忘れは下書きに残せる（計算では未評価・確定できない＝result.entryErrors）
const CS4_HARD = ['unknown_item', 'bad_entry', 'bad_status', 'unassigned_only_g', 'bad_score', 'na_reason_type_g_only'];
const CS4_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CS4_DEC = /^\d{1,12}(\.\d{1,6})?$/;
const CS4_TRACK = { kt: 'Kitchen中心', sv: 'Server中心', op: '両部門育成' };   // 賞与の G3 の職種（bonus_track）→ G の型（答え 2 A の初めの提案）
const CS4_TITLE_TYPE = { 'Kitchen Leader': 'Kitchen中心', 'Server Leader': 'Server中心', 'Operation Leader': '両部門育成' };
const CS4_TOP_TYPE = { 4: '店長', 5: '管轄責任', 6: '全社責任' };
const CS4_OFFICE_TITLES = ['Office Crew', 'Office Staff', 'Office Crew Leader', 'Accounting Leader', 'Office Manager', 'Accountant'];
const CS4_PREP_TITLES = ['Prep', 'Prep Specialist'];
const CS4_Q = CSQ4.csq4System(CSQ4_MASTER, 'PREP').quality.map(q => q.id);
const CS4_STEPS = CSQ4.csq4System(CSQ4_MASTER, 'PREP').pay.map(p => p.step);
const CS4_OPEN = ['draft', 'submitted', 'returned'];

function cs4Txt(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > max ? null : t;
}
// 1 項目の明細を確かめて、状態に要る欄だけにする。{ entry }（null＝未評価に戻す）か { error }
export function cs4CleanEntry(sys, id, e) {
  if (!CS4_ITEMS[sys] || typeof id !== 'string' || !CS4_ITEMS[sys].has(id)) return { error: 'unknown_item' };
  if (e === null) return { entry: null };
  if (!obj(e)) return { error: 'bad_entry' };
  for (const k of Object.keys(e)) if (!CS4_EDIT.includes(k) && !CS4_SERVER.includes(k)) return { error: 'bad_field' };
  const st = e.status;
  if (!CS4_STATUS.includes(st)) return { error: 'bad_status' };
  const out = { status: st };
  for (const k of CS4_TEXT) {
    const t = cs4Txt(e[k], 1000);
    if (t === null) return { error: 'bad_text' };
    if (t) out[k] = t;
  }
  const noScore = e.score === undefined || e.score === null;
  if (st === 'SCORED') {
    if (!Number.isInteger(e.score) || e.score < 0 || e.score > 3) return { error: 'bad_score' };
    out.score = e.score;
  } else if (st === 'UNASSIGNED') {
    if (!noScore && e.score !== 0) return { error: 'bad_score' };
    out.score = 0;     // 未担当は 0 点で分母に入る（G だけ）
  } else {
    if (!noScore) return { error: 'bad_score' };
    out.score = null;
  }
  if (st !== 'NOT_APPLICABLE') delete out.naReason;
  if (st !== 'UNASSIGNED') delete out.unassignedReason;
  if (st === 'NOT_APPLICABLE') {
    const rt = e.naReasonType;
    if (rt !== undefined && rt !== null && rt !== CS4_NA.ROLE && rt !== CS4_NA.COMPANY) return { error: 'bad_na_type' };
    if (sys !== 'G' && rt === CS4_NA.COMPANY) return { error: 'na_reason_type_g_only' };   // 答え 4 A：S・Prep は会社都合の今回非該当を使わない
    out.naReasonType = rt || (sys === 'G' ? null : CS4_NA.ROLE);
    if (out.naReasonType === CS4_NA.COMPANY) {
      if (e.periodOnly !== undefined && e.periodOnly !== null && typeof e.periodOnly !== 'boolean') return { error: 'bad_period' };
      out.periodOnly = e.periodOnly === true;
      for (const k of ['periodFrom', 'periodTo']) {
        const v = e[k];
        if (v === undefined || v === null || v === '') continue;
        if (typeof v !== 'string' || !CS4_DAY.test(v)) return { error: 'bad_period' };
        out[k] = v;
      }
    }
  }
  // 変えた理由は明細に残さない（記録 csq4_log にだけ。#214 のルーティン 7096582005 の P3-2：理由だけの未評価の明細を作らない）
  const reason = out.changeReason || '';
  delete out.changeReason;
  if (st === 'UNASSESSED') {
    const keep = ['evidence', 'feedbackComment'].filter(k => out[k]);
    if (!keep.length) return { entry: null, reason };
  }
  const errs = CSQ4.csq4CheckEntry(CSQ4_MASTER, sys, id, out);
  const hard = errs.find(x => CS4_HARD.includes(x));
  if (hard) return { error: hard };
  return { entry: out, reason };
}
const cs4Pick = (e, ks) => { const o = {}; if (!e) return o; for (const k of ks) if (e[k] !== undefined) o[k] = e[k]; return o; };
// 比べるための中身（null・未設定・periodOnly false は「無い」と同じ。未評価の項目と null は同じ）
const cs4Norm = o => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '' && v !== false) r[k] = v; return r; };
const cs4CoreOf = e => canon(cs4Norm(e ? cs4Pick(e, CS4_CORE) : { status: 'UNASSESSED' }));
const cs4BodyOf = e => canon(cs4Norm(e ? cs4Pick(e, [...CS4_CORE, ...CS4_KEEP]) : { status: 'UNASSESSED' }));
export function cs4CleanFeedback(f) {
  if (!obj(f)) return null;
  const out = {};
  for (const k of Object.keys(f)) {
    if (!['good', 'improve', 'next'].includes(k)) return null;
    const t = cs4Txt(f[k], 2000);
    if (t === null) return null;
    if (t) out[k] = t;
  }
  return out;
}
function cs4Dec(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') v = Number.isFinite(v) && v >= 0 ? String(v) : 'x';
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return CS4_DEC.test(t) ? t : null;
}
export function cs4CleanPrep(p) {
  if (!obj(p)) return null;
  for (const k of Object.keys(p)) if (!['quality', 'measure', 'currentStep'].includes(k)) return null;
  const quality = {};
  if (p.quality !== undefined && p.quality !== null) {
    if (!obj(p.quality)) return null;
    for (const [k, v] of Object.entries(p.quality)) {
      if (!CS4_Q.includes(k) || !['clear', 'not_clear', 'unconfirmed'].includes(v)) return null;
      quality[k] = v;
    }
  }
  let measure = null;
  if (p.measure !== undefined && p.measure !== null) {
    const m = p.measure;
    if (!obj(m)) return null;
    for (const k of Object.keys(m)) if (!['trials', 'independentStd', 'allStd'].includes(k)) return null;
    const trials = m.trials === undefined || m.trials === null ? [] : m.trials;
    if (!Array.isArray(trials) || trials.length > 20) return null;
    const ts = [];
    for (const t of trials) {
      if (!obj(t)) return null;
      for (const k of Object.keys(t)) if (!['date', 'goodStd', 'actual'].includes(k)) return null;
      const date = t.date === undefined || t.date === null ? '' : t.date;
      if (typeof date !== 'string' || (date && !CS4_DAY.test(date))) return null;
      const goodStd = cs4Dec(t.goodStd), actual = cs4Dec(t.actual);
      if (goodStd === null || actual === null) return null;
      ts.push({ date, goodStd, actual });
    }
    const independentStd = cs4Dec(m.independentStd), allStd = cs4Dec(m.allStd);
    if (independentStd === null || allStd === null) return null;
    measure = { trials: ts, independentStd, allStd };
  }
  let currentStep = null;
  if (p.currentStep !== undefined && p.currentStep !== null && p.currentStep !== '') {
    if (!CS4_STEPS.includes(p.currentStep)) return null;
    currentStep = p.currentStep;
  }
  return { quality, measure, currentStep };
}
// 評価表の行（GM・CEO が決める）を確かめる。G は Grade ごとの型（マスターの配点の行がある型）だけ
export function cs4CleanAssign(x) {
  if (!obj(x) || !CS4_SYSTEMS.includes(x.system)) return null;
  const blank = v => v === undefined || v === null || v === '';
  if (x.system === 'PREP') return blank(x.grade) && blank(x.type) ? { system: 'PREP', grade: null, type: null } : null;
  if (x.system === 'G') {
    if (typeof x.grade !== 'string' || !/^G[1-6]$/.test(x.grade)) return null;
    const w = CSQ4.csq4System(CSQ4_MASTER, 'G').weights[x.grade] || {};
    if (typeof x.type !== 'string' || !Object.prototype.hasOwnProperty.call(w, x.type)) return null;
    return { system: 'G', grade: x.grade, type: x.type };
  }
  if (typeof x.grade !== 'string' || !/^S[1-6]$/.test(x.grade) || !blank(x.type)) return null;
  return { system: x.system, grade: x.grade, type: null };
}
// 計算し直す（端末の総合点は使わない）
export function cs4Compute(a, entries, prep) {
  if (a.system === 'PREP') {
    const p = prep || {};
    return CSQ4.csq4Prep(CSQ4_MASTER, { entries: entries || {}, quality: p.quality || {}, measure: p.measure || null, currentStep: p.currentStep || null });
  }
  const r = CSQ4.csq4Score(CSQ4_MASTER, { system: a.system, grade: a.grade, type: a.type, entries: entries || {} });
  if (!r.ok) throw err('db', 500);
  return r;
}
// 一覧に出す短いまとめ
export function cs4Brief(row) {
  const r = obj(row && row.result) || {};
  const base = { state: r.state || null, confirmable: r.confirmable === true, counts: obj(r.counts) || null };
  if (row && row.system === 'PREP') return { ...base, score: r.score ? r.score.display : null, pay: obj(r.pay) ? { state: r.pay.state, step: r.pay.step || null } : null };
  // exact＝総合点の分数（賞与の ① の段を丸めずに決めるため・段階 3-2）・base＝その評価表の基準点
  return { ...base, total: r.total ? r.total.display : null, exact: r.total ? r.total.exact : null, base: Number.isFinite(r.base) ? r.base : null,
    provisional: r.totalProvisional !== false, baseMet: r.baseMet === undefined ? null : r.baseMet };
}
// 本人に共有する内容（根拠・変えた理由・だれがいつ書いたかは入れない）
export function cs4Shared(row, entries, feedback, result) {
  const items = {};
  for (const [id, e] of Object.entries(entries || {})) if (e && e.status && e.status !== 'UNASSESSED') items[id] = cs4Pick(e, CS4_SHARE);
  const r = result || {};
  const res = row.system === 'PREP'
    ? { state: r.state, score: r.score || null, counts: r.counts, quality: r.quality, qualityState: r.qualityState, measure: r.measure,
        pay: obj(r.pay) ? { state: r.pay.state, step: r.pay.step || null, wageUsd: r.pay.wageUsd === undefined ? null : r.pay.wageUsd } : null }
    : { state: r.state, total: r.total || null, totalProvisional: r.totalProvisional !== false, base: r.base, baseMet: r.baseMet === undefined ? null : r.baseMet,
        counts: r.counts, categories: r.categories, minimum: r.minimum, unassignedList: r.unassignedList || [], roleNaList: r.roleNaList || [] };
  return { v: 1, rev: row.rev, system: row.system, grade: row.grade || null, type: row.type || null, version: row.version || CS4_VERSION,
    result: res, feedback: cs4Pick(feedback || {}, ['good', 'improve', 'next']), items };
}
// 評価表の初めの提案（答え 1 A・2 A：役職と肩書きから。GM・CEO が確かめて決める）。決められなければ型は null
export function cs4Suggest(p, track) {
  if (!p || p.out || p.role === 'ceo') return null;
  const title = String(p.title || '');
  if (CS4_PREP_TITLES.includes(title)) return { system: 'PREP', grade: null, type: null, from: 'title' };
  const g = Number(p.gS);
  if (!Number.isInteger(g) || g < 1 || g > 6) return null;
  if (p.dept === '調理') return { system: 'S_CHEF', grade: 'S' + g, type: null, from: 'dept' };
  if (p.dept === '経理' || OFFICE_ROLES.includes(p.role) || CS4_OFFICE_TITLES.includes(title)) return { system: 'S_OFFICE', grade: 'S' + g, type: null, from: 'dept' };
  if (g >= 4) return { system: 'G', grade: 'G' + g, type: CS4_TOP_TYPE[g], from: 'grade' };
  const t = track && CS4_TRACK[track] ? CS4_TRACK[track] : null;
  if (t) return { system: 'G', grade: 'G' + g, type: t, from: 'track' };
  if (CS4_TITLE_TYPE[title]) return { system: 'G', grade: 'G' + g, type: CS4_TITLE_TYPE[title], from: 'title' };
  return { system: 'G', grade: 'G' + g, type: null, from: 'none' };
}

export function createHandler(deps) {
  const env = deps.env;
  const fetch = deps.fetch || globalThis.fetch.bind(globalThis);
  const now = deps.now || (() => Date.now());
  const url = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY'), anon = env('SUPABASE_ANON_KEY');
  const wrUrl = env('SS_WR_URL') || (url + '/functions/v1/work-requests');
  const origins = ['https://funergy-plus.com', ...String(env('SS_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)];
  const sv = { apikey: service, authorization: 'Bearer ' + service };
  const timeout = (ms = 8000) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const cache = new Map();     // sha256(印) → { a, exp }（60 秒。同じ印で何度も work-requests を呼ばない）
  const fails = new Map();     // 成長カルテの PIN の間違い：社員 ID → [時刻…]

  async function rest(path, opt = {}) {
    const r = await fetch(url + '/rest/v1/' + path, { ...opt, headers: { ...sv, 'content-type': 'application/json', ...(opt.headers || {}) }, signal: timeout(opt.ms || 20000) });
    const t = await r.text();
    if (!r.ok) { const e = err(r.status === 409 ? 'conflict' : 'db', r.status); e.detail = t.slice(0, 200); throw e; }
    return t ? JSON.parse(t) : null;
  }

  // ---- v1151：だれが書いたか（変更の記録）。この関数が PIN・メールで確かめた人を、サーバーの鍵の書き込みに付ける（x-fp-actor・f:'1'）。
  //   見張り（SQL 20261118090000）は、サーバーの鍵で f:'1' の付いた書き込みを via='fn'（関数が確かめた人）として残す。
  //   端末の印（d）・種類（k）は、アプリが送った x-fp-actor から形を確かめて写すだけ（人は関数が決める）
  function fpHdr(a) {
    if (!a || typeof a !== 'object') return {};
    const o = { e: typeof a.emp === 'string' ? a.emp.slice(0, 64) : '', n: typeof a.name === 'string' ? a.name.slice(0, 120) : '', r: typeof a.role === 'string' ? a.role.slice(0, 40) : '', f: '1' };
    if (typeof a.dev === 'string' && a.dev) o.d = a.dev;
    if (typeof a.kind === 'string' && a.kind) o.k = a.kind;
    const u = te.encode(JSON.stringify(o));
    let t = ''; for (let i = 0; i < u.length; i++) t += String.fromCharCode(u[i]);
    return { 'x-fp-actor': btoa(t) };
  }
  function fpDevice(req) {
    const h = req.headers.get('x-fp-actor');
    if (typeof h !== 'string' || !h || h.length > 3000) return {};
    try {
      const bin = atob(h), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const j = JSON.parse(new TextDecoder().decode(u));
      if (!obj(j)) return {};
      return { dev: typeof j.d === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(j.d) ? j.d : '', kind: FP_KINDS.includes(j.k) ? j.k : '' };
    } catch { return {}; }
  }

  // ---- v1151：変更の記録を読む（Moto さん 11/12：見られるのは CEO・GM・経理・事務Crew・残すのは 1 年）。中身（値）は記録に無い
  async function clGet(a, b) {
    if (!CL_ROLES.includes(a.role)) throw err('forbidden', 403);
    const day = 86400000, t1 = now();
    const pt = v => (v === undefined || v === null || v === '') ? null : (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN);
    const fromIn = pt(b.from), toIn = pt(b.to);
    if (Number.isNaN(fromIn) || Number.isNaN(toIn)) throw bad();
    const to = toIn == null ? t1 : Math.min(toIn, t1 + day);
    const from = Math.max(fromIn == null ? to - 7 * day : fromIn, t1 - 366 * day);
    if (from > to) throw bad();
    const lim = Number.isInteger(b.limit) ? Math.min(Math.max(b.limit, 1), 200) : 100;
    let q = 'change_log?select=id,at,last_at,src,key,cat,by_emp,by_name,by_role,by_dev,by_kind,via,parts,more,n&order=id.desc&limit=' + lim
      + '&last_at=gte.' + encodeURIComponent(new Date(from).toISOString()) + '&at=lte.' + encodeURIComponent(new Date(to).toISOString());
    if (b.before !== undefined && b.before !== null) { if (!Number.isSafeInteger(b.before) || b.before < 1) throw bad(); q += '&id=lt.' + b.before; }
    if (b.emp !== undefined && b.emp !== null && b.emp !== '') { if (typeof b.emp !== 'string' || b.emp.length > 64) throw bad(); q += '&by_emp=eq.' + encodeURIComponent(b.emp); }
    if (b.src !== undefined && b.src !== null && b.src !== '') { if (!CL_SRC.includes(b.src)) throw bad(); q += '&src=eq.' + b.src; }
    if (b.via !== undefined && b.via !== null && b.via !== '') { if (!CL_VIA.includes(b.via)) throw bad(); q += '&via=eq.' + b.via; }
    if (b.q !== undefined && b.q !== null && b.q !== '') { if (typeof b.q !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(b.q)) throw bad(); q += '&key=ilike.*' + b.q + '*'; }
    const rows = await rest(q);
    const list = Array.isArray(rows) ? rows : [];
    return { rows: list, more: list.length === lim, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }

  // ---- だれか
  async function pinActor(tok) {
    if (typeof tok !== 'string' || !tok || tok.length > 4000) return { deny: 'pin_shape' };
    const h = await sha256(tok);
    const c = cache.get(h);
    if (c && c.exp > now()) return c.a;
    let r;
    try {
      r = await fetch(wrUrl, { method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', pin_session: tok }), signal: timeout() });
    } catch { return { err: 'auth_unavailable' }; }
    if (r.status === 401 || r.status === 403) {
      try { await r.text(); } catch { /* */ }
      const d = { deny: 'pin' };
      cache.set(h, { a: d, exp: now() + 30000 });   // 断られた印も 30 秒覚える（同じ印で何度も work-requests を呼ばない）
      return d;
    }
    if (!r.ok) { try { await r.text(); } catch { /* */ } return { err: 'auth_unavailable' }; }   // work-requests が無い（404）・PIN を確かめられない（503）など
    let j = null; try { j = await r.json(); } catch { return { err: 'auth_unavailable' }; }
    const me = obj(j && j.me);
    if (!me || typeof me.emp !== 'string' || !me.emp || me.emp.length > 64) return { deny: 'pin' };
    const a = { via: 'pin', emp: me.emp, role: typeof me.role === 'string' ? me.role : '', grade: Number.isInteger(me.grade) ? me.grade : 0,
      stores: arr(me.stores), am: arr(me.am_stores), name: typeof me.name === 'string' && me.name.length <= 120 ? me.name : '',
      confirmed: me.confirmed === true,   // v1142：GM・CEO が確かめた写しがあるか（G4・店長の範囲に要る）。v1140：名前（GM・CEO が確かめた写しか、PIN の印の名前）
      live: j.live === true ? true : (j.live === false ? false : null) };   // v1146：ワークセンターを使い始めたか（G4・Head Chef が Tip Rate を決めるか）
    if (cache.size > 500) { for (const [k, v] of cache) if (!(v.exp > now())) cache.delete(k); if (cache.size > 500) cache.clear(); }
    cache.set(h, { a, exp: now() + 60000 });
    return a;
  }
  async function emailActor(auth) {
    let r;
    try { r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, authorization: auth }, signal: timeout() }); } catch { return { err: 'auth_unavailable' }; }
    if (!r.ok) { try { await r.text(); } catch { /* */ } return (r.status >= 500 || r.status === 429) ? { err: 'auth_unavailable' } : { deny: 'email' }; }
    let u = null; try { u = await r.json(); } catch { return { deny: 'email' }; }
    const uid = u && typeof u.id === 'string' && /^[0-9a-f-]{36}$/i.test(u.id) ? u.id : null;
    if (!uid) return { deny: 'email' };
    const rows = await rest('manager_auth?user_id=eq.' + encodeURIComponent(uid) + '&select=role,emp_id');
    const m = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!m || !MGR_ROLES.includes(m.role)) return { deny: 'email_role' };
    const emp = m.emp_id == null || m.emp_id === '' ? null : String(m.emp_id);
    let name = '';
    if (emp) {
      const es = await rest('employees?id=eq.' + encodeURIComponent(emp) + '&select=status,data,name');
      const e0 = Array.isArray(es) ? es[0] : null, d = e0 && obj(e0.data) ? e0.data : {};
      // work-requests の wr_emp_out と同じ：表の status・data の status が退職、または OS を止めた人
      if (e0 && (String(e0.status || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true')) return { deny: 'email_out' };
      if (e0 && typeof e0.name === 'string' && e0.name.length <= 120) name = e0.name;   // v1140：メールのログインの人の名前は社員の表（経理・事務Crew・GM・CEO）
    }
    return { via: 'email', emp, role: m.role, grade: 0, stores: [], am: [], name };
  }
  async function actorOf(req, body) {
    const tok = body.pin_session;
    const auth = req.headers.get('authorization') || '';
    const email = auth.startsWith('Bearer ') && auth.length <= 4000 && jwtRole(auth.slice(7)) === 'authenticated';
    // PIN の印がある要求は、その印だけで決める。確かめられない（work-requests の 404・503・通信の失敗・読めない答え）ときも
    // メールのログインへ切り替えない（Codex の P1：共有の端末に GM のメールのログインが残っていると、Crew の PIN の要求が GM の権限になっていた）
    if (tok !== undefined && tok !== null && tok !== '') return await pinActor(tok);
    if (email) return await emailActor(auth);
    return { deny: 'none' };
  }
  const levelOf = a => (SS_FULL_ROLES.includes(a.role) ? 'full' : (a.emp ? 'proj' : 'none'));
  // v1144（Codex #138 P1-1）：Head Chef として広い範囲（全員の個人の欄・全店の Career Score）を見るのは、GM・CEO が確かめた写し
  // （wr_people.chef・SQL 20261113080000）でも Head Chef のときだけ。社員の表の肩書き・役割は公開の鍵で書けるので、それだけでは広げない。
  // 列が無い（SQL の前）・読めない・写しが無いときは Head Chef としない（狭いほう）。今の社員の表でも Head Chef か（liveChef）は呼ぶ側が見る
  async function confChef(a) {
    if (!a || a.role !== 'staff' || !(a.grade >= 4) || typeof a.emp !== 'string' || !a.emp) return false;
    try {
      const r = await rest('wr_people?emp_id=eq.' + encodeURIComponent(a.emp) + '&select=chef');
      return Array.isArray(r) && r.length === 1 && !!r[0] && r[0].chef === true;
    } catch { return false; }
  }
  // v1147（Codex #141 6781928056 の P2-1）：店のある範囲（Tip の確定・注意ログ・応募者・Career Score の店の人）を決める店。
  //   社員の表の役割・肩書き・店・応援は公開の鍵で書けるので、それだけでは範囲に入れない。GM・CEO が確かめた写し（wr_people）があり、
  //   その写しのグレードが 2 以上の人だけ、写しの店と whoami の店（今の社員の表）の重なりを返す（増える変更は確かめるまで効かない・減るのはすぐ）。
  //   G2（リーダー）も写しに入れるのは SQL 20261116080000（wr_elevated を G2 以上に）。写しが無い・G2 未満・読めない・列が無いときは []（狭いほう）。
  //   whoami の AM（確かめた写しの AM）は a.am・a.stores がもう写しとの重なりなので、呼ぶ側がそのまま使う
  async function protStores(a) {
    if (!a || a.role !== 'staff' || a.confirmed !== true || !(Number(a.grade) >= 2) || typeof a.emp !== 'string' || !a.emp) return [];
    let c = null;
    try {
      const r = await rest('wr_people?emp_id=eq.' + encodeURIComponent(a.emp) + '&select=grade,stores');
      c = Array.isArray(r) && r.length === 1 && obj(r[0]) ? r[0] : null;
    } catch { return []; }
    if (!c || !Number.isInteger(c.grade) || c.grade < 2) return [];
    const cs = arr(c.stores);
    return [...new Set(arr(a.stores).filter(s => cs.includes(s)))];
  }

  // v1146：Tip Rate を決められる人か（今の画面と同じ。画面の Tip Rate の画面の承認・引き上げ＝ROLE_CONFIG の canApprove と v1135 の止め）。
  //   CEO・GM・確かめた AM：いつも。役割 g4（画面では AM と同じ扱い）：ワークセンターを使い始めるまで。
  //   役割 chef：GM・CEO が確かめた Head Chef の印があるとき。Head Chef（G4）は使い始めるまで、Corporate Chef（G5）はいつも。
  //   役割は今の社員の表（画面が使う役割と同じ。公開の鍵で書ける＝今の画面と同じ確かさ）、グレードは GM・CEO が確かめた写しとの狭いほう（whoami）。
  //   使い始めたか（live）は work-requests の whoami の答え（wr_settings・サーバーの鍵だけ）。分からないときは使い始めたとみなす（狭いほう）
  async function tipDecider(a) {
    if (!a) return false;
    if (TIP_DECIDE.includes(a.role)) return true;
    if (a.role !== 'staff' || !(a.grade >= 4) || a.confirmed !== true || typeof a.emp !== 'string' || !a.emp) return false;
    let e = null;
    try { const r = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=role,data'); e = Array.isArray(r) && r.length === 1 ? r[0] : null; } catch { return false; }
    if (!e) return false;
    const d = obj(e.data) || {}, role = String(e.role || d.role || '');
    const notLive = a.live === false;
    if (role === 'g4') return notLive;
    if (role === 'chef') return (a.grade >= 5 || notLive) && await confChef(a);
    return false;
  }

  // v1146（Codex #140 6766283780 の P3）：本人かを見るための、この人の名前。PIN の印・確かめた写しの名前（a.name）と、社員の表の自分の行の名前（列と data）。
  //   社員と結ばれていない人（社員 ID の無いメールのログイン）は a.name だけ（空なら本人かを決められない＝決めない・申請しない）。読めなければ失敗（500。端末は送り直す）
  // v1147（Codex #141 6781928056 の P2-2）：この人の前の名前（社員の変更記録の name・col:name の前と後と、そのときの名前）。
  //   社員の表の名前は公開の鍵で書けるので、メールのログイン（社員の表の名前しか分からない）の GM・CEO が自分の行の名前を変えると、
  //   前の名前の自分の Tip Rate の申請を承認できた。決める人だけが呼ぶ。読めない（表が無い＝SQL 20261029090000 の前を含む）ときは失敗
  //  （500。決めない：本人かを確かめられないので。端末は送り直す・断った印は付けない）
  // Codex #141 6784041763 の P2：前は新しい順に 2000 件までしか読まず、残りを「前の名前ではない」としていた
  // （名前を何度も変える・サーバーの 1 回の上限が小さいと、古い名前の自分の申請を決められた）。
  // いまは id の古い順に、続きの id（id=gt.）で空のページが来るまで読む（1 回の上限・max-rows に左右されない）。
  // 読み切れない（ページが多すぎる・途中で読めない・id が進まない）ときは決めない（500）
  async function tipPastNames(a) {
    if (!a || typeof a.emp !== 'string' || !a.emp) return [];
    const out = [];
    let last = null;
    for (let page = 0; ; page++) {
      if (page >= TIP_PAST_PAGES) throw err('db', 500);
      let r;
      try {
        r = await rest('employee_field_log?emp_id=eq.' + encodeURIComponent(a.emp) + '&field=in.(name,' + encodeURIComponent('"col:name"') + ')'
          + (last === null ? '' : '&id=gt.' + last) + '&select=id,old_value,new_value,emp_name&order=id.asc&limit=' + TIP_PAST_PAGE);
      } catch { throw err('db', 500); }   // 表が無い（404）も 500 にする（404 は「関数が無い」と読まれるので）
      if (!Array.isArray(r)) throw err('db', 500);
      if (!r.length) return out;
      for (const x of r) for (const v of [x && x.old_value, x && x.new_value, x && x.emp_name]) if (typeof v === 'string' && v.length <= 200) out.push(v);
      const id = String(r[r.length - 1] && r[r.length - 1].id);
      if (!/^[0-9]{1,18}$/.test(id) || (last !== null && BigInt(id) <= BigInt(last))) throw err('db', 500);   // id が読めない・進まない
      last = id;
    }
  }
  async function tipActorNames(a) {
    const out = [a && a.name];
    if (a && typeof a.emp === 'string' && a.emp) {
      const r = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=name,data');
      for (const e of (Array.isArray(r) ? r : [])) { const d = obj(e && e.data) || {}; out.push(e && e.name, d.name); }
    }
    return out.filter(x => typeof x === 'string' && x.length <= 200);
  }

  // 目標を見せてよい人：本人。AM は担当の店（と自分の店）、G4 以上は自分の店の人（Career Score の一覧で見られる人）
  async function goalsGate(a) {
    const self = id => id === a.emp;
    self.sig = 's';
    let stores = [];
    if (a.role === 'am') stores = [...new Set([...a.am, ...a.stores])];
    else if (a.role === 'staff' && a.grade >= 4) stores = a.stores;
    if (!stores.length) return self;
    let emps = [], mgr = [], ams = [];
    try { [emps, mgr, ams] = await Promise.all([rest('employees?select=id,store&limit=5000'), rest('manager_auth?select=emp_id&limit=1000'), rest('wr_people?select=emp_id&role=eq.am&limit=1000')]); }
    catch { return self; }
    // 社員の表の店は公開の鍵で書けるので、CEO・GM・経理・事務Crew（manager_auth）と AM（GM・CEO が確かめた写し）の目標は、店を書き換えても見せない
    const top = new Set([...(Array.isArray(mgr) ? mgr : []), ...(Array.isArray(ams) ? ams : [])].map(x => String((x && x.emp_id) || '')).filter(Boolean));
    const ok = new Set((Array.isArray(emps) ? emps : []).filter(e => e && stores.includes(String(e.store || '')) && !top.has(String(e.id))).map(e => String(e.id)));
    const fn = id => self(id) || ok.has(id);
    fn.sig = 'g:' + [...ok].sort().join(',');
    return fn;
  }

  // ---- 行
  const IN = keys => 'in.(' + keys.map(k => '"' + String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
  const SEL_ALL = 'or=' + encodeURIComponent('(key.' + IN(SS_KEYS) + ',' + SS_PREFIX.map(p => 'key.like.' + p + '*').join(',') + ')');
  async function readRows(keys) {
    const q = keys ? 'key=' + encodeURIComponent(IN(keys)) : SEL_ALL;
    const rows = await rest('app_state?select=key,value,updated_at&' + q + '&limit=1000');
    return (Array.isArray(rows) ? rows : []).filter(r => r && ssIsKey(r.key) && r.key !== 'karte_pin');
  }
  // 行の一覧と印（md5）：app_state_index（v1098）があればそれ（サーバーの鍵で呼ぶ）。無ければ null
  // 独立レビュー P2-2：PostgREST は 1 回に返す行に上限（既定 1000）があるので、空のページが来るまで読む
  async function index() {
    try {
      const out = [];
      for (let off = 0, page = 0; page < 100; page++) {
        const rows = await rest('rpc/app_state_index?order=key.asc&limit=1000&offset=' + off, { method: 'POST', body: JSON.stringify({ p_skip_prefix: ['invoice_purchase_', 'lunch_photo_', 'spl_lss_history_'] }) });
        if (!Array.isArray(rows)) return null;
        if (!rows.length) break;
        off += rows.length;
        // v1140：Career Score のキーも（履歴は開いたときだけ取るので一覧に入れない）
        // v1147：Tip の期間の確定・注意ログも（店ごとの行）。v1148：グレード履歴・賞与の個人設定・G3 の職種も
        for (const r of rows) if (r && (ssIsKey(r.key) || (csIsKey(r.key) && csParse(r.key).kind !== 'hist') || scIsKey(r.key) || gbIsKey(r.key)) && r.key !== 'karte_pin' && /^[0-9a-f]{32}$/.test(String(r.h || ''))) out.push({ key: r.key, v: 'h:' + r.h });
        if (page === 99) return null;   // 読み切れない：中身から作る
      }
      return out;
    } catch { return null; }
  }


  // ================================================================ v1140：Career Score
  // 行を読む（キーが多いときは URL が長くなりすぎないよう分ける）
  async function readKeysAny(keys, pred = csIsKey) {   // v1147：pred（どの種類のキーか。初めは Career Score）
    const out = [];
    let batch = [], len = 0;
    const flush = async () => {
      if (!batch.length) return;
      const rows = await rest('app_state?select=key,value,updated_at&key=' + encodeURIComponent(IN(batch)) + '&limit=1000');
      if (Array.isArray(rows)) out.push(...rows);
      batch = []; len = 0;
    };
    for (const k of keys) {
      const el = encodeURIComponent(k).length + 8;
      if (len + el > 6000 && batch.length) await flush();
      batch.push(k); len += el;
    }
    await flush();
    return out.filter(r => r && pred(r.key));
  }
  // Career Score の行を全部（履歴は hist のときだけ）。1000 行ずつ、空のページが来るまで（独立レビュー P3：上限の行数が 1000 より小さいサーバーでも切れない）。
  // 読み切れない（50 ページ）ときは失敗にする（途中までの一覧で、端末の写しを消さない）
  async function readCsAll(hist) {
    const q = hist ? 'key=like.spl_lss_history_*'
      : 'or=' + encodeURIComponent('(key.' + IN(CS_LEGACY) + ',key.like.lss_emp_*,key.like.spl_lss_requests_*)');
    const out = [];
    for (let off = 0, page = 0; ; page++) {
      if (page >= 50) throw err('db', 500);
      const rows = await rest('app_state?select=key,value,updated_at&' + q + '&order=key.asc&limit=1000&offset=' + off);
      if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows); off += rows.length;
    }
    return out.filter(r => r && csIsKey(r.key) && (hist ? csParse(r.key).kind === 'hist' : csParse(r.key).kind !== 'hist'));
  }
  // 人の表（社員の表・manager_auth・GM・CEO が確かめた写し・Score管理の権限）。社員の表の店・肩書き・役割・名前は公開の鍵で書けるので、
  // CEO・GM・経理・事務Crew（manager_auth）と AM（確かめた写し）の人は、店で決まる範囲には入れない（v1139 の目標と同じ）。
  // 退職の人も返す（同じ名前の人を見分けるため。範囲には入れない）。確かめた写しの名前が社員の表の名前と違えば、その名前も持つ（confName）
  async function csPeople() {
    const [emps, mgr, wrp, cfgRows] = await Promise.all([
      rest('employees?select=id,name,store,support,role,title,status,data&limit=5000'),
      rest('manager_auth?select=emp_id,role&limit=1000'),
      rest('wr_people?select=emp_id,name,role,grade&limit=2000'),
      rest('app_state?select=value&key=eq.career_cfg'),
    ]);
    const mrole = new Map(), conf = new Map();
    for (const m of (Array.isArray(mgr) ? mgr : [])) if (m && m.emp_id != null && MGR_ROLES.includes(m.role)) mrole.set(String(m.emp_id), m.role);
    for (const c of (Array.isArray(wrp) ? wrp : [])) if (c && c.emp_id != null) conf.set(String(c.emp_id), { role: c.role, grade: Number.isInteger(c.grade) ? c.grade : 0, name: typeof c.name === 'string' ? c.name : '' });
    const cfg = obj(Array.isArray(cfgRows) && cfgRows[0] ? cfgRows[0].value : null) || {};
    const list = [], ids = new Set();
    for (const e of (Array.isArray(emps) ? emps : [])) {
      if (!e || e.id == null || typeof e.name !== 'string' || !e.name) continue;
      const d = obj(e.data) || {}, id = String(e.id), c = conf.get(id) || null, mr = mrole.get(id) || '';
      const role = String(e.role || d.role || ''), title = String(e.title || d.title || '');
      const support = Array.isArray(e.support) ? e.support : (Array.isArray(d.support) ? d.support : []);
      const out = String(e.status || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true';
      const gL = wrGrade(title, role), gS = Math.max(gL, c ? c.grade : 0);
      const dept = (typeof d.career === 'string' && d.career) || TITLE_DEPT[title] || '';
      const ag = appGrade(title, role);
      const cfgView = [], cfgEdit = [], cfgApprove = [];
      if (SPEC_DEPTS.includes(dept) && ag) {
        const x = obj(cfg[dept + '|' + (ag === 'G1-P' ? 'G1' : ag)]);
        const pick = f => (x && !x._deleted && Array.isArray(x[f])) ? x[f].filter(r => typeof r === 'string') : [];
        cfgEdit.push(...pick('csEdit')); cfgApprove.push(...pick('csApprove'));
        cfgView.push(...pick('csView'), ...cfgEdit, ...cfgApprove);   // 付ける・承認する役は見られる（アプリの cgCsGranted と同じ）
      }
      ids.add(id);
      // known：グレードが分かる（肩書きか役割が決まりにある・GM・CEO が確かめた写しにグレードがある）。どちらも空の人は wrGrade が 1 とみなすが「分からない」
      list.push({ id, name: e.name, confName: c && c.name && c.name !== e.name ? c.name : '', store: String(e.store || d.store || ''), support: support.filter(x => typeof x === 'string'), role, title, out, gS, known: !!ag || !!(c && c.grade > 0), dept,
        top: !!mr || !!(c && c.role === 'am'), boss: mr === 'ceo' || mr === 'gm', confAm: !!(c && c.role === 'am'), cfgView, cfgEdit, cfgApprove });
    }
    // 確かめた写しにだけある人（社員の表に行が無い）：その名前はだれにも見せない
    for (const [id, c] of conf) if (!ids.has(id) && c.name) list.push({ id, name: c.name, confName: '', store: '', support: [], role: '', title: '', out: true, gS: 0, known: false, dept: '', top: true, boss: false, confAm: c.role === 'am', cfgView: [], cfgEdit: [], cfgApprove: [] });
    return list;
  }
  // 見られる人（see）・申請を見られる人（req）・点（lss_emp_）を書ける人（emp：そのまま／ojt：分野の下限を上げるだけ＝名前 → 上げてよい上限）・
  // 履歴を書ける人（hist）・本人（self）。名前の Set（Map）。
  // 点・申請・履歴は名前で持っているので、名前で決める。社員の表の名前は公開の鍵で書き換えられるので（独立レビュー P1-1）、
  // その名前を持つ人（社員の表の名前・確かめた写しの名前。退職の人も）が全員その範囲に入るときだけ、その名前を渡す。
  // 本人の名前は、その名前を持つのが本人だけのときだけ。本人とほかの人が同じ名前なら、その名前は渡さない（だれの点か分からない）
  async function csScope(a) {
    const P = await csPeople();
    const actorId = String(a.emp || '');
    const me = actorId ? (P.find(p => p.id === actorId && !p.out) || null) : null;
    const isChef = a.role === 'staff' && a.grade >= 4 && !!me && (me.role === 'chef' || CHEF_TITLES.includes(me.title)) && await confChef(a);   // v1144：確かめた写しでも Head Chef
    // Score管理（career_cfg）の役職：アプリの役割と同じ名前
    const R = ['office', 'office_crew', 'am'].includes(a.role) ? a.role
      : a.role === 'staff' ? (isChef ? 'chef' : a.grade >= 4 ? 'g4' : a.grade === 3 ? 'sl' : '') : '';
    // 店：AM は whoami（確かめた写しとの重なり）。ほかの人は GM・CEO が確かめた写し（G2 以上）との重なりだけ（社員の表の役割・肩書き・店は
    // 公開の鍵で書けるので、写しの無い人は店の人を見ない＝自分の分だけ：v1147・Codex #141 6781928056 の P2-1 と同じ）
    const S = a.role === 'am' ? [...new Set([...a.am, ...a.stores])] : (a.role === 'staff' ? await protStores(a) : a.stores);
    const inStores = p => S.length > 0 && (S.includes(p.store) || p.support.some(x => S.includes(x)));
    const okOf = p => {
      if (p.out) return null;
      let vis = false;
      if (a.role === 'am') vis = !p.top && inStores(p);
      else if (a.role === 'staff') {
        if (isChef) vis = !p.top && !OFFICE_ROLES.includes(p.role);              // Head Chef：全店の人（申請と、その判断に要る点。本部の事務の人は入れない）
        else if (a.grade >= 4) vis = !p.top && inStores(p) && p.gS <= 4;          // G4：自分の店の G4 以下
        else if (a.grade === 3) vis = !p.top && inStores(p) && p.gS <= 2;         // G3：自分の店の G1・G2
        else if (a.grade === 2) vis = !p.top && inStores(p) && p.gS === 1;        // Crew Leader：自分の店の G1
      } else if (a.role === 'office' || a.role === 'office_crew') vis = HQ_ROLES.includes(p.role) && !p.boss && !p.confAm;   // 本部の人（Office管理のメンバー）
      // Score管理で選ばれた役（GM・CEO・確かめた AM の人は除く。G4 は G4 以下。G4・G3 は自分の店の人だけ＝一覧と同じ）
      const gOk = !!R && !p.boss && !p.confAm && (R !== 'g4' || p.gS <= 4) && (!['g4', 'sl'].includes(R) || inStores(p));
      const gView = gOk && p.cfgView.includes(R);
      // 点・履歴を直接書く：承認する役（承認すると点と履歴を書く）。付ける役は AM だけが直接（AM より下の役は申請＝アプリの lssNeedsApproval）
      const gWrite = gOk && (p.cfgApprove.includes(R) || (R === 'am' && p.cfgEdit.includes(R)));
      const full = (a.role === 'am' && vis) || gWrite;
      // OJT の合格（ワークセンターを使い始める前は直接）：サインできる人（G3 以上＝アプリの g2CanEdit）が、範囲の G1・G2（OJT の相手）の分野の下限を上げるだけ
      const ojt = !full && a.role === 'staff' && a.grade >= 3 && vis && p.gS <= 2;
      return { see: vis || gView, req: vis || gView, emp: full ? 2 : ojt ? 1 : 0, hist: full, cap: p.gS <= 1 ? 2 : 3 };
    };
    const byName = new Map();
    const hold = (n, p) => { if (!n) return; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(p); };
    for (const p of P) { hold(p.name, p); hold(p.confName, p); }
    const onlyMe = n => { const hs = byName.get(n); return !!hs && hs.length > 0 && hs.every(h => h.id === actorId); };
    const see = new Set(), req = new Set(), emp = new Set(), ojt = new Map(), hist = new Set(), self = new Set();
    if (me && onlyMe(me.name)) self.add(me.name);
    if (me && a.name && a.name !== me.name) {
      if (onlyMe(a.name)) self.add(a.name);                                       // GM・CEO が確かめた写しの名前（社員の表はまだ前の名前）
      else if (a.name.trim() === me.name.trim() && onlyMe(me.name) && !byName.has(a.name)) self.add(a.name);   // 名前の前後の空白だけ違う
    }
    for (const [n, hs] of byName) {
      if (hs.some(h => h.id === actorId)) continue;                               // 本人の名前（上）。本人とほかの人が同じ名前なら渡さない
      const oks = hs.map(okOf);
      if (oks.some(o => !o)) continue;                                            // 退職の人・社員の表に無い人と同じ名前
      if (oks.every(o => o.see)) see.add(n);
      if (oks.every(o => o.req)) req.add(n);
      if (oks.every(o => o.emp === 2)) emp.add(n);
      else if (oks.every(o => o.emp >= 1)) ojt.set(n, Math.min(...oks.map(o => o.cap)));
      if (oks.every(o => o.hist)) hist.add(n);
    }
    for (const n of self) { see.add(n); req.add(n); }                            // 自分の点・履歴は書けない（自己評価は申請）
    // v1148：見られる人の従業員 ID（その名前を持つ人。名前を渡すのはその名前の人が全員見られるときだけなので、全員の ID）と本人の ID。
    // グレード履歴・賞与の個人設定・G3 の職種（ID で持っている記録）を、Career Score と同じ範囲で分ける（gbScope）
    const ids = new Set();
    for (const n of see) for (const p of (byName.get(n) || [])) if (p.id) ids.add(p.id);
    if (me) ids.add(me.id);
    return { see, req, emp, ojt, hist, self, ids };
  }
  const csSig = sc => [...sc.see].sort().join('\u0001') + '\u0002' + [...sc.req].sort().join('\u0001');
  function csProject(key, value, sc) {
    if (key === 'lss_scores') { const m = obj(value) || {}; const o = {}; for (const [n, v] of Object.entries(m)) if (sc.see.has(n)) o[n] = v; return o; }
    const list = Array.isArray(value) ? value : [];
    const set = key === 'lss_requests' ? sc.req : sc.see;
    return list.filter(r => obj(r) && typeof r.name === 'string' && set.has(r.name));
  }
  function csCanRead(p, sc) {
    if (p.kind === 'legacy') return true;
    return p.kind === 'req' ? sc.req.has(p.name) : sc.see.has(p.name);
  }

  async function csPull(a, b, idx, csP) {   // v1148：csP（同じ取り込みの中で見られる人を 1 回だけ決める。gbScope と分け合う）
    const level = levelOf(a);
    if (level === 'none') return { level: 'none', names: [], req_names: [], index: [], rows: [] };
    const have = obj(b.cs_have) || {};
    if (level === 'full') {
      if (idx) {
        const need = idx.filter(x => have[x.key] !== x.v).map(x => x.key);
        const ver = Object.fromEntries(idx.map(x => [x.key, x.v]));
        const rows = need.length ? await readKeysAny(need) : [];
        return { level, names: null, req_names: null, index: idx, rows: rows.filter(r => ver[r.key]).map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, v: ver[r.key] })) };
      }
      const rows = await readCsAll(false), out = [];
      for (const r of rows) out.push({ key: r.key, value: r.value, updated_at: r.updated_at, v: 'x:' + await sha256(JSON.stringify(r.value)) });
      return { level, names: null, req_names: null, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
    }
    const sc = await (csP ? csP() : csScope(a)), sig = await sha256(csSig(sc));
    const names = [...sc.see].sort(), req_names = [...sc.req].sort();
    let base;   // [{key, v（元の行の印）}]
    if (idx) base = idx;
    else {
      const rows = await readCsAll(false);
      base = [];
      for (const r of rows) base.push({ key: r.key, v: 'x:' + await sha256(JSON.stringify(r.value)), row: r });
    }
    const sidx = [];
    for (const x of base) {
      const p = csParse(x.key);
      if (!p || !csCanRead(p, sc)) continue;
      sidx.push({ key: x.key, v: p.kind === 'legacy' ? 'p:' + await sha256(x.v + '|' + sig) : x.v, row: x.row });
    }
    const need = sidx.filter(x => have[x.key] !== x.v);
    let rows = need.filter(x => x.row).map(x => x.row);
    const toRead = need.filter(x => !x.row).map(x => x.key);
    if (toRead.length) rows = rows.concat(await readKeysAny(toRead));
    const ver = Object.fromEntries(sidx.map(x => [x.key, x.v]));
    return { level: 'scoped', names, req_names, index: sidx.map(x => ({ key: x.key, v: x.v })),
      rows: rows.filter(r => ver[r.key]).map(r => ({ key: r.key, value: csParse(r.key).kind === 'legacy' ? csProject(r.key, r.value, sc) : r.value, updated_at: r.updated_at, v: ver[r.key] })) };
  }
  // 履歴（開いたときだけ）：見られる人の spl_lss_history_
  async function csHist(a) {
    const level = levelOf(a);
    if (level === 'none') throw err('forbidden', 403);
    const rows = await readCsAll(true);
    if (level === 'full') return { level, names: null, rows: rows.map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at })) };
    const sc = await csScope(a);
    return { level: 'scoped', names: [...sc.see].sort(), rows: rows.filter(r => sc.see.has(csParse(r.key).name)).map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at })) };
  }
  async function csGet(a, key) {
    const level = levelOf(a);
    if (level === 'none') throw err('forbidden', 403);
    const p = csParse(key);
    let sc = null;
    if (level !== 'full') { sc = await csScope(a); if (!csCanRead(p, sc)) throw err('forbidden', 403); }
    const rows = await readKeysAny([key]);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    const r = rows[0];
    if (sc && p.kind === 'legacy') return { exists: true, value: csProject(key, r.value, sc), updated_at: r.updated_at, proj: true };
    return { exists: true, value: r.value, updated_at: r.updated_at };
  }
  // 書く前の確かめ（CEO・GM 以外）。cur：今の行の値（無ければ null）。ダメなら forbidden（403）か bad_value（400）
  // OJT の合格で分野の下限を上げるだけか（アプリの g2RaiseAxisFloor）：点を下げない・消さない・上げるのは上限（G1 は 2、G2 は 3）まで。
  // 点のほかの欄は変えない（日付・OJT の印・保存の印は変えてよい。評価者・状態は無かったときだけ入れてよい）。base：今の点（無ければ前の統合行のその人の分）
  const OJT_FREE = new Set(['scores', 'date', 'autoOjt', '_at', '_by', '_set', 'evaluator', 'status']);
  function ojtRaiseOk(base, value, cap) {
    const c = obj(base) || {};
    if (!obj(value)) return false;
    for (const k of new Set([...Object.keys(c), ...Object.keys(value)])) {
      if (OJT_FREE.has(k)) continue;
      if (canon(c[k] === undefined ? null : c[k]) !== canon(value[k] === undefined ? null : value[k])) return false;
    }
    for (const k of ['evaluator', 'status']) {
      const had = c[k] !== undefined && c[k] !== null && c[k] !== '';
      if (had ? canon(c[k]) !== canon(value[k] === undefined ? null : value[k]) : (value[k] != null && (typeof value[k] !== 'string' || value[k].length > 60))) return false;
    }
    if (value.autoOjt !== undefined && value.autoOjt !== true && canon(value.autoOjt) !== canon(c.autoOjt === undefined ? null : c.autoOjt)) return false;
    const cs = obj(c.scores) || {}, vs = obj(value.scores);
    if (!vs) return false;
    for (const id of Object.keys(cs)) if (!Object.prototype.hasOwnProperty.call(vs, id)) return false;     // 消さない
    for (const [id, v] of Object.entries(vs)) {
      const had = Object.prototype.hasOwnProperty.call(cs, id);
      if (had && canon(cs[id]) === canon(v)) continue;
      const before = had ? (parseInt(cs[id], 10) || 0) : 0;
      if (typeof v !== 'number' || !Number.isInteger(v) || v > cap || v <= before) return false;            // 上げるだけ・上限まで
    }
    return true;
  }
  function csCheck(p, value, cur, sc, base) {
    if (p.kind === 'legacy') throw err('forbidden', 403);                          // 前の統合行は CEO・GM だけ（見せる形で書き戻さない）
    const may = p.kind === 'req' ? sc.req.has(p.name) : p.kind === 'emp' ? (sc.emp.has(p.name) || sc.ojt.has(p.name)) : sc.hist.has(p.name);
    if (!may) throw err('forbidden', 403);
    if (JSON.stringify(value === undefined ? null : value).length > 2000000) throw bad();
    if (p.kind === 'emp') {
      if (!obj(value)) throw bad();
      if (!sc.emp.has(p.name) && !ojtRaiseOk(cur != null ? cur : base, value, sc.ojt.get(p.name))) throw err('forbidden', 403);   // OJT の合格だけ（独立レビュー P2-2）
      return;
    }
    if (!Array.isArray(value) || value.length > 5000) throw bad();
    if (!value.every(r => obj(r) && r.name === p.name)) throw bad();              // 別の人の記録を混ぜない
    const curList = Array.isArray(cur) ? cur.filter(r => obj(r)) : [];
    if (p.kind === 'hist') {                                                       // 履歴は足すだけ（消さない・書き換えない）
      const have = new Set(value.map(canon));
      if (!curList.every(r => have.has(canon(r)))) throw err('forbidden', 403);
      return;
    }
    // 申請：今ある申請を消さない
    const byId = new Map(value.filter(r => r.id != null).map(r => [String(r.id), r]));
    if (!curList.every(r => r.id == null || byId.has(String(r.id)))) throw err('forbidden', 403);
    if (!sc.self.has(p.name)) return;
    // 自分の申請の行：新しい申請（申請中）を足す・自分で取り下げる（取消）だけ。自分で承認・却下しない・ほかの人が出した申請を書き換えない
    const curById = new Map(curList.filter(r => r.id != null).map(r => [String(r.id), r]));
    const strip = o => { const x = { ...o }; delete x.status; delete x.supersededAt; delete x.wr; delete x._mut; return canon(x); };
    for (const r of value) {
      const c = r.id == null ? null : curById.get(String(r.id));
      if (!c) { if (!pendingSt(r.status)) throw err('forbidden', 403); continue; }
      if (canon(c) === canon(r)) continue;
      if (strip(c) !== strip(r)) throw err('forbidden', 403);
      if (r.status !== c.status && !(pendingSt(c.status) && r.status === '取消')) throw err('forbidden', 403);
    }
  }
  async function csPut(a, b) {
    const key = b.key, p = csParse(key);
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    if (levelOf(a) === 'full') return writeRow(key, b.value, e, a);
    if (levelOf(a) === 'none') throw err('forbidden', 403);
    const sc = await csScope(a);
    const rows = await readKeysAny([key]), cur = rows[0] || null;
    let base = null;   // OJT の合格で点の行がまだ無い人：アプリは前の統合行のその人の分から下限を上げる（getLssScores）
    if (p.kind === 'emp' && !cur && !sc.emp.has(p.name) && sc.ojt.has(p.name)) {
      const lg = await readKeysAny(['lss_scores']);
      const m = lg[0] && obj(lg[0].value);
      base = m && obj(m[p.name]) ? m[p.name] : null;
    }
    csCheck(p, b.value, cur ? cur.value : null, sc, base);
    // 確かめた行に書く（読んだあとに変わっていれば conflict）。expect があればそれとも合わせる
    if (e) {
      if (e.exists && e.updated_at != null && tsMicro(e.updated_at) == null) throw bad();
      if (!!cur !== e.exists) throw err('conflict', 409);
      if (cur && (e.updated_at == null ? cur.updated_at != null : tsMicro(cur.updated_at) !== tsMicro(e.updated_at))) throw err('conflict', 409);
    }
    return writeRow(key, b.value, cur ? { exists: true, updated_at: cur.updated_at } : { exists: false }, a);
  }

  async function pull(a, b) {
    // v1140：Career Score（cs_have を送ってきたアプリ＝v1140 から。前の版のアプリには付けない）
    const wantCs = obj(b.cs_have) !== null;
    const wantSc = obj(b.sc_have) !== null;   // v1147：sc_have を送ってきたアプリ（v1147 から）にだけ、Tip の期間の確定・注意ログを付ける
    const wantGb = obj(b.gb_have) !== null;   // v1148：gb_have を送ってきたアプリ（v1148 から）にだけ、グレード履歴・賞与の個人設定・G3 の職種を付ける
    // 見られる人（Career Score の範囲）は 1 回だけ決める（Career Score と v1148 の 3 つで分け合う。社員の表などを 2 回読まない）
    let csMemo = null;
    const csP = () => (csMemo || (csMemo = csScope(a)));
    // 見られる店を先に決める（何も見ない人＝G1 などに、全部の行の一覧を読まない：Claude のレビュー 6781770026 の P3）
    let scS = null, scErr = false;
    if (wantSc) { try { scS = await scScope(a); } catch (e) { console.error('secure-state sc scope', safeErr(e)); scErr = true; } }
    const scAny = !!scS && scOut(scS).level !== 'none';
    let gbS = null, gbErr = false;
    if (wantGb) { try { gbS = await gbScope(a, csP); } catch (e) { console.error('secure-state gb scope', safeErr(e)); gbErr = true; } }
    const gbAny = !!gbS && GB_KEYS.some(k => gbLevel(gbS, k) !== 'none');
    const idxAll = (levelOf(a) === 'none' && !scAny && !gbAny) ? null : await index();
    const out = await pullKb(a, b, idxAll && idxAll.filter(x => ssIsKey(x.key)));
    if (wantCs) {
      try { out.cs = await csPull(a, b, idxAll && idxAll.filter(x => csIsKey(x.key)), csP); }
      catch (e) { console.error('secure-state cs pull', safeErr(e)); out.cs = { error: 'scope' }; }   // 見られる人を決められなかった：端末の写しはそのまま
    }
    if (wantSc) {
      if (scErr) out.sc = { error: 'scope' };   // 見られる店を決められなかった：端末の写しはそのまま
      else {
        try { out.sc = await scPull(a, b, idxAll && idxAll.filter(x => scIsKey(x.key)), scS); }
        catch (e) { console.error('secure-state sc pull', safeErr(e)); out.sc = { error: 'scope' }; }
      }
    }
    if (wantGb) {
      if (gbErr) out.gb = { error: 'scope' };   // 見られる人を決められなかった：端末の写しはそのまま
      else {
        try { out.gb = await gbPull(a, b, idxAll && idxAll.filter(x => gbIsKey(x.key)), gbS); }
        catch (e) { console.error('secure-state gb pull', safeErr(e)); out.gb = { error: 'scope' }; }
      }
    }
    return out;
  }
  async function pullKb(a, b, idx0) {
    const level = levelOf(a);
    if (level === 'none') return { level, index: [], rows: [] };
    const have = obj(b.have) || {};
    if (level === 'full') {
      const idx = idx0;
      if (idx) {
        const need = idx.filter(x => have[x.key] !== x.v).map(x => x.key);
        const rows = need.length ? await readRows(need) : [];
        const ver = Object.fromEntries(idx.map(x => [x.key, x.v]));
        return { level, index: idx, rows: rows.map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, v: ver[r.key] || null })).filter(r => r.v) };
      }
      const rows = await readRows(null);
      const out = [];
      for (const r of rows) out.push({ key: r.key, value: r.value, updated_at: r.updated_at, v: 'x:' + await sha256(JSON.stringify(r.value)) });
      return { level, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
    }
    // proj：見せる形にしてから印を付ける。印は元の行の印（md5）と見せる範囲から作り、変わっていなければ行を読まない
    //（成長カルテは大きく、CEO・GM 以外のログインと 10 分ごとの同期のたびに読んでいた：独立レビュー P3）
    const gate = await goalsGate(a);
    const idx = idx0;
    if (idx) {
      const pidx = [];
      for (const x of idx) if (SS_PROJ.includes(x.key)) pidx.push({ key: x.key, v: 'p:' + await sha256(x.v + '|' + (x.key === 'growth_karte' ? a.emp + '|' + gate.sig : '')) });
      const need = pidx.filter(x => have[x.key] !== x.v).map(x => x.key);
      const rows = need.length ? await readRows(need) : [];
      const pv = Object.fromEntries(pidx.map(x => [x.key, x.v]));
      return { level, index: pidx, rows: rows.filter(r => pv[r.key]).map(r => ({ key: r.key, value: r.key === 'growth_karte' ? projKarte(r.value, gate) : projKbCfg(r.value), updated_at: r.updated_at, v: pv[r.key] })) };
    }
    const rows = await readRows(SS_PROJ);
    const out = [];
    for (const r of rows) {
      const value = r.key === 'growth_karte' ? projKarte(r.value, gate) : projKbCfg(r.value);
      out.push({ key: r.key, value, updated_at: r.updated_at, v: 'p:' + await sha256(JSON.stringify(value)) });
    }
    return { level, index: out.map(r => ({ key: r.key, v: r.v })), rows: out.filter(r => have[r.key] !== r.v) };
  }

  async function get(a, b) {
    const key = b.key;
    if (scIsKey(key)) return scGet(a, key);   // v1147
    if (gbIsKey(key)) return gbGet(a, key);   // v1148
    if (csIsKey(key)) return csGet(a, key);   // v1140
    if (!ssIsKey(key) || key === 'karte_pin') throw bad();
    const level = levelOf(a);
    if (level === 'none' || (level === 'proj' && !SS_PROJ.includes(key))) throw err('forbidden', 403);
    const rows = await readRows([key]);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    const r = rows[0];
    if (level === 'proj') return { exists: true, value: key === 'growth_karte' ? projKarte(r.value, await goalsGate(a)) : projKbCfg(r.value), updated_at: r.updated_at, proj: true };
    return { exists: true, value: r.value, updated_at: r.updated_at };
  }

  // 書く。expect が無い：今までの upsert と同じ（読んだ行によらず書く）。expect.exists=false：行が無いときだけ。expect.exists=true：updated_at が同じときだけ
  // v1141：決めた人だけが書ける設定。決めた人でなくても、クラウドと同じ値なら書かずに通す（一括の送り直しなどで、変えていない設定を送っても止まらない）
  async function swPut(a, b) {
    const key = b.key;
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    const cur = async () => { const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key)); return Array.isArray(rows) && rows[0] ? rows[0] : null; };
    if (!SW_WRITE[key].includes(a.role)) {
      // 決めた人でなければ書かない。クラウドと同じ値なら（まとめて送り直す端末のため）書かずに通す。
      // 書かないので値の形は見ない（クラウドの値そのものの形がおかしくても、送り直しが止まらないように＝独立レビュー P3-6）
      // v1148：グレード履歴・賞与の個人設定・G3 の職種は、全部を読めない人には同じ値でも 403（「同じ値か」で中身を当てる道にしない）
      if (gbIsKey(key) && gbLevel(await gbScope(a), key) !== 'all') throw err('forbidden', 403);
      const c = await cur();
      if (c && canon(c.value) === canon(b.value)) return { ok: true, updated_at: c.updated_at, same: true };
      throw err('forbidden', 403);
    }
    let cloud;
    if (swMapKey(key) && swCgBadKeys(b.value, swMapMax(key)).length) { const c = await cur(); cloud = c ? c.value : null; }
    if (!swShapeOk(key, b.value, cloud)) throw bad();
    // by：書いた人の役割（アプリが「設定 › 診断と記録」に残す。③ の前の確かめで、関数が決めた人として書いたことが分かる：Codex #135 の P2）
    return { ...(await writeRow(key, b.value, e, a)), by: a.role };
  }

  // v1146：Tip Rate・プレップ。読んだ行で確かめ（tpCheck）、その行が変わっていないときだけ書く
  async function tpPut(a, b) {
    const key = b.key;
    if (!Object.prototype.hasOwnProperty.call(b, 'value') || key.length > 200) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key));
    const c = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (c && canon(c.value) === canon(b.value)) return { ok: true, updated_at: c.updated_at, same: true, by: a.role };   // クラウドと同じ：書かずに通す
    // 端末が読んだ行（expect）から変わっていれば 409（端末は読み直して合わせてから送り直す。古い写しを「断られた」にしない）
    if (e && (e.exists !== !!c || (c && e.exists && tsMicro(e.updated_at) !== tsMicro(c.updated_at)))) throw err('conflict', 409);
    const dec = key.startsWith(TP_TIP_PRE) ? await tipDecider(a) : false;   // 名前の分からない人は申請を足せない・決めない（本人かを決められない：tpCheck）
    const names = key.startsWith(TP_TIP_PRE) ? await tipActorNames(a) : [];
    const past = dec ? await tipPastNames(a) : [];
    const v = tpCheck(key, c ? c.value : null, b.value, { role: a.role, name: a.name, names, dec, past });
    if (v === 'bad') throw bad();
    if (v !== 'ok') throw err('forbidden', 403);
    // 確かめた行に条件を付けて書く（確かめたあと・書く前にほかの端末が書いていれば 409）
    return { ...(await writeRow(key, b.value, c ? { exists: true, updated_at: c.updated_at } : { exists: false }, a)), by: a.role };
  }

  // ================================================================ v1147：Tip の期間の確定・注意ログ（店ごと。docs/SECURE_TIP_CF_V1147_JA.md）
  // 見られる店（今の画面と同じ。Moto さん 11/10「読む人も書く人も絞る」）：
  //   Tip の確定（チップ管理を開ける人）：CEO・GM・経理・事務Crew＝全店／確かめた AM＝担当の店と自分の店・応援の店／
  //     GM・CEO が確かめた Head Chef＝全店／ほかの G2〜G4・店長・リーダー・Head Chef（社員の表の役割で、GM・CEO が確かめた写しが G2 以上の人）＝
  //     写しの店と whoami の店の重なり（protStores）／確かめがまだの人・G1 など＝なし（Codex #141 6781928056 の P2-1）。
  //   注意ログ（必須チェックを開ける人。事務Crew は開けない）：同じ店。
  // 書ける人：Tip の確定＝見られる人（確定のボタンは画面を開ける人みんな）。確定の解除・例外承認＝CEO・GM・経理（画面と同じ）。
  //   注意ログを足す＝記録のボタンを押せる人（CEO・GM・確かめた AM・GM・CEO が確かめた G4 以上の G4・Head Chef）。
  // 社員の表の役割・店・応援は公開の鍵で書けるので、範囲は GM・CEO が確かめた写し（whoami の grade・confirmed、wr_people の grade・stores・chef）で決め、
  // 社員の表の役割は狭めることにだけ使う。店のログイン（店舗の PIN）は whoami が断る（401）＝何も見えない。
  const SC_NONE = { tip: false, wn: false, all: false, stores: [], confirm: false, unlock: false, wnWrite: false };
  async function scScope(a) {
    const empOk = async () => {
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,role,status,data');
      const e0 = Array.isArray(es) ? es[0] : null;
      return e0 && !empOut(e0) ? e0 : null;
    };
    if (MGR_ROLES.includes(a.role)) {
      // 社員と結ばれた CEO・GM・経理・事務Crew も、今の社員の表で退職・OS 停止・行が無ければ止める（v1142 の hrScope と同じ。PIN は 60 秒覚えているので）
      if (a.emp && !(await empOk())) return SC_NONE;
      const tip = true, wn = a.role !== 'office_crew';
      return { tip, wn, all: true, stores: [], confirm: tip, unlock: ['ceo', 'gm', 'office'].includes(a.role), wnWrite: ['ceo', 'gm'].includes(a.role) };
    }
    if (!a.emp) return SC_NONE;
    const e = await empOk();
    if (!e) return SC_NONE;
    const d = obj(e.data) || {}, rr = String(e.role || d.role || '');
    const S = [...new Set([...(a.role === 'am' ? a.am : []), ...a.stores])].filter(x => typeof x === 'string' && x);
    if (a.role === 'am') return { tip: true, wn: true, all: false, stores: S, confirm: true, unlock: false, wnWrite: true };
    if (a.role !== 'staff') return SC_NONE;
    // 画面と同じ役割（今の社員の表）の人だけ。役割は公開の鍵で書けるので、狭めることにだけ使う（Codex #141 6781928056 の P2-1）
    if (!['g4', 'am', 'chef', 'sl', 'g2'].includes(rr)) return SC_NONE;
    const g4ok = a.confirmed === true && Number(a.grade) >= 4;
    if (rr === 'chef' && g4ok && await confChef(a)) return { tip: true, wn: true, all: true, stores: [], confirm: true, unlock: false, wnWrite: true };
    // 店は GM・CEO が確かめた写し（G2 以上）と今の社員の表の重なり。写しの無い人（確かめがまだの AM・G4・Head Chef・店長・リーダーも）は何も見ない
    const P = await protStores(a);
    if (!P.length) return SC_NONE;
    return { tip: true, wn: true, all: false, stores: P, confirm: true, unlock: false, wnWrite: ['g4', 'am', 'chef'].includes(rr) && g4ok };
  }
  const scOut = sc => ({ level: (!sc.tip && !sc.wn) ? 'none' : (sc.all ? 'all' : 'scoped'), stores: sc.all ? null : [...sc.stores].sort(),
    tip: sc.tip, wn: sc.wn, confirm: sc.confirm, unlock: sc.unlock, wnWrite: sc.wnWrite });
  // 2 つの種類の行を全部（1000 行ずつ・空のページまで）。読み切れないときは失敗（途中までの一覧で端末の写しを消さない）
  async function readScAll() {
    const q = 'or=' + encodeURIComponent('(key.like.' + SC_TIP_PRE + '*,key.like.' + SC_WN_PRE + '*)');
    const out = [];
    for (let off = 0, page = 0; ; page++) {
      if (page >= 50) throw err('db', 500);
      const rows = await rest('app_state?select=key,value,updated_at&' + q + '&order=key.asc&limit=1000&offset=' + off);
      if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows); off += rows.length;
    }
    return out.filter(r => r && scIsKey(r.key));
  }
  async function scPull(a, b, idx, sc0) {
    const sc = sc0 || await scScope(a), o = scOut(sc);
    if (o.level === 'none') return { ...o, index: [], rows: [] };
    const have = obj(b.sc_have) || {};
    let base;   // [{key, v（元の行の印）, row?}]
    if (idx) base = idx.filter(x => scCanRead(x.key, sc));
    else {
      base = [];
      for (const r of await readScAll()) if (scCanRead(r.key, sc)) base.push({ key: r.key, v: 'x:' + await sha256(JSON.stringify(r.value)), row: r });
    }
    const need = base.filter(x => have[x.key] !== x.v);
    let rows = need.filter(x => x.row).map(x => x.row);
    const toRead = need.filter(x => !x.row).map(x => x.key);
    if (toRead.length) rows = rows.concat(await readKeysAny(toRead, scIsKey));
    const ver = Object.fromEntries(base.map(x => [x.key, x.v]));
    return { ...o, index: base.map(x => ({ key: x.key, v: x.v })),
      rows: rows.filter(r => ver[r.key] && scCanRead(r.key, sc)).map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, v: ver[r.key] })) };
  }
  // ================================================================ v1148：グレード履歴・賞与の個人設定・G3 の職種を読む範囲（docs/SECURE_GRADE_BONUS_READ_V1148_JA.md）
  // { all：全部を読むキー, ids：見られる人の従業員 ID（Set）か null }。
  //   CEO・GM＝3 つとも全部／経理・事務Crew＝グレード履歴は全部（HR・福利厚生の画面）・ほかの 2 つは Career Score で見られる人と本人／
  //   AM・スタッフ＝3 つとも Career Score で見られる人と本人（csScope の ids）／ほか（店のログインなど）＝なし
  async function gbScope(a, csP) {
    if (SS_FULL_ROLES.includes(a.role)) return { all: GB_KEYS.slice(), ids: null };
    if (!['office', 'office_crew', 'am', 'staff'].includes(a.role)) return { all: [], ids: null };
    const sc = await (csP ? csP() : csScope(a));
    return { all: OFFICE_ROLES.includes(a.role) ? ['grade_hist'] : [], ids: sc.ids };
  }
  const gbSig = gb => [...(gb.ids || [])].sort().join('\u0001');
  async function gbPull(a, b, idx, gb) {
    const keys = Object.fromEntries(GB_KEYS.map(k => [k, gbLevel(gb, k)]));
    const any = GB_KEYS.some(k => keys[k] !== 'none');
    if (!any) return { keys, index: [], rows: [] };
    const have = obj(b.gb_have) || {};
    const sig = await sha256(gbSig(gb));
    let base;   // [{key, v（元の行の印）, row?}]
    if (idx) base = idx.filter(x => keys[x.key] && keys[x.key] !== 'none');
    else {
      base = [];
      for (const r of await readKeysAny(GB_KEYS, gbIsKey)) if (keys[r.key] && keys[r.key] !== 'none') base.push({ key: r.key, v: 'x:' + await sha256(JSON.stringify(r.value)), row: r });
    }
    // 見られる人の分だけのときは、元の行の印と見られる人から印を作る（人が変われば送り直す・元の行が同じで人も同じなら読まない）
    const pidx = [];
    for (const x of base) pidx.push({ key: x.key, v: keys[x.key] === 'all' ? x.v : 'g:' + await sha256(x.v + '|' + sig), row: x.row });
    const need = pidx.filter(x => have[x.key] !== x.v);
    let rows = need.filter(x => x.row).map(x => x.row);
    const toRead = need.filter(x => !x.row).map(x => x.key);
    if (toRead.length) rows = rows.concat(await readKeysAny(toRead, gbIsKey));
    const ver = Object.fromEntries(pidx.map(x => [x.key, x.v]));
    return { keys, index: pidx.map(x => ({ key: x.key, v: x.v })),
      rows: rows.filter(r => ver[r.key]).map(r => ({ key: r.key, value: keys[r.key] === 'all' ? r.value : gbProject(r.key, r.value, gb.ids), updated_at: r.updated_at, v: ver[r.key] })) };
  }
  async function gbGet(a, key) {
    const gb = await gbScope(a), l = gbLevel(gb, key);
    if (l === 'none') throw err('forbidden', 403);
    const rows = await readKeysAny([key], gbIsKey);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    // 見られる人の分だけ（proj）：GM・CEO 以外は書かない（swPut が断る）。アプリはこの値で送るかを決めない（読むだけ）
    return l === 'all' ? { exists: true, value: rows[0].value, updated_at: rows[0].updated_at }
      : { exists: true, value: gbProject(key, rows[0].value, gb.ids), updated_at: rows[0].updated_at, proj: true };
  }

  async function scGet(a, key) {
    const sc = await scScope(a);
    if (!scCanRead(key, sc)) throw err('forbidden', 403);
    const rows = await readKeysAny([key], scIsKey);
    if (!rows.length) return { exists: false, value: null, updated_at: null };
    return { exists: true, value: rows[0].value, updated_at: rows[0].updated_at };
  }
  async function scPut(a, b) {
    const key = b.key, p = scParse(key);
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    const e = b.expect;
    if (e !== undefined && e !== null && (!obj(e) || typeof e.exists !== 'boolean')) throw bad();
    const sc = await scScope(a);
    // 見られない店・種類の行には書かない（同じ値でも 403：値を当てる道にしない）
    if (!scCanRead(key, sc)) throw err('forbidden', 403);
    if (JSON.stringify(b.value === undefined ? null : b.value).length > 4000000) throw bad();
    const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key));
    const c = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (c && canon(c.value) === canon(b.value)) return { ok: true, updated_at: c.updated_at, same: true, by: a.role };   // クラウドと同じ：書かずに通す
    if (e && (e.exists !== !!c || (c && e.exists && tsMicro(e.updated_at) !== tsMicro(c.updated_at)))) throw err('conflict', 409);
    if (!p.store) throw bad();                                                     // 形の合わないキー（tip_cf_x など）：だれも書かない
    const v = p.kind === 'tip' ? tcfCheck(p.year, c ? c.value : null, b.value, sc) : wnCheck(c ? c.value : null, b.value, sc);
    if (v === 'bad') throw bad();
    if (v !== 'ok') throw err('forbidden', 403);
    // 確かめた行に条件を付けて書く（確かめたあと・書く前にほかの端末が書いていれば 409）
    return { ...(await writeRow(key, b.value, c ? { exists: true, updated_at: c.updated_at } : { exists: false }, a)), by: a.role };
  }
  // 前の期間から Tip Rate を効かせるときの確かめ（アプリの tipBackPull）：その人の店のその期間が確定しているか（店の ID だけ。額は返さない）。
  // Tip Rate を決められる人（店では分けない）と、その店の確定を見られる人
  async function tcfStatus(a, b) {
    const from = typeof b.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.from) ? b.from : null;
    const stores = Array.isArray(b.stores) && b.stores.length <= 30 && b.stores.every(s => typeof s === 'string' && s && s.length <= 60) ? [...new Set(b.stores)] : null;
    if (!from || !stores) throw bad();
    const keyOf = s => SC_TIP_PRE + s + '_' + from.slice(0, 4);
    if (!(await tipDecider(a))) {
      const sc = await scScope(a);
      if (!stores.every(s => scCanRead(keyOf(s), sc))) throw err('forbidden', 403);
    }
    const rows = stores.length ? await readKeysAny(stores.map(keyOf), scIsKey) : [];
    const by = new Map(rows.map(r => [r.key, asVal(r.value)]));
    return { confirmed: stores.filter(s => { const m = obj(by.get(keyOf(s))), r = m && obj(m[from]); return !!(r && r._deleted !== true && r.status === '確定済み'); }) };
  }

  async function put(a, b) {
    const key = b.key;
    if (scIsKey(key)) return scPut(a, b);   // v1147
    if (tpIsKey(key)) return tpPut(a, b);   // v1146
    if (swIsKey(key)) return swPut(a, b);   // v1141
    if (csIsKey(key)) return csPut(a, b);   // v1140
    if (!ssIsKey(key) || key === 'karte_pin') throw bad();
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (!Object.prototype.hasOwnProperty.call(b, 'value')) throw bad();
    return writeRow(key, b.value, b.expect, a);
  }
  async function writeRow(key, value, e, a) {
    const b = { value };
    const ah = fpHdr(a);   // v1151：だれが書いたか（この関数が確かめた人）。見張り（20261118090000）が変更の記録に残す
    const pref = { prefer: 'return=representation', ...ah };
    if (e === undefined || e === null) {
      const ts = new Date(now()).toISOString();
      const rows = await rest('app_state?select=key,updated_at', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation', ...ah },
        body: JSON.stringify({ key, value: b.value, updated_at: ts }) });
      return { ok: true, updated_at: Array.isArray(rows) && rows[0] ? rows[0].updated_at : ts };
    }
    if (!obj(e) || typeof e.exists !== 'boolean') throw bad();
    if (!e.exists) {
      const ts = new Date(now()).toISOString();
      try {
        const rows = await rest('app_state?select=key,updated_at', { method: 'POST', headers: pref, body: JSON.stringify({ key, value: b.value, updated_at: ts }) });
        return { ok: true, updated_at: Array.isArray(rows) && rows[0] ? rows[0].updated_at : ts };
      } catch (x) { if (x.code === 'conflict') throw err('conflict', 409); throw x; }
    }
    const rt = e.updated_at;
    let ts;
    if (rt == null) ts = new Date(now()).toISOString();
    else {
      const base = tsMicro(rt);
      if (base == null) throw bad();
      ts = new Date(Math.max(now(), Math.floor(base / 1000) + 1)).toISOString();   // 読んだ時刻より後の、次のミリ秒の境目以降（アプリの _casTs と同じ）
    }
    const cond = rt == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(String(rt));
    const rows = await rest('app_state?key=eq.' + encodeURIComponent(key) + '&' + cond + '&select=key,updated_at', { method: 'PATCH', headers: pref,
      body: JSON.stringify({ value: b.value, updated_at: ts }) });
    if (!(Array.isArray(rows) && rows.length === 1)) throw err('conflict', 409);
    return { ok: true, updated_at: rows[0].updated_at };
  }

  // ---- 成長カルテの PIN（4 桁）。サーバーで確かめる。値は app_state の karte_pin に、PIN そのものではなく PBKDF2 の印で置く
  //   （前の版の平文の値・行が無いとき（初期値 1234）も確かめられる。合えば印に置き換える）
  const PIN_RE = /^\d{4}$/;
  async function pbkdf2(pin, saltHex, it) {
    const salt = new Uint8Array(saltHex.match(/../g).map(x => parseInt(x, 16)));
    const k = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, 256));
  }
  const same = (x, y) => { if (typeof x !== 'string' || typeof y !== 'string' || x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0; };
  async function pinRow() {
    const rows = await rest('app_state?select=value,updated_at&key=eq.karte_pin');
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  async function pinMatches(row, pin) {
    const v = row ? row.value : null;
    if (v == null || v === '') return same(pin, '1234');                         // 行が無い：今までの初期値
    if (typeof v === 'string' || typeof v === 'number') return same(pin, String(v));   // 前の版の平文
    const o = obj(v);
    if (!o || typeof o.h !== 'string' || typeof o.s !== 'string' || !/^[0-9a-f]{32}$/.test(o.s) || !Number.isInteger(o.it) || o.it < 1000 || o.it > 2000000) return false;
    return same(await pbkdf2(pin, o.s, o.it), o.h);
  }
  async function pinStore(pin, row, by, a) {
    const s = hex(crypto.getRandomValues(new Uint8Array(16))), it = 150000;
    const value = { h: await pbkdf2(pin, s, it), s, it, at: new Date(now()).toISOString(), by: String(by || '').slice(0, 64) };
    if (row) {
      const cond = row.updated_at == null ? 'updated_at=is.null' : 'updated_at=eq.' + encodeURIComponent(String(row.updated_at));
      const base = tsMicro(row.updated_at);
      const ts = new Date(Math.max(now(), base == null ? 0 : Math.floor(base / 1000) + 1)).toISOString();
      const r = await rest('app_state?key=eq.karte_pin&' + cond + '&select=key', { method: 'PATCH', headers: { prefer: 'return=representation', ...fpHdr(a) }, body: JSON.stringify({ value, updated_at: ts }) });
      return Array.isArray(r) && r.length === 1;
    }
    try { await rest('app_state?select=key', { method: 'POST', headers: { prefer: 'return=representation', ...fpHdr(a) }, body: JSON.stringify({ key: 'karte_pin', value, updated_at: new Date(now()).toISOString() }) }); return true; }
    catch (x) { if (x.code === 'conflict') return false; throw x; }
  }
  function pinGuard(a) {
    const k = String(a.emp || a.role), t = now(), list = (fails.get(k) || []).filter(x => t - x < 10 * 60000);
    fails.set(k, list);
    if (list.length >= 5) throw err('locked', 429);
    return () => { list.push(t); fails.set(k, list); };
  }
  async function pinCheck(a, b) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (typeof b.pin !== 'string' || !PIN_RE.test(b.pin)) return { ok: false };
    const miss = pinGuard(a);
    const row = await pinRow();
    if (!(await pinMatches(row, b.pin))) { miss(); return { ok: false }; }
    fails.delete(String(a.emp || a.role));
    if (!row || !obj(row.value)) { try { await pinStore(b.pin, row, a.emp, a); } catch { /* 印に置き換えられなくても、合ったことは返す */ } }
    return { ok: true };
  }
  async function pinSet(a, b) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (typeof b.pin !== 'string' || !PIN_RE.test(b.pin) || typeof b.cur !== 'string' || !PIN_RE.test(b.cur)) throw bad();
    const miss = pinGuard(a);
    const row = await pinRow();
    if (!(await pinMatches(row, b.cur))) { miss(); return { ok: false, why: 'cur' }; }
    fails.delete(String(a.emp || a.role));
    if (!(await pinStore(b.pin, row, a.emp, a))) throw err('conflict', 409);
    return { ok: true };
  }

  // ================================================================ v1142：採用（応募者・不採用ログ）とお悩み相談室（docs/SECURE_HR_V1142_JA.md）
  // 見られる範囲はサーバーが決める（今の画面と同じ。Moto さん 11/04：不採用ログの全部は CEO・GM・経理、AM・店長は担当・自分の店の分だけ。
  // お悩み相談室は今のまま）。社員の表（役割・肩書き・店）と店の表（ブランド）は公開の鍵で書けるので、AM の担当の店は GM・CEO が確かめた写し、
  // G3 以上の店は確かめた写しと今の社員の表の重なり（work-requests の whoami が決めた a.am・a.stores）を使う。
  async function hrScope(a) {
    const sc = { all: false, ap: [], gh: [], mgr: false, name: typeof a.name === 'string' ? a.name.trim() : '', store: '' };
    // 何も見せない・本人の分も無い（名前を残さない）：退職・OS を止めた・社員がいない人。PIN の確かめは 60 秒覚えているので、
    // そのあいだに退職にしても、ここで今の社員の表を見て止める（Codex #136 6736973993 の P2-1：前は名前が残り、本人の相談を読み書きできた）
    const none = { ...sc, name: '' };
    const out = e => { const d = obj(e && e.data) || {}; return String((e && e.status) || '') === '退職' || String(d.status || '') === '退職' || String(d.osDisabled) === 'true'; };
    if (HR_ALL.includes(a.role)) {
      if (a.emp) {   // 社員と結ばれている CEO・GM・経理も、今の社員の表で退職・OS 停止なら止める（メールのログインは emailActor が止める。PIN は 60 秒のあいだ）
        const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,status,data');
        // 社員の行が無くなった（消した）人も止める（Codex #136 6738169923 の P2-1：前は行が無いと「退職でない」になり、PIN を覚えている 60 秒のあいだ全部が見えた）。
        // 社員と結ばれていないメールのログイン（a.emp が空）は今までどおり
        const e0 = Array.isArray(es) ? es[0] : null;
        if (!e0 || out(e0)) return none;
      }
      return { ...sc, all: true, mgr: true, name: sc.name || HR_LABEL[a.role] };   // 社員と結ばれていないメールのログインも（担当の名前）
    }
    if (!a.emp) return none;
    const [es, st] = await Promise.all([
      rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,name,role,title,store,status,data'),
      rest('stores?select=id,name,brand,data&limit=1000'),
    ]);
    const e = Array.isArray(es) ? es[0] : null;
    if (!e) return none;
    const d = obj(e.data) || {};
    if (out(e)) return none;
    const rr = String(e.role || d.role || ''), title = String(e.title || d.title || '');
    const home = String(e.store || d.store || '');
    sc.store = home;
    if (!sc.name && typeof e.name === 'string') sc.name = e.name.trim();
    if (a.role !== 'am' && a.role !== 'staff') return sc;                        // 事務Crew：応募者・不採用ログは見ない（今の画面と同じ）。相談は自分の分だけ
    const S = (Array.isArray(st) ? st : []).filter(s => s && s.id != null);
    const labels = (ids, withName) => {
      const out = [];
      for (const s of S) if (ids.includes(String(s.id))) {
        const sd = obj(s.data) || {};   // 列が空なら中身（data）の値（アプリは同じものを両方に書く）
        const brand = typeof s.brand === 'string' && s.brand.trim() ? s.brand : sd.brand, name = typeof s.name === 'string' && s.name.trim() ? s.name : sd.name;
        if (typeof brand === 'string' && brand.trim()) out.push(brand.trim());
        if (withName && typeof name === 'string' && name.trim()) out.push(name.trim());
      }
      return [...new Set(out)];
    };
    // 自分の店（配属の店）：AM は whoami の店（確かめた写しとの重なり）の中にあるとき。ほかの人は GM・CEO が確かめた写し（G2 以上）の店の中にもあるときだけ
    //（社員の表の役割・店は公開の鍵で書けるので：v1147・Codex #141 6781928056 の P2-1 と同じ。写しの無い人は自分の相談だけ）
    const PS = a.role === 'am' ? a.stores : await protStores(a);
    const own = PS.includes(home) ? [home] : [];
    // G4・店長（Store Manager＝G4）の範囲は、GM・CEO が確かめた写しのある人だけ（社員の表の役割・肩書きは公開の鍵で書けるので、
    // 確かめた写しの無い人のグレードは whoami が 3 までにする。独立レビュー 7e3f878 P2-3）。確かめがまだの AM・G4 は G3 と同じ（配属の店）
    const g4ok = a.confirmed === true && Number(a.grade) >= 4;
    if (a.role === 'am') { sc.ap = [...labels(a.am, false), HR_UNSORTED]; sc.gh = [...a.am]; sc.mgr = true; }
    else if ((rr === 'g4' || rr === 'am') && g4ok) { sc.ap = [...labels(own, false), HR_UNSORTED]; sc.gh = own; sc.mgr = true; }   // アプリ：G4 は AM 扱い（担当＝配属の店）
    else if (rr === 'g4' || rr === 'am' || rr === 'sl' || rr === 'g2') {        // アプリ：G2 は SL 扱い。店長（SL・Store Manager）は相談も
      sc.ap = labels(own, true);
      if (rr === 'sl' && title === 'Store Manager' && g4ok) { sc.gh = own; sc.mgr = true; }
    }
    return sc;
  }
  const hrApIn = (sc, r) => sc.all || sc.ap.includes(String((r && r.store) || '').trim());
  const hrGhMgr = (sc, p) => sc.all || (sc.mgr && sc.gh.includes(String((p && p.store) || '')));
  const hrOwn = (sc, p) => !!sc.name && !!p && typeof p.author === 'string' && p.author.trim() === sc.name;
  function hrProject(key, value, sc, log) {
    const list = Array.isArray(value) ? value.filter(x => obj(x)) : [];
    if (key === 'applicants') {
      return list.filter(r => hrApIn(sc, r)).map(r => {
        const x = { ...r };
        delete x._prior;
        if (AP_ACTIVE.includes(x.status)) { const m = hrMatches(x, log); if (m.length) x._prior = m.slice(-5).map(hrPrior); }
        return x;
      });
    }
    if (key === 'reject_log') return list.filter(r => hrApIn(sc, r));
    return list.filter(p => hrGhMgr(sc, p) || hrOwn(sc, p));                       // growthhub
  }
  const hrLevel = (key, sc) => (sc.all ? 'all' : key === 'growthhub' ? 'scoped' : (sc.ap.length ? 'scoped' : 'none'));
  async function hrRow(key) {
    const rows = await rest('app_state?select=key,value,updated_at&key=eq.' + encodeURIComponent(key));
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  async function hrView(key, sc) {
    const [row, lg] = await Promise.all([hrRow(key), key === 'applicants' ? hrRow('reject_log') : Promise.resolve(null)]);
    const log = lg && Array.isArray(lg.value) ? lg.value.filter(x => obj(x)) : [];
    return { exists: !!row, value: hrProject(key, row ? row.value : null, sc, log), updated_at: row ? row.updated_at : null, level: hrLevel(key, sc) };
  }
  // 読んで・直して・読んだ行が変わっていないときだけ書く（変わっていれば読み直してやり直す。5 回まで）。fn が undefined を返せば書かない
  async function hrRmw(key, fn, a) {
    for (let i = 0; i < 5; i++) {
      const row = await hrRow(key);
      if (row && row.value != null && !Array.isArray(row.value)) throw err('db', 500);   // 配列でない行（形が違う）：空とみなして上書きしない
      const cur = row && Array.isArray(row.value) ? row.value : [];
      const next = fn(cur.slice());
      if (next === undefined) return false;
      if (JSON.stringify(next).length > 8000000) throw bad();
      try { await writeRow(key, next, row ? { exists: true, updated_at: row.updated_at } : { exists: false }, a); return true; }
      catch (x) { if (x.code !== 'conflict') throw x; }
    }
    throw err('conflict', 409);
  }
  async function hrGet(a, b) {
    if (!hrIsKey(b.key)) throw bad();
    return hrView(b.key, await hrScope(a));
  }
  // 応募の入力の「前に不採用」の確かめ：全店の不採用ログから、当たった分だけ（Moto さん 11/04）。応募者を足せる人だけ
  async function hrMatch(a, b) {
    const sc = await hrScope(a);
    if (!sc.all && !sc.ap.length) throw err('forbidden', 403);
    const probe = { name: hrStr(b.name, 120), phone: hrStr(b.phone, 60), email: hrStr(b.email, 200) };
    const lg = await hrRow('reject_log');
    return { matches: hrMatches(probe, lg && Array.isArray(lg.value) ? lg.value.filter(x => obj(x)) : []).slice(-5).map(hrPrior) };
  }
  async function hrOp(a, b) {
    const key = b.key, op = b.op;
    if (!hrIsKey(key) || key === 'reject_log' || typeof op !== 'string') throw bad();
    const sc = await hrScope(a);
    if (key === 'applicants') {
      if (op === 'put') {
        const rec = hrApClean(b.rec);
        if (!rec) throw bad();
        const base = b.create === true ? null : hrApClean(b.base);                 // 直すときは、端末が読んだときの記録が要る
        if (b.create !== true && (!base || base.id !== rec.id)) throw bad();
        // 足す・直すのは、応募者を見られる人（今の画面で一覧が出る人）だけ。応募店舗は今までどおりどの店でも選べる（見られない店にすると一覧から消える）
        if (!sc.all && !sc.ap.length) throw err('forbidden', 403);
        let created = false;
        await hrRmw('applicants', cur => {
          const i = cur.findIndex(r => obj(r) && String(r.id) === rec.id);
          if (i >= 0) {
            if (b.create === true) throw err('conflict', 409);                     // 新しく足すつもりが同じ ID：上書きしない（どの店の人かも言わない）
            if (!hrApIn(sc, cur[i])) throw err('forbidden', 403);                 // 見られない店の応募者は書き換えない
            // 端末が読んだときの記録（base）と比べて、この端末が変えた欄だけを今の記録に重ねる。同じ欄をほかの端末も変えていたら 409
            // （古い写しで、ほかの人が変えた状態・Onboarding の印を戻さない。独立レビュー 7e3f878 P2-2）
            const cur0 = hrApStrip(cur[i]), next = { ...cur0 };
            for (const k of new Set([...Object.keys(base), ...Object.keys(rec)])) {
              if (canon(base[k]) === canon(rec[k])) continue;
              if (canon(cur0[k]) !== canon(base[k]) && canon(cur0[k]) !== canon(rec[k])) throw err('conflict', 409);
              if (rec[k] === undefined) delete next[k]; else next[k] = rec[k];
            }
            const merged = hrApClean(next);
            if (!merged) throw bad();
            if (canon(cur[i]) === canon(merged)) return undefined;
            cur[i] = merged;
          } else {
            if (b.create !== true) throw err('gone', 410);                        // 直そうとした応募者がもう無い（ほかの端末で不採用にした など）
            cur.push(rec); created = true;
          }
          return cur;
        }, a);
        return { ...(await hrView('applicants', sc)), created };
      }
      if (op === 'reject') {
        const id = typeof b.id === 'string' && HR_ID_RE.test(b.id) ? b.id : null;
        if (!id) throw bad();
        const why = { rejectDate: hrStr(b.rejectDate, 40), reason: hrStr(b.reason, 300), memo: hrStr(b.memo, 2000), by: hrStr(b.by, 80) || sc.name };
        // 不採用ログに写す → 応募者の一覧から外す。外すのは、ログに写したときの記録のまま（ほかの端末が直していない）ときだけ。
        // 直されていたら、今の記録をログに写し直してからもう一度（5 回まで）。前は写したあとに直された電話番号などが消えた（Codex #136 6736973993 の P2-2）。
        // ログの記録は同じ応募者に 1 つ（やり直しても 2 つにならない）。理由・日付・メモは最初の不採用のまま、応募者から写した欄だけ今の記録に
        // 読む順：不採用ログ → 応募者。ログは「先に読んだログの行のまま」のときだけ書く（変わっていれば読み直す）。
        // こうすると、ログにもうある記録は、こちらが応募者を読むより前に読んだ応募者から写したもの＝こちらの写しのほうが新しい（か同じ）。
        // 古い不採用の処理が、あとから完了した新しいログを古い電話番号などに戻すことはない（Codex #136 6738169923 の P2-2：
        // 前は応募者を先に読み、そのあいだに直し＋ほかの不採用が完了すると、古い写しでログを上書きして成功にしていた）。
        let done = false;
        for (let t = 0; t < 8 && !done; t++) {
          const lg = await hrRow('reject_log');
          if (lg && lg.value != null && !Array.isArray(lg.value)) throw err('db', 500);   // 配列でない行（形が違う）：上書きしない
          const logs = lg && Array.isArray(lg.value) ? lg.value : [];
          const row = await hrRow('applicants');
          const ap = (row && Array.isArray(row.value) ? row.value : []).find(r => obj(r) && String(r.id) === id) || null;
          if (!ap) {
            // 応募者がもう無い：ほかの端末が不採用を終えた（ログを読んだあとに終わったこともあるので、ログを読み直す）
            const lg2 = await hrRow('reject_log');
            const was = (lg2 && Array.isArray(lg2.value) ? lg2.value : []).find(r => obj(r) && r.aid === id);
            if (!was) throw err('gone', 410);
            if (!hrApIn(sc, was)) throw err('forbidden', 403);
            done = true; break;
          }
          if (!hrApIn(sc, ap)) throw err('forbidden', 403);
          const copy = { aid: id, name: hrStr(ap.name, 200), phone: hrStr(ap.phone, 60), email: hrStr(ap.email, 200), store: hrStr(ap.store, 80), applyDate: hrStr(ap.date, 40), resumeName: hrStr(ap.resumeName, 200) };
          const entry = { ...copy, ...why };
          if (!entry.reason || !entry.rejectDate) throw bad();
          const cur = logs.slice();
          const i = cur.findIndex(r => obj(r) && r.aid === id);
          let next = null;
          if (i < 0) next = cur.concat([entry]);
          else { const e1 = { ...cur[i], ...copy }; if (canon(e1) !== canon(cur[i])) { cur[i] = e1; next = cur; } }
          if (next) {
            if (JSON.stringify(next).length > 8000000) throw bad();
            try { await writeRow('reject_log', next, lg ? { exists: true, updated_at: lg.updated_at } : { exists: false }, a); }
            catch (x) { if (x.code !== 'conflict') throw x; continue; }   // 読んだあとにログが変わった：はじめから読み直す
          }
          let moved = false;
          await hrRmw('applicants', cur => {
            const i = cur.findIndex(r => obj(r) && String(r.id) === id);
            if (i < 0) return undefined;
            if (!hrApIn(sc, cur[i])) throw err('forbidden', 403);
            if (canon(cur[i]) !== canon(ap)) { moved = true; return undefined; }   // ログに写したあとに直された：写し直してから
            cur.splice(i, 1); return cur;
          }, a);
          if (!moved) done = true;
        }
        if (!done) throw err('conflict', 409);
        const [v1, v2] = await Promise.all([hrView('applicants', sc), hrView('reject_log', sc)]);
        return { ...v1, reject_log: v2 };
      }
      throw bad();
    }
    // growthhub
    if (op === 'post') {
      const title = hrStr(b.title, 200), body = hrStr(b.body, 5000);
      if (!title || !body || !sc.name) throw err(sc.name ? 'bad_value' : 'forbidden', sc.name ? 400 : 403);
      const cid = typeof b.cid === 'string' && HR_CID_RE.test(b.cid) ? b.cid : '';   // 同じ送信を 2 回押しても 1 つ（答えが届かなかったとき）
      let id = '';
      await hrRmw('growthhub', cur => {
        const same = cid ? cur.find(p => obj(p) && p.cid === cid && p.author === sc.name) : null;
        if (same) { id = String(same.id); return undefined; }
        let n = now();
        const ids = new Set(cur.map(p => obj(p) && String(p.id)));
        while (ids.has('gh' + n)) n++;
        id = 'gh' + n;
        return cur.concat([{ id, title, body, author: sc.name, store: sc.store, date: hrStr(b.date, 40), status: '未対応', replies: [], ...(cid ? { cid } : {}) }]);
      }, a);
      return { ...(await hrView('growthhub', sc)), id };
    }
    const id = typeof b.id === 'string' && HR_ID_RE.test(b.id) ? b.id : null;
    if (!id) throw bad();
    if (!['reply', 'status', 'assign'].includes(op)) throw bad();
    let mgrOut = false;
    await hrRmw('growthhub', cur => {
      const p = cur.find(x => obj(x) && String(x.id) === id);
      if (!p) throw err('gone', 410);
      const mgr = hrGhMgr(sc, p), mine = hrOwn(sc, p);
      if (op === 'reply') {
        if (!mgr && !mine) throw err('forbidden', 403);
        const text = hrStr(b.text, 5000);
        if (!text) throw bad();
        mgrOut = mgr;
        const cid = typeof b.cid === 'string' && HR_CID_RE.test(b.cid) ? b.cid : '';
        if (cid && Array.isArray(p.replies) && p.replies.some(r => obj(r) && r.cid === cid)) return undefined;   // 同じ返信をもう一度（答えが届かなかった）
        p.replies = (Array.isArray(p.replies) ? p.replies : []).concat([{ author: mgr ? (hrStr(b.author, 60) || sc.name || '管理者') : sc.name, byMgr: mgr, text, date: hrStr(b.date, 40), ...(cid ? { cid } : {}) }]);
        if (mgr && (p.status || '未対応') === '未対応') p.status = '対応中';
        return cur;
      }
      if (!mgr) throw err('forbidden', 403);
      if (op === 'status') {
        if (!['未対応', '対応中', '解決'].includes(b.status)) throw bad();
        if (p.status === b.status) return undefined;
        p.status = b.status; return cur;
      }
      if (b.off === true) { if (!p.assignee) return undefined; p.assignee = ''; return cur; }
      if (!sc.name) throw err('forbidden', 403);
      p.assignee = sc.name; p.assignedAt = hrStr(b.at, 40);
      if ((p.status || '未対応') === '未対応') p.status = '対応中';
      return cur;
    }, a);
    return { ...(await hrView('growthhub', sc)), mgr: mgrOut };
  }

  // ---- v1144：従業員の個人の欄（生年月日・カードの下 4 桁・保険の加入・保険料）
  // 見られる範囲。lv：full（5 つ）／hr（保険料を除く 4 つ）／flag（生年月日があるかだけ）／none。ok(e)：その社員の行が範囲か。
  // newOk：社員の表にまだ無い人（今登録した人）にも書ける（CEO・GM・経理）。amt：保険料を見る・直す（GM・CEO）
  async function piiScope(a) {
    const none = { lv: 'none', ok: () => false, newOk: false, amt: false };
    let me = null;
    if (a.emp) {   // 社員と結ばれた人：行が無い・退職・OS を止めた人は何も（PIN の確かめは 60 秒覚えているので、今の社員の表で見る。hrScope と同じ）
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,role,title,store,status,data');
      me = Array.isArray(es) ? es[0] || null : null;
      if (!me || empOut(me)) return none;
    }
    // all：全員が範囲（見られる人の一覧 ids を返さない）
    if (a.role === 'ceo' || a.role === 'gm') return { lv: 'full', ok: () => true, all: true, newOk: true, amt: true };
    if (a.role === 'office') return { lv: 'hr', ok: () => true, all: true, newOk: true, amt: false };
    if (a.role === 'office_crew') return { lv: 'flag', ok: () => true, all: true, newOk: false, amt: false };
    if (!me) return none;
    if (a.role === 'am') {   // 担当の店（応援も）と全店（ALL）の人（v1197 と同じ）
      // v1207 の一覧（アプリの従業員マスター）には本部（OFFICE）の人も全部の AM に出すが、個人の欄はこの範囲のまま（Moto さん 11/23「C」：
      // 本部の人の生年月日・カード・保険は、応援が担当の店でなければ AM に出さない・直させない）。アプリは pii_get の ids でその人の欄を止める
      const S = [...new Set([...a.am, ...a.stores])];
      const ok = e => {
        const d = obj(e && e.data) || {};
        const st = String((d.store != null && d.store !== '') ? d.store : ((e && e.store) || ''));
        const sup = Array.isArray(d.support) ? d.support : (Array.isArray(e && e.support) ? e.support : []);
        return st === 'ALL' || S.includes(st) || sup.some(x => S.includes(String(x)));
      };
      return { lv: 'hr', ok, all: false, newOk: false, amt: false };
    }
    // Head Chef（Corporate Chef も）：全員（v950 から従業員マスターで全店の人を見る）。今の社員の表と、GM・CEO が確かめた写し（wr_people.chef）の
    // 両方で Head Chef のときだけ（Codex #138 P1-1：確かめた店長が自分の肩書きを Head Chef に書き換えるだけでは広げない）
    if (a.role === 'staff' && a.grade >= 4 && liveChef(me) && await confChef(a)) return { lv: 'hr', ok: () => true, all: true, newOk: false, amt: false };
    return none;
  }
  async function piiLoad() {
    const [row, emps] = await Promise.all([hrRow(PII_KEY), rest('employees?select=id,name,role,title,store,support,status,data&limit=5000')]);
    if (row && row.value != null && !obj(row.value)) throw err('db', 500);   // オブジェクトでない行（形が違う）：読まない・上書きしない
    return { row, map: row ? obj(row.value) || {} : {}, emps: (Array.isArray(emps) ? emps : []).filter(e => e && e.id != null) };
  }
  // その人の欄：emp_pii にあればそれ（書いたときに全部の欄を持たせる）。無ければ従業員の表の値（SQL 20261113090000 の前）
  function piiOf(map, id, e) {
    const en = obj(map[id]);
    const src = en || obj(e && e.data) || {};
    const o = {};
    for (const k of PII_FIELDS) if (Object.prototype.hasOwnProperty.call(src, k)) o[k] = piiOut(src[k]);
    return o;
  }
  function piiProject(f, lv) {
    if (lv === 'flag') return piiCmp('dob', f.dob) !== '' ? { _dobSet: true } : null;
    const ks = lv === 'full' ? PII_FIELDS : PII_HR;
    const o = {};
    let n = 0;
    for (const k of ks) if (Object.prototype.hasOwnProperty.call(f, k)) { o[k] = f[k]; n++; }
    return n ? o : null;
  }
  async function piiGet(a) {
    const sc = await piiScope(a);
    if (sc.lv === 'none') return { level: 'none', data: {}, updated_at: null };
    const { row, map, emps } = await piiLoad();
    const data = {}, seen = new Set(), ids = [];
    for (const e of emps) {
      const id = String(e.id);
      seen.add(id);
      if (!sc.ok(e)) continue;
      ids.push(id);
      const p = piiProject(piiOf(map, id, e), sc.lv);
      if (p) data[id] = p;
    }
    // 社員の表にまだ無い人（登録した端末がまだ送れていない）：書ける人（CEO・GM・経理）にだけ
    if (sc.newOk) for (const id of Object.keys(map)) if (!seen.has(id) && PII_ID_RE.test(id) && obj(map[id])) { const p = piiProject(piiOf(map, id, null), sc.lv); if (p) data[id] = p; }
    const out = { level: sc.lv, data, updated_at: row ? row.updated_at : null };
    // v1207：全員ではない人（AM）には、見られる人の社員 ID も返す。アプリはここに無い人（本部の人など）の個人の欄を止める（空の欄を直せると見せない）
    if (!sc.all) out.ids = ids;
    return out;
  }
  // 1 人の欄を直す。base＝画面を開いたときの値。サーバーの今の値が base と違い、送った値とも違う欄があれば 409（ほかの端末が同じ欄を直した）。
  // 読んだ行が変わっていないときだけ書く（5 回まで）。書くとき、その人の欄を全部 emp_pii に持たせる（従業員の表の値も写す）
  async function piiOp(a, b) {
    const id = b.id;
    if (typeof id !== 'string' || !PII_ID_RE.test(id)) throw bad();
    const set = obj(b.set), base = obj(b.base) || {};
    if (!set) throw bad();
    const ks = Object.keys(set);
    if (!ks.length || ks.some(k => !PII_FIELDS.includes(k))) throw bad();
    const val = {};
    for (const k of ks) { const v = piiValid(k, set[k]); if (v === undefined) throw bad(); val[k] = v; }
    const sc = await piiScope(a);
    if (sc.lv !== 'full' && sc.lv !== 'hr') throw err('forbidden', 403);
    if (ks.includes('insuranceAmt') && !sc.amt) throw err('forbidden', 403);
    const who = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 120) : (HR_LABEL[a.role] || a.role);
    for (let t = 0; t < 5; t++) {
      const { row, map, emps } = await piiLoad();
      const e = emps.find(x => String(x.id) === id) || null;
      if (e) { if (!sc.ok(e)) throw err('forbidden', 403); }
      else if (!sc.newOk) throw err('not_found', 404);   // 社員の表にまだ無い人：社員の行が届いてから（アプリはもう一度送る）
      const cur = piiOf(map, id, e);
      let changed = false;
      for (const k of ks) {
        const c = canon(piiCmp(k, cur[k]));
        if (c === canon(piiCmp(k, val[k]))) continue;
        if (c !== canon(piiCmp(k, base[k]))) throw err('conflict', 409);
        changed = true;
      }
      if (!changed) return { same: true, entry: piiProject(cur, sc.lv) || {}, level: sc.lv, by: a.role };
      const next = { ...cur, ...val, _at: new Date(now()).toISOString(), _by: who };
      const value = { ...map, [id]: next };
      if (JSON.stringify(value).length > 2000000) throw bad();
      try { await writeRow(PII_KEY, value, row ? { exists: true, updated_at: row.updated_at } : { exists: false }, a); }
      catch (x) { if (x.code !== 'conflict') throw x; continue; }   // 読んだあとに行が変わった：読み直して比べ直す
      return { same: false, entry: piiProject(next, sc.lv) || {}, level: sc.lv, by: a.role };
    }
    throw err('conflict', 409);
  }
  // カードの下 4 桁の照合：レシート管理を使える人（CEO・GM・経理・事務Crew・AM・G3 以上）。在籍の G2 以上の人（アプリの empsByCardLast4 と同じ）の ID と名前だけ。
  // 全部の 4 桁を当てて調べられないように、10 分で 200 件まで（関数の 1 つの実行環境の中で数える）
  const cardHits = new Map();
  async function cardMatch(a, b) {
    if (!(['ceo', 'gm', 'office', 'office_crew', 'am'].includes(a.role) || (a.role === 'staff' && a.grade >= 3))) throw err('forbidden', 403);
    const list = Array.isArray(b.last4s) ? b.last4s : [b.last4];
    if (!list.length || list.length > 20 || list.some(x => typeof x !== 'string' || !/^\d{4}$/.test(x))) throw bad();
    if (a.emp) {
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,status,data');
      const me = Array.isArray(es) ? es[0] || null : null;
      if (!me || empOut(me)) throw err('forbidden', 403);
    }
    const hk = a.emp ? 'e:' + a.emp : 'r:' + a.role + ':' + a.via;
    const t0 = now(), hits = (cardHits.get(hk) || []).filter(x => t0 - x < 600000);
    if (hits.length + list.length > 200) throw err('locked', 429);
    for (let i = 0; i < list.length; i++) hits.push(t0);
    cardHits.set(hk, hits);
    if (cardHits.size > 500) for (const [k, v] of cardHits) if (!v.some(x => t0 - x < 600000)) cardHits.delete(k);
    const { map, emps } = await piiLoad();
    const out = {};
    for (const l4 of list) out[l4] = [];
    for (const e of emps) {
      const d = obj(e.data) || {}, id = String(e.id);
      const st = String(d.status != null ? d.status : (e.status || ''));
      if (st && st !== '在籍') continue;
      const g = Number(String(appGrade(String(d.title || e.title || ''), String(d.role || e.role || ''))).replace('G', '')) || 0;
      if (g < 2) continue;
      const cards = String(piiOf(map, id, e).cardLast4 || '').split(',').map(x => x.trim());
      for (const l4 of Object.keys(out)) if (cards.includes(l4)) out[l4].push({ id, name: String(d.name || e.name || '').slice(0, 120) });
    }
    return { matches: out };
  }
  // 店ごとの保険料の合計（月額）：アプリの storeInsuranceMonthly と同じ（配属の店・退職でない人）。だれにでも（ログイン不要）
  async function insTotals() {
    const { map, emps } = await piiLoad();
    const totals = {};
    for (const e of emps) {
      const d = obj(e.data) || {}, id = String(e.id);
      const st = String(d.store != null ? d.store : (e.store || ''));
      const status = String(d.status != null ? d.status : (e.status || ''));
      if (!st || status === '退職') continue;
      const f = piiOf(map, id, e);
      const amt = f.insuranceAmt != null ? (Number(f.insuranceAmt) || 0) : 0;
      if (!amt) continue;
      totals[st] = (totals[st] || 0) + amt;
    }
    return { totals };
  }

  // ================================================================ v1152：通知
  // 宛先を決める人の形（画面の curRole・curStore・応援・担当の店に当たるもの）。60 秒覚える（通知は 1 分ごとに読むので）
  const ntCtxCache = new Map();
  // 名前を持つ人（社員の表の名前・GM・CEO が確かめた写しの名前。退職の人も）。60 秒覚える（1 分ごとの読みで毎回読まない）。
  // 個人あての通知（toUser）と出した人（by）は名前で持っているので、その名前を持つのが本人だけのときだけ返す（v1140 の Career Score と同じ考え。
  // Codex #146 6845284151：前は名前だけで決め、同じ名前の別の人（別の店）にも同じ個人あての通知を返した）
  let ntNames = null;
  async function ntNameHolders() {
    if (ntNames && ntNames.exp > now()) return ntNames.m;
    // どちらかが読めない：名前を持つ人が分からないので、nt 全体を失敗にする（Codex #146 a78b401 P2：前は確かめた写しが読めないと社員の表の名前だけで決め、
    // 写しにだけある同じ名前の人がいても個人あての通知を返し、印も付けられた）。端末は前の写しのまま
    const [emps, wrp] = await Promise.all([rest('employees?select=id,name&limit=5000'), rest('wr_people?select=emp_id,name&limit=2000')]);
    const m = new Map();
    const hold = (n, id) => { const k = typeof n === 'string' ? n.trim() : ''; if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
    for (const e of (Array.isArray(emps) ? emps : [])) if (e && e.id != null) hold(e.name, String(e.id));
    for (const w of (Array.isArray(wrp) ? wrp : [])) if (w && w.emp_id != null) hold(w.name, String(w.emp_id));
    ntNames = { m, exp: now() + 60000 };
    return m;
  }
  async function ntCtx(a) {
    const c0 = await ntCtx0(a);
    const name = (c0.name || '').trim();
    if (!name) return { ...c0, nameOk: false };
    const hs = (await ntNameHolders()).get(name);   // 社員の表・確かめた写しが読めない：nt 全体を失敗にする（アプリは端末の写しのまま。名前あての通知を黙って消さない）
    const emp = typeof a.emp === 'string' ? a.emp : '';
    return { ...c0, nameOk: emp ? (!hs || [...hs].every(x => x === emp)) : !hs };   // 社員と結ばれていない人（GM・CEO）：その名前の社員がいないときだけ
  }
  async function ntCtx0(a) {
    const name = typeof a.name === 'string' ? a.name : '';
    if (NT_ALL_ROLES.includes(a.role)) return { name, role: a.role, all: true, stores: new Set(), sm: false };
    if (a.role === 'am') return { name, role: 'am', all: false, stores: new Set([...arr(a.stores), ...arr(a.am)]), sm: false };   // 確かめた AM（whoami）：担当の店と自分の店
    if (a.role !== 'staff' || typeof a.emp !== 'string' || !a.emp) return { name, role: '', all: false, stores: new Set(), sm: false };
    const ck = a.emp + '|' + name + '|' + arr(a.stores).join(',') + '|' + (a.confirmed === true ? 1 : 0) + '|' + a.grade;
    const hit = ntCtxCache.get(ck);
    if (hit && hit.exp > now()) return hit.c;
    let e = null, w = null;
    try { const r = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=role,title,data'); e = Array.isArray(r) && r.length === 1 ? r[0] : null; } catch { e = null; }
    if (a.confirmed === true) {
      try { const r = await rest('wr_people?emp_id=eq.' + encodeURIComponent(a.emp) + '&select=grade,stores,chef'); w = Array.isArray(r) && r.length === 1 && obj(r[0]) ? r[0] : null; } catch { w = null; }   // 列が無い（SQL の前）・読めない：確かめた写しが無いのと同じ（狭いほう）
    }
    const d = obj(e && e.data) || {};
    const tr = String((e && e.role) || d.role || ''), title = String((e && e.title) || d.title || '').trim();
    const cg = w && Number.isInteger(w.grade) ? w.grade : 0;
    let role = 'crew', stores = arr(a.stores);   // 確かめがまだの人・G1：crew あての通知だけ（自分の店。whoami の店＝今の社員の表）
    const need = NT_STAFF_NEED[tr];
    if (need && cg >= need && Number(a.grade) >= need && (tr !== 'chef' || w.chef === true)) {
      role = NT_ROLE_ALIAS[tr] || tr;
      const ws = arr(w.stores);
      stores = arr(a.stores).filter(s => ws.includes(s));   // 役割の通知の店：確かめた写しと今の社員の表の重なり（v1147 の protStores と同じ）
    }
    const c = { name, role, all: false, stores: new Set(stores), sm: role === 'sl' && title === 'Store Manager' };
    if (ntCtxCache.size > 500) ntCtxCache.clear();
    ntCtxCache.set(ck, { c, exp: now() + 60000 });
    return c;
  }
  // ログインを確かめられない端末から足す数（この関数の 1 つの実行環境の中で 10 分に 300 件まで。たくさん足して本物の通知を押し出さないように）
  let ntAnonHits = [];
  // nt：{ add:[通知…], read:[id…], ack:[id…] }。a が null＝ログインを確かめられない端末（足すだけ）
  async function ntOp(a, b) {
    const L = (v, max) => { if (v === undefined || v === null) return []; if (!Array.isArray(v) || v.length > max) throw bad(); return v; };
    const add = L(b.add, NT_ADD_MAX), read = L(b.read, NT_MARK_MAX), ack = L(b.ack, NT_MARK_MAX);
    if ([...read, ...ack].some(x => typeof x !== 'string' || !NT_ID_RE.test(x))) throw bad();
    const t0 = now();
    if (!a) {
      ntAnonHits = ntAnonHits.filter(x => t0 - x < 600000);
      if (ntAnonHits.length + add.length > 300) throw err('locked', 429);
      for (let i = 0; i < add.length; i++) ntAnonHits.push(t0);
    }
    const items = add.map(x => ntClean(x, t0));
    const ids = add.map(x => (x && (typeof x.id === 'string' || typeof x.id === 'number')) ? String(x.id) : '').filter(x => x && x.length <= 100);
    const c = a ? await ntCtx(a) : null;
    const me = c ? c.name : '';
    for (let tries = 0; tries < 5; tries++) {
      const rows = await rest('app_state?key=eq.' + NT_KEY + '&select=key,value,updated_at');
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      let list = row ? asVal(row.value) : [];
      if (!Array.isArray(list)) list = [];
      list = list.filter(n => n && typeof n === 'object' && !Array.isArray(n));
      const byId = new Map();
      for (const n of list) if (n.id != null) byId.set(String(n.id), n);
      let changed = false, bad0 = 0;
      for (const it0 of items) {
        if (!it0) { bad0++; continue; }
        if (byId.has(it0.id)) continue;   // もうある（送り直し・ほかの端末が出した）
        if (it0.by === NT_SYS && it0.refId && list.some(n => n.refId === it0.refId)) continue;   // 自動の知らせ：同じ refId はもう出した（端末は見えない分を確かめられない）
        const it = { ...it0 };
        if (a && me && it.by !== NT_SYS) it.by = me;   // 出した人は関数が確かめた人（自動の知らせはシステムのまま）
        if (!a) it._u = 1;                              // 出した人を確かめていない
        list.push(it); byId.set(it.id, it); changed = true;
      }
      if (me) {
        const mark = (id, f) => {
          const n = byId.get(id); if (!n || !ntVisible(n, c)) return;   // 見られない通知には印を付けない
          for (const k of f) { const v = Array.isArray(n[k]) ? n[k] : []; if (!v.includes(me)) { n[k] = [...v, me]; changed = true; } }
        };
        for (const id of new Set(read)) mark(id, ['readBy']);
        for (const id of new Set(ack)) mark(id, ['ackBy', 'readBy']);
      }
      if (changed) {
        list.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
        if (list.length > NT_MAX) list = list.slice(list.length - NT_MAX);
        try { await writeRow(NT_KEY, list, row ? { exists: true, updated_at: row.updated_at } : { exists: false }, a); }   // a が null：だれか分からない書き込み（変更の記録は「サーバー」）
        catch (x) { if (x.code === 'conflict') continue; throw x; }   // 読んだあとに行が変わった：読み直して重ね直す
      }
      const out = { done: ids, bad: bad0, level: c ? 'fn' : 'add' };
      if (c) out.items = list.filter(n => ntVisible(n, c));
      return out;
    }
    throw err('conflict', 409);
  }

  // ---- v1192：人件費の合計（店・月ごと）。見られるのは CEO・GM・経理（全店）と AM（担当の店と応援の店・ダッシュボードで全店を見る人は全店）。
  //   頼めない店は no に入れて返す（端末は今までどおり自分で数える）。社員と結ばれた人は今の社員の表で退職・OS 停止なら何も出さない
  async function ltGet(a, b) {
    const asks = ltAsks(b.asks);
    if (!asks) throw bad();
    const empOk = async () => {
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,role,status,data');
      const e0 = Array.isArray(es) ? es[0] : null;
      return !!(e0 && !empOut(e0));
    };
    let all = false; const S = new Set();
    if (['ceo', 'gm', 'office'].includes(a.role)) {
      if (a.emp && !(await empOk())) throw err('forbidden', 403);
      all = true;
    } else if (a.role === 'am' && a.emp) {
      if (!(await empOk())) throw err('forbidden', 403);
      for (const x of [...a.am, ...a.stores]) if (typeof x === 'string' && x) S.add(x);
      // 全店で返すのは、GM・CEO だけが書ける写し（app_state の md_all_viewers_gm・上の LV_KEYS）で ON の人だけ。
      // app_settings の md_all_viewers（ダッシュボードの表示に使う・公開の鍵で書ける）は見ない（Codex 6986713362 の P2-1：AM の自分での書き足し）
      // 写しを信じるのは、SQL が公開の鍵の書き込みを止めているときだけ（rpc/md_all_viewers_gm_trusted が true。Codex 6989812896 の P2-1・P2-3）。
      // 関数が無い（SQL の前・戻す SQL のあと＝404）・false・読めないときは写しを見ずに担当の店だけ
      const [trusted, rows] = await Promise.all([
        rest('rpc/md_all_viewers_gm_trusted', { method: 'POST', body: '{}' }).then(x => x === true, () => false),
        rest('app_state?select=value&key=eq.' + LV_KEYS[0]),
      ]);
      const v = trusted && Array.isArray(rows) && rows[0] && obj(rows[0].value) ? rows[0].value[a.emp] : null;
      if (obj(v) && v.on === true && !v._deleted) all = true;
    } else throw err('forbidden', 403);
    const ok = asks.filter(x => all || S.has(x.s)), no = asks.filter(x => !(all || S.has(x.s))).map(x => x.s + '|' + x.m);
    const today = ltToday(b.to, now());
    if (!ok.length) return { r: {}, no, today, max: LT_MAX_ASKS };
    const data = await ltLoad(rest, ok, today);
    return { r: ltCompute(data, ok), no, today, max: LT_MAX_ASKS };
  }

  // ---- v1193：画面の表示（UI案95）。pv_get＝ログインした人の分だけ・pv_full／pv_save／pv_log＝GM・CEO だけ
  async function pvRead() {
    let rows;
    try { rows = await rest('pv_doc?id=eq.1&select=doc,ver,updated_at,by_name,by_role'); }
    catch (e) { if (e && e.status === 404) return { nosql: true }; throw e; }   // 表が無い（SQL の前）
    const r = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!r) return { row: null };
    return { row: r, doc: pvCheck(r.doc) };
  }
  async function pvGet(a) {
    const x = await pvRead();
    if (x.nosql) return { pv: null, nosql: true };
    if (!x.row) return { pv: null };
    if (!x.doc) return { pv: null, broken: true };      // 形の合わない中身（SQL で手で直した など）：画面は今までの決まりで出す
    if (x.doc.off) return { pv: null, off: true, ver: x.row.ver };
    return { pv: { ver: x.row.ver, at: x.row.updated_at, ...pvProject(x.doc, a.emp || '') } };
  }
  // v1197（UI案96 の 6B）：店のタブレットの列だけ（ログインを確かめない・ins_totals と同じ）。店舗の PIN のタブレットはこの関数を自分で呼べない（ログインの印が無い）。
  // どの画面をどの列に出すかは秘密ではない（pv_get もログインした人に列を全部返す）。人の例外・指定スタッフ限定・記録・だれが保存したかは返さない
  async function pvTab() {
    const x = await pvRead();
    if (x.nosql) return { pv: null, nosql: true };
    if (!x.row) return { pv: null };
    if (!x.doc) return { pv: null, broken: true };
    if (x.doc.off) return { pv: null, off: true, ver: x.row.ver };
    return { pv: { ver: x.row.ver, at: x.row.updated_at, col: x.doc.cols.tab || {} } };
  }
  async function pvMgr(a) {
    if (levelOf(a) !== 'full') throw err('forbidden', 403);
    if (a.emp) {
      const es = await rest('employees?id=eq.' + encodeURIComponent(a.emp) + '&select=id,status,data');
      const e0 = Array.isArray(es) ? es[0] : null;
      if (!e0 || empOut(e0)) throw err('forbidden', 403);
    }
  }
  async function pvFull(a) {
    await pvMgr(a);
    const x = await pvRead();
    if (x.nosql) return { pv: null, nosql: true };
    // tabok:1＝店のタブレットの列（v1197）を受け取れる関数（アプリは無い答えのとき、その列を出さない・保存に入れない）
    if (!x.row) return { pv: null, ver: 0, tabok: 1 };
    return { pv: x.doc ? { ver: x.row.ver, at: x.row.updated_at, by_name: x.row.by_name || '', by_role: x.row.by_role || '', doc: x.doc } : null,
      ver: x.row.ver, broken: !x.doc, tabok: 1 };
  }
  async function pvSave(a, b) {
    await pvMgr(a);
    const doc = pvCheck(b.doc);
    if (!doc) throw bad();
    if (!Number.isSafeInteger(b.expect) || b.expect < 0) throw bad();
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason || reason.length > 500) throw bad();
    const sm = b.summary === undefined ? [] : b.summary;
    if (!Array.isArray(sm) || sm.length > 300 || sm.some(t => typeof t !== 'string' || !t || t.length > 200)) throw bad();
    let r;
    try {
      r = await rest('rpc/pv_save', { method: 'POST', headers: fpHdr(a), body: JSON.stringify({ p_doc: doc, p_expect: b.expect, p_reason: reason, p_summary: sm,
        p_by_emp: a.emp || null, p_by_name: a.name || null, p_by_role: a.role || null }) });
    } catch (e) { if (e && e.status === 404) throw err('not_installed', 503); throw e; }
    if (!obj(r)) throw err('db', 500);
    if (r.conflict === true) throw err('conflict', 409);
    if (r.ok !== true || !Number.isSafeInteger(r.ver)) throw err('db', 500);
    return { ok: true, ver: r.ver, at: r.at || null, same: r.same === true };
  }
  async function pvLog(a, b) {
    await pvMgr(a);
    const C = 'id,at,ver,by_name,by_role,via,reason,summary';
    try {
      if (b.id !== undefined && b.id !== null) {
        if (!Number.isSafeInteger(b.id) || b.id < 1) throw bad();
        const rows = await rest('pv_log?id=eq.' + b.id + '&select=' + C + ',before,after');
        return { row: Array.isArray(rows) && rows[0] ? rows[0] : null };
      }
      let q = 'pv_log?select=' + C + '&order=id.desc&limit=20';
      if (b.before !== undefined && b.before !== null) { if (!Number.isSafeInteger(b.before) || b.before < 1) throw bad(); q += '&id=lt.' + b.before; }
      const rows = await rest(q);
      const list = Array.isArray(rows) ? rows : [];
      return { rows: list, more: list.length === 20 };
    } catch (e) { if (e && e.status === 404) return { rows: [], nosql: true }; throw e; }
  }

  // ---- v1195（UI案96 の段階 2 の ①）：所属の確認。aff_get＝ログインした人の行だけ・aff_full／aff_save＝GM・CEO だけ。
  // 表 aff_people（人ごとの所属の写し）と aff_log（記録）。従業員マスターの所属はアプリが今までの道で書く（ここでは書かない）。
  // 見え方が変わるのは、マスターと写しが同じときだけ（次の版 v1196 から。違えば狭いほう）。docs/UNIFIED_UI_V1191_JA.md の 18
  const AFF_ID = /^[A-Za-z0-9][A-Za-z0-9_+-]{0,31}$/;
  const affStoreOk = v => typeof v === 'string' && AFF_ID.test(v) && v.toUpperCase() !== 'ALL' && v.toUpperCase() !== 'OFFICE';
  async function affGet(a) {
    if (!a.emp) return { row: null };
    let rows;
    try { rows = await rest('aff_people?emp_id=eq.' + encodeURIComponent(a.emp) + '&select=aff,store,support,ver,updated_at'); }
    catch (e) { if (e && e.status === 404) return { row: null, nosql: true }; throw e; }
    const r = Array.isArray(rows) && rows[0] ? rows[0] : null;
    return { row: r ? { aff: r.aff, store: r.store || '', support: Array.isArray(r.support) ? r.support : [], ver: r.ver, at: r.updated_at } : null };
  }
  async function affFull(a) {
    await pvMgr(a);
    let rows, log;
    try {
      rows = await rest('aff_people?select=emp_id,aff,store,support,ver,updated_at,by_name,by_role&order=emp_id.asc&limit=5000');
      log = await rest('aff_log?select=id,at,emp_id,emp_name,ver,by_name,by_role,reason,before,after&order=id.desc&limit=100');
    } catch (e) { if (e && e.status === 404) return { rows: [], log: [], nosql: true }; throw e; }
    return { rows: Array.isArray(rows) ? rows : [], log: Array.isArray(log) ? log : [] };
  }
  async function affSave(a, b) {
    await pvMgr(a);
    const its = b.items;
    if (!Array.isArray(its) || its.length < 1 || its.length > 200) throw bad();
    const reason = b.reason === undefined || b.reason === null ? '' : (typeof b.reason === 'string' ? b.reason.trim() : null);
    if (reason === null || reason.length > 500) throw bad();
    const seen = new Set(), out = [];
    for (const x of its) {
      if (!obj(x)) throw bad();
      const emp = x.emp;
      if (typeof emp !== 'string' || !emp || emp.length > 64 || emp.charAt(0) === '_' || seen.has(emp)) throw bad();
      seen.add(emp);
      if (x.aff !== 'hq' && x.aff !== 'store') throw bad();
      const store = x.aff === 'hq' ? (x.store === undefined || x.store === null ? '' : x.store) : x.store;
      if (x.aff === 'hq' ? store !== '' : !affStoreOk(store)) throw bad();
      const sup = x.support === undefined || x.support === null ? [] : x.support;
      if (!Array.isArray(sup) || sup.length > 20 || sup.some(s => !affStoreOk(s) || s === store) || new Set(sup).size !== sup.length) throw bad();
      /* 版は SQL で integer（(it->>'expect')::integer）。範囲の外は 500 ではなく 400 で断る（Claude のルーティン 7002642425 の P3-2） */
      if (!Number.isSafeInteger(x.expect) || x.expect < 0 || x.expect > 2147483647) throw bad();
      out.push({ emp, aff: x.aff, store, support: sup, expect: x.expect });
    }
    // 人は在籍していること・店は店舗マスターにあること（端末の名簿が古くても、サーバーで確かめる）
    const es = await rest('employees?id=' + encodeURIComponent(IN([...seen])) + '&select=id,name,status,data');
    const em = new Map((Array.isArray(es) ? es : []).map(e => [String(e.id), e]));
    for (const x of out) { const e0 = em.get(x.emp); if (!e0 || empOut(e0)) throw err('not_found', 404); x.name = String((obj(e0.data) || {}).name || e0.name || '').slice(0, 120); }
    const st = await rest('stores?select=id');
    const S = new Set((Array.isArray(st) ? st : []).map(r => String(r.id)));
    for (const x of out) { if ((x.store && !S.has(x.store)) || x.support.some(s => !S.has(s))) throw bad(); }
    let r;
    try {
      r = await rest('rpc/aff_save', { method: 'POST', headers: fpHdr(a), body: JSON.stringify({ p_items: out, p_reason: reason,
        p_by_emp: a.emp || null, p_by_name: a.name || null, p_by_role: a.role || null }) });
    } catch (e) { if (e && e.status === 404) throw err('not_installed', 503); throw e; }
    if (!obj(r)) throw err('db', 500);
    if (r.conflict === true) { const e = err('conflict', 409); e.ids = Array.isArray(r.ids) ? r.ids : []; throw e; }
    if (r.ok !== true || !Array.isArray(r.rows)) throw err('db', 500);
    return { ok: true, rows: r.rows, same: Number(r.same) || 0, at: r.at || null };
  }

  // ---- Career Score 2026 Q4（新制度・段階 3-1）：評価表・評価・本人への共有・見直しの申し出・今までの記録（docs/CAREER_SCORE_Q4_JA.md の 7）。
  //   表と関数は SQL 20261214090000（csq4_*）。SQL がまだ（404）なら読むものは nosql、書くものは not_installed。
  //   だれができるか（Claude が決めた・Moto さんに確かめる。答え 7 A＝店で採点 → GM が確定 → 本人に公開・GM の評価は CEO が確定）：
  //   ・採点（始める・下書き・本人に共有・確認待ちへ）：CEO・GM＝だれでも／確かめた AM＝担当の店の人（AM・本部の人は除く）／
  //     確かめた Head Chef＝下のグレードの調理の人（調理の評価表・Prep・G の Kitchen中心）／ほかの G4 以上（確かめた写しの店）＝自分の店の下のグレードの人／
  //     確かめた G3（確かめた写しの店）＝自分の店の G2 の人の G の評価表だけ（Moto さん 11/23「G3はG2を採点できる様(申請できる様に)」・「G の評価表だけ」。確定は CEO・GM）／
  //     経理（office）＝事務Crew（Moto さん 11/23「経理は事務crewを採点できる様に」）。自分は採点しない（本人は見直しの申し出とコメントだけ）。退職の人は採点しない
  //   ・確定・差戻し・取りやめ：CEO・GM＝だれでも（自分を除く）
  //   GM は CEO と同じにすべて（閲覧・採点・変更・確定・取り消し。ほかの GM・CEO の人も。Moto さん 11/23「GMは全ての閲覧、評価、変更、承認の権限を持たせてください」）。
  //   自分の評価だけは採点・確定しない（Claude が決めた・Moto さんに伝える）
  //   ・評価表を決める・今までの記録を写す：GM・CEO
  const CS4_EV_COLS = 'id,emp_id,emp_name,period,system,grade,type,version,rev,status,entries,prep,feedback,result,shared,shared_at,shared_by_name,prev_id,change_reason,note,ver,'
    + 'created_at,created_by_name,updated_at,updated_by_name,submitted_at,submitted_by_name,returned_at,returned_by_name,confirmed_at,confirmed_by_name,confirmed_by_role,closed_at,closed_by_name,superseded_by';
  const CS4_HIST_COLS = 'id,kind,emp_id,emp_name,period,period_state,data,src_updated_at,copied_at';
  const cs4Iso = () => new Date(now()).toISOString();
  const cs4Int = (v, min = 0) => Number.isSafeInteger(v) && v >= min && v <= 2147483647;
  const cs4Id = v => typeof v === 'string' && v.length >= 1 && v.length <= 64 && v.charAt(0) !== '_';
  const cs4By = a => ({ p_by_emp: a.emp || null, p_by_name: a.name || null, p_by_role: a.role || null });
  async function cs4Read(path) {
    try { return await rest(path); } catch (e) { if (e && e.status === 404) return null; throw e; }
  }
  async function cs4Rpc(a, fn, args) {
    let r;
    try { r = await rest('rpc/' + fn, { method: 'POST', headers: fpHdr(a), body: JSON.stringify(args) }); }
    catch (e) { if (e && e.status === 404) throw err('not_installed', 503); if (e && e.status === 400) throw bad(); throw e; }
    if (!obj(r)) throw err('db', 500);
    return r;
  }
  // SQL の答えの断り → 答えのコード
  function cs4Fail(r) {
    if (r.conflict === true) { const e = err('conflict', 409); if (Array.isArray(r.ids)) e.ids = r.ids; return e; }
    if (r.open === true) { const e = err('open', 409); e.ids = Array.isArray(r.ids) ? r.ids : []; return e; }
    const c = String(r.error || '');
    if (c === 'not_found') return err('not_found', 404);
    if (['state', 'not_complete', 'open_requests', 'no_assign', 'published', 'open', 'too_many'].includes(c)) {
      const e = err(c, 409);
      if (c === 'published' && Number.isSafeInteger(r.id)) e.ids = [String(r.id)];
      return e;
    }
    return err('db', 500);
  }
  async function cs4Ctx(a) {
    if (!a.emp) throw err('no_emp', 403);
    const P = await csPeople();
    const me = P.find(p => p.id === String(a.emp) && !p.out) || null;
    if (!me) throw err('forbidden', 403);
    const asg = await cs4Read('csq4_assign?period=eq.' + encodeURIComponent(CS4_PERIOD) + '&select=emp_id,system,grade,type,ver,updated_at,by_name&limit=5000');
    const A = new Map((Array.isArray(asg) ? asg : []).map(x => [String(x.emp_id), x]));
    const isChef = a.role === 'staff' && a.grade >= 4 && (me.role === 'chef' || CHEF_TITLES.includes(me.title)) && await confChef(a);
    const S = a.role === 'am' ? [...new Set([...arr(a.am), ...arr(a.stores)])] : (a.role === 'staff' && a.grade >= 3 ? await protStores(a) : []);
    const inStores = p => S.length > 0 && (S.includes(p.store) || p.support.some(x => S.includes(x)));
    const kitchen = p => {
      const x = A.get(p.id);
      if (x) return x.system === 'S_CHEF' || x.system === 'PREP' || (x.system === 'G' && x.type === 'Kitchen中心');
      return p.dept === '調理' || p.title === 'Kitchen Leader' || CS4_PREP_TITLES.includes(p.title);
    };
    const live = p => !!p && !p.out && p.id !== me.id;
    // sys：評価の行の評価表（保存・共有・確認待ち）。無ければ割り当ての評価表で見る
    const canScore = (p, sys) => {
      if (!live(p)) return false;
      if (a.role === 'ceo' || a.role === 'gm') return true;
      if (a.role === 'am') return !p.top && inStores(p);
      if (a.role === 'staff') {
        // グレードの分からない人（肩書きも役割も決まりに無い）は「自分より下」と決められないので採点しない（#214 のレビュー）
        if (isChef) return !p.top && !OFFICE_ROLES.includes(p.role) && p.known && p.gS < a.grade && kitchen(p);
        if (a.grade >= 4) return !p.top && inStores(p) && p.known && p.gS < a.grade;
        // 確かめた G3：自分の店の G2 の人だけ（本部の人・グレードの分からない人は除く。Moto さん 11/23）。
        // G の評価表だけ（Moto さん 11/23 07:3x「G の評価表だけ」・Codex #214）：評価の行・割り当てのどちらかが G 以外（S_CHEF・S_OFFICE・PREP）なら採点しない。
        // 評価表がまだ決まっていない人は一覧に出す（始めるには割り当てが要る＝no_assign）
        if (a.grade === 3) {
          const f = (A.get(p.id) || {}).system;
          if ((sys !== undefined && sys !== 'G') || (f !== undefined && f !== 'G')) return false;
          return !p.top && !OFFICE_ROLES.includes(p.role) && inStores(p) && p.known && p.gS === 2;
        }
        return false;
      }
      if (a.role === 'office') return p.role === 'office_crew' && !p.boss && !p.confAm;
      return false;
    };
    const canConfirm = p => live(p) && (a.role === 'ceo' || a.role === 'gm');
    // 退職した人の開いたままの評価：CEO・GM が取り消せる（読むのと取り消しだけ。#214 のレビュー）
    const canCancelOut = p => !!p && p.out && p.id !== me.id && (a.role === 'ceo' || a.role === 'gm');
    const byId = new Map(P.filter(p => !p.out).map(p => [p.id, p]));
    const all = new Map(P.map(p => [p.id, p]));
    return { P, me, A, nosql: asg === null, byId, all, canScore, canConfirm, canCancelOut, canSee: p => canScore(p) || canConfirm(p) };
  }
  // 読める人か（採点・確定できる人・退職の人の取り消し）。書く頼みはこのあとでそれぞれの権限を確かめる
  function cs4Person(C, id) {
    if (!cs4Id(id)) throw bad();
    const p = C.byId.get(id) || C.all.get(id);
    if (!p || !(C.canSee(p) || C.canCancelOut(p))) throw err('forbidden', 403);
    return p;
  }
  async function cs4Row(id, cols = CS4_EV_COLS) {
    if (!cs4Int(id, 1)) throw bad();
    const rows = await cs4Read('csq4_evals?id=eq.' + id + '&select=' + cols);
    if (rows === null) throw err('not_installed', 503);
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r || r.period !== CS4_PERIOD) throw err('not_found', 404);
    return r;
  }
  async function cs4Tracks() {
    const rows = await rest("app_state?select=value&key=eq.bonus_track");
    const v = obj(kbPlain(Array.isArray(rows) && rows[0] ? rows[0].value : null)) || {};
    const m = new Map(), pre = CS4_PERIOD + '|';
    for (const [k, x] of Object.entries(v)) if (k.startsWith(pre) && obj(x) && typeof x.t === 'string') m.set(k.slice(pre.length), x.t);
    return m;
  }
  const cs4Can = (a, C, p) => ({ score: C.canScore(p), confirm: C.canConfirm(p), assign: SS_FULL_ROLES.includes(a.role) && C.canConfirm(p), cancel: C.canConfirm(p) || C.canCancelOut(p) });
  const cs4AssignOut = x => x ? { system: x.system, grade: x.grade || null, type: x.type || null, ver: x.ver, at: x.updated_at || null, by_name: x.by_name || '' } : null;

  // 本人：自分の評価表・本人に共有された内容（共有していない下書きは中身を出さない）・自分の申し出・今までの自分の記録
  async function cs4Me(a) {
    const base = { period: CS4_PERIOD, version: CS4_VERSION };
    if (!a.emp) return { ...base, none: true };
    const id = encodeURIComponent(a.emp), per = '&period=eq.' + encodeURIComponent(CS4_PERIOD);
    const asg = await cs4Read('csq4_assign?emp_id=eq.' + id + per + '&select=system,grade,type,ver,updated_at,by_name');
    if (asg === null) return { ...base, nosql: true };
    const [evs, reqs, hist] = await Promise.all([
      rest('csq4_evals?emp_id=eq.' + id + per + '&select=id,rev,status,system,grade,type,version,shared,shared_at,confirmed_at,confirmed_by_name,closed_at&order=rev.desc&limit=50'),
      rest('csq4_reqs?emp_id=eq.' + id + per + '&select=id,eval_id,item_id,kind,note,status,answer,created_at,answered_at,answered_by_name&order=id.desc&limit=500'),
      rest('csq4_hist?emp_id=eq.' + id + '&kind=in.(lss_emp,lss_history,lss_requests)&select=' + CS4_HIST_COLS + '&order=id.desc&limit=200'),
    ]);
    const E = Array.isArray(evs) ? evs : [];
    const pub = E.find(r => r.status === 'published') || null;
    const op = E.find(r => CS4_OPEN.includes(r.status)) || null;
    const shown = r => ({ id: r.id, rev: r.rev, system: r.system, grade: r.grade || null, type: r.type || null, version: r.version });
    const state = pub && !op ? 'published' : op ? (op.shared_at ? 'shared' : 'in_progress') : 'none';
    return { ...base, state, assign: cs4AssignOut(Array.isArray(asg) ? asg[0] : null),
      published: pub ? { ...shown(pub), confirmed_at: pub.confirmed_at, confirmed_by_name: pub.confirmed_by_name || '', shared: pub.shared || null } : null,
      open: op ? { ...shown(op), shared_at: op.shared_at || null, shared: op.shared_at ? (op.shared || null) : null } : null,
      past: E.filter(r => r.status === 'superseded' && r.confirmed_at).map(r => ({ ...shown(r), confirmed_at: r.confirmed_at, closed_at: r.closed_at, shared: r.shared || null })),
      reqs: Array.isArray(reqs) ? reqs : [],
      hist: (Array.isArray(hist) ? hist : []).map(h => ({ ...h, oldSystem: h.period === CS4_PERIOD })) };
  }
  // 評価する人の一覧（見られる人・初めの提案・評価表・今の評価の短いまとめ・申し出の数・できること）
  async function cs4Roster(a) {
    const C = await cs4Ctx(a);
    const base = { period: CS4_PERIOD, version: CS4_VERSION };
    if (C.nosql) return { ...base, rows: [], counts: null, nosql: true };
    const ppl = [...C.byId.values()].filter(p => C.canSee(p));
    if (SS_FULL_ROLES.includes(a.role)) {   // CEO・GM：退職した人で開いたままの評価がある人も出す（取り消すため）
      const op = await rest('csq4_evals?period=eq.' + encodeURIComponent(CS4_PERIOD) + '&status=in.(draft,submitted,returned)&select=emp_id&limit=5000');
      const seen = new Set(ppl.map(p => p.id));
      for (const r of (Array.isArray(op) ? op : [])) {
        const p = C.all.get(String(r.emp_id));
        if (p && !seen.has(p.id) && C.canCancelOut(p)) { seen.add(p.id); ppl.push(p); }
      }
    }
    const tracks = await cs4Tracks();
    const ids = ppl.map(p => p.id), E = new Map(), R = new Map();
    for (let i = 0; i < ids.length; i += 150) {
      const part = ids.slice(i, i + 150);
      const evs = await rest('csq4_evals?period=eq.' + encodeURIComponent(CS4_PERIOD) + '&status=in.(draft,submitted,returned,published)&emp_id=' + encodeURIComponent(IN(part))
        + '&select=id,emp_id,rev,status,system,grade,type,result,ver,shared_at,updated_at,updated_by_name,confirmed_at&limit=2000');
      for (const r of (Array.isArray(evs) ? evs : [])) { const k = String(r.emp_id); if (!E.has(k)) E.set(k, []); E.get(k).push(r); }
      const rq = await rest('csq4_reqs?period=eq.' + encodeURIComponent(CS4_PERIOD) + '&status=eq.open&emp_id=' + encodeURIComponent(IN(part)) + '&select=emp_id&limit=5000');
      for (const r of (Array.isArray(rq) ? rq : [])) R.set(String(r.emp_id), (R.get(String(r.emp_id)) || 0) + 1);
    }
    const counts = { not_started: 0, draft: 0, submitted: 0, returned: 0, published: 0 };
    const sum = r => r ? { id: r.id, rev: r.rev, status: r.status, ver: r.ver, system: r.system, grade: r.grade || null, type: r.type || null,
      shared: !!r.shared_at, at: r.updated_at, by_name: r.updated_by_name || '', confirmed_at: r.confirmed_at || null, ...cs4Brief(r) } : null;
    const rows = ppl.map(p => {
      const es = E.get(p.id) || [];
      const op = es.find(r => CS4_OPEN.includes(r.status)) || null, pub = es.find(r => r.status === 'published') || null;
      counts[op ? op.status : pub ? 'published' : 'not_started']++;
      return { emp: p.id, name: p.name, store: p.store, title: p.title, role: p.role, grade: p.gS, out: !!p.out,
        suggest: cs4Suggest(p, tracks.get(p.id)), assign: cs4AssignOut(C.A.get(p.id)), open: sum(op), published: sum(pub), reqs: R.get(p.id) || 0,
        can: cs4Can(a, C, p) };
    });
    rows.sort((x, y) => String(x.store).localeCompare(String(y.store)) || String(x.name).localeCompare(String(y.name)));
    return { ...base, rows, counts };
  }
  // 1 人の評価（全部の改訂・申し出・記録）
  async function cs4Get(a, b) {
    const C = await cs4Ctx(a);
    if (C.nosql) return { period: CS4_PERIOD, nosql: true };
    const p = cs4Person(C, b.emp);
    const id = encodeURIComponent(p.id), per = '&period=eq.' + encodeURIComponent(CS4_PERIOD);
    const [evs, reqs, log] = await Promise.all([
      rest('csq4_evals?emp_id=eq.' + id + per + '&select=' + CS4_EV_COLS + '&order=rev.desc&limit=50'),
      rest('csq4_reqs?emp_id=eq.' + id + per + '&select=id,eval_id,item_id,kind,note,status,answer,created_at,created_by_name,answered_at,answered_by_name&order=id.desc&limit=500'),
      rest('csq4_log?emp_id=eq.' + id + per + '&select=id,at,eval_id,action,by_name,by_role,detail&order=id.desc&limit=200'),
    ]);
    return { period: CS4_PERIOD, version: CS4_VERSION, person: { emp: p.id, name: p.name, store: p.store, title: p.title, role: p.role, grade: p.gS, out: !!p.out },
      assign: cs4AssignOut(C.A.get(p.id)), evals: Array.isArray(evs) ? evs : [], reqs: Array.isArray(reqs) ? reqs : [], log: Array.isArray(log) ? log : [],
      can: cs4Can(a, C, p) };
  }
  // 評価表を決める（GM・CEO。答え 1 A・2 A）
  async function cs4Assign(a, b) {
    await pvMgr(a);
    const C = await cs4Ctx(a);
    if (C.nosql) throw err('not_installed', 503);
    const its = b.items;
    if (!Array.isArray(its) || its.length < 1 || its.length > 200) throw bad();
    const seen = new Set(), out = [];
    for (const x of its) {
      if (!obj(x) || !cs4Id(x.emp) || seen.has(x.emp) || !cs4Int(x.expect)) throw bad();
      seen.add(x.emp);
      const p = C.byId.get(x.emp);
      if (!p || !C.canConfirm(p)) throw err('forbidden', 403);
      const v = cs4CleanAssign(x);
      if (!v) throw bad();
      out.push({ emp: p.id, name: String(p.name || '').slice(0, 120), period: CS4_PERIOD, ...v, expect: x.expect });
    }
    const r = await cs4Rpc(a, 'csq4_assign_save', { p_items: out, ...cs4By(a) });
    if (r.ok !== true || !Array.isArray(r.rows)) throw cs4Fail(r);
    return { ok: true, rows: r.rows, same: Number(r.same) || 0, at: r.at || null };
  }
  // 評価を始める・再開する（開いている評価があればそれを返す＝何度押しても初期化しない）
  async function cs4Start(a, b) {
    const C = await cs4Ctx(a);
    if (C.nosql) throw err('not_installed', 503);
    const p = cs4Person(C, b.emp);
    if (!C.canScore(p)) throw err('forbidden', 403);
    const x = C.A.get(p.id);
    if (!x) throw err('no_assign', 409);
    if (b.assign !== undefined && b.assign !== null && b.assign !== x.ver) throw err('conflict', 409);
    const result = cs4Compute(x, {}, x.system === 'PREP' ? {} : null);
    const r = await cs4Rpc(a, 'csq4_eval_start', { p_emp: p.id, p_name: String(p.name || '').slice(0, 120), p_period: CS4_PERIOD, p_assign_ver: x.ver, p_result: result, ...cs4By(a) });
    if (r.ok !== true) throw cs4Fail(r);
    return { ok: true, id: r.id, rev: r.rev, ver: r.ver, status: r.status, resumed: r.resumed === true };
  }
  // 確定・公開のあとの再評価（新しい改訂。同じ評価表なら確定の明細を写して始める）
  async function cs4Reeval(a, b) {
    const C = await cs4Ctx(a);
    if (C.nosql) throw err('not_installed', 503);
    const p = cs4Person(C, b.emp);
    if (!C.canScore(p)) throw err('forbidden', 403);
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason || reason.length > 1000 || !cs4Int(b.pub, 1)) throw bad();
    const x = C.A.get(p.id);
    if (!x) throw err('no_assign', 409);
    if (b.assign !== undefined && b.assign !== null && b.assign !== x.ver) throw err('conflict', 409);
    const pub = await cs4Row(b.pub, 'id,emp_id,period,status,system,entries,prep');
    if (pub.emp_id !== p.id || pub.status !== 'published') throw err('conflict', 409);
    const copy = pub.system === x.system;
    const entries = copy ? (obj(pub.entries) || {}) : {};
    const prep = x.system === 'PREP' ? (copy ? (obj(pub.prep) || {}) : {}) : null;
    const result = cs4Compute(x, entries, prep);
    const r = await cs4Rpc(a, 'csq4_eval_reeval', { p_emp: p.id, p_name: String(p.name || '').slice(0, 120), p_period: CS4_PERIOD, p_pub_id: pub.id, p_assign_ver: x.ver,
      p_copy: copy, p_reason: reason, p_result: result, ...cs4By(a) });
    if (r.ok !== true) throw cs4Fail(r);
    return { ok: true, id: r.id, rev: r.rev, ver: r.ver, status: r.status, copied: r.copied === true };
  }
  // 下書きを保存する（明細は変わった項目だけ送る。null＝未評価に戻す）。総合点・状態はサーバーが計算する
  async function cs4Save(a, b) {
    const C = await cs4Ctx(a);
    const row = await cs4Row(b.id);
    const p = C.byId.get(String(row.emp_id));
    if (!p || !C.canScore(p, row.system)) throw err('forbidden', 403);
    if (!cs4Int(b.expect, 1)) throw bad();
    if (b.expect !== row.ver) throw err('conflict', 409);
    if (!['draft', 'returned'].includes(row.status)) throw err('state', 409);
    const sensitive = !!row.shared_at || row.rev > 1 || row.status === 'returned';   // 本人に共有した・再評価・差戻しのあとは、変えた理由が要る
    const old = obj(row.entries) || {}, entries = { ...old }, changes = {}, need = [];
    if (b.entries !== undefined) {
      if (!obj(b.entries) || Object.keys(b.entries).length > 200) throw bad();
      for (const [id, v] of Object.entries(b.entries)) {
        const c = cs4CleanEntry(row.system, id, v);
        if (c.error) { const e = bad(); e.ids = [id]; throw e; }
        const before = obj(old[id]) || null, after = c.entry;
        const coreChanged = cs4CoreOf(before) !== cs4CoreOf(after);
        const bodyChanged = cs4BodyOf(before) !== cs4BodyOf(after);
        if (!coreChanged && !bodyChanged) continue;
        const why = c.reason && c.reason !== (before && before.changeReason) ? c.reason : '';   // この保存で送った理由だけ（前の版が明細に残した理由は使わない）
        if (coreChanged && sensitive && before && before.status !== 'UNASSESSED' && !why) { need.push(id); continue; }
        if (after === null) delete entries[id];
        else entries[id] = { ...cs4Pick(after, [...CS4_CORE, ...CS4_KEEP]), prevStatus: coreChanged ? (before ? before.status : 'UNASSESSED') : (before && before.prevStatus ? before.prevStatus : 'UNASSESSED'),
          byEmp: a.emp, byName: a.name || '', at: cs4Iso() };
        changes[id] = coreChanged ? { before: before ? cs4Pick(before, CS4_CORE) : null, after: after ? cs4Pick(after, CS4_CORE) : null, reason: why } : { text: true };
      }
    }
    if (need.length) { const e = err('reason_required', 400); e.ids = need; throw e; }
    let feedback = obj(row.feedback) || {};
    if (b.feedback !== undefined) {
      const f = cs4CleanFeedback(b.feedback);
      if (!f) throw bad();
      if (canon(f) !== canon(feedback)) changes._feedback = true;
      feedback = f;
    }
    let prep = row.system === 'PREP' ? (obj(row.prep) || {}) : null;
    if (b.prep !== undefined) {
      if (row.system !== 'PREP') throw bad();
      const q = cs4CleanPrep(b.prep);
      if (!q) throw bad();
      if (canon(q) !== canon(prep)) changes._prep = true;
      prep = q;
    }
    if (!Object.keys(changes).length) return { ok: true, id: row.id, ver: row.ver, same: true, result: row.result };
    const result = cs4Compute(row, entries, prep);
    const r = await cs4Rpc(a, 'csq4_eval_save', { p_id: row.id, p_expect: b.expect, p_entries: entries, p_prep: prep, p_feedback: feedback, p_result: result,
      p_changes: changes, ...cs4By(a) });
    if (r.ok !== true) throw cs4Fail(r);
    return { ok: true, id: row.id, ver: r.ver, at: r.at || null, result };
  }
  // 状態を進める：share（本人に共有）・submit（確認待ちへ）＝採点する人／return・confirm・cancel＝確定する人
  async function cs4Act(a, b) {
    const C = await cs4Ctx(a);
    if (!['share', 'submit', 'return', 'confirm', 'cancel'].includes(b.act) || !cs4Int(b.expect, 1)) throw bad();
    const note = b.note === undefined || b.note === null ? '' : (typeof b.note === 'string' ? b.note.trim() : null);
    if (note === null || note.length > 1000) throw bad();
    if ((b.act === 'return' || b.act === 'cancel') && !note) throw bad();
    const row = await cs4Row(b.id);
    const p = C.byId.get(String(row.emp_id)) || C.all.get(String(row.emp_id));
    const may = b.act === 'share' || b.act === 'submit' ? (p && C.canScore(p, row.system)) : b.act === 'cancel' ? (p && (C.canConfirm(p) || C.canCancelOut(p))) : (p && C.canConfirm(p));
    if (!may) throw err('forbidden', 403);
    const result = cs4Compute(row, obj(row.entries) || {}, row.system === 'PREP' ? (obj(row.prep) || {}) : null);
    const shared = b.act === 'share' || b.act === 'confirm' ? cs4Shared(row, obj(row.entries) || {}, obj(row.feedback) || {}, result) : null;
    const r = await cs4Rpc(a, 'csq4_eval_act', { p_id: row.id, p_expect: b.expect, p_act: b.act, p_note: note, p_shared: shared, p_ok: result.confirmable === true, ...cs4By(a) });
    if (r.ok !== true) throw cs4Fail(r);
    return { ok: true, id: row.id, ver: r.ver, at: r.at || null };
  }
  // 本人の見直しの申し出（「任されていないため見直しを希望」＝not_assigned・項目）とコメント（comment）。本人の評価だけ
  async function cs4Req(a, b) {
    if (!a.emp) throw err('no_emp', 403);
    const P = await csPeople();   // 退職した人（OS 無効を含む）は申し出ない（#214 のレビュー）
    if (!P.some(p => p.id === String(a.emp) && !p.out)) throw err('forbidden', 403);
    if (!['not_assigned', 'comment'].includes(b.kind)) throw bad();
    const note = b.note === undefined || b.note === null ? '' : (typeof b.note === 'string' ? b.note.trim() : null);
    if (note === null || note.length > 1000 || (b.kind === 'comment' && !note)) throw bad();
    const row = await cs4Row(b.id, 'id,emp_id,period,system,status,shared_at');
    if (String(row.emp_id) !== String(a.emp)) throw err('not_found', 404);
    let item = null;
    if (b.item !== undefined && b.item !== null && b.item !== '') {
      if (typeof b.item !== 'string' || !CS4_ITEMS[row.system] || !CS4_ITEMS[row.system].has(b.item)) throw bad();
      item = b.item;
    }
    if (b.kind === 'not_assigned' && !item) throw bad();
    const r = await cs4Rpc(a, 'csq4_req_add', { p_eval_id: row.id, p_item: item, p_kind: b.kind, p_note: note, p_by_emp: a.emp, p_by_name: a.name || null });
    if (r.ok !== true) throw cs4Fail(r);
    return { ok: true, id: r.id, same: r.same === true, at: r.at || null };
  }
  // 申し出に答える（その人を採点・確定できる人）
  async function cs4Answer(a, b) {
    const C = await cs4Ctx(a);
    const answer = typeof b.answer === 'string' ? b.answer.trim() : '';
    if (!answer || answer.length > 1000 || !cs4Int(b.id, 1)) throw bad();
    const rows = await cs4Read('csq4_reqs?id=eq.' + b.id + '&select=id,emp_id,period,status');
    if (rows === null) throw err('not_installed', 503);
    const x = Array.isArray(rows) ? rows[0] : null;
    if (!x || x.period !== CS4_PERIOD) throw err('not_found', 404);
    const p = C.byId.get(String(x.emp_id));
    if (!p || !C.canSee(p)) throw err('forbidden', 403);
    const r = await cs4Rpc(a, 'csq4_req_answer', { p_id: x.id, p_answer: answer, ...cs4By(a) });
    if (r.ok !== true) throw cs4Fail(r);
    return { ok: true, id: x.id, at: r.at || null };
  }
  // 今までの記録（読むだけ）：{ emp }＝その人（見られる人）／{ legacy: true }＝人を決めない記録と写した回（GM・CEO）
  async function cs4Hist(a, b) {
    if (b.legacy === true) {
      await pvMgr(a);
      const [rows, runs] = await Promise.all([
        cs4Read('csq4_hist?emp_id=is.null&select=' + CS4_HIST_COLS + '&order=id.desc&limit=500'),
        cs4Read('csq4_runs?select=id,at,via,by_name,report&order=id.desc&limit=20'),
      ]);
      if (rows === null || runs === null) return { rows: [], runs: [], nosql: true };
      return { rows: rows.map(h => ({ ...h, oldSystem: h.period === CS4_PERIOD })), runs };
    }
    const C = await cs4Ctx(a);
    if (C.nosql) return { rows: [], nosql: true };
    const p = cs4Person(C, b.emp);
    const rows = await rest('csq4_hist?emp_id=eq.' + encodeURIComponent(p.id) + '&select=' + CS4_HIST_COLS + '&order=id.desc&limit=500');
    return { rows: (Array.isArray(rows) ? rows : []).map(h => ({ ...h, oldSystem: h.period === CS4_PERIOD })) };
  }
  // 今までの記録を写す（GM・CEO。元は変えない・何度でも同じ）
  async function cs4Copy(a) {
    await pvMgr(a);
    const r = await cs4Rpc(a, 'csq4_hist_copy', { p_via: 'fn', p_by_emp: a.emp || null, p_by_name: a.name || null });
    if (!Number.isSafeInteger(r.run)) throw err('db', 500);
    return { ok: true, report: r };
  }

  const ACTIONS = { pull, get, put, hist: csHist, pin_check: pinCheck, pin_set: pinSet, hr_get: hrGet, hr_op: hrOp, hr_match: hrMatch, pii_get: piiGet, pii_op: piiOp, card_match: cardMatch, tcf_status: tcfStatus, change_log: clGet, labor: ltGet, pv_get: pvGet, pv_full: pvFull, pv_save: pvSave, pv_log: pvLog, aff_get: affGet, aff_full: affFull, aff_save: affSave,
    cs4_me: cs4Me, cs4_roster: cs4Roster, cs4_get: cs4Get, cs4_assign: cs4Assign, cs4_start: cs4Start, cs4_reeval: cs4Reeval, cs4_save: cs4Save, cs4_act: cs4Act,
    cs4_req: cs4Req, cs4_answer: cs4Answer, cs4_hist: cs4Hist, cs4_copy: cs4Copy };
  const CODES = { forbidden: 403, bad_value: 400, conflict: 409, locked: 429, gone: 410, not_found: 404, not_installed: 503,
    no_emp: 403, state: 409, not_complete: 409, open_requests: 409, reason_required: 400, no_assign: 409, published: 409, open: 409, too_many: 409 };   // no_emp 以降は Career Score Q4（段階 3-1）

  return async function handle(req) {
    const origin = req.headers.get('origin');
    if (origin && !origins.includes(origin)) return new Response(JSON.stringify({ error: 'origin', fn: 1 }), { status: 403 });
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-fp-actor', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' } : {};
    // 答えにはいつも fn:1（アプリは fn の無い答え（ゲートウェイの 401・関数が無い 404 など）を「関数が使えない」とみなす）
    // csfn:1＝Career Score も扱う関数（v1140）。アプリは csfn の無い答えを「前の版の関数」とみなし、Career Score を今までどおり REST で
    //（取り込みの答えの Career Score の部分は cs。名前を分けている）
    // swfn:1＝決めた人だけが書ける設定（v1141）も扱う関数。アプリは swfn の無い答えを前の版とみなし、その設定を今までどおり REST で書く
    // hrfn:1＝採用（応募者・不採用ログ）とお悩み相談室（v1142）も扱う関数。アプリは hrfn の無い答えを前の版とみなし、今までどおり REST で
    // sw2:1＝v1143 の設定（GM・CEO だけが変える賞与・Career Score の設定）も扱う。アプリは sw2 の無い答えを前の版とみなし、その設定を今までどおり REST で書く
    // piifn:1＝従業員の個人の欄（v1144）も扱う。アプリは piifn の無い答えを前の版とみなし、その欄を今までどおり従業員の表に書く
    // ghfn:1＝グレード履歴（v1145）も扱う。アプリは ghfn の無い答えを前の版とみなし、グレード履歴を今までどおり REST で書く
    // tpfn:1＝Tip Rate・プレップ（v1146）も扱う。アプリは tpfn の無い答えを前の版とみなし、その 2 つを今までどおり REST で書く
    // scfn:1＝Tip の期間の確定・注意ログ（v1147）も扱う。アプリは scfn の無い答えを前の版とみなし、その 2 つを今までどおり REST で読み書きする
    // gbfn:1＝グレード履歴・賞与の個人設定・G3 の職種を読む範囲（v1148）も扱う。アプリは gbfn の無い答えを前の版とみなし、その 3 つを今までどおり REST で読む
    // clfn:1＝変更の記録（v1151）を読める（change_log）・書き込みに確かめた人を付ける。アプリは clfn の無い答えを前の版とみなし、記録のタブで「関数を v1151 に」と出す
    // ntfn:1＝通知（v1152）を読み書きする（nt）。アプリは ntfn の無い答えを前の版とみなし、通知を今までどおり REST で読み書きする
    // ltfn:1＝人件費の合計（v1192・labor）を出す。アプリは ltfn の無い答え（unknown_action）を前の版とみなし、10 分は端末で数える
    // affn:1＝所属の確認（v1195・aff_get・aff_full・aff_save）を扱う。アプリは affn の無い答えを前の版とみなし、「所属の確認」で「関数を v1195 に」と出す
    // pvfn:1＝画面の表示の設定（v1193・pv_get など）を扱う。アプリは pvfn の無い答え（unknown_action）を前の版とみなし、画面を今までの決まりで出す
    // cs4fn:1＝Career Score 2026 Q4（新制度・cs4_*）を扱う（段階 3-1）。アプリは cs4fn の無い答え（unknown_action）を前の版とみなし、新しい評価の画面を出さない
    const json = (v, s = 200) => new Response(JSON.stringify({ ...v, fn: 1, csfn: 1, swfn: 1, hrfn: 1, sw2: 1, piifn: 1, ghfn: 1, tpfn: 1, scfn: 1, gbfn: 1, clfn: 1, ntfn: 1, ltfn: 1, pvfn: 1, affn: 1, cs4fn: 1 }), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body;
    try { const t = await req.text(); if (t.length > 8000000) return json({ error: 'too_large' }, 413); body = JSON.parse(t || '{}'); } catch { return json({ error: 'bad_json' }, 400); }
    if (!obj(body)) return json({ error: 'bad_json' }, 400);
    // v1144：店ごとの保険料の合計は、ログインを確かめずに返す（店舗の PIN のタブレットでも人件費が今と同じに。人ごとの額は返さない）
    if (body.action === 'ins_totals') {
      try { return json(await insTotals()); } catch (e) { console.error('secure-state', 'ins_totals', safeErr(e)); return json({ error: 'error' }, 500); }
    }
    // v1197（UI案96 の 6B）：店のタブレットの列（画面の表示）は、ログインを確かめずに返す（店舗の PIN のタブレットのため・列だけ）
    if (body.action === 'pv_tab') {
      try { return json(await pvTab()); } catch (e) { console.error('secure-state', 'pv_tab', safeErr(e)); return json({ error: 'error' }, 500); }
    }
    // v1152：通知。ログインを確かめられない端末（店舗の PIN のタブレット・PIN が初期の人）は足すだけ（読めない・印を付けられない）
    if (body.action === 'nt') {
      try {
        const a0 = await actorOf(req, body);
        if (a0.err) return json({ error: a0.err }, 503);
        if (a0.deny) {
          const marks = (Array.isArray(body.read) && body.read.length) || (Array.isArray(body.ack) && body.ack.length);
          if (marks || !Array.isArray(body.add) || !body.add.length) { console.warn('secure-state unauthorized', 'nt', a0.deny); return json({ error: 'unauthorized' }, 401); }
          return json(await ntOp(null, body));
        }
        return json(await ntOp({ ...a0, ...fpDevice(req) }, body));
      } catch (e) {
        const code = e && e.code && CODES[e.code] ? e.code : '';
        if (code) return json({ error: code }, CODES[code]);
        console.error('secure-state', 'nt', safeErr(e));
        return json({ error: 'error' }, 500);
      }
    }
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!fn) return json({ error: 'unknown_action' }, 400);
    try {
      const a0 = await actorOf(req, body);
      if (a0.err) return json({ error: a0.err }, 503);
      if (a0.deny) { console.warn('secure-state unauthorized', body.action, a0.deny); return json({ error: 'unauthorized' }, 401); }
      const a = { ...a0, ...fpDevice(req) };   // v1151：端末の印・種類（変更の記録だけに使う。権限には使わない）
      return json(await fn(a, body));
    } catch (e) {
      const code = e && e.code && CODES[e.code] ? e.code : '';
      if (code) return json(Array.isArray(e.ids) ? { error: code, ids: e.ids } : { error: code }, CODES[code]);   // v1195：aff_save の conflict は違った人を返す
      console.error('secure-state', body.action, safeErr(e));
      return json({ error: 'error' }, 500);
    }
  };
}

// ---- 起動（supabase/functions/secure-state/index.ts と同じ）
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
