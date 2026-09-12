import {createServer,type IncomingMessage} from 'node:http';
import {CardError,ENVIRONMENT,type WalletAuthority} from './contracts.ts';
import {CardService} from './service.ts';
import {requireScope,scopeForRoute} from './permissions.ts';
async function body(request:IncomingMessage):Promise<any>{let bytes=0;const chunks:Buffer[]=[];for await(const chunk of request){const data=Buffer.from(chunk);bytes+=data.length;if(bytes>65536)throw new CardError('REQUEST_TOO_LARGE',413);chunks.push(data)}try{return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}catch{throw new CardError('INVALID_JSON',400)}}
function rejectSensitive(value:any){if(Array.isArray(value)){value.forEach(rejectSensitive);return}if(!value||typeof value!=='object')return;for(const[key,child]of Object.entries(value)){if(/^(pan|cvv|cvc|pin|seed|mnemonic|privateKey|cryptogram|trackData|fullCardNumber)$/i.test(key))throw new CardError('SENSITIVE_PAYMENT_DATA_FORBIDDEN',400);rejectSensitive(child)}}
export function createCardServer(options:{service:CardService;wallet:WalletAuthority;sourceCommit:string;allowedOrigin?:string;configurationReady:boolean}){
  return createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Type','application/json; charset=utf-8');
    const send=(status:number,value:unknown)=>{response.statusCode=status;response.end(JSON.stringify(value))};
    try{
      const origin=request.headers.origin;if(origin&&origin!==options.allowedOrigin)throw new CardError('CARD_ORIGIN_NOT_ALLOWED',403);if(origin){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin')}
      if(request.method==='OPTIONS'){response.setHeader('Access-Control-Allow-Headers','X-YNX-Product-Session-Proof-V2, Content-Type, Idempotency-Key');response.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, OPTIONS');response.statusCode=204;response.end();return}
      const path=new URL(request.url??'/','http://card-backend.invalid').pathname;
      if(request.method==='GET'&&(path==='/healthz'||path==='/version')){send(200,{service:'ynx-card-business-backend',schemaVersion:1,sourceCommit:options.sourceCommit,environment:ENVIRONMENT,configurationReady:options.configurationReady,runtimeFundingVerified:false,productionRealPayments:false});return}
      const method=request.method??'',requiredScope=scopeForRoute(method,path);
      if(request.headers.authorization||request.headers['x-ynx-product-session-proof'])throw new CardError('LEGACY_CARD_AUTH_NOT_SUPPORTED',401);
      const proof=request.headers['x-ynx-product-session-proof-v2'];if(Array.isArray(proof))throw new CardError('INVALID_SESSION_PROOF',401);
      const principal=await options.wallet.authenticate({proofHeader:proof??'',...(origin?{origin}:{}),operation:method==='GET'?'read':'write',method,path,requiredScopes:[requiredScope]});requireScope(principal,requiredScope);const input=await body(request);rejectSensitive(input);
      const key=String(request.headers['idempotency-key']??'');const service=options.service;let result:unknown;
      if(request.method==='GET'&&path==='/api/card/v1/state')result=service.getState(principal);
      else if(request.method==='POST'&&path==='/api/card/v1/applications')result=service.createApplication(principal,input,key);
      else if(request.method==='POST'&&path==='/api/card/v1/topups')result=await service.confirmTopup(principal,input.intentId,input.txHash,key);
      else {
        const app=/^\/api\/card\/v1\/applications\/([^/]+)(?:\/(approval-request|submit|cancel))?$/.exec(path);
        const card=/^\/api\/card\/v1\/cards\/([^/]+)\/(topup-intents|freeze|unfreeze|close|recover|controls|authorizations|fees|statement|reconciliation)$/.exec(path);
        const settlement=/^\/api\/card\/v1\/(authorizations|captures)\/([^/]+)\/(capture|reverse|refund)$/.exec(path);
        if(app&&request.method==='PATCH'&&!app[2])result=service.updateApplication(principal,app[1]!,input,key);
        else if(app&&request.method==='POST'&&app[2]==='approval-request')result=service.requestApproval(principal,app[1]!,key);
        else if(app&&request.method==='POST'&&app[2]==='submit')result=await service.submitApplication(principal,app[1]!,input.proof,key);
        else if(app&&request.method==='POST'&&app[2]==='cancel')result=service.cancelApplication(principal,app[1]!,key);
        else if(card&&request.method==='GET'&&card[2]==='statement')result=service.statement(principal,card[1]!);
        else if(card&&request.method==='GET'&&card[2]==='reconciliation')result=service.reconcile(principal,card[1]!);
        else if(card&&request.method==='POST'&&card[2]==='topup-intents')result=service.createTopupIntent(principal,card[1]!,input,key);
        else if(card&&request.method==='PUT'&&card[2]==='controls')result=service.updateControls(principal,card[1]!,input,key);
        else if(card&&request.method==='POST'&&card[2]==='authorizations')result=service.authorize(principal,card[1]!,input,key);
        else if(card&&request.method==='POST'&&card[2]==='fees')result=service.applySimulationFee(principal,card[1]!,input,key);
        else if(card&&request.method==='POST'&&['freeze','unfreeze','close','recover'].includes(card[2]!))result=service.changeCard(principal,card[1]!,card[2] as 'freeze'|'unfreeze'|'close'|'recover',key);
        else if(settlement&&request.method==='POST'&&((settlement[1]==='captures'&&settlement[3]==='refund')||(settlement[1]==='authorizations'&&settlement[3]!=='refund')))result=service.settle(principal,settlement[2]!,settlement[3] as 'capture'|'reverse'|'refund',input,key);
        else throw new CardError('CARD_ROUTE_NOT_FOUND',404);
      }
      send(200,{schemaVersion:1,environment:ENVIRONMENT,productionRealPayments:false,data:result});
    }catch(error){const known=error instanceof CardError;send(known?error.status:503,{error:{code:known?error.code:'PRIVATE_SERVICE_DEGRADED',message:known?error.code:'Card private service is unavailable'},environment:ENVIRONMENT,productionRealPayments:false})}
  });
}
