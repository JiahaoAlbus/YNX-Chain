import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {capturePublicationArtifact} from './artifact-publication-client.mjs';
const program="import {createServer} from 'node:http';\ncreateServer((req,res)=>res.end('YNX project\\n')).listen(Number(process.env.PORT),'0.0.0.0');\n";
async function fixture(t){
 const workspace=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'ynx-publication-file-')));t.after(()=>fs.rm(workspace,{recursive:true}));const artifactPath=join(workspace,'server.mjs');await fs.writeFile(artifactPath,program);
 const state={owner:'PUBLIC-owner',workspaceOwner:'PUBLIC-owner',account:'PUBLIC-account',generation:1,identityReference:'PUBLIC-ref',localProjectId:'PUBLIC-canonical-project',workspace,launch:'PUBLIC-launch',sessionId:'PUBLIC-session',expiresAt:Date.now()+60000};
 const options={context:{workspace},admittedProject:{assertCurrent:async()=>({...state})},artifactPath,version:'0.1.0',publishPurpose:'PUBLIC-purpose-data',targetEnvironment:'PUBLIC-environment-data'};
 return {workspace,artifactPath,state,options};
}
test('real Node project bytes bind canonical project, size and digest without granting approval',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);assert.equal(draft.binding.projectId,f.state.localProjectId);assert.equal(draft.binding.byteSize,Buffer.byteLength(program));assert.equal(draft.binding.contentDigest,createHash('sha256').update(program).digest('hex'));assert.equal(draft.authority,'artifact-data-only');assert.equal(draft.signingApproved,false);assert.equal(draft.deploymentApproved,false);
 const copy=draft.artifactBytes();copy.fill(0);assert.equal(Buffer.from(draft.artifactBytes()).toString(),program);await draft.assertCurrent();
 await assert.rejects(draft.encodeManifest(),{code:'IDE_ARTIFACT_ORIGINAL_CODEC_UNAVAILABLE'});
 // This fixture exercises DATA byte matching, not the original Auth codec or a signature.
 const raw=await draft.encodeManifest(binding=>JSON.stringify(binding));assert.deepEqual(JSON.parse(Buffer.from(raw)),draft.binding);
});
test('same-size source change requires a fresh approval and preserves selected user bytes',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);const changed=program.replace('YNX project','NEW project');assert.equal(changed.length,program.length);await fs.writeFile(f.artifactPath,changed);await assert.rejects(draft.assertCurrent(),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});await assert.rejects(draft.encodeManifest(JSON.stringify),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});assert.equal(await fs.readFile(f.artifactPath,'utf8'),changed);
});
test('replacement inode, symlink and hardlink do not inherit a prior file review',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);await fs.rename(f.artifactPath,join(f.workspace,'retained.mjs'));await fs.writeFile(f.artifactPath,program);await assert.rejects(draft.assertCurrent(),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});await fs.unlink(f.artifactPath);await fs.symlink(join(f.workspace,'retained.mjs'),f.artifactPath);await assert.rejects(capturePublicationArtifact(f.options));await fs.unlink(f.artifactPath);await fs.link(join(f.workspace,'retained.mjs'),f.artifactPath);await assert.rejects(capturePublicationArtifact(f.options),{code:'IDE_ARTIFACT_FILE_INVALID'});
});
test('project generation change and outside-project selection never produce a manifest',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);f.state.generation++;await assert.rejects(draft.assertCurrent(),{code:'IDE_ARTIFACT_PROJECT_RETIRED'});await assert.rejects(capturePublicationArtifact({...f.options,artifactPath:join(f.workspace,'..','outside.mjs')}),{code:'IDE_ARTIFACT_OUTSIDE_PROJECT'});
});
test('manifest codec cannot substitute project, digest, purpose or extra trusted-key fields',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);for(const change of [{projectId:'PUBLIC-other'},{contentDigest:'0'.repeat(64)},{publishPurpose:'PUBLIC-other'},{trustedKey:'PUBLIC-not-trust'}])await assert.rejects(draft.encodeManifest(binding=>JSON.stringify({...binding,...change})),{code:'IDE_ARTIFACT_ORIGINAL_CODEC_INVALID'});
});
