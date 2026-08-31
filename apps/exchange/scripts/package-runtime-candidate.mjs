import {createHash} from "node:crypto";
import {mkdir,readFile,readdir,stat,writeFile,mkdtemp} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {gzipSync} from "node:zlib";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"../../..");
const args=parseArgs(process.argv.slice(2));
const commit=args.commit;
if(!/^[0-9a-f]{40}$/.test(commit)||!args.output)throw new Error("usage: package-runtime-candidate.mjs --commit <exact-source-commit> --output <archive>");
if(git(["rev-parse","HEAD"])!==commit)throw new Error("runtime package must be built from the requested exact source commit");
const sourceTree=git(["rev-parse",`${commit}^{tree}`]);
const sourceTime=git(["show","-s","--format=%aI",commit]);
const release=`ynx-exchange-${commit.slice(0,12)}`;
const work=await mkdtemp(path.join(tmpdir(),"ynx-exchange-runtime-"));
const binary=path.join(work,"ynx-exchanged");
const walletBundle=path.join(work,"wallet-connect.js");
const ldflags=`-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct.BuildCommit=${commit}`;
run("go",["build","-trimpath","-buildvcs=false","-ldflags",ldflags,"-o",binary,"./apps/exchange/server"]);
run(path.join(root,"apps/exchange/web/node_modules/esbuild/bin/esbuild"),["wallet-connect-entry.js","--bundle","--minify","--platform=browser","--target=es2022",`--outfile=${walletBundle}`],path.join(root,"apps/exchange/web"));
const files=[];
const sha256=value=>createHash("sha256").update(value).digest("hex");
const add=async(absolute,relative,mode)=>{const info=await stat(absolute);if(!info.isFile()||info.isSymbolicLink())throw new Error(`required regular file missing: ${relative}`);files.push({relative,data:await readFile(absolute),mode});};
await add(binary,`${release}/ynx-exchanged`,0o755);
for(const name of ["app.js","index.html","styles.css"])await add(path.join(root,"apps/exchange/web",name),`${release}/apps/exchange/web/${name}`,0o644);
await add(walletBundle,`${release}/apps/exchange/web/wallet-connect.js`,0o644);
files.sort((a,b)=>a.relative.localeCompare(b.relative));
const inventory=files.map(file=>({path:file.relative,sha256:sha256(file.data),bytes:file.data.length,mode:file.mode.toString(8)}));
files.push({relative:`${release}/BUNDLE_MANIFEST.json`,data:Buffer.from(`${JSON.stringify({schemaVersion:1,productId:"ynx-exchange",sourceCommit:commit,sourceTree,release,build:{goos:"linux",goarch:"amd64",cgoEnabled:false,trimpath:true,buildVCS:false,buildTime:sourceTime},entries:inventory},null,2)}\n`),mode:0o644});
files.push({relative:`${release}/SHA256SUMS`,data:Buffer.from(files.map(file=>`${sha256(file.data)}  ${file.relative.slice(release.length+1)}\n`).join("")),mode:0o644});
files.sort((a,b)=>a.relative.localeCompare(b.relative));
const archive=gzipTar(files);
await mkdir(path.dirname(path.resolve(args.output)),{recursive:true});
await writeFile(args.output,archive,{mode:0o644});
process.stdout.write(`${JSON.stringify({release,sourceCommit:commit,sourceTree,archive:{path:args.output,bytes:archive.length,sha256:sha256(archive)},entries:files.map(file=>({path:file.relative,bytes:file.data.length,sha256:sha256(file.data),mode:file.mode.toString(8)}))},null,2)}\n`);

function parseArgs(argv){const result={commit:null,output:null};for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if((key!=="--commit"&&key!=="--output")||!value||result[key.slice(2)]!==null)throw new Error("usage: package-runtime-candidate.mjs --commit <exact-source-commit> --output <archive>");result[key.slice(2)]=value;}return result;}
function git(args){return execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();}
function run(command,args,cwd=root){execFileSync(command,args,{cwd,stdio:"inherit"});}
function gzipTar(files){const blocks=[];for(const file of files){const header=Buffer.alloc(512);writeString(header,0,100,file.relative);writeOctal(header,100,8,file.mode);writeOctal(header,108,8,0);writeOctal(header,116,8,0);writeOctal(header,124,12,file.data.length);writeOctal(header,136,12,0);header.fill(0x20,148,156);header[156]="0".charCodeAt(0);writeString(header,257,6,"ustar");writeString(header,263,2,"00");let checksum=0;for(const byte of header)checksum+=byte;writeOctal(header,148,8,checksum);blocks.push(header,file.data,Buffer.alloc((512-file.data.length%512)%512));}blocks.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(blocks),{level:9,mtime:0});}
function writeString(buffer,offset,length,value){const data=Buffer.from(value);if(data.length>length)throw new Error(`tar path too long: ${value}`);data.copy(buffer,offset);}
function writeOctal(buffer,offset,length,value){writeString(buffer,offset,length,value.toString(8).padStart(length-1,"0")+"\0");}
