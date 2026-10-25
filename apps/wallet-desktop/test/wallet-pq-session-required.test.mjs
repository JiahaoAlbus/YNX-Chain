import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopWalletAuthority,MemoryPermissionStore} from '../src/desktop-wallet-authority.mjs';
test('YNX product approval cannot fall back to classic key access when current PQ policy source is missing',async()=>{
 let classic=0,pq=0;const account='0x'+'11'.repeat(20),authority=new DesktopWalletAuthority({permissions:new MemoryPermissionStore(),vault:{withSecret(){classic++;throw Error('PUBLIC_CLASSIC_FALLBACK_ENTERED');},withPQKeys(){pq++;throw Error('UNEXPECTED_PQ_KEY_ENTRY');}}});
 await assert.rejects(authority.approveCanonicalAuthorization({},new Date().toISOString(),account),e=>e.data?.code==='ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED');assert.equal(classic,0);assert.equal(pq,0);
});
