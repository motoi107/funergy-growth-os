/* v724 日次食材差異(1画面版) — 自動テスト（実コードをモック環境で実行） */
const fs = require('fs');
const vm = require('vm');

/* ---- モック環境 ---- */
const store = {};
const ctx = {
  console, Math, Date, JSON, Object, Array, Number, String, isFinite, parseInt, parseFloat,
  window: {},
  localStorage: null,
  ls: (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d),
  lsSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); return true; },
  t: (ja, en) => ja,
  escapeHtml: (s) => String(s == null ? '' : s),
  showToast: () => {},
  openModal: () => {},
  closeModalDirect: () => {},
  renderPage: () => {},
  pageSyncStrip: () => '',
  myName: () => 'Tester',
  nowJP: () => '2026/7/25 10:00',
  bizNow: () => new Date(2026, 6, 25, 12, 0, 0),   /* HST営業日モック */
  curPage: 'fv_variance', curRole: 'gm', curPage2: '',
  ROLE_CONFIG: { gm: { financial: true }, sl: { financial: false }, crew: { financial: false } },
  myGradeNum: () => 6,
  TOTOYA_STORE_IDS: ['F04-K', 'F04-P', 'F04-A'],
  getStoresAll: () => [
    { id: 'F01', name: 'ToriTon', active: true },
    { id: 'F04-K', name: 'Kaimuki', active: true, toastGuid: 'G-K' },
    { id: 'F04-P', name: 'Piikoi', active: true, toastGuid: 'G-P' },
    { id: 'F04-A', name: 'Aiea', active: true, toastGuid: 'G-A' },
  ],
  getVisibleStores: () => ctx.getStoresAll(),
  getIngredients: () => [
    { code: 6034, name: 'まぐろ 冷凍ミンチ', unit: 'g', vendor: 'Tropic', price: 4.95, qty: 454, yield: 100 },
    { code: 6006, name: 'いくら JFC', unit: 'g', vendor: 'JFC', price: 38.0, qty: 500, yield: 100 },
    { code: 6045, name: 'ずわいがにJFC', unit: 'g', vendor: 'JFC', price: 46.0, qty: 454, yield: 100 },
    { code: 6030, name: 'まぐろ Mgr Int', unit: '-', vendor: 'Maguro Int', price: 18.0, qty: 0, yield: 100 },
  ],
  ingUnitCost: (i) => i.price / (i.qty * ((i.yield != null ? i.yield : 100) / 100)),
  getRecipes: () => [],
  getIngTransfers: () => ctx.__transfers || [],
  fetchToastItemSales: () => Promise.resolve([]),
  document: { getElementById: () => null, querySelectorAll: () => [] },
  confirm: () => true,
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('/home/claude/fv_module_v724.js', 'utf8'), ctx);

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, '\n    got :', JSON.stringify(got), '\n    want:', JSON.stringify(want)); }
}

/* ---- 共通セットアップ: レシピ（テスト専用データ。本番登録はしない） ---- */
function setupConfig() {
  for (const k of Object.keys(store)) delete store[k];
  const cfg = ctx.fvDefaultConfig();
  cfg.ings.tuna.code = 6034;                                   /* まぐろ→マスタ6034(単価 $4.95/454g) */
  cfg.recipes = {
    r1: { id: 'r1', guid: 'GUID_AHI',   name: 'Ahi Bowl',     fvId: 'tuna', g: 40, kind: 'base',   storeG: {}, from: '', to: '', active: true, editedAt: '2026-07-01T00:00:00Z' },
    r2: { id: 'r2', guid: 'GUID_NISH',  name: 'Nishiki Bowl', fvId: 'tuna', g: 20, kind: 'base',   storeG: {}, from: '', to: '', active: true, editedAt: '2026-07-01T00:00:00Z' },
    r3: { id: 'r3', guid: 'GUID_EXTRA', name: 'Extra Tuna',   fvId: 'tuna', g: 15, kind: 'add',    storeG: {}, from: '', to: '', active: true, editedAt: '2026-07-01T00:00:00Z' },
    r4: { id: 'r4', guid: 'GUID_NOTNA', name: 'No Tuna',      fvId: 'tuna', g: 20, kind: 'remove', storeG: {}, from: '', to: '', active: true, editedAt: '2026-07-01T00:00:00Z' },
  };
  store['fv_config'] = cfg;
  return cfg;
}

