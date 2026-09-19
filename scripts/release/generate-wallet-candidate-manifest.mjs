import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, mkdir, open, realpath, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("git", args, {cwd:root, encoding:"utf8"}).trim();

function parseArguments(argv) {
  const result = {artifacts:[]};
  for (let index=0; index<argv.length; index+=1) {
    const name=argv[index], value=argv[index+1];
    if (!["--root","--output","--source-commit","--sbom","--public-source-commit","--artifact"].includes(name) || !value) throw new Error(`Invalid argument: ${name || "missing"}`);
    if (name === "--artifact") result.artifacts.push(value);
    else result[name.slice(2).replaceAll("-","")]=value;
    index+=1;
  }
  if (!result.root || !result.output || !result.sourcecommit || !result.sbom || !result.artifacts.length) {
    throw new Error("Usage: generate-wallet-candidate-manifest --root <repo> --output <dir> --source-commit <sha> --sbom <path> --artifact <platform|signing-class|path> [...]");
  }
  return result;
}

async function recordFile(root, descriptor) {
  const [platform, signingClass, relativePath, ...extra]=descriptor.split("|");
  if (!platform || !signingClass || !relativePath || extra.length) throw new Error(`Invalid artifact descriptor: ${descriptor}`);
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes("..")) throw new Error(`Artifact path must stay under root: ${relativePath}`);
  const absolute=path.resolve(root, relativePath), expectedRoot=`${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(expectedRoot)) throw new Error(`Artifact path escapes root: ${relativePath}`);
  const [realRoot,realArtifact]=await Promise.all([realpath(root),realpath(absolute)]);
  if (!realArtifact.startsWith(`${realRoot}${path.sep}`)) throw new Error(`Artifact symlink escapes root: ${relativePath}`);
  const canonical=path.join(realRoot,path.relative(path.resolve(root),absolute));
  if (realArtifact !== canonical) throw new Error(`Artifact path contains a symlink: ${relativePath}`);
  const components=path.relative(realRoot,canonical).split(path.sep), snapshots=[]; let cursor=realRoot;
  for (const component of components) { cursor=path.join(cursor,component); const info=await lstat(cursor); if (info.isSymbolicLink()) throw new Error(`Artifact path contains a symlink: ${relativePath}`); snapshots.push([cursor,info.dev,info.ino,info.mode]); }
  const handle=await open(canonical,constants.O_RDONLY|constants.O_NOFOLLOW); let bytes,info;
  try { info=await handle.stat(); bytes=await handle.readFile(); } finally { await handle.close(); }
  for (const [entry,dev,ino,mode] of snapshots) { const after=await lstat(entry); if (after.dev!==dev||after.ino!==ino||after.mode!==mode) throw new Error(`Artifact path changed while reading: ${relativePath}`); }
  if (await realpath(canonical)!==realArtifact) throw new Error(`Artifact path changed while reading: ${relativePath}`);
  if (!info.isFile() || info.size === 0) throw new Error(`Artifact is not a non-empty file: ${relativePath}`);
  return {platform, filename:path.basename(relativePath), path:relativePath, bytes:info.size, sha256:sha256(bytes), signingClass,
    installedLocal:false, publicDownloadVerified:false, productionSigned:false, storeReleased:false};
}

export async function generateWalletCandidateManifest(options) {
  const root=path.resolve(options.root), sourceCommit=options.sourcecommit;
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("An exact 40-character source commit is required");
  git(root,"cat-file","-e",`${sourceCommit}^{commit}`);
  if (git(root,"rev-parse","HEAD") !== sourceCommit) throw new Error("Checkout HEAD differs from candidate source commit");
  const sourcePaths=["apps/wallet","apps/wallet-web","apps/wallet-desktop","packages/wallet-auth"];
  git(root,"diff","--exit-code",sourceCommit,"--",...sourcePaths);
  const untracked=git(root,"ls-files","--others","--exclude-standard","--",...sourcePaths);
  if (untracked) throw new Error(`Untracked Wallet source is not allowed: ${untracked.split("\n")[0]}`);
  const artifacts=[];
  for (const descriptor of options.artifacts) artifacts.push(await recordFile(root,descriptor));
  const sbom=await recordFile(root,`wallet-sbom|cyclonedx-1.6|${options.sbom}`);
  const sourceTrees=Object.fromEntries(["apps/wallet","apps/wallet-web","apps/wallet-desktop","packages/wallet-auth"].map(item=>[item,git(root,"rev-parse",`${sourceCommit}:${item}`)]));
  const manifest={schemaVersion:1,product:"YNX Wallet",distribution:"testnet-preview",sourceCommit,sourceTrees,
    publicRuntimeSourceCommit:options.publicsourcecommit || null,currentSourceDeployedPublic:false,integratedCentral:false,
    installedEndToEndVerified:false,productionSigned:false,storeReleased:false,artifacts,sbom};
  const rollback={schemaVersion:1,product:"YNX Wallet",candidateSourceCommit:sourceCommit,ready:false,
    reason:"No prior artifact was supplied and reverified in this candidate run.",
    requiredEvidence:["prior artifact bytes and SHA-256","compatible persisted-state schema","installed downgrade and relaunch proof"]};
  await mkdir(options.output,{recursive:true});
  await writeFile(path.join(options.output,"release-manifest.json"),`${JSON.stringify(manifest,null,2)}\n`);
  await writeFile(path.join(options.output,"rollback-manifest.json"),`${JSON.stringify(rollback,null,2)}\n`);
  return {manifest,rollback};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result=await generateWalletCandidateManifest(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify({sourceCommit:result.manifest.sourceCommit,artifacts:result.manifest.artifacts.length,rollbackReady:result.rollback.ready}));
}
