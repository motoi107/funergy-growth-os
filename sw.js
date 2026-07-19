/* Funergy Growth OS — Service Worker (v2)
   方針:
   - ナビゲーション（index.html）は「ネットワーク優先」。最新を取得し、オフライン時のみキャッシュを表示。
   - アイコン等の静的ファイルは「キャッシュ優先」。
   - CACHE 名にビルド番号を含める。index.html 側から postMessage で受け取り、activate 時に
     古い版のキャッシュを必ず捨てる。これにより「新版を配ったのに端末が古いまま」を防ぐ。
   - waiting 状態の SW は、index.html から SKIP_WAITING を受けたときだけ有効化する（勝手に切り替えて
     入力中データを飛ばさない。ユーザーがバナーで「更新」を押したときだけ切り替わる）。
   SW を差し替えるときは SW_BUILD を上げること。 */
const SW_BUILD = '649';                     // ← index.html の APP_VERSION と揃える
const CACHE = 'funergy-os-' + SW_BUILD;
const CORE = [
  './',
  'index.html',
  'appicons/manifest.json',
  'appicons/icon-180.png',
  'appicons/icon-192.png',
  'appicons/icon-512.png',
  'appicons/icon-32.png',
  'appicons/favicon.ico'
];

self.addEventListener('install', (e) => {
  // 注意: ここでは skipWaiting しない。waiting のまま待機し、ユーザーが「更新」を押したら切り替える。
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(CORE.map((u) => c.add(u)))   // 一部が無くても install を失敗させない
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// index.html からのメッセージ: 「更新」ボタンで SKIP_WAITING を受けたら有効化を進める
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  const isNav = req.mode === 'navigate' ||
    (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname));

  if (isNav) {
    // ネットワーク優先（最新のアプリを表示）。失敗したらキャッシュ。
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 静的: キャッシュ優先 → ネットワーク（取得できたら同一オリジンのみ保存）
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached)
    )
  );
});

/* Push通知用フック（将来用・無害なプレースホルダ） */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || 'Funergy';
  const options = {
    body: data.body || '',
    icon: 'appicons/icon-192.png',
    badge: 'appicons/icon-192.png',
    data: data.url || './'
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data || './';
  e.waitUntil(clients.matchAll({ type: 'window' }).then((cl) => {
    for (const c of cl) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
