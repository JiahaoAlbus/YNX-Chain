// Fixed PUBLIC supplier CI staging. No Go/SQL/child execution or authorization.
import {readFileSync,writeFileSync,readSync,readdirSync,lstatSync,fstatSync,realpathSync,openSync,closeSync,renameSync,constants} from 'node:fs';import {resolve,join,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomBytes} from 'node:crypto';
const fixture=fileURLToPath(new URL('./fixtures/auth-r221-publication-caller-guard/',import.meta.url));
const H={bytes:25719,sha256:'962f5c99518fcc839d5ad903c89bbc59764f14d91483d31c9865c2feb566de50'},parent={bytes:24787,sha256:'6e5676f29fc88b6d35580aae9175f410507d83e6b9ff09b6155e312c044cb8b8'};
const firstActualFailure={bytes:13280,sha256:'f6911130fddf42af12aae0b6f5158e7851f0b388b4496731d8a58af214a4193a',CI:40074517538,job:120814915265,firstAuthorizePublicationSeconds:28.63,fixturePublisherSeconds:26,fixturePrincipalSeconds:28,firstAuthorizeFailed:true,secondRecheckReached:false,open:true};
const replace=['original_publication_continuation_test.go'],append=['original_publication_caller_guard_test.go'],names=[...replace,...append],prefix='source/internal/developerauthority/';
const old=[{bytes:6331,sha256:'a03628983c50c766135950d34112a5616af5e53ffd1b0fdd9b03eb87e81644f1'}];
const fail=code=>{throw Object.assign(Error(code),{code});},sha=b=>createHash('sha256').update(b).digest('hex');
function canonical(p,dir=false){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('R221_CALLER_PATH');for(let at=p;;at=dirname(at)){if(lstatSync(at).isSymbolicLink())fail('R221_CALLER_SYMLINK');if(at===dirname(at))break;}if(realpathSync(p)!==p||dir&&!lstatSync(p).isDirectory())fail('R221_CALLER_PATH');}
function exact(file,pin){canonical(file);const s=lstatSync(file);if(!s.isFile()||s.size!==pin.bytes)fail('R221_CALLER_PIN');const b=readFileSync(file);if(b.length!==pin.bytes||sha(b)!==pin.sha256)fail('R221_CALLER_PIN');return b;}
function supply(){const root=resolve(fixture),expected=['SUPPLIER_HANDOFF.json',...names.map(n=>prefix+n)].sort(),actual=[];canonical(root,true);
 function visit(dir){for(const n of readdirSync(dir)){const p=join(dir,n),relative=p.slice(root.length+1).split('\\').join('/'),s=lstatSync(p);if(s.isSymbolicLink())fail('R221_CALLER_SYMLINK');if(s.isDirectory()){if(!expected.some(x=>x.startsWith(relative+'/')))fail('R221_CALLER_EXTRA');visit(p);}else{if(!s.isFile())fail('R221_CALLER_PIN');actual.push(relative);if(actual.length>3)fail('R221_CALLER_EXTRA');}}}visit(root);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R221_CALLER_EXTRA');
 const h=JSON.parse(exact(join(root,'SUPPLIER_HANDOFF.json'),H));if(h.parent?.bytes!==parent.bytes||h.parent?.sha256!==parent.sha256||h.truth?.Source13!==false||h.truth?.Root!==false||h.truth?.mounted!==false||h.sourceDelta?.length!==2)fail('R221_CALLER_PARENT');
 if(Object.entries(firstActualFailure).some(([key,value])=>h.firstActualFailure?.[key]!==value)||['productionBytesChanged','originalPinnerChanged','timeWindowsExtended','permitRebound','oldFullPinnedRuntimeFailureResolved'].some(key=>h.truth?.[key]!==false))fail('R221_CALLER_FIRST_ACTUAL_FAILURE');
 const files=names.map((name,i)=>{const rows=h.sourceDelta.filter(p=>p.relative===prefix+name);if(rows.length!==1)fail('R221_CALLER_SCOPE');const r=rows[0],pin={bytes:r.bytes,sha256:r.sha256};if(i<replace.length?(r.parent?.bytes!==old[i].bytes||r.parent?.sha256!==old[i].sha256):r.parent!==null)fail('R221_CALLER_PARENT');const refs=h.refs.filter(p=>p.relative===r.relative);if(refs.length!==1||refs[0].bytes!==pin.bytes||refs[0].sha256!==pin.sha256)fail('R221_CALLER_SCOPE');return{name,pin,raw:exact(join(root,prefix+name),pin)};});return{root,files};
}
function fence(opened){const a=fstatSync(opened.fd,{bigint:true}),b=lstatSync(opened.file,{bigint:true});for(const s of [a,b])if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.dev!==opened.identity.dev||s.ino!==opened.identity.ino||s.size!==BigInt(opened.pin.bytes))fail('R221_CALLER_OLD_IDENTITY');const raw=Buffer.alloc(opened.pin.bytes);let at=0;while(at<raw.length){const n=readSync(opened.fd,raw,at,raw.length-at,at);if(n===0)fail('R221_CALLER_OLD_PIN');at+=n;}if(sha(raw)!==opened.pin.sha256)fail('R221_CALLER_OLD_PIN');}
/** Caller owns the exclusive R202+R209+R210+R213+R214+R215+R216+R217+R219 prepared temp tree.
 * FD/name/byte fences precede each same-directory rename. The single
 * fenced rename plus append are not one kernel-atomic transaction. */
