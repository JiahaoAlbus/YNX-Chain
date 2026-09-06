# YNX Wallet

Draft store text. Publisher contact and privacy URL are pending; do not submit this file with placeholders. Runtime manifest name remains `YNX Wallet`, version `0.1.0`; uniqueness against an actual store account has not been checked.

## Short description

Independent YNX Testnet wallet provider for approved DApp connections and transactions.

## Single purpose

Manage one local YNX Testnet browser account and explicitly authorize compatible websites to connect, request signatures and submit supported native transfers.

## Detailed description

YNX Wallet is an independent browser wallet for YNX Testnet, chain 6423. Create or import an account, protect its private key with a local wallet password, and review requests from compatible DApps. Wallet uses its own YNX account and does not log you in through MetaMask.

**Data before you install:** The extension keeps an encrypted private key, public account information, approved site origins and transaction recovery records in this browser profile. It sends public account queries and approved signed transactions to `https://evm.ynxweb4.com`, and returns approved account information and signatures to the requesting DApp. Signing messages may authenticate you or authorize actions. DApp request/response data is handled for these wallet features. The RPC operator receives ordinary connection information, including your IP address. The local vault password and raw private key are not uploaded by the extension. Read the publisher's completed privacy policy before installation: **[PRIVACY_POLICY_HTTPS_URL — pending]**.

Connect only to sites you trust. Review the requesting site, account and exact message or typed data before entering your local password. Rejecting a request does not produce a signature. An approved site may retain information it already received; revoking a connection prevents future account authorization but cannot retract earlier signatures or transactions.

The interface displays and copies a checksum-validated `ynx` address by default. Standard Ethereum-compatible APIs return the corresponding `0x` address. The extension announces its distinct provider through EIP-6963 and supports EIP-1193 account connections, permission revocation, `personal_sign` and `eth_signTypedData_v4` on the supported chain.

Transfers are limited to the RPC's verified plain native-transfer capability: positive whole YNXT amounts on Testnet, with the supported fee model. Unsupported or unavailable capabilities stop the operation. This preview does not provide full EVM contract execution, multiple networks, multiple simultaneous vault accounts, mainnet assets, swaps, staking, fiat purchase, or cryptocurrency mining. Message signatures can still authorize external actions; Testnet branding is not a reason to approve unfamiliar content.

If a submission result is uncertain, the original signed transaction is retained locally. Open the account vault to check it or explicitly retry the same bytes after review and password entry. A missing receipt is not proof of rejection. Removing the account does not erase transaction recovery/history records or network data.

Keep your recovery key offline. There is no publisher password reset or recovery-key escrow in this extension. Browser storage and local password encryption do not establish hardware-backed protection. Private browsing is disabled; Firefox container isolation is not implemented. Minimum package targets are Chrome/Edge 120 and desktop Firefox 140. Store approval and public transfer availability must be verified separately before release.

## Support

Support: **[VERIFIED_SUPPORT_URL_OR_EMAIL — pending]**. Never send your wallet password or recovery key to support.
