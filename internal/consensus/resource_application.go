package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func (a *Application) applyResourceAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	txHash := ApplicationActionHash(raw)
	idempotencyKey, requestHash, err := resourceActionIdentity(tx)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	idempotencyID := ResourceIdempotencyID(tx.Signer, idempotencyKey)
	if _, _, exists := findResourceRecord(state.resourceIdempotency, idempotencyID, func(v BFTResourceIdempotency) string { return v.ID }); exists {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource idempotency key is already committed"))
	}

	objectID, objectType, provider, beneficiary := "", "", "", ""
	var amount int64
	policy := a.migration.ResourcePolicy
	if err := policy.Validate(); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, fmt.Errorf("invalid committed Resource policy: %w", err))
	}

	switch tx.Action {
	case ActionResourceDelegate:
		var input ResourceDelegationPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Provider != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource delegation provider must be the signer"))
		}
		if input.PolicyHash != policy.PolicyHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource delegation policy hash is stale or unknown"))
		}
		signerIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok || input.AmountYNXT > math.MaxInt64-SignedActionFeeYNXT || state.accounts[signerIndex].Balance < input.AmountYNXT+SignedActionFeeYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT for Resource delegation and action fee"))
		}
		state.accounts, _ = ensureAccount(state.accounts, input.Beneficiary)
		beneficiaryIndex, _ := accountIndex(state.accounts, input.Beneficiary)
		if state.accounts[beneficiaryIndex].Staked > math.MaxInt64-input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource delegation would overflow beneficiary stake"))
		}
		if err := a.chargeApplicationAction(&state, tx); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		signerIndex, _ = accountIndex(state.accounts, tx.Signer)
		beneficiaryIndex, _ = accountIndex(state.accounts, input.Beneficiary)
		state.accounts[signerIndex].Balance -= input.AmountYNXT
		state.accounts[beneficiaryIndex].Staked += input.AmountYNXT

		objectID, objectType, provider, beneficiary, amount = ApplicationActionRecordID("resource-delegation", txHash), "delegation", input.Provider, input.Beneficiary, input.AmountYNXT
		delegation := BFTResourceDelegation{ResourceDelegation: chain.ResourceDelegation{
			ID: objectID, Provider: input.Provider, Beneficiary: input.Beneficiary, AmountYNXT: input.AmountYNXT,
			Bandwidth: input.AmountYNXT / policy.BandwidthStakeDivisor, Compute: input.AmountYNXT / policy.ComputeStakeDivisor,
			AICredits: input.AmountYNXT / policy.AICreditStakeDivisor, TrustCredits: input.AmountYNXT / policy.TrustStakeDivisor,
			PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, Status: "active", CreatedAt: blockTime,
		}, Signer: tx.Signer, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		delegation.AuditHash = resourceDelegationAuditHash(delegation)
		state.resourceDelegations = insertResourceRecord(state.resourceDelegations, delegation, func(v BFTResourceDelegation) string { return v.ID })

	case ActionResourceRent:
		var input ResourceRentalPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Address != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource rental address must be the signer"))
		}
		if input.PolicyHash != policy.PolicyHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource rental policy hash is stale or unknown"))
		}
		if input.Provider != chain.ProtocolResourceProvider && !hasActiveResourceDelegation(state.resourceDelegations, input.Provider) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource provider has no active delegation"))
		}
		if !validationOnly {
			if !input.QuoteExpiresAt.After(blockTime) || input.QuoteExpiresAt.After(blockTime.Add(time.Duration(policy.QuoteTTLSeconds)*time.Second)) {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource quote is expired or exceeds policy TTL"))
			}
		}
		quote, err := chain.ResourceQuoteForPolicy(policy, input.Address, input.Bandwidth, input.Compute, input.AICredits, input.TrustCredits, input.QuoteExpiresAt)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if quote.ID != input.QuoteID || quote.PriceYNXT > input.MaxPriceYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource quote commitment or maximum price mismatch"))
		}
		providerIncome := int64(0)
		if input.Provider != chain.ProtocolResourceProvider {
			providerIncome = resourceBasisPoints(quote.PriceYNXT, policy.ProviderShareBps)
		}
		protocolFee := quote.PriceYNXT - providerIncome
		signerIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok || quote.PriceYNXT > math.MaxInt64-SignedActionFeeYNXT || state.accounts[signerIndex].Balance < quote.PriceYNXT+SignedActionFeeYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT for Resource rental and action fee"))
		}
		state.accounts, _ = ensureAccount(state.accounts, input.Provider)
		state.accounts, _ = ensureAccount(state.accounts, chain.ProtocolResourceTreasury)
		providerIndex, _ := accountIndex(state.accounts, input.Provider)
		treasuryIndex, _ := accountIndex(state.accounts, chain.ProtocolResourceTreasury)
		if state.accounts[providerIndex].Balance > math.MaxInt64-providerIncome || state.accounts[treasuryIndex].Balance > math.MaxInt64-protocolFee {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource rental income would overflow account balance"))
		}
		if err := a.chargeApplicationAction(&state, tx); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		signerIndex, _ = accountIndex(state.accounts, tx.Signer)
		providerIndex, _ = accountIndex(state.accounts, input.Provider)
		treasuryIndex, _ = accountIndex(state.accounts, chain.ProtocolResourceTreasury)
		state.accounts[signerIndex].Balance -= quote.PriceYNXT
		state.accounts[providerIndex].Balance += providerIncome
		state.accounts[treasuryIndex].Balance += protocolFee
		reduceResourceUsage(&state.accounts[signerIndex].ResourceUsage, input)

		quoteRecord := BFTResourceQuote{ResourceQuote: quote, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		quoteRecord.AuditHash = resourceQuoteAuditHash(quoteRecord)
		state.resourceQuotes = insertResourceRecord(state.resourceQuotes, quoteRecord, func(v BFTResourceQuote) string { return v.ID })
		objectID, objectType, provider, amount = ApplicationActionRecordID("resource-rental", txHash), "rental", input.Provider, quote.PriceYNXT
		rental := BFTResourceRental{ResourceRental: chain.ResourceRental{
			ID: objectID, QuoteID: quote.ID, Address: input.Address, Provider: input.Provider, PriceYNXT: quote.PriceYNXT,
			ProviderIncomeYNXT: providerIncome, ProtocolFeeYNXT: protocolFee, PolicyID: policy.ID, PolicyVersion: policy.Version,
			PolicyHash: policy.PolicyHash, GovernanceStatus: policy.GovernanceStatus, Status: "active", CreatedAt: blockTime,
			Bandwidth: input.Bandwidth, Compute: input.Compute, AICredits: input.AICredits, TrustCredits: input.TrustCredits,
		}, Signer: tx.Signer, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		rental.AuditHash = resourceRentalAuditHash(rental)
		state.resourceRentals = insertResourceRecord(state.resourceRentals, rental, func(v BFTResourceRental) string { return v.ID })
		if providerIncome > 0 {
			state.resourceIncome = appendResourceIncome(state.resourceIncome, tx, objectID, input.Provider, "resource-rental", providerIncome, policy, height, blockTime, txHash)
		}
		if protocolFee > 0 {
			state.resourceIncome = appendResourceIncome(state.resourceIncome, tx, objectID, chain.ProtocolResourceTreasury, "resource-protocol-fee", protocolFee, policy, height, blockTime, txHash)
		}
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported Resource application action"))
	}

	event := BFTResourceEvent{ID: ApplicationActionRecordID("resource-event", txHash), Type: tx.Action, ObjectID: objectID, Signer: tx.Signer, Provider: provider, Beneficiary: beneficiary, AmountYNXT: amount, IdempotencyKey: idempotencyKey, BlockHeight: height, TxHash: txHash, CreatedAt: blockTime}
	event.AuditHash = resourceEventAuditHash(event)
	state.resourceEvents = append(state.resourceEvents, event)
	idempotency := BFTResourceIdempotency{ID: idempotencyID, Signer: tx.Signer, IdempotencyKey: idempotencyKey, Action: tx.Action, RequestHash: requestHash, ObjectType: objectType, ObjectID: objectID, TxHash: txHash}
	state.resourceIdempotency = insertResourceRecord(state.resourceIdempotency, idempotency, func(v BFTResourceIdempotency) string { return v.ID })
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.resource_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "provider", Value: provider, Index: true}, {Key: "object_id", Value: objectID, Index: true}}}}, nil
}

