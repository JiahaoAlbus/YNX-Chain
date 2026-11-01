//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func distributedReadbackInput(t *testing.T, root string) PQLabDistributedPublicInput {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	return PQLabDistributedPublicInput{Directory: root, ReceiptSHA256: pqLabSHA(raw)}
}

func TestPQLabDistributedReadbackBootstrapFullStateColdAndUnknown(t *testing.T) {
	f := newPQLabDistributedTestFixture(t)
	persistPQLabDistributedTestCheckpoint(t, f, nil)
	var inputs []PQLabDistributedPublicInput
	var full []byte
	for _, local := range f.locals {
		state, err := readPQEngineCommittedState(local.node.StatePath, local.migration, local.bootstrap, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		before := inspectionInventory(t, local.root)
		o := PQLabDistributedReadbackOptions{RootDir: local.root, PlanSHA256: f.planSHA, Mode: "stopped", ExpectedHeight: state.Height, ExpectedAppHash: state.AppHash, OutputDir: filepath.Join(pqLabWorkloadTemp(t), "public")}
		r, err := ReadPQLabDistributedCheckpoint(context.Background(), o, time.Now().UTC())
		if err != nil {
			t.Fatal("normal stopped readback", err)
		}
		if !r.ColdReopened || !r.WriterExcluded || !r.SigningWriterExcluded || !r.SourceReadOnly || !r.SyntheticOnly || r.AuthorityGranted || r.PublicNetwork || r.NodeStarted || r.Heights == nil || r.Materials != nil {
			t.Fatal("readback evidence layer changed")
		}
		raw, err := os.ReadFile(filepath.Join(o.OutputDir, r.State.Path))
		if err != nil {
			t.Fatal(err)
		}
		want, err := encodeCommittedStateJSON(state)
		if err != nil || !bytes.Equal(want, raw) {
			t.Fatal("full original state projected or altered", err)
		}
		if full == nil {
			full = raw
		} else if !bytes.Equal(full, raw) {
			t.Fatal("four normal applications differ")
		}
		inputs = append(inputs, distributedReadbackInput(t, o.OutputDir))
		if !reflect.DeepEqual(before, inspectionInventory(t, local.root)) {
			t.Fatal("public readback rewrote original source/custody")
		}
		if _, err = ReadPQLabDistributedCheckpoint(context.Background(), o, time.Now().UTC()); err == nil {
			t.Fatal("existing receipt/attempt overwritten")
		}
	}
	compared, err := ComparePQLabDistributedReadbacks(f.planRaw, f.planSHA, inputs, time.Now().UTC())
	if err != nil || !compared.FullStateEqual || !compared.FullHeightEqual || !compared.AllStoppedAndCold || compared.AuthorityGranted {
		t.Fatal("full PUBLIC equality", err)
	}
	duplicate := append([]PQLabDistributedPublicInput(nil), inputs...)
	duplicate[3] = duplicate[0]
	if _, err = ComparePQLabDistributedReadbacks(f.planRaw, f.planSHA, duplicate, time.Now().UTC()); err == nil {
		t.Fatal("one host relabeled as four")
	}
	// A late durability failure can leave both a complete result and an
	// explicit UNKNOWN marker. Its unchanged result pin cannot erase that
	// first cause. Plain lost stdout with a durable result remains valid.
	for _, kind := range []string{"unknown_file", "unknown_directory", "unknown_dangling_symlink", "partial"} {
		t.Run(kind, func(t *testing.T) {
			derived := filepath.Join(pqLabWorkloadTemp(t), "public")
			if e := os.Mkdir(derived, 0700); e != nil {
				t.Fatal(e)
			}
			entries, e := os.ReadDir(inputs[0].Directory)
			if e != nil {
				t.Fatal(e)
			}
			for _, entry := range entries {
				raw, e := os.ReadFile(filepath.Join(inputs[0].Directory, entry.Name()))
				if e != nil {
					t.Fatal(e)
				}
				if e = pqLabWrite(filepath.Join(derived, entry.Name()), raw); e != nil {
					t.Fatal(e)
				}
			}
			marker := filepath.Join(derived, "UNKNOWN.json")
			cause := []byte("original file or directory fsync outcome unknown; do not replay")
			switch kind {
			case "unknown_directory":
				e = os.Mkdir(marker, 0700)
			case "unknown_dangling_symlink":
				e = os.Symlink(filepath.Join(derived, "missing-original"), marker)
			case "partial":
				marker = filepath.Join(derived, "result.json.partial")
				e = pqLabWrite(marker, cause)
			default:
				e = pqLabWrite(marker, cause)
			}
			if e != nil {
				t.Fatal(e)
			}
			before := inspectionInventory(t, derived)
			bad := append([]PQLabDistributedPublicInput(nil), inputs...)
			bad[0] = PQLabDistributedPublicInput{Directory: derived, ReceiptSHA256: inputs[0].ReceiptSHA256}
			if _, e = ComparePQLabDistributedReadbacks(f.planRaw, f.planSHA, bad, time.Now().UTC()); e == nil {
				t.Fatal("complete pinned result erased original UNKNOWN or partial outcome")
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, derived)) {
				t.Fatal("public failure reconciliation rewrote original evidence")
			}
		})
	}
	local := f.locals[0]
	state, err := readPQEngineCommittedState(local.node.StatePath, local.migration, local.bootstrap, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := AcquireApplicationStateWriterLease(local.node.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	o := PQLabDistributedReadbackOptions{RootDir: local.root, PlanSHA256: f.planSHA, Mode: "stopped", ExpectedHeight: state.Height, ExpectedAppHash: state.AppHash, OutputDir: filepath.Join(pqLabWorkloadTemp(t), "busy")}
	if _, err = ReadPQLabDistributedCheckpoint(context.Background(), o, time.Now().UTC()); err == nil {
		t.Fatal("active application writer accepted as stopped")
	}
	if err = lease.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(o.OutputDir, "UNKNOWN.json")); err != nil {
		t.Fatal("first cause/unknown attempt lost", err)
	}
	if _, err = os.Stat(filepath.Join(o.OutputDir, "result.json")); !os.IsNotExist(err) {
		t.Fatal("failure published success")
	}
	originalUnknown, err := os.ReadFile(filepath.Join(o.OutputDir, "UNKNOWN.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ReadPQLabDistributedCheckpoint(context.Background(), o, time.Now().UTC()); err == nil {
		t.Fatal("UNKNOWN retried")
	}
	currentUnknown, _ := os.ReadFile(filepath.Join(o.OutputDir, "UNKNOWN.json"))
	if !bytes.Equal(originalUnknown, currentUnknown) {
		t.Fatal("first cause replaced")
	}
	o.OutputDir = filepath.Join(pqLabWorkloadTemp(t), "wrong-checkpoint")
	o.ExpectedHeight++
	if _, err = ReadPQLabDistributedCheckpoint(context.Background(), o, time.Now().UTC()); err == nil {
		t.Fatal("wrong original height accepted")
	}
	// After capture the coordinator no longer has ANY node private directory.
	// Its public-only consumer must still compare complete records successfully.
	for _, l := range f.locals {
		if err = os.Rename(l.root, l.root+"-offline"); err != nil {
			t.Fatal(err)
		}
		defer os.Rename(l.root+"-offline", l.root)
	}
	if _, err = ComparePQLabDistributedReadbacks(f.planRaw, f.planSHA, inputs, time.Now().UTC()); err != nil {
		t.Fatal("PUBLIC consumer opened remote custody", err)
	}
}

// Test-only synthetic execution uses four distinct normal host-local custody
// directories, real HostSigner/transition signatures and real BlockExecutor.
// It opens no node, P2P port, public service or SSH connection.
func distributedPQReadbackFixture(t *testing.T) (*pqLabDistributedFixture, []PQLabDistributedReadbackOptions) {
	t.Helper()
	f := newPQLabDistributedTestFixture(t)
	persistPQLabDistributedTestCheckpoint(t, f, nil)
	var registrations cmttypes.Txs
	for _, l := range f.locals {
		state, err := readPQEngineCommittedState(l.node.StatePath, l.migration, l.bootstrap, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		r, err := PreparePQLabDistributedRegistration(l.root, f.planSHA, state.Height, state.AppHash)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, r.Transaction)
	}
	persistPQLabDistributedTestCheckpoint(t, f, registrations)
	l := f.locals[0]
	cp, err := InspectOperatorCheckpoint(l.migration, l.genesisRaw, f.plan.Pins, OperatorCheckpointOptions{StatePath: l.node.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(l.node.Home, "data"), SigningStatePath: l.node.LegacyStateFile, ProposePQActivationHeight: f.plan.InitialHeight + 5})
	if err != nil {
		t.Fatal(err)
	}
	schedule, err := base64.StdEncoding.DecodeString(cp.ScheduleCandidate.CanonicalScheduleBase64)
	if err != nil {
		t.Fatal(err)
	}
	var s PQEngineSchedule
	if err = json.Unmarshal(schedule, &s); err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := s.Hash()
	if err != nil {
		t.Fatal(err)
	}
	var auths []*PQEngineAuthorization
	for i, local := range f.locals {
		if _, err = ActivatePQLabDistributedLocal(local.root, f.planSHA, schedule, scheduleHash); err != nil {
			t.Fatal(err)
		}
		f.locals[i], err = LoadPQLabDistributedLocal(local.root, f.planSHA)
		if err != nil {
			t.Fatal(err)
		}
		a, err := NewPQEngineAuthorization(schedule, scheduleHash)
		if err != nil {
			t.Fatal(err)
		}
		auths = append(auths, a)
	}
	doc, err := cmttypes.GenesisDocFromJSON(f.plan.GenesisRaw)
	if err != nil {
		t.Fatal(err)
	}
	vf := &validatorRegistryFixture{migration: f.locals[0].migration, bootstrap: f.locals[0].bootstrap, pins: f.plan.Pins, raw: f.plan.GenesisRaw, doc: doc, legacy: map[string]ed25519.PrivateKey{}}
	var harnesses []*engineWiringHarness
	var closers []func() error
	closeAll := func() {
		for i := len(closers) - 1; i >= 0; i-- {
			if e := closers[i](); e != nil {
				t.Error(e)
			}
		}
		closers = nil
	}
	t.Cleanup(closeAll)
	pvs := map[string]*PQTransitionPrivValidator{}
	for i, local := range f.locals {
		n := local.node
		legacy, e := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, f.plan.ChainID)
		if e != nil {
			t.Fatal(e)
		}
		key := legacy.Key.PrivKey.(cmted.PrivKey)
		vf.legacy[string(n.ValidatorAddress)] = ed25519.PrivateKey(key)
		defer clear(key)
		app, e := NewPersistentApplicationWithEngineAuthorization(local.migration, n.StatePath, local.bootstrap, auths[i])
		if e != nil {
			t.Fatal(e)
		}
		db, e := dbm.NewGoLevelDB("state", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		closers = append(closers, db.Close)
		blocks, e := dbm.NewGoLevelDB("blockstore", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		closers = append(closers, blocks.Close)
		h := &engineWiringHarness{f: vf, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: n.StatePath}
		h.proxy = startEngineTestProxy(t, app)
		closers = append(closers, h.proxy.Stop)
		harnesses = append(harnesses, h)
		if _, e = h.wrapped().Load(); e != nil {
			t.Fatal(e)
		}
		registry, e := NewPQCommittedSignerRegistry(app, local.bootstrap)
		if e != nil {
			t.Fatal(e)
		}
		bindingRaw, e := os.ReadFile(n.HostBindingFile)
		if e != nil {
			t.Fatal(e)
		}
		var binding ynxconsensusauth.HostKeyBinding
		if e = json.Unmarshal(bindingRaw, &binding); e != nil {
			t.Fatal(e)
		}
		credential, e := os.ReadFile(n.RecoveryCredentialFile)
		if e != nil {
			t.Fatal(e)
		}
		host, e := ynxconsensusauth.ResumeHostSigner(n.VaultFile, credential, binding, registry)
		clear(credential)
		if e != nil {
			t.Fatal(e)
		}
		closers = append(closers, host.Close)
		signer, e := host.Signer()
		if e != nil {
			t.Fatal(e)
		}
		pq, e := NewPQPrivValidator(signer, app)
		if e != nil {
			t.Fatal(e)
		}
		pvs[string(n.ValidatorAddress)], e = NewPQTransitionPrivValidator(legacy, pq, local.bootstrap, auths[i])
		if e != nil {
			t.Fatal(e)
		}
	}
	target, err := os.ReadFile(filepath.Join(f.corpusRoot, f.corpus.Transactions[0].Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	nextTx, err := os.ReadFile(filepath.Join(f.corpusRoot, f.corpus.Transactions[1].Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	for height := s.RegistryHeight + 1; height <= s.ActivationHeight+3; height++ {
		state, e := harnesses[0].wrapped().Load()
		if e != nil {
			t.Fatal(e)
		}
		var txs cmttypes.Txs
		if height == s.ActivationHeight+1 {
			txs = cmttypes.Txs{target}
		}
		if height == s.ActivationHeight+2 {
			// The second exact original is a real nonce-reuse failure in the
			// signed block. Complete readback must preserve its error as well.
			txs = cmttypes.Txs{nextTx, nextTx}
		}
		block, e := state.MakeBlock(height, txs, harnesses[0].blocks.LoadSeenCommit(height-1), nil, state.Validators.GetProposer().Address)
		if e != nil {
			t.Fatal(e)
		}
		parts, e := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if e != nil {
			t.Fatal(e)
		}
		id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
		commit := &cmttypes.Commit{Height: height, BlockID: id}
		for i, v := range state.Validators.Validators {
			vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: height, BlockID: id, Timestamp: block.Time.Add(time.Second), ValidatorAddress: bytes.Clone(v.Address), ValidatorIndex: int32(i)}
			pv := pvs[string(v.Address)]
			if e = pv.SetConsensusSigningContext(f.plan.ChainID, height, 0, state.Validators); e != nil {
				t.Fatal(e)
			}
			p := vote.ToProto()
			if e = pv.SignVote(f.plan.ChainID, p); e != nil {
				t.Fatal(e)
			}
			vote.Signature = p.Signature
			if e = vote.Verify(f.plan.ChainID, v.PubKey); e != nil {
				t.Fatal(e)
			}
			commit.Signatures = append(commit.Signatures, vote.CommitSig())
		}
		for _, h := range harnesses {
			actual, e := h.wrapped().Load()
			if e != nil {
				t.Fatal(e)
			}
			h.blocks.SaveBlock(block, parts, commit)
			executor := sm.NewBlockExecutor(h.wrapped(), log.NewNopLogger(), h.proxy.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, h.blocks)
			if _, e = executor.ApplyBlock(actual, id, block); e != nil {
				t.Fatal(e)
			}
		}
	}
	closeAll()
	var options []PQLabDistributedReadbackOptions
	for _, local := range f.locals {
		state, e := readPQEngineCommittedState(local.node.StatePath, local.migration, local.bootstrap, auths[local.node.Index], nil)
		if e != nil {
			t.Fatal(e)
		}
		dir := filepath.Join(local.root, "public-transactions")
		if e = os.Mkdir(dir, 0700); e != nil {
			t.Fatal(e)
		}
		txPath := filepath.Join(dir, pqLabSHA(target)+".abci")
		if e = pqLabWrite(txPath, target); e != nil {
			t.Fatal(e)
		}
		a, e := os.ReadFile(filepath.Join(local.root, "activation", "activation.json"))
		if e != nil {
			t.Fatal(e)
		}
		options = append(options, PQLabDistributedReadbackOptions{RootDir: local.root, PlanSHA256: f.planSHA, ActivationSHA256: pqLabSHA(a), Mode: "proof", ExpectedHeight: state.Height, ExpectedAppHash: state.AppHash, OutputDir: filepath.Join(pqLabWorkloadTemp(t), "public"), TransactionFile: txPath, TransactionSHA256: pqLabSHA(target), NativeWireHash: strings.TrimPrefix(f.corpus.Transactions[0].NativeHash, "0x"), TrustingPeriod: time.Hour, MaxClockDrift: time.Minute, TrustNumerator: 1, TrustDenominator: 3})
	}
	return f, options
}

func TestPQLabDistributedReadbackRealPQProofAndPublicTamper(t *testing.T) {
	f, options := distributedPQReadbackFixture(t)
	var inputs []PQLabDistributedPublicInput
	for _, o := range options {
		before := inspectionInventory(t, o.RootDir)
		r, err := ReadPQLabDistributedCheckpoint(context.Background(), o, time.Now().UTC())
		if err != nil {
			t.Fatal("actual host-local AND proof capture", err)
		}
		if r.Materials == nil || r.Proof == nil || !r.ColdReopened {
			t.Fatal("normal proof not captured")
		}
		if !reflect.DeepEqual(before, inspectionInventory(t, o.RootDir)) {
			t.Fatal("proof capture mutated original source")
		}
		inputs = append(inputs, distributedReadbackInput(t, o.OutputDir))
	}
	if result, err := ComparePQLabDistributedReadbacks(f.planRaw, f.planSHA, inputs, time.Now().UTC()); err != nil || !result.FullHeightEqual || !result.FullStateEqual {
		t.Fatal("four complete public proof/readbacks differ", err)
	}
	// The normal proof-context writer and original transaction verifier consume
	// EXACT exported public materials, not a test-only boolean or trusted stub.
	raw, err := os.ReadFile(filepath.Join(inputs[0].Directory, "materials.json"))
	if err != nil {
		t.Fatal(err)
	}
	m, err := DecodePQLabProofMaterials(raw, pqLabSHA(raw))
	if err != nil {
		t.Fatal(err)
	}
	proofRaw, err := os.ReadFile(filepath.Join(inputs[0].Directory, "proof.json"))
	if err != nil {
		t.Fatal(err)
	}
	proof, err := DecodePQTransactionProofRequest(proofRaw)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := WritePQLabProofInputs(filepath.Join(pqLabWorkloadTemp(t), "normal-context"), m, proof, time.Now().UTC())
	if err != nil || !verified.Result.ExecutionSuccessful || verified.AuthorityGranted || verified.ActualNetworkExecutionClaim {
		t.Fatal("normal independent proof consumer", err)
	}
	var originalRows []PQLabDistributedHeight
	heightsRaw, err := os.ReadFile(filepath.Join(inputs[0].Directory, "heights.json"))
	if err != nil || json.Unmarshal(heightsRaw, &originalRows) != nil {
		t.Fatal("complete original height file", err)
	}
	failureRow := -1
	for i, row := range originalRows {
		var result abci.ResponseFinalizeBlock
		if err = result.Unmarshal(row.FinalizeResponse); err != nil {
			t.Fatal(err)
		}
		if len(result.TxResults) == 2 && result.TxResults[0].Code == 0 && result.TxResults[1].Code != 0 {
			failureRow = i
		}
	}
	if failureRow < 0 {
		t.Fatal("actual successful and rejected execution results were not preserved")
	}
	for _, name := range []string{"bad_present_commit", "wrong_full_result", "wrong_full_state", "alter_uncommitted_error_detail"} {
		t.Run(name, func(t *testing.T) {
			derived := filepath.Join(pqLabWorkloadTemp(t), "public")
			if err := os.Mkdir(derived, 0700); err != nil {
				t.Fatal(err)
			}
			entries, err := os.ReadDir(inputs[0].Directory)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				raw, e := os.ReadFile(filepath.Join(inputs[0].Directory, entry.Name()))
				if e != nil {
					t.Fatal(e)
				}
				if e = pqLabWrite(filepath.Join(derived, entry.Name()), raw); e != nil {
					t.Fatal(e)
				}
			}
			raw, _ := os.ReadFile(filepath.Join(derived, "result.json"))
			var receipt PQLabDistributedReadback
			if err = json.Unmarshal(raw, &receipt); err != nil {
				t.Fatal(err)
			}
			if name == "wrong_full_state" {
				data, _ := os.ReadFile(filepath.Join(derived, "committed-state.json"))
				var state CommittedState
				if err = json.Unmarshal(data, &state); err != nil {
					t.Fatal(err)
				}
				state.Accounts[0].Balance++
				data, err = json.Marshal(state)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(derived, "committed-state.json"), data, 0600); err != nil {
					t.Fatal(err)
				}
				receipt.State = pqLabFile("committed-state.json", data)
			} else {
				data, _ := os.ReadFile(filepath.Join(derived, "heights.json"))
				var rows []PQLabDistributedHeight
				if err = json.Unmarshal(data, &rows); err != nil {
					t.Fatal(err)
				}
				last := &rows[len(rows)-1]
				if name == "bad_present_commit" {
					var lb cmttypes.LightBlock
					if err = cmtjson.Unmarshal(last.LightBlock, &lb); err != nil {
						t.Fatal(err)
					}
					lb.Commit.Signatures[0].Signature[len(lb.Commit.Signatures[0].Signature)-1] ^= 1
					last.LightBlock, err = cmtjson.Marshal(&lb)
					if err != nil {
						t.Fatal(err)
					}
				} else if name == "alter_uncommitted_error_detail" {
					var result abci.ResponseFinalizeBlock
					if err = result.Unmarshal(rows[failureRow].FinalizeResponse); err != nil {
						t.Fatal(err)
					}
					result.TxResults[1].Log += " altered original failure detail"
					rows[failureRow].FinalizeResponse, err = result.Marshal()
					if err != nil {
						t.Fatal(err)
					}
				} else {
					last.FinalizeResponse = append(last.FinalizeResponse, 0xff)
				}
				data, err = json.Marshal(rows)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(derived, "heights.json"), data, 0600); err != nil {
					t.Fatal(err)
				}
				entry := pqLabFile("heights.json", data)
				receipt.Heights = &entry
			}
			raw, err = json.Marshal(receipt)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(derived, "result.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			bad := append([]PQLabDistributedPublicInput(nil), inputs...)
			bad[0] = distributedReadbackInput(t, derived)
			if _, err = ComparePQLabDistributedReadbacks(f.planRaw, f.planSHA, bad, time.Now().UTC()); err == nil {
				t.Fatal("rehashed public corruption accepted")
			}
		})
	}
	if output := os.Getenv("YNX_PQ_DISTRIBUTED_READBACK_PUBLIC_OUT"); output != "" {
		if err = pqLabNetworkFreshDirectory(output); err != nil {
			t.Fatal(err)
		}
		if err = pqLabWrite(filepath.Join(output, "plan.json"), f.planRaw); err != nil {
			t.Fatal(err)
		}
		public := make([]PQLabDistributedPublicInput, 0, 4)
		for i, input := range inputs {
			dir := filepath.Join(output, []string{"node-0", "node-1", "node-2", "node-3"}[i])
			if err = os.Mkdir(dir, 0700); err != nil {
				t.Fatal(err)
			}
			entries, e := os.ReadDir(input.Directory)
			if e != nil {
				t.Fatal(e)
			}
			for _, entry := range entries {
				if entry.Name() == "intent.json" {
					continue
				}
				data, e := os.ReadFile(filepath.Join(input.Directory, entry.Name()))
				if e != nil {
					t.Fatal(e)
				}
				if e = pqLabWrite(filepath.Join(dir, entry.Name()), data); e != nil {
					t.Fatal(e)
				}
			}
			public = append(public, distributedReadbackInput(t, dir))
		}
		data, err := json.Marshal(public)
		if err != nil {
			t.Fatal(err)
		}
		if err = pqLabWrite(filepath.Join(output, "receipts.json"), data); err != nil {
			t.Fatal(err)
		}
		if err = pqLabWriteJSON(filepath.Join(output, "pins.json"), struct{ PlanSHA256, ReceiptsSHA256 string }{f.planSHA, pqLabSHA(data)}); err != nil {
			t.Fatal(err)
		}
	}
}
