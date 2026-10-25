package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

func registryQuery(t *testing.T, app *Application) *ValidatorRegistryState {
	t.Helper()
	response, err := app.Query(context.Background(), &abci.RequestQuery{Path: "/validator-registry"})
	if err != nil || response.Code != 0 {
		t.Fatalf("query registry: %+v %v", response, err)
	}
	var state *ValidatorRegistryState
	if err := json.Unmarshal(response.Value, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestValidatorRegistryRealProofCommitIsolationAndRestart(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	app := newPinnedRegistryApp(t, f, path)
	height := f.doc.InitialHeight
	first, firstWire := f.transaction(t, 0, height)
	second, secondWire := f.transaction(t, 1, height)
	ctx := context.Background()
	oldHash := app.committed.AppHash
	oldAccounts := cloneAccounts(app.committed.Accounts)
	oldLots := cloneTraceLots(app.committed.TraceLots)

	legacy, err := NewPersistentApplication(f.migration, "")
	if err != nil {
		t.Fatal(err)
	}
	check, err := legacy.CheckTx(ctx, &abci.RequestCheckTx{Tx: first})
	if err != nil || check.Code == 0 {
		t.Fatal("unconfigured old entry accepted registry")
	}
	check, err = app.CheckTx(ctx, &abci.RequestCheckTx{Tx: first})
	if err != nil || check.Code != 0 {
		t.Fatalf("real dual PoP registration rejected: %+v %v", check, err)
	}
	prepared, err := app.PrepareProposal(ctx, &abci.RequestPrepareProposal{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: height, Txs: [][]byte{first, first, second}, MaxTxBytes: int64(len(first)+len(second)) * 2})
	if err != nil || len(prepared.Txs) != 2 || !bytes.Equal(prepared.Txs[1], second) {
		t.Fatalf("duplicate candidate corrupted subsequent candidate: %+v %v", prepared, err)
	}
	processed, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: height, Txs: [][]byte{first, second}})
	if err != nil || processed.Status != abci.ResponseProcessProposal_ACCEPT {
		t.Fatalf("valid registry proposal rejected: %+v %v", processed, err)
	}
	rejected, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: height, Txs: [][]byte{first, first}})
	if err != nil || rejected.Status != abci.ResponseProcessProposal_REJECT {
		t.Fatal("duplicate operation proposal accepted")
	}
	if registryQuery(t, app) != nil || app.pending != nil || app.committed.AppHash != oldHash {
		t.Fatal("Check/Prepare/Process leaked candidate registry into committed state")
	}
	// Finalize preserves actual outer block positions even for an invalid
	// earlier transaction. PrepareProposal would omit that invalid envelope.
	result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: height, Txs: [][]byte{[]byte("invalid"), first, second}})
	if err != nil || len(result.TxResults) != 3 || result.TxResults[0].Code == 0 || result.TxResults[1].Code != 0 || result.TxResults[2].Code != 0 {
		t.Fatalf("finalize real registrations: %+v %v", result, err)
	}
	if len(result.ValidatorUpdates) != 0 || result.ConsensusParamUpdates != nil {
		t.Fatal("registration unexpectedly activated engine membership or profile")
	}
	if registryQuery(t, app) != nil || app.committed.AppHash != oldHash || app.pending == nil || app.pending.AppHash == oldHash || app.pending.Version != ValidatorRegistryStateVersion {
		t.Fatal("first registration did not isolate new hash in pending v16 state")
	}
	beforeInfo, _ := app.Info(ctx, &abci.RequestInfo{})
	if beforeInfo.LastBlockHeight == height {
		t.Fatal("Finalize AppHash was reported as committed")
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	registry := registryQuery(t, app)
	if registry == nil || len(registry.Events) != 2 {
		t.Fatal("committed full history missing")
	}
	for i, wire := range [][]byte{firstWire, secondWire} {
		event := registry.Events[i]
		op, _ := ynxconsensusauth.RegistrationHash(wire)
		payload, _ := EncodeValidatorRegistryTransaction(wire)
		if event.Index != uint64(i) || event.TransactionIndex != uint32(i+1) || event.Height != height || !bytes.Equal(event.Wire, wire) || event.OperationHash != "0x"+hex.EncodeToString(op[:]) || event.ABCIHash != SignedTransactionHash(payload) || event.ABCIHash == event.OperationHash {
			t.Fatal("registry original wire, operation hash, ABCI hash or actual block index lost")
		}
	}
	if !reflect.DeepEqual(oldAccounts, app.committed.Accounts) || !reflect.DeepEqual(oldLots, app.committed.TraceLots) {
		t.Fatal("validator registration altered native balances/nonce/lots")
	}
	if _, err := NewPersistentApplication(f.migration, path); err == nil {
		t.Fatal("cold state self-authorized bootstrap without independent pins")
	}
	reopened, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil || !reflect.DeepEqual(registryQuery(t, reopened), registry) || reopened.committed.AppHash != app.committed.AppHash {
		t.Fatalf("restart changed authenticated registry or AppHash: %v", err)
	}
	registry.Events[0].Wire[0] ^= 1
	if bytes.Equal(registry.Events[0].Wire, registryQuery(t, app).Events[0].Wire) {
		t.Fatal("Query leaked mutable original proof")
	}
	empty, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: height + 1})
	if err != nil || !bytes.Equal(empty.AppHash, result.AppHash) {
		t.Fatal("empty block changed committed registry hash")
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func TestValidatorRegistryRejectsWrongHeightAndEitherProofBranch(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	app := newPinnedRegistryApp(t, f, "")
	height := f.doc.InitialHeight
	valid, wire := f.transaction(t, 0, height)
	ctx := context.Background()
	for _, branch := range []string{"legacy", "MLDSA", "SLHDSA"} {
		reg, err := ynxconsensusauth.DecodeRegistration(wire)
		if err != nil {
			t.Fatal(err)
		}
		switch branch {
		case "legacy":
			reg.LegacyApproval[0] ^= 1
		case "MLDSA":
			reg.PossessionMLDSA87[0] ^= 1
		case "SLHDSA":
			reg.PossessionSLHDSASHA2256f[0] ^= 1
		}
		badWire, err := reg.MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := EncodeValidatorRegistryTransaction(badWire)
		check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: payload})
		if err != nil || check.Code == 0 {
			t.Fatalf("invalid %s branch accepted", branch)
		}
	}
	if _, _, err := app.applyTransaction(app.cloneExecutionState(), valid, height+1, f.doc.GenesisTime); err == nil {
		t.Fatal("ApprovedAt was not checked at actual execution height")
	}
	if _, err := DecodeValidatorRegistryTransaction(append(bytes.Clone(valid), ' ')); err == nil {
		t.Fatal("noncanonical outer bytes accepted")
	}
	if registryQuery(t, app) != nil {
		t.Fatal("rejected candidates published registry")
	}
}

