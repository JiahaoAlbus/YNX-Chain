import {createPrivateSessionController} from '../../seller-console/product-session.js';
import { p256 } from "@noble/curves/nist.js";
import { createRequestContext } from "./request-context.js";
import {discoverEip6963WalletProviders} from '@ynx-chain/wallet-auth/wallet-provider-discovery';
import {StandardWalletConnection,Eip1193ProviderError} from '@ynx-chain/wallet-auth/standard-wallet-connection';
import {
  encodeBase64url,
  encodeRequestDeepLink,
  parseAuthorizationRequest,
  parseCallbackURL,
  registryParserBinding,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
} from "@ynx-chain/wallet-auth";

export const MERCHANT_REGISTRY=Object.freeze({schemaVersion:3,productClientId:"ynx-merchant-console-v1",requestingProduct:"pay-merchant",bundleId:"com.ynxweb4.merchant-console",callbacks:Object.freeze(["https://pay.ynxweb4.com/merchant/wallet-auth/callback"]),origins:Object.freeze(["https://pay.ynxweb4.com"]),scopes:Object.freeze(["account:read","merchant:session:create"]),maxScopes:2,productDeviceAlgorithms:Object.freeze(["p256-sha256"])});
export const WALLET_INSTALL_OPTIONS=Object.freeze({ynx:"https://ynxweb4.com/dapp/download",metamask:"https://metamask.io/download/"});
const STORAGE="ynx-merchant-wallet-auth-v1";
const pendingRequests=createRequestContext(()=>sessionStorage.getItem(STORAGE));
const completing=new Set();

export function cancelWalletSignIn(){pendingRequests.invalidate();sessionStorage.removeItem(STORAGE);void canonicalMerchant.clear().catch(()=>{});sessionStorage.removeItem("ynx-merchant-canonical-selection-v2")}

export async function connectStandardWallet({windowLike=globalThis,timeoutMs=250,network=globalThis.YNX_STANDARD_WALLET_NETWORK,origin=windowLike.location?.origin??globalThis.location?.origin??'https://pay.ynxweb4.com'}={}){
 const discovery=await discoverEip6963WalletProviders(windowLike,timeoutMs);
 const preferred=[...discovery.candidates].filter(candidate=>!discovery.ambiguities.includes(candidate.kind)).sort((left,right)=>(left.kind==='ynx-wallet'?0:1)-(right.kind==='ynx-wallet'?0:1))[0];
 if(!preferred)throw Object.assign(new Error('No compatible standard EVM wallet was found.'),{code:'WALLET_NOT_FOUND',details:{installOptions:WALLET_INSTALL_OPTIONS}});
 const connection=new StandardWalletConnection({provider:preferred.provider,origin,metadata:{name:'YNX Merchant Console',url:origin}});
 try{
  const connected=await connection.connect();
  const expectedAccount=connected.selectedAccount;
  const assertCurrent=()=>{if(connection.current?.selectedAccount!==expectedAccount)throw new Eip1193ProviderError(4100,'Wallet account changed during network confirmation.');};
  const target='0x1917';let chain=await connection.request({method:'eth_chainId'});assertCurrent();
  if(typeof chain!=='string'||chain.toLowerCase()!==target){
   try{await connection.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});assertCurrent();}
   catch(error){assertCurrent();if(error.code!==4902||!network?.rpcUrl)throw error;
    await connection.request({method:'wallet_addEthereumChain',params:[{chainId:target,chainName:'YNX Testnet',nativeCurrency:{name:'YNX Testnet',symbol:'YNXT',decimals:18},rpcUrls:[network.rpcUrl],blockExplorerUrls:network.explorerUrl?[network.explorerUrl]:[]}]});assertCurrent();
    await connection.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});assertCurrent();
   }
  }
  chain=await connection.request({method:'eth_chainId'});assertCurrent();
  if(typeof chain!=='string'||chain.toLowerCase()!==target)throw new Eip1193ProviderError(4901,'Wallet did not confirm YNX Testnet.');
  // Refresh the SDK's selected account/chain using a silent permission read,
  // never a second grant; reject any changed account across every await.
  const confirmed=await connection.restore();assertCurrent();
  if(confirmed?.selectedAccount!==expectedAccount||confirmed.selectedChain!==target)throw new Eip1193ProviderError(4901,'Wallet network or account changed during readback.');
  return Object.freeze({connection,providerInfo:Object.freeze({name:preferred.name??'EVM Wallet',rdns:preferred.rdns}),providerName:preferred.name??'EVM Wallet',account:confirmed.selectedAccount,chainId:confirmed.selectedChain,state:'STANDARD_CONNECTED'});
 }catch(error){connection.disconnect();throw error;}
}

