// v1067: fixes for the Codex review of PR #43 (6447442) — R1 pay history merged row by row, R2 confirming only after re-reading
// the other devices' latest evaluations, R3 missing cost/attendance data is "missing" (not a 0% result), R4 the confirmed record
// keeps the evaluation evidence and comments. Runs the real code from index.html in a VM with the synthetic company of
// tests/karte-eval.test.mjs (fictional staff and numbers). No network, no browser storage, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = process.env.FUNERGY_INDEX || new URL('../index.html', import.meta.url).pathname;
let fixture = fs.readFileSync(new URL('./karte-eval.test.mjs', import.meta.url), 'utf8').split("test('the fictional company")[0];
fixture = fixture.replace(/const file = .*?;/, 'const file = ' + JSON.stringify(index) + ';');
const { company, fn, person, Q } = await import('data:text/javascript;base64,' + Buffer.from(
  fixture + '\nexport { company, fn, person, Q };\n').toString('base64'));
const J = x => JSON.parse(JSON.stringify(x));
const call = (c, code) => vm.runInContext(code, c);                         // raw value (Promises stay Promises)
const run = (c, code) => { const v = call(c, code); return v === undefined ? v : J(v); };
const install = (c, ...names) => vm.runInContext(names.map(fn).join('\n'), c);
const clock = (c, n) => vm.runInContext('Date.now = () => ' + n, c);
const lastToast = c => (c.TOASTS.at(-1) || [''])[0];

/* ------------------------------------------------------------------ R1 ------------------------------------------------------------------ */
// A device records the bonus; the record goes to B. Both start from the same karte.
function recorded(at = 1000) {
  const a = company();
  install(a, 'saveKarte', 'kartePayAdd', 'kartePaySet', 'kartePayDel', '_coversMapByTime');
  a.openKarteDetail = () => {};
  clock(a, at);
  run(a, `bqLockQuarter('${Q}'); bonusConfirmQuarter();`);
  return a;
}
function peer(from) {
  const b = company();
  install(b, 'saveKarte', 'kartePayAdd', 'kartePaySet', 'kartePayDel', '_coversMapByTime');
  b.STORE.growth_karte = J(from.STORE.growth_karte); b.STORE.bonus_q = J(from.STORE.bonus_q);
  return b;
}
const merge = (c, cloud, local) => { c.M1 = cloud; c.M2 = local; return run(c, 'mergeMapByTime(M1, M2)'); };
const autoRows = (rec, q = Q) => (rec.payLog || []).filter(p => p.src === 'auto' && p.quarter === q);

test('R1: a stale device saving another field does not remove the recorded bonus (both merge directions)', () => {
  const a = recorded(1000), b = company();
  install(b, 'saveKarte', '_coversMapByTime');
  clock(b, 2000);
  run(b, "var k=getKarte('ken'); k.note='Synthetic meeting note'; saveKarte('ken', k);");
  for (const [cloud, local] of [[a.STORE.growth_karte, b.STORE.growth_karte], [b.STORE.growth_karte, a.STORE.growth_karte]]) {
    const m = merge(b, cloud, local);
    assert.equal(autoRows(m.ken).length, 1, 'the history line survives');
    assert.equal(m.ken.payLog[0].amount, a.STORE.growth_karte.ken.payLog[0].amount);
    assert.equal(m.ken.note, 'Synthetic meeting note', 'the newer edit of the other field also survives');
  }
  // identical copies merge to the same content (nothing is duplicated or dropped)
  assert.deepEqual(merge(b, a.STORE.growth_karte, J(a.STORE.growth_karte)), J(a.STORE.growth_karte));
  // the check after writing to the cloud: a cloud copy as new as ours but without the line is not "covering"
  const W = merge(b, a.STORE.growth_karte, b.STORE.growth_karte), H = J(W);
  H.ken.payLog = [];
  b.W = W; b.H = H;
  assert.equal(call(b, '_coversMapByTime(H, W)'), true, 'the record-level check alone would accept it');
  assert.equal(call(b, 'kartePayCoversMap(H, W)'), false);
  assert.equal(call(b, 'kartePayCoversMap(W, W)'), true);
  assert.equal(call(b, 'kartePayCoversMap(W, H)'), true);
  // a cloud copy that deleted the line later covers it; one without the delete mark does not cover a delete
  const D = J(W); D.ken.payLog = []; D.ken.payDel = { [W.ken.payLog[0].id]: 9e12 }; b.D = D;
  assert.equal(call(b, 'kartePayCoversMap(D, W)'), true);
  assert.equal(call(b, 'kartePayCoversMap(W, D)'), false);
});

test('R1: a deleted line stays deleted against a stale copy; re-recording after the delete is kept', () => {
  const a = recorded(1000), b = peer(a);
  const p1 = a.STORE.growth_karte.mia.payLog[0].id;
  clock(a, 3000); run(a, `kartePayDel('mia', '${p1}')`);
  assert.equal(a.STORE.growth_karte.mia.payLog.length, 0);
  assert.equal(a.STORE.growth_karte.mia.payDel[p1], 3000);
  clock(b, 4000); run(b, "var k=getKarte('mia'); k.note='later edit'; saveKarte('mia', k);");   // stale B still holds p1
  let m = merge(b, a.STORE.growth_karte, b.STORE.growth_karte);
  assert.equal(m.mia.payLog.length, 0, 'the stale copy does not bring the deleted line back');
  assert.equal(m.mia.payDel[p1], 3000);
  assert.equal(m.mia.note, 'later edit');
  m = merge(b, b.STORE.growth_karte, a.STORE.growth_karte);
  assert.equal(m.mia.payLog.length, 0, 'same from the other side');
  // A records the quarter again after deleting: a new line, kept against the stale copy
  clock(a, 5000); run(a, "bonusConfirmOne('mia')");
  const p2 = autoRows(a.STORE.growth_karte.mia)[0];
  assert.notEqual(p2.id, p1);
  m = merge(b, a.STORE.growth_karte, b.STORE.growth_karte);
  assert.deepEqual(autoRows(m.mia).map(p => p.id), [p2.id]);
  // the stale device itself records again after A's delete (newer than the delete): its line is kept
  const c = peer(recorded(1000));
  const q1 = c.STORE.growth_karte.mia.payLog[0].id;
  const a2 = peer(c); clock(a2, 3000); run(a2, `kartePayDel('mia', '${q1}')`);
  clock(c, 6000); run(c, "bonusConfirmOne('mia')");
  m = merge(c, a2.STORE.growth_karte, c.STORE.growth_karte);
  assert.deepEqual(autoRows(m.mia).map(p => [p.id, p._at]), [[q1, 6000]]);
  // ... and a re-record made before the delete (not yet seen by the deleting device) loses to the delete
  const r0 = recorded(1000), c2 = peer(r0), a3 = peer(r0), x1 = r0.STORE.growth_karte.mia.payLog[0].id;
  clock(c2, 2500); run(c2, "bonusConfirmOne('mia')");
  clock(a3, 3000); run(a3, `kartePayDel('mia', '${x1}')`);
  m = merge(c2, a3.STORE.growth_karte, c2.STORE.growth_karte);
  assert.equal(autoRows(m.mia).length, 0);
});

test('R1: hand-entered lines merge one by one; an edit wins by its own time; two devices recording the same quarter keep one line', () => {
  const a = recorded(1000), b = peer(a);
  clock(a, 2000); run(a, "kartePayAdd('ken')");
  const add = a.STORE.growth_karte.ken.payLog.at(-1);
  clock(b, 2500); run(b, "kartePayAdd('ken')");
  const addB = b.STORE.growth_karte.ken.payLog.at(-1);
  let m = merge(a, a.STORE.growth_karte, b.STORE.growth_karte);
  assert.deepEqual(m.ken.payLog.map(p => p.id).sort(), [a.STORE.growth_karte.ken.payLog[0].id, add.id, addB.id].sort(), 'lines added on both devices are all kept');
  // both devices edit the same line: the later edit wins even when that record is older
  b.STORE.growth_karte = m; a.STORE.growth_karte = J(m);
  clock(a, 3000); run(a, `kartePaySet('ken', '${add.id}', 'amount', '120')`);
  clock(b, 3500); run(b, `kartePaySet('ken', '${add.id}', 'note', 'B note')`);
  clock(a, 4000); run(a, "var k=getKarte('ken'); k.note='A later'; saveKarte('ken', k);");
  m = merge(a, b.STORE.growth_karte, a.STORE.growth_karte);
  const line = m.ken.payLog.find(p => p.id === add.id);
  assert.deepEqual([line.amount, line.note], ['', 'B note'], 'the line takes the later line edit (B) — lines are whole, not field by field');
  assert.equal(m.ken.note, 'A later');
  // the first recording of a quarter made on two devices at once: one line, the newer
  const x = company(), y = company();
  clock(x, 1000); run(x, `bqLockQuarter('${Q}'); bonusConfirmQuarter();`);
  clock(y, 1500); run(y, `bqLockQuarter('${Q}'); bonusConfirmQuarter();`);
  m = merge(x, x.STORE.growth_karte, y.STORE.growth_karte);
  assert.equal(autoRows(m.ken).length, 1);
  assert.equal(autoRows(m.ken)[0].id, y.STORE.growth_karte.ken.payLog[0].id);
  m = merge(x, y.STORE.growth_karte, x.STORE.growth_karte);
  assert.equal(autoRows(m.ken)[0].id, y.STORE.growth_karte.ken.payLog[0].id);
  // two lines already in one device's copy (an older state) are left as they are
  const two = J(x.STORE.growth_karte); two.ken.payLog.push(Object.assign({}, two.ken.payLog[0], { id: 'p-older-dup' }));
  assert.equal(autoRows(merge(x, two, J(two)).ken).length, 2);
});

