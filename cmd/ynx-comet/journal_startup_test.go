package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type cometJournalFixture struct {
	migration chain.ConsensusMigrationState
	bootstrap *consensus.ConsensusBootstrap
	doc       *cmttypes.GenesisDoc
	owner     string
	wires     [][]byte
	transfer  []byte
}

func newCometJournalFixture(t *testing.T) *cometJournalFixture {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{63}, 32))
	defer key.Zero()
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipientKey := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{64}, 32))
	defer recipientKey.Zero()
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	legacy := make(map[string]ed25519.PrivateKey)
	defer func() {
		for _, key := range legacy {
			clear(key)
		}
	}()
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, validator := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 81)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		hash := sha256.Sum256(public)
		address := strings.ToUpper(hex.EncodeToString(hash[:20]))
		legacy[address] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: validator.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: address})
	}
	migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	bootstrap, err := consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(hash[:]), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}, migration)
	if err != nil {
		t.Fatal(err)
	}
	f := &cometJournalFixture{migration: migration, bootstrap: bootstrap, doc: doc, owner: owner}
	for _, validator := range doc.Validators {
		candidate, pka, pkb, err := ynxconsensusauth.GenerateCandidateKey()
		if err != nil {
			t.Fatal(err)
		}
		intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(hash[:]), ChainID: doc.ChainID, ValidatorAddress: bytes.Clone(validator.Address), Sequence: 1, Epoch: 1, ApprovedAt: doc.InitialHeight, EffectiveAt: doc.InitialHeight + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(validator.PubKey.Bytes()), MLDSA87PublicKey: pka, SLHDSASHA2256fPublicKey: pkb}
		a, b, err := candidate.RegistrationPossession(intent)
		candidate.Destroy()
		if err != nil {
			t.Fatal(err)
		}
		message, err := intent.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(legacy[strings.ToUpper(hex.EncodeToString(validator.Address))], message), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		f.wires = append(f.wires, tx)
	}
	tx, err := consensus.NewSignedTransfer(key, migration.Network.ChainID, recipient, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	f.transfer, err = consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *cometJournalFixture) init(t *testing.T, app *consensus.Application) {
	t.Helper()
	params := f.doc.ConsensusParams.ToProto()
	req := &abci.RequestInitChain{Time: f.doc.GenesisTime, ChainId: f.doc.ChainID, InitialHeight: f.doc.InitialHeight, ConsensusParams: &params, AppStateBytes: f.doc.AppState}
	for _, validator := range f.doc.Validators {
		key, err := cryptoenc.PubKeyToProto(validator.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: validator.Power})
	}
	if _, err := app.InitChain(context.Background(), req); err != nil {
		t.Fatal(err)
	}
}

func cometJournalQuery(t *testing.T, app *consensus.Application, path string, target any) []byte {
	t.Helper()
	response, err := app.Query(context.Background(), &abci.RequestQuery{Path: path})
	if err != nil || response.Code != 0 {
		t.Fatal("actual application query failed", path, response, err)
	}
	if target != nil {
		if err := json.Unmarshal(response.Value, target); err != nil {
			t.Fatal(err)
		}
	}
	return bytes.Clone(response.Value)
}

func TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation(t *testing.T) {
	f := newCometJournalFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			options := pqOptions{stateLayout: layout, recoveryFD: -1}
			path := filepath.Join(t.TempDir(), "original.state")
			// Model the actual runPQNode lifetime lease, without starting a node,
			// opening a socket, or touching a validator's HRS/key files.
			lease, err := consensus.AcquireApplicationStateWriterLease(path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = lease.Close() }()
			app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, options)
			if err != nil {
				t.Fatal("normal operator helper refused original layout", err)
			}
			f.init(t, app)
			before, readErr := os.ReadFile(path)
			snapshot, err := app.CommittedPQEngineSnapshot()
			if err != nil {
				t.Fatal(err)
			}
			next, err := snapshot.ExpectedValidatorHash(f.doc.InitialHeight + 1)
			if err != nil {
				t.Fatal(err)
			}
			txs := append(append([][]byte{}, f.wires...), f.transfer, f.transfer)
			result, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, Time: f.doc.GenesisTime, NextValidatorsHash: next, Txs: txs})
			if err != nil || len(result.TxResults) != len(txs) {
				t.Fatal("actual normal helper execution failed", err)
			}
			for _, item := range result.TxResults[:len(txs)-1] {
				if item.Code != 0 {
					t.Fatal(item.Log)
				}
			}
			if result.TxResults[len(txs)-1].Code != consensus.CodeInvalidNonce {
				t.Fatal("original native nonce replay was accepted")
			}
			pending, pendingErr := os.ReadFile(path)
			if !bytes.Equal(before, pending) || os.IsNotExist(readErr) != os.IsNotExist(pendingErr) || (readErr == nil) != (pendingErr == nil) {
				t.Fatal("pending candidate changed original durable state", readErr, pendingErr)
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			stored, err := os.ReadFile(path)
			if err != nil || consensus.IsSnapshotJournal(stored) != (layout == "snapshot-journal") || consensus.IsBlockJournal(stored) != (layout == "block-journal") {
				t.Fatal("normal helper silently used another storage layout", err)
			}
			var registry consensus.ValidatorRegistryState
			registryRaw := cometJournalQuery(t, app, "/validator-registry", &registry)
			if len(registry.Events) != len(f.wires) {
				t.Fatal("complete original registration history missing")
			}
			schedule, err := consensus.NewPQEngineSchedule(f.bootstrap, &registry, f.doc.InitialHeight, f.doc.InitialHeight+4)
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
			authorization, err := consensus.NewPQEngineAuthorization(raw, pin)
			if err != nil {
				t.Fatal(err)
			}
			for h := schedule.AuthorizedAt; h <= schedule.ActivationHeight+1; h++ {
				if err = lease.Close(); err != nil {
					t.Fatal(err)
				}
				lease, err = consensus.AcquireApplicationStateWriterLease(path)
				if err != nil {
					t.Fatal(err)
				}
				app, err = newOperatorApplication(f.migration, path, f.bootstrap, authorization, options)
				if err != nil {
					t.Fatal("cold normal helper lost independent journal authority", err)
				}
				if duplicate, err := consensus.AcquireApplicationStateWriterLease(path); err == nil {
					_ = duplicate.Close()
					t.Fatal("original writer lease did not exclude another writer")
				}
				info, err := app.Info(context.Background(), &abci.RequestInfo{})
				if err != nil || info.LastBlockHeight != h-1 || !bytes.Equal(info.LastBlockAppHash, result.AppHash) {
					t.Fatal("cold helper changed original committed H/AppHash", err)
				}
				if !bytes.Equal(registryRaw, cometJournalQuery(t, app, "/validator-registry", nil)) {
					t.Fatal("cold helper altered original full registration wires")
				}
				snapshot, err = app.CommittedPQEngineSnapshot()
				if err != nil {
					t.Fatal(err)
				}
				next, err = snapshot.ExpectedValidatorHash(h + 1)
				if err != nil {
					t.Fatal(err)
				}
				result, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: f.doc.GenesisTime.Add(time.Duration(h) * time.Second), NextValidatorsHash: next})
				if err != nil {
					t.Fatal(err)
				}
				if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
			}
			cold, err := newOperatorApplication(f.migration, path, f.bootstrap, authorization, options)
			if err != nil {
				t.Fatal(err)
			}
			var account chain.Account
			cometJournalQuery(t, cold, "/accounts/"+f.owner, &account)
			if account.Nonce != 1 || account.Balance != 992 {
				t.Fatal("cold helper changed original value/fee/nonce", account.Balance, account.Nonce)
			}
			t.Logf("normalOperatorLayout=%s actualCommitAndColdRecovery=true", layout)
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if bad, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, options); err == nil || bad != nil {
				t.Fatal("stored schedule replaced its independent operator authorization")
			}
			changedSchedule := *schedule
			changedSchedule.ActivationHeight++
			changedSchedule.ValidatorUpdateHeight++
			changedRaw, err := json.Marshal(changedSchedule)
			if err != nil {
				t.Fatal(err)
			}
			changedPin, err := changedSchedule.Hash()
			if err != nil {
				t.Fatal(err)
			}
			changedAuthorization, err := consensus.NewPQEngineAuthorization(changedRaw, changedPin)
			if err != nil {
				t.Fatal("negative must supply a valid separately pinned schedule", err)
			}
			if bad, err := newOperatorApplication(f.migration, path, f.bootstrap, changedAuthorization, options); err == nil || bad != nil {
				t.Fatal("a different valid schedule replaced the committed original")
			}
			genesis, err := cmtjson.Marshal(f.doc)
			if err != nil {
				t.Fatal(err)
			}
			genesis = append(genesis, '\n')
			genesisHash := sha256.Sum256(genesis)
			changedBootstrap, err := consensus.NewConsensusBootstrap(genesis, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(genesisHash[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}, f.migration)
			if err != nil {
				t.Fatal("negative must supply another independently pinned raw genesis", err)
			}
			if bad, err := newOperatorApplication(f.migration, path, changedBootstrap, authorization, options); err == nil || bad != nil {
				t.Fatal("another raw genesis substituted for the original registry anchor")
			}
			wrong := options
			wrong.stateLayout = "atomic-json"
			if layout == "atomic-json" {
				wrong.stateLayout = "snapshot-journal"
			}
			if bad, err := newOperatorApplication(f.migration, path, f.bootstrap, authorization, wrong); err == nil || bad != nil {
				t.Fatal("wrong layout silently selected another decoder")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("refused authority/layout changed original state", err)
			}
			if layout != "atomic-json" {
				broken := append(bytes.Clone(original), 0x01)
				if err := os.WriteFile(path, broken, 0600); err != nil {
					t.Fatal(err)
				}
				if bad, err := newOperatorApplication(f.migration, path, f.bootstrap, authorization, options); err == nil || bad != nil {
					t.Fatal("normal operator helper repaired an incomplete authorized journal")
				}
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(after, broken) {
					t.Fatal("refused incomplete source was truncated or reset", err)
				}
			}
		})
	}
}

