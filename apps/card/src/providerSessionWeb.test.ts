import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {cardCallbackKind} from './providerCallback';

// Isolated SDK contract doubles; these tests do not claim a Gateway approval.
function load(values:Map<string,string>,ready=false){
  const calls:{scopes:string[];restored:number;begun:number}[]=[];
  const exports:Record<string,any>={};
  const w={location:{origin:'https://card.ynxweb4.com',href:'https://card.ynxweb4.com/',assign:()=>{throw Error('Unexpected launch')}},isSecureContext:true,navigator:{onLine:true},history:{replaceState(){}},localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}};
  const sdk={ProductSessionGatewayFetchAdapter:class{},createBrowserProductSessionClient:async(config:any)=>{const record={scopes:[...config.scopes],restored:0,begun:0};calls.push(record);return {close(){},client:{current:null,restore:async()=>{record.restored++;return {status:'disconnected'}},beginExplicit:async()=>{record.begun++;return ready?{status:'connecting',route:{status:'ready',url:'ynxwallet://authorize?request=isolated-fixture'}}:{status:'disconnected'}}}}}};
  const source=ts.transpileModule(fs.readFileSync(new URL('./providerSessionWeb.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,window:w,URL,fetch:async()=>{throw Error('No external requests allowed')},require:(name:string)=>{if(name==='@ynx-chain/wallet-auth-card-provider-v2')return sdk;if(name.includes('registry-b754'))return {};if(name==='./providerCallback')return {cardCallbackKind};throw Error('Unexpected import '+name)}});
  return {api:exports,calls};
}
test('explicit Finance scope mode restores its own namespace after page reload without a new request',async()=>{
  const storage=new Map<string,string>();const first=load(storage);await first.api.beginCardWebSession(true);
  assert.ok(first.calls[0]!.scopes.includes('card:finance:share'));assert.equal(first.calls[0]!.begun,1);
  const reloaded=load(storage);await reloaded.api.restoreCardWebSession();
  assert.ok(reloaded.calls[0]!.scopes.includes('card:finance:share'));assert.equal(reloaded.calls[0]!.restored,1);assert.equal(reloaded.calls[0]!.begun,0);
  await reloaded.api.beginCardWebSession(false);assert.equal(reloaded.calls.length,2);assert.ok(!reloaded.calls[1]!.scopes.includes('card:finance:share'));
});
test('legacy attempted sessions remain base-only and corrupt mode is rejected',async()=>{
  const storage=new Map([['ynx.card.provider-session.v2.attempted','yes']]);const legacy=load(storage);await legacy.api.restoreCardWebSession();assert.ok(!legacy.calls[0]!.scopes.includes('card:finance:share'));
  storage.set('ynx.card.provider-session.v2.scope-mode','arbitrary');const corrupt=load(storage);await assert.rejects(corrupt.api.restoreCardWebSession(),/CARD_SESSION_MODE_INVALID/);assert.equal(corrupt.calls.length,0);
});

test('explicit private Web authorization retains the page instead of opening a custom scheme',async()=>{
  const isolated=load(new Map(),true);await assert.rejects(isolated.api.beginCardWebSession(),{code:'CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE'});assert.equal(isolated.calls[0]!.begun,1);
});