test('R1: the cloud sync of growth_karte uses this merge and the row-by-row check after writing', () => {
  const src = fs.readFileSync(index, 'utf8');   // (assert.ok: do not print the whole page on failure)
  assert.ok(/\n\s*growth_karte:\s*\{\s*merge:\s*mergeMapByTime,\s*covers:\s*kartePayCoversMap\s*\}/.test(src), 'OP_MERGE.growth_karte must be { merge: mergeMapByTime, covers: kartePayCoversMap }');
});

test('R1 + P2-1: copies written by an older version: rows before tracking follow the newer record (as before); rows after tracking are kept', () => {
  const b = company();
  const m1 = { id: 'm1', type: 'ボーナス', amount: '50', date: '2026-07-01', note: '' };
  const auto = { id: 'p-auto', type: 'ボーナス', amount: '2615', src: 'auto', quarter: Q, at: '2026-10-11T20:40:00.000Z' };
  const mine = { ken: { _at: 5000, payTrack: 4000, payLog: [J(m1), J(auto)] } };
  // an older device (v1065/v1066) saved last and never received a tracked copy: as before, the newer record decides
  const older = { ken: { _at: 9000, note: 'older device', payLog: [J(m1)] } };
  for (const [x, y] of [[older, mine], [mine, older]]) {
    const m = merge(b, x, y);
    assert.deepEqual(m.ken.payLog.map(p => p.id), ['m1'], 'old behavior: a line the newer untracked record lacks is not brought back');
    assert.equal(m.ken.note, 'older device');
    assert.equal(m.ken.payTrack, 4000, 'the tracking start passes on (the larger of the two)');
  }
  // an older device that had received a tracked copy keeps payTrack when it saves (it keeps fields it does not know): a line recorded after tracking is kept
  const older2 = { ken: { _at: 9000, payTrack: 4000, note: 'older device', payLog: [J(m1)] } };
  for (const [x, y] of [[older2, mine], [mine, older2]]) assert.deepEqual(merge(b, x, y).ken.payLog.map(p => p.id).sort(), ['m1', 'p-auto']);
  // a line without a time: the newer record decides, as before
  const o2 = J(older2); o2.ken.payLog[0].amount = '60';
  assert.equal(merge(b, mine, o2).ken.payLog.find(p => p.id === 'm1').amount, '60');
  // a row of an unexpected shape in the newer record is kept (not dropped, no error)
  const odd = { ken: { _at: 9500, payLog: ['legacy text row', J(m1)] } };
  assert.deepEqual(merge(b, mine, odd).ken.payLog.map(p => (typeof p === 'string' ? p : p.id)), ['legacy text row', 'm1']);
  // other keys that use the same merge are unchanged (no payLog)
  assert.deepEqual(merge(b, { x: { v: 1, _at: 2 } }, { x: { v: 2, _at: 1 } }), { x: { v: 1, _at: 2 } });
});

/* ------------------------------------------------------------------ R2 ------------------------------------------------------------------ */
// A cloud shared by the devices, read through a pullOpKey that merges like the app (bonus_eval* with kevMergeMap, the quarter record newest-wins).
// The fixture's evaluations have no per-field times (_t); records written by v1065+ always have them. Give every field time 1
// (and the matching "seen when done" times) so that merging behaves as it does between real devices.
function stampFixture(c) {
  const META = ['_at', '_t', 'at', 'by', 'st', 'doneAt', 'doneBy', 'doneT', '_deleted'];
  for (const rec of Object.values(c.STORE.bonus_eval)) {
    const t = {};
    for (const [k, v] of Object.entries(rec)) {
      if (META.includes(k)) continue;
      if (v && typeof v === 'object') for (const f of Object.keys(v)) t[k + '.' + f] = 1; else t[k] = 1;
    }
    rec.doneT = Object.assign({}, t); t.st = 1; rec._t = t;
  }
}
function cloudDevice(cloud, opts = {}) {
  const c = company();
  stampFixture(c);
  c.CLOUD = cloud; c.PULLED = []; c.PUSHED = []; c.OUTBOX = []; c.PULL_FAIL = false; c.PUSH_OK = true;
  vm.runInContext(`
    var SUPA_SYNC_ENABLED = true;
    function _lsRaw(key, d){ if(String(key).indexOf('spl_bonus_q_')===0){ var m=ls('bonus_q', {}); var q=String(key).slice(12); return (q in m) ? m[q] : d; } return ls(key, d); }
    function pullOpKey(key){
      PULLED.push(key);
      return new Promise(function(res){ Promise.resolve().then(function(){
        if(PULL_FAIL===true || PULL_FAIL===key){ res(false); return; }
        var v=CLOUD[key]; if(v===undefined){ res(true); return; }
        v=JSON.parse(JSON.stringify(v));
        if(String(key).indexOf('spl_bonus_q_')===0){ var m=ls('bonus_q', {}), q=String(key).slice(12), cur=m[q]; if(!cur || (Number(v._at)||0)>(Number(cur._at)||0)) m[q]=v; lsSet('bonus_q', m); }
        else if(key==='bonus_eval' || key==='bonus_eval_rule' || key==='bonus_eval_ovr') lsSet(key, kevMergeMap(v, ls(key, {})));
        else if(key==='karte_bonus_config' && typeof mergeStamped==='function') lsSet(key, mergeStamped(v, ls(key, null)));
        else lsSet(key, v);
        res(true);
      }); });
    }
    function opMergePush(key, val){ PUSHED.push([key, JSON.parse(JSON.stringify(val))]); if(PUSH_OK) CLOUD[key]=JSON.parse(JSON.stringify(val)); return Promise.resolve(PUSH_OK); }
    function _outboxAdd(key, why){ OUTBOX.push([key, why]); }`, c);
  if (opts.clock) clock(c, opts.clock);
  return c;
}
const publish = (dev, cloud) => { cloud.bonus_eval = J(dev.STORE.bonus_eval); cloud['spl_bonus_q_' + Q] = J(dev.STORE.bonus_q[Q]); };

test('R2: a device that has not received a re-completed evaluation does not confirm; after re-reading it shows the new content and confirms on the next press', async () => {
  const cloud = {}, a = cloudDevice(cloud, { clock: 1000 }), b = cloudDevice(cloud, { clock: 2000 });
  const oldAmount = person(b, 'ken').amount;
  run(a, `kevEvEdit('ken','G3','ab.lv',5,'${Q}'); kevDone('ken','G3','${Q}');`);
  const latest = person(a, 'ken').amount;
  assert.notEqual(latest, oldAmount);
  publish(a, cloud);
  const p = call(b, `bqLockQuarter('${Q}')`);
  assert.equal(typeof p.then, 'function', 'confirming waits for the re-read');
  assert.equal(await p, false);
  assert.ok(!b.STORE.bonus_q[Q].locked, 'not confirmed with the old evaluation');
  assert.match(lastToast(b), /ほかの端末で評価・設定・原資などが変わっていたため、確定していません/);
  assert.ok(['bonus_eval', 'bonus_eval_rule', 'bonus_eval_ovr', 'spl_bonus_q_' + Q, 'bonus_rules', 'bonus_coef_rng', 'bonus_track', 'grade_hist'].every(k => b.PULLED.includes(k)));
  assert.ok(b.PULLED.includes('lss_emp_Ken Sample'), 'the members\' Career Scores are re-read too');
  assert.equal(b.STORE.bonus_eval[`${Q}|ken|G3`].ab.lv, 5, 'the screen now has the newer evaluation');
  assert.equal(person(b, 'ken').amount, latest);
  assert.equal(b.PUSHED.length, 0);
  // pressing again (nothing new elsewhere): confirmed with the latest evaluation, and sent to the cloud right away
  assert.equal(await call(b, `bqLockQuarter('${Q}')`), true);
  const d = b.STORE.bonus_q[Q];
  assert.equal(d.locked, true);
  assert.equal(d.evSnap.people.ken.raw, latest);
  assert.equal(person(b, 'ken').amount, latest);
  assert.deepEqual(b.PUSHED.map(x => x[0]), ['spl_bonus_q_' + Q]);
  assert.equal(b.PUSHED[0][1].locked, true);
  assert.match(lastToast(b), /査定を確定しました（クラウドにも保存/);
});

