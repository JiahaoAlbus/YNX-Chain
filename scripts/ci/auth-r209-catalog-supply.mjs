// PUBLIC supplier CI delta only. No Go/Node execution, service or Source grant.
import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/auth-r209-catalog/',import.meta.url));
const handoff={bytes:3797,sha256:'8e9e0893c7d109dccfe8fa21a300d2dbb02471e335f9208e9347677aa16bb2ac'},parent={bytes:14261,sha256:'5115dbbe571e31a5e21a7af2868ffe012e26457cbb8a26d52d3bd0ca9856e72f'};
const names=['original_catalog_authority.go','original_catalog_authority_test.go'],prefix='source/internal/developerauthority/';
const fail=code=>{throw Object.assign(Error(code),{code});},sha=b=>createHash('sha256').update(b).digest('hex');
function canonical(p,directory){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('R209_CATALOG_PATH');for(let at=p;;at=dirname(at)){const st=lstatSync(at);if(st.isSymbolicLink())fail('R209_CATALOG_SYMLINK');if(at===dirname(at))break;}if(realpathSync(p)!==p||directory&&!lstatSync(p).isDirectory())fail('R209_CATALOG_PATH');}
function exact(file,pin){canonical(file,false);const s=lstatSync(file);if(!s.isFile()||s.size!==pin.bytes)fail('R209_CATALOG_PIN');const raw=readFileSync(file);if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)fail('R209_CATALOG_PIN');return raw;}
function supply(){
 const root=resolve(fixture),expected=['SUPPLIER_HANDOFF.json',...names.map(n=>prefix+n)].sort(),actual=[];canonical(root,true);
 function visit(dir){for(const name of readdirSync(dir)){const file=join(dir,name),relative=file.slice(root.length+1).split('\\').join('/'),st=lstatSync(file);if(st.isSymbolicLink())fail('R209_CATALOG_SYMLINK');if(st.isDirectory()){if(!expected.some(p=>p.startsWith(relative+'/')))fail('R209_CATALOG_EXTRA');visit(file);}else{if(!st.isFile())fail('R209_CATALOG_NOT_REGULAR');actual.push(relative);if(actual.length>3)fail('R209_CATALOG_EXTRA');}}}visit(root);
 if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R209_CATALOG_EXTRA');
 const h=JSON.parse(exact(join(root,'SUPPLIER_HANDOFF.json'),handoff));
 if(h.parent?.bytes!==parent.bytes||h.parent?.sha256!==parent.sha256||h.truth?.fullSource13!==false||h.truth?.Root!==false||h.truth?.production!==false)fail('R209_CATALOG_PARENT');
 const files=names.map(name=>{const refs=h.refs.filter(p=>p.relative===prefix+name);if(refs.length!==1)fail('R209_CATALOG_SCOPE');const p=refs[0],pin={bytes:p.bytes,sha256:p.sha256};return {name,pin,raw:exact(join(root,prefix+name),pin)};});
 return {root,files};
}
/** Caller must supply its original prepare result's exclusive temporary root.
 * This only appends the two pinned Catalog files; it does not requalify the
 * earlier 30 files, their fixtureNode value, or the surrounding CI process. */
export function stageR209CatalogDelta({preparedRoot}){
 const original=supply();canonical(preparedRoot,true);const target=join(preparedRoot,'internal/developerauthority');canonical(target,true);
 for(const {name}of original.files){try{lstatSync(join(target,name));}catch(e){if(e.code==='ENOENT')continue;throw e;}fail('R209_CATALOG_OUTPUT_EXISTS');}
 const outputs=[];for(const {name,pin,raw}of original.files){const file=join(target,name);writeFileSync(file,raw,{flag:'wx',mode:0o600});exact(file,pin);outputs.push(Object.freeze({path:'internal/developerauthority/'+name,bytes:pin.bytes,sha256:pin.sha256}));}
 // Final source readback retains the fixed H/parent/leaf evidence. No retries,
 // no overwrite, no cleanup of a partial output and no change to old 30 files.
 supply();
 return Object.freeze({basenames:Object.freeze([...names]),files:Object.freeze(outputs),supplierHandoff:Object.freeze({path:join(original.root,'SUPPLIER_HANDOFF.json'),...handoff}),parentHandoff:Object.freeze({...parent}),preparedRoot,staged:true,dataOnly:true,old30Rewritten:false,fixtureNodeChanged:false,GoExecuted:false,NodeExecuted:false,normalGoServer:false,Source13:false,Root:false,Native:false,production:false});
}
