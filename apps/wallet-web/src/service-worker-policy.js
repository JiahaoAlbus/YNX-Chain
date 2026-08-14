export const PWA_CACHE_PREFIX = "ynx-wallet-web-v";
export const PWA_CACHE = `${PWA_CACHE_PREFIX}6`;

export function obsoletePwaCaches(keys) {
  return (Array.isArray(keys) ? keys : []).filter((key) => typeof key === "string" && key.startsWith(PWA_CACHE_PREFIX) && key !== PWA_CACHE);
}

export function assetKeyForRequest(request, scopeOrigin) {
  let url;
  try { url = new URL(request?.url); } catch { return null; }
  if (url.origin !== scopeOrigin || request?.method !== "GET") return null;
  const scope = new URL(scopeOrigin);
  const pathname = url.pathname === scope.pathname || url.pathname === `${scope.pathname}/` ? "/index.html" : url.pathname;
  const relative = pathname.slice(scope.pathname.replace(/\/$/u, "").length).replace(/^\//u, "");
  return relative ? `./${relative}` : "./index.html";
}

export function serviceWorkerRoute(request, scopeOrigin) {
  if (!request || request.method !== "GET") return "network-only";
  let url;
  try { url = new URL(request.url); } catch { return "network-only"; }
  if (url.origin !== scopeOrigin) return "network-only";
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
