import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile,realpath,rm,symlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {LocalWorkbenchStorageStore,MAX_VALUE}=require('../../ynx-workbench/lib/local-workbench-storage-store');
const {LocalWorkbenchStorage}=require('../../ynx-workbench/lib/local-workbench-storage');
async function fixture(task){const root=await realpath(await mkdtemp('/private/tmp/ynx-local-ui-store-'));try{const workspace=join(root,'workspace'),profile=join(root,'profile');await mkdir(workspace,{mode:0o700});await mkdir(profile,{mode:0o700});const projectId='12345678-1234-1234-1234-123456789abc';await writeFile(join(profile,'ynx-local-project.json'),JSON.stringify({schemaVersion:1,workspace,profile,projectId}),{mode:0o600});const env={YNX_WORKSPACE_MODE:'local',YNX_LOCAL_WORKSPACE:workspace,YNX_LOCAL_PROFILE:profile,THEIA_CONFIG_DIR:profile,YNX_LOCAL_PROJECT_ID:projectId};await task({root,workspace,profile,env,store:new LocalWorkbenchStorageStore(env)});}finally{await rm(root,{recursive:true,force:true});}}
test('real profile UI state survives fresh store and workspace prefix; atomic file private',async()=>fixture(async({store,env,profile,workspace})=>{
 await Promise.all([store.setData('layout',{tabs:['file:///test.sol']}),store.setData(pathToFileURL(workspace).href+':perspective-layouts',{main:{widgets:[]}})]);await store.flush();
 const reopened=new LocalWorkbenchStorageStore(env);assert.deepEqual(await reopened.getData('layout'),{found:true,value:{tabs:['file:///test.sol']}});assert.equal((await lstat(join(profile,'ynx-workbench-ui-v1.json'))).mode&0o777,0o600);
 await reopened.setData('layout',null,true);assert.deepEqual(await reopened.getData('layout'),{found:false});
}));
test('damaged saved UI archive is reported and remains byte-identical',async()=>fixture(async({store,profile})=>{
 const path=join(profile,'ynx-workbench-ui-v1.json');await writeFile(path,'damaged-user-record',{mode:0o600});
 await assert.rejects(store.getData('layout'),/damaged/);await assert.rejects(store.setData('layout',{}),/damaged/);assert.equal(await readFile(path,'utf8'),'damaged-user-record');
}));
test('canonical mode, changed binding, unrelated prefixes and identity keys refused',async()=>fixture(async({store,env,profile})=>{
 await assert.rejects(new LocalWorkbenchStorageStore({...env,YNX_WORKSPACE_MODE:'canonical'}).getData('layout'),/not bound/);
 await assert.rejects(store.setData('authentication-session-provider','secret'),/presentation state/);await assert.rejects(store.setData('file:///another:layout',{}),/presentation state/);
 await assert.rejects(store.setData('layout','x'.repeat(MAX_VALUE+1)),/exceeds/);
 await writeFile(join(profile,'ynx-local-project.json'),JSON.stringify({schemaVersion:1,workspace:'/other',profile,projectId:env.YNX_LOCAL_PROJECT_ID}));await assert.rejects(store.setData('layout',{}),/binding changed/);
}));
test('symlinked existing archive cannot replace outside data',async()=>fixture(async({store,root,profile})=>{
 const outside=join(root,'outside');await writeFile(outside,'retained',{mode:0o600});await symlink(outside,join(profile,'ynx-workbench-ui-v1.json'));await assert.rejects(store.setData('layout',{}),/file changed/);assert.equal(await readFile(outside,'utf8'),'retained');
}));
test('frontend standard API flush waits UI writes; identity/nonlocal uses original browser only',async()=>{
 const calls=[], fallback={async setData(key,data){calls.push(['browser-set',key,data]);},async getData(key,defaultValue){calls.push(['browser-get',key]);return defaultValue;}};
 let release;const writing=new Promise(resolve=>{release=resolve;});const api={async setData(key){calls.push(['disk-set',key]);await writing;},async getData(){return {found:true,value:{tabs:2}};},async flush(){calls.push(['disk-flush']);}};
 const target={webkit:{messageHandlers:{ynxLocalWorkbench:{}}}};const adapter=new LocalWorkbenchStorage(fallback,api,{async error(message){calls.push(['error',message]);}},target);
 const write=adapter.setData('layout',{});let flushed=false;const flush=adapter.flush().then(()=>{flushed=true;});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(flushed,false);release();await Promise.all([write,flush]);assert.deepEqual(await adapter.getData('layout'),{tabs:2});
 await adapter.setData('authentication-session',123);target.webkit=undefined;await adapter.setData('layout',{});assert.deepEqual(calls.filter(row=>row[0]==='browser-set').map(row=>row[1]),['authentication-session','layout']);
 const failure=new LocalWorkbenchStorage(fallback,{...api,async getData(){throw Error('damaged');}}, {async error(message){calls.push(['error',message]);}}, {webkit:{messageHandlers:{ynxLocalWorkbench:{}}}});await assert.rejects(failure.getData('layout'),/damaged/);await assert.rejects(failure.flush(),/damaged/);assert.equal(calls.filter(row=>row[0]==='error').length,1);
});
test('prelayout storage failure rejects immediately even when its toast never resolves; damaged bytes survive',async()=>fixture(async({store,profile})=>{
 const path=join(profile,'ynx-workbench-ui-v1.json'), damaged='retained-before-layout';await writeFile(path,damaged,{mode:0o600});
 let notifications=0;const adapter=new LocalWorkbenchStorage({async getData(){throw Error('local failure must not use browser fallback');}},store,{error(){notifications++;return new Promise(()=>{});}}, {webkit:{messageHandlers:{ynxLocalWorkbench:{}}}});
 const promptly=async job=>{let timer;try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('storage waited for the toast')),250);})]);}finally{clearTimeout(timer);}};
 await assert.rejects(promptly(adapter.getData('layout')),/damaged/);
 await assert.rejects(promptly(adapter.flush()),/damaged/);
 assert.equal(notifications,1);assert.equal(await readFile(path,'utf8'),damaged);
 const rejectsNotification=new LocalWorkbenchStorage({},store,{error(){return Promise.reject(Error('notification unavailable'));}}, {webkit:{messageHandlers:{ynxLocalWorkbench:{}}}});
 await assert.rejects(promptly(rejectsNotification.getData('layout')),/damaged/);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(await readFile(path,'utf8'),damaged);
}));
