import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build as bundle} from "esbuild";
import {chromiumManifest, firefoxManifest} from "../src/extension-manifest.js";
import {deriveWalletWebCompanionBinding} from "../src/core-auth-consumer.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const repository=resolve(root,"..","..");
const centralMobileCommit="d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59";
const centralMobileContracts=[
  {path:"release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json",blob:"d402fcdc844aa39bd5ee351a99d93acb4852dc37",sha256:"d344c607c2bbbf7bb0d9d3662b424976d0d6c4ff20428025dd1e2fb92bf31392"},
  {path:"release/integration/wallet-auth-android-launcher-contract.json",blob:"83c9f91779701288861cff5e4dc6c487ffcdc26c",sha256:"d296732141a4029b1811b655f0001cc7d81a1d45019a4bd87d21b2b4b256d1a6"},
];
for(const contract of centralMobileContracts){
  const object=execFileSync("git",["rev-parse",`${centralMobileCommit}:${contract.path}`],{cwd:repository,encoding:"utf8"}).trim();
  const bytes=execFileSync("git",["show",`${centralMobileCommit}:${contract.path}`],{cwd:repository});
  if(object!==contract.blob||createHash("sha256").update(bytes).digest("hex")!==contract.sha256)throw new Error(`Central mobile Wallet contract mismatch: ${contract.path}`);
}
const centralCallerCommit="38c9c0ce1400ad6ba8dc5e0c1aa1d657a6c9748d";
const centralCallerContract={path:"release/integration/wallet-auth-android-launcher-contract.json",blob:"0e0d702f9245fae42daec7d0a3a3fd5fe83f9a42",sha256:"27449c80300acd463574d5d7bb016e2273cfd7d24f6669c9da00505559393a58"};
const coreCommit="39c80021b87730a20569b61f6ccd3f80092523c4";
const coreContracts=[
  {path:"release/integration/wallet-auth-web-companion-registry-contract.json",blob:"a1db56d51f3afe795faace17e4e7bb51cae66ff7",sha256:"6584e439783d6c83e8aef712af95488e75cfa034c259d63356cb7bdc731f684f"},
  {path:"packages/wallet-auth/product-session-registry.json",blob:"a59f7aba930e6643363e7c0b5bb27028c1ecc43a",sha256:"f8a25702bdc7e3bd12b0cdecd6ac513b0a3d3ac25832a112efbe6b788ff8de9b"},
  {path:"packages/wallet-auth/src/product-session-recovery.js",blob:"9e5af333b5873a36ab0884917a21a17675b36456",sha256:"84ea01c9d36e2de70928e42881aaa33e4883dbbeeb0072a34e9849e72f6b824c"},
  {path:"packages/wallet-auth/src/product-session-gateway-client.js",blob:"89b12a5f54725b2dfc2194495f228cc1b265bacf",sha256:"671f85b00b1f3a6e40d0c43e6a631d3e15edbe99cb242056be289b91f11a8ca0"},
];
const providerAuthorityCommit="98c6d5d784d212df8981a53b17118a511e246ad2";
const providerAuthorityContracts=[
  {path:"packages/wallet-auth/src/standard-wallet-connect-state.js",blob:"60879be26a4b4760dea53b38f76872045c421202",sha256:"72558116f22625c6e9abf363b9dd16a7b1b80c93d88099be531cb63e70a62b92"},
  {path:"packages/wallet-auth/src/wallet-provider-discovery.js",blob:"38198077220584668a94649c7f36d6881bfab6fb",sha256:"94875a262b7422f3153ecfd7cbe4bde2c7884239bc9f1003a1e6f86ca74b08ed"},
  {path:"packages/wallet-auth/scripts/verify-standard-wallet-connect-consumer.mjs",blob:"bdbd1f80db502096ff204ce2c5db3afce311547d",sha256:"19682da2caa7020f5648e9fe8136f27813b41ba171fcdfc01e5f0fccc908c045"},
];
const providerEvidenceAuthorities=[
  {commit:"0c9846e6856f53e6d0ec1bc7dd7b389fefb03441",path:"release/integration/wallet-provider-discovery-connect-state-p0-handoff-20260821.json",blob:"ec7f04bd0cec075a89e0ad95daf9bc844fdb18eb",sha256:"6ffa68a649ec32b9569b78045a665fd05a5454dc9327094316a969ecfc60697e"},
  {commit:"c3ab255c32bdeb9c8e056882c315f8ad43c29c7f",path:"release/integration/wallet-provider-discovery-connect-state-p0-handoff-20260821.json",blob:"745c85539b89f542b774c862e01ee847a438cec9",sha256:"2c3872882b2d88986cecafa6c08fc3a640d60039eb8dab29d3a088aaa6452f49"},
  {commit:"d3831c300560507f64a50e73117bab7b85926d9a",path:"release/integration/wallet-provider-connect-pending-owner-handoffs-20260821.json",blob:"4e8a760b30fc4dd54cce2cde388515701592ddd3",sha256:"c79c82b0053120a5f492ce177c9100e8f60f07be52c97fe88ab6f9a2eff57854"},
];
const routerInteropCommit="9ab9cd8c8deac8563acff9ffd7e277553e20383e";
const routerInteropContract={path:"release/integration/wallet-standard-connection-conformance-contract-p0-20260822.json",blob:"173cb99a6fa6b942f43c6dc8ee3a3b851e876525",sha256:"c59cc18de86a304be8de6ef7056e3e260e62156fe36fb0b76e021e38e096a2fe"};
function immutableObject(commit,contract){
  const object=execFileSync("git",["rev-parse",`${commit}:${contract.path}`],{cwd:repository,encoding:"utf8"}).trim();
  const bytes=execFileSync("git",["show",`${commit}:${contract.path}`],{cwd:repository});
  if(object!==contract.blob||createHash("sha256").update(bytes).digest("hex")!==contract.sha256)throw new Error(`Immutable authority mismatch: ${contract.path}`);
  return bytes;
}
const centralCaller=JSON.parse(immutableObject(centralCallerCommit,centralCallerContract));
if(centralCaller?.authority?.walletPackage!=="com.ynxweb4.wallet"||centralCaller?.authority?.uriTemplate!=="ynxwallet://authorize?request=<base64url-canonical-authorization-request>"||centralCaller?.sharedCallerRequirements?.singleBuilder!=="@ynx-chain/wallet-auth encodeRequestDeepLink")throw new Error("Central caller authority mismatch");
const [coreContractBytes]=coreContracts.map((contract)=>immutableObject(coreCommit,contract));
providerAuthorityContracts.forEach((contract)=>immutableObject(providerAuthorityCommit,contract));
providerEvidenceAuthorities.forEach(({commit,...contract})=>immutableObject(commit,contract));
const routerInterop=JSON.parse(immutableObject(routerInteropCommit,routerInteropContract));
const expectedInteropProfiles=["ynx-first-party","uniswap-interface-reference","opensea-reference","safe-reference","walletconnect-v2-reference"];
if(routerInterop?.version!=="standardWalletConformance@1.0.0-p0.0"||routerInterop?.authoritativeInputs?.sharedProvider?.commit!==providerAuthorityCommit||routerInterop?.layering?.directBrowserRpcFetchIsPrerequisite!==false||routerInterop?.layering?.productSessionFailure?.standardConnection!=="CONNECTED"||routerInterop?.layering?.productSessionFailure?.privateService!=="DEGRADED"||JSON.stringify(routerInterop?.chain)!==JSON.stringify({cosmosChainId:"ynx_6423-1",evmChainId:6423,evmChainHex:"0x1917",nativeSymbol:"YNXT",defaultLanguage:"en"})||routerInterop?.executableInteropFixture?.fixtureOnly!==true||JSON.stringify(routerInterop?.executableInteropFixture?.profiles)!==JSON.stringify(expectedInteropProfiles)||!routerInterop?.requiredDirectEvidenceBeforePromotion?.includes("three independently opened non-YNX standard EVM DApps plus a first-party DApp"))throw new Error("Router Standard EVM interop authority mismatch");
const coreAuthBinding=deriveWalletWebCompanionBinding(JSON.parse(coreContractBytes),{
  coreCommit,coreContractBlob:coreContracts[0].blob,centralCallerCommit,centralCallerBlob:centralCallerContract.blob,
  publicGatewayRegistryReady:false,trustedRuntimeAvailable:false,
});
await rm(dist, {recursive: true, force: true});
await mkdir(join(dist, "pwa"), {recursive: true});
const sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree";
const buildIdentity={schemaVersion:1,product:"YNX Wallet Companion",sourceCommit,providerAuthorityCommit,providerEvidenceCommit:"d3831c300560507f64a50e73117bab7b85926d9a",chainId:"0x1917"};
await writeFile(join(dist,"pwa","build-identity.json"),`${JSON.stringify(buildIdentity)}\n`);
await writeFile(join(dist,"pwa","core-auth-binding.js"),`export const CORE_WALLET_AUTH_BINDING=Object.freeze(${JSON.stringify(coreAuthBinding)});\n`);
for (const file of ["index.html", "manifest.webmanifest", "sw.js", "styles.css", "accessibility.css", "app.js"]) await cp(join(root, "public", file), join(dist, "pwa", file));
await cp(join(root,"public","vercel.json"),join(dist,"pwa","vercel.json"));
for (const file of ["provider.js", "i18n.js", "preferences.js", "mobile-wallet-routing.js", "core-auth-consumer.js", "wallet-web-companion-lifecycle.js", "standard-wallet-connect-state.js"]) await cp(join(root, "src", file), join(dist, "pwa", file));
await cp(join(root, "src", "service-worker-policy.js"), join(dist, "pwa", "service-worker-policy.js"));
for(const icon of ["ynx-logo.png","ynx-icon-192.png","ynx-icon-512.png","ynx-icon-maskable-512.png"])await cp(join(root,"public",icon),join(dist,"pwa",icon));
const pwaIntegrityFiles=["index.html","styles.css","accessibility.css","app.js","provider.js","i18n.js","preferences.js","mobile-wallet-routing.js","core-auth-consumer.js","wallet-web-companion-lifecycle.js","standard-wallet-connect-state.js","core-auth-binding.js","service-worker-policy.js","build-identity.json","ynx-logo.png","ynx-icon-192.png","ynx-icon-512.png","ynx-icon-maskable-512.png","manifest.webmanifest"],assetIntegrity={};
for(const file of pwaIntegrityFiles)assetIntegrity[`./${file}`]=createHash("sha256").update(await readFile(join(dist,"pwa",file))).digest("hex");
assetIntegrity["./"]=assetIntegrity["./index.html"];
await writeFile(join(dist,"pwa","asset-integrity.js"),`export const ASSET_INTEGRITY=Object.freeze(${JSON.stringify(assetIntegrity)});\n`);

