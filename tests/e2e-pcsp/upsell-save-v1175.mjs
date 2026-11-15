// v1175（11/15 の依頼の B・UI案84）：アップセル対象商品の保存を本物のブラウザ（Chromium）で確かめる。模擬サーバーと合成データだけ（本番にはつながない）。
// 店（G3）が選んで保存 → クラウド（店ごとの設定）→ 読み込み直し → 本部（GM・別の端末）が同じ店を開く → 本部が保存。
// v1174 では、本部は店の設定ではなく全店共通を見せて全店共通に保存し、その店の率に効かなかった（このスクリプトで確かめた）。
// 使い方：模擬サーバー（tests/perf/server.mjs）を DATA_FILE=<合成データ> で動かしてから  DATA_FILE=<合成データ> node upsell-save-v1175.mjs [結果の JSON]
import fs from 'node:fs';
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k];
const APP='http://localhost:8080/';
const D=JSON.parse(fs.readFileSync(process.env.DATA_FILE||'/tmp/pcsp/data.json','utf8'));
const ARGS=['--host-resolver-rules=MAP tgbhgxzehzeouopklhje.supabase.co 127.0.0.1, MAP cdn.jsdelivr.net 127.0.0.1, MAP api.open-meteo.com 127.0.0.1, MAP archive-api.open-meteo.com 127.0.0.1','--ignore-certificate-errors'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ctl=p=>fetch(new URL(p,APP)).then(r=>r.text());
const sto=e=>e.store||(e.data||{}).store, role=e=>e.role||(e.data||{}).role, nm=e=>e.name||(e.data||{}).name;
async function open(tag){ const dir='/tmp/bprobe-'+tag; fs.rmSync(dir,{recursive:true,force:true});
  const ctx=await chromium.launchPersistentContext(dir,{headless:true,args:ARGS,ignoreHTTPSErrors:true,viewport:{width:1280,height:860},locale:'ja-JP',timezoneId:'Pacific/Honolulu'});
  const page=ctx.pages()[0]||await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e.message).slice(0,160))); page.on('dialog',d=>d.accept().catch(()=>{}));
  await page.goto(APP); await page.waitForFunction(()=>document.querySelectorAll('#login-store-grid .store-btn').length>2,null,{timeout:120000}); return {ctx,page,errors}; }
async function login(page,loc,name){ await page.evaluate(s=>loginPickLocation(s),loc); await page.locator('#login-name-grid .store-btn',{hasText:name}).first().click();
  await page.fill('#login-pin-input','1234'); await page.click('#login-pin-btn');
  await page.waitForFunction(()=>{const a=document.getElementById('app-shell');return a&&getComputedStyle(a).display!=='none'&&document.getElementById('main-content').children.length>0;},null,{timeout:180000});
  await page.waitForFunction(()=>window._heavyPending===false&&!window._uxOpsBusy,null,{timeout:180000,polling:100}); await sleep(2000); }
async function openUpsell(page,sid){ await page.evaluate(s=>{ window._kpiTab='manual'; window._kpiStore=s; go('kpi_master'); },sid); await sleep(1500);
  return page.evaluate(()=>({checked:[...document.querySelectorAll('.kpi-upsell:checked')].map(c=>c.value), total:document.querySelectorAll('.kpi-upsell').length, disabled:[...document.querySelectorAll('.kpi-upsell')].some(c=>c.disabled), btn:!!document.querySelector('[onclick^="saveUpsellGuids"]')})); }
const cloud=async(page)=>page.evaluate(async()=>{ try{ const r=await fetch(SUPABASE_URL+'/rest/v1/app_settings?key=eq.kpi_config&select=value,updated_at',{headers:supaHeaders()}); const j=await r.json(); const v=j&&j[0]&&j[0].value; const u=(v&&v.__st)?v.v:v; return {top:(u||{}).upsellGuids||null, byStore:(u&&u.byStore)?Object.fromEntries(Object.entries(u.byStore).map(([k,x])=>[k,x.upsellGuids])):null, at:j&&j[0]&&j[0].updated_at}; }catch(e){ return String(e); } });
const out={};
const gm=D.tables.employees.find(e=>role(e)==='gm'); const g4={name:D.login.sl};   // G3（Store Leader）・F02
const sidG=sto(gm)||'---';
// 1) store G4 (F01) checks two items and saves
let A=await open('g4'); await login(A.page,'F02',nm(g4));
out.g4_before=await openUpsell(A.page,'F02');
await A.page.evaluate(()=>{ const cs=[...document.querySelectorAll('.kpi-upsell')]; cs[0].checked=true; cs[1].checked=true; });
const pick=await A.page.evaluate(()=>[...document.querySelectorAll('.kpi-upsell:checked')].map(c=>c.value));
await A.page.click('[onclick^="saveUpsellGuids"]'); await sleep(4000);
out.g4_after_save=await openUpsell(A.page,'F02'); out.g4_pick=pick;
out.cloud1=await cloud(A.page);
// reload same device
await A.page.reload(); await A.page.waitForFunction(()=>document.querySelectorAll('#login-store-grid .store-btn').length>2,null,{timeout:120000}); await login(A.page,'F02',nm(g4));
out.g4_after_reload=await openUpsell(A.page,'F02');
await A.ctx.close();
// 2) GM on another device views F01
let B=await open('gm'); await login(B.page, 'OFFICE', D.login.gm).catch(async e=>{ out.gmLoginErr=String(e).slice(0,200); });
out.gm_view_F01=await openUpsell(B.page,'F02');
// GM checks item 3 and saves
await B.page.evaluate(()=>{ const cs=[...document.querySelectorAll('.kpi-upsell')]; cs[2].checked=true; });
await B.page.click('[onclick^="saveUpsellGuids"]'); await sleep(4000);
out.gm_after_save=await openUpsell(B.page,'F02');
out.cloud2=await cloud(B.page);
out.upsellRateF01=await B.page.evaluate(()=>{ try{ var c=getKpiConfigFor('F02'); return {forF01:c.upsellGuids, override:c.storeOverride}; }catch(e){return String(e);} });
out.errors=[...A.errors,...B.errors];
await B.ctx.close();
const res=[]; const ok=(n,c,i)=>{ res.push({n,ok:!!c}); console.log((c?'OK  ':'NG  ')+n+(i!==undefined?'  '+JSON.stringify(i):'')); };
ok('① 店（G3）が選んだ 2 つ', out.g4_pick.length===2);
ok('②③ 店ごとの設定としてクラウドに入る', JSON.stringify((out.cloud1.byStore||{}).F02)===JSON.stringify(out.g4_pick), out.cloud1);
ok('④ 読み込み直しても残る', out.g4_after_reload.checked.length===2);
ok('本部（GM）が同じ店を開くと店の設定を見る', JSON.stringify(out.gm_view_F01.checked)===JSON.stringify(out.g4_pick), out.gm_view_F01.checked);
ok('本部の保存は店の設定に入る（全店共通は変えない）', (out.cloud2.byStore||{}).F02 && out.cloud2.byStore.F02.length===3 && !out.cloud2.top, out.cloud2);
ok('その店で使う選択も同じ', out.upsellRateF01.forF01.length===3);
ok('pageerror 0', !out.errors.length, out.errors);
if(process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({out,res},null,1));
process.exit(res.every(r=>r.ok)?0:1);
