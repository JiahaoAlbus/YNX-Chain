package consensus

import (
	"errors"
	"math"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type BFTResourceQuote struct {
	chain.ResourceQuote
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTResourceDelegation struct {
	chain.ResourceDelegation
	Signer         string `json:"signer"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
	BlockHeight    int64  `json:"blockHeight"`
	TxHash         string `json:"txHash"`
	AuditHash      string `json:"auditHash"`
}

type BFTResourceRental struct {
	chain.ResourceRental
	Signer         string `json:"signer"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
	BlockHeight    int64  `json:"blockHeight"`
	TxHash         string `json:"txHash"`
	AuditHash      string `json:"auditHash"`
}

type BFTResourceIncome struct {
	chain.ResourceIncomeRecord
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTResourceEvent struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"`
	ObjectID       string    `json:"objectId"`
	Signer         string    `json:"signer"`
	Provider       string    `json:"provider"`
	Beneficiary    string    `json:"beneficiary,omitempty"`
	AmountYNXT     int64     `json:"amountYnxt"`
	IdempotencyKey string    `json:"idempotencyKey"`
	BlockHeight    int64     `json:"blockHeight"`
	TxHash         string    `json:"txHash"`
	AuditHash      string    `json:"auditHash"`
	CreatedAt      time.Time `json:"createdAt"`
}

type BFTResourceIdempotency struct {
	ID             string `json:"id"`
	Signer         string `json:"signer"`
	IdempotencyKey string `json:"idempotencyKey"`
	Action         string `json:"action"`
	RequestHash    string `json:"requestHash"`
	ObjectType     string `json:"objectType"`
	ObjectID       string `json:"objectId"`
	TxHash         string `json:"txHash"`
}

func validateResourceCommittedState(s CommittedState, migration chain.ConsensusMigrationState) error {
	policy := migration.ResourcePolicy
	if err := policy.Validate(); err != nil {
		return err
	}
	previous := ""
	for _, value := range s.ResourceQuotes {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) {
			return errors.New("committed Resource quotes must have unique sorted IDs")
		}
		if !IsNativeAddress(value.Signer) || value.Address != value.Signer || value.PriceYNXT <= 0 || value.PolicyHash != policy.PolicyHash || value.ExpiresAt.IsZero() || value.BlockHeight <= 0 || !validResourceTxHash(value.TxHash) {
			return errors.New("committed Resource quote metadata is incomplete or not policy-bound")
		}
		if value.AuditHash != resourceQuoteAuditHash(value) {
			return errors.New("committed Resource quote audit hash mismatch")
		}
		previous = value.ID
	}
	previous = ""
	for _, value := range s.ResourceDelegations {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !IsNativeAddress(value.Signer) || value.Provider != value.Signer || !validResourceAccount(value.Beneficiary) || value.AmountYNXT <= 0 || value.PolicyHash != policy.PolicyHash || value.Status != "active" || value.CreatedAt.IsZero() || !validResourceIdempotencyKey(value.IdempotencyKey) || !payHashPattern.MatchString(value.RequestHash) || value.BlockHeight <= 0 || !validResourceTxHash(value.TxHash) || value.AuditHash != resourceDelegationAuditHash(value) {
			return errors.New("committed Resource delegations must be complete, policy-bound, and sorted")
		}
		if value.Bandwidth != value.AmountYNXT/policy.BandwidthStakeDivisor || value.Compute != value.AmountYNXT/policy.ComputeStakeDivisor || value.AICredits != value.AmountYNXT/policy.AICreditStakeDivisor || value.TrustCredits != value.AmountYNXT/policy.TrustStakeDivisor {
			return errors.New("committed Resource delegation capacity does not match policy")
		}
		previous = value.ID
	}
	previous = ""
	for _, value := range s.ResourceRentals {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !payIDPattern.MatchString(value.QuoteID) || !IsNativeAddress(value.Signer) || value.Address != value.Signer || !validResourceAccount(value.Provider) || value.PriceYNXT <= 0 || value.ProviderIncomeYNXT < 0 || value.ProtocolFeeYNXT < 0 || value.ProviderIncomeYNXT > math.MaxInt64-value.ProtocolFeeYNXT || value.ProviderIncomeYNXT+value.ProtocolFeeYNXT != value.PriceYNXT || value.PolicyHash != policy.PolicyHash || value.Status != "active" || value.CreatedAt.IsZero() || !validResourceIdempotencyKey(value.IdempotencyKey) || !payHashPattern.MatchString(value.RequestHash) || value.BlockHeight <= 0 || !validResourceTxHash(value.TxHash) || value.AuditHash != resourceRentalAuditHash(value) {
			return errors.New("committed Resource rentals must be complete, reconciled, policy-bound, and sorted")
		}
		previous = value.ID
	}
	previous = ""
	for _, value := range s.ResourceIncome {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !payIDPattern.MatchString(value.RentalID) || !validResourceAccount(value.Provider) || value.Source == "" || value.Amount <= 0 || value.Currency != "YNXT" || value.PolicyHash != policy.PolicyHash || value.CreatedAt.IsZero() || value.BlockHeight <= 0 || !validResourceTxHash(value.TxHash) || value.AuditHash != resourceIncomeAuditHash(value) {
			return errors.New("committed Resource income must be complete, policy-bound, and sorted")
		}
		previous = value.ID
	}
	seenEvents := make(map[string]struct{}, len(s.ResourceEvents))
	for _, value := range s.ResourceEvents {
		if !payIDPattern.MatchString(value.ID) || !payIDPattern.MatchString(value.ObjectID) || !IsNativeAddress(value.Signer) || !validResourceAccount(value.Provider) || value.AmountYNXT <= 0 || !validResourceIdempotencyKey(value.IdempotencyKey) || value.BlockHeight <= 0 || !validResourceTxHash(value.TxHash) || value.CreatedAt.IsZero() || value.AuditHash != resourceEventAuditHash(value) {
			return errors.New("committed Resource event is incomplete")
		}
		if _, exists := seenEvents[value.ID]; exists {
			return errors.New("committed Resource event IDs must be unique")
		}
		seenEvents[value.ID] = struct{}{}
	}
	previous = ""
	for _, value := range s.ResourceIdempotency {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !IsNativeAddress(value.Signer) || !validResourceIdempotencyKey(value.IdempotencyKey) || !isResourceAction(value.Action) || !payHashPattern.MatchString(value.RequestHash) || value.ObjectType == "" || !payIDPattern.MatchString(value.ObjectID) || !validResourceTxHash(value.TxHash) {
			return errors.New("committed Resource idempotency records must be complete and sorted")
		}
		previous = value.ID
	}
	if len(s.ResourceQuotes) != len(s.ResourceRentals) || len(s.ResourceEvents) != len(s.ResourceDelegations)+len(s.ResourceRentals) || len(s.ResourceIdempotency) != len(s.ResourceEvents) {
		return errors.New("committed Resource quote, event, rental, delegation, and idempotency counts do not reconcile")
	}
	rentalByID := make(map[string]BFTResourceRental, len(s.ResourceRentals))
	var delegatedTotal, rentalTotal, providerTotal, protocolTotal int64
	for _, value := range s.ResourceDelegations {
		if value.AmountYNXT > math.MaxInt64-delegatedTotal {
			return errors.New("committed Resource delegation total overflows int64")
		}
		delegatedTotal += value.AmountYNXT
	}
	for _, rental := range s.ResourceRentals {
		rentalByID[rental.ID] = rental
		quoteIndex, quote, ok := findResourceRecord(s.ResourceQuotes, rental.QuoteID, func(v BFTResourceQuote) string { return v.ID })
		_ = quoteIndex
		if !ok || quote.Signer != rental.Signer || quote.Address != rental.Address || quote.PriceYNXT != rental.PriceYNXT || quote.PolicyHash != rental.PolicyHash || quote.TxHash != rental.TxHash || quote.BlockHeight != rental.BlockHeight || !quote.ExpiresAt.After(rental.CreatedAt) || quote.Bandwidth != rental.Bandwidth || quote.Compute != rental.Compute || quote.AICredits != rental.AICredits || quote.TrustCredits != rental.TrustCredits {
			return errors.New("committed Resource rental does not reconcile with its quote")
		}
		recomputed, err := chain.ResourceQuoteForPolicy(policy, quote.Address, quote.Bandwidth, quote.Compute, quote.AICredits, quote.TrustCredits, quote.ExpiresAt)
		if err != nil || recomputed.ID != quote.ID || recomputed.PriceYNXT != quote.PriceYNXT {
			return errors.New("committed Resource quote does not recompute from policy")
		}
		expectedProvider := int64(0)
		if rental.Provider != chain.ProtocolResourceProvider {
			expectedProvider = resourceBasisPoints(rental.PriceYNXT, policy.ProviderShareBps)
		}
		if rental.ProviderIncomeYNXT != expectedProvider || rental.ProtocolFeeYNXT != rental.PriceYNXT-expectedProvider {
			return errors.New("committed Resource rental settlement does not match policy")
		}
		if rental.PriceYNXT > math.MaxInt64-rentalTotal || rental.ProviderIncomeYNXT > math.MaxInt64-providerTotal || rental.ProtocolFeeYNXT > math.MaxInt64-protocolTotal {
			return errors.New("committed Resource analytics total overflows int64")
		}
		rentalTotal += rental.PriceYNXT
		providerTotal += rental.ProviderIncomeYNXT
		protocolTotal += rental.ProtocolFeeYNXT
	}
	incomeByRental := make(map[string]int64, len(s.ResourceRentals))
	providerIncomeByRental := make(map[string]int64, len(s.ResourceRentals))
	protocolIncomeByRental := make(map[string]int64, len(s.ResourceRentals))
	for _, income := range s.ResourceIncome {
		rental, ok := rentalByID[income.RentalID]
		if !ok || income.TxHash != rental.TxHash || income.BlockHeight != rental.BlockHeight || !income.CreatedAt.Equal(rental.CreatedAt) {
			return errors.New("committed Resource income references an unknown or inconsistent rental")
		}
		if income.Amount > math.MaxInt64-incomeByRental[income.RentalID] {
			return errors.New("committed Resource income total overflows int64")
		}
		incomeByRental[income.RentalID] += income.Amount
		switch income.Source {
		case "resource-rental":
			if income.Provider != rental.Provider {
				return errors.New("committed provider income recipient mismatch")
			}
			providerIncomeByRental[income.RentalID] += income.Amount
		case "resource-protocol-fee":
			if income.Provider != chain.ProtocolResourceTreasury {
				return errors.New("committed protocol income recipient mismatch")
			}
			protocolIncomeByRental[income.RentalID] += income.Amount
		default:
			return errors.New("committed Resource income source is unsupported")
		}
	}
	for _, rental := range s.ResourceRentals {
		if incomeByRental[rental.ID] != rental.PriceYNXT || providerIncomeByRental[rental.ID] != rental.ProviderIncomeYNXT || protocolIncomeByRental[rental.ID] != rental.ProtocolFeeYNXT {
			return errors.New("committed Resource income does not reconcile with rental settlement")
		}
	}
	objectTx := make(map[string]string, len(s.ResourceEvents))
	for _, value := range s.ResourceDelegations {
		objectTx[value.ID] = value.TxHash
	}
	for _, value := range s.ResourceRentals {
		objectTx[value.ID] = value.TxHash
	}
	for _, event := range s.ResourceEvents {
		if objectTx[event.ObjectID] != event.TxHash {
			return errors.New("committed Resource event does not reference its transaction object")
		}
	}
	for _, idem := range s.ResourceIdempotency {
		if objectTx[idem.ObjectID] != idem.TxHash {
			return errors.New("committed Resource idempotency does not reference its transaction object")
		}
	}
	expectedStake := make(map[string]int64, len(s.Accounts))
	for _, account := range migration.Accounts {
		expectedStake[account.Address] = account.Staked
	}
	for _, value := range s.ResourceDelegations {
		if expectedStake[value.Beneficiary] > math.MaxInt64-value.AmountYNXT {
			return errors.New("committed expected Resource stake overflows int64")
		}
		expectedStake[value.Beneficiary] += value.AmountYNXT
	}
	for _, value := range s.StakeDelegations {
		if expectedStake[value.Delegator] > math.MaxInt64-value.AmountYNXT {
			return errors.New("committed expected validator delegation stake overflows int64")
		}
		expectedStake[value.Delegator] += value.AmountYNXT
	}
	for _, account := range s.Accounts {
		if account.Staked != expectedStake[account.Address] {
			return errors.New("committed staked YNXT differs from migration plus Resource and validator delegations")
		}
		delete(expectedStake, account.Address)
	}
	if len(expectedStake) != 0 {
		return errors.New("committed Resource stake account is missing")
	}
	return nil
}

func findResourceRecord[T any](values []T, id string, idOf func(T) string) (int, T, bool) {
	index := sort.Search(len(values), func(i int) bool { return idOf(values[i]) >= id })
	var zero T
	if index < len(values) && idOf(values[index]) == id {
		return index, values[index], true
	}
	return index, zero, false
}

func insertResourceRecord[T any](values []T, value T, idOf func(T) string) []T {
	index, _, _ := findResourceRecord(values, idOf(value), idOf)
	values = append(values, value)
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func resourceQuoteAuditHash(v BFTResourceQuote) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_RESOURCE_QUOTE_AUDIT_V1", v)
}
func resourceDelegationAuditHash(v BFTResourceDelegation) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_RESOURCE_DELEGATION_AUDIT_V1", v)
}
func resourceRentalAuditHash(v BFTResourceRental) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_RESOURCE_RENTAL_AUDIT_V1", v)
}
func resourceIncomeAuditHash(v BFTResourceIncome) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_RESOURCE_INCOME_AUDIT_V1", v)
}
func resourceEventAuditHash(v BFTResourceEvent) string {
	v.AuditHash = ""
	return recordAuditHash("YNX_RESOURCE_EVENT_AUDIT_V1", v)
}

func validResourceTxHash(value string) bool {
	return len(value) == 66 && value[:2] == "0x" && payHashPattern.MatchString(value[2:])
}
