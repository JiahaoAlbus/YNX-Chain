// PUBLIC supplier CI append-only delta. No child, Go/Node execution or grant.
import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';import {resolve,join,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/auth-r213-publisher-current/',import.meta.url));
const H={bytes:7442,sha256:'eab74dca7de61d9a91b122737ae9a6bba1f35151d8037dfcbab641195b276c4b'},parent={bytes:5773,sha256:'e3305b55b516943b70b7d0e1c4ccafb6e04717be53808c65be0e726976c505b2'},sdk={bytes:6676,sha256:'0663e47a6636b67d3e2dd3cf4462b4a0db491f5d69309764a74f1f5ccaeedf94'};
const names=['original_publisher_current.go','original_publisher_current_test.go'],prefix='source/internal/developerauthority/';
const prior=[{name:'original_control_runtime.go',bytes:12767,sha256:'39ae71b4ca13b9f2060707c8217ac56c81887b53aa300cd8a44bf37f2c57a656'},{name:'original_source_post_completion_test.go',bytes:1573,sha256:'5ffccbd8efe1752b45ad2bf961836e7f2c8bb82fe0510adaaa4b1a04eb426697'}];
const fail=code=>{throw Object.assign(Error(code),{code});},sha=b=>createHash('sha256').update(b).digest('hex');
function canonical(p,dir=false){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('R213_PUBLISHER_PATH');for(let at=p;;at=dirname(at)){if(lstatSync(at).isSymbolicLink())fail('R213_PUBLISHER_SYMLINK');if(at===dirname(at))break;}if(realpathSync(p)!==p||dir&&!lstatSync(p).isDirectory())fail('R213_PUBLISHER_PATH');}
function exact(file,pin){canonical(file);const st=lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('R213_PUBLISHER_PIN');const raw=readFileSync(file);if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)fail('R213_PUBLISHER_PIN');return raw;}
function supply(){const root=resolve(fixture),expected=['SUPPLIER_HANDOFF.json',...names.map(n=>prefix+n)].sort(),actual=[];canonical(root,true);
 function visit(dir){for(const n of readdirSync(dir)){const p=join(dir,n),relative=p.slice(root.length+1).split('\\').join('/'),s=lstatSync(p);if(s.isSymbolicLink())fail('R213_PUBLISHER_SYMLINK');if(s.isDirectory()){if(!expected.some(x=>x.startsWith(relative+'/')))fail('R213_PUBLISHER_EXTRA');visit(p);}else{if(!s.isFile())fail('R213_PUBLISHER_PIN');actual.push(relative);if(actual.length>3)fail('R213_PUBLISHER_EXTRA');}}}visit(root);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R213_PUBLISHER_EXTRA');
 const h=JSON.parse(exact(join(root,'SUPPLIER_HANDOFF.json'),H)),r211=h.requiresSDK?.R211;if(h.parent?.bytes!==parent.bytes||h.parent?.sha256!==parent.sha256||r211?.bytes!==sdk.bytes||r211?.sha256!==sdk.sha256||h.requiresSDK?.operation!=='ide-protected-publisher-current-native-node/v1'||h.truth?.Source13!==false||h.truth?.Root!==false||h.truth?.production!==false)fail('R213_PUBLISHER_PARENTS');
 const files=names.map(name=>{const rows=h.refs.filter(x=>x.relative===prefix+name);if(rows.length!==1)fail('R213_PUBLISHER_SCOPE');const {bytes,sha256}=rows[0],pin={bytes,sha256};return{name,pin,raw:exact(join(root,prefix+name),pin)};});return{root,files};
}
/** preparedRoot is the caller-owned R202 prepare + R209 + R210 temporary
 * tree. This stages two source leaves only, without qualifying that tree or
 * the required Auth29/R211 runtime, caller, Source or registration authority. */
export function stageR213PublisherCurrentDelta({preparedRoot}){
 const original=supply();canonical(preparedRoot,true);const target=join(preparedRoot,'internal/developerauthority');canonical(target,true);for(const p of prior)exact(join(target,p.name),p);
 for(const {name}of original.files){try{lstatSync(join(target,name));}catch(e){if(e.code==='ENOENT')continue;throw e;}fail('R213_PUBLISHER_OUTPUT_EXISTS');}
 const files=[];try{
  for(const {name,pin,raw}of original.files){const file=join(target,name);writeFileSync(file,raw,{flag:'wx',mode:0o600});exact(file,pin);files.push(Object.freeze({path:'internal/developerauthority/'+name,...pin}));}
  supply();for(const p of prior)exact(join(target,p.name),p);
  return Object.freeze({basenames:Object.freeze([...names]),files:Object.freeze(files),supplierHandoff:Object.freeze({path:join(original.root,'SUPPLIER_HANDOFF.json'),...H}),parentHandoff:Object.freeze({...parent}),requiredR211Handoff:Object.freeze({...sdk}),preparedRoot,staged:true,dataOnly:true,oldFilesRewritten:false,fixtureNodeChanged:false,requiredSDKRuntimeVerified:false,GoExecuted:false,NodeExecuted:false,normalGoServer:false,Source13:false,Root:false,registered:false,protectedCustodyAdmitted:false,authorized:false,Native:false,production:false});
 }catch(error){error.partialOutputPreserved=true;throw error;}
}
