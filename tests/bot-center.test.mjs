import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createClockDetector } from '../bot/clock-detector.mjs';
const {extract}=createRequire(import.meta.url)('../scripts/extract-bot-clock.cjs');
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const cfg={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15};
const detector=createClockDetector({getCeCfg:()=>cfg,getTipLabor:()=>({})});
const sh=(a,b)=>({inDate:'2026-08-01T'+a+':00-10:00',outDate:b?'2026-08-01T'+b+':00-10:00':null});
function context(labor={}){
  const ctx={curRole:'office',curLang:'en',curUserName:'Test Reviewer',Date,console,setTimeout:()=>{},window:{},
    t:(ja,en)=>ctx.curLang==='en'?en:ja,
    getVisibleStores:()=>[{id:'TEST',name:'Test Store',toastGuid:'test-guid'}],
    getCeCfg:()=>({...cfg}),getTipLabor:()=>labor,getAttOverride:()=>null,
    escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    renderPage:()=>{},showToast:()=>{},openModal:s=>{ctx.modal=s;},
    document:{getElementById:id=>({value:({'bot-from':'2026-08-01','bot-to':'2026-08-01','bot-store':''})[id]})}};
  Object.assign(ctx,createClockDetector({getCeCfg:ctx.getCeCfg,getTipLabor:ctx.getTipLabor}));
  vm.createContext(ctx);
  const start=source.indexOf('/* FUNERGY_BOT_CENTER_BEGIN'),end=source.indexOf('/* FUNERGY_BOT_CENTER_END */',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),ctx); return ctx;
}
test('generated bot rules equal current app source byte-for-byte',()=>{
  assert.equal(fs.readFileSync(new URL('../bot/clock-detector.mjs',import.meta.url),'utf8'),extract(source));
});
test('legacy boundaries and Hawaii window remain unchanged',()=>{
  assert.equal(detector.ceCheckShift(sh('09:00','21:00')).level,null);
  assert.deepEqual(detector.ceCheckShift(sh('09:00','21:01')).kinds,['long']);
  assert.equal(detector.ceCheckShift(sh('09:00','09:15')).level,null);
  assert.deepEqual(detector.ceCheckShift(sh('09:00','09:14')).kinds,['short']);
  assert.deepEqual(detector.ceCheckShift(sh('01:00','03:00')).kinds,['auto']);
  assert.deepEqual(detector.ceCheckShift(sh('01:00','05:00')).kinds,['auto']);
  assert.equal(detector.ceCheckShift(sh('01:00','05:01')).level,null);
  assert.deepEqual(detector.ceCheckShift(sh('12:00','11:00')).kinds,['reverse']);
  assert.deepEqual(detector.ceCheckShift(sh('09:00',null)).kinds,['bad']);
  assert.deepEqual(detector.ceCheckShift(sh('20:00','23:30'),{...cfg,nightFrom:'23:00'}).kinds,['auto']);
  assert.equal(detector._ceOverlap([sh('09:00','12:00'),sh('11:00','13:00')]),true);
});
test('existing input provider drives person-level scan and overlap',()=>{
  const d=createClockDetector({getCeCfg:()=>cfg,getTipLabor:()=>({Synthetic:{shifts:[sh('09:00','12:00'),sh('11:00','13:00')]}})});
  assert.deepEqual(d.ceScanDay('TEST','2026-08-01').rows[0].kinds,['overlap']);
});
test('screen scans effective data and creates escaped bilingual editable drafts',()=>{
  const ctx=context({'<img src=x onerror=alert(1)>':{shifts:[sh('09:00','09:08')]}});
  ctx.botScan(); assert.equal(ctx._botView.rows.length,1);
  const html=ctx.renderBotLocalCenter(); assert.match(html,/Very short shift/);assert.doesNotMatch(html,/<img src=x/);
  ctx.botOpenDraft(0,'en'); assert.match(ctx.modal,/correct it in Toast/);assert.match(ctx.modal,/&lt;img/);
  ctx.botOpenDraft(0,'ja'); assert.match(ctx.modal,/Toastで修正/);
  ctx.curLang='ja';assert.match(ctx.renderBotLocalCenter(),/極端に短い/);
});
test('missing input and manual adjustments are explicit; no correction completion action',()=>{
  const empty=context();empty.botScan();assert.equal(empty._botView.missing.length,1);
  assert.match(empty.renderBotLocalCenter(),/Data not loaded or no shifts recorded/);
  const ctx=context({Synthetic:{shifts:[sh('09:00','09:08')]}});
  ctx.getAttOverride=()=>({data:{Synthetic:{}}});ctx.botScan();
  assert.equal(ctx._botView.overrides.length,1);ctx.botOpenDraft(0,'en');assert.match(ctx.modal,/manual adjustment/);
});
test('direct access denied for store staff; dates bounded to previous day and 31 days',()=>{
  const ctx=context({Synthetic:{shifts:[sh('09:00','09:08')]}});
  ctx.curRole='crew';ctx.botScan();assert.equal(ctx._botView.scanned,false);
  assert.doesNotMatch(ctx.renderBotLocalCenter(),/Synthetic/);
  assert.throws(()=>ctx.botDays('2026-02-30','2026-03-01'));
  assert.throws(()=>ctx.botDays('2026-01-01','2026-02-01'));
  assert.throws(()=>ctx.botDays('2099-01-01','2099-01-01'));
  assert.equal(ctx.botDays('2026-08-01','2026-08-31').length,31);
});
test('shared group and assignment UI work in both languages and escape user content',async()=>{
 const ctx=context();
 ctx._botShared.data={actor:{role:'gm'},line:{secret:true,token:true},stores:[{store_id:'TEST',name:'Test Store'}],groups:[{group_id:'C'+'c'.repeat(32),all_stores:true,enabled:true,label:'HQ <test>'},{group_id:'C'+'b'.repeat(32),store_id:'OTHER',enabled:true,label:'Other only'}],owners:[],intakes:[{id:1,data:{text:'<unsafe>'}}],cases:[{id:'00000000-0000-4000-8000-000000000001',code:'B-000000000001',kind:'labor',store_id:'TEST',business_date:'2026-08-01',subject:'Synthetic',assignee:'<Manager>',version:1,status:'review',payload:{}}],runs:[]};
 ctx.botAPI=async()=>({events:[],outbox:[]});
 for(const lang of ['en','ja']){
  ctx.curLang=lang;ctx.botGroupsModal();assert.match(ctx.modal,/value="__all__"/);assert.match(ctx.modal,/HQ &lt;test&gt;/);
  ctx.botOwnersModal();assert.match(ctx.modal,/bot-owner-0/);
  const html=ctx.renderBotCenter();assert.match(html,/bot-intake-1/);assert.match(html,/&lt;unsafe&gt;/);
  await ctx.botCaseModal(ctx._botShared.data.cases[0].id);assert.match(ctx.modal,/HQ &lt;test&gt;/);assert.doesNotMatch(ctx.modal,/Other only/);assert.match(ctx.modal,/&lt;Manager&gt;/);assert.match(ctx.modal,/bot-assignee/);
  ctx._botShared.data.daily={overview:{day:'2026-09-08'}};ctx._botShared.data.cases[0].payload.draft='Saved reviewer wording';await ctx.botCaseModal(ctx._botShared.data.cases[0].id,true);assert.match(ctx.modal,/Saved reviewer wording/);
 }
});
test('attendance is the initial shared filter and default collection explicitly excludes Voids',async()=>{
 const ctx=context();assert.equal(ctx._botShared.kind,'labor');const calls=[];ctx._botShared.data={stores:[{store_id:'TEST'}]};
 ctx.document.getElementById=id=>({value:id==='bot-cloud-store'?'TEST':'2026-08-01'});
 ctx.botAPI=async body=>{calls.push(body);return {created_or_matched:0};};ctx.botLoadShared=async()=>{};
 await ctx.botCloudScan();assert.equal(calls[0].with_voids,false);assert.equal(ctx._botShared.kind,'labor');
 await ctx.botCloudScan(true);assert.equal(calls[1].with_voids,true);assert.equal(ctx._botShared.kind,'');
});

