const CACHE="ynx-search-shell-v2",SHELL=["/","/app.js","/i18n.js","/shared-i18n.js","/styles.css"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener("fetch",event=>{if(event.request.method!=="GET"||new URL(event.request.url).pathname.startsWith("/api/"))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request))) });
