// Actual original stdin driver and installed dependency graph. No network,
// synthetic authority, provider hook, signer or Native qualification is used.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {canonicalJSON} from '../src/canonical.js';
const driver=fileURLToPath(new URL('../native/original-auth-identity-source-verifier.mjs',import.meta.url));
test('original Source v2 stdin branch loads actual sole SDK and refuses unpinned originals/selectors',()=>{
 const input={operation:'auth-source-v2-native-node/v1',node:{origin:'',spki:'',nativeChainId:''},rootRaw:'{}',enrollmentRaw:'{}',profileRaw:'{}',headRaw:'{}',policy:{rootDigest:'00'.repeat(32),enrollmentDigest:'00'.repeat(32),endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'00'.repeat(32),signatureContract:{purpose:'PUBLIC-unqualified',enrollmentFrame:'PUBLIC-E',profileFrame:'PUBLIC-P',currentFrame:'PUBLIC-C'}},previous:{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'}};
 for(const [body,code] of [[input,'AUTH_SOURCE_V2_NOT_PINNED'],[{...input,provider:'PUBLIC-not-accepted'},'AUTH_SOURCE_V2_DISPATCH_SCHEMA'],[{...input,clock:1},'AUTH_SOURCE_V2_DISPATCH_SCHEMA']]){
  const r=spawnSync(process.execPath,[driver],{input:canonicalJSON(body),encoding:'utf8',env:{},timeout:7000});assert.ifError(r.error);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,code+'\n');
 }
});
