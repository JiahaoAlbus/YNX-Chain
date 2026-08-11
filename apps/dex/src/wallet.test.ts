import { describe, expect, it, vi } from "vitest";
import { buildWalletRequest, connectMetaMask, DEX_WALLET, WALLET_INSTALL_URL, YNX_EVM_CHAIN } from "./wallet";

describe("canonical DEX Wallet binding",()=>{
  it("binds the reviewed product, callback, least-privilege scopes and five-minute lifetime",()=>{
    vi.spyOn(globalThis.crypto,"getRandomValues").mockImplementation(array=>{new Uint8Array(array.buffer).fill(7);return array});
    const request=buildWalletRequest({productDeviceKey:"A".repeat(44),productDeviceSecret:"B".repeat(43)},new Date("2026-08-10T00:00:00.000Z"));
    expect(request).toMatchObject({chainId:"ynx_6423-1",requestingProduct:"dex",productClientId:"ynx-dex-web-v1",bundleId:"com.ynxweb4.dex.web",callback:"https://dex.ynxweb4.com/wallet-auth/callback"});
    expect(request.scopes).toEqual(["account:read","dex:positions:read","dex:transaction:request"]);
    expect(request.expiresAt).toBe("2026-08-10T00:05:00.000Z");
    expect(request.purpose).toMatch(/cannot sign or move assets/i);
    expect(DEX_WALLET.scopes).not.toContain("dex:withdraw");
    expect(WALLET_INSTALL_URL).toBe("https://www.ynxweb4.com/downloads/ynx-wallet-1.0.1-testnet-preview-dc31c9a8-test-signed.apk");
  });

  it("adds YNX Testnet through MetaMask, rechecks the chain and requests an account",async()=>{
    const calls:{method:string;params?:readonly unknown[]|Record<string,unknown>}[]=[];
    const provider={request:vi.fn(async(input:{method:string;params?:readonly unknown[]|Record<string,unknown>})=>{calls.push(input);if(input.method==="wallet_switchEthereumChain"&&calls.filter(item=>item.method==="wallet_switchEthereumChain").length===1)throw Object.assign(new Error("missing"),{code:4902});if(input.method==="eth_chainId")return"0x1917";if(input.method==="eth_requestAccounts")return["0x"+"A".repeat(40)];return null})};
    await expect(connectMetaMask(provider)).resolves.toBe("0x"+"a".repeat(40));
    expect(YNX_EVM_CHAIN).toMatchObject({chainId:"0x1917",nativeCurrency:{symbol:"YNXT",decimals:18}});
    expect(calls.map(item=>item.method)).toEqual(["wallet_switchEthereumChain","wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId","eth_requestAccounts"]);
  });

  it("fails closed when MetaMask stays on another chain",async()=>{
    const provider={request:vi.fn(async(input:{method:string})=>input.method==="eth_chainId"?"0x1":null)};
    await expect(connectMetaMask(provider)).rejects.toThrow(/did not switch/);
  });
});
