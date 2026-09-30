import { parseCentralRequest, signCentralApproval } from "./extension-central-sign-in.js";
export async function approveHostedCentralSignIn({ params, origin, vault, store, review, assertLive, assertAccount, unlock }) {
  const challenge = parseCentralRequest(params, origin);
  assertLive(); await assertAccount(); assertLive();
  await store.consumeReplay(`central-browser:${challenge.challengeId}:${challenge.browserBinding}`, Date.parse(challenge.expiresAt));
  assertLive();
  const choice = await review(challenge);
  assertLive();
  if (!choice.approved) throw Object.assign(new Error("USER_REJECTED"), { code: "USER_REJECTED" });
  await assertAccount(); assertLive();
  const unlocked = await unlock(vault, choice.password);
  assertLive(); await assertAccount(); assertLive();
  if (unlocked.account !== vault.account) throw Object.assign(new Error("HOSTED_ACCOUNT_CHANGED"), { code: "HOSTED_ACCOUNT_CHANGED" });
  return signCentralApproval(challenge, origin, unlocked.secretHex);
}
