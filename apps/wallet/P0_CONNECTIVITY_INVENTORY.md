# Wallet P0 connectivity inventory

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`  
Contract consumed: `p0-wallet-connection-v1`, accepted by Integration at
`15d046bf5f0a56b7ca3bfb3a82099114dc9992be`; protocol source
`66003e76e804da16d472255efde50cb879055b96`.

This is a source inventory, not an installed-client or public-runtime claim.

| Surface | Present source | Standard connection state | Deep link / callback | Faucet | Public artifact state | P0 blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Android Wallet | `android/`, Expo native app | Platform EIP-1193 core is implemented and Gateway-independent; no extension injection is claimed | `ynxwallet://authorize`; incoming request is now keystore-persisted before review | Official link is reachable from Wallet UI but held `DEGRADED` | Historical local test APK only | Accepted signed endpoint manifest, real Android E2E, external-DApp bridge, WalletConnect transport |
| iOS Wallet | `ios/`, Expo native app | Same shared platform core | `ynxwallet://authorize`; incoming request is persisted before review | Same degraded link state | Historical unsigned Simulator evidence only | Device signing, Universal Link evidence, real E2E, WalletConnect transport |
| Web companion | Not present as a custody runtime | Not implemented | N/A | N/A | No artifact | Product scope deliberately excludes browser-hosted key custody |
| Browser extension | Not present | The reusable EIP-6963 announcer is source-tested, but no extension is built or injected | N/A | N/A | No artifact | Extension product, manifest, permissions, browser E2E |
| Wallet DApp Browser | Not present | Not implemented | N/A | N/A | No artifact | Dedicated secure-browser product work and E2E |
| macOS Wallet | Not present | Not implemented | N/A | N/A | No artifact | Separate desktop custody scope and threat model |
| Windows Wallet | Not present | Not implemented | N/A | N/A | No artifact | Separate desktop custody scope and threat model |
| WalletConnect v2 | SDK/runtime absent | Not implemented or claimed | N/A | N/A | No artifact | Review, dependency, relay/project credentials, QR and session E2E |

## Current guarantees in this candidate

- `StandardWalletConnection` implements the accepted EIP-1193 request/event
  boundary for chain ID `6423` (`0x1917`) and exposes only a selected lowercase
  `0x…` account to EVM callers.
- A Product Session or Gateway failure transitions only private service status
  to `PRIVATE_SERVICE_DEGRADED`; it cannot emit `disconnect`, erase an account,
  or block the normal EIP-1193 methods.
- Incoming first-party authorization deep links persist exactly one validated
  request and digest before review, survive a cold launch, and fail closed on
  expiry or substitution.
- The native Android manifest includes `INTERNET`; iOS ATS disallows arbitrary
  loads. Neither fact proves endpoint health or installed application use.

## Faucet truth

The central candidate manifest has `faucet: null` and is not accepted. The
observed public Faucet health response leaks a loopback RPC URL and `/version`
is missing. Wallet therefore offers an explicitly degraded official HTTPS link
but does not classify it as online or use it as endpoint configuration.

## Explicit non-claims

This candidate does not prove Browser Extension discovery, WalletConnect QR,
SIWE/EIP-712 signing with an installed Wallet, external EVM DApp connection,
first-party alternate-wallet connection, a real testnet EVM transaction, or
public deployment. These remain queue items until their runtime and artifact
evidence are independently collected.
