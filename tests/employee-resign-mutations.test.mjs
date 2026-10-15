// v1085: わざと壊す試験（退職の保護）。守りを 1 つずつ外して、退職の試験が落ちることを確かめる。重いので普段の一式には入れない
// （invoice-mutations と同じ扱い）: node --test tests/employee-resign-mutations.test.mjs
// Each case writes a changed copy of index.html or of the migration into a temporary folder and runs the relevant tests on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const INDEX = path.join(ROOT, 'index.html');
const MIG = path.join(ROOT, 'supabase/migrations/20261023090000_employee_resign_guard.sql');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'resign-mut-'));
const SYNC = path.join(ROOT, 'tests/employee-resign-sync.test.mjs'), GUARD = path.join(ROOT, 'tests/employee-resign-guard.test.mjs');

// [name, file, from, to, test file, test name pattern]
const CASES = [
  ['app: the save does not rebase / remember the change', 'index', "if(key==='m_employees' && typeof _empOnLocalSave==='function'){ try{ val=_empOnLocalSave(val); }catch(e){ console.warn('emp save', e); } }", '', SYNC, 'offline is kept|read the list before a reload|what a write sends'],
  ['app: the push sends the whole list again', 'index', "  if (key === 'm_employees') return await empPushDirty();", '', SYNC, 'v1085 alone'],
  ['app: the sign-in pull replaces the unsent changes', 'index', "_lsWriteVerified('m_employees', JSON.stringify(_empMergeCloud(a)));", "_lsWriteVerified('m_employees', JSON.stringify(a));", SYNC, 'offline is kept'],
  ['app: getEmployees does not remember what it read', 'index', "  try { Object.defineProperty(emps, '__src', { value:_src, enumerable:false, configurable:true, writable:true }); } catch(e){}", '', SYNC, 'read the list before a reload'],
  ['app: the status version is taken from the current table, not from what the screen read', 'index', "      if(e.st==null) e.st=Number((b && b._stV)||0)||0;", "      if(e.st==null) e.st=Number(((cBy[id]||b) && (cBy[id]||b)._stV)||0)||0;", SYNC, 'read the list before a reload'],
  ['app: a status the server did not take is not detected', 'index', "        if(EMP_ST_FIELDS.indexOf(k)>=0 && !_empSameField(k, a[k], wv)){ lost=true; if(k==='status'){ stWant=wv; stHave=a[k]; } }", '', SYNC, 'two devices change the same'],
  ['app: the pull does not drop a status change made on an older version', 'index', "      if(_empHasSt(e) && e.st!=null && (Number(c._stV)||0) > (Number(e.st)||0)){", "      if(false){", SYNC, 'two devices change the same'],
  ['app: the completion does not wait for the server', 'index', "    var r=await empSyncNow([o.empId], 'blocked');\r\n    if(!r.ok){ fail(r.reason||''); return; }", "    var r={ ok:true, states:{} };", SYNC, '退職手続きを完了'],
  ['app: the completion shows 完了 although the record was not sent', 'index', "      if(!wasDone){ var arr2=getOffboardings(); var o2=arr2.find(function(x){return x.id===obId;}); if(o2 && o2.status==='完了'){ o2.status='進行中'; o2.completedBy=''; o2.completedAt=''; setOffboardings(arr2); } }", '', SYNC, '退職手続きを完了'],
  ['app: the completion does not ask the server whether the sign-in is stopped', 'index', "    if(want==='blocked' && !st.stopped){", "    if(false){", SYNC, 'could not stop the manager account'],
  ['app: anyone can restore', 'index', "  if(['ceo','gm','am','office'].indexOf(curRole)<0){ showToast(t('在籍に戻せるのは CEO・GM・AM・経理だけです。','Only CEO, GM, AM or office can restore.'), 'danger'); return; }", '', SYNC, 'restore'],
  ['app: the restore cancels the offboarding before the server took it', 'index', "  if(!r.ok){ showToast(t('在籍に戻せませんでした。','Could not restore.')+' '+(r.reason||''), 'danger'); renderPage('staff_master'); return; }", '', SYNC, 'restore'],
  ['app: the onboarding brings a resigned namesake back', 'index', "    var e = ob.empId ? emps.find(x=>x.id===ob.empId) : emps.filter(x=>x.name===ob.name && !empBlocked(x))[0];", "    var e = emps.find(x=>x.name===ob.name);", SYNC, 'quick status'],
  ['app: the onboarding registers a second person with the resigned name', 'index', "  if (!_act && _same.length) {", "  if (false) {", SYNC, 'quick status'],
  ['app: the quick button leaves 退職 without the restore', 'index', "  if(e.status==='退職'){ restoreEmployee(empId); return; }   /* v1085: 退職から戻すのは「在籍に戻す」だけ */", '', SYNC, 'quick status'],
  ['app: the approval of a completed offboarding can be undone', 'index', "if(_ob0 && _ob0.status==='完了'){", "if(false){", SYNC, 'undoing the approval'],
  ['app: the edit form brings a resigned person back', 'index', "if (_cur0 && _cur0.status==='退職' && _ns0 && _ns0!=='退職') {", "if (false) {", SYNC, 'undoing the approval'],
  ['app: the signed-in check does not ask the server', 'index', "    if(empBlocked(rows[me])){ empForceLogout(rows[me]); return 'out'; }", '', SYNC, 'signed out on the next check'],
  ['app: the forced sign-out keeps the PIN in memory', 'index', "  window._sessionPin=null; window._hwSession=null; window._empPrivate=null;", '', SYNC, 'signed out on the next check'],
  ['app: saved sign-ins of resigned people are kept', 'index', "  try{ _empForgetBlockedSignins(out); }catch(e){}", '', SYNC, 'signed out on the next check'],
  ['app: the sign-in does not tell a stopped account', 'index', "    if (r && r.ok && j && j.error === 'inactive') return { ok:false, server:false, inactive:true };   /* v1085: 退職・停止中（サーバーが断った） */", '', SYNC, 'PIN sign-in reports'],
  ['app: the sign-in does not send the employee ID', 'index', "body:JSON.stringify(emp ? {action:'verify', scope:scope, key:key, pin:pin, emp:String(emp)} : {action:'verify', scope:scope, key:key, pin:pin})", "body:JSON.stringify({action:'verify', scope:scope, key:key, pin:pin})", SYNC, 'PIN sign-in reports'],
  ['app: the repair is open to anyone', 'index', "  if(['ceo','gm'].indexOf(curRole)<0) return;\r\n  var o=offboardById(obId), emps=getEmployees()", "  var o=offboardById(obId), emps=getEmployees()", SYNC, 'repair list'],
  ['app: the repair list ignores "keep in service"', 'index', "    if(String(e._restoreAt||'') > String(o.completedAt||'')) return;", '', SYNC, 'repair list'],
  ['app: the repair list guesses without a completed record', 'index', "    var o=e && latest[e.id]; if(!o || o.status!=='完了' || empBlocked(e)) return;", "    var o=e && latest[e.id]; if(!o || empBlocked(e)) return;", SYNC, 'repair list'],
  ['app: the offboarding merge lets the local copy win again', 'index', "  else if(_obRank(c)!==_obRank(l)) st = _obRank(l)>_obRank(c) ? l : c;", "  else if(false) st = l;", SYNC, 'moves forward only'],
  ['app: undoing an approval does not raise the generation', 'index', "  if(cg!==lg) st = lg>cg ? l : c;", '', SYNC, 'moves forward only'],
  ['sql: the version is not compared', 'mig', ' if nk is distinct from ok and nv = ov then', ' if nk is distinct from ok then', GUARD, 'root cause|kept'],
  ['sql: the rows get no version when the SQL is run', 'mig', "update public.employees set data = data || jsonb_build_object('_stV', 1)", "update public.employees set data = data || jsonb_build_object('_stV', 0)", GUARD, 'before this SQL'],
  ['sql: a stale copy may set the status column', 'mig', " NEW.status := case when od ? 'status' and nullif(od->>'status', '') is not null then od->>'status' else OLD.status end;", " NEW.status := NEW.status;", GUARD, 'root cause'],
  ['sql: the PIN is not stopped', 'mig', "      update public.auth_pins set data = jsonb_set(cur, array[nm], to_jsonb(public.emp_pin_mark()), true) where id = 'staff';", '', GUARD, 'stops the PIN'],
  ['sql: a namesake in service loses the PIN', 'mig', "    if shared then", "    if false then", GUARD, 'namesake'],
  ['sql: the linked manager account is not stopped', 'mig', "     update public.manager_auth set role = 'suspended' where user_id::text = m.user_id::text;", '', GUARD, 'stops the PIN'],
  ['sql: the linked Bot use is not stopped', 'mig', "      update public.bot_users set enabled = false where user_id::text = m.user_id::text;", '', GUARD, 'stops the PIN'],
  ['sql: the restore does not give the PIN back', 'mig', "      update public.auth_pins set data = case when h.prev is null or jsonb_typeof(h.prev) = 'null' then cur - nm else jsonb_set(cur, array[nm], h.prev, true) end where id = 'staff';", '', GUARD, 'stops the PIN'],
  ['sql: the app key cannot ask', 'mig', 'grant execute on function public.employee_access_state(text, boolean) to anon, authenticated, service_role;', 'grant execute on function public.employee_access_state(text, boolean) to service_role;', GUARD, 'check from the app'],
  ['sql: the app key can call the inner function', 'mig', 'revoke all on function public.employee_access_apply(text) from public, anon, authenticated;', '', GUARD, 'check from the app'],
  ['sql: a rename keeps the old name stopped', 'mig', "   for h in select * from public.employee_access_hold where kind = 'pin' and emp_id = p_emp and key <> nm loop", "   for h in select * from public.employee_access_hold where false loop", GUARD, 'namesake'],
];