test('R2: offline, sync off, or a failed re-read: nothing is confirmed', async () => {
  const cloud = {};
  const off = cloudDevice(cloud); off.navigator = { onLine: false };
  assert.equal(call(off, `bqLockQuarter('${Q}')`), false);
  assert.ok(!off.STORE.bonus_q[Q].locked);
  assert.match(lastToast(off), /オフラインのため確定していません/);
  assert.equal(off.PULLED.length, 0);
  const noSync = cloudDevice(cloud); vm.runInContext('SUPA_SYNC_ENABLED = false;', noSync);
  assert.equal(call(noSync, `bqLockQuarter('${Q}')`), false);
  assert.ok(!noSync.STORE.bonus_q[Q].locked);
  assert.match(lastToast(noSync), /クラウド同期が OFF のため確定していません/);
  for (const fail of [true, 'bonus_eval', 'spl_bonus_q_' + Q, 'lss_emp_Mia Sample']) {
    const f = cloudDevice(cloud); f.PULL_FAIL = fail;
    assert.equal(await call(f, `bqLockQuarter('${Q}')`), false, 'pull failure: ' + fail);
    assert.ok(!f.STORE.bonus_q[Q].locked);
    assert.match(lastToast(f), /クラウドから最新の内容を読めなかったため、確定していません/);
    assert.equal(f.PUSHED.length, 0);
  }
  // the user cancelling the dialog: nothing is read or written
  const no = cloudDevice(cloud); no.CONFIRM = false;
  assert.equal(call(no, `bqLockQuarter('${Q}')`), false);
  assert.equal(no.PULLED.length, 0);
});

test('R2: unchanged content confirms; a second press while checking is refused; a send failure is queued and shown', async () => {
  const cloud = {}, b = cloudDevice(cloud);
  publish(b, cloud);   // the cloud has the same content
  const before = person(b, 'mia').amount;
  const p1 = call(b, `bqLockQuarter('${Q}')`);
  assert.equal(call(b, `bqLockQuarter('${Q}')`), false, 'pressing again while the first is checking');
  assert.match(lastToast(b), /確定の前の確認をしています/);
  assert.equal(await p1, true);
  assert.equal(b.STORE.bonus_q[Q].locked, true);
  assert.equal(person(b, 'mia').amount, before);
  assert.equal(b.PUSHED.length, 1);
  // a send failure: the confirmation stays on this device, is queued, and the screen says it was not sent
  const c = cloudDevice({}); c.PUSH_OK = false;
  assert.equal(await call(c, `bqLockQuarter('${Q}')`), true);
  assert.equal(c.STORE.bonus_q[Q].locked, true);
  assert.deepEqual(J(c.OUTBOX), [['spl_bonus_q_' + Q, 'push failed']]);
  assert.match(lastToast(c), /クラウドへはまだ送れていません/);
  // the commit itself refuses content that no longer matches what was shown
  const s = cloudDevice({});
  assert.equal(call(s, `kevLockCommit('${Q}', 'a digest of something else', false)`), false);
  assert.ok(!s.STORE.bonus_q[Q].locked);
  assert.equal(call(s, `kevLockCommit('${Q}', kevLockDigest('${Q}'), false)`), true);
});

test('R2: a profit or settings change on another device, or a confirmation there, stops this confirmation', async () => {
  const cloud = {}, a = cloudDevice(cloud, { clock: 1000 }), b = cloudDevice(cloud, { clock: 500 });
  // another device corrects one month's profit (④ is reflected for Sam, G5)
  a.STORE.bonus_q[Q].profit.S3['2026-09'] = { a: 20000, t: 33334 }; a.STORE.bonus_q[Q]._at = 1000;
  publish(a, cloud);
  assert.equal(await call(b, `bqLockQuarter('${Q}')`), false);
  assert.match(lastToast(b), /変わっていたため、確定していません/);
  assert.equal(b.STORE.bonus_q[Q].profit.S3['2026-09'].a, 20000);
  // only a reason text changed elsewhere (no amount moves): still not confirmed with the old text
  const cloudT = {}, t1 = cloudDevice(cloudT, { clock: 1500 }), t2 = cloudDevice(cloudT, { clock: 700 });
  const amounts = J(call(t2, 'bonusTotals(kbCfg()).finals'));
  run(t1, `kevTxt('ken','G3','ab.ev','A newer reason written on another device','${Q}'); kevDone('ken','G3','${Q}');`);
  assert.deepEqual(J(call(t1, 'bonusTotals(kbCfg()).finals')), amounts);
  publish(t1, cloudT);
  assert.equal(await call(t2, `bqLockQuarter('${Q}')`), false);
  assert.match(lastToast(t2), /変わっていたため、確定していません/);
  assert.equal(await call(t2, `bqLockQuarter('${Q}')`), true);
  assert.equal(t2.STORE.bonus_q[Q].evSnap.people.ken.segs[0].ev.ab.ev, 'A newer reason written on another device');
  // a personal setting changed elsewhere
  const cloud2 = {}, x = cloudDevice(cloud2, { clock: 3000 }), y = cloudDevice(cloud2, { clock: 100 });
  x.STORE.bonus_eval_ovr['mia|2026-Q3'] = { set: { s: { on: false } }, why: 'test', at: '2026/10/11 11:00', by: 'GM', _at: 3000, _t: { s: 3000 } };
  cloud2.bonus_eval_ovr = J(x.STORE.bonus_eval_ovr);
  assert.equal(await call(y, `bqLockQuarter('${Q}')`), false);
  assert.ok(!y.STORE.bonus_q[Q].locked);
  // another device already confirmed the quarter
  const cloud3 = {}, m = cloudDevice(cloud3, { clock: 1000 }), n = cloudDevice(cloud3, { clock: 500 });
  assert.equal(await call(m, `bqLockQuarter('${Q}')`), true);
  assert.equal(cloud3['spl_bonus_q_' + Q].locked, true);
  assert.equal(await call(n, `bqLockQuarter('${Q}')`), false);
  assert.match(lastToast(n), /ほかの端末で、2026-Q3 の査定がすでに確定されています/);
  assert.equal(n.STORE.bonus_q[Q].evSnap.lk, cloud3['spl_bonus_q_' + Q].evSnap.lk, 'the other device\'s confirmation is now shown');
  assert.equal(n.PUSHED.length, 0);
});

/* ------------------------------------------------------------------ R3 ------------------------------------------------------------------ */
test('R3: a store-month without purchases/inventory or attendance is "missing" while ③ uses the result; not when the result weight is 0 or ③ is fixed', () => {
  const c = company();
  vm.runInContext("STORES.S2.noCost = ['2026-08'];", c);
  let mia = person(c, 'mia');
  assert.equal(mia.blocked, 'eval');
  assert.equal(mia.segs[0].items.f.food.res.actual, null, 'not taken as a 0% cost rate');
  assert.match(mia.missing.join(), /Food の結果：実績が未取得（Store 2 8月：仕入れ・棚卸の記録が無い）/);
  assert.match(run(c, 'kevLockProblems(bonusTotals(kbCfg())).join()'), /Mia Sample：.*Store 2 8月：仕入れ・棚卸の記録が無い/);
  run(c, `bqLockQuarter('${Q}')`);
  assert.ok(!c.STORE.bonus_q[Q].locked, 'not confirmed while it is missing');
  // attendance not loaded for a month
  const c2 = company();
  vm.runInContext("STORES.S2.noLabor = ['2026-07','2026-08','2026-09'];", c2);
  mia = person(c2, 'mia');
  assert.equal(mia.blocked, 'eval');
  assert.match(mia.missing.join(), /Labor の結果：実績が未取得（Store 2 7・8・9月：売上のある日に勤怠が未取得の日がある）/);
  // ③ with the result weight 0: the action alone decides, nothing blocks (as before)
  c.STORE.bonus_eval_ovr['mia|2026-Q3'] = { set: { fl: { aw: 100, rw: 0 } }, why: 'test', _at: 1 };
  mia = person(c, 'mia');
  assert.equal(mia.blocked, null);
  assert.equal(mia.segs[0].items.f.score.toFixed(1), '62.5');
  // ③ fixed at 1.00 (G5 Sam): evaluated only, the missing month is shown but does not block
  vm.runInContext("STORES.S3.noCost = ['2026-09'];", c);
  const sam = person(c, 'sam');
  assert.equal(sam.blocked, null);
  assert.equal(sam.segs[0].items.f.on, false);
  assert.match(sam.segs[0].items.f.miss.join(), /Store 3 9月：仕入れ・棚卸の記録が無い/);
});

