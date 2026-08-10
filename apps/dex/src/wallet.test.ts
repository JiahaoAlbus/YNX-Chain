import {createCallbackURL,requestDigest,signAuthorization} from "@ynx-chain/wallet-auth";
import {describe,expect,it} from "vitest";
import {buildWalletRequest,consumeWalletCallback,DEX_WALLET_CALLBACK,walletDeepLink,WalletRequestError} from "./wallet";

const key="AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv";
const now=new Date("2026-07-18T08:00:00.000Z");
const build=()=>buildWalletRequest({nonce:"abcdefghijklmnopqrstuvwxyz123456",productDeviceKey:key,now});
class MemoryStorage implements Storage{
  private values=new Map<string,string>();get length(){return this.values.size}clear(){this.values.clear()}getItem(key:string){return this.values.get(key)??null}key(index:number){return [...this.values.keys()][index]??null}removeItem(key:string){this.values.delete(key)}setItem(key:string,value:string){this.values.set(key,value)}
}

describe("canonical Wallet request adapter",()=>{
  it("binds the exact reviewed web product, callback, scopes and five-minute expiry",()=>{const value=build();expect(value.chainId).toBe("ynx_6423-1");expect(value.bundleId).toBe("com.ynxweb4.dex.web");expect(value.callback).toBe(DEX_WALLET_CALLBACK);expect(value.scopes).toEqual(["account:read","dex:positions:read","dex:transaction:request"]);expect(value.expiresAt).toBe("2026-07-18T08:05:00.000Z");expect(requestDigest(value)).toMatch(/^[0-9a-f]{64}$/);expect(walletDeepLink(value)).toMatch(/^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/)});
  it("rejects callback, scope, product, unknown-field and malformed device substitution",()=>{const value=build();for(const changed of [{...value,callback:"https://attacker.invalid/callback"},{...value,scopes:["admin:all"]},{...value,productClientId:"ynx-exchange-v1"},{...value,unknown:true},{...value,productDeviceKey:"opaque"}])expect(()=>walletDeepLink(changed as never)).toThrow(WalletRequestError)});
  it("accepts one signed Wallet callback and rejects replay, tampering and cross-tab returns",()=>{
    const request=build(),storage=new MemoryStorage();storage.setItem("ynx-dex-wallet-pending-v1",JSON.stringify(request));
    const approval=signAuthorization(request,{accountSecret:"01".padStart(64,"0"),issuedAt:"2026-07-18T08:01:00.000Z"});
    const url=createCallbackURL(approval);expect(consumeWalletCallback(url,storage,new Date("2026-07-18T08:02:00.000Z"))?.account).toBe(approval.account);
    expect(()=>consumeWalletCallback(url,storage,new Date("2026-07-18T08:02:00.000Z"))).toThrow(/no pending/);
    const cross=new MemoryStorage();cross.setItem("ynx-dex-wallet-pending-v1",JSON.stringify({...request,bundleId:"com.ynxweb4.exchange"}));expect(()=>consumeWalletCallback(url,cross,new Date("2026-07-18T08:02:00.000Z"))).toThrow(WalletRequestError);
  });
});
