import type {FundingIntent} from '../server/contracts';
export type FundingSendRecord=Readonly<{version:1;owner:string;cardId:string;intentId:string;sourceCommit:string;sessionBinding:string;sender:string;recipient:string;amountWei:string;chainId:'0x1917';expiresAt:string;status:'PENDING'|'RETURNED'|'REJECTED'|'UNKNOWN';txHash?:string}>;
export type FundingSendContext=Readonly<{owner:string;sessionBinding:string;expiresAt:string;sourceCommit:string}>;
export type FundingSendStorage={read:()=>Promise<string|null>;write:(raw:string)=>Promise<void>;exclusive:<T>(operation:()=>Promise<T>)=>Promise<T>};
export type FundingSendWallet={request:(input:{method:string;params?:unknown})=>Promise<unknown>};
const fail=(code:string):never=>{throw Error(code)};
const address=(value:unknown)=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value);
export function parseFundingSendRecord(raw:string,intent:FundingIntent,context:FundingSendContext):FundingSendRecord{
  if(typeof raw!=='string'||raw.length>65_536)fail('CARD_FUNDING_RECOVERY_REQUIRED');
  let value:any;try{value=JSON.parse(raw)}catch{fail('CARD_FUNDING_RECOVERY_REQUIRED')}
  const expected=['version','owner','cardId','intentId','sourceCommit','sessionBinding','sender','recipient','amountWei','chainId','expiresAt','status',...(value?.txHash!==undefined?['txHash']:[])];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==expected.sort().join('|'))fail('CARD_FUNDING_RECOVERY_REQUIRED');
  if(value?.version!==1||value.owner!==context.owner||value.cardId!==intent.cardId||value.intentId!==intent.id||value.sender!==intent.sender||value.recipient!==intent.recipient||value.amountWei!==intent.amountWei||value.chainId!=='0x1917'||value.expiresAt!==intent.expiresAt||typeof value.sessionBinding!=='string'||!value.sessionBinding||typeof value.sourceCommit!=='string'||! /^[a-f0-9]{40}$/.test(value.sourceCommit)||!['PENDING','RETURNED','REJECTED','UNKNOWN'].includes(value.status)||(value.status==='RETURNED'?!/^0x[a-f0-9]{64}$/.test(value.txHash??''):value.txHash!==undefined))fail('CARD_FUNDING_RECOVERY_REQUIRED');
  return value;
}
/** Called only by explicit user confirmation. Shared SDK performs wallet access;
 * this product layer binds the owned Card intent and prevents repeat sends. */
export async function sendExactCardFunding(input:{intent:FundingIntent;context:FundingSendContext;wallet:FundingSendWallet;storage:FundingSendStorage;isCurrent:()=>boolean;now?:()=>number;timeoutMs?:number;onRecoveryRecord?:(record:FundingSendRecord)=>void}):Promise<FundingSendRecord>{
  const {wallet,storage,isCurrent}=input,intent=structuredClone(input.intent),context={...input.context},now=input.now??Date.now;
  const timeout=input.timeoutMs??90000;
  const assertCurrent=()=>{if(!isCurrent()||Date.parse(context.expiresAt)<=now()||Date.parse(intent.expiresAt)<=now())fail('CARD_FUNDING_CONTEXT_CHANGED')};
  const assertWalletBinding=async()=>{
    assertCurrent();
    const accounts=await wallet.request({method:'eth_accounts'});assertCurrent();
    if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==intent.sender)fail('CARD_FUNDING_APPROVED_ACCOUNT_REQUIRED');
    const chain=await wallet.request({method:'eth_chainId'});assertCurrent();
    if(chain!=='0x1917')fail('WRONG_TESTNET_CHAIN');
  };
  if(intent.owner!==context.owner||intent.status!=='pending'||intent.chainId!=='0x1917'||!address(intent.sender)||!address(intent.recipient)||! /^[1-9][0-9]{0,77}$/.test(intent.amountWei)||BigInt(intent.amountWei)>=2n**256n||!Number.isFinite(Date.parse(intent.createdAt))||Date.parse(intent.createdAt)>now()||!Number.isFinite(Date.parse(intent.expiresAt))||!Number.isFinite(Date.parse(context.expiresAt))||!context.sessionBinding||! /^[a-f0-9]{40}$/.test(context.sourceCommit)||!Number.isSafeInteger(timeout)||timeout<1||timeout>90000)fail('CARD_FUNDING_INTENT_INVALID');
  return storage.exclusive(async()=>{
    assertCurrent();
    const prior=await storage.read();assertCurrent();
    if(prior){parseFundingSendRecord(prior,intent,context);fail('CARD_FUNDING_ALREADY_ATTEMPTED')}
    await assertWalletBinding();assertCurrent();
    const pending:FundingSendRecord={version:1,owner:context.owner,cardId:intent.cardId,intentId:intent.id,sourceCommit:context.sourceCommit,sessionBinding:context.sessionBinding,sender:intent.sender,recipient:intent.recipient,amountWei:intent.amountWei,chainId:'0x1917',expiresAt:intent.expiresAt,status:'PENDING'};
    const persist=async(record:FundingSendRecord)=>{const raw=JSON.stringify(record);await storage.write(raw);if(await storage.read()!==raw)fail('CARD_FUNDING_LOCAL_WRITE_UNCONFIRMED')};
    await persist(pending);assertCurrent();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let response:unknown;
    let attemptClosed=false;
    const transaction=Promise.resolve().then(async()=>{
      await assertWalletBinding();assertCurrent();
      if(attemptClosed)fail('CARD_FUNDING_SEND_TIMEOUT');
      return wallet.request({method:'eth_sendTransaction',params:[{from:intent.sender,to:intent.recipient,value:'0x'+BigInt(intent.amountWei).toString(16),chainId:'0x1917'}]});
    });
    try{
      response=await Promise.race([transaction,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CARD_FUNDING_SEND_TIMEOUT')),timeout)})]);
    }catch(error){
      attemptClosed=true;
      const rejected=typeof error==='object'&&error!==null&&'code' in error&&error.code===4001;
      const unresolved:FundingSendRecord={...pending,status:rejected?'REJECTED':'UNKNOWN'};
      await persist(unresolved);
      if(!rejected){
        // Observe the same request only. A late hash is recovery evidence, never
        // confirmation, credit or permission to broadcast a second transaction.
        void transaction.then(async late=>{
          if(typeof late!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(late))return;
          await storage.exclusive(async()=>{
            if(await storage.read()!==JSON.stringify(unresolved))return;
            const recovered:FundingSendRecord={...pending,status:'RETURNED',txHash:late.toLowerCase()};
            await persist(recovered);
            try{await assertWalletBinding();assertCurrent();input.onRecoveryRecord?.(recovered)}catch{/* Original hash remains recoverable, never applied to a changed account or network. */}
          });
        },()=>{}).catch(()=>{/* Keep the original UNKNOWN if recovery cannot be saved. */});
      }
      fail(rejected?'CARD_FUNDING_REJECTED':'CARD_FUNDING_OUTCOME_UNKNOWN');
    }finally{if(timer)clearTimeout(timer)}
    if(typeof response!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(response)){await persist({...pending,status:'UNKNOWN'});fail('CARD_FUNDING_OUTCOME_UNKNOWN')}
    const returned:FundingSendRecord={...pending,status:'RETURNED',txHash:(response as string).toLowerCase()};
    await persist(returned);assertCurrent();return returned;
  });
}
