import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = code => Object.assign(Error('The selected project artifact requires a fresh publication review.'), {code});
const projectKeys = ['owner','workspaceOwner','account','generation','identityReference','localProjectId','workspace','launch','sessionId'];
const same = (a,b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;
const unchanged = (a,b) => same(a,b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const text = value => typeof value === 'string' && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

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

// DATA preparation for the existing publication flow, not approval/signature
// authority. An immutable private byte snapshot prevents a pathname from being
// reopened as different bytes after approval. Auth/SDK own encoding, current
// permission, purpose key selection, approval, signing and independent verify.
export async function capturePublicationArtifact({context, admittedProject, artifactPath, version, publishPurpose, targetEnvironment, signal, now = Date.now}) {
  if (!context?.workspace || !path.isAbsolute(context.workspace) || path.resolve(context.workspace) !== context.workspace || typeof artifactPath !== 'string' || !path.isAbsolute(artifactPath) || typeof admittedProject?.assertCurrent !== 'function' || ![version,publishPurpose,targetEnvironment].every(text)) throw reject('IDE_ARTIFACT_SELECTION_INVALID');
  const workspace = context.workspace;
  const selected = path.resolve(artifactPath);
  const relative = path.relative(workspace, selected);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw reject('IDE_ARTIFACT_OUTSIDE_PROJECT');
  let captured, deadline;
  async function current() {
    signal?.throwIfAborted();
    const state = await admittedProject.assertCurrent();
    signal?.throwIfAborted();
    if (!state || projectKeys.some(key => state[key] === undefined) || state.workspace !== workspace || !text(state.localProjectId) || !Number.isSafeInteger(state.generation) || state.generation < 0 || !Number.isFinite(state.expiresAt) || state.expiresAt <= now()) throw reject('IDE_ARTIFACT_PROJECT_RETIRED');
    if (captured && (projectKeys.some(key => captured[key] !== state[key]) || state.expiresAt < deadline || now() >= deadline)) throw reject('IDE_ARTIFACT_PROJECT_RETIRED');
    if (!captured) { captured = Object.freeze({...state}); deadline = state.expiresAt; }
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
  const binding = Object.freeze({projectId:captured.localProjectId,version,contentDigest:digest(original.bytes),publishPurpose,targetEnvironment,byteSize:original.bytes.length});
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
    async encodeManifest(originalEncoder) {
      await assertCurrent();
      if (typeof originalEncoder !== 'function') throw reject('IDE_ARTIFACT_ORIGINAL_CODEC_UNAVAILABLE');
      const encoded = await originalEncoder(binding);
      const raw = typeof encoded === 'string' ? Buffer.from(encoded,'utf8') : encoded instanceof Uint8Array ? Buffer.from(encoded) : null;
      if (!raw || !raw.length || raw.length > 16384) throw reject('IDE_ARTIFACT_ORIGINAL_CODEC_INVALID');
      const parsed = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      if (!parsed || Object.keys(parsed).sort().join() !== Object.keys(binding).sort().join() || Object.keys(binding).some(key => parsed[key] !== binding[key])) throw reject('IDE_ARTIFACT_ORIGINAL_CODEC_INVALID');
      await assertCurrent();
      return Uint8Array.from(raw);
    },
    authority:'artifact-data-only',
    signingApproved:false,
    deploymentApproved:false,
  });
}
