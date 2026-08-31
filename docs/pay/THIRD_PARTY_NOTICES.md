# Third-party notices and provider register

JavaScript dependency licenses are derived from the locked dependency trees during release packaging; the resulting SBOM and notices must be attached to the artifact provenance record. Go module licenses require the same release-time scan. Vendored `@ynx-chain/wallet-auth@1.0.0` is an internal YNX package and its tarball hash is verified by the lockfile.

No external stablecoin, bridge, card issuer/processor or AI provider is approved for production in the current release. Before enabling one, record its legal entity, official API/SDK and version, license/terms URL, jurisdictions, authentication method, rate limits, retention, data rights, health endpoint, outage behavior and fallback. Provider unavailability must remain visible and must never be replaced by mock success.

Circle USDC/CCTP was assessed from Circle's official [USDC contract address registry](https://developers.circle.com/stablecoins/usdc-contract-addresses) and [CCTP supported chains and domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains), checked 2026-07-22. Neither registry lists YNX or chain ID 6423. This is a negative compatibility finding, not provider approval: Circle code, SDKs, trademarks, APIs and credentials are not bundled, and no USDC contract address or CCTP domain is configured.
