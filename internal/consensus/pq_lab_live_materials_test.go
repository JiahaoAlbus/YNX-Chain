//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This fixture uses four ORIGINAL disk stores and the normal durable HostSigner
// / PrivValidator / BlockExecutor. It opens no TCP port and never Node.Start.
// Its commits are synthetic test executions, not a four-process network claim.
func pqLabLiveMaterialsFixture(t *testing.T, root string) (PQLabNetworkPlan, PQLabExportOptions, PQLabLiveMaterialsSetup) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 4, BatchSize: 2, Owners: 2, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
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
	setup, err := PreparePQLabLiveMaterials(PQLabLiveMaterialsPolicy{Version: PQLabLiveMaterialsPolicyVersion, RootDir: root, PlanSHA256: pin, ActivationSHA256: pqLabSHA(activationRaw), NodeIndex: 0, MaxOperations: 3, CaptureTimeout: 30 * time.Second, TrustingPeriod: time.Hour, MaxClockDrift: time.Minute, TrustNumerator: 1, TrustDenominator: 3})
	if err != nil {
		t.Fatal("original stopped R setup", err)
	}
	manifestRaw, err := os.ReadFile(filepath.Join(root, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	credential, err := os.ReadFile(filepath.Join(root, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	cp, err := LoadPQLabSenderCheckpoint(root, pin, pqLabSHA(activationRaw), a.RegistryHeight, a.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		sender, e := OpenPQLabSender(filepath.Join(root, "workload"), pqLabSHA(manifestRaw), i, credential)
		if e != nil {
			t.Fatal(e)
		}
		r := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat(string(rune('a'+i)), 64), OwnerIndex: i, FirstNonce: 2, Members: 2 - i}
		signed, e := sender.Sign(r, cp)
		closeErr := sender.Close()
		if e != nil || closeErr != nil {
			t.Fatal("actual online sender", e, closeErr)
		}
		transaction := signed.Transaction
		transaction.Envelope.Path = filepath.Join("sender-public", fmt.Sprintf("%04d", i), r.OperationID, "transaction.abci")
		corpus.Transactions = append(corpus.Transactions, transaction)
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
	return p, o, setup
}

func pqLabLiveMaterialsOwningNode(t *testing.T, p PQLabNetworkPlan, o PQLabExportOptions) (*node.Node, *Application) {
	t.Helper()
	_, m, b, err := loadPQLab(p.RootDir, o.PlanSHA256)
	if err != nil {
		t.Fatal(err)
	}
	schedule, err := os.ReadFile(filepath.Join(p.RootDir, "activation", "schedule.json"))
	if err != nil {
		t.Fatal(err)
	}
	var a PQLabActivation
	raw, err := os.ReadFile(filepath.Join(p.RootDir, "activation", "activation.json"))
	if err != nil || json.Unmarshal(raw, &a) != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(schedule, a.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithEngineAuthorization(m, p.Nodes[0].StatePath, b, auth)
	if err != nil {
		t.Fatal(err)
	}
	config := cmtconfig.DefaultConfig().SetRoot(p.Nodes[0].Home)
	config.TxIndex.Indexer = "null"
	config.P2P.PexReactor = false
	config.RPC.ListenAddress = ""
	config.RPC.PprofListenAddress = ""
	pv := privval.LoadFilePV(p.Nodes[0].LegacyKeyFile, p.Nodes[0].LegacyStateFile)
	noSign := &proofSourceNoSigningPV{delegate: pv}
	nodeKey, err := p2p.LoadNodeKey(p.Nodes[0].NodeKeyFile)
	if err != nil {
		t.Fatal(err)
	}
	n, err := newPQNodeWithDatabase(config, app, noSign, nodeKey, log.NewNopLogger(), cmtconfig.DefaultDBProvider)
	if err != nil {
		t.Fatal(err)
	}
	noSign.blocked = true
	t.Cleanup(func() { n.OnStop(); _ = n.ProxyApp().Stop() })
	return n, app
}

func pqLabLiveMaterialsPublishTestRequest(t *testing.T, setup PQLabLiveMaterialsSetup, r PQLabLiveMaterialsRequest) {
	t.Helper()
	_, err := PublishPQLabLiveMaterialsRequest(setup.Policy.Path, setup.Policy.SHA256, r)
	if runtime.GOOS == "linux" {
		if err != nil {
			t.Fatal("normal immutable Linux publication", err)
		}
		return
	}
	if err == nil || !strings.Contains(err.Error(), "requires Linux renameat2") {
		t.Fatal("unsupported platform silently enabled publisher", err)
	}
	// A private synthetic input fixture exercises the owning reader on macOS.
	// This is NOT a replacement/fallback production publisher or Node.Start.
	raw, e := json.Marshal(r)
	if e != nil {
		t.Fatal(e)
	}
	if e = pqLabWrite(pqLabLiveRequestPath(filepath.Dir(setup.Policy.Path), r.Sequence), raw); e != nil {
		t.Fatal(e)
	}
}

func TestPQLabLiveMaterialsOriginalAnchorContinuousProofAndSenderConfirm(t *testing.T) {
	root := os.Getenv("YNX_PQ_LAB_LIVE_FIXTURE_ROOT")
	if root == "" {
		root = filepath.Join(pqLabWorkloadTemp(t), "lab")
	}
	p, o, setup := pqLabLiveMaterialsFixture(t, root)
	if setup.AuthorityGranted || setup.NodeStarted || !setup.SyntheticOnly {
		t.Fatal("setup claimed authority or execution")
	}
	n, app := pqLabLiveMaterialsOwningNode(t, p, o)
	control, err := NewPQLabLiveMaterialsControl(n, app, setup.Policy.Path, setup.Policy.SHA256)
	if err != nil {
		t.Fatal("normal owning reader", err)
	}
	t.Cleanup(func() { _ = control.Close() })
	if _, err = NewPQLabLiveMaterialsControl(n, app, setup.Policy.Path, setup.Policy.SHA256); err == nil {
		t.Fatal("second reader attached to original Node")
	}
	stateBefore, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	hrsBefore, err := os.ReadFile(p.Nodes[0].SignerStateFile)
	if err != nil {
		t.Fatal(err)
	}
	manifestRaw, err := os.ReadFile(filepath.Join(root, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	credential, err := os.ReadFile(filepath.Join(root, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	var firstResult PQLabLiveMaterialsResult
	for i := 0; i < 2; i++ {
		operation := strings.Repeat(string(rune('a'+i)), 64)
		envelopePath := filepath.Join(root, "workload", "sender-public", fmt.Sprintf("%04d", i), operation, "transaction.abci")
		envelope, e := os.ReadFile(envelopePath)
		if e != nil {
			t.Fatal(e)
		}
		_, wire, e := pqTransactionWire(envelope)
		if e != nil {
			t.Fatal(e)
		}
		request := PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: setup.Policy.SHA256, Sequence: uint32(i + 1), TransactionFile: envelopePath, TransactionSHA256: pqLabSHA(envelope), NativeWireHash: pqLabSHA(wire)}
		if i == 0 {
			future := request
			future.Sequence = 2
			if _, e = PublishPQLabLiveMaterialsRequest(setup.Policy.Path, setup.Policy.SHA256, future); e == nil {
				t.Fatal("unbounded future queue admitted")
			}
			bad := request
			bad.TransactionFile = p.Nodes[0].VaultFile
			if _, e = PublishPQLabLiveMaterialsRequest(setup.Policy.Path, setup.Policy.SHA256, bad); e == nil {
				t.Fatal("private custody path entered DATA request")
			}
		}
		pqLabLiveMaterialsPublishTestRequest(t, setup, request)
		if _, e = PublishPQLabLiveMaterialsRequest(setup.Policy.Path, setup.Policy.SHA256, request); e == nil {
			t.Fatal("original request overwritten/replayed")
		}
		if present, e := control.step(context.Background()); !present || e != nil {
			t.Fatal("actual owning Node live capture", present, e)
		}
		result, e := ReadPQLabLiveMaterialsResult(setup.Policy.Path, setup.Policy.SHA256, uint32(i+1))
		if e != nil {
			t.Fatal("normal result", e)
		}
		if result.AuthorityGranted || result.FourNodeAgreementClaim || !result.Verified.Result.Finalized || !result.Verified.Result.ExecutionSuccessful || result.Verified.Result.NativeGrant {
			t.Fatal("invalid proof outcome boundary")
		}
		if i == 0 {
			firstResult = result
		}
		materialRaw, e := os.ReadFile(result.Materials.Path)
		if e != nil {
			t.Fatal(e)
		}
		materials, e := DecodePQLabProofMaterials(materialRaw, result.Materials.SHA256)
		if e != nil {
			t.Fatal(e)
		}
		proofRaw, e := os.ReadFile(result.Proof.Path)
		if e != nil {
			t.Fatal(e)
		}
		proof, e := DecodePQTransactionProofRequest(proofRaw)
		if e != nil {
			t.Fatal(e)
		}
		if materials.Expected.Block.HeaderHeight+1 != materials.Expected.Successor.HeaderHeight || materials.EngineHeight != app.committed.Height {
			t.Fatal("source relabeled H/H+1/checkpoint")
		}
		sender, e := OpenPQLabSender(filepath.Join(root, "workload"), pqLabSHA(manifestRaw), i, credential)
		if e != nil {
			t.Fatal(e)
		}
		r := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: operation, OwnerIndex: i, FirstNonce: 2, Members: 2 - i}
		checkpoint, e := LoadPQLabSenderCheckpoint(root, o.PlanSHA256, o.ActivationSHA256, app.committed.Height, app.committed.AppHash)
		if e != nil {
			t.Fatal(e)
		}
		next := r
		next.OperationID = strings.Repeat(string(rune('d'+i)), 64)
		next.FirstNonce = uint64(4 - i)
		next.Members = 1
		if _, e = sender.Sign(next, checkpoint); e == nil {
			t.Fatal("unconfirmed online operation released nonce")
		}
		wrong := materials
		wrong.Expected.Envelope = bytes.Clone(wrong.Expected.Envelope)
		wrong.Expected.Envelope[0] ^= 1
		if _, e = sender.Confirm(r, wrong, proof, time.Now().UTC()); e == nil {
			t.Fatal("unbound material confirmed another operation")
		}
		confirmed, e := sender.Confirm(r, materials, proof, time.Now().UTC())
		if e != nil || !confirmed.Result.Finalized || !confirmed.Result.ExecutionSuccessful {
			t.Fatal("normal original sender full proof Confirm", e)
		}
		if _, e = sender.Sign(next, checkpoint); e != nil {
			t.Fatal("full proof did not release next independent actual nonce", e)
		}
		if e = sender.Close(); e != nil {
			t.Fatal(e)
		}
	}
	// Source operations did not write application history or the original HRS.
	stateAfter, _ := os.ReadFile(p.Nodes[0].StatePath)
	hrsAfter, _ := os.ReadFile(p.Nodes[0].SignerStateFile)
	if !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(hrsBefore, hrsAfter) {
		t.Fatal("read-only source changed original state or signing history")
	}
	// A third request whose original sender transaction is not yet committed is
	// retained as UNKNOWN and permanently retires this reader, never re-signed.
	path := filepath.Join(root, "workload", "sender-public", "0000", strings.Repeat("d", 64), "transaction.abci")
	raw, _ := os.ReadFile(path)
	_, wire, _ := pqTransactionWire(raw)
	r := PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: setup.Policy.SHA256, Sequence: 3, TransactionFile: path, TransactionSHA256: pqLabSHA(raw), NativeWireHash: pqLabSHA(wire)}
	pqLabLiveMaterialsPublishTestRequest(t, setup, r)
	if _, err = control.step(context.Background()); err == nil {
		t.Fatal("uncommitted operation got proof")
	}
	failed := filepath.Join(filepath.Dir(setup.Policy.Path), "operation-000003")
	if _, err = os.Stat(filepath.Join(failed, "failure.json")); err != nil {
		t.Fatal("UNKNOWN original missing", err)
	}
	if _, err = control.step(context.Background()); err == nil {
		t.Fatal("failed source automatically retried")
	}
	if _, err = ReadPQLabLiveMaterialsResult(setup.Policy.Path, setup.Policy.SHA256, 3); err == nil {
		t.Fatal("UNKNOWN became success")
	}
	if _, err = ReadPQLabLiveMaterialsResult(setup.Policy.Path, setup.Policy.SHA256, 1); err != nil {
		t.Fatal("later UNKNOWN erased prior proof", err)
	}
	if firstResult.EngineHeight != app.committed.Height {
		t.Fatal("proof did not retain original checkpoint")
	}
	if err = control.Close(); err == nil {
		t.Fatal("UNKNOWN silently swallowed at close")
	}
	if _, err = NewPQLabLiveMaterialsControl(n, app, setup.Policy.Path, setup.Policy.SHA256); err == nil {
		t.Fatal("restart silently replayed original session")
	}
	if os.Getenv("YNX_PQ_LAB_LIVE_FIXTURE_ROOT") != "" {
		if err = pqLabWriteJSON(filepath.Join(root, "live-command-input.json"), setup); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPQLabLiveMaterialsBoundedPolicyNoSyntheticAuthority(t *testing.T) {
	root := pqLabWorkloadTemp(t)
	base := PQLabLiveMaterialsPolicy{Version: PQLabLiveMaterialsPolicyVersion, RootDir: root, PlanSHA256: strings.Repeat("a", 64), ActivationSHA256: strings.Repeat("b", 64), NodeIndex: 0, MaxOperations: 1, CaptureTimeout: time.Second, TrustingPeriod: time.Hour, MaxClockDrift: time.Minute, TrustNumerator: 1, TrustDenominator: 3}
	for _, change := range []func(*PQLabLiveMaterialsPolicy){func(p *PQLabLiveMaterialsPolicy) { p.MaxOperations = 10001 }, func(p *PQLabLiveMaterialsPolicy) { p.CaptureTimeout = 121 * time.Second }, func(p *PQLabLiveMaterialsPolicy) { p.TrustDenominator = 1 << 63 }, func(p *PQLabLiveMaterialsPolicy) { p.TrustNumerator = 0 }, func(p *PQLabLiveMaterialsPolicy) { p.NodeIndex = 4 }, func(p *PQLabLiveMaterialsPolicy) { p.PlanSHA256 = "" }} {
		p := base
		change(&p)
		if validatePQLabLivePolicy(p) == nil {
			t.Fatal("unbounded/missing independent input accepted")
		}
	}
	if _, err := PreparePQLabLiveMaterials(base); err == nil {
		t.Fatal("synthetic metadata minted a source without original plan/activation/R")
	}
	if _, err := os.Lstat(filepath.Join(root, "live-materials")); !os.IsNotExist(err) {
		t.Fatal("missing plan mutated output")
	}
}
