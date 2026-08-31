# Finance Standard Wallet event rendering checkpoint — 2026-08-31

Finance Web now subscribes to the accepted reducer's
`ynx-finance-standard-wallet-state` event.  The connected surface refreshes
the selected YNX Wallet or MetaMask account after `accountsChanged`; a wrong
chain or Provider disconnect immediately returns the product to its guest
surface.  The pending Product Session boundary is unchanged and no Finance API
request is introduced.

Verification: `npm run build:standard-wallet`, `npm test` (21/21), and
`npm run security` (283 text files) passed locally.

This is not public/installed lifecycle evidence.  Provider approval/rejection,
callback, signature, transaction, Product Session and ComputerControl gates
remain false pending a Finance-only deployment lease and direct proof.
