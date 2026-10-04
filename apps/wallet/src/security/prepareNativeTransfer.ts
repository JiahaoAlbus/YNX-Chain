import {createSignedNativeTransfer,evmAddressFromYNX,walletIdentity} from "@ynx-chain/wallet-auth";
import type {NativeChainClient} from "../chain/nativeTransfer";
import type {NativeTransferPrepared} from "../chain/nativeTransferOutbox";
import type {WalletRepository} from "../storage/walletRepository";
import type {WalletOperationLease} from "./operationLifecycle";

export type NativeTransferReview=Readonly<{account:string;accountPublicKey:string;to:string;amount:number}>;

/** The same protected signing path for Send and Pay. No key copies, alternate
 * vault, session authority, storage or dispatch lives in this helper. Call only
 * inside NativeTransferOutbox's prepare callback after visible user review. */
export async function prepareNativeTransfer(review:NativeTransferReview,lease:WalletOperationLease,
  client:Pick<NativeChainClient,"account"|"requireDurabilityCapability">,
  repository:Pick<WalletRepository,"accountSecret">,authorize:()=>Promise<void>):Promise<NativeTransferPrepared>{
  return prepareNativeTransferWithBinding(review,lease,client,repository,authorize,()=>{},signed=>signed);
}

/** Pay can bind a public result inside the SAME existing protected key read.
 * The additional guard only narrows the operation lease; it cannot unlock,
 * supply keys, skip native authorization or dispatch a transaction. */
export async function prepareNativeTransferWithBinding<T>(review:NativeTransferReview,lease:WalletOperationLease,
  client:Pick<NativeChainClient,"account"|"requireDurabilityCapability">,
  repository:Pick<WalletRepository,"accountSecret">,authorize:()=>Promise<void>,assertBinding:()=>void,
  bind:(signed:NativeTransferPrepared,secret:string,guard:()=>void)=>T|Promise<T>):Promise<T>{
  const guard=()=>{lease.assert();assertBinding()};
  const step=async<R>(operation:()=>Promise<R>)=>{guard();const result=await operation();guard();return result};
  const request=Object.freeze({...review});guard();
  if(lease.account!==request.account)throw new Error("Signing account changed after review");
  evmAddressFromYNX(request.account);evmAddressFromYNX(request.to);
  if(!Number.isSafeInteger(request.amount)||request.amount<=0||!Number.isSafeInteger(request.amount+1))
    throw new Error("Review a supported whole YNXT amount before signing");
  await step(authorize);
  const remote=await step(()=>client.account(request.account));
  if(remote.balance<request.amount+1)throw new Error("Insufficient YNXT to cover the reviewed amount and 1 YNXT fee");
  if(!Number.isSafeInteger(remote.nonce+1))throw new Error("The next account nonce exceeds the supported range");
  await step(()=>client.requireDurabilityCapability());
  return lease.withSecret(()=>{guard();return repository.accountSecret(request.account,guard,{allowLegacyMigration:true})},async secret=>{
    guard();const identity=walletIdentity(secret);
    if(identity.account!==request.account||identity.accountPublicKey!==request.accountPublicKey)throw new Error("Signing account changed after review");
    const signed=createSignedNativeTransfer({accountSecret:secret,to:request.to,amount:request.amount,nonce:remote.nonce+1});
    guard();const result=await bind(signed,secret,guard);guard();return result;
  });
}
