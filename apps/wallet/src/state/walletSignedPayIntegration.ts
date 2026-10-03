import type {createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";
import type {WalletPayAuthorityLease} from "../security/prepareSignedPayTransfer";
import type {WalletSignedPayRecord} from "./walletSignedPayRecord";
import type {WalletSignedSettlementTransport} from "./walletSignedPayFlow";

/** Protected issuer/bootstrap dependency only. Never decoded from QR/URL,
 * public invoice response, environment bearer strings or global JS state.
 * No default implementation: current disabled/unmounted Pay remains disabled.
 * createProtectedPayWalletApp is an in-process composition seam, not a wire
 * protocol. Default App and all native/Expo launch props cannot enable Pay. */
export type WalletSignedPayIntegration=Readonly<{
  policy:ReturnType<typeof createPayInvoiceSignerPolicy>;
  /** Read the original invoice and current exact intent using A's protected
   * registered session/business adapter. No key use/signing or auto-consent.
   * Returned authority lifetime is independent of the temporary read guard;
   * never retain a finished Wallet operation lease as assertCurrent. */
  getQuote:(reference:string,account:string,guard:()=>void)=>Promise<Readonly<{invoice:unknown;intent:unknown;authority:WalletPayAuthorityLease}>>;
  getSettlementTransport:(record:WalletSignedPayRecord,guard:()=>void)=>Promise<WalletSignedSettlementTransport>;
}>;
