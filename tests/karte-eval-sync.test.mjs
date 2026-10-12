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

test('R1: copies written by an older version (no line times, record-level merge) keep their lines and heal on this version', () => {
  const b = company();
  // an older device's copy: hand-entered lines with no time, and a newer record that lost a line (older devices merge whole records)
  const older = { ken: { _at: 9000, note: 'older device', payLog: [{ id: 'm1', type: 'ボーナス', amount: '50', date: '2026-07-01', note: '' }] } };
  const mine = { ken: { _at: 5000, payLog: [{ id: 'm1', type: 'ボーナス', amount: '50', date: '2026-07-01', note: '' },
    { id: 'p-auto', type: 'ボーナス', amount: '2615', src: 'auto', quarter: Q, at: '2026-10-11T20:40:00.000Z' }] } };
  let m = merge(b, older, mine);
  assert.deepEqual(m.ken.payLog.map(p => p.id), ['m1', 'p-auto'], 'the line the older device dropped comes back');
  assert.equal(m.ken.note, 'older device');
  m = merge(b, mine, older);
  assert.deepEqual(m.ken.payLog.map(p => p.id), ['m1', 'p-auto']);
  // a line without a time: the newer record decides, as before
  const o2 = J(older); o2.ken.payLog[0].amount = '60';
  assert.equal(merge(b, mine, o2).ken.payLog.find(p => p.id === 'm1').amount, '60');
  // a row of an unexpected shape is kept, not dropped
  const odd = { ken: { _at: 1, payLog: ['legacy text row', { id: 'm1', type: 'ボーナス', amount: '50', date: '2026-07-01', note: '' }] } };
  assert.deepEqual(merge(b, odd, mine).ken.payLog.map(p => (typeof p === 'string' ? p : p.id)), ['m1', 'p-auto', 'legacy text row']);
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
