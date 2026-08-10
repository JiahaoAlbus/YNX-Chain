import { describe, expect, it, vi } from "vitest";
import { buildWalletRequest, DEX_WALLET, WALLET_INSTALL_URL } from "./wallet";

describe("canonical DEX Wallet binding",()=>{
  it("binds the reviewed product, callback, least-privilege scopes and five-minute lifetime",()=>{
    vi.spyOn(globalThis.crypto,"getRandomValues").mockImplementation(array=>{new Uint8Array(array.buffer).fill(7);return array});
    const request=buildWalletRequest({productDeviceKey:"A".repeat(44),productDeviceSecret:"B".repeat(43)},new Date("2026-08-10T00:00:00.000Z"));
    expect(request).toMatchObject({chainId:"ynx_6423-1",requestingProduct:"dex",productClientId:"ynx-dex-web-v1",bundleId:"com.ynxweb4.dex.web",callback:"https://dex.ynxweb4.com/wallet-auth/callback"});
    expect(request.scopes).toEqual(["account:read","dex:positions:read","dex:transaction:request"]);
    expect(request.expiresAt).toBe("2026-08-10T00:05:00.000Z");
    expect(request.purpose).toMatch(/cannot sign or move assets/i);
    expect(DEX_WALLET.scopes).not.toContain("dex:withdraw");
    expect(WALLET_INSTALL_URL).toMatch(/^https:\/\/ynxweb4\.com\/ecosystem\?product=wallet$/);
  });
});
