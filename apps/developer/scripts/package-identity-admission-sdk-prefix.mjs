import { readFile, writeFile, mkdir, lstat, realpath, copyFile } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, posix } from 'node:path';
const digest = async path => { const h=createHash('sha256');for await(const bytes of createReadStream(path))h.update(bytes);return h.digest('hex'); };
async function jsonPin(pin) {
  const s=await lstat(pin.path);
  if(!s.isFile()||s.isSymbolicLink()||await realpath(pin.path)!==pin.path||s.size!==pin.bytes)throw Error('SDK prefix metadata changed');
  const bytes=await readFile(pin.path);
  if(bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('SDK prefix metadata changed');
  return JSON.parse(bytes);
}
// Artifact copying only: no SDK import, Native call, storage or Root authority.
export async function copyPinnedSDKPrefix({destination,prefix,files,sourceCommit}) {
  if(resolve(destination)!==destination||!destination.endsWith('/vendor/identity-admission')||await realpath(prefix)!==prefix)throw Error('Exact normal SDK prefix paths required');
  const seen=new Set();
  for(const file of files) {
    if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\')||posix.normalize(file.path)!==file.path||file.path.split('/').includes('..')||seen.has(file.path)||!Number.isSafeInteger(file.bytes)||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid SDK prefix inventory');
    seen.add(file.path);
  }
  await mkdir(dirname(destination),{recursive:true});await mkdir(destination);
  for(const file of files) {
    const from=join(prefix,file.path),to=join(destination,file.path),s=await lstat(from);
    if(!s.isFile()||s.isSymbolicLink()||await realpath(from)!==from||s.size!==file.bytes||await digest(from)!==file.sha256)throw Error('Normal SDK prefix source differs: '+file.path);
    await mkdir(dirname(to),{recursive:true});await copyFile(from,to,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);
    if(await digest(to)!==file.sha256)throw Error('Copied normal SDK prefix differs: '+file.path);
  }
  // Keep integrity data outside the supplier prefix. Code/manifests remain
  // byte-identical under codesign; Native image integrity is the SDK's own
  // fixed pre-load guard, never a consumer-generated authority assertion.
  const code=files.filter(file=>/\.(?:[cm]?js|json|wasm)$/.test(file.path));
  await writeFile(join(dirname(dirname(destination)),'identity-sdk-pins.json'),JSON.stringify({schema:'YNX_IDE_SDK_CODE_PINS/v1',SDKSourceCommit:sourceCommit,files:code})+'\n',{flag:'wx'});
  return {schema:'YNX_IDE_NORMAL_SDK_PREFIX_DISTRIBUTION/v1',SDKSourceCommit:sourceCommit,sourceLeaves:files.length,sharedModulesExecuted:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
}
export async function copyNormalIdentityAdmissionPrefix(destination,planPath) {
  const plan=JSON.parse(await readFile(planPath));
  if(plan.schema==='YNX_IDE_CURRENT_PRODUCT_QA_LINK_PLAN/v1'){
    if(plan.SDKHandoff?.bytes!==3418||plan.SDKHandoff.sha256!=='1da803cf12b5be86bfb3769133a45ce88230928c77be912566631802655a44c5')throw Error('Exact current SDK resource handoff required');
    const resource=await jsonPin(plan.SDKHandoff),inventory=await jsonPin(resource.completePrefix);
    if(inventory.schema!=='ynx-complete-normal-sdk-prefix/v1'||inventory.sourceCommit!==plan.SDKSourceCommit||inventory.sourceCommit!=='60eca7260c6c326170c7d45e7b13b58f03147446'||inventory.files.length!==10095||inventory.prefix!==join(dirname(plan.SDKHandoff.path),'supplier-probe-prefix'))throw Error('Current complete physical SDK graph differs');
    const result=await copyPinnedSDKPrefix({destination,prefix:inventory.prefix,files:inventory.files,sourceCommit:inventory.sourceCommit});
    return {...result,manifestSha256:resource.completePrefix.sha256,compiledSourceCommit:plan.compiledSource.commit};
  }
  const expected={bytes:5467,sha256:'d467ade5e87f1aaaadd5641ee0a2e5e0f8f0fc1573aaddd1a58b21039a5193d7'};
  if(plan.schema!=='YNX_IDE_NORMAL_COCOA_LINK_PLAN/v1'||plan.SDKSourceCommit!=='8edbfc57e2beb91b58360ae781d5c39ef1d56950'||plan.SDKHandoff?.bytes!==expected.bytes||plan.SDKHandoff?.sha256!==expected.sha256)throw Error('Matching whole SDK plan required');
  const sdk=await jsonPin(plan.SDKHandoff),inventory=await jsonPin(sdk.completePrefix);
  if(inventory.schema!=='ynx-complete-normal-sdk-prefix/v1'||inventory.sourceCommit!==plan.SDKSourceCommit||sdk.source.commit!==plan.SDKSourceCommit||inventory.files.length!==sdk.counts.sourcePrefix||inventory.prefix!==join(dirname(plan.SDKHandoff.path),'source/packages/wallet-auth'))throw Error('Complete normal SDK input differs');
  const result=await copyPinnedSDKPrefix({destination,prefix:inventory.prefix,files:inventory.files,sourceCommit:inventory.sourceCommit});
  return {...result,manifestSha256:sdk.completePrefix.sha256,parentFactoryExport:'acquireOriginalIDEAdmissionParentDelivery'};
}
