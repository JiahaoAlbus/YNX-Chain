import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { fault } from './central-identity.mjs';

const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const bind = bytes => ({ bytes: String(bytes.length), sha3_512: digest(bytes, 'sha3-512'), sha512: digest(bytes, 'sha512') });
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const refKey = value => {
  if (!value || ['realm','tenant','kind','id','rev'].some(key => typeof value[key] !== 'string' || !value[key])) throw fault('A complete project reference is required.', 'build_project', 400);
  return JSON.stringify(['realm','tenant','kind','id','rev'].map(key => value[key]));
};
const scope = ctx => JSON.stringify([ctx.realm,ctx.tenant,ctx.actor,ctx.actorEpoch]);
const bytesOf = value => Buffer.from(JSON.stringify(value));

// This is a local artifact projection, never an authorization database. Every
// read and begin calls the original product authorization supplied by its owner.
// Only opaque handles from begin can finish jobs; late completions have no
// mutable "current artifact" pointer to overwrite.
export function createBuildCollection({ directory, authorize } = {}) {
  if (typeof directory !== 'string' || !directory.startsWith('/') || typeof authorize !== 'function') throw Error('Build collection needs a private directory and original authorization.');
  const handles = new WeakMap();
  const pathFor = job => {
    if (typeof job !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(job)) throw fault('Invalid build job.', 'build_job', 400);
    return join(directory, digest(Buffer.from(job), 'sha512'));
  };
  async function put(path, name, bytes) {
    const file = await open(join(path,name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  }
  async function read(path, limit = 8*1024*1024) {
    const file=await open(path,constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info=await file.stat();
      if(!info.isFile() || info.size>limit) throw fault('Build evidence is not a bounded regular file.','build_integrity',409);
      // Bound the actual read too: a concurrent writer cannot grow evidence
      // after stat into an unbounded allocation.
      const bytes=Buffer.alloc(info.size+1);let offset=0;
      while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
      if(offset!==info.size)throw fault('Build evidence changed while reading.','build_integrity',409);
      return bytes.subarray(0,offset);
    }
    finally { await file.close(); }
  }
  async function begin(ctx, { job = randomUUID(), project, gen, commit }) {
    refKey(project);
    if (!decimal(gen) || typeof commit !== 'string' || !commit || commit.length > 256 || ctx?.realm !== project.realm || ctx?.tenant !== project.tenant || !decimal(ctx?.actorEpoch)) throw fault('Invalid build binding.', 'build_binding', 400);
    await authorize(ctx, project, 'build');
    const path = pathFor(job);
    await mkdir(directory,{recursive:true,mode:0o700});
    await mkdir(path,{mode:0o700});
    const record = { job, project: structuredClone(project), gen, commit, scope:scope(ctx) };
    await put(path,'started.json',bytesOf(record));
    const handle = Object.freeze({job}); handles.set(handle,{record,path,finishing:false}); return handle;
  }
  async function complete(handle, { exit, artifact, toolchain, logs, cancelled = false }) {
    const entry = handles.get(handle);
    if (!entry || entry.finishing) throw fault('Build already ended or has no original job handle.', 'build_terminal', 409);
    entry.finishing = true;
    if (!Number.isInteger(exit) || typeof cancelled !== 'boolean') throw fault('Invalid tool exit.', 'build_exit', 400);
    const {record,path} = entry;
    const logBytes=bytesOf(logs ?? []);
    if(logBytes.length>4*1024*1024) throw fault('Build logs exceed the collection limit.', 'build_limit',413);
    await put(path,'logs.json',logBytes);
    // Failed/cancelled jobs retain diagnostic evidence but no artifact bytes.
    const terminal = {...record,exit,cancelled,logs:bind(logBytes)};
    if(exit===0 && !cancelled) {
      if(artifact===undefined || !toolchain || typeof toolchain!=='object') throw fault('Successful build needs actual artifact and toolchain evidence.', 'build_evidence',400);
      const artifactBytes=bytesOf(artifact), toolBytes=bytesOf(toolchain);
      if(artifactBytes.length>8*1024*1024 || toolBytes.length>128*1024) throw fault('Build evidence exceeds the collection limit.','build_limit',413);
      await put(path,'artifact.json',artifactBytes); await put(path,'toolchain.json',toolBytes);
      terminal.artifact=bind(artifactBytes); terminal.toolchain=bind(toolBytes);
    }
    // Written last with exclusive creation: crashes never expose partial builds.
    await put(path,'completed.json',bytesOf(terminal));
    const folder=await open(path,constants.O_RDONLY);try {await folder.sync();} finally {await folder.close();}
    return {job:record.job,exit,cancelled};
  }
  async function collectBuild(ctx, job, project, gen) {
    refKey(project); if(!decimal(gen)) throw fault('Invalid build generation.','build_binding',400);
    await authorize(ctx,project,'read-build');
    let record;
    try { record=JSON.parse((await read(join(pathFor(job),'completed.json'),65536)).toString('utf8')); }
    catch(error) { if(error.code==='ENOENT') throw fault('Build has not completed.','build_pending',409); throw error; }
    if(record.job!==job || refKey(record.project)!==refKey(project) || record.gen!==gen || record.scope!==scope(ctx)) throw fault('Build belongs to another project, generation or identity.','build_binding',403);
    if(record.exit!==0 || record.cancelled) throw fault('Failed or cancelled builds are not publishable artifacts.','build_failed',409);
    for(const [name,key] of [['artifact','artifact'],['toolchain','toolchain'],['logs','logs']]) {
      const value=await read(join(pathFor(job),name+'.json'));
      if(JSON.stringify(bind(value))!==JSON.stringify(record[key])) throw fault('Sealed build evidence changed.','build_integrity',409);
    }
    const artifactRef={...project,kind:'build-artifact',id:job,rev:'1'};
    return {project:record.project,commit:record.commit,artifact:{ref:artifactRef,content:record.artifact,size:record.artifact.bytes,mime:'application/json',objectKey:`build/${job}/artifact.json`},toolchain:record.toolchain,logs:{...project,kind:'build-logs',id:job,rev:'1'},exit:record.exit};
  }
  async function readBuildArtifact(ctx, job, project, gen) {
    const build = await collectBuild(ctx, job, project, gen);
    const content = await read(join(pathFor(job),'artifact.json'));
    if(JSON.stringify(bind(content))!==JSON.stringify(build.artifact.content)) throw fault('Sealed build artifact changed before publication.','build_integrity',409);
    // This is the bytes-to-publisher boundary, not a persisted permission.
    // Recheck the original current project authority after all disk reads.
    await authorize(ctx,project,'read-build');
    return {build,content};
  }
  return Object.freeze({begin,complete,collectBuild,readBuildArtifact});
}
