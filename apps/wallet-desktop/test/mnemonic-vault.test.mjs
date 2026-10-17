import test from 'node:test';
import assert from 'node:assert/strict';
import {mnemonicAccountFromEntropy} from '../src/mnemonic-account.mjs';
import {createPasswordVault,rewritePasswordVault,unlockPasswordVault,decryptPasswordVaultRecord,decryptPasswordVaultMnemonic,closePasswordVaultSession} from '../src/password-vault-crypto.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
const password='Public synthetic fixture password';
const fixture=mnemonicAccountFromEntropy('00'.repeat(16));
test('encrypted entropy restores phrase while preserving original V3 private-key records',async()=>{
 const old=await createPasswordVault({password,accounts:[{secretHex:'1'.padStart(64,'0')}]});
 const oldBytes=JSON.stringify(old.vault),originalRecord=structuredClone(old.vault.records[0]);
 const next=await rewritePasswordVault(old.vault,{accounts:[...old.vault.accounts,{secretHex:fixture.secretHex,mnemonicEntropyHex:fixture.entropyHex}],activeAccount:fixture.account},old.session);
 assert.equal(JSON.stringify(old.vault),oldBytes);assert.deepEqual(next.vault.records[0],originalRecord);
 assert.equal(JSON.stringify(next.vault).includes(fixture.phrase),false);assert.equal(JSON.stringify(next.vault).includes(fixture.secretHex),false);
 const cold=await unlockPasswordVault(JSON.stringify(next.vault),password);
 assert.equal(await decryptPasswordVaultRecord(next.vault,fixture.account,cold),fixture.secretHex);
 assert.equal((await decryptPasswordVaultMnemonic(next.vault,fixture.account,cold)).phrase,fixture.phrase);
 await assert.rejects(decryptPasswordVaultMnemonic(next.vault,old.vault.activeAccount,cold),error=>error.code==='MNEMONIC_NOT_AVAILABLE');
 for(const session of [old.session,next.session,cold])closePasswordVaultSession(session);
 await assert.rejects(decryptPasswordVaultMnemonic(next.vault,fixture.account,cold),error=>error.code==='PASSWORD_VAULT_SESSION_INVALID');
});
test('seed stripping, ciphertext swaps, path changes and wrong identity fail closed',async()=>{
 const first=await createPasswordVault({password,accounts:[{secretHex:fixture.secretHex,mnemonicEntropyHex:fixture.entropyHex}]});
 for(const alter of [v=>delete v.records[0].mnemonic,v=>v.records[0].mnemonic.path="m/0",v=>v.records[0].mnemonic.cipher=v.records[0].cipher]){
  const changed=structuredClone(first.vault);alter(changed);await assert.rejects(unlockPasswordVault(changed,password));
 }
 await assert.rejects(rewritePasswordVault(first.vault,{accounts:[{...first.vault.accounts[0],secretHex:fixture.secretHex,mnemonicEntropyHex:'01'.repeat(16)}]},first.session),error=>error.code==='PASSWORD_VAULT_IDENTITY_MISMATCH');
 closePasswordVaultSession(first.session);
});
test('lock after mnemonic decrypt suppresses outward secret delivery',async()=>{
 const first=await createPasswordVault({password,accounts:[{secretHex:fixture.secretHex,mnemonicEntropyHex:fixture.entropyHex}]});
 await assert.rejects(decryptPasswordVaultMnemonic(first.vault,fixture.account,first.session,{guard(stage){if(stage==='mnemonic-decrypt:after')closePasswordVaultSession(first.session)}}),error=>error.code==='PASSWORD_VAULT_SESSION_INVALID');
});
async function repository(t,now=Date.now){
 const directory=await mkdtemp(join(tmpdir(),'ynx-public-mnemonic-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const life=new DesktopKeyLifecycle();life.setFocused(true);
 const filePath=join(directory,'vault.json'),vault=new PasswordWalletVault({filePath,authorization:life,now});life.authorizer=vault.authorizer();t.after(()=>life.lock());
 await life.custody(guard=>vault.setup({password,confirmation:password},guard));await life.unlock({password});return {life,vault,filePath};
}
test('normal backup confirmation bridges exactly one owned account-change revision and cold restores seed',async t=>{
 const f=await repository(t),review=await f.life.run(()=>f.vault.prepareMnemonicAccount({wordCount:24}));
 assert.equal((await f.vault.status()).accounts.length,0);
 assert.throws(()=>f.vault.consumeMnemonicCommit({id:review.id,words:['wrong','wrong','wrong']},true),error=>error.data.code==='MNEMONIC_BACKUP_NOT_CONFIRMED');
 const words=review.indexes.map(index=>review.phrase.split(' ')[index]);
 const commit=f.vault.consumeMnemonicCommit({id:review.id,words},true);f.life.cancelOperations();
 const status=await f.life.run(commit);assert.equal(status.account,review.account);assert.equal(status.accounts.length,1);
 await assert.rejects(f.life.run(commit),error=>error.data.code==='WALLET_OPERATION_CANCELLED');
 f.life.setAccount(status.account);await f.life.unlock({password});
 await assert.rejects(f.life.run(()=>f.vault.recoveryPhrase('incorrect synthetic password')));
 assert.equal((await f.life.run(()=>f.vault.recoveryPhrase(password))).phrase,review.phrase);
 const bytes=await readFile(f.filePath,'utf8');assert.equal(bytes.includes(review.phrase),false);
 const cold=await unlockPasswordVault(bytes,password);assert.equal((await decryptPasswordVaultMnemonic(bytes,status.account,cold)).phrase,review.phrase);closePasswordVaultSession(cold);
});
test('cancel and lock retire a new-account phrase without committing any account',async t=>{
 const f=await repository(t),review=await f.life.run(()=>f.vault.prepareMnemonicAccount());f.vault.cancelMnemonicAccount();
 assert.throws(()=>f.vault.consumeMnemonicCommit({id:review.id,words:review.indexes.map(i=>review.phrase.split(' ')[i])}),error=>error.data.code==='MNEMONIC_REVIEW_EXPIRED');
 const next=await f.life.run(()=>f.vault.prepareMnemonicAccount());f.life.lock();
 assert.throws(()=>f.vault.consumeMnemonicCommit({id:next.id,words:next.indexes.map(i=>next.phrase.split(' ')[i])}),error=>error.data.code==='MNEMONIC_REVIEW_EXPIRED');
 assert.equal((await f.vault.status()).accounts.length,0);
});
test('extra cancellation revision rejects a consumed commit and imported mnemonic remains recoverable',async t=>{
 const f=await repository(t),review=await f.life.run(()=>f.vault.prepareMnemonicAccount());
 const commit=f.vault.consumeMnemonicCommit({id:review.id,words:review.indexes.map(i=>review.phrase.split(' ')[i])},true);
 f.life.cancelOperations();f.life.cancelOperations();await assert.rejects(f.life.run(commit),error=>error.data.code==='WALLET_OPERATION_CANCELLED');
 assert.equal((await f.vault.status()).accounts.length,0);
 const status=await f.life.run(()=>f.vault.importAccount({kind:'recovery-phrase',value:fixture.phrase}));f.life.setAccount(status.account);await f.life.unlock({password});
 assert.equal((await f.life.run(()=>f.vault.recoveryPhrase(password))).phrase,fixture.phrase);
});
test('account-change failure disposes an uninvoked mnemonic handoff without writing an account',async t=>{
 const f=await repository(t),review=await f.life.run(()=>f.vault.prepareMnemonicAccount());
 const commit=f.vault.consumeMnemonicCommit({id:review.id,words:review.indexes.map(i=>review.phrase.split(' ')[i])},true);
 try{throw new Error('Synthetic account action already in progress')}catch{}finally{commit.dispose()}
 commit.dispose();f.life.cancelOperations();
 await assert.rejects(f.life.run(commit),error=>error.data.code==='WALLET_OPERATION_CANCELLED');
 assert.equal((await f.vault.status()).accounts.length,0);
});
test('encrypted JSON backup imports the same account and preserves its recovery phrase',async t=>{
 const sender=await repository(t),recipient=await repository(t);
 const status=await sender.life.run(()=>sender.vault.importAccount({kind:'recovery-phrase',value:fixture.phrase}));
 sender.life.setAccount(status.account);await sender.life.unlock({password});
 const backup=await sender.life.run(()=>sender.vault.encryptedBackup(password));
 assert.equal(backup.includes(fixture.phrase),false);assert.equal(backup.includes(fixture.secretHex),false);
 const restored=await recipient.life.run(()=>recipient.vault.importAccount({kind:'encrypted-json',value:backup,password}));
 assert.equal(restored.account,status.account);recipient.life.setAccount(restored.account);await recipient.life.unlock({password});
 assert.equal((await recipient.life.run(()=>recipient.vault.recoveryPhrase(password))).phrase,fixture.phrase);
});
test('explicit password reset from mnemonic preserves seed and archives the old encrypted generation',async t=>{
 const f=await repository(t),nextPassword='Another public synthetic password';
 const status=await f.life.run(()=>f.vault.importAccount({kind:'recovery-phrase',value:fixture.phrase}));f.life.setAccount(status.account);
 const original=await readFile(f.filePath,'utf8');
 const preview=await f.life.custody(guard=>f.vault.prepareRecovery({account:status.account,kind:'recovery-phrase',value:fixture.phrase,resetPassword:true,newPassword:nextPassword,confirmation:nextPassword},guard));
 await f.life.custody(guard=>f.vault.commitRecovery(preview.previewId,guard));await f.life.unlock({password:nextPassword});
 assert.equal((await f.life.run(()=>f.vault.recoveryPhrase(nextPassword))).phrase,fixture.phrase);
 const history=await f.vault.recoveryHistory();assert.equal(history.length,1);
 const old=await unlockPasswordVault(original,password);assert.equal((await decryptPasswordVaultMnemonic(original,status.account,old)).phrase,fixture.phrase);closePasswordVaultSession(old);
});
test('review expiry before consumption or before publication cannot create an account',async t=>{
 let clock=Date.now();const f=await repository(t,()=>clock);
 const first=await f.life.run(()=>f.vault.prepareMnemonicAccount());clock=first.expiresAt;
 assert.throws(()=>f.vault.consumeMnemonicCommit({id:first.id,words:first.indexes.map(i=>first.phrase.split(' ')[i])}),error=>error.data.code==='MNEMONIC_REVIEW_EXPIRED');
 const next=await f.life.run(()=>f.vault.prepareMnemonicAccount());
 const commit=f.vault.consumeMnemonicCommit({id:next.id,words:next.indexes.map(i=>next.phrase.split(' ')[i])},true);
 f.life.cancelOperations();clock=next.expiresAt;
 await assert.rejects(f.life.run(commit),error=>error.data.code==='WALLET_OPERATION_CANCELLED');
 assert.equal((await f.vault.status()).accounts.length,0);
});
test('actual main IPC and account-change helper commit once, lock the new account and emit its public status',async t=>{
 const f=await repository(t),review=await f.life.run(()=>f.vault.prepareMnemonicAccount());
 const source=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),handlers=new Map(),events=[];
 const context={handleWalletIPC:(name,handler)=>handlers.set(name,handler),safeIPC:action=>action(),walletAuthority:{vault:f.vault,expire(){}},keyAccess:f.life,
  accountChangeInProgress:false,walletConnectProposalActions:new Map(),walletConnectProposalAccounts:new Map(),walletConnectRequests:new Map(),
  walletConnectInbox:{pending:()=>[]},walletConnect:{sessions:()=>[]},nativeWallet:{clear(){}},authorizationController:{pending:null,cancel:()=>false,refreshAccount:async()=>null},
  mainWindow:{isDestroyed:()=>false,webContents:{send:(...args)=>events.push(args)}},recordEvidence:async()=>{},rpcStatus:async()=>({})};
 const handlerStart=source.indexOf('handleWalletIPC("wallet:commit-mnemonic-account"'),handlerEnd=source.indexOf('handleWalletIPC("wallet:recovery-phrase"',handlerStart);
 const helperStart=source.indexOf('async function changeActiveAccount(change)'),helperEnd=source.indexOf('async function custodyChange(',helperStart);
 assert.ok(handlerStart>=0&&handlerEnd>handlerStart&&helperStart>=0&&helperEnd>helperStart);
 runInNewContext(source.slice(helperStart,helperEnd)+source.slice(handlerStart,handlerEnd),context);
 const input={id:review.id,words:review.indexes.map(i=>review.phrase.split(' ')[i])};
 const result=await handlers.get('wallet:commit-mnemonic-account')(null,input);
 assert.equal(result.account,review.account);assert.equal(result.accounts.length,1);assert.equal(f.life.status().locked,true);
 assert.equal(events.filter(([name])=>name==='wallet:account-status-result').length,1);
 assert.equal(JSON.stringify(events).includes(review.phrase),false);
 await assert.rejects(handlers.get('wallet:commit-mnemonic-account')(null,input));
 assert.equal((await f.vault.status()).accounts.length,1);assert.equal(context.accountChangeInProgress,false);
 await f.life.unlock({password});assert.equal((await f.life.run(()=>f.vault.recoveryPhrase(password))).phrase,review.phrase);
});
test('bare private-key password reset cannot silently discard a stored mnemonic',async t=>{
 const f=await repository(t),nextPassword='Another public synthetic password';
 const status=await f.life.run(()=>f.vault.importAccount({kind:'recovery-phrase',value:fixture.phrase}));f.life.setAccount(status.account);
 const before=await readFile(f.filePath,'utf8');
 await assert.rejects(f.life.custody(guard=>f.vault.prepareRecovery({account:status.account,kind:'private-key',value:fixture.secretHex,resetPassword:true,newPassword:nextPassword,confirmation:nextPassword},guard)),error=>error.data.code==='MNEMONIC_BACKUP_REQUIRED');
 assert.equal(await readFile(f.filePath,'utf8'),before);await f.life.unlock({password});
 assert.equal((await f.life.run(()=>f.vault.recoveryPhrase(password))).phrase,fixture.phrase);
});
