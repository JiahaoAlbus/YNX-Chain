import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {WALLET_AUTH_PROTOCOL_SOURCE} from '../src/wallet-auth-contract.mjs';
test('normal consumer retains the exact R3b or complete SDK46 source receipt without relabeling either',()=>{
 const expected={'460b4e514ae748de5d73defa932c3aa840cb4cd50b5525a6eda1e8461e423544':'b164a68376ad784bfd5f83513611f6a4ee008070','6f67298154ebf44b9fd1c5b01c75dbb16cee425ab8164e53dc9c8e504892741c':'59a3797ea3421129171565e37870568e424ec085'};
 assert(Object.hasOwn(expected,WALLET_AUTH_PROTOCOL_SOURCE.sourceSha256));assert.equal(WALLET_AUTH_PROTOCOL_SOURCE.sourceCommit,expected[WALLET_AUTH_PROTOCOL_SOURCE.sourceSha256]);assert.equal(Object.isFrozen(WALLET_AUTH_PROTOCOL_SOURCE),true);
});
test('one changed protocol byte still refuses before registry selection under either reviewed SDK',()=>{
 const original=readFileSync(new URL('./product-session-v2.js',import.meta.resolve('@ynx-chain/wallet-auth'))),changed=Buffer.from(original);changed[changed.length-1]^=1;
 const source=readFileSync(new URL('../src/wallet-auth-contract.mjs',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export const ','const ').replaceAll('import.meta.resolve("@ynx-chain/wallet-auth")','"file:///PUBLIC/sdk/src/index.js"');let reads=0;
 assert.throws(()=>runInNewContext(source,{URL,createHash,readFileSync:()=>{reads++;return changed;}}),/no reviewed source receipt/);assert.equal(reads,1);
});
test('unreviewed protocol bytes still fail before a registry or policy can be selected',()=>{
 const source=readFileSync(new URL('../src/wallet-auth-contract.mjs',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export const ','const ').replaceAll('import.meta.resolve("@ynx-chain/wallet-auth")','"file:///PUBLIC/sdk/src/index.js"');let reads=0;
 assert.throws(()=>runInNewContext(source,{URL,createHash,readFileSync:()=>{reads++;return Buffer.from('PUBLIC_UNREVIEWED_PROTOCOL');}}),/no reviewed source receipt/);assert.equal(reads,1);
});
