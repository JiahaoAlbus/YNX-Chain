import test from 'node:test';
import assert from 'node:assert/strict';
import {walletIdentity} from '@ynx-chain/wallet-auth';
import {createPaymentURI} from '../chain/paymentRequest';
import {parseWalletScan} from './walletScan';
const address=walletIdentity('01'.padStart(64,'0')).account;
const uri=`wc:${'a'.repeat(64)}@2?relay-protocol=irn&symKey=${'b'.repeat(64)}`;
test('receiving scan uses original native network parser without relay access',()=>{
 for(const value of [address,createPaymentURI(address)]){
  const result=parseWalletScan(value);assert.equal(result.kind,'payment');
  if(result.kind==='payment'){assert.equal(result.payment.recipient,address);assert.equal(result.payment.chainId,'ynx_6423-1');}
 }
});
test('WC scan only classifies original strict request for explicit review',()=>{
 const result=parseWalletScan(uri);assert.equal(result.kind,'walletconnect');
 if(result.kind==='walletconnect')assert.equal(result.uri,uri);
});
test('wrong network, asset, unknown callback and arbitrary URL never reach either route',()=>{
 for(const value of [createPaymentURI(address).replace('6423','1'),createPaymentURI(address).replace('YNXT','ETH'),createPaymentURI(address)+'&callback=https://example.com','https://example.com',`wc:${'a'.repeat(64)}@1?relay-protocol=irn&symKey=${'b'.repeat(64)}`,null,'x'.repeat(2049)])assert.throws(()=>parseWalletScan(value));
});
