const failureText = code => ({
  NATIVE_CONTRACT_CHAIN_MISMATCH: "This endpoint is not the expected YNX Testnet. Nothing was signed or submitted.",
  NATIVE_CONTRACT_UNSUPPORTED_RUNTIME: "This contract runtime is not supported by the existing chain capability.",
  NATIVE_CONTRACT_CHANGED_REVIEW_AGAIN: "The contract changed during this read. Look it up again.",
  NATIVE_CONTRACT_PURE_VIEW_ONLY: "Only pure and view methods can be read here.",
  NATIVE_CONTRACT_CALLDATA_REQUIRED: "Enter complete hex calldata including the method selector and arguments.",
  NATIVE_CONTRACT_READ_TIMEOUT: "The read timed out. You can try again; no transaction was submitted.",
})[code] ?? "The contract response could not be verified. Nothing was signed or submitted. Check the address and try again.";

/** Close, editing, account changes and Wallet lock cancel old public results. */
export function createNativeContractUI({getContext, request, render}) {
  let revision = 0;
  function clear() { revision++; render({busy: false, result: null, error: null}); }
  async function run(input) {
    const before = getContext();
    if (!before.open) return;
    const current = ++revision;
    const active = () => {
      const after = getContext();
      return current === revision && after.open && before.account === after.account && before.keyRevision === after.keyRevision;
    };
    render({busy: true, result: null, error: null});
    try {
      const response = await request(input);
      if (!active()) return;
      if (!response?.ok) throw Object.assign(new Error(), {code: response?.error?.code});
      const result = response.value;
      if (result?.action !== input.action || result.mode !== input.mode ||
          (result.artifact ?? result.read?.artifact)?.address !== input.address ||
          input.action === "read" && result.read?.truthfulStatus !== (input.mode === "bft" ? "bft-bounded-static-read-no-sign-no-broadcast" : "native-local-pure-view-read-no-sign-no-broadcast")) {
        throw new Error("Unverified read");
      }
      render({busy: false, result, error: null});
    } catch (error) {
      if (active()) render({busy: false, result: null, error: failureText(error?.code)});
    }
  }
  return {clear, run};
}
