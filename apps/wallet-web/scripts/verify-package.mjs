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
    for (const required of ["manifest.webmanifest", "preferences.js", "mobile-wallet-routing.js", "core-auth-consumer.js", "wallet-web-companion-lifecycle.js", "standard-wallet-connect-state.js", "core-auth-binding.js", "build-identity.json", "sw.js", "service-worker-policy.js", "asset-integrity.js", "vercel.json", "ynx-icon-192.png", "ynx-icon-512.png", "ynx-icon-maskable-512.png"]) if (!entries.includes(required)) throw new Error(`Missing ${required}: ${artifact.name}`);
    const deploymentPolicy=JSON.parse(execFileSync("unzip",["-p",archive,"vercel.json"],{encoding:"utf8"})),expectedNoStore=["/build-identity.json","/sw.js","/asset-integrity.js","/service-worker-policy.js"];
    if(JSON.stringify(deploymentPolicy.headers?.map(({source})=>source))!==JSON.stringify(expectedNoStore)||deploymentPolicy.headers.some(({headers})=>JSON.stringify(headers)!==JSON.stringify([{key:"Cache-Control",value:"no-store"}])))throw new Error(`Invalid PWA deployment cache policy: ${artifact.name}`);
    const integritySource=execFileSync("unzip",["-p",archive,"asset-integrity.js"],{encoding:"utf8"}),match=integritySource.match(/^export const ASSET_INTEGRITY=Object\.freeze\((\{.*\})\);\n$/u);
    if(!match)throw new Error(`Invalid PWA asset integrity module: ${artifact.name}`);
    const integrity=JSON.parse(match[1]),expected=["./","./index.html","./styles.css","./accessibility.css","./app.js","./provider.js","./i18n.js","./preferences.js","./mobile-wallet-routing.js","./core-auth-consumer.js","./wallet-web-companion-lifecycle.js","./standard-wallet-connect-state.js","./core-auth-binding.js","./service-worker-policy.js","./build-identity.json","./ynx-logo.png","./ynx-icon-192.png","./ynx-icon-512.png","./ynx-icon-maskable-512.png","./manifest.webmanifest"];
    if(JSON.stringify(Object.keys(integrity).sort())!==JSON.stringify(expected.sort()))throw new Error(`Invalid PWA asset integrity set: ${artifact.name}`);
    for(const [key,digest] of Object.entries(integrity)){const file=key==="./"?"index.html":key.slice(2),content=execFileSync("unzip",["-p",archive,file]);if(createHash("sha256").update(content).digest("hex")!==digest)throw new Error(`PWA asset integrity mismatch for ${key}: ${artifact.name}`)}
    continue;
  }

  const extension = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], {encoding: "utf8"}));
  for (const required of ["preferences.js", "mobile-wallet-routing.js", "wallet-web-companion-lifecycle.js", "standard-wallet-connect-state.js", "build-identity.json", "content-script.js", "page-provider.js", "active-tab-policy.js", "extension-migration.js", "extension-bridge.js", "extension-rpc.js", "extension-provider-permissions.js", "extension-vault.js", "extension-signer.js", "approval.html", "approval.css", "approval.js", "vault.html", "vault.css", "vault.js", "signer.html", "signer.css", "signer.js", "core-auth-consumer.js", "core-auth-binding.js", "extension-sensitive-policy.js", "service-worker.js"]) if (!entries.includes(required)) throw new Error(`Missing ${required}: ${artifact.name}`);
  if (extension.manifest_version !== 3 || extension.action?.default_popup !== "index.html" || JSON.stringify(extension.options_ui)!==JSON.stringify({page:"vault.html",open_in_tab:true})) throw new Error(`Invalid MV3 entrypoint: ${artifact.name}`);
  const vaultBundle=execFileSync("unzip",["-p",archive,"extension-vault.js"],{encoding:"utf8"});
  if(!vaultBundle.includes("PBKDF2")||!vaultBundle.includes("AES-GCM")||vaultBundle.includes("correct horse battery staple")||/eval\(|new Function/u.test(vaultBundle))throw new Error(`Invalid encrypted vault bundle: ${artifact.name}`);
  const signerBundle=execFileSync("unzip",["-p",archive,"extension-signer.js"],{encoding:"utf8"});if(!signerBundle.includes("eth_signTypedData_v4")||!signerBundle.includes("eth_sendTransaction")||/eval\(|new Function/u.test(signerBundle))throw new Error(`Invalid signer bundle: ${artifact.name}`);
  if (extension.content_security_policy?.extension_pages !== "script-src 'self'; object-src 'self'; connect-src https://evm.ynxweb4.com") throw new Error(`Invalid extension RPC CSP: ${artifact.name}`);
  if (JSON.stringify(extension.host_permissions) !== JSON.stringify(["https://*/*"])) throw new Error(`Invalid host permissions: ${artifact.name}`);
  const expectedContentScripts=[
    {matches:["https://*/*"],js:["content-script.js"],run_at:"document_start",all_frames:false,match_about_blank:false},
    {matches:["https://*/*"],js:["page-provider.js"],run_at:"document_start",all_frames:false,match_about_blank:false,world:"MAIN"},
  ];
  if(JSON.stringify(extension.content_scripts)!==JSON.stringify(expectedContentScripts))throw new Error(`Invalid deterministic HTTPS provider injection: ${artifact.name}`);
  for (const forbidden of ["web_accessible_resources", "optional_host_permissions", "update_url", "key"]) if (forbidden in extension) throw new Error(`Forbidden ${forbidden}: ${artifact.name}`);
  const pageProvider=execFileSync("unzip",["-p",archive,"page-provider.js"],{encoding:"utf8"});
  if(!pageProvider.includes('rdns:"com.ynx.wallet"')||!pageProvider.includes('isYNXWallet:true')||!pageProvider.includes('isMetaMask:false')||!pageProvider.includes('eip6963:requestProvider')||!pageProvider.includes('eip6963:announceProvider')||!pageProvider.includes('queueMicrotask(announce)'))throw new Error(`Invalid YNX EIP-6963 provider identity: ${artifact.name}`);
  for(const sourceName of ["app.js","page-provider.js","content-script.js","service-worker.js"]){const source=execFileSync("unzip",["-p",archive,sourceName],{encoding:"utf8"});if(/window\.open\s*\(/u.test(source)||/(?:window\.)?location(?:\.href)?\s*=\s*[`'"]ynxwallet:\/\//u.test(source))throw new Error(`Forbidden top-level YNX custom-scheme navigation in ${sourceName}: ${artifact.name}`)}
  if (artifact.browsers.includes("Firefox")) {
    if (extension.browser_specific_settings?.gecko?.id !== "wallet-testnet@ynxweb4.com" || extension.browser_specific_settings?.gecko?.strict_min_version !== "128.0") throw new Error(`Invalid Firefox identity metadata: ${artifact.name}`);
  } else if (extension.minimum_chrome_version !== "120") {
    throw new Error(`Invalid Chromium minimum version: ${artifact.name}`);
  }
}

if (manifest.downloadHosted || manifest.productionSigned || manifest.storeReleased || manifest.installedLocal) throw new Error("Unproved release boolean is true");
console.log(`Verified ${manifest.artifacts.length} fail-closed artifact packages.`);
