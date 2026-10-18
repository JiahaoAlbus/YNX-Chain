import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('two-phase Native contract has no SDK runtime wrapper in Node or browser',()=>{
 for(const conditions of [[],['--conditions=browser']]){
  const r=spawnSync(process.execPath,[...conditions,'--input-type=module','-e',"try {await import('@ynx-chain/wallet-auth/auth-native-contract');process.exit(1);} catch(e) {if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw e;}"],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
 }
});
