package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// This candidate is an offline, independently pinned description for review.
// It is not installed in Application, journal replay, a node, or an RPC and
// does not authorize an activation. The old state and wire formats are intact.
const ethereumUnitCandidateFormat = "YNX-ETHEREUM-UNIT-CANDIDATE/v1"
const ethereumUnitCandidateMaximumBytes = 2048

type ethereumUnitCandidatePlan struct {
	Format               string `json:"format"`
	RuntimePlanSHA256    string `json:"runtimePlanSHA256"`
	CheckpointHeight     int64  `json:"checkpointHeight,string"`
	CheckpointAppHash    string `json:"checkpointAppHash"`
	CheckpointAppVersion uint64 `json:"checkpointAppVersion,string"`
	ActivationHeight     int64  `json:"activationHeight,string"`
	Before               string `json:"before"`
	After                string `json:"after"`
}

const ethereumUnitBefore = "preserve-unversioned-21k-integer"
const ethereumUnitAfter = "hold-unversioned-21k"

type ethereumUnitCandidate struct {
	plan ethereumUnitCandidatePlan
	hash string
}

// newEthereumUnitCandidate checks the proposed bytes against a separately
// supplied pin and the original runtime/engine checkpoint. The private
// checkpoint must come from the existing trusted engine holder, not from this
// plan, a transaction, an RPC response, or a restored state file alone.
func newEthereumUnitCandidate(raw []byte, expectedHash string, runtime *RuntimeUpgradeAuthorization, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, committed CommittedState, trusted runtimeUpgradeCheckpoint) (*ethereumUnitCandidate, error) {
	if len(raw) == 0 || len(raw) > ethereumUnitCandidateMaximumBytes {
		return nil, errors.New("unit candidate exceeds size bound")
	}
	if _, err := canonicalBootstrapHash(expectedHash); err != nil {
		return nil, err
	}
	var p ethereumUnitCandidatePlan
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(p)
	if err != nil || !bytes.Equal(canonical, raw) {
		return nil, errors.New("unit candidate is not exact canonical JSON")
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expectedHash {
		return nil, errors.New("unit candidate differs from independent pin")
	}
	base, err := runtime.Plan()
	if err != nil {
		return nil, err
	}
	baseHash, err := base.Hash()
	if err != nil || p.RuntimePlanSHA256 != baseHash || p.Format != ethereumUnitCandidateFormat || p.Before != ethereumUnitBefore || p.After != ethereumUnitAfter || p.CheckpointHeight < base.UpgradeHeight || p.CheckpointHeight == math.MaxInt64 || p.ActivationHeight != p.CheckpointHeight+1 || p.CheckpointAppVersion != base.NewApplicationVersion {
		return nil, errors.New("unit candidate differs from pinned runtime or transition profile")
	}
	if _, err := canonicalBootstrapHash(p.CheckpointAppHash); err != nil {
		return nil, err
	}
	if bootstrap == nil || trusted.height != p.CheckpointHeight || trusted.appHash != p.CheckpointAppHash || trusted.appVersion != p.CheckpointAppVersion || committed.Height != p.CheckpointHeight || committed.AppHash != p.CheckpointAppHash {
		return nil, errors.New("unit candidate requires the independently trusted checkpoint")
	}
	// The existing cursor constructor validates the original bootstrap,
	// migration, state, runtime identity and supplied engine checkpoint. Its
	// temporary result is not installed and cannot advance the live application.
	committed.bootstrap = bootstrap
	if _, err := newRuntimeUpgradeCursor(runtime, migration, committed, trusted); err != nil {
		return nil, err
	}
	return &ethereumUnitCandidate{plan: p, hash: expectedHash}, nil
}

// candidateRuleAt is for offline comparison only. It is not an authorization
// to execute or replay a block; future integration must also verify continuous
// trusted state and preserve the original journal's per-frame response/AppHash.
func (c *ethereumUnitCandidate) candidateRuleAt(height int64) (string, error) {
	if c == nil || height <= 0 {
		return "", errors.New("unit candidate or height unavailable")
	}
	raw, err := json.Marshal(c.plan)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != c.hash {
		return "", errors.New("unit candidate changed after validation")
	}
	if height < c.plan.ActivationHeight {
		return ethereumUnitBefore, nil
	}
	return ethereumUnitAfter, nil
}
