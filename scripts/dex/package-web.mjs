import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";

const root=path.resolve(import.meta.dirname,"../..");
const app=path.join(root,"apps/dex");
const dist=path.join(app,"dist");
const release=path.join(root,"release/dex");
const packageJSON=JSON.parse(await readFile(path.join(app,"package.json"),"utf8"));
const manifest=JSON.parse(await readFile(path.join(dist,"manifest.webmanifest"),"utf8"));
if(manifest.id!=="com.ynxweb4.dex.web"||manifest.name!=="YNX DEX Testnet Preview"||manifest.icons?.length<2)throw new Error("built PWA manifest identity or icons are incomplete");

const files=[];
async function walk(directory,prefix=""){
 for(const name of (await readdir(directory)).sort()){
  const absolute=path.join(directory,name);const relative=path.posix.join(prefix,name);const info=await stat(absolute);
  if(info.isSymbolicLink())throw new Error(`symlink forbidden in release: ${relative}`);
  if(info.isDirectory())await walk(absolute,relative);else if(info.isFile())files.push({absolute,relative,data:await readFile(absolute)});else throw new Error(`unsupported release entry: ${relative}`);
 }
}
await walk(dist);
if(!files.some(file=>file.relative==="index.html")||!files.some(file=>file.relative==="sw.js"))throw new Error("PWA build is missing index or service worker");

const blocks=[];
for(const file of files){const header=Buffer.alloc(512);writeString(header,0,100,file.relative);writeOctal(header,100,8,0o644);writeOctal(header,108,8,0);writeOctal(header,116,8,0);writeOctal(header,124,12,file.data.length);writeOctal(header,136,12,0);header.fill(0x20,148,156);header[156]="0".charCodeAt(0);writeString(header,257,6,"ustar");writeString(header,263,2,"00");let checksum=0;for(const byte of header)checksum+=byte;writeOctal(header,148,8,checksum);blocks.push(header,file.data,Buffer.alloc((512-file.data.length%512)%512))}
blocks.push(Buffer.alloc(1024));
const archive=gzipSync(Buffer.concat(blocks),{level:9,mtime:0});
const archiveName=`ynx-dex-web-pwa-${packageJSON.version}.tar.gz`;
await mkdir(release,{recursive:true});
await writeFile(path.join(release,archiveName),archive,{mode:0o644});
const sha256=value=>createHash("sha256").update(value).digest("hex");
const sourceBaseCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const artifact={schemaVersion:1,productId:"ynx-dex",artifactType:"web-pwa-upload-bundle",version:packageJSON.version,sourceBaseCommit,mainnet:false,audited:false,productionLiquidity:false,installedLocal:false,deployedStaging:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false,file:archiveName,sha256:sha256(archive),sizeBytes:archive.length,contentFileCount:files.length,content:files.map(file=>({path:file.relative,sha256:sha256(file.data),sizeBytes:file.data.length})),verification:{command:`shasum -a 256 release/dex/${archiveName}`,expectedSha256:sha256(archive)}};
await writeFile(path.join(release,"web-pwa-artifact.json"),JSON.stringify(artifact,null,2)+"\n",{mode:0o644});
process.stdout.write(`${archiveName} ${artifact.sha256} ${artifact.sizeBytes} bytes\n`);

function writeString(buffer,offset,length,value){const data=Buffer.from(value);if(data.length>length)throw new Error(`tar path too long: ${value}`);data.copy(buffer,offset)}
function writeOctal(buffer,offset,length,value){const encoded=value.toString(8).padStart(length-1,"0")+"\0";writeString(buffer,offset,length,encoded)}
