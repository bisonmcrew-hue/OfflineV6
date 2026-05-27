/* Service Worker — SSAS Jalisco
   Cachea el shell (HTML + manifest) para que la app abra sin internet.
   Las peticiones a Apps Script SIEMPRE pasan por red, nunca se cachean. */
const CACHE = 'ssas-cuestionario-v1';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
                            .map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  const url = new URL(e.request.url);
  // Apps Script SIEMPRE va a la red, sin cache
  if (url.hostname.indexOf('script.google.com')     !== -1 ||
      url.hostname.indexOf('googleusercontent.com') !== -1) {
    return;
  }
  // Para el shell: cache-first con fallback a red
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(resp){
        if (resp && resp.status === 200 && url.origin === self.location.origin) {
          const clon = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clon); });
        }
        return resp;
      }).catch(function(){
        return new Response('Sin conexión y recurso no cacheado.', { status: 503 });
      });
    })
  );
});
