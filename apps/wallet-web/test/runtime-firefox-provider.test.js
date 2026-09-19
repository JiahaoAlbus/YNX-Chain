import assert from 'node:assert/strict';
import test from 'node:test';
import {assessFirefoxProviderEvidence} from '../scripts/runtime-evidence.mjs';
const complete=()=>({addonId:'wallet-testnet@ynxweb4.com',reloadedAddonId:'wallet-testnet@ynxweb4.com',
  firstLaunch:{matchingCount:1,foreignUnchanged:true,chain:{chainId:'0x1917',isYNXWallet:true,isMetaMask:false}},
  secondLaunch:{matchingCount:1,foreignUnchanged:true,chain:{chainId:'0x1917',isYNXWallet:true,isMetaMask:false}},
  restartBeforeReload:{matchingCount:0,restartMarker:'retained'},httpWithoutAction:{matchingCount:0}});
test('Firefox gate requires both real provider launches and negative restart/HTTP boundaries',()=>{
  assert.equal(assessFirefoxProviderEvidence(complete()).passed,true);
  for(const mutate of [
    x=>{delete x.firstLaunch},x=>{delete x.secondLaunch},
    x=>{x.firstLaunch.matchingCount=2},x=>{x.secondLaunch.chain={error:{code:'RPC_UNAVAILABLE'}}},
    x=>{x.firstLaunch.chain.chainId='0x1'},x=>{x.firstLaunch.chain.isMetaMask=true},
    x=>{x.secondLaunch.foreignUnchanged=false},x=>{x.restartBeforeReload.matchingCount=1},
    x=>{x.restartBeforeReload.restartMarker=null},x=>{x.httpWithoutAction.matchingCount=1},
    x=>{x.reloadedAddonId='different-addon'},x=>{x.addonId='different-addon'},
  ]){const evidence=complete();mutate(evidence);assert.equal(assessFirefoxProviderEvidence(evidence).passed,false);}
});
