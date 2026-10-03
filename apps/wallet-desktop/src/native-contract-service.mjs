import {NativeContractClient, bftNativeReadMethods} from "./native-contract.mjs";

/** Public read-only API. This service never receives a vault or a signer. */
export function createNativeContractService({client = new NativeContractClient(), getContext}) {
  return async input => {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => !["mode", "action", "address", "function"].includes(key)) ||
        !["bft", "legacy"].includes(input.mode) || !["lookup", "read"].includes(input.action) ||
        typeof input.address !== "string" || !/^0x[0-9a-f]{40}$/.test(input.address) ||
        input.action === "lookup" && Object.hasOwn(input, "function") ||
        input.action === "read" && (typeof input.function !== "string" || !input.function || input.function.length > 8194)) {
      throw Object.assign(new Error("Enter a valid contract address and read-only function."), {code: "NATIVE_CONTRACT_INVALID_INPUT"});
    }
    const before = getContext();
    const guard = () => {
      const current = getContext();
      if (!before.focused || before.changing || !current.focused || current.changing ||
          current.revision !== before.revision || current.account !== before.account) {
        throw Object.assign(new Error("The Wallet context changed. Start this read again."), {code: "NATIVE_CONTRACT_READ_CANCELLED"});
      }
    };
    guard();
    const bft = input.mode === "bft";
    if (input.action === "lookup") {
      const artifact = await (bft ? client.lookupBFT(input.address, guard) : client.lookup(input.address, guard));
      guard();
      return {mode: input.mode, action: "lookup", artifact,
        methods: bft ? bftNativeReadMethods(artifact) : artifact.functions.filter(row => ["pure", "view"].includes(row.stateMutability))};
    }
    const read = await (bft ? client.readBFT(input.address, input.function, guard) : client.read(input.address, input.function, guard));
    guard();
    return {mode: input.mode, action: "read", read};
  };
}
