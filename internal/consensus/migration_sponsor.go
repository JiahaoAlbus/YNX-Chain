package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// LegacyResourceSponsor preserves the source authority and hash domains. It is
// immutable after import; live pools are in ResourcePools. Old idempotency,
// action references and audit entries participate in actual execution.
type LegacyResourceSponsor struct {
	SourceAnchor string                                      `json:"sourceAnchor"`
	Pools        map[string]chain.ResourcePool               `json:"pools"`
	Sponsors     map[string]chain.ResourceSponsorship        `json:"sponsors"`
	IDs          map[string]chain.ResourceSponsorIdempotency `json:"idempotency"`
	ActionRefs   map[string]string                           `json:"actionReferences"`
	Audit        []chain.ResourceSponsorAuditEvent           `json:"audit"`
}

func migrationResourceSponsor(m chain.ConsensusMigrationState) *LegacyResourceSponsor {
	r := m.Runtime
	if r == nil || len(r.Pools)+len(r.Sponsors)+len(r.SponsorIDs)+len(r.ActionRefs)+len(r.SponsorLog) == 0 {
		return nil
	}
	return cloneLegacyResourceSponsor(&LegacyResourceSponsor{SourceAnchor: m.StateHash, Pools: r.Pools, Sponsors: r.Sponsors, IDs: r.SponsorIDs, ActionRefs: r.ActionRefs, Audit: r.SponsorLog})
}

func cloneLegacyResourceSponsor(source *LegacyResourceSponsor) *LegacyResourceSponsor {
	if source == nil {
		return nil
	}
	// These concrete types contain only JSON primitives, time.Time, maps and
	// slices. A round trip also clones the historical PoolSnapshot pointers.
	raw, _ := json.Marshal(source)
	var out LegacyResourceSponsor
	_ = json.Unmarshal(raw, &out)
	return &out
}

