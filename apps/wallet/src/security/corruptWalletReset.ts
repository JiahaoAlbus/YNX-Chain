import type { CorruptWalletResetReview, WalletRepository } from "../storage/walletRepository";
import { WalletOperationCancelled, type WalletOperationLease, type WalletOperationLifecycle } from "./operationLifecycle";

type Repository=Pick<WalletRepository,"reviewCorruptStorageReset"|"discardCorruptStorageReset"|"resetCorruptStorage">;
type Pending={lease:WalletOperationLease;review:CorruptWalletResetReview|null;confirming:boolean};

/** A confirmation refers to the corruption observed before the dialog opened.
 * Cancelling/backgrounding invalidates that dialog, including a late OS result. */
export class CorruptWalletResetController {
  private pending:Pending|null=null;
  constructor(private readonly repository:Repository,private readonly operations:WalletOperationLifecycle,private readonly authorize:()=>Promise<void>){}
  active():boolean{return this.pending!==null}
  owns(review:CorruptWalletResetReview):boolean{return this.pending?.review===review}
  isCurrent(review:CorruptWalletResetReview):boolean{return this.owns(review)&&this.pending!.lease.isCurrent()}
  async prepare():Promise<CorruptWalletResetReview>{
    if(this.pending)throw new Error("A Wallet reset review is already in progress");
    const entry:Pending={lease:this.operations.scope().begin({requireUnlocked:false}),review:null,confirming:false};this.pending=entry;
    try{const review=await entry.lease.step(()=>this.repository.reviewCorruptStorageReset(entry.lease.assert));entry.review=review;return review}
    catch(error){if(this.pending===entry)this.cancel();throw error}
  }
  async confirm(review:CorruptWalletResetReview):Promise<void>{
    const entry=this.pending;if(!entry||entry.review!==review||entry.confirming)throw new WalletOperationCancelled();
    entry.lease.assert();entry.confirming=true;
    try{await entry.lease.step(this.authorize);await entry.lease.step(()=>this.repository.resetCorruptStorage(review,entry.lease.assert))}
    finally{entry.confirming=false}
  }
  cancel(review?:CorruptWalletResetReview):void{
    const entry=this.pending;if(!entry||(review&&entry.review!==review))return;
    this.pending=null;if(entry.review)this.repository.discardCorruptStorageReset(entry.review);entry.lease.finish();
  }
}
