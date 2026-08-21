// The v2 package root currently exports Node-only Gateway modules; import its
// browser-safe launcher module from the same vendored, hash-pinned package.
import {launchWebAuthorization} from './node_modules/@ynx-chain/wallet-auth/src/authorize-launcher.js';

const YNX_CHAIN_HEX='0x1917';
const DOWNLOADS=Object.freeze({ynxWallet:'https://www.ynxweb4.com/dapp/download',metaMask:'https://metamask.io/download/'});

async function discover(){
  // v2 Web launcher performs provider discovery only: it never builds or navigates a custom-scheme URL.
  return launchWebAuthorization(undefined,{scope:window,waitMs:160});
}

async function connect(){
  const launch=await discover();
  if(launch.status!=='provider-ready'||!launch.providerCandidate?.provider){
    return Object.freeze({status:'unsupported',detail:launch.detail,downloads:DOWNLOADS});
  }
  const provider=launch.providerCandidate.provider;
  try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_CHAIN_HEX}]});}
  catch(error){if(error?.code!==4902)throw error;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:YNX_CHAIN_HEX,chainName:'YNX Testnet',nativeCurrency:{name:'YNXT',symbol:'YNXT',decimals:18},rpcUrls:['https://rpc.ynxweb4.com/'],blockExplorerUrls:['https://explorer.ynxweb4.com/']} ]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:YNX_CHAIN_HEX}]});}
  const chainId=await provider.request({method:'eth_chainId'});
  const accounts=await provider.request({method:'eth_requestAccounts'});
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].length===0)throw new Error('WALLET_NOT_AUTHORIZED: The selected standard Wallet returned no account.');
  if(chainId!==YNX_CHAIN_HEX)throw new Error(`WRONG_NETWORK: Finance requires YNX Testnet ${YNX_CHAIN_HEX}.`);
  return Object.freeze({status:'standard-connected',account:accounts[0],chainId,providerKind:launch.providerCandidate.kind,authority:launch.providerCandidate.authority});
}

window.YNXFinanceWebWallet=Object.freeze({connect,discover,downloads:DOWNLOADS});
