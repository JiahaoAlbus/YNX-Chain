// Explicitly injected generic-serializer test capability. This is not parsed
// from the canonical network and does not claim that YNX supports a full EVM.
export const fixtureEVMCapabilities = Object.freeze({ version: "test-only-generic-ethereum", enabled: true, unit: "wei", fullEVM: true, eip1559: true });
