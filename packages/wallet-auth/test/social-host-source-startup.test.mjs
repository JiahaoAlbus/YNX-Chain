import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
const registry=JSON.parse(fs.readFileSync(new URL('../product-session-registry.json',import.meta.url)));
test('actual Host uses independent zero-input Social Source and retains the missing-row owner until physical close',async()=>{
 const dir=fs.mkdtempSync(path.join(os.homedir(),'PUBLIC-social-host-'));try{
  const h=new ProductSessionGatewayNodeHost(registry,{statePath:path.join(dir,'state.json'),now:()=>new Date(),tokenFactory:()=>('P'.repeat(32))});
  const p=h.supplyOriginalSocialDirectorySourceV4();assert.equal(h.supplyOriginalSocialDirectorySourceV4(),p);const s=await p;assert.equal(s.configured,false);assert.equal(s.firstCausePresent,true);assert.equal(s.firstCause.code,'SOCIAL_SOURCE_HELPER_NOT_SUPPLIED');
  await assert.rejects(h.openOriginalSocialDirectoryResponseLoanV4({},'currentExistingSocialDeviceDirectoryPrincipalV4'),{code:'SOCIAL_DIRECTORY_ORIGINAL_PRINCIPAL_SOURCE_REQUIRED'});
  h.retireOriginalSocialDirectorySourceV4();await assert.rejects(h.closeOriginalSocialDirectorySourceV4(),e=>e===s.firstCause);const closed=h.originalSocialDirectorySourceStatusV4();assert.equal(closed.closed,true);assert.equal(closed.firstCause,s.firstCause);await h.drainOriginalSocialDirectorySourceV4();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
