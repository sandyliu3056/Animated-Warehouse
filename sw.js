/* Animated Warehouse — service worker
 *
 * BUILD 只要換過任何一個檔案就要改。快取名稱綁在它上面，
 * 舊快取會在新版啟用時整包刪掉。
 * 上一版沒改這個字串就換了圖示，結果裝好的人一直吃到舊圖示——
 * 圖片走的是 cache-first，名稱沒變就永遠不會去抓新的。
 */
const BUILD = "2026-08-16-n";
const CACHE = "aw-" + BUILD;
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-180-5.png", "./icon-192-5.png",
  "./icon-512-5.png", "./icon-maskable-512-5.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      /* 天氣 API 之類的不要攔 */

  const isDoc = req.mode === "navigate" || url.pathname.endsWith(".html");

  if (isDoc) {
    /* HTML：network-first。改完重新上傳，一開就是新版。 */
    e.respondWith(
      fetch(req)
        .then(r => { const copy = r.clone();
                     caches.open(CACHE).then(c => c.put(req, copy)); return r; })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  /* 其他（圖示、manifest、封面）：stale-while-revalidate。
     先給快取的版本所以開得快，同時在背景抓新的存起來，
     下一次開就是新的。不會像純 cache-first 那樣永遠卡在舊檔。 */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return resp;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
