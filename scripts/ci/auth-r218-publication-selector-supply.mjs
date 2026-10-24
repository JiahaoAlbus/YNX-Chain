// Fixed PUBLIC supplier CI staging. No Go/SQL/child execution or authorization.
import {readFileSync,writeFileSync,readSync,readdirSync,lstatSync,fstatSync,realpathSync,openSync,closeSync,renameSync,constants} from 'node:fs';import {resolve,join,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomBytes} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/auth-r218-publication-selector/',import.meta.url));
const H={bytes:36346,sha256:'6716c8adeaa2e3614f6ff4b18596a4274f4c8f6b836ad10aa08a9627b6f80355'},parent={bytes:24787,sha256:'6e5676f29fc88b6d35580aae9175f410507d83e6b9ff09b6155e312c044cb8b8'};
const replace=['original_factory_publisher.go','original_factory_publisher_current.go'],append=['original_factory_publication_selector.go','original_factory_publication_selector_test.go','original_signed_manifest.go'],names=[...replace,...append],prefix='source/internal/developerauthority/';
const old=[{bytes:10256,sha256:'8bc850b81fd48b23a62301d3d5e370ea7f906721b7c19a220525409df56287e2'},{bytes:8558,sha256:'4128cd97bfecd5c1c94f4027d1ebfc79b0fa755e6cc7b4cdef8a033a3f26d4e3'}];
const r221=[{name:'original_publication_continuation_test.go',bytes:8317,sha256:'de8f1b2f4c4b5f19dd3d2fb3686d386acf8318eead5df9bedfd90f3bd04b9afe'},{name:'original_publication_caller_guard_test.go',bytes:932,sha256:'528d92d20a4127e6f5fac26623d316459283e7cd51bd8d9397eb7ac36aca14d0'}];
const fail=code=>{throw Object.assign(Error(code),{code});},sha=b=>createHash('sha256').update(b).digest('hex');
function canonical(p,dir=false){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('R218_SELECTOR_PATH');for(let at=p;;at=dirname(at)){if(lstatSync(at).isSymbolicLink())fail('R218_SELECTOR_SYMLINK');if(at===dirname(at))break;}if(realpathSync(p)!==p||dir&&!lstatSync(p).isDirectory())fail('R218_SELECTOR_PATH');}
function exact(file,pin){canonical(file);const s=lstatSync(file);if(!s.isFile()||s.size!==pin.bytes)fail('R218_SELECTOR_PIN');const b=readFileSync(file);if(b.length!==pin.bytes||sha(b)!==pin.sha256)fail('R218_SELECTOR_PIN');return b;}
function supply(){const root=resolve(fixture),expected=['SUPPLIER_HANDOFF.json',...names.map(n=>prefix+n)].sort(),actual=[];canonical(root,true);
 function visit(dir){for(const n of readdirSync(dir)){const p=join(dir,n),relative=p.slice(root.length+1).split('\\').join('/'),s=lstatSync(p);if(s.isSymbolicLink())fail('R218_SELECTOR_SYMLINK');if(s.isDirectory()){if(!expected.some(x=>x.startsWith(relative+'/')))fail('R218_SELECTOR_EXTRA');visit(p);}else{if(!s.isFile())fail('R218_SELECTOR_PIN');actual.push(relative);if(actual.length>6)fail('R218_SELECTOR_EXTRA');}}}visit(root);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R218_SELECTOR_EXTRA');
 const h=JSON.parse(exact(join(root,'SUPPLIER_HANDOFF.json'),H));if(h.parent?.bytes!==parent.bytes||h.parent?.sha256!==parent.sha256||h.truth?.migrationApplied!==false||h.truth?.Source13!==false||h.truth?.Root!==false||h.truth?.production!==false||h.sourceDelta?.length!==5)fail('R218_SELECTOR_PARENT');
 const files=names.map((name,i)=>{const rows=h.sourceDelta.filter(p=>p.relative===prefix+name);if(rows.length!==1)fail('R218_SELECTOR_SCOPE');const r=rows[0],pin={bytes:r.bytes,sha256:r.sha256};if(i<2?(r.parent?.bytes!==old[i].bytes||r.parent?.sha256!==old[i].sha256):r.parent!==null)fail('R218_SELECTOR_PARENT');const refs=h.refs.filter(p=>p.relative===r.relative);if(refs.length!==1||refs[0].bytes!==pin.bytes||refs[0].sha256!==pin.sha256)fail('R218_SELECTOR_SCOPE');return{name,pin,raw:exact(join(root,prefix+name),pin)};});return{root,files};
}
function fence(opened){const a=fstatSync(opened.fd,{bigint:true}),b=lstatSync(opened.file,{bigint:true});for(const s of [a,b])if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.dev!==opened.identity.dev||s.ino!==opened.identity.ino||s.size!==BigInt(opened.pin.bytes))fail('R218_SELECTOR_OLD_IDENTITY');const raw=Buffer.alloc(opened.pin.bytes);let at=0;while(at<raw.length){const n=readSync(opened.fd,raw,at,raw.length-at,at);if(n===0)fail('R218_SELECTOR_OLD_PIN');at+=n;}if(sha(raw)!==opened.pin.sha256)fail('R218_SELECTOR_OLD_PIN');}
/** Caller owns the exclusive R202+R209+R210+R213+R214+R215+R216+R217+R219+R221 prepared temp tree.
 * FD/name/byte fences precede each same-directory rename. Neither the two
 * renames nor all five staged leaves are a kernel-atomic transaction. */