const ONLY = process.env.RESIGN_MUTATION_ONLY ? new RegExp(process.env.RESIGN_MUTATION_ONLY) : null;
for (const [name, which, from, to, file, pattern] of CASES) {
  test('mutation: ' + name, { skip: !!ONLY && !ONLY.test(name) }, () => {
    const src = which === 'index' ? INDEX : MIG;
    const body = fs.readFileSync(src, 'utf8');
    const n = body.split(from).length - 1;
    assert.equal(n, 1, 'the anchor must be found exactly once: ' + from.slice(0, 80));
    const out = path.join(TMP, name.replace(/[^a-z0-9]+/gi, '_') + (which === 'index' ? '.html' : '.sql'));
    fs.writeFileSync(out, body.replace(from, to));
    // NODE_TEST_CONTEXT would make the child report to this runner instead of printing its own summary
    const { NODE_TEST_CONTEXT, ...base } = process.env;
    const env = { ...base, [which === 'index' ? 'FUNERGY_INDEX' : 'FUNERGY_RESIGN_MIG']: out };
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, file], { cwd: path.join(ROOT, 'tests'), env, encoding: 'utf8', timeout: 300000 });
    const passLine = (r.stdout.match(/^# pass (\d+)/m) || [])[1], failLine = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
    assert.ok(Number(failLine) > 0, 'the tests should fail with this guard removed (pass ' + passLine + ', fail ' + failLine + ')');
  });
}
test('the unchanged copies pass (so the failures above come from the mutations)', () => {
  for (const [file, pattern] of [[SYNC, '.'], [GUARD, '.']]) {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, file], { cwd: path.join(ROOT, 'tests'), env, encoding: 'utf8', timeout: 300000 });
    assert.match(r.stdout, /^# fail 0$/m, file);
    assert.match(r.stdout, /^# pass [1-9]/m, file);
  }
});
