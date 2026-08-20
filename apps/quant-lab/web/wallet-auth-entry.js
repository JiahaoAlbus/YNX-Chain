import {createProductWalletConnection,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN} from '@ynx-chain/wallet-auth';
import {quantProductSessionRegistry} from './product-session-registry.js';

const INSTALL_URL='https://www.ynxweb4.com/dapp/download';
let privateConnection=null;
window.YNXQuantWallet=Object.freeze({connect:beginAuthorization,configure:configureQuantPrivateConnection,requireProof,retry:retryPrivateSession,revoke:disconnectPrivateSession});
window.addEventListener('DOMContentLoaded',boot,{once:true});

function unavailable(){return new Error('PRODUCT_SESSION_UNAVAILABLE: Quant Product Session v2 requires a platform-proven protected device signer and storage adapter. Research and Paper remain available without login.');}
function privateError(error){return new Error(`PRIVATE_SERVICE_DEGRADED: ${error instanceof Error?error.message:String(error)}`);}
function requirePrivateConnection(){if(!privateConnection)throw unavailable();return privateConnection;}

/**
 * The host supplies only protected device/storage and Wallet-opening capabilities.
 * The authoritative origin, v2 routes, callback and session are all derived by
 * the accepted root factory and cannot be injected by Quant code.
 */
export function configureQuantPrivateConnection(capabilities){
  const device=capabilities?.device;
  if(!device||!capabilities.storage||typeof capabilities.walletInstalled!=='function'||typeof capabilities.schemeRegistered!=='function'||typeof capabilities.openWallet!=='function')throw unavailable();
  privateConnection=createProductWalletConnection({registry:quantProductSessionRegistry,productId:'quant',platform:'web',walletInstalled:capabilities.walletInstalled,schemeRegistered:capabilities.schemeRegistered,gatewayTimeoutMs:10_000,storage:capabilities.storage,device:{id:device.id,key:device.key,sign:({algorithm,deviceKey,payload})=>{if(algorithm!=='p256-sha256'||deviceKey!==device.key)throw privateError('The Wallet SDK requested an unexpected Quant device signature.');return device.sign({algorithm,deviceKey,payload});},scopes:['quant:account','quant:mandate:create','quant:mandate:execute','quant:mandate:revoke'],purpose:'Connect YNX Quant private services through the approved Wallet Product Session.'},scope:globalThis,discoveryWaitMs:250,openWallet:capabilities.openWallet,openTimeoutMs:10_000});
  return privateConnection;
}

async function boot(){
  document.querySelector('#connect-wallet')?.addEventListener('click',()=>beginAuthorization().catch(showError));
  document.querySelector('#install-wallet')?.setAttribute('href',INSTALL_URL);
  try{await restorePrivateSession();}catch(error){showError(error)}
  render();
}
async function beginAuthorization(){
  try{const result=await requirePrivateConnection().beginYNX();const url=result?.url;if(typeof url!=='string')throw unavailable();location.assign(url);return result;}catch(error){throw error.message?.startsWith('PRODUCT_SESSION_UNAVAILABLE')?error:privateError(error)}
}
async function retryPrivateSession(){try{return await requirePrivateConnection().retryYNX();}catch(error){throw error.message?.startsWith('PRODUCT_SESSION_UNAVAILABLE')?error:privateError(error)}}
async function restorePrivateSession(){if(!privateConnection)return null;return privateConnection.restore(navigator.onLine!==false);}
async function disconnectPrivateSession(){if(!privateConnection)return null;return privateConnection.disconnect();}
async function requireProof(scope){
  if(!['quant:mandate:create','quant:mandate:execute'].includes(scope))throw new Error('SCOPE_NOT_ALLOWED: Quant execution scope is not registered.');
  // Product Session proof is root-factory owned; no legacy local proof is emitted.
  throw unavailable();
}
function render(){const status=document.querySelector('#wallet-status'),button=document.querySelector('#connect-wallet');if(status)status.textContent=privateConnection?'Private session requires Wallet approval':'Wallet not connected — Research and Paper are still available';if(button)button.textContent='Connect YNX Wallet';}
function showError(error){const status=document.querySelector('#wallet-status');if(status)status.textContent=error instanceof Error?error.message:'Wallet connection failed closed.';}
export function quantProductSessionGatewayOrigin(){return PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN;}
