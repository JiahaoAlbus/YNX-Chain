# YNX DEX open questions and external inputs

These are unresolved owner or operator inputs. They are not requests for secrets in chat.

1. **Wallet/Auth owner:** accept client `ynx-dex-web-v1`, bundle `com.ynxweb4.dex.web`, exact scopes, approval digest and revoke/introspection vectors.
2. **Oracle owner:** provide the frozen Testnet Oracle contract/version and reviewed stable-asset peg/rate policy, including stale/depeg thresholds and source metadata.
3. **Integration owner:** schedule shared Testnet acceptance across Wallet, Quant, Data Fabric, Explorer, Monitor, Trust and Finance.
4. **Operator:** provide an approved secure signer path, funded Testnet deployer identity and canonical token/treasury addresses through the protected deployment mechanism; never paste private keys or seed phrases.
5. **Security/SRE:** define the accepted provenance/signing class, immutable artifact host, independent audit path and public status/security endpoints.
6. **Website owner:** consume `/dex` metadata and screenshots, but keep `websitePublished=false` and `deployedPublic=false` until direct probes exist.
7. **GitHub remote evidence:** `gh pr list` and `gh run list` returned no DEX PR or Actions run; `gh release list` returned Releases for other products only. DEX CI, merge, Release and hosted artifact status remain false.

Autonomous work remains: concentrated liquidity, weighted pool, liquidity bootstrapping, down-schema rollback, provisioned-Testnet operational RPO, supply-chain scans, SLO/capacity, unit economics and complete 12-language/a11y closure.
