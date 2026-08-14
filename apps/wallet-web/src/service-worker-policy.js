export const PWA_CACHE_PREFIX = "ynx-wallet-web-v";
export const PWA_CACHE = `${PWA_CACHE_PREFIX}6`;

export function obsoletePwaCaches(keys) {
  return (Array.isArray(keys) ? keys : []).filter((key) => typeof key === "string" && key.startsWith(PWA_CACHE_PREFIX) && key !== PWA_CACHE);
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
