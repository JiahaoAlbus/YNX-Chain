import {readFileSync} from "node:fs";
const input = process.argv[2];
if (!input) { process.stdout.write("ARTWORK_MANIFEST_PATH_REQUIRED\n"); process.exitCode = 2; }
else {
  let manifest; try { manifest = JSON.parse(readFileSync(input, "utf8")); } catch { process.stdout.write("ARTWORK_MANIFEST_INVALID_JSON\n"); process.exitCode = 2; }
  if (manifest) {
    const required = ["productId", "artworkVersion", "sourceVector", "appIcon", "launchSplash", "downloadCover", "screenshots"];
    const missing = required.filter(key => !manifest[key] || (Array.isArray(manifest[key]) && !manifest[key].length));
    if (missing.length) { process.stdout.write(`${JSON.stringify({code: "ARTWORK_FIELD_MISSING", missing})}\n`); process.exitCode = 2; }
    else { process.stdout.write(`${JSON.stringify({valid: true, productId: manifest.productId, artworkVersion: manifest.artworkVersion})}\n`); }
  }
}
