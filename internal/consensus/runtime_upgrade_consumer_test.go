package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
)

func openRuntimeConsumerFixture(t *testing.T, f runtimeUpgradeFixture, state CommittedState) (*Application, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "original-state.json")
	if err := saveCommittedState(path, state, f.migration); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithRuntimeUpgrade(f.migration, path, f.bootstrap, nil, f.authorization)
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(original, after) || app.runtimeUpgradeCursor != nil {
		t.Fatal("constructor changed history or trusted its file", err)
	}
	return app, path
}

func runtimeConsumerRequest(t *testing.T, f runtimeUpgradeFixture, nonce uint64) *abci.RequestFinalizeBlock {
	t.Helper()
	tx := journalTransfer(t, nonce)
	return &abci.RequestFinalizeBlock{Height: int64(f.migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0), NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: [][]byte{tx, tx}}
}

func confirmRuntimeConsumer(t *testing.T, app *Application, plan RuntimeUpgradePlan, state CommittedState) {
	t.Helper()
	hash, _ := hex.DecodeString(state.AppHash)
	version := plan.OldApplicationVersion
	if state.Height >= plan.UpgradeHeight {
		version = plan.NewApplicationVersion
	}
	if err := app.ConfirmConsensusRuntimeCheckpoint(plan.ChainID, state.Height, hash, version); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeConsumerHistoricalExecutionAndExactEngineFence(t *testing.T) {
	for _, version := range []int{12, 13} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			f := newRuntimeUpgradeFixture(t, version)
			app, path := openRuntimeConsumerFixture(t, f, f.old[0])
			info, err := app.Info(context.Background(), &abci.RequestInfo{})
			if err != nil || info.AppVersion != f.plan.OldApplicationVersion || info.LastBlockHeight != f.old[0].Height {
				t.Fatal("Info rewrote old version", err)
			}
			if _, err := app.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 2)); err == nil {
				t.Fatal("file-only authority executed")
			}
			hash, _ := hex.DecodeString(f.old[0].AppHash)
			if app.ConfirmConsensusRuntimeCheckpoint(f.plan.ChainID, f.old[0].Height, hash, 20) == nil || app.runtimeUpgradeCursor != nil {
				t.Fatal("current binary version substituted for engine version")
			}
			confirmRuntimeConsumer(t, app, f.plan, f.old[0])
			for nonce := uint64(2); nonce <= 4; nonce++ {
				oldHeight := app.runtimeUpgradeCursor.height
				request := runtimeConsumerRequest(t, f, nonce)
				before := app.committed
				check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: request.Txs[0]})
				if err != nil || check.Code != 0 || !reflect.DeepEqual(app.committed, before) {
					t.Fatal("CheckTx leaked or rejected historical operation", err)
				}
				prepare, err := app.PrepareProposal(context.Background(), &abci.RequestPrepareProposal{Height: request.Height, Time: request.Time, NextValidatorsHash: request.NextValidatorsHash, Txs: request.Txs, MaxTxBytes: 1 << 20})
				if err != nil || len(prepare.Txs) != 1 || !reflect.DeepEqual(app.committed, before) {
					t.Fatal("proposal candidate changed committed state", err)
				}
				process, err := app.ProcessProposal(context.Background(), &abci.RequestProcessProposal{Height: request.Height, Time: request.Time, NextValidatorsHash: request.NextValidatorsHash, Txs: prepare.Txs})
				if err != nil || process.Status != abci.ResponseProcessProposal_ACCEPT || !reflect.DeepEqual(app.committed, before) {
					t.Fatal("ProcessProposal changed committed state", err)
				}
				response, err := app.FinalizeBlock(context.Background(), request)
				if err != nil {
					t.Fatal(err)
				}
				want := f.next
				if nonce <= 3 {
					want = f.old[nonce-1]
				}
				if app.pending.AppHash != want.AppHash || app.pending.Version != want.Version || app.runtimeUpgradeCursor.height != oldHeight {
					t.Fatal("historical/new domain mismatch or Finalize advanced cursor")
				}
				if nonce <= 3 && response.ConsensusParamUpdates != nil {
					t.Fatal("old response changed")
				}
				if nonce == 4 && (response.ConsensusParamUpdates == nil || response.ConsensusParamUpdates.Version == nil || response.ConsensusParamUpdates.Version.App != 20) {
					t.Fatal("first new block omitted actual AppVersion update")
				}
				if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
				if app.runtimeUpgradeCursor.height != oldHeight {
					t.Fatal("app Commit impersonated engine Save")
				}
				if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: request.Height + 1, NextValidatorsHash: request.NextValidatorsHash}); err == nil {
					t.Fatal("next execution raced unconfirmed engine Save")
				}
				confirmRuntimeConsumer(t, app, f.plan, app.committed)
			}
			cold, err := NewPersistentApplicationWithRuntimeUpgrade(f.migration, path, f.bootstrap, nil, f.authorization)
			if err != nil || cold.runtimeUpgradeCursor != nil {
				t.Fatal("cold state self-authorized", err)
			}
			confirmRuntimeConsumer(t, cold, f.plan, app.committed)
			snapshot, err := cold.CommittedPQEngineSnapshot()
			if err != nil {
				t.Fatal(err)
			}
			prior, err := snapshot.ParamsAt(f.plan.UpgradeHeight)
			if err != nil {
				t.Fatal(err)
			}
			next, err := snapshot.ParamsAt(f.plan.UpgradeHeight + 1)
			if err != nil || prior.Version.App != f.plan.OldApplicationVersion || next.Version.App != 20 {
				t.Fatal("actual H+1 parameter boundary lost", err)
			}
		})
	}
}

