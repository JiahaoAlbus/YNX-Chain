import { OneTimeNonceStore, type AuthorizationRequest } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const REPLAY_KEY="ynx.wallet.auth-nonces.v1";
const MAX_REPLAY_RECORDS=4096;
const MAX_REPLAY_BYTES=512*1024;
const NONCE=/^[A-Za-z0-9_-]{32,64}$/;
const EXACT_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class PersistentNonceStore {
  private pending:Promise<void>=Promise.resolve();
  constructor(private readonly storage:SecureStorageAdapter){}
  async consume(request:AuthorizationRequest,at=new Date(),assertActive:()=>void=()=>{}):Promise<void>{
    const operation=this.pending.then(()=>this.consumeExclusive(request,at,assertActive));
    this.pending=operation.catch(()=>undefined);
    return operation;
  }
  private async consumeExclusive(request:AuthorizationRequest,at:Date,assertActive:()=>void):Promise<void>{
    const raw=await this.storage.getItem(REPLAY_KEY);
    let records:readonly [string,string][]=[];
    if(raw!==null){
      if(raw.length>MAX_REPLAY_BYTES)throw new Error("Wallet authorization replay record is too large");
      let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error("Wallet authorization replay record is unreadable");}
      if(!Array.isArray(value)||value.length>MAX_REPLAY_RECORDS||value.some((item)=>!validRecord(item)))throw new Error("Wallet authorization replay record is invalid");
      records=value as [string,string][];
      for(let index=1;index<records.length;index++)if(records[index-1]![0]>=records[index]![0])throw new Error("Wallet authorization replay record is not canonical");
    }
    const store=new OneTimeNonceStore(records);
    store.consume(request,at);
    const snapshot=store.snapshot();
    if(snapshot.length>MAX_REPLAY_RECORDS)throw new Error("Wallet authorization replay record capacity is exhausted");
    assertActive();
    await this.storage.setItem(REPLAY_KEY,JSON.stringify(snapshot));
  }
}

function validRecord(value:unknown):value is [string,string]{
  if(!Array.isArray(value)||value.length!==2||typeof value[0]!=="string"||typeof value[1]!=="string"||!NONCE.test(value[0])||!EXACT_TIME.test(value[1]))return false;
  const parsed=Date.parse(value[1]);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value[1];
}
