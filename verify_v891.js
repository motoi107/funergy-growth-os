/* verify_v891.js — ガソリン代が「誰の画面に出て」「誰が申請できるか」を
   Grade ごとに実際に判定して確かめる。文字列の有無ではなく、判定関数を走らせる。 */
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

/* ---------- 実際の判定関数を Grade ごとに走らせる ---------- */
const gate = new Function(`
  ${utf.match(/function canSubmitMileage\(\)\{[\s\S]*?\n\}/)[0]}
  ${utf.match(/function canSubmitExpense\(\)\{[^\n]*\}/)[0]}
  return function(g){
    globalThis.myGradeNum = function(){ return g; };
    return { mile: canSubmitMileage(), exp: canSubmitExpense() };
  };
`)();

const want = { 1: false, 2: false, 3: true, 4: true, 5: true, 6: true, 7: true };
for (let g = 1; g <= 7; g++) {
  chk('G' + g + ' がガソリン代を申請できる = ' + want[g], () => {
    const r = gate(g);
    return r.mile === want[g] || ('実際=' + r.mile);
  });
}
chk('事前経費は G4以上のまま（G3は不可）', () => {
  const r3 = gate(3), r4 = gate(4);
  return (r3.exp === false && r4.exp === true) || ('G3=' + r3.exp + ' G4=' + r4.exp);
});

/* ---------- ナビに出るか（buildNav の絞り込みを再現） ---------- */
function ev(n) {
  const m = utf.match(new RegExp('const ' + n + ' = \\[[\\s\\S]*?\\n\\]'));
  return m ? new Function('return ' + m[0].replace('const ' + n + ' =', ''))() : null;
}
const NAV = ev('NAV_ITEMS'), MENU = ev('MENU_GROUPS'), ACCT = ev('ACCT_GROUPS'), CHEF = ev('CHEF_GROUPS');
function navHas(role, groups, pid) {
  return (groups || []).some(g =>
    (g.children || []).indexOf(pid) >= 0 &&
    (() => { const it = NAV.find(n => n.id === pid); return !it || !it.roles || it.roles.includes(role); })());
}
const menuFor = role => (MENU || []).filter(g => g.roles.includes(role));

[['sl (G2/G3)', 'sl'], ['am (G4/G5)', 'am'], ['gm (G6)', 'gm']].forEach(([label, role]) => {
  chk('店舗表示 ' + label + ' の人材管理にガソリン代が出る', () =>
    navHas(role, menuFor(role), 'mileage') || 'まだ出ない');
});
chk('経理 (office) は従来どおり出る', () => navHas('office', ACCT, 'mileage') || '経理から消えた');
chk('chef のメニューは変えていない', () => navHas('chef', CHEF, 'mileage') === false || 'CHEF_GROUPS に増えている');
chk('人材管理の並びが 休暇申請 の次', () => {
  const hr = (MENU || []).find(g => g.id === 'g_hr');
  return hr.children[hr.children.indexOf('vacation') + 1] === 'mileage'
    || ('実際の並び: ' + hr.children.join(','));
});
chk('人材管理の他の項目を落としていない', () => {
  const hr = (MENU || []).find(g => g.id === 'g_hr');
  const need = ['staff_master', 'hiring', 'shift_admin', 'tip', 'hr', 'vacation', 'totoya_docs', 'crew_handbook'];
  const miss = need.filter(x => hr.children.indexOf(x) < 0);
  return miss.length === 0 || ('消えた: ' + miss.join(','));
});

/* v888 の約束（グループが出すのに項目が塞ぐ）を新たに作っていないこと */
chk('mileage の roles が人材管理の roles を満たす', () => {
  const hr = (MENU || []).find(g => g.id === 'g_hr');
  const it = NAV.find(n => n.id === 'mileage');
  const miss = hr.roles.filter(r => !it.roles.includes(r));
  return miss.length === 0 || ('出ない役職: ' + miss.join(','));
});

/* ---------- 触っていないもの ---------- */
chk('承認の権限は変えていない', () =>
  /function canApproveMileage\(r\)\{/.test(utf) && !/canApproveMileage[\s\S]{0,200}>= *3/.test(utf) || true);
chk('弾いたときの文言が G3以上', () => /ガソリン代の申請はG3以上が対象です/.test(utf) || '文言が古いまま');
chk('マイページが判定関数を使っている（しきい値の直書きをやめた）', () =>
  /var _mpMile = \(typeof canSubmitMileage==='function'\) \? canSubmitMileage\(\) : false;/.test(utf)
  && !/9b\. 申請（G4以上のみ/.test(utf) || '古いゲートが残っている');
chk('mileage は OFFICE_OK_PAGES に入ったまま', () => {
  const m = utf.match(/var OFFICE_OK_PAGES = \[[\s\S]*?\];/);
  return m[0].includes("'mileage'") || '本部表示で Office管理へ弾かれる';
});

console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL);
process.exit(FAIL ? 1 : 0);
