import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "artifact-manifest.json"), "utf8"));
const requiredFiles = new Set(["index.html", "app.js", "provider.js", "i18n.js", "styles.css", "accessibility.css", "ynx-logo.png"]);

for (const artifact of manifest.artifacts) {
  const archive = join(root, artifact.path);
  const bytes = await readFile(archive);
  const info = await stat(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (info.size !== artifact.bytes || sha256 !== artifact.sha256) throw new Error(`Integrity mismatch: ${artifact.name}`);

  const entries = execFileSync("unzip", ["-Z1", archive], {encoding: "utf8"}).trim().split("\n").filter(Boolean);
  if (new Set(entries).size !== entries.length) throw new Error(`Duplicate ZIP entry: ${artifact.name}`);
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error(`Unsafe ZIP path: ${artifact.name}`);
  for (const required of requiredFiles) if (!entries.includes(required)) throw new Error(`Missing ${required}: ${artifact.name}`);

  if (artifact.browsers.includes("PWA")) {
    for (const required of ["manifest.webmanifest", "sw.js", "service-worker-policy.js"]) if (!entries.includes(required)) throw new Error(`Missing ${required}: ${artifact.name}`);
    continue;
  }

  const extension = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], {encoding: "utf8"}));
  for (const required of ["content-script.js", "page-provider.js", "extension-bridge.js", "extension-rpc.js", "core-auth-consumer.js", "core-auth-binding.js", "extension-sensitive-policy.js", "service-worker.js"]) if (!entries.includes(required)) throw new Error(`Missing ${required}: ${artifact.name}`);
  if (extension.manifest_version !== 3 || extension.action?.default_popup !== "index.html") throw new Error(`Invalid MV3 entrypoint: ${artifact.name}`);
  if (extension.content_security_policy?.extension_pages !== "script-src 'self'; object-src 'self'; connect-src https://evm.ynxweb4.com") throw new Error(`Invalid extension RPC CSP: ${artifact.name}`);
  if (JSON.stringify(extension.host_permissions) !== JSON.stringify(["https://*/*","http://localhost/*","http://127.0.0.1/*"])) throw new Error(`Invalid host permissions: ${artifact.name}`);
  for (const forbidden of ["update_url", "key"]) if (forbidden in extension) throw new Error(`Forbidden ${forbidden}: ${artifact.name}`);
  if (artifact.browsers.includes("Firefox")) {
    if (extension.browser_specific_settings?.gecko?.id !== "wallet-testnet@ynxweb4.com" || extension.browser_specific_settings?.gecko?.strict_min_version !== "128.0") throw new Error(`Invalid Firefox identity metadata: ${artifact.name}`);
  } else if (extension.minimum_chrome_version !== "120") {
    throw new Error(`Invalid Chromium minimum version: ${artifact.name}`);
  }
}

if (manifest.downloadHosted || manifest.productionSigned || manifest.storeReleased || manifest.installedLocal) throw new Error("Unproved release boolean is true");
console.log(`Verified ${manifest.artifacts.length} fail-closed artifact packages.`);