console.log('== 1) 仕様テストケース: 理論600g / 実1,000g / 総差異+400g / 原因不明+350g ==');
{
  setupConfig();
  const sid = 'F04-K', date = '2026-07-24', prev = '2026-07-23';
  /* Toast出数(日次): Ahi 10, Nishiki 10 */
  const rows = [
    { business_date: date, item_guid: 'GUID_AHI', qty: 10 },
    { business_date: date, item_guid: 'GUID_NISH', qty: 10 },
  ];
  const cache = ctx.fvBuildSalesCache(rows, ctx.fvRecipeGuidSet(store['fv_config']));
  store[ctx.fvSalesKey(sid, '2026-07')] = { fp: ctx.fvSalesFp(store['fv_config']), d: cache, at: 'x' };
  /* 棚卸: 前日終了=2000g(開始へ自動反映) / 当日終了=2000g */
  ctx.fvSaveCount(sid, prev, 'tuna', { packs: 0, packG: 0, openG: 2000, locs: [], tareG: 0 });
  ctx.fvSaveCount(sid, date, 'tuna', { packs: 0, packG: 0, openG: 2000, locs: [], tareG: 0 });
  /* 入荷1000g、廃棄50g */
  ctx.fvAddMove(sid, date, 'tuna', 'in', 1000, 'テスト入荷');
  ctx.fvAddMove(sid, date, 'tuna', 'waste', 50, 'テスト廃棄');
  const day = ctx.fvSalesFor(sid, date);
  const theo = ctx.fvTheoreticalDay(sid, date, day, store['fv_config']).tuna;
  eq('理論消費 = 600g', ctx.fvG(theo.dg), 600);
  const v = ctx.fvVarianceDay(sid, date, 'tuna', theo, ctx.fvGetConfig());
  eq('開始在庫(前日終了の自動反映) = 2000g', ctx.fvG(v.startDg), 2000);
  eq('実消費 = 1000g', ctx.fvG(v.actDg), 1000);
  eq('総差異 = +400g', ctx.fvG(v.totalDiffDg), 400);
  eq('登録済み廃棄 = 50g', ctx.fvG(v.knownDg), 50);
  eq('原因不明差異 = +350g', ctx.fvG(v.unexplainedDg), 350);
  eq('差異率 = 350/600*100 (58.33…%)', Math.round(v.pct * 100) / 100, 58.33);
  /* 推定損失: $4.95/454g = 0.01090…/g × 350g → セント丸め */
  const perG = 4.95 / 454;
  eq('推定損失 = 350g×単価(セント丸め)', v.lossCents, Math.round(350 * perG * 100));
  eq('赤判定(既定: 20%以上 かつ 量100g以上)', v.level, 'red');
}

console.log('== 2) Void商品が除外される ==');
{
  setupConfig();
  const rows = [
    { business_date: '2026-07-24', item_guid: 'GUID_AHI', qty: 10 },
    { business_date: '2026-07-24', item_guid: 'GUID_AHI', qty: 3, voided: true },
    { business_date: '2026-07-24', item_guid: 'GUID_AHI', qty: 2, is_refund: true },
  ];
  const c = ctx.fvBuildSalesCache(rows, ctx.fvRecipeGuidSet(store['fv_config']));
  eq('void/返金行を除外して qty=10', c['2026-07-24'].g['GUID_AHI'], 10);
}

console.log('== 3) Extra topping 加算 / No topping 減算 / 数量2個以上 ==');
{
  setupConfig();
  const day = { g: { GUID_AHI: 3, GUID_EXTRA: 2, GUID_NOTNA: 4 }, tq: 9, n: 3 };
  const theo = ctx.fvTheoreticalDay('F04-K', '2026-07-24', day, store['fv_config']).tuna;
  /* 3×40 + 2×15 - 4×20 = 120+30-80 = 70g */
  eq('base+add-remove = 70g', ctx.fvG(theo.dg), 70);
}

console.log('== 4) 店舗別上書き(共通設定と店舗別設定) ==');
{
  const cfg = setupConfig();
  cfg.recipes.r1.storeG = { 'F04-P': 45 };
  store['fv_config'] = cfg;
  const day = { g: { GUID_AHI: 2 }, tq: 2, n: 1 };
  eq('Kaimuki=共通40g×2=80g', ctx.fvG(ctx.fvTheoreticalDay('F04-K', '2026-07-24', day, cfg).tuna.dg), 80);
  eq('Piikoi=上書き45g×2=90g', ctx.fvG(ctx.fvTheoreticalDay('F04-P', '2026-07-24', day, cfg).tuna.dg), 90);
}

