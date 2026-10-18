package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// This private business value contains no public key, signature, or verified
// flag. Its only callers are the classic/PQ gateways after original-proof
// verification. Resource fee zero is a distinct native protocol rule.
type authorizedResourceAction struct {
	Type, Signer, Action string
	Nonce                uint64
	Payload              json.RawMessage
	Fee, BandwidthUnits  int64
	NativeHash           string
}

func classicAuthorizedResourceAction(tx SignedApplicationAction) authorizedResourceAction {
	return authorizedResourceAction{Type: tx.Type, Signer: tx.Signer, Action: tx.Action, Nonce: tx.Nonce, Payload: bytes.Clone(tx.Payload), Fee: tx.Fee, BandwidthUnits: 1}
}

func (a *Application) applyAuthorizedResourceAction(state executionState, raw []byte, tx authorizedResourceAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if tx.Type != SignedActionType && tx.Type != PQActionType || tx.Type == SignedActionType && (tx.Fee != SignedActionFeeYNXT || tx.BandwidthUnits != 1) || tx.Type == PQActionType && (tx.Fee != 0 || tx.BandwidthUnits != 0) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported Resource execution billing rules"))
	}
	canonical, err := canonicalResourceActionPayload(tx.Action, tx.Payload)
	if err != nil || !bytes.Equal(canonical, tx.Payload) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource execution payload is not canonical"))
	}
	state.accounts = cloneAccounts(state.accounts)
	state.resourceDelegations = append([]BFTResourceDelegation(nil), state.resourceDelegations...)
	state.resourceRentals = append([]BFTResourceRental(nil), state.resourceRentals...)
	state.resourceQuotes = append([]BFTResourceQuote(nil), state.resourceQuotes...)
	state.resourceIncome = append([]BFTResourceIncome(nil), state.resourceIncome...)
	state.resourceEvents = append([]BFTResourceEvent(nil), state.resourceEvents...)
	state.resourceIdempotency = append([]BFTResourceIdempotency(nil), state.resourceIdempotency...)
	txHash := ApplicationActionHash(raw)
	idempotencyKey, _, err := authorizedResourceIdentity(tx)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	idempotencyID := ResourceIdempotencyID(tx.Signer, idempotencyKey)
	if _, _, exists := findResourceRecord(state.resourceIdempotency, idempotencyID, func(v BFTResourceIdempotency) string { return v.ID }); exists {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource idempotency key is already committed"))
	}

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
		if !ok || input.AmountYNXT > math.MaxInt64-tx.Fee || state.accounts[signerIndex].Balance < input.AmountYNXT+tx.Fee {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT for Resource delegation and action fee"))
		}
		state.accounts, _ = ensureAccount(state.accounts, input.Beneficiary)
		beneficiaryIndex, _ := accountIndex(state.accounts, input.Beneficiary)
		if state.accounts[beneficiaryIndex].Staked > math.MaxInt64-input.AmountYNXT {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource delegation would overflow beneficiary stake"))
		}
		if err := a.chargeAuthorizedResourceAction(&state, tx); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		signerIndex, _ = accountIndex(state.accounts, tx.Signer)
		beneficiaryIndex, _ = accountIndex(state.accounts, input.Beneficiary)
		state.accounts[signerIndex].Balance -= input.AmountYNXT
		state.accounts[beneficiaryIndex].Staked += input.AmountYNXT

	case ActionResourceRent:
		var input ResourceRentalPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Address != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource rental address must be the signer"))
		}
		if input.PolicyHash != policy.PolicyHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource rental policy hash is stale or unknown"))
		}
		if input.Provider != chain.ProtocolResourceProvider && !hasActiveResourceDelegation(state.resourceDelegations, input.Provider) && !hasLegacyActiveResourceDelegation(state.legacyResourceMarket, input.Provider) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource provider has no active delegation"))
		}
		if policy.QuoteTTLSeconds > math.MaxInt64/int64(time.Second) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource quote TTL overflows duration"))
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
		if _, _, exists := findResourceRecord(state.resourceQuotes, quote.ID, func(v BFTResourceQuote) string { return v.ID }); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource quote already committed"))
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
		if !ok || quote.PriceYNXT > math.MaxInt64-tx.Fee || state.accounts[signerIndex].Balance < quote.PriceYNXT+tx.Fee {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT for Resource rental and action fee"))
		}
		state.accounts, _ = ensureAccount(state.accounts, input.Provider)
		state.accounts, _ = ensureAccount(state.accounts, chain.ProtocolResourceTreasury)
		if err := a.chargeAuthorizedResourceAction(&state, tx); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		// Apply net settlement deltas so a renter/provider alias is valid and
		// a shared fee/provider recipient cannot overflow after fee collection.
		deltas := map[string]int64{tx.Signer: -quote.PriceYNXT}
		deltas[input.Provider] += providerIncome
		deltas[chain.ProtocolResourceTreasury] += protocolFee
		for address, delta := range deltas {
			i, _ := accountIndex(state.accounts, address)
			balance := state.accounts[i].Balance
			if delta < 0 && balance < -delta || delta > 0 && balance > math.MaxInt64-delta {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource rental net settlement overflows"))
			}
		}
		for address, delta := range deltas {
			i, _ := accountIndex(state.accounts, address)
			state.accounts[i].Balance += delta
		}
		signerIndex, _ = accountIndex(state.accounts, tx.Signer)
		if err := reduceUnreservedResourceUsage(&state.accounts[signerIndex].ResourceUsage, input, state.resourcePools, tx.Signer); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}

	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported Resource application action"))
	}

	effects, err := buildAuthorizedResourceRecords(tx, policy, height, blockTime, txHash)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if effects.delegation != nil {
		state.resourceDelegations = insertResourceRecord(state.resourceDelegations, *effects.delegation, func(v BFTResourceDelegation) string { return v.ID })
	}
	if effects.rental != nil {
		state.resourceRentals = insertResourceRecord(state.resourceRentals, *effects.rental, func(v BFTResourceRental) string { return v.ID })
		state.resourceQuotes = insertResourceRecord(state.resourceQuotes, *effects.quote, func(v BFTResourceQuote) string { return v.ID })
	}
	for _, income := range effects.income {
		state.resourceIncome = insertResourceRecord(state.resourceIncome, income, func(v BFTResourceIncome) string { return v.ID })
	}
	state.resourceEvents = append(state.resourceEvents, effects.event)
	state.resourceIdempotency = insertResourceRecord(state.resourceIdempotency, effects.idempotency, func(v BFTResourceIdempotency) string { return v.ID })
	provider, objectID := effects.event.Provider, effects.event.ObjectID

	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.resource_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "provider", Value: provider, Index: true}, {Key: "object_id", Value: objectID, Index: true}}}}, nil
}

