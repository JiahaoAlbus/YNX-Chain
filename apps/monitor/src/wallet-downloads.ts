export interface WalletPreviewDownload {
  id: string;
  kind: "chromium";
  url: string;
  filename: string;
  bytes: number;
  sha256: string;
  sourceCommit: string;
}

const supportedPreviews = new Map<string, WalletPreviewDownload["kind"]>([
  ["web-chromium-f90ad90", "chromium"],
]);

// Published file availability is separate from installation, signing and login.
// Prepared catalogs and unknown preview versions must never create live links.
export function verifiedWalletPreviews(value: unknown): WalletPreviewDownload[] {
  if (!value || typeof value !== "object") return [];
  const catalog = value as Record<string, unknown>;
  if (catalog.status !== "published-files-verified" || !Array.isArray(catalog.artifacts) || catalog.artifacts.length > 32) return [];
  const previews: WalletPreviewDownload[] = [];
  for (const item of catalog.artifacts) {
    if (!item || typeof item !== "object") continue;
    const kind = supportedPreviews.get(item.id);
    if (!kind || item.published !== true || item.publicDownloadVerified !== true) continue;
    if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        typeof item.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(item.sourceCommit) ||
        !Number.isSafeInteger(item.bytes) || item.bytes <= 0 ||
        typeof item.filename !== "string" || !/^[a-zA-Z0-9._-]+$/.test(item.filename) ||
        !item.filename.endsWith(".zip")) continue;
    try {
      const url = new URL(item.url);
      if (url.origin !== "https://downloads.ynxweb4.com" || url.username || url.password || url.search || url.hash ||
          url.pathname !== `/wallet/sha256-${item.sha256}/${item.filename}`) continue;
      previews.push({ id: item.id, kind, url: url.href, filename: item.filename, bytes: item.bytes, sha256: item.sha256, sourceCommit: item.sourceCommit });
    } catch { /* Invalid or absent URLs remain unavailable. */ }
  }
  return previews;
}
