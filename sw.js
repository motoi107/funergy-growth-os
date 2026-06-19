/* Funergy Growth OS — Service Worker
   - ナビゲーションは「ネットワーク優先」: 最新のindex.htmlを取得（更新が必ず反映される）。
     オフライン時のみキャッシュした画面を表示。
   - アイコン等の静的ファイルは「キャッシュ優先」。
   - 更新時は CACHE のバージョン名（v1→v2…）を上げてください。 */
const CACHE = 'funergy-os-v1';
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
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // 一部が無くても install を失敗させない
      Promise.allSettled(CORE.map((u) => c.add(u)))
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

/* 将来のPush通知用フック（フェーズ③で使用）。今は無害なプレースホルダ。 */
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
