import test from 'node:test';
import assert from 'node:assert/strict';
import {createClockDetector} from '../bot/clock-detector.mjs';
const {laborFindings,createHandler,voidFindings,unpaidFindings}=await import(process.env.BOT_HANDLER_PATH||'../supabase/functions/ops-bot/handler.mjs');
const cfg={nightFrom:'03:00',nightTo:'05:00',longH:12,shortMin:15},store={store_id:'TEST',name:'Test'};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const shifts=[{guid:id(1),employeeReference:{guid:id(2)},inDate:'2026-08-01T09:00:00-10:00',outDate:null}];
const names=['Kiosk Mode','Kiosk Mode FG','FG KioskMode','kiosk-mode','KIOSK_MODE','Kiosk','Order Only','OrderOnly','order-only','Store Order.Only','Order','Ｏｒｄｅｒ　Ｏｎｌｙ'];
const humans=['Synthetic Person','Kioski Person','Orderly Person','Order Onlyson','Admin','Training','Guest','Unknown','',id(2)];
test('local attendance scan excludes reserved system names before every error/overlap check',()=>{
 const labor=Object.fromEntries([...names,...humans].map(n=>[n,{shifts:[...shifts,{inDate:'2026-08-01T09:00:00-10:00',outDate:'2026-08-01T09:08:00-10:00'}]}]));
 const before=JSON.stringify(labor),d=createClockDetector({getCeCfg:()=>cfg,getTipLabor:()=>labor}),r=d.ceScanDay('TEST','2026-08-01');
 assert.deepEqual(r.rows.map(r=>r.name),humans);assert.equal(r.nError,humans.length);assert.equal(JSON.stringify(labor),before);
});
test('server identity mapping excludes system accounts but keeps unknown and human accounts',()=>{
 for(const name of names)assert.equal(laborFindings(shifts,[{guid:id(2),name}],cfg,store,'2026-08-01').length,0,name);
 for(const name of humans)assert.equal(laborFindings(shifts,[{guid:id(2),name}],cfg,store,'2026-08-01').length,1,name);
 assert.equal(laborFindings(shifts,[{guid:id(2),firstName:'Kiosk',lastName:'Mode FG'}],cfg,store,'2026-08-01').length,0);
 assert.equal(laborFindings(shifts,[],cfg,store,'2026-08-01').length,1);
});
test('existing system-account cases close with exclusion evidence and never contact Toast or LINE',async()=>{
 const c={id:id(10),version:3,kind:'labor',store_id:'TEST',payload:{employee_name:'Kiosk Mode FG'}},calls=[];
 const env=k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon'})[k];
 const handler=createHandler({env,fetch:async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:id(99)});
  if(url.includes('/manager_auth?'))return Response.json([{role:'office'}]);
  if(url.includes('/bot_cases?id='))return Response.json([c]);
  if(url.endsWith('/rpc/bot_case_write')){const b=JSON.parse(init.body);calls.push(b);assert.equal(b.p_op,'verified');assert.equal(b.p_version,3);assert.equal(b.p_data.verification_type,'nonhuman_account_excluded');return Response.json({...c,status:'done'});}
  throw Error('Unexpected request '+url);
 }});
 const response=await handler(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({action:'recheck',id:c.id,version:3})}));
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.message,'excluded_nonhuman_account');assert.equal(calls.length,1);
 c.payload.employee_name='Synthetic Person';calls.length=0;
 assert.notEqual((await handler(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({action:'recheck',id:c.id,version:3})}))).status,200);assert.equal(calls.length,0);
});
test('finance findings remain detectable for system-account transactions',()=>{
 const orders=[{guid:id(1),checks:[{guid:id(2),paymentStatus:'OPEN',totalAmount:10,payments:[{guid:id(3),paymentStatus:'VOIDED',voidInfo:{voidUser:{guid:id(4)}}}]}]}];
 assert.equal(voidFindings(orders,store,'2026-08-01',[],[{guid:id(4),name:'Kiosk Mode'}]).length,1);assert.equal(unpaidFindings(orders,store,'2026-08-01').length,1);
});
