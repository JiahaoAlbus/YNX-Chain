import {WalletOperationScope,type WalletOperationLease} from './operationLifecycle';

export type PendingRemovalReview=Readonly<{kind:'previously-confirmed-local-removals'}>;
type OriginalRepository<Manifest>=Readonly<{retryPendingDeletions:(assertCurrent:()=>void)=>Promise<Manifest>}>;
// This controller never opens storage or performs cleanup at construction/review.
// It delegates only to the original repository journal after explicit review and
// the original native strong authentication. It does not create deletion intent.
export class PendingRemovalRetryController<Manifest>{
  private activeReview:PendingRemovalReview|null=null;
  private records=new WeakMap<PendingRemovalReview,{lease:WalletOperationLease;confirmed:boolean}>();
  constructor(private readonly scope:WalletOperationScope,private readonly repository:OriginalRepository<Manifest>,private readonly authorize:()=>Promise<void>){}
  active():boolean{return this.activeReview!==null}
  prepare():PendingRemovalReview{
    if(this.activeReview)throw new Error('A local removal review is already in progress');
    const lease=this.scope.begin({requireUnlocked:false});
    const review=Object.freeze({kind:'previously-confirmed-local-removals' as const});
    this.records.set(review,{lease,confirmed:false});this.activeReview=review;return review;
  }
  isCurrent(review:PendingRemovalReview):boolean{
    return this.activeReview===review&&this.records.get(review)?.lease.isCurrent()===true;
  }
  ownsReview(review:PendingRemovalReview):boolean{
    return this.activeReview===review&&this.records.get(review)?.lease.ownsScope()===true;
  }
  async confirm(review:PendingRemovalReview):Promise<Manifest>{
    const record=this.records.get(review);
    if(this.activeReview!==review||!record||record.confirmed)throw new Error('Review previously confirmed local removals again');
    record.lease.assert();record.confirmed=true;
    await record.lease.step(this.authorize);
    const manifest=await record.lease.step(()=>this.repository.retryPendingDeletions(record.lease.assert));
    record.lease.assert();return manifest;
  }
  finish(review:PendingRemovalReview):void{
    const record=this.records.get(review);record?.lease.finish();this.records.delete(review);
    if(this.activeReview===review)this.activeReview=null;
  }
  cancel():void{if(this.activeReview)this.finish(this.activeReview)}
}
