export type SourceStatus={available:boolean;source:string;version?:string;asOf?:string;asOfKind?:string;coverage?:string;syncStatus:string;error?:string};
export type ReadSourceAction={label:string;url?:string;configured:boolean;owner:string;opensOwnerProduct:boolean;requiresOwnerApproval:boolean};
export type ExchangeBalance={asset:string;availableMicro:number;reservedMicro:number};
export type ExchangeOrder={id:string;market:string;side:string;type:string;timeInForce:string;priceMicro:number;amountMicro:number;filledMicro:number;status:string;createdAt:string;updatedAt:string};
export type ExchangeFill={id:string;market:string;side:string;priceMicro:number;amountMicro:number;feeMicro:number;createdAt:string};
export type ExchangePosition={market:string;sizeMicro:number;entryPriceMicro:number;markPriceMicro:number;unrealizedPnlMicro:number;realizedPnlMicro:number;leverage:number;status:string;updatedAt:string};
export type ExchangeFunding={id:string;market:string;positionSizeMicro:number;rateBps:number;paymentMicro:number;settledAt:string};
export type ExchangeFinancePayload={product:string;productVersion:string;buildCommit:string;balances:ExchangeBalance[];orders:ExchangeOrder[];trades:ExchangeFill[];fees:Array<{asset:string;amountMicro:number;kind:string;createdAt:string}>;equityMicro:number;freeCollateralMicro:number;positions:ExchangePosition[];perpetualOrders:ExchangeOrder[];perpetualTrades:ExchangeFill[];funding:ExchangeFunding[];oracleStatus:string};
export type QuantStrategy={id:string;name:string;family:string;stage:string;strategyHash:string;modelHash:string;dataHash:string;params:Record<string,number>;limitations:string;createdAt:string};
export type QuantAttribution={currency:string;alpha:number;beta:number;carryFunding:number;makerRebateLpFee:number;tradingFee:number;gas:number;slippage:number;mev:number;oracleDrift:number;averageIdleCapital:number;computeDataFee:number;managementPerformanceFee:number;userRealizedPnl:number;userUnrealizedPnl:number;userNetPnl:number;reconciled:boolean;unsupportedComponents:string[]};
export type QuantExperiment={id:string;strategyHash:string;strategyName:string;stage:string;status:string;metrics:{returnBps:number;buyHoldBps:number;maxDrawdownBps:number;trades:number;partialFills:number;dataGaps:number;noTrade:boolean};attribution:QuantAttribution;leakageChecksPassed:boolean;auditDigest:string;createdAt:string};
export type QuantMandate={digest:string;strategyHash:string;market:string;scope:string;maxNotional:number;maxPosition:number;maxDailyLoss:number;maxSlippageBps:number;maxLeverageBps:number;maxDrawdown:number;maxVar:number;maxExpectedShortfall:number;expiresAt:string;revoked:boolean;revokedAt?:string};
export type QuantExecution={id:string;mandateDigest:string;strategyHash:string;market:string;side:string;price:number;amount:number;brokerProof:string;venueOrderId:string;venueStatus:string;authorizationDigest:string;status:string;createdAt:string};
export type QuantPaperState={cash:number;position:number;realizedPnl:number;reconciliationDelta:number;killSwitch:boolean;updatedAt:string};
export type QuantFinancePayload={product:string;productVersion:string;buildCommit:string;strategies:QuantStrategy[];experiments:QuantExperiment[];mandates:QuantMandate[];executions:QuantExecution[];paper:QuantPaperState[];tenantStates:number};
export type ReadSourceEnvelope={envelopeVersion:string;sourceId:string;owner:string;network:string;nativeAsset:string;authorizedAccount:string;ownerContractVersion:string;payloadSchema:string;asOf:string;asOfKind:string;coverage:string;syncStatus:string;readOnly:boolean;capabilities:string[];payload:ExchangeFinancePayload|QuantFinancePayload};
export type ReadSource={id:string;name:string;owner:string;capability:string;consumerEnvelopeVersion:string;ownerContractAccepted:boolean;readOnly:boolean;status:SourceStatus;action:ReadSourceAction;forbiddenCapabilities:string[];envelope?:ReadSourceEnvelope};
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
export type Overview={portfolio:{account:string;network:string;symbol:string;balanceYnxt:number;stakedYnxt:number;activity:Activity[];payReceipts:PayReceipt[];explorerStatus:SourceStatus;payStatus:SourceStatus;readSources:Record<string,ReadSource>;asOf:string;readOnly:boolean};profile:{categories:Category[];budgets:Budget[];reminders:Reminder[];notes:Note[];privacy:Privacy;aiJobs:AIJob[]};budgetProgress:BudgetProgress[];alerts:Array<Record<string,unknown>>;support:Support;boundaries:Record<string,unknown>};

export class FinanceAPI{
  constructor(readonly base:string,readonly session:CentralWalletSession){}
  private scope(path:string){if(path.startsWith('/api/ai/'))return 'finance.ai.draft';if(['/api/categories','/api/budgets','/api/reminders','/api/notes','/api/privacy','/api/account'].some(value=>path.startsWith(value))||path.includes('/category'))return 'finance.profile.write';return 'finance.portfolio.read'}
  private async response(path:string,init?:RequestInit){
    const response=await fetch(this.base.replace(/\/$/,'')+path,{...init,headers:{'Content-Type':'application/json','X-YNX-Product-Session-Proof':await gatewayProof(this.session,this.scope(path)),...init?.headers}});
    if(!response.ok)throw new Error(`${response.status}: ${(await response.text()).slice(0,200)}`);
    return response;
  }
  async call<T=unknown>(path:string,init?:RequestInit):Promise<T>{const response=await this.response(path,init);return (response.status===204?null:await response.json()) as T}
  overview(){return this.call<Overview>('/api/overview')}
  sources(){return this.call<{consumerEnvelopeVersion:string;readOnly:boolean;integrationState:string;sources:Record<string,ReadSource>}>('/api/sources')}
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
import type {CentralWalletSession} from '@ynx-chain/wallet-auth';
import {gatewayProof} from './wallet';
