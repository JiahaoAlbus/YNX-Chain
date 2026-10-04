import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {isVenueTimestamp} from '../web/market-data.js';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const restore=app.slice(app.indexOf('async function restoreBrowserIdentity('),app.indexOf('async function restoreBrowserIdentityQuietly('));
const valid=()=>({signedIn:true,account:'native-owner',subject:'native-owner',generation:1,expiresAt:new Date(Date.now()+60000).toISOString(),csrfToken:'c'.repeat(43),scopes:['identity:read'],privateWorkspaceAuthorized:false});
async function attempt(data){
  const status={textContent:''},logout={hidden:true,disabled:false},calls={disconnect:0,guest:0};
  const scope={isVenueTimestamp,browserIdentityEpoch:0,browserIdentity:null,state:{account:'native-owner',standardWallet:{status:'standard-connected',account:'standard-owner'}},privateAccount:{disconnect:async()=>{calls.disconnect++},guest:async()=>{calls.guest++}},browserIdentityRequest:async()=>({response:{ok:true},data}),$:selector=>selector==='#browser-identity-status'?status:logout,writeBrowserIdentity:(element,key)=>{element.textContent=key},restoreBrowserIdentityQuietly:async()=>{}};
  runInNewContext(restore+';this.restore=restoreBrowserIdentity',scope);await scope.restore();return {scope,status,logout,calls};
}
test('malformed identity envelope cannot display signed-in state or retire the separate private account',async()=>{
  for(const change of [d=>delete d.account,d=>d.account='',d=>d.account=' other ',d=>d.account='other\nowner',d=>d.subject='different-owner',d=>d.signedIn=false,d=>d.generation=0,d=>d.generation=Number.MAX_SAFE_INTEGER+1,d=>d.expiresAt='not-a-date',d=>d.expiresAt=new Date(Date.now()-1).toISOString(),d=>delete d.csrfToken,d=>d.csrfToken='short',d=>d.csrfToken=' '.repeat(43),d=>d.scopes=['identity:read','exchange:trade'],d=>d.privateWorkspaceAuthorized=true]){
    const data=valid();change(data);const result=await attempt(data);
    assert.equal(result.scope.browserIdentity,null);assert.equal(result.status.textContent,'identity-unavailable');assert.equal(result.logout.hidden,true);assert.equal(result.calls.disconnect,0);assert.equal(result.calls.guest,0);assert.equal(result.scope.state.standardWallet.account,'standard-owner');
  }
});
test('exact existing identity envelope restores without private or standard authority changes',async()=>{
  const data=valid(),result=await attempt(data);assert.equal(result.scope.browserIdentity,data);assert.equal(result.status.textContent,'identity-read');assert.equal(result.logout.hidden,false);assert.equal(result.calls.disconnect,0);assert.equal(result.calls.guest,0);
});
