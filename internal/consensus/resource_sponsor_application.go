package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func (a *Application) applyResourceSponsorAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	idempotencyKey, err := resourceSponsorActionIdempotencyKey(tx)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	idempotencyID := ResourceSponsorIdempotencyID(tx.Signer, idempotencyKey)
	if i := sort.Search(len(state.resourceSponsorIdempotency), func(i int) bool { return state.resourceSponsorIdempotency[i].ID >= idempotencyID }); i < len(state.resourceSponsorIdempotency) && state.resourceSponsorIdempotency[i].ID == idempotencyID {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource sponsor idempotency key is already committed"))
	}
	if tx.Fee != 0 || tx.AIUnits != 0 || tx.PayUnits != 0 || tx.TrustUnits != 0 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource sponsor actions must not move YNXT or charge typed user resources"))
	}
	txHash, objectID, objectType, poolID := ApplicationActionHash(raw), "", "", ""
	var poolSnapshot *BFTResourcePool
	var sponsorshipSnapshot *BFTResourceSponsorship

	switch tx.Action {
	case ActionResourcePoolCreate:
		var input ResourcePoolCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if !validationOnly && !input.ExpiresAt.After(blockTime) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool expiry must follow committed block time"))
		}
		ownerIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("Resource pool owner account does not exist"))
		}
		if err := requireBFTSponsorNonce(state.accounts[ownerIndex], tx.Nonce); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		if err := canReserveBFTResourceUnits(bftResourceBalance(state.accounts[ownerIndex], a.migration.ResourcePolicy), input.CumulativeAllowance); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		objectID, objectType = "rsp_"+ApplicationActionRecordID("resource-pool", txHash), "pool"
		if _, exists := bftResourcePoolIndex(state.resourcePools, objectID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool already exists"))
		}
		pool := BFTResourcePool{ResourcePool: chain.ResourcePool{ID: objectID, PoolType: input.PoolType, Name: input.Name, Owner: tx.Signer, Public: input.Public, AllowedBeneficiaries: input.AllowedBeneficiaries, AllowedScopes: input.AllowedScopes, AllowedResourceTypes: input.AllowedResourceTypes, PerActionLimit: input.PerActionLimit, CumulativeAllowance: input.CumulativeAllowance, ExpiresAt: input.ExpiresAt, Status: "active", CreatedAt: blockTime, UpdatedAt: blockTime}, LastAction: tx.Action, LastSigner: tx.Signer, BlockHeight: height, TxHash: txHash}
		pool.PolicyHash = chain.ResourcePoolPolicyHash(pool.ResourcePool)
		pool.AuditHash = resourcePoolAuditHash(pool)
		if err := addBFTResourceUsage(&state.accounts[ownerIndex].ResourceUsage, input.CumulativeAllowance); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		state.accounts[ownerIndex].Nonce++
		state.resourcePools = insertBFTResourcePool(state.resourcePools, pool)
		poolID = pool.ID
		poolSnapshot = &pool

	case ActionResourcePoolFund:
		var input ResourcePoolFundPayload
		_ = json.Unmarshal(tx.Payload, &input)
		poolIndex, ok := bftResourcePoolIndex(state.resourcePools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool not found"))
		}
		pool := state.resourcePools[poolIndex]
		if pool.Owner != tx.Signer || pool.Status == "revoked" || pool.PolicyHash != input.ExpectedPolicyHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool funding owner, status, or policy hash mismatch"))
		}
		if !resourceFundingTypesAllowed(input.Additional, pool.AllowedResourceTypes) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool funding contains a disallowed resource type"))
		}
		ownerIndex, _ := accountIndex(state.accounts, tx.Signer)
		if err := requireBFTSponsorNonce(state.accounts[ownerIndex], tx.Nonce); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		if err := canReserveBFTResourceUnits(bftResourceBalance(state.accounts[ownerIndex], a.migration.ResourcePolicy), input.Additional); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		next, err := addBFTResourceUnits(pool.CumulativeAllowance, input.Additional)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if err := addBFTResourceUsage(&state.accounts[ownerIndex].ResourceUsage, input.Additional); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		pool.CumulativeAllowance, pool.UpdatedAt, pool.LastAction, pool.LastSigner, pool.BlockHeight, pool.TxHash = next, blockTime, tx.Action, tx.Signer, height, txHash
		pool.PolicyHash = chain.ResourcePoolPolicyHash(pool.ResourcePool)
		pool.AuditHash = resourcePoolAuditHash(pool)
		state.accounts[ownerIndex].Nonce++
		state.resourcePools[poolIndex] = pool
		objectID, objectType, poolID, poolSnapshot = pool.ID, "pool", pool.ID, &pool

	case ActionResourcePoolPolicy:
		var input ResourcePoolPolicyPayload
		_ = json.Unmarshal(tx.Payload, &input)
		poolIndex, ok := bftResourcePoolIndex(state.resourcePools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool not found"))
		}
		pool := state.resourcePools[poolIndex]
		if pool.Owner != tx.Signer || pool.Status == "revoked" || pool.PolicyHash != input.ExpectedPolicyHash || !resourceUnitsWithin(input.PerActionLimit, pool.CumulativeAllowance) || !consumedResourceTypesAllowed(pool.Consumed, input.AllowedResourceTypes) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool policy update is unauthorized, stale, or incompatible with committed allowance"))
		}
		if !validationOnly && !input.ExpiresAt.After(blockTime) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool policy expiry must follow committed block time"))
		}
		ownerIndex, _ := accountIndex(state.accounts, tx.Signer)
		if err := requireBFTSponsorNonce(state.accounts[ownerIndex], tx.Nonce); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		pool.Public, pool.AllowedBeneficiaries, pool.AllowedScopes, pool.AllowedResourceTypes, pool.PerActionLimit, pool.ExpiresAt = input.Public, input.AllowedBeneficiaries, input.AllowedScopes, input.AllowedResourceTypes, input.PerActionLimit, input.ExpiresAt
		pool.UpdatedAt, pool.LastAction, pool.LastSigner, pool.BlockHeight, pool.TxHash = blockTime, tx.Action, tx.Signer, height, txHash
		pool.PolicyHash = chain.ResourcePoolPolicyHash(pool.ResourcePool)
		pool.AuditHash = resourcePoolAuditHash(pool)
		state.accounts[ownerIndex].Nonce++
		state.resourcePools[poolIndex] = pool
		objectID, objectType, poolID, poolSnapshot = pool.ID, "pool", pool.ID, &pool

	case ActionResourcePoolStatus:
		var input ResourcePoolStatusPayload
		_ = json.Unmarshal(tx.Payload, &input)
		poolIndex, ok := bftResourcePoolIndex(state.resourcePools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool not found"))
		}
		pool := state.resourcePools[poolIndex]
		if pool.Owner != tx.Signer || pool.Status == "revoked" || pool.Status == input.Status || pool.PolicyHash != input.ExpectedPolicyHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource pool status transition is unauthorized, stale, revoked, or unchanged"))
		}
		if !validationOnly && input.Status == "active" && !pool.ExpiresAt.After(blockTime) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("expired Resource pool cannot be resumed"))
		}
		ownerIndex, _ := accountIndex(state.accounts, tx.Signer)
		if err := requireBFTSponsorNonce(state.accounts[ownerIndex], tx.Nonce); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		if input.Status == "revoked" {
			remaining, err := subtractBFTResourceUnits(pool.CumulativeAllowance, pool.Consumed)
			if err != nil {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
			}
			if err := subtractBFTResourceUsage(&state.accounts[ownerIndex].ResourceUsage, remaining); err != nil {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
			}
		}
		pool.Status, pool.UpdatedAt, pool.LastAction, pool.LastSigner, pool.BlockHeight, pool.TxHash = input.Status, blockTime, tx.Action, tx.Signer, height, txHash
		pool.AuditHash = resourcePoolAuditHash(pool)
		state.accounts[ownerIndex].Nonce++
		state.resourcePools[poolIndex] = pool
		objectID, objectType, poolID, poolSnapshot = pool.ID, "pool", pool.ID, &pool

	case ActionResourceSponsor:
		var input ResourceSponsorshipPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if input.Beneficiary != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource sponsorship beneficiary must sign its own action"))
		}
		beneficiaryIndex, ok := accountIndex(state.accounts, tx.Signer)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("Resource sponsorship beneficiary account does not exist"))
		}
		if err := requireBFTSponsorNonce(state.accounts[beneficiaryIndex], tx.Nonce); err != nil {
			return executionState{}, transactionExecution{}, err
		}
		refID := ResourceSponsorActionRefID(input.ActionReference)
		if i := sort.Search(len(state.resourceSponsorActionRefs), func(i int) bool { return state.resourceSponsorActionRefs[i].ID >= refID }); i < len(state.resourceSponsorActionRefs) && state.resourceSponsorActionRefs[i].ID == refID {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource sponsorship action reference is already consumed"))
		}
		poolIndex, pool, err := selectBFTResourcePool(state.resourcePools, input, blockTime, validationOnly)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		pool.Consumed, err = consumeBFTResourceUnit(pool.Consumed, input.ResourceType, input.Amount)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		pool.UpdatedAt, pool.LastAction, pool.LastSigner, pool.BlockHeight, pool.TxHash = blockTime, tx.Action, tx.Signer, height, txHash
		pool.AuditHash = resourcePoolAuditHash(pool)
		state.resourcePools[poolIndex] = pool
		state.accounts[beneficiaryIndex].Nonce++
		objectID, objectType, poolID = "rss_"+ApplicationActionRecordID("resource-sponsorship", txHash), "sponsorship", pool.ID
		value := BFTResourceSponsorship{ResourceSponsorship: chain.ResourceSponsorship{ID: objectID, PoolID: pool.ID, PoolType: pool.PoolType, Payer: tx.Signer, Sponsor: pool.Owner, Beneficiary: tx.Signer, Scope: input.Scope, ResourceType: input.ResourceType, ResourceSource: pool.PoolType + "-resource-pool", Amount: input.Amount, PolicyHash: pool.PolicyHash, ActionReference: input.ActionReference, IdempotencyKey: input.IdempotencyKey, TransactionHash: txHash, CreatedAt: blockTime}, Signer: tx.Signer, BlockHeight: height, TxHash: txHash}
		value.AuditHash = resourceSponsorshipAuditHash(value)
		state.resourceSponsorships = insertResourceRecord(state.resourceSponsorships, value, func(v BFTResourceSponsorship) string { return v.ID })
		sponsorshipSnapshot = &value
		ref := BFTResourceSponsorActionRef{ID: refID, ActionRef: input.ActionReference, SponsorshipID: value.ID, TxHash: txHash}
		state.resourceSponsorActionRefs = insertResourceRecord(state.resourceSponsorActionRefs, ref, func(v BFTResourceSponsorActionRef) string { return v.ID })
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported Resource sponsor action"))
	}

	idem := BFTResourceSponsorIdempotency{ID: idempotencyID, Signer: tx.Signer, IdempotencyKey: idempotencyKey, Action: tx.Action, RequestHash: tx.PayloadHash, ObjectType: objectType, ObjectID: objectID, TxHash: txHash, PoolSnapshot: poolSnapshot, SponsorshipSnapshot: sponsorshipSnapshot}
	state.resourceSponsorIdempotency = insertResourceRecord(state.resourceSponsorIdempotency, idem, func(v BFTResourceSponsorIdempotency) string { return v.ID })
	previousHash := ""
	if len(state.resourceSponsorAudit) > 0 {
		previousHash = state.resourceSponsorAudit[len(state.resourceSponsorAudit)-1].AuditHash
	}
	audit := BFTResourceSponsorAudit{ID: ApplicationActionRecordID("resource-sponsor-audit", txHash), Sequence: uint64(len(state.resourceSponsorAudit) + 1), Action: tx.Action, Signer: tx.Signer, PoolID: poolID, ObjectID: objectID, RequestHash: tx.PayloadHash, PreviousHash: previousHash, BlockHeight: height, TxHash: txHash, CreatedAt: blockTime}
	audit.AuditHash = resourceSponsorAuditHash(audit)
	state.resourceSponsorAudit = append(state.resourceSponsorAudit, audit)
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.resource_sponsor_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "pool_id", Value: poolID, Index: true}, {Key: "object_id", Value: objectID, Index: true}}}}, nil
}

