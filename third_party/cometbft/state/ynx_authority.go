package state

import (
	"bytes"
	"errors"
	"fmt"
	"math"

	"github.com/cometbft/cometbft/types"
)

// BindConsensusState authenticates already-selected engine sets. It never
// reconstructs priorities or accepts a pending application candidate.
func BindConsensusState(state State, authority types.ConsensusAuthority) (State, error) {
	if authority == nil {
		if len(state.ConsensusParams.YNXProfile) > 0 || types.ValidatorSetRequiresConsensusAuthority(state.Validators) || types.ValidatorSetRequiresConsensusAuthority(state.NextValidators) || types.ValidatorSetRequiresConsensusAuthority(state.LastValidators) {
			return state, errors.New("PQ engine state requires independently committed consensus authority")
		}
		return state, nil
	}
	height := state.LastBlockHeight + 1
	if state.LastBlockHeight == 0 {
		height = state.InitialHeight
	}
	if height <= 0 || height >= math.MaxInt64 {
		return state, errors.New("invalid authority binding height")
	}
	expected, err := authority.ParamsAt(height)
	if err != nil {
		return state, err
	}
	want, got := expected.ToProto(), state.ConsensusParams.ToProto()
	if !want.Equal(&got) || !bytes.Equal(expected.Hash(), state.ConsensusParams.Hash()) {
		return state, errors.New("actual consensus parameters differ from authenticated historical profile")
	}
	// Individual binding owns a fresh set while retaining the real priorities.
	next := state
	next.Validators, err = authority.BindValidatorSet(height, state.Validators)
	if err != nil {
		return state, fmt.Errorf("bind current validators at %d: %w", height, err)
	}
	next.NextValidators, err = authority.BindValidatorSet(height+1, state.NextValidators)
	if err != nil {
		return state, fmt.Errorf("bind next validators at %d: %w", height+1, err)
	}
	if state.LastBlockHeight > 0 {
		next.LastValidators, err = authority.BindValidatorSet(state.LastBlockHeight, state.LastValidators)
		if err != nil {
			return state, fmt.Errorf("bind last validators at %d: %w", state.LastBlockHeight, err)
		}
	}
	return next, nil
}

func authorityForState(state State, source types.ConsensusAuthoritySource) (types.ConsensusAuthority, error) {
	if source == nil {
		return nil, nil
	}
	height := state.LastBlockHeight
	if height == 0 {
		height = state.InitialHeight - 1
	}
	authority, err := source.ConsensusAuthorityForState(state.ChainID, height, bytes.Clone(state.AppHash))
	if err != nil {
		return nil, err
	}
	if authority == nil {
		return nil, errors.New("configured consensus authority source returned nil")
	}
	return authority, nil
}

func BindConsensusStateFromSource(state State, source types.ConsensusAuthoritySource) (State, error) {
	authority, err := authorityForState(state, source)
	if err != nil {
		return state, err
	}
	return BindConsensusState(state, authority)
}

// WithConsensusAuthorityStore keeps persisted protobufs authority-free and
// authenticates decoded current/historical sets on every actual load path.
// The wrapped database, rather than the peer or requested historical height,
// selects the current committed AppHash checkpoint for the source.
func WithConsensusAuthorityStore(store Store, source types.ConsensusAuthoritySource) Store {
	if source == nil {
		return store
	}
	return &consensusAuthorityStore{Store: store, source: source}
}

type consensusAuthorityStore struct {
	Store
	source             types.ConsensusAuthoritySource
	handshakeAuthority types.ConsensusAuthority
	handshakeHeight    int64
}

