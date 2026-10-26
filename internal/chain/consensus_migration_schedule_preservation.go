package chain

import (
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// VerifyConsensusPQSchedulePreservation permits only the real EnableAccountPQ
// scheduling transition at an explicit future height, or an unchanged existing
// schedule at that same height. Both documents must independently pass the
// complete migration validation; this comparison does not authorize activation,
// bind validator custody, prove deployment or replace execution verification.
//
// Runtime export already applies normalizedConsensusRuntimeSnapshot. Compare
// its complete typed result here: no additional metadata, history, empty-value
// or address normalization is permitted. The function never edits either input
// or its nested maps, slices, policy records, blocks or transactions.
func VerifyConsensusPQSchedulePreservation(before, after ConsensusMigrationState, enableAt uint64) error {
	if err := before.Validate(); err != nil {
		return fmt.Errorf("PQ schedule preservation before state: %w", err)
	}
	if err := after.Validate(); err != nil {
		return fmt.Errorf("PQ schedule preservation after state: %w", err)
	}
	if before.Version != ConsensusMigrationVersion || after.Version != ConsensusMigrationVersion || before.Runtime == nil || after.Runtime == nil {
		return errors.New("PQ schedule preservation requires complete v2 migration runtimes")
	}
	if enableAt == 0 || enableAt <= before.Height {
		return errors.New("PQ schedule preservation requires an explicit future enable height")
	}
	if before.AccountPolicy == nil {
		if before.Runtime.Version != devnetSnapshotVersion || after.Runtime.Version != pqDevnetSnapshotVersion {
			return errors.New("PQ schedule preservation requires runtime v2 to v3")
		}
		network, err := hex.DecodeString(before.OriginalGenesisHash)
		expected := &ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: enableAt}
		if err != nil || len(network) != 32 || !reflect.DeepEqual(after.AccountPolicy, expected) {
			return errors.New("PQ schedule preservation requires the exact empty genesis-bound policy")
		}
	} else {
		if before.Runtime.Version != pqDevnetSnapshotVersion || after.Runtime.Version != pqDevnetSnapshotVersion ||
			before.AccountPolicy.EnableAt != enableAt || !reflect.DeepEqual(before.AccountPolicy, after.AccountPolicy) {
			return errors.New("PQ schedule preservation cannot rewrite an existing schedule or policy")
		}
	}

	// Value copies exclude exactly the three allowed top-level fields. This
	// compares every other present or future typed field, including full maps,
	// order, original addresses, hashes, supplies and compiler material.
	a, b := before, after
	a.StateHash, b.StateHash = "", ""
	a.AccountPolicy, b.AccountPolicy = nil, nil
	a.Runtime, b.Runtime = nil, nil
	if !reflect.DeepEqual(a, b) {
		return errors.New("PQ schedule preservation changed complete migration state")
	}

	// Full validation above bound each runtime policy to its top-level copy.
	// Only that policy and the already checked version transition may differ.
	// These shallow value copies do not write through caller-owned references.
	x, y := *before.Runtime, *after.Runtime
	x.AccountPolicy, y.AccountPolicy = nil, nil
	x.Version, y.Version = 0, 0
	if !reflect.DeepEqual(x, y) {
		return errors.New("PQ schedule preservation changed complete source runtime")
	}
	return nil
}
