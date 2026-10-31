//go:build transportlab_actual

package transportlab

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/p2p"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
	"github.com/cometbft/cometbft/proxy"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/cosmos/gogoproto/proto"
)

// These tests require the Core CI owner to supply an artifact root. They never
// select the system temp directory or skip into a false PASS when it is absent.
const networkNextArtifactEnvironment = "YNX_NETWORK_NEXT_ARTIFACT_ROOT"

type actualArtifacts struct {
	root  string
	trace *os.File
}

func newActualArtifacts(t *testing.T) *actualArtifacts {
	t.Helper()
	root := os.Getenv(networkNextArtifactEnvironment)
	if root == "" {
		t.Fatalf("%s must be supplied by the Core CI owner; functional evidence is NOT_SUPPLIED", networkNextArtifactEnvironment)
	}
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		t.Fatal("explicit canonical absolute artifact root required")
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		t.Fatal("artifact root must already exist without path aliases", err)
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		t.Fatal("artifact root must be an existing owner-controlled directory", err)
	}
	run, err := os.MkdirTemp(root, "application-lossless-")
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(filepath.Join(run, "actual-steps.jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	a := &actualArtifacts{root: run, trace: f}
	t.Cleanup(func() {
		if e := f.Sync(); e != nil {
			t.Error(e)
		}
		if e := f.Close(); e != nil {
			t.Error(e)
		}
	})
	t.Logf("public Application functional artifacts (preserved): %s", run)
	a.event(t, map[string]any{"stage": "started", "physicalBytesMeasured": false, "fullNodeStarted": false, "productionActivation": false, "coldProcessClaim": false})
	return a
}

func (a *actualArtifacts) event(t *testing.T, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	if _, err = a.trace.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err = a.trace.Sync(); err != nil {
		t.Fatal(err)
	}
}

func (a *actualArtifacts) directory(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(a.root, name)
	if filepath.Base(name) != name || name == "." {
		t.Fatal("owned artifact child name required")
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	return path
}

func (a *actualArtifacts) write(t *testing.T, name string, raw []byte) {
	t.Helper()
	if filepath.Base(name) != name || name == "." {
		t.Fatal("owned artifact file name required")
	}
	f, err := os.OpenFile(filepath.Join(a.root, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	n, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || n != len(raw) || syncErr != nil || closeErr != nil {
		t.Fatalf("preserving public artifact failed: write=%v sync=%v close=%v", writeErr, syncErr, closeErr)
	}
}

func (a *actualArtifacts) state(t *testing.T, label string, s actualApplicationSnapshot) {
	t.Helper()
	a.write(t, label+".state.json", s.RawState)
	a.event(t, map[string]any{"stage": label, "height": s.State.Height, "appHash": s.State.AppHash, "stateBytes": len(s.RawState), "completePublicStateCompared": true})
}

type actualWorkload struct {
	migration chain.ConsensusMigrationState
	manifest  consensus.PQLabWorkloadManifest
	corpus    string
}

func newActualWorkload(t *testing.T, art *actualArtifacts) actualWorkload {
	t.Helper()
	// This is the existing Core source and original N=1 signer. Account classic
	// and both PQ private keys are generated/destroyed INSIDE that implementation.
	// It mines its own real source migration; no test reimplements that logic.
	source, err := consensus.NewPQLabWorkloadSource(consensus.PQLabWorkloadOptions{Transfers: 3, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if source.Migration.Network.IsPublicNet || source.Migration.Network.ChainID != consensus.PQLabNativeChainID {
		t.Fatal("source fixture is not the original isolated PQ lab")
	}
	// Bind ONLY temporary validator public keys with the existing public Core
	// binding method. No validator process or consensus signer is started.
	bindings := make([]chain.ConsensusValidatorKeyBinding, len(source.Migration.Validators))
	for i, v := range source.Migration.Validators {
		key := ed25519.GenPrivKey()
		public := key.PubKey()
		bindings[i] = chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public.Bytes()), ConsensusAddress: public.Address().String()}
		clear(key)
	}
	bound, err := source.Migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	corpus := filepath.Join(art.root, "public-corpus")
	manifest, err := source.WriteCorpus(corpus, bound)
	if err != nil {
		t.Fatal(err)
	}
	if !manifest.SyntheticOnly || manifest.NetworkStarted || manifest.AuthorityGranted || manifest.DeployedSourceQualification || len(manifest.Transactions) != 3 || len(manifest.InvalidSignatureEnvelopes) != 2 {
		t.Fatal("Core public source changed its exact isolated N=1 control contract")
	}
	for _, tx := range manifest.Transactions {
		if tx.Type != consensus.PQTransferType || tx.Members != "1" || tx.AmountPerMember != "1" || tx.FeePerMember != "1" {
			t.Fatal("Core source did not supply the original N=1 transfer contract")
		}
	}
	raw, err := bound.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	art.write(t, "bound-migration.json", raw)
	return actualWorkload{migration: bound, manifest: manifest, corpus: corpus}
}

func readActualOriginal(t *testing.T, w actualWorkload, file consensus.PQLabWorkloadFile) []byte {
	t.Helper()
	if filepath.Base(file.Path) != file.Path || file.Path == "." {
		t.Fatal("Core manifest contains nonlocal public path")
	}
	n, err := strconv.ParseUint(file.Bytes, 10, 32)
	if err != nil || n == 0 || n > 64<<20 || strconv.FormatUint(n, 10) != file.Bytes {
		t.Fatal("Core public file has invalid bound")
	}
	path := filepath.Join(w.corpus, file.Path)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != int64(n) {
		t.Fatal("original public file identity changed", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if uint64(len(raw)) != n || hex.EncodeToString(sum[:]) != file.SHA256 {
		t.Fatal("original public bytes differ from the Core manifest")
	}
	return raw
}

type actualArm struct {
	name, path string
	app        *consensus.Application
}

func newActualArm(t *testing.T, art *actualArtifacts, m chain.ConsensusMigrationState, name string) *actualArm {
	t.Helper()
	dir := art.directory(t, name)
	path := filepath.Join(dir, "state.json")
	app, err := consensus.NewPersistentApplication(m, path)
	if err != nil {
		t.Fatal(err)
	}
	return &actualArm{name: name, path: path, app: app}
}

func restoredActualC(t *testing.T, codec *mempool.LosslessHexCodec, original []byte) []byte {
	t.Helper()
	before := bytes.Clone(original)
	frame, eligible, err := codec.Pack(original)
	if err != nil || !eligible {
		t.Fatal("actual Core original C was not packable", eligible, err)
	}
	restored, err := codec.Restore(frame)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, before) || !bytes.Equal(cmttypes.Tx(restored).Hash(), cmttypes.Tx(before).Hash()) {
		t.Fatal("actual original C/hash changed")
	}
	for i := range frame {
		frame[i] ^= 0xff
	}
	if !bytes.Equal(restored, before) {
		t.Fatal("restored C aliases the packed frame")
	}
	return restored
}

// A transparent counter delegates every actual CheckTx to the real Core app.
// It does not return synthetic success, alter a request/result, or verify math.
type countedActualApplication struct {
	*consensus.Application
	mu           sync.Mutex
	calls        int
	lastTx       []byte
	lastResponse *abci.ResponseCheckTx
}

func (a *countedActualApplication) CheckTx(ctx context.Context, req *abci.RequestCheckTx) (*abci.ResponseCheckTx, error) {
	a.mu.Lock()
	a.calls++
	a.lastTx = bytes.Clone(req.Tx)
	a.mu.Unlock()
	response, err := a.Application.CheckTx(ctx, req)
	a.mu.Lock()
	if response != nil {
		a.lastResponse = proto.Clone(response).(*abci.ResponseCheckTx)
	}
	a.mu.Unlock()
	return response, err
}

func (a *countedActualApplication) observations() (int, []byte, *abci.ResponseCheckTx) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.calls, bytes.Clone(a.lastTx), a.lastResponse
}

// Receive requires only connection capability/ID metadata in this isolated
// fixture. No network/peer service is started or simulated. Unexpected calls to
// any other embedded Peer method fail instead of manufacturing a live peer.
type actualCarrierCapabilityPeer struct{ p2p.Peer }

func (*actualCarrierCapabilityPeer) ID() p2p.ID {
	return p2p.ID("1111111111111111111111111111111111111111")
}
func (*actualCarrierCapabilityPeer) NodeInfo() p2p.NodeInfo {
	return p2p.DefaultNodeInfo{Channels: []byte{mempool.MempoolChannel, mempool.LosslessHexV1Channel}}
}

func actualCorruptCarrierBoundary(t *testing.T, art *actualArtifacts, app *consensus.Application, codec *mempool.LosslessHexCodec, original []byte) {
	t.Helper()
	before := captureActualApplication(t, app)
	counted := &countedActualApplication{Application: app}
	client, err := proxy.NewLocalClientCreator(counted).NewABCIClient()
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if e := client.Stop(); e != nil {
			t.Error(e)
		}
	})
	config := cfg.DefaultMempoolConfig()
	mp := mempool.NewCListMempool(config, client, before.State.Height)
	r := mempool.NewReactor(config, mp)
	r.SetLogger(log.NewNopLogger())
	if err = r.EnableExperimentalLosslessHex(mempool.LosslessHexLimits{}); err != nil {
		t.Fatal(err)
	}
	peer := &actualCarrierCapabilityPeer{}
	r.InitPeer(peer)
	frame, eligible, err := codec.Pack(original)
	if err != nil || !eligible {
		t.Fatal("real source carrier setup", eligible, err)
	}
	for _, mode := range []string{"magic", "version", "declared-length", "hash", "wire", "trailing"} {
		bad := bytes.Clone(frame)
		switch mode {
		case "magic":
			bad[0] ^= 0xff
		case "version":
			bad[4]++
		case "declared-length":
			bad[8] ^= 0x7f
		case "hash":
			bad[16] ^= 1
		case "wire":
			bad[len(bad)-1] ^= 1
		case "trailing":
			bad = append(bad, 0)
		}
		r.Receive(p2p.Envelope{ChannelID: mempool.LosslessHexV1Channel, Src: peer, Message: &protomem.LosslessHexV1{Frame: bad}})
		if err = mp.FlushAppConn(); err != nil {
			t.Fatal(err)
		}
		calls, _, _ := counted.observations()
		if calls != 0 || mp.Size() != 0 {
			t.Fatalf("corrupt packed %s reached actual CheckTx or mempool", mode)
		}
		requireActualApplicationUnchanged(t, before, app)
		art.event(t, map[string]any{"stage": "corrupt-carrier-rejected-before-real-CheckTx", "control": mode, "actualCheckTxCalls": calls})
	}
	r.Receive(p2p.Envelope{ChannelID: mempool.LosslessHexV1Channel, Src: peer, Message: &protomem.LosslessHexV1{Frame: frame}})
	if err = mp.FlushAppConn(); err != nil {
		t.Fatal(err)
	}
	calls, got, response := counted.observations()
	reaped := mp.ReapMaxTxs(-1)
	if calls != 1 || response == nil || response.Code != abci.CodeTypeOK || !bytes.Equal(got, original) || len(reaped) != 1 || !bytes.Equal(reaped[0], original) {
		t.Fatal("actual reactor did not restore original C before the genuine Core CheckTx")
	}
	for i := range frame {
		frame[i] = 0
	}
	if !bytes.Equal(reaped[0], original) {
		t.Fatal("actual admitted C aliases corruptible carrier bytes")
	}
	requireActualApplicationUnchanged(t, before, app)
	art.event(t, map[string]any{"stage": "valid-carrier-genuine-CheckTx", "actualCheckTxCalls": calls, "code": response.Code, "originalHash": consensus.SignedTransactionHash(got), "carrierFunctionalOnly": true})
}

func actualCheckAndProposalRejection(t *testing.T, art *actualArtifacts, arm *actualArm, raw []byte, label string, signature bool) {
	t.Helper()
	before := captureActualApplication(t, arm.app)
	height := before.State.Height + 1
	at := time.Unix(height, 0).UTC()
	check, err := arm.app.CheckTx(t.Context(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || check == nil || check.Code == abci.CodeTypeOK {
		t.Fatal("real CheckTx accepted negative control", label, err)
	}
	if signature && !strings.Contains(check.Log, ynxbatch.ErrInvalidSignature.Error()) {
		t.Fatal("AND control rejected for a different first cause", label, check.Log)
	}
	requireActualApplicationUnchanged(t, before, arm.app)
	prepared, err := arm.app.PrepareProposal(t.Context(), &abci.RequestPrepareProposal{Height: height, Time: at, MaxTxBytes: 1 << 20, Txs: [][]byte{raw}})
	if err != nil || prepared == nil || len(prepared.Txs) != 0 {
		t.Fatal("real PrepareProposal did not exclude negative control", label, err)
	}
	requireActualApplicationUnchanged(t, before, arm.app)
	processed, err := arm.app.ProcessProposal(t.Context(), &abci.RequestProcessProposal{Height: height, Time: at, Txs: [][]byte{raw}})
	if err != nil || processed == nil || processed.Status != abci.ResponseProcessProposal_REJECT {
		t.Fatal("real ProcessProposal accepted negative control", label, err)
	}
	requireActualApplicationUnchanged(t, before, arm.app)
	art.event(t, map[string]any{"stage": "genuine-CheckTx-Prepare-Process-rejection", "arm": arm.name, "control": label, "height": height, "code": check.Code, "firstCause": check.Log, "originalHash": consensus.SignedTransactionHash(raw), "completeStateUnchanged": true})
}

func actualColdReload(t *testing.T, art *actualArtifacts, m chain.ConsensusMigrationState, arm *actualArm, label string) {
	t.Helper()
	before := captureActualApplication(t, arm.app)
	// Application exposes no Close and holds no long-lived persistence file
	// handle. This is its normal constructor/load boundary, NOT a cold process,
	// abrupt crash, node finality proof or cache-free crypto benchmark.
	cold, err := consensus.NewPersistentApplication(m, arm.path)
	if err != nil {
		t.Fatal("normal Application reload failed", err)
	}
	after := captureActualApplication(t, cold)
	requireActualApplicationsEqual(t, before, after)
	arm.app = cold
	art.state(t, label+"-"+arm.name, after)
}

func actualRejectedFinalizeAndCommit(t *testing.T, art *actualArtifacts, w actualWorkload, codec *mempool.LosslessHexCodec, raw []byte, label string) {
	t.Helper()
	plain := newActualArm(t, art, w.migration, "negative-"+label+"-plain")
	encoded := newActualArm(t, art, w.migration, "negative-"+label+"-restored")
	restored := restoredActualC(t, codec, raw)
	var results []*abci.ResponseFinalizeBlock
	for i, arm := range []*actualArm{plain, encoded} {
		input := raw
		if i == 1 {
			input = restored
		}
		before := captureActualApplication(t, arm.app)
		actualCheckAndProposalRejection(t, art, arm, input, label, true)
		// Deliberately adversarial direct ABCI call: normal Comet would never
		// finalize its rejected proposal. Exercise Core's last defense too.
		out, err := arm.app.FinalizeBlock(t.Context(), &abci.RequestFinalizeBlock{Height: before.State.Height + 1, Time: time.Unix(before.State.Height+1, 0).UTC(), Txs: [][]byte{input}})
		if err != nil || out == nil || len(out.TxResults) != 1 || out.TxResults[0].Code == abci.CodeTypeOK || !strings.Contains(out.TxResults[0].Log, ynxbatch.ErrInvalidSignature.Error()) {
			t.Fatal("real defensive FinalizeBlock accepted bad independent signature", label, err)
		}
		requireActualApplicationUnchanged(t, before, arm.app)
		if _, err = arm.app.Commit(t.Context(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		after := captureActualApplication(t, arm.app)
		if !reflect.DeepEqual(before.State.Accounts, after.State.Accounts) || !reflect.DeepEqual(before.State.AccountPolicy, after.State.AccountPolicy) || !reflect.DeepEqual(before.State.PQHistory, after.State.PQHistory) {
			t.Fatal("rejected signature changed original accounts/policy/PQ history")
		}
		results = append(results, out)
		art.state(t, label+"-rejected-commit-"+arm.name, after)
		actualColdReload(t, art, w.migration, arm, label+"-rejected-reload")
	}
	if !proto.Equal(results[0], results[1]) {
		t.Fatal("bad-signature Finalize results differ across the carrier")
	}
	requireActualApplicationsEqual(t, captureActualApplication(t, plain.app), captureActualApplication(t, encoded.app))
}

func TestLosslessHexActualApplicationLifecycleAndCold(t *testing.T) {
	art := newActualArtifacts(t)
	w := newActualWorkload(t, art)
	codec, err := mempool.NewLosslessHexCodec(cfg.DefaultMempoolConfig().MaxTxBytes, mempool.LosslessHexLimits{})
	if err != nil {
		t.Fatal(err)
	}
	plain := newActualArm(t, art, w.migration, "plain-original")
	encoded := newActualArm(t, art, w.migration, "restored-original")
	initial := captureActualApplication(t, plain.app)
	requireActualApplicationsEqual(t, initial, captureActualApplication(t, encoded.app))
	initialOwner := actualAccount(t, initial, w.manifest.Owner)
	if strconv.FormatInt(initialOwner.Balance, 10) != w.manifest.InitialOwnerBalance || initialOwner.Nonce != 1 {
		t.Fatal("actual source starting balance/nonce differs from original Core N=1 workload")
	}
	for _, a := range initial.State.Accounts {
		if a.Address == w.manifest.Recipient {
			t.Fatal("original Core fixture unexpectedly prefunded its fresh recipient")
		}
	}
	art.state(t, "initial-complete", initial)
	first := readActualOriginal(t, w, w.manifest.Transactions[0].Envelope)
	actualCorruptCarrierBoundary(t, art, encoded.app, codec, first)
	for i, bad := range w.manifest.InvalidSignatureEnvelopes {
		raw := readActualOriginal(t, w, bad)
		label := []string{"sigma-A", "sigma-B"}[i]
		actualRejectedFinalizeAndCommit(t, art, w, codec, raw, label)
	}
	frame, eligible, err := codec.Pack(first)
	if err != nil || !eligible {
		t.Fatal(err)
	}
	for _, arm := range []*actualArm{plain, encoded} {
		actualCheckAndProposalRejection(t, art, arm, frame, "packed-bytes-are-not-original-C", false)
	}
	for index, tx := range w.manifest.Transactions {
		original := readActualOriginal(t, w, tx.Envelope)
		restored := restoredActualC(t, codec, original)
		if consensus.SignedTransactionHash(original) != tx.ABCIHash || consensus.SignedTransactionHash(restored) != tx.ABCIHash {
			t.Fatal("actual original C or restored C differs from the Core manifest hash")
		}
		var finalized []*abci.ResponseFinalizeBlock
		var committed []*abci.ResponseCommit
		for i, arm := range []*actualArm{plain, encoded} {
			raw := original
			if i == 1 {
				raw = restored
			}
			before := captureActualApplication(t, arm.app)
			height := before.State.Height + 1
			at := time.Unix(height, 0).UTC()
			check, e := arm.app.CheckTx(t.Context(), &abci.RequestCheckTx{Tx: raw})
			if e != nil || check == nil || check.Code != abci.CodeTypeOK {
				t.Fatal("genuine Core CheckTx rejected original N=1", arm.name, index, e)
			}
			requireActualApplicationUnchanged(t, before, arm.app)
			art.event(t, map[string]any{"stage": "CheckTx", "arm": arm.name, "height": height, "originalHash": tx.ABCIHash, "code": check.Code})
			prepared, e := arm.app.PrepareProposal(t.Context(), &abci.RequestPrepareProposal{Height: height, Time: at, MaxTxBytes: int64(codec.MaxOriginalBytes()), Txs: [][]byte{raw}})
			if e != nil || prepared == nil || len(prepared.Txs) != 1 || !bytes.Equal(prepared.Txs[0], original) {
				t.Fatal("normal PrepareProposal changed or rejected C", arm.name, index, e)
			}
			requireActualApplicationUnchanged(t, before, arm.app)
			art.event(t, map[string]any{"stage": "PrepareProposal", "arm": arm.name, "height": height, "originalHash": tx.ABCIHash, "selected": len(prepared.Txs)})
			processed, e := arm.app.ProcessProposal(t.Context(), &abci.RequestProcessProposal{Height: height, Time: at, Txs: prepared.Txs})
			if e != nil || processed == nil || processed.Status != abci.ResponseProcessProposal_ACCEPT {
				t.Fatal("normal ProcessProposal rejected original C", arm.name, index, e)
			}
			requireActualApplicationUnchanged(t, before, arm.app)
			art.event(t, map[string]any{"stage": "ProcessProposal", "arm": arm.name, "height": height, "originalHash": tx.ABCIHash, "status": processed.Status.String()})
			out, e := arm.app.FinalizeBlock(t.Context(), &abci.RequestFinalizeBlock{Height: height, Time: at, Txs: prepared.Txs})
			if e != nil || out == nil || len(out.TxResults) != 1 || out.TxResults[0].Code != abci.CodeTypeOK || !bytes.Equal(out.TxResults[0].Data, []byte(tx.ABCIHash)) {
				t.Fatal("normal FinalizeBlock rejected or changed original C identity", arm.name, index, e)
			}
			requireActualApplicationUnchanged(t, before, arm.app)
			art.event(t, map[string]any{"stage": "FinalizeBlock-pending-only", "arm": arm.name, "height": height, "originalHash": tx.ABCIHash, "code": out.TxResults[0].Code})
			commit, e := arm.app.Commit(t.Context(), &abci.RequestCommit{})
			if e != nil || commit == nil {
				t.Fatal("normal Commit failed", arm.name, index, e)
			}
			after := captureActualApplication(t, arm.app)
			if after.State.Height != height || !after.State.Initialized || !bytes.Equal(after.Info.LastBlockAppHash, out.AppHash) {
				t.Fatal("actual Commit Info/state differs from finalized app hash")
			}
			owner := actualAccount(t, after, w.manifest.Owner)
			nonce, e := strconv.ParseUint(tx.FirstNonce, 10, 64)
			if e != nil || owner.Nonce != nonce || owner.Balance != initialOwner.Balance-int64(2*(index+1)) {
				t.Fatal("actual original amount+fee/nonce not executed")
			}
			recipient := actualAccount(t, after, w.manifest.Recipient)
			if recipient.Balance != int64(index+1) || recipient.Nonce != 0 {
				t.Fatal("actual recipient value/nonce differs")
			}
			art.state(t, fmt.Sprintf("committed-%d-%s", height, arm.name), after)
			finalized = append(finalized, out)
			committed = append(committed, commit)
		}
		if !proto.Equal(finalized[0], finalized[1]) || !proto.Equal(committed[0], committed[1]) {
			t.Fatal("complete normal ABCI finalize/commit responses differ across carrier")
		}
		requireActualApplicationsEqual(t, captureActualApplication(t, plain.app), captureActualApplication(t, encoded.app))
		for _, arm := range []*actualArm{plain, encoded} {
			actualCheckAndProposalRejection(t, art, arm, original, "committed-original-replay", false)
			actualColdReload(t, art, w.migration, arm, fmt.Sprintf("cold-application-after-%d", index+1))
		}
		requireActualApplicationsEqual(t, captureActualApplication(t, plain.app), captureActualApplication(t, encoded.app))
	}
	final := captureActualApplication(t, encoded.app)
	owner := actualAccount(t, final, w.manifest.Owner)
	recipient := actualAccount(t, final, w.manifest.Recipient)
	if strconv.FormatInt(owner.Balance, 10) != w.manifest.FinalOwnerBalance || strconv.FormatUint(owner.Nonce, 10) != w.manifest.FinalOwnerNonce || strconv.FormatInt(recipient.Balance, 10) != w.manifest.RecipientDelta {
		t.Fatal("original Core workload final balances/nonce not preserved")
	}
	art.event(t, map[string]any{"stage": "complete", "height": final.State.Height, "appHash": final.State.AppHash, "fullStateEqual": true, "coldApplicationReloadEqual": true, "physicalBytesMeasured": false, "productionActivation": false})
}
