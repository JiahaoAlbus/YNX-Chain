package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
)

func invoiceAuthorizationFor(t *testing.T, a *Application) (*PQInvoiceAuthorization, *PQInvoiceSchedule) {
	t.Helper()
	s := &PQInvoiceSchedule{Version: 1, ChainID: a.bootstrap.record.ChainID, NativeChainID: a.migration.Network.ChainID, CometGenesisSHA256: a.bootstrap.record.CometGenesisSHA256, OriginalGenesisHash: a.migration.OriginalGenesisHash, MigrationStateHash: a.migration.StateHash, PreviousHeight: a.committed.Height, PreviousAppHash: a.committed.AppHash, AuthorizedAt: a.committed.Height + 1, ActivationHeight: a.committed.Height + 3}
	return invoiceAuthorizationFrom(t, s), s
}

func invoiceAuthorizationFrom(t *testing.T, s *PQInvoiceSchedule) *PQInvoiceAuthorization {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := s.Hash()
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewPQInvoiceAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func openInvoiceTestApplication(f *validatorRegistryFixture, path, layout string, auth *PQInvoiceAuthorization) (*Application, error) {
	if auth != nil {
		if layout == "snapshot-journal" {
			return NewJournaledApplicationWithInvoiceAuthorization(f.migration, path, f.bootstrap, nil, nil, auth)
		}
		return NewPersistentApplicationWithInvoiceAuthorization(f.migration, path, f.bootstrap, nil, nil, auth)
	}
	if layout == "snapshot-journal" {
		return NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
	}
	return NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
}

func invoiceCommitEmpty(t *testing.T, a *Application) {
	t.Helper()
	_, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: a.committed.Height + 1, NextValidatorsHash: bytes.Clone(a.bootstrap.validatorSetHash)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func TestPQInvoiceScheduleNormalPersistenceActivationAndColdPins(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal"} {
		t.Run(layout, func(t *testing.T) {
			ctx := context.Background()
			path := filepath.Join(t.TempDir(), "original.state")
			a, err := openInvoiceTestApplication(f, path, layout, nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.InitChain(ctx, f.initRequest(t)); err != nil {
				t.Fatal(err)
			}
			invoiceCommitEmpty(t, a)
			if a.committed.InvoiceLedger != nil || a.committed.Version != CommittedStateVersion || a.committed.AppHash != f.migration.StateHash {
				t.Fatal("default mode changed original empty-block hash domain")
			}
			old, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			oldJSON := mustJSON(t, a.committed)
			if bytes.Contains(oldJSON, []byte(`"invoiceLedger"`)) {
				t.Fatal("disabled ledger altered legacy serialization")
			}
			auth, s := invoiceAuthorizationFor(t, a)
			a, err = openInvoiceTestApplication(f, path, layout, auth)
			if err != nil {
				t.Fatal(err)
			}
			// Replacing a public authorization value is legal from another Go
			// package; it must not change the already-owned startup capability.
			originalAuthorization := *auth
			replacement := *s
			replacement.ActivationHeight++
			*auth = *invoiceAuthorizationFrom(t, &replacement)
			for _, phase := range []string{"check", "prepare", "process"} {
				switch phase {
				case "check":
					if r, e := a.CheckTx(ctx, &abci.RequestCheckTx{Tx: []byte("invalid")}); e != nil || r.Code == 0 {
						t.Fatal("invalid transaction accepted", e)
					}
				case "prepare":
					if _, e := a.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: s.AuthorizedAt, NextValidatorsHash: bytes.Clone(a.bootstrap.validatorSetHash)}); e != nil {
						t.Fatal(e)
					}
				case "process":
					if r, e := a.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: s.AuthorizedAt, NextValidatorsHash: bytes.Clone(a.bootstrap.validatorSetHash)}); e != nil || r.Status != abci.ResponseProcessProposal_ACCEPT {
						t.Fatal(r, e)
					}
				}
				if !bytes.Equal(mustJSON(t, a.committed), oldJSON) || a.pending != nil {
					t.Fatal("simulation committed the invoice schedule", phase)
				}
			}
			if _, err = a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: s.AuthorizedAt, NextValidatorsHash: bytes.Clone(a.bootstrap.validatorSetHash)}); err != nil {
				t.Fatal(err)
			}
			if a.pending.Version != PQInvoiceLedgerStateVersion || a.pending.InvoiceLedger == nil || !reflect.DeepEqual(a.pending.InvoiceLedger.Schedule, s) || a.committed.InvoiceLedger != nil {
				t.Fatal("schedule was not isolated at the exact authorization block")
			}
			if got, _ := os.ReadFile(path); !bytes.Equal(old, got) {
				t.Fatal("Finalize changed durable original before Commit")
			}
			if _, err = a.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			*auth = originalAuthorization
			if a.committed.AppHash == s.PreviousAppHash {
				t.Fatal("invoice schedule absent from committed hash")
			}
			captured := a.cloneExecutionState()
			captured.invoiceLedger.Schedule.ActivationHeight++
			if a.committed.InvoiceLedger.Schedule.ActivationHeight != s.ActivationHeight {
				t.Fatal("candidate clone aliases committed schedule")
			}
			for a.committed.Height < s.ActivationHeight {
				invoiceCommitEmpty(t, a)
			}
			if err = a.committed.Validate(f.migration); err != nil {
				t.Fatal(err)
			}
			cold, err := openInvoiceTestApplication(f, path, layout, auth)
			if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, a.committed)) {
				t.Fatal("cold invoice recovery drift", err)
			}
			invoiceCommitEmpty(t, cold)
			original, _ := os.ReadFile(path)
			if _, err = openInvoiceTestApplication(f, path, layout, nil); err == nil {
				t.Fatal("cold ledger self-authorized without independent pin")
			}
			wrong := *s
			wrong.ActivationHeight++
			if _, err = openInvoiceTestApplication(f, path, layout, invoiceAuthorizationFrom(t, &wrong)); err == nil {
				t.Fatal("cold ledger accepted replacement schedule")
			}
			if after, _ := os.ReadFile(path); !bytes.Equal(original, after) {
				t.Fatal("rejected cold recovery changed original state")
			}
		})
	}
}