func (s *consensusAuthorityStore) BindState(state State) (State, error) {
	if s.handshakeAuthority != nil && state.LastBlockHeight <= s.handshakeHeight {
		return BindConsensusState(state, s.handshakeAuthority)
	}
	authority, err := authorityForState(state, s.source)
	if err != nil {
		return state, err
	}
	return BindConsensusState(state, authority)
}
func (s *consensusAuthorityStore) Load() (State, error) {
	state, err := s.Store.Load()
	if err != nil {
		return state, err
	}
	return s.BindState(state)
}
func (s *consensusAuthorityStore) LoadFromDBOrGenesisDoc(doc *types.GenesisDoc) (State, error) {
	state, err := s.Store.LoadFromDBOrGenesisDoc(doc)
	if err != nil {
		return state, err
	}
	return s.BindState(state)
}
func (s *consensusAuthorityStore) LoadFromDBOrGenesisFile(path string) (State, error) {
	state, err := s.Store.LoadFromDBOrGenesisFile(path)
	if err != nil {
		return state, err
	}
	return s.BindState(state)
}
func (s *consensusAuthorityStore) Bootstrap(state State) error {
	bound, err := BindConsensusStateFromSource(state, s.source)
	if err != nil {
		return err
	}
	return s.Store.Bootstrap(bound)
}
func (s *consensusAuthorityStore) Save(state State) error {
	// A newly written state always requires its exact post-Commit AppHash,
	// even during recovery using an independently checked later checkpoint.
	bound, err := BindConsensusStateFromSource(state, s.source)
	if err != nil {
		return err
	}
	return s.Store.Save(bound)
}
func (s *consensusAuthorityStore) currentAuthority() (types.ConsensusAuthority, error) {
	if s.handshakeAuthority != nil {
		return s.handshakeAuthority, nil
	}
	state, err := s.Store.Load()
	if err != nil {
		return nil, err
	}
	return authorityForState(state, s.source)
}
func (s *consensusAuthorityStore) BindValidatorSet(height int64, set *types.ValidatorSet) (*types.ValidatorSet, error) {
	authority, err := s.currentAuthority()
	if err != nil {
		return nil, err
	}
	return authority.BindValidatorSet(height, set)
}
func (s *consensusAuthorityStore) LoadValidators(height int64) (*types.ValidatorSet, error) {
	set, err := s.Store.LoadValidators(height)
	if err != nil {
		return nil, err
	}
	return s.BindValidatorSet(height, set)
}
func (s *consensusAuthorityStore) BindEvidenceValidatorSet(height int64, set *types.ValidatorSet) (*types.ValidatorSet, error) {
	authority, err := s.currentAuthority()
	if err != nil {
		return nil, err
	}
	if evidenceAuthority, ok := authority.(types.ConsensusEvidenceAuthority); ok {
		return evidenceAuthority.BindEvidenceValidatorSet(height, set)
	}
	return authority.BindValidatorSet(height, set)
}
func (s *consensusAuthorityStore) LoadConsensusParams(height int64) (types.ConsensusParams, error) {
	params, err := s.Store.LoadConsensusParams(height)
	if err != nil {
		return params, err
	}
	authority, err := s.currentAuthority()
	if err != nil {
		return params, err
	}
	expected, err := authority.ParamsAt(height)
	if err != nil {
		return params, err
	}
	want, got := expected.ToProto(), params.ToProto()
	if !want.Equal(&got) {
		return params, errors.New("stored historical params differ from authenticated profile")
	}
	return params, nil
}

// BindValidatorSetFromStore is also used for embedded evidence/light sets,
// which do not originate from LoadValidators and otherwise lose authority.
func BindValidatorSetFromStore(store Store, height int64, set *types.ValidatorSet) (*types.ValidatorSet, error) {
	if binder, ok := store.(interface {
		BindValidatorSet(int64, *types.ValidatorSet) (*types.ValidatorSet, error)
	}); ok {
		return binder.BindValidatorSet(height, set)
	}
	if types.ValidatorSetRequiresConsensusAuthority(set) {
		return nil, errors.New("decoded PQ evidence set has no configured consensus authority")
	}
	return set, nil
}

func BindEvidenceValidatorSetFromStore(store Store, height int64, set *types.ValidatorSet) (*types.ValidatorSet, error) {
	if binder, ok := store.(interface {
		BindEvidenceValidatorSet(int64, *types.ValidatorSet) (*types.ValidatorSet, error)
	}); ok {
		return binder.BindEvidenceValidatorSet(height, set)
	}
	return BindValidatorSetFromStore(store, height, set)
}

func (blockExec *BlockExecutor) BindState(state State) (State, error) {
	if blockExec == nil {
		return BindConsensusState(state, nil)
	}
	if binder, ok := blockExec.store.(interface{ BindState(State) (State, error) }); ok {
		return binder.BindState(state)
	}
	return BindConsensusState(state, nil)
}

// WithHandshakeConsensusAuthorityStore is only for a checkpoint already
// checked against persisted engine Finalize results. It does not relabel that
// checkpoint's AppHash as an older one; immutable historical key/param queries
// use the real later snapshot, while every Save still pins its exact AppHash.
func WithHandshakeConsensusAuthorityStore(store Store, source types.ConsensusAuthoritySource, authority types.ConsensusAuthority, checkpointHeight int64) (Store, error) {
	if source == nil || authority == nil || checkpointHeight < 0 {
		return nil, errors.New("missing authenticated handshake checkpoint")
	}
	return &consensusAuthorityStore{Store: store, source: source, handshakeAuthority: authority, handshakeHeight: checkpointHeight}, nil
}
