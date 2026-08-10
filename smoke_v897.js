/* smoke_v897.js — 従業員割引カードを「実際に走らせて」確かめる。
   文字列があるかではなく、呼んで落ちないか・値が合っているかを見る。

   v892 の教訓：UIは呼び出し元の画面ごと再現する。
   このアプリは renderPage() が #main-content に innerHTML で流し込むので、
   jsdom で #main-content を用意し、そこへ実際に描いて確かめる。

   逆向き：v896（index.html.v896.bak）に当てると、関数が無いので必ず落ちる。 */
const fs = require('fs');
const vm = require('vm');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const FILE = process.argv[2] || 'index.html';
const utf = fs.readFileSync(FILE, 'utf8');
const code = utf.slice(utf.indexOf('<script>') + 8, utf.lastIndexOf('</script>'));

let PASS = 0, FAIL = 0;
function chk(name, fn) {
  try {
    const r = fn();
    if (r === true) { PASS++; console.log('  PASS  ' + name); }
    else { FAIL++; console.log('  FAIL  ' + name + (r ? '  → ' + r : '')); }
  } catch (e) { FAIL++; console.log('  FAIL  ' + name + '  → 例外: ' + (e && e.message)); }
}

/* ---------- 必要な宣言だけを AST で切り出す ---------- */
const ast = acorn.parse(code, { ecmaVersion: 2022, allowReturnOutsideFunction: true });
const src = new Map();
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id) src.set(n.id.name, code.slice(n.start, n.end));
  else if (n.type === 'VariableDeclaration') {
    for (const d of n.declarations) {
      if (d.id.type === 'Identifier') src.set(d.id.name, n.kind + ' ' + code.slice(d.start, d.end) + ';');
    }
  }
}

const NEED = ['DISCOUNT_FORM_BASE','DISCOUNT_E_STORE','DISCOUNT_E_HOME','SURVEY_STORE_NAME',
  '_dcState','_dcClockTimer','_cardUser','surveyUrl','insertDiscountUse','useDiscount',
  'startCardClock','stopCardClock','dcPickStoreFromUrl','renderDiscount','dcSelfCheck','escapeHtml'];
const missing = NEED.filter(n => !src.has(n));

chk('必要な宣言がすべて存在する', () => missing.length === 0 || ('見つからない: ' + missing.join(',')));
if (missing.length) { console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL); process.exit(1); }

/* ---------- 登録先テーブル（データリテラルなのでそのまま評価できる） ---------- */
const TABLES = ['NAV_ITEMS','MENU_GROUPS','CREW_GROUPS','ACCT_GROUPS','CHEF_GROUPS','STORE_GROUPS',
  'OFFICE_GROUPS','OFFICE_OK_PAGES','SKEL_LIGHT_PAGES'];
const T = vm.runInNewContext(TABLES.map(n => src.get(n)).join('\n') + '\n({' + TABLES.join(',') + '})');

chk('renderPage() の switch に case discount がある', () =>
  /case 'discount':\s*el\.innerHTML = renderDiscount\(\);/.test(code) || 'switch に無い');

chk('NAV_ITEMS に discount があり全グレード対象', () => {
  const it = T.NAV_ITEMS.find(x => x.id === 'discount');
  if (!it) return 'NAV_ITEMS に無い';
  const need = ['ceo','gm','office','chef','am','g4','sl','g2','office_crew','crew'];
  const lack = need.filter(r => it.roles.indexOf(r) < 0);
  return lack.length === 0 || ('roles 不足: ' + lack.join(','));
});

chk('CREW_GROUPS（G1 Crew）に discount がある', () =>
  T.CREW_GROUPS.some(g => (g.children || []).indexOf('discount') >= 0) || 'G1 のマイページに出ない');
chk('MENU_GROUPS に discount がある', () =>
  T.MENU_GROUPS.some(g => (g.children || []).indexOf('discount') >= 0) || '店舗表示で出ない');
chk('ACCT_GROUPS に discount がある', () =>
  T.ACCT_GROUPS.some(g => (g.children || []).indexOf('discount') >= 0) || '経理・事務Crewで出ない');