func TestValidatorRegistryHistoryDeletionReorderAndBootstrapSubstitution(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	app := newPinnedRegistryApp(t, f, "")
	first, _ := f.transaction(t, 0, f.doc.InitialHeight)
	second, _ := f.transaction(t, 1, f.doc.InitialHeight)
	ctx := context.Background()
	if result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: f.doc.InitialHeight, Txs: [][]byte{first, second}}); err != nil || result.TxResults[0].Code != 0 || result.TxResults[1].Code != 0 {
		t.Fatalf("prepare committed history: %v", err)
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*CommittedState){
		"delete": func(s *CommittedState) { s.ValidatorRegistry.Events = s.ValidatorRegistry.Events[:1] },
		"reorder": func(s *CommittedState) {
			s.ValidatorRegistry.Events[0], s.ValidatorRegistry.Events[1] = s.ValidatorRegistry.Events[1], s.ValidatorRegistry.Events[0]
		},
		"wire": func(s *CommittedState) { s.ValidatorRegistry.Events[0].Wire[20] ^= 1 },
		"ABCI identity": func(s *CommittedState) {
			s.ValidatorRegistry.Events[0].ABCIHash = s.ValidatorRegistry.Events[0].OperationHash
		},
		"position": func(s *CommittedState) { s.ValidatorRegistry.Events[1].TransactionIndex = 0 },
		"power":    func(s *CommittedState) { s.ValidatorRegistry.Bootstrap.Members[0].Power++ },
		"root":     func(s *CommittedState) { s.ValidatorRegistry.Root = f.pins.CometGenesisSHA256 },
		"erase":    func(s *CommittedState) { s.ValidatorRegistry = nil },
		"version":  func(s *CommittedState) { s.Version = 15 },
	} {
		t.Run(name, func(t *testing.T) {
			state := app.committed
			state.ValidatorRegistry = cloneValidatorRegistry(state.ValidatorRegistry)
			mutate(&state)
			if err := state.Validate(f.migration); err == nil {
				t.Fatal("tampered history validated")
			}
			// Continuation detects deletion/reordering even if an attacker also
			// recomputes a self-consistent candidate root and application hash.
			if err := validateValidatorRegistryContinuation(app.committed, state); err == nil {
				t.Fatal("append-only continuation accepted changed history")
			}
		})
	}
}

