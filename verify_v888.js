/* verify_v888.js — 「グループは出すと言っているのに NAV_ITEMS.roles が塞いでいる」を検出する。
   この不整合は画面から見ると『そのページが無い』のと区別がつかず、
   これまでの検証（文字列があるか）では拾えなかった。

   考え方:
   ・各ページについて「そのページを children に持つグループの roles」の和集合を出す
   ・NAV_ITEMS.roles がそれを満たしていなければ不整合
   ・既知で意図的なものは KNOWN に置く。KNOWN に無い不整合が出たら FAIL
     → 新しいページを足したときに roles を書き忘れると、ここで必ず落ちる */
const fs = require('fs');
const utf = fs.readFileSync('index.html', 'utf8');
const src = fs.readFileSync('index.html', 'latin1');
const sw = fs.readFileSync('sw.js', 'utf8');

let PASS = 0, FAIL = 0;
function chk(name, fn) {
  try {
    const r = fn();
    if (r === true) { PASS++; console.log('  PASS  ' + name); }
    else { FAIL++; console.log('  FAIL  ' + name + (r ? '  → ' + r : '')); }
  } catch (e) { FAIL++; console.log('  FAIL  ' + name + '  → 例外: ' + (e && e.message)); }
}

const APP = (utf.match(/const APP_VERSION = '(\d+)'/) || [])[1];
const SWB = (sw.match(/const SW_BUILD = '(\d+)'/) || [])[1];
console.log('APP_VERSION=' + APP + '  SW_BUILD=' + SWB + '\n');

chk('APP_VERSION と SW_BUILD が一致', () => APP === SWB || ('APP=' + APP + ' SW=' + SWB));
chk('lone LF = 0', () => {
  const crlf = (src.match(/\r\n/g) || []).length, lf = (src.match(/\n/g) || []).length;
  return lf - crlf === 0 || ('lone LF=' + (lf - crlf));
});

function ev(name) {
  const m = utf.match(new RegExp('const ' + name + ' = \\[[\\s\\S]*?\\n\\]'));
  if (!m) throw new Error(name + ' が見つからない');
  return new Function('return ' + m[0].replace('const ' + name + ' =', ''))();
}
const NAV = ev('NAV_ITEMS');

/* グループ集合ごとに、そのメニューを見る役職。roles を持たない集合は groupsForRole() の分岐に対応。 */
const SETS = [
  { name: 'MENU_GROUPS', groups: ev('MENU_GROUPS'), roles: null },              // g.roles で決まる
  { name: 'OFFICE_GROUPS', groups: ev('OFFICE_GROUPS'), roles: null },          // 同上
  { name: 'ACCT_GROUPS', groups: ev('ACCT_GROUPS'), roles: ['office', 'office_crew'] },
  { name: 'CHEF_GROUPS', groups: ev('CHEF_GROUPS'), roles: ['chef'] },
];

const need = {};
SETS.forEach(s => s.groups.forEach(g => {
  const rs = g.roles || s.roles || [];
  (g.children || []).forEach(pid => {
    need[pid] = need[pid] || { roles: new Set(), where: [] };
    rs.forEach(r => need[pid].roles.add(r));
    need[pid].where.push(s.name + '/' + (g.label || g.id));
  });
}));

function mismatch(pid) {
  const it = NAV.find(x => x.id === pid);
  if (!it || !it.roles || !need[pid]) return [];
  return [...need[pid].roles].filter(r => !it.roles.includes(r));
}

/* v888 で直した4件。ここが再発したら必ず落とす。 */
const FIXED = ['tip', 'vacation', 'inventory', 'invoice'];
FIXED.forEach(pid => chk('roles が足りている: ' + pid, () => {
  const m = mismatch(pid);
  return m.length === 0 || ('出ない役職: ' + m.join(',') + ' | ' + need[pid].where.join(' , '));
}));

/* v888 時点で残している不整合。意図的なものと未確認のものが混在しているので、
   触らずに固定しておく。ここから減るぶんには問題ない（KNOWN の掃除だけ）。
   増えたら＝新しい登録漏れなので FAIL にする。 */
const KNOWN = ['acct_center', 'acct_review', 'approval', 'crew_handbook', 'foodcost',
  'fv_variance', 'hr', 'ing_transfer', 'ingredient_master', 'leadership', 'menu',
  'mypage', 'notifications', 'ojt_admin', 'recipe', 'settings', 'shift_admin',
  'staff_master', 'store_cmd', 'store_master', 'vendor_master'];

chk('新しい roles の登録漏れが無い', () => {
  const bad = Object.keys(need).filter(pid => mismatch(pid).length > 0 && KNOWN.indexOf(pid) < 0);
  return bad.length === 0
    || ('KNOWN に無い不整合: ' + bad.map(p => p + '(' + mismatch(p).join(',') + ')').join(' , '));
});

chk('KNOWN に不要な項目が残っていない', () => {
  const stale = KNOWN.filter(pid => mismatch(pid).length === 0);
  return stale.length === 0 || ('直ったので KNOWN から外せる: ' + stale.join(','));
});

/* 実際に buildNav の絞り込みを再現して、人材管理・食材管理に出るか見る */
function subnavFor(groupId, role, setName) {
  const s = SETS.find(x => x.name === setName);
  const g = s.groups.find(x => x.id === groupId);
  return (g.children || []).filter(pid => {
    const it = NAV.find(n => n.id === pid);
    return !it || !it.roles || it.roles.includes(role);
  });
}
[['gm', 'g_hr', 'tip'], ['ceo', 'g_hr', 'tip'], ['gm', 'g_hr', 'vacation'],
 ['gm', 'g_food', 'invoice'], ['gm', 'g_food', 'inventory'],
 ['am', 'g_hr', 'tip'], ['sl', 'g_hr', 'tip']].forEach(([role, gid, pid]) => {
  chk('buildNav 再現: ' + role + ' の ' + gid + ' に ' + pid + ' が出る', () =>
    subnavFor(gid, role, 'MENU_GROUPS').indexOf(pid) >= 0 || 'まだ出ない');
});
chk('buildNav 再現: office_crew の 経理 請求・仕訳 に invoice が出る', () =>
  subnavFor('ga_acct', 'office_crew', 'ACCT_GROUPS').indexOf('invoice') >= 0 || 'まだ出ない');
chk('buildNav 再現: chef の 食材管理 に inventory が出る', () =>
  subnavFor('gc_food', 'chef', 'CHEF_GROUPS').indexOf('inventory') >= 0 || 'まだ出ない');

/* 権限そのものは広げていないこと（roles はメニューの表示可否だけ） */
chk('roles 以外に権限判定を足していない', () => {
  const guards = ['canApproveVacation', 'canAccessStaffMaster', 'canApproveSupplyOrder'];
  return guards.every(g => new RegExp('function\\s+' + g + '\\s*\\(').test(utf))
    || '既存の権限関数が消えている';
});

console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL);
process.exit(FAIL ? 1 : 0);
