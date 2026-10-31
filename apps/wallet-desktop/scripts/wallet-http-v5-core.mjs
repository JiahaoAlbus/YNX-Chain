// Frozen component inputs for a NEW single-archive V5 role. Does not replace
// an old build role or establish Source, custody, App or installation status.
import path from 'node:path';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source='8d134c93d3f5500aea01cd0f0f5e88127d4dd37f';
const manifestPath=fileURLToPath(new URL('./wallet-http-v5-core-inputs.json',import.meta.url));
const fail=()=>{throw Error('WALLET_HTTP_V5_FROZEN_CORE_INPUT_DIFFERS');};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const regular=file=>{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||realpathSync(file)!==file)fail();return readFileSync(file);};
const raw=regular(manifestPath);
if(sha(raw)!=='a0ac1b9390678fddfca0a08bfa521c8313a819ee223dd5b59638cbc9009766a1')fail();
const pins=JSON.parse(raw);
if(pins.source!==source||pins.inputs.length!==7||pins.inputs.filter(p=>p.path.endsWith('.a')).length!==1||pins.normalAppCompiled!==false||pins.SourceAdmission!==false)fail();
export const HTTP_V5_CORE_INPUTS=Object.freeze(pins.inputs.map(p=>Object.freeze({...p})));
export const HTTP_V5_CORE_COMPONENT=Object.freeze({source,tree:pins.tree,platform:'darwin',arch:'arm64',run:pins.run,artifactId:pins.artifactId,
  inputs:HTTP_V5_CORE_INPUTS,SourceAdmission:false,RootAdmission:false,normalAppCompiled:false,installed:false});
export function assertHTTPV5CoreInputs(root){
  if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root)fail();
  const held=new Map();
  for(const pin of HTTP_V5_CORE_INPUTS){const bytes=regular(path.join(root,pin.path));if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail();held.set(path.basename(pin.path),bytes);}
  const original=JSON.parse(held.get('SOURCE.json'));
  if(original.commit!==source||original.sourceTree!==pins.tree||original.abi!=='YNXProductSessionHTTPProofSignV5'||original.RootAdmission!==false||original.SourceAdmission!==false)fail();
  for(const [name,pin]of Object.entries(original.files)){const bytes=held.get(name);if(!bytes||bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail();}
  const qualified=JSON.parse(held.get('QUALIFIED-COMPONENT.json'));
  if(qualified.source!==source||qualified.componentQualified!==true||qualified.archive.bytes!==11433080||qualified.archive.sha256!=='f078524c371648a284343d69496e4d37276f3a90bea220af7ef99e568e883c6a'||qualified.SourceAdmission!==false||qualified.AppInstalled!==false)fail();
  return HTTP_V5_CORE_COMPONENT;
}
export function assertHTTPV5CoreExports(text){
  if(typeof text!=='string')fail();
  // One archive must retain the ordinary and original device entry points.
  // This checks symbols only; it does not inherit their mathematical/runtime
  // qualification or make the frozen component a combined Wallet build.
  for(const name of ['YNXTransactionBatchSignV1','YNXAccountInitialSignV1','YNXProductSessionHTTPProofSignV4','YNXProductSessionHTTPProofSignV5','YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4','YNXProductSessionDeviceKeypairGenerateV4'])
    if(!text.split(/\r?\n/).some(line=>new RegExp('\\b[Tt]\\s+_'+name+'$').test(line.trim())))fail();
}
