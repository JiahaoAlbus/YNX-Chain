package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
)

// The probe runs after the real durable Application.Commit, while the real
// BlockExecutor is still waiting for its response and has not saved Comet state.
// No node, listener, consensus reactor or synthetic authority is started.
type checkpointCommitProbe struct {
	*Application
	afterCommit func() error
}

func (p *checkpointCommitProbe) Commit(ctx context.Context, request *abci.RequestCommit) (*abci.ResponseCommit, error) {
	response, err := p.Application.Commit(ctx, request)
	if err == nil && p.afterCommit != nil {
		err = p.afterCommit()
	}
	return response, err
}

type checkpointObservedStore struct {
	sm.Store
	saves, bootstraps int
	failSave          error
}

func (s *checkpointObservedStore) Save(state sm.State) error {
	s.saves++
	if s.failSave != nil {
		return s.failSave
	}
	return s.Store.Save(state)
}

func (s *checkpointObservedStore) Bootstrap(state sm.State) error {
	s.bootstraps++
	return s.Store.Bootstrap(state)
}

type checkpointObservedSource struct {
	*Application
	confirms int
}

func (s *checkpointObservedSource) ConfirmConsensusRuntimeCheckpoint(chain string, height int64, hash []byte, version uint64) error {
	s.confirms++
	return s.Application.ConfirmConsensusRuntimeCheckpoint(chain, height, hash, version)
}

