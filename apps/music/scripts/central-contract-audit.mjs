import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const registries=["central/wallet-registry-v2.json","central/wallet-registry-web-v2.json"].map(file=>JSON.parse(fs.readFileSync(path.join(root,file),"utf8")));
const exact=["schemaVersion","productClientId","requestingProduct","bundleId","callbacks","scopes","maxScopes","productDeviceAlgorithms"];
for(const registry of registries){if(JSON.stringify(Object.keys(registry).sort())!==JSON.stringify([...exact].sort()))throw new Error("registry fields are not exact v2");if(registry.schemaVersion!==2||registry.requestingProduct!=="music")throw new Error("registry identity mismatch");for(const key of ["callbacks","scopes","productDeviceAlgorithms"]){if(!Array.isArray(registry[key])||new Set(registry[key]).size!==registry[key].length||registry[key].join("\n")!==[...registry[key]].sort().join("\n"))throw new Error(`${key} must be sorted and unique`)}if(registry.maxScopes!==registry.scopes.length||registry.productDeviceAlgorithms.join()!=="p256-sha256")throw new Error("registry bounds mismatch")}
if(registries[0].productClientId!=="ynx-music-v1"||registries[0].bundleId!=="com.ynxweb4.music"||registries[0].callbacks.join()!=="ynxmusic://auth/callback")throw new Error("mobile registry identity mismatch");
if(registries[1].productClientId!=="ynx-music-web-v1"||registries[1].bundleId!=="web.ynx.music"||registries[1].callbacks.join()!=="https://web4.ynxweb4.com/music/auth/callback")throw new Error("Web registry identity mismatch");
const sources=["android/app/src/main/java/com/ynxweb4/music/CentralContracts.java","ios/YNXMusic/YNXMusicApp.swift","web/music-wallet-auth.js","../../internal/music/central.go","../../internal/music/server.go"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n");
for(const legacy of ["/api/auth/challenges","/api/auth/wallet-v1/challenge","X-YNX-Device-ID","X-YNX-App-Session","X-YNX-Product-Device-Key","expectedNonce","legacyToken"]){if(sources.includes(legacy))throw new Error(`legacy auth marker remains: ${legacy}`)}
for(const required of ["YNX_PRODUCT_SESSION_CHALLENGE_V1","YNX_PRODUCT_SESSION_HTTP_PROOF_V1","X-YNX-Product-Session-Proof","p256-sha256"]){if(!sources.includes(required))throw new Error(`canonical marker missing: ${required}`)}
console.log("mobile and Web Wallet registries plus per-request Product Session proofs: canonical contract audit passed");