func TestPQInvoiceRuntimeBoundaryRetainsEngineCheckpointAndAppVersion(t *testing.T) {
	for _, version := range []int{12, 13} {
		t.Run(strconv.Itoa(version), func(t *testing.T) {
			f := newRuntimeUpgradeFixture(t, version)
			path := filepath.Join(t.TempDir(), "old-original.json")
			previous := f.old[len(f.old)-1]
			if err := saveCommittedState(path, previous, f.migration); err != nil {
				t.Fatal(err)
			}
			s := &PQInvoiceSchedule{Version: 1, ChainID: f.plan.ChainID, NativeChainID: f.plan.NativeChainID, CometGenesisSHA256: f.plan.CometGenesisSHA256, OriginalGenesisHash: f.plan.OriginalGenesisHash, MigrationStateHash: f.plan.MigrationStateHash, PreviousHeight: previous.Height, PreviousAppHash: previous.AppHash, AuthorizedAt: f.plan.UpgradeHeight, ActivationHeight: f.plan.UpgradeHeight}
			auth := invoiceAuthorizationFrom(t, s)
			original, _ := os.ReadFile(path)
			if _, err := NewPersistentApplicationWithInvoiceAuthorization(f.migration, path, f.bootstrap, nil, nil, auth); err == nil {
				t.Fatal("invoice pin bypassed required old-runtime authorization")
			}
			a, err := NewPersistentApplicationWithInvoiceAuthorization(f.migration, path, f.bootstrap, nil, f.authorization, auth)
			if err != nil {
				t.Fatal(err)
			}
			request := runtimeConsumerRequest(t, f, 4)
			if _, err = a.FinalizeBlock(context.Background(), request); err == nil || a.pending != nil {
				t.Fatal("invoice pin bypassed actual runtime engine checkpoint")
			}
			if after, _ := os.ReadFile(path); !bytes.Equal(original, after) {
				t.Fatal("unconfirmed runtime changed old checkpoint")
			}
			confirmRuntimeConsumer(t, a, f.plan, previous)
			response, err := a.FinalizeBlock(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			if response.ConsensusParamUpdates == nil || response.ConsensusParamUpdates.Version == nil || response.ConsensusParamUpdates.Version.App != 20 || a.pending.Version != 21 || a.pending.InvoiceLedger == nil || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce {
				t.Fatal("invoice activation changed normal runtime/transaction response")
			}
			if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			confirmRuntimeConsumer(t, a, f.plan, a.committed)
			if a.runtimeUpgradeCursor.height != a.committed.Height {
				t.Fatal("runtime cursor did not confirm new invoice schema")
			}
			cold, err := NewPersistentApplicationWithInvoiceAuthorization(f.migration, path, f.bootstrap, nil, f.authorization, auth)
			if err != nil {
				t.Fatal(err)
			}
			info, err := cold.Info(context.Background(), &abci.RequestInfo{})
			if err != nil || info.AppVersion != 20 || info.LastBlockHeight != s.AuthorizedAt || cold.runtimeUpgradeCursor != nil {
				t.Fatal("invoice cold restore self-authorized or changed AppVersion", err)
			}
			confirmRuntimeConsumer(t, cold, f.plan, cold.committed)
			if _, err = cold.FinalizeBlock(context.Background(), runtimeConsumerRequest(t, f, 5)); err != nil {
				t.Fatal("runtime cold continuation with invoice schema", err)
			}
		})
	}
}

func TestPQInvoiceScheduleCoexistsWithOriginalPQActivationAndFreshSigningSource(t *testing.T) {
	r := newPQReadFixture(t, "snapshot-journal")
	invoice, _ := invoiceAuthorizationFor(t, r.app)
	app, err := NewJournaledApplicationWithInvoiceAuthorization(r.f.migration, r.path, r.f.bootstrap, r.auth, nil, invoice)
	if err != nil {
		t.Fatal(err)
	}
	r.app = app
	source, err := NewPQEngineFileSource(r.f.migration, r.path, r.f.bootstrap, r.auth)
	if err != nil {
		t.Fatal(err)
	}
	for h := r.schedule.AuthorizedAt; h <= r.schedule.ActivationHeight+1; h++ {
		snapshot, err := r.app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		next, err := snapshot.ExpectedValidatorHash(h + 1)
		if err != nil {
			t.Fatal(err)
		}
		response, err := r.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, NextValidatorsHash: next})
		if err != nil {
			t.Fatal(err)
		}
		if h == r.schedule.ParamsUpdateHeight && (response.ConsensusParamUpdates == nil || len(response.ConsensusParamUpdates.Validator.PubKeyTypes) != 2) {
			t.Fatal("invoice dropped original PQ allowlist update")
		}
		if h == r.schedule.ValidatorUpdateHeight && len(response.ValidatorUpdates) != len(r.f.bootstrap.record.Members) {
			t.Fatal("invoice dropped original full-key validator update")
		}
		if _, err = r.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		if r.app.committed.Version != 21 || r.app.committed.InvoiceLedger == nil || r.app.committed.PQEngineSchedule == nil {
			t.Fatal("one independent schedule replaced the other")
		}
		r.read(t, source)
	}
	if _, err = NewJournaledApplicationWithInvoiceAuthorization(r.f.migration, r.path, r.f.bootstrap, nil, nil, invoice); err == nil {
		t.Fatal("invoice pin substituted for independent consensus PQ schedule")
	}
	if _, err = NewJournaledApplicationWithInvoiceAuthorization(r.f.migration, r.path, r.f.bootstrap, r.auth, nil, invoice); err != nil {
		t.Fatal("combined authorized journal cold restore", err)
	}
}

