import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const packed=fs.readFileSync(new URL('./sdk49-issuer-product-source.json.gz',import.meta.url));
if(createHash('sha256').update(packed).digest('hex')!=='7a1cc0ad53b79b0db9b3cd70760537c28a3b56b7bd8fea9b4e0a81f600282296')throw Error('Frozen issuer fixture differs');
const files=JSON.parse(gunzipSync(packed)).files;
export function issuerSourceBytes(name){if(!Object.hasOwn(files,name))throw Error('Unknown issuer fixture');return Buffer.from(files[name],'base64');}
export function issuerSourceFixture(t,appMetadata){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-issuer49-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,b)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b);};
 for(const name of Object.keys(files))put(name,issuerSourceBytes(name));put('apps/wallet-desktop/package.json',appMetadata);
 const git=(...a)=>execFileSync('git',a,{cwd:root,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','Frozen issuer source metadata');return{root,put};
}
