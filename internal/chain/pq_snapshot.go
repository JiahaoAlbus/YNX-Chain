package chain

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

const (
	pqDevnetSnapshotVersion    = 3
	pqDevnetSnapshotHashDomain = "YNX_CHAIN_DEVNET_SNAPSHOT_V3"
)

func cloneAccountPolicy(state *ynxauth.State) *ynxauth.State {
	if state == nil {
		return nil
	}
	cloned := state.Clone()
	return &cloned
}

// validateAccountPolicyShape deliberately rejects a non-nil zero State. That
// value is accepted by the policy package for historical callers, but cannot
// represent an enabled v3 ledger or replace a previously enabled policy.
func validateAccountPolicyShape(state *ynxauth.State, network []byte) error {
	if state == nil || state.Version != ynxauth.PolicyVersion {
		return errors.New("snapshot account policy is missing or uninitialized")
	}
	return state.Validate(network)
}

// validateAccountPolicySnapshot binds policy to the original genesis identity,
// including for partial replication State documents that omit the block list.
// Complete snapshots also recheck preserved PQ envelopes at their execution
// heights through the authorization layer; that layer owns proof semantics.
func validateAccountPolicySnapshot(snapshot devnetSnapshot) error {
	switch snapshot.Version {
	case legacyDevnetSnapshotVersion, devnetSnapshotVersion:
		if snapshot.AccountPolicy != nil || len(snapshot.PQBatches) != 0 {
			return errors.New("legacy snapshot must not contain account policy")
		}
	case pqDevnetSnapshotVersion:
		genesis := hashParts("genesis", snapshot.Config.Slug, fmt.Sprint(snapshot.Config.ChainID))
		network, err := hex.DecodeString(genesis)
		if err != nil {
			return fmt.Errorf("decode original genesis: %w", err)
		}
		if len(snapshot.Blocks) > 0 && snapshot.Blocks[0].Hash != genesis {
			return errors.New("account policy snapshot genesis mismatch")
		}
		if err := validateAccountPolicyShape(snapshot.AccountPolicy, network); err != nil {
			return fmt.Errorf("validate snapshot account policy: %w", err)
		}
	default:
		return fmt.Errorf("unsupported account policy snapshot version %d", snapshot.Version)
	}
	type registrationID struct {
		owner    string
		revision uint64
	}
	proofs := make(map[registrationID]uint64)
	validateTransaction := func(tx Transaction, height uint64) error {
		if strings.HasPrefix(tx.Memo, pqBatchMemo) {
			// Complete shared batch coverage is checked once below.
			return nil
		}
		if err := validateHistoricalPQTransaction(tx, snapshot.AccountPolicy, height, snapshot.Config.ChainID); err != nil {
			return err
		}
		if strings.HasPrefix(tx.Memo, pqMigrationMemo) {
			wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqMigrationMemo))
			if err != nil {
				return err
			}
			migration, err := ynxauth.DecodeMigration(wire)
			if err != nil {
				return err
			}
			id := registrationID{migration.Intent.Owner, migration.Intent.NewRevision}
			proofs[id]++
			if proofs[id] != 1 {
				return errors.New("duplicate historical account migration proof")
			}
		}
		return nil
	}
	for _, block := range snapshot.Blocks {
		for _, tx := range block.Transactions {
			if err := validateTransaction(tx, block.Height); err != nil {
				return fmt.Errorf("validate PQ history at height %d: %w", block.Height, err)
			}
		}
	}
	// A partial replication State has no execution tip. The complete candidate
	// is validated again before persistence, after attaching the local history.
	if len(snapshot.Blocks) > 0 {
		height := snapshot.Blocks[len(snapshot.Blocks)-1].Height
		if height < math.MaxUint64 {
			height++
		}
		for _, tx := range snapshot.Pending {
			if err := validateTransaction(tx, height); err != nil {
				return fmt.Errorf("validate pending PQ history: %w", err)
			}
		}
		if snapshot.AccountPolicy != nil {
			for _, record := range snapshot.AccountPolicy.Records {
				if record.RegisteredAt > height {
					return errors.New("account registration is ahead of snapshot execution height")
				}
				if proofs[registrationID{record.Owner, record.Revision}] != 1 {
					return errors.New("account registration is missing its original migration proof")
				}
			}
		}
	}
	if err := validatePQBatchSnapshot(snapshot); err != nil {
		return err
	}
	return validatePQActionSnapshot(snapshot)
}

