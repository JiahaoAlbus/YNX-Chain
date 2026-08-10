import {
  signDexAction,
  walletIdentity,
} from "../../packages/wallet-auth/src/index.js";

const now = new Date("2026-08-10T03:00:00.000Z"),
  secret = "0000000000000000000000000000000000000000000000000000000000000065",
  account = walletIdentity(secret).account,
  deadlineUnix = 1786331040;
const quote = {
  poolId: "dex_ynxt_yusd",
  poolBlockHeight: 931437,
  poolUpdatedAt: "2026-08-10T02:59:30.000Z",
  asset0: "YNXT",
  asset1: "yusd-test",
  reserve0: 1000000,
  reserve1: 2000000,
  feeBps: 30,
  expectedAmount: 1974,
};
const actions = [
  [
    "dex_swap_exact_input",
    {
      poolId: "dex_ynxt_yusd",
      assetIn: "YNXT",
      amountIn: 1000,
      minAmountOut: 1900,
      deadlineUnix,
    },
  ],
  [
    "dex_swap_exact_output",
    {
      poolId: "dex_ynxt_yusd",
      assetOut: "yusd-test",
      amountOut: 1900,
      maxAmountIn: 1100,
      deadlineUnix,
    },
  ],
  [
    "dex_liquidity_add",
    {
      poolId: "dex_ynxt_yusd",
      amount0: 1000,
      amount1: 2000,
      minShares: 1300,
      deadlineUnix,
    },
  ],
  [
    "dex_liquidity_remove",
    {
      poolId: "dex_ynxt_yusd",
      shares: 500,
      minAmount0: 300,
      minAmount1: 600,
      deadlineUnix,
    },
  ],
];
const result = actions.map(([action, payload], index) => {
  const request = {
      version: "1",
      chainId: 6423,
      productClientId: "ynx-dex-web-v1",
      bundleId: "com.ynxweb4.dex.web",
      callback: "https://dex.ynxweb4.com/wallet-action/callback",
      sessionBinding: "a".repeat(64),
      account,
      nonce: index + 1,
      action,
      payload,
      quote,
      issuedAt: now.toISOString(),
      expiresAt: "2026-08-10T03:05:00.000Z",
    },
    response = signDexAction(request, { accountSecret: secret, account }, now);
  return {
    action,
    canonicalPayloadHex: response.canonicalPayloadHex,
    transactionHash: response.transactionHash,
  };
});
process.stdout.write(`${JSON.stringify(result)}\n`);
