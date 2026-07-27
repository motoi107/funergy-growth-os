/* v736: PCで変更した請求書が携帯にも反映されることを実ファイルの関数で検証 */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('/home/claude/index.html', 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n    got : ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
}

const code = [grab('_invMut'), grab('invTouch'), grab('mergeInvoices'), grab('_coversInvoices')].join('\n');
const sandbox = { console, JSON, Object, Array, String, Number, Math, Date, isFinite };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox;

/* 「PC → クラウド → 携帯」の流れを再現する */
function roundTrip(pcRec, phoneRec) {
  const cloudBefore = [phoneRec];                     /* クラウドには変更前の状態 */
  const cloudAfter = S.mergeInvoices(cloudBefore, [pcRec]);   /* PCが押し上げ */
  const onPhone = S.mergeInvoices(cloudAfter, [phoneRec]);    /* 携帯が取得してマージ */
  return { cloudAfter, onPhone };
}

console.log('== 1) 修正前の動き（用途の変更が携帯に届かない） ==');
{
  /* 修正前と同じ条件＝更新時刻がどちらも 0 の状態を作る */
  const before = { id: 'i1', vendor: 'Repair Co', purpose: '', total: 300 };
  const pc = { id: 'i1', vendor: 'Repair Co', purpose: '修繕・設備', total: 300 };   /* _mut なし */
  const r = roundTrip(pc, before);
  eq('クラウドにはPCの変更が乗る', r.cloudAfter[0].purpose, '修繕・設備');
  eq('しかし携帯では古い方が勝つ【これが今回の症状】', r.onPhone[0].purpose, '');
}

console.log('== 2) 修正後（invTouch で更新時刻が付く） ==');
{
  const before = { id: 'i1', vendor: 'Repair Co', purpose: '', total: 300 };
  const pc = S.invTouch({ id: 'i1', vendor: 'Repair Co', purpose: '修繕・設備', purposeAt: '2026/07/27 00:20', total: 300 });
  eq('更新時刻が入る', typeof pc._mut === 'number' && pc._mut > 0, true);
  eq('比較に使われる', S._invMut(pc) > S._invMut(before), true);
  const r = roundTrip(pc, before);
  eq('クラウドに乗る', r.cloudAfter[0].purpose, '修繕・設備');
  eq('携帯にも反映される', r.onPhone[0].purpose, '修繕・設備');
  eq('保存確認(covers)も通る', S._coversInvoices(r.cloudAfter, [pc]), true);
}

console.log('== 3) 逆向き（携帯で変更 → PC）も同じ ==');
{
  const before = { id: 'i2', vendor: 'Cherry', purpose: '', total: 500 };
  const phone = S.invTouch({ id: 'i2', vendor: 'Cherry', purpose: '仕入れ・仕込み', total: 500 });
  const cloudAfter = S.mergeInvoices([before], [phone]);
  const onPc = S.mergeInvoices(cloudAfter, [before]);
  eq('PC側にも反映される', onPc[0].purpose, '仕入れ・仕込み');
}

console.log('== 4) 古い時刻で新しい変更を上書きしない ==');
{
  const newer = S.invTouch({ id: 'i3', purpose: '修繕・設備' });
  const older = { id: 'i3', purpose: '', _mut: newer._mut - 10000 };
  const merged = S.mergeInvoices([newer], [older]);
  eq('新しい方が残る', merged[0].purpose, '修繕・設備');
  const merged2 = S.mergeInvoices([older], [newer]);
  eq('順序を変えても新しい方', merged2[0].purpose, '修繕・設備');
}

console.log('== 5) 確認日時(reviewedAt)しか無い旧データとも比較できる ==');
{
  const reviewed = { id: 'i4', purpose: '', reviewStatus: '確認済み', reviewedAt: '2026-07-20T10:00:00Z' };
  eq('旧データの時刻を読める', S._invMut(reviewed) > 0, true);
  const classified = S.invTouch({ id: 'i4', purpose: '備品・消耗品', reviewStatus: '確認済み', reviewedAt: '2026-07-20T10:00:00Z' });
  eq('あとから分類した方が新しい', S._invMut(classified) > S._invMut(reviewed), true);
  const merged = S.mergeInvoices([reviewed], [classified]);
  eq('分類が残る', merged[0].purpose, '備品・消耗品');
}

console.log('== 6) 削除は復活しない（従来どおり） ==');
{
  const del = S.invTouch({ id: 'i5', _deleted: true });
  const alive = S.invTouch({ id: 'i5', purpose: '仕入れ・仕込み' });
  alive._mut = del._mut + 5000;                 /* 削除より新しくても */
  const merged = S.mergeInvoices([del], [alive]);
  eq('削除が優先される', !!merged[0]._deleted, true);
}

console.log('== 7) 編集する場所すべてで時刻を押している ==');
{
  const sites = ['inv.reviewStatus=status; invTouch(inv);',
    'inv.driveMoved=true; invTouch(inv);',
    "inv.reviewStatus='確認済み'; invTouch(inv);",
    "inv.reviewStatus='差し戻し'; invTouch(inv);",
    "inv.reviewStatus='未確認'; invTouch(inv);",
    'inv.driveMoved=false; invTouch(inv);',
    'invoices[idx]._deleted=true; invTouch(invoices[idx]);'];
  sites.forEach(function (sig, i) {
    eq('編集経路' + (i + 1) + 'で時刻を押す', src.indexOf(sig) >= 0, true);
  });
  eq('一括分類でも押す', src.indexOf("v.purposeAt=nowJP(); invTouch(v);") >= 0, true);
}

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