console.log('== 5) 店舗間移動の入出が一致(既存 ingredient_transfers 自動取込) ==');
{
  setupConfig();
  ctx.__transfers = [{ id: 'it_1', date: '2026-07-24', from: 'F04-K', to: 'F04-P', code: 6034, name: 'まぐろ 冷凍ミンチ', qty: 300, unit: 'g' }];
  const outK = ctx.fvAutoTransfers('F04-K', '2026-07-24', store['fv_config']);
  const inP = ctx.fvAutoTransfers('F04-P', '2026-07-24', store['fv_config']);
  eq('Kaimuki 側 = xfer_out 300g', [outK.length, outK[0].type, ctx.fvG(outK[0].dg)], [1, 'xfer_out', 300]);
  eq('Piikoi 側 = xfer_in 300g', [inP.length, inP[0].type, ctx.fvG(inP[0].dg)], [1, 'xfer_in', 300]);
  eq('入出の重量が一致', outK[0].dg, inP[0].dg);
  ctx.__transfers = [];
}

console.log('== 6) レシピ変更前の過去データが変わらない(有効日付き) ==');
{
  const cfg = setupConfig();
  /* 7/25 から Ahi の使用量を 40g→50g に変更（旧行に終了日・新行に開始日） */
  cfg.recipes.r1.to = '2026-07-24';
  cfg.recipes.r1b = { id: 'r1b', guid: 'GUID_AHI', name: 'Ahi Bowl', fvId: 'tuna', g: 50, kind: 'base', storeG: {}, from: '2026-07-25', to: '', active: true, editedAt: '2026-07-25T00:00:00Z' };
  store['fv_config'] = cfg;
  const day = { g: { GUID_AHI: 10 }, tq: 10, n: 1 };
  eq('過去日(7/24)は旧40g→400g のまま', ctx.fvG(ctx.fvTheoreticalDay('F04-K', '2026-07-24', day, cfg).tuna.dg), 400);
  eq('新日(7/25)は新50g→500g', ctx.fvG(ctx.fvTheoreticalDay('F04-K', '2026-07-25', day, cfg).tuna.dg), 500);
}

console.log('== 7) Totoya以外では機能が有効にならない ==');
{
  setupConfig();
  eq('F01(ToriTon)は無効', ctx.fvStoreEnabled('F01'), false);
  eq('F04-Kは有効', ctx.fvStoreEnabled('F04-K'), true);
  eq('表示店舗はTotoya 3店のみ', ctx.fvVisibleStores().map(s => s.id), ['F04-K', 'F04-P', 'F04-A']);
  /* 存在しない店舗IDを設定しても店舗マスタ照合で除外される */
  const cfg = ctx.fvGetConfig(); cfg.stores = ['F99-X']; store['fv_config'] = cfg;
  eq('実在しない店舗IDは既定(Totoya3店)へフォールバック', ctx.fvGetConfig().stores, ['F04-K', 'F04-P', 'F04-A']);
}

console.log('== 8) HSTの営業日を使用(既定日付=HST前日) ==');
{
  setupConfig();
  eq('fvCurDate = bizNow(HST) の前日', ctx.fvCurDate(), '2026-07-24');
}

console.log('== 9) 同じToastデータを再同期しても二重計上されない ==');
{
  setupConfig();
  const rows = [
    { business_date: '2026-07-24', item_guid: 'GUID_AHI', qty: 10 },
    { business_date: '2026-07-24', item_guid: 'GUID_NISH', qty: 7 },
    { item_guid: 'GUID_AHI', qty: 999 },                     /* 旧・月次集計行(日付なし)は日次計算に使わない */
  ];
  const gs = ctx.fvRecipeGuidSet(store['fv_config']);
  const a = ctx.fvBuildSalesCache(rows, gs);
  const b = ctx.fvBuildSalesCache(rows, gs);                 /* 再同期＝再構築(加算ではなく置換) */
  eq('再構築は冪等(同一結果)', a, b);
  eq('日付なし(旧月次)行は除外', a['2026-07-24'].g['GUID_AHI'], 10);
}

