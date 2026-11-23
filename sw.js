// オフラインでも開けるようにするための service worker。
// 画面やデータのファイルを直したら、下の VERSION を1つ上げてください（利用者の端末で新しい版に入れ替わります）。
const VERSION = 'v37';
const CACHE = `yowatari-nikki-${VERSION}`;
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './src/css/style.css', './src/app/app.js', './src/app/store.js', './src/app/scan.js',
  './src/data/lords.js', './src/data/characters.js', './src/data/effects.js',
  './src/data/vessels.js', './src/data/relics.js', './src/data/labels.js', './src/data/help.js', './src/data/enemies.js', './src/data/night_bosses.js',
  './icons/favicon.png', './icons/logo.png', ...['record', 'history', 'stats', 'builds', 'enemies'].map(id => `./icons/tabs/${id}.png`), './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  // 夜の王・夜渡りのアイコン（tools/make_unit_icons.py で作る）
  ...['gladius', 'adel', 'gnoster', 'maris', 'libra', 'fulghor', 'caligo', 'final', 'harmonia', 'strages'].map(id => `./icons/lords/${id}.png`),
  ...['wylder', 'guardian', 'ironeye', 'duchess', 'raider', 'revenant', 'recluse', 'executor', 'scholar', 'undertaker'].map(id => `./icons/chars/${id}.png`),
];

self.addEventListener('install', e => {
  // ブラウザに残っている古いファイルではなく、必ずサーバーの最新を取って保存する
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// まずネットから最新を取り、つながらないときは保存しておいた版を使う
// 同じサイトのファイルは毎回サーバーに「新しくなったか」を確かめる（公開直後に古いファイルと新しいファイルが混ざらないように）
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const same = new URL(req.url).origin === location.origin;
  e.respondWith(
    (same ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req)).then(res => {
      if (res.ok && (new URL(req.url).origin === location.origin || req.url.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
