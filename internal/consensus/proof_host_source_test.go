//go:build unix

package consensus

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	dbm "github.com/cometbft/cometbft-db"
	cmtconfig "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/crypto"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmtstate "github.com/cometbft/cometbft/proto/tendermint/state"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

type proofHostSourceFixture struct {
	f    *pqTransactionProofFixture
	plan ProofHostSourcePlan
	root string
}

func proofSourceHeader(e PQLightProofExpectation) ProofHostExpectedHeader {
	return ProofHostExpectedHeader{ChainID: e.ChainID, HeaderHeight: strconv.FormatInt(e.HeaderHeight, 10), BlockHash: hex.EncodeToString(e.BlockHash), StateHeight: strconv.FormatInt(e.StateHeight, 10), StateAppHash: hex.EncodeToString(e.StateAppHash)}
}
func proofSourceExpected(e PQTransactionProofExpectation) ProofHostExpectedTransaction {
	return ProofHostExpectedTransaction{Block: proofSourceHeader(e.Block), Successor: proofSourceHeader(e.Successor), TransactionType: e.TransactionType, Envelope: base64.StdEncoding.EncodeToString(e.Envelope), NativeWire: base64.StdEncoding.EncodeToString(e.NativeWire), TransactionHash: hex.EncodeToString(e.TransactionHash), NativeWireHash: hex.EncodeToString(e.NativeWireHash), Index: strconv.FormatInt(e.Index, 10)}
}
func proofSourceWrite(t *testing.T, path string, b []byte) {
	t.Helper()
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Write(b); e != nil {
		t.Fatal(e)
	}
	if e = f.Sync(); e != nil {
		t.Fatal(e)
	}
	if e = f.Close(); e != nil {
		t.Fatal(e)
	}
}
func proofSourceJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	return b
}

// The proof objects, headers, all dual signatures, actual execution results,
// account migration and state here come from the existing real BlockExecutor
// fixture. Copying its public database records does not sign or fake a commit.
// The fixture's idle signer-lock sentinel tests exclusion only; it is not a
// real daemon/HRS or a claim of deployed custody. No private key is exported.
func newProofHostSourceFixture(t *testing.T, layout, root string) *proofHostSourceFixture {
	t.Helper()
	return newProofHostSourceFixtureFromTransaction(t, newPQTransactionProofFixture(t), layout, root)
}

