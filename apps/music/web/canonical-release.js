import {MUSIC_ORIGIN,MUSIC_SCOPES} from './canonical-request.js';

// The matching private registry/module/decl graph is the complete current R9 same-copy source.
// Approval, protected key storage and callback/recovery remain in the real SDK;
// original Music activation still requires matching original /api/me readback.
export async function loadCanonicalMusicRelease({environment=globalThis}={}){
 if(environment.location?.origin!==MUSIC_ORIGIN||environment.isSecureContext!==true)throw Error('Music sign-in requires its registered HTTPS origin');
 const sdk=await import('./vendor/wallet-auth-r9-2689bece/artifacts/product-session-browser.mjs');
 if(sdk.MEDIA_SDK_SOURCE_COMMIT!=='2689bece12fddd991c2ecd7a024f6aa4e8b1afbd')throw Error('Matching current Music SDK build required');
 const {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter}=sdk;
 const response=await environment.fetch(new URL('./vendor/wallet-auth-r9-2689bece/source/packages/wallet-auth/product-session-registry.json',import.meta.url),{cache:'no-cache',credentials:'omit',redirect:'error'});
 if(!response.ok)throw Error('Music sign-in configuration is unavailable. Please retry.');
 const registry=await response.json();
 const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:environment.fetch.bind(environment),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:15000});
 return createBrowserProductSessionClient({registry,productId:'music',scopes:[...MUSIC_SCOPES],purpose:'Access my Music profile, library and playback, and manage my creator releases and reviews',gateway,environment});
}
