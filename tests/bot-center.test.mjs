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
  const ctx={curRole:'office',curLang:'en',curUserName:'Test Reviewer',Date,console,
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
  const html=ctx.renderBotCenter(); assert.match(html,/Very short shift/);assert.doesNotMatch(html,/<img src=x/);
  ctx.botOpenDraft(0,'en'); assert.match(ctx.modal,/correct it in Toast/);assert.match(ctx.modal,/&lt;img/);
  ctx.botOpenDraft(0,'ja'); assert.match(ctx.modal,/Toastで修正/);
  ctx.curLang='ja';assert.match(ctx.renderBotCenter(),/極端に短い/);
});
test('missing input and manual adjustments are explicit; no correction completion action',()=>{
  const empty=context();empty.botScan();assert.equal(empty._botView.missing.length,1);
  assert.match(empty.renderBotCenter(),/Data not loaded or no shifts recorded/);
  const ctx=context({Synthetic:{shifts:[sh('09:00','09:08')]}});
  ctx.getAttOverride=()=>({data:{Synthetic:{}}});ctx.botScan();
  assert.equal(ctx._botView.overrides.length,1);ctx.botOpenDraft(0,'en');assert.match(ctx.modal,/manual adjustment/);
});
test('direct access denied for store staff; dates bounded to previous day and 31 days',()=>{
  const ctx=context({Synthetic:{shifts:[sh('09:00','09:08')]}});
  ctx.curRole='crew';ctx.botScan();assert.equal(ctx._botView.scanned,false);
  assert.doesNotMatch(ctx.renderBotCenter(),/Synthetic/);
  assert.throws(()=>ctx.botDays('2026-02-30','2026-03-01'));
  assert.throws(()=>ctx.botDays('2026-01-01','2026-02-01'));
  assert.throws(()=>ctx.botDays('2099-01-01','2099-01-01'));
  assert.equal(ctx.botDays('2026-08-01','2026-08-31').length,31);
});
