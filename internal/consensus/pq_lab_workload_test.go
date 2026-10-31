package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func pqLabWorkloadTemp(t *testing.T) string {
	t.Helper()
	path, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func pqLabBoundFixture(t *testing.T, m chain.ConsensusMigrationState) *validatorRegistryFixture {
	t.Helper()
	f := &validatorRegistryFixture{legacy: map[string]ed25519.PrivateKey{}}
	bindings := make([]chain.ConsensusValidatorKeyBinding, len(m.Validators))
	for i, v := range m.Validators {
		pub, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(pub)
		f.legacy[string(h[:20])] = key
		bindings[i] = chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(pub), ConsensusAddress: strings.ToUpper(hex.EncodeToString(h[:20]))}
	}
	var err error
	f.migration, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f.doc, err = BuildCometGenesis(f.migration, time.Now().UTC().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{hex.EncodeToString(h[:]), f.migration.OriginalGenesisHash, f.migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestPQLabWorkloadRealSourceCorpusExecutionAndRestart(t *testing.T) {
	for _, batchSize := range []int{1, 4} {
		t.Run(strconv.Itoa(batchSize), func(t *testing.T) {
			s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 7, BatchSize: batchSize})
			if err != nil {
				t.Fatal(err)
			}
			public := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			public.ProduceBlock()
			publicMigration, err := public.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			if s.Migration.Network.ChainID != 642399 || s.Migration.Network.IsPublicNet || !strings.HasPrefix(s.Migration.Network.Slug, "pq-lab-") || s.Migration.OriginalGenesisHash == publicMigration.OriginalGenesisHash {
				t.Fatal("synthetic identity reused public network")
			}
			if s.Migration.Height != 3 || s.Migration.Runtime == nil || len(s.Migration.AccountPolicy.Records) != 1 || len(s.Migration.Runtime.Pending) != 0 {
				t.Fatal("source did not mine actual approved migration")
			}
			f := pqLabBoundFixture(t, s.Migration)
			dir := filepath.Join(pqLabWorkloadTemp(t), "corpus")
			manifest, err := s.WriteCorpus(dir, f.migration)
			if err != nil {
				t.Fatal(err)
			}
			original, _ := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
			if _, err = s.WriteCorpus(dir, f.migration); err == nil {
				t.Fatal("existing UNKNOWN corpus overwritten")
			}
			after, _ := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
			if !bytes.Equal(original, after) {
				t.Fatal("existing corpus changed")
			}
			if manifest.NetworkStarted || manifest.AuthorityGranted || manifest.DeployedSourceQualification || !manifest.SyntheticOnly {
				t.Fatal("public manifest grants authority")
			}
			app, err := NewPersistentApplication(f.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			before := app.committed.AppHash
			for _, bad := range manifest.InvalidSignatureEnvelopes {
				raw, err := os.ReadFile(filepath.Join(dir, bad.Path))
				if err != nil {
					t.Fatal(err)
				}
				check, e := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
				if e != nil || check.Code == 0 || app.committed.AppHash != before {
					t.Fatal("independent bad signature admitted or mutated state", check, e)
				}
			}
			for _, tx := range manifest.Transactions {
				raw, err := os.ReadFile(filepath.Join(dir, tx.Envelope.Path))
				if err != nil {
					t.Fatal(err)
				}
				if pqLabFile(tx.Envelope.Path, raw) != tx.Envelope || SignedTransactionHash(raw) != tx.ABCIHash {
					t.Fatal("public exact raw/hash mismatch")
				}
				check, e := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
				if e != nil || check.Code != 0 {
					t.Fatal("normal original CheckTx rejected", check, e)
				}
				h := app.committed.Height + 1
				res, e := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{raw}})
				if e != nil || len(res.TxResults) != 1 || res.TxResults[0].Code != 0 {
					t.Fatal("normal execution rejected", res, e)
				}
				if _, e = app.Commit(ctx, &abci.RequestCommit{}); e != nil {
					t.Fatal(e)
				}
			}
			cold, err := NewPersistentApplication(f.migration, app.statePath)
			if err != nil {
				t.Fatal(err)
			}
			if cold.committed.AppHash != app.committed.AppHash {
				t.Fatal("cold state lost original result")
			}
			owner, ok := accountIndex(cold.committed.Accounts, manifest.Owner)
			if !ok || cold.committed.Accounts[owner].Balance != 1 || cold.committed.Accounts[owner].Nonce != 8 {
				t.Fatal("full nonce/fee/balance corpus not executed")
			}
			receiver, ok := accountIndex(cold.committed.Accounts, manifest.Recipient)
			if !ok || cold.committed.Accounts[receiver].Balance != 7 {
				t.Fatal("actual recipient balance mismatch")
			}
			if err = cold.committed.Validate(f.migration); err != nil {
				t.Fatal("full cold history invalid", err)
			}
		})
	}
}

