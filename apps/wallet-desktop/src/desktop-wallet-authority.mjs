import { randomUUID,createHash } from "node:crypto";
import { Wallet, TypedDataEncoder, formatEther, getBytes, isAddress, isHexString } from "ethers";
import { createProductSessionReturnURL, parseProductSessionWalletURL, signProductSessionApproval,evmAddressFromYNX,ynxAddressFromEVM,productSessionRequestDigest,parseProductSessionApproval } from "@ynx-chain/wallet-auth";
import { providerError } from "./desktop-wallet-vault.mjs";
import { PRODUCT_SESSION_REGISTRY, YNX_TESTNET_CHAIN_QUANTITY } from "./wallet-auth-contract.mjs";
import { CENTRAL_BROWSER_METHOD, parseCentralSignIn, signCentralSignIn } from "./central-browser-sign-in.mjs";
import {PermissionEpoch,bindPermissionGuard} from "./permission-lease.mjs";
import {inspectPQWalletActionPolicy,planPQNativeTransfer,assertPQAuthorizationCurrent,pqRegisteredPublicBinding,planPQAccountMigration,preparePQClassicMigrationAuthorization,preparePQClassicMigrationProof,preparePQReviewedMigrationTransport,planPQAccountRevocation} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {signPQWalletNativeTransfer,createPQWalletMigrationPossession,signPQWalletProductSessionApproval,signPQWalletAccountRevocation} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {captureProductSessionAccountPolicy,readProductSessionAccountPolicy,pqProductSessionRegisteredPublicBinding} from '@ynx-chain/wallet-auth/product-session-account-policy';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval} from '@ynx-chain/wallet-auth/product-session-pq-approval';
import {pqPublicBindingToRegistrationKeys,encodePQNativeTransfer,decodePQTransferRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {readPQTransferOriginal} from './features/pq-transaction/transfer-binding.mjs';
import {pqBroadcastPermissionRequest} from './features/pq-transaction/submission.mjs';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './features/pq-transaction/typed-action-caller.mjs';
import {pqTypedSignPermissionRequest} from './wallet-pq-typed-permission.mjs';
import {PRIVATE_FILE_MAX_BYTES} from './bounded-private-file-read.mjs';
import {createPQOriginalRecord} from './wallet-pq-intent-record.mjs';
import {retainPQPolicyResource} from './wallet-pq-policy-owner.mjs';
import {assertSessionReturnTransport} from './wallet-session-return-boundary.mjs';
import {prepareSessionPublicationReturn,sessionPublicationOutcome} from './wallet-session-publication.mjs';

export const YNX_EIP155_CHAIN = "eip155:6423";
export const YNX_EVM_CHAIN_ID = YNX_TESTNET_CHAIN_QUANTITY;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_REQUESTS = 64;
const MAX_PENDING_REQUESTS_PER_ORIGIN = 8;
const originalPQTransactionReviewBorrows=new WeakSet();
export const isOriginalPQTransactionReviewBorrow=value=>originalPQTransactionReviewBorrows.has(value);
export const APPROVAL_METHODS = Object.freeze([
  "eth_requestAccounts",
  "wallet_requestPermissions",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "ynx_requestProductSessionV2",
  CENTRAL_BROWSER_METHOD
]);

export class DesktopWalletAuthority {
  #reviewLeases = new WeakMap();
  #activeReviews = new Map();
  #pqReviews = new WeakMap();
  #pqPolicySource; #pqPolicyRecognized; #pqNetworkId; #pqOwners=new Set();
  #pqSessionSource; #pqSessionRecognized;
  #sessionReturnClient;
  #pqAcquiring=false;
  #pqInFlight=new Set(); #pqShuttingDown=false; #pqShutdownPass=null;
  #pqTxSource; #pqTxRecognized; #pqTxOwners=new Set();
  #pqBroadcastSource;
  constructor({ vault, permissions, transactionSender, requestId = randomUUID, clock = () => new Date(), pqPolicySource = null, pqPolicyRecognized = null, pqNetworkId = null, pqSessionSource = null, pqSessionRecognized = null, sessionReturnClient = null, pqTransactionPermissionSource=null, pqTransactionPermissionRecognized=null, pqBroadcastSource=null }) {
    this.vault = vault;
    this.permissions = permissions;
    this.transactionSender = transactionSender;
    this.requestId = requestId;
    this.clock = clock;
    this.pending = new Map();
    // Fixed original-main supply only. No renderer DTO, parsed execution view,
    // session committed checkpoint or optional peer can manufacture this source.
    if(pqPolicySource!==null&&typeof pqPolicySource!=='function')throw Error('PQ_POLICY_SOURCE_INVALID');
    if(pqNetworkId!==null&&(typeof pqNetworkId!=='string'||! /^[0-9a-f]{64}$/.test(pqNetworkId)))throw Error('PQ_POLICY_NETWORK_INVALID');
    if(pqPolicyRecognized!==null&&typeof pqPolicyRecognized!=='function')throw Error('PQ_POLICY_PREDICATE_INVALID');
    this.#pqPolicySource=pqPolicySource;this.#pqPolicyRecognized=pqPolicyRecognized;this.#pqNetworkId=pqNetworkId;
    if(pqSessionSource!==null&&typeof pqSessionSource!=='function'||pqSessionRecognized!==null&&typeof pqSessionRecognized!=='function')throw Error('PQ_SESSION_SOURCE_INVALID');
    this.#pqSessionSource=pqSessionSource;this.#pqSessionRecognized=pqSessionRecognized;
    this.#sessionReturnClient=sessionReturnClient;
    if(pqTransactionPermissionSource!==null&&typeof pqTransactionPermissionSource!=='function'||pqTransactionPermissionRecognized!==null&&typeof pqTransactionPermissionRecognized!=='function')throw Error('PQ_TRANSACTION_PERMISSION_SOURCE_INVALID');
    this.#pqTxSource=pqTransactionPermissionSource;this.#pqTxRecognized=pqTransactionPermissionRecognized;
    if(pqBroadcastSource!==null&&typeof pqBroadcastSource!=='function')throw Error('PQ_BROADCAST_SOURCE_INVALID');this.#pqBroadcastSource=pqBroadcastSource;
  }
  #closePQ(owner,...causes){
    if(causes.length)owner.retire(causes[0]);
    const pass=owner.close();void pass.then(()=>{if(!owner.status().cleanupDebt)this.#pqOwners.delete(owner);},()=>{});return pass;
  }

  #trackPQ(action){
    if(this.#pqShuttingDown)return Promise.reject(providerError(4100,'PQ_SHUTDOWN_ENTERED','Wallet is closing.'));
    const pass=Promise.resolve().then(()=>{if(this.#pqShuttingDown)throw providerError(4100,'PQ_SHUTDOWN_ENTERED','Wallet is closing.');return action();});this.#pqInFlight.add(pass);
    void pass.then(()=>this.#pqInFlight.delete(pass),()=>this.#pqInFlight.delete(pass));return pass;
  }
  requestPQTransfer(input){return this.#trackPQ(()=>this.#preparePQTransfer(input));}
  requestPQTypedAction(input){return this.#trackPQ(()=>this.#preparePQTypedAction(input));}
  requestPQMigration(input){return this.#trackPQ(()=>this.#preparePQTransfer(input,'migration'));}
  requestPQRevocation(input){return this.#trackPQ(()=>this.#preparePQTransfer(input,'revocation'));}
  requestPQBroadcast(hash){return this.#trackPQ(async()=>{
    if(!this.#pqBroadcastSource||!this.#pqPolicySource||!this.#pqPolicyRecognized||this.#pqOwners.size||this.#pqTxOwners.size||this.#pqAcquiring)throw providerError(4100,'PQ_BROADCAST_NOT_READY','Original broadcast and current policy are required.');
    const guard=this.vault.authorization.current(),permission=this.permissions.authorizationLease('ynx-wallet:local-pq'),store=this.transactionSender?.submissions?.intentStore;
    const status=await this.vault.status();guard.assert();permission.assert();
    const original=await readPQTransferOriginal(store,hash,{account:status.account,networkId:this.#pqNetworkId,guard});
    if((await store.readPQProgress(status.account,hash,()=>guard.assert())).status!=='signed-unsubmitted')throw providerError(4100,'PQ_TRANSACTION_ALREADY_ENTERED','Only query this original; do not send again.');
    let resource;this.#pqAcquiring=true;
    try{resource=await this.#pqPolicySource({networkId:this.#pqNetworkId,nativeChainId:'6423',owner:status.account,operation:'transfer',at:this.clock().toISOString()});}
    catch(error){const d=error&&Object.getOwnPropertyDescriptor(error,'partial');if(d&&Object.hasOwn(d,'value')&&d.value){const owner=retainPQPolicyResource(d.value,{networkId:this.#pqNetworkId,account:status.account,now:this.clock});this.#pqOwners.add(owner);try{await this.#closePQ(owner,error);}catch{}}throw error;}
    finally{this.#pqAcquiring=false;}
    const owner=retainPQPolicyResource(resource,{networkId:this.#pqNetworkId,account:status.account,now:this.clock});this.#pqOwners.add(owner);
    try{
      guard.assert();permission.assert();if(this.#pqPolicyRecognized(resource)!==true)throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original current policy is required.');
      const {snapshot,expiresAt}=owner.read(),decoded=decodePQTransferRequest(Buffer.from(original.original.wire,'base64url')),plan=planPQNativeTransfer(snapshot,decoded.transfer),pair=pqPublicBindingToRegistrationKeys(pqRegisteredPublicBinding(snapshot));
      if(decoded.pkA!==pair.pkA||decoded.pkB!==pair.pkB)throw providerError(4100,'PQ_TRANSACTION_KEY_CHANGED','The saved member does not match the current complete key pair.');
      this.#pruneExpired();if(this.pending.size>=MAX_PENDING_REQUESTS)throw providerError(4200,'PENDING_REQUEST_LIMIT','Finish current reviews first.');
      const id=this.requestId(),createdAt=this.clock().toISOString(),deadline=new Date(Math.min(Date.parse(expiresAt),Date.parse(createdAt)+30000)).toISOString(),request=pqBroadcastPermissionRequest(original.binding);
      const pending=deepFreeze({id,origin:'ynx-wallet:local-pq',method:'ynx_broadcastPQNativeTransfer',params:[],createdAt,review:{title:'Broadcast saved PQ transfer / 提交已保存的 PQ 转账',account:status.account,...plan.transfer,hash,operationId:original.binding.operationId,expiresAt:deadline,warning:'This is a separate one-time broadcast approval. No new signature. UNKNOWN is retained and never resent automatically. 提交许可独立于签名；结果未知时只查询原件。'}});
      let cancelled=false;const revision=this.vault.authorization.status().revision;
      const lease=Object.freeze({assert:()=>{permission.assert();owner.assert();if(cancelled||this.vault.authorization.status().revision!==revision||this.clock().getTime()>=Date.parse(deadline))throw providerError(4100,'REQUEST_EXPIRED','Review this original broadcast again.');}});
      lease.assert();this.#pqReviews.set(pending,{snapshot,plan,owner,broadcast:request});this.#reviewLeases.set(pending,{lease,permission,cancel:()=>{if(cancelled)return false;cancelled=true;void this.#closePQ(owner,providerError(4001,'USER_REJECTED_REQUEST','Broadcast cancelled.')).catch(()=>{});return true;}});this.pending.set(id,pending);
      return Object.freeze({status:'approval-required',request:pending});
    }catch(error){try{await this.#closePQ(owner,error);}catch{}throw error;}
  });}
  async #preparePQTypedAction(input){
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).sort().join()!=='fee,kind,payload'||Object.values(Object.getOwnPropertyDescriptors(input)).some(d=>!Object.hasOwn(d,'value')))throw providerError(-32602,'PQ_TYPED_ACTION_INPUT_INVALID','Supply only kind, fee and payload. Account, network and nonce come from original policy.');
    if(['stake_delegate','stake_unbond','stake_withdraw'].includes(input.kind))throw providerError(4100,'PQ_TYPED_CLASSIC_ORIGINALS_NOT_SUPPLIED','The original protected staking witness source is required before signing.');
    if(input.kind==='contract_deploy')throw providerError(4100,'PQ_TYPED_DEPLOYMENT_MATERIAL_NOT_SUPPLIED','The original canonical deployment source and material codec are required before signing.');
    const guard=this.vault.authorization.current(),permission=this.permissions.authorizationLease('ynx-wallet:local-pq');guard.assert();permission.assert();
    if(!this.#pqPolicySource||!this.#pqPolicyRecognized||!this.#pqNetworkId)throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original current typed action policy is unavailable.');
    this.#pruneExpired();if(this.#pqOwners.size||this.#pqTxOwners.size||this.#pqAcquiring)throw providerError(4100,'PQ_POLICY_RESOURCE_UNRESOLVED','Preserve and finish the original review first.');
    const status=await this.vault.status();guard.assert();permission.assert();if(!status.initialized||status.account!==guard.account)throw providerError(4100,'ACCOUNT_CHANGED','Review the original selected account.');
    let resource;this.#pqAcquiring=true;
    try{resource=await this.#pqPolicySource({networkId:this.#pqNetworkId,nativeChainId:'6423',owner:status.account,operation:'typed-action',at:this.clock().toISOString()});}
    catch(error){const d=error&&Object.getOwnPropertyDescriptor(error,'partial');if(d&&Object.hasOwn(d,'value')&&d.value){const owner=retainPQPolicyResource(d.value,{networkId:this.#pqNetworkId,account:status.account,now:this.clock});this.#pqOwners.add(owner);try{await this.#closePQ(owner,error);}catch{}}throw error;}
    finally{this.#pqAcquiring=false;}
    const owner=retainPQPolicyResource(resource,{networkId:this.#pqNetworkId,account:status.account,now:this.clock});this.#pqOwners.add(owner);
    try{
      guard.assert();permission.assert();if(this.#pqShuttingDown||this.#pqPolicyRecognized(resource)!==true)throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original typed policy is not recognized.');
      const {snapshot,expiresAt}=owner.read(),policy=inspectPQWalletActionPolicy(snapshot,'pq-native-action'),at=this.clock().getTime(),id=this.requestId();
      const typedReview=preparePQTypedActionReview(snapshot,{chainId:this.#pqNetworkId,nativeChainId:'6423',owner:status.account,nonce:policy.nextNonce,fee:input.fee,kind:input.kind,payload:input.payload},{operationId:id,account:status.account,networkId:this.#pqNetworkId,createdAt:new Date(at).toISOString(),expiresAt:new Date(Math.min(Date.parse(expiresAt),at+120000)).toISOString()});
      const archive={review:typedReview,reviewSnapshot:JSON.parse(JSON.stringify(snapshot)),signingSnapshot:JSON.parse(JSON.stringify(snapshot))};
      // N1 Member includes both full signatures/public pair; fixed codec
      // overhead is conservatively reserved before custody or key entry.
      const memberBound=encodePQNativeAction(typedReview.action).length+65536;
      const reserveBytes=Math.max(350000,Buffer.byteLength(JSON.stringify(archive))+Math.ceil((memberBound*2+512)/3)*4+8192);
      if(!Number.isSafeInteger(reserveBytes)||reserveBytes>PRIVATE_FILE_MAX_BYTES-65536)throw providerError(4100,'PQ_TYPED_ORIGINAL_CAPACITY','There is insufficient protected journal capacity for this exact operation. Nothing was signed.');
      this.#pruneExpired();if(this.pending.size>=MAX_PENDING_REQUESTS)throw providerError(4200,'PENDING_REQUEST_LIMIT','Finish pending reviews first.');
      const pending=deepFreeze({id,origin:'ynx-wallet:local-pq',method:'ynx_signPQNativeAction',params:[],createdAt:typedReview.createdAt,review:{title:'Sign PQ action locally',account:status.account,typedReview,expiresAt:typedReview.expiresAt,warning:'Sign and retain this exact typed action only. Broadcast requires a separate original approval. No submission, contract execution or finality is claimed.'}});
      // The preparation operation's key guard ends when preparation returns.
      // Bind the persistent review to its security revision instead; approval
      // obtains its own current key guard, as do existing transfer reviews.
      let cancelled=false;const revision=this.vault.authorization.status().revision,lease=Object.freeze({assert:()=>{permission.assert();owner.assert();if(cancelled||this.#pqShuttingDown||this.vault.authorization.status().revision!==revision||this.clock().getTime()>=Date.parse(pending.review.expiresAt))throw providerError(4100,'REQUEST_EXPIRED','Review this original action again.');}});
      lease.assert();this.#pqReviews.set(pending,{snapshot,owner,typedReview,archive,reserveBytes});this.#reviewLeases.set(pending,{lease,permission,cancel:()=>{if(cancelled)return false;cancelled=true;void this.#closePQ(owner,providerError(4001,'USER_REJECTED_REQUEST','Typed action cancelled.')).catch(()=>{});return true;}});this.pending.set(id,pending);
      return Object.freeze({status:'approval-required',request:pending});
    }catch(error){try{await this.#closePQ(owner,error);}catch{}throw error;}
  }
  async #preparePQTransfer(input,operation='transfer'){
    if(this.#pqTxOwners.size)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_CLEANUP_UNKNOWN','Finish the original permission cleanup first.');
    const migration=operation==='migration',revocation=operation==='revocation';
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).sort().join()!==(migration?'activateAt':revocation?'':'amount,to')||Object.values(Object.getOwnPropertyDescriptors(input)).some(d=>!Object.hasOwn(d,'value')))throw providerError(-32602,'PQ_TRANSFER_INPUT_INVALID','Supply only the fields for this exact review.');
    const to=migration||revocation?null:normalizeAccount(typeof input.to==='string'&&input.to.startsWith('ynx1')?evmAddressFromYNX(input.to):input.to);
    if(!revocation&&(migration?typeof input.activateAt!=='string'||! /^[1-9][0-9]{0,19}$/.test(input.activateAt):typeof input.amount!=='string'||! /^[1-9][0-9]{0,18}$/.test(input.amount)))throw providerError(-32602,'PQ_TRANSFER_INPUT_INVALID','Use canonical integer values.');
    const guard=this.vault.authorization.current(),permission=this.permissions.authorizationLease('ynx-wallet:local-pq');guard.assert();permission.assert();
    if(!this.#pqPolicySource||!this.#pqPolicyRecognized||!this.#pqNetworkId)throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Trusted current transaction policy is not supplied. Nothing was signed or sent.');
    this.#pruneExpired();if(this.#pqOwners.size||this.#pqAcquiring)throw providerError(4100,'PQ_POLICY_RESOURCE_UNRESOLVED','Finish the original policy review and cleanup first.');
    const status=await this.vault.status();guard.assert();permission.assert();if(!status.initialized||status.account!==guard.account)throw providerError(4100,'ACCOUNT_CHANGED','Review the original selected account.');
    if(this.#pqOwners.size||this.#pqAcquiring)throw providerError(4100,'PQ_POLICY_RESOURCE_UNRESOLVED','Finish the original policy review and cleanup first.');
    let resource;this.#pqAcquiring=true;
    try{resource=await this.#pqPolicySource({networkId:this.#pqNetworkId,nativeChainId:'6423',owner:status.account,operation,at:this.clock().toISOString()});}
    catch(error){
      // Auth's failed initialization throws an original partial, even though
      // it is NOT branded successful supply. Capture before any live check.
      let partial;try{const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'partial'):null;if(descriptor&&Object.hasOwn(descriptor,'value'))partial=descriptor.value;}catch{}
      if(partial){const owner=retainPQPolicyResource(partial,{networkId:this.#pqNetworkId,account:status.account,now:this.clock});this.#pqOwners.add(owner);try{await this.#closePQ(owner,error);}catch{}}
      throw error;
    }finally{this.#pqAcquiring=false;}
    // Capture a returned original before ANY post-await lifecycle check.
    const owner=retainPQPolicyResource(resource,{networkId:this.#pqNetworkId,account:status.account,now:this.clock});this.#pqOwners.add(owner);
    try{
    guard.assert();permission.assert();if(this.#pqPolicyRecognized(resource)!==true)throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original transaction policy is not recognized.');const {snapshot,expiresAt}=owner.read();
    const policy=inspectPQWalletActionPolicy(snapshot,migration?'pq-account-migration':revocation?'pq-account-revocation':'pq-native-transfer');if(policy.owner!==status.account)throw providerError(4100,'ACCOUNT_CHANGED','The policy belongs to another account.');
    // The current one-pair Vault cannot safely overwrite an active pair for
    // rotation. Refuse explicitly rather than using a classic fallback.
    if(migration&&policy.mode!=='legacy')throw providerError(4100,'PQ_ROTATION_PROPOSAL_SLOT_REQUIRED','An independent protected proposed-pair slot is required for active PQ rotation.');
    const proposal=migration?await this.vault.readPQProposalBinding(this.#pqNetworkId):null;guard.assert();permission.assert();owner.assert();
    const plan=migration?planPQAccountMigration(snapshot,{...pqPublicBindingToRegistrationKeys(proposal),priorRevision:policy.policyRevision,newRevision:(BigInt(policy.policyRevision)+1n).toString(),ledgerNonce:policy.nextNonce,activateAt:input.activateAt}):revocation?planPQAccountRevocation(snapshot,{chainId:policy.chainId,owner:status.account,algorithmVersion:policy.activeRecord.algorithmVersion,pkA:policy.activeRecord.pkA,pkB:policy.activeRecord.pkB,authorizingRevision:policy.policyRevision,throughRevision:snapshot.records.at(-1).revision,ledgerNonce:policy.nextNonce,executeAt:policy.executionHeight,revokeAt:(BigInt(policy.executionHeight)+1n).toString()}):planPQNativeTransfer(snapshot,{chainId:policy.chainId,nativeChainId:policy.nativeChainId,from:status.account,to,amount:input.amount,fee:'1',nonce:policy.nextNonce});
    this.#pruneExpired();if(this.pending.size>=MAX_PENDING_REQUESTS)throw providerError(4200,'PENDING_REQUEST_LIMIT','Finish or cancel pending reviews first.');
    const pending=deepFreeze({id:this.requestId(),origin:'ynx-wallet:local-pq',method:migration?'ynx_signPQMigration':revocation?'ynx_signPQRevocation':'ynx_signPQNativeTransfer',params:[],createdAt:this.clock().toISOString(),review:{title:migration?'Sign initial PQ migration locally':revocation?'Sign terminal PQ account revocation locally':'Sign PQ transfer locally',account:status.account,...(migration?{activationHeight:plan.intent.activateAt,newRevision:plan.intent.newRevision,nonce:plan.intent.ledgerNonce,fee:'1',newPublicKeys:proposal}:revocation?{authorizingRevision:plan.intent.authorizingRevision,throughRevision:plan.intent.throughRevision,executionHeight:plan.intent.executeAt,revokeAt:plan.intent.revokeAt,nonce:plan.intent.ledgerNonce}:plan.transfer),policyRevision:plan.policy.policyRevision,expiresAt,warning:revocation?'Terminal revocation covers the current pair and all registered pending revisions. Sign and save only; nothing is submitted. If separately submitted and committed, revocation takes effect at the displayed next height. It does not reset funds, erase keys or grant broadcast permission.':'Sign and save this exact operation locally only. This does not submit, activate a migration, grant future signing permission or prove chain confirmation.'}});
    let cancelled=false;const lease=Object.freeze({assert:()=>{permission.assert();guard.assert();if(cancelled||this.clock().getTime()-Date.parse(pending.createdAt)>=APPROVAL_TTL_MS)throw providerError(4100,'REQUEST_EXPIRED','Review this transfer again.');}});
    // The first lifecycle lease ends after preparation. Approval uses its own
    // current original lease, bound to the same security generation below.
    const securityRevision=this.vault.authorization.status().revision;
    const approvalPermission=Object.freeze({assert:()=>{permission.assert();owner.assert();if(cancelled||this.vault.authorization.status().revision!==securityRevision||this.clock().getTime()-Date.parse(pending.createdAt)>=APPROVAL_TTL_MS)throw providerError(4100,'REQUEST_EXPIRED','Review this transfer again.');}});
    lease.assert();this.#pqReviews.set(pending,{snapshot,plan,owner,proposal});this.#reviewLeases.set(pending,{lease:approvalPermission,permission,cancel:()=>{if(cancelled)return false;cancelled=true;void this.#closePQ(owner,providerError(4001,'USER_REJECTED_REQUEST','Review cancelled.')).catch(()=>{});return true;}});this.pending.set(pending.id,pending);
    return Object.freeze({status:'approval-required',request:pending});
    }catch(error){try{await this.#closePQ(owner,error);}catch{}throw error;}
  }

  cancelAll() {for(const pending of [...this.pending.values(),...this.#activeReviews.values()])this.#reviewLeases.get(pending)?.cancel();this.pending.clear();}
  async accountStatus() { return this.vault.status(); }
  async createAccount() { return this.vault.createAccount(); }
  async importAccount(input) { this.cancelAll(); await this.permissions.revokeAll(); return this.vault.importAccount(input); }
  async addAccountAndSelect() { this.cancelAll(); await this.permissions.revokeAll(); return this.vault.addAccountAndSelect(); }
  async selectAccount(account) { this.cancelAll(); await this.permissions.revokeAll(); return this.vault.selectAccount(account); }
  async approveCanonicalAuthorization(request, issuedAt, expectedAccount, permission, requestId=null) {
    if (!/^0x[0-9a-f]{40}$/.test(expectedAccount ?? "")) throw providerError(4100, "ACCOUNT_REVIEW_REQUIRED", "Review the selected account before approving");
    // Normal main always supplies this port. Its refusal never falls through
    // to historical classic authorization, even on cached/cold requests.
    if(this.#pqSessionSource)return this.#trackPQ(()=>this.#approveCurrentSession(request,expectedAccount,permission,{requestId}));
    return this.vault.withSecret((secret, identity) => {
      permission?.assert();
      if (identity.account !== expectedAccount) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed. Review the request again.");
      const at = new Date(issuedAt);
      const approval = signProductSessionApproval(PRODUCT_SESSION_REGISTRY, request, { accountSecret: secret, scopes: request.scopes, expiresAt: request.expiresAt, ...(request.serviceConsent ? { approvedServiceConsent: request.serviceConsent } : {}) }, at);
      return Object.freeze({ approval, callbackUrl: createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, request, { result: "approved", approval }, at) });
    },permission);
  }
  reconcileCanonicalAuthorization(request,account,permission){
    if(!this.#pqSessionSource)throw providerError(4100,'ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','Fresh committed policy is required for recovery.');
    return this.#trackPQ(()=>this.#approveCurrentSession(request,account,permission,{readOnly:true}));
  }
  async canonicalAuthorizationStatus(request,account){
    // Read-only display metadata remains available after auto-lock. Never
    // return an approval, proof, callback or verification capability here.
    const store=this.transactionSender?.submissions?.intentStore;if(typeof store?.sessionOriginalStatus!=='function')return null;
    const digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,new Date(request.issuedAt));
    return store.sessionOriginalStatus(account,digest);
  }
  async canonicalPublicationRecords(){
    const guard=this.vault.authorization.current();guard.assert();
    return this.transactionSender.submissions.intentStore.sessionRecoverySummaries(guard.account,()=>guard.assert());
  }
  readCanonicalPublicationOutcome(digest){return this.#trackPQ(async()=>{
    if(typeof digest!=='string'||digest.length>128)throw providerError(-32602,'SESSION_ORIGINAL_REQUIRED','Select an original retained request.');
    const guard=this.vault.authorization.current();guard.assert();const account=guard.account,store=this.transactionSender.submissions.intentStore;
    if(typeof this.#sessionReturnClient?.publicationOutcome!=='function')throw providerError(4100,'SESSION_REFERENCE_RETURN_REQUIRED','The original fixed publisher is required for outcome reads.');
    const original=await store.readSessionOriginal(account,digest,()=>guard.assert());guard.assert();
    const publication=await store.readSessionPublication(account,digest,()=>guard.assert());guard.assert();
    if(!original?.approval||!publication)throw providerError(4100,'SESSION_PUBLICATION_REQUIRED','No original publication marker is available. Nothing will be published.');
    const outcome=await this.#sessionReturnClient.publicationOutcome({requestId:'req_'+randomUUID().replaceAll('-',''),publicationRequestId:publication.publicationRequestId,request:original.request,approval:original.approval});
    const result=sessionPublicationOutcome(outcome,original);
    // Same storage-only custody rule as publication: retain an actual result
    // even on a late lock, without generating any callback or authority.
    if(result)await store.saveSessionPublicationResult(account,digest,result);
    guard.assert();return Object.freeze({requestId:original.requestId,state:outcome.state,expiresAt:result?.expiresAt??null,expired:Date.parse(original.request.expiresAt)<=this.clock().getTime(),retryAuthorized:false,callbackEmitted:false,productSessionCreated:false});
  });}
  async beginCanonicalAuthorizationDelivery(request,account){
    if(!this.#pqSessionSource)throw providerError(4100,'SESSION_ORIGINAL_REQUIRED','Original pending custody is required.');
    const guard=this.vault.authorization.current();guard.assert();if(guard.account!==account)throw providerError(4100,'ACCOUNT_CHANGED','Select the original account.');
    const digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,this.clock());
    return this.transactionSender.submissions.intentStore.beginSessionDelivery(account,digest,()=>guard.assert());
  }
  async #approveCurrentSession(request,account,permission,{requestId=null,readOnly=false}={}){
    const guard=bindPermissionGuard(this.vault.authorization.current(),permission);guard.assert();
    if(guard.account!==account)throw providerError(4100,'ACCOUNT_CHANGED','Review the selected original account.');
    if(!this.#pqNetworkId||!this.#pqSessionRecognized)throw providerError(4100,'ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','The fixed committed policy source is required.');
    if(this.#pqOwners.size||this.#pqAcquiring)throw providerError(4100,'PQ_POLICY_RESOURCE_UNRESOLVED','Finish the original policy cleanup first.');
    const store=this.transactionSender?.submissions?.intentStore;
    if(['readSessionOriginal','reserveSessionOriginal','captureSessionOriginal','saveSessionOriginal','recordSessionFailure'].some(name=>typeof store?.[name]!=='function'))throw providerError(4100,'SESSION_ORIGINAL_STORE_REQUIRED','The original protected journal is required before signing.');
    const digest=productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,this.clock()),saved=await store.readSessionOriginal(account,digest,()=>guard.assert());guard.assert();
    if(saved&&!saved.approval)throw providerError(4100,'SESSION_APPROVAL_RESULT_UNKNOWN','The original signature outcome is unknown. No new signature is permitted.');
    if(saved?.deliveryAttempted)throw providerError(4100,'SESSION_CALLBACK_DELIVERY_UNKNOWN','The original callback may already have been delivered. No automatic repeat is permitted.');
    if(saved&&(saved.cleanupCause||!saved.cleanupComplete))throw providerError(4100,'SESSION_ORIGINAL_CLEANUP_UNKNOWN','Read the original outcome; its cleanup remains unresolved.');
    if(readOnly&&!saved)throw providerError(4100,'SESSION_ORIGINAL_REQUIRED','No original signed result is available for read-only recovery.');
    const originalRequestId=saved?.requestId??requestId??this.requestId();
    let resource,owner,failed=false,cause,result,token,savePass,cleanupFailed=false,cleanupCause;
    const capture=approval=>{store.captureSessionOriginal(token,approval);savePass=store.saveSessionOriginal(token);void savePass.catch(()=>{});};
    try{
      if(this.#pqOwners.size||this.#pqAcquiring)throw providerError(4100,'PQ_POLICY_RESOURCE_UNRESOLVED','Finish the original policy cleanup first.');
      this.#pqAcquiring=true;
      try{resource=await this.#pqSessionSource({networkId:this.#pqNetworkId,owner:account,operation:'approval',at:this.clock().toISOString()});}
      catch(error){const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'partial'):null;if(d&&Object.hasOwn(d,'value')&&d.value){owner=retainPQPolicyResource(d.value,{networkId:this.#pqNetworkId,account,now:this.clock});this.#pqOwners.add(owner);}throw error;}
      finally{this.#pqAcquiring=false;}
      // Capture before qualification/lifecycle checks. This wrapper owns only
      // cleanup here; the distinct SDK session parser owns committed policy.
      owner=retainPQPolicyResource(resource,{networkId:this.#pqNetworkId,account,now:this.clock});this.#pqOwners.add(owner);guard.assert();
      if(this.#pqSessionRecognized(resource)!==true)throw providerError(4100,'ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED','The original committed source is not recognized.');
      const originalAccount=ynxAddressFromEVM(account),observation=captureProductSessionAccountPolicy(resource,{networkId:this.#pqNetworkId,account:originalAccount},this.clock());
      if(await resource.recheck()!==undefined)throw providerError(4100,'ACCOUNT_POLICY_CURRENT_REFUSED','Current source recheck failed.');guard.assert();owner.assert();
      const at=this.clock(),policy=readProductSessionAccountPolicy(observation,originalAccount,at);
      if(saved){
        if(policy.algorithmVersion==='legacy'){
          if(saved.approval.version!=='2')throw providerError(4100,'ACCOUNT_POLICY_CHANGED','The retained approval does not match current account policy.');
          const approval=parseProductSessionApproval(PRODUCT_SESSION_REGISTRY,request,saved.approval,this.clock());
          result=Object.freeze({approval,callbackUrl:createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,request,{result:'approved',approval},this.clock()),originalRequestId:saved.requestId,recovered:true});
        }else{
          const verified=verifyPQProductSessionApproval(PRODUCT_SESSION_REGISTRY,request,saved.approval,observation,this.clock());
          result=Object.freeze({approval:verified.approval,callbackUrl:createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,request,{result:'approved',approval:verified.approval},this.clock(),verified.verifiedApproval),originalRequestId:saved.requestId,recovered:true});
        }
      }else{
      token=await store.reserveSessionOriginal({version:1,account,requestId:originalRequestId,requestDigest:digest,request,createdAt:at.toISOString(),approval:null,deliveryAttempted:false,cleanupComplete:false,firstCause:null,storageCause:null,cleanupCause:null},()=>guard.assert());guard.assert();
      if(policy.algorithmVersion==='legacy'){
        result=await this.vault.withSecret((secret,identity)=>{
          guard.assert();assertReviewedAccount(identity.account,account);readProductSessionAccountPolicy(observation,originalAccount,this.clock());
          const approval=signProductSessionApproval(PRODUCT_SESSION_REGISTRY,request,{accountSecret:secret,scopes:request.scopes,expiresAt:request.expiresAt,...(request.serviceConsent?{approvedServiceConsent:request.serviceConsent}:{})},this.clock());
          capture(approval);
          return Object.freeze({approval,callbackUrl:createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,request,{result:'approved',approval},this.clock())});
        },permission);
      }else{
        const binding=pqProductSessionRegisteredPublicBinding(observation,originalAccount,at),plan=preparePQProductSessionApproval(PRODUCT_SESSION_REGISTRY,request,{account:originalAccount,expiresAt:request.expiresAt,...(request.serviceConsent?{approvedServiceConsent:request.serviceConsent}:{})},observation,at);
        result=await this.vault.withPQKeys(binding,handle=>{
          guard.assert();readProductSessionAccountPolicy(observation,originalAccount,this.clock());
          const approval=signPQWalletProductSessionApproval(handle,plan,this.clock());capture(approval);
          const verified=verifyPQProductSessionApproval(PRODUCT_SESSION_REGISTRY,request,approval,observation,this.clock());
          return Object.freeze({approval:verified.approval,callbackUrl:createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,request,{result:'approved',approval:verified.approval},this.clock(),verified.verifiedApproval)});
        },permission);
      }
      if(savePass)await savePass;
      }
      guard.assert();if(await resource.recheck()!==undefined)throw providerError(4100,'ACCOUNT_POLICY_CURRENT_REFUSED','Current source recheck failed.');guard.assert();readProductSessionAccountPolicy(observation,originalAccount,this.clock());
    }catch(error){failed=true;cause=error;}
    finally{
      // A storage-only original continuation must settle even after lock or
      // Vault post-fence failure; it never reacquires or retains private keys.
      if(savePass)try{await savePass;}catch(error){if(!failed){failed=true;cause=error;}}
      if(owner)try{await this.#closePQ(owner,...(failed?[cause]:[]));}catch(error){cleanupFailed=true;cleanupCause=error;if(!failed){failed=true;cause=error;}}
      if(token)try{await store.recordSessionFailure(token,{firstPresent:failed,first:cause,cleanupPresent:cleanupFailed,cleanup:cleanupCause,cleanupComplete:owner?.status().closed===true&&!owner.status().cleanupDebt});}catch(error){if(!failed){failed=true;cause=error;}}
    }
    if(failed)throw cause;
    try{guard.assert();productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,this.clock());}
    catch(error){if(token)try{await store.recordSessionFailure(token,{firstPresent:true,first:error,cleanupComplete:true});}catch{}throw error;}
    if(result.approval.version==='3'&&this.#sessionReturnClient){
      const original=await store.readSessionOriginal(account,digest,()=>guard.assert());guard.assert();
      try{result=Object.freeze({...result,callbackUrl:await prepareSessionPublicationReturn({store,client:this.#sessionReturnClient,original,guard:()=>guard.assert(),clock:this.clock})});}
      catch(error){
        // The signed original is already durable and its Source is closed.
        // Keep the first publication/return failure through the existing
        // diagnostic writer, without signing, publishing or replacing it.
        if(token)try{await store.recordSessionFailure(token,{firstPresent:true,first:error,cleanupComplete:true});}
        catch(metadataError){try{if(error&&typeof error==='object'&&Object.isExtensible(error))Object.defineProperty(error,'sessionOriginalMetadataError',{value:metadataError});}catch{}}
        throw error;
      }
    }
    return Object.freeze({...result,retained:true,originalRequestId});
  }
  async approveOrigin(originInput, expectedAccount = null) {
    const origin = exactHttpsOrigin(originInput);
    const permission=this.permissions.authorizationLease(origin);
    const guard = bindPermissionGuard(this.vault.authorization?.current(),permission);
    const status = await this.vault.status();
    guard?.assert();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before connecting a DApp");
    if (expectedAccount !== null) assertReviewedAccount(status.account, expectedAccount);
    const existing = await this.permissions.hasAccount(origin, status.account);
    guard?.assert();
    try { await this.permissions.grantAccount(origin, status.account, this.clock().toISOString(),guard); guard?.assert(); }
    catch (error) { if (!existing) await this.#undoGrant(origin,permission); throw error; }
    return Object.freeze({ origin, account: status.account });
  }
  async revokeOrigin(originInput) { const origin = exactHttpsOrigin(originInput); await this.permissions.revoke(origin); this.#clearOriginPending(origin); return Object.freeze({ origin, revoked: true }); }

  async request(input) {
    const origin = exactHttpsOrigin(input?.origin);
    const method = methodName(input?.method);
    const params = Array.isArray(input?.params) ? input.params : [];
    // Revocation itself must remain available while an older read is pending.
    if(method === "wallet_revokePermissions") {validatePermissionRequest(params);await this.revokeOrigin(origin);return success(null);}
    const permission=this.permissions.authorizationLease(origin);
    const status = await this.vault.status();
    permission.assert();
    if (method === "eth_chainId") return success(YNX_EVM_CHAIN_ID);
    if (method === "net_version") return success("6423");
    if (method === "eth_accounts") {const accounts=await this.#approvedAccounts(origin,status);permission.assert();return success(accounts);}
    if (method === "wallet_getPermissions") {const records=await this.permissions.list(origin);permission.assert();return success(records);}
    if (!APPROVAL_METHODS.includes(method)) throw providerError(4200, "UNSUPPORTED_PROVIDER_METHOD", `Unsupported Provider method: ${method}`);
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before connecting a DApp");
    if (["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "ynx_requestProductSessionV2"].includes(method) && !(await this.permissions.hasAccount(origin, status.account))) {
      throw providerError(4100, "ACCOUNT_PERMISSION_REQUIRED", "The DApp has not been approved for this account");
    }
    permission.assert();
    let normalized;
    if(method === CENTRAL_BROWSER_METHOD) {
      const challenge = parseCentralSignIn(params, origin, this.clock().getTime());
      normalized = {params:[challenge],review:{title:"Sign in",account:status.account,origin,initiator:challenge.initiator,clients:challenge.clients,purpose:challenge.purpose,expiresAt:challenge.expiresAt,warning:"Approve identity sign-in to these exact official apps in this browser. No automatic signing, transfers or sensitive product permissions."}};
    } else if(method === "ynx_requestProductSessionV2") {
      if(params.length !== 1 || typeof params[0] !== "string" || params[0].length > 32768) invalidParams("Product Session requires one exact official Wallet route");
      const request = parseProductSessionWalletURL(PRODUCT_SESSION_REGISTRY, params[0], this.clock());
      if(request.origin !== origin) throw providerError(4100,"PRODUCT_SESSION_ORIGIN_MISMATCH","The sign-in origin does not match this connected app");
      normalized = {params:[params[0]],review:{title:"Sign in",account:status.account,chainId:YNX_EVM_CHAIN_ID,request,warning:request.scopes.includes("quant:paper:workspace") ? "Simulated Paper workspace only: view your snapshot and history, save backtest strategies and submit simulated orders. No real money, live trading, schedules or Testnet transactions." : "Review the exact product, origin, scopes and expiry. This approval does not grant automatic transfers or future signatures."}};
    } else normalized = normalizeApproval(method, params, status.account);
    if (method === "eth_sendTransaction") {
      if (typeof this.transactionSender?.prepare !== "function") throw providerError(4200, "TRANSACTION_TRANSPORT_UNAVAILABLE", "Canonical transaction preparation is unavailable");
      const snapshot = await this.transactionSender.prepare(status.account, normalized.params[0]);
      permission.assert();
      const current = await this.vault.status();
      permission.assert();
      assertReviewedAccount(current.account, status.account);
      if (!(await this.permissions.hasAccount(origin, status.account))) throw providerError(4100, "ACCOUNT_PERMISSION_REVOKED", "The DApp account permission was revoked while preparing the transaction");
      permission.assert();
      const maximumFee = BigInt(snapshot.gasLimit) * BigInt(snapshot.gasPrice ?? snapshot.maxFeePerGas);
      normalized.params = [snapshot];
      const fees = this.transactionSender.reviewDetails?.(snapshot);
      normalized.review = { title: "Send transaction", account: status.account, ...snapshot, amount: formatEther(snapshot.value), ...fees, maximumFee: formatEther(maximumFee), total: formatEther(BigInt(snapshot.value) + maximumFee), symbol: "YNXT", warning: fees?.fullEVM === false ? "This network currently supports whole-YNXT plain transfers only. It does not execute general Ethereum contracts." : "This exact transaction will be signed and broadcast. Contract calls may transfer assets or grant permissions beyond the displayed native amount." };
    }
    this.#pruneExpired();
    if (this.pending.size >= MAX_PENDING_REQUESTS || [...this.pending.values()].filter(item => item.origin === origin).length >= MAX_PENDING_REQUESTS_PER_ORIGIN) {
      throw providerError(4200, "PENDING_REQUEST_LIMIT", "Too many Wallet requests are awaiting review");
    }
    this.vault.authorization?.current().assert();
    permission.assert();
    const id = this.requestId();
    const pending = deepFreeze({ id, origin, method, params: normalized.params, review: normalized.review, createdAt: this.clock().toISOString() });
    this.pending.set(id, pending);
    let cancelled=false;
    const lease=Object.freeze({assert:()=>{permission.assert();if(cancelled)throw providerError(4100,"UNKNOWN_OR_EXPIRED_REQUEST","Provider review was cancelled. Review the request again.");if(this.clock().getTime()-Date.parse(pending.createdAt)>=APPROVAL_TTL_MS)throw providerError(4100,"REQUEST_EXPIRED","Provider request expired before approval");}});
    this.#reviewLeases.set(pending,{lease,permission,cancel:()=>{if(cancelled)return false;cancelled=true;return true;}});
    return Object.freeze({ status: "approval-required", request: pending });
  }

  isPendingPQTransactionReview(id){const p=this.pending.get(id);return ['ynx_signPQNativeTransfer','ynx_signPQNativeAction'].includes(p?.method)&&this.#pqReviews.has(p);}
  isPendingPQBroadcastReview(id){const p=this.pending.get(id);return p?.method==='ynx_broadcastPQNativeTransfer'&&this.#pqReviews.has(p);}
  approve(id,capsule){return this.#pqReviews.has(this.pending.get(id))?this.#trackPQ(()=>this.#approve(id,capsule)):this.#approve(id,capsule);}
  async #approve(id,capsule) {
    const pending = this.#take(id);
    this.#activeReviews.set(id,pending);
    let result,failed=false,cause;
    try {result=await this.#approvePending(pending,capsule);}catch(error){failed=true;cause=error;}
    finally {
      const original=this.#pqReviews.get(pending)?.owner;
      if(original)try{await this.#closePQ(original,...(failed?[cause]:[]));}catch(error){if(!failed){failed=true;cause=error;}}
      if(this.#activeReviews.get(id)===pending)this.#activeReviews.delete(id);
    }
    if(failed)throw cause;return result;
  }
  shutdownPQReviews(){
    if(this.#pqShutdownPass)return this.#pqShutdownPass;
    let resolve,reject;this.#pqShutdownPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
    this.#pqShuttingDown=true;this.cancelAll();
    void(async()=>{
      try{
        while(this.#pqInFlight.size)await Promise.allSettled([...this.#pqInFlight]);
        await Promise.allSettled([...this.#pqOwners].map(owner=>this.#closePQ(owner)));
        await Promise.allSettled([...this.#pqTxOwners].map(owner=>this.#closePQTransactionPermission(owner)));
        if(this.#pqTxOwners.size||[...this.#pqOwners].some(owner=>owner.status().cleanupDebt||!owner.status().closed)||this.vault.pqCleanupUnresolved?.()===true)throw providerError(4100,'PQ_POLICY_CLEANUP_UNKNOWN','Keep Wallet open; original policy cleanup is unresolved.');
        resolve();
      }catch(error){reject(error);}
    })();void this.#pqShutdownPass.catch(()=>{});return this.#pqShutdownPass;
  }
  #borrowPQTransactionReview(pending,reviewed,guard,request){
    let retired=false,entered=false,completed=null,producedHash=request.action==='broadcast'?request.transportHash:null;
    const typed=Object.hasOwn(request,'typedAction');let producedMemberHash=typed&&request.action==='broadcast'?request.memberHash:null;
    const issuedAt=this.clock().toISOString(),expiresAt=new Date(Math.min(Date.parse(pending.review.expiresAt),Date.parse(issuedAt)+30000)).toISOString();
    const packet=Object.freeze({request,issuedAt,expiresAt});
    const current=()=>{
      if(retired||this.#activeReviews.get(pending.id)!==pending||this.#pqReviews.get(pending)!==reviewed||this.clock().getTime()>=Date.parse(expiresAt))throw providerError(4100,'PQ_TRANSACTION_REVIEW_RETIRED','The original transaction review is no longer current.');
      if(request.action==='broadcast'&&entered)guard.assertEffectCurrent();else guard.assert();this.#reviewLeases.get(pending).lease.assert();reviewed.owner.assert();
    };
    const borrow=Object.freeze({
      readApprovalIdentity:()=>{current();return Object.freeze({reviewId:pending.id,operationId:request.operationId,action:request.action});},
      readOriginal:()=>{current();return packet;},
      assertCurrent:()=>{current();},
      recheck:async()=>{current();const {snapshot}=await reviewed.owner.recheck();current();assertPQAuthorizationCurrent(reviewed.snapshot,snapshot);},
      enterOriginal:action=>{current();if(action!==request.action||entered)throw providerError(4100,'PQ_TRANSACTION_SIGN_ONCE','Original permission is single-use.');entered=true;},
      completeOriginal:result=>{if(!entered||completed||!producedHash||result?.transportHash!==producedHash||typed&&(!producedMemberHash||result?.memberHash!==producedMemberHash)||!['returned',...(request.action==='broadcast'?['unknown']:[])].includes(result?.outcome))throw providerError(4100,'PQ_TRANSACTION_RESULT_BINDING','Keep the original result.');completed=result;current();},
      assertCompletedCurrent:result=>{if(result!==completed||result?.transportHash!==producedHash||typed&&result?.memberHash!==producedMemberHash)throw providerError(4100,'PQ_TRANSACTION_RESULT_BINDING','Keep the original signing result.');current();},
      retire:()=>{retired=true;},join:async()=>{},close:async()=>{retired=true;}
    });
    originalPQTransactionReviewBorrows.add(borrow);
    return {borrow,captureProduced:(hash,memberHash)=>{if(!entered||producedHash||typed&&(!/^0x[0-9a-f]{64}$/.test(hash??'')||!/^0x[0-9a-f]{64}$/.test(memberHash??'')))throw providerError(4100,'PQ_TRANSACTION_SIGN_ONCE','Keep the original signing result.');producedHash=hash;if(typed)producedMemberHash=memberHash;}};
  }
  async #closePQTransactionPermission(owner){
    await owner.close();this.#pqTxOwners.delete(owner);
  }
  async #approvePending(pending,capsule) {
    const permission=this.#reviewLeases.get(pending)?.lease;
    const guard = bindPermissionGuard(this.vault.authorization?.current(),permission);
    guard.assert();
    const status = await this.vault.status();
    guard?.assert();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Wallet account is unavailable");
    if (pending.review.account !== status.account) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed. Review the request again.");
    if (["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "ynx_requestProductSessionV2"].includes(pending.method) && !(await this.permissions.hasAccount(pending.origin, status.account))) {
      throw providerError(4100, "ACCOUNT_PERMISSION_REVOKED", "The DApp account permission was revoked before approval");
    }
    guard.assert();
    switch (pending.method) {
      case 'ynx_signPQNativeAction': {
        const reviewed=this.#pqReviews.get(pending),store=this.transactionSender?.submissions?.intentStore;
        if(!reviewed?.typedReview||!store||typeof store.capturePQTypedMember!=='function'||typeof this.vault.withPQKeys!=='function'||!this.#pqTxSource||!this.#pqTxRecognized||!capsule)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED','A separate original typed approval is required; no fallback signer is available.');
        const {snapshot:refreshed}=await reviewed.owner.recheck();guard.assert();assertPQAuthorizationCurrent(reviewed.snapshot,refreshed);
        const request=pqTypedSignPermissionRequest(reviewed.typedReview,refreshed,this.clock().getTime());
        const archive={...reviewed.archive,signingSnapshot:JSON.parse(JSON.stringify(refreshed))};
        let auth,borrowed,hash,failed=false;
        try{
          borrowed=this.#borrowPQTransactionReview(pending,reviewed,guard,request);
          try{auth=await this.#pqTxSource(request,capsule,borrowed.borrow);}
          catch(error){const d=error&&Object.getOwnPropertyDescriptor(error,'partial');if(d&&Object.hasOwn(d,'value')&&d.value){auth=d.value;this.#pqTxOwners.add(auth);}throw error;}
          this.#pqTxOwners.add(auth);guard.assert();
          if(this.#pqTxRecognized(auth)!==true)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED','Typed transaction permission is not recognized.');
          if(await auth.recheck()!==undefined||auth.assertCurrent()!==undefined)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED','Typed permission current check failed.');guard.assert();
          await store.reserveOriginal(status.account,'pq-typed-action',{reserveBytes:reviewed.reserveBytes});guard.assert();
          await this.vault.withPQKeys(pqRegisteredPublicBinding(refreshed),handle=>{
            guard.assert();if(auth.assertCurrent()!==undefined||auth.enterSign()!==undefined)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED','Typed sign entry must be exact.');
            const member=signPQReviewedTypedAction(reviewed.typedReview,refreshed,handle,{account:status.account,networkId:this.#pqNetworkId},this.clock().getTime());
            // Original Main adopts the Member before encoding/hash/math,
            // completion callbacks or a late focus/currentness check.
            const captured=store.capturePQTypedMember(status.account,member,archive);hash=captured.transportHash;
            borrowed.captureProduced(hash,captured.memberHash);if(auth.complete({outcome:'returned',transportHash:hash,memberHash:captured.memberHash})!==undefined)throw providerError(4100,'PQ_TRANSACTION_RESULT_BINDING','Keep the original typed result.');guard.assert();
          },Object.freeze({assert:()=>{permission.assert();guard.assert();auth.assertCurrent();}}));
          const current=()=>{guard.assert();auth.assertCurrent();};current();
          const saved=await store.saveOriginal(status.account,hash,current);current();return success(saved);
        }catch(error){failed=true;store.originalFailed(status.account,error);throw error;}
        finally{if(auth)try{await this.#closePQTransactionPermission(auth);}catch(error){if(!failed)throw error;}else borrowed?.borrow.retire();}
      }
      case 'ynx_broadcastPQNativeTransfer': {
        const reviewed=this.#pqReviews.get(pending);
        if(!capsule||!reviewed?.broadcast||!this.#pqBroadcastSource)throw providerError(4100,'PQ_BROADCAST_NOT_READY','A separate current broadcast approval is required.');
        const borrowed=this.#borrowPQTransactionReview(pending,reviewed,guard,reviewed.broadcast);
        return success(await this.#pqBroadcastSource({hash:reviewed.broadcast.transportHash,request:reviewed.broadcast,capsule,borrow:borrowed.borrow,guard}));
      }
      case 'ynx_signPQRevocation': {
        const reviewed=this.#pqReviews.get(pending),store=this.transactionSender?.submissions?.intentStore;
        if(!reviewed||!store||typeof this.vault.withPQKeys!=='function')throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original policy, Vault and journal are required.');
        const {snapshot:refreshed}=await reviewed.owner.recheck();guard.assert();assertPQAuthorizationCurrent(reviewed.snapshot,refreshed);
        const plan=planPQAccountRevocation(refreshed,reviewed.plan.intent);guard.assert();await store.reserveOriginal(status.account,'pq-revocation');
        let hash;
        try{
          guard.assert();await this.vault.withPQKeys(pqRegisteredPublicBinding(refreshed),handle=>{
            guard.assert();const signed=signPQWalletAccountRevocation(handle,plan.intent,refreshed);
            const original=createPQOriginalRecord({account:status.account,kind:'pq-revocation',operationId:pending.id,request:signed});
            store.captureOriginal(status.account,original,'pq-revocation');hash=original.hash;guard.assert();
          },permission);
          guard.assert();const saved=await store.saveOriginal(status.account,hash,()=>guard.assert());guard.assert();return success(saved);
        }catch(error){store.originalFailed(status.account,error);throw error;}
      }
      case 'ynx_signPQMigration': {
        const reviewed=this.#pqReviews.get(pending),store=this.transactionSender?.submissions?.intentStore;
        if(!reviewed||!store||typeof this.vault.withPQKeys!=='function')throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original policy, Vault and journal are required.');
        const {snapshot:refreshed}=await reviewed.owner.recheck();guard.assert();assertPQAuthorizationCurrent(reviewed.snapshot,refreshed);
        const plan=planPQAccountMigration(refreshed,reviewed.plan.intent),authorization=preparePQClassicMigrationAuthorization(refreshed,plan.intent);
        guard.assert();await store.reserveOriginal(status.account,'pq-migration');let hash;
        try{
          guard.assert();const classic=await this.vault.withSecret((secret,identity)=>{
            guard.assert();assertReviewedAccount(identity.account,status.account);const signer=walletForSecret(secret),signature=signer.signingKey.sign(authorization.digest);
            return preparePQClassicMigrationProof(refreshed,plan.intent,{publicKey:signer.signingKey.compressedPublicKey,r:signature.r,s:signature.s});
          },permission);
          guard.assert();await this.vault.withPQKeys(reviewed.proposal,handle=>{
            guard.assert();const newKeyWholeProof=createPQWalletMigrationPossession(handle,plan.intent);
            const {request}=preparePQReviewedMigrationTransport(refreshed,{intent:plan.intent,...classic,currentPQMember:new Uint8Array(0),newKeyWholeProof});
            const original=createPQOriginalRecord({account:status.account,kind:'pq-migration',operationId:pending.id,request});
            store.captureOriginal(status.account,original,'pq-migration');hash=original.hash;guard.assert();
          },permission);
          guard.assert();const saved=await store.saveOriginal(status.account,hash,()=>guard.assert());guard.assert();return success(saved);
        }catch(error){store.originalFailed(status.account,error);throw error;}
      }
      case 'ynx_signPQNativeTransfer': {
        const reviewed=this.#pqReviews.get(pending),store=this.transactionSender?.submissions?.intentStore;
        if(!reviewed||!store||typeof this.vault.withPQKeys!=='function')throw providerError(4100,'PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED','Original policy, Vault and journal are required.');
        const {snapshot:refreshed}=await reviewed.owner.recheck();guard.assert();assertPQAuthorizationCurrent(reviewed.snapshot,refreshed);
        const plan=planPQNativeTransfer(refreshed,reviewed.plan.transfer);guard.assert();
        const request=deepFreeze({action:'sign',networkId:this.#pqNetworkId,nativeChainId:'6423',account:status.account,operationId:pending.id,origin:'ynx-wallet:local-pq',transfer:{...plan.transfer},requestDigest:createHash('sha256').update(encodePQNativeTransfer(plan.transfer)).digest('hex'),policyRevision:pending.review.policyRevision,expiresAt:pending.review.expiresAt});
        let auth,borrowed,hash,failed=false;
        try{
          if(this.#pqTxSource!==null||capsule!==undefined){
            if(!this.#pqTxSource||!this.#pqTxRecognized||!capsule)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED','A real transaction approval is required.');
            borrowed=this.#borrowPQTransactionReview(pending,reviewed,guard,request);
            try{auth=await this.#pqTxSource(request,capsule,borrowed.borrow);}
            catch(error){const d=error&&Object.getOwnPropertyDescriptor(error,'partial');if(d&&Object.hasOwn(d,'value')&&d.value){auth=d.value;this.#pqTxOwners.add(auth);}throw error;}
            this.#pqTxOwners.add(auth);guard.assert();
            if(this.#pqTxRecognized(auth)!==true)throw providerError(4100,'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED','Original transaction permission is not recognized.');
            await auth.recheck();auth.assertCurrent();guard.assert();
          }
          await store.reserveOriginal(status.account,'pq-transfer');
          guard.assert();await this.vault.withPQKeys(pqRegisteredPublicBinding(refreshed),handle=>{
            guard.assert();if(auth)auth.enterSign();const signed=signPQWalletNativeTransfer(handle,plan.transfer,refreshed);
            const original=createPQOriginalRecord({account:status.account,kind:'pq-transfer',operationId:pending.id,request:signed});
            store.captureOriginal(status.account,original,'pq-transfer');hash=original.hash;
            if(auth){borrowed.captureProduced(hash);auth.complete({outcome:'returned',transportHash:hash});}guard.assert();
          },auth?Object.freeze({assert:()=>{permission.assert();auth.assertCurrent();}}):permission);
          const current=()=>{guard.assert();auth?.assertCurrent();};
          current();const saved=await store.saveOriginal(status.account,hash,current);current();return success(saved);
        }catch(error){failed=true;store.originalFailed(status.account,error);throw error;}
        finally{if(auth)try{await this.#closePQTransactionPermission(auth);}catch(error){if(!failed)throw error;}else borrowed?.borrow.retire();}
      }
      case CENTRAL_BROWSER_METHOD:
        return this.vault.withSecret((secret, identity) => {
          guard.assert();
          assertReviewedAccount(identity.account, pending.review.account);
          return success(signCentralSignIn(pending.params[0], pending.origin, secret, this.clock().getTime()));
        },permission);
      case "ynx_requestProductSessionV2": {
        const request = parseProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,pending.params[0],this.clock());
        if(request.origin !== pending.origin) throw providerError(4100,"PRODUCT_SESSION_ORIGIN_MISMATCH","The sign-in origin does not match this connected app");
        const result = await this.approveCanonicalAuthorization(request,this.clock().toISOString(),pending.review.account,permission,pending.id);
        guard.assert();
        assertSessionReturnTransport(result.callbackUrl);
        if(result.retained)await this.beginCanonicalAuthorizationDelivery(request,pending.review.account);
        guard.assert();
        return success({version:2,returnUrl:result.callbackUrl});
      }
      case "eth_requestAccounts":
      case "wallet_requestPermissions":
        { const existing = await this.permissions.hasAccount(pending.origin, status.account);
          guard?.assert();
          try { await this.permissions.grantAccount(pending.origin, status.account, this.clock().toISOString(),guard); guard?.assert(); }
          catch (error) { if (!existing) await this.#undoGrant(pending.origin,this.#reviewLeases.get(pending).permission); throw error; }
        }
        return success(pending.method === "eth_requestAccounts" ? [status.account] : [{ parentCapability: "eth_accounts" }]);
      case "personal_sign":
        return this.vault.withSecret(async (secret, identity) => {
          guard.assert();
          assertReviewedAccount(identity.account, pending.review.account);
          const signature=await walletForSecret(secret).signMessage(getBytes(pending.params[0]));guard.assert();return success(signature);
        },permission);
      case "eth_signTypedData_v4":
        return this.vault.withSecret(async (secret, identity) => {
          guard.assert();
          assertReviewedAccount(identity.account, pending.review.account);
          const typed = JSON.parse(pending.params[1]);
          const types = { ...typed.types };
          delete types.EIP712Domain;
          const signature=await walletForSecret(secret).signTypedData(typed.domain, types, typed.message);guard.assert();return success(signature);
        },permission);
      case "eth_sendTransaction":
        if (!this.transactionSender) throw providerError(4200, "TRANSACTION_TRANSPORT_UNAVAILABLE", "Canonical transaction transport is unavailable");
        return this.vault.withSecret(async (secret, identity, keyGuard) => {
          guard.assert();
          assertReviewedAccount(identity.account, pending.review.account);
          return success(await this.transactionSender.send(walletForSecret(secret), pending.params[0], bindPermissionGuard(keyGuard,permission)));
        },permission);
      default:
        throw providerError(4200, "UNSUPPORTED_PROVIDER_METHOD", "Provider method is not implemented");
    }
  }

  reject(id) {
    const pending=this.#take(id);this.#reviewLeases.get(pending)?.cancel();
    throw providerError(4001, "USER_REJECTED_REQUEST", "User rejected the request");
  }

  expire(id) {
    if(typeof id!=="string")return false;
    const pending=this.pending.get(id)??this.#activeReviews.get(id);if(!pending)return false;
    const cancelled=this.#reviewLeases.get(pending)?.cancel()??false;return this.pending.delete(id)||cancelled;
  }

  pendingRequests() { return Object.freeze([...this.pending.values()]); }

  async #approvedAccounts(origin, status) {
    return status.initialized && await this.permissions.hasAccount(origin, status.account) ? [status.account] : [];
  }

  #take(id) {
    if (typeof id !== "string" || !this.pending.has(id)) throw providerError(4100, "UNKNOWN_OR_EXPIRED_REQUEST", "Provider request is unknown or already resolved");
    const value = this.pending.get(id);
    this.pending.delete(id);
    if (this.clock().getTime() - Date.parse(value.createdAt) > APPROVAL_TTL_MS) {this.#reviewLeases.get(value)?.cancel();throw providerError(4100, "REQUEST_EXPIRED", "Provider request expired before approval");}
    return value;
  }

  async #undoGrant(origin,permission) {try{permission.assert();}catch{return;}await this.permissions.revoke(origin);}
  #clearOriginPending(origin) { for (const [id, request] of this.pending) if (request.origin === origin) this.expire(id);for(const request of this.#activeReviews.values())if(request.origin===origin)this.#reviewLeases.get(request)?.cancel(); }
  #pruneExpired() { const now = this.clock().getTime(); for (const [id, request] of this.pending) if (now - Date.parse(request.createdAt) > APPROVAL_TTL_MS) this.expire(id); }
}

export class MemoryPermissionStore {
  constructor() { this.records = new Map();this.epoch=new PermissionEpoch(); }
  authorizationLease(origin){return this.epoch.lease(origin);}
  async grantAccount(origin, account, approvedAt,guard) {guard?.assert(); this.records.set(origin, Object.freeze({ parentCapability: "eth_accounts", accounts: [account], approvedAt })); }
  async revoke(origin) {return this.epoch.revoke(origin,()=>this.records.delete(origin));}
  async revokeAll() {return this.epoch.revoke(null,()=>this.records.clear());}
  async hasAccount(origin, account) { return this.records.get(origin)?.accounts.includes(account) ?? false; }
  async list(origin) { const record = this.records.get(origin); return record ? [record] : []; }
}

function normalizeApproval(method, params, activeAccount) {
  if (method === "eth_requestAccounts") return { params: [], review: { title: "Connect account", account: activeAccount, permissions: ["eth_accounts"] } };
  if (method === "wallet_requestPermissions") {
    validatePermissionRequest(params);
    return { params, review: { title: "Grant account permission", account: activeAccount, permissions: ["eth_accounts"] } };
  }
  if (method === "personal_sign") {
    if (params.length !== 2 || !isHexString(params[0], true) || normalizeAccount(params[1]) !== activeAccount) invalidParams("personal_sign requires hex data and the active approved account");
    return { params: [params[0], activeAccount], review: { title: "Sign message", account: activeAccount, message: params[0], warning: "This signature may authorize an external action." } };
  }
  if (method === "eth_signTypedData_v4") {
    if (params.length !== 2 || normalizeAccount(params[0]) !== activeAccount || typeof params[1] !== "string") invalidParams("eth_signTypedData_v4 requires the active approved account and JSON typed data");
    let typed;
    try { typed = JSON.parse(params[1]); } catch { invalidParams("Typed data is not valid JSON"); }
    if (!typed?.domain || !typed?.types || !typed?.primaryType || !typed?.message) invalidParams("Typed data is incomplete");
    if (typed.domain.chainId !== undefined && Number(typed.domain.chainId) !== 6423) invalidParams("Typed data targets a different chain");
    try {
      const types = { ...typed.types }; delete types.EIP712Domain;
      if (TypedDataEncoder.from(types).primaryType !== typed.primaryType) invalidParams("Typed data primaryType does not match the signed type");
      TypedDataEncoder.hash(typed.domain, types, typed.message);
      const actualDomainType = TypedDataEncoder.getPayload(typed.domain, types, typed.message).types.EIP712Domain;
      if (typed.types.EIP712Domain !== undefined && (!Array.isArray(typed.types.EIP712Domain) || typed.types.EIP712Domain.length !== actualDomainType.length || actualDomainType.some((field, index) => typed.types.EIP712Domain[index]?.name !== field.name || typed.types.EIP712Domain[index]?.type !== field.type))) invalidParams("Typed data domain types differ from the signed domain");
      typed.types.EIP712Domain = actualDomainType;
    } catch { invalidParams("Typed data cannot be signed exactly as displayed"); }
    return { params: [activeAccount, JSON.stringify(typed)], review: { title: "Sign typed data", account: activeAccount, domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message, warning: "This signature may authorize transfers, spending permissions, or other external actions. Review every domain, type and message field." } };
  }
  if (method === "eth_sendTransaction") {
    if (params.length !== 1 || typeof params[0] !== "object" || params[0] === null) invalidParams("eth_sendTransaction requires one transaction object");
    const tx = { ...params[0], from: normalizeAccount(params[0].from) };
    if (tx.from !== activeAccount || (tx.to !== undefined && tx.to !== null && !isAddress(tx.to))) invalidParams("Transaction account or destination is invalid");
    if (tx.chainId !== undefined && Number(tx.chainId) !== 6423) invalidParams("Transaction targets a different chain");
    for (const field of ["value", "data", "gas", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]) if (tx[field] !== undefined && !isHexString(tx[field])) invalidParams(`Transaction ${field} must be hexadecimal`);
    return { params: [tx], review: { title: "Send transaction", account: activeAccount, to: tx.to ?? null, value: tx.value ?? "0x0", data: tx.data ?? "0x", chainId: YNX_EVM_CHAIN_ID } };
  }
  invalidParams("Provider request cannot be reviewed");
}

function validatePermissionRequest(params) {
  const request = params[0];
  if (params.length !== 1 || typeof request !== "object" || request === null || Array.isArray(request) || Object.keys(request).join(",") !== "eth_accounts" || typeof request.eth_accounts !== "object" || request.eth_accounts === null || Object.keys(request.eth_accounts).length !== 0) {
    invalidParams("Only the exact eth_accounts permission is supported");
  }
}
function exactHttpsOrigin(value) { try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(); return url.origin; } catch { throw providerError(4100, "INVALID_DAPP_ORIGIN", "DApp origin must be an exact HTTPS origin"); } }
function methodName(value) { if (typeof value !== "string" || !/^[a-z][A-Za-z0-9_]{1,63}$/.test(value)) invalidParams("Provider method is invalid"); return value; }
function normalizeAccount(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) invalidParams("Provider account is invalid"); return value.toLowerCase(); }
function invalidParams(message) { throw providerError(-32602, "INVALID_PROVIDER_PARAMS", message); }
function success(result) { return Object.freeze({ status: "success", result }); }
function walletForSecret(secret) { return new Wallet(secret.startsWith("0x") ? secret : `0x${secret}`); }
function assertReviewedAccount(actual, expected) { if (actual !== expected) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed. Review the request again."); }
function deepFreeze(value) { for (const child of Object.values(value)) if (child && typeof child === "object") deepFreeze(child); return Object.freeze(value); }