console.log('== 10) データ未完成 → 差異を確定しない(誤アラート防止) ==');
{
  setupConfig();
  const sid = 'F04-K', date = '2026-07-24';
  const day = { g: { GUID_AHI: 10 }, tq: 10, n: 1 };
  /* 棚卸なし */
  let v = ctx.fvVarianceDay(sid, date, 'tuna', ctx.fvTheoreticalDay(sid, date, day, store['fv_config']).tuna, ctx.fvGetConfig());
  eq('棚卸なし → incomplete / 差異null', [v.level, v.unexplainedDg], ['incomplete', null]);
  /* レシピ未設定食材(salmon: 行なし) */
  ctx.fvSaveCount(sid, '2026-07-23', 'salmon', { packs: 0, packG: 0, openG: 500, locs: [], tareG: 0 });
  ctx.fvSaveCount(sid, date, 'salmon', { packs: 0, packG: 0, openG: 400, locs: [], tareG: 0 });
  const theoS = ctx.fvTheoreticalDay(sid, date, day, store['fv_config']).salmon;
  v = ctx.fvVarianceDay(sid, date, 'salmon', theoS, ctx.fvGetConfig());
  eq('レシピ未設定 → incomplete(理由に含む)', [v.level, v.incomplete.some(x => x.indexOf('レシピ未設定') >= 0)], ['incomplete', true]);
  /* 単価未設定(salmonは code=6022 だがモックマスタに無い) */
  eq('単価未設定も理由に含む', v.incomplete.some(x => x.indexOf('単価未設定') >= 0), true);
}

console.log('== 11) 棚卸合計の計算(パック+開封+場所別-風袋)・0.1g整数で誤差なし ==');
{
  setupConfig();
  const e = { packs: 3, packG: 500, openG: 123.4, locs: [{ n: '冷蔵', g: 33.3 }, { n: '冷凍', g: 33.3 }, { n: '仕込', g: 33.3 }], tareG: 20.5 };
  /* 1500 + 123.4 + 99.9 - 20.5 = 1702.8g → 17028dg (浮動小数点誤差なし) */
  eq('合計 = 17028 decigram (1702.8g)', ctx.fvCountTotalDg(e), 17028);
  eq('0.1g×3の加算が正確(33.3×3=99.9)', ctx.fvDg(33.3) * 3, 999);
}

console.log('== 12) 少量販売の率暴れ防止(率が高くても量・額が最小未満なら判定しない) ==');
{
  setupConfig();
  const sid = 'F04-K', date = '2026-07-24';
  const rows = [{ business_date: date, item_guid: 'GUID_AHI', qty: 1 }];   /* 理論40g */
  store[ctx.fvSalesKey(sid, '2026-07')] = { fp: ctx.fvSalesFp(store['fv_config']), d: ctx.fvBuildSalesCache(rows, ctx.fvRecipeGuidSet(store['fv_config'])), at: 'x' };
  ctx.fvSaveCount(sid, '2026-07-23', 'tuna', { packs: 0, packG: 0, openG: 100, locs: [], tareG: 0 });
  ctx.fvSaveCount(sid, date, 'tuna', { packs: 0, packG: 0, openG: 40, locs: [], tareG: 0 });
  /* 実60g vs 理論40g → +20g(+50%) だが 量20g<100g かつ 損失<$5 → OK判定 */
  const theo = ctx.fvTheoreticalDay(sid, date, ctx.fvSalesFor(sid, date), store['fv_config']).tuna;
  const v = ctx.fvVarianceDay(sid, date, 'tuna', theo, ctx.fvGetConfig());
  eq('+50%でも量・額が最小未満 → OK', [ctx.fvG(v.unexplainedDg), v.level], [20, 'ok']);
}

