import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWalletPQTransferInput} from '../src/wallet-pq-transfer-input.mjs';
test('default PQ amount delegates exact signed64 total bound and leaves native units unchanged',()=>{
 for(const amount of ['1','3','9223372036854775806']){const source={to:'ynx1PUBLIC',amount},copy={...source},r=normalizeWalletPQTransferInput(source);assert.deepEqual(r,copy);assert(Object.isFrozen(r));assert.deepEqual(source,copy);}
 for(const amount of ['9223372036854775807','18446744073709551615','0','-1','1.25','1e18','01',' 1'])assert.throws(()=>normalizeWalletPQTransferInput({to:'ynx1PUBLIC',amount}));
});
test('renderer input cannot supply a fee policy nonce or key and accessors/proxies are not invoked',()=>{
 for(const value of [null,[],{to:'ynx1PUBLIC',amount:1},{to:'ynx1PUBLIC',amount:1n},{to:'ynx1PUBLIC',amount:'1',fee:'0'},{to:'ynx1PUBLIC',amount:'1',nonce:'1'}])assert.throws(()=>normalizeWalletPQTransferInput(value));
 let reads=0;const accessor={to:'ynx1PUBLIC',get amount(){reads++;return '1';}},proxy=new Proxy({to:'ynx1PUBLIC',amount:'1'},{get(){reads++;throw Error('untrusted trap');},ownKeys(){reads++;throw Error('untrusted trap');}});
 assert.throws(()=>normalizeWalletPQTransferInput(accessor));assert.throws(()=>normalizeWalletPQTransferInput(proxy));assert.equal(reads,0);
});
