package consensus

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// LegacyResourceMarket preserves source records without manufacturing a
// signer, transaction, quote expiry or idempotency key absent from that source.
// Their already-applied balances, stakes and usage are in migration.Accounts.
type LegacyResourceMarket struct {
	SourceAnchor string                                `json:"sourceAnchor"`
	Delegations  map[string]chain.ResourceDelegation   `json:"delegations"`
	Rentals      map[string]chain.ResourceRental       `json:"rentals"`
	Income       map[string]chain.ResourceIncomeRecord `json:"income"`
}

func migrationResourceMarket(m chain.ConsensusMigrationState) *LegacyResourceMarket {
	r := m.Runtime
	if r == nil || len(r.Delegation)+len(r.Rentals)+len(r.Income) == 0 {
		return nil
	}
	return cloneLegacyResourceMarket(&LegacyResourceMarket{SourceAnchor: m.StateHash, Delegations: r.Delegation, Rentals: r.Rentals, Income: r.Income})
}

func cloneLegacyResourceMarket(source *LegacyResourceMarket) *LegacyResourceMarket {
	if source == nil {
		return nil
	}
	raw, _ := json.Marshal(source)
	var out LegacyResourceMarket
	_ = json.Unmarshal(raw, &out)
	return &out
}

func validateLegacyResourceMarket(source *LegacyResourceMarket, s CommittedState, m chain.ConsensusMigrationState) error {
	if !reflect.DeepEqual(source, migrationResourceMarket(m)) {
		return errors.New("source Resource Market differs from the complete migration checkpoint")
	}
	if source == nil {
		return nil
	}
	if s.Version < 15 {
		return errors.New("legacy committed version cannot carry Resource Market imports")
	}
	accounts := make(map[string]chain.ConsensusAccount, len(m.Accounts))
	for _, account := range m.Accounts {
		accounts[account.Address] = account
	}
	delegated := map[string]int64{}
	var delegatedTotal, rentalTotal, providerTotal, protocolTotal int64
	for id, value := range source.Delegations {
		_, providerExists := accounts[value.Provider]
		_, beneficiaryExists := accounts[value.Beneficiary]
		if id != value.ID || !payIDPattern.MatchString(id) || !providerExists || !beneficiaryExists || value.AmountYNXT <= 0 || value.Status != "active" || value.CreatedAt.IsZero() || value.PolicyID == "" || value.PolicyVersion == "" || !payHashPattern.MatchString(value.PolicyHash) || value.Bandwidth < 0 || value.Compute < 0 || value.AICredits < 0 || value.TrustCredits < 0 {
			return errors.New("source Resource delegation is incomplete or references missing accounts")
		}
		if value.AmountYNXT > math.MaxInt64-delegated[value.Beneficiary] || value.AmountYNXT > math.MaxInt64-delegatedTotal {
			return errors.New("source Resource delegation amount overflows")
		}
		delegated[value.Beneficiary] += value.AmountYNXT
		delegatedTotal += value.AmountYNXT
	}
	for beneficiary, amount := range delegated {
		if accounts[beneficiary].Staked < amount {
			return errors.New("source active delegations exceed the beneficiary's preserved stake")
		}
	}
	providerIncome, protocolIncome := map[string]int64{}, map[string]int64{}
	for id, value := range source.Rentals {
		_, payerExists := accounts[value.Address]
		_, providerExists := accounts[value.Provider]
		if id != value.ID || !payIDPattern.MatchString(id) || !payIDPattern.MatchString(value.QuoteID) || !payerExists || !providerExists || value.PriceYNXT <= 0 || value.ProviderIncomeYNXT < 0 || value.ProtocolFeeYNXT < 0 || value.ProviderIncomeYNXT > math.MaxInt64-value.ProtocolFeeYNXT || value.ProviderIncomeYNXT+value.ProtocolFeeYNXT != value.PriceYNXT || value.CreatedAt.IsZero() || value.Status != "active" || value.PolicyID == "" || value.PolicyVersion == "" || !payHashPattern.MatchString(value.PolicyHash) || value.Bandwidth < 0 || value.Compute < 0 || value.AICredits < 0 || value.TrustCredits < 0 {
			return errors.New("source Resource rental settlement is incomplete")
		}
		if value.Provider == chain.ProtocolResourceProvider && value.ProviderIncomeYNXT != 0 {
			return errors.New("source protocol resource rental has unexpected provider income")
		}
		if value.PriceYNXT > math.MaxInt64-rentalTotal || value.ProviderIncomeYNXT > math.MaxInt64-providerTotal || value.ProtocolFeeYNXT > math.MaxInt64-protocolTotal {
			return errors.New("source Resource rental analytics overflow")
		}
		rentalTotal += value.PriceYNXT
		providerTotal += value.ProviderIncomeYNXT
		protocolTotal += value.ProtocolFeeYNXT
	}
	for id, value := range source.Income {
		rental, ok := source.Rentals[value.RentalID]
		if id != value.ID || !payIDPattern.MatchString(id) || !ok || value.Amount <= 0 || value.Currency != m.Network.NativeCurrencySymbol || value.CreatedAt.IsZero() || value.PolicyID != rental.PolicyID || value.PolicyVersion != rental.PolicyVersion || value.PolicyHash != rental.PolicyHash {
			return errors.New("source Resource income does not match its rental provenance")
		}
		switch value.Source {
		case "resource-rental":
			if value.Provider != rental.Provider || value.Amount > math.MaxInt64-providerIncome[value.RentalID] {
				return errors.New("source Resource provider income recipient or amount mismatch")
			}
			providerIncome[value.RentalID] += value.Amount
		case "protocol-resource-fee":
			if value.Provider != chain.ProtocolResourceTreasury || value.Amount > math.MaxInt64-protocolIncome[value.RentalID] {
				return errors.New("source Resource protocol income recipient or amount mismatch")
			}
			protocolIncome[value.RentalID] += value.Amount
		default:
			return errors.New("unsupported source Resource income provenance")
		}
	}
	for id, value := range source.Rentals {
		if providerIncome[id] != value.ProviderIncomeYNXT || protocolIncome[id] != value.ProtocolFeeYNXT {
			return errors.New("source rental income does not cover its original settlement")
		}
	}
	for _, value := range s.ResourceDelegations {
		if _, exists := source.Delegations[value.ID]; exists {
			return errors.New("native Resource delegation shadows a source object")
		}
		if value.AmountYNXT > math.MaxInt64-delegatedTotal {
			return errors.New("combined Resource delegation analytics overflow")
		}
		delegatedTotal += value.AmountYNXT
	}
	for _, value := range s.ResourceRentals {
		if _, exists := source.Rentals[value.ID]; exists {
			return errors.New("native Resource rental shadows a source object")
		}
		if value.PriceYNXT > math.MaxInt64-rentalTotal || value.ProviderIncomeYNXT > math.MaxInt64-providerTotal || value.ProtocolFeeYNXT > math.MaxInt64-protocolTotal {
			return errors.New("combined Resource rental analytics overflow")
		}
		rentalTotal += value.PriceYNXT
		providerTotal += value.ProviderIncomeYNXT
		protocolTotal += value.ProtocolFeeYNXT
	}
	for _, value := range s.ResourceIncome {
		if _, exists := source.Income[value.ID]; exists {
			return errors.New("native Resource income shadows a source record")
		}
	}
	return nil
}

