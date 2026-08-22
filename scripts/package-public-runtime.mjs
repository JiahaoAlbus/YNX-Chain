import {createHash} from "node:crypto";
import {mkdir,readFile,readdir,stat,writeFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import path from "node:path";
import {execFileSync} from "node:child_process";

const root=path.resolve(import.meta.dirname,"..");
const sourceCommit=process.argv[2];
const output=process.argv[3];
if(!/^[0-9a-f]{40}$/.test(sourceCommit||"")||!output)throw new Error("usage: package-public-runtime.mjs <exact-source-commit> <output-archive>");
if(execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim()!==sourceCommit)throw new Error("runtime package must be built from the requested exact source commit");
const tree=execFileSync("git",["rev-parse",`${sourceCommit}^{tree}`],{cwd:root,encoding:"utf8"}).trim();
const release=`ynx-dex-${sourceCommit.slice(0,12)}`;
const sha256=value=>createHash("sha256").update(value).digest("hex");
const files=[];
async function addFile(absolute,relative){const info=await stat(absolute);if(!info.isFile())throw new Error(`required runtime file missing: ${relative}`);files.push({absolute,relative,data:await readFile(absolute),mode:relative.endsWith("ynx-dex-indexerd")?0o755:0o644});}
async function addTree(directory,prefix){for(const name of (await readdir(directory)).sort()){const absolute=path.join(directory,name),relative=path.posix.join(prefix,name),info=await stat(absolute);if(info.isSymbolicLink())throw new Error(`symlink forbidden: ${relative}`);if(info.isDirectory())await addTree(absolute,relative);else if(info.isFile()&&!relative.endsWith(".map"))await addFile(absolute,relative);else if(!info.isFile())throw new Error(`unsupported input: ${relative}`);}}
await addFile(path.join(root,"release/dex-candidate-runtime/ynx-dex-indexerd"),`${release}/ynx-dex-indexerd`);
await addTree(path.join(root,"apps/dex/dist"),`${release}/web`);
for(const [source,target] of [["token-lists/dex-testnet.json","token-lists/dex-testnet.json"],["deploy/dex/ynx-dex.caddy","deploy/ynx-dex.caddy"],["deploy/dex/ynx-dex-indexerd.service","deploy/ynx-dex-indexerd.service"],["deploy/dex/dex.env.example","deploy/dex.env.example"]])await addFile(path.join(root,source),`${release}/${target}`);
files.sort((a,b)=>a.relative.localeCompare(b.relative));
const inventory=files.map(file=>({path:file.relative,sha256:sha256(file.data),bytes:file.data.length,mode:file.mode.toString(8)}));
const manifest=Buffer.from(`${JSON.stringify({schemaVersion:1,productId:"ynx-dex",sourceCommit,sourceTree:tree,release,entries:inventory},null,2)}\n`);
files.push({relative:`${release}/BUNDLE_MANIFEST.json`,data:manifest,mode:0o644});
const sums=Buffer.from(files.map(file=>`${sha256(file.data)}  ${file.relative.slice(release.length+1)}\n`).join(""));
files.push({relative:`${release}/SHA256SUMS`,data:sums,mode:0o644});
files.sort((a,b)=>a.relative.localeCompare(b.relative));
const blocks=[];
for(const file of files){const header=Buffer.alloc(512);writeString(header,0,100,file.relative);writeOctal(header,100,8,file.mode);writeOctal(header,108,8,0);writeOctal(header,116,8,0);writeOctal(header,124,12,file.data.length);writeOctal(header,136,12,0);header.fill(0x20,148,156);header[156]="0".charCodeAt(0);writeString(header,257,6,"ustar");writeString(header,263,2,"00");let checksum=0;for(const byte of header)checksum+=byte;writeOctal(header,148,8,checksum);blocks.push(header,file.data,Buffer.alloc((512-file.data.length%512)%512));}
blocks.push(Buffer.alloc(1024));
const archive=gzipSync(Buffer.concat(blocks),{level:9,mtime:0});
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,archive,{mode:0o644});
process.stdout.write(`${JSON.stringify({release,sourceCommit,sourceTree:tree,archive:{path:output,sha256:sha256(archive),bytes:archive.length},entries:files.map(file=>({path:file.relative,sha256:sha256(file.data),bytes:file.data.length,mode:file.mode.toString(8)}))},null,2)}\n`);
function writeString(buffer,offset,length,value){const data=Buffer.from(value);if(data.length>length)throw new Error(`tar path too long: ${value}`);data.copy(buffer,offset);}
function writeOctal(buffer,offset,length,value){writeString(buffer,offset,length,value.toString(8).padStart(length-1,"0")+"\0");}