test('bulk scans cover inclusive days and all stores, preserve failures, and retry only unfinished work',async()=>{
 const ctx=context();ctx._botShared.data={stores:[{store_id:'A'},{store_id:'B'}]};ctx.botYesterday=()=> '2026-08-10';
 assert.throws(()=>ctx.botScanJobs('__all__','2026-07-01','2026-08-10'));
 assert.throws(()=>ctx.botScanJobs('__all__','2026-08-02','2026-08-01'));
 assert.throws(()=>ctx.botScanJobs('__all__','2026-02-30','2026-03-01'));
 assert.throws(()=>ctx.botScanJobs('__all__','2026-08-10','2026-08-11'));
 assert.equal(ctx.botScanJobs('__all__','2026-07-11','2026-08-10').length,62);
 const calls=[];ctx.botLoadShared=async()=>{};ctx.botAPI=async b=>{calls.push(b);if(calls.length===2)throw Error('toast_read_failed');return {};};
 ctx._botBatch={jobs:ctx.botScanJobs('__all__','2026-08-01','2026-08-02'),withVoids:false};
 await ctx.botRunBatch(false);assert.equal(calls.length,4);assert.equal(ctx._botBatch.jobs.filter(j=>j.state==='error').length,1);
 await ctx.botRunBatch(true);assert.equal(calls.length,5);assert.equal(calls[4].store_id,'B');assert.equal(calls[4].date,'2026-08-01');
 assert.equal(ctx._botBatch.jobs.every(j=>j.state==='ok'),true);
 ctx._botBatch={jobs:ctx.botScanJobs('__all__','2026-08-01','2026-08-02'),withVoids:true};ctx.botAPI=async b=>{ctx._botBatch.stop=true;assert.equal(b.with_voids,true);};
 await ctx.botRunBatch(false);assert.equal(ctx._botBatch.jobs.filter(j=>j.state==='pending').length,3);
});
test('work center hosts the same bot view and async updates stay in that tab',()=>{
 const ctx=context();ctx.curPage='tasks';let page;ctx.renderPage=p=>{page=p;};ctx.botRender();assert.equal(page,'tasks');
 assert.match(source,/if \(workTab==='bot' && botCanView\(\)\) return bar \+ renderBotCenter\(\)/);
 assert.match(source,/botCanView\(\)\?`<div class="phase-tab\$\{workTab==='bot'/);
});

test('morning panel groups assignees, preserves prior months, separates failures and has bilingual drafts',()=>{
 const ctx=context();const base={id:'00000000-0000-4000-8000-000000000001',code:'B-000000000001',kind:'labor',business_date:'2026-08-31',status:'review',store_id:'TEST',subject:'<unsafe>',assignee:'<Manager>',payload:{},daily_check:'action'};
 ctx._botShared.data={daily:{overview:{day:'2026-09-08',from:'2026-09-01',to:'2026-09-07',ok:1,expected:7,failed:1,issues:[]},cases:[base,{...base,id:'00000000-0000-4000-8000-000000000002',daily_check:'review',last_check:{message:'toast_read_failed'}}],next:'cursor'}};
 for(const lang of ['en','ja']){ctx.curLang=lang;const html=ctx.botDailyPanel();assert.match(html,/&lt;Manager&gt;/);assert.doesNotMatch(html,/<unsafe>/);assert.match(html,/botDailyMore/);assert.equal((html.match(/botMorningOpen\('[^']+',true\)/g)||[]).length,1);assert.ok(ctx.botMorningDraft(base).includes(lang==='en'?'Morning check':'毎朝の確認'));}
 ctx._botShared.data.daily.cases[0].daily_send='sent';assert.doesNotMatch(ctx.botDailyPanel(),/botMorningOpen\('[^']+',true\)/);
});

test('AM can reach Bot sign-in without a manager session or private administrator tabs',()=>{
 const ctx=context();ctx.curRole='am';assert.equal(ctx.botCanView(),true);ctx.botLoginModal();
 assert.match(ctx.modal,/Bot-only access does not open administrator pages/);assert.equal(ctx.window._authSession,undefined);
 ctx.curLang='ja';ctx.botLoginModal();assert.match(ctx.modal,/Bot専用登録では管理者ページは開けません/);
});
test('administrator entry and secure rendering reject office staff, AM and Bot-only sessions',async()=>{
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{style:{},dataset:{},value:'test',focus(){}});return elements.get(id);};
 const ctx={SUPABASE_URL:'https://db.test',SUPABASE_ANON:'anon',window:{},loginPerson:null,loginStoreMode:false,document:{getElementById:el},fetch:async url=>Response.json(url.includes('/token?')?{access_token:'token'}:[{role:'office_crew'}])};
 vm.createContext(ctx);
 const begin=source.indexOf('function managerRoleAllowed('),end=source.indexOf('/* ============================================================',begin);
 vm.runInContext(source.slice(begin,end),ctx);
 const render=source.indexOf('function renderSecureBody(){'),rend=source.indexOf('/* ============================================================',render);
 vm.runInContext(source.slice(render,rend),ctx);
 for(const role of ['office_crew','am','crew']){
  ctx.loginPerson={role};el('manager-login-screen').style.display='none';ctx.showManagerLogin();assert.equal(el('manager-login-screen').style.display,'none');
  ctx.window._authSession={role,access_token:'token'};assert.equal(ctx.managerSessionAllowed(),false);assert.doesNotMatch(ctx.renderSecureBody(),/secTab|PL分析|本部予算|成長カルテ/);
 }
 ctx.window._authSession=null;assert.equal(ctx.managerSessionAllowed(),false);
 for(const role of ['ceo','gm','office']){ctx.loginPerson={role};ctx.showManagerLogin();assert.equal(el('manager-login-screen').style.display,'flex');ctx.window._authSession={role,access_token:'token'};assert.equal(ctx.managerSessionAllowed(),true);}
 await ctx.doManagerLogin();assert.equal(ctx.window._authSession,null);assert.match(el('mgr-err').textContent,/管理者ページの権限がありません/);
});
test('HQ queue and response controls render in Japanese and English without exposing approval to crews',async()=>{
 const c=context(),id='00000000-0000-4000-8000-000000000010';c.botAPI=async()=>({events:[],outbox:[]});c._ceClock=()=>'';
 for(const lang of ['ja','en']){c.curLang=lang;c._botShared.data={actor:{role:'gm'},stores:[{store_id:'TEST',name:'Test'}],groups:[],cases:[{id,code:'#123',status:'hq_review',kind:'unpaid',version:3,store_id:'TEST',business_date:'2026-08-01',subject:'Synthetic',payload:{response:{actor:'<Manager>',note:'<reason>'}}}],daily:{overview:{day:'2026-09-10',from:'2026-09-01',to:'2026-09-09',expected:1,ok:1,failed:0},cases:[],next:null}};c._botShared.data.daily.cases=c._botShared.data.cases;
 const panel=c.botDailyPanel();assert.match(panel,/#123/);assert.match(panel,lang==='ja'?/本部確認待ち/:/Awaiting HQ review/);
 await c.botCaseModal(id);assert.match(c.modal,/hq_approve/);assert.match(c.modal,/hq_return/);assert.doesNotMatch(c.modal,/botReminderDraft|botCaseSend/);assert.match(c.modal,/&lt;reason&gt;/);
 c._botShared.data.actor.role='office_crew';await c.botCaseModal(id);assert.doesNotMatch(c.modal,/hq_approve|hq_return/);
 }
});