func TestPQEngineCheckpointReadSurvivesApplicationCommitBeforeStoreSave(t *testing.T) {
	h := newEngineWiringHarness(t)
	var registrations cmttypes.Txs
	for i := range h.f.bootstrap.record.Members {
		key, wire := engineRegistration(t, h.f, i, h.f.doc.InitialHeight)
		h.keys = append(h.keys, key)
		payload, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, payload)
	}
	h.apply(t, registrations)
	schedule, err := NewPQEngineSchedule(h.f.bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	pin, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(raw, pin)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithEngineAuthorization(h.f.migration, h.path, h.f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	h.app, h.source.app = app, app
	source := &checkpointObservedSource{Application: app}
	observed := &checkpointObservedStore{Store: h.raw}
	store := sm.WithConsensusAuthorityStore(observed, source)
	binder := store.(interface {
		BindState(sm.State) (sm.State, error)
	})
	probe := &checkpointCommitProbe{Application: app}
	connections := proxy.NewAppConns(proxy.NewLocalClientCreator(probe), proxy.NopMetrics())
	if err := connections.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connections.Stop() })
	apply := func() (sm.State, error) {
		state, block, id, _ := h.makeBlock(t, nil)
		executor := sm.NewBlockExecutor(store, log.NewNopLogger(), connections.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, h.blocks)
		return executor.ApplyBlock(state, id, block)
	}
	// Prime from the actual post-handshake database, as normal Node construction
	// does. Merely holding a PubKey or an application file never primes this view.
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}
	pState, err := apply()
	if err != nil || pState.LastBlockHeight != schedule.ParamsUpdateHeight {
		t.Fatal("real P block failed", err)
	}
	profile, err := schedule.ProfileBytes()
	if err != nil {
		t.Fatal(err)
	}
	checks := 0
	probe.afterCommit = func() error {
		checks++
		if app.committed.Height != pState.LastBlockHeight+1 {
			return errors.New("probe did not run at actual Commit/Store.Save gap")
		}
		actual, err := h.raw.Load()
		if err != nil || actual.LastBlockHeight != pState.LastBlockHeight || !bytes.Equal(actual.AppHash, pState.AppHash) {
			return fmt.Errorf("Comet checkpoint advanced before the probe: %v", err)
		}
		if _, err := app.ConsensusAuthorityForState(actual.ChainID, actual.LastBlockHeight, actual.AppHash); err == nil {
			return errors.New("current-only application source no longer rejects prior H")
		}
		// These are the exact production RPC/history reads that failed in the
		// four-node test, while the app is one block ahead of the actual store.
		before, err := store.LoadConsensusParams(schedule.ParamsUpdateHeight)
		if err != nil || len(before.YNXProfile) != 0 {
			return fmt.Errorf("real P params lost during Commit gap: %v", err)
		}
		after, err := store.LoadConsensusParams(schedule.ParamsUpdateHeight + 1)
		if err != nil || !bytes.Equal(after.YNXProfile, profile) {
			return fmt.Errorf("real P+1 params lost during Commit gap: %v", err)
		}
		if _, err := store.LoadValidators(schedule.ParamsUpdateHeight + 1); err != nil {
			return fmt.Errorf("real historical validators lost during Commit gap: %w", err)
		}
		if loaded, err := store.Load(); err != nil || loaded.LastBlockHeight != actual.LastBlockHeight || !bytes.Equal(loaded.AppHash, actual.AppHash) {
			return fmt.Errorf("read changed the actual checkpoint: %v", err)
		}
		if _, err := sm.WithConsensusAuthorityStore(h.raw, source).Load(); err == nil {
			return errors.New("cold wrapper invented an unobserved prior authority")
		}
		for _, mutate := range []func(*sm.State){
			func(s *sm.State) { s.ChainID += "-foreign" },
			func(s *sm.State) { s.AppHash[0] ^= 1 },
			func(s *sm.State) { s.AppHash = nil },
			func(s *sm.State) { s.AppHash = s.AppHash[:31] },
			func(s *sm.State) { s.LastBlockHeight += 2 },
		} {
			bad := actual.Copy()
			bad.AppHash = bytes.Clone(actual.AppHash)
			mutate(&bad)
			if _, err := binder.BindState(bad); err == nil {
				return errors.New("checkpoint cache accepted wrong chain, height or full hash")
			}
		}
		saves, bootstraps, confirms := observed.saves, observed.bootstraps, source.confirms
		if err := store.Save(actual); err == nil {
			return errors.New("read cache authorized stale Store.Save")
		}
		if err := store.Bootstrap(actual); err == nil {
			return errors.New("read cache authorized stale Store.Bootstrap")
		}
		if observed.saves != saves || observed.bootstraps != bootstraps || source.confirms != confirms {
			return errors.New("rejected stale write touched database or runtime cursor")
		}
		return nil
	}
	// A pre-write failure keeps the actual previous Comet checkpoint readable
	// and never confirms the runtime cursor. Retry only this same real state.
	writeFailure := errors.New("synthetic engine Save failure before database mutation")
	observed.failSave = writeFailure
	confirms := source.confirms
	uState, err := apply()
	probe.afterCommit = nil
	if !errors.Is(err, writeFailure) || checks != 1 || uState.LastBlockHeight != schedule.ValidatorUpdateHeight {
		t.Fatal("real Commit-gap regression or write failure was not exercised", err)
	}
	if source.confirms != confirms {
		t.Fatal("failed engine Save confirmed runtime cursor")
	}
	if old, err := store.Load(); err != nil || old.LastBlockHeight != pState.LastBlockHeight || !bytes.Equal(old.AppHash, pState.AppHash) {
		t.Fatal("failed Save lost previous authenticated checkpoint", err)
	}
	observed.failSave = nil
	if err := store.Save(uState); err != nil || source.confirms != confirms+1 {
		t.Fatal("same original engine state did not recover after write failure", err)
	}
	if cold, err := sm.WithConsensusAuthorityStore(h.raw, source).Load(); err != nil || cold.LastBlockHeight != uState.LastBlockHeight || !bytes.Equal(cold.AppHash, uState.AppHash) {
		t.Fatal("cold reader rejected the now-matching actual checkpoint", err)
	}
	var previous sm.State
	for app.committed.Height < schedule.ActivationHeight+1 {
		previous, err = store.Load()
		if err != nil {
			t.Fatal(err)
		}
		if _, err = apply(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := binder.BindState(previous); err != nil {
		t.Fatal("the immediately previous exact checkpoint was not retained", err)
	}
	if _, err := binder.BindState(pState); err == nil {
		t.Fatal("authority cache retained more than two checkpoint heights")
	}
	active, err := store.LoadValidators(schedule.ActivationHeight)
	commit := h.blocks.LoadSeenCommit(schedule.ActivationHeight)
	if err != nil || active.VerifyCommit(h.f.doc.ChainID, commit.BlockID, commit.Height, commit) != nil {
		t.Fatal("actual post-transition PQ commit no longer verifies", err)
	}
}