// A caller may reuse one already signed transaction fixture across read-only
// policy cases. Each invocation still writes independent original files and
// databases; no Application, Node, controller or mutable store is shared.
func newProofHostSourceFixtureFromTransaction(t *testing.T, f *pqTransactionProofFixture, layout, root string) *proofHostSourceFixture {
	t.Helper()
	h := f.light.harness
	if root == "" {
		root = t.TempDir()
	} else {
		if e := os.Mkdir(root, 0700); e != nil {
			t.Fatal(e)
		}
	}
	var err error
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(root, "original")
	if err = os.Mkdir(original, 0700); err != nil {
		t.Fatal(err)
	}
	migration, err := h.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	schedule := proofSourceJSON(t, f.light.schedule)
	for name, b := range map[string][]byte{"migration.json": migration, "genesis.json": h.f.raw, "schedule.json": schedule} {
		proofSourceWrite(t, filepath.Join(original, name), b)
	}
	statePath := filepath.Join(original, "application-state")
	switch layout {
	case "atomic-json":
		b, e := encodeCommittedStateJSON(h.app.committed)
		if e != nil {
			t.Fatal(e)
		}
		proofSourceWrite(t, statePath, b)
	case "snapshot-journal":
		j, _, e := openSnapshotJournal(statePath, h.f.migration)
		if e != nil {
			t.Fatal(e)
		}
		if e = j.save(h.app.committed, h.f.migration, nil); e != nil {
			t.Fatal(e)
		}
	case "block-journal":
		j, _, e := openBlockJournal(statePath, h.f.migration)
		if e != nil {
			t.Fatal(e)
		}
		if e = j.replaceCheckpoint(h.app.committed, h.f.migration); e != nil {
			t.Fatal(e)
		}
	default:
		t.Fatal("unknown fixture layout")
	}
	lease, err := AcquireApplicationStateWriterLease(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = lease.Close(); err != nil {
		t.Fatal(err)
	}
	signing := filepath.Join(original, "synthetic-idle-signing-state")
	proofSourceWrite(t, signing, []byte("synthetic public lock-exclusion sentinel; not HRS or custody evidence\n"))
	proofSourceWrite(t, signing+".lock", nil)
	data := filepath.Join(original, "data")
	if err = os.Mkdir(data, 0700); err != nil {
		t.Fatal(err)
	}
	stateDB, err := dbm.NewGoLevelDB("state", data)
	if err != nil {
		t.Fatal(err)
	}
	blockDB, err := dbm.NewGoLevelDB("blockstore", data)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	store := sm.NewStore(stateDB, sm.StoreOptions{})
	if err = store.Save(actual); err != nil {
		t.Fatal(err)
	}
	blocks := blockstore.NewBlockStore(blockDB)
	for height := h.blocks.Base(); height <= h.blocks.Height(); height++ {
		block := h.blocks.LoadBlock(height)
		commit := h.blocks.LoadSeenCommit(height)
		if block == nil || commit == nil {
			t.Fatal("real fixture missing original block/commit")
		}
		parts, e := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if e != nil {
			t.Fatal(e)
		}
		blocks.SaveBlock(block, parts, commit)
		set, e := h.raw.LoadValidators(height)
		if e != nil {
			t.Fatal(e)
		}
		vp, e := set.ToProto()
		if e != nil {
			t.Fatal(e)
		}
		raw, e := (&cmtstate.ValidatorsInfo{ValidatorSet: vp, LastHeightChanged: height}).Marshal()
		if e != nil {
			t.Fatal(e)
		}
		if e = stateDB.SetSync([]byte(fmt.Sprintf("validatorsKey:%d", height)), raw); e != nil {
			t.Fatal(e)
		}
		params, e := h.raw.LoadConsensusParams(height)
		if e != nil {
			t.Fatal(e)
		}
		cp := params.ToProto()
		cpRaw, e := (&cmtstate.ConsensusParamsInfo{ConsensusParams: cp, LastHeightChanged: height}).Marshal()
		if e != nil {
			t.Fatal(e)
		}
		if e = stateDB.SetSync([]byte(fmt.Sprintf("consensusParamsKey:%d", height)), cpRaw); e != nil {
			t.Fatal(e)
		}
		response, e := h.raw.LoadFinalizeBlockResponse(height)
		if e != nil {
			t.Fatal(e)
		}
		if e = store.SaveFinalizeBlockResponse(height, response); e != nil {
			t.Fatal(e)
		}
	}
	if err = stateDB.Close(); err != nil {
		t.Fatal(err)
	}
	if err = blockDB.Close(); err != nil {
		t.Fatal(err)
	}
	e := f.expected[0]
	member, err := ynxbatch.DecodeMember(e.NativeWire)
	if err != nil {
		t.Fatal(err)
	}
	transfer, err := ynxauth.DecodeTransfer(member.Message)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := f.light.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	p := ProofHostSourcePlan{Version: ProofHostSourcePlanVersion, SourceID: "qa-ledger-proof-source", Epoch: "1", OperationID: "qa-original-transfer", Account: transfer.From, NetworkID: h.f.migration.OriginalGenesisHash, OriginalHash: "0x" + hex.EncodeToString(e.NativeWireHash), MigrationFile: filepath.Join(original, "migration.json"), MigrationSHA256: proofHostSHA(migration), GenesisFile: filepath.Join(original, "genesis.json"), ConsensusGenesisSHA256: h.f.pins.CometGenesisSHA256, OriginalGenesisHash: h.f.pins.OriginalGenesisHash, MigrationStateHash: h.f.pins.MigrationStateHash, StateFile: statePath, StateLayout: layout, CometDataDirectory: data, SigningStatePath: signing, SigningLockKind: "pq-signer", ScheduleFile: filepath.Join(original, "schedule.json"), ScheduleHash: scheduleHash, ScheduleSHA256: proofHostSHA(schedule), EngineHeight: strconv.FormatInt(actual.LastBlockHeight, 10), EngineAppHash: hex.EncodeToString(actual.AppHash), TrustedHeight: strconv.FormatInt(f.light.trust.TrustedLightBlock.Height, 10), TrustedBlockHash: hex.EncodeToString(f.light.trust.TrustedLightBlock.Hash()), TrustingPeriodNanoseconds: strconv.FormatInt(int64(time.Hour), 10), MaxClockDriftNanoseconds: strconv.FormatInt(int64(f.light.trust.MaxClockDrift), 10), TrustLevelNumerator: "1", TrustLevelDenominator: "3", ExpectedTransaction: proofSourceExpected(e)}
	return &proofHostSourceFixture{f: f, plan: p, root: root}
}
func proofSourceTree(t *testing.T, root string) map[string]string {
	t.Helper()
	r := map[string]string{}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if !d.IsDir() {
			b, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			r[path] = proofHostSHA(b)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func (s *proofHostSourceFixture) export(t *testing.T, output string) (ProofHostSourceExport, error) {
	t.Helper()
	raw := proofSourceJSON(t, s.plan)
	return ExportStoppedProofHostSource(raw, proofHostSHA(raw), output, time.Now().UTC())
}

func TestProofHostSourceFromOriginalLedger(t *testing.T) {
	f := newProofHostSourceFixture(t, "atomic-json", os.Getenv("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT"))
	before := proofSourceTree(t, filepath.Join(f.root, "original"))
	output := filepath.Join(f.root, "delivery")
	result, err := f.export(t, output)
	if err != nil {
		t.Fatal(err)
	}
	if result.Version != "YNX-PROOF-HOST-SOURCE-EXPORT/v1" || !result.SourceReadOnly || !result.LedgerProofVerified || result.NativeRootAuthorized || result.DeploymentVerified || len(result.Files) != 8 {
		t.Fatal("wrong public source semantics")
	}
	if !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.root, "original"))) {
		t.Fatal("source export mutated original ledger or signing material")
	}
	proof, err := DecodePQTransactionProofRequest(result.Proof)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := f.plan.ExpectedTransaction.expectation()
	if r, e := VerifyPQTransactionProof(f.f.light.trust, expected, proof); e != nil || !r.ExecutionSuccessful {
		t.Fatal("exported ledger proof failed original verifier", e)
	}
	if os.Getenv("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT") != "" {
		// Only this isolated CI working root is retained. The workflow must not
		// upload original databases/signing-lock sentinel or claim real custody.
		raw := proofSourceJSON(t, f.plan)
		planPath := filepath.Join(f.root, "source-plan.json")
		proofSourceWrite(t, planPath, raw)
		requestPath := filepath.Join(f.root, "request.json")
		request := proofSourceJSON(t, map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", "expected": f.plan.ExpectedTransaction, "proof": proof})
		proofSourceWrite(t, requestPath, request)
		proofSourceWrite(t, filepath.Join(f.root, "metadata.json"), proofSourceJSON(t, map[string]string{"sourcePlanSHA256": proofHostSHA(raw), "sourcePlanPath": planPath, "deliveryPath": output, "sourceId": f.plan.SourceID, "epoch": f.plan.Epoch, "requestPath": requestPath, "expectedVerifierCode": "VERIFIED_TRANSACTION_DATA"}))
		return
	}
	receipt, err := WriteProofHostDelivery(output, result)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.SourceSHA256 != result.SourceSHA256 {
		t.Fatal("delivery changed source bytes")
	}
	// Reopen the exported complete checkpoint through the same normal loader
	// used by the external Host, not a fixture-owned authority pointer.
	source, err := NewPQEngineFileSource(f.f.light.harness.f.migration, filepath.Join(output, "committed-state.json"), f.f.light.harness.f.bootstrap, f.f.light.authorization)
	if err != nil {
		t.Fatal(err)
	}
	h, _ := strconv.ParseInt(f.plan.EngineHeight, 10, 64)
	hash, _ := hex.DecodeString(f.plan.EngineAppHash)
	authority, err := source.ConsensusAuthorityForState(expected.Block.ChainID, h, hash)
	if err != nil {
		t.Fatal(err)
	}
	trust := f.f.light.trust
	trust.Snapshot = authority.(*PQEngineSnapshot)
	trustedRaw, err := os.ReadFile(filepath.Join(output, "trusted-light-block.json"))
	if err != nil {
		t.Fatal(err)
	}
	trust.TrustedLightBlock, err = DecodePQTrustedLightBlock(trustedRaw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyPQTransactionProof(trust, expected, proof); err != nil {
		t.Fatal(err)
	}
	if _, err = WriteProofHostDelivery(output, result); err == nil {
		t.Fatal("existing/UNKNOWN delivery was overwritten")
	}
}

func TestProofHostSourceThreeLayoutsAndOriginalFailures(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := newProofHostSourceFixture(t, layout, "")
			before := proofSourceTree(t, filepath.Join(f.root, "original"))
			if _, err := f.export(t, filepath.Join(f.root, "output")); err != nil {
				t.Fatal(err)
			}
			for _, change := range []struct {
				name  string
				apply func(*ProofHostSourcePlan)
			}{
				{"wrong-engine-hash", func(p *ProofHostSourcePlan) { p.EngineAppHash = strings.Repeat("a", 64) }},
				{"wrong-trusted-hash", func(p *ProofHostSourcePlan) { p.TrustedBlockHash = strings.Repeat("b", 64) }},
				{"wrong-target-hash", func(p *ProofHostSourcePlan) { p.ExpectedTransaction.Block.BlockHash = strings.Repeat("c", 64) }},
				{"wrong-index", func(p *ProofHostSourcePlan) { p.ExpectedTransaction.Index = "2" }},
				{"wrong-account", func(p *ProofHostSourcePlan) { p.Account = "0x" + strings.Repeat("f", 40) }},
				{"wrong-layout", func(p *ProofHostSourcePlan) { p.StateLayout = "unsupported" }},
			} {
				t.Run(change.name, func(t *testing.T) {
					p := f.plan
					change.apply(&p)
					raw := proofSourceJSON(t, p)
					if _, err := ExportStoppedProofHostSource(raw, proofHostSHA(raw), filepath.Join(f.root, "reject"), time.Now().UTC()); err == nil {
						t.Fatal("forged source accepted")
					}
				})
			}
			lease, err := AcquireApplicationStateWriterLease(f.plan.StateFile)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.export(t, filepath.Join(f.root, "active-app")); err == nil {
				t.Fatal("active writer accepted")
			}
			if err = lease.Close(); err != nil {
				t.Fatal(err)
			}
			signer, err := existingInspectionLockFile(f.plan.SigningStatePath + ".lock")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.export(t, filepath.Join(f.root, "active-signer")); err == nil {
				t.Fatal("active signer accepted")
			}
			if err = signer(); err != nil {
				t.Fatal(err)
			}
			db, err := dbm.NewGoLevelDB("state", f.plan.CometDataDirectory)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.export(t, filepath.Join(f.root, "active-db")); err == nil {
				t.Fatal("live LevelDB was bypassed")
			}
			if err = db.Close(); err != nil {
				t.Fatal(err)
			}
			// The actual writer open above may update LevelDB LOG; capture after its
			// intentional normal close, then ensure the failing reader does not repair.
			before = proofSourceTree(t, filepath.Join(f.root, "original"))
			stateRaw, err := os.ReadFile(f.plan.StateFile)
			if err != nil {
				t.Fatal(err)
			}
			bad := bytes.TrimSpace(stateRaw)
			bad = bad[:len(bad)-1]
			if err = os.WriteFile(f.plan.StateFile, bad, 0600); err != nil {
				t.Fatal(err)
			}
			corrupt := proofSourceTree(t, filepath.Join(f.root, "original"))
			if _, err = f.export(t, filepath.Join(f.root, "corrupt")); err == nil {
				t.Fatal("corrupt/partial source accepted")
			}
			if !reflect.DeepEqual(corrupt, proofSourceTree(t, filepath.Join(f.root, "original"))) {
				t.Fatal("failed capture repaired original bytes")
			}
			if before[f.plan.MigrationFile] != corrupt[f.plan.MigrationFile] {
				t.Fatal("test changed unrelated migration")
			}
		})
	}
}

