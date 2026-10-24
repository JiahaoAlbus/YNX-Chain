// PUBLIC fixture staging only. Does not execute Go/Node, keys, SQL or Source.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const fixture=path.resolve(fileURLToPath(new URL('./fixtures/auth-r227-go-source/',import.meta.url)));
export const r227SupplierPin=Object.freeze({bytes:39645,sha256:'35fdc783b6371faf9246d1f4f94ef6c30659d022fc3e15ddcf05bd7ba20bf941'});
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})};
const old='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"';
function canonical(p,dir=false){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('R227_PATH');for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('R227_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(p)!==p||dir&&!fs.lstatSync(p).isDirectory())fail('R227_PATH');}
function exact(file,pin){canonical(file);const s=fs.lstatSync(file);if(!s.isFile()||s.size!==pin.bytes)fail('R227_PIN');const raw=fs.readFileSync(file);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('R227_PIN');return raw;}
export function readR227PublicationResultSupply(){
 canonical(fixture,true);const h=JSON.parse(exact(path.join(fixture,'SUPPLIER_HANDOFF.json'),r227SupplierPin));
 if(h.sourceClosureGo!==50||h.sourceDelta.length!==4||h.refs.length!==84||h.truth.Source13!==false||h.truth.Root!==false||h.truth.production!==false)fail('R227_SUPPLY');
 const files=h.refs.filter(r=>/^source\/internal\/developerauthority\/[a-z0-9_]+\.go$/.test(r.relative));
 if(files.length!==50||new Set(files.map(p=>p.relative)).size!==50)fail('R227_SCOPE');
 const vector=h.refs.find(p=>p.relative==='evidence/transport-BsJMCU/PUBLIC_VECTOR.json');if(!vector)fail('R227_VECTOR');
 const expected=['SUPPLIER_HANDOFF.json','PINS.json','PUBLIC_VECTOR.json',...files.map(p=>p.relative)].sort(),actual=[];
 function visit(dir){for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p),rel=path.relative(fixture,p).split(path.sep).join('/');if(s.isSymbolicLink())fail('R227_SYMLINK');if(s.isDirectory()){if(!expected.some(x=>x.startsWith(rel+'/')))fail('R227_EXTRA');visit(p);}else{if(!s.isFile())fail('R227_PIN');actual.push(rel);if(actual.length>53)fail('R227_EXTRA');}}}visit(fixture);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R227_EXTRA');
 const rows=files.map(p=>({path:p.relative,bytes:p.bytes,sha256:p.sha256}));
 const pins=JSON.parse(fs.readFileSync(path.join(fixture,'PINS.json'),'utf8'));
 if(pins.kind!=='YNX-R227-PUBLIC-GO-FIXTURE/v1'||pins.PUBLIC!==true||pins.Source13!==false||pins.Root!==false||pins.production!==false||JSON.stringify(pins.supplierHandoff)!==JSON.stringify(r227SupplierPin)||JSON.stringify(pins.files)!==JSON.stringify(rows)||pins.publicVector?.path!=='PUBLIC_VECTOR.json'||pins.publicVector.bytes!==vector.bytes||pins.publicVector.sha256!==vector.sha256)fail('R227_PINS');
 const captured=rows.map(p=>({pin:p,raw:exact(path.join(fixture,p.path),p)})),rawVector=exact(path.join(fixture,'PUBLIC_VECTOR.json'),vector);
 return {fixture,files:captured,vector:{path:path.join(fixture,'PUBLIC_VECTOR.json'),bytes:vector.bytes,sha256:vector.sha256,raw:rawVector}};
}
/** Fresh exclusive test tree; only the inherited PUBLIC fixtureNode constant is
 * adapted to the actual running private Node. No production Go leaf changes.
 * Failure retains partial output and first cause; never retries/deletes it. */
export function stageR227PublicationResultSupply({outputRoot,nodeExecutable}){
 const supplied=readR227PublicationResultSupply();canonical(path.dirname(outputRoot),true);
 if(!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot||outputRoot===fixture||outputRoot.startsWith(fixture+path.sep))fail('R227_OUTPUT_PATH');
 canonical(nodeExecutable);if(nodeExecutable!==fs.realpathSync(process.execPath)||!fs.lstatSync(nodeExecutable).isFile())fail('R227_NODE');fs.accessSync(nodeExecutable,fs.constants.X_OK);
 const changed='source/internal/developerauthority/original_source_process_test.go',entry=supplied.files.find(p=>p.pin.path===changed),text=new TextDecoder('utf-8',{fatal:true}).decode(entry.raw);
 if(text.split(old).length!==2||!text.split(/\r?\n/).includes(old))fail('R227_NODE_CONSTANT');
 const prepared=Buffer.from(text.replace(old,'const fixtureNode = '+JSON.stringify(nodeExecutable))),rows=[];
 fs.mkdirSync(outputRoot,{mode:0o700});
 try{
  for(const {pin,raw} of supplied.files){const relative=pin.path.slice('source/'.length),out=path.join(outputRoot,relative),b=pin.path===changed?prepared:raw;fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.writeFileSync(out,b,{flag:'wx',mode:0o600});const p={path:relative,bytes:b.length,sha256:hash(b)};exact(out,p);rows.push(p);}
  const vector=path.join(outputRoot,'PUBLIC_VECTOR.json');fs.writeFileSync(vector,supplied.vector.raw,{flag:'wx',mode:0o600});exact(vector,supplied.vector);readR227PublicationResultSupply();
  return Object.freeze({supplierHandoff:r227SupplierPin,outputRoot,nodeExecutable,files:rows,publicVector:vector,testOnlyNodeConstant:{path:changed,replacements:1,originalSHA256:entry.pin.sha256,preparedSHA256:hash(prepared)},originalProductionUnchanged:true,staged:true,dataOnly:true,GoExecuted:false,NodeExecuted:false,Root:false,Source13:false,production:false,oldFullPinned28_63FailureResolved:false});
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
