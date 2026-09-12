// Product-owned deterministic server carrier, not a desktop installer.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';

const root=path.resolve(import.meta.dirname,'../../..');
const [commit,output]=process.argv.slice(2);
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sha=value=>createHash('sha256').update(value).digest('hex');
if(process.argv.length!==4||!/^[a-f0-9]{40}$/.test(commit||'')||!path.isAbsolute(output||''))throw Error('usage: package-schema10-runtime.mjs EXACT_COMMIT ABSENT_ABSOLUTE_ARCHIVE');
if(git(['rev-parse','HEAD'])!==commit||git(['status','--porcelain']).length)throw Error('exact clean source checkout required');
if(existsSync(output))throw Error('output must be absent; no overwrite');
const sourceTree=git(['rev-parse',commit+'^{tree}']),work=mkdtempSync(path.join(tmpdir(),'ynx-exchange-schema10-build-'));
const binary=path.join(work,'ynx-exchanged'),wallet=path.join(work,'wallet-auth.js');
const run=(tool,args,env=process.env)=>execFileSync(tool,args,{cwd:root,env,stdio:'inherit'});
run('go',['build','-trimpath','-buildvcs=false','-ldflags',`-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct.BuildCommit=${commit}`,'-o',binary,'./apps/exchange/server'],{...process.env,CGO_ENABLED:'0',GOOS:'linux',GOARCH:'amd64'});
run(path.join(root,'apps/exchange/node_modules/esbuild/bin/esbuild'),['apps/exchange/web/wallet-auth-entry.js','--bundle','--minify','--platform=browser','--target=es2022',`--outfile=${wallet}`]);
if(!readFileSync(wallet).equals(readFileSync(path.join(root,'apps/exchange/web/wallet-auth.js'))))throw Error('rebuilt wallet bundle differs from source-frozen bytes');
const elf=readFileSync(binary);if(elf.subarray(0,4).toString('hex')!=='7f454c46'||elf[4]!==2||elf[5]!==1||elf.readUInt16LE(18)!==62)throw Error('candidate must be ELF64 little-endian x86-64');
const release='ynx-exchange-schema10-'+commit.slice(0,12),files=[];
function add(file,relative,mode){const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('required regular file: '+relative);files.push({path:release+'/'+relative,data:readFileSync(file),mode})}
add(binary,'ynx-exchanged',0o755);
for(const name of ['index.html','styles.css','app.js'])add(path.join(root,'apps/exchange/web',name),'apps/exchange/web/'+name,0o644);
add(wallet,'apps/exchange/web/wallet-auth.js',0o644);
files.sort((a,b)=>a.path.localeCompare(b.path));
const entries=files.map(f=>({path:f.path.slice(release.length+1),mode:f.mode.toString(8),bytes:f.data.length,sha256:sha(f.data)}));
const manifest={schemaVersion:1,product:'YNX Exchange',sourceCommit:commit,sourceTree,stateSchema:10,release,kind:'offline-linux-server-carrier-not-installer',build:{goos:'linux',goarch:'amd64',cgo:false,trimpath:true,buildVCS:false,goVersion:execFileSync('go',['version'],{encoding:'utf8'}).trim(),nodeVersion:process.version,esbuildVersion:execFileSync(path.join(root,'apps/exchange/node_modules/esbuild/bin/esbuild'),['--version'],{encoding:'utf8'}).trim()},sdk:{standard:'c97f85e9ae4d4580b99860c51738e6040ca9ca18',private:'a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9',reducer:'98c6d5d784d212df8981a53b17118a511e246ad2'},entries,truth:{publicDeployed:false,installed:false,realProviderApproval:false,privateSessionVerified:false,nativeActionSigned:false,transactionSubmitted:false}};
files.push({path:release+'/BUNDLE_MANIFEST.json',mode:0o644,data:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
files.push({path:release+'/SHA256SUMS',mode:0o644,data:Buffer.from(files.map(f=>sha(f.data)+'  '+f.path.slice(release.length+1)+'\n').join(''))});
files.sort((a,b)=>a.path.localeCompare(b.path));
const archive=gzipSync(tar(files),{level:9,mtime:0});
writeFileSync(output,archive,{flag:'wx',mode:0o644});
process.stdout.write(JSON.stringify({...manifest,archive:{path:output,bytes:archive.length,sha256:sha(archive)},allFiles:files.map(f=>({path:f.path,bytes:f.data.length,sha256:sha(f.data),mode:f.mode.toString(8)}))},null,2)+'\n');
function tar(files){const blocks=[];for(const f of files){const header=Buffer.alloc(512);put(header,0,100,f.path);oct(header,100,8,f.mode);oct(header,108,8,0);oct(header,116,8,0);oct(header,124,12,f.data.length);oct(header,136,12,0);header.fill(32,148,156);header[156]=48;put(header,257,6,'ustar');put(header,263,2,'00');oct(header,148,8,header.reduce((a,b)=>a+b,0));blocks.push(header,f.data,Buffer.alloc((512-f.data.length%512)%512))}blocks.push(Buffer.alloc(1024));return Buffer.concat(blocks)}
function put(buffer,offset,size,value){const data=Buffer.from(value);if(data.length>size)throw Error('tar field overflow');data.copy(buffer,offset)}
function oct(buffer,offset,size,value){put(buffer,offset,size,value.toString(8).padStart(size-1,'0')+'\0')}
