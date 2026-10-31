//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This fixture uses four ORIGINAL disk stores and the normal durable HostSigner
// / PrivValidator / BlockExecutor. It opens no TCP port and never Node.Start.
// Its commits are synthetic test executions, not a four-process network claim.
func pqLabStoppedExportFixture(t *testing.T, root string) (PQLabNetworkPlan, PQLabExportOptions) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 3, BatchSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	p, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	planRaw, err := os.ReadFile(filepath.Join(root, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	pin := pqLabSHA(planRaw)
	_, m, b, err := loadPQLab(root, pin)
	if err != nil {
		t.Fatal(err)
	}
	corpus, err := source.WriteCorpus(filepath.Join(root, "workload"), m)
	if err != nil {
		t.Fatal(err)
	}
	persistPQLabTestCheckpoint(t, p, pin, nil)
	var registrations cmttypes.Txs
	for i := 0; i < 4; i++ {
		r, e := PreparePQLabValidatorRegistration(root, pin, i, p.InitialHeight+1)
		if e != nil {
			t.Fatal(e)
		}
		registrations = append(registrations, r.Transaction)
	}
	persistPQLabTestCheckpoint(t, p, pin, registrations)
	a, err := ActivatePQLabNetwork(root, pin)
	if err != nil {
		t.Fatal(err)
	}
	activationRaw, err := os.ReadFile(filepath.Join(root, "activation", "activation.json"))
	if err != nil {
		t.Fatal(err)
	}
	genesisRaw, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(genesisRaw)
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{migration: m, bootstrap: b, pins: p.pins(), raw: genesisRaw, doc: doc, legacy: map[string]ed25519.PrivateKey{}}
	harnesses := make([]*engineWiringHarness, 4)
	pvs := map[string]*PQTransitionPrivValidator{}
	var cleanups []func() error
	closeAll := func() {
		for i := len(cleanups) - 1; i >= 0; i-- {
			if e := cleanups[i](); e != nil {
				t.Error(e)
			}
		}
		cleanups = nil
	}
	t.Cleanup(closeAll)
	for i, n := range p.Nodes {
		legacy, e := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, p.ChainID)
		if e != nil {
			t.Fatal(e)
		}
		f.legacy[string(n.ValidatorAddress)] = ed25519.PrivateKey(legacy.Key.PrivKey.(cmted.PrivKey))
		in, e := LoadPQOperatorInputs(PQOperatorFiles{Migration: p.MigrationFile, Genesis: p.GenesisFile, State: n.StatePath, Schedule: a.ScheduleFile, ScheduleHash: a.ScheduleHash, Binding: n.HostBindingFile, Pins: p.pins()})
		if e != nil {
			t.Fatal(e)
		}
		app, e := NewPersistentApplicationWithEngineAuthorization(m, n.StatePath, b, in.Authorization)
		if e != nil {
			t.Fatal(e)
		}
		database, e := dbm.NewGoLevelDB("state", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		cleanups = append(cleanups, database.Close)
		blocks, e := dbm.NewGoLevelDB("blockstore", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		cleanups = append(cleanups, blocks.Close)
		h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(database, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: n.StatePath}
		h.proxy = startEngineTestProxy(t, app)
		cleanups = append(cleanups, h.proxy.Stop)
		harnesses[i] = h
		if _, e = h.wrapped().Load(); e != nil {
			t.Fatal(e)
		}
		registry, e := NewPQCommittedSignerRegistry(app, b)
		if e != nil {
			t.Fatal(e)
		}
		credential, e := os.ReadFile(n.RecoveryCredentialFile)
		if e != nil {
			t.Fatal(e)
		}
		host, e := ynxconsensusauth.ResumeHostSigner(n.VaultFile, credential, in.Binding, registry)
		clear(credential)
		if e != nil {
			t.Fatal(e)
		}
		cleanups = append(cleanups, host.Close)
		signer, e := host.Signer()
		if e != nil {
			t.Fatal(e)
		}
		pv, e := NewPQPrivValidator(signer, app)
		if e != nil {
			t.Fatal(e)
		}
		transition, e := NewPQTransitionPrivValidator(legacy, pv, b, in.Authorization)
		if e != nil {
			t.Fatal(e)
		}
		pvs[string(n.ValidatorAddress)] = transition
	}
	target, err := os.ReadFile(filepath.Join(root, "workload", corpus.Transactions[0].Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	successorTx, err := os.ReadFile(filepath.Join(root, "workload", corpus.Transactions[1].Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	for height := a.RegistryHeight + 1; height <= a.ActivationHeight+3; height++ {
		state, e := harnesses[0].wrapped().Load()
		if e != nil {
			t.Fatal(e)
		}
		var txs cmttypes.Txs
		if height == a.ActivationHeight+1 {
			txs = cmttypes.Txs{target}
		}
		if height == a.ActivationHeight+2 {
			txs = cmttypes.Txs{successorTx}
		}
		previous := harnesses[0].blocks.LoadSeenCommit(height - 1)
		block, e := state.MakeBlock(height, txs, previous, nil, state.Validators.GetProposer().Address)
		if e != nil {
			t.Fatal(e)
		}
		parts, e := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if e != nil {
			t.Fatal(e)
		}
		id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
		commit := &cmttypes.Commit{Height: height, BlockID: id}
		for i, member := range state.Validators.Validators {
			vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: height, BlockID: id, Timestamp: block.Time.Add(time.Second), ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(i)}
			pv := pvs[string(member.Address)]
			if e = pv.SetConsensusSigningContext(p.ChainID, height, 0, state.Validators); e != nil {
				t.Fatal(e)
			}
			proto := vote.ToProto()
			if e = pv.SignVote(p.ChainID, proto); e != nil {
				t.Fatal("normal durable original transition signing", e)
			}
			vote.Signature = proto.Signature
			if e = vote.Verify(p.ChainID, member.PubKey); e != nil {
				t.Fatal(e)
			}
			commit.Signatures = append(commit.Signatures, vote.CommitSig())
		}
		for _, h := range harnesses {
			current, e := h.wrapped().Load()
			if e != nil {
				t.Fatal(e)
			}
			h.blocks.SaveBlock(block, parts, commit)
			executor := sm.NewBlockExecutor(h.wrapped(), log.NewNopLogger(), h.proxy.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, h.blocks)
			if _, e = executor.ApplyBlock(current, id, block); e != nil {
				t.Fatal("original four-store BlockExecutor", e)
			}
		}
	}
	closeAll()
	for _, key := range f.legacy {
		clear(key)
	}
	o := PQLabExportOptions{RootDir: root, PlanSHA256: pin, ActivationSHA256: pqLabSHA(activationRaw), TransactionFile: filepath.Join(root, "workload", corpus.Transactions[0].Envelope.Path), TransactionSHA256: pqLabSHA(target), NativeWireHash: strings.TrimPrefix(corpus.Transactions[0].NativeHash, "0x"), OutputDir: filepath.Join(root, "export"), TrustingPeriod: time.Hour, MaxClockDrift: time.Minute, TrustNumerator: 1, TrustDenominator: 3}
	return p, o
}

func TestPQLabExportOriginalFourStoresNormalProofAndRefusals(t *testing.T) {
	root := os.Getenv("YNX_PQ_LAB_STOPPED_FIXTURE_ROOT")
	if root == "" {
		root = filepath.Join(pqLabWorkloadTemp(t), "lab")
	}
	p, o := pqLabStoppedExportFixture(t, root)
	before := inspectionInventory(t, p.MigrationFile, p.GenesisFile, p.Nodes[0].Home, p.Nodes[1].Home, p.Nodes[2].Home, p.Nodes[3].Home)
	result, err := ExportPQLabProof(o, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if !result.SyntheticOnly || !result.SourceReadOnly || result.StoppedNodes != 4 || result.NodeStarted || result.AuthorityGranted || result.PublicNetwork || result.TransactionHash != o.TransactionSHA256 || result.NativeWireHash != o.NativeWireHash {
		t.Fatal("exported source/evidence scope changed")
	}
	materialRaw, err := os.ReadFile(result.Materials.Path)
	if err != nil {
		t.Fatal(err)
	}
	materials, err := DecodePQLabProofMaterials(materialRaw, result.Materials.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	proofRaw, err := os.ReadFile(result.Proof.Path)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := DecodePQTransactionProofRequest(proofRaw)
	if err != nil {
		t.Fatal(err)
	}
	normal, err := WritePQLabProofInputs(filepath.Join(root, "normal-proof-context"), materials, proof, time.Now().UTC())
	if err != nil {
		t.Fatal("normal original proof-context producer", err)
	}
	if !normal.Result.ExecutionSuccessful || normal.Result.Outcome != "succeeded" || !normal.Result.Finalized || normal.AuthorityGranted {
		t.Fatal("actual original transaction proof not verified", normal.Result)
	}
	if normal.Result.TransactionType != PQWholeType || len(normal.Result.BatchResults) != 2 {
		t.Fatal("original Whole members were not individually proved", normal.Result)
	}
	single := o
	single.TransactionFile = filepath.Join(root, "workload", "transaction-0001.abci")
	singleRaw, err := os.ReadFile(single.TransactionFile)
	if err != nil {
		t.Fatal(err)
	}
	_, singleWire, err := pqTransactionWire(singleRaw)
	if err != nil {
		t.Fatal(err)
	}
	single.TransactionSHA256, single.NativeWireHash = pqLabSHA(singleRaw), pqLabSHA(singleWire)
	single.OutputDir = filepath.Join(root, "single-export")
	singleResult, err := ExportPQLabProof(single, time.Now().UTC())
	if err != nil || singleResult.TransactionHeight != result.TransactionHeight+1 || singleResult.TransactionIndex != 0 {
		t.Fatal("original N1 target/actual Comet index not preserved", err)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, p.MigrationFile, p.GenesisFile, p.Nodes[0].Home, p.Nodes[1].Home, p.Nodes[2].Home, p.Nodes[3].Home)) {
		t.Fatal("export altered original DB/App/HRS/custody bytes")
	}
	if _, err = ExportPQLabProof(o, time.Now()); err == nil {
		t.Fatal("UNKNOWN output was overwritten")
	}
	for name, change := range map[string]func(*PQLabExportOptions){
		"wrong-plan":       func(x *PQLabExportOptions) { x.PlanSHA256 = strings.Repeat("b", 64) },
		"wrong-activation": func(x *PQLabExportOptions) { x.ActivationSHA256 = strings.Repeat("c", 64) },
		"wrong-envelope":   func(x *PQLabExportOptions) { x.TransactionSHA256 = strings.Repeat("d", 64) },
		"wrong-native":     func(x *PQLabExportOptions) { x.NativeWireHash = strings.Repeat("e", 64) },
		"private-path":     func(x *PQLabExportOptions) { x.TransactionFile = p.Nodes[0].VaultFile },
		"missing-trust":    func(x *PQLabExportOptions) { x.TrustingPeriod = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			x := o
			x.OutputDir = filepath.Join(root, name)
			change(&x)
			if _, e := ExportPQLabProof(x, time.Now()); e == nil {
				t.Fatal("invalid independent input accepted")
			}
		})
	}
	for _, kind := range []string{"app-writer", "signing-writer", "database"} {
		t.Run(kind, func(t *testing.T) {
			var release func() error
			switch kind {
			case "app-writer":
				lease, e := AcquireApplicationStateWriterLease(p.Nodes[3].StatePath)
				if e != nil {
					t.Fatal(e)
				}
				release = lease.Close
			case "signing-writer":
				lease, e := existingInspectionLockFile(p.Nodes[3].SignerStateFile + ".lock")
				if e != nil {
					t.Fatal(e)
				}
				release = lease
			case "database":
				db, e := dbm.NewGoLevelDB("state", filepath.Join(p.Nodes[3].Home, "data"))
				if e != nil {
					t.Fatal(e)
				}
				release = db.Close
			}
			x := o
			x.OutputDir = filepath.Join(root, kind)
			_, e := ExportPQLabProof(x, time.Now())
			if closeErr := release(); closeErr != nil {
				t.Fatal(closeErr)
			}
			if e == nil {
				t.Fatal("fourth live original source did not refuse export")
			}
			if _, e = os.Stat(filepath.Join(x.OutputDir, "intent.json")); e != nil {
				t.Fatal("failed exclusive attempt was removed", e)
			}
			if _, e = ExportPQLabProof(x, time.Now()); e == nil {
				t.Fatal("failed original attempt retried")
			}
		})
	}
	// Corrupt a real signed successor commit on disk, preserving the exact
	// original header and transaction. The existing full AND verifier must fail.
	db, err := dbm.NewGoLevelDB("blockstore", filepath.Join(p.Nodes[0].Home, "data"))
	if err != nil {
		t.Fatal(err)
	}
	store := blockstore.NewBlockStore(db)
	commit := store.LoadSeenCommit(result.EngineHeight)
	original := append([]byte(nil), commit.Signatures[0].Signature...)
	commit.Signatures[0].Signature[len(original)-1] ^= 1
	if err = store.SaveSeenCommit(result.EngineHeight, commit); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	x := single
	x.OutputDir = filepath.Join(root, "bad-real-commit")
	if _, err = ExportPQLabProof(x, time.Now()); err == nil {
		t.Fatal("actual changed successor AND signature accepted")
	}
	db, err = dbm.NewGoLevelDB("blockstore", filepath.Join(p.Nodes[0].Home, "data"))
	if err != nil {
		t.Fatal(err)
	}
	store = blockstore.NewBlockStore(db)
	commit.Signatures[0].Signature = original
	if err = store.SaveSeenCommit(result.EngineHeight, commit); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("YNX_PQ_LAB_STOPPED_FIXTURE_ROOT") != "" {
		// Explicit local/CI fixture request only. This root contains SYNTHETIC
		// custody and must never be uploaded as a public proof artifact.
		if err = pqLabWriteJSON(filepath.Join(root, "export-options.json"), o); err != nil {
			t.Fatal(err)
		}
	}
	encoded, _ := json.Marshal(result)
	t.Logf("PQ_LAB_STOPPED_ORIGINAL_PROOF_PASS %s", encoded)
}