func resourceSponsorActionIdempotencyKey(tx SignedApplicationAction) (string, error) {
	switch tx.Action {
	case ActionResourcePoolCreate:
		var p ResourcePoolCreatePayload
		_ = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, nil
	case ActionResourcePoolFund:
		var p ResourcePoolFundPayload
		_ = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, nil
	case ActionResourcePoolPolicy:
		var p ResourcePoolPolicyPayload
		_ = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, nil
	case ActionResourcePoolStatus:
		var p ResourcePoolStatusPayload
		_ = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, nil
	case ActionResourceSponsor:
		var p ResourceSponsorshipPayload
		_ = json.Unmarshal(tx.Payload, &p)
		return p.IdempotencyKey, nil
	}
	return "", errors.New("unsupported Resource sponsor action")
}

func requireBFTSponsorNonce(account chain.ConsensusAccount, nonce uint64) error {
	if account.Nonce == math.MaxUint64 || nonce != account.Nonce+1 {
		return invalidTransaction(CodeInvalidNonce, fmt.Errorf("Resource sponsor nonce %d must equal next account nonce %d", nonce, account.Nonce+1))
	}
	return nil
}
func canReserveBFTResourceUnits(balance chain.ResourceBalance, units chain.ResourceUnits) error {
	if units.Bandwidth > balance.BandwidthLeft || units.Compute > balance.ComputeLeft || units.AICredits > balance.AICreditsLeft || units.TrustCredits > balance.TrustLeft {
		return errors.New("Resource pool owner has insufficient unreserved resources")
	}
	return nil
}