func TestProofHostSourceHeldOriginalRejectsReplacementAndRestoredMtime(t *testing.T) {
	for _, mode := range []string{"replacement", "restore-bytes-and-mtime"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			root, _ = filepath.EvalSymlinks(root)
			path := filepath.Join(root, "original.json")
			raw := []byte("{\"original\":true}\n")
			proofSourceWrite(t, path, raw)
			held, err := readProofHostOriginal(path, proofHostSHA(raw), 4096)
			if err != nil {
				t.Fatal(err)
			}
			defer held.file.Close()
			if mode == "replacement" {
				next := path + ".new"
				proofSourceWrite(t, next, raw)
				if err = os.Rename(next, path); err != nil {
					t.Fatal(err)
				}
			} else {
				if err = os.WriteFile(path, bytes.Repeat([]byte{'x'}, len(raw)), 0600); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
				if err = os.Chtimes(path, held.info.ModTime(), held.info.ModTime()); err != nil {
					t.Fatal(err)
				}
			}
			if held.unchanged() == nil {
				t.Fatal("source epoch revived after replacement/mutation")
			}
		})
	}
}

func TestProofHostSourcePlanRequiresExternalPinAndExactSchema(t *testing.T) {
	for _, raw := range [][]byte{[]byte(`{"version":"x","version":"y"}`), []byte(`{"unknown":"field"}`), []byte(`{} {}`)} {
		if _, e := DecodeProofHostSourcePlan(raw, proofHostSHA(raw)); e == nil {
			t.Fatal("invalid source plan accepted")
		}
	}
	if _, e := DecodeProofHostSourcePlan([]byte(`{}`), strings.Repeat("1", 64)); e == nil {
		t.Fatal("independent pin mismatch accepted")
	}
}