func TestPQLabWorkloadBoundsAliasesAndExactSource(t *testing.T) {
	for _, o := range []PQLabWorkloadOptions{{0, 1}, {1, 0}, {1025, 1}, {2, 3}, {6, 3}} {
		if _, err := NewPQLabWorkloadSource(o); err == nil {
			t.Fatal("invalid bound admitted", o)
		}
	}
	s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{1, 1})
	if err != nil {
		t.Fatal(err)
	}
	f := pqLabBoundFixture(t, s.Migration)
	altered := f.migration
	altered.Accounts = append([]chain.ConsensusAccount(nil), altered.Accounts...)
	altered.Accounts[0].Nonce++
	target := filepath.Join(pqLabWorkloadTemp(t), "bad")
	if _, err = s.WriteCorpus(target, altered); err == nil {
		t.Fatal("changed original source admitted")
	}
	if _, err = os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("bad source mutated output")
	}
	parent := pqLabWorkloadTemp(t)
	alias := filepath.Join(parent, "alias")
	if err = os.Symlink(parent, alias); err != nil {
		t.Fatal(err)
	}
	if _, err = s.WriteCorpus(filepath.Join(alias, "out"), f.migration); err == nil {
		t.Fatal("aliased parent accepted")
	}
	// A second fresh synthetic identity must not be a shared public/testnet root.
	other, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{1, 1})
	if err != nil {
		t.Fatal(err)
	}
	if other.Migration.Network.Slug == s.Migration.Network.Slug || other.Migration.OriginalGenesisHash == s.Migration.OriginalGenesisHash {
		t.Fatal("fresh lab genesis identity reused")
	}
}

// Actual BlockExecutor/Comet types only, no Node.Start or HTTP/network. The
// production exporter itself never uses this test harness or signs a block.
func pqLabProofFixture(t *testing.T) (PQLabProofMaterials, PQTransactionProofRequest) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{1, 1})
	if err != nil {
		t.Fatal(err)
	}
	f := pqLabBoundFixture(t, source.Migration)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"), f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blocks := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blocks.Close() })
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: app.statePath}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, f.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err = handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	if _, err = h.wrapped().Load(); err != nil {
		t.Fatal(err)
	}
	var registrations cmttypes.Txs
	for i := range f.bootstrap.record.Members {
		key, wire := engineRegistration(t, f, i, f.doc.InitialHeight)
		h.keys = append(h.keys, key)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, tx)
	}
	h.apply(t, registrations)
	schedule, err := NewPQEngineSchedule(f.bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	scheduleRaw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, h.path, f.bootstrap, auth)
	if err != nil {
		t.Fatal(err)
	}
	h.app = app
	h.source.app = app
	h.proxy = startEngineTestProxy(t, app)
	for app.committed.Height < schedule.ActivationHeight+1 {
		h.apply(t, nil)
	}
	tx := source.manifest.Transactions[0]
	envelope := source.files[tx.Envelope.Path]
	height := app.committed.Height + 1
	h.apply(t, cmttypes.Txs{envelope})
	h.apply(t, nil)
	l := &pqLightProofFixture{harness: h, schedule: schedule, authorization: auth}
	block, successor := l.block(t, height), l.block(t, height+1)
	statement := func(b *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
	}
	wire := source.files[tx.Wire.Path]
	outer, native := sha256.Sum256(envelope), sha256.Sum256(wire)
	expected := PQTransactionProofExpectation{Block: statement(block), Successor: statement(successor), TransactionType: tx.Type, Envelope: envelope, NativeWire: wire, TransactionHash: outer[:], NativeWireHash: native[:], Index: 0}
	rawTx, err := cmtjson.Marshal(h.blocks.LoadBlock(height).Data.Txs.Proof(0))
	if err != nil {
		t.Fatal(err)
	}
	response, err := h.raw.LoadFinalizeBlockResponse(height)
	if err != nil {
		t.Fatal(err)
	}
	if response.TxResults[0].Code != 0 {
		t.Fatal("actual corpus execution failed", response.TxResults[0])
	}
	result, proof, err := EncodePQTransactionExecutionProof(response.TxResults, 0)
	if err != nil {
		t.Fatal(err)
	}
	request := PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: l.encode(t, block), Successor: l.encode(t, successor), TransactionProof: rawTx, ExecutionResult: result, ExecutionProof: proof}
	migrationRaw, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	stateRaw, err := os.ReadFile(h.path)
	if err != nil {
		t.Fatal(err)
	}
	trusted, err := cmtjson.Marshal(l.block(t, schedule.ActivationHeight))
	if err != nil {
		t.Fatal(err)
	}
	engine, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	return PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: migrationRaw, Genesis: f.raw, CommittedState: stateRaw, Schedule: scheduleRaw, TrustedLightBlock: trusted, Pins: f.pins, ScheduleHash: scheduleHash, EngineHeight: engine.LastBlockHeight, EngineAppHash: bytes.Clone(engine.AppHash), TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustNumerator: 1, TrustDenominator: 3, Expected: expected}, request
}

