import {describe,expect,it,vi} from 'vitest';
import {beginWalletAuthorization,connectMetaMask,configureDexPrivateConnection,dexProductSessionGatewayOrigin,WalletRequestError,YNX_EVM_CHAIN} from './wallet';

describe('DEX Wallet Product Session v2 adapter',()=>{
  it('keeps Standard EIP-1193 separate and adds YNX Testnet when required',async()=>{const calls:string[]=[];const provider={request:vi.fn(async({method}:{method:string})=>{calls.push(method);if(method==='wallet_switchEthereumChain'&&calls.length===1)throw Object.assign(new Error('unknown chain'),{code:4902});if(method==='eth_chainId')return YNX_EVM_CHAIN.chainId;if(method==='eth_requestAccounts')return [`0x${'A'.repeat(40)}`];return null;})};await expect(connectMetaMask(provider)).resolves.toBe(`0x${'a'.repeat(40)}`);expect(calls).toEqual(['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId','eth_requestAccounts']);});
  it('keeps Web provider discovery available without a Product Session capability',async()=>{await expect(beginWalletAuthorization()).resolves.toMatchObject({status:'unsupported'});});
  it('accepts only a capability surface without endpoint, callback, origin or session injection',()=>{expect(typeof configureDexPrivateConnection).toBe('function');expect(dexProductSessionGatewayOrigin()).toBeNull();expect(new WalletRequestError('x','x').code).toBe('x');});
});