func selectBFTResourcePool(values []BFTResourcePool, input ResourceSponsorshipPayload, blockTime time.Time, validationOnly bool) (int, BFTResourcePool, error) {
	for i, pool := range values {
		if input.PoolID != "" && pool.ID != input.PoolID {
			continue
		}
		if pool.Status != "active" || !validationOnly && !pool.ExpiresAt.After(blockTime) || !pool.Public && !containsSortedString(pool.AllowedBeneficiaries, input.Beneficiary) || !containsSortedString(pool.AllowedScopes, input.Scope) || !containsSortedString(pool.AllowedResourceTypes, input.ResourceType) || input.Amount > resourceUnitAmount(pool.PerActionLimit, input.ResourceType) {
			continue
		}
		remaining, err := subtractBFTResourceUnits(pool.CumulativeAllowance, pool.Consumed)
		if err == nil && input.Amount <= resourceUnitAmount(remaining, input.ResourceType) {
			return i, pool, nil
		}
	}
	return 0, BFTResourcePool{}, errors.New("no eligible Resource sponsor pool has sufficient allowance")
}

func consumedResourceTypesAllowed(value chain.ResourceUnits, types []string) bool {
	for kind := range bftResourceTypes {
		if resourceUnitAmount(value, kind) > 0 && !containsSortedString(types, kind) {
			return false
		}
	}
	return true
}

func resourceFundingTypesAllowed(value chain.ResourceUnits, types []string) bool {
	for kind := range bftResourceTypes {
		if resourceUnitAmount(value, kind) > 0 && !containsSortedString(types, kind) {
			return false
		}
	}
	return true
}
