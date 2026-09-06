# YNX Wallet browser extension — privacy policy draft

**Not yet approved or published.** Publisher: **[LEGAL_PUBLISHER_NAME]**. Privacy contact: **[PRIVACY_CONTACT]**. Support: **[SUPPORT_CONTACT]**. Effective date: **[EFFECTIVE_DATE]**. Policy URL: **[HTTPS_POLICY_URL]**. The publisher must complete these fields and the service-operation facts below before using this policy.

## What this policy covers

This draft describes the YNX Wallet browser extension for YNX Testnet, chain 6423. The public website/PWA, RPC infrastructure, browser stores and third-party DApps may have additional policies; identify and link their actual operators and policies before publication. The extension holds a local YNX account and does not use MetaMask to log you in.

## Data and purposes

We use wallet data to create/import and protect your local account, connect to sites you approve, review and sign requests, query Testnet information and recover uncertain transactions.

Your private key is stored as password-encrypted ciphertext in the current browser profile. The password is used locally to derive an encryption key; the password and raw private/recovery key are not uploaded by extension code. They are handled in memory when you create, import or authorize a request. A recovery key may be displayed so you can back it up offline. This is local password encryption, not a hardware-backed custody claim.

Public account information and approved site origins are stored locally. After approval, a DApp receives the public account address; approved message or typed-data signatures are returned to that DApp. These signatures can authenticate you or authorize actions. The DApp controls its subsequent processing and may retain information or forward it to its own service. Review its identity, request and privacy policy before approval.

Wallet queries send account addresses, hashes and other allowlisted request parameters to `https://evm.ynxweb4.com`. DApps can request public read-only RPC information without an account-connection or signing prompt. Transactions require separate review and password authorization. Approved signed raw transactions are sent to that RPC. Transaction data may be distributed through the Testnet and viewed by other participants or explorers. The RPC receives ordinary network information such as your IP address. Extension RPC requests omit cookies and use HTTPS; this does not mean the server keeps no logs.

The extension stores the exact signed raw transaction, account, source-site origin, RPC origin, hash and outcome/proof locally before broadcast, including history by hash. These records are not encrypted with the vault password. Raw signed transactions are not private keys but can be broadcast. They are retained so a missing reply cannot silently trigger a replacement transaction.

Locale and remembered public connection settings are kept in local extension-page storage. Pending review/replay records use browser-session storage and are cleaned up when possible. No analytics, advertising identifier, telemetry upload or remote crash-report feature is implemented in the reviewed extension. The extension does not scrape general page content, read browser history, cookies, bookmarks, contact lists or passwords from websites. Requesting-site context and data deliberately supplied through the wallet API are handled for the wallet features above.

## Who receives data

Recipients are the DApps you authorize, the configured RPC operator and infrastructure providers, and chain participants that receive submitted transactions. Clicking official download, website or explorer links also makes an ordinary browser request to that destination. Complete before publication: **[RPC_OPERATOR_AND_PROCESSORS]**, **[HOSTING_REGIONS]**, **[WEBSITE_EXPLORER_OPERATORS_AND_POLICY_LINKS]**, **[NETWORK_LOG_FIELDS_RETENTION_AND_ACCESS]**. Do not replace these unknowns with claims of no collection or zero retention.

## Your controls and retention

Decline connection/signature requests or revoke an approved site's connection. This stops future authorization but cannot retract already released addresses/signatures or submitted transactions. Canceling a request after network dispatch cannot recall the broadcast.

Remove account deletes the encrypted vault, provider account and site permissions from this profile. It **does not delete the transaction journal or history**, and there is currently no automatic journal retention period. Clearing the extension's stored data or removing it through your browser can remove local extension records; consult the browser's controls and preserve your offline recovery key first. Separate PWA/site data, backups and external copies require separate handling. The extension cannot guarantee deletion from chain participants, another DApp or a service's logs.

Private browsing is disabled in this candidate. Firefox site permissions are separated by the browser-provided container identity; each container requires its own connection approval. The encrypted vault, selected account and account-level transaction recovery journal are shared within the extension profile, not separate per-container vaults. Old Firefox permissions without container identity require a new connection. Container metadata stays local. Installed Firefox verification is pending. The publisher must define and verify server-side retention and data-request procedures: **[SERVER_RETENTION_AND_DELETION_PROCESS]**, **[PRIVACY_REQUEST_PROCESS]**. There is no publisher recovery-key escrow or password-reset service in the extension.

## Limited use and changes

Proposed publisher commitment, to be approved against actual operations: YNX Wallet uses information only for its disclosed wallet purpose and complies with the Chrome Web Store User Data Policy, including Limited Use. It does not sell data or use it for personalized advertising, data-broker transfer, credit scoring or lending decisions. Human access and any legally required/security transfers must be limited and disclosed in the finalized service policy. Do not send a password or recovery key to support.

Material data-practice changes require an updated policy and appropriate disclosure/consent before the new handling starts. Contact **[PRIVACY_CONTACT]** for questions or requests; this placeholder is not an operational channel.
