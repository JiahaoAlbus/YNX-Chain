// Generated from reviewed versioned authority. Runtime never renews or fetches it.
import {deepFreeze,assertEndpointAuthorityStructure,validateEndpointAuthority} from './endpoint-authority.js';
export const endpointAuthorityPin = deepFreeze({
  "schema": "ynx-endpoint-authority-pin/v1",
  "manifestVersion": "1.1.0-weekly-v3.20260920.1",
  "manifestPath": "chain-metadata/endpoint-authority/20260920.1.json",
  "fileSha256": "c8eb9f641185958aaec82c6fa16764e9424ad10f47bf7435af643a2a888a07e1",
  "payloadSha256": "29f801933e9df4faea58531cb522cc34bfe1028628adfb88227f3d0cae1e4e73",
  "policy": "Reviewed bundled release pin; never a client-fetched trust root"
});
export const bundledEndpointAuthority = deepFreeze({
  "schemaVersion": "1.1.0",
  "manifestVersion": "1.1.0-weekly-v3.20260920.1",
  "status": "ACCEPTED_BUNDLED_CONSUMER_CONTRACT",
  "environment": "testnet",
  "releaseId": "ynx-endpoints-20260920.1",
  "sourceCommit": "61a914ffaa2debbf168e74a4e6f5da00b97d8f17",
  "issuedAt": "2026-09-20T08:55:00.000Z",
  "expiresAt": "2026-09-27T08:55:00.000Z",
  "cosmosChainId": "ynx_6423-1",
  "evmChainId": 6423,
  "evmChainHex": "0x1917",
  "nativeAsset": "YNXT",
  "rpc": "https://rpc-testnet.ynxweb4.com",
  "evmRpc": "https://rpc-testnet.ynxweb4.com",
  "rest": "https://rest.ynxweb4.com",
  "walletGateway": "https://wallet-auth.ynxweb4.com",
  "appGateway": "https://gateway.ynxweb4.com",
  "faucet": "https://faucet-testnet.ynxweb4.com",
  "explorer": "https://explorer.ynxweb4.com",
  "indexer": "https://indexer.ynxweb4.com",
  "monitor": "https://monitor.ynxweb4.com",
  "healthUrl": "https://monitor.ynxweb4.com/health",
  "versionUrl": "https://monitor.ynxweb4.com/version",
  "endpointStates": {
    "rpc": {
      "status": "VERIFIED",
      "health": "https://rpc-testnet.ynxweb4.com/status",
      "versionIdentity": "https://rpc-testnet.ynxweb4.com/status",
      "verifiedAt": "2026-09-20T08:54:22.858Z",
      "chainId": 6423,
      "sourceCommit": "4c17f2c13a0f40f7e3ccf00a03986ec7a58b3ce3",
      "reason": "Fresh bounded TLS/chain/build/readiness observations; not continuous availability"
    },
    "evmRpc": {
      "status": "VERIFIED",
      "health": "https://rpc-testnet.ynxweb4.com/status",
      "versionIdentity": "https://rpc-testnet.ynxweb4.com/status",
      "verifiedAt": "2026-09-20T08:54:22.858Z",
      "chainId": 6423,
      "sourceCommit": "4c17f2c13a0f40f7e3ccf00a03986ec7a58b3ce3",
      "reason": "Fresh bounded TLS/chain/build/readiness observations; not continuous availability"
    },
    "rest": {
      "status": "PENDING",
      "health": null,
      "versionIdentity": null,
      "verifiedAt": null,
      "sourceCommit": null,
      "reason": "Location preserved only; no renewed service authority in this RPC/Faucet release"
    },
    "walletGateway": {
      "status": "PENDING",
      "health": null,
      "versionIdentity": null,
      "verifiedAt": null,
      "sourceCommit": null,
      "reason": "Location preserved only; no renewed service authority in this RPC/Faucet release"
    },
    "appGateway": {
      "status": "PENDING",
      "health": null,
      "versionIdentity": null,
      "verifiedAt": null,
      "sourceCommit": null,
      "reason": "Location preserved only; no renewed service authority in this RPC/Faucet release"
    },
    "faucet": {
      "status": "VERIFIED",
      "health": "https://faucet-testnet.ynxweb4.com/health",
      "versionIdentity": "https://faucet-testnet.ynxweb4.com/health",
      "verifiedAt": "2026-09-20T08:54:22.858Z",
      "chainId": 6423,
      "sourceCommit": "6ac8362989cc1633c26a6468a9407d4560da77c8",
      "reason": "Fresh bounded TLS/chain/build/readiness observations; not continuous availability"
    },
    "explorer": {
      "status": "PENDING",
      "health": null,
      "versionIdentity": null,
      "verifiedAt": null,
      "sourceCommit": null,
      "reason": "Location preserved only; no renewed service authority in this RPC/Faucet release"
    },
    "indexer": {
      "status": "PENDING",
      "health": null,
      "versionIdentity": null,
      "verifiedAt": null,
      "sourceCommit": null,
      "reason": "Location preserved only; no renewed service authority in this RPC/Faucet release"
    },
    "monitor": {
      "status": "PENDING",
      "health": null,
      "versionIdentity": null,
      "verifiedAt": null,
      "sourceCommit": null,
      "reason": "Location preserved only; no renewed service authority in this RPC/Faucet release"
    },
    "products": {
      "finance": {
        "status": "PENDING",
        "reason": "Official provider and current public Finance acceptance are independent gates"
      }
    }
  },
  "mainnet": {
    "enabled": false,
    "chainId": null,
    "rpc": null,
    "reservedRpcUrl": "https://rpc-mainnet.ynxweb4.com"
  },
  "legacyCompatibility": {
    "rpc": {
      "url": "https://rpc.ynxweb4.com",
      "status": "VERIFIED",
      "chainId": 6423,
      "sourceCommit": "4c17f2c13a0f40f7e3ccf00a03986ec7a58b3ce3",
      "verifiedAt": "2026-09-20T08:54:22.858Z"
    },
    "faucet": {
      "url": "https://faucet.ynxweb4.com",
      "status": "VERIFIED",
      "chainId": 6423,
      "sourceCommit": "6ac8362989cc1633c26a6468a9407d4560da77c8",
      "verifiedAt": "2026-09-20T08:54:22.858Z"
    },
    "evmRpc": {
      "url": "https://evm.ynxweb4.com",
      "status": "PENDING",
      "reason": "Preserved compatibility location; not renewed by this RPC/Faucet evidence"
    }
  },
  "sourceEvidence": {
    "path": "chain-metadata/endpoint-authority/20260920.1.evidence.json",
    "sha256": "060d56cb6448d8053a3127e4ff6a76cda496e5953846addd77ac94c2fbcb0e4b",
    "scope": "Public health/status refresh plus separately hash-bound controlled deployment compatibility evidence"
  },
  "fallbacks": {
    "rpc": [],
    "evmRpc": [],
    "rest": [],
    "walletGateway": [],
    "appGateway": [],
    "faucet": []
  },
  "minimumClientVersion": {
    "wallet": null,
    "financialApps": null,
    "policy": "Only independently accepted product release matrices may declare minimum client versions"
  },
  "clientPolicy": {
    "remoteReplacement": "FORBIDDEN_UNSIGNED",
    "clientRenewal": false,
    "automaticWriteRetry": false,
    "compatibilitySelection": "Explicit legacy profile only; never automatic failover"
  },
  "acceptanceBoundary": "Versioned bundled source authority for RPC/Faucet locations and sampled identity only. Not continuous/global uptime, consensus finality, installed product acceptance, official Broker Sandbox, or a remote signature.",
  "integrity": {
    "algorithm": "SHA-256",
    "canonicalization": "UTF-8 stable JSON recursively sorted keys, integrity omitted",
    "payloadSha256": "29f801933e9df4faea58531cb522cc34bfe1028628adfb88227f3d0cae1e4e73",
    "remoteSignature": {
      "status": "PENDING_PROTECTED_SIGNER",
      "keyId": null,
      "signature": null,
      "failClosed": true
    }
  }
});
// The bundled bytes are hash-checked during generation/release; no caller data accepted here.
export function getBundledEndpointAuthority({nowMs=Date.now()}={}) {
  return assertEndpointAuthorityStructure(bundledEndpointAuthority,{nowMs});
}
export async function verifyBundledEndpointAuthority(options={}) {
  return validateEndpointAuthority(bundledEndpointAuthority,{...options,source:'bundled',trustedPin:endpointAuthorityPin});
}
