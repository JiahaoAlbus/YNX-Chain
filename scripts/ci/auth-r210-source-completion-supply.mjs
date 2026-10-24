// PUBLIC supplier CI source replacement only. No runtime/Go/Node execution.
import {readFileSync,writeFileSync,readSync,readdirSync,lstatSync,fstatSync,realpathSync,openSync,closeSync,renameSync,constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomBytes} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/auth-r210-source-completion/',import.meta.url));
const H={bytes:5773,sha256:'e3305b55b516943b70b7d0e1c4ccafb6e04717be53808c65be0e726976c505b2'},old={bytes:11941,sha256:'de5328f880c5479b1532651b127df1e41c9bcfe60096bbfb4946671af25f50fe'};
const runtime='original_control_runtime.go',added='original_source_post_completion_test.go',prefix='source/internal/developerauthority/';
const catalog=[{name:'original_catalog_authority.go',bytes:1211,sha256:'2ac5d7dcf6729063a8e2228b3275bf55ad71db60a2477f014914f53e8cc35465'},{name:'original_catalog_authority_test.go',bytes:2239,sha256:'291961e5665ca927dc731f3389175c8dbc738e42a8e538e8ebb015cfee252657'}];
const fail=code=>{throw Object.assign(Error(code),{code});},sha=raw=>createHash('sha256').update(raw).digest('hex');
function canonical(p,dir=false){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('R210_COMPLETION_PATH');for(let at=p;;at=dirname(at)){if(lstatSync(at).isSymbolicLink())fail('R210_COMPLETION_SYMLINK');if(at===dirname(at))break;}if(realpathSync(p)!==p||dir&&!lstatSync(p).isDirectory())fail('R210_COMPLETION_PATH');}
function exact(file,pin){canonical(file);const st=lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('R210_COMPLETION_PIN');const b=readFileSync(file);if(b.length!==pin.bytes||sha(b)!==pin.sha256)fail('R210_COMPLETION_PIN');return b;}
function supply(){const root=resolve(fixture),expected=['SUPPLIER_HANDOFF.json',prefix+runtime,prefix+added].sort(),actual=[];canonical(root,true);
 function visit(dir){for(const n of readdirSync(dir)){const p=join(dir,n),relative=p.slice(root.length+1).split('\\').join('/'),st=lstatSync(p);if(st.isSymbolicLink())fail('R210_COMPLETION_SYMLINK');if(st.isDirectory()){if(!expected.some(x=>x.startsWith(relative+'/')))fail('R210_COMPLETION_EXTRA');visit(p);}else{if(!st.isFile())fail('R210_COMPLETION_PIN');actual.push(relative);if(actual.length>3)fail('R210_COMPLETION_EXTRA');}}}visit(root);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R210_COMPLETION_EXTRA');
 const h=JSON.parse(exact(join(root,'SUPPLIER_HANDOFF.json'),H));if(h.parent?.bytes!==old.bytes||h.parent?.sha256!==old.sha256||h.truth?.Source13!==false||h.truth?.Root!==false||h.truth?.production!==false)fail('R210_COMPLETION_PARENT');
 const files=[runtime,added].map(name=>{const refs=h.refs.filter(p=>p.relative===prefix+name);if(refs.length!==1)fail('R210_COMPLETION_SCOPE');const {bytes,sha256}=refs[0],pin={bytes,sha256};return{name,pin,raw:exact(join(root,prefix+name),pin)};});return{root,files};
}
function fdOld(fd,file,identity){const fst=fstatSync(fd,{bigint:true}),named=lstatSync(file,{bigint:true});for(const s of [fst,named])if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.dev!==identity.dev||s.ino!==identity.ino||s.size!==BigInt(old.bytes))fail('R210_COMPLETION_OLD_IDENTITY');
 const b=Buffer.alloc(old.bytes);let offset=0;while(offset<b.length){const n=readSync(fd,b,offset,b.length-offset,offset);if(n===0)fail('R210_COMPLETION_OLD_PIN');offset+=n;}if(sha(b)!==old.sha256)fail('R210_COMPLETION_OLD_PIN');return b;
}
/** Call only with the caller-owned temporary R202 prepare + R209 staged tree.
 * Same-directory rename follows FD/name/bytes fences; this is not a kernel
 * compare-exchange primitive. No old31 file or fixtureNode is rewritten. */
export function stageR210SourceCompletionDelta({preparedRoot}){
 const supplied=supply();canonical(preparedRoot,true);const dir=join(preparedRoot,'internal/developerauthority');canonical(dir,true);
 for(const p of catalog)exact(join(dir,p.name),p);
 const test=join(dir,added);try{lstatSync(test);fail('R210_COMPLETION_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const target=join(dir,runtime);canonical(target);const initial=lstatSync(target,{bigint:true});if(!initial.isFile()||initial.nlink!==1n)fail('R210_COMPLETION_OLD_IDENTITY');
 const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);let temporary;
 try{
  fdOld(fd,target,initial);const replacement=supplied.files[0],next=supplied.files[1];temporary=join(dir,'.'+runtime+'.r210-'+randomBytes(12).toString('hex')+'.tmp');
  writeFileSync(temporary,replacement.raw,{flag:'wx',mode:0o600});exact(temporary,replacement.pin);
  canonical(dir,true);fdOld(fd,target,initial);renameSync(temporary,target);exact(target,replacement.pin);if(lstatSync(target).nlink!==1)fail('R210_COMPLETION_REPLACEMENT_IDENTITY');
  writeFileSync(test,next.raw,{flag:'wx',mode:0o600});exact(test,next.pin);supply();for(const p of catalog)exact(join(dir,p.name),p);
  const replaced=Object.freeze({path:'internal/developerauthority/'+runtime,previous:Object.freeze({...old}),bytes:replacement.pin.bytes,sha256:replacement.pin.sha256}),file=Object.freeze({path:'internal/developerauthority/'+added,...next.pin});
  return Object.freeze({basenames:Object.freeze([added]),files:Object.freeze([file]),replacedRuntime:replaced,supplierHandoff:Object.freeze({path:join(supplied.root,'SUPPLIER_HANDOFF.json'),...H}),preparedRoot,staged:true,dataOnly:true,old31Rewritten:false,fixtureNodeChanged:false,kernelAtomicCompareExchange:false,GoExecuted:false,NodeExecuted:false,normalGoServer:false,Source13:false,Root:false,Native:false,production:false});
 }catch(error){error.partialOutputPreserved=true;if(temporary)error.selectedTemporaryPath=temporary;throw error;}finally{closeSync(fd);}
}