func TestPQInvoiceScheduleRejectsWrongAnchorMissedHeightAndUnsupportedLayout(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	a, err := openInvoiceTestApplication(f, path, "atomic-json", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.InitChain(context.Background(), f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	invoiceCommitEmpty(t, a)
	auth, s := invoiceAuthorizationFor(t, a)
	original, _ := os.ReadFile(path)
	for name, change := range map[string]func(*PQInvoiceSchedule){
		"apphash":        func(s *PQInvoiceSchedule) { s.PreviousAppHash = strings.Repeat("a", 64) },
		"native-genesis": func(s *PQInvoiceSchedule) { s.OriginalGenesisHash = strings.Repeat("b", 64) },
		"comet-genesis":  func(s *PQInvoiceSchedule) { s.CometGenesisSHA256 = strings.Repeat("c", 64) },
		"migration":      func(s *PQInvoiceSchedule) { s.MigrationStateHash = strings.Repeat("d", 64) },
		"future":         func(s *PQInvoiceSchedule) { s.PreviousHeight++; s.AuthorizedAt++; s.ActivationHeight++ },
	} {
		t.Run(name, func(t *testing.T) {
			bad := *s
			change(&bad)
			if _, err := openInvoiceTestApplication(f, path, "atomic-json", invoiceAuthorizationFrom(t, &bad)); err == nil {
				t.Fatal("wrong anchor accepted")
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(original, after) {
				t.Fatal("rejected anchor changed original")
			}
		})
	}
	missing := filepath.Join(t.TempDir(), "absent", "state")
	if _, err = NewJournaledApplicationWithInvoiceAuthorization(f.migration, missing, f.bootstrap, nil, nil, auth); err == nil {
		t.Fatal("invoice journal created substitute prior state")
	}
	if _, err = os.Lstat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Fatal("rejected invoice journal created source parent")
	}
	if _, err = newJournaledApplicationWithRuntimeAuthority(f.migration, missing, f.bootstrap, nil, nil, true, auth); err == nil {
		t.Fatal("unsupported block replay accepted")
	}
	invoiceCommitEmpty(t, a)
	if _, err = openInvoiceTestApplication(f, path, "atomic-json", auth); err == nil {
		t.Fatal("missed authorization height accepted")
	}
}

func TestPQInvoiceScheduleCanonicalPinAndGetterIsolation(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	a, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.InitChain(context.Background(), f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	auth, s := invoiceAuthorizationFor(t, a)
	raw, _ := json.Marshal(s)
	pin, _ := s.Hash()
	for name, bad := range map[string][]byte{
		"unknown":         append(append([]byte(nil), raw[:len(raw)-1]...), []byte(`,"unknown":true}`)...),
		"duplicate":       append(append([]byte(nil), raw[:len(raw)-1]...), []byte(`,"version":1}`)...),
		"trailing":        append(bytes.Clone(raw), []byte(`{}`)...),
		"whitespace":      append([]byte(" "), raw...),
		"unquoted-height": bytes.Replace(raw, []byte(`"previousHeight":"1"`), []byte(`"previousHeight":1`), 1),
	} {
		t.Run(name, func(t *testing.T) {
			if bytes.Equal(raw, bad) {
				t.Fatal("invalid fixture did not change original")
			}
			if _, err := NewPQInvoiceAuthorization(bad, pin); err == nil {
				t.Fatal("noncanonical independent schedule accepted")
			}
		})
	}
	if _, err = NewPQInvoiceAuthorization(raw, strings.Repeat("e", 64)); err == nil {
		t.Fatal("wrong external hash accepted")
	}
	copy, err := auth.Schedule()
	if err != nil {
		t.Fatal(err)
	}
	copy.ActivationHeight++
	unchanged, _ := auth.Schedule()
	if !reflect.DeepEqual(unchanged, s) {
		t.Fatal("getter changed private operator authorization")
	}
}

func TestPQInvoiceSnapshotRequiresIndependentScheduleAndRetainsLedger(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	ctx := context.Background()
	sourcePath := filepath.Join(t.TempDir(), "source.json")
	source, err := openInvoiceTestApplication(f, sourcePath, "atomic-json", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.InitChain(ctx, f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	invoiceCommitEmpty(t, source)
	prior, _ := os.ReadFile(sourcePath)
	auth, s := invoiceAuthorizationFor(t, source)
	source, err = openInvoiceTestApplication(f, sourcePath, "atomic-json", auth)
	if err != nil {
		t.Fatal(err)
	}
	invoiceCommitEmpty(t, source)
	listed, err := source.ListSnapshots(ctx, &abci.RequestListSnapshots{})
	if err != nil || len(listed.Snapshots) != 1 {
		t.Fatal(listed, err)
	}
	snapshot := listed.Snapshots[0]
	info, _ := source.Info(ctx, &abci.RequestInfo{})
	for _, mode := range []string{"absent", "wrong", "exact"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "target.json")
			if err := os.WriteFile(path, prior, 0600); err != nil {
				t.Fatal(err)
			}
			var selected *PQInvoiceAuthorization
			if mode == "exact" {
				selected = auth
			}
			if mode == "wrong" {
				wrong := *s
				wrong.ActivationHeight++
				selected = invoiceAuthorizationFrom(t, &wrong)
			}
			target, err := openInvoiceTestApplication(f, path, "atomic-json", selected)
			if err != nil {
				t.Fatal(err)
			}
			offer, err := target.OfferSnapshot(ctx, &abci.RequestOfferSnapshot{Snapshot: cloneABCSnapshot(snapshot), AppHash: info.LastBlockAppHash})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "absent" {
				if offer.Result != abci.ResponseOfferSnapshot_REJECT {
					t.Fatal("unconfigured snapshot accepted")
				}
				return
			}
			if offer.Result != abci.ResponseOfferSnapshot_ACCEPT {
				t.Fatal(offer)
			}
			var result *abci.ResponseApplySnapshotChunk
			for i := uint32(0); i < snapshot.Chunks; i++ {
				chunk, e := source.LoadSnapshotChunk(ctx, &abci.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: i})
				if e != nil {
					t.Fatal(e)
				}
				result, e = target.ApplySnapshotChunk(ctx, &abci.RequestApplySnapshotChunk{Index: i, Chunk: chunk.Chunk})
				if e != nil {
					t.Fatal(e)
				}
			}
			if mode == "wrong" {
				if result.Result == abci.ResponseApplySnapshotChunk_ACCEPT {
					t.Fatal("wrong independent pin restored ledger")
				}
				if after, _ := os.ReadFile(path); !bytes.Equal(prior, after) {
					t.Fatal("rejected snapshot changed durable original")
				}
				return
			}
			if result.Result != abci.ResponseApplySnapshotChunk_ACCEPT || !bytes.Equal(mustJSON(t, target.committed), mustJSON(t, source.committed)) {
				t.Fatal("authorized snapshot lost invoice state")
			}
			if _, err = openInvoiceTestApplication(f, path, "atomic-json", auth); err != nil {
				t.Fatal("snapshot cold restore", err)
			}
		})
	}
}
