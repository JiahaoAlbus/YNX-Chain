import {createPrivateSessionController} from './product-session.js';
const controller=createPrivateSessionController({productId:'shop',scopes:['account:read','shop:seller:operate'],purpose:'Operate only my authorized YNX Shop seller records on ynx_6423-1.',endpoint:()=>{
 const runtime=globalThis.__YNX_SELLER_RUNTIME__;
 return runtime?.endpoints?.appGateway?.status==='AVAILABLE'?runtime.endpoints.appGateway.url:null;
}});
export const onPrivateSessionChange=controller.onChange;
export const privateSession=controller.current;
// A UI identity marker, never a bearer credential.
export const token=()=>controller.current()?.sessionBinding||'';
export const authorizeBusinessRequest=controller.authorize;
export const privateSignoutPending=()=>controller.signoutPending;
export function clearWalletSession(){return controller.clear().catch(()=>null)}
export async function startWalletAuth(surface){if(surface!=='seller')throw new Error('Seller requests only the canonical Shop Seller grant.');return controller.begin()}
export async function completeWalletCallback(expectedAccount){
 if(new URL(location.href).searchParams.has('response'))throw new Error('Legacy Seller approval requires a fresh canonical Shop Seller approval. Original recovery data was retained.');
 const session=await controller.recover(location.href,expectedAccount);
 if(session&&new URL(location.href).searchParams.has('result'))history.replaceState({},'',location.pathname+location.hash);
 return session;
}
