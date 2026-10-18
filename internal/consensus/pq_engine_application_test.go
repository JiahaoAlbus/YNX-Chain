package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ynxpq"
)

func persistentEngineAuthorizationFixture(t *testing.T) (*validatorRegistryFixture, *Application, *PQEngineAuthorization, *PQEngineSchedule, string, []engineTestKey) {
	t.Helper()
	f, original, keys := committedEngineFixture(t)
	path := filepath.Join(t.TempDir(), "committed.json")
	if err := saveCommittedState(path, original.committed, f.migration); err != nil {
		t.Fatal(err)
	}
	schedule, err := NewPQEngineSchedule(f.bootstrap, original.committed.ValidatorRegistry, original.committed.Height, original.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	if app.committed.AppHash != original.committed.AppHash || app.committed.PQEngineSchedule != nil {
		t.Fatal("normal constructor activated schedule or rewrote old AppHash")
	}
	return f, app, authorization, schedule, path, keys
}

func TestPQEngineNormalConstructorAndActualABCIActivationOrdering(t *testing.T) {
	f, app, authorization, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	ctx := context.Background()
	before := app.committed.AppHash
	if _, err := app.InitChain(ctx, f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	if app.committed.AppHash != before || app.committed.PQEngineSchedule != nil {
		t.Fatal("InitChain rewrote old hash or activated profile")
	}
	for height := schedule.AuthorizedAt; height <= schedule.ActivationHeight; height++ {
		snapshot, err := app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		nextHash, err := snapshot.ExpectedValidatorHash(height + 1)
		if err != nil {
			t.Fatal(err)
		}
		if height == schedule.AuthorizedAt {
			check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: []byte("invalid")})
			if err != nil || check.Code == 0 {
				t.Fatal("invalid candidate unexpectedly admitted", err)
			}
		}
		prepared, err := app.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: height, NextValidatorsHash: nextHash})
		if err != nil || len(prepared.Txs) != 0 {
			t.Fatal("empty schedule proposal failed", err)
		}
		processed, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: height, NextValidatorsHash: nextHash})
		if err != nil || processed.Status != abci.ResponseProcessProposal_ACCEPT {
			t.Fatal("valid scheduled proposal rejected", err)
		}
		if height == schedule.AuthorizedAt && (app.committed.AppHash != before || app.committed.PQEngineSchedule != nil || app.pending != nil) {
			t.Fatal("Check/Prepare/Process leaked candidate schedule")
		}
		if height == schedule.ActivationHeight-1 {
			rejected, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: height, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)})
			if err != nil || rejected.Status != abci.ResponseProcessProposal_REJECT {
				t.Fatal("actual ProcessProposal accepted fixed old Ed next-set hash", err)
			}
		}
		response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, NextValidatorsHash: nextHash})
		if err != nil {
			t.Fatal(err)
		}
		switch height {
		case schedule.ParamsUpdateHeight:
			if response.ConsensusParamUpdates == nil || len(response.ValidatorUpdates) != 0 {
				t.Fatal("P must emit profile/params only")
			}
			expected, err := schedule.ProfileBytes()
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(response.ConsensusParamUpdates.YnxProfile, expected) {
				t.Fatal("ABCI emitted different profile bytes")
			}
			profile, err := ynxpq.DecodeConsensusProfile(response.ConsensusParamUpdates.YnxProfile)
			if err != nil || profile.ParamsUpdateHeight != height || profile.ActivationHeight != schedule.ActivationHeight {
				t.Fatal("actual profile does not bind schedule", err)
			}
			info, err := app.Info(ctx, &abci.RequestInfo{})
			if err != nil {
				t.Fatal(err)
			}
			oldHash, _ := hex.DecodeString(before)
			if !bytes.Equal(info.LastBlockAppHash, oldHash) || bytes.Equal(response.AppHash, oldHash) || app.pending.Version != PQEngineScheduleStateVersion {
				t.Fatal("Finalize/pending hash mistaken for committed or old hash unchanged")
			}
			stillCommitted, err := app.CommittedPQEngineSnapshot()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := stillCommitted.Policy(); err == nil {
				t.Fatal("pending Finalize profile escaped committed snapshot")
			}
		case schedule.ValidatorUpdateHeight:
			if response.ConsensusParamUpdates != nil || len(response.ValidatorUpdates) != len(f.bootstrap.record.Members) {
				t.Fatal("H+2 key update step differs")
			}
		default:
			if response.ConsensusParamUpdates != nil || len(response.ValidatorUpdates) != 0 {
				t.Fatal("unexpected repeated profile/key updates")
			}
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	committedHash := app.committed.AppHash
	if _, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap); err == nil {
		t.Fatal("restart silently accepted scheduled ledger without operator pin")
	}
	wrong := clonePQEngineSchedule(schedule)
	wrong.ActivationHeight++
	wrong.ValidatorUpdateHeight++
	wrongJSON, _ := json.Marshal(wrong)
	wrongHash, _ := wrong.Hash()
	wrongAuthorization, err := NewPQEngineAuthorization(wrongJSON, wrongHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, wrongAuthorization); err == nil {
		t.Fatal("restart substituted different independent schedule pin")
	}
	reopened, err := NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.committed.AppHash != committedHash || reopened.committed.PQEngineSchedule == nil {
		t.Fatal("cold actual constructor lost committed profile/hash")
	}
	visible, err := reopened.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	policy, err := visible.Policy()
	if err != nil || policy.ActivationHeight != schedule.ActivationHeight {
		t.Fatal("committed profile missing on cold read", err)
	}
	oldParams, err := visible.ParamsAt(schedule.ParamsUpdateHeight)
	if err != nil {
		t.Fatal(err)
	}
	newParams, err := visible.ParamsAt(schedule.ParamsUpdateHeight + 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(oldParams.YNXProfile) != 0 || len(newParams.YNXProfile) == 0 || bytes.Equal(oldParams.Hash(), newParams.Hash()) {
		t.Fatal("historical parameter lookup reinterpreted P")
	}
}