// The real PL / food cost / labor functions with synthetic sources (no purchases, attendance only on some days, …)
function realPl(c, src) {
  install(c, 'plComputeStore', 'foodCostOf', '_laborCoreForYmRaw', 'laborWeekDays', 'laborMonthWeeks', 'laborWeekRange', '_laborHrs', 'isoLocalDate', 'isoOf');
  c.SRC = src;
  vm.runInContext(`
    var PL_VC_CATS = [], PL_FIX_CATS = [], PAYROLL_TAX_RATE = 0.17;
    function getPlConfig(){ return {vcAvg:{}, fixed:{}, getRate:4.712}; }
    function getPlOverrides(){ return {}; }
    function getFcMonthly(sid, ym){ return (SRC.inv && SRC.inv[sid+'|'+ym]) || {}; }
    function monthInvoiceCostYm(sid, ym){ return (SRC.invoice && SRC.invoice[sid+'|'+ym]) || 0; }
    function monthPurchaseCostYm(sid, ym){ return (SRC.buy && SRC.buy[sid+'|'+ym]) || 0; }
    function monthTransferNetYm(){ return {inAmt:0,outAmt:0,net:0}; }
    function plReimburseTotal(){ return 0; }
    function laborCoreForYm(s, ym){ return _laborCoreForYmRaw(s, ym); }
    function curYm(){ return '2026-10'; }
    function getTipLabor(sid, dt){ var v=SRC.labor && SRC.labor[sid+'|'+dt]; return v===undefined ? null : v; }
    function laborForEmployee(n, x){ return {total:(x.regular+x.ot*1.5)*20}; }
    function storeMonthlyStaff(){ return []; }
    function daysInMonthOf(ym){ return new Date(+ym.slice(0,4),+ym.slice(5),0).getDate(); }
    function daysOfYm(ym){ return Array.from({length:daysInMonthOf(ym)},(_,i)=>({date:ym+'-'+String(i+1).padStart(2,'0')})); }
    function _daRO(sid){ return (SRC.acts && SRC.acts[sid]) || {}; }
    function isFrozenMonth(){ return false; }`, c);
}
const daysOf = ym => Array.from({ length: new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate() }, (_, i) => ym + '-' + String(i + 1).padStart(2, '0'));

test('R3: the real PL tells "no data" from a real 0 — invoices or an end inventory make cost data; attendance must exist on every sales day', () => {
  const c = company();
  const acts = {}, labor = {};
  for (const ym of ['2026-07', '2026-08', '2026-09']) for (const dt of daysOf(ym)) {
    acts[dt] = { actual: 10000 };
    labor['S2|' + dt] = { 'Neo Sample': { rawLunch: 4, rawDinner: 4 } };
  }
  const src = { acts: { S2: acts }, labor, invoice: { 'S2|2026-07': 90000, 'S2|2026-08': 91000 }, inv: { 'S2|2026-09': { beginInv: 5000, endInv: 5000 } } };
  realPl(c, src);
  let pl = run(c, "plComputeStore('S2','2026-09',-1)");
  assert.deepEqual([pl.cogs, pl.cogsHas], [0, true], 'an end inventory with no purchases is a confirmed cost (here 0)');
  assert.equal(pl.laborHas, true);
  assert.deepEqual(run(c, "[plComputeStore('S2','2026-07',-3).cogsHas, plComputeStore('S2','2026-08',-2).cogsHas]"), [true, true]);
  assert.equal(person(c, 'mia').blocked, null, 'all data present: the FL result is computed');
  // a fetched day with nobody clocked in is a record (a real 0), not a gap
  labor['S2|2026-09-05'] = {};
  assert.equal(run(c, "plComputeStore('S2','2026-09',-1).laborHas"), true);
  // a sales day whose attendance was never fetched is a gap
  delete labor['S2|2026-09-06'];
  pl = run(c, "plComputeStore('S2','2026-09',-1)");
  assert.deepEqual([pl.laborHas, pl.laborMissDays], [false, ['2026-09-06']]);
  // … but a day without sales (closed) needs no attendance
  labor['S2|2026-09-06'] = { 'Neo Sample': { rawLunch: 4, rawDinner: 4 } };
  delete labor['S2|2026-09-07']; acts['2026-09-07'] = { actual: 0 };
  assert.equal(run(c, "plComputeStore('S2','2026-09',-1).laborHas"), true);
  // a hand-entered labor amount on a day without Toast attendance counts as a record
  delete labor['S2|2026-09-08']; acts['2026-09-08'] = { actual: 10000, labor: 900 };
  assert.equal(run(c, "plComputeStore('S2','2026-09',-1).laborHas"), true);
  // no purchases, no inventory: missing (the amounts and the PL screen numbers are unchanged — still 0)
  delete src.inv['S2|2026-09'];
  pl = run(c, "plComputeStore('S2','2026-09',-1)");
  assert.deepEqual([pl.cogs, pl.cogsHas], [0, false]);
  const mia = person(c, 'mia');
  assert.equal(mia.blocked, 'eval');
  assert.match(mia.missing.join(), /Store 2 9月：仕入れ・棚卸の記録が無い/);
  // a store with no attendance at all
  for (const k of Object.keys(labor)) delete labor[k];
  assert.deepEqual(run(c, "[plComputeStore('S2','2026-07',-3).laborHas, _laborCoreForYmRaw('S2','2026-07').laborDays]"), [false, 0]);
});

/* ------------------------------------------------------------------ R4 ------------------------------------------------------------------ */
test('R4: the confirmed record keeps the reasons, FL actions and comment, who evaluated and when; shown without unlocking (escaped)', () => {
  const c = company();
  const ev = c.STORE.bonus_eval[`${Q}|mia|G4`];
  Object.assign(ev, { cm: 'Comment <b>for Mia</b>', doneAt: '2026/10/10 18:00', doneBy: 'GM Sample', at: '2026/10/10 17:55', by: 'GM Sample' });
  ev.ab.ev = 'Reason & detail'; ev.kn.ev = 'Knowledge note'; ev.qu = { lv: 3, ev: '' };
  Object.assign(ev.fa, { what: 'Changed the order sheet', st: 'fixed', ev: 'Order log', next: 'Next: weekly check', qc: true });
  run(c, `bqLockQuarter('${Q}')`);
  const seg = J(c.STORE.bonus_q[Q].evSnap.people.mia.segs[0]);
  assert.deepEqual(seg.ev.ab, { lv: 4, ev: 'Reason & detail', cm: '' });
  assert.deepEqual(seg.ev.fa, { lv: 4, what: 'Changed the order sheet', st: 'fixed', ev: 'Order log', next: 'Next: weekly check', qc: true, okLow: false });
  assert.deepEqual([seg.ev.cm, seg.ev.doneAt, seg.ev.doneBy, seg.ev.st], ['Comment <b>for Mia</b>', '2026/10/10 18:00', 'GM Sample', 'done']);
  // the draft changes later; the confirmed view keeps what was confirmed
  ev.ab.ev = 'Changed after confirming';
  const html = run(c, 'var b=bonusForEmp(EMPS[3],kbCfg()); kevSnapMainHtml(EMPS[3],b,b.segs[0],kevApplies(kbCfg()))');
  for (const s of ['Reason &amp; detail', 'Knowledge note', 'Changed the order sheet', 'Order log', 'Next: weekly check', '定着', 'Comment &lt;b&gt;for Mia&lt;/b&gt;', 'GM Sample', '2026/10/10 18:00']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('Changed after confirming'));
  assert.ok(!html.includes('<b>for Mia</b>'), 'texts are escaped');
  assert.ok(!html.includes('<textarea'), 'read-only');
  // a quarter confirmed by v1066 (no texts in the record) still shows, and says the texts are not in the record
  delete c.STORE.bonus_q[Q].evSnap.people.mia.segs[0].ev;
  const old = run(c, 'var b=bonusForEmp(EMPS[3],kbCfg()); kevSnapMainHtml(EMPS[3],b,b.segs[0],kevApplies(kbCfg()))');
  assert.match(old, /（確定時の記録に無い）/);
  assert.match(old, /能力 75 点/);
});

