# Decision 001: immutable constant-product Testnet engine

- Status: accepted for Testnet Preview only
- Date: 2026-07-18
- Source revision: `42c6c7dc15c7adf36144417fd399e12e60bf4908`

YNX DEX v1 selects a clean-room constant-product engine because its invariant, fee accounting, routing and LP share model can be tested and explained within the current YNX Testnet boundary. Stable-swap is rejected until reviewed stable assets and rate-oracle contracts exist. Concentrated liquidity is deferred because range/tick accounting, UX, indexing and audit scope are materially larger. An external aggregator is rejected because YNX does not yet have multiple proven liquidity venues or a production route service.

Pools are immutable. Governance cannot transfer pool reserves, confiscate LP shares, hide minting, change a deployed pool fee or freeze native YNXT. Governance can schedule token allow-list, protocol-fee recipient and governance-address changes with a public two-day delay. The deployment candidate must use an owner-approved multisig; that address is currently absent.

Consequences: v1 is less capital-efficient for correlated assets, and LPs remain exposed to price divergence, toxic flow, arbitrage, oracle manipulation and MEV. The product must display those risks and must not publish APY/TVL/volume until derived from real indexed events.