func TestPQEngineProfileCommitUnknownRetainsExactCandidateAndColdPin(t *testing.T) {
	f, app, authorization, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	ctx := context.Background()
	oldHash := app.committed.AppHash
	response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)})
	if err != nil {
		t.Fatal(err)
	}
	candidate := app.pending.AppHash
	if candidate != hex.EncodeToString(response.AppHash) {
		t.Fatal("wrong candidate identity")
	}
	app.persistenceHooks = &committedPersistenceHooks{beforeRename: func() error { return errors.New("QA pre-rename") }}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err == nil || errors.Is(err, ErrCommittedStateDurabilityUncertain) {
		t.Fatal("pre-rename failure misreported", err)
	}
	if app.pending == nil || app.pending.AppHash != candidate || app.committed.AppHash != oldHash {
		t.Fatal("pre-rename failure lost original/candidate")
	}
	app.persistenceHooks = &committedPersistenceHooks{syncDirectory: func(string) error { return errors.New("QA post-rename directory sync") }}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); !errors.Is(err, ErrCommittedStateDurabilityUncertain) {
		t.Fatal("post-rename failure not UNKNOWN", err)
	}
	if app.pending == nil || app.pending.AppHash != candidate || app.committed.AppHash != oldHash {
		t.Fatal("UNKNOWN changed visible committed or lost pending fence")
	}
	if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt + 1}); err == nil {
		t.Fatal("UNKNOWN allowed execution of another candidate")
	}
	failedSync := &committedPersistenceHooks{syncDirectory: func(string) error { return errors.New("QA cold sync failure") }}
	if _, err := newPersistentApplicationWithAuthorization(f.migration, path, f.bootstrap, failedSync, authorization); !errors.Is(err, ErrCommittedStateDurabilityUncertain) {
		t.Fatal("cold load claimed durability without directory sync", err)
	}
	cold, err := NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	if cold.committed.AppHash != candidate || cold.committed.Height != schedule.AuthorizedAt {
		t.Fatal("cold load lost original visible UNKNOWN candidate")
	}
	app.persistenceHooks = nil
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if app.committed.AppHash != candidate || app.pending != nil || len(app.committed.ValidatorRegistry.Events) != len(cold.committed.ValidatorRegistry.Events) {
		t.Fatal("reconfirmation reexecuted or changed candidate history")
	}
}

func TestPQEngineActualRegistryIngressRejectsActivationConflictBeforeFinalize(t *testing.T) {
	f, app, _, schedule, _, keys := persistentEngineAuthorizationFixture(t)
	ctx := context.Background()
	if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	height := schedule.ValidatorUpdateHeight
	conflict := appendEngineRevocation(t, f, app.committed.ValidatorRegistry, keys[0], height, schedule.ActivationHeight)
	tx, err := EncodeValidatorRegistryTransaction(conflict.Events[len(conflict.Events)-1].Wire)
	if err != nil {
		t.Fatal(err)
	}
	before := app.committed.AppHash
	root := app.committed.ValidatorRegistry.Root
	check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: tx})
	if err != nil || check.Code == 0 {
		t.Fatal("CheckTx admitted lawfully signed activation conflict", err)
	}
	prepared, err := app.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: height, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: [][]byte{tx}})
	if err != nil || len(prepared.Txs) != 0 {
		t.Fatal("PrepareProposal selected activation conflict", err)
	}
	processed, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: height, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: [][]byte{tx}})
	if err != nil || processed.Status != abci.ResponseProcessProposal_REJECT {
		t.Fatal("ProcessProposal deferred unsafe event until Finalize", err)
	}
	if app.committed.AppHash != before || app.committed.ValidatorRegistry.Root != root || app.pending != nil {
		t.Fatal("rejected proposal mutated committed state")
	}
	finalized, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: [][]byte{tx}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code == 0 {
		t.Fatal("Finalize did not isolate rejected event", err)
	}
	if app.pending.ValidatorRegistry.Root != root || len(finalized.ValidatorUpdates) != len(f.bootstrap.record.Members) {
		t.Fatal("rejected event changed initial activation update")
	}
}