type proofSourceNoSigningPV struct {
	delegate cmttypes.PrivValidator
	blocked  bool
	calls    int
}

func (p *proofSourceNoSigningPV) GetPubKey() (crypto.PubKey, error) {
	p.calls++
	if p.blocked {
		return nil, errors.New("source capture must not query validator")
	}
	return p.delegate.GetPubKey()
}
func (p *proofSourceNoSigningPV) SignVote(string, *cmtproto.Vote) error {
	return errors.New("source test never signs via node")
}
func (p *proofSourceNoSigningPV) SignProposal(string, *cmtproto.Proposal) error {
	return errors.New("source test never signs via node")
}

func TestProofHostSourceActualNodeStoreCallbackWithoutStartOrSignerRPC(t *testing.T) {
	f := newProofHostSourceFixture(t, "atomic-json", "")
	h := f.f.light.harness
	app, err := NewPersistentApplicationWithEngineAuthorization(h.f.migration, f.plan.StateFile, h.f.bootstrap, f.f.light.authorization)
	if err != nil {
		t.Fatal(err)
	}
	config := cmtconfig.DefaultConfig().SetRoot(filepath.Dir(f.plan.CometDataDirectory))
	config.TxIndex.Indexer = "null"
	config.P2P.PexReactor = false
	config.RPC.ListenAddress = ""
	config.RPC.PprofListenAddress = ""
	if err = os.MkdirAll(filepath.Dir(config.GenesisFile()), 0700); err != nil {
		t.Fatal(err)
	}
	proofSourceWrite(t, config.GenesisFile(), h.f.raw)
	key := cmted.PrivKey(bytes.Clone(h.f.legacy[string(h.f.bootstrap.record.Members[0].Address)]))
	pv := &proofSourceNoSigningPV{delegate: privval.NewFilePV(key, filepath.Join(config.RootDir, "unused-key.json"), filepath.Join(config.RootDir, "unused-sign.json"))}
	n, err := newPQNodeWithDatabase(config, app, pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger(), cmtconfig.DefaultDBProvider)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { n.OnStop(); _ = n.ProxyApp().Stop() })
	if n.IsRunning() {
		t.Fatal("source test started a node")
	}
	pv.blocked = true
	calls := pv.calls
	raw := proofSourceJSON(t, f.plan)
	before := proofSourceTree(t, filepath.Join(f.root, "original"))
	result, err := ExportNodeProofHostSource(n, app, raw, proofHostSHA(raw), filepath.Join(f.root, "live-delivery"), time.Now().UTC())
	if err != nil {
		t.Fatal("actual node source callback failed", err)
	}
	if pv.calls != calls || !result.LedgerProofVerified || n.IsRunning() {
		t.Fatal("source callback contacted signer or changed node lifecycle")
	}
	if !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.root, "original"))) {
		t.Fatal("live callback changed source files")
	}
	if _, err = ExportStoppedProofHostSource(raw, proofHostSHA(raw), filepath.Join(f.root, "cannot-reopen-live-db"), time.Now().UTC()); err == nil {
		t.Fatal("stopped path reopened the node's owned database")
	}
}

