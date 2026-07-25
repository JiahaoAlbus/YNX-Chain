# Decisions

- The attached long-term Chain Core goal is authoritative and remains active until real Testnet and public evidence gates pass.
- Chain-owned protocol facts are frozen locally; Wallet/Auth scope names remain owned by Wallet/Auth and must not be invented in Chain Core.
- Product-level `deployedPublic` remains false because the current source commit is not the deployed public runtime.
- Existing public runtime evidence is preserved as a separate deployed baseline rather than relabeled as current source.
- CometBFT remains the safety baseline; StreamBFT stays a shadow candidate.
