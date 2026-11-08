// 最小のService Worker（ホーム画面へのインストール用）。データはキャッシュしない。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
