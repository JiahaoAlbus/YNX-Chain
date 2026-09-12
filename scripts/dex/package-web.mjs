import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";
import { resolveSourceBaseCommit } from "./source-base.mjs";
import { readReleaseFiles } from "./release-files.mjs";

export async function packageDexWeb({rootDir=path.resolve(import.meta.dirname,"../.."),sourceCommit,outputDir}={}){
const root=path.resolve(rootDir);
const app=path.join(root,"apps/dex");
const dist=path.join(app,"dist");
const release=path.resolve(outputDir??path.join(root,"release/dex"));
const sourceBaseCommit=await resolveSourceBaseCommit(root,["apps/dex","sdk/dex"],sourceCommit);
const packageJSON=JSON.parse(await readFile(path.join(app,"package.json"),"utf8"));
if(typeof packageJSON.version!=="string"||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(packageJSON.version)||packageJSON.version.length>80)throw new Error("invalid artifact version");
const files=await readReleaseFiles(dist);
const manifestFile=files.find(file=>file.relative==="manifest.webmanifest");
if(!manifestFile)throw new Error("PWA build is missing its manifest");
const manifest=JSON.parse(manifestFile.data.toString("utf8"));
if(manifest.id!=="com.ynxweb4.dex.web"||manifest.name!=="YNX DEX Testnet Preview"||manifest.icons?.length<2)throw new Error("built PWA manifest identity or icons are incomplete");

if(!files.some(file=>file.relative==="index.html")||!files.some(file=>file.relative==="sw.js"))throw new Error("PWA build is missing index or service worker");

const blocks=[];
for(const file of files){const header=Buffer.alloc(512);writeString(header,0,100,file.relative);writeOctal(header,100,8,0o644);writeOctal(header,108,8,0);writeOctal(header,116,8,0);writeOctal(header,124,12,file.data.length);writeOctal(header,136,12,0);header.fill(0x20,148,156);header[156]="0".charCodeAt(0);writeString(header,257,6,"ustar");writeString(header,263,2,"00");let checksum=0;for(const byte of header)checksum+=byte;writeOctal(header,148,8,checksum);blocks.push(header,file.data,Buffer.alloc((512-file.data.length%512)%512))}
blocks.push(Buffer.alloc(1024));
const archive=gzipSync(Buffer.concat(blocks),{level:9,mtime:0});
const archiveName=`ynx-dex-web-pwa-${packageJSON.version}.tar.gz`;
// Reserve a new directory only after all source/content checks succeed.
// Existing releases must never be replaced, even when empty.
await mkdir(path.dirname(release),{recursive:true});
await mkdir(release);
await writeFile(path.join(release,archiveName),archive,{mode:0o644,flag:"wx"});
const sha256=value=>createHash("sha256").update(value).digest("hex");
const artifact={schemaVersion:1,productId:"ynx-dex",artifactType:"web-pwa-upload-bundle",version:packageJSON.version,sourceBaseCommit,mainnet:false,audited:false,productionLiquidity:false,installedLocal:false,deployedStaging:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false,file:archiveName,sha256:sha256(archive),sizeBytes:archive.length,contentFileCount:files.length,content:files.map(file=>({path:file.relative,sha256:sha256(file.data),sizeBytes:file.data.length})),verification:{command:`shasum -a 256 ${archiveName}`,workingDirectory:release,expectedSha256:sha256(archive)}};
await writeFile(path.join(release,"web-pwa-artifact.json"),JSON.stringify(artifact,null,2)+"\n",{mode:0o644,flag:"wx"});
return {...artifact,outputDir:release};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){
  if(!["--source","--output"].includes(args[i])||!args[i+1])throw new Error("Usage: [--source <exact-source-commit>] [--output <new-release-directory>]");
  const key=args[i]==="--source"?"sourceCommit":"outputDir";
  if(options[key]!==undefined)throw new Error("Duplicate argument");
  options[key]=args[i+1];
 }
 process.stdout.write(JSON.stringify(await packageDexWeb(options),null,2)+"\n");
}

function writeString(buffer,offset,length,value){const data=Buffer.from(value);if(data.length>length)throw new Error(`tar path too long: ${value}`);data.copy(buffer,offset)}
function writeOctal(buffer,offset,length,value){const encoded=value.toString(8).padStart(length-1,"0")+"\0";writeString(buffer,offset,length,encoded)}
