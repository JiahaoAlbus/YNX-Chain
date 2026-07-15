import { OneTimeNonceStore, type AuthorizationRequest } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";

const REPLAY_KEY="ynx.wallet.auth-nonces.v1";

export class PersistentNonceStore {
  constructor(private readonly storage:SecureStorageAdapter){}
  async consume(request:AuthorizationRequest,at=new Date()):Promise<void>{
    const raw=await this.storage.getItem(REPLAY_KEY);
    let records:readonly [string,string][]=[];
    if(raw!==null){
      let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error("Wallet authorization replay record is unreadable");}
      if(!Array.isArray(value)||value.some((item)=>!Array.isArray(item)||item.length!==2||typeof item[0]!=="string"||typeof item[1]!=="string"))throw new Error("Wallet authorization replay record is invalid");
      records=value as [string,string][];
    }
    const store=new OneTimeNonceStore(records);
    store.consume(request,at);
    await this.storage.setItem(REPLAY_KEY,JSON.stringify(store.snapshot()));
  }
}
