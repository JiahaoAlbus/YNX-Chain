import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const expectedRoot='/Volumes/西部数据/YNX-large-work/wallet-sdk49-product-successor-20261026';
const supply='/Volumes/西部数据/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-pq-device-session/runtime-r2/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=message=>{throw Error(message);};
function pinned(file,reference){const before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||fs.realpathSync(file)!==file)fail('SDK49_SOURCE_NOT_REGULAR');const bytes=fs.readFileSync(file),after=fs.lstatSync(file);if(bytes.length!==reference.bytes||hash(bytes)!==reference.sha256||['dev','ino','size','mode','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))fail('SDK49_SOURCE_PIN_DIFFERS');return bytes;}
function relative(name){if(typeof name!=='string'||!name||path.posix.normalize(name)!==name||path.isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>p==='..'||p==='.'||!p))fail('SDK49_SOURCE_PATH_INVALID');return name;}
function put(destination,raw,mode=0o644){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,raw,{flag:'wx',mode});}
function files(directory,prefix=''){return fs.readdirSync(path.join(directory,prefix),{withFileTypes:true}).flatMap(entry=>{const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())return files(directory,name);if(!entry.isFile())fail('SDK49_SOURCE_FOREIGN_ENTRY');return[name];}).sort();}
if(root.replace(/\/$/,'')!==expectedRoot||fs.realpathSync(expectedRoot)!==expectedRoot)fail('SDK49_EXCLUSIVE_SUCCESSOR_ROOT_REQUIRED');
const git=(...args)=>execFileSync('git',args,{cwd:expectedRoot,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!=='8d232f59c0e95f62bd91330dd2fbd872b02b6000'||git('status','--porcelain','--untracked-files=no')!=='')fail('SDK49_PRISTINE_SUCCESSOR_REQUIRED');
const handoff=JSON.parse(pinned(supply+'SDK49_PQ_DEVICE_SESSION_RUNTIME_HANDOFF.json',{bytes:25649,sha256:'7550e5ae567e139abf75d1178d0a6b4f376f65c4626d2a25e266501bdf8582cb'}));
const inventory=JSON.parse(pinned(handoff.normalPrefix.inventory.path,handoff.normalPrefix.inventory));
if(handoff.sourceCommit!=='afa53c4dddba6bb9e06b6619dea45af189978fb6'||inventory.versionSDK!=='1.3.0-pq.3.32-auth.49'||inventory.files.length!==9606)fail('SDK49_FORMAL_SOURCE_ROLE_REQUIRED');
const prefix=handoff.prefix;if(JSON.stringify(files(prefix))!==JSON.stringify(inventory.files.map(row=>relative(row.path)).sort()))fail('SDK49_FULL_PREFIX_SET_DIFFERS');
for(const row of inventory.files)pinned(path.join(prefix,row.path),row);
const target=path.join(expectedRoot,'packages/wallet-auth'),backup=expectedRoot+'-sdk46-pristine-preserved';
if(fs.existsSync(backup))fail('SDK49_PRESERVED_PARENT_ALREADY_EXISTS');
fs.renameSync(target,backup); // Only this new pristine worktree's SDK; recoverable.
fs.mkdirSync(target);
for(const row of inventory.files){const input=path.join(prefix,row.path);put(path.join(target,row.path),pinned(input,row),fs.statSync(input).mode&0o777);}
if(JSON.stringify(files(target))!==JSON.stringify(inventory.files.map(row=>row.path).sort()))fail('SDK49_MATERIALIZED_SET_DIFFERS');
for(const row of inventory.files)pinned(path.join(target,row.path),row);
const cas=JSON.parse(pinned(supply+'SDK49_FORMAL_SOURCE_ROLES_CAS_ADDENDUM.json',{bytes:16835,sha256:'9f9d307cc61a460aa92342ad8a62c06bd340fa5c6566e9e92ca0c4b9b661eae0'}));
const roleRows=[...cas.fullNormalSourceRoles,...cas.newFormalPrimaryProductSourceSlots,cas.requiredSixthPolicySlot,...cas.fullMatchingAppSourceRoles];
for(const row of roleRows){
 const destination=path.join(expectedRoot,relative(row.sourceSlot)),raw=pinned(row.replacement.path,row.replacement);
 if(fs.existsSync(destination)){
  const old=fs.readFileSync(destination);if(old.equals(raw))continue;
  if(!row.sourceSlot.startsWith('apps/wallet-desktop/'))fail('SDK49_EXISTING_ROLE_DIFFERS');
  const original=execFileSync('git',['show','HEAD:'+row.sourceSlot],{cwd:expectedRoot});if(!old.equals(original))fail('SDK49_APP_ROLE_NOT_PRISTINE');
  const saved=path.join(backup,'outside-package',row.sourceSlot);put(saved,old);fs.renameSync(destination,destination+'.sdk49-original-preserved');
  put(destination,raw); // Original bytes remain beside it and in backup.
 }else put(destination,raw);
}
const receipt={kind:'YNX_WALLET_SDK49_SUCCESSOR_SOURCE_ASSEMBLY/v1',root:expectedRoot,parent:'8d232f59c0e95f62bd91330dd2fbd872b02b6000',SDKCommit:handoff.sourceCommit,normalPrefixFiles:9606,normalPrefixVerifiedBeforeAndAfter:true,originalSDKPreserved:backup,formalRoleRows:roleRows.length,NativeBuilt:false,AppBuilt:false,installed:false,keysOrAccountsTouched:false};
const output=path.join(expectedRoot,'SDK49_SOURCE_ASSEMBLY.json');put(output,Buffer.from(JSON.stringify(receipt,null,2)+'\n'));console.log(JSON.stringify(receipt));