func authorizedResourceIdentity(tx authorizedResourceAction) (key, requestHash string, err error) {
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

func appendAuthorizedResourceIncome(values []BFTResourceIncome, tx authorizedResourceAction, rentalID, provider, source string, amount int64, policy chain.ResourceMarketPolicy, height int64, blockTime time.Time, txHash string) []BFTResourceIncome {
	id := ApplicationActionRecordID("resource-income-"+source, txHash)
	income := BFTResourceIncome{ResourceIncomeRecord: chain.ResourceIncomeRecord{PQTransactionHash: tx.NativeHash, ID: id, Provider: provider, RentalID: rentalID, Source: source, Amount: amount, Currency: "YNXT", PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, CreatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
	income.AuditHash = resourceIncomeAuditHash(income)
	return insertResourceRecord(values, income, func(v BFTResourceIncome) string { return v.ID })
}

type authorizedResourceRecords struct {
	delegation  *BFTResourceDelegation
	rental      *BFTResourceRental
	quote       *BFTResourceQuote
	income      []BFTResourceIncome
	event       BFTResourceEvent
	idempotency BFTResourceIdempotency
}

// One deterministic record assembler is used by real execution and restore.
// It does not invent historical balances or execute against a fabricated ledger.
func buildAuthorizedResourceRecords(tx authorizedResourceAction, policy chain.ResourceMarketPolicy, height int64, blockTime time.Time, txHash string) (authorizedResourceRecords, error) {
	var out authorizedResourceRecords
	key, requestHash, err := authorizedResourceIdentity(tx)
	if err != nil {
		return out, err
	}
	idempotencyKey, idempotencyID := key, ResourceIdempotencyID(tx.Signer, key)
	objectID, objectType, provider, beneficiary := "", "", "", ""
	var amount int64
	switch tx.Action {
	case ActionResourceDelegate:
		var input ResourceDelegationPayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil {
			return out, err
		}
		objectID, objectType, provider, beneficiary, amount = ApplicationActionRecordID("resource-delegation", txHash), "delegation", input.Provider, input.Beneficiary, input.AmountYNXT
		delegation := BFTResourceDelegation{ResourceDelegation: chain.ResourceDelegation{
			PQTransactionHash: tx.NativeHash, ID: objectID, Provider: input.Provider, Beneficiary: input.Beneficiary, AmountYNXT: input.AmountYNXT,
			Bandwidth: input.AmountYNXT / policy.BandwidthStakeDivisor, Compute: input.AmountYNXT / policy.ComputeStakeDivisor,
			AICredits: input.AmountYNXT / policy.AICreditStakeDivisor, TrustCredits: input.AmountYNXT / policy.TrustStakeDivisor,
			PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, Status: "active", CreatedAt: blockTime,
		}, Signer: tx.Signer, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		delegation.AuditHash = resourceDelegationAuditHash(delegation)
		out.delegation = &delegation

	case ActionResourceRent:
		var input ResourceRentalPayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil {
			return out, err
		}
		quote, err := chain.ResourceQuoteForPolicy(policy, input.Address, input.Bandwidth, input.Compute, input.AICredits, input.TrustCredits, input.QuoteExpiresAt)
		if err != nil || quote.ID != input.QuoteID || quote.PriceYNXT > input.MaxPriceYNXT {
			return out, errors.New("Resource quote differs from original signed intent")
		}
		providerIncome := int64(0)
		if input.Provider != chain.ProtocolResourceProvider {
			providerIncome = resourceBasisPoints(quote.PriceYNXT, policy.ProviderShareBps)
		}
		protocolFee := quote.PriceYNXT - providerIncome
		quoteRecord := BFTResourceQuote{ResourceQuote: quote, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		quoteRecord.AuditHash = resourceQuoteAuditHash(quoteRecord)
		out.quote = &quoteRecord
		objectID, objectType, provider, amount = ApplicationActionRecordID("resource-rental", txHash), "rental", input.Provider, quote.PriceYNXT
		rental := BFTResourceRental{ResourceRental: chain.ResourceRental{
			PQTransactionHash: tx.NativeHash, ID: objectID, QuoteID: quote.ID, Address: input.Address, Provider: input.Provider, PriceYNXT: quote.PriceYNXT,
			ProviderIncomeYNXT: providerIncome, ProtocolFeeYNXT: protocolFee, PolicyID: policy.ID, PolicyVersion: policy.Version,
			PolicyHash: policy.PolicyHash, GovernanceStatus: policy.GovernanceStatus, Status: "active", CreatedAt: blockTime,
			Bandwidth: input.Bandwidth, Compute: input.Compute, AICredits: input.AICredits, TrustCredits: input.TrustCredits,
		}, Signer: tx.Signer, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: height, TxHash: txHash}
		rental.AuditHash = resourceRentalAuditHash(rental)
		out.rental = &rental
		if providerIncome > 0 {
			out.income = appendAuthorizedResourceIncome(out.income, tx, objectID, input.Provider, "resource-rental", providerIncome, policy, height, blockTime, txHash)
		}
		if protocolFee > 0 {
			out.income = appendAuthorizedResourceIncome(out.income, tx, objectID, chain.ProtocolResourceTreasury, "resource-protocol-fee", protocolFee, policy, height, blockTime, txHash)
		}
	default:
		return out, errors.New("unsupported resource records")
	}
	event := BFTResourceEvent{ID: ApplicationActionRecordID("resource-event", txHash), Type: tx.Action, ObjectID: objectID, Signer: tx.Signer, Provider: provider, Beneficiary: beneficiary, AmountYNXT: amount, IdempotencyKey: idempotencyKey, BlockHeight: height, TxHash: txHash, CreatedAt: blockTime}
	event.AuditHash = resourceEventAuditHash(event)
	out.event = event
	idempotency := BFTResourceIdempotency{ID: idempotencyID, Signer: tx.Signer, IdempotencyKey: idempotencyKey, Action: tx.Action, RequestHash: requestHash, ObjectType: objectType, ObjectID: objectID, TxHash: txHash}
	out.idempotency = idempotency
	return out, nil
}

const pqResourceHistoryMemo = "ynx-abci-pq-resource-v1:"

func (a *Application) chargeAuthorizedResourceAction(state *executionState, tx authorizedResourceAction) error {
	i, ok := accountIndex(state.accounts, tx.Signer)
	if !ok || state.accounts[i].Balance < tx.Fee {
		return invalidTransaction(CodeInsufficientYNXT, errors.New("Resource signer cannot pay its actual fee"))
	}
	signer := state.accounts[i]
	if signer.Nonce == math.MaxUint64 || tx.Nonce != signer.Nonce+1 {
		return invalidTransaction(CodeInvalidNonce, errors.New("Resource action requires exact next owner nonce"))
	}
	if tx.Fee < 0 || tx.BandwidthUnits < 0 || signer.ResourceUsage.BandwidthUsed < 0 || signer.ResourceUsage.BandwidthUsed > math.MaxInt64-tx.BandwidthUnits {
		return invalidTransaction(CodeInvalidTx, errors.New("Resource action billing overflows"))
	}
	if tx.Fee > 0 {
		state.accounts, _ = ensureAccount(state.accounts, a.feeRecipient)
		i, _ = accountIndex(state.accounts, tx.Signer)
		j, _ := accountIndex(state.accounts, a.feeRecipient)
		if i != j && state.accounts[j].Balance > math.MaxInt64-tx.Fee {
			return invalidTransaction(CodeInvalidTx, errors.New("Resource fee recipient balance overflows"))
		}
		state.accounts[i].Balance -= tx.Fee
		state.accounts[j].Balance += tx.Fee
	}
	state.accounts[i].Nonce = tx.Nonce
	state.accounts[i].ResourceUsage.BandwidthUsed += tx.BandwidthUnits
	return nil
}

func pqAuthorizedResourceAction(action ynxauth.Action, nativeHash string) (authorizedResourceAction, error) {
	tx := authorizedResourceAction{Type: PQActionType, Signer: action.Owner, Action: action.Kind, Nonce: action.Nonce, NativeHash: nativeHash}
	if action.Fee != 0 {
		return tx, errors.New("native PQ resource actions require fee zero")
	}
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return tx, err
	}
	var payload any
	switch p := value.(type) {
	case ynxauth.ResourceDelegationPayload:
		payload = ResourceDelegationPayload{Provider: p.Provider, Beneficiary: p.Beneficiary, AmountYNXT: int64(p.AmountYNXT), PolicyHash: p.PolicyHash, IdempotencyKey: p.IdempotencyKey, RequestHash: p.RequestHash}
		if p.Provider != action.Owner {
			return tx, errors.New("Resource delegation owner mismatch")
		}
	case ynxauth.ResourceRentalPayload:
		expiry, err := time.Parse(time.RFC3339Nano, p.QuoteExpiresAt)
		if err != nil {
			return tx, err
		}
		payload = ResourceRentalPayload{Address: p.Address, Provider: p.Provider, Bandwidth: int64(p.Bandwidth), Compute: int64(p.Compute), AICredits: int64(p.AICredits), TrustCredits: int64(p.TrustCredits), QuoteID: p.QuoteID, QuoteExpiresAt: expiry.UTC(), PolicyHash: p.PolicyHash, MaxPriceYNXT: int64(p.MaxPriceYNXT), IdempotencyKey: p.IdempotencyKey, RequestHash: p.RequestHash}
		if p.Address != action.Owner {
			return tx, errors.New("Resource rental owner mismatch")
		}
	default:
		return tx, errors.New("unsupported typed Resource action")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return tx, err
	}
	tx.Payload, err = canonicalResourceActionPayload(tx.Action, raw)
	if err != nil || !bytes.Equal(raw, tx.Payload) {
		return tx, errors.New("typed Resource payload differs from canonical business request")
	}
	return tx, nil
}

func resourceHistoryTransaction(action ynxauth.Action, records authorizedResourceRecords, raw []byte, height uint64, at time.Time) chain.Transaction {
	kind, to := "resource_delegate", records.event.Beneficiary
	if records.rental != nil {
		kind, to = "resource_rent", records.event.Provider
	}
	return chain.Transaction{Hash: recordsNativeHash(records), Type: kind, From: action.Owner, To: to, Amount: records.event.AmountYNXT, Nonce: action.Nonce, BlockNum: height, Timestamp: at, Memo: pqResourceHistoryMemo + hex.EncodeToString(raw)}
}
func recordsNativeHash(records authorizedResourceRecords) string {
	if records.delegation != nil {
		return records.delegation.PQTransactionHash
	}
	return records.rental.PQTransactionHash
}

func (a *Application) applyPQResourceAction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return fail(err)
	}
	if height <= 0 || state.accountPolicy == nil || action.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(action.ChainID, state.accountPolicy.NetworkID) {
		return fail(errors.New("PQ Resource action requires actual network, policy and height"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err = a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); err != nil {
		return fail(err)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(raw)
	for _, prior := range state.pqHistory {
		if prior.Transaction.Hash == nativeHash || prior.ABCITransactionHash == abciHash {
			return fail(errors.New("original PQ Resource authorization already executed"))
		}
	}
	tx, err := pqAuthorizedResourceAction(action, nativeHash)
	if err != nil {
		return fail(err)
	}
	validationOnly := at.IsZero()
	if validationOnly {
		at = time.Unix(height, 0)
	}
	at = at.UTC()
	next, execution, err := a.applyAuthorizedResourceAction(state, raw, tx, height, at, validationOnly)
	if err != nil {
		return executionState{}, transactionExecution{}, err
	}
	records, err := buildAuthorizedResourceRecords(tx, a.migration.ResourcePolicy, height, at, abciHash)
	if err != nil {
		return fail(err)
	}
	history := resourceHistoryTransaction(action, records, raw, uint64(height), at)
	next.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: history})
	execution.hash = abciHash
	return next, execution, nil
}

func isPQResourceHistory(tx chain.Transaction) bool {
	return strings.HasPrefix(tx.Memo, pqResourceHistoryMemo)
}

func decodePQResourceHistory(entry PQCommittedAuthorization, policy chain.ResourceMarketPolicy) ([]byte, ynxauth.Action, authorizedResourceRecords, error) {
	var action ynxauth.Action
	var records authorizedResourceRecords
	tx := entry.Transaction
	if !isPQResourceHistory(tx) || len(tx.Memo) > 4*chain.MaxPQActionMemberBytes+1024 {
		return nil, action, records, errors.New("missing or oversized PQ Resource history")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqResourceHistoryMemo))
	if err != nil || tx.Memo != pqResourceHistoryMemo+hex.EncodeToString(raw) {
		return nil, action, records, errors.New("noncanonical PQ Resource history")
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return nil, action, records, err
	}
	auth, err := pqAuthorizedResourceAction(action, SignedTransactionHash(wire))
	if err != nil {
		return nil, action, records, err
	}
	if err := policy.Validate(); err != nil {
		return nil, action, records, err
	}
	if tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || tx.BlockNum > math.MaxInt64 || entry.ABCITransactionHash != SignedTransactionHash(raw) {
		return nil, action, records, errors.New("PQ Resource inclusion or original transport mismatch")
	}
	var policyHash string
	if action.Kind == ynxauth.ActionResourceDelegate {
		var input ResourceDelegationPayload
		_ = json.Unmarshal(auth.Payload, &input)
		policyHash = input.PolicyHash
	} else {
		var input ResourceRentalPayload
		_ = json.Unmarshal(auth.Payload, &input)
		policyHash = input.PolicyHash
		if policy.QuoteTTLSeconds > math.MaxInt64/int64(time.Second) || !input.QuoteExpiresAt.After(tx.Timestamp) || input.QuoteExpiresAt.After(tx.Timestamp.Add(time.Duration(policy.QuoteTTLSeconds)*time.Second)) {
			return nil, action, records, errors.New("PQ Resource quote was not valid at actual execution time")
		}
	}
	if policyHash != policy.PolicyHash {
		return nil, action, records, errors.New("PQ Resource history used an untrusted policy")
	}
	records, err = buildAuthorizedResourceRecords(auth, policy, int64(tx.BlockNum), tx.Timestamp, entry.ABCITransactionHash)
	if err != nil {
		return nil, action, records, err
	}
	if !reflect.DeepEqual(tx, resourceHistoryTransaction(action, records, raw, tx.BlockNum, tx.Timestamp)) {
		return nil, action, records, errors.New("PQ Resource history differs from exact signed execution fields")
	}
	return wire, action, records, nil
}

// The original Member and immutable business records are bound in both
// directions. Legacy records retain their old representation; without their
// original wire this is not an independent replay of all classic balances.
func validateConsensusPQResources(s CommittedState, m chain.ConsensusMigrationState) error {
	cache := chain.NewPQCertificateCache()
	records := map[string]authorizedResourceRecords{}
	order := map[string]int{}
	lastNonce := map[string]uint64{}
	tracked := map[string]bool{}
	for n, entry := range s.PQHistory {
		if !isPQResourceHistory(entry.Transaction) {
			continue
		}
		wire, action, effect, err := decodePQResourceHistory(entry, m.ResourcePolicy)
		if err != nil {
			return err
		}
		if s.AccountPolicy == nil || action.NativeChainID != uint64(s.ChainID) || !bytes.Equal(action.ChainID, s.AccountPolicy.NetworkID) || entry.Transaction.BlockNum <= m.Height || entry.Transaction.BlockNum > uint64(s.Height) {
			return errors.New("PQ Resource history network or height mismatch")
		}
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			return err
		}
		if err = cache.VerifyDecodedMember(s.AccountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, entry.Transaction.BlockNum); err != nil {
			return err
		}
		if _, exists := records[entry.ABCITransactionHash]; exists {
			return errors.New("duplicate PQ Resource proof")
		}
		records[entry.ABCITransactionHash], order[entry.ABCITransactionHash] = effect, n
		tracked[action.Owner] = true
	}
	for owner := range tracked {
		if i, ok := accountIndex(m.Accounts, owner); ok {
			lastNonce[owner] = m.Accounts[i].Nonce
		}
	}
	activeSequence := map[string]bool{}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if !tracked[tx.From] {
			continue
		}
		if tx.Nonce <= lastNonce[tx.From] || activeSequence[tx.From] && (lastNonce[tx.From] == math.MaxUint64 || tx.Nonce != lastNonce[tx.From]+1) {
			return errors.New("PQ Resource owner nonce repeated, regressed or skipped after activation")
		}
		lastNonce[tx.From] = tx.Nonce
		if isPQResourceHistory(tx) {
			activeSequence[tx.From] = true
		}
	}
	for owner, nonce := range lastNonce {
		i, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[i].Nonce != nonce {
			return errors.New("PQ Resource final nonce differs from complete active authorization history")
		}
	}
	// ResourceEvents preserve original execution order, including same-height
	// classic/PQ interleaving. A later delegation cannot authorize an earlier rent.
	providers := map[string]bool{}
	seen := map[string]bool{}
	lastOrder, lastHeight := -1, int64(m.Height)
	for _, event := range s.ResourceEvents {
		if event.BlockHeight < lastHeight || event.BlockHeight > s.Height {
			return errors.New("Resource events changed actual chronological order")
		}
		lastHeight = event.BlockHeight
		if effect, pq := records[event.TxHash]; pq {
			if seen[event.TxHash] || order[event.TxHash] <= lastOrder || !reflect.DeepEqual(event, effect.event) {
				return errors.New("PQ Resource event differs from proof or original order")
			}
			lastOrder, seen[event.TxHash] = order[event.TxHash], true
			if effect.rental != nil && event.Provider != chain.ProtocolResourceProvider && !providers[event.Provider] && !hasLegacyActiveResourceDelegation(s.LegacyResourceMarket, event.Provider) {
				return errors.New("PQ Resource provider was not active at rental execution")
			}
		} else if err := requireConsensusLegacy(s.AccountPolicy, event.Signer, event.BlockHeight); err != nil {
			return err
		}
		if event.Type == ActionResourceDelegate {
			_, d, ok := findResourceRecord(s.ResourceDelegations, event.ObjectID, func(v BFTResourceDelegation) string { return v.ID })
			if ok && d.Provider == event.Provider && d.TxHash == event.TxHash && d.Status == "active" && d.AmountYNXT > 0 {
				providers[event.Provider] = true
			}
		}
	}
	for hash, effect := range records {
		if !seen[hash] {
			return errors.New("PQ Resource proof lacks its ordered event")
		}
		_, idem, ok := findResourceRecord(s.ResourceIdempotency, effect.idempotency.ID, func(v BFTResourceIdempotency) string { return v.ID })
		if !ok || !reflect.DeepEqual(idem, effect.idempotency) {
			return errors.New("PQ Resource idempotency differs from original request")
		}
		if effect.delegation != nil {
			_, value, ok := findResourceRecord(s.ResourceDelegations, effect.delegation.ID, func(v BFTResourceDelegation) string { return v.ID })
			if !ok || !reflect.DeepEqual(value, *effect.delegation) {
				return errors.New("PQ Resource delegation differs from original request")
			}
		} else {
			_, value, ok := findResourceRecord(s.ResourceRentals, effect.rental.ID, func(v BFTResourceRental) string { return v.ID })
			if !ok || !reflect.DeepEqual(value, *effect.rental) {
				return errors.New("PQ Resource rental differs from original request")
			}
			_, quote, ok := findResourceRecord(s.ResourceQuotes, effect.quote.ID, func(v BFTResourceQuote) string { return v.ID })
			if !ok || !reflect.DeepEqual(quote, *effect.quote) {
				return errors.New("PQ Resource quote differs from original request")
			}
			for _, expected := range effect.income {
				_, value, ok := findResourceRecord(s.ResourceIncome, expected.ID, func(v BFTResourceIncome) string { return v.ID })
				if !ok || !reflect.DeepEqual(value, expected) {
					return errors.New("PQ Resource settlement differs from original request")
				}
			}
		}
	}
	for _, d := range s.ResourceDelegations {
		effect, ok := records[d.TxHash]
		if (d.PQTransactionHash != "" || ok) && (!ok || effect.delegation == nil || !reflect.DeepEqual(d, *effect.delegation)) {
			return errors.New("PQ Resource delegation marker lacks original proof")
		}
	}
	for _, r := range s.ResourceRentals {
		effect, ok := records[r.TxHash]
		if (r.PQTransactionHash != "" || ok) && (!ok || effect.rental == nil || !reflect.DeepEqual(r, *effect.rental)) {
			return errors.New("PQ Resource rental marker lacks original proof")
		}
	}
	for _, income := range s.ResourceIncome {
		effect, ok := records[income.TxHash]
		if income.PQTransactionHash != "" || ok {
			matched := false
			for _, expected := range effect.income {
				matched = matched || reflect.DeepEqual(income, expected)
			}
			if !ok || !matched {
				return errors.New("PQ Resource income lacks its exact proof")
			}
		}
	}
	for _, fee := range s.FeeEvents {
		if _, ok := records[fee.TxHash]; ok {
			return errors.New("fee-zero PQ Resource action acquired an unexecuted fee event")
		}
	}
	return nil
}

