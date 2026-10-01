import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repository=resolve(root,"..","..");
const evidencePath=join(root,"evidence","runtime","built-current-catalog-entry-0.1.15-20261001.json");
const sourceCommit=process.env.YNX_WALLET_WEB_SOURCE_COMMIT||execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim();
execFileSync(process.execPath,["scripts/build.mjs"],{cwd:root,stdio:"inherit",env:{...process.env,YNX_WALLET_WEB_SOURCE_COMMIT:sourceCommit}});

const [provider,app,styles,nativeManifest,publicChannels]=await Promise.all([
  import(`${pathToFileURL(join(root,"dist","pwa","provider.js")).href}?built=${Date.now()}`),
  readFile(join(root,"dist","pwa","app.js"),"utf8"),
  readFile(join(root,"dist","pwa","styles.css"),"utf8"),
  readFile(join(repository,"apps","wallet","artifact-manifest.json"),"utf8").then(JSON.parse),
  readFile(join(root,"public-channel-manifest.json"),"utf8").then(JSON.parse),
]);
const matrix=provider.WALLET_DOWNLOAD_MATRIX;
const failures=[];
const require=(condition,message)=>{if(!condition)failures.push(message)};
const android=nativeManifest.artifacts.find(item=>item.name==="android-release-apk");
const officialWalletURL=artifact=>`https://downloads.ynxweb4.com/wallet/sha256-${artifact.sha256}/${artifact.url.split("/").pop()}`;
for(const [key,entry] of Object.entries(matrix)){
  require(entry?.hosted===true,`${key} is incorrectly shown as unavailable`);
  require(typeof entry?.url==="string"&&entry.url.startsWith("https://"),`${key} has no HTTPS download`);
  require(Number.isSafeInteger(entry?.bytes)&&entry.bytes>0,`${key} has no exact byte size`);
  require(/^[0-9a-f]{64}$/u.test(entry?.sha256||""),`${key} has no exact SHA-256`);
  require(entry?.productionSigned===false,`${key} has an unsupported production-signing claim`);
}
for(const key of ["android","windowsX64","windowsArm64","macosUniversal","linuxX64","linuxArm64"]){
  const entry=matrix[key];
  require(key==="android"?provider.isPinnedAndroidRelease(entry):new URL(entry.url).hostname==="downloads.ynxweb4.com"&&entry.url.includes(`/sha256-${entry.sha256}/`),`${key} is not bound to the exact verified download`);
}
require(app.includes('id="current-wallet-downloads" href="${YNX_DOWNLOAD_URL}"')&&provider.YNX_DOWNLOAD_URL==="https://www.ynxweb4.com/dapp/wallet/open-download","built install details must use the official current release catalog");
require(!/packageSources|WALLET_DOWNLOAD_MATRIX\./.test(app),"built UI must not offer stale snapshot package links");
require(/button\.disabled = button\.dataset\.permanentDisabled === "true"/u.test(app),"built UI lost permanent-disabled handling");
require(/@media\(max-width:520px\)[\s\S]*\.wallets,\.actions,\.platform-grid\{grid-template-columns:minmax\(0,1fr\)\}/u.test(styles),"built UI lost narrow layout");

const result={schemaVersion:2,sourceCommit,generatedAt:new Date().toISOString(),gateClass:"current built PWA install entry delegates release selection and signing disclosures to the official catalog; packaged matrix is a historical snapshot",matrix,failures,passed:failures.length===0,installedLocal:false,deployedPublic:false,productionSigned:false,storeReleased:false};
await mkdir(dirname(evidencePath),{recursive:true});
await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result,null,2));
process.exit(result.passed?0:1);