func equalAccountPolicyRecord(a, b ynxauth.Record) bool {
	return a.AlgorithmVersion == b.AlgorithmVersion && a.Owner == b.Owner &&
		a.Revision == b.Revision && a.RegisteredAt == b.RegisteredAt &&
		a.ActiveFrom == b.ActiveFrom && a.LedgerNonce == b.LedgerNonce &&
		bytes.Equal(a.PKA, b.PKA) && bytes.Equal(a.PKB, b.PKB)
}

// validateAccountPolicyContinuation allows sorted insertion of new owners and
// append-only revisions. Comparing a global prefix would incorrectly reject a
// newly registered owner that sorts before an existing owner.
func validateAccountPolicyContinuation(previous, next *ynxauth.State) error {
	if next != nil {
		if err := validateAccountPolicyShape(next, next.NetworkID); err != nil {
			return err
		}
	}
	if previous == nil {
		return nil
	}
	if next == nil {
		return errors.New("account policy downgrade or omission rejected")
	}
	if err := validateAccountPolicyShape(previous, previous.NetworkID); err != nil {
		return fmt.Errorf("invalid current account policy: %w", err)
	}
	if previous.Version != next.Version || previous.EnableAt != next.EnableAt || !bytes.Equal(previous.NetworkID, next.NetworkID) {
		return errors.New("account policy network or activation rewrite rejected")
	}
	j := 0
	for _, old := range previous.Records {
		for j < len(next.Records) && (next.Records[j].Owner < old.Owner ||
			(next.Records[j].Owner == old.Owner && next.Records[j].Revision < old.Revision)) {
			j++
		}
		if j == len(next.Records) || !equalAccountPolicyRecord(old, next.Records[j]) {
			return errors.New("account policy history removal or rewrite rejected")
		}
		j++
	}
	return nil
}

// commitReplicationSnapshot holds the write lock across the final policy
// check, durable replacement and in-memory replacement. A read lock here would
// allow another checkpoint to persist the old policy between disk commit and
// memory commit, or two replication calls to commit incompatible schedules.
// Hashing/proof verification precede this phase. The lock order is always
// mu -> persistenceMu; no persistenceMu holder acquires mu. Callers enter with
// neither lock. Disk latency blocks reads until snapshot writing is redesigned
// to support a single atomic generation check across all checkpoint writers.
func (d *Devnet) commitReplicationSnapshot(snapshot devnetSnapshot, expectedHeight uint64, expectedHash string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	current := d.blocks[len(d.blocks)-1]
	if current.Height != expectedHeight || current.Hash != expectedHash {
		return errors.New("local chain advanced before replication persistence")
	}
	if err := validateAccountPolicyContinuation(d.accountPolicy, snapshot.AccountPolicy); err != nil {
		return err
	}
	if err := validatePQBatchContinuation(d.pqBatches, snapshot.PQBatches); err != nil {
		return err
	}
	persistErr := d.persistPreparedSnapshot(snapshot)
	d.recordPersistenceErrorLocked(persistErr)
	if persistErr != nil && !errors.Is(persistErr, ErrSnapshotDurabilityUncertain) {
		return persistErr
	}
	previousDurableHeight := d.replicationDurableHeight
	localPeers, localPeerSyncs := d.validatorPeers, d.validatorPeerSyncs
	// UNKNOWN means rename exposed this candidate. Keep its stricter policy
	// in memory even when directory fsync or the integrity marker failed; an
	// in-memory rollback could authorize a legacy write over the exposed file.
	d.applySnapshotLocked(snapshot)
	d.validatorPeers, d.validatorPeerSyncs = localPeers, localPeerSyncs
	d.uncertainTransactions = nil
	if persistErr != nil {
		d.replicationDurableHeight = previousDurableHeight
		d.uncertainTransactions = make(map[string]struct{})
		remember := func(tx Transaction) {
			if !d.transactionCheckpointCovers(tx) {
				d.uncertainTransactions[tx.Hash] = struct{}{}
			}
		}
		for _, block := range snapshot.Blocks {
			for _, tx := range block.Transactions {
				remember(tx)
			}
		}
		for _, tx := range snapshot.Pending {
			remember(tx)
		}
	}
	return persistErr
}