func resourceActionIdentity(tx SignedApplicationAction) (key, requestHash string, err error) {
	switch tx.Action {
	case ActionResourceDelegate:
		var p ResourceDelegationPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, p.RequestHash, err
	case ActionResourceRent:
		var p ResourceRentalPayload
		err = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, p.RequestHash, err
	default:
		return "", "", errors.New("unsupported Resource action")
	}
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

func appendResourceIncome(values []BFTResourceIncome, tx SignedApplicationAction, rentalID, provider, source string, amount int64, policy chain.ResourceMarketPolicy, height int64, blockTime time.Time, txHash string) []BFTResourceIncome {
	id := ApplicationActionRecordID("resource-income-"+source, txHash)
	income := BFTResourceIncome{ResourceIncomeRecord: chain.ResourceIncomeRecord{ID: id, Provider: provider, RentalID: rentalID, Source: source, Amount: amount, Currency: "YNXT", PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, CreatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
	income.AuditHash = resourceIncomeAuditHash(income)
	return insertResourceRecord(values, income, func(v BFTResourceIncome) string { return v.ID })
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
	for _, value := range state.ResourceDelegations {
		result.DelegatedYNXT += value.AmountYNXT
	}
	for _, value := range state.ResourceRentals {
		result.RentalVolumeYNXT += value.PriceYNXT
		result.ProviderIncomeYNXT += value.ProviderIncomeYNXT
		result.ProtocolFeeYNXT += value.ProtocolFeeYNXT
	}
	return result
}
