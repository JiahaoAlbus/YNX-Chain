const exactPaths=new Set([
  "apps/wallet-web/package.json",
  "apps/wallet-web/package-lock.json",
  "apps/wallet-web/README.md",
  "packages/wallet-auth/package.json",
  "packages/wallet-auth/package-lock.json",
  "release/integration/wallet-web-pwa-site/wallet-manifest-binding.mjs",
  "release/integration/wallet-web-pwa-site/frozen-wallet-manifest.webmanifest",
]);

export function isReviewerSourcePath(path){
  return /^(?:apps\/wallet-web\/(?:src|public|extension|scripts|test|fixtures|store|vendor)\/|packages\/wallet-auth\/src\/)/u.test(path)||exactPaths.has(path);
}
