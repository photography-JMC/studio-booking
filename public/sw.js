// Service worker מינימלי: נדרש להתקנה כאפליקציה. אינו שומר שום מידע במטמון (נתוני ההזמנות אישיים ותמיד נטענים מהשרת).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});