export function stageR221PublicationCallerGuardDelta({preparedRoot}){
 const supplied=supply();canonical(preparedRoot,true);const dir=join(preparedRoot,'internal/developerauthority');canonical(dir,true);const opened=[],temporaries=[];let firstFailure;
 try{
  for(const name of append){try{lstatSync(join(dir,name));fail('R221_CALLER_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const [i,name]of replace.entries()){const file=join(dir,name);canonical(file);const identity=lstatSync(file,{bigint:true});if(!identity.isFile()||identity.nlink!==1n)fail('R221_CALLER_OLD_IDENTITY');const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW),entry={file,identity,fd,pin:old[i]};opened.push(entry);fence(entry);}
  // All old pins/FD identities have passed before any output is selected.
  for(let i=0;i<replace.length;i++){
   const next=supplied.files[i],temp=join(dir,'.'+next.name+'.r221-'+randomBytes(12).toString('hex')+'.tmp');temporaries.push(temp);writeFileSync(temp,next.raw,{flag:'wx',mode:0o600});exact(temp,next.pin);canonical(dir,true);
   for(let j=i;j<replace.length;j++)fence(opened[j]);for(let j=0;j<i;j++)exact(opened[j].file,supplied.files[j].pin);
   renameSync(temp,opened[i].file);exact(opened[i].file,next.pin);if(lstatSync(opened[i].file).nlink!==1)fail('R221_CALLER_REPLACEMENT_IDENTITY');
  }
  for(const next of supplied.files.slice(replace.length)){const file=join(dir,next.name);writeFileSync(file,next.raw,{flag:'wx',mode:0o600});exact(file,next.pin);}
  supply();for(const next of supplied.files)exact(join(dir,next.name),next.pin);
  const replacements=replace.map((name,i)=>Object.freeze({path:'internal/developerauthority/'+name,previous:Object.freeze({...old[i]}),...supplied.files[i].pin})),files=supplied.files.slice(replace.length).map(p=>Object.freeze({path:'internal/developerauthority/'+p.name,...p.pin}));
  return Object.freeze({basenames:Object.freeze(append.filter(n=>n.endsWith('.go'))),files:Object.freeze(files),replacedFiles:Object.freeze(replacements),supplierHandoff:Object.freeze({path:join(supplied.root,'SUPPLIER_HANDOFF.json'),...H}),parentHandoff:Object.freeze({...parent}),firstActualFailure:Object.freeze({...firstActualFailure}),productionBytesChanged:false,originalPinnerChanged:false,timeWindowsExtended:false,permitRebound:false,oldFullPinnedRuntimeFailureResolved:false,fullPinnedRuntimeQualified:false,preparedRoot,staged:true,dataOnly:true,kernelAtomicAllTwo:false,kernelAtomicCompareExchange:false,otherFilesRewritten:false,fixtureNodeChanged:false,migrationApplied:false,PostgreSQLConnected:false,GoExecuted:false,NodeExecuted:false,normalGoServer:false,Source13:false,Root:false,registered:false,authorized:false,Native:false,production:false});
 }catch(error){firstFailure=error;error.firstCause??=error.code??error.message;error.partialOutputPreserved=true;error.selectedTemporaryPaths=[...temporaries];throw error;}finally{
  let firstClose;const closeErrors=[];for(const p of opened){try{closeSync(p.fd);}catch(e){firstClose??=e;closeErrors.push({code:e.code??e.message});}}
  if(firstClose){const cause=firstFailure??firstClose;cause.closeErrors=closeErrors;cause.cleanupUnknown=true;if(!firstFailure){cause.firstCause??=cause.code??cause.message;cause.partialOutputPreserved=true;cause.selectedTemporaryPaths=[...temporaries];throw cause;}}
 }
}
