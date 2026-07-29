/* ============================================================
   verify_v776.js — 配属店舗=Office の人がログイン画面に出ない問題

   loginPickLocation() を index.html から切り出し、モック DOM で実行して
   「誰が候補に出るか」を v775 と比較する。

     テスト1: 症状再現 … v775 は store='OFFICE' でも role が該当しなければ出ない
     テスト2: 症状再現 … その人は店舗側の一覧にも出ない（どこからもログインできない）
     テスト3: v776 … 配属店舗=OFFICE の人が出る（役職は問わない）
     テスト4: 従来の役職ベースの候補は変わらない（退行防止）
     テスト5: 退職・無効は除外したまま
     テスト6: 店舗側の一覧は変えていない
     テスト7: 表記が Office になっている
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const SRC = fs.readFileSync('index.html', 'utf8');
const OLD = fs.readFileSync('index_v775_backup.html', 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  ✅ ' + m); pass++; } else { console.log('  ❌ ' + m); fail++; } }

function grab(src, name) {
  const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('function', m.index);
  let d = 0, st = false, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; }
    else if (c === '}') { d--; if (st && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

const STORES = [
  { id: 'F01', name: 'ToriTon' }, { id: 'F02', name: 'Tenkichi' },
  { id: 'F03', name: 'Waikiki Five Star Poke' }, { id: 'F03-G', name: 'Waikiki Garlic Shack' },
  { id: 'F04-K', name: 'Kaimuki' }, { id: 'F04-P', name: 'Piikoi' },
  { id: 'F04-A', name: 'Aiea' }, { id: 'F05', name: 'Marujuu' }
];

const EMPS = [
  /* 役職で本部に属する人（従来から出ていた） */
  { name: 'Tac Tsutsumi', role: 'ceo', store: 'ALL', status: '在籍' },
  { name: 'Moto Kubota', role: 'gm', store: 'ALL', status: '在籍' },
  { name: 'Marcia Kodama', role: 'office', store: 'OFFICE', status: '在籍' },
  { name: 'Akane Yoshizawa', role: 'office_crew', store: 'OFFICE', status: '在籍' },
  { name: 'Chikayoshi Nishihara', role: 'chef', store: 'ALL', status: '在籍' },
  /* 今回の問題：配属店舗を Office にしたが役職は該当しない */
  { name: 'Office New Crew', role: 'crew', store: 'OFFICE', status: '在籍' },
  { name: 'Office Leader', role: 'sl', store: 'OFFICE', status: '在籍' },
  { name: 'Office G4', role: 'g4', store: 'OFFICE', status: '在籍' },
  /* 除外されるべき人 */
  { name: 'Retired Office', role: 'office', store: 'OFFICE', status: '退職' },
  { name: 'Disabled Office', role: 'crew', store: 'OFFICE', status: '在籍', osDisabled: true },
  /* 店舗スタッフ */
  { name: 'ToriTon Crew', role: 'crew', store: 'F01', status: '在籍' },
  { name: 'Support Crew', role: 'crew', store: 'F02', support: ['F01'], status: '在籍' }
];

/* loginPickLocation は DOM を触るので、最小限のモックを置いて people だけ取り出す */
function run(src, loc) {
  const captured = { names: [] };
  const el = () => ({
    set textContent(v) { }, get textContent() { return ''; },
    set innerHTML(v) {
      const m = [...String(v).matchAll(/data-name="([^"]+)"/g)].map(x => x[1]);
      if (m.length) captured.names = m;
    },
    classList: { add() { }, remove() { } }, style: {}, querySelectorAll: () => []
  });
  const sb = {
    console, Object, Array, String, Number, JSON,
    STORES: STORES.slice(),
    loginLocation: null,
    getEmployees: () => JSON.parse(JSON.stringify(EMPS)),
    t: (ja) => ja,
    escapeHtml: (s) => String(s),
    empGrade: () => 'G1',
    document: {
      getElementById: () => el(),
      querySelectorAll: () => [],
      createElement: () => el()
    }
  };
  /* 実関数から people の絞り込みだけを取り出して評価する。
     描画部分は DOM 依存が強いので、フィルタ式そのものを実行する。 */
  const fn = grab(src, 'loginPickLocation');
  const body = fn.slice(fn.indexOf('{') + 1);
  const cut = body.indexOf('var locLabel');
  const filterOnly = 'function _pick(loc){ var people;' + body.slice(0, cut) + ' return people; }';
  vm.createContext(sb);
  vm.runInContext(filterOnly, sb);
  return sb._pick(loc).map(e => e.name);
}