func migrationResourcePools(m chain.ConsensusMigrationState) []BFTResourcePool {
	if m.Runtime == nil {
		return nil
	}
	values := make([]BFTResourcePool, 0, len(m.Runtime.Pools))
	for _, pool := range m.Runtime.Pools {
		values = append(values, BFTResourcePool{ResourcePool: pool, SourceAnchor: m.StateHash})
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
	return cloneBFTResourcePools(values)
}

func sourceSponsorAuditTail(source *LegacyResourceSponsor) (string, uint64) {
	if source == nil || len(source.Audit) == 0 {
		return "", 0
	}
	tail := source.Audit[len(source.Audit)-1]
	return tail.AuditHash, tail.Sequence
}

func validateLegacyResourceSponsor(s CommittedState, m chain.ConsensusMigrationState) error {
	expected := migrationResourceSponsor(m)
	if s.Version < 15 && (expected != nil || s.LegacyResourceSponsor != nil) {
		return errors.New("legacy committed version cannot contain source sponsor imports")
	}
	if !reflect.DeepEqual(s.LegacyResourceSponsor, expected) {
		return errors.New("source Resource sponsor segment differs from the complete migration checkpoint")
	}
	if err := validateSourceSponsorReplayCoverage(expected, m); err != nil {
		return err
	}
	originals := map[string]chain.ResourcePool{}
	if expected != nil {
		originals = expected.Pools
	}
	seen := make(map[string]bool, len(originals))
	for _, pool := range s.ResourcePools {
		original, imported := originals[pool.ID]
		if !imported {
			if pool.SourceAnchor != "" {
				return errors.New("non-imported Resource pool claims a source anchor")
			}
			continue
		}
		seen[pool.ID] = true
		if pool.SourceAnchor != m.StateHash || pool.Owner != original.Owner || pool.PoolType != original.PoolType || pool.Name != original.Name || !pool.CreatedAt.Equal(original.CreatedAt) || !resourceUnitsWithin(original.CumulativeAllowance, pool.CumulativeAllowance) || !resourceUnitsWithin(original.Consumed, pool.Consumed) || original.Status == "revoked" && pool.Status != "revoked" {
			return errors.New("imported Resource pool changed identity, provenance or historical accounting")
		}
		if pool.LastAction == "" {
			if !reflect.DeepEqual(pool.ResourcePool, original) || pool.LastSigner != "" || pool.BlockHeight != 0 || pool.TxHash != "" || pool.AuditHash != "" {
				return errors.New("untouched imported Resource pool is not the original source object")
			}
		} else if pool.BlockHeight <= int64(m.Height) || pool.BlockHeight > s.Height {
			return errors.New("imported Resource pool update must have a real post-migration height")
		}
		consumed := original.Consumed
		for _, value := range s.ResourceSponsorships {
			if value.PoolID == pool.ID {
				var err error
				consumed, err = consumeBFTResourceUnit(consumed, value.ResourceType, value.Amount)
				if err != nil {
					return err
				}
			}
		}
		if consumed != pool.Consumed {
			return errors.New("imported Resource pool consumption lacks exact source-plus-new sponsorship coverage")
		}
	}
	if len(seen) != len(originals) {
		return errors.New("imported Resource pool was omitted")
	}
	if expected == nil {
		return nil
	}
	for _, record := range s.ResourceSponsorIdempotency {
		if _, exists := sourceSponsorID(expected, record.Signer, record.IdempotencyKey); exists {
			return errors.New("new Resource idempotency record shadows a source request")
		}
	}
	for _, record := range s.ResourceSponsorships {
		if _, exists := expected.Sponsors[record.ID]; exists {
			return errors.New("new sponsorship shadows a source object")
		}
		if _, exists := expected.ActionRefs[record.ActionReference]; exists {
			return errors.New("new sponsorship reuses a source action reference")
		}
	}
	return nil
}

func sourceSponsorID(source *LegacyResourceSponsor, signer, key string) (chain.ResourceSponsorIdempotency, bool) {
	if source != nil {
		for _, record := range source.IDs {
			if record.Signer == signer && record.Key == key {
				return record, true
			}
		}
	}
	return chain.ResourceSponsorIdempotency{}, false
}

type SourceSponsorReplay struct {
	SourceAnchor string                           `json:"sourceAnchor"`
	Record       chain.ResourceSponsorIdempotency `json:"record"`
	Pool         *chain.ResourcePool              `json:"pool,omitempty"`
	Sponsorship  *chain.ResourceSponsorship       `json:"sponsorship,omitempty"`
	Transaction  chain.Transaction                `json:"transaction"`
}

// sourceSponsorReplay is evaluated only after the enclosing action's current
// signature and account policy are verified. Replay never executes the old
// transaction and never touches nonce, fee, resource usage or live pool state.
func (a *Application) sourceSponsorReplay(state executionState, tx SignedApplicationAction, key string) (transactionExecution, bool, error) {
	record, exists := sourceSponsorID(state.legacyResourceSponsor, tx.Signer, key)
	if !exists {
		return transactionExecution{}, false, nil
	}
	hash, err := chain.ConsensusSourceSponsorRequestHash(tx.Action, tx.Payload)
	if err != nil || record.Action != tx.Action || record.RequestHash != hash {
		return transactionExecution{}, true, invalidTransaction(CodeInvalidTx, errors.New("source Resource sponsor idempotency key was reused with changed input"))
	}
	result := SourceSponsorReplay{SourceAnchor: state.legacyResourceSponsor.SourceAnchor, Record: record}
	switch record.ObjectType {
	case "pool":
		if record.PoolSnapshot == nil || record.PoolSnapshot.ID != record.ObjectID {
			return transactionExecution{}, true, invalidTransaction(CodeInvalidTx, errors.New("source pool replay lacks its original object snapshot"))
		}
		pool := cloneBFTResourcePools([]BFTResourcePool{{ResourcePool: *record.PoolSnapshot}})[0].ResourcePool
		result.Pool = &pool
	case "sponsorship":
		value, ok := state.legacyResourceSponsor.Sponsors[record.ObjectID]
		if !ok || value.TransactionHash != record.TransactionHash {
			return transactionExecution{}, true, invalidTransaction(CodeInvalidTx, errors.New("source sponsorship replay object is inconsistent"))
		}
		result.Sponsorship = &value
	default:
		return transactionExecution{}, true, invalidTransaction(CodeInvalidTx, errors.New("unsupported source sponsor replay object"))
	}
	var ok bool
	result.Transaction, ok = sourceHistoryTransaction(a.migration, record.TransactionHash)
	if !ok {
		return transactionExecution{}, true, invalidTransaction(CodeInvalidTx, errors.New("source replay transaction is absent from the migration history"))
	}
	data, err := json.Marshal(result)
	if err != nil {
		return transactionExecution{}, true, err
	}
	return transactionExecution{typeName: tx.Type, resultData: data, event: abcitypes.Event{Type: "ynx.resource_sponsor_replay", Attributes: []abcitypes.EventAttribute{{Key: "source_anchor", Value: result.SourceAnchor}, {Key: "object_id", Value: record.ObjectID}, {Key: "original_transaction_hash", Value: record.TransactionHash}}}}, true, nil
}

// SponsorReplayResult is a native BFT replay result. It remains distinct from
// SourceSponsorReplay because the historical authority/hash domains differ.
type SponsorReplayResult struct {
	Record BFTResourceSponsorIdempotency `json:"record"`
}

func nativeSponsorReplay(tx SignedApplicationAction, record BFTResourceSponsorIdempotency) (transactionExecution, error) {
	if record.Action != tx.Action || record.Signer != tx.Signer || record.RequestHash != tx.PayloadHash {
		return transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("Resource sponsor idempotency key was reused with changed input"))
	}
	data, err := json.Marshal(SponsorReplayResult{Record: record})
	if err != nil {
		return transactionExecution{}, err
	}
	return transactionExecution{typeName: tx.Type, resultData: data, event: abcitypes.Event{Type: "ynx.resource_sponsor_replay", Attributes: []abcitypes.EventAttribute{{Key: "object_id", Value: record.ObjectID}, {Key: "original_transaction_hash", Value: record.TxHash}}}}, nil
}

