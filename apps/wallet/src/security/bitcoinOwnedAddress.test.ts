import test from 'node:test';
import assert from 'node:assert/strict';
import {HDNodeWallet} from 'ethers';
import {bitcoinOwnedReceivePath,projectBitcoinOwnedReceiveAddress,validateBitcoinOwnedReceiveAddress} from './bitcoinOwnedAddress';
import {validateBitcoinReadAddress} from '../chain/bitcoinRead';

// Published BIP84 vectors only; no wallet repository or storage accessed.
const phrase='abandon '.repeat(11)+'about';
const vaultAccount='ynx1'+'q'.repeat(38);
const selection={vaultAccount,network:'mainnet' as const};
const key0='0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c';
test('BTC receive public projection matches the first two official BIP84 receive vectors',()=>{
  const vectors=[[key0,'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'],['03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77','bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g']];
  for(const [index,[key,address]] of vectors.entries()){
    const expected={...selection,index},path=bitcoinOwnedReceivePath(expected);
    const pub=HDNodeWallet.fromPhrase(phrase,'',path).publicKey.slice(2);
    assert.equal(path,`m/84'/0'/0'/0/${index}`);assert.equal(pub,key);
    const dto=projectBitcoinOwnedReceiveAddress(expected,pub);
    assert.deepEqual(dto,{family:'bitcoin',vaultAccount,network:'mainnet',path,index,publicKey:key,address,networkVerified:false});
    assert.deepEqual(validateBitcoinOwnedReceiveAddress(expected,dto),dto);assert.ok(Object.isFrozen(dto));
  }
});
test('BTC receive test networks share tb and BIP84 coin 1 but remain distinctly bound',()=>{
  const rows=(['testnet3','testnet4','signet'] as const).map(network=>{
    const expected={vaultAccount,network};const path=bitcoinOwnedReceivePath(expected);assert.equal(path,"m/84'/1'/0'/0/0");
    const dto=projectBitcoinOwnedReceiveAddress(expected,HDNodeWallet.fromPhrase(phrase,'',path).publicKey.slice(2));
    assert.equal(dto.networkVerified,false);assert.ok(dto.address.startsWith('tb1q'));assert.equal(validateBitcoinReadAddress(dto.address,network),dto.address);return dto;
  });
  assert.equal(new Set(rows.map(row=>row.address)).size,1);assert.equal(new Set(rows.map(row=>row.network)).size,3);
  assert.throws(()=>validateBitcoinOwnedReceiveAddress({vaultAccount,network:'testnet4'},rows[0]),{code:'BTC_RECEIVE_RESULT_INVALID'});
  assert.throws(()=>validateBitcoinReadAddress(rows[0]!.address,'mainnet'),{code:'BTC_ADDRESS_NETWORK'});
});
test('BTC receive rejects malformed selection, scalars, uncompressed keys and invalid curve points',()=>{
  for(const input of [{...selection,index:-1},{...selection,index:2**31},{...selection,index:0.5},{...selection,network:'__proto__' as never},{...selection,vaultAccount:'0x'+'0'.repeat(40)}])assert.throws(()=>bitcoinOwnedReceivePath(input),{code:'BTC_RECEIVE_SELECTION_INVALID'});
  for(const key of ['00'.repeat(32),'04'+'00'.repeat(64),'02'+'ff'.repeat(32),key0.toUpperCase()])assert.throws(()=>projectBitcoinOwnedReceiveAddress(selection,key),{code:'BTC_RECEIVE_PUBLIC_KEY_INVALID'});
});
test('BTC receive refuses foreign account/path/address/key or extra secret fields at the public boundary',()=>{
  const dto=projectBitcoinOwnedReceiveAddress(selection,key0);
  for(const raw of [{...dto,vaultAccount:'ynx1'+'p'.repeat(38)},{...dto,path:"m/84'/0'/0'/1/0"},{...dto,address:dto.address.toUpperCase()},{...dto,networkVerified:true},{...dto,privateKey:'PUBLIC-invalid'},{...dto,phrase:'PUBLIC-invalid'},{...dto,publicKey:'03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77'}])assert.throws(()=>validateBitcoinOwnedReceiveAddress(selection,raw));
  let invoked=false;const getter={...dto};Object.defineProperty(getter,'publicKey',{get:()=>{invoked=true;return key0;}});
  assert.throws(()=>validateBitcoinOwnedReceiveAddress(selection,getter));assert.equal(invoked,false);
});