// Run only after all original-proof and exact resource-record validators. This
// lower bound folds actual PQ execution order. A rental can release prior usage
// but cannot erase a later stake or contract call, including in the same block.
// Unrecorded classic usage increases are not invented as historical evidence.
func validatePQOrderedResourceUsage(s CommittedState, m chain.ConsensusMigrationState) error {
	first := map[string]uint64{}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if isPQContractHistory(tx) || isPQNativeActionHistory(tx) || isPQResourceHistory(tx) || isPQDexHistory(tx) || isPQEthereumValueHistory(tx) {
			if first[tx.From] == 0 {
				first[tx.From] = tx.BlockNum
			}
		}
	}
	usage := map[string][2]int64{}
	for owner, height := range first {
		bw, compute, err := pqContractRemainingSourceUsage(s, m, owner, height)
		if err != nil {
			return err
		}
		usage[owner] = [2]int64{bw, compute}
	}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		u, tracked := usage[tx.From]
		if !tracked {
			continue
		}
		bw, compute := int64(0), int64(0)
		switch {
		case isPQContractHistory(tx):
			bw, compute = 1, 1
			if tx.Type == "contract_deploy" {
				compute = 5
			}
		case isPQDexHistory(tx), isPQEthereumValueHistory(tx):
			bw = 1
		case isPQNativeActionHistory(tx):
			compute = 1
		case isPQResourceHistory(tx):
			_, _, effects, err := decodePQResourceHistory(entry, m.ResourcePolicy)
			if err != nil {
				return err
			}
			if effects.rental != nil {
				// Later sponsorship consumption can only lower the surviving
				// reservation. Using that current floor is conservative and
				// never fabricates a higher historical reservation.
				var reserved chain.ResourceUnits
				for _, pool := range s.ResourcePools {
					if pool.Owner != tx.From || pool.Status == "revoked" {
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
				floor := chain.ResourceUsage{BandwidthUsed: u[0], ComputeUsed: u[1], AICreditsUsed: reserved.AICredits, TrustUsed: reserved.TrustCredits}
				if floor.BandwidthUsed < reserved.Bandwidth {
					floor.BandwidthUsed = reserved.Bandwidth
				}
				if floor.ComputeUsed < reserved.Compute {
					floor.ComputeUsed = reserved.Compute
				}
				rental := effects.rental
				if err := reduceUnreservedResourceUsage(&floor, ResourceRentalPayload{Bandwidth: rental.Bandwidth, Compute: rental.Compute, AICredits: rental.AICredits, TrustCredits: rental.TrustCredits}, s.ResourcePools, tx.From); err != nil {
					return err
				}
				u[0], u[1] = floor.BandwidthUsed, floor.ComputeUsed
			}
		}
		if u[0] > math.MaxInt64-bw || u[1] > math.MaxInt64-compute {
			return errors.New("PQ resource history usage overflows")
		}
		u[0] += bw
		u[1] += compute
		usage[tx.From] = u
	}
	for owner, minimum := range usage {
		i, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[i].ResourceUsage.BandwidthUsed < minimum[0] || s.Accounts[i].ResourceUsage.ComputeUsed < minimum[1] {
			return errors.New("PQ ordered resource effects were removed from final account")
		}
	}
	return nil
}
