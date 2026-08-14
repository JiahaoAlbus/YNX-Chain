import type { SecureStorageAdapter } from "../storage/walletRepository";

const ACTION_REPLAY_KEY="ynx.wallet.action-replays.v1";
const MAX_ACTION_REPLAY_RECORDS=4096;
const MAX_ACTION_REPLAY_BYTES=512*1024;
const EXACT_KEY=/^(exchange|developer|dex|quant):[0-9a-f]{64}$/;
const EXACT_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ActionReplayRecord=Readonly<{key:string;expiresAt:string}>;

export class PersistentActionReplayStore {
  private pending:Promise<void>=Promise.resolve();
  constructor(private readonly storage:SecureStorageAdapter){}

  async consume(record:ActionReplayRecord,at=new Date(),assertActive:()=>void=()=>{}):Promise<void>{
    const operation=this.pending.then(()=>this.consumeExclusive(record,at,assertActive));
    this.pending=operation.catch(()=>undefined);
    return operation;
  }

  private async consumeExclusive(record:ActionReplayRecord,at:Date,assertActive:()=>void):Promise<void>{
    if(!validRecord([record.key,record.expiresAt]))throw new Error("Wallet action replay binding is invalid");
    if(!(at instanceof Date)||!Number.isFinite(at.getTime())||at.toISOString()>=record.expiresAt)throw new Error("Wallet action replay binding is expired");
    const raw=await this.storage.getItem(ACTION_REPLAY_KEY);
    let records:readonly [string,string][]=[];
    if(raw!==null){
      if(raw.length>MAX_ACTION_REPLAY_BYTES)throw new Error("Wallet action replay record is too large");
      let value:unknown;try{value=JSON.parse(raw)}catch{throw new Error("Wallet action replay record is unreadable")}
      if(!Array.isArray(value)||value.length>MAX_ACTION_REPLAY_RECORDS||value.some((item)=>!validRecord(item)))throw new Error("Wallet action replay record is invalid");
      records=value as [string,string][];
      for(let index=1;index<records.length;index++)if(records[index-1]![0]>=records[index]![0])throw new Error("Wallet action replay record is not canonical");
    }
    if(records.some(([key])=>key===record.key))throw new Error("Wallet action request was already used");
    if(records.length>=MAX_ACTION_REPLAY_RECORDS)throw new Error("Wallet action replay record capacity is exhausted");
    const next=[...records,[record.key,record.expiresAt] as [string,string]].sort(([left],[right])=>left.localeCompare(right));
    assertActive();
    await this.storage.setItem(ACTION_REPLAY_KEY,JSON.stringify(next));
  }
}

function validRecord(value:unknown):value is [string,string]{
  if(!Array.isArray(value)||value.length!==2||typeof value[0]!=="string"||typeof value[1]!=="string"||!EXACT_KEY.test(value[0])||!EXACT_TIME.test(value[1]))return false;
  const parsed=Date.parse(value[1]);return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value[1];
}
