// 小柯文件PDF線上版的 Service Worker：離線使用、更新、接收分享的 PDF
const VERSION = '1.0.1';
const CACHE = 'xk-pdf-' + VERSION;
const CORE = [
  './', 'index.html', 'app.css', 'manifest.webmanifest', 'favicon.ico',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'js/app.js', 'js/util.js', 'js/core.js', 'js/inline.js', 'js/doc.js', 'js/viewer.js', 'js/ops.js', 'js/watermark.js', 'js/sign.js', 'js/style.js', 'js/panels.js', 'js/tools.js',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/forge.min.js', 'vendor/jszip.min.js',
  'fonts/jf-openhuninn-2.1.ttf',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('xk-pdf-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 從其他 App 分享過來的 PDF（Web Share Target）
  if (e.request.method === 'POST' && url.searchParams.has('share-target')) {
    e.respondWith((async () => {
      const data = await e.request.formData();
      const f = data.get('pdf');
      if (f) {
        const c = await caches.open('xk-share');
        await c.put('shared.pdf', new Response(f, { headers: { 'Content-Type': 'application/pdf', 'X-Name': encodeURIComponent(f.name || 'shared.pdf') } }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 版本資訊永遠從網路讀
  if (url.pathname.endsWith('version.json')) { e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))); return; }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') });
    if (hit) return hit;
    try {
      const r = await fetch(e.request);
      if (r.ok && (url.pathname.includes('/vendor/') || url.pathname.includes('/fonts/') || url.pathname.includes('/icons/'))) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      if (e.request.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw err;
    }
  })());
});
