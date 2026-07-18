import {describe,expect,it} from "vitest";
import {assertWalletRequest,buildWalletRequest,walletDeepLink,WalletRequestError} from "./wallet";
const key="A".repeat(44);const now=new Date("2026-07-18T08:00:00.000Z");
describe("canonical Wallet request adapter",()=>{
 it("binds exact DEX product, callback, device key, scopes and five-minute expiry",()=>{const value=buildWalletRequest({nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",productDeviceKey:key,now});expect(value.chainId).toBe("ynx_6423-1");expect(value.bundleId).toBe("com.ynxweb4.dex.web");expect(value.scopes).toEqual(["account:read","dex:positions:read","dex:transaction:request"]);expect(value.expiresAt).toBe("2026-07-18T08:05:00.000Z");expect(walletDeepLink(value)).toMatch(/^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/)});
 it("rejects callback, scope, product and unknown-field substitution",()=>{const value=buildWalletRequest({nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",productDeviceKey:key,now});for(const changed of [{...value,callback:"https://attacker.invalid/callback"},{...value,scopes:["admin:all"]},{...value,productClientId:"ynx-exchange-v1"},{...value,unknown:true}])expect(()=>assertWalletRequest(changed as never)).toThrow(WalletRequestError)});
 it("rejects malformed nonce and product device key",()=>{expect(()=>buildWalletRequest({nonce:"short",productDeviceKey:key,now})).toThrow(/nonce/);expect(()=>buildWalletRequest({nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",productDeviceKey:"opaque",now})).toThrow(/P-256/)})
});
