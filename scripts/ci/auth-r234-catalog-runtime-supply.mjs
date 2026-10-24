// Only the two original R234 Go additions; all54 baseline bytes stay owned R232.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {readR232CatalogSupply,stageR232CatalogSupply,r232SupplierPin} from './auth-r232-catalog-supply.mjs';
const fixture=fileURLToPath(new URL('./fixtures/auth-r234-go-source/',import.meta.url));
export const r234SupplierPin=Object.freeze({bytes:29569,sha256:'a59154e4e1abafac88049c940eb88d2c239c4d45c7ad267ee74302319d41d197'});
const startupGapPin=Object.freeze({bytes:2141,sha256:'cb118143ef35685ad714a96bf0c045eecfa11111ea6de567c073ba3c38aa9c16'});
const actualR232LinuxPin=Object.freeze({bytes:6116,sha256:'8cffdbb5038c896137e9083fee75c5dca7940ec0d4918828ec1367cb470ddd28'});
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})},same=(a,b)=>a?.bytes===b?.bytes&&a?.sha256===b?.sha256;
function canonical(p){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('R234_PATH');for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('R234_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(p)!==p)fail('R234_PATH');}
function exact(file,pin){canonical(file);const st=fs.lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('R234_PIN');const raw=fs.readFileSync(file);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('R234_PIN');return raw;}
const isGo=p=>typeof p==='string'&&/^source\/internal\/developerauthority\/[a-z0-9_]+\.go$/.test(p);
export function readR234CatalogRuntimeSupply(){
 const h=JSON.parse(exact(path.join(fixture,'SUPPLIER_HANDOFF.json'),r234SupplierPin));
 if(h.sourceClosureGo!==56||h.sourceDelta?.length!==2||h.refs?.length!==62||!same(h.parent,r232SupplierPin)||!same(h.startupGap,startupGapPin)||!same(h.qualifiedOldFailureResolution?.actualLinux,actualR232LinuxPin)||h.truth.Source13!==false||h.truth.resourceProducer!==false||h.truth.Root!==false||h.truth.actualServiceMounted!==false||h.truth.newServerCreated!==false)fail('R234_SUPPLY');
 const full=h.refs.filter(p=>isGo(p.relative)),delta=h.sourceDelta;
 if(full.length!==56||new Set(full.map(p=>p.relative)).size!==56||new Set(delta.map(p=>p.relative)).size!==2||delta.some(p=>!isGo(p.relative)||p.parent!==null))fail('R234_SCOPE');
 const expected=['SUPPLIER_HANDOFF.json','PINS.json',...delta.map(p=>p.relative)].sort(),actual=[];
 function visit(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),s=fs.lstatSync(file),rel=path.relative(fixture,file).split(path.sep).join('/');if(s.isSymbolicLink())fail('R234_SYMLINK');if(s.isDirectory()){if(!expected.some(p=>p.startsWith(rel+'/')))fail('R234_EXTRA');visit(file);}else{if(!s.isFile())fail('R234_PIN');actual.push(rel);if(actual.length>4)fail('R234_EXTRA');}}}visit(fixture);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R234_EXTRA');
 const pins=JSON.parse(fs.readFileSync(path.join(fixture,'PINS.json'),'utf8')),rows=delta.map(p=>({path:p.relative,bytes:p.bytes,sha256:p.sha256,parent:null}));
 if(pins.kind!=='YNX-R234-PUBLIC-GO-DELTA-FIXTURE/v1'||pins.PUBLIC!==true||pins.Source13!==false||pins.Root!==false||pins.production!==false||!same(pins.supplierHandoff,r234SupplierPin)||!same(pins.parent,r232SupplierPin)||!same(pins.startupGap,startupGapPin)||!same(pins.actualR232Linux,actualR232LinuxPin)||JSON.stringify(pins.files)!==JSON.stringify(rows))fail('R234_PINS');
 const baseline=readR232CatalogSupply(),before=new Map([...baseline.baseline.files.map(p=>[p.pin.path,p.pin]),[baseline.delta.pin.path,baseline.delta.pin]]),additions=new Map(delta.map(p=>[p.relative,p]));
 let added=0;for(const p of full){const old=before.get(p.relative);if(old){if(!same(old,p)||additions.has(p.relative))fail('R234_BASELINE_CHANGED');}else{if(!same(additions.get(p.relative),p))fail('R234_UNDECLARED_DELTA');added++;}}
 if(before.size!==54||added!==2||[...before.keys()].some(p=>!full.some(x=>x.relative===p)))fail('R234_BASELINE_REMOVED');
 return {fixture:path.resolve(fixture),baseline,delta:rows.map(p=>({pin:p,raw:exact(path.join(fixture,p.path),p)}))};
}
export function stageR234CatalogRuntimeSupply({outputRoot,nodeExecutable}){
 // Complete merged56 and all new pins are checked BEFORE any baseline output.
 const supplied=readR234CatalogRuntimeSupply();
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot||outputRoot===supplied.fixture||outputRoot.startsWith(supplied.fixture+path.sep))fail('R234_OUTPUT_PATH');
 const prepared=stageR232CatalogSupply({outputRoot,nodeExecutable});
 try{
  const additions=[];for(const {pin,raw}of supplied.delta){const relative=pin.path.slice('source/'.length),out=path.join(outputRoot,relative);fs.writeFileSync(out,raw,{flag:'wx',mode:0o600});exact(out,pin);additions.push({path:relative,bytes:pin.bytes,sha256:pin.sha256});}
  for(const p of prepared.files)exact(path.join(outputRoot,p.path),p);
  readR234CatalogRuntimeSupply();
  return Object.freeze({...prepared,supplierHandoff:r234SupplierPin,baselineSupplier:r232SupplierPin,actualR232Linux:actualR232LinuxPin,startupGap:startupGapPin,files:[...prepared.files,...additions],delta:supplied.delta.map(p=>p.pin),originalR232PreparedBytesUnchanged:true,currentSixFieldFullPinnedPathPreviouslyPassed:true,historicalFirstFailuresPreserved:true,actualServiceMounted:false,newServerCreated:false,Root:false,Source13:false,resourceProducer:false});
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
