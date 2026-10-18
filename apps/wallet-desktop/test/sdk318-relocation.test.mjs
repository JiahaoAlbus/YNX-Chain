import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {relocateDesktopRuntimeSource,PACKAGED_RELOCATION_RULES} from '../scripts/release-provenance.mjs';
const name='packages/wallet-auth/src/original-ide-admission-parent-delivery.js';
// Same checkout by default; isolated consumers must supply their exact frozen
// SDK source directory explicitly. No node_modules or ambient SDK fallback.
const sdkSource=process.env.PROVENANCE_SDK_SOURCE??fileURLToPath(new URL('../../../packages/wallet-auth/src/',import.meta.url));
const source=readFileSync(path.join(sdkSource,'original-ide-admission-parent-delivery.js'));
assert.equal(source.length,22531,'SDK318 source byte pin');
assert.equal(createHash('sha256').update(source).digest('hex'),'1235de33effb0454f65b6c99e72b76ee5b1ddf286dd177a5de3623cccf433af5','SDK318 source SHA256 pin');
const operand='../../../apps/wallet-desktop/native/original-auth-identity.node';
test('SDK318 pinned parent and cold Native URLs are both preserved',()=>{
 assert.equal(source.length,22531);
 assert.equal(createHash('sha256').update(source).digest('hex'),'1235de33effb0454f65b6c99e72b76ee5b1ddf286dd177a5de3623cccf433af5');
 const result=relocateDesktopRuntimeSource(name,source);
 assert.deepEqual(result.bytes,source);
 assert.equal(result.operands.length,1);
 assert.equal(result.operands[0].count,2);
 assert.equal(PACKAGED_RELOCATION_RULES.find(r=>r.sourcePath===name).packedPath,'code/'+name);
});
test('SDK318 missing either occurrence or an added third occurrence is rejected',()=>{
 const text=source.toString(),first=text.indexOf(operand),second=text.indexOf(operand,first+operand.length);
 assert.ok(first>=0&&second>first);
 for(const offset of [first,second])assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.from(text.slice(0,offset)+'./foreign.node'+text.slice(offset+operand.length))),/operand count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.from(text+`\nnew URL('${operand}',import.meta.url);`)),/operand count differs/);
});
test('SDK318 extra unlisted repository URL is rejected',()=>{
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.from(source.toString()+"\nnew URL('../../../apps/wallet-desktop/native/foreign.node',import.meta.url);")),/Unlisted repository operand/);
});
test('Host journal retains its exact single Native URL requirement',()=>{
 const host='packages/wallet-auth/src/original-host-terminal-journal.js',body=Buffer.from(`new URL('${operand}',import.meta.url);`);
 assert.equal(relocateDesktopRuntimeSource(host,body).operands[0].count,1);
 assert.throws(()=>relocateDesktopRuntimeSource(host,Buffer.concat([body,body])),/operand count differs/);
});