func TestPQLabWorkloadProofOriginalCLIInputsAndNegatives(t *testing.T) {
	m, proof := pqLabProofFixture(t)
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodePQLabProofMaterials(raw, pqLabFile("", raw).SHA256); err != nil {
		t.Fatal(err)
	}
	if _, err = DecodePQLabProofMaterials(raw, strings.Repeat("0", 64)); err == nil {
		t.Fatal("unapproved proof context accepted")
	}
	dir := filepath.Join(pqLabWorkloadTemp(t), "proof")
	out, err := WritePQLabProofInputs(dir, m, proof, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if !out.Result.Finalized || !out.Result.ExecutionSuccessful || out.AuthorityGranted || out.ActualNetworkExecutionClaim || !out.SyntheticOnly {
		t.Fatal("wrong proof/authority result", out)
	}
	contextRaw, err := os.ReadFile(filepath.Join(dir, out.Context.Path))
	if err != nil {
		t.Fatal(err)
	}
	if pqLabFile(out.Context.Path, contextRaw) != out.Context {
		t.Fatal("normal CLI context pin differs")
	}
	var c struct {
		Version    string                     `json:"version"`
		LightTrust map[string]string          `json:"lightTrust"`
		Expected   map[string]json.RawMessage `json:"expectedTransaction"`
	}
	if err = json.Unmarshal(contextRaw, &c); err != nil || len(c.LightTrust) != 24 || c.Version != "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1" {
		t.Fatal("normal CLI context schema drift", err)
	}
	if _, err = WritePQLabProofInputs(dir, m, proof, time.Now().UTC()); err == nil {
		t.Fatal("UNKNOWN proof originals overwritten")
	}
	for _, name := range []string{"wrong engine checkpoint", "wrong original envelope", "wrong result proof", "expired trust", "wrong source genesis"} {
		t.Run(name, func(t *testing.T) {
			bad := m
			p := proof
			switch name {
			case "wrong engine checkpoint":
				bad.EngineAppHash = bytes.Repeat([]byte{1}, 32)
			case "wrong original envelope":
				bad.Expected.Envelope = bytes.Clone(m.Expected.Envelope)
				bad.Expected.Envelope[0] ^= 1
			case "wrong result proof":
				p.ExecutionProof = bytes.Clone(p.ExecutionProof)
				p.ExecutionProof[len(p.ExecutionProof)-2] ^= 1
			case "expired trust":
				bad.TrustingPeriod = time.Nanosecond
			case "wrong source genesis":
				bad.Pins.CometGenesisSHA256 = strings.Repeat("0", 64)
			}
			if _, err := WritePQLabProofInputs(filepath.Join(pqLabWorkloadTemp(t), "bad"), bad, p, time.Now().UTC()); err == nil {
				t.Fatal("mismatched actual proof material accepted")
			}
		})
	}
	if export := os.Getenv("YNX_PQ_LAB_PROOF_FIXTURE_OUT"); export != "" {
		if err = pqLabFreshDirectory(export); err != nil {
			t.Fatal(err)
		}
		proofRaw, err := json.Marshal(proof)
		if err != nil {
			t.Fatal(err)
		}
		if err = pqLabWriteExclusive(filepath.Join(export, "operator-materials.json"), raw); err != nil {
			t.Fatal(err)
		}
		if err = pqLabWriteExclusive(filepath.Join(export, "proof.json"), proofRaw); err != nil {
			t.Fatal(err)
		}
		t.Log("PQ_LAB_PROOF_PUBLIC_INPUTS_READY actualBlockExecutor=true actualNetwork=false authority=false")
	}
}

func TestPQLabWorkloadMaximumProtocolWhole(t *testing.T) {
	s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 1024, BatchSize: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if len(s.manifest.Transactions) != 1 || s.manifest.Transactions[0].Type != PQWholeType || s.manifest.Transactions[0].Members != "1024" || s.manifest.FinalOwnerNonce != "1025" {
		t.Fatal("protocol maximum corpus truncated")
	}
	if s.manifest.InitialOwnerBalance != "2049" || s.manifest.FinalOwnerBalance != "1" {
		t.Fatal("maximum corpus underfunded")
	}
}
