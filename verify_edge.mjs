/* hyper-worker の Job 追加が正しく動くか、実関数を抜き出して確認する */
import fs from 'fs';
const src = fs.readFileSync('index.ts', 'utf8');
const orig = fs.readFileSync('index_orig.ts', 'utf8');
let pass=0, fail=0;
const ok=(c,l,x)=>{ c?(pass++,console.log('  ✅ '+l)):(fail++,console.log('  ❌ '+l+(x!==undefined?'  → '+JSON.stringify(x):''))); };
function grab(t,n){
  let i=t.indexOf('function '+n+'(');
  if(i<0) throw new Error('not found: '+n);
  if(t.slice(i-6,i)==='async ') i-=6;
  let d=0,st=false,j=i;
  for(;j<t.length;j++){const c=t[j];if(c==='{'){d++;st=true;}else if(c==='}'){d--;if(st&&d===0){j++;break;}}}
  return t.slice(i,j);
}
// TS型注釈を落として素のJSにする（esbuildの出力を使う）
const js = fs.readFileSync('/tmp/_edge.js','utf8');

let calls=[];
globalThis.fetch = async (url, opt) => {
  calls.push(String(url));
  if(String(url).endsWith('/labor/v1/jobs')) return { ok:true, json: async()=>([
    {guid:'j1', title:'Shift Leader', deleted:false},
    {guid:'j2', title:'Server', deleted:false},
    {guid:'j3', title:'Prep', deleted:true},
  ])};
  return { ok:false, status:404, json: async()=>({}) };
};
const TOAST_HOST='https://ws-api.toasttab.com';
const fetchJobMap = new Function('TOAST_HOST', grab(js,'fetchJobMap')+'; return fetchJobMap;')(TOAST_HOST);
const jobTitleOf  = new Function(grab(js,'jobTitleOf')+'; return jobTitleOf;')();

console.log('\n[1] Job対応表');
const m = await fetchJobMap('TOKEN','REST-GUID');
ok(m.size===3, '3件取り込む', m.size);
ok(m.get('j1')==='Shift Leader', 'GUID→title が引ける', m.get('j1'));
ok(m.get('j3')==='Prep', '削除済みJobも入る（過去の勤怠が参照するため）');
ok(calls.filter(u=>u.endsWith('/labor/v1/jobs')).length===1, '一覧取得は1回だけ');
ok(calls[0].includes('/labor/v1/jobs'), '正しいエンドポイント', calls[0]);

console.log('\n[2] Job名の解決');
ok(jobTitleOf(m,{jobReference:{guid:'j1'}})==='Shift Leader', 'Job名が返る');
ok(jobTitleOf(m,{jobReference:{guid:'zz'}})==='', '未知GUIDは空文字');
ok(jobTitleOf(m,{})==='', 'jobReference が無くても落ちない');
ok(jobTitleOf(m,null)==='', 'te が null でも落ちない');
ok(jobTitleOf(undefined,{jobReference:{guid:'j1'}})==='', '対応表が無くても落ちない');

console.log('\n[3] /jobs が失敗した場合');
globalThis.fetch = async()=>{ throw new Error('network down'); };
const m2 = await fetchJobMap('T','G');
ok(m2.size===0, '例外でも空の対応表を返す（勤怠同期は止めない）', m2.size);
globalThis.fetch = async()=>({ ok:false, status:500, json:async()=>({}) });
ok((await fetchJobMap('T','G')).size===0, '500でも空を返す');

console.log('\n[4] 既存の挙動を壊していないか');
const before = grab(orig,'syncTipLabor'), after = grab(src,'syncTipLabor');
ok(/lunchHours \+= sp\.lunch/.test(after) && /dinnerHours \+= sp\.dinner/.test(after), 'L/D時間の計算はそのまま');
ok(/e\.lunchHours > 0 \|\| e\.dinnerHours > 0/.test(after), '保存対象の絞り込みもそのまま');
ok(/onConflict: "restaurant_guid,business_date"/.test(after), 'upsert のキーもそのまま');
ok(/te\.inDate && te\.outDate/.test(after), '未クロックアウトを除く条件もそのまま');
ok(before.match(/empCache/g).length === after.match(/empCache/g).length, 'empCache の扱いを変えていない');
// 「元のどの行が消えたか」で見る。行フィルタだと追加行が混ざって判定できない。
const norm = t => t.split('\n').map(x=>x.trim()).filter(Boolean);
const newSet = new Set(norm(after));
const removed = norm(before).filter(l => !newSet.has(l));
// 消えてよいのは「引数を増やした署名」と「Jobを足すために書き換えた push」の2行だけ
ok(removed.length===2, '元の行のうち消えたのは2行だけ', removed);
ok(removed.some(l=>l.startsWith('async function syncTipLabor')), '1つ目は引数を増やした署名', removed);
ok(removed.some(l=>l.includes('shifts.push({ inDate: te.inDate, outDate: te.outDate })')),
   '2つ目は Job を足すために書き換えた push', removed);
// 残りの行はすべて生きている
ok(norm(before).filter(l=>!newSet.has(l)).length === removed.length, '他の処理は1行も欠けていない');

console.log('\n[5] 呼び出し側');
ok(/const jobCache = await fetchJobMap\(token, s\.restaurant_guid\)/.test(src), 'cronSyncは店舗ごとに1回だけ取得');
const loop = src.slice(src.indexOf('for (const bd of bdList)'), src.indexOf('for (const bd of bdList)')+400);
ok(!/fetchJobMap/.test(loop), '日付ループの中では取得しない（実行時間切れを避ける）');
ok(/syncTipLabor\(token, supabase, s\.restaurant_guid, bd, sh, empCache, jobCache\)/.test(src), 'cronSyncから対応表を渡す');
ok((src.match(/jobTitle: jobTitleOf/g)||[]).length===2, '定期同期と手動同期の両方に入っている',(src.match(/jobTitle: jobTitleOf/g)||[]).length);
ok(/mode === "tipLabor"/.test(src) && /jobMapTL/.test(src), '手動のtipLaborモードにも入っている');

console.log('\n[6] クライアント(v801)との噛み合わせ');
const app = fs.readFileSync('/home/claude/build/index.html','utf8');
function grabApp(n){ let i=app.indexOf('function '+n+'(');let d=0,st=false,j=i;for(;j<app.length;j++){const c=app[j];if(c==='{'){d++;st=true;}else if(c==='}'){d--;if(st&&d===0){j++;break;}}}return app.slice(i,j); }
const slJobOf = new Function(grabApp('slJobOf')+'; return slJobOf;')();
const shiftOut = { inDate:'A', outDate:'B', jobTitle:'Shift Leader', jobGuid:'j1' };
ok(slJobOf(shiftOut)==='Shift Leader', 'アプリがEdgeの出力をそのまま拾える', slJobOf(shiftOut));
const isJob = new Function(grabApp('slIsLeaderJob')+'; return slIsLeaderJob;')();
ok(isJob('Shift Leader',{jobs:['Shift Leader','SL']}), 'Shift Leader と判定される');
ok(!isJob('Server',{jobs:['Shift Leader','SL']}), 'Server は判定されない');
ok(slJobOf({inDate:'A',outDate:'B',jobTitle:'',jobGuid:''})==='', 'Job未設定の勤務は空のまま');

console.log('\nPASS='+pass+'  FAIL='+fail);
process.exit(fail?1:0);
