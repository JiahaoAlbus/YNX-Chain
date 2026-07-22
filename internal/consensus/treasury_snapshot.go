package consensus

import (
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const TreasuryPolicyVersion = 1

type TreasuryBucketSnapshot struct {
	ID                   string `json:"id"`
	BalanceYNXT          int64  `json:"balanceYnxt"`
	Account              string `json:"account,omitempty"`
	Source               string `json:"source"`
	Configured           bool   `json:"configured"`
	MaximumAllocationBPS int64  `json:"maximumAllocationBps"`
}
type BFTTreasurySnapshot struct {
	SchemaVersion                   int                      `json:"schemaVersion"`
	PolicyVersion                   int                      `json:"policyVersion"`
	Source                          string                   `json:"source"`
	AsOfBlockHeight                 uint64                   `json:"asOfBlockHeight"`
	Buckets                         []TreasuryBucketSnapshot `json:"buckets"`
	TotalYNXT                       int64                    `json:"totalYnxt"`
	Reconciled                      bool                     `json:"reconciled"`
	AllocationWithinCandidateLimits bool                     `json:"allocationWithinCandidateLimits"`
	TransferExecutionEnabled        bool                     `json:"transferExecutionEnabled"`
	GovernanceStatus                string                   `json:"governanceStatus"`
	GovernanceTimelockSeconds       int64                    `json:"governanceTimelockSeconds"`
	SecretMarketSupport             bool                     `json:"secretMarketSupport"`
	CounterpartyCoverage            string                   `json:"counterpartyCoverage"`
	RunwayCoverage                  string                   `json:"runwayCoverage"`
	Failure                         bool                     `json:"failure"`
}

func buildTreasurySnapshot(migration chain.ConsensusMigrationState, state CommittedState) BFTTreasurySnapshot {
	development := int64(0)
	if index, ok := accountIndex(state.Accounts, chain.ProtocolResourceTreasury); ok {
		development = state.Accounts[index].Balance
	}
	buckets := []TreasuryBucketSnapshot{
		{ID: "stable_reserve", Source: "not_configured", MaximumAllocationBPS: 10_000},
		{ID: "validator_runway", Source: "not_configured", MaximumAllocationBPS: 5_000},
		{ID: "insurance", Source: "not_configured", MaximumAllocationBPS: 5_000},
		{ID: "liquidity_budget", Source: "not_configured", MaximumAllocationBPS: 2_500},
		{ID: "development_public_goods", BalanceYNXT: development, Account: chain.ProtocolResourceTreasury, Source: "ynx-consensus-account", Configured: true, MaximumAllocationBPS: 5_000},
		{ID: "provider_obligations", Source: "not_configured", MaximumAllocationBPS: 5_000},
		{ID: "emergency_reserve", Source: "not_configured", MaximumAllocationBPS: 5_000},
	}
	var total int64
	reconciled := true
	for _, bucket := range buckets {
		if bucket.BalanceYNXT < 0 || total > math.MaxInt64-bucket.BalanceYNXT {
			reconciled = false
			continue
		}
		total += bucket.BalanceYNXT
	}
	within := true
	if total > 0 {
		for _, bucket := range buckets {
			if bucket.BalanceYNXT*10_000/total > bucket.MaximumAllocationBPS {
				within = false
			}
		}
	}
	return BFTTreasurySnapshot{SchemaVersion: 1, PolicyVersion: TreasuryPolicyVersion, Source: "ynx-consensus-abci", AsOfBlockHeight: uint64(state.Height), Buckets: buckets, TotalYNXT: total, Reconciled: reconciled, AllocationWithinCandidateLimits: within, TransferExecutionEnabled: false, GovernanceStatus: "observation_only_pending_multisig_and_timelock", GovernanceTimelockSeconds: 7 * 24 * 60 * 60, SecretMarketSupport: false, CounterpartyCoverage: "no_external_counterparties_configured", RunwayCoverage: "unavailable_until_obligations_and_budget_are_governed", Failure: false}
}