console.log('== 13) マージ: 棚卸(セル単位・新しい方) / 入出庫(id和集合+論理削除) / 設定(エントリ単位) ==');
{
  const A = { '2026-07-24': { tuna: { openG: 100, editedAt: '2026-07-24T01:00:00Z' }, uni: { openG: 5, editedAt: '2026-07-24T01:00:00Z' } } };
  const B = { '2026-07-24': { tuna: { openG: 200, editedAt: '2026-07-24T02:00:00Z' } }, '2026-07-25': { ikura: { openG: 9, editedAt: 'x' } } };
  const m = ctx.mergeFvCellMap(A, B);
  eq('新しい編集が勝ち・他セルは和集合', [m['2026-07-24'].tuna.openG, m['2026-07-24'].uni.openG, m['2026-07-25'].ikura.openG], [200, 5, 9]);
  eq('covers: 片方が古ければ false', ctx._coversFvCellMap(A, B), false);
  eq('covers: マージ結果は両方をカバー', ctx._coversFvCellMap(m, A) && ctx._coversFvCellMap(m, B), true);

  const M1 = { '2026-07-24': [{ id: 'a', dg: 100, editedAt: '2026-07-24T01:00:00Z' }, { id: 'b', dg: 50, editedAt: '2026-07-24T01:00:00Z' }] };
  const M2 = { '2026-07-24': [{ id: 'a', dg: 100, _deleted: true, editedAt: '2026-07-24T02:00:00Z' }, { id: 'c', dg: 30, editedAt: '2026-07-24T01:30:00Z' }] };
  const mm = ctx.mergeFvMoves(M1, M2);
  const ids = mm['2026-07-24'].map(r => r.id + (r._deleted ? '(del)' : '')).sort();
  eq('id和集合・削除は復活しない', ids, ['a(del)', 'b', 'c']);

  const C1 = { editedAt: '2026-07-24T01:00:00Z', ings: { tuna: { code: 6034, editedAt: '2026-07-24T01:00:00Z' } }, recipes: { r1: { g: 40, editedAt: '2026-07-24T01:00:00Z' } }, alerts: { def: {} }, stores: ['F04-K'] };
  const C2 = { editedAt: '2026-07-24T02:00:00Z', ings: {}, recipes: { r2: { g: 20, editedAt: '2026-07-24T02:00:00Z' } }, alerts: { def: {} }, stores: ['F04-K', 'F04-P'] };
  const mc = ctx.mergeFvConfig(C1, C2);
  eq('設定マージ: 新しい全体+古い側のエントリも保持', [!!mc.ings.tuna, !!mc.recipes.r1, !!mc.recipes.r2, mc.stores.length], [true, true, true, 2]);
}

console.log('== 14) 権限ゲート ==');
{
  setupConfig();
  ctx.curRole = 'crew'; ctx.myGradeNum = () => 1;
  eq('G1(Crew)は閲覧不可', ctx.fvCanView(), false);
  ctx.myGradeNum = () => 2;
  eq('G2は閲覧+入力可 / 管理不可', [ctx.fvCanView(), ctx.fvCanInput(), ctx.fvCanManage(), ctx.fvCanConfig()], [true, true, false, false]);
  ctx.myGradeNum = () => 4;
  eq('G4は管理可 / 設定不可', [ctx.fvCanManage(), ctx.fvCanConfig()], [true, false]);
  ctx.myGradeNum = () => 5;
  eq('G5(AM)は設定可', ctx.fvCanConfig(), true);
  ctx.curRole = 'gm'; ctx.myGradeNum = () => 6;
}

console.log('== 15) 1画面レンダリング と 再描画ループが起きないこと ==');
{
  setupConfig();
  const sid='F04-K', ym='2026-07';
  store[ctx.fvSalesKey(sid, ym)] = { fp: ctx.fvSalesFp(store['fv_config']), d: {}, at: 'x' };
  let rp=0; ctx.renderPage=()=>{rp++;};
  let fetches=0; ctx.fetchToastItemSales=()=>{fetches++; return Promise.resolve([]);};
  const html = ctx.renderFvVariance();
  eq('1画面にタブが無く、前日/使用量/当日カウントが並ぶ',
     ['前日カウント','使用量','当日カウント','予定残'].every(w => html.indexOf(w) >= 0), true);
  eq('描画中に renderPage が呼ばれない(ループなし)', rp, 0);
  eq('キャッシュありなら fetch しない', fetches, 0);
  ctx.fvEnsureSales(sid, ym);
  eq('fvEnsureSales もキャッシュありなら何もしない', [rp, fetches], [0, 0]);
  delete store[ctx.fvSalesKey(sid, ym)];
  ctx.fvEnsureSales(sid, ym); ctx.fvEnsureSales(sid, ym);
  eq('キャッシュ無しでも取得は1回だけ', fetches, 1);
  ctx._fvView='config'; eq('設定はビュー切替で開く', ctx.renderFvVariance().indexOf('業者') >= 0, true);
  ctx._fvView='main';
  ctx.renderPage=()=>{};
}

