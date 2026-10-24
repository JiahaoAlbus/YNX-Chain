// PUBLIC supplier CI append-only delta. No child, Go/Node execution or grant.
import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';import {resolve,join,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/auth-r214-publisher-capture/',import.meta.url));
const H={bytes:7072,sha256:'bb3b4092b178575b95e3bf4dfc7fd2affed31f7e761954a7c40215d89873aa25'},parent={bytes:7442,sha256:'eab74dca7de61d9a91b122737ae9a6bba1f35151d8037dfcbab641195b276c4b'};
const names=['original_publisher_capture_store.go','original_publisher_capture_store_test.go','publisher_capture_schema.sql'],prefix='source/internal/developerauthority/';
const prior=[{name:'original_publisher_current.go',bytes:12885,sha256:'37795f27973115ae9d66419a58968d9f802c0208abc6784732d161fcaba2230c'},{name:'original_publisher_current_test.go',bytes:8064,sha256:'3e19236fec2f038e2cbd7d2a6f8d40e69d885fd910aef89e2cefad61506f7090'}];
const fail=code=>{throw Object.assign(Error(code),{code});},sha=b=>createHash('sha256').update(b).digest('hex');
function canonical(p,dir=false){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('R214_PUBLISHER_PATH');for(let at=p;;at=dirname(at)){if(lstatSync(at).isSymbolicLink())fail('R214_PUBLISHER_SYMLINK');if(at===dirname(at))break;}if(realpathSync(p)!==p||dir&&!lstatSync(p).isDirectory())fail('R214_PUBLISHER_PATH');}
function exact(file,pin){canonical(file);const st=lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('R214_PUBLISHER_PIN');const raw=readFileSync(file);if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)fail('R214_PUBLISHER_PIN');return raw;}
function supply(){const root=resolve(fixture),expected=['SUPPLIER_HANDOFF.json',...names.map(n=>prefix+n)].sort(),actual=[];canonical(root,true);
 function visit(dir){for(const n of readdirSync(dir)){const p=join(dir,n),relative=p.slice(root.length+1).split('\\').join('/'),s=lstatSync(p);if(s.isSymbolicLink())fail('R214_PUBLISHER_SYMLINK');if(s.isDirectory()){if(!expected.some(x=>x.startsWith(relative+'/')))fail('R214_PUBLISHER_EXTRA');visit(p);}else{if(!s.isFile())fail('R214_PUBLISHER_PIN');actual.push(relative);if(actual.length>4)fail('R214_PUBLISHER_EXTRA');}}}visit(root);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R214_PUBLISHER_EXTRA');
 const h=JSON.parse(exact(join(root,'SUPPLIER_HANDOFF.json'),H));if(h.parent?.bytes!==parent.bytes||h.parent?.sha256!==parent.sha256||h.truth?.migrationApplied!==false||h.truth?.Source13!==false||h.truth?.Root!==false||h.truth?.production!==false)fail('R214_PUBLISHER_PARENTS');
 const files=names.map(name=>{const rows=h.refs.filter(x=>x.relative===prefix+name);if(rows.length!==1)fail('R214_PUBLISHER_SCOPE');const {bytes,sha256}=rows[0],pin={bytes,sha256};return{name,pin,raw:exact(join(root,prefix+name),pin)};});return{root,files};
}
/** preparedRoot is the caller-owned R202 prepare + R209 + R210 + R213 temporary
 * tree. This stages two Go leaves and one unapplied SQL only, without qualifying that tree or
 * a current runtime, caller, Source or registration authority. */
export function stageR214PublisherCaptureDelta({preparedRoot}){
 const original=supply();canonical(preparedRoot,true);const target=join(preparedRoot,'internal/developerauthority');canonical(target,true);for(const p of prior)exact(join(target,p.name),p);
 for(const {name}of original.files){try{lstatSync(join(target,name));}catch(e){if(e.code==='ENOENT')continue;throw e;}fail('R214_PUBLISHER_OUTPUT_EXISTS');}
 const files=[];try{
  for(const {name,pin,raw}of original.files){const file=join(target,name);writeFileSync(file,raw,{flag:'wx',mode:0o600});exact(file,pin);files.push(Object.freeze({path:'internal/developerauthority/'+name,...pin}));}
  supply();for(const p of prior)exact(join(target,p.name),p);
  return Object.freeze({basenames:Object.freeze(names.filter(n=>n.endsWith('.go'))),files:Object.freeze(files),supplierHandoff:Object.freeze({path:join(original.root,'SUPPLIER_HANDOFF.json'),...H}),parentHandoff:Object.freeze({...parent}),preparedRoot,staged:true,dataOnly:true,oldFilesRewritten:false,fixtureNodeChanged:false,migrationApplied:false,PostgreSQLConnected:false,GoExecuted:false,NodeExecuted:false,normalGoServer:false,Source13:false,Root:false,registered:false,protectedCustodyAdmitted:false,authorized:false,Native:false,production:false});
 }catch(error){error.partialOutputPreserved=true;throw error;}
}
