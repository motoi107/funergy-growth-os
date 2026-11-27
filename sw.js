/* Funergy Growth OS — Service Worker (v2)
   方針:
   - ナビゲーション（index.html）は「ネットワーク優先」。最新を取得し、オフライン時のみキャッシュを表示。
   - アイコン等の静的ファイルは「キャッシュ優先」。
   - CACHE 名にビルド番号を含める。index.html 側から postMessage で受け取り、activate 時に
     古い版のキャッシュを必ず捨てる。これにより「新版を配ったのに端末が古いまま」を防ぐ。
   - waiting 状態の SW は、index.html から SKIP_WAITING を受けたときだけ有効化する（勝手に切り替えて
     入力中データを飛ばさない。ユーザーがバナーで「更新」を押したときだけ切り替わる）。
   SW を差し替えるときは SW_BUILD を上げること。 */
const SW_BUILD = '1227';                     // ← index.html の APP_VERSION と揃える
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

// アプリ本体の URL か（同じオリジンで、この SW の範囲の先頭か index.html。?onboard= などの問い合わせ・# はどれでもよい）
function isAppShell(url) {
  if (url.origin !== location.origin) return false;
  const scope = new URL((self.registration && self.registration.scope) || './', location.href).pathname;
  return url.pathname === scope || url.pathname === scope + 'index.html';
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  const isNav = req.mode === 'navigate' ||
    (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname));

  if (isNav) {
    // v1217：index.html の控えにするのはアプリ本体（この SW の範囲の先頭か index.html）だけ。
    //   /privacy/・/support/ などの静的ページを開いても、オフラインのときに出すアプリの控えを置き換えない
    //   （前は開いたページを index.html として保存し、オフラインでアプリを開くとそのページが出た）。
    //   静的ページはネットワークだけ（控えは作らない）。オフラインならブラウザーの「つながらない」表示。
    if (!isAppShell(url)) {
      e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())));
      return;
    }
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

/* v1168：チャットのプッシュ通知（docs/CHAT_GUARD_V1168_JA.md）。サーバーは中身を送らない（届いた中身があっても使わない）。
   出すのは「新着メッセージがあります」だけ（送った人・会話の名前・本文・画像は出さない）。同じ印（tag）なので、何通来ても 1 つにまとまる。
   iPhone はホーム画面に追加したアプリ（iOS 16.4 以上）で受け取る。届いたら必ず 1 つ出す（出さないとブラウザが受け取りを止めることがある）。 */
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('Funergy+', {
    body: '新着メッセージがあります',
    tag: 'funergy-chat',
    renotify: false,
    icon: 'appicons/icon-192.png',
    badge: 'appicons/icon-192.png',
    data: { chat: 1 }
  }));
});
/* 押したら：開いているアプリがあれば前に出して「新しいメッセージのある会話を開いて」と伝える。無ければ ?chat=1 で開く（ログインのあと開く） */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./?chat=1', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
    for (const c of cl) {
      if ('focus' in c) {
        try { c.postMessage({ type: 'funergy-chat-open' }); } catch (_) {}
        return c.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