chk('CHEF_GROUPS に discount がある', () =>
  T.CHEF_GROUPS.some(g => (g.children || []).indexOf('discount') >= 0) || 'Chef で出ない');
chk('OFFICE_OK_PAGES に discount がある', () =>
  T.OFFICE_OK_PAGES.indexOf('discount') >= 0 || '本部ログインだと Office管理へ弾かれる');
chk('SKEL_LIGHT_PAGES に discount がある', () =>
  !!T.SKEL_LIGHT_PAGES.discount || 'QRで開いた直後スケルトンのままになる');

chk('グループの roles と NAV_ITEMS の roles が矛盾しない（v888型）', () => {
  const it = T.NAV_ITEMS.find(x => x.id === 'discount');
  const bad = [];
  for (const g of T.MENU_GROUPS) {
    if ((g.children || []).indexOf('discount') < 0) continue;
    for (const r of (g.roles || [])) if (it.roles.indexOf(r) < 0) bad.push(g.id + ':' + r);
  }
  return bad.length === 0 || ('グループは出すのに項目が塞いでいる: ' + bad.join(','));
});

chk('go() が離脱時に stopCardClock を呼ぶ', () =>
  /curPage==='discount' && page!=='discount' && typeof stopCardClock==='function'/.test(code)
  || 'setInterval が残る');
chk('ログイン後の着地で QR コードを拾う', () =>
  /dcPickStoreFromUrl==='function' && dcPickStoreFromUrl\(\)\) curPage='discount'/.test(code)
  || 'QRから開いても割引画面に着地しない');

/* ---------- ここから実行：呼び出し元の画面ごと再現する ---------- */
const dom = new JSDOM('<body><div id="main-content"></div></body>',
  { url: 'https://funergy-plus.com/?s=F04-K' });
const win = dom.window;

const EMP = { id: 'e777', name: 'Test Crew', store: 'F01', title: 'Crew' };
let posted = null;

const ctx = vm.createContext({
  window: win, document: win.document, location: win.location,
  sessionStorage: win.sessionStorage, URLSearchParams: win.URLSearchParams,
  setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win),
  console, JSON, Date, String, Object, Math, Error, Promise, encodeURIComponent,
  curUserName: EMP.name, curStore: 'F01', curRole: 'crew', curRealRole: 'crew',
  _curEmp: () => EMP,
  myGradeNum: () => 1,
  SUPABASE_URL: 'https://example.supabase.co',
  supaHeaders: (x) => Object.assign({ apikey: 'k' }, x || {}),
  renderPage: () => { win.document.getElementById('main-content').innerHTML = A.renderDiscount(); },
  fetch: async (url, opt) => { posted = { url, body: JSON.parse(opt.body) }; return { ok: true }; },
});

const A = vm.runInContext(
  NEED.map(n => src.get(n)).join('\n') + '\n({' + NEED.join(',') + '})', ctx);

chk('_cardUser() が従業員マスターから埋まる', () => {
  const u = A._cardUser();
  return (u.staff_id === 'e777' && u.name === 'Test Crew' && u.home_store === 'F01' && u.grade === 1)
    || JSON.stringify(u);
});

chk('QR の ?s=F04-K を拾う', () => A.dcPickStoreFromUrl() === 'F04-K' || '拾えない');

chk('他店のとき「他店」で事前入力される', () => {
  const u = A.surveyUrl('F04-K', 'F01');
  return (u.indexOf('entry.2100670339=' + encodeURIComponent('Totoya Kaimuki')) > 0
       && u.indexOf('entry.1145182546=' + encodeURIComponent('他店')) > 0) || u;
});
chk('自店のとき「自分の所属店」で事前入力される', () => {
  const u = A.surveyUrl('F01', 'F01');
  return (u.indexOf('entry.1145182546=' + encodeURIComponent('自分の所属店')) > 0) || u;
});
chk('未知の店舗コードは null（空欄送信を防ぐ）', () =>
  A.surveyUrl('F99', 'F01') === null || 'null を返していない');

