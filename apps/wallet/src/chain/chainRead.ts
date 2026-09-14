import type { ChainAccount, ChainActivity } from "./nativeTransfer";

export type ChainReadClient=Readonly<{
  account:(account:string)=>Promise<ChainAccount>;
  activity:(account:string)=>Promise<readonly ChainActivity[]>;
}>;

export type ChainReadResult=Readonly<{
  account:ChainAccount;
  activity:readonly ChainActivity[];
  activityError?:string;
}>;

// Account authority and transaction history have separate bounded reads.  A
// history outage must not hide a successfully verified account balance/nonce,
// and an account failure must never be converted into a partial success.
export async function readAuthoritativeChainAccount(client:ChainReadClient,account:string):Promise<ChainReadResult>{
  const verifiedAccount=await client.account(account);
  try{return Object.freeze({account:verifiedAccount,activity:await client.activity(account)})}
  catch(caught){return Object.freeze({account:verifiedAccount,activity:Object.freeze([]),activityError:message(caught)})}
}

function message(value:unknown){return value instanceof Error?value.message:String(value)}
