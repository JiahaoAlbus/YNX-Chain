import {ProductSessionServerAuthorizer} from './vendor/wallet-session-6f332753/product-session-server.mjs';
import {registry} from './vendor/wallet-session-6f332753/registry.mjs';
import {CardError,subject,type WalletAuthority} from './contracts.ts';
import {scopeForRoute} from './permissions.ts';

export const CARD_SESSION_AUTHORITY='https://wallet-auth.ynxweb4.com';
export const CARD_SESSION_SDK_SOURCE='6f332753baae5deaf6b05c8276b20a02cc4887c5';

/** Only trusted bootstrap/test code may inject transport/time. The HTTP caller
 * never supplies an authority URL, registry, authorizer or identity claim. */
export function createWalletAuthority(dependencies:{fetch?:typeof fetch;clock?:()=>Date}={}):Pick<WalletAuthority,'authenticate'>{
  const authorizers=Object.fromEntries((['web','ios','android'] as const).map(platform=>[platform,new ProductSessionServerAuthorizer({
    registry,productId:'card',platform,endpoint:CARD_SESSION_AUTHORITY,fetch:dependencies.fetch??globalThis.fetch.bind(globalThis),timeoutMs:5000,
    ...(dependencies.clock?{clock:dependencies.clock}:{}),
  })]));
  return {async authenticate(request){
    const expected=scopeForRoute(request.method,request.path);
    if(request.requiredScopes.length!==1||request.requiredScopes[0]!==expected)throw new CardError('CARD_ROUTE_SCOPE_MISMATCH',403);
    const platform=request.platform??(request.origin?'web':undefined);
    if(platform!=='web'&&platform!=='ios'&&platform!=='android')throw new CardError('CARD_PLATFORM_REQUIRED',401);
    try{
      const session=await authorizers[platform]!.authorize({proofHeader:request.proofHeader,origin:request.origin??null,
        method:request.method,path:request.path,requiredScopes:[expected]});
      return {owner:subject(session.account),chainId:session.chainId,expiresAt:session.expiresAt,scopes:Object.freeze([...session.scopes])};
    }catch(error){
      const code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
      if(['ORIGIN_MISMATCH','CROSS_PRODUCT_SESSION','HTTP_BINDING_MISMATCH','SESSION_BINDING_MISMATCH','SCOPE_WIDENING','INVALID_ROUTE_POLICY'].includes(code))throw new CardError(code,403);
      if(['SESSION_EXPIRED','SESSION_INACTIVE','REPLAY','INVALID_PROOF','INVALID_PROOF_HEADER','INVALID_REQUEST','INVALID_BASE64URL','INVALID_SIGNATURE'].includes(code))throw new CardError(code,401);
      throw new CardError('PRIVATE_SERVICE_DEGRADED',503);
    }
  }};
}
