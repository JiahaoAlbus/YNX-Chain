# Quant Web provider-only Wallet handoff

Commit `5fd6794b` consumes safe launcher v2. Web discovers EIP-6963/EIP-1193 only, then explicitly requests accounts and adds/switches YNX Testnet `0x1917`. It never opens a custom scheme, frame, or Product Session. Missing providers leave Research/Paper guest access plus official YNX Wallet and MetaMask links. Local build and three focused tests pass; public deployment, account approval, signing, orders, strategy execution, and ComputerControl remain false.