/* =========================== independent review of cfa17bb: P2-1 (deleted lines), P2-2 (settings re-read), P2-3 (record from the current lock), P3 =========================== */
const SRC = fs.readFileSync(index, 'utf8').replace(/\r\n/g, '\n');
const varLine = name => { const m = SRC.match(new RegExp('\\nvar ' + name + ' = [^\\n]*')); assert.ok(m, name); return m[0]; };
const row = (id, extra = {}) => Object.assign({ id, type: 'ボーナス', amount: '1', date: '2026-07-01', note: '' }, extra);
const ids = rec => Array.from(rec.payLog || [], p => (typeof p === 'string' ? p : p.id)).sort();   // a plain array of this realm (the cloud copies live in the VM)

/* ------------------------------------------------------------------ P2-1 ------------------------------------------------------------------ */
test('P2-1: a line deleted before tracking does not come back from a stale copy (reviewer A1); after tracking, lines merge as a union', () => {
  const c = company();
  // A1: neither copy has started tracking — the newer record decides, as before v1067
  const cloud = { ken: { _at: 5000, payLog: [row('keep')] } };
  const stale = { ken: { _at: 1000, payLog: [row('keep'), row('x-old')] } };
  for (const [x, y] of [[cloud, stale], [stale, cloud]]) assert.deepEqual(ids(merge(c, x, y).ken), ['keep']);
  // lines only in the newer record always stay
  const newer = { ken: { _at: 6000, payLog: [row('keep'), row('only-newer')] } };
  assert.deepEqual(ids(merge(c, stale, newer).ken), ['keep', 'only-newer']);
  // the newer copy started tracking at 4000: lines older than that stay deleted, a line added after it on the other device is kept
  const cloudT = { ken: { _at: 5000, payTrack: 4000, payLog: [row('keep')] } };
  const staleT = { ken: { _at: 4600, payTrack: 800, payLog: [row('keep'), row('x-old', { _at: 900 }), row('x-auto', { src: 'auto', quarter: '2026-Q2', at: new Date(3000).toISOString() }), row('x-new', { _at: 4500 })] } };
  for (const [x, y] of [[cloudT, staleT], [staleT, cloudT]]) {
    const m = merge(c, x, y);
    assert.deepEqual(ids(m.ken), ['keep', 'x-new']);
    assert.equal(m.ken.payTrack, 4000, 'the larger tracking start');
  }
});

test('P2-1: every writer starts tracking before moving the record time; lines added on two devices are all kept; a delete mark still wins', () => {
  const c = company();
  install(c, 'saveKarte', 'kartePayAdd', 'kartePayDel');
  c.openKarteDetail = () => {};
  c.STORE.growth_karte = { ken: { _at: 700, payLog: [row('m0')] } };   // a record saved before v1067
  clock(c, 2000); run(c, "var k=getKarte('ken'); k.note='n'; saveKarte('ken', k);");
  assert.deepEqual([c.STORE.growth_karte.ken.payTrack, c.STORE.growth_karte.ken._at], [700, 2000], 'tracking starts at the previous record time');
  clock(c, 3000); run(c, "var k=getKarte('ken'); k.note='n2'; saveKarte('ken', k);");
  assert.equal(c.STORE.growth_karte.ken.payTrack, 700, 'and does not move afterwards');
  clock(c, 3500); run(c, "saveKarte('neo', {note:'first'})");
  assert.equal(c.STORE.growth_karte.neo.payTrack, 1, 'a new record tracks everything');
  // the bonus record (_bonusWritePay) writes the record itself
  const r = company();
  r.STORE.growth_karte = { ken: { _at: 800, payLog: [row('m0')] } };
  clock(r, 1000); run(r, `bqLockQuarter('${Q}'); bonusConfirmQuarter();`);
  assert.deepEqual([r.STORE.growth_karte.ken.payTrack, r.STORE.growth_karte.mia.payTrack], [800, 1]);
  // the grade-history import writes the record itself too: it starts tracking before moving _at, and its lines carry a time
  assert.match(fn('ghImpRun'), /kartePayTrackInit\(k\);[^\n]*\n\s*k\.updatedAt=new Date\(\)\.toISOString\(\); k\._at=Date\.now\(\);/);
  assert.match(fn('ghImpRun'), /src:'import', _at:Date\.now\(\)\}/);
  // two devices add lines to the same record (tracked from 700): all kept, both directions
  const a = company(), b = company();
  for (const d of [a, b]) { install(d, 'saveKarte', 'kartePayAdd', 'kartePayDel'); d.openKarteDetail = () => {}; d.STORE.growth_karte = J(c.STORE.growth_karte); }
  clock(a, 4000); run(a, "kartePayAdd('ken')");
  clock(b, 4500); run(b, "kartePayAdd('ken')");
  const ra = a.STORE.growth_karte.ken.payLog.at(-1), rb = b.STORE.growth_karte.ken.payLog.at(-1);
  assert.equal(ra._at, 4000, 'an added line carries its time');
  for (const [x, y] of [[a.STORE.growth_karte, b.STORE.growth_karte], [b.STORE.growth_karte, a.STORE.growth_karte]]) assert.deepEqual(ids(merge(a, x, y).ken), ['m0', ra.id, rb.id].sort());
  // A receives B's line and deletes it; B (stale, still holding it) saves later: the delete mark wins, A's line stays
  a.STORE.growth_karte = merge(a, b.STORE.growth_karte, a.STORE.growth_karte);
  clock(a, 5000); run(a, `kartePayDel('ken', '${rb.id}')`);
  clock(b, 6000); run(b, "var k=getKarte('ken'); k.note='later'; saveKarte('ken', k);");
  for (const [x, y] of [[a.STORE.growth_karte, b.STORE.growth_karte], [b.STORE.growth_karte, a.STORE.growth_karte]]) {
    const m = merge(a, x, y);
    assert.deepEqual(ids(m.ken), ['m0', ra.id].sort());
    assert.equal(m.ken.note, 'later');
  }
});

// The real opMergePush (fetch → merge → write → check → retry) against a fake cloud
function pushDevice() {
  const c = company();
  install(c, 'opMergePush', '_opWriteBack', '_coversMapByTime');
  vm.runInContext(`
    var _opMergeChain = {}, _opLastPushErr = {}, CLOUDV = {}, WRITES = 0, AFTER_WRITE = null;
    function _opMergeDef(){ return { merge: mergeMapByTime, covers: kartePayCoversMap }; }
    function _fetchOpValue(key){ return Promise.resolve(Object.prototype.hasOwnProperty.call(CLOUDV, key) ? JSON.parse(JSON.stringify(CLOUDV[key])) : null); }
    function supaUpsert(t, rows){ WRITES++; CLOUDV[rows[0].key] = JSON.parse(JSON.stringify(rows[0].value)); if(AFTER_WRITE){ var f = AFTER_WRITE; AFTER_WRITE = null; f(); } return Promise.resolve(true); }
    function _opUpsertRow(key, val){ return { key: key, value: val }; }
    function _lsWriteVerified(key, json){ STORE[key] = JSON.parse(json); return true; }
    function _lsRaw(key, d){ return ls(key, d); }`, c);
  return c;
}