func TestRuntimeConsumerUnknownKeepsOriginalPendingUntilEngineConfirmation(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	app, path := openRuntimeConsumerFixture(t, f, f.old[2])
	confirmRuntimeConsumer(t, app, f.plan, f.old[2])
	if _, err := app.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 4)); err != nil {
		t.Fatal(err)
	}
	pending := app.pending.AppHash
	app.persistenceHooks = &committedPersistenceHooks{syncDirectory: func(string) error { return errors.New("injected post-rename directory Sync failure") }}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); !errors.Is(err, ErrCommittedStateDurabilityUncertain) {
		t.Fatal("lost UNKNOWN", err)
	}
	if app.pending == nil || app.pending.AppHash != pending || app.committed.AppHash != f.plan.CheckpointAppHash || app.runtimeUpgradeCursor.height != f.plan.CheckpointHeight {
		t.Fatal("UNKNOWN advanced state or cursor")
	}
	hash, _ := hex.DecodeString(pending)
	if app.ConfirmConsensusRuntimeCheckpoint(f.plan.ChainID, f.plan.UpgradeHeight, hash, 20) == nil {
		t.Fatal("UNKNOWN pending confirmed")
	}
	app.persistenceHooks = nil
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if app.runtimeUpgradeCursor.height != f.plan.CheckpointHeight || app.committed.AppHash != pending {
		t.Fatal("retry re-executed or claimed engine durability")
	}
	confirmRuntimeConsumer(t, app, f.plan, app.committed)
	cold, err := NewPersistentApplicationWithRuntimeUpgrade(f.migration, path, f.bootstrap, nil, f.authorization)
	if err != nil || cold.committed.AppHash != pending {
		t.Fatal("cold original result lost", err)
	}
}

func TestRuntimeConsumerMergesVersionWithoutReplacingPQParams(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	app, _ := openRuntimeConsumerFixture(t, f, f.old[2])
	confirmRuntimeConsumer(t, app, f.plan, f.old[2])
	profile, err := (ynxpq.ConsensusProfile{GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.plan.ChainID, ParamsUpdateHeight: f.plan.UpgradeHeight, ActivationHeight: f.plan.UpgradeHeight + 3, ScheduleHash: bytes.Repeat([]byte{1}, 32), RegistryRoot: bytes.Repeat([]byte{2}, 32)}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	// This test checks field-preserving composition only; schedule admission and
	// independent registry authorization retain their separate real tests.
	params := &cmtproto.ConsensusParams{Validator: &cmtproto.ValidatorParams{PubKeyTypes: []string{"ed25519", "ynx_dual_pq_v2"}}, YnxProfile: profile, Block: &cmtproto.BlockParams{MaxBytes: 1024, MaxGas: -1}}
	response := &abci.ResponseFinalizeBlock{ConsensusParamUpdates: params}
	if err := app.applyRuntimeUpgradeResponse(f.plan.UpgradeHeight, response); err != nil {
		t.Fatal(err)
	}
	if response.ConsensusParamUpdates != params || params.Version.App != 20 || params.Block.MaxBytes != 1024 || len(params.Validator.PubKeyTypes) != 2 || !bytes.Equal(params.YnxProfile, profile) {
		t.Fatal("runtime replaced other update fields")
	}
	params.Version.App = 21
	if app.applyRuntimeUpgradeResponse(f.plan.UpgradeHeight, response) == nil {
		t.Fatal("conflicting version silently overwritten")
	}
}
