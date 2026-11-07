//go:build unix && ynx_public_trace_testsupport

package ynxresourcepolicy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
)

const publicObserverTraceReceipt = "11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6"

// Test-only reusable original-engine fixture. It contains no PQ/account private
// key, signs no block, starts no Node and grants no Root/Native/transport Source.
// Auth's same-package test can call openPublicTraceObserver, then its ACTUAL
// OpenLivePolicyChild(ctx, f.app, f.expected). No production reader is replaced.
type publicTraceObserver struct {
	app         *consensus.Application
	node        *node.Node
	config      *cfg.Config
	key         *p2p.NodeKey
	lease       *consensus.ApplicationStateWriterLease
	path        string
	migration   chain.ConsensusMigrationState
	bootstrap   *consensus.ConsensusBootstrap
	engine      *consensus.PQEngineAuthorization
	engineReady bool
	expected    ynxbatch.NetworkResourceConsentBinding
	receipt     consensus.PQLabFinalizeTrace
}

func publicTraceBytes(t *testing.T, path string, limit int64) []byte {
	t.Helper()
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > limit {
		t.Fatal("bounded PUBLIC original required", path, err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		t.Fatal("PUBLIC input replaced on open")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(raw)) != before.Size() {
		t.Fatal("PUBLIC input changed or exceeded bound", err)
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("PUBLIC input changed during read")
	}
	return raw
}
func publicTraceSHA(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }

func (f *publicTraceObserver) closeNode() {
	if f.node != nil {
		f.node.OnStop()
		f.node = nil
	}
}
func (f *publicTraceObserver) close() {
	f.closeNode()
	if f.key != nil {
		clear(f.key.PrivKey.Bytes())
		f.key = nil
	}
	if f.lease != nil {
		_ = f.lease.Close()
		f.lease = nil
	}
}
func (f *publicTraceObserver) reopen(t *testing.T) {
	t.Helper()
	f.closeNode()
	var app *consensus.Application
	var err error
	if f.engineReady {
		app, err = consensus.NewPersistentApplicationWithEngineAuthorization(f.migration, f.path, f.bootstrap, f.engine)
	} else {
		app, err = consensus.NewPersistentApplicationWithBootstrap(f.migration, f.path, f.bootstrap)
	}
	if err != nil {
		t.Fatal("original cold application", err)
	}
	n, err := consensus.NewPQObserverNode(f.config, app, f.key, log.NewNopLogger())
	if err != nil {
		t.Fatal("normal original observer", err)
	}
	f.app, f.node = app, n
	if n.IsRunning() || n.IsListening() || n.PrivValidator() != nil {
		t.Fatal("PUBLIC fixture started or obtained validator identity")
	}
}

func openPublicTraceObserver(t *testing.T, directory string) *publicTraceObserver {
	t.Helper()
	if directory == "" || !filepath.IsAbs(directory) {
		t.Fatal("explicit original PUBLIC trace directory required")
	}
	receiptRaw := publicTraceBytes(t, filepath.Join(directory, "result.json"), 64<<10)
	if publicTraceSHA(receiptRaw) != publicObserverTraceReceipt {
		t.Fatal("independent PUBLIC receipt pin differs")
	}
	var receipt consensus.PQLabFinalizeTrace
	if json.Unmarshal(receiptRaw, &receipt) != nil || receipt.Version != consensus.PQLabFinalizeTraceVersion || !receipt.SyntheticOnly || !receipt.SourceReadOnly || !receipt.ColdReopened || receipt.NodeStarted || receipt.AuthorityGranted || receipt.PublicNetwork || receipt.RuntimePlan != nil || receipt.RuntimePlanHash != "" || receipt.FirstHeight != 4 || receipt.LastHeight != 12 {
		t.Fatal("not the frozen PUBLIC original trajectory")
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 9 {
		t.Fatal("PUBLIC trace closed nine-file catalogue", err)
	}
	allowed := map[string]bool{"result.json": true, "intent.json": true, "migration.json": true, "genesis.json": true, "schedule.json": true, "init-chain.pb": true, "initial-state.json": true, "final-state.json": true, "records.jsonl": true}
	for _, e := range entries {
		if !allowed[e.Name()] || !e.Type().IsRegular() {
			t.Fatal("foreign PUBLIC trace entry")
		}
	}
	originals := map[string][]byte{}
	for _, part := range []consensus.PQLabFinalizeTraceFile{receipt.Migration, receipt.Genesis, receipt.Schedule, receipt.InitChain, receipt.InitialState, receipt.FinalState, receipt.Records} {
		if !allowed[part.Name] || part.Name == "result.json" || part.Name == "intent.json" || originals[part.Name] != nil {
			t.Fatal("PUBLIC trace role substitution")
		}
		raw := publicTraceBytes(t, filepath.Join(directory, part.Name), 16<<20)
		if int64(len(raw)) != part.Bytes || publicTraceSHA(raw) != part.SHA256 {
			t.Fatal("PUBLIC role bytes differ", part.Name)
		}
		originals[part.Name] = raw
	}
	var migration chain.ConsensusMigrationState
	if json.Unmarshal(originals["migration.json"], &migration) != nil || migration.Network.IsPublicNet || migration.Network.ChainID != consensus.PQLabNativeChainID {
		t.Fatal("PUBLIC migration required")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(originals["genesis.json"], receipt.Pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := consensus.NewPQEngineAuthorization(originals["schedule.json"], receipt.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	var schedule consensus.PQEngineSchedule
	if json.Unmarshal(originals["schedule.json"], &schedule) != nil || schedule.RegistryHeight != 5 || schedule.AuthorizedAt != 6 {
		t.Fatal("frozen original schedule boundary differs")
	}
	var final struct{ AccountPolicy ynxauth.State }
	if json.Unmarshal(originals["final-state.json"], &final) != nil || len(final.AccountPolicy.Records) != 1 {
		t.Fatal("frozen PUBLIC registration missing")
	}
	registered := final.AccountPolicy.Records[0]
	expected := ynxbatch.NetworkResourceConsentBinding{NetworkID: bytes.Clone(final.AccountPolicy.NetworkID), Owner: registered.Owner, KeyEpoch: strconv.FormatUint(registered.Revision, 10), IssuedHeight: strconv.FormatUint(registered.ActiveFrom, 10), PKA: bytes.Clone(registered.PKA), PKB: bytes.Clone(registered.PKB)}
	home := t.TempDir()
	if err = os.Chmod(home, 0700); err != nil {
		t.Fatal(err)
	}
	configuration := cfg.DefaultConfig().SetRoot(home)
	configuration.TxIndex.Indexer, configuration.RPC.ListenAddress, configuration.RPC.PprofListenAddress = "null", "", ""
	configuration.P2P.PexReactor = false
	configuration.Storage.DiscardABCIResponses = false
	if err = os.MkdirAll(filepath.Dir(configuration.GenesisFile()), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(configuration.GenesisFile(), originals["genesis.json"], 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "application", "state")
	// The ordinary startup contract consumes an already initialized original
	// application. Use its real offline initializer, not a copied final ledger
	// or a fabricated engine/AppHash checkpoint.
	if _, err = consensus.InitializeApplication(migration, originals["genesis.json"], receipt.Pins, consensus.ApplicationInitializationOptions{StatePath: path, StateLayout: "atomic-json"}); err != nil {
		t.Fatal("normal original application initializer", err)
	}
	lease, err := consensus.AcquireApplicationStateWriterLease(path)
	if err != nil {
		t.Fatal(err)
	}
	// A publicly known, fixed, TEST-ONLY transport identity, never used to sign
	// a vote/account message or start networking. No production identity borrowed.
	seed := sha256.Sum256([]byte("YNX PUBLIC OBSERVER TRACE TEST TRANSPORT ONLY/v1"))
	key := &p2p.NodeKey{PrivKey: cmted.PrivKey(ed25519.NewKeyFromSeed(seed[:]))}
	clear(seed[:])
	f := &publicTraceObserver{config: configuration, key: key, lease: lease, path: path, migration: migration, bootstrap: bootstrap, engine: engine, expected: expected, receipt: receipt}
	t.Cleanup(f.close)
	f.reopen(t) // Actual normal handshake creates the engine genesis state.
	if raw := publicTraceBytes(t, path, 16<<20); !bytes.Equal(raw, originals["initial-state.json"]) {
		t.Fatal("normal handshake initial full state differs")
	}
	environment, err := f.node.ConfigureRPC()
	if err != nil {
		t.Fatal(err)
	}
	executor := sm.NewBlockExecutor(environment.StateStore, log.NewNopLogger(), f.node.ProxyApp().Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, f.node.BlockStore())
	scanner := bufio.NewScanner(bytes.NewReader(originals["records.jsonl"]))
	scanner.Buffer(make([]byte, 64<<10), 16<<20)
	height := receipt.FirstHeight
	andRefusals := false
	for scanner.Scan() {
		var row consensus.PQLabFinalizeTraceRecord
		if json.Unmarshal(scanner.Bytes(), &row) != nil || row.Height != height || height > receipt.LastHeight {
			t.Fatal("PUBLIC block gap/order")
		}
		var bp cmtproto.Block
		if err = bp.Unmarshal(row.Block); err != nil {
			t.Fatal(err)
		}
		block, err := cmttypes.BlockFromProto(&bp)
		if err != nil {
			t.Fatal(err)
		}
		lb, err := consensus.DecodePQTrustedLightBlock(row.LightBlock)
		if err != nil {
			t.Fatal(err)
		}
		state, err := environment.StateStore.Load()
		if err != nil {
			t.Fatal("actual authenticated engine state", err)
		}
		if err = lb.ValidateBasic(state.ChainID); err != nil {
			t.Fatal(err)
		}
		if block.Height != height || lb.Height != height || !bytes.Equal(block.Hash(), lb.Hash()) || !bytes.Equal(state.Validators.Hash(), lb.ValidatorSet.Hash()) {
			t.Fatal("PUBLIC current block/full validator set mismatch")
		}
		parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if err != nil {
			t.Fatal(err)
		}
		id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
		// Verify the CURRENT commit with the real normal engine's bound full
		// validator set. ApplyBlock below independently verifies the previous commit.

		if !andRefusals && len(lb.Commit.Signatures) > 0 && len(lb.Commit.Signatures[0].Signature) == ynxconsensusauth.EnvelopeSize {
			for _, branch := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
				envelope, err := ynxconsensusauth.ParseEnvelope(lb.Commit.Signatures[0].Signature)
				if err != nil {
					t.Fatal(err)
				}
				if branch == "ML-DSA-87" {
					envelope.MLDSA87[0] ^= 1
				} else {
					envelope.SLHDSASHA2256f[0] ^= 1
				}
				corrupted, err := envelope.MarshalBinary()
				if err != nil {
					t.Fatal(err)
				}
				proto := lb.Commit.ToProto()
				proto.Signatures[0].Signature = corrupted
				bad, err := cmttypes.CommitFromProto(proto)
				if err != nil {
					t.Fatal(err)
				}
				if err = state.Validators.VerifyCommit(state.ChainID, id, height, bad); err == nil {
					t.Fatal("normal observer admitted one invalid AND branch", branch)
				}
			}
			andRefusals = true
		}
		if err = state.Validators.VerifyCommit(state.ChainID, id, height, lb.Commit); err != nil {
			t.Fatal("original BFT current commit rejected", height, err)
		}
		f.node.BlockStore().SaveBlock(block, parts, lb.Commit)
		if _, err = executor.ApplyBlock(state, id, block); err != nil {
			t.Fatal("original BlockExecutor rejected", height, err)
		}
		response, err := environment.StateStore.LoadFinalizeBlockResponse(height)
		if err != nil {
			t.Fatal(err)
		}
		actualResponse, err := response.Marshal()
		if err != nil || !bytes.Equal(actualResponse, row.Response) {
			t.Fatal("normal complete response differs", height, err)
		}
		actualState := publicTraceBytes(t, path, 16<<20)
		if int64(len(actualState)) != row.StateBytes || publicTraceSHA(actualState) != row.StateSHA256 {
			t.Fatal("normal complete state differs", height)
		}
		next, err := environment.StateStore.Load()
		if err != nil || next.LastBlockHeight != height || hex.EncodeToString(next.AppHash) != row.AppHash {
			t.Fatal("actual persisted engine checkpoint differs", height, err)
		}
		if height == schedule.RegistryHeight {
			// Follow the actual operator transition: first execute registration
			// blocks under bootstrap, then cold-open the SAME real stores with
			// the independent authorization at its exact committed height.
			f.engineReady = true
			f.reopen(t)
			environment, err = f.node.ConfigureRPC()
			if err != nil {
				t.Fatal(err)
			}
			executor = sm.NewBlockExecutor(environment.StateStore, log.NewNopLogger(), f.node.ProxyApp().Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, f.node.BlockStore())
		}
		height++
	}
	if scanner.Err() != nil || height != receipt.LastHeight+1 || !andRefusals {
		t.Fatal("PUBLIC trace incomplete", scanner.Err())
	}
	if raw := publicTraceBytes(t, path, 16<<20); !bytes.Equal(raw, originals["final-state.json"]) {
		t.Fatal("normal final full state differs")
	}
	// The construction-time consensus state was intentionally not advanced by
	// test pointer mutation. Close actual stores and let the NORMAL cold ctor load
	// their executed checkpoint into consensus state before any live-policy read.
	f.reopen(t)
	return f
}

func TestResourcePolicyPUBLICRegisteredObserverTrace(t *testing.T) {
	fixture := openPublicTraceObserver(t, os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE"))
	parent, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	source, err := fixture.app.WalletPolicyLiveSource()
	if err != nil {
		t.Fatal(err)
	}
	child, err := OpenLivePolicyChild(parent, fixture.app, fixture.expected)
	if err != nil {
		t.Fatal("actual original Auth factory", err)
	}
	defer child.Close()
	started := time.Now().UnixMilli()
	data, err := child.Read()
	if err != nil || data.ExecutionHeight != uint64(fixture.receipt.LastHeight+1) || data.SubjectOwner != fixture.expected.Owner || data.NowMillis < started || data.NowMillis > time.Now().UnixMilli() {
		t.Fatal("actual Auth positive Current4 read", err)
	}
	before := bytes.Clone(data.PolicyOriginal)
	if err = child.Current(); err != nil {
		t.Fatal("actual Auth fresh Current", err)
	}
	bad := fixture.expected
	bad.PKB = bytes.Clone(bad.PKB)
	bad.PKB[0] ^= 1
	wrong, err := OpenLivePolicyChild(parent, fixture.app, bad)
	if err != nil {
		t.Fatal("well-shaped wrong full pair must reach actual qualification", err)
	}
	if out, err := wrong.Read(); err == nil || out.SubjectOwner != "" || len(out.PolicyOriginal) != 0 {
		t.Fatal("wrong independent full pair admitted")
	}
	if err = wrong.Close(); !errors.Is(err, ErrCurrent) || !wrong.Drained() {
		t.Fatal("failed Auth child lost first cause or physical drain", err)
	}
	if err = child.Retire(); err != nil {
		t.Fatal(err)
	}
	if err = child.Join(); err != nil || !child.Drained() {
		t.Fatal("actual successful Auth child did not drain", err)
	}
	if out, err := child.Read(); !errors.Is(err, ErrLiveChildRetired) || out.SubjectOwner != "" || len(out.PolicyOriginal) != 0 {
		t.Fatal("retired child remained usable", err)
	}
	if read, err := source.Read(parent, fixture.expected.Owner); err != nil || read == nil {
		t.Fatal("Auth child close incorrectly closed shared Core source", err)
	}
	fixture.reopen(t)
	if out, err := source.Read(context.Background(), fixture.expected.Owner); !errors.Is(err, consensus.ErrPQWalletPolicyLiveRetired) || out != nil {
		t.Fatal("original source survived owner retirement", err)
	}
	cold, err := OpenLivePolicyChild(parent, fixture.app, fixture.expected)
	if err != nil {
		t.Fatal("actual cold Auth factory", err)
	}
	defer cold.Close()
	again, err := cold.Read()
	if err != nil || !bytes.Equal(again.PolicyOriginal, before) || again.ExecutionHeight != data.ExecutionHeight {
		t.Fatal("cold original Auth policy changed", err)
	}
	fixture.closeNode()
	if out, err := cold.Read(); !errors.Is(err, consensus.ErrPQWalletPolicyLiveRetired) || out.SubjectOwner != "" || len(out.PolicyOriginal) != 0 {
		t.Fatal("closed Core source remained usable through Auth", err)
	}
	if err = cold.Close(); !errors.Is(err, consensus.ErrPQWalletPolicyLiveRetired) || !cold.Drained() {
		t.Fatal("owner-close failure not sticky/drained", err)
	}
}