console.log('== 16) 7日集計(オンデマンド)が例外なく計算される ==');
{
  setupConfig();
  let modalHtml=''; ctx.openModal=(h)=>{modalHtml=h;};
  ctx.fvOpenSummary('F04-K', '2026-07-24');
  eq('7日集計モーダルがHTMLを生成', modalHtml.indexOf('7日集計') >= 0, true);
  ctx.fvOpenMove('F04-K', '2026-07-24', 'tuna');
  eq('入出庫モーダルが食材ごとに開く', modalHtml.indexOf('入出庫') >= 0, true);
  ctx.openModal=()=>{};
}

console.log('== 17) 予定残 = 前日 + 入出庫 - 使用量 - 廃棄等 / 差 = 予定残 - 当日カウント ==');
{
  setupConfig();
  const sid='F04-K', date='2026-07-24', prev='2026-07-23';
  const rows=[{business_date:date,item_guid:'GUID_AHI',qty:10},{business_date:date,item_guid:'GUID_NISH',qty:10}];
  store[ctx.fvSalesKey(sid,'2026-07')]={fp:ctx.fvSalesFp(store['fv_config']),d:ctx.fvBuildSalesCache(rows,ctx.fvRecipeGuidSet(store['fv_config'])),at:'x'};
  ctx.fvSaveCount(sid, prev, 'tuna', {packs:0,packG:0,openG:2000,locs:[],tareG:0});
  ctx.fvAddMove(sid, date, 'tuna', 'in', 1000, '');
  ctx.fvAddMove(sid, date, 'tuna', 'waste', 50, '');
  /* 当日カウント未入力でも予定残は出る */
  let theo=ctx.fvTheoreticalDay(sid,date,ctx.fvSalesFor(sid,date),store['fv_config']).tuna;
  let v=ctx.fvVarianceDay(sid,date,'tuna',theo,ctx.fvGetConfig());
  eq('当日カウント前でも予定残 = 2000+1000-600-50 = 2350g', ctx.fvG(v.expectedDg), 2350);
  eq('当日カウント未入力なら判定は保留', v.level, 'incomplete');
  /* 当日カウント 2000g → 差 +350g（従来式と一致） */
  ctx.fvSaveCount(sid, date, 'tuna', {packs:0,packG:0,openG:2000,locs:[],tareG:0});
  theo=ctx.fvTheoreticalDay(sid,date,ctx.fvSalesFor(sid,date),store['fv_config']).tuna;
  v=ctx.fvVarianceDay(sid,date,'tuna',theo,ctx.fvGetConfig());
  eq('差 = 予定残2350 - 当日2000 = +350g', ctx.fvG(v.expectedDg - v.endDg), 350);
  eq('従来式(原因不明差異)と完全一致', ctx.fvG(v.unexplainedDg), 350);
  /* 予定どおりカウントされたら正常 */
  ctx.fvSaveCount(sid, date, 'tuna', {packs:0,packG:0,openG:2350,locs:[],tareG:0});
  theo=ctx.fvTheoreticalDay(sid,date,ctx.fvSalesFor(sid,date),store['fv_config']).tuna;
  v=ctx.fvVarianceDay(sid,date,'tuna',theo,ctx.fvGetConfig());
  eq('当日=予定残なら差0・正常判定', [ctx.fvG(v.unexplainedDg), v.level], [0, 'ok']);
}

console.log('== 18) 食材を業者から検索できる ==');
{
  setupConfig();
  eq('業者一覧はg単位食材から作られる(単位-のMaguro Intは出ない)', ctx.fvVendorList(), ['JFC','Tropic']);
  const all=ctx.fvIngOptionsHtml('', '', null);
  eq('業者すべて → g単位の3件が候補', (all.match(/<option value="6/g)||[]).length, 3);
  const jfc=ctx.fvIngOptionsHtml('JFC', '', null);
  eq('業者JFCで絞ると2件', (jfc.match(/<option value="6/g)||[]).length, 2);
  eq('JFC絞込みにTropicの6034は含まれない', jfc.indexOf('value="6034"') < 0, true);
  eq('候補に業者名が併記される', jfc.indexOf('JFC') >= 0, true);
  const q=ctx.fvIngOptionsHtml('', 'ずわい', null);
  eq('名前で検索できる', (q.match(/<option value="6/g)||[]).length, 1);
  const q2=ctx.fvIngOptionsHtml('', '6034', null);
  eq('コードでも検索できる', q2.indexOf('value="6034"') >= 0, true);
  const keep=ctx.fvIngOptionsHtml('JFC', 'ずわい', 6034);
  eq('選択中の食材は絞込みで消えない', keep.indexOf('value="6034"') >= 0, true);
}

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
