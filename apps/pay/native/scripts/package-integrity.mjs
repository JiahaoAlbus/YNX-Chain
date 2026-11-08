import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const runtimeModules=Object.freeze({
 r5:Object.freeze(['cli.mjs','pay-business-client.mjs','merchant-invoice-approval.mjs','invoice-product-intent.mjs','notification-inbox.mjs','main-entry.mjs','desktop-entry.mjs','product-source.mjs']),
 r6:Object.freeze(['archive-receipt.mjs','cli.mjs','pay-business-client.mjs','merchant-invoice-approval.mjs','invoice-product-intent.mjs','notification-inbox.mjs','main-entry.mjs','desktop-entry.mjs','product-source.mjs'])
});
const invalid=()=>{throw Error('Exact complete application file inventory required.');};
const relative=value=>typeof value==='string'&&value.length>0&&!path.isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..');

/** The signed app is immutable input. Include resources and signature files,
 * not just its executable or an unverified source-head label. */
export async function snapshotApplication(root){
 const result=[];
 async function walk(directory,prefix=''){
  const entries=await fs.readdir(directory,{withFileTypes:true});
  entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  for(const entry of entries){
   const name=prefix+entry.name,file=path.join(directory,entry.name);
   if(entry.isSymbolicLink())invalid();
   if(entry.isDirectory()){await walk(file,name+'/');continue;}
   if(!entry.isFile()||!relative(name)||result.length>=8192)invalid();
   const handle=await fs.open(file,'r');
   try{
    const before=await handle.stat(),hash=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;hash.update(chunk);}
    const after=await handle.stat();
    if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)invalid();
    result.push({path:name,bytes,mode:before.mode&0o777,sha256:hash.digest('hex')});
   }finally{await handle.close();}
  }
 }
 if(!(await fs.lstat(root)).isDirectory()||(await fs.lstat(root)).isSymbolicLink())invalid();
 await walk(root);return result;
}

export async function verifyApplication(root,expected){
 if(!Array.isArray(expected)||!expected.length||expected.length>8192)invalid();
 const seen=new Set();
 for(const file of expected){
  if(!file||!relative(file.path)||seen.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!Number.isInteger(file.mode)||file.mode<0||file.mode>0o777||!/^[0-9a-f]{64}$/.test(file.sha256))invalid();
  seen.add(file.path);
 }
 const actual=await snapshotApplication(root),byName=new Map(expected.map(file=>[file.path,file]));
 if(actual.length!==expected.length)invalid();
 for(const file of actual){const saved=byName.get(file.path);if(!saved||saved.bytes!==file.bytes||saved.mode!==file.mode||saved.sha256!==file.sha256)invalid();}
 return actual;
}
