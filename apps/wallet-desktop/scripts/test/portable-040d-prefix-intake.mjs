// Finite CI intake of the actually generated040 normal prefix/root6/full2.
// Reads fixed fixture names + actual checkout/npmci bytes; no OUT access, no
// Root provider/native build/fixture source fabrication or package writes.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{fileURLToPath}from'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),fixture=path.join(here,'fixtures/portable-040d-runtime'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function intakePortable040NormalPrefixDATA(checkout,destination){
 const info=JSON.parse(fs.readFileSync(path.join(fixture,'fixture-info.json')));const files=new Map();
 for(const row of info.files){if(typeof row.fixture!=='string'||path.posix.normalize(row.fixture)!==row.fixture||row.fixture.startsWith('/')||row.fixture.split('/').includes('..'))throw Error('PORTABLE_CI_FIXTURE_PATH');const b=fs.readFileSync(path.join(fixture,row.fixture));if(b.length!==row.bytes||hash(b)!==row.sha256)throw Error('PORTABLE_CI_FIXTURE_PIN');files.set(row.fixture,b);}
 const inventory=JSON.parse(files.get('prefix-inventory.json')),expectedSource=new Map(inventory.files.filter(x=>!x.path.startsWith('node_modules/')).map(x=>[x.path,x])),pkg=path.join(checkout,'packages/wallet-auth');
 const sourceNames=[];function walk(dir,prefix=''){for(const n of fs.readdirSync(dir).sort()){if(!prefix&&n==='node_modules')continue;const rel=prefix?prefix+'/'+n:n,p=path.join(dir,n),s=fs.lstatSync(p);if(s.isDirectory())walk(p,rel);else{if(!s.isFile()||s.isSymbolicLink())throw Error('PORTABLE_CI_SOURCE_NOT_REGULAR');sourceNames.push(rel);}}}walk(pkg);
 // Two generated full Native slots may be present after a normal Source intake.
 // They never silently replace the original prefix inventory rows.
 const fullNames=['native/original-ide-auth-runtime-manifest.json','native/original-ide-contract-relay-runtime-manifest.json'];for(const [name,key]of[[fullNames[0],'full-auth.json'],[fullNames[1],'full-union.json']]){const p=path.join(pkg,name);if(fs.existsSync(p)&&!fs.readFileSync(p).equals(files.get(key)))throw Error('PORTABLE_CI_EXISTING_FULL_SLOT_DIFFERS');}
 if(JSON.stringify(sourceNames.filter(n=>!fullNames.includes(n)).sort())!==JSON.stringify([...expectedSource.keys()].sort()))throw Error('PORTABLE_CI_SOURCE_SET_DIFFERS');
 fs.mkdirSync(path.join(destination,'packages/wallet-auth'),{recursive:true});const targetPkg=path.join(destination,'packages/wallet-auth');
 for(const row of inventory.files){const relative=row.path;if(typeof relative!=='string'||path.posix.normalize(relative)!==relative||relative.startsWith('/')||relative.split('/').includes('..'))throw Error('PORTABLE_CI_SOURCE_PATH');const original=path.join(pkg,relative);let b,mode;
  if(relative==='node_modules/.package-lock.json'){b=files.get('supplier-installed-lock.json');mode=0o644;}
  else{const s=fs.statSync(original);if(!s.isFile()||s.size!==row.bytes||s.size>16777216)throw Error('PORTABLE_CI_INPUT_SIZE:'+relative);b=fs.readFileSync(original);mode=s.mode&0o777;if(/^native\/vendor\/runtime-inputs\/(libssl\.3|libcrypto\.3|libuv\.1)\.dylib$/.test(relative)&&mode!==0o755)throw Error('PORTABLE_CI_RUNTIME_INPUT_MODE');}
  if(b.length!==row.bytes||hash(b)!==row.sha256)throw Error('PORTABLE_CI_ACTUAL_INPUT_PIN:'+relative);const target=path.join(targetPkg,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b,{flag:'wx',mode});
 }
 for(const [name,key]of[[fullNames[0],'full-auth.json'],[fullNames[1],'full-union.json']])fs.writeFileSync(path.join(targetPkg,name),files.get(key),{flag:'wx'});
 const product=path.join(destination,'runtime-projections/sdk49-product');fs.mkdirSync(product,{recursive:true});for(const [name,b]of files)if(name.startsWith('product/'))fs.writeFileSync(path.join(product,name.slice(8)),b,{flag:'wx'});
 const actualInstalledLock=fs.readFileSync(path.join(pkg,'node_modules/.package-lock.json'));return {supplierInstalledLockDATA:true,checkoutInstalledLock:{bytes:actualInstalledLock.length,sha256:hash(actualInstalledLock),sameAsSupplierFixture:actualInstalledLock.equals(files.get('supplier-installed-lock.json'))},pkg:targetPkg,inventoryRaw:files.get('prefix-inventory.json'),fullAuth:files.get('full-auth.json'),fullUnion:files.get('full-union.json'),sourceCommit:info.sourceCommit,sourceOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,NativeCompiled:false,installed:false};
}
