// v1218：アプリの中からプライバシーポリシー・サポートを開ける（App Store のガイドライン 5.1.1(i)）。
// ログインの画面の下（ログインの前）とマイページの下。言葉に合わせたページ・公開のサイトの URL（iPhone アプリでも外を指す）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const IDX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function fnSource(name) {
  const i = IDX.indexOf('function ' + name + '(');
  assert.ok(i > 0, name);
  let d = 0, j = IDX.indexOf('{', i);
  for (let k = j; k < IDX.length; k++) { if (IDX[k] === '{') d++; else if (IDX[k] === '}') { d--; if (!d) return IDX.slice(i, k + 1); } }
  throw new Error('no end ' + name);
}
function legal(lang, where) {
  const ctx = { curLang: lang };
  vm.createContext(ctx);
  vm.runInContext(IDX.match(/var LEGAL_SITE = '[^']+';/)[0] + '\n' + fnSource('legalLinksHtml') + '\nthis.out = legalLinksHtml(' + JSON.stringify(where) + ');', ctx);
  return ctx.out;
}
const hrefs = h => [...h.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

test('版：APP_VERSION と SW_BUILD がそろい、1218 以上', () => {
  const app = IDX.match(/const APP_VERSION = '(\d+)'/)[1], sw = SW.match(/const SW_BUILD = '(\d+)'/)[1];
  assert.equal(app, sw); assert.ok(Number(app) >= 1218, app);
});

test('日本語は日本語のページ、English は英語のページ（公開のサイトの URL・新しいタブ）', () => {
  const ja = legal('ja', 'login'), en = legal('en', 'mypage');
  assert.deepEqual(hrefs(ja), ['https://funergy-plus.com/privacy/ja/', 'https://funergy-plus.com/support/ja/']);
  assert.deepEqual(hrefs(en), ['https://funergy-plus.com/privacy/', 'https://funergy-plus.com/support/']);
  assert.match(ja, /プライバシーポリシー/); assert.match(ja, /サポート/);
  assert.match(en, />Privacy Policy</); assert.match(en, />Support</);
  for (const h of [ja, en]) {
    assert.equal((h.match(/target="_blank" rel="noopener"/g) || []).length, 2);
    assert.doesNotMatch(h, /<script|on[a-z]+=/i);
  }
  assert.deepEqual(hrefs(legal(undefined, 'login')), hrefs(ja));   // 言葉がまだ決まっていないときは日本語（アプリの初めと同じ）
});

test('ログインの画面：入れ物があり、言葉を切り替えるたびに入れ直す（ログインの前に開ける）', () => {
  // v1221：版は「ログインで困ったとき」の中・その下にプライバシーポリシー・サポート（ログインの前にも見える）
  assert.match(IDX, /<div id="login-version"[^>]*><\/div>\n      <\/details>\n    <div id="login-legal"><\/div>/);
  const r = fnSource('refreshLoginLabels');
  assert.match(r, /getElementById\('login-legal'\)[\s\S]*legalLinksHtml\('login'\)/);
  assert.match(fnSource('pickLang'), /refreshLoginLabels\(\)/);
  assert.match(fnSource('bootLogin'), /refreshLoginLabels\(\)/);
});

test('マイページ：どの形（今の形・ほかの人の形）でも下にリンク', () => {
  const m = fnSource('renderMypage');
  const rets = [...m.matchAll(/\n {2,4}return ([^\n]+)/g)].map(x => x[1]).filter(x => /html/.test(x));
  assert.equal(rets.length, 3, rets.join(' | '));
  for (const x of rets) assert.match(x, /legalLinksHtml\('mypage'\)/, x);
});
