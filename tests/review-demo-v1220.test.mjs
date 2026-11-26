import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../review-demo/README_JA.md', import.meta.url), 'utf8');

function reviewBlock() {
  const a = html.indexOf('/* v1219 review demo start');
  const b = html.indexOf('/* v1219 review demo end */');
  assert.ok(a >= 0 && b > a);
  return html.slice(a, b);
}

function names(list) {
  const o = { length: list.length, contains: (s) => list.includes(s) };
  list.forEach((n, i) => { o[i] = n; });
  return o;
}

function fakeIdb(spec, opts) {
  opts = opts || {};
  const events = [];
  const dbs = {
    funergy_os_kv: { stores: ['kv'], keys: spec.recovery || [] },
    funergy_pending_images: { stores: ['files'], count: spec.images || 0 },
    funergy_bulk_invoices: { stores: ['batch', 'items'], count: spec.bulk || 0 },
    'funergy-dl': { stores: ['keys'], count: spec.device || 0 },
  };
  function dbFor(name) {
    const meta = dbs[name] || { stores: [], count: 0, keys: [] };
    return {
      objectStoreNames: names(meta.stores),
      close() { events.push('close:' + name); },
      transaction(store) {
        const tx = {
          objectStore() {
            return {
              clear() { events.push('clear:' + name + '/' + store); return {}; },
              count() {
                const req = {};
                queueMicrotask(() => { req.result = meta.count || (meta.keys || []).length; req.onsuccess && req.onsuccess(); });
                return req;
              },
              openCursor() {
                const req = {};
                const keys = (meta.keys || []).slice();
                let i = 0;
                const step = () => {
                  if (i >= keys.length) { req.result = null; req.onsuccess && req.onsuccess(); return; }
                  const key = keys[i++];
                  req.result = { key, continue() { queueMicrotask(step); } };
                  req.onsuccess && req.onsuccess();
                };
                queueMicrotask(step);
                return req;
              },
            };
          },
        };
        queueMicrotask(() => { events.push('tx:' + name); tx.oncomplete && tx.oncomplete(); });
        return tx;
      },
    };
  }
  return {
    events,
    open(name) {
      events.push('open:' + name);
      const req = {};
      queueMicrotask(() => {
        if (opts.failOpen === name) { req.onerror && req.onerror(); return; }
        req.result = dbFor(name);
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) {
      events.push('delete:' + name);
      const req = {};
      queueMicrotask(() => {
        if (opts.failDelete === name) { req.onerror && req.onerror(); return; }
        if (opts.blockDelete === name) { req.onblocked && req.onblocked(); return; }
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

function world(flag, extra, idb) {
  const store = new Map();
  if (flag) store.set('fg_env', flag);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] || null,
    get length() { return store.size; },
  };
  const msg = { textContent: '', style: { display: 'none' } };
  const ctx = {
    localStorage,
    sessionStorage: { clear() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById(id) { return id === 'fg-review-msg' ? msg : null; } },
    window: {},
    setTimeout() { return 0; },
    location: { reload() { ctx.reloaded = true; ctx.reloadAt = ctx.indexedDB.events.slice(); } },
    showToast(m) { ctx.toasts.push(m); },
    t: (ja) => ja,
    confirm: () => true,
    indexedDB: idb,
    msg, toasts: [], reloaded: false, reloadAt: null,
  };
  Object.assign(ctx, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(reviewBlock() + '\nthis.fgReviewSwitch=fgReviewSwitch; this.fgReviewPending=fgReviewPending; this.SUPABASE_URL=SUPABASE_URL; this.FG_REVIEW_DBS=FG_REVIEW_DBS;', ctx);
  ctx.store = store;
  return ctx;
}

test('印が無いときは本番のまま。ログインのカードは英語と日本語', () => {
  const c = world(null, {}, null);
  assert.equal(c.SUPABASE_URL, 'https://tgbhgxzehzeouopklhje.supabase.co');
  assert.equal((html.match(/const APP_VERSION = '(\d+)';/) || [])[1], '1220');
  assert.equal((sw.match(/const SW_BUILD = '(\d+)';/) || [])[1], '1220');
  assert.match(html, /Review \(Demo\) \/ 審査用（デモ）/);
});

test('売上の復旧・採用と相談の下書き・未送信の伝票があると切り替えない', async () => {
  const recovery = world(null, { confirm() { throw new Error('confirm'); } }, fakeIdb({ recovery: ['financial_save_recovery_v2/sale'] }));
  assert.equal(await recovery.fgReviewSwitch(true), false);
  assert.equal(recovery.store.has('fg_env'), false);
  assert.equal(recovery.reloaded, false);
  assert.equal(recovery.indexedDB.events.filter(e => e.startsWith('delete:')).length, 0);
  assert.match(recovery.msg.textContent, /送っていない保存があるので、切り替えません/);

  const hire = world(null, { confirm() { throw new Error('confirm'); } }, fakeIdb({}));
  hire.localStorage.setItem('_hr_unsent', '[{"id":"draft"}]');
  assert.equal(hire.fgReviewSwitch(true), false);
  assert.equal(hire.store.get('_hr_unsent'), '[{"id":"draft"}]');

  const consult = world(null, { confirm() { throw new Error('confirm'); } }, fakeIdb({}));
  consult.localStorage.setItem('_ss_unsent', '{"note":"kept"}');
  assert.equal(consult.fgReviewSwitch(true), false);

  const images = world(null, { confirm() { throw new Error('confirm'); } }, fakeIdb({ images: 2 }));
  assert.equal(await images.fgReviewSwitch(true), false);
  assert.equal(images.reloaded, false);
  assert.equal(images.indexedDB.events.some(e => e.startsWith('delete:')), false);

  const bulk = world(null, { confirm() { throw new Error('confirm'); } }, fakeIdb({ bulk: 1 }));
  assert.equal(await bulk.fgReviewSwitch(true), false);
  assert.equal(bulk.store.has('fg_env'), false);
});

test('各 IndexedDB を開いて消し終わってから再読み込みする。失敗したら切り替えない', async () => {
  const idb = fakeIdb({});
  const ok = world(null, {}, idb);
  ok.localStorage.setItem('m_employees', '[{"name":"kept"}]');
  assert.equal(await ok.fgReviewSwitch(true), true);
  assert.equal(ok.store.get('fg_env'), 'review');
  assert.equal(ok.store.has('m_employees'), false);
  assert.equal(ok.reloaded, true);
  const beforeReload = ok.reloadAt;
  for (const name of ok.FG_REVIEW_DBS) {
    assert.ok(beforeReload.includes('open:' + name), name);
    assert.ok(beforeReload.includes('tx:' + name), name);
    assert.ok(beforeReload.includes('delete:' + name), name);
    assert.ok(beforeReload.indexOf('open:' + name) < beforeReload.indexOf('delete:' + name));
  }
  assert.equal(idb.events.filter(e => e.startsWith('delete:')).join(','), ok.FG_REVIEW_DBS.map(n => 'delete:' + n).join(','));

  const bad = world(null, {}, fakeIdb({}, { failDelete: 'funergy_os_kv' }));
  bad.localStorage.setItem('cur_lang', 'ja');
  assert.equal(await bad.fgReviewSwitch(true), false);
  assert.equal(bad.store.has('fg_env'), false);
  assert.equal(bad.store.get('cur_lang'), 'ja');
  assert.equal(bad.reloaded, false);
  assert.match(bad.msg.textContent, /この端末の保存を消せなかったので、切り替えません/);

  const blocked = world(null, {}, fakeIdb({}, { blockDelete: 'funergy_pending_images' }));
  assert.equal(await blocked.fgReviewSwitch(true), false);
  assert.equal(blocked.reloaded, false);
  assert.equal(blocked.store.has('fg_env'), false);
});

test('README はリポジトリに無い PIN のひな形と verify.sh を中にあるファイルとして載せない', () => {
  assert.match(readme, /02_pins\.template\.sql` は置かない/);
  assert.match(readme, /verify\.sh` は置かない/);
  assert.doesNotMatch(readme, /\| `seed\/02_pins\.template\.sql` \|/);
  assert.doesNotMatch(readme, /\| `verify\.sh` \|/);
});
