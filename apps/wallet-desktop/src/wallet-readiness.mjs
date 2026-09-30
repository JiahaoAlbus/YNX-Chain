// Public vault metadata drives setup UI. A locked key lease alone cannot prove
// that an account exists, or that retained Wallet records are readable.
export function walletReadiness(account, key, readFailed = false) {
  if (readFailed) return { state: "unreadable", title: "Wallet status unavailable", canPrepare: false };
  if (!account) return { state: "checking", title: "Checking local Wallet protection…", canPrepare: false };
  if (account.recoveryRequired || account.formatError || !account.initialized && account.accounts?.length) return { state: "recovery", title: "Wallet status unavailable", canPrepare: false };
  if (!account.initialized) return { state: "setup", title: account.passwordConfigured ? "Password protected · no account yet" : "Set up Wallet protection", canPrepare: true };
  return { state: key.locked ? "locked" : "ready", title: key.locked ? "Wallet locked" : "Wallet unlocked", canPrepare: false };
}
