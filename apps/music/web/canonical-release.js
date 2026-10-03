import {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter} from './vendor/wallet-auth-5c5e8a23/artifacts/product-session-browser.mjs';
import {MUSIC_ORIGIN,MUSIC_SCOPES} from './canonical-request.js';

// The matching private registry/module/decl graph is A's frozen5c successor.
// Approval, protected key storage and callback/recovery remain in the real SDK;
// original Music activation still requires matching original /api/me readback.
export async function loadCanonicalMusicRelease({environment=globalThis}={}){
 if(environment.location?.origin!==MUSIC_ORIGIN||environment.isSecureContext!==true)throw Error('Music sign-in requires its registered HTTPS origin');
 const response=await environment.fetch(new URL('./vendor/wallet-auth-5c5e8a23/source/packages/wallet-auth/product-session-registry.json',import.meta.url),{cache:'no-cache',credentials:'omit',redirect:'error'});
 if(!response.ok)throw Error('Music sign-in configuration is unavailable. Please retry.');
 const registry=await response.json();
 const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:environment.fetch.bind(environment),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:15000});
 return createBrowserProductSessionClient({registry,productId:'music',scopes:[...MUSIC_SCOPES],purpose:'Access my Music profile, library and playback, and manage my creator releases and reviews',gateway,environment});
}