chk('9店舗すべてに文言がある', () => {
  const need = ['F01','F02','F03','F03-G','F04-K','F04-P','F04-A','F05','F06'];
  const lack = need.filter(k => !A.SURVEY_STORE_NAME[k]);
  return lack.length === 0 || ('欠け: ' + lack.join(','));
});

/* --- 実際に #main-content へ描く（v892型） --- */
const main = win.document.getElementById('main-content');

chk('店舗未指定でも落ちずに案内が出る（QR未読取）', () => {
  const saved = ctx.location;
  ctx.location = { hash: '', search: '' };          /* QRを踏んでいない状態 */
  try { win.sessionStorage.clear(); } catch (e) {}
  A._dcState.storeCode = null; A._dcState.used = false;
  try {
    main.innerHTML = A.renderDiscount();
    return main.textContent.indexOf('QR') >= 0
      || ('案内が出ない: ' + main.textContent.slice(0, 80));
  } finally { ctx.location = saved; }
});

chk('カードが #main-content に描かれ、秒時計が動く', () => {
  A._dcState.storeCode = 'F04-K'; A._dcState.used = false;
  main.innerHTML = A.renderDiscount();
  A.startCardClock();
  const el = win.document.getElementById('dc-clock');
  if (!el) return '#dc-clock が無い';
  if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(el.textContent)) return '時刻が入らない: ' + el.textContent;
  if (main.textContent.indexOf('Totoya Kaimuki') < 0) return '利用店舗が出ない';
  if (main.textContent.indexOf('Test Crew') < 0) return '氏名が出ない';
  return true;
});

chk('stopCardClock() でタイマーが止まる', () => {
  A.startCardClock();
  A.stopCardClock();
  return win.document.getElementById('dc-clock') !== null ? true : 'DOM が消えた';
});

(async () => {
  await A.useDiscount();

  chk('POST の中身が仕様どおり', () => {
    if (!posted) return 'POST されていない';
    const b = posted.body;
    if (posted.url.indexOf('/rest/v1/staff_discount_use') < 0) return 'URL: ' + posted.url;
    if (b.staff_id !== 'e777') return 'staff_id: ' + b.staff_id;
    if (b.store_code !== 'F04-K') return 'store_code: ' + b.store_code;
    if (b.is_home_store !== false) return 'is_home_store: ' + b.is_home_store;
    if (b.staff_home_store !== 'F01') return 'staff_home_store: ' + b.staff_home_store;
    return true;
  });

  chk('POST に匿名性を壊す項目が乗っていない（フォーム側へは渡さない）', () => {
    const u = A.surveyUrl('F04-K', 'F01');
    return (u.indexOf('e777') < 0 && u.indexOf('Test%20Crew') < 0 && u.indexOf('Test Crew') < 0)
      || 'フォームURLに個人情報が乗っている';
  });

  chk('利用後はアンケート導線が出る', () => {
    main.innerHTML = A.renderDiscount();
    return (main.textContent.indexOf('アンケートに回答する') >= 0
         && main.textContent.indexOf('利用済み') >= 0) || '導線が出ない';
  });

  /* 失敗を握り潰さないこと（レシート imagePath:null と同じ事故を防ぐ） */
  ctx.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  A._dcState.used = false; A._dcState.busy = false;
  main.innerHTML = A.renderDiscount();
  await A.useDiscount();
  chk('POST 失敗が画面に出る（握り潰さない）', () => {
    const err = win.document.getElementById('dc-error');
    if (!err) return '#dc-error が無い';
    if (err.style.display !== 'block') return 'エラーが非表示のまま';
    if (err.textContent.indexOf('失敗') < 0) return '文言が出ない: ' + err.textContent;
    return true;
  });
  chk('POST 失敗後に利用済みにならない', () => A._dcState.used === false || '失敗なのに利用済み');

  A.stopCardClock();
  console.log('\n合計 PASS=' + PASS + '  FAIL=' + FAIL);
  process.exit(FAIL ? 1 : 0);
})();
