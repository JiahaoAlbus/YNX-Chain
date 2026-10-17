import test from 'node:test';
import assert from 'node:assert/strict';
import {createMnemonicAccount,importMnemonicAccount,mnemonicAccountFromEntropy,MNEMONIC_ACCOUNT_PATH} from '../src/mnemonic-account.mjs';
test('public BIP39 vector restores the same EVM/native identity with explicit path',()=>{
 const account=mnemonicAccountFromEntropy('00'.repeat(16));
 assert.equal(account.account,'0x9858effd232b4033e47d90003d41ec34ecaeda94');
 assert.equal(account.path,MNEMONIC_ACCOUNT_PATH);assert.equal(account.wordCount,12);
 assert.deepEqual(importMnemonicAccount({phrase:'  '+account.phrase.replaceAll(' ','\n')+'  '}),account);
});
test('all standard English word lengths import while generation offers 12 or 24',()=>{
 for(const bytes of [16,20,24,28,32]){const account=mnemonicAccountFromEntropy('00'.repeat(bytes));assert.equal(importMnemonicAccount({phrase:account.phrase}).secretHex,account.secretHex)}
 for(const wordCount of [12,24]){const first=createMnemonicAccount({wordCount}),second=createMnemonicAccount({wordCount});assert.equal(first.wordCount,wordCount);assert.notEqual(first.entropyHex,second.entropyHex)}
});
test('invalid checksum, extra passphrase and cancelled generation never become accounts',()=>{
 const phrase=mnemonicAccountFromEntropy('00'.repeat(16)).phrase;
 for(const value of [null,'secret',phrase.replace(/about$/,'abandon'),'x'.repeat(513)])assert.throws(()=>importMnemonicAccount({phrase:value}),error=>error.code==='MNEMONIC_INVALID'&&!error.message.includes(String(value)));
 assert.throws(()=>importMnemonicAccount({phrase,passphrase:'extra'}),error=>error.code==='MNEMONIC_PASSPHRASE_UNSUPPORTED');
 let calls=0;assert.throws(()=>createMnemonicAccount({},()=>{if(++calls===3)throw Error('cancelled')}),/cancelled/);
});
