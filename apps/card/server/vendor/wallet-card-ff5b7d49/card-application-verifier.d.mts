// Type-only subset of Wallet/Auth ff5b7d49 src/index.d.ts.
export type CardApplicationDetails=Readonly<{nickname:string;useCase:string;limitWei:string;riskAccepted:true;termsVersion:'card-testnet-v1'}>;
export type CardApplicationChallenge=Readonly<{id:string;applicationId:string;owner:string;chainId:'0x1917';purpose:'create-testnet-card';payloadHash:string;nonce:string;issuedAt:string;expiresAt:string}>;
export type SignedCardApplicationApproval=Readonly<{version:'1';productId:'card';challenge:CardApplicationChallenge;details:CardApplicationDetails;account:string;accountPublicKey:string;issuedAt:string;expiresAt:string;signature:string}>;
export declare const CARD_APPLICATION_APPROVAL_DOMAIN:string;
export declare function verifySignedCardApplicationApproval(input:unknown,expected:Readonly<{challenge:CardApplicationChallenge;details:CardApplicationDetails;account:string}>,at?:Date):SignedCardApplicationApproval;
export declare function parseSignedCardApplicationApproval(input:unknown):SignedCardApplicationApproval;
export declare function cardApplicationDetailsHash(details:CardApplicationDetails):string;
export declare function cardApplicationApprovalId(input:unknown):string;
export declare function evmAddressFromYNX(account:string):string;
