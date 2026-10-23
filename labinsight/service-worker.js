"use strict";
// GitHub Pages handoff: remove only the old public REPODAM app-shell caches.
// Never delete Caffeine Atlas or other LABDAM caches, and never cache health data.
self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name.startsWith("labinsight-app-"))
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});
// No fetch handler: Pages no longer serves health forms or app assets.