func TestCometJournalLayoutOptionsNeverFallBackToStockOrAtomic(t *testing.T) {
	if (pqOptions{recoveryFD: -1}).enabled() || (pqOptions{stateLayout: "atomic-json", recoveryFD: -1}).enabled() {
		t.Fatal("stock default changed")
	}
	for _, layout := range []string{"snapshot-journal", "block-journal", "auto", " block-journal"} {
		options := pqOptions{stateLayout: layout, recoveryFD: -1}
		if !options.enabled() || options.validate() == nil {
			t.Fatal("explicit storage selection bypassed independent pins and custody")
		}
	}
	f := newCometJournalFixture(t)
	for _, layout := range []string{"auto", " block-journal", "block-journal ", "unknown"} {
		path := filepath.Join(t.TempDir(), "must-not-exist")
		app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, pqOptions{stateLayout: layout})
		if err == nil || app != nil {
			t.Fatal("unknown layout accepted")
		}
		for _, name := range []string{path, path + ".lock", path + ".read.lock", path + ".writer.lock"} {
			if _, err := os.Lstat(name); !os.IsNotExist(err) {
				t.Fatal("invalid layout touched original state or locks", err)
			}
		}
	}
}

func TestCometJournalRuntimeAndCustodyModesRetainIndependentConfiguration(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		base := pqOptions{stateLayout: layout, migration: "original-migration.json", state: "original-state", genesisHash: "genesis-pin", originalGenesisHash: "native-pin", migrationHash: "migration-pin", recoveryFD: -1, runtimePlan: "independent-runtime.json", runtimePlanHash: "runtime-pin"}
		for _, mode := range []string{"runtime-only", "local", "remote"} {
			t.Run(layout+"/"+mode, func(t *testing.T) {
				options := base
				if mode != "runtime-only" {
					options.schedule, options.scheduleHash, options.binding = "schedule.json", "schedule-pin", "binding.json"
					if mode == "local" {
						options.vault, options.recoveryFD = "original.vault", 3
					} else {
						options.remoteAddress, options.transportKey, options.peerPin = "tcp://127.0.0.1:27701", "original.transport", "full-peer.pub"
					}
				}
				if !options.enabled() || options.validate() != nil || options.runtimeOnly() != (mode == "runtime-only") {
					t.Fatal("original explicit mode lost its selected application layout")
				}
				for _, mutate := range []func(*pqOptions){
					func(p *pqOptions) { p.genesisHash = "" },
					func(p *pqOptions) { p.originalGenesisHash = "" },
					func(p *pqOptions) { p.migrationHash = "" },
					func(p *pqOptions) { p.runtimePlanHash = "" },
					func(p *pqOptions) { p.stateLayout = "unknown" },
				} {
					bad := options
					mutate(&bad)
					if bad.validate() == nil {
						t.Fatal("layout selection bypassed original pins/runtime/custody validation")
					}
				}
			})
		}
	}
}

func TestCometJournalRuntimePlanRefusesBeforeOpeningOriginalState(t *testing.T) {
	f := newCometJournalFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		for _, mode := range []string{"missing_pin", "wrong_pin", "invalid_plan"} {
			t.Run(layout+"/"+mode, func(t *testing.T) {
				directory := t.TempDir()
				path := filepath.Join(directory, "must-not-exist.state")
				planPath := filepath.Join(directory, "untrusted-plan.json")
				wire := []byte(`{}`)
				if err := os.WriteFile(planPath, wire, 0600); err != nil {
					t.Fatal(err)
				}
				digest := sha256.Sum256(wire)
				pin := hex.EncodeToString(digest[:])
				if mode == "missing_pin" {
					pin = ""
				} else if mode == "wrong_pin" {
					pin = strings.Repeat("ab", 32)
				}
				options := pqOptions{stateLayout: layout, runtimePlan: planPath, runtimePlanHash: pin}
				if app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, options); err == nil || app != nil {
					t.Fatal("invalid runtime configuration reached a normal writer")
				}
				for _, name := range []string{path, path + ".lock", path + ".read.lock", path + ".writer.lock"} {
					if _, err := os.Lstat(name); !os.IsNotExist(err) {
						t.Fatal("runtime refusal opened state or locks", err)
					}
				}
			})
		}
	}
}
