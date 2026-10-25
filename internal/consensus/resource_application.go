package consensus

import (
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// applyApplicationAction verifies the original classic signature and legacy
// policy before reaching this private shared business executor.
func (a *Application) applyResourceAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	return a.applyAuthorizedResourceAction(state, raw, classicAuthorizedResourceAction(tx), height, blockTime, validationOnly)
}

func hasActiveResourceDelegation(values []BFTResourceDelegation, provider string) bool {
	for _, value := range values {
		if value.Provider == provider && value.Status == "active" && value.AmountYNXT > 0 {
			return true
		}
	}
	return false
}

func resourceBasisPoints(amount, basisPoints int64) int64 {
	return amount/10000*basisPoints + amount%10000*basisPoints/10000
}

func reduceResourceUsage(usage *chain.ResourceUsage, input ResourceRentalPayload) {
	usage.BandwidthUsed = maxZero(usage.BandwidthUsed - minInt64(usage.BandwidthUsed, input.Bandwidth))
	usage.ComputeUsed = maxZero(usage.ComputeUsed - minInt64(usage.ComputeUsed, input.Compute))
	usage.AICreditsUsed = maxZero(usage.AICreditsUsed - minInt64(usage.AICreditsUsed, input.AICredits))
	usage.TrustUsed = maxZero(usage.TrustUsed - minInt64(usage.TrustUsed, input.TrustCredits))
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
func maxZero(value int64) int64 {
	if value < 0 {
		return 0
	}
	return value
}

func bftResourceBalance(account chain.ConsensusAccount, policy chain.ResourceMarketPolicy) chain.ResourceBalance {
	bandwidth := capacityLimit(policy.BaseBandwidth, account.Staked, policy.BandwidthStakeDivisor)
	compute := capacityLimit(policy.BaseCompute, account.Staked, policy.ComputeStakeDivisor)
	ai := capacityLimit(policy.BaseAICredits, account.Staked, policy.AICreditStakeDivisor)
	trust := capacityLimit(policy.BaseTrustCredits, account.Staked, policy.TrustStakeDivisor)
	return chain.ResourceBalance{Address: account.Address, BandwidthLimit: bandwidth, BandwidthUsed: account.ResourceUsage.BandwidthUsed, BandwidthLeft: maxZero(bandwidth - account.ResourceUsage.BandwidthUsed), ComputeLimit: compute, ComputeUsed: account.ResourceUsage.ComputeUsed, ComputeLeft: maxZero(compute - account.ResourceUsage.ComputeUsed), AICreditsLimit: ai, AICreditsUsed: account.ResourceUsage.AICreditsUsed, AICreditsLeft: maxZero(ai - account.ResourceUsage.AICreditsUsed), TrustLimit: trust, TrustUsed: account.ResourceUsage.TrustUsed, TrustLeft: maxZero(trust - account.ResourceUsage.TrustUsed), PayCreditsUsed: account.ResourceUsage.PayCreditsUsed, Staked: account.Staked}
}

func capacityLimit(base, staked, divisor int64) int64 {
	addition := staked / divisor
	if base > math.MaxInt64-addition {
		return math.MaxInt64
	}
	return base + addition
}

func buildBFTResourceAnalytics(migration chain.ConsensusMigrationState, state CommittedState) chain.ResourceAnalytics {
	result := chain.ResourceAnalytics{Network: migration.Network, ActiveDelegationCount: len(state.ResourceDelegations), ResourceRentalCount: len(state.ResourceRentals), ResourceIncomeRecordCount: len(state.ResourceIncome), Policy: migration.ResourcePolicy, PolicyID: migration.ResourcePolicy.ID, PolicyVersion: migration.ResourcePolicy.Version, PolicyHash: migration.ResourcePolicy.PolicyHash, GovernanceStatus: migration.ResourcePolicy.GovernanceStatus, TruthfulStatus: "committed_bft_state"}
	addLegacyResourceMarketAnalytics(&result, state.LegacyResourceMarket)
	for _, value := range state.ResourceDelegations {
		result.DelegatedYNXT += value.AmountYNXT
	}
	for _, value := range state.ResourceRentals {
		result.RentalVolumeYNXT += value.PriceYNXT
		result.ProviderIncomeYNXT += value.ProviderIncomeYNXT
		result.ProtocolFeeYNXT += value.ProtocolFeeYNXT
	}
	for _, pool := range state.ResourcePools {
		if pool.PoolType == "merchant" {
			result.MerchantPoolCount++
		} else if pool.PoolType == "dapp" {
			result.DAppPoolCount++
		}
		if pool.Status == "active" {
			result.ActiveSponsorPoolCount++
		}
	}
	result.SponsorshipCount = len(state.ResourceSponsorships)
	values := make([]chain.ResourceSponsorship, 0, len(state.ResourceSponsorships))
	for _, value := range state.ResourceSponsorships {
		values = append(values, value.ResourceSponsorship)
	}
	if source := state.LegacyResourceSponsor; source != nil {
		result.TruthfulStatus = "committed_bft_with_anchored_source_state"
		result.SponsorshipCount += len(source.Sponsors)
		for _, value := range source.Sponsors {
			values = append(values, value)
		}
	}
	for _, value := range values {
		switch value.ResourceType {
		case "bandwidth":
			result.SponsoredResources.Bandwidth += value.Amount
		case "compute":
			result.SponsoredResources.Compute += value.Amount
		case "ai_credits":
			result.SponsoredResources.AICredits += value.Amount
		case "trust_credits":
			result.SponsoredResources.TrustCredits += value.Amount
		}
	}
	return result
}
