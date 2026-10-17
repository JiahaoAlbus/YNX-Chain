import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {WALLET_AUTH_PROTOCOL_SOURCE} from '../src/wallet-auth-contract.mjs';
test('R3 normal consumer retains the exact original SDK source receipt',()=>{
 assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceCommit,'0ec5ce5d9a65649dd8f8f4b591c2beaf2d003bfc');assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceSha256,'8d1c4f1d0b64c8d61bdee964ebf062e2c7067920745fbce6a620a2b8c3849ded');assert.equal(Object.isFrozen(WALLET_AUTH_PROTOCOL_SOURCE),true);
});
test('unreviewed protocol bytes still fail before a registry or policy can be selected',()=>{
 const source=readFileSync(new URL('../src/wallet-auth-contract.mjs',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export const ','const ').replaceAll('import.meta.resolve("@ynx-chain/wallet-auth")','"file:///PUBLIC/sdk/src/index.js"');let reads=0;
 assert.throws(()=>runInNewContext(source,{URL,createHash,readFileSync:()=>{reads++;return Buffer.from('PUBLIC_UNREVIEWED_PROTOCOL');}}),/no reviewed source receipt/);assert.equal(reads,1);
});
