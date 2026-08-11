# YNX DEX liquidity-provider guide

Adding liquidity transfers both reviewed Testnet tokens to an immutable constant-product pool and mints proportional LP shares. Removing liquidity burns the selected LP shares and returns the proportional reserves subject to user-defined minimum amounts and a deadline.

Before approval, review pool and token contracts, current reserves, deposit ratio, expected LP shares, minimum shares or returned tokens, fee, price movement, gas, deadline and Wallet network. LP shares are not a fixed-value deposit, bank balance or guaranteed yield. Price divergence can create impermanent loss; malicious or depegged assets, oracle manipulation, toxic flow and MEV can cause permanent loss.

YNX DEX does not publish APY, TVL, volume or fee income until calculated from real indexed events. Test liquidity must be labelled with its owner-controlled Testnet account and is not market liquidity. No administrator can confiscate LP shares or transfer pool reserves through the DEX contracts, but contract bugs and token behavior remain risks until external audit.

Fee-on-transfer, rebasing, callback-bearing and otherwise non-standard tokens are unsupported even if their bytecode implements ERC-20 methods. Adversarial tests prove key failures roll back or reject reserve loss; they do not make those assets safe. Only the owner-reviewed Testnet list may appear in the product.
