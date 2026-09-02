export const PWA_CACHE_PREFIX = "ynx-wallet-web-v";
export const PWA_CACHE = `${PWA_CACHE_PREFIX}11`;
export const PWA_RECOVERY_PARAM = "ynx-sw-recovery";
export const PWA_UPGRADE_PARAM = "ynx-sw-upgrade";

export function obsoletePwaCaches(keys) {
  return (Array.isArray(keys) ? keys : []).filter((key) => typeof key === "string" && key.startsWith(PWA_CACHE_PREFIX) && key !== PWA_CACHE);
}

export function allPwaCaches(keys) {
  return (Array.isArray(keys) ? keys : []).filter((key) => typeof key === "string" && key.startsWith(PWA_CACHE_PREFIX));
}

function markedNavigationUrl(requestUrl, parameter, value) {
  let url;
  try { url = new URL(requestUrl); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.searchParams.get(parameter) === value) return null;
  url.searchParams.set(parameter, value);
  return url.href;
}

export function recoveryNavigationUrl(requestUrl, cacheName = PWA_CACHE) {
  return markedNavigationUrl(requestUrl, PWA_RECOVERY_PARAM, cacheName);
}

export function upgradeNavigationUrl(requestUrl, cacheName = PWA_CACHE) {
  return markedNavigationUrl(requestUrl, PWA_UPGRADE_PARAM, cacheName);
}

export function cleanPwaNavigationUrl(requestUrl) {
  let url;
  try { url = new URL(requestUrl); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  let changed = false;
  for (const parameter of [PWA_RECOVERY_PARAM, PWA_UPGRADE_PARAM]) {
    if (!url.searchParams.has(parameter)) continue;
    url.searchParams.delete(parameter);
    changed = true;
  }
  return changed ? `${url.pathname}${url.search}${url.hash}` : null;
}

export function assetKeyForRequest(request, scopeUrl) {
  let url, scope;
  try { url = new URL(request?.url); scope = new URL(scopeUrl); } catch { return null; }
  if (url.origin !== scope.origin || request?.method !== "GET") return null;
  const scopePath = scope.pathname.endsWith("/") ? scope.pathname : `${scope.pathname}/`;
  const scopeRoot = scopePath === "/" ? "/" : scopePath.slice(0, -1);
  if (url.pathname !== scopeRoot && !url.pathname.startsWith(scopePath)) return null;
  const pathname = url.pathname === scopeRoot || url.pathname === scopePath ? `${scopePath}index.html` : url.pathname;
  const relative = pathname.slice(scopePath.length).replace(/^\//u, "");
  return relative ? `./${relative}` : "./index.html";
}

export function serviceWorkerRoute(request, scopeUrl) {
  if (!request || request.method !== "GET") return "network-only";
  let url, scope;
  try { url = new URL(request.url); scope = new URL(scopeUrl); } catch { return "network-only"; }
  if (url.origin !== scope.origin) return "network-only";
  const scopePath = scope.pathname.endsWith("/") ? scope.pathname : `${scope.pathname}/`;
  const scopeRoot = scopePath === "/" ? "/" : scopePath.slice(0, -1);
  if (url.pathname !== scopeRoot && !url.pathname.startsWith(scopePath)) return "network-only";
  return request.mode === "navigate" ? "navigation-network-first" : "asset-cache-first";
}

export function cacheableResponse(response) {
  return Boolean(response?.ok) && ["basic", "default"].includes(response.type);
}

export async function responseMatchesIntegrity(response, expectedSha256) {
  if (!cacheableResponse(response) || !/^[0-9a-f]{64}$/u.test(expectedSha256 || "") || !globalThis.crypto?.subtle) return false;
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("") === expectedSha256;
  } catch { return false; }
}
