import assert from 'node:assert/strict';
import test from 'node:test';
import {ynxAddressFromEVM} from '../../../packages/wallet-auth/src/crypto.js';
import {privateSubjectMatchesSelectedWallet} from '../web/private-subject-boundary.js';

const a='0x'+'a'.repeat(40),b='0x'+'b'.repeat(40);
const session={account:ynxAddressFromEVM(a)};

test('approved private subject remains separate but cannot serve a different selected Standard Wallet account',()=>{
  assert.equal(privateSubjectMatchesSelectedWallet(session,{status:'disconnected'}),true);
  assert.equal(privateSubjectMatchesSelectedWallet(session,{status:'connecting'}),false);
  assert.equal(privateSubjectMatchesSelectedWallet(session,{status:'connected',account:a,chainId:'0x1917'}),true);
  assert.equal(privateSubjectMatchesSelectedWallet(session,{status:'connected',account:b,chainId:'0x1917'}),false);
  assert.equal(privateSubjectMatchesSelectedWallet(session,{status:'connected',account:a,chainId:'0x1'}),false);
  assert.equal(privateSubjectMatchesSelectedWallet({account:'ynx1invalid'},{status:'connected',account:a,chainId:'0x1917'}),false);
});
