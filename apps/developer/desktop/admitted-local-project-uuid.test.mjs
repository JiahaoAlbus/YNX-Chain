import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdmittedLocalProjectMapping} from './admitted-local-project.mjs';
const good='11111111-1234-1234-1234-123456789abc';
const bad='------------------------------------';
for(const field of ['localLaunch','canonicalLaunch','canonicalSession'])test('project mapping rejects malformed '+field+' before opening protected Tools',async()=>{
 const state={owner:'PUBLIC-owner',workspaceOwner:'PUBLIC-owner',account:'PUBLIC-account',generation:1,identityReference:'PUBLIC-reference',localProjectId:'PUBLIC-canonical',workspace:'/PUBLIC/workspace',launch:good,sessionId:good,expiresAt:1000};
 if(field==='canonicalLaunch')state.launch=bad;
 if(field==='canonicalSession')state.sessionId=bad;
 let opened=0;
 const mapping=createAdmittedLocalProjectMapping({context:{id:'PUBLIC-local',workspace:state.workspace},canonicalProject:{assertCurrent:async()=>({...state}),request(){throw Error('Not entered');},close(){}},nativeTools:{async openProject(){opened++;return {assertCurrent:async()=>({...state,generation:'1'}),request(){throw Error('Not entered');},close(){}};}},now:()=>100});
 try{await assert.rejects(mapping.openProject({projectId:'PUBLIC-local',workspace:state.workspace,launch:field==='localLaunch'?bad:good}),{code:'AI_RETIRED'});assert.equal(opened,0);}finally{await mapping.finishCleanup();}
});

test('valid original project binding still opens and retires exactly once',async()=>{
 let opened=0,closed=0;const state={owner:'PUBLIC-owner',workspaceOwner:'PUBLIC-owner',account:'PUBLIC-account',generation:1,identityReference:'PUBLIC-reference',localProjectId:'PUBLIC-canonical',workspace:'/PUBLIC/workspace',launch:good,sessionId:good,expiresAt:1000};
 const mapping=createAdmittedLocalProjectMapping({context:{id:'PUBLIC-local',workspace:state.workspace},canonicalProject:{assertCurrent:async()=>({...state}),request(){throw Error('Not entered');},close(){}},nativeTools:{async openProject(binding){assert.deepEqual(binding,{projectId:state.localProjectId,workspace:state.workspace,launch:good});opened++;return {assertCurrent:async()=>({...state,generation:'1'}),request(){throw Error('Not entered');},close(){closed++;}};}},now:()=>100});
 const input={projectId:'PUBLIC-local',workspace:state.workspace,launch:good};const held=await mapping.openProject(input);assert.equal((await held.assertCurrent(input)).launch,good);assert.equal(opened,1);await mapping.finishCleanup();assert.equal(closed,1);await assert.rejects(held.assertCurrent(input),{code:'AI_RETIRED'});
});
