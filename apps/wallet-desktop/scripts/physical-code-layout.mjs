// Offline package assembly only. Runtime executes the sole physical code copy;
// no runtime extraction, loader setter, source rewrite or Root grant exists.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
const here=fileURLToPath(import.meta.url),digest=b=>createHash('sha256').update(b).digest('hex');
export const PHYSICAL_CODE_RECEIPT='ynx-wallet-physical-code-layout.json';
const main='code/apps/wallet-desktop/src/main.mjs',fail=()=>{throw Error('WALLET_PHYSICAL_CODE_LAYOUT_DIFFERS');};
const relative=p=>typeof p==='string'&&p&&!p.includes('\\')&&!p.includes('\0')&&!path.posix.isAbsolute(p)&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='.'||s==='..'||!s);
const pin=b=>({bytes:b.length,sha256:digest(b)});
function inventory(root){
 const rows=[];
 function walk(rel=''){for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){const name=rel?rel+'/'+e.name:e.name,p=path.join(root,name),s=fs.lstatSync(p);if(s.isSymbolicLink()){const target=fs.readlinkSync(p);if(path.isAbsolute(target)||!fs.realpathSync(p).startsWith(root+'/'))fail();rows.push({path:name,type:'link',link:path.posix.normalize(path.posix.join(path.posix.dirname(name),target))});}else if(s.isDirectory()){rows.push({path:name,type:'directory'});walk(name);}else if(s.isFile()){rows.push({path:name,type:'file',mode:s.mode&0o777,...pin(fs.readFileSync(p))});}else fail();}}
 walk();return rows.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