func TestProofHostSourceCapturedBytesSurviveActualLaterCommit(t *testing.T) {
	f := newPQTransactionProofFixture(t)
	h := f.light.harness
	before, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	captured, err := h.app.captureProofHostCommittedJSON(before)
	if err != nil {
		t.Fatal(err)
	}
	original := bytes.Clone(captured)
	var prior CommittedState
	if err = json.Unmarshal(captured, &prior); err != nil {
		t.Fatal(err)
	}
	prior.bootstrap = h.f.bootstrap
	// Mutate a real funded recipient's account, nonce, fee and native history
	// while an independent old checkpoint is encoded. No shallow committed map
	// is borrowed after Application.mu is released.
	key := deterministicPrivateKey(212)
	defer key.Zero()
	owner := mustNativeAddress(t, key)
	var oldNonce uint64
	found := false
	for _, account := range prior.Accounts {
		if account.Address == owner {
			oldNonce = account.Nonce
			found = true
		}
	}
	if !found {
		t.Fatal("actual fixture recipient missing")
	}
	tx, err := NewSignedTransfer(key, prior.ChainID, mustNativeAddress(t, deterministicPrivateKey(213)), 1, oldNonce+1)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	type encodedResult struct {
		raw []byte
		err error
	}
	encoded := make(chan encodedResult, 1)
	go func() { raw, e := encodeCommittedStateJSON(prior); encoded <- encodedResult{raw, e} }()
	after := h.apply(t, cmttypes.Txs{wire})
	concurrent := <-encoded
	if concurrent.err != nil || !bytes.Equal(concurrent.raw, original) {
		t.Fatal("concurrent old checkpoint encoding changed", concurrent.err)
	}
	response, err := h.raw.LoadFinalizeBlockResponse(after.LastBlockHeight)
	if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
		t.Fatal("later actual transfer did not execute", err)
	}
	if len(h.app.committed.NativeTransfers) != len(prior.NativeTransfers)+1 || len(h.app.committed.FeeEvents) != len(prior.FeeEvents)+1 {
		t.Fatal("later commit did not change actual transfer/fee history")
	}
	newNonce := oldNonce
	for _, account := range h.app.committed.Accounts {
		if account.Address == owner {
			newNonce = account.Nonce
		}
	}
	if newNonce != oldNonce+1 {
		t.Fatal("later commit did not change actual owner nonce")
	}
	if after.LastBlockHeight != before.LastBlockHeight+1 || !bytes.Equal(captured, original) {
		t.Fatal("later actual commit mutated captured checkpoint")
	}
	if err = prior.Validate(h.f.migration); err != nil {
		t.Fatal("captured history/state no longer validates", err)
	}
	reencoded, err := encodeCommittedStateJSON(prior)
	if err != nil || !bytes.Equal(reencoded, original) {
		t.Fatal("captured complete state/history was reinterpreted", err)
	}
	l := proofHostLedger{load: h.raw.Load, validators: h.raw.LoadValidators, results: h.raw.LoadFinalizeBlockResponse, blocks: h.blocks}
	if err = proofHostCheckpointContinuation(l, f.light.trust.Snapshot, before, after, true); err != nil {
		t.Fatal("signed successor did not retain historical checkpoint", err)
	}
	if err = proofHostCheckpointContinuation(l, f.light.trust.Snapshot, before, after, false); err == nil {
		t.Fatal("stopped source accepted writer advancement")
	}
	conflict := before.Copy()
	conflict.AppHash = bytes.Repeat([]byte{88}, 32)
	if err = proofHostCheckpointContinuation(l, f.light.trust.Snapshot, before, conflict, true); err == nil {
		t.Fatal("same-height conflict accepted")
	}
	wrong := before.Copy()
	wrong.AppHash = bytes.Repeat([]byte{89}, 32)
	if err = proofHostCheckpointContinuation(l, f.light.trust.Snapshot, wrong, after, true); err == nil {
		t.Fatal("successor accepted a substituted old AppHash")
	}
	rollback := before.Copy()
	rollback.LastBlockHeight--
	if err = proofHostCheckpointContinuation(l, f.light.trust.Snapshot, before, rollback, true); err == nil {
		t.Fatal("rollback accepted")
	}
}