export function privateServiceDegraded(error,standardConnection){return Object.freeze({standardConnection:standardConnection?.account?'STANDARD_CONNECTED':'NOT_CONNECTED',account:standardConnection?.account??null,privateService:Object.freeze({state:'PRIVATE_SERVICE_DEGRADED',code:'PRODUCT_SESSION_GATEWAY_UNREACHABLE'})});}

export function beginWalletSignIn(merchantId,now=new Date()){
  return encodeRequestDeepLink(prepareWalletSignIn(merchantId,now));
}

const canonicalMerchant=createPrivateSessionController({productId:'pay-merchant',scopes:['account:read','merchant:session:create'],purpose:'Sign in to my authorized YNX Merchant Console records on ynx_6423-1.',endpoint:()=>globalThis.YNX_APP_GATEWAY_URL||null});
export async function launchMerchantWalletSignIn(merchantId){
 if(!/^mrc_[A-Za-z0-9._:-]{3,127}$/.test(merchantId))throw new Error('A valid merchant ID is required');
 // The selected object is a navigation hint, never membership or a role grant.
 const state=await canonicalMerchant.begin();
 sessionStorage.setItem('ynx-merchant-canonical-selection-v2',merchantId);
 return state;
}

function prepareWalletSignIn(merchantId,now){
  if(!/^mrc_[A-Za-z0-9._:-]{3,127}$/.test(merchantId))throw new Error("A valid merchant ID is required");
  cancelWalletSignIn();
  const secret=p256.utils.randomSecretKey();
  const request=parseAuthorizationRequest({version:"2",nonce:randomNonce(),chainId:"ynx_6423-1",requestingProduct:MERCHANT_REGISTRY.requestingProduct,productClientId:MERCHANT_REGISTRY.productClientId,bundleId:MERCHANT_REGISTRY.bundleId,productDeviceAlgorithm:"p256-sha256",productDeviceKey:encodeBase64url(p256.getPublicKey(secret,true)),origin:MERCHANT_REGISTRY.origins[0],callback:MERCHANT_REGISTRY.callbacks[0],scopes:[...MERCHANT_REGISTRY.scopes],purpose:"Sign in to the YNX Merchant Console for this merchant",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+5*60_000).toISOString()},{now,registry:registryParserBinding(MERCHANT_REGISTRY)});
  sessionStorage.setItem(STORAGE,JSON.stringify({merchantId,request,deviceSecret:encodeBase64url(secret)}));
  return request;
}

export async function finishWalletSignIn(callbackURL,gatewayBase,now=new Date()){
  if(new URL(callbackURL).searchParams.has("result")){
    await canonicalMerchant.recover(callbackURL);
    throw new Error("Canonical private approval was checked. Merchant membership readback is not yet configured; no role or merchant session was created.");
  }
  const pending=sessionStorage.getItem(STORAGE);
  const stored=JSON.parse(pending||"null");
  if(!stored?.merchantId||!stored?.request||!stored?.deviceSecret)throw new Error("Wallet sign-in recovery state is missing or expired");
  if(completing.has(pending))throw new Error("This Wallet approval is already being completed");
  const assertCurrent=pendingRequests.capture();
  const approval=verifyAuthorization(parseCallbackURL(callbackURL,MERCHANT_REGISTRY.callbacks[0]),{...stored.request,requestDigest:requestDigest(stored.request),now});
  completing.add(pending);
  try{
    const challenge=await gatewayRequest(gatewayBase,"/app/pay-merchant/session/challenges",{request:stored.request,approval});
    assertCurrent();
    const completion=signGatewayChallenge(challenge,stored.deviceSecret);
    const session=await gatewayRequest(gatewayBase,"/app/pay-merchant/session/complete",{request:stored.request,approval,completion,merchantId:stored.merchantId});
    assertCurrent();
    if(session.account!==approval.account||session.merchant?.id!==stored.merchantId||!['owner','finance','developer','support','viewer'].includes(session.role)||typeof session.token!=="string"||!session.token.trim())throw new Error("Gateway returned a mismatched merchant session");
    sessionStorage.removeItem(STORAGE);
    return session;
  }catch(error){assertCurrent();throw error}finally{completing.delete(pending)}
}

export function hasWalletCallback(url=location.href){try{return new URL(url).searchParams.has("response")||new URL(url).searchParams.has("result")}catch{return false}}
async function gatewayRequest(base,path,body){if(!base)throw new Error("YNX App Gateway URL is not configured");return pendingRequests.fetchJSON(base.replace(/\/$/,"")+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})}
function randomNonce(){return encodeBase64url(crypto.getRandomValues(new Uint8Array(24)))}
