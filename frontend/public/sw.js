const CACHE_VERSION = 'pwa-phase3-v1';
const APP_SHELL_CACHE = `kha-app-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `kha-static-${CACHE_VERSION}`;
const EXPECTED_CACHES = [APP_SHELL_CACHE, STATIC_CACHE];

const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

const INDEX_URL = new URL('./index.html', self.location).toString();
const API_PATH_PREFIX = '/api';
const STATIC_DESTINATIONS = new Set(['script', 'style', 'font', 'image', 'manifest']);

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiRequest(url) {
  return url.pathname === API_PATH_PREFIX || url.pathname.startsWith(`${API_PATH_PREFIX}/`);
}

function isCacheableResponse(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'default');
}

async function cacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await Promise.all(APP_SHELL_URLS.map(async url => {
    try {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      if (isCacheableResponse(response)) await cache.put(request, response);
    } catch (err) {
      console.warn('[PWA] Không thể cache app shell:', url, err);
    }
  }));
}

async function putRuntimeCache(request, response) {
  if (!isCacheableResponse(response)) return;
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(request, response.clone());
}

async function networkFirstNavigation(request) {
  const appCache = await caches.open(APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) await appCache.put(INDEX_URL, response.clone());
    return response;
  } catch (_) {
    return (await appCache.match(INDEX_URL))
      || (await appCache.match(new URL('./', self.location).toString()))
      || Response.error();
  }
}

async function staticAssetWithCacheFallback(request) {
  try {
    const response = await fetch(request);
    await putRuntimeCache(request, response);
    return response;
  } catch (_) {
    return (await caches.match(request)) || Response.error();
  }
}

function normalizeSafeCacheUrl(value) {
  try {
    const url = new URL(value, self.location.href);
    if (!isSameOrigin(url) || isApiRequest(url)) return '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function responseLooksLikeHtml(response) {
  return String(response.headers.get('content-type') || '').includes('text/html');
}

async function cacheSafeUrls(urls = []) {
  const appCache = await caches.open(APP_SHELL_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  const safeUrls = Array.from(new Set(urls.map(normalizeSafeCacheUrl).filter(Boolean)));

  await Promise.all(safeUrls.map(async url => {
    try {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      if (!isCacheableResponse(response)) return;

      if (responseLooksLikeHtml(response)) {
        await appCache.put(INDEX_URL, response.clone());
        await appCache.put(request, response.clone());
        return;
      }

      await staticCache.put(request, response.clone());
    } catch (_) {
      // Runtime pre-cache là best-effort; bỏ qua nếu tài nguyên chưa sẵn sàng.
    }
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => EXPECTED_CACHES.includes(key) ? undefined : caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'KHA_PWA_CACHE_URLS') return;
  event.waitUntil(cacheSafeUrls(event.data.urls));
});

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url) || isApiRequest(url)) return;

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(staticAssetWithCacheFallback(request));
  }
});