export function stageR218PublicationSelectorDelta({preparedRoot}){
 const supplied=supply();canonical(preparedRoot,true);const dir=join(preparedRoot,'internal/developerauthority');canonical(dir,true);for(const p of r221)exact(join(dir,p.name),p);const opened=[],temporaries=[];let firstFailure;
 try{
  for(const name of append){try{lstatSync(join(dir,name));fail('R218_SELECTOR_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const [i,name]of replace.entries()){const file=join(dir,name);canonical(file);const identity=lstatSync(file,{bigint:true});if(!identity.isFile()||identity.nlink!==1n)fail('R218_SELECTOR_OLD_IDENTITY');const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW),entry={file,identity,fd,pin:old[i]};opened.push(entry);fence(entry);}
  // Both old pins/FD identities have passed before any output is selected.
  for(let i=0;i<2;i++){
   const next=supplied.files[i],temp=join(dir,'.'+next.name+'.r218-'+randomBytes(12).toString('hex')+'.tmp');temporaries.push(temp);writeFileSync(temp,next.raw,{flag:'wx',mode:0o600});exact(temp,next.pin);canonical(dir,true);
   for(let j=i;j<2;j++)fence(opened[j]);for(let j=0;j<i;j++)exact(opened[j].file,supplied.files[j].pin);
   renameSync(temp,opened[i].file);exact(opened[i].file,next.pin);if(lstatSync(opened[i].file).nlink!==1)fail('R218_SELECTOR_REPLACEMENT_IDENTITY');
  }
  for(const next of supplied.files.slice(2)){const file=join(dir,next.name);writeFileSync(file,next.raw,{flag:'wx',mode:0o600});exact(file,next.pin);}
  supply();for(const next of supplied.files)exact(join(dir,next.name),next.pin);for(const p of r221)exact(join(dir,p.name),p);
  const replacements=replace.map((name,i)=>Object.freeze({path:'internal/developerauthority/'+name,previous:Object.freeze({...old[i]}),...supplied.files[i].pin})),files=supplied.files.slice(2).map(p=>Object.freeze({path:'internal/developerauthority/'+p.name,...p.pin}));
  return Object.freeze({basenames:Object.freeze(append.filter(n=>n.endsWith('.go'))),files:Object.freeze(files),replacedFiles:Object.freeze(replacements),supplierHandoff:Object.freeze({path:join(supplied.root,'SUPPLIER_HANDOFF.json'),...H}),parentHandoff:Object.freeze({...parent}),preparedRoot,staged:true,dataOnly:true,kernelAtomicAllFive:false,kernelAtomicCompareExchange:false,otherFilesRewritten:false,r221TestsRewritten:false,oldFullPinnedRuntimeFailureResolved:false,fixtureNodeChanged:false,migrationApplied:false,PostgreSQLConnected:false,GoExecuted:false,NodeExecuted:false,normalGoServer:false,Source13:false,Root:false,registered:false,authorized:false,Native:false,production:false});
 }catch(error){firstFailure=error;error.firstCause??=error.code??error.message;error.partialOutputPreserved=true;error.selectedTemporaryPaths=[...temporaries];throw error;}finally{
  let firstClose;const closeErrors=[];for(const p of opened){try{closeSync(p.fd);}catch(e){firstClose??=e;closeErrors.push({code:e.code??e.message});}}
  if(firstClose){const cause=firstFailure??firstClose;cause.closeErrors=closeErrors;cause.cleanupUnknown=true;if(!firstFailure){cause.firstCause??=cause.code??cause.message;cause.partialOutputPreserved=true;cause.selectedTemporaryPaths=[...temporaries];throw cause;}}
 }
}