func TestValidatorRegistryCommitBeforeRenameAndUnknownRecovery(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	payload, _ := f.transaction(t, 0, f.doc.InitialHeight)
	for _, phase := range []string{"before rename", "after rename"} {
		t.Run(phase, func(t *testing.T) {
			ctx := context.Background()
			path := filepath.Join(t.TempDir(), "state.json")
			app := newPinnedRegistryApp(t, f, path)
			result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: f.doc.InitialHeight, Txs: [][]byte{payload}})
			if err != nil || result.TxResults[0].Code != 0 {
				t.Fatalf("finalize: %+v %v", result, err)
			}
			originalHash, originalRoot := app.pending.AppHash, app.pending.ValidatorRegistry.Root
			injected := errors.New("injected persistence failure")
			app.persistenceHooks = &committedPersistenceHooks{}
			if phase == "before rename" {
				app.persistenceHooks.beforeRename = func() error { return injected }
			} else {
				app.persistenceHooks.syncDirectory = func(string) error { return injected }
			}
			_, err = app.Commit(ctx, &abci.RequestCommit{})
			if err == nil || !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != (phase == "after rename") {
				t.Fatalf("wrong persistence phase/error classification: %v", err)
			}
			if app.pending == nil || app.pending.AppHash != originalHash || app.pending.ValidatorRegistry.Root != originalRoot || len(app.pending.ValidatorRegistry.Events) != 1 || registryQuery(t, app) != nil {
				t.Fatal("failure lost exact pending identity or falsely published commit")
			}
			if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: f.doc.InitialHeight}); err == nil {
				t.Fatal("pending durability fence allowed duplicate execution")
			}
			if phase == "before rename" {
				if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("pre-rename failure exposed new state")
				}
			} else {
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				var visible CommittedState
				if err := json.Unmarshal(raw, &visible); err != nil || visible.AppHash != originalHash || visible.ValidatorRegistry.Root != originalRoot {
					t.Fatal("UNKNOWN disk candidate lost original identity")
				}
				calls := 0
				_, err = newPersistentApplication(f.migration, path, f.bootstrap, &committedPersistenceHooks{syncDirectory: func(string) error { calls++; return injected }})
				if !errors.Is(err, ErrCommittedStateDurabilityUncertain) || calls != 1 {
					t.Fatal("cold UNKNOWN was published without actual directory confirmation")
				}
				cold, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
				if err != nil || cold.committed.AppHash != originalHash || registryQuery(t, cold).Root != originalRoot {
					t.Fatalf("cold confirmed original root: %v", err)
				}
			}
			app.persistenceHooks = nil
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if app.pending != nil || app.committed.AppHash != originalHash || app.committed.ValidatorRegistry.Root != originalRoot || len(app.committed.ValidatorRegistry.Events) != 1 {
				t.Fatal("reconfirm reexecuted or changed original candidate")
			}
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err == nil {
				t.Fatal("completed commit was executed twice")
			}
		})
	}
}
