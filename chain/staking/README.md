# Staking

The current testnet migration records account-level `staked` balances and validator voting power. It does not yet provide delegations, commissions, reward-source accounting, jail/slash evidence, unbonding, withdrawal queues, operator concentration controls, or liquid staking.

The economic simulator may model security-budget pressure from staked ratio, validator count, and concentration, but it does not calculate or promise APY. Consensus staking activation requires versioned state, explicit reward sources, bounded slash conditions, a tested exit queue, governance timelock, emergency recovery, and Explorer-visible events.
