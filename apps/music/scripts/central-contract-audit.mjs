import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const registry=JSON.parse(fs.readFileSync(path.join(root,"central/wallet-registry-v2.json"),"utf8"));
const exact=["schemaVersion","productClientId","requestingProduct","bundleId","callbacks","scopes","maxScopes","productDeviceAlgorithms"];
if(JSON.stringify(Object.keys(registry).sort())!==JSON.stringify([...exact].sort()))throw new Error("registry fields are not exact v2");
if(registry.schemaVersion!==2||registry.productClientId!=="ynx-music-v1"||registry.requestingProduct!=="music"||registry.bundleId!=="com.ynxweb4.music")throw new Error("registry identity mismatch");
for(const key of ["callbacks","scopes","productDeviceAlgorithms"]){if(!Array.isArray(registry[key])||new Set(registry[key]).size!==registry[key].length||registry[key].join("\n")!==[...registry[key]].sort().join("\n"))throw new Error(`${key} must be sorted and unique`)}
if(registry.maxScopes!==registry.scopes.length||registry.callbacks.join()!=="ynxmusic://auth/callback"||registry.productDeviceAlgorithms.join()!=="p256-sha256")throw new Error("registry bounds mismatch");
const sources=["android/app/src/main/java/com/ynxweb4/music/CentralContracts.java","ios/YNXMusic/YNXMusicApp.swift","../../internal/music/central.go","../../internal/music/server.go"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n");
for(const legacy of ["/api/auth/challenges","X-YNX-Device-ID","Authorization\",\"Bearer","expectedNonce","legacyToken"]){if(sources.includes(legacy))throw new Error(`legacy auth marker remains: ${legacy}`)}
for(const required of ["YNX_PRODUCT_SESSION_CHALLENGE_V1","X-YNX-App-Session","X-YNX-Product-Device-Key","p256-sha256"]){if(!sources.includes(required))throw new Error(`canonical marker missing: ${required}`)}
console.log("wallet registry v2 and product clients: canonical contract audit passed");
