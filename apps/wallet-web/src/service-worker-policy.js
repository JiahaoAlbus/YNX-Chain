export const PWA_CACHE = "ynx-wallet-web-v3";

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
