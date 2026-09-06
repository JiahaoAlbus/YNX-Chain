import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile,readdir,lstat,utimes} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildAll} from "../scripts/build.mjs";

const web=resolve(dirname(fileURLToPath(import.meta.url)),".."),repository=resolve(web,"../..");
const destination=process.argv[2]&&resolve(process.argv[2]);
if(!destination)throw new Error("Usage: node store/export-reviewer-source.mjs NEW_OUTPUT_DIRECTORY");
if(process.env.YNX_WALLET_WEB_AUTHORITY_FILE!==undefined)throw new Error("Source export requires the normal Git authority path");
const git=(...args)=>execFileSync("git",args,{cwd:repository,maxBuffer:16*1024*1024});
const commit=git("rev-parse","HEAD").toString().trim();
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const selected=path=>/^(?:apps\/wallet-web\/(?:src|public|extension|scripts|test|fixtures|store)\/|packages\/wallet-auth\/src\/)/u.test(path) ||
  ["apps/wallet-web/package.json","apps/wallet-web/package-lock.json","apps/wallet-web/README.md","packages/wallet-auth/package.json","packages/wallet-auth/package-lock.json","release/integration/wallet-web-pwa-site/wallet-manifest-binding.mjs","release/integration/wallet-web-pwa-site/frozen-wallet-manifest.webmanifest"].includes(path);
const entries=git("ls-tree","-rz","--full-tree",commit).toString().split("\0").filter(Boolean).map(value=>{
  const [meta,path]=value.split("\t"),[mode,type,blob]=meta.split(" ");return{mode,type,blob,path};
}).filter(x=>selected(x.path)).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
if(!entries.some(x=>x.path==="apps/wallet-web/store/export-reviewer-source.mjs"))throw new Error("Exporter must be committed before materializing release sources");
// Never package a working-tree override, symlink, credential directory or mutable artifact.
const files=[];
for(const entry of entries){
  if(!["100644","100755"].includes(entry.mode)||entry.type!=="blob"||/[\n\r]/u.test(entry.path))throw new Error("Unsupported source entry");
  const bytes=git("cat-file","blob",entry.blob),current=join(repository,entry.path);
  if((await lstat(current)).isSymbolicLink()||!(await readFile(current)).equals(bytes))throw new Error(`Uncommitted source: ${entry.path}`);
  files.push({...entry,bytes:bytes.length,sha256:hash(bytes)});
}
await mkdir(destination); // Refuse an existing directory; preserve previous packages.
const source=join(destination,"source");await mkdir(source);
for(const entry of files){const target=join(source,entry.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,git("cat-file","blob",entry.blob));}
const authorityPath=join(source,"build-authorities.json"),reference=join(destination,"reference-dist");
const previous=process.env.YNX_WALLET_WEB_SOURCE_COMMIT;process.env.YNX_WALLET_WEB_SOURCE_COMMIT=commit;
try{await buildAll({dist:reference,authorityFile:undefined,authorityOutput:authorityPath});}
finally{if(previous===undefined)delete process.env.YNX_WALLET_WEB_SOURCE_COMMIT;else process.env.YNX_WALLET_WEB_SOURCE_COMMIT=previous;}
const expectedOutputs=[];
for(const variant of ["chromium","firefox","pwa"]){for(const file of (await readdir(join(reference,variant))).sort()){const bytes=await readFile(join(reference,variant,file));expectedOutputs.push({path:`${variant}/${file}`,bytes:bytes.length,sha256:hash(bytes)})}}
const manifest={schemaVersion:1,sourceCommit:commit,files,authorityArchiveSha256:hash(await readFile(authorityPath)),expectedOutputs};
await writeFile(join(source,"source-package.json"),JSON.stringify(manifest,null,2)+"\n");
await writeFile(join(source,"REBUILD.md"),`# YNX Wallet reviewer sources\n\nExact source commit: ${commit}. No Git repository or developer dependencies are needed. Use Node 24.19.0 and npm 11.19.0 (record your actual versions). From this extracted directory:\n\n\`\`\`sh\nnpm ci --prefix packages/wallet-auth --no-audit --no-fund\nnpm ci --prefix apps/wallet-web --no-audit --no-fund\nnode apps/wallet-web/store/rebuild-reviewer-source.mjs\n\`\`\`\n\nThe rebuild checks every submitted source file, both fixed authority hashes and every generated output byte against the normal Git build. Outputs are in reviewer-output; the result is rebuild-result.json. Dependencies are installed from the included integrity-locked npm manifests, not symlinked to a developer checkout. See apps/wallet-web/store/submission-build.md for disclosure and review boundaries. No store submission or signing is performed.\n`);
const timestamp=new Date("2000-01-01T00:00:00.000Z");
async function normalize(directory){for(const name of await readdir(directory)){const path=join(directory,name),stat=await lstat(path);if(stat.isSymbolicLink())throw new Error("Source archive cannot contain symlinks");if(stat.isDirectory())await normalize(path);await utimes(path,timestamp,timestamp)}}
await normalize(source);
const archive=join(destination,`ynx-wallet-reviewer-source-${commit.slice(0,7)}.zip`);
execFileSync("zip",["-X","-q","-r",archive,"."],{cwd:source});
const bytes=await readFile(archive),result={sourceCommit:commit,archive,bytes:bytes.length,sha256:hash(bytes),sourceFileCount:files.length,authorityRecords:JSON.parse(await readFile(authorityPath)).records.length,expectedOutputFiles:expectedOutputs.length,extractedRebuildVerified:false,storeSubmitted:false};
await writeFile(join(destination,"source-archive-manifest.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
