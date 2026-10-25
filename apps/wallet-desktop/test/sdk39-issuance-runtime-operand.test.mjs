import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
const name='packages/wallet-auth/src/original-auth-source-issuance-v2.js';
const operand='../../../apps/wallet-desktop/native/original-source-current-dirfd.node';
const sample=Buffer.from(`const io=createRequire(import.meta.url)(fileURLToPath(new URL('${operand}',import.meta.url)));\n`);
const versions=['1.3.0-pq.3.32-auth.38','1.3.0-pq.3.32-auth.39','1.3.0-pq.3.32-auth.40','1.3.0-pq.3.32-auth.41'];
test('SDK38 through41 exact issuance operand is preserved under normal package and verification reader',()=>{
 for(const version of versions){const result=relocateDesktopRuntimeSource(name,sample,version);assert(result.bytes.equals(sample));assert.deepEqual(result.operands,[{kind:'url',from:operand,to:operand,count:1}]);assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname('code/'+name),operand)),'code/apps/wallet-desktop/native/original-source-current-dirfd.node');}
});
test('issuance operand selection does not admit old or unknown versions or an unknown source',()=>{
 for(const version of ['1.3.0-pq.3.32-auth.37','1.3.0-pq.3.32-auth.42'])assert.throws(()=>relocateDesktopRuntimeSource(name,sample,version),/Unlisted repository operand/);
 assert.throws(()=>relocateDesktopRuntimeSource(name.replace('issuance-v2','foreign'),sample,versions[1]),/Unlisted repository operand/);
});
test('issuance closed rule rejects missing duplicate changed and extra repository operands',()=>{
 for(const version of versions)for(const body of [Buffer.from('export {};'),Buffer.concat([sample,sample]),Buffer.from(sample.toString().replace('original-source-current-dirfd.node','foreign.node')),Buffer.concat([sample,Buffer.from("import {} from '../../../packages/wallet-auth/src/foreign.js';\n")])])assert.throws(()=>relocateDesktopRuntimeSource(name,body,version),/operand count differs|Unlisted repository operand/);
});
test('actual supplied SDK39 issuer and its SDK38 parent pass original reader without changing SDK bytes',{skip:!process.env.WALLET_AUTH39_NORMAL_SUPPLY},()=>{
 const supply=process.env.WALLET_AUTH39_NORMAL_SUPPLY;
 for(const [version,file,bytes,sha256]of [[versions[1],path.join(supply,'package/src/original-auth-source-issuance-v2.js'),15729,'b4ce5ef5cc1d1afc8d27b6d6ac18fdb3418c53fcce3c63b3f2ac0f1b3c49b7fd'],[versions[0],path.join(supply,'../sdk38-normal-supply/package/src/original-auth-source-issuance-v2.js'),14973,'4bde60cb18839b82a0bbe6f751375b4aac2c64296799b31386c8cf2efca83ec7']]){const raw=fs.readFileSync(file);assert.equal(raw.length,bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),sha256);const snapshot=Buffer.from(raw),result=relocateDesktopRuntimeSource(name,raw,version);assert(result.bytes.equals(snapshot));assert(raw.equals(snapshot));assert.deepEqual(result.operands,[{kind:'url',from:operand,to:operand,count:1}]);}
});
