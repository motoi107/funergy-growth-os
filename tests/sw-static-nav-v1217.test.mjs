// v1217：Service Worker が静的ページ（/privacy/・/support/ など）を index.html の控えにしない。
// sw.js を VM で動かし（self・caches・fetch はこの試験の作り物）、画面の移動（navigate）の答えと控えへの書き込みを見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const IDX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ORIGIN = 'https://funergy-plus.com';

function world({ online = true, scope = ORIGIN + '/' } = {}) {
  const store = new Map();   // 控え（キャッシュ名は 1 つだけ見る）
  const puts = [];
  const cache = {
    put: async (k, r) => { const key = typeof k === 'string' ? k : k.url; puts.push(key); store.set(key, r); },
    match: async (k) => store.get(typeof k === 'string' ? k : k.url),
    add: async () => {},
  };
  const handlers = {};
  const net = { online, calls: [] };
  const ctx = {
    self: null, location: new URL(ORIGIN + '/sw.js'), URL, Response, Promise, console,
    caches: {
      open: async () => cache,
      match: async (k) => store.get(typeof k === 'string' ? k : k.url),
      keys: async () => [], delete: async () => true,
    },
    fetch: async (req) => {
      net.calls.push(req.url);
      if (!net.online) throw new TypeError('offline');
      const path = new URL(req.url).pathname;
      return new Response('<title>' + (path.startsWith('/privacy') ? 'Privacy' : 'App') + '</title>', { headers: { 'content-type': 'text/html' } });
    },
  };
  ctx.self = { addEventListener: (t, f) => { handlers[t] = f; }, registration: { scope }, skipWaiting() {}, clients: { claim: async () => {} } };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  async function go(url, mode = 'navigate') {
    let p = null;
    handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: (x) => { p = Promise.resolve(x); }, waitUntil() {} });
    if (!p) return { passed: true };
    const r = await p;
    await new Promise((res) => setTimeout(res, 5));   // 控えへの書き込み（then の中）を待つ
    return { r, text: r && r.type !== 'error' ? await r.clone().text() : null };
  }
  return { go, puts, store, net };
}

test('版：SW_BUILD と APP_VERSION がそろい、1217 以上', () => {
  const sw = SW.match(/const SW_BUILD = '(\d+)'/)[1], app = IDX.match(/const APP_VERSION = '(\d+)'/)[1];
  assert.equal(sw, app); assert.ok(Number(sw) >= 1217, sw);
});

test('静的ページを開いても index.html の控えは変わらない（オフラインでもアプリが出る）', async () => {
  const w = world();
  await w.go(ORIGIN + '/');                       // アプリ：控えに入る
  assert.deepEqual(w.puts, ['index.html']);
  const pr = await w.go(ORIGIN + '/privacy/');    // 静的ページ：ネットワークの答え・控えは作らない
  assert.equal(pr.text, '<title>Privacy</title>');
  await w.go(ORIGIN + '/support/ja/');
  assert.deepEqual(w.puts, ['index.html']);
  w.net.online = false;
  const off = await w.go(ORIGIN + '/');           // オフライン：アプリの控え
  assert.equal(off.text, '<title>App</title>');
  const offP = await w.go(ORIGIN + '/privacy/');  // オフラインの静的ページ：アプリを出さない（ネットワークの失敗）
  assert.equal(offP.r.type, 'error');
});

test('アプリ本体の行き先は今までどおり控えに入る（?onboard=・index.html・#）', async () => {
  for (const u of ['/', '/index.html', '/?onboard=abc', '/index.html?x=1#h']) {
    const w = world();
    await w.go(ORIGIN + u);
    assert.deepEqual(w.puts, ['index.html'], u);
  }
});

test('SW の範囲が下のフォルダーでも、その先頭だけがアプリ', async () => {
  const w = world({ scope: ORIGIN + '/app/' });
  await w.go(ORIGIN + '/app/');
  await w.go(ORIGIN + '/privacy/');
  await w.go(ORIGIN + '/app/privacy/');
  assert.deepEqual(w.puts, ['index.html']);
});

test('画面の移動でない読み込み（アイコンなど）は今までどおり', async () => {
  const w = world();
  await w.go(ORIGIN + '/appicons/icon-180.png', 'no-cors');
  assert.deepEqual(w.puts, [ORIGIN + '/appicons/icon-180.png']);
  const x = await w.go('https://cdn.example.com/a.js', 'no-cors');
  assert.ok(x.r);
  assert.deepEqual(w.puts, [ORIGIN + '/appicons/icon-180.png']);   // ほかのオリジンは控えに入れない
});
