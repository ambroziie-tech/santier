/* Service worker minimal: doar cât să se poată instala pe ecranul principal.
   Nu ține nimic în cache, ca să primești mereu ultima versiune. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