console.log('\n===== テスト1: 症状再現（配属店舗=Office が反映されない） =====');
{
  const o = run(OLD, 'OFFICE');
  ok(o.indexOf('Office New Crew') < 0, "v775: role='crew' + 配属Office の人が出ない");
  ok(o.indexOf('Office Leader') < 0, "v775: role='sl' + 配属Office も出ない");
  ok(o.indexOf('Office G4') < 0, "v775: role='g4' + 配属Office も出ない");
  ok(o.indexOf('Marcia Kodama') >= 0, 'v775: 役職が office の人は出ていた');
}

console.log('\n===== テスト2: 症状再現（店舗側にも出ない＝どこからも入れない） =====');
{
  let found = false;
  STORES.forEach(s => { if (run(OLD, s.id).indexOf('Office New Crew') >= 0) found = true; });
  ok(!found, 'v775: 店舗側の一覧にも出ない（store が OFFICE のため）');
}

console.log('\n===== テスト3: v776 で出るようになる =====');
{
  const n = run(SRC, 'OFFICE');
  ok(n.indexOf('Office New Crew') >= 0, '配属Office の crew が出る');
  ok(n.indexOf('Office Leader') >= 0, '配属Office の sl が出る');
  ok(n.indexOf('Office G4') >= 0, '配属Office の g4 が出る');
}

console.log('\n===== テスト4: 従来の候補は変わらない =====');
{
  const n = run(SRC, 'OFFICE');
  ['Tac Tsutsumi', 'Moto Kubota', 'Marcia Kodama', 'Akane Yoshizawa', 'Chikayoshi Nishihara']
    .forEach(x => ok(n.indexOf(x) >= 0, x + ' は従来どおり出る'));
}

console.log('\n===== テスト5: 退職・無効は除外 =====');
{
  const n = run(SRC, 'OFFICE');
  ok(n.indexOf('Retired Office') < 0, '退職者は出ない');
  ok(n.indexOf('Disabled Office') < 0, '無効(osDisabled)は出ない');
}

console.log('\n===== テスト6: 店舗側の一覧は変えていない =====');
{
  const a = run(OLD, 'F01').sort().join(','), b = run(SRC, 'F01').sort().join(',');
  ok(a === b, 'F01 の候補が v775 と同じ（' + b + '）');
  ok(run(SRC, 'F01').indexOf('Support Crew') >= 0, 'サポート店舗の人は従来どおり出る');
  ok(run(SRC, 'F01').indexOf('Office New Crew') < 0, '配属Office の人が店舗側に混ざらない');
}

console.log('\n===== テスト7: 表記 =====');
{
  ok(SRC.indexOf("></i>Office</div>`;") >= 0, '所属ボタンが Office');
  ok(SRC.indexOf("loc==='OFFICE' ? 'Office' :") >= 0, 'スタッフ選択の見出しが Office');
  const seg = SRC.slice(SRC.indexOf('function loginPickLocation'), SRC.indexOf('function loginPickLocation') + 3000);
  ok(seg.indexOf("t('本部','Head Office')") < 0, 'ログイン画面に「本部」表記が残っていない');
  ok(OLD.indexOf("t('本部','Head Office')") >= 0, 'v775 では「本部」だった');
}

console.log('\n===== テスト8: Office ログイン後の curStore（ページゲートに掛かるか） =====');
{
  /* ページゲートは curStore==='OFFICE' で判定する（8538行）。
     しかしログインの2経路はどちらも loginLocation==='OFFICE' のとき curStore='ALL' にする。
     つまり Office からログインした人は、そもそもゲートに掛からない。 */
  ok(SRC.indexOf("if (loginLocation==='OFFICE') {\r\n    curStore = 'ALL';") >= 0,
    'finishStaffLogin: Office ログインは curStore=ALL');
  ok(SRC.indexOf("if (loginLocation==='OFFICE') curStore = 'ALL';") >= 0,
    'もう一方のログイン経路も curStore=ALL');
  ok(SRC.indexOf("var showOffice = ['ceo','gm','office','office_crew'].includes(curRole);") >= 0,
    '店舗切替で OFFICE を選べるのは ceo/gm/office/office_crew のみ');
  ok(SRC.indexOf("var showOffice = ['ceo','gm','office','office_crew','chef']") < 0,
    'chef は店舗切替で OFFICE を選べない → curStore が OFFICE になる経路が無い');
  ok(SRC.indexOf("if (curStore === 'OFFICE' && OFFICE_OK_PAGES.indexOf(page) < 0)") >= 0,
    'ゲートの条件は curStore（role ではない）');
}

console.log('\n===== 結果: PASS ' + pass + ' / FAIL ' + fail + ' =====');
if (fail) process.exit(1);
console.log('===== 全テスト PASS =====\n');
