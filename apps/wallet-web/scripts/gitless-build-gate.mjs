import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),repository=resolve(root,"../..");
const checkoutCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim();
if(!/^[0-9a-f]{40}$/u.test(checkoutCommit))throw new Error("Gitless gate requires an exact checkout commit");
const stage=await mkdtemp(join(tmpdir(),"ynx-wallet-gitless-build-"));
const archive=join(dirname(stage),`${basename(stage)}.tar`);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
try{
  execFileSync("git",["archive","--format=tar",`--output=${archive}`,"HEAD:apps/wallet-web"],{cwd:repository,stdio:"pipe"});
  execFileSync("tar",["-xf",archive,"-C",stage],{stdio:"pipe"});
  if(existsSync(join(stage,".git")))throw new Error("Git metadata entered the deployment archive");
  await mkdir(join(stage,"dist"),{recursive:true});
  const env={...process.env,YNX_WALLET_WEB_SOURCE_COMMIT:"",VERCEL:"1",VERCEL_GIT_COMMIT_SHA:checkoutCommit};
  execFileSync("npm",["ci","--no-audit","--no-fund"],{cwd:stage,env,stdio:"pipe",maxBuffer:32*1024*1024});
  execFileSync("npm",["run","build"],{cwd:stage,env,stdio:"pipe",maxBuffer:32*1024*1024});
  const authorityArchive=await readFile(join(stage,"build-authority.json"));
  const identity=JSON.parse(await readFile(join(stage,"dist/pwa/build-identity.json"),"utf8"));
  const addressAuthority=await readFile(join(stage,"vendor/wallet-address-authority.js"));
  if(identity.sourceCommit!==checkoutCommit||identity.authorityArchiveSha256!==sha(authorityArchive)||identity.authorityRecordCount!==14||identity.walletAddressAuthoritySha256!==sha(addressAuthority)||identity.walletAuthSourceTree!=="8e50f7a52a614ea6d4c4a4d2988315d036ea0b25"||identity.walletAddressWrapperBlob!=="fb0f96cc68df36c13eb6c9d92a59cb771ddd6b93")throw new Error("Gitless build identity is not bound to its source and immutable authorities");
  const tampered=Buffer.concat([authorityArchive,Buffer.from("\n")]);
  await writeFile(join(stage,"build-authority.json"),tampered);
  let rejected=false,errorMessage=null;
  try{execFileSync("npm",["run","build"],{cwd:stage,env,stdio:"pipe",maxBuffer:32*1024*1024})}catch(error){rejected=true;errorMessage=Buffer.concat([error.stdout||Buffer.alloc(0),error.stderr||Buffer.alloc(0)]).toString("utf8")}
  if(!rejected||!errorMessage.includes("Immutable Wallet build authority archive changed"))throw new Error("A byte-changed authority archive did not fail closed");
  await writeFile(join(stage,"build-authority.json"),authorityArchive);
  await writeFile(join(stage,"vendor/wallet-address-authority.js"),Buffer.concat([addressAuthority,Buffer.from("\n")]));
  rejected=false;errorMessage=null;
  try{execFileSync("npm",["run","build"],{cwd:stage,env,stdio:"pipe",maxBuffer:32*1024*1024})}catch(error){rejected=true;errorMessage=Buffer.concat([error.stdout||Buffer.alloc(0),error.stderr||Buffer.alloc(0)]).toString("utf8")}
  if(!rejected||!errorMessage.includes("Immutable Wallet address authority bundle changed"))throw new Error("A byte-changed Wallet address authority did not fail closed");
  console.log(JSON.stringify({passed:true,sourceCommit:checkoutCommit,authorityArchiveSha256:identity.authorityArchiveSha256,authorityRecordCount:identity.authorityRecordCount,walletAddressAuthoritySha256:identity.walletAddressAuthoritySha256,walletAuthSourceTree:identity.walletAuthSourceTree,walletAddressWrapperBlob:identity.walletAddressWrapperBlob,gitMetadataCopied:false,stageClass:basename(stage),tamperedArchiveRejected:true,tamperedAddressAuthorityRejected:true}));
}finally{await rm(stage,{recursive:true,force:true});await rm(archive,{force:true})}
