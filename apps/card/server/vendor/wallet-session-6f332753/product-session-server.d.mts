// Type-only consumer subset. Runtime is the unchanged Wallet-owner 6f332753 bundle.
export type CardApplicationDetails=Readonly<{nickname:string;useCase:string;limitWei:string;riskAccepted:true;termsVersion:'card-testnet-v1'}>;
export type CardApplicationChallenge=Readonly<{id:string;applicationId:string;owner:string;chainId:'0x1917';purpose:'create-testnet-card';payloadHash:string;nonce:string;issuedAt:string;expiresAt:string}>;
export type SignedCardApplicationApproval=Readonly<{version:'1';productId:'card';challenge:CardApplicationChallenge;details:CardApplicationDetails;account:string;accountPublicKey:string;issuedAt:string;expiresAt:string;signature:string}>;
export declare function verifySignedCardApplicationApproval(input:unknown,expected:Readonly<{challenge:CardApplicationChallenge;details:CardApplicationDetails;account:string}>,at?:Date):SignedCardApplicationApproval;
export declare function cardApplicationApprovalId(input:unknown):string;
export declare function evmAddressFromYNX(account:string):string;
export declare class ProductSessionServerAuthorizer {
  constructor(config:{registry:unknown;productId:'card';platform:'web'|'ios'|'android';endpoint:string;fetch:typeof fetch;timeoutMs:number;clock?:()=>Date});
  authorize(input:{proofHeader:string;origin:string|null;method:string;path:string;requiredScopes:readonly string[]}):Promise<Readonly<{account:string;chainId:'ynx_6423-1';expiresAt:string;scopes:readonly string[]}>>;
}
