const CACHE='ynx-shop-shell-v2';
const BASE=new URL('./',self.registration.scope).pathname;
const SHELL=['','styles.css','workflow.css','app.js','i18n.js','wallet-auth.js','manifest.webmanifest','icon-192.png','icon-512.png'].map(path=>new URL(path,self.registration.scope).pathname);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}return response}).catch(()=>caches.match(request).then(cached=>cached||caches.match(BASE))))});