func validateSourceSponsorReplayCoverage(source *LegacyResourceSponsor, m chain.ConsensusMigrationState) error {
	if source == nil {
		return nil
	}
	seen := map[string]bool{}
	poolCreates, sponsorRequests := map[string]int{}, map[string]int{}
	if len(source.IDs) != len(source.Audit) || len(source.Sponsors) != len(source.ActionRefs) {
		return errors.New("source sponsor idempotency, audit and action-reference counts do not reconcile")
	}
	for _, record := range source.IDs {
		key := ResourceSponsorIdempotencyID(record.Signer, record.Key)
		if seen[key] || !IsNativeAddress(record.Signer) || !validResourceIdempotencyKey(record.Key) || !isResourceSponsorAction(record.Action) || !payHashPattern.MatchString(record.RequestHash) {
			return errors.New("source sponsor request identity is ambiguous or invalid")
		}
		seen[key] = true
		tx, ok := sourceHistoryTransaction(m, record.TransactionHash)
		if !ok || tx.From != record.Signer {
			return fmt.Errorf("source sponsor request %s has no committed transaction", record.ID)
		}
		expectedType := map[string]string{ActionResourcePoolCreate: "resource_pool_create", ActionResourcePoolFund: "resource_pool_fund", ActionResourcePoolPolicy: "resource_pool_policy", ActionResourcePoolStatus: "resource_pool_status", ActionResourceSponsor: "resource_sponsored_action"}[record.Action]
		if tx.Type != expectedType {
			return errors.New("source sponsor request has a mismatched transaction kind")
		}
		matchedAudit := 0
		for _, event := range source.Audit {
			actionMatches := event.Action == record.Action
			if record.Action == ActionResourcePoolStatus && record.PoolSnapshot != nil {
				actionMatches = event.Action == record.Action+":"+record.PoolSnapshot.Status
			}
			if actionMatches && event.Signer == record.Signer && event.ObjectID == record.ObjectID && event.RequestHash == record.RequestHash {
				matchedAudit++
			}
		}
		if matchedAudit != 1 {
			return errors.New("source sponsor request lacks exactly one original audit entry")
		}
		if record.ObjectType == "pool" {
			if record.Action == ActionResourceSponsor || record.PoolSnapshot == nil || record.PoolSnapshot.ID != record.ObjectID || record.PoolSnapshot.Owner != record.Signer || record.PoolSnapshot.PolicyHash != chain.ResourcePoolPolicyHash(*record.PoolSnapshot) {
				return errors.New("source sponsor pool request lacks its exact actor-bound snapshot")
			}
			if _, exists := source.Pools[record.ObjectID]; !exists {
				return errors.New("source sponsor request references an absent pool")
			}
			if record.Action == ActionResourcePoolCreate {
				poolCreates[record.ObjectID]++
			}
		} else if record.ObjectType == "sponsorship" {
			value, ok := source.Sponsors[record.ObjectID]
			if record.Action != ActionResourceSponsor || !ok || value.TransactionHash != record.TransactionHash || value.Beneficiary != record.Signer || value.Payer != record.Signer || source.ActionRefs[value.ActionReference] != value.ID {
				return errors.New("source sponsorship request does not reconcile with its actor and action reference")
			}
			sponsorRequests[value.ID]++
		} else {
			return errors.New("unsupported source sponsor request object")
		}
	}
	consumed := map[string]chain.ResourceUnits{}
	for id, value := range source.Sponsors {
		if sponsorRequests[id] != 1 {
			return errors.New("source sponsorship lacks exactly one original request")
		}
		var err error
		consumed[value.PoolID], err = consumeBFTResourceUnit(consumed[value.PoolID], value.ResourceType, value.Amount)
		if err != nil {
			return err
		}
	}
	for id, pool := range source.Pools {
		if poolCreates[id] != 1 || consumed[id] != pool.Consumed {
			return errors.New("source pool creation or consumption does not reconcile with original requests")
		}
	}
	return nil
}
