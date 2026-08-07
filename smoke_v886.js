/* smoke_v886.js — renderAcctCenter() を実際に走らせて HTML が返るか確かめる。
   検証スクリプトが緑でも実機が直っていない、を繰り返したので、
   「文字列があるか」ではなく「呼んで落ちないか」を見る。
   経理センターまわりの関数だけ切り出し、外部依存は最小の stub を当てる。 */
const fs = require('fs');
const utf = fs.readFileSync('index.html', 'utf8');

function grab(re, name) {
  const m = utf.match(re);
  if (!m) { console.log('切り出し失敗: ' + name); process.exit(1); }
  return m[0];
}

const parts = [
  grab(/var AC_ST = \[[\s\S]*?\];/, 'AC_ST'),
  grab(/function _acStatus\(raw\)\{[\s\S]*?\n\}/, '_acStatus'),
  grab(/function _acStCol\(s\)\{[\s\S]*?\n\}/, '_acStCol'),
  grab(/function _acStRank\(s\)\{.*?\}/, '_acStRank'),
  grab(/function _acYm\(v\)\{[\s\S]*?\n\}/, '_acYm'),
  grab(/function _acDate\(v\)\{.*?\}/, '_acDate'),
  grab(/function _acStoreName\(id\)\{[\s\S]*?\n\}/, '_acStoreName'),
  grab(/function _acRows\(kind\)\{[\s\S]*?\n\}/, '_acRows'),
  grab(/function _acPend\(\)\{[\s\S]*?\n\}/, '_acPend'),
  grab(/function _acPendHtml\(\)\{[\s\S]*?\n\}/, '_acPendHtml'),
  grab(/var _acF = \{[^}]*\};/, '_acF'),
  grab(/function acUploadList\(kind\)\{[\s\S]*?\n\}/, 'acUploadList'),
  grab(/var _acCat = '[a-z]+';/, '_acCat'),
  grab(/var _acSub = '[a-z]+';/, '_acSub'),
  grab(/function acDashBody\(\)\{.*?\}/, 'acDashBody'),
  grab(/function acErrBody\(\)\{.*?\}/, 'acErrBody'),
  grab(/var AC_TABS = \[[\s\S]*?\n\];/, 'AC_TABS'),
  grab(/function acSetCat\(id\)\{[\s\S]*?\n\}/, 'acSetCat'),
  grab(/function acSetSub\(id\)\{.*\}/, 'acSetSub'),
  grab(/function renderAcctCenter\(\)\{[\s\S]*?\n\}\r?\nfunction renderMileage/, 'renderAcctCenter')
    .replace(/\r?\nfunction renderMileage$/, ''),
];

/* --- 外部依存の stub。中身は空でよい（落ちないことを見る） --- */
const stub = `
var STORES = [{id:'F01',name:'ToriTon'},{id:'F02',name:'Tenkichi'}];
var curStore='OFFICE', curRole='gm', curUserName='Moto';
function t(ja,en){ return ja; }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function ls(k,d){ return d; }
function renderPage(){}
function pendingAcctReviewCount(){ return 3; }
function getLostReceipts(){ return [{id:'L1',purchaseDate:'2026-08-01',storeId:'F01',employee:'A',amount:12,status:'申請中'}]; }
function getMileageRequests(){ return [{id:'G1',date:'2026-08-02',storeId:'F02',employee:'B',amount:9,status:'申請中'}]; }
function hqStaffMembers(){ return [{name:'経理さん'}]; }
function arStatusColor(){ return 'var(--green)'; }
var window = globalThis;
`;

/* sub.fn / sub.more が指す関数を空実装で用意（実在チェックは verify 側で済） */
const TABS_SRC = grab(/var AC_TABS = \[[\s\S]*?\n\];/, 'AC_TABS');
const TABS = new Function('return ' + TABS_SRC.replace(/^var AC_TABS = /, '').replace(/;$/, ''))();
const fnNames = new Set();
TABS.forEach(c => c.subs.forEach(s => { if (s.fn) fnNames.add(s.fn); if (s.more) fnNames.add(s.more); }));
fnNames.delete('acDashBody'); fnNames.delete('acErrBody');
/* ブラウザでは <script> 直下の function 宣言は window のプロパティになる。
   new Function の中ではローカル関数になってしまうので、明示的に載せ替える。 */
const fnStubs = [...fnNames].map(n => `globalThis.${n} = function(){ return '<div id="body-${n}">ok</div>'; };`).join('\n')
  + `\nglobalThis.renderOfficeMgr = function(bare){ return '<div id="body-officemgr" data-bare="'+!!bare+'">ok</div>'; };`
  + `\nglobalThis.renderErrorCenter = function(em){ return '<div id="body-err">ok</div>'; };`
  + `\nglobalThis.acDashBody = function(){ return renderOfficeMgr(true); };`
  + `\nglobalThis.acErrBody = function(){ return renderErrorCenter(true); };`;

const src = stub + '\n' + fnStubs + '\n' + parts.join('\n') + `
;globalThis.__run = function(){
  var out = [];
  AC_TABS.forEach(function(c){
    c.subs.forEach(function(s){
      _acCat = c.id; _acSub = s.id;
      var h = renderAcctCenter();
      if (typeof h !== 'string' || h.length < 50) throw new Error(c.id+'/'+s.id+' が空');
      out.push(c.id+'/'+s.id+' '+h.length);
    });
  });
  return out;
};`;

let res;
try {
  const f = new Function(src + '\nreturn globalThis.__run;');
  res = f()();
} catch (e) {
  console.log('SMOKE FAIL → ' + (e && e.message));
  console.log(e && e.stack && e.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
console.log('renderAcctCenter() 全 ' + res.length + ' タブで HTML を返した:');
res.forEach(r => console.log('   ' + r + ' 文字'));

/* 既定状態（起動直後）で 6 つの大タブが出るか */
const g = new Function(src + "\n_acCat='dash';_acSub='dash';return renderAcctCenter();")();
const labels = ['経理ダッシュボード', '経理レビュー', 'Tip＆シフトリーダー', '出力センター', '勤怠', '人材'];
const missing = labels.filter(L => g.indexOf(L) < 0);
console.log('\n既定表示に大タブ6つ: ' + (missing.length ? 'FAIL 欠け=' + missing.join(',') : 'OK'));
console.log('既定表示は経理ダッシュボード: ' + (g.indexOf('body-officemgr') >= 0 ? 'OK' : 'FAIL'));
console.log('帯なし(bare=true)で呼べている: ' + (g.indexOf('data-bare="true"') >= 0 ? 'OK' : 'FAIL'));
process.exit(missing.length ? 1 : 0);