func hasLegacyActiveResourceDelegation(source *LegacyResourceMarket, provider string) bool {
	if source != nil {
		for _, value := range source.Delegations {
			if value.Provider == provider && value.Status == "active" && value.AmountYNXT > 0 {
				return true
			}
		}
	}
	return false
}

// Rental replenishment may reduce spent usage, but it must not erase a live
// sponsor pool reservation. No persistent state is changed on validation error.
func reduceUnreservedResourceUsage(usage *chain.ResourceUsage, input ResourceRentalPayload, pools []BFTResourcePool, owner string) error {
	var reserved chain.ResourceUnits
	for _, pool := range pools {
		if pool.Owner != owner || pool.Status == "revoked" {
			continue
		}
		remaining, err := subtractBFTResourceUnits(pool.CumulativeAllowance, pool.Consumed)
		if err != nil {
			return err
		}
		reserved, err = addBFTResourceUnits(reserved, remaining)
		if err != nil {
			return err
		}
	}
	if usage.BandwidthUsed < reserved.Bandwidth || usage.ComputeUsed < reserved.Compute || usage.AICreditsUsed < reserved.AICredits || usage.TrustUsed < reserved.TrustCredits {
		return errors.New("Resource rental cannot repair an already inconsistent sponsor reservation")
	}
	next := *usage
	reduceResourceUsage(&next, input)
	if next.BandwidthUsed < reserved.Bandwidth {
		next.BandwidthUsed = reserved.Bandwidth
	}
	if next.ComputeUsed < reserved.Compute {
		next.ComputeUsed = reserved.Compute
	}
	if next.AICreditsUsed < reserved.AICredits {
		next.AICreditsUsed = reserved.AICredits
	}
	if next.TrustUsed < reserved.TrustCredits {
		next.TrustUsed = reserved.TrustCredits
	}
	*usage = next
	return nil
}

func addLegacyResourceMarketAnalytics(result *chain.ResourceAnalytics, source *LegacyResourceMarket) {
	if source == nil {
		return
	}
	result.TruthfulStatus = "committed_bft_with_anchored_source_state"
	result.ActiveDelegationCount += len(source.Delegations)
	result.ResourceRentalCount += len(source.Rentals)
	result.ResourceIncomeRecordCount += len(source.Income)
	for _, value := range source.Delegations {
		result.DelegatedYNXT += value.AmountYNXT
	}
	for _, value := range source.Rentals {
		result.RentalVolumeYNXT += value.PriceYNXT
		result.ProviderIncomeYNXT += value.ProviderIncomeYNXT
		result.ProtocolFeeYNXT += value.ProtocolFeeYNXT
	}
}
