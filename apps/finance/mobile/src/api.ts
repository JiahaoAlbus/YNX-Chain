export type SourceStatus={available:boolean;source:string;coverage?:string;error?:string};
export type Activity={id:string;type:string;direction:string;from?:string;to?:string;amountYnxt:number;feeYnxt:number;timestamp:string;blockNumber:number;categoryId?:string;source:string};
export type PayReceipt={id:string;status:string;payer?:string;merchant?:string;amountYnxt:number;transactionHash?:string;createdAt:string;disputeUrl?:string;truthfulStatus:string};
export type Category={id:string;name:string;color:string};
export type Budget={id:string;name:string;categoryId:string;limitYnxt:number;period:string;startsAt:string;source?:string};
export type Reminder={id:string;title:string;amountYnxt?:number;schedule:string;nextDueAt:string;sourceRef?:string;enabled:boolean};
export type Note={id:string;recordId?:string;body:string;source:string;createdAt:string;updatedAt:string};
export type BudgetProgress={budgetId:string;spentYnxt:number;remainingYnxt:number;limitYnxt:number;periodStart:string;asOf:string;source:string};
export type Privacy={includePayInStatements:boolean;allowAiActivityContext:boolean;alertsEnabled:boolean};
export type AIJob={id:string;kind:string;recordIds:string[];provider:string;model:string;estimatedCost:string;status:string;progress?:string;result?:Record<string,unknown>;error?:string;decision?:string};
export type Support={helpUrl:string;privacyUrl:string;disputeUrl:string};
export type Overview={portfolio:{account:string;network:string;symbol:string;balanceYnxt:number;stakedYnxt:number;activity:Activity[];payReceipts:PayReceipt[];explorerStatus:SourceStatus;payStatus:SourceStatus;asOf:string;readOnly:boolean};profile:{categories:Category[];budgets:Budget[];reminders:Reminder[];notes:Note[];privacy:Privacy;aiJobs:AIJob[]};budgetProgress:BudgetProgress[];alerts:Array<Record<string,unknown>>;support:Support;boundaries:Record<string,unknown>};

export class FinanceAPI{
  constructor(readonly base:string,readonly session:string){}
  private async response(path:string,init?:RequestInit){
    const response=await fetch(this.base.replace(/\/$/,'')+path,{...init,headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.session}`,...init?.headers}});
    if(!response.ok)throw new Error(`${response.status}: ${(await response.text()).slice(0,200)}`);
    return response;
  }
  async call<T=unknown>(path:string,init?:RequestInit):Promise<T>{const response=await this.response(path,init);return (response.status===204?null:await response.json()) as T}
  overview(){return this.call<Overview>('/api/overview')}
  statement(){const now=new Date();return this.call<Record<string,unknown>>(`/api/statements?year=${now.getUTCFullYear()}&month=${now.getUTCMonth()+1}`)}
  monthlyReview(){const now=new Date();return this.call<Record<string,unknown>>(`/api/monthly-review?year=${now.getUTCFullYear()}&month=${now.getUTCMonth()+1}`)}
  async export(format:'json'|'csv'){const response=await this.response(`/api/export?format=${format}`);return format==='json'?JSON.stringify(await response.json(),null,2):response.text()}
  create<T=unknown>(path:string,value:unknown){return this.call<T>(path,{method:'POST',body:JSON.stringify(value)})}
  classify(recordId:string,categoryId:string,idempotencyKey:string){return this.call(`/api/activity/${encodeURIComponent(recordId)}/category`,{method:'PUT',body:JSON.stringify({categoryId,idempotencyKey})})}
  delete(path:string){return this.call(path,{method:'DELETE'})}
  privacy(value:Privacy){return this.call<Privacy>('/api/privacy',{method:'PUT',body:JSON.stringify(value)})}
  audit(){return this.call<{events:Array<Record<string,unknown>>}>('/api/audit')}
  ai(value:unknown){return this.create<AIJob>('/api/ai/jobs',value)}
  aiJob(id:string){return this.call<AIJob>(`/api/ai/jobs/${encodeURIComponent(id)}`)}
  decision(id:string,decision:'apply'|'reject'){return this.create<AIJob>(`/api/ai/jobs/${encodeURIComponent(id)}/decision`,{decision})}
  cancelAI(id:string){return this.create<AIJob>(`/api/ai/jobs/${encodeURIComponent(id)}/cancel`,{})}
  deleteAccount(){return this.call('/api/account',{method:'DELETE',body:JSON.stringify({confirmation:'DELETE FINANCE DATA'})})}
}
