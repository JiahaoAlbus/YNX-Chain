package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmttypes "github.com/cometbft/cometbft/types"
)

// PQEngineFileSource retains at most the current and previous authenticated
// checkpoints, so a concurrent Commit cannot erase authority already bound to
// the engine's previous state. No cache entry is derived from a peer's height.
type PQEngineFileSource struct {
	mu                   sync.Mutex
	migration            chain.ConsensusMigrationState
	path                 string
	bootstrap            *ConsensusBootstrap
	authorization        *PQEngineAuthorization
	runtimeAuthorization *RuntimeUpgradeAuthorization
	checkpoints          [2]pqEngineCheckpoint
	// Signing observations cannot be evicted by historical engine reads.
	// Protected by mu; durable anti-equivocation still belongs to Signer H/R/S.
	signingSeen   bool
	signingHeight int64
	signingHash   [32]byte
}

var _ cmttypes.ConsensusAuthoritySource = (*PQEngineFileSource)(nil)

type pqEngineCheckpoint struct {
	height   int64
	hash     [32]byte
	snapshot *PQEngineSnapshot
}

func NewPQEngineFileSource(migration chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization) (*PQEngineFileSource, error) {
	if bootstrap == nil || authorization == nil || strings.TrimSpace(statePath) == "" {
		return nil, errors.New("engine authority source requires pinned bootstrap, path and independent schedule authorization")
	}
	if err := migration.Validate(); err != nil {
		return nil, err
	}
	if err := bootstrap.matchesMigration(migration); err != nil {
		return nil, err
	}
	raw, err := migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	var detached chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &detached); err != nil {
		return nil, err
	}
	path, err := filepath.Abs(statePath)
	if err != nil {
		return nil, err
	}
	return &PQEngineFileSource{migration: detached, path: path, bootstrap: bootstrap, authorization: authorization}, nil
}

func (s *PQEngineFileSource) ConsensusAuthorityForState(chainID string, committedHeight int64, appHash []byte) (cmttypes.ConsensusAuthority, error) {
	if s == nil || s.bootstrap == nil || chainID != s.bootstrap.record.ChainID || len(appHash) != 32 {
		return nil, errors.New("engine authority requires the exact trusted chain and full AppHash")
	}
	var hash [32]byte
	copy(hash[:], appHash)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, checkpoint := range s.checkpoints {
		if checkpoint.snapshot != nil && checkpoint.height == committedHeight && checkpoint.hash == hash {
			return checkpoint.snapshot, nil
		}
	}
	snapshot, err := loadPQEngineSnapshotWithRuntime(s.migration, s.path, s.bootstrap, s.authorization, s.runtimeAuthorization, committedHeight, hash[:])
	if err != nil {
		return nil, err
	}
	s.checkpoints[1] = s.checkpoints[0]
	s.checkpoints[0] = pqEngineCheckpoint{height: committedHeight, hash: hash, snapshot: snapshot}
	return snapshot, nil
}

// CommittedPQEngineSnapshot is the signer's view, populated only after the
// engine has supplied and authenticated its actual checkpoint through the
// source method above. Reading an arbitrary current file cannot prime it.
func (s *PQEngineFileSource) CommittedPQEngineSnapshot() (*PQEngineSnapshot, error) {
	if s == nil {
		return nil, errors.New("missing committed file authority source")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var latest *PQEngineSnapshot
	for _, checkpoint := range s.checkpoints {
		if checkpoint.snapshot != nil && (latest == nil || checkpoint.height > latest.through) {
			latest = checkpoint.snapshot
		}
	}
	if latest == nil {
		return nil, errors.New("signer authority requires the engine's first authenticated committed checkpoint")
	}
	return latest, nil
}

// LoadPQEngineSnapshot reads the application's actual committed file for an
// independently supplied Comet state. It never confirms a pending rename,
// writes the ledger, accepts peer authority or extrapolates an old AppHash.
// The caller must obtain height/AppHash from the trusted engine state after
// handshake, not from an incoming block, validator object or RPC response.
func LoadPQEngineSnapshot(migration chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, committedHeight int64, committedAppHash []byte) (*PQEngineSnapshot, error) {
	return loadPQEngineSnapshotWithRuntime(migration, statePath, bootstrap, authorization, nil, committedHeight, committedAppHash)
}

func loadPQEngineSnapshotWithRuntime(migration chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization, committedHeight int64, committedAppHash []byte) (*PQEngineSnapshot, error) {
	if bootstrap == nil || strings.TrimSpace(statePath) == "" || len(committedAppHash) != 32 {
		return nil, errors.New("engine file source requires pinned bootstrap, committed path and full trusted AppHash")
	}
	if err := bootstrap.matchesMigration(migration); err != nil {
		return nil, err
	}
	state, err := readPQEngineCommittedState(statePath, migration, bootstrap, authorization, runtime)
	if err != nil {
		return nil, fmt.Errorf("read committed engine authority: %w", err)
	}
	if state.Height != committedHeight {
		return nil, errors.New("application authority height differs from trusted Comet state; handshake/replay must reconcile it")
	}
	hash, err := hex.DecodeString(state.AppHash)
	if err != nil || !bytes.Equal(hash, committedAppHash) {
		return nil, errors.New("application authority AppHash differs from trusted Comet state")
	}
	if err := state.Validate(migration); err != nil {
		return nil, err
	}
	if _, err := runtimeStateApplicationVersion(state, runtime); err != nil {
		return nil, err
	}
	if err := authorization.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return nil, err
	}
	if authorization != nil && state.PQEngineSchedule == nil {
		if authorization.schedule.RegistryHeight != state.Height {
			return nil, errors.New("independent engine authorization does not bind the actual committed registry height")
		}
		if _, err := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, authorization.schedule, authorization.schedule.AuthorizedAt); err != nil {
			return nil, err
		}
	}
	snapshot, err := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	return withRuntimeUpgradeSnapshot(snapshot, err, runtime)
}
