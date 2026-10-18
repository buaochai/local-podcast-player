// 离线缓存：网页本身的文件。改了文件要升 CACHE 版本号。
var CACHE = 'lpp-0.37.5';
var FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'cover-192.png', 'cover-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
// 先用网络（向服务器确认是不是最新），断网时用缓存
self.addEventListener('fetch', function(e){
  var u = new URL(e.request.url);
  // 云同步接口不经过缓存（还要带上请求头）
  if(e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.indexOf('/api/') >= 0) return;
  // 打开网页本身：原样请求，Cloudflare Access 要求登录时会跳到登录页（不能用缓存挡住）
  var req = e.request.mode === 'navigate' ? fetch(e.request) : fetch(e.request.url, {cache:'no-cache'});
  e.respondWith(req.then(function(res){
    if(res.ok && !new URL(e.request.url).search){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
    }
    return res;
  }).catch(function(){ return caches.match(e.request, {ignoreSearch:true}); }));
});