const variants = [
  ["chromium", chromiumManifest],
  ["firefox", firefoxManifest],
];
for (const [name, manifest] of variants) {
  const target = join(dist, name); await mkdir(target, {recursive: true});
  for (const file of ["index.html", "styles.css", "accessibility.css", "app.js"]) await cp(join(root, "public", file), join(target, file));
  for (const file of ["approval.html","approval.css","approval.js","vault.html","vault.css","vault.js","signer.html","signer.css","signer.js"]) await cp(join(root,"extension",file),join(target,file));
  for (const file of ["provider.js", "i18n.js", "preferences.js", "mobile-wallet-routing.js", "wallet-web-companion-lifecycle.js", "standard-wallet-connect-state.js"]) await cp(join(root, "src", file), join(target, file));
  for (const file of ["service-worker.js", "content-script.js", "page-provider.js"]) await cp(join(root, "extension", file), join(target, file));
  await cp(join(root, "src", "extension-bridge.js"), join(target, "extension-bridge.js"));
  await cp(join(root, "src", "extension-rpc.js"), join(target, "extension-rpc.js"));
  await cp(join(root, "src", "extension-provider-permissions.js"), join(target, "extension-provider-permissions.js"));
  await bundle({entryPoints:[join(root,"src","extension-vault.js")],outfile:join(target,"extension-vault.js"),bundle:true,format:"esm",platform:"browser",target:name==="firefox"?"firefox128":"chrome120",legalComments:"none",minify:true});
  await bundle({entryPoints:[join(root,"src","extension-signer.js")],outfile:join(target,"extension-signer.js"),bundle:true,format:"esm",platform:"browser",target:name==="firefox"?"firefox128":"chrome120",legalComments:"none",minify:true});
  await cp(join(root, "src", "core-auth-consumer.js"), join(target, "core-auth-consumer.js"));
  await cp(join(root, "src", "extension-sensitive-policy.js"), join(target, "extension-sensitive-policy.js"));
  await cp(join(root, "src", "active-tab-policy.js"), join(target, "active-tab-policy.js"));
  await cp(join(root, "src", "extension-migration.js"), join(target, "extension-migration.js"));
  await writeFile(join(target,"core-auth-binding.js"),`export const CORE_WALLET_AUTH_BINDING=Object.freeze(${JSON.stringify(coreAuthBinding)});\n`);
  await writeFile(join(target,"build-identity.json"),`${JSON.stringify(buildIdentity)}\n`);
  await cp(join(root, "public", "ynx-logo.png"), join(target, "ynx-logo.png"));
  const providerSource=await readFile(join(target,"page-provider.js"),"utf8"),providerIcon=`data:image/png;base64,${(await readFile(join(root,"public","ynx-logo.png"))).toString("base64")}`;
  if(!providerSource.includes("__YNX_PROVIDER_ICON_DATA_URI__"))throw new Error("YNX Provider icon placeholder missing");
  await writeFile(join(target,"page-provider.js"),providerSource.replace("__YNX_PROVIDER_ICON_DATA_URI__",providerIcon));
  const html = (await readFile(join(target, "index.html"), "utf8")).replace('<link rel="manifest" href="./manifest.webmanifest">', "");
  await writeFile(join(target, "index.html"), html);
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log("Built PWA plus unsigned Chromium (Chrome/Edge) and Firefox extension directories.");
