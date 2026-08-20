// Legacy action types only type the existing DEX UI while the old action bridge
// is fail-closed. They are not a Product Session implementation.
import '@ynx-chain/wallet-auth';
declare module '@ynx-chain/wallet-auth' {
  export type DexActionName='dex_swap_exact_input'|'dex_swap_exact_output'|'dex_liquidity_add'|'dex_liquidity_remove';
  export type DexActionPayload=Readonly<Record<string,number|string>&{poolId:string;deadlineUnix:number}>;
  export type DexQuote=Readonly<{poolId:string;poolBlockHeight:number;poolUpdatedAt:string;asset0:string;asset1:string;reserve0:number;reserve1:number;feeBps:number;expectedAmount:number}>;
  export type DexActionResponse=Readonly<{version:'1';requestDigest:string;productClientId:'ynx-dex-web-v1';bundleId:'com.ynxweb4.dex.web';callback:'https://dex.ynxweb4.com/wallet-action/callback';sessionBinding:string;account:string;action:DexActionName;payloadHash:string;signedTransaction:Readonly<Record<string,unknown>>;canonicalPayloadHex:string;transactionHash:string;issuedAt:string;expiresAt:string}>;
}
