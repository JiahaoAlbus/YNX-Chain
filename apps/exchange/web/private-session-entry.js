import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from './vendor/product-session-browser-9840ef87.mjs';
import registry from './vendor/product-session-registry-9840ef87.json' with {type:'json'};
import {createPrivateAccountController,PRIVATE_READ_SCOPE} from './private-account-controller.js';
export const PRIVATE_SDK_SOURCE='9840ef871165eb523c4e7a3d48964dd25f8dee8e';
export function createExchangePrivateAccount({scope=globalThis,onState}={}){
  const fetchImpl=(...args)=>scope.fetch(...args);
  return createPrivateAccountController({origin:scope.location?.origin,fetchImpl,onState,createAdapter:()=>{
    // Unknown installation: only beginExplicit may expose a user-click attempt.
    // These conservative probes never claim a native handler is installed.
    const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:fetchImpl,walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:10000});
    return createBrowserProductSessionClient({registry,productId:'exchange',scopes:[PRIVATE_READ_SCOPE],purpose:'Read my Exchange testnet venue balances, orders and activity. This does not authorize trading or withdrawals.',gateway,environment:scope});
  }});
}
