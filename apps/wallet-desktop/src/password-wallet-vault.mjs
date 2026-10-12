import { randomBytes, randomUUID,createPrivateKey,createPublicKey } from "node:crypto";
import {canonicalJSON,exactFields} from '../../../packages/wallet-auth/src/canonical.js';
import {captureOriginalRecoveryJSON} from '../../../packages/wallet-auth/src/original-operation-recovery-state.js';
import {createOriginalWalletServiceRoleEnrollmentCodec} from '../../../packages/wallet-auth/src/original-wallet-service-role-enrollment-state.js';
import {prepareOriginalWalletServiceAdmissionReview,prepareOriginalWalletServiceAdmissionHolderBinding,prepareOriginalWalletServiceAdmissionPublisher,signOriginalWalletServiceRuntimeObservation} from '../../../packages/wallet-auth/src/original-wallet-service-admission.js';
import {captureOriginalWalletServiceRuntimeObservation,assertOriginalWalletServiceRuntimeObservationCurrent} from '../../../packages/wallet-auth/src/original-wallet-service-runtime-observer.js';
import {reserveOriginalWalletServiceRuntimePublication,markOriginalWalletServiceRuntimePublicationUnknown,recordOriginalWalletServiceRuntimePublicationSigned,readOriginalWalletServiceRuntimePublication} from '../../../packages/wallet-auth/src/original-wallet-service-runtime-publication.js';
import {reserveOriginalWalletServiceAdmissionPublication,markOriginalWalletServiceAdmissionPublicationUnknown,recordOriginalWalletServiceAdmissionPublicationSigned,readOriginalWalletServiceAdmissionPublication,enterOriginalWalletServiceAdmissionDelivery,markOriginalWalletServiceAdmissionDeliveryUnknown,acknowledgeOriginalWalletServiceAdmissionDelivery} from '../../../packages/wallet-auth/src/original-wallet-service-admission-publication-state.js';
import {installOriginalWalletServiceAdmissionReceipt} from '../../../packages/wallet-auth/src/original-wallet-service-admission-installer.js';
import {retainOriginalAdmissionCustodian} from './original-admission-custodian.mjs';
import { Wallet, HDNodeWallet } from "ethers";
import {createMnemonicAccount as generateMnemonicAccount,importMnemonicAccount} from './mnemonic-account.mjs';
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey } from "@ynx-chain/wallet-auth";
import { keyAccessError } from "./key-lifecycle.mjs";
import {bindPermissionGuard} from "./permission-lease.mjs";
import { providerError } from "./desktop-wallet-vault.mjs";
import { PasswordVaultFile, vaultStorageError } from "./password-vault-file.mjs";
import { parsePasswordVault, readPasswordVaultPublicMetadata, createPasswordVault, unlockPasswordVault, rewritePasswordVault, decryptPasswordVaultRecord, decryptPasswordVaultMnemonic, closePasswordVaultSession,decryptPasswordVaultOriginalAdmissionCatalog } from "./password-vault-crypto.mjs";

const fail = (code, message) => { throw providerError(4100, code, message); };
const cancelled = () => keyAccessError("WALLET_OPERATION_CANCELLED");
const options = guard => ({ guard: () => guard.assert() });
const identityFor = secret => { const identity = walletIdentity(secret); return { account: evmAddressFromYNX(identity.account), ynxAccount: identity.account, publicKey: identity.accountPublicKey }; };
function passwordPair(password, confirmation) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) fail("PASSWORD_VAULT_PASSWORD_INVALID", "Use a local Wallet password of 12 to 256 characters.");
  if (password !== confirmation) fail("PASSWORD_CONFIRMATION_MISMATCH", "The two local Wallet passwords do not match.");
}
function legacyVault(text) {
  let value; try { value = JSON.parse(text); } catch { fail("WALLET_VAULT_INVALID", "The existing Wallet file is invalid. Keep it for offline recovery."); }
  if (value?.schemaVersion === 1) value = { schemaVersion: 2, activeAccount: value.account, accounts: [value] };
  if (value?.schemaVersion !== 2 || !Array.isArray(value.accounts) || value.accounts.length < 1 || value.accounts.length > 32) fail("WALLET_VAULT_INVALID", "The existing Wallet catalog is invalid.");
  const accounts = value.accounts.map(record => {
    try {
      if (walletIdentityFromPublicKey(record.publicKey) !== record.ynxAccount || evmAddressFromYNX(record.ynxAccount) !== record.account || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.encryptedSecret) || record.encryptedSecret.length > 16_384) throw new Error();
      let createdAtValid = false;
      try { createdAtValid = typeof record.createdAt === "string" && record.createdAt.length === 24 && new Date(record.createdAt).toISOString() === record.createdAt; } catch {}
      const label = record.label === undefined ? "" : record.label;
      if (!createdAtValid || typeof label !== "string" || label.length > 120 || Buffer.byteLength(label) > 480 || /[\u0000-\u001f\u007f]/u.test(label)) fail("LEGACY_METADATA_INVALID", "The existing Wallet has an unsupported account label or an unknown creation date. Keep the original file; migration cannot invent or discard that metadata.");
      return { account: record.account, ynxAccount: record.ynxAccount, publicKey: record.publicKey, label, createdAt: record.createdAt, state: "protected", encryptedSecret: record.encryptedSecret };
    } catch (error) { if (error?.data?.code === "LEGACY_METADATA_INVALID") throw error; fail("WALLET_VAULT_INVALID", "An existing Wallet account does not match its public identity."); }
  });
  if (new Set(accounts.map(record => record.account)).size !== accounts.length || !accounts.some(record => record.account === value.activeAccount)) fail("WALLET_VAULT_INVALID", "The existing Wallet catalog is invalid.");
  return { accounts, activeAccount: value.activeAccount };
}
const publicLegacy = ({ encryptedSecret, ...record }) => record;
const originalProductionContexts=new WeakMap();
// Private source inventory: structural callbacks/DTOs cannot register custody.
// Only actual acquire below inserts after the same Vault resources validate.
export function captureOriginalAdmissionProductionContext(ref){
  const context=originalProductionContexts.get(ref);
  if(!context)fail('ADMISSION_ORIGINAL_OWNER_REQUIRED','Original same-Vault context is absent.');
  return context;
}

