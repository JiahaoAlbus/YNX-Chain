import {
  canonicalJSON, centralApprovalDigest, createGatewayChallenge, parseCallbackURL,
  parseCentralWalletSession, requestDigest, signGatewayChallenge, verifyAuthorization,
  verifyGatewayCompletion, type AuthorizationRequest, type AuthorizationResponse,
  type CentralWalletSession,
} from '@ynx-chain/wallet-auth';

type Device={secret:string;key:string};
type GatewayResponse={ok:boolean;status:number;json():Promise<unknown>};
export type WalletCompletionDependencies={
  now:Date;
  gatewayURL:string;
  getPending():Promise<string|null>;
  deletePending():Promise<void>;
  getDevice():Promise<Device>;
  randomNonce():Promise<string>;
  post(url:string,body:string):Promise<GatewayResponse>;
};

function mismatch(field:string):never{throw new Error(`Central Gateway session binding mismatch (${field}); pending Wallet approval was preserved`)}
function equalList(left:readonly string[],right:readonly string[]){return left.length===right.length&&left.every((value,index)=>value===right[index])}

/** Complete and consume a pending request only after the returned session is fully bound to this approval. */
export async function completeWalletSession(url:string,deps:WalletCompletionDependencies):Promise<CentralWalletSession>{
  const pending=await deps.getPending();
  if(!pending)throw new Error('Pending Wallet request missing after restart');
  let request:AuthorizationRequest;
  try{request=JSON.parse(pending) as AuthorizationRequest}catch{throw new Error('Pending Wallet request is invalid')}
  const approval=verifyAuthorization(parseCallbackURL(url,request.callback),{...request,requestDigest:requestDigest(request),now:deps.now}) as AuthorizationResponse;
  const d=await deps.getDevice(),expiresAt=new Date(Math.min(Date.parse(approval.expiresAt),deps.now.getTime()+120_000)).toISOString();
  const challenge=createGatewayChallenge(approval,{challenge:await deps.randomNonce(),expiresAt},deps.now),gatewayCompletion=signGatewayChallenge(challenge,d.secret);
  const response=await deps.post(deps.gatewayURL,canonicalJSON({authorizationRequest:request,walletApproval:approval,gatewayCompletion}));
  if(!response.ok)throw new Error(`Central Gateway device proof rejected (${response.status}); no local session or fallback was created`);
  const envelope=await response.json() as {ok?:unknown;result?:unknown};
  if(envelope?.ok!==true)throw new Error('Central Gateway returned no canonical Finance Product Session');
  const parsed=parseCentralWalletSession(envelope.result);
  if(parsed.verifierVersion!=='wallet-auth-v2')mismatch('verifierVersion');
  const session=parsed as CentralWalletSession,completion=verifyGatewayCompletion(gatewayCompletion,approval,deps.now);
  const exact:[keyof CentralWalletSession,unknown][]=[
    ['sessionBinding',completion.sessionBinding],['chainId',request.chainId],['requestingProduct',request.requestingProduct],
    ['productClientId',request.productClientId],['bundleId',request.bundleId],['origin',request.origin],
    ['callback',request.callback],['productDeviceAlgorithm',request.productDeviceAlgorithm],['productDeviceKey',request.productDeviceKey],
    ['account',approval.account],['nonce',request.nonce],['purpose',request.purpose],['requestDigest',approval.requestDigest],
    ['approvalDigest',centralApprovalDigest(approval)],['issuedAt',challenge.issuedAt],['expiresAt',completion.expiresAt],
  ];
  for(const [field,expected] of exact)if(session[field]!==expected)mismatch(field);
  if(!equalList(session.scopes,approval.grantedScopes))mismatch('scopes');
  await deps.deletePending();
  return session;
}
