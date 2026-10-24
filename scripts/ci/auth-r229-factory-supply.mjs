// PUBLIC fixture staging only. Does not execute Go/Node, keys, SQL or Source.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const fixture=path.resolve(fileURLToPath(new URL('./fixtures/auth-r229-go-source/',import.meta.url)));
export const r229SupplierPin=Object.freeze({bytes:32969,sha256:'d98c6681917487d57e2a3acb7e62d91cf0331dec0f46957992c09050e6b30b3a'});
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})};
const old='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"';
function canonical(p,dir=false){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('R229_PATH');for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('R229_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(p)!==p||dir&&!fs.lstatSync(p).isDirectory())fail('R229_PATH');}
function exact(file,pin){canonical(file);const s=fs.lstatSync(file);if(!s.isFile()||s.size!==pin.bytes)fail('R229_PIN');const raw=fs.readFileSync(file);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('R229_PIN');return raw;}
export function readR229FactorySupply(){
 canonical(fixture,true);const h=JSON.parse(exact(path.join(fixture,'SUPPLIER_HANDOFF.json'),r229SupplierPin));
 if(h.sourceClosureGo!==52||h.sourceDelta.length!==4||h.refs.length!==67||h.truth.completeSource13!==false||h.truth.Root!==false||h.truth.production!==false)fail('R229_SUPPLY');
 const files=h.refs.filter(r=>/^source\/internal\/developerauthority\/[a-z0-9_]+\.go$/.test(r.relative));
 if(files.length!==52||new Set(files.map(p=>p.relative)).size!==52)fail('R229_SCOPE');
 if(h.parent.bytes!==39645||h.parent.sha256!=='35fdc783b6371faf9246d1f4f94ef6c30659d022fc3e15ddcf05bd7ba20bf941'||h.truth.resourceApproval!==false||h.truth.registered!==false)fail('R229_PARENT_OR_AUTHORITY');
 const expected=['SUPPLIER_HANDOFF.json','PINS.json',...files.map(p=>p.relative)].sort(),actual=[];
 function visit(dir){for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p),rel=path.relative(fixture,p).split(path.sep).join('/');if(s.isSymbolicLink())fail('R229_SYMLINK');if(s.isDirectory()){if(!expected.some(x=>x.startsWith(rel+'/')))fail('R229_EXTRA');visit(p);}else{if(!s.isFile())fail('R229_PIN');actual.push(rel);if(actual.length>54)fail('R229_EXTRA');}}}visit(fixture);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R229_EXTRA');
 const rows=files.map(p=>({path:p.relative,bytes:p.bytes,sha256:p.sha256}));
 const pins=JSON.parse(fs.readFileSync(path.join(fixture,'PINS.json'),'utf8'));
 if(pins.kind!=='YNX-R229-PUBLIC-GO-FIXTURE/v1'||pins.PUBLIC!==true||pins.Source13!==false||pins.Root!==false||pins.production!==false||JSON.stringify(pins.supplierHandoff)!==JSON.stringify(r229SupplierPin)||JSON.stringify(pins.files)!==JSON.stringify(rows)||JSON.stringify(pins.parent)!==JSON.stringify(h.parent))fail('R229_PINS');
 const captured=rows.map(p=>({pin:p,raw:exact(path.join(fixture,p.path),p)}));
 return {fixture,files:captured};
}
/** Fresh exclusive test tree; only the inherited PUBLIC fixtureNode constant is
 * adapted to the actual running private Node. No production Go leaf changes.
 * Failure retains partial output and first cause; never retries/deletes it. */
export function stageR229FactorySupply({outputRoot,nodeExecutable}){
 const supplied=readR229FactorySupply();canonical(path.dirname(outputRoot),true);
 if(!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot||outputRoot===fixture||outputRoot.startsWith(fixture+path.sep))fail('R229_OUTPUT_PATH');
 canonical(nodeExecutable);if(nodeExecutable!==fs.realpathSync(process.execPath)||!fs.lstatSync(nodeExecutable).isFile())fail('R229_NODE');fs.accessSync(nodeExecutable,fs.constants.X_OK);
 const changed='source/internal/developerauthority/original_source_process_test.go',entry=supplied.files.find(p=>p.pin.path===changed),text=new TextDecoder('utf-8',{fatal:true}).decode(entry.raw);
 if(text.split(old).length!==2||!text.split(/\r?\n/).includes(old))fail('R229_NODE_CONSTANT');
 const prepared=Buffer.from(text.replace(old,'const fixtureNode = '+JSON.stringify(nodeExecutable))),rows=[];
 fs.mkdirSync(outputRoot,{mode:0o700});
 try{
  for(const {pin,raw} of supplied.files){const relative=pin.path.slice('source/'.length),out=path.join(outputRoot,relative),b=pin.path===changed?prepared:raw;fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.writeFileSync(out,b,{flag:'wx',mode:0o600});const p={path:relative,bytes:b.length,sha256:hash(b)};exact(out,p);rows.push(p);}
  readR229FactorySupply();
  return Object.freeze({supplierHandoff:r229SupplierPin,outputRoot,nodeExecutable,files:rows,testOnlyNodeConstant:{path:changed,replacements:1,originalSHA256:entry.pin.sha256,preparedSHA256:hash(prepared)},originalProductionUnchanged:true,staged:true,dataOnly:true,GoExecuted:false,NodeExecuted:false,Root:false,Source13:false,production:false,oldFullPinned28_63FailureResolved:false});
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