function bootstrap(profile){
 if(typeof profile!=='string'||!path.isAbsolute(profile)||path.normalize(profile)!==profile||profile.includes('\0'))fail();
 return Buffer.from('// Source-owned local QA entry; one preassembled physical code copy.\n'+
  'process.env.YNX_WALLET_PROFILE_PATH='+JSON.stringify(profile)+';\n'+
  "await import(new URL('../../../../../app.code/code/apps/wallet-desktop/src/main.mjs',import.meta.url));\n");
}
function rawHeader(asar,archive){return{algorithm:'SHA256',hash:digest(Buffer.from(asar.getRawHeader(archive).headerString))};}
export function assemblePhysicalQACodeLayout(resources,cwd,qaProfile){
 if(!path.isAbsolute(resources)||fs.realpathSync(resources)!==resources||fs.existsSync(path.join(resources,PHYSICAL_CODE_RECEIPT))||fs.existsSync(path.join(resources,'app.code')))fail();
 const asar=createRequire(path.join(cwd,'package.json'))('@electron/asar'),archive=path.join(resources,'app.asar'),root=path.join(resources,'app.code'),temp=fs.mkdtempSync(path.join(resources,'.physical-qa-'));
 const original=rawHeader(asar,archive),metadata=asar.extractFile(archive,'package.json'),entry=bootstrap(qaProfile);
 if(JSON.parse(metadata).main!==main)fail();
 try{
  asar.extractAll(archive,root);
  // asar.extractAll does not preserve an unpacked member's executable mode.
  // Restore the actual preassembly mode before freezing the physical tree.
  for(const item of asar.listPackage(archive)){const name=item.replace(/^\//,''),info=asar.statFile(archive,path.normalize(name),false);if(!info.files&&!info.link){const mode=info.unpacked?fs.lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:info.executable?0o755:0o644;fs.chmodSync(path.join(root,name),mode);}}
  const rows=inventory(root);
  if(rows.filter(r=>r.type==='file'&&r.path.endsWith('/original-auth-identity.node')).length!==1||!rows.some(r=>r.path==='code/packages/wallet-auth/src/original-auth-runtime-image-source-v1.js'))fail();
  const input=path.join(temp,'input.json');fs.writeFileSync(input,JSON.stringify({cwd,output:path.join(temp,'app.asar'),metadata:metadata.toString('base64'),entry:entry.toString('base64')}));
  execFileSync(process.execPath,[here,'--write-bootstrap',input],{stdio:'pipe',maxBuffer:1<<20});
  fs.renameSync(archive,path.join(temp,'original.asar'));fs.renameSync(path.join(temp,'app.asar'),archive);asar.uncache(archive);
  const after=rawHeader(asar,archive),receipt={kind:'YNX_WALLET_PHYSICAL_QA_CODE_LAYOUT/v1',physicalRoot:'app.code',main,qaProfile,bootstrap:pin(entry),metadata:pin(metadata),originalAsarHeaderIntegrity:original,bootstrapAsarHeaderIntegrity:after,files:rows,SourceAdmission:false,RootAdmission:false,officialRelease:false};
  // The old unpacked file was copied by extractAll into the sole physical
  // tree before first launch. Remove its now redundant preassembly location.
  fs.rmSync(archive+'.unpacked',{recursive:true,force:true});
  fs.writeFileSync(path.join(resources,PHYSICAL_CODE_RECEIPT),JSON.stringify(receipt,null,2)+'\n');
  openPhysicalCodeView(resources,cwd);return receipt;
 }catch(cause){fs.writeFileSync(path.join(temp,'FIRST_FAILURE.txt'),String(cause?.stack??cause));throw cause;}
 finally{if(fs.existsSync(path.join(resources,PHYSICAL_CODE_RECEIPT)))fs.rmSync(temp,{recursive:true,force:true});}
}
/** Build verifier view of the preassembly source recipe. Runtime never sees
 * this adapter: all held FD / realpath / module URI checks use app.code files. */
export function openPhysicalCodeView(resources,cwd){
 const file=path.join(resources,PHYSICAL_CODE_RECEIPT);if(!fs.existsSync(file))return null;
 const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())fail();const r=JSON.parse(fs.readFileSync(file));
 if(r.kind!=='YNX_WALLET_PHYSICAL_QA_CODE_LAYOUT/v1'||r.physicalRoot!=='app.code'||r.main!==main||r.SourceAdmission!==false||r.RootAdmission!==false||r.officialRelease!==false)fail();
 const root=path.join(resources,'app.code');if(fs.realpathSync(root)!==root||JSON.stringify(inventory(root))!==JSON.stringify(r.files)||fs.existsSync(path.join(resources,'app.asar.unpacked')))fail();
 const asar=createRequire(path.join(cwd,'package.json'))('@electron/asar'),archive=path.join(resources,'app.asar'),entry=bootstrap(r.qaProfile),actualNames=asar.listPackage(archive).map(p=>p.replace(/^\//,'')).sort();
 const allowed=['package.json','code','code/apps','code/apps/wallet-desktop','code/apps/wallet-desktop/src',main].sort();if(JSON.stringify(actualNames)!==JSON.stringify(allowed))fail();
 if(!asar.extractFile(archive,main).equals(entry)||JSON.stringify(pin(entry))!==JSON.stringify(r.bootstrap)||JSON.stringify(rawHeader(asar,archive))!==JSON.stringify(r.bootstrapAsarHeaderIntegrity))fail();
 const metadata=asar.extractFile(archive,'package.json');if(JSON.stringify(pin(metadata))!==JSON.stringify(r.metadata)||!metadata.equals(fs.readFileSync(path.join(root,'package.json'))))fail();
 const relocation=JSON.parse(fs.readFileSync(path.join(resources,'ynx-wallet-packaged-relocation.json'))),originalRows=new Map(relocation.after.map(row=>[row.path,row]));
 if(JSON.stringify(r.originalAsarHeaderIntegrity)!==JSON.stringify(relocation.asarHeaderIntegrity))fail();
 // Compare all physical bytes to the retained source assembly recipe. An
 // extra file/copy cannot be hidden by a receipt-selected source path.
 if(r.files.length!==originalRows.size)fail();
 for(const f of r.files){const q=originalRows.get(f.path);if(!q||f.type!==q.type||f.type==='file'&&(f.bytes!==q.bytes||f.sha256!==q.sha256||f.mode!==(q.unpacked?q.physicalMode:q.executable?0o755:0o644))||f.type==='link'&&f.link!==q.link)fail();}
 const checked=name=>{if(!relative(name)||!originalRows.has(name))fail();return path.join(root,name);};
 const adapter={uncache(){},listPackage(){return [...originalRows.keys()].map(p=>'/'+p);},statFile(_archive,name){name=name.split(path.sep).join('/');const q=originalRows.get(name);if(!q)fail();return q.type==='directory'?{files:{},unpacked:q.unpacked}:q.type==='link'?{link:q.link,unpacked:q.unpacked}:{size:q.bytes,unpacked:q.unpacked,executable:q.executable};},extractFile(_archive,name){return fs.readFileSync(checked(name.split(path.sep).join('/')));}};
 return {root,receipt:r,asar:adapter,sourceInventory:[...relocation.after],actualAsarHeaderIntegrity:r.bootstrapAsarHeaderIntegrity};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here&&process.argv[2]==='--write-bootstrap'){
 const input=JSON.parse(fs.readFileSync(process.argv[3])),asar=createRequire(path.join(input.cwd,'package.json'))('@electron/asar');
 const entries=[['package.json',Buffer.from(input.metadata,'base64')],[main,Buffer.from(input.entry,'base64')]],dirs=['code','code/apps','code/apps/wallet-desktop','code/apps/wallet-desktop/src'];
 await asar.createPackageFromStreams(input.output,[...dirs.map(path=>({path,type:'directory',unpacked:false})),...entries.map(([path,b])=>({path,type:'file',unpacked:false,stat:{mode:0o644,size:b.length},streamGenerator:()=>Readable.from([b])}))]);
}
