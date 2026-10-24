// One new PUBLIC Go test; original R231 production/test bytes are unchanged.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {readR231RuntimeSupply,stageR231RuntimeSupply,r231SupplierPin} from './auth-r231-runtime-supply.mjs';
const fixture=fileURLToPath(new URL('./fixtures/auth-r232-go-source/',import.meta.url));
export const r232SupplierPin=Object.freeze({bytes:28026,sha256:'8b02cc79e1c29bd4facbc948c785e5f46d8476e4477574fa9de07d4377b8fdc9'});
const originalR219Pin=Object.freeze({bytes:24787,sha256:'6e5676f29fc88b6d35580aae9175f410507d83e6b9ff09b6155e312c044cb8b8'});
const R231LinuxPin=Object.freeze({bytes:6668,sha256:'b7513fd11ffc0ac663613f617c9b8972be0e0033d7d74e1c52fc2e56f761f3ca'});
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})},same=(a,b)=>a?.bytes===b?.bytes&&a?.sha256===b?.sha256;
function canonical(p){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('R232_PATH');for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('R232_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(p)!==p)fail('R232_PATH');}
function exact(file,pin){canonical(file);const st=fs.lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('R232_PIN');const raw=fs.readFileSync(file);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('R232_PIN');return raw;}
const isGo=p=>typeof p==='string'&&/^source\/internal\/developerauthority\/[a-z0-9_]+\.go$/.test(p);
export function readR232CatalogSupply(){
 const h=JSON.parse(exact(path.join(fixture,'SUPPLIER_HANDOFF.json'),r232SupplierPin));
 if(h.sourceClosureGo!==54||h.sourceDelta?.length!==1||h.refs?.length!==59||h.parents?.length!==2||!same(h.parents[0],r231SupplierPin)||!same(h.parents[1],originalR219Pin)||!same(h.R231Linux,R231LinuxPin)||h.tests.singleNewTest!=='TestR232OriginalFailedNormalCallerWithFullPinnedCurrent'||h.truth.Source13!==false||h.truth.resourceProducer!==false||h.truth.Root!==false||h.truth.originalLinuxFullPinnedFailureClosed!==false)fail('R232_SUPPLY');
 const full=h.refs.filter(p=>isGo(p.relative)),delta=h.sourceDelta[0];
 if(full.length!==54||new Set(full.map(p=>p.relative)).size!==54||!isGo(delta.relative)||delta.parent!==null)fail('R232_SCOPE');
 const expected=['SUPPLIER_HANDOFF.json','PINS.json',delta.relative].sort(),actual=[];
 function visit(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),s=fs.lstatSync(file),rel=path.relative(fixture,file).split(path.sep).join('/');if(s.isSymbolicLink())fail('R232_SYMLINK');if(s.isDirectory()){if(!expected.some(p=>p.startsWith(rel+'/')))fail('R232_EXTRA');visit(file);}else{if(!s.isFile())fail('R232_PIN');actual.push(rel);if(actual.length>3)fail('R232_EXTRA');}}}visit(fixture);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R232_EXTRA');
 const pins=JSON.parse(fs.readFileSync(path.join(fixture,'PINS.json'),'utf8')),row={path:delta.relative,bytes:delta.bytes,sha256:delta.sha256,parent:null};
 if(pins.kind!=='YNX-R232-PUBLIC-GO-DELTA-FIXTURE/v1'||pins.PUBLIC!==true||pins.Source13!==false||pins.Root!==false||pins.production!==false||!same(pins.supplierHandoff,r232SupplierPin)||pins.parents?.length!==2||!same(pins.parents[0],r231SupplierPin)||!same(pins.parents[1],originalR219Pin)||!same(pins.R231Linux,R231LinuxPin)||JSON.stringify(pins.files)!==JSON.stringify([row]))fail('R232_PINS');
 const baseline=readR231RuntimeSupply(),before=new Map(baseline.files.map(p=>[p.pin.path,p]));
 let added=0;for(const p of full){const old=before.get(p.relative);if(old){if(!same(old.pin,p)||p.relative===delta.relative)fail('R232_BASELINE_CHANGED');}else{if(p.relative!==delta.relative||!same(p,delta))fail('R232_UNDECLARED_DELTA');added++;}}
 if(added!==1||baseline.files.some(p=>!full.some(x=>x.relative===p.pin.path)))fail('R232_BASELINE_REMOVED');
 const raw=exact(path.join(fixture,delta.relative),delta);
 return {fixture:path.resolve(fixture),baseline,delta:{pin:{path:delta.relative,bytes:delta.bytes,sha256:delta.sha256},raw},R231Linux:R231LinuxPin};
}
export function stageR232CatalogSupply({outputRoot,nodeExecutable}){
 // Validate the full54-to-base53 comparison before selecting any output.
 const supplied=readR232CatalogSupply();
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot||outputRoot===supplied.fixture||outputRoot.startsWith(supplied.fixture+path.sep))fail('R232_OUTPUT_PATH');
 const prepared=stageR231RuntimeSupply({outputRoot,nodeExecutable});
 try{
  const relative=supplied.delta.pin.path.slice('source/'.length),out=path.join(outputRoot,relative);
  fs.writeFileSync(out,supplied.delta.raw,{flag:'wx',mode:0o600});exact(out,supplied.delta.pin);
  // All previously prepared53 bytes, including the sole adapted test constant,
  // must remain exactly as the original R231 preparer reported them.
  for(const p of prepared.files)exact(path.join(outputRoot,p.path),p);
  readR232CatalogSupply();
  const files=[...prepared.files,{path:relative,bytes:supplied.delta.pin.bytes,sha256:supplied.delta.pin.sha256}];
  return Object.freeze({...prepared,supplierHandoff:r232SupplierPin,baselineSupplier:r231SupplierPin,R231Linux:R231LinuxPin,files,delta:[{...supplied.delta.pin,parent:null}],originalR231BytesUnchanged:true,originalR219FailurePreserved:true,originalR229FailurePreserved:true,oldFullPinned28_63FailureResolved:false});
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
