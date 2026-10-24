// CI PUBLIC fixture delta only; immutable R229 baseline remains owned there.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {readR229FactorySupply,r229SupplierPin} from './auth-r229-factory-supply.mjs';
const fixture=fileURLToPath(new URL('./fixtures/auth-r231-go-source/',import.meta.url));
export const r231SupplierPin=Object.freeze({bytes:32674,sha256:'180fcc139b3fd5fe060bb51055ded1d812dada9cb128db65c430ab1acea1ff2f'});
const firstCIPin=Object.freeze({bytes:6762,sha256:'f32de2fbaff9c54844e8ed96e3126736dd9603ba1c13d3b8db3d407fcc71d20f'});
const hash=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})};
const old='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"';
function canonical(p,dir=false){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('R231_PATH');for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('R231_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(p)!==p||dir&&!fs.lstatSync(p).isDirectory())fail('R231_PATH');}
function exact(file,pin){canonical(file);const st=fs.lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('R231_PIN');const raw=fs.readFileSync(file);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('R231_PIN');return raw;}
const same=(a,b)=>a?.bytes===b?.bytes&&a?.sha256===b?.sha256;
const leaf=p=>typeof p==='string'&&/^source\/internal\/developerauthority\/[a-z0-9_]+\.go$/.test(p);
export function readR231RuntimeSupply(){
 canonical(path.resolve(fixture),true);
 const h=JSON.parse(exact(path.join(fixture,'SUPPLIER_HANDOFF.json'),r231SupplierPin));
 if(h.sourceClosureGo!==53||h.sourceDelta?.length!==4||h.refs?.length!==66||!same(h.parent,r229SupplierPin)||!same(h.firstCI,firstCIPin)||h.truth.Source13!==false||h.truth.resourceProducer!==false||h.truth.Root!==false||h.truth.deployed!==false)fail('R231_SUPPLY');
 const full=h.refs.filter(p=>leaf(p.relative));if(full.length!==53||new Set(full.map(p=>p.relative)).size!==53||h.sourceDelta.some(p=>!leaf(p.relative))||new Set(h.sourceDelta.map(p=>p.relative)).size!==4)fail('R231_SCOPE');
 const expected=['SUPPLIER_HANDOFF.json','PINS.json',...h.sourceDelta.map(p=>p.relative)].sort(),actual=[];
 function visit(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),st=fs.lstatSync(file),rel=path.relative(fixture,file).split(path.sep).join('/');if(st.isSymbolicLink())fail('R231_SYMLINK');if(st.isDirectory()){if(!expected.some(p=>p.startsWith(rel+'/')))fail('R231_EXTRA');visit(file);}else{if(!st.isFile())fail('R231_PIN');actual.push(rel);if(actual.length>6)fail('R231_EXTRA');}}}visit(fixture);if(JSON.stringify(actual.sort())!==JSON.stringify(expected))fail('R231_EXTRA');
 const deltaRows=h.sourceDelta.map(p=>({path:p.relative,bytes:p.bytes,sha256:p.sha256,parent:p.parent?{bytes:p.parent.bytes,sha256:p.parent.sha256}:null})),pins=JSON.parse(fs.readFileSync(path.join(fixture,'PINS.json'),'utf8'));
 if(pins.kind!=='YNX-R231-PUBLIC-GO-DELTA-FIXTURE/v1'||pins.PUBLIC!==true||pins.Source13!==false||pins.Root!==false||pins.production!==false||!same(pins.supplierHandoff,r231SupplierPin)||!same(pins.parent,r229SupplierPin)||!same(pins.firstCI,firstCIPin)||JSON.stringify(pins.files)!==JSON.stringify(deltaRows))fail('R231_PINS');
 const baseline=readR229FactorySupply(),base=new Map(baseline.files.map(p=>[p.pin.path,p])),delta=new Map(h.sourceDelta.map(p=>[p.relative,p]));
 let replaced=0,added=0;
 const files=full.map(p=>{
  const before=base.get(p.relative),change=delta.get(p.relative);let raw;
  if(change){if(!same(p,change)||before&&!same(before.pin,change.parent)||!before&&change.parent)fail('R231_PARENT_CAS');raw=exact(path.join(fixture,p.relative),change);before?replaced++:added++;}
  else{if(!before||!same(before.pin,p))fail('R231_UNDECLARED_DELTA');raw=before.raw;}
  return {pin:{path:p.relative,bytes:p.bytes,sha256:p.sha256},raw};
 });
 if(replaced!==3||added!==1||baseline.files.some(p=>!full.some(x=>x.relative===p.pin.path)))fail('R231_BASELINE_REMOVED');
 return {fixture:path.resolve(fixture),files,baselineSupplier:r229SupplierPin,delta:deltaRows,firstCI:firstCIPin};
}
export function stageR231RuntimeSupply({outputRoot,nodeExecutable}){
 const supplied=readR231RuntimeSupply();
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot)fail('R231_OUTPUT_PATH');
 canonical(path.dirname(outputRoot),true);
 if(outputRoot===supplied.fixture||outputRoot.startsWith(supplied.fixture+path.sep))fail('R231_OUTPUT_PATH');
 canonical(nodeExecutable);if(nodeExecutable!==fs.realpathSync(process.execPath)||!fs.lstatSync(nodeExecutable).isFile())fail('R231_NODE');fs.accessSync(nodeExecutable,fs.constants.X_OK);
 const changed='source/internal/developerauthority/original_source_process_test.go',entry=supplied.files.find(p=>p.pin.path===changed),text=new TextDecoder('utf-8',{fatal:true}).decode(entry.raw);
 if(text.split(old).length!==2||!text.split(/\r?\n/).includes(old))fail('R231_NODE_CONSTANT');
 const prepared=Buffer.from(text.replace(old,'const fixtureNode = '+JSON.stringify(nodeExecutable))),rows=[];
 fs.mkdirSync(outputRoot,{mode:0o700});
 try{
  for(const {pin,raw}of supplied.files){const relative=pin.path.slice('source/'.length),out=path.join(outputRoot,relative),b=pin.path===changed?prepared:raw;fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.writeFileSync(out,b,{flag:'wx',mode:0o600});const row={path:relative,bytes:b.length,sha256:hash(b)};exact(out,row);rows.push(row);}
  readR231RuntimeSupply();
  return Object.freeze({supplierHandoff:r231SupplierPin,baselineSupplier:r229SupplierPin,firstCI:firstCIPin,delta:supplied.delta,outputRoot,nodeExecutable,files:rows,testOnlyNodeConstant:{path:changed,replacements:1,originalSHA256:entry.pin.sha256,preparedSHA256:hash(prepared)},originalProductionUnchanged:true,staged:true,dataOnly:true,GoExecuted:false,NodeExecuted:false,Root:false,Source13:false,resourceProducer:false,production:false,originalR229FailurePreserved:true,oldFullPinned28_63FailureResolved:false});
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
