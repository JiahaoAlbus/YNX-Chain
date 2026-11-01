import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertWalletIPC} from '../src/wallet-ipc-policy.mjs';
import {createYNXEVMCompatibilityReceiveCode,resolveReceivingAddress} from '../src/receive-code.mjs';
const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const preload=await readFile(new URL('../src/preload.cjs',import.meta.url),'utf8');
const account='ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt';
const evm='0x84bc88971971078d450ac7cc31d9a4775d6e3065';
function fixture(){
 const directory='/public-installed/src',url=pathToFileURL(path.join(directory,'index.html')).href;
 const frame={url},contents={mainFrame:frame,isDestroyed:()=>false},event={sender:contents,senderFrame:frame};
 const handlers=new Map();let reads=0,status={initialized:true,account:evm,ynxAccount:account};
 const sandbox={ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},assertWalletIPC,mainWindow:{webContents:contents},directory,path,pathToFileURL,
  safeIPC:async fn=>{try{return {ok:true,value:await fn()};}catch(error){return {ok:false,error};}},
  walletAuthority:{accountStatus:async()=>{reads++;return status;}},createYNXEVMCompatibilityReceiveCode,resolveReceivingAddress};
 const guard=main.slice(main.indexOf('function handleWalletIPC('),main.indexOf('const isolatedProfile'));
 const begin=main.indexOf('handleWalletIPC("wallet:receive-compatibility-code"'),end=main.indexOf('handleWalletIPC("wallet:receive-code"',begin);
 assert.ok(begin>0&&end>begin);runInNewContext(guard+main.slice(begin,end),sandbox);
 const api={};for(const name of ['receiveCompatibilityCode','resolveReceivingAddress']){
  const line=preload.split('\n').find(value=>value.trimStart().startsWith(name+':'));
  Object.assign(api,runInNewContext('({'+line+'})',{ipcRenderer:{invoke:(channel,input)=>handlers.get(channel)(event,input)}}));
 }
 return {api,event,frame,handlers,reads:()=>reads,setStatus:value=>status=value};
}
test('normal preload → exact Main frame → actual receiving producers returns only current same-account encodings',async()=>{
 const f=fixture(),qr=await f.api.receiveCompatibilityCode(account);assert.equal(qr.ok,true);assert.equal(qr.value.payload,evm);assert.equal(qr.value.nativeAccount,account);
 const resolved=await f.api.resolveReceivingAddress({address:evm,direction:'evm-to-ynx',networkId:'ynx_6423-1'});
 assert.equal(resolved.ok,true);assert.equal(resolved.value.target,account);assert.equal(resolved.value.method,'same-account-encoding');assert.equal(f.reads(),4);
});
test('both new readonly IPC routes reject foreign frames before accessing the current account',async()=>{
 const f=fixture();for(const [name,handler] of f.handlers){const response=await handler({...f.event,senderFrame:{url:f.frame.url}},name.includes('compatibility')?account:{});assert.equal(response.ok,false);assert.equal(response.error.data.code,'UNTRUSTED_WALLET_FRAME');}assert.equal(f.reads(),0);
});
test('normal resolver does not reuse a previous selection or return another account as verified',async()=>{
 const f=fixture();assert.equal((await f.api.receiveCompatibilityCode(account)).ok,true);
 f.setStatus({initialized:true,account:'0x'+'1'.repeat(40),ynxAccount:'ynx1unselected'});
 assert.equal((await f.api.receiveCompatibilityCode(account)).ok,false);
 const result=await f.api.resolveReceivingAddress({address:evm,direction:'evm-to-ynx',networkId:'ynx_6423-1'});assert.equal(result.ok,false);
});
