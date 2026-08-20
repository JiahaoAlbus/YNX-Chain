export {YNX_TESTNET, WALLET_PROTOCOL_REFERENCE} from "./constants.js";
export {DAppConnectError, classifyWalletError, productSessionStateFromError} from "./errors.js";
export {StandardWalletConnection, connectWithWalletConnect} from "./provider.js";
export {discoverEIP6963} from "./discovery.js";
export {PendingCallbackStore, enhanceWithProductSession} from "./session.js";
export {validateEndpointManifest, loadBundledManifest, fetchRemoteManifest, verifyManifestSignature, manifestPayloadSha256, validateSchema, validateExpiry, verifyChainIdentity, selectHealthyEndpoint, getProductEndpoint, compatibilityCheck, safeRetry, diagnostics} from "./endpoints.js";
export {createSiweMessage} from "./siwe.js";
export {DAppConnectClient} from "./client.js";
export {COMPATIBILITY_SCENARIOS, runCompatibilityLab} from "./compatibility-lab.js";