test('P2-1: pushing to the cloud converges — a line the merge drops does not keep the push retrying; an older-version copy written meanwhile is merged in', async () => {
  // (1) an older-version device deletes a line from before tracking (no delete mark) and saves right after our write
  const c = pushDevice();
  const local = { ken: { _at: 3000, payTrack: 2000, payLog: [row('p0'), row('x', { _at: 1500 })] } };
  c.STORE.growth_karte = J(local); c.L = J(local);
  c.CLOUDV.growth_karte = { ken: { _at: 2900, payTrack: 2000, payLog: [row('p0'), row('x', { _at: 1500 })] } };
  c.AFTER_WRITE = () => { c.CLOUDV.growth_karte = { ken: { _at: 4000, payTrack: 2000, note: 'old device', payLog: [row('p0')] } }; };
  assert.equal(await call(c, "opMergePush('growth_karte', L)"), true);
  assert.equal(c.WRITES, 1, 'no second write: the merge would drop that line anyway');
  assert.deepEqual(ids(c.CLOUDV.growth_karte.ken), ['p0'], 'the other device\'s delete stays in the cloud');
  const pulled = merge(c, c.CLOUDV.growth_karte, c.STORE.growth_karte);   // the next pull on this device follows the cloud
  assert.deepEqual(ids(pulled.ken), ['p0']);
  c.P = pulled; assert.equal(call(c, 'kartePayCoversMap(CLOUDV.growth_karte, P)'), true);
  // (2) an older-version copy without tracking is written meanwhile: one more round puts the tracking start back
  const d = pushDevice();
  const l2 = { ken: { _at: 3000, payTrack: 2000, payLog: [row('p0'), row('r', { _at: 2500 })] } };
  d.STORE.growth_karte = J(l2); d.L = J(l2);
  d.CLOUDV.growth_karte = { ken: { _at: 2000, payLog: [row('p0')] } };
  d.AFTER_WRITE = () => { d.CLOUDV.growth_karte = { ken: { _at: 4000, note: 'old device', payLog: [row('p0')] } }; };
  assert.equal(await call(d, "opMergePush('growth_karte', L)"), true);
  assert.equal(d.WRITES, 2);
  assert.deepEqual([d.CLOUDV.growth_karte.ken.payTrack, d.CLOUDV.growth_karte.ken.note], [2000, 'old device']);
  // (3) two v1067 devices push in turns to one cloud: lines added on both end up everywhere; another push changes nothing
  const A = pushDevice(), B = pushDevice();
  const base = { ken: { _at: 1000, payTrack: 1, payLog: [row('p0')] } };
  A.STORE.growth_karte = J(base); B.STORE.growth_karte = J(base);
  A.STORE.growth_karte.ken.payLog.push(row('ra', { _at: 2000 })); A.STORE.growth_karte.ken._at = 2000;
  B.STORE.growth_karte.ken.payLog.push(row('rb', { _at: 2500 })); B.STORE.growth_karte.ken._at = 2500;
  B.CLOUDV = A.CLOUDV;
  for (const dev of [A, B, A]) assert.equal(await call(dev, "opMergePush('growth_karte', ls('growth_karte', {}))"), true);
  assert.deepEqual(ids(A.CLOUDV.growth_karte.ken), ['p0', 'ra', 'rb']);
  assert.deepEqual(J(A.STORE.growth_karte), J(A.CLOUDV.growth_karte));
  const before = J(A.CLOUDV.growth_karte), writes = A.WRITES;
  assert.equal(await call(A, "opMergePush('growth_karte', ls('growth_karte', {}))"), true);
  assert.deepEqual(J(A.CLOUDV.growth_karte), before);
  assert.equal(A.WRITES, writes + 1, 'one write, no retry');
  // (4) a record with a tracking start but no lines yet: the start reaches the cloud too (the merge carries it), and the push ends
  const E = pushDevice();
  E.STORE.growth_karte = { ken: { _at: 3000, payTrack: 2000, note: 'n' } }; E.L = J(E.STORE.growth_karte);
  E.CLOUDV.growth_karte = { ken: { _at: 4000, note: 'old device' } };
  E.AFTER_WRITE = () => { E.CLOUDV.growth_karte = { ken: { _at: 5000, note: 'old device again' } }; };   // an older version overwrites it right after our write
  assert.equal(await call(E, "opMergePush('growth_karte', L)"), true);
  assert.equal(E.WRITES, 2, 'the check sees the tracking start missing and writes once more');
  assert.deepEqual([E.CLOUDV.growth_karte.ken.payTrack, E.CLOUDV.growth_karte.ken.note], [2000, 'old device again']);
  // the check after writing follows the merge: a missing line counts as there only when the merge would drop it too
  const k = company(); install(k, '_coversMapByTime');
  const want = { ken: { _at: 3000, payTrack: 2000, payLog: [row('p0'), row('x', { _at: 1500 }), row('y', { _at: 2500 })] } };
  const cov = h => { k.H = h; k.W = want; return call(k, 'kartePayCoversMap(H, W)'); };
  assert.equal(cov({ ken: { _at: 4000, payTrack: 2000, payLog: [row('p0'), row('y', { _at: 2500 })] } }), true, 'newer, tracked: the line from before tracking would be dropped');
  assert.equal(cov({ ken: { _at: 4000, payTrack: 2000, payLog: [row('p0'), row('x', { _at: 1500 })] } }), false, 'a line after tracking would be kept');
  assert.equal(cov({ ken: { _at: 3000, payTrack: 2000, payLog: [row('p0'), row('y', { _at: 2500 })] } }), false, 'same record time: this device wins the merge and keeps the line');
  assert.equal(cov({ ken: { _at: 4000, payTrack: 1000, payLog: [row('p0'), row('y', { _at: 2500 })] } }), false, 'an earlier tracking start in the cloud is raised by the merge');
});

/* ------------------------------------------------------------------ P2-2 ------------------------------------------------------------------ */
// kbCfg of v1066 (main 47c9c72), copied as it was: it reads the fields on top of the stored value
const KBCFG_V1066 = `function kbCfgV1066(){
  var d={ poolRate:0.12, profit:0, quarter:_curQuarter(), gradeBase:{G2:1000,G3:3000,G4:5000,G5:8000,G6:12000}, csMin:0.7, csMax:1.3, storeScore:{}, storeProfit:{}, empStore:{}, spMin:0.8, spMax:1.2, baMin:0.8, baMax:1.2 };
  var r=ls('karte_bonus_config',null);
  if(r && typeof r==='object'){ d=Object.assign(d,r); d.gradeBase=Object.assign({G2:1000,G3:3000,G4:5000,G5:8000,G6:12000}, r.gradeBase||{}); d.storeScore=Object.assign({}, r.storeScore||{}); d.storeProfit=Object.assign({}, r.storeProfit||{}); d.empStore=Object.assign({}, r.empStore||{}); if(d.spMin==null)d.spMin=0.8; if(d.spMax==null)d.spMax=1.2; if(d.baMin==null)d.baMin=0.8; if(d.baMax==null)d.baMax=1.2; }
  return d;
}`;
function cfgInstall(c) {
  install(c, '_stIsWrapped', '_stUnwrap', '_stAt', '_stWrap', 'mergeStamped', '_coversStamped', 'kbCfgPlain', 'kbCfg', 'kbSave');
  vm.runInContext(varLine('KB_ST_META') + `\nfunction _curQuarter(){ return '${Q}'; }\n` + KBCFG_V1066, c);
  return c;
}

test('P2-2: the bonus settings read the same whether stored plain, wrapped by the sync, wrapped with the fields on top, or wrapped twice', () => {
  const c = cfgInstall(company());
  const read = v => { c.STORE.karte_bonus_config = v; return run(c, 'kbCfg()'); };
  let k = read({ gradeBase: { G3: 3500 }, empStore: { ken: ['S2'] }, csMin: 0.6 });   // A: plain
  assert.deepEqual([k.gradeBase.G2, k.gradeBase.G3, k.empStore.ken, k.csMin], [1000, 3500, ['S2'], 0.6]);
  k = read({ __st: 1, v: { gradeBase: { G3: 3500 }, csMin: 0.6 }, _at: 5, _by: '' });   // B: wrapped by the sync merge, nothing on top
  assert.deepEqual([k.gradeBase.G3, k.csMin], [3500, 0.6]);
  assert.equal(run(c, 'kbCfgV1066()').gradeBase.G3, 3000, '(v1066 read the default amount here)');
  k = read({ __st: 1, v: { gradeBase: { G3: 3100 } }, _at: 5, _by: '', gradeBase: { G3: 3500 }, csMin: 0.6 });   // C: wrapped, fields on top
  assert.deepEqual([k.gradeBase.G3, k.csMin], [3500, 0.6], 'the fields on top, as before');
  assert.deepEqual([run(c, 'kbCfgV1066()').gradeBase.G3, run(c, 'kbCfgV1066()').csMin], [3500, 0.6]);
  assert.ok(!('__st' in k) && !('v' in k) && !('_at' in k) && !('_by' in k), 'no wrapper fields in the settings');
  k = read({ __st: 1, v: { __st: 1, v: { gradeBase: { G3: 3600 } }, _at: 3 }, _at: 5 });   // wrapped twice
  assert.equal(k.gradeBase.G3, 3600);
  delete c.STORE.karte_bonus_config;
  assert.equal(run(c, 'kbCfg()').gradeBase.G3, 3000, 'nothing stored: the defaults');
});

