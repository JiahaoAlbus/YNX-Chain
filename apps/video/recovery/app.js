import {createRecoveryController} from './controller.js';
const button=document.querySelector('#retry'),status=document.querySelector('#status');
const controller=createRecoveryController({
  render(state){button.disabled=state.busy;status.textContent=state.message;},
  async openClient(){
    const config=await fetch(new URL('./recovery-config.json',import.meta.url),{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('Recovery configuration is unavailable.');return response.json();});
    if(location.origin!==config.origin)throw new Error('Use the registered HTTPS product address to retry sign-out.');
    const registry=await fetch(new URL('./product-session-registry.json',import.meta.url),{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('Recovery registration is unavailable.');return response.json();});
    const {createBrowserProductSessionClient,ProductSessionGatewayFetchAdapter}=await import('./product-session-sdk.js');
    const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:fetch.bind(globalThis),walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:15000});
    return createBrowserProductSessionClient({registry,productId:config.productId,scopes:config.scopes,purpose:'Retry an explicit sign-out while product sign-in is paused',gateway});
  },
});
button.addEventListener('click',()=>void controller.retrySignOut());
