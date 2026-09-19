import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),repository=resolve(root,"../..");
const expectedAuthorityArchiveSha256="4a7eed2da6b1626cce94713a0d4420c56ebedef0d71ee39b7e2cd9bc6762ead7";
const expectedAddressAuthoritySha256="df4bade31952f98602f51fbc9cbcb731bffe772da3d685b5be7ce895cb0e409f";
const requiredIntegrityAssets=["./","./index.html","./styles.css","./accessibility.css","./app.js","./provider.js","./wallet-address.js","./extension-fee-model.js","./extension-durability.js","./transaction-input.js","./i18n.js","./preferences.js","./mobile-wallet-routing.js","./core-auth-consumer.js","./wallet-web-companion-lifecycle.js","./standard-wallet-connect-state.js","./core-auth-binding.js","./service-worker-policy.js","./build-identity.json","./ynx-logo.png","./ynx-icon-192.png","./ynx-icon-512.png","./ynx-icon-maskable-512.png","./manifest.webmanifest"];
const requiredStaticFiles=[...new Set([...requiredIntegrityAssets.filter(reference=>reference!=="./").map(reference=>reference.slice(2)),"asset-integrity.js","sw.js"])].sort();
const requiredHeaderRoutes=["^/build-identity\\.json$","^/sw\\.js$","^/asset-integrity\\.js$","^/service-worker-policy\\.js$"];
const requiredSecurityHeaders={
  "Content-Security-Policy":"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://rpc-testnet.ynxweb4.com https://evm.ynxweb4.com; manifest-src 'self'; worker-src 'self'",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "X-Frame-Options":"DENY",
};
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

export async function validateVercelStaticOutput(directory,sourceCommit){
  if(!/^[0-9a-f]{40}$/u.test(sourceCommit))throw new Error("Expected Vercel source commit must be exact");
  const root=resolve(directory);
  if(!(await stat(root)).isDirectory())throw new Error("Vercel static output is missing");
  const identity=JSON.parse(await readFile(join(root,"build-identity.json"),"utf8"));
  if(identity.sourceCommit!==sourceCommit||identity.authorityArchiveSha256!==expectedAuthorityArchiveSha256||identity.authorityRecordCount!==14||identity.walletAddressAuthoritySha256!==expectedAddressAuthoritySha256)throw new Error("Vercel static build identity is not bound to the approved source and authorities");
  const integritySource=await readFile(join(root,"asset-integrity.js"),"utf8");
  const match=integritySource.match(/^export const ASSET_INTEGRITY=Object\.freeze\((\{.*\})\);\n$/u);
  if(!match)throw new Error("Vercel static asset integrity module is invalid");
  const integrity=JSON.parse(match[1]);
  if(JSON.stringify(Object.keys(integrity).sort())!==JSON.stringify([...requiredIntegrityAssets].sort()))throw new Error("Vercel static asset integrity set is incomplete");
  const staticFiles=(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>entry.name).sort();
  if(JSON.stringify(staticFiles)!==JSON.stringify(requiredStaticFiles))throw new Error("Vercel static output file set is incomplete or contains deployment configuration");
  for(const [reference,digest] of Object.entries(integrity)){
    if(!/^[0-9a-f]{64}$/u.test(digest))throw new Error(`Invalid Vercel asset digest: ${reference}`);
    const file=reference==="./"?"index.html":reference.slice(2);
    let bytes;
    try{bytes=await readFile(join(root,file))}catch{throw new Error(`Missing Vercel static asset: ${file}`)}
    if(sha(bytes)!==digest)throw new Error(`Changed Vercel static asset: ${file}`);
  }
  return {identity,integrityAssetCount:Object.keys(integrity).length};
}

export async function validateVercelOutputConfig(file){
  const config=JSON.parse(await readFile(file,"utf8"));
  if(config.version!==3||!Array.isArray(config.routes))throw new Error("Vercel output routing config is invalid");
  const hardened=config.routes.filter(route=>Object.entries(requiredSecurityHeaders).every(([key,value])=>route?.headers?.[key]===value)&&route.continue===true);
  if(hardened.length!==1||hardened[0].src!=="^(?:/(.*))$")throw new Error("Vercel output security header route is incomplete");
  const secured=config.routes.filter(route=>route?.headers?.["Cache-Control"]==="no-store"&&route.continue===true);
  if(JSON.stringify(secured.map(route=>route.src))!==JSON.stringify(requiredHeaderRoutes))throw new Error("Vercel output no-store header routes are incomplete");
  return {headerRouteCount:secured.length,securityHeaderRouteCount:hardened.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim();
  if(!/^[0-9a-f]{40}$/u.test(sourceCommit))throw new Error("Vercel output gate requires an exact checkout commit");
  const stage=await mkdtemp(join(tmpdir(),"ynx-wallet-vercel-output-"));
  const archive=join(dirname(stage),`${basename(stage)}.tar`),output=join(stage,".vercel","output");
  try{
    execFileSync("git",["archive","--format=tar",`--output=${archive}`,"HEAD:apps/wallet-web"],{cwd:repository,stdio:"pipe"});
    execFileSync("tar",["-xf",archive,"-C",stage],{stdio:"pipe"});
    if(existsSync(join(stage,".git")))throw new Error("Git metadata entered the Vercel source archive");
    const env={...process.env,YNX_WALLET_WEB_SOURCE_COMMIT:sourceCommit};
    execFileSync("vercel",["build","--yes","--project","wallet-web","--target","preview","--output",output,"--cwd",stage],{env,stdio:"pipe",maxBuffer:64*1024*1024});
    const staticRoot=join(output,"static"),validated=await validateVercelStaticOutput(staticRoot,sourceCommit),routing=await validateVercelOutputConfig(join(output,"config.json"));
    const removed=join(staticRoot,"core-auth-binding.js"),bytes=await readFile(removed);await rm(removed);
    let missingRejected=false;
    try{await validateVercelStaticOutput(staticRoot,sourceCommit)}catch(error){missingRejected=["Vercel static output file set is incomplete or contains deployment configuration","Missing Vercel static asset: core-auth-binding.js"].includes(error.message)}
    if(!missingRejected)throw new Error("Incomplete Vercel static output did not fail closed");
    await writeFile(removed,bytes);
    console.log(JSON.stringify({passed:true,sourceCommit,staticOutput:".vercel/output/static",authorityArchiveSha256:validated.identity.authorityArchiveSha256,walletAddressAuthoritySha256:validated.identity.walletAddressAuthoritySha256,integrityAssetCount:validated.integrityAssetCount,headerRouteCount:routing.headerRouteCount,securityHeaderRouteCount:routing.securityHeaderRouteCount,gitMetadataCopied:false,missingAssetRejected:true}));
  }finally{await rm(stage,{recursive:true,force:true});await rm(archive,{force:true})}
}