test('P2-2: saving keeps the fields on top for older versions; save → push → read keeps the base amounts; the newer save wins', () => {
  const x = cfgInstall(company()), y = cfgInstall(company());
  clock(x, 5000);
  run(x, "var c=kbCfg(); c.gradeBase.G3=3500; c.empStore={ken:['S2']}; kbSave(c);");
  const saved = J(x.STORE.karte_bonus_config);
  assert.deepEqual([saved.__st, saved._at, saved._by, saved.v.gradeBase.G3, saved.gradeBase.G3, saved.v.__st], [1, 5000, 'CEO Sample', 3500, 3500, undefined]);
  // an older version (v1066) reads the same numbers from it
  const nOld = run(x, 'kbCfgV1066()'), nNew = run(x, 'kbCfg()');
  for (const f of ['gradeBase', 'empStore', 'csMin', 'csMax', 'baMin', 'baMax', 'spMin', 'spMax', 'quarter', 'poolRate']) assert.deepEqual(nOld[f], nNew[f], f);
  // ... and when it saves what it read (its kbSave stores the object as it is), this version reads its change
  run(x, "var o=kbCfgV1066(); o.gradeBase.G4=5300; STORE.karte_bonus_config=JSON.parse(JSON.stringify(o));");
  assert.deepEqual([run(x, 'kbCfg()').gradeBase.G4, run(x, 'kbCfg()').gradeBase.G3], [5300, 3500]);
  run(x, 'kbSave(kbCfgV1066())');   // saving an object that still has the wrapper fields: not wrapped twice
  assert.deepEqual([x.STORE.karte_bonus_config.v.__st, x.STORE.karte_bonus_config.v.v, x.STORE.karte_bonus_config.v.gradeBase.G4], [undefined, undefined, 5300]);
  // push (the merge of the sync) and read again
  const push = (dev, cloud) => { dev.CL = cloud; dev.STORE.karte_bonus_config = run(dev, "mergeStamped(CL, ls('karte_bonus_config', null))"); return run(dev, 'kbCfg()').gradeBase.G3; };
  x.STORE.karte_bonus_config = J(saved);
  assert.equal(push(x, { gradeBase: { G3: 2000 } }), 3500, 'a plain cloud value');
  x.STORE.karte_bonus_config = J(saved);
  assert.equal(push(x, { __st: 1, v: { gradeBase: { G3: 2000 } }, _at: 4000, _by: '' }), 3500, 'an older wrapped cloud value');
  // another device saves later: its save wins on both devices
  clock(y, 6000); run(y, "var c=kbCfg(); c.gradeBase.G3=2800; kbSave(c);");
  const ySaved = J(y.STORE.karte_bonus_config);
  x.STORE.karte_bonus_config = J(saved);
  assert.equal(push(x, J(ySaved)), 2800);
  assert.equal(push(y, J(saved)), 2800);
  x.M = x.STORE.karte_bonus_config; assert.equal(call(x, '_coversStamped(M, M)'), true);
  // saving again on a device whose clock is behind still moves the time forward
  clock(x, 100); run(x, 'kbSave(kbCfg())');
  assert.ok(x.STORE.karte_bonus_config._at > 6000);
});

test('P2-2: before locking, the bonus settings and the budget, sales and cost data of the stores in scope are read again; a change there stops the lock', async () => {
  const cloud = {}, a = cfgInstall(cloudDevice(cloud, { clock: 3000 })), b = cfgInstall(cloudDevice(cloud, { clock: 1000 }));
  const keys = run(b, `kevLockSyncKeys('${Q}')`);
  for (const k of ['bonus_eval', 'spl_bonus_q_' + Q, 'karte_bonus_config', 'bonus_coef', 'bonus_coef_rng', 'spl_budgets_v2_S1', 'spl_budgets_v2_S5', 'daily_actuals_S2', 'spl_invoices_S3', 'purchases_S4', 'fc_monthly_S2_2026-06', 'fc_monthly_S2_2026-07', 'fc_monthly_S2_2026-09'])
    assert.ok(keys.includes(k), 'reads ' + k);
  for (const k of ['pl_public', 'pl_actual', 'm_store_kpi', 'm_format_kpi', 'ocs_cfg', 'budgets_v2', 'q_budgets', 'ingredient_transfers', 'm_employees', 'fc_monthly_S2_2026-10'])
    assert.ok(!keys.includes(k), 'does not read ' + k);
  // another device raises the G4 base amount
  run(a, "var c=kbCfg(); c.gradeBase.G4=5200; kbSave(c);");
  cloud.karte_bonus_config = J(a.STORE.karte_bonus_config);
  const before = person(b, 'mia').amount;
  assert.equal(await call(b, `bqLockQuarter('${Q}')`), false);
  assert.match(lastToast(b), /変わっていたため、確定していません/);
  assert.equal(run(b, 'kbCfg()').gradeBase.G4, 5200);
  assert.notEqual(person(b, 'mia').amount, before);
  assert.equal(await call(b, `bqLockQuarter('${Q}')`), true);
  assert.equal(b.STORE.bonus_q[Q].evSnap.people.mia.base, 5200);
  // a settings value no one's numbers show yet (a G1 base amount) is in the digest too: a change elsewhere is not confirmed over (fail-closed)
  const e = cfgInstall(company()), dg = call(e, `kevLockDigest('${Q}')`), fin0 = J(call(e, 'bonusTotals(kbCfg()).finals'));
  run(e, "var c=kbCfg(); c.gradeBase.G1=500; kbSave(c);");
  assert.deepEqual(J(call(e, 'bonusTotals(kbCfg()).finals')), fin0);
  assert.notEqual(call(e, `kevLockDigest('${Q}')`), dg);
  // a budget changed on another device (the budget rows of the stores in scope are read again)
  const cloud2 = {}, d = cfgInstall(cloudDevice(cloud2, { clock: 1000 }));
  vm.runInContext("var _msb0 = monthSalesBudget; monthSalesBudget = function(sid, ym){ var o = ls('spl_budgets_v2_' + sid, null); return (o && o.m && o.m[ym] != null) ? o.m[ym] : _msb0(sid, ym); };", d);
  const miaBefore = person(d, 'mia').amount;
  cloud2.spl_budgets_v2_S2 = { m: { '2026-08': 250000 } };
  assert.equal(await call(d, `bqLockQuarter('${Q}')`), false);
  assert.notEqual(person(d, 'mia').amount, miaBefore);
  assert.equal(await call(d, `bqLockQuarter('${Q}')`), true);
});

/* ------------------------------------------------------------------ P2-3 ------------------------------------------------------------------ */
test('P2-3: recording re-reads the lock (reviewer A4): a re-lock on another device stops the stale record; the history keeps the newer lock\'s amount', async () => {
  const cloud = {}, a = cloudDevice(cloud, { clock: 1000 }), b = cloudDevice(cloud, { clock: 1100 });
  assert.equal(await call(a, `bqLockQuarter('${Q}')`), true);              // lock L1
  assert.equal(await call(b, `pullOpKey('spl_bonus_q_${Q}')`), true);      // B receives L1
  const L1 = J(b.STORE.bonus_q[Q].evSnap), oldKen = L1.finals.ken;
  assert.ok(L1.lid && L1.lt === 1000, 'a lock carries its time and mark');
  // A unlocks, raises Ken's evaluation, locks again (L2) and records
  clock(a, 2000);
  run(a, `bqUnlockQuarter('${Q}')`);
  run(a, `kevEvEdit('ken','G3','ab.lv',5,'${Q}'); kevDone('ken','G3','${Q}');`);
  publish(a, cloud);
  clock(a, 3000);
  assert.equal(await call(a, `bqLockQuarter('${Q}')`), true);
  const L2 = J(a.STORE.bonus_q[Q].evSnap);
  assert.notEqual(L2.lid, L1.lid);
  clock(a, 3100);
  assert.equal(await call(a, 'bonusConfirmQuarter()'), true);
  const aRow = a.STORE.growth_karte.ken.payLog[0], newKen = Number(aRow.amount);
  assert.deepEqual([oldKen, newKen], [2615, 2703], 'the amounts of the reviewer\'s scenario');
  assert.deepEqual([aRow.lk, aRow.lkt], [L2.lid, 3000], 'the line says which lock it was written from');
  // re-locking within the same millisecond still gives a new mark
  const s1 = cloudDevice({}, { clock: 7000 });
  assert.equal(await call(s1, `bqLockQuarter('${Q}')`), true);
  const m1 = s1.STORE.bonus_q[Q].evSnap.lid;
  run(s1, `bqUnlockQuarter('${Q}')`);
  assert.equal(await call(s1, `bqLockQuarter('${Q}')`), true);
  assert.notEqual(s1.STORE.bonus_q[Q].evSnap.lid, m1);
  // a later record written without a lock mark (the formula before 2026 Q3) does not keep an old mark
  run(s1, "var e=EMPS[1]; _bonusWritePay(e, {amount:1, segs:[]}, 'Q-test', 10, 1, {id:'L-old', t:5}); _bonusWritePay(e, {amount:1, segs:[]}, 'Q-test', 11, 1);");
  const tr = s1.STORE.growth_karte.ken.payLog.find(p => p.quarter === 'Q-test');
  assert.deepEqual([tr.amount, tr.lk, tr.lkt], ['11', undefined, undefined]);
  // B still shows L1 and presses "record" later: it reads the lock again, sees L2, and records nothing
  clock(b, 4000);
  assert.equal(await call(b, 'bonusConfirmQuarter()'), false);
  assert.match(lastToast(b), /確定し直されていたため、記録していません/);
  assert.equal(b.STORE.growth_karte, undefined);
  assert.equal(b.STORE.bonus_q[Q].evSnap.lid, L2.lid, 'B now shows the new lock');
  // B presses again: the same amount from L2; the merged history keeps one line with that amount
  assert.equal(await call(b, 'bonusConfirmQuarter()'), true);
  assert.equal(Number(b.STORE.growth_karte.ken.payLog[0].amount), newKen);
  for (const [x, y] of [[a.STORE.growth_karte, b.STORE.growth_karte], [b.STORE.growth_karte, a.STORE.growth_karte]]) {
    const rows = autoRows(merge(a, x, y).ken);
    assert.deepEqual(rows.map(p => Number(p.amount)), [newKen]);
  }
});

