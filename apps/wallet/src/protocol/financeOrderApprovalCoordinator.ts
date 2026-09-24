import type { FinanceOrderApprovalReview } from "./financeOrderApprovalController";
import { FinanceOrderApprovalController } from "./financeOrderApprovalController";
import { FinanceOrderOpaqueController } from "./financeOrderOpaqueController";

/** Keeps legacy in-flight requests separate from the ticket-based v2 journal. */
export class FinanceOrderApprovalCoordinator {
  private active:FinanceOrderApprovalController|FinanceOrderOpaqueController|null=null;
  constructor(private readonly legacy:FinanceOrderApprovalController,private readonly opaque:FinanceOrderOpaqueController){}
  get current():FinanceOrderApprovalReview|null{return this.active?.current??null}
  cancel():void{this.legacy.cancel();this.opaque.cancel();this.active=null}
  async receive(url:string):Promise<FinanceOrderApprovalReview>{
    if(this.current)throw new Error("Finish the current Finance order approval first");
    let target:URL;try{target=new URL(url)}catch{throw new Error("Finance order launch URL is invalid")}
    if(target.protocol!=="ynxwallet:"||target.hostname!=="finance-order-approval")throw new Error("Finance order launch route is invalid");
    const controller=target.searchParams.has("ticket")?this.opaque:this.legacy;
    const review=await controller.receive(url);
    this.active=controller;
    return review;
  }
  hasReturn(id:string):boolean{return this.require(id).hasReturn(id)}
  canRevoke(id:string):boolean{return this.require(id).canRevoke(id)}
  isExpired(id:string):Promise<boolean>{return this.require(id).isExpired(id)}
  approve(id:string):Promise<void>{return this.require(id).approve(id)}
  reject(id:string):Promise<void>{return this.require(id).reject(id)}
  revokeUnused(id:string):Promise<void>{return this.require(id).revokeUnused(id)}
  retryReturn(id:string):Promise<void>{return this.require(id).retryReturn(id)}
  private require(id:string):FinanceOrderApprovalController|FinanceOrderOpaqueController{
    if(!this.active||this.active.current?.id!==id)throw new Error("Finance order review is no longer active");
    return this.active;
  }
}
