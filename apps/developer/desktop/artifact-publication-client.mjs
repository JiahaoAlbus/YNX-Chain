import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = code => Object.assign(Error('The selected project artifact requires a fresh publication review.'), {code});
// Local snapshot freshness only. These fields are not a signed project role.
const projectKeys = ['generation','localProjectId','workspace','launch'];
const same = (a,b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;
const unchanged = (a,b) => same(a,b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const text = value => typeof value === 'string' && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

// Same fixed Node-only SDK for codec, DATA reference and protected constructor.
// This is deliberately not a CurrentProject/Publisher factory or an AI lease.
export async function openBundledOriginalPublicationArtifact({selection,actualEntryURL}){
  const metadataURL=new URL('../../../packages/wallet-auth/package.json',import.meta.url);
  const metadata=JSON.parse(await fs.readFile(metadataURL,'utf8'));
  if(metadata.name!=='@ynx-chain/wallet-auth')throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_UNAVAILABLE');
  const root=await fs.realpath(path.dirname(fileURLToPath(metadataURL))),sdk=createRequire(metadataURL);
  const load=async specifier=>{const target=await fs.realpath(sdk.resolve('@ynx-chain/wallet-auth/'+specifier));if(!target.startsWith(root+path.sep))throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_UNAVAILABLE');return import(pathToFileURL(target).href);};
  const [original,codec]=await Promise.all([load('original-ide-admission'),load('ide-artifact-manifest')]);
  return captureOriginalPublicationArtifact({selection,actualEntryURL,api:{
    encodeIDEArtifactManifestData:codec.encodeIDEArtifactManifestData,
    captureOriginalIDEPublicationArtifact:original.captureOriginalIDEPublicationArtifact,
    readOriginalIDEPublicationArtifactManifest:original.readOriginalIDEPublicationArtifactManifest,
    closeOriginalIDEPublicationArtifact:original.closeOriginalIDEPublicationArtifact,
    acquireOriginalIDEProtectedPublicationKeyCall:original.acquireOriginalIDEProtectedPublicationKeyCall,
  }});
}

// Backend custody only. Return cleanup custody BEFORE any later current/read
// check, including when Native capture throws false/undefined or returns null.
// No opaque reference or protected owner may cross the renderer DATA boundary.
export async function captureOriginalPublicationArtifact({selection,actualEntryURL,api}){
  const names=['encodeIDEArtifactManifestData','captureOriginalIDEPublicationArtifact','readOriginalIDEPublicationArtifactManifest','closeOriginalIDEPublicationArtifact','acquireOriginalIDEProtectedPublicationKeyCall'];
  if(names.some(name=>typeof api?.[name]!=='function')||typeof selection?.encodeManifest!=='function'||typeof selection?.assertCurrent!=='function'||typeof selection?.artifactBytes!=='function')throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_UNAVAILABLE');
  const encoded=await selection.encodeManifest(api.encodeIDEArtifactManifestData);
  const canonical=new TextDecoder('utf-8',{fatal:true}).decode(encoded);
  let reference,retired=false,failed=false,firstCause,cleanupSelected=false,cleanupComplete=false,cleanupFailed=false,cleanupCause;
  const remember=cause=>{if(!failed){failed=true;firstCause=cause;}return firstCause;};
  const live=()=>{if(retired)throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_RETIRED');if(failed)throw firstCause;};
  try{reference=api.captureOriginalIDEPublicationArtifact(canonical,Uint8Array.from(selection.artifactBytes()));if(reference===null||reference===undefined)throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_UNAVAILABLE');}catch(cause){remember(cause);}
  async function current(){
    live();
    try{await selection.assertCurrent();live();if(api.readOriginalIDEPublicationArtifactManifest(reference)!==canonical)throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_INVALID');live();return selection.binding;}
    catch(cause){throw remember(cause);}
  }
  return Object.freeze({
    assertCurrent:current,
    async acquireProtectedKeyCall(){
      live();
      // Canonical CurrentProject/Publisher consumption is still missing. A DATA
      // artifact, local UUID or former AI lease cannot select this constructor.
      throw reject('IDE_PUBLICATION_NOT_SUPPLIED');
    },
    close(){
      retired=true;
      if(cleanupSelected){if(cleanupFailed)throw cleanupCause;return cleanupComplete;}
      cleanupSelected=true;
      try{if(reference!==null&&reference!==undefined&&api.closeOriginalIDEPublicationArtifact(reference)!==true)throw reject('IDE_ARTIFACT_ORIGINAL_CAPTURE_CLOSE_INVALID');cleanupComplete=true;return true;}
      catch(cause){cleanupFailed=true;cleanupCause=cause;throw cause;}
    },
    status(){return Object.freeze({captured:reference!==null&&reference!==undefined,retired,firstCausePresent:failed,cleanupSelected,cleanupComplete,keyCallSelected:false});},
    authority:'artifact-data-only',signingApproved:false,deploymentApproved:false,
  });
}

// The paired package must supply the original Cloud SDK at its fixed source
// role. No cwd, environment, renderer path or same-origin substitute is used.
export async function openBundledArtifactPublicationObservation(options){
  const metadataURL=new URL('../../cloud/sdk/package.json',import.meta.url);
  const metadata=JSON.parse(await fs.readFile(metadataURL,'utf8'));
  if(metadata.name!=='@ynx/cloud-client'||!metadata.exports?.['./observe-ide-deployment'])throw reject('IDE_ARTIFACT_CLOUD_NOT_SUPPLIED');
  const root=await fs.realpath(path.dirname(fileURLToPath(metadataURL))),original=createRequire(metadataURL);
  const resolve=async specifier=>{const target=await fs.realpath(original.resolve(specifier));if(!target.startsWith(root+path.sep))throw reject('IDE_ARTIFACT_CLOUD_NOT_SUPPLIED');return pathToFileURL(target).href;};
  const {YNXCloudClient}=await import(await resolve('@ynx/cloud-client'));
  const {observeIDEDeployment}=await import(await resolve('@ynx/cloud-client/observe-ide-deployment'));
  const {openPublicationObservation}=await import('./artifact-publication-lifecycle.mjs');
  return openPublicationObservation({...options,CloudClient:YNXCloudClient,observeIDEDeployment});
}

// Local file/snapshot DATA only. Its localProjectId is not a canonical signed
// publication identity. The missing original project supplier must be resolved
// before manifest encoding or protected-key selection can be enabled.
export async function capturePublicationArtifact({context, localProjectSnapshot, artifactPath, version, publishPurpose, targetEnvironment, signal, now = Date.now}) {
  if(typeof localProjectSnapshot?.assertCurrent!=='function')throw reject('IDE_PUBLICATION_NOT_SUPPLIED');
  if (!context?.workspace || !path.isAbsolute(context.workspace) || path.resolve(context.workspace) !== context.workspace || typeof artifactPath !== 'string' || !path.isAbsolute(artifactPath) || ![version,publishPurpose,targetEnvironment].every(text)) throw reject('IDE_ARTIFACT_SELECTION_INVALID');
  const workspace = context.workspace;
  const selected = path.resolve(artifactPath);
  const relative = path.relative(workspace, selected);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw reject('IDE_ARTIFACT_OUTSIDE_PROJECT');
  let captured, deadline;
  async function current() {
    signal?.throwIfAborted();
    const state = await localProjectSnapshot.assertCurrent();
    signal?.throwIfAborted();
    if (!state || projectKeys.some(key => state[key] === undefined) || state.workspace !== workspace || !text(state.localProjectId) || !Number.isSafeInteger(state.generation) || state.generation < 0 || !Number.isFinite(state.expiresAt) || state.expiresAt <= now()) throw reject('IDE_ARTIFACT_PROJECT_RETIRED');
    if (captured && (projectKeys.some(key => captured[key] !== state[key]) || state.expiresAt < deadline || now() >= deadline)) throw reject('IDE_ARTIFACT_PROJECT_RETIRED');
    if (!captured) { captured = Object.freeze(Object.fromEntries(projectKeys.map(key=>[key,state[key]]))); deadline = state.expiresAt; }
  }
  await current();
  const parents = [];
  for (let directory = path.dirname(selected);; directory = path.dirname(directory)) {
    const stat = await fs.lstat(directory, {bigint:true});
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw reject('IDE_ARTIFACT_PATH_CHANGED');
    parents.push({directory,stat});
    if (directory === workspace) break;
  }
  async function pathsCurrent() {
    for (const {directory,stat} of parents) {
      const next = await fs.lstat(directory,{bigint:true});
      if (!next.isDirectory() || next.isSymbolicLink() || !same(stat,next) || await fs.realpath(directory) !== directory) throw reject('IDE_ARTIFACT_PATH_CHANGED');
    }
  }
  async function readSelected() {
    await current(); await pathsCurrent();
    const file = await fs.open(selected, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat({bigint:true});
      if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid()) || before.size < 1n || before.size > 67108864n) throw reject('IDE_ARTIFACT_FILE_INVALID');
      // Read at most the already checked size plus one; readFile() would let a
      // concurrent writer grow the allocation beyond the deployment ceiling.
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let length = 0;
      while (length < bytes.length) { signal?.throwIfAborted(); const read = await file.read(bytes,length,bytes.length-length,null); if (!read.bytesRead) break; length += read.bytesRead; }
      const after = await file.stat({bigint:true}), named = await fs.lstat(selected,{bigint:true});
      await pathsCurrent(); await current();
      if (!unchanged(before,after) || !unchanged(after,named) || named.isSymbolicLink() || named.nlink !== 1n || BigInt(length) !== before.size) throw reject('IDE_ARTIFACT_FILE_CHANGED');
      return {bytes:Buffer.from(bytes.subarray(0,length)),stat:after};
    } finally { await file.close(); }
  }
  const original = await readSelected();
  const binding = Object.freeze({localProjectId:captured.localProjectId,version,contentDigest:digest(original.bytes),publishPurpose,targetEnvironment,byteSize:original.bytes.length});
  async function assertCurrent() {
    const latest = await readSelected();
    if (!unchanged(original.stat,latest.stat) || digest(latest.bytes) !== binding.contentDigest) throw reject('IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED');
    return binding;
  }
  return Object.freeze({
    binding,
    assertCurrent,
    // Each accessor returns a copy, never the private approved backing buffer.
    artifactBytes() { return Uint8Array.from(original.bytes); },
    async encodeManifest() {
      await assertCurrent();
      // This local snapshot has no canonical publication project identity.
      // Do not invoke even an original codec with a guessed projectId.
      throw reject('IDE_PUBLICATION_NOT_SUPPLIED');
    },
    authority:'artifact-data-only',
    signingApproved:false,
    deploymentApproved:false,
  });
}