test('P2-3: two lines for the same quarter: the line written from the newer lock wins even when it was written earlier; without lock marks the newer line wins as before', () => {
  const c = company();
  install(c, '_coversMapByTime');
  const rA = { id: 'pA', type: 'ボーナス', src: 'auto', quarter: Q, amount: '2703', _at: 3100, lk: 'L2', lkt: 3000 };
  const rB = { id: 'pB', type: 'ボーナス', src: 'auto', quarter: Q, amount: '2615', _at: 4000, lk: 'L1', lkt: 1000 };
  const A = { ken: { _at: 3100, payTrack: 1, payLog: [rA] } }, B = { ken: { _at: 4000, payTrack: 1, payLog: [rB] } };
  for (const [x, y] of [[A, B], [B, A]]) {
    const m = merge(c, x, y);
    assert.deepEqual(autoRows(m.ken).map(p => p.amount), ['2703']);
    c.M = m; c.X = x; c.Y = y;
    assert.equal(call(c, 'kartePayCoversMap(M, X) && kartePayCoversMap(M, Y)'), true, 'the merged copy covers both');
  }
  // the same line written from two locks
  const sA = { ken: { _at: 3100, payTrack: 1, payLog: [Object.assign({}, rA, { id: 'p1' })] } };
  const sB = { ken: { _at: 4000, payTrack: 1, payLog: [Object.assign({}, rB, { id: 'p1' })] } };
  for (const [x, y] of [[sA, sB], [sB, sA]]) assert.equal(merge(c, x, y).ken.payLog[0].amount, '2703');
  c.SA = sA; c.SB = sB;
  assert.equal(call(c, 'kartePayCoversMap(SB, SA)'), false, 'a cloud copy with only the older lock\'s line does not cover the newer one');
  // lines without lock marks (written by older versions): the newer line wins, as before
  const oB = { ken: { _at: 4000, payTrack: 1, payLog: [{ id: 'pO', type: 'ボーナス', src: 'auto', quarter: Q, amount: '2615', _at: 4000 }] } };
  for (const [x, y] of [[A, oB], [oB, A]]) assert.deepEqual(autoRows(merge(c, x, y).ken).map(p => p.amount), ['2615']);
});

test('P2-3: a failed re-read, an unlock on another device, offline, or a second press while checking: nothing is recorded', async () => {
  const cloud = {}, g = cloudDevice(cloud, { clock: 1000 }), h = cloudDevice(cloud, { clock: 1100 });
  assert.equal(await call(g, `bqLockQuarter('${Q}')`), true);
  assert.equal(await call(h, `pullOpKey('spl_bonus_q_${Q}')`), true);
  h.PULL_FAIL = 'spl_bonus_q_' + Q;
  assert.equal(await call(h, 'bonusConfirmQuarter()'), false);
  assert.match(lastToast(h), /最新の確定を読めなかったため、記録していません/);
  assert.equal(h.STORE.growth_karte, undefined);
  h.PULL_FAIL = false;
  h.navigator = { onLine: false };
  const n0 = h.PULLED.length;
  assert.equal(call(h, 'bonusConfirmQuarter()'), false);
  assert.match(lastToast(h), /オフラインのため記録していません/);
  assert.equal(h.PULLED.length, n0, 'not even read');
  h.navigator = undefined;
  vm.runInContext('SUPA_SYNC_ENABLED = false;', h);
  assert.equal(call(h, 'bonusConfirmQuarter()'), false);
  assert.match(lastToast(h), /クラウド同期が OFF のため記録していません/);
  assert.equal(h.PULLED.length, n0);
  vm.runInContext('SUPA_SYNC_ENABLED = true;', h);
  const p1 = call(h, 'bonusConfirmQuarter()');
  assert.equal(call(h, 'bonusConfirmQuarter()'), false, 'a second press while the first is checking');
  assert.match(lastToast(h), /記録の前の確認をしています/);
  assert.equal(await p1, true);
  const recorded = J(h.STORE.growth_karte);
  // G unlocks; H still shows the lock and records one person from it
  clock(g, 2000); run(g, `bqUnlockQuarter('${Q}')`); cloud['spl_bonus_q_' + Q] = J(g.STORE.bonus_q[Q]);
  clock(h, 3000);
  assert.equal(await call(h, "bonusConfirmOne('mia')"), false);
  assert.match(lastToast(h), /確定が解除されていたため、記録していません/);
  assert.ok(!h.STORE.bonus_q[Q].locked);
  assert.deepEqual(J(h.STORE.growth_karte), recorded, 'nothing written');
});

/* ------------------------------------------------------------------ P3 ------------------------------------------------------------------ */
test('P3: a lock digest that cannot be computed never matches, so nothing is confirmed', () => {
  const c = company();
  vm.runInContext("var _kss0 = kevStableStr; kevStableStr = function(){ throw new Error('synthetic failure'); };", c);
  vm.runInContext('var CLEARED = 0; function mdCacheClear(){ CLEARED++; }', c);   // the page's per-call summary cache: cleared so the digest uses what was just read
  const d1 = call(c, `kevLockDigest('${Q}')`), d2 = call(c, `kevLockDigest('${Q}')`);
  assert.equal(c.CLEARED, 2);
  assert.match(d1, /^err:/);
  assert.notEqual(d1, d2);
  assert.equal(call(c, `kevLockCommit('${Q}', kevLockDigest('${Q}'), false)`), false);
  run(c, `bqLockQuarter('${Q}')`);
  assert.ok(!c.STORE.bonus_q[Q].locked);
  vm.runInContext('kevStableStr = _kss0;', c);
  assert.equal(call(c, `kevLockCommit('${Q}', kevLockDigest('${Q}'), false)`), true);
});

test('P3: a month with sales but no attendance record at all is missing (the current month before today: no sales day lacks attendance yet)', () => {
  const c = company();
  realPl(c, { acts: { S2: { '2026-10-01': { actual: 10000 } } }, labor: {} });
  vm.runInContext("function bizToday(){ return '2026-10-01'; } var _ms1 = monthStats; monthStats = function(sid, off){ return off === 0 ? {hasData:true, sales:10000} : _ms1(sid, off); };", c);
  const pl = run(c, "plComputeStore('S2','2026-10',0)");
  assert.equal(pl.sales, 10000);
  assert.deepEqual([pl.laborHas, pl.laborMissDays], [false, []], 'no attendance record in the month: missing, not a real 0');
});

test('P3: missing attendance tells where to fetch it; missing purchases do not get that text', () => {
  const c = company();
  vm.runInContext("STORES.S2.noLabor = ['2026-08'];", c);
  const mia = person(c, 'mia');
  assert.match(mia.missing.join(), /Labor の結果：実績が未取得（Store 2 8月：売上のある日に勤怠が未取得の日がある）。勤怠データの画面でその月を選び、「この月を最新化（売上＋勤怠）」を押して Toast から取得してください/);
  assert.match(run(c, 'kevLockProblems(bonusTotals(kbCfg())).join()'), /Mia Sample：.*勤怠データの画面でその月を選び/);
  const f = company();
  vm.runInContext("STORES.S2.noCost = ['2026-08'];", f);
  assert.doesNotMatch(person(f, 'mia').missing.join(), /勤怠データの画面/);
  const p = company();   // the accounting PL of a month has no payroll: fixed by importing the PL, not by fetching attendance
  vm.runInContext("_meetPlKpi = function(sid, ym){ return (sid === 'S2' && ym === '2026-08') ? {sales:309000, cogs:95481, payroll:null} : null; };", p);
  const pm = person(p, 'mia').missing.join();
  assert.match(pm, /Labor の結果：実績が未取得（Store 2 8月：会計 PL の人件費が空）/);
  assert.doesNotMatch(pm, /勤怠データの画面/);
});