/** Password-encrypted V3 custody. OS storage is read only during explicit migration. */
export class PasswordWalletVault {
  #session = null; #digest = null; #preview = null; #previewEpoch = 0; #mutations = Promise.resolve();
  #mnemonicDraft = null; #mnemonicEpoch = 0;
  constructor({ filePath, legacyFilePaths = [], safeStorage, authorization, fileStore = new PasswordVaultFile(filePath), randomSecret = () => randomBytes(32).toString("hex"), now = Date.now } = {}) {
    if (!filePath || !authorization) throw new Error("Password Wallet requires storage and authorization");
    this.filePath = filePath; this.files = fileStore; this.legacyFilePaths = [...new Set(legacyFilePaths)]; this.safeStorage = safeStorage; this.authorization = authorization; this.randomSecret = randomSecret; this.now = now;
  }
  authorizer() { return Object.freeze({ available: () => true, method: "local-password-encrypted-vault", inProcess: true, authenticate: (input, guard) => this.authenticate(input, guard), invalidate: () => this.lock() }); }
  lock() { closePasswordVaultSession(this.#session); this.#session = null; this.#digest = null; this.cancelRecovery(); this.cancelMnemonicAccount(); }
  cancelMnemonicAccount() {this.#mnemonicEpoch++;const draft=this.#mnemonicDraft;this.#mnemonicDraft=null;if(draft){clearTimeout(draft.timer);draft.phrase=null;draft.secretHex=null;draft.entropyHex=null;}}
  async prepareMnemonicAccount(input={}) {
    const guard=this.authorization.current();this.cancelMnemonicAccount();const epoch=this.#mnemonicEpoch;
    return this.#serialize(async()=>{
      const current=await this.#readUnlocked(guard);
      if(epoch!==this.#mnemonicEpoch)throw cancelled();
      if(current.vault.accounts.length>=32)fail("ACCOUNT_LIMIT","This Wallet supports up to 32 accounts.");
      const material=generateMnemonicAccount(input,()=>guard.assert()),id=randomUUID(),expiresAt=this.now()+120_000;
      const indexes=[0,Math.floor(material.wordCount/2),material.wordCount-1];
      const security=this.authorization.status();
      const draft={...material,id,indexes,expiresAt,scopeAccount:security.account,scopeRevision:security.revision,digest:current.snapshot.digest};
      draft.timer=setTimeout(()=>{if(this.#mnemonicDraft===draft)this.cancelMnemonicAccount()},120_000);draft.timer.unref?.();
      this.#mnemonicDraft=draft;guard.assert();
      return {id,phrase:material.phrase,path:material.path,wordCount:material.wordCount,account:material.account,ynxAccount:material.ynxAccount,indexes,expiresAt};
    });
  }
  consumeMnemonicCommit({id,words}={},advanceRevision=false) {
    const draft=this.#mnemonicDraft;
    if(!draft||draft.id!==id||this.now()>=draft.expiresAt)fail("MNEMONIC_REVIEW_EXPIRED","Reopen new Wallet and back up a fresh recovery phrase.");
    this.authorization.assertUnlocked();
    const security=this.authorization.status();
    if(security.account!==draft.scopeAccount||security.revision!==draft.scopeRevision)throw cancelled();
    if(!Array.isArray(words)||words.length!==3||words.some((word,index)=>typeof word!=="string"||word.trim()!==draft.phrase.split(" ")[draft.indexes[index]]))fail("MNEMONIC_BACKUP_NOT_CONFIRMED","The recovery words do not match. Check your offline backup.");
    const reviewed={secretHex:draft.secretHex,entropyHex:draft.entropyHex,digest:draft.digest,expiresAt:draft.expiresAt,account:draft.scopeAccount,revision:draft.scopeRevision+(advanceRevision?1:0)};
    this.cancelMnemonicAccount();let used=false;
    // Internal single-use handoff through the existing account-change cancellation.
    // No renderer token, fresh unlock, arbitrary generation or changed account can use it.
    let retirement;
    const dispose=()=>{used=true;clearTimeout(retirement);reviewed.secretHex=null;reviewed.entropyHex=null};
    const commit=async()=>{
      if(used)throw cancelled();used=true;
      try{return await this.#add({kind:"private-key",value:reviewed.secretHex},false,reviewed.entropyHex,reviewed.digest,reviewed)}finally{dispose()}
    };
    retirement=setTimeout(dispose,Math.max(0,reviewed.expiresAt-this.now()));retirement.unref?.();
    Object.defineProperty(commit,"dispose",{value:dispose});
    return commit;
  }
  async commitMnemonicAccount(input) {return this.consumeMnemonicCommit(input)();}
  async recoveryPhrase(password) {
    const guard=this.authorization.current(),current=await this.#readUnlocked(guard);let session;
    try{
      session=await unlockPasswordVault(current.snapshot.text,password,options(guard));
      await this.files.assertCurrent(current.snapshot.digest,guard);
      const result=await decryptPasswordVaultMnemonic(current.vault,current.vault.activeAccount,session,options(guard));
      guard.assert();return result;
    }finally{closePasswordVaultSession(session);password=null}
  }
  cancelRecovery() { this.#previewEpoch++; if (this.#preview) { clearTimeout(this.#preview.timer); closePasswordVaultSession(this.#preview.candidate.session); this.#preview = null; } }
  async #legacy() {
    const sources = [];
    for (const filePath of this.legacyFilePaths) { const snapshot = await this.files.read(filePath, { legacy: true }); if (snapshot) sources.push({ filePath, snapshot, vault: legacyVault(snapshot.text) }); }
    const accounts = [];
    for (const source of sources) for (const record of source.vault.accounts) {
      const old = accounts.find(item => item.account === record.account);
      if (!old) accounts.push(publicLegacy(record));
      else if (old.publicKey !== record.publicKey || old.ynxAccount !== record.ynxAccount) fail("WALLET_VAULT_INVALID", "Existing Wallet files disagree on an account identity.");
    }
    if (accounts.length > 32) fail("ACCOUNT_LIMIT", "Existing Wallet files contain more than 32 accounts. Preserve them for separate recovery.");
    return { sources, accounts, activeAccount: sources[0]?.vault.activeAccount ?? null };
  }
  async status() {
    // On Windows a reader opened during native replacement may prevent the
    // old encrypted file from being renamed. The entire public read holds a
    // queue slot, so a mutation arriving after it cannot race its read handle.
    return this.#serialize(() => this.#readStatus());
  }
  async #readStatus() {
    const snapshot = await this.files.read();
    let catalog, custody, formatError = null, configured = snapshot !== null;
    if (snapshot) {
      catalog = readPasswordVaultPublicMetadata(snapshot.text); // Never fall back to OS-only keys when V3 exists.
      try { parsePasswordVault(snapshot.text); } catch (error) { formatError = error?.data?.code ?? "PASSWORD_VAULT_INVALID"; }
      custody = "password-encrypted-local";
    } else { const legacy = await this.#legacy(); catalog = legacy; custody = legacy.accounts.length ? "legacy-migration-required" : "not-created"; }
    const active = catalog.accounts.find(record => record.account === catalog.activeAccount) ?? null;
    const legacyFilesPresent = (await Promise.all(this.legacyFilePaths.map(filePath => this.files.exists(filePath)))).some(Boolean);
    return Object.freeze({ initialized: active !== null, account: active?.account ?? null, ynxAccount: active?.ynxAccount ?? null, accounts: Object.freeze(catalog.accounts.map(record => Object.freeze({ ...record, ...(formatError ? { state: "recovery-required" } : {}) }))), custody, passwordConfigured: configured, recoveryRequired: Boolean(formatError || active?.state === "recovery-required"), formatError, catalogAuthenticated: Boolean(snapshot && this.#session && this.#digest === snapshot.digest), legacyCleanupPending: configured && legacyFilesPresent, secretExported: false });
  }
  async authenticate({ password } = {}, guard) {
    guard.assert(); const snapshot = await this.files.read(); guard.assert();
    if (!snapshot) fail("PASSWORD_VAULT_NOT_CONFIGURED", "Set a local password or explicitly migrate the existing Wallet first.");
    let session;
    try {
      session = await unlockPasswordVault(snapshot.text, password, options(guard));
      await this.files.assertCurrent(snapshot.digest, guard);
      return Object.freeze({ account: parsePasswordVault(snapshot.text).activeAccount, commit: () => { guard.assert(); closePasswordVaultSession(this.#session); this.#session = session; this.#digest = snapshot.digest; }, discard: () => closePasswordVaultSession(session) });
    } catch (error) { closePasswordVaultSession(session); throw error; }
  }
  #serialize(action) { const result = this.#mutations.then(action); this.#mutations = result.catch(() => {}); return result; }
  async #readUnlocked(guard) {
    guard.assert(); const snapshot = await this.files.read(); guard.assert();
    if (!snapshot || !this.#session || this.#digest !== snapshot.digest) { this.authorization.lock(); throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED"); }
    return { snapshot, vault: parsePasswordVault(snapshot.text), session: this.#session };
  }
  async #originalAdmissionContext(input,review,observer){
    if(!review||typeof review.assert!=='function'||typeof review.assertAdmissionSuccession!=='function')fail('SERVICE_ADMISSION_SUCCESSION_NOT_SUPPLIED','Original finite review is absent.');
    review.assert();review.assertAdmissionSuccession(input.expectedRequest);
    const at=this.now();
    if(!Number.isSafeInteger(at)||at<input.expectedRequest.requestedAtMs||at>=input.expiresAtMs||input.expiresAtMs>input.expectedRequest.expiresAtMs||input.expiresAtMs-at>120000)fail('SERVICE_ADMISSION_REVIEW_EXPIRED','Original run budget expired.');
    const current=await this.#readUnlocked(review);
    const catalog=await decryptPasswordVaultOriginalAdmissionCatalog(current.vault,current.session,options(review));
    const roles=catalog.serviceRoleState,operation=roles.operations.find(op=>op.review.operationId===input.operationId);
    if(!operation)fail('SERVICE_ROLE_NOT_APPROVED','Original independently approved ROLE is absent.');
    const codec=createOriginalWalletServiceRoleEnrollmentCodec({rootAnchor:roles.rootAnchor,registryDigest:operation.review.registryDigest,targetConsumerManifestDigest:operation.review.targetConsumerManifestDigest,gatewayManifestDigest:operation.review.gatewayManifestDigest,now:()=>{review.assert();return this.now();}});
    const approved=codec.assertApproved(roles),receipt=approved.receipt.body;
    const source=prepareOriginalWalletServiceAdmissionHolderBinding(input.sourceSelection,()=>{review.assert();return new Date(this.now());}),binding=source.binding;
    if(review.account!==current.vault.activeAccount||receipt.operationId!==input.operationId||binding.rootId!==approved.rootAnchor.rootId||binding.rootKeyId!==approved.rootAnchor.rootKeyId||binding.rootPublicKey!==approved.rootAnchor.publicKey||binding.holderPublicKey!==approved.holderPublicKey||binding.registrationNonce!==receipt.nonce||binding.registryDigest!==receipt.registryDigest||binding.issuedAtMs<receipt.issuedAt||binding.expiresAtMs>receipt.roleExpiresAt||input.expiresAtMs>binding.expiresAtMs||input.expectedRequest.consumerManifestDigest!==receipt.targetConsumerManifestDigest||input.expectedRequest.gatewayManifestDigest!==receipt.gatewayManifestDigest||input.expectedRequest.registryDigest!==receipt.registryDigest)fail('SERVICE_ADMISSION_HOLDER_BINDING_MISMATCH','Original ROLE, same Vault and approved target differ.');
    const observation=captureOriginalWalletServiceRuntimeObservation(observer,catalog.runtimePublicationState.sequenceHighWater+1);
    for(const field of ['instanceId','currentReference','gatewayManifestDigest','registryDigest'])if(observation.binding[field]!==input.expectedRequest[field])fail('SERVICE_ADMISSION_RUNTIME_BINDING_MISMATCH','Original observed instance differs from the reviewed request.');
    assertOriginalWalletServiceRuntimeObservationCurrent(observer,observation);
    source.assertCurrent();await this.files.assertCurrent(current.snapshot.digest,review);
    review.assert();review.assertAdmissionSuccession(input.expectedRequest);
    const after=this.now();if(!Number.isSafeInteger(after)||after<at||after>=input.expiresAtMs)fail('SERVICE_ADMISSION_REVIEW_EXPIRED','Original finite review expired.');
    return {current,catalog,codec,approved,source,observation};
  }
  async acquireOriginalServiceAdmissionProduction(raw,review,observer){
    const input=captureOriginalRecoveryJSON(raw);
    exactFields(input,['operationId','sourceSelection','expectedRequest','receiptDirectory','expiresAtMs'],'Original admission production');
    prepareOriginalWalletServiceAdmissionReview(input.expectedRequest);
    if(!Number.isSafeInteger(input.expiresAtMs))fail('SERVICE_ADMISSION_REVIEW_EXPIRED','Invalid original deadline.');
    await this.#serialize(()=>this.#originalAdmissionContext(input,review,observer));
    const context=Object.freeze({});
    originalProductionContexts.set(context,Object.freeze({
      assertCurrent:()=>this.#serialize(async()=>{await this.#originalAdmissionContext(input,review,observer);return undefined;}),
      publish:(partial,businessCurrent)=>this.#serialize(()=>this.#produceOriginalAdmission(input,review,observer,partial,businessCurrent)),
      enterDelivery:async result=>{await this.enterOriginalServiceAdmissionDelivery(result.selection.expectedRequest.requestNonce,review);return undefined;},
      acknowledgeDelivery:async result=>{await this.acknowledgeOriginalServiceAdmissionDelivery({type:'ack',requestNonce:result.selection.expectedRequest.requestNonce,receiptDigest:result.selection.receiptSelection.receiptDigest,sequence:result.sequence,consumerManifestDigest:result.selection.expectedRequest.consumerManifestDigest},review);return undefined;},
      unknownDelivery:async(result,cause)=>{await this.markOriginalServiceAdmissionDeliveryUnknown(result.selection.expectedRequest.requestNonce,cause,review);return undefined;},
      // There is no external key/FD handle here: ephemeral key material is
      // wiped by the joined original publish finally. No retired guard call.
      dispose:()=>undefined,
    }));
    return retainOriginalAdmissionCustodian(context);
  }
  async #produceOriginalAdmission(input,review,observer,partial,businessCurrent){
    let {current,catalog,codec,approved,source,observation}=await this.#originalAdmissionContext(input,review,observer);
    if(catalog.runtimePublicationState.records.some(record=>record.nonce===input.expectedRequest.requestNonce||record.state!=='signed')||catalog.admissionPublicationState.records.some(record=>record.requestNonce===input.expectedRequest.requestNonce||record.state!=='signed'||record.delivery&&record.delivery.state!=='acknowledged'))fail('SERVICE_ADMISSION_ORIGINAL_UNRESOLVED','Read the original retained outcome; never renew or replay it.');
    const check=()=>{businessCurrent();review.assert();codec.assertApproved(catalog.serviceRoleState);source.assertCurrent();assertOriginalWalletServiceRuntimeObservationCurrent(observer,observation);businessCurrent();review.assert();};
    const persist=async next=>{
      check();const candidate=await rewritePasswordVault(current.vault,{originalAdmissionCatalog:next},current.session,options(review));check();
      await this.#publish(candidate,current.snapshot.digest,review,true,check);
      current=await this.#readUnlocked(review);check();
      const retained=await decryptPasswordVaultOriginalAdmissionCatalog(current.vault,current.session,options(review));check();
      if(canonicalJSON(retained)!==canonicalJSON(next))fail('SERVICE_ADMISSION_PUBLICATION_CHANGED','Original catalog readback differs.');
      catalog=retained;await this.files.assertCurrent(current.snapshot.digest,review);check();
    };
    // Admission request is the exact immutable approved intent, not a hidden
    // successor nonce/time tuple. The distinct private runtime catalog binds
    // the SAME reviewed intent nonce, so cold failure between runtime/admission
    // cannot reacquire another nonce and sign the same intent again.
    check();partial.runtimeNonce=input.expectedRequest.requestNonce;partial.requestNonce=input.expectedRequest.requestNonce;partial.phase='runtime';
    const reservation=reserveOriginalWalletServiceRuntimePublication(catalog.runtimePublicationState,{binding:observation.binding,nonce:partial.runtimeNonce,observationRaw:observation.observationRaw});
    // Reserve enough capacity before ONE actual sign. Never erase old history.
    if(Buffer.byteLength(canonicalJSON(current.vault))+2*Buffer.byteLength(canonicalJSON({...catalog,runtimePublicationState:reservation.state}))+32768>65536)fail('SERVICE_RUNTIME_CAPACITY','Original catalog capacity is exhausted.');
    await persist({...catalog,runtimePublicationState:reservation.state});
    await persist({...catalog,runtimePublicationState:markOriginalWalletServiceRuntimePublicationUnknown(catalog.runtimePublicationState,partial.runtimeNonce).state});
    let privateBytes;
    try{
      privateBytes=Buffer.from(catalog.serviceRoleState.holder.privateKeyPKCS8,'base64url');
      const key=createPrivateKey({key:privateBytes,format:'der',type:'pkcs8'});
      if(createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('base64url')!==approved.holderPublicKey)fail('SERVICE_ROLE_CUSTODY_MISMATCH','Original holder identity differs.');
      const clock=()=>{check();return new Date(this.now());};
      check();const runtimeRaw=signOriginalWalletServiceRuntimeObservation(input.sourceSelection,key,observation.observationRaw,clock);partial.runtime=runtimeRaw;check();
      await persist({...catalog,runtimePublicationState:recordOriginalWalletServiceRuntimePublicationSigned(catalog.runtimePublicationState,partial.runtimeNonce,runtimeRaw).state});
      const request=input.expectedRequest;
      review.assertAdmissionSuccession(request);check();const prepared=prepareOriginalWalletServiceAdmissionReview(request);
      const decision={requestRaw:prepared.requestRaw,reviewDigest:prepared.reviewDigest,decision:'approve',observedRuntimeRaw:runtimeRaw};source.validateReviewedOriginalPublication(decision);check();
      partial.phase='admission';
      const reserved=reserveOriginalWalletServiceAdmissionPublication(catalog.admissionPublicationState,{enrollmentOperationId:input.operationId,registrationNonce:approved.receipt.body.nonce,requestNonce:request.requestNonce,requestRaw:prepared.requestRaw,reviewDigest:prepared.reviewDigest,roleSource:source.binding,runtimeRaw});
      await persist({...catalog,admissionPublicationState:reserved.state});
      await persist({...catalog,admissionPublicationState:markOriginalWalletServiceAdmissionPublicationUnknown(catalog.admissionPublicationState,request.requestNonce).state});
      const publisher=prepareOriginalWalletServiceAdmissionPublisher(input.sourceSelection,key,clock);
      check();const signedRaw=publisher.publishReviewedOriginalAdmission(decision);partial.publication=signedRaw;check();
      await persist({...catalog,admissionPublicationState:recordOriginalWalletServiceAdmissionPublicationSigned(catalog.admissionPublicationState,request.requestNonce,signedRaw).state});
      partial.phase='install';
      const installed=installOriginalWalletServiceAdmissionReceipt(input.sourceSelection,{directory:input.receiptDirectory,expectedRequest:request},signedRaw,review,clock);
      partial.installed=installed;check();const receipt=JSON.parse(signedRaw);
      if(receipt.expiresAtMs>input.expiresAtMs||this.now()>=receipt.expiresAtMs)fail('SERVICE_ADMISSION_REVIEW_EXPIRED','Installed epoch expired.');
      partial.phase='installed';
      return Object.freeze({selection:Object.freeze({sourceSelection:input.sourceSelection,receiptSelection:installed.receiptSelection,expectedRequest:request,receiptDirectory:input.receiptDirectory}),sequence:observation.sequence,expiresAtMs:receipt.expiresAtMs,account:review.account});
    }finally{privateBytes?.fill(0);}
  }
  async readOriginalServiceAdmissionPublication(requestNonce,guard){
    return this.#serialize(async()=>{const current=await this.#readUnlocked(guard),catalog=await decryptPasswordVaultOriginalAdmissionCatalog(current.vault,current.session,options(guard));const result=readOriginalWalletServiceAdmissionPublication(catalog.admissionPublicationState,requestNonce);await this.files.assertCurrent(current.snapshot.digest,guard);guard.assert();return result;});
  }
  async readOriginalServiceRuntimePublication(nonce,guard){
    return this.#serialize(async()=>{const current=await this.#readUnlocked(guard),catalog=await decryptPasswordVaultOriginalAdmissionCatalog(current.vault,current.session,options(guard));const result=readOriginalWalletServiceRuntimePublication(catalog.runtimePublicationState,nonce);await this.files.assertCurrent(current.snapshot.digest,guard);guard.assert();return result;});
  }
  async #updateOriginalDelivery(requestNonce,guard,change){
    return this.#serialize(async()=>{
      let current=await this.#readUnlocked(guard);const catalog=await decryptPasswordVaultOriginalAdmissionCatalog(current.vault,current.session,options(guard));
      const changed=change(catalog.admissionPublicationState);guard.assert();if(changed.readOnly)return changed;
      const next={...catalog,admissionPublicationState:changed.state},candidate=await rewritePasswordVault(current.vault,{originalAdmissionCatalog:next},current.session,options(guard));
      await this.#publish(candidate,current.snapshot.digest,guard,true);current=await this.#readUnlocked(guard);
      const kept=await decryptPasswordVaultOriginalAdmissionCatalog(current.vault,current.session,options(guard));
      if(canonicalJSON(kept)!==canonicalJSON(next))fail('SERVICE_ADMISSION_PUBLICATION_CHANGED','Delivery catalog readback differs.');
      await this.files.assertCurrent(current.snapshot.digest,guard);guard.assert();return readOriginalWalletServiceAdmissionPublication(kept.admissionPublicationState,requestNonce);
    });
  }
  enterOriginalServiceAdmissionDelivery(requestNonce,guard){return this.#updateOriginalDelivery(requestNonce,guard,state=>enterOriginalWalletServiceAdmissionDelivery(state,requestNonce));}
  markOriginalServiceAdmissionDeliveryUnknown(requestNonce,cause,guard){return this.#updateOriginalDelivery(requestNonce,guard,state=>markOriginalWalletServiceAdmissionDeliveryUnknown(state,requestNonce,cause));}
  acknowledgeOriginalServiceAdmissionDelivery(ack,guard){return this.#updateOriginalDelivery(ack.requestNonce,guard,state=>acknowledgeOriginalWalletServiceAdmissionDelivery(state,ack));}
  async #verify(candidate, text, guard) {
    const vault = parsePasswordVault(text);
    // Check every protected identity before accepting a durable candidate, not just the active one.
    for (const record of vault.accounts) if (record.state === "protected") await decryptPasswordVaultRecord(vault, record.account, candidate.session, options(guard));
  }
  async #publish(candidate, expected, guard, install = false, beforeCommit) {
    try {
      const digest = await this.files.publish(candidate.vault, expected, guard, text => this.#verify(candidate, text, guard), beforeCommit);
      guard.assert();
      if (install) { closePasswordVaultSession(this.#session); this.#session = candidate.session; this.#digest = digest; }
      else closePasswordVaultSession(candidate.session);
    } catch (error) {
      closePasswordVaultSession(candidate.session); this.lock();
      let ownsGeneration = false; try { guard.assert(); ownsGeneration = true; } catch {}
      if (ownsGeneration) this.authorization.lock();
      throw error;
    }
  }
  async setup({ password, confirmation, migrateLegacy = false } = {}, guard, { beforePublish } = {}) {
    return this.#serialize(async () => {
      guard.assert(); passwordPair(password, confirmation);
      if (await this.files.read()) fail("PASSWORD_VAULT_ALREADY_CONFIGURED", "This Wallet already has a password. Unlock it or use explicit offline recovery.");
      const legacy = await this.#legacy(); guard.assert();
      if (legacy.accounts.length && migrateLegacy !== true) fail("LEGACY_MIGRATION_REQUIRED", "Review and explicitly migrate all existing local accounts before setting a password.");
      let candidate;
      try {
        candidate = await createPasswordVault({ password, accounts: [], activeAccount: null }, options(guard));
        // One plaintext key at a time; no unprotected migration journal and no deletion of old files.
        for (const source of legacy.sources) for (const record of source.vault.accounts) {
          guard.assert();
          if (!this.safeStorage?.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === "basic_text") fail("LEGACY_RECOVERY_REQUIRED", "OS protection is unavailable. Restore the existing accounts from offline backups.");
          let secret;
          try {
            try {
              if (typeof this.safeStorage.decryptStringAsync === "function") secret = (await this.safeStorage.decryptStringAsync(Buffer.from(record.encryptedSecret, "base64")))?.result;
              else secret = this.safeStorage.decryptString(Buffer.from(record.encryptedSecret, "base64"));
            } catch { fail("LEGACY_RECOVERY_REQUIRED", "An existing key could not be opened by the OS. All original files were kept for offline recovery."); }
            guard.assert();
            let identity; try { identity = identityFor(secret); } catch { fail("PASSWORD_VAULT_IDENTITY_MISMATCH", "An existing key does not match its public account."); }
            if (["account", "ynxAccount", "publicKey"].some(key => identity[key] !== record[key])) fail("PASSWORD_VAULT_IDENTITY_MISMATCH", "An existing key does not match its public account.");
            if (!candidate.vault.accounts.some(item => item.account === record.account)) {
              const next = await rewritePasswordVault(candidate.vault, { accounts: [...candidate.vault.accounts, { ...publicLegacy(record), secretHex: secret }], activeAccount: candidate.vault.activeAccount ?? record.account }, candidate.session, options(guard));
              closePasswordVaultSession(candidate.session); candidate = next;
            }
          } finally { secret = null; }
        }
        if (candidate.vault.activeAccount !== legacy.activeAccount) {
          const next = await rewritePasswordVault(candidate.vault, { activeAccount: legacy.activeAccount }, candidate.session, options(guard)); closePasswordVaultSession(candidate.session); candidate = next;
        }
        for (const source of legacy.sources) { const current = await this.files.read(source.filePath, { legacy: true }); guard.assert(); if (current?.digest !== source.snapshot.digest) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED"); }
        await this.#publish(candidate, null, guard, false, beforePublish);
        return this.#readStatus();
      } finally { closePasswordVaultSession(candidate?.session); password = null; confirmation = null; }
    });
  }
  async createAccount() { return this.#add(null, true); }
  async addAccountAndSelect() { return this.#add(null, false); }
  async importAccount(input) { return this.#add(input, false); }
  async #add(input, onlyFirst, reviewedEntropy, expectedDigest, review) {
    const lease = this.authorization.current();
    const guard=review?{...lease,assert:()=>{lease.assert();if(lease.account!==review.account||this.authorization.status().revision!==review.revision||this.now()>=review.expiresAt)throw cancelled()}}:lease;
    return this.#serialize(async () => {
      const current = await this.#readUnlocked(guard);
      if(expectedDigest!==undefined&&current.snapshot.digest!==expectedDigest)fail("MNEMONIC_REVIEW_EXPIRED","This Wallet changed. Prepare a fresh recovery phrase.");
      if (onlyFirst && current.vault.accounts.length) return this.#readStatus();
      if (current.vault.accounts.length >= 32) fail("ACCOUNT_LIMIT", "This Wallet supports up to 32 accounts.");
      let secret,material;
      try {
        if(input?.kind==="recovery-phrase")material=importMnemonicAccount({phrase:input.value,passphrase:input.passphrase??""},()=>guard.assert());
        else if(input)material=await importSecret(input,guard,true);
        secret = material?.secretHex ?? this.randomSecret(); guard.assert();
        const identity = identityFor(secret);
        if (current.vault.accounts.some(record => record.account === identity.account)) fail("DUPLICATE_ACCOUNT", "This account already exists. Use explicit recovery to restore its key.");
        const entropy=material?.entropyHex??reviewedEntropy;
        const candidate = await rewritePasswordVault(current.vault, { accounts: [...current.vault.accounts, { secretHex: secret,...(entropy?{mnemonicEntropyHex:entropy}:{}) }], activeAccount: identity.account }, current.session, options(guard));
        await this.#publish(candidate, current.snapshot.digest, guard, true); return this.#readStatus();
      } finally { secret = null;if(material){material.secretHex=null;material.entropyHex=null;material.phrase=null} }
    });
  }
  async selectAccount(account) {
    const guard = this.authorization.current();
    return this.#serialize(async () => {
      const current = await this.#readUnlocked(guard);
      if (!current.vault.accounts.some(record => record.account === account)) fail("UNKNOWN_WALLET_ACCOUNT", "The selected account does not exist.");
      const candidate = await rewritePasswordVault(current.vault, { activeAccount: account }, current.session, options(guard));
      await this.#publish(candidate, current.snapshot.digest, guard, true); return this.#readStatus();
    });
  }
  async withSecret(action, permission) {
    const guard = bindPermissionGuard(this.authorization.current(),permission), current = await this.#readUnlocked(guard), account = current.vault.activeAccount;
    if (!account) fail("ACCOUNT_NOT_CREATED", "Create or import an account first.");
    if (guard.account !== account) throw cancelled();
    let secret;
    try {
      secret = await decryptPasswordVaultRecord(current.vault, account, current.session, options(guard));
      await this.files.assertCurrent(current.snapshot.digest, guard);
      const record = current.vault.accounts.find(item => item.account === account);
      return await guard.step(() => action(secret, Object.freeze({ account, ynxAccount: record.ynxAccount, publicKey: record.publicKey }), guard));
    } finally { secret = null; }
  }
  /** Trusted-main callback only: never mount mnemonic material on account IPC.
   * Each chain derives its own reviewed path locally; an EVM key is not a seed.
   * Produced signing results must be retained inside action before step returns.
   */
  async withMnemonic(action, permission) {
    const guard = bindPermissionGuard(this.authorization.current(),permission), current = await this.#readUnlocked(guard), account = current.vault.activeAccount;
    if (!account) fail("ACCOUNT_NOT_CREATED", "Create or import an account first.");
    if (guard.account !== account) throw cancelled();
    let material;
    try {
      material = await decryptPasswordVaultMnemonic(current.vault,account,current.session,options(guard));
      await this.files.assertCurrent(current.snapshot.digest,guard);
      const record = current.vault.accounts.find(item => item.account === account);
      return await guard.step(() => action(material.phrase,Object.freeze({account,ynxAccount:record.ynxAccount,publicKey:record.publicKey}),guard));
    } finally { if (material) material.phrase = null; }
  }
  async encryptedBackup(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 1024) fail("BACKUP_PASSWORD_REQUIRED", "Use a backup password of at least 12 characters.");
    return this.withSecret(async secret => {
      const guard=this.authorization.current(),current=await this.#readUnlocked(guard);
      const record=current.vault.records.find(item=>item.account===current.vault.activeAccount);
      if(!record?.mnemonic)return new Wallet(`0x${secret}`).encrypt(password);
      const backup=await decryptPasswordVaultMnemonic(current.vault,current.vault.activeAccount,current.session,options(guard));
      try{return await HDNodeWallet.fromPhrase(backup.phrase,"",backup.path).encrypt(password)}finally{backup.phrase=null}
    });
  }
  async recoveryHistory() {
    const current = await this.status(), result = [];
    for (const id of (await this.files.history()).slice(0, 64)) {
      try {
        const snapshot = await this.files.readHistory(id), catalog = readPasswordVaultPublicMetadata(snapshot.text);
        result.push(Object.freeze({ id, revision: catalog.revision, accounts: catalog.accounts.filter(record => record.state === "protected" && current.accounts.some(item => item.account === record.account)).map(record => record.account) }));
      } catch { /* A damaged archive never becomes an alternate unlock path. */ }
    }
    return Object.freeze(result);
  }
  async prepareRecovery(input = {}, guard) {
    this.cancelRecovery();
    const outer = guard, epoch = this.#previewEpoch;
    guard = Object.freeze({ revision: outer.revision, assert: () => { outer.assert(); if (epoch !== this.#previewEpoch) throw cancelled(); } });
    guard.assert();
    const snapshot = await this.files.read(), legacy = snapshot ? null : await this.#legacy(); guard.assert();
    const catalog = snapshot ? readPasswordVaultPublicMetadata(snapshot.text) : legacy;
    const record = catalog.accounts.find(item => item.account === input.account);
    if (!record) fail("UNKNOWN_WALLET_ACCOUNT", "Recovery must match an existing public account.");
    let secret, candidate, currentSession, material;
    try {
      if (input.kind === "previous-password") {
        const archived = await this.files.readHistory(input.value); guard.assert();
        let oldSession;
        try {
          oldSession = await unlockPasswordVault(archived.text, input.backupPassword, options(guard)); secret = await decryptPasswordVaultRecord(archived.text, record.account, oldSession, options(guard));
          if(parsePasswordVault(archived.text).records.find(item=>item.account===record.account)?.mnemonic){const backup=await decryptPasswordVaultMnemonic(archived.text,record.account,oldSession,options(guard));material=importMnemonicAccount({phrase:backup.phrase},()=>guard.assert());backup.phrase=null;}
        }
        finally { closePasswordVaultSession(oldSession); }
      } else {material=await importSecret({ kind: input.kind, value: input.value, password: input.backupPassword ?? "",passphrase:input.passphrase??"" }, guard,true);secret=material.secretHex;}
      if (identityFor(secret).account !== record.account) fail("PASSWORD_VAULT_IDENTITY_MISMATCH", "This backup belongs to a different account. Existing accounts were kept.");
      if (input.resetPassword === true) {
        if(snapshot&&parsePasswordVault(snapshot.text).records.find(item=>item.account===record.account)?.mnemonic&&!material?.entropyHex)fail("MNEMONIC_BACKUP_REQUIRED","This account has a recovery phrase. Use that phrase or its mnemonic-preserving encrypted backup to reset the password without losing it.");
        passwordPair(input.newPassword, input.confirmation);
        candidate = await createPasswordVault({ password: input.newPassword, revision: (catalog.revision ?? 0) + 1, activeAccount: record.account, accounts: catalog.accounts.map(item => item.account === record.account ? { ...item, state: "protected", secretHex: secret,...(material?.entropyHex?{mnemonicEntropyHex:material.entropyHex}:{}) } : { ...item, state: "recovery-required" }) }, options(guard));
      } else {
        if (!snapshot) fail("PASSWORD_VAULT_NOT_CONFIGURED", "Set a new local password when recovering an OS-protected Wallet.");
        const vault = parsePasswordVault(snapshot.text);
        currentSession = await unlockPasswordVault(vault, input.currentPassword, options(guard));
        candidate = await rewritePasswordVault(vault, { accounts: vault.accounts.map(item => item.account === record.account ? { ...item, state: "protected", secretHex: secret,...(material?.entropyHex?{mnemonicEntropyHex:material.entropyHex}:{}) } : item), activeAccount: record.account }, currentSession, options(guard));
      }
      await this.files.assertCurrent(snapshot?.digest ?? null, guard);
      const previewId = randomUUID(), expiresAt = this.now() + 60_000;
      const preview = { id: previewId, expiresAt, revision: guard.revision, snapshot, legacy, candidate, account: record.account, resetPassword: input.resetPassword === true };
      guard.assert(); this.#preview = preview;
      preview.timer = setTimeout(() => { if (this.#preview === preview) this.cancelRecovery(); }, 60_000); preview.timer.unref?.();
      return Object.freeze({ previewId, account: record.account, resetPassword: preview.resetPassword, recoveryRequiredAccounts: candidate.vault.accounts.filter(item => item.state === "recovery-required").map(item => item.account), expiresAt });
    } catch (error) { closePasswordVaultSession(candidate?.session); throw error; }
    finally { closePasswordVaultSession(currentSession); secret = null;if(material){material.secretHex=null;material.entropyHex=null;material.phrase=null;} }
  }
  async commitRecovery(previewId, guard, { beforePublish } = {}) {
    return this.#serialize(async () => {
      const preview = this.#preview;
      if (!preview || preview.id !== previewId || preview.expiresAt <= this.now() || preview.revision !== guard.revision) { this.cancelRecovery(); throw cancelled(); }
      guard.assert();
      try {
        await this.files.assertCurrent(preview.snapshot?.digest ?? null, guard);
        if (preview.legacy) for (const source of preview.legacy.sources) { const current = await this.files.read(source.filePath, { legacy: true }); guard.assert(); if (current?.digest !== source.snapshot.digest) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED"); }
        // Preserve the exact old encrypted generation before replacing the password.
        // It can be used for later offline restoration of the remaining identities.
        if (preview.resetPassword) await this.files.preserve(preview.snapshot, guard);
        await this.#publish(preview.candidate, preview.snapshot?.digest ?? null, guard, false, async () => {
          guard.assert();
          if (this.#preview !== preview || preview.expiresAt <= this.now() || preview.revision !== guard.revision) throw cancelled();
          await beforePublish?.(); guard.assert();
          if (this.#preview !== preview || preview.expiresAt <= this.now()) throw cancelled();
        });
        return this.#readStatus();
      } finally { this.cancelRecovery(); }
    });
  }
}

/** Bounded import parser. Passwords and plaintext never enter public errors or journals. */
async function importSecret({ kind, value, password = "", passphrase="" } = {}, guard, includeMnemonic=false) {
  guard.assert();
  if (typeof value !== "string" || value.length < 1 || value.length > 100_000 || typeof password !== "string" || password.length > 1024) fail("INVALID_IMPORT", "Enter a valid Wallet backup.");
  let secret,entropyHex;
  try {
    if (kind === "private-key" && /^(0x)?[0-9a-fA-F]{64}$/.test(value.trim())) secret = new Wallet(value.trim().replace(/^(?!0x)/, "0x")).privateKey.slice(2);
    else if (kind === "recovery-phrase") {const material=importMnemonicAccount({phrase:value,passphrase},()=>guard.assert());secret=material.secretHex;entropyHex=material.entropyHex;}
    else if (kind === "encrypted-json") {
      const json = JSON.parse(value), crypto = json.crypto ?? json.Crypto, kdf = crypto?.kdfparams;
      if (json.version !== 3 || crypto?.cipher !== "aes-128-ctr" || !/^[0-9a-f]{64}$/i.test(crypto.ciphertext) || !/^[0-9a-f]{32}$/i.test(crypto.cipherparams?.iv) || !/^[0-9a-f]{64}$/i.test(crypto.mac) || !/^[0-9a-f]{32,128}$/i.test(kdf?.salt) || kdf.salt.length % 2 || kdf.dklen !== 32) throw new Error();
      if (crypto.kdf === "scrypt") { if (!Number.isSafeInteger(kdf.n) || kdf.n < 2 || kdf.n > 262_144 || (kdf.n & (kdf.n - 1)) !== 0 || !Number.isSafeInteger(kdf.r) || kdf.r < 1 || kdf.r > 8 || !Number.isSafeInteger(kdf.p) || kdf.p < 1 || kdf.p > 4 || kdf.n * kdf.r * kdf.p > 2_097_152) throw new Error(); }
      else if (crypto.kdf === "pbkdf2") { if (kdf.prf !== "hmac-sha256" || !Number.isSafeInteger(kdf.c) || kdf.c < 1 || kdf.c > 1_000_000) throw new Error(); }
      else throw new Error();
      const wallet=await Wallet.fromEncryptedJson(value,password);secret=wallet.privateKey.slice(2);
      if(wallet.mnemonic){const material=importMnemonicAccount({phrase:wallet.mnemonic.phrase,passphrase:wallet.mnemonic.password},()=>guard.assert());if(wallet.path!==material.path||material.secretHex!==secret)throw new Error();entropyHex=material.entropyHex;}
    } else throw new Error();
    guard.assert(); return includeMnemonic?{secretHex:secret,entropyHex}:secret;
  } catch (error) { if (error?.data?.code === "WALLET_OPERATION_CANCELLED") throw error; fail("INVALID_IMPORT", "The backup is invalid, uses unsupported encryption parameters, or its password is incorrect."); }
  finally { secret = null;entropyHex=null; }
}
