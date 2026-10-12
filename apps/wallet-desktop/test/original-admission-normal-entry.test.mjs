import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createOriginalAdmissionController} from '../src/original-admission-controller.mjs';
const root=process.env.PUBLIC_NATIVE_PARENT?new URL('file://'+process.env.PUBLIC_NATIVE_PARENT+'/'):new URL('../src/',import.meta.url);
const source=name=>readFileSync(new URL(name,root),'utf8');
test('R9 PUBLIC actual normal main binds fixed absent supply and protected four IPC routes',async()=>{
 const main=source('main.mjs'),start=main.indexOf('const originalAdmissionSupply = null;'),end=main.indexOf('const recipientCameraPermission',start);assert.ok(start>=0&&end>start,'actual main entry absent');
 const routes=new Map(),context={createOriginalAdmissionController,keyAccess:{status:()=>({locked:false,account:'PUBLIC-account',revision:1,unlockExpiresAt:2000}),run:()=>{throw Error('no original supply; no key operation');}},mainWindow:{isFocused:()=>true,webContents:{send(){}}},accountChangeInProgress:false,randomUUID:()=> 'PUBLIC-id',handleWalletIPC:(c,h)=>routes.set(c,h),safeIPC:async f=>{try{return {ok:true,value:await f()};}catch{return {ok:false};}}};
 runInNewContext(main.slice(start,end),context);assert.equal(routes.size,4);assert.equal((await routes.get('wallet:original-admission-status')()).value.available,false);assert.equal((await routes.get('wallet:original-admission-review')()).ok,false);
 assert.match(main,/assertWalletIPC\(event, mainWindow\?\.webContents/);assert.match(main,/originalAdmissionSecurityStamp/);
});
test('R9 PUBLIC actual preload exposes only review ID, status and cancel, not owner or selection',()=>{const text=source('preload.cjs');for(const method of ['originalAdmissionStatus','originalAdmissionReview','originalAdmissionConfirm','originalAdmissionCancel','onOriginalAdmissionState'])assert.ok(text.includes(method));assert.match(text,/originalAdmissionConfirm:reviewId=>ipcRenderer.invoke\('wallet:original-admission-confirm',reviewId\)/);});
test('R9 PUBLIC actual renderer projects unknown and does not present delivery as account authorization',()=>{
 const text=source('renderer.js'),start=text.indexOf('function renderOriginalAdmission('),end=text.indexOf('async function originalAdmissionAction',start);assert.ok(start>=0&&end>start);
 const nodes=new Map(),context={originalAdmissionState:{revision:-1},keyState:{locked:false},document:{querySelector:id=>{if(!nodes.has(id))nodes.set(id,{replaceChildren(){},append(){}});return nodes.get(id);}}};
 runInNewContext(text.slice(start,end)+'\nrenderOriginalAdmission({revision:2,phase:"unknown",available:true,busy:false,outcomeUnknown:true,publicationRetained:true,hasReview:false});',context);
 assert.match(nodes.get('#original-admission-status').textContent,/Outcome unknown/);assert.equal(nodes.get('#original-admission-review').disabled,true);
 runInNewContext('renderOriginalAdmission({revision:1,phase:"acknowledged",available:true,hasReview:false});',context);assert.match(nodes.get('#original-admission-status').textContent,/Outcome unknown/);
 assert.match(source('index.html'),/original-admission-status/);assert.match(source('index.html'),/no account, project, tools or transfer permission/);
});
