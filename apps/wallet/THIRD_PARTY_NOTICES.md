# Third-party notices and standards

The application dependency inventory is pinned by `package-lock.json`; license review and known limitations are in `DEPENDENCY_REVIEW.md`. Key direct dependencies include Expo/React Native/React (MIT), Noble cryptography libraries (MIT), Lucide icons (ISC), and React Native SVG/Safe Area/QR packages under their published open-source licenses. The exact transitive license text must be generated and reviewed from the release lock before public binary distribution.

Protocol references are ERC-4337/7769/7562 (Ethereum Improvement Proposal repository terms), W3C WebAuthn Level 3, Verifiable Credentials Data Model 2.0 and Bitstring Status List 1.0 (W3C document license), OpenID Connect Core (OpenID Foundation), and IETF RFC 9449/9700. References define interoperability and security boundaries; no specification name implies certification or endorsement.

WalletConnect is an optional external compatibility protocol and is not currently bundled. MetaMask, Rabby, Phantom and Apple Wallet are comparative product references only; their trademarks and assets are not included.

Smart Account build dependencies include eth-infinitism `@account-abstraction/contracts` 0.8.0 (MIT) and OpenZeppelin Contracts 5.6.1 (MIT). The official account-abstraction npm dependency graph also contains Uniswap v2/v3 packages under GPL-2.0-or-later, GPL-3.0-or-later and BUSL-1.1 declarations. No Uniswap contract is imported into the YNX Smart Account source, but those build dependencies and their exact license texts must remain in release notices and legal review.
