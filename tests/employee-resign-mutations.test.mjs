// v1085: わざと壊す試験（退職の保護）。守りを 1 つずつ外して、退職の試験が落ちることを確かめる。重いので普段の一式には入れない
// （invoice-mutations と同じ扱い）: node --test tests/employee-resign-mutations.test.mjs
// Each case writes a changed copy of index.html or of the migration into a temporary folder and runs the relevant tests on it.
// RESIGN_MUTATION_ONLY=<regexp> runs only the cases whose name matches (to split the run).
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
const N = '\r\n';   // index.html keeps CRLF

// [name, file, from, to, test file, test name pattern]
const CASES = [
  // ---- the app: what is saved and sent
  ['app: the save does not rebase / remember the change', 'index', "if(key==='m_employees' && typeof _empOnLocalSave==='function'){ try{ val=_empOnLocalSave(val); }catch(e){ console.warn('emp save', e); try{ _lsNoteSaveFailure(key); }catch(_){} return false; } }", '', SYNC, 'offline is kept|read the list before a reload|what a write sends'],
  ['app: the push sends the whole list again', 'index', "  if (key === 'm_employees') return await empPushDirty();", '', SYNC, 'v1085 alone'],
  ['app: the sign-in pull replaces the unsent changes', 'index', "_lsWriteVerified('m_employees', JSON.stringify(_empMergeCloud(a)));", "_lsWriteVerified('m_employees', JSON.stringify(a));", SYNC, 'offline is kept'],
  ['app: getEmployees does not remember what it read', 'index', "  try { Object.defineProperty(emps, '__src', { value:_src, enumerable:false, configurable:true, writable:true }); } catch(e){}", '', SYNC, 'read the list before a reload'],
  ['app: the status version is taken from the current table, not from what the screen read', 'index', "      if(e.st==null) e.st=Number((b && b._stV)||0)||0;", "      if(e.st==null) e.st=Number(((cBy[id]||b) && (cBy[id]||b)._stV)||0)||0;", SYNC, 'read the list before a reload'],
  ['app: a status the server did not take is not detected', 'index', "        if(EMP_ST_FIELDS.indexOf(k)>=0 && !_empSameField(k, a[k], wv)){ lost=true; if(k==='status'){ stWant=wv; stHave=a[k]; } }", '', SYNC, 'two devices change the same'],
  ['app: the pull does not drop a status change made on an older version', 'index', "    if(_empHasSt(e) && e.st!=null && (Number(c._stV)||0) > (Number(e.st)||0)){", "    if(false){", SYNC, 'two devices change the same'],
  ['app: the queue is a device-local key again (not in IndexedDB)', 'index', "var EMP_DIRTY_KEY = 'emp_dirty_q';", "var EMP_DIRTY_KEY = '_emp_dirty';", SYNC, 'localStorage is full'],
  ['app: a queue that cannot be saved is not kept in memory', 'index', "  if(_empQFailed && _EMP_Q_MEM) return _empClone(_EMP_Q_MEM);", '', SYNC, 'localStorage is full'],
  ['app: a late load overwrites a newer local state', 'index', "    if(l && (Number(l._stV)||0) > (Number(c._stV)||0)){", "    if(false){", SYNC, 'a load that started before'],
  ['app: the one-time fixes while starting are queued', 'index', "  var booting=(typeof _supaBooting!=='undefined' && _supaBooting);", "  var booting=false;", SYNC, 'one-time fixes'],
  ['app: a rolled-back grade change stays queued', 'index', "  try{ if(tx.empQ && typeof _empDirtyRestore==='function') _empDirtyRestore(tx.empQ); }catch(e){ bad=true; }   /* v1085: 戻した変更を、あとで送らない */", '', SYNC, 'grade change'],
  ['app: one refused row blocks every push', 'index', "      if(!_empRowRefused(s0)) return false;", "      return false;", SYNC, 'refuses does not block'],
  ['app: the edit form saves on the list read at save time', 'index', "  var emps = _fm0 || getEmployees();", "  var emps = getEmployees();", SYNC, 'edit form saves only'],
  // ---- the app: completion, restore, repair
  ['app: the completion does not wait for the server', 'index', "    var r=await empSetStateNow(o.empId, function(c){ return { status:'退職', resignDate:(c.resignDate||e.resignDate||o.lastWorkDate||todayISO()), osDisabled:true }; }, 'blocked');", "    var r={ ok:true, states:{}, guard:true };", SYNC, '退職手続きを完了 — completes'],
  ['app: the state is not sent on the cloud version when nothing is queued', 'index', "  if(need.length){", "  if(false){", SYNC, 'already shows 退職'],
  ['app: the completion shows 完了 although the record was not sent', 'index', "      if(!wasDone){ var arr2=getOffboardings(); var o2=arr2.find(function(x){return x.id===obId;}); if(o2 && o2.status==='完了'){ o2.status='進行中'; o2.completedBy=''; o2.completedAt=''; setOffboardings(arr2); } }", '', SYNC, '退職手続きを完了 — completes'],
  ['app: the completion does not ask the server whether the sign-in is stopped', 'index', "    if(want==='blocked' && !st.stopped){", "    if(false){", SYNC, 'could not stop the manager account'],
  ['app: the completion goes on without the server guard', 'index', "    if(r.guard===false){ fail(", "    if(false){ fail(", SYNC, 'without the server guard'],
  ['app: a namesake is not asked about', 'index', "    if(shared && !o.pinShared && !confirm(", "    if(false && !confirm(", SYNC, 'namesake in service'],
  ['app: the completion does not re-read a record cancelled elsewhere', 'index', "    if(o.status==='取消'){ fail(t('この退職手続きは「取消」になっています（在籍に戻しました）。'", "    if(false){ fail(t('この退職手続きは「取消」になっています（在籍に戻しました）。'", SYNC, 'cancelled on another device'],
  ['app: anyone can restore', 'index', "  if(['ceo','gm','am','office'].indexOf(curRole)<0){ showToast(t('在籍に戻せるのは", "  if(false){ showToast(t('在籍に戻せるのは", SYNC, 'restore \\(在籍に戻す\\)'],
  ['app: the restore writes the device first (the old way)', 'index', "  var r=await empRestoreServer(empId, false, title, again, fresh);", "  var _L=getEmployees(); var _x=_L.find(function(z){return z.id===empId;}); _x.status='在籍'; _x.osDisabled=false; lsSet('m_employees', _L);" + N + "  var r=await empRestoreServer(empId, false, title, again, fresh);", SYNC, 'restore \\(在籍に戻す\\)'],
  ['app: the restore cancels the offboarding before the server took it', 'index', "  if(!r.ok){ showToast(t('在籍に戻せませんでした。','Could not restore.')+' '+(r.reason||''), 'danger'); renderPage('staff_master'); return; }", '', SYNC, 'restore \\(在籍に戻す\\)'],
  ['app: the onboarding brings a resigned namesake back', 'index', "    var e = ob.empId ? emps.find(x=>x.id===ob.empId) : emps.filter(x=>x.name===ob.name && !empBlocked(x))[0];", "    var e = emps.find(x=>x.name===ob.name);", SYNC, 'quick status'],
  ['app: the onboarding registers a second person with the resigned name', 'index', "  if (!_act && _same.length) {", "  if (false) {", SYNC, 'quick status'],
  ['app: the quick button leaves 退職 without the restore', 'index', "  if(e.status==='退職'){ restoreEmployee(empId); return; }   /* v1085: 退職から戻すのは「在籍に戻す」だけ */", '', SYNC, 'quick status'],
  ['app: a completed offboarding approval can be undone', 'index', "  if(ob && (ob.status==='完了' || ob.status==='取消')){ alert(", "  if(false){ alert(", SYNC, 'undoing an offboarding approval'],
  ['app: the undo does not re-read the record', 'index', "  if(!(await offboardPullNow())){ alert(t('退職記録をサーバーで確かめられませんでした（通信）。もう一度お試しください。'", "  if(false){ alert(t('退職記録をサーバーで確かめられませんでした（通信）。もう一度お試しください。'", SYNC, 'undoing an offboarding approval'],
  ['app: the edit form brings a resigned person back', 'index', "if (_cur0 && _cur0.status==='退職' && _ns0 && _ns0!=='退職' && _ns0!==_or0) {", "if (false) {", SYNC, 'undoing an offboarding approval'],
  ['app: the repair is open to anyone', 'index', "  if(['ceo','gm'].indexOf(curRole)<0) return;" + N + "  var o=offboardById(obId), e=getEmployees()", "  var o=offboardById(obId), e=getEmployees()", SYNC, 'repair list'],
  ['app: the repair list ignores "keep in service"', 'index', "    if(e._resignOk && e._resignOk.ob===o.id) return;", '', SYNC, 'repair list'],
  ['app: the repair list guesses without a completed record', 'index', "    var o=e && latest[e.id]; if(!o || o.status!=='完了' || empBlocked(e)) return;", "    var o=e && latest[e.id]; if(!o || empBlocked(e)) return;", SYNC, 'repair list'],
  // ---- the app: sign-in and sign-out
  ['app: the signed-in check does not ask the server', 'index', "    if(empBlocked(c)){ empForceLogout(c); return 'out'; }", '', SYNC, 'signed out on the next check'],
  ['app: a stale local copy signs out without asking the server', 'index', "    var rows=await _empFetchByIds([me]);" + N + "    if(!rows){", "    if(locBlocked){ empForceLogout(loc); return 'out'; }" + N + "    var rows=await _empFetchByIds([me]);" + N + "    if(!rows){", SYNC, 'signed out on the next check'],
  ['app: the secure sign-in checks the PIN user instead of the account', 'index', "  if(window._secureMode && window._authSession && window._authSession.emp_id) return String(window._authSession.emp_id);", '', SYNC, 'signed out on the next check'],
  ['app: the forced sign-out keeps the PIN in memory', 'index', "  window._sessionPin=null; window._hwSession=null; window._empPrivate=null;", '', SYNC, 'signed out on the next check'],
  ['app: saved sign-ins of resigned people are kept', 'index', "  try{ _empForgetBlockedSignins(out); }catch(e){}", '', SYNC, 'signed out on the next check'],
  ['app: the sign-in does not tell a stopped account', 'index', "    if (r && r.ok && j && j.error === 'inactive') return { ok:false, server:false, inactive:true };   /* v1085: 退職・停止中（サーバーが断った） */", '', SYNC, 'PIN sign-in reports'],
  ['app: the sign-in does not send the employee ID', 'index', "body:JSON.stringify(emp ? {action:'verify', scope:scope, key:key, pin:pin, emp:String(emp)} : {action:'verify', scope:scope, key:key, pin:pin})", "body:JSON.stringify({action:'verify', scope:scope, key:key, pin:pin})", SYNC, 'PIN sign-in reports'],
  // ---- the app: the offboarding record merge
  ['app: the offboarding merge lets the local copy win again', 'index', "  else if(_obRank(c)!==_obRank(l)) st = _obRank(l)>_obRank(c) ? l : c;", "  else if(false) st = l;", SYNC, 'moves forward only'],
  ['app: undoing an approval does not raise the generation', 'index', "  else if(cg!==lg) st = lg>cg ? l : c;", '', SYNC, 'moves forward only'],
  ['app: 完了 is not final in the merge', 'index', "  if(_obFinal(c) || _obFinal(l)){", "  if(false){", SYNC, 'moves forward only'],
  // ---- the server
  ['sql: the version is not compared', 'mig', ' if nk is distinct from ok and nv = ov and (priv or not reinstate) then', ' if nk is distinct from ok and (priv or not reinstate) then', GUARD, 'root cause|kept'],
  ['sql: the public key may bring a resigned person back', 'mig', ' if nk is distinct from ok and nv = ov and (priv or not reinstate) then', ' if nk is distinct from ok and nv = ov then', GUARD, 'public key cannot'],
  ['sql: leaving 退職 with the OS account off is not a reinstatement', 'mig', "  or (coalesce(nullif(od->>'status', ''), OLD.status, '') = '退職' and coalesce(nullif(nd->>'status', ''), NEW.status, '') <> '退職');", "  or false;", GUARD, 'public key cannot'],
  ['sql: a column-only status change is not looked at', 'mig', " if NEW.status is distinct from OLD.status and (nd->>'status') is not distinct from (od->>'status') and nullif(NEW.status, '') is not null then", " if false then", GUARD, 'public key cannot'],
  ['sql: the public key may set the restore mark', 'mig', " if not priv then\n  foreach k in array array['_restoreAt','_restoreBy'] loop", " if false then\n  foreach k in array array['_restoreAt','_restoreBy'] loop", GUARD, 'public key cannot'],
  ['sql: the rows get no version when the SQL is run', 'mig', "update public.employees set data = data || jsonb_build_object('_stV', 1)", "update public.employees set data = data || jsonb_build_object('_stV', 0)", GUARD, 'before this SQL'],
  ['sql: running it again moves new rows to version 1', 'mig', " where data is not null and jsonb_typeof(data) = 'object' and not (data ? '_stV');", " where data is not null and jsonb_typeof(data) = 'object';", GUARD, 'runs twice'],
  ['sql: a stale copy may set the status column', 'mig', " NEW.status := case when od ? 'status' and nullif(od->>'status', '') is not null then od->>'status' else OLD.status end;", " NEW.status := NEW.status;", GUARD, 'root cause'],
  ['sql: every repeated stale write is logged', 'mig', " if p_kind in ('kept','refused','offboard_kept') and exists(", " if false and exists(", GUARD, 'root cause'],
  ['sql: the PIN is not stopped', 'mig', "   update public.auth_pins set data = jsonb_set(cur, array[nm], to_jsonb(public.emp_pin_mark()), true) where id = 'staff';", '', GUARD, 'stops the PIN'],
  ['sql: a namesake in service loses the PIN', 'mig', " select exists(select 1 from public.employees x where btrim(coalesce(x.data->>'name', '')) = nm and not public.emp_blocked_of(x.status, x.data)) into v_active;", " select false into v_active;", GUARD, 'PINs are by name'],
  ['sql: a new namesake gets the resigned person\'s PIN', 'mig', "     and exists(select 1 from public.employees x where x.id::text = h.emp_id and not public.emp_blocked_of(x.status, x.data)) then", "     then", GUARD, 'PINs are by name'],
  ['sql: a new person is not looked at', 'mig', " if nb is distinct from ob or TG_OP = 'INSERT'", " if nb is distinct from ob or (TG_OP = 'INSERT' and nb)", GUARD, 'PINs are by name'],
  ['sql: a rename keeps the old name stopped', 'mig', "  for h in select * from public.employee_access_hold where kind = 'pin' and emp_id = p_emp and key is distinct from nm loop", "  for h in select * from public.employee_access_hold where false loop", GUARD, 'PINs are by name'],
  ['sql: the restore does not give the PIN back', 'mig', "then jsonb_set(cur, array[nm], h.prev, true)", "then cur - nm", GUARD, 'public key cannot'],
  ['sql: the linked manager account is not stopped', 'mig', "     update public.manager_auth set role = 'suspended' where user_id::text = m.user_id::text;", '', GUARD, 'stops the PIN'],
  ['sql: the linked Bot use is not stopped', 'mig', "      update public.bot_users set enabled = false where user_id::text = m.user_id::text;", '', GUARD, 'stops the PIN'],
  ['sql: the app learns about manager accounts of people in service', 'mig', "  'manager', case when blocked then mgr when mgr = 'stopped' then 'stopped' else 'n/a' end,", "  'manager', mgr,", GUARD, 'stops the PIN'],
  ['sql: the app key cannot ask', 'mig', 'grant execute on function public.employee_access_state(text, boolean) to anon, authenticated, service_role;', 'grant execute on function public.employee_access_state(text, boolean) to service_role;', GUARD, 'check from the app'],
  ['sql: the app key can call the inner function', 'mig', 'revoke all on function public.employee_access_apply(text) from public, anon, authenticated;', '', GUARD, 'check from the app'],
  ['sql: the PIN writer overwrites a stopped PIN', 'mig', " if p_scope = 'staff' and (cur->>p_key) = public.emp_pin_mark() then return 'blocked'; end if;", '', GUARD, 'PIN writer'],
  ['sql: a stale copy turns 完了 back', 'mig', "    (o->>'status' = '完了' and coalesce(n->>'status', '') not in ('完了','取消'))", "    false", GUARD, 'offboarding record in app_state'],
  ['sql: a stale copy drops a finished record', 'mig', "  if jsonb_typeof(o) = 'object' and (o->>'id') is not null and not ((o->>'id') = any(seen)) and o->>'status' in ('完了','取消') then", "  if false then", GUARD, 'offboarding record in app_state'],
  ['sql: the restore leaves the offboarding records', 'mig', " if not coalesce(p_keep_offboard, false) and to_regclass('public.app_state') is not null then", " if false then", GUARD, 'offboarding records to 取消'],
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
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, file], { cwd: path.join(ROOT, 'tests'), env, encoding: 'utf8', timeout: 600000 });
    const passLine = (r.stdout.match(/^# pass (\d+)/m) || [])[1], failLine = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
    assert.ok(Number(passLine) + Number(failLine) > 0, 'the pattern ran no test: ' + pattern);
    assert.ok(Number(failLine) > 0, 'the tests should fail with this guard removed (pass ' + passLine + ', fail ' + failLine + ')');
  });
}
test('the unchanged copies pass (so the failures above come from the mutations)', { skip: !!ONLY && !ONLY.test('unchanged') }, () => {
  for (const [file, pattern] of [[SYNC, '.'], [GUARD, '.']]) {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, file], { cwd: path.join(ROOT, 'tests'), env, encoding: 'utf8', timeout: 600000 });
    assert.match(r.stdout, /^# fail 0$/m, file);
    assert.match(r.stdout, /^# pass [1-9]/m, file);
  }
});
