import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {WALLET_AUTH_PROTOCOL_SOURCE} from '../src/wallet-auth-contract.mjs';
test('R3b normal consumer retains the exact original SDK source receipt',()=>{
 assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceCommit,'b164a68376ad784bfd5f83513611f6a4ee008070');assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceSha256,'460b4e514ae748de5d73defa932c3aa840cb4cd50b5525a6eda1e8461e423544');assert.equal(Object.isFrozen(WALLET_AUTH_PROTOCOL_SOURCE),true);
});
test('unreviewed protocol bytes still fail before a registry or policy can be selected',()=>{
 const source=readFileSync(new URL('../src/wallet-auth-contract.mjs',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export const ','const ').replaceAll('import.meta.resolve("@ynx-chain/wallet-auth")','"file:///PUBLIC/sdk/src/index.js"');let reads=0;
 assert.throws(()=>runInNewContext(source,{URL,createHash,readFileSync:()=>{reads++;return Buffer.from('PUBLIC_UNREVIEWED_PROTOCOL');}}),/no reviewed source receipt/);assert.equal(reads,1);
});
