import QRCode from "qrcode";
import { evmAddressFromYNX } from "@ynx-chain/wallet-auth";

const fail = () => { throw Object.assign(new Error("The receiving account could not be verified. Reopen Receive from your selected account."), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" }); };

/** Encode only the selected public identity. No key access, RPC or image service. */
export async function createReceiveCode(expectedAccount, readAccountStatus) {
  const status = await readAccountStatus();
  try {
    if (!status?.initialized || typeof expectedAccount !== "string" || expectedAccount !== status.ynxAccount ||
        evmAddressFromYNX(expectedAccount) !== status.account) fail();
  } catch { fail(); }
  const uri = `ynx:${expectedAccount}?chainId=ynx_6423-1&asset=YNXT`;
  const { modules } = QRCode.create(uri, { errorCorrectionLevel: "M" });
  const current = await readAccountStatus();
  if (!current?.initialized || current.ynxAccount !== expectedAccount || current.account !== status.account) fail();
  return { account: expectedAccount, chainId: "ynx_6423-1", asset: "YNXT", uri, size: modules.size, modules: Array.from(modules.data) };
}
