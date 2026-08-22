import {readFileSync} from "node:fs";
const input = process.argv[2];
if (!input) { process.stdout.write("ARTWORK_MANIFEST_PATH_REQUIRED\n"); process.exitCode = 2; }
else {
  let manifest; try { manifest = JSON.parse(readFileSync(input, "utf8")); } catch { process.stdout.write("ARTWORK_MANIFEST_INVALID_JSON\n"); process.exitCode = 2; }
  if (manifest) {
    const required = ["productId", "artworkVersion", "sourceVector", "appIcon", "launchSplash", "downloadCover", "screenshots", "assetManifest", "sha256"];
    const missing = required.filter(key => !manifest[key] || (Array.isArray(manifest[key]) && !manifest[key].length));
    const platform = manifest.platformIcons || {};
    const platformMissing = ["androidAdaptive", "androidMonochrome", "iosAppIcon", "macosIcon", "windowsIcon", "pwaIcon"].filter(key => !platform[key]);
    const invalid = [];
    if (!/\.svg$/i.test(manifest.sourceVector || "")) invalid.push("SOURCE_VECTOR_NOT_SVG");
    if (!/^[a-f0-9]{64}$/i.test(manifest.sha256 || "")) invalid.push("ARTWORK_SHA256_INVALID");
    for (const asset of [manifest.appIcon, manifest.launchSplash, manifest.downloadCover, ...Array.isArray(manifest.screenshots) ? manifest.screenshots : []]) if (/(?:default|vite|react|placeholder|framework)/i.test(asset || "")) invalid.push("DEFAULT_OR_PLACEHOLDER_ASSET");
    if (missing.length || platformMissing.length || invalid.length) { process.stdout.write(`${JSON.stringify({code: "ARTWORK_VALIDATION_FAILED", missing, platformMissing, invalid})}\n`); process.exitCode = 2; }
    else { process.stdout.write(`${JSON.stringify({valid: true, productId: manifest.productId, artworkVersion: manifest.artworkVersion, sha256: manifest.sha256})}\n`); }
  }
}
