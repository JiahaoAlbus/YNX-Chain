//go:build linux

package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This is an opt-in normal-binary process test, not a Node.Start/network test
// or deployment receipt. The enclosing Linux job must bound the whole process
// tree (512 MiB RSS), private temp files (32 MiB), and wall time (90 seconds).
// Build both binaries before that window. No test helper executable impersonates
// the daemon: only the independently SHA256-pinned normal command is executed.
// One layout per independently authorized window. An absent layout preserves
// the original atomic scenario; journal cases use the same binary and protocol.
func TestPQRemoteSignerNormalProcessColdRecoveryAndUnknown(t *testing.T) {
	if os.Getenv("YNX_PQ_REMOTE_PROCESS") == "" {
		t.Skip("requires the separately authorized normal remote-signer process window")
	}
	if os.Getenv("YNX_PQ_REMOTE_PROCESS") != "authorized-signer-process-window" {
		t.Fatal("invalid remote signer process authorization")
	}
	layout := os.Getenv("YNX_PQ_REMOTE_PROCESS_LAYOUT")
	if layout == "" {
		layout = "atomic-json"
	}
	switch layout {
	case "atomic-json", "snapshot-journal", "block-journal":
	default:
		t.Fatal("unsupported normal remote signer process checkpoint layout")
	}
	binary := os.Getenv("YNX_PQ_REMOTE_SIGNER_BINARY")
	pin := os.Getenv("YNX_PQ_REMOTE_SIGNER_SHA256")
	checkRemoteProcessBinary(t, binary, pin)
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	f := newRemoteProcessFixture(t, layout)
	immutable := f.immutableBytes(t)
	t.Log("phase=normal-cli actualEngineCheckpoint=ready")

	first := f.start(t, ctx, binary, pin, f.files.State)
	pv, wire := f.connect(t, ctx, first, f.engine)
	f.bind(t, pv, 0)
	key, err := pv.GetPubKeyForHeight(f.chain(), f.state.LastBlockHeight+1)
	if err != nil {
		t.Fatal("normal CLI full-key readback:", err)
	}
	full, ok := key.(ynxpq.PubKey)
	if !ok || !bytes.Equal(full.Address(), f.binding.ValidatorAddress) {
		t.Fatal("normal daemon did not return independently bound full PQ identity")
	}
	precommit := f.vote(0)
	proposal := &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: precommit.Height, Round: 0, PolRound: -1, BlockID: copyPQSigningBlock(precommit.BlockID), Timestamp: precommit.Timestamp}
	if err = pv.SignProposal(f.chain(), proposal); err != nil || !full.VerifyProposal(f.chain(), proposal) {
		t.Fatal("normal CLI proposal was not durably dual-signed:", err)
	}
	prevote := clonePQPVVote(precommit)
	prevote.Type, prevote.Extension = cmtproto.PrevoteType, nil
	if err = pv.SignVote(f.chain(), prevote); err != nil || !full.VerifyVote(f.chain(), prevote) || len(prevote.ExtensionSignature) != 0 {
		t.Fatal("normal CLI prevote failed:", err)
	}
	if err = pv.SignVote(f.chain(), precommit); err != nil || !full.VerifyVote(f.chain(), precommit) || !full.VerifyVoteExtension(f.chain(), precommit) {
		t.Fatal("normal CLI precommit/extension failed:", err)
	}
	initialHRS := f.readHRS(t)
	first.stop(t) // SIGTERM, actual main signal context, original locks released.
	_ = wire.Close()
	f.assertImmutable(t, immutable)
	t.Log("phase=cold-resume originalKeysAndHRS=preserved")

	second := f.start(t, ctx, binary, pin, f.files.State)
	pv, wire = f.connect(t, ctx, second, f.engine)
	f.bind(t, pv, 0)
	retry := clonePQPVVote(precommit)
	retry.Signature, retry.ExtensionSignature = nil, nil
	if err = pv.SignVote(f.chain(), retry); err != nil || !bytes.Equal(retry.Signature, precommit.Signature) || !bytes.Equal(retry.ExtensionSignature, precommit.ExtensionSignature) || !bytes.Equal(initialHRS, f.readHRS(t)) {
		t.Fatal("cold normal command did not read the exact original signatures/HRS:", err)
	}
	// A higher actual round permits a new request at the same height. The
	// source remains the same engine checkpoint; only Comet priorities advance.
	f.bind(t, pv, 1)
	lost := f.vote(1)
	unsigned, err := lost.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	wire.arm(f.binding.SignerStatePath, initialHRS)
	err = pv.SignVote(f.chain(), lost)
	var unknown *privval.RemoteConsensusUnknown
	if !errors.As(err, &unknown) || !wire.dropped.Load() || unknown.RequestHash != sha256.Sum256(unknown.Request) || !bytes.Contains(unknown.Request, unsigned) {
		t.Fatal("actual post-persistence TCP response loss did not preserve UNKNOWN:", err)
	}
	afterObject, err := lost.Marshal()
	if err != nil || !bytes.Equal(unsigned, afterObject) {
		t.Fatal("UNKNOWN mutated the original unsigned request")
	}
	unknownHRS := f.readHRS(t)
	if bytes.Equal(initialHRS, unknownHRS) {
		t.Fatal("fault did not follow an actual durable HRS change")
	}
	var stored struct {
		Height             int64                 `json:"height"`
		Round              int32                 `json:"round"`
		Kind               ynxconsensusauth.Kind `json:"kind"`
		Signature          []byte                `json:"signature"`
		PrecommitSignature []byte                `json:"precommitSignature"`
	}
	if err = json.Unmarshal(unknownHRS, &stored); err != nil || stored.Height != lost.Height || stored.Round != 1 || stored.Kind != ynxconsensusauth.VoteExtension || len(stored.Signature) == 0 || len(stored.PrecommitSignature) == 0 {
		t.Fatal("lost response lacks complete original durable precommit/extension")
	}
	request, requestHash, writes := bytes.Clone(unknown.Request), unknown.RequestHash, wire.writes.Load()
	unknown.Request[0] ^= 1
	err = pv.SignVote(f.chain(), lost)
	var retained *privval.RemoteConsensusUnknown
	if !errors.As(err, &retained) || retained.RequestHash != requestHash || !bytes.Equal(retained.Request, request) || wire.writes.Load() != writes || !bytes.Equal(unknownHRS, f.readHRS(t)) {
		t.Fatal("terminal client retried or replaced the original UNKNOWN")
	}
	select {
	case <-pv.Done():
	default:
		t.Fatal("UNKNOWN did not terminate the normal remote session")
	}
	second.await(t) // EOF must end this one-session daemon without reconnect.
	f.assertImmutable(t, immutable)
	t.Log("phase=unknown-response durableHRS=observed automaticRetry=false")

	third := f.start(t, ctx, binary, pin, f.files.State)
	pv, wire = f.connect(t, ctx, third, f.engine)
	f.bind(t, pv, 1)
	recovered := f.vote(1) // Explicit operator readback; no automatic retry.
	if err = pv.SignVote(f.chain(), recovered); err != nil || !full.VerifyVote(f.chain(), recovered) || !full.VerifyVoteExtension(f.chain(), recovered) || !bytes.Equal(recovered.Signature, stored.PrecommitSignature) || !bytes.Equal(recovered.ExtensionSignature, stored.Signature) || !bytes.Equal(unknownHRS, f.readHRS(t)) {
		t.Fatal("cold exact UNKNOWN readback changed or failed the durable result:", err)
	}
	conflict := f.vote(1)
	conflict.BlockID.Hash[0] ^= 1
	if err = pv.SignVote(f.chain(), conflict); err == nil || len(conflict.Signature) != 0 || len(conflict.ExtensionSignature) != 0 || !bytes.Equal(unknownHRS, f.readHRS(t)) {
		t.Fatal("cold daemon accepted same-HRS conflicting block or changed history")
	}
	third.await(t)
	_ = wire.Close()

	// The same normal binary must reject an old independently preserved app
	// checkpoint even though it is a valid file with the same original genesis.
	stale := f.start(t, ctx, binary, pin, f.staleState)
	pv, wire = f.connect(t, ctx, stale, f.engine)
	if err = pv.SetConsensusCheckpointSigningContext(f.chain(), f.state.LastBlockHeight, bytes.Clone(f.state.AppHash), f.state.LastBlockHeight+1, 1, f.roundSet(1)); err == nil {
		t.Fatal("stale remote checkpoint file supplied current signing authority")
	}
	stale.await(t)
	_ = wire.Close()
	if !bytes.Equal(unknownHRS, f.readHRS(t)) {
		t.Fatal("rejected stale checkpoint changed HRS")
	}

	wrong := f.start(t, ctx, binary, pin, f.files.State)
	badEngine := f.engine
	badEngine.Address = "tcp://" + wrong.address
	badEngine.PeerPin = f.write(t, "wrong-peer.pub", []byte(hex.EncodeToString(cmted.GenPrivKey().PubKey().Bytes())+"\n"))
	raw, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", wrong.address)
	if err != nil {
		t.Fatal("connect to normal daemon for wrong-pin control:", err)
	}
	if conn, _, err := AuthenticatePQRemoteConnection(ctx, raw, badEngine); err == nil || conn != nil || !strings.Contains(err.Error(), "remote peer differs from independent full key pin") {
		t.Fatal("normal daemon connection ignored the independent full peer pin")
	}
	wrong.await(t)
	if !bytes.Equal(unknownHRS, f.readHRS(t)) {
		t.Fatal("wrong peer pin reached durable signing")
	}
	f.assertImmutable(t, immutable)
	f.assertPrivateBound(t)
	t.Logf("checkpointLayout=%s normalCLI=true originalSourceUnchanged=true coldOriginalHRS=true unknownNoRetry=true", f.layout)
	t.Logf("normalRemoteProcess=true proposal=true prevote=true precommit=true extension=true coldOriginalHRS=true unknownNoRetry=true freshCheckpoint=true fullPeerPin=true nodeStarted=false publicDeployment=false binarySHA256=%s", pin)
}

type remoteProcessFixture struct {
	dir, vault, legacyKey, legacyState, staleState string
	layout                                         string
	h                                              *engineWiringHarness
	state                                          sm.State
	files                                          PQOperatorFiles
	binding                                        ynxconsensusauth.HostKeyBinding
	credential                                     []byte
	engine, daemon                                 PQRemoteTransport
}

func (f *remoteProcessFixture) chain() string { return f.h.f.doc.ChainID }

func (f *remoteProcessFixture) write(t *testing.T, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(f.dir, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, writeErr := file.Write(data)
	if err = errors.Join(writeErr, file.Close()); err != nil {
		t.Fatal(err)
	}
	return path
}

func newRemoteProcessFixture(t *testing.T, layout string) *remoteProcessFixture {
	t.Helper()
	// The controlled runner supplies a fresh private TMPDIR. Preserve original
	// vault/HRS files on both success and failure; t.TempDir would delete an
	// unresolved UNKNOWN during test cleanup. Only processes and RAM keys close.
	dir, err := os.MkdirTemp("", "ynx-pq-remote-private-")
	if err != nil {
		t.Fatal(err)
	}
	f := &remoteProcessFixture{dir: dir, layout: layout}
	if err := os.Chmod(f.dir, 0700); err != nil {
		t.Fatal(err)
	}
	original := newValidatorRegistryFixture(t)
	original.doc.ConsensusParams.ABCI.VoteExtensionsEnableHeight = original.doc.InitialHeight + 4
	original.raw, err = cmtjson.Marshal(original.doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(original.raw)
	original.pins.CometGenesisSHA256 = hex.EncodeToString(sum[:])
	original.bootstrap, err = NewConsensusBootstrap(original.raw, original.pins, original.migration)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(f.dir, "committed.json")
	if layout != "atomic-json" {
		path = filepath.Join(f.dir, "committed."+layout)
	}
	var app *Application
	switch layout {
	case "atomic-json":
		app, err = NewPersistentApplicationWithBootstrap(original.migration, path, original.bootstrap)
	case "snapshot-journal":
		app, err = NewJournaledApplicationWithBootstrap(original.migration, path, original.bootstrap)
	case "block-journal":
		app, err = NewBlockJournaledApplicationWithBootstrap(original.migration, path, original.bootstrap)
	default:
		t.Fatal("unsupported process fixture layout")
	}
	if err != nil {
		t.Fatal(err)
	}
	db, blocksDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blocksDB.Close() })
	h := &engineWiringHarness{f: original, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocksDB), path: path}
	f.h = h
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(original.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, original.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err = handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	var txs cmttypes.Txs
	var keys []*ynxconsensusauth.CandidateKey
	var materials []ynxconsensusauth.CandidateKeyMaterial
	for _, member := range original.bootstrap.record.Members {
		key, material, err := ynxconsensusauth.GenerateCandidateKeyMaterial()
		if err != nil {
			t.Fatal(err)
		}
		keys, materials = append(keys, key), append(materials, material)
		t.Cleanup(func() { key.Destroy(); material.Clear() })
		intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(original.bootstrap.genesisID), ChainID: original.doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: original.doc.InitialHeight, EffectiveAt: original.doc.InitialHeight + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.Ed25519), MLDSA87PublicKey: bytes.Clone(material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(material.PublicB)}
		a, b, err := key.RegistrationPossession(intent)
		if err != nil {
			t.Fatal(err)
		}
		message, err := intent.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(original.legacy[string(member.Address)], message), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		txs = append(txs, tx)
	}
	h.apply(t, txs)
	schedule, err := NewPQEngineSchedule(original.bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
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
	authorization, err := NewPQEngineAuthorization(scheduleRaw, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	switch layout {
	case "atomic-json":
		app, err = NewPersistentApplicationWithEngineAuthorization(original.migration, path, original.bootstrap, authorization)
	case "snapshot-journal":
		app, err = NewJournaledApplicationWithEngineAuthorization(original.migration, path, original.bootstrap, authorization)
	case "block-journal":
		app, err = NewBlockJournaledApplicationWithEngineAuthorization(original.migration, path, original.bootstrap, authorization)
	}
	if err != nil {
		t.Fatal(err)
	}
	h.app, h.source.app = app, app
	h.proxy = startEngineTestProxy(t, app)
	var staleHeight int64
	var staleHash []byte
	for h.app.committed.Height < schedule.ActivationHeight-1 {
		next := h.apply(t, nil) // Actual BlockExecutor, Commit and Store.Save; no node loop.
		if h.app.committed.Height == schedule.ActivationHeight-2 {
			name := "prior-committed.json"
			if layout != "atomic-json" {
				name = "prior-committed." + layout
			}
			// Preserve an earlier actual writer output only for the stale-source
			// negative control. Never replace the current source with an export.
			f.staleState = f.write(t, name, remoteProcessRead(t, path))
			if layout != "atomic-json" {
				f.write(t, name+".read.lock", remoteProcessRead(t, path+".read.lock"))
			}
			staleHeight, staleHash = next.LastBlockHeight, bytes.Clone(next.AppHash)
		}
	}
	f.state, err = h.wrapped().Load()
	if err != nil || f.state.LastBlockHeight != schedule.ActivationHeight-1 || f.staleState == "" {
		t.Fatal("missing actual engine activation checkpoint:", err)
	}
	f.assertCheckpointLayout(t, path)
	f.assertCheckpointLayout(t, f.staleState)
	// Establish that the negative control really is a complete older checkpoint
	// with its original read-lock bytes, not a malformed/missing-lock fixture.
	staleSource, err := NewPQEngineFileSource(original.migration, f.staleState, original.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	priorBytes := remoteProcessRead(t, f.staleState)
	if _, err = staleSource.ConsensusAuthorityForSigning(original.doc.ChainID, staleHeight, staleHash); err != nil || !bytes.Equal(priorBytes, remoteProcessRead(t, f.staleState)) {
		t.Fatal("preserved prior layout does not validate at its actual original engine checkpoint:", err)
	}
	owner := -1
	for i, member := range original.bootstrap.record.Members {
		if bytes.Equal(member.Address, f.state.Validators.GetProposer().Address) {
			owner = i
		}
	}
	if owner < 0 {
		t.Fatal("actual engine proposer is not in original pinned membership")
	}
	member := original.bootstrap.record.Members[owner]
	f.binding = ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(original.bootstrap.genesisID), ChainID: original.doc.ChainID, ActivationHeight: schedule.ActivationHeight}, ValidatorAddress: bytes.Clone(member.Address), Epoch: 1, MLDSA87PublicKey: bytes.Clone(materials[owner].PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(materials[owner].PublicB), SignerStatePath: filepath.Join(f.dir, "original-pq-hrs.json")}
	registry, err := NewPQCommittedSignerRegistry(app, original.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ynxconsensusauth.CreateSigner(f.binding.SignerStatePath, keys[owner], f.binding.Policy, registry, member.Address, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err = signer.Close(); err != nil {
		t.Fatal(err)
	}
	f.credential, err = ynxconsensusauth.GenerateHostRecoveryCredential()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(f.credential) })
	vault, err := ynxconsensusauth.SealHostKeyEnvelope(materials[owner], f.binding, f.credential)
	if err != nil {
		t.Fatal(err)
	}
	f.vault = f.write(t, "original-validator.encrypted", vault)
	f.legacyKey, f.legacyState = filepath.Join(f.dir, "original-ed-key.json"), filepath.Join(f.dir, "original-ed-hrs.json")
	legacy := privval.NewFilePV(cmted.PrivKey(bytes.Clone(original.legacy[string(member.Address)])), f.legacyKey, f.legacyState)
	legacy.Save() // Isolated new QA material only; the child is resume-only.
	if err = legacy.SignVote(f.chain(), &cmtproto.Vote{Type: cmtproto.PrevoteType, Height: f.state.LastBlockHeight, Round: 0, ValidatorAddress: bytes.Clone(member.Address), Timestamp: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := original.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	bindingRaw, err := json.Marshal(f.binding)
	if err != nil {
		t.Fatal(err)
	}
	f.files = PQOperatorFiles{Migration: f.write(t, "migration.json", migrationRaw), Genesis: f.write(t, "genesis.json", original.raw), State: path, Schedule: f.write(t, "schedule.json", scheduleRaw), ScheduleHash: scheduleHash, Binding: f.write(t, "binding.json", bindingRaw), Pins: original.pins}
	engineKey, daemonKey := cmted.GenPrivKey(), cmted.GenPrivKey()
	transport := func(name string, key cmted.PrivKey, peer []byte) PQRemoteTransport {
		raw, err := cmtjson.Marshal(&p2p.NodeKey{PrivKey: key})
		if err != nil {
			t.Fatal(err)
		}
		return PQRemoteTransport{TransportKey: f.write(t, name+"-transport.json", raw), PeerPin: f.write(t, name+"-peer.pub", []byte(hex.EncodeToString(peer)+"\n")), Timeout: 10 * time.Second}
	}
	f.engine, f.daemon = transport("engine", engineKey, daemonKey.PubKey().Bytes()), transport("daemon", daemonKey, engineKey.PubKey().Bytes())
	clear(engineKey)
	clear(daemonKey)
	return f
}

func remoteProcessRead(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (f *remoteProcessFixture) assertCheckpointLayout(t *testing.T, path string) {
	t.Helper()
	raw := remoteProcessRead(t, path)
	switch f.layout {
	case "atomic-json":
		if !json.Valid(raw) || IsSnapshotJournal(raw) || IsBlockJournal(raw) {
			t.Fatal("normal atomic writer did not produce complete JSON")
		}
	case "snapshot-journal":
		if !IsSnapshotJournal(raw) {
			t.Fatal("normal snapshot writer did not produce the original journal format")
		}
	case "block-journal":
		if !IsBlockJournal(raw) {
			t.Fatal("normal block writer did not produce the original journal format")
		}
	default:
		t.Fatal("unknown actual checkpoint layout")
	}
	if f.layout != "atomic-json" {
		// Do not create a reader lock. This must be the existing writer's
		// regular private lock (or its explicitly preserved stale-control copy).
		lock, err := journalRegularFile(path+".read.lock", os.O_RDONLY)
		if err != nil {
			t.Fatal("normal journal has no readable original read lock:", err)
		}
		if err = lock.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func (f *remoteProcessFixture) readHRS(t *testing.T) []byte {
	t.Helper()
	return remoteProcessRead(t, f.binding.SignerStatePath)
}

func (f *remoteProcessFixture) immutableBytes(t *testing.T) map[string][]byte {
	t.Helper()
	out := make(map[string][]byte)
	for _, path := range []string{f.files.Migration, f.files.Genesis, f.files.State, f.files.Schedule, f.files.Binding, f.vault, f.legacyKey, f.legacyState, f.staleState, f.engine.TransportKey, f.engine.PeerPin, f.daemon.TransportKey, f.daemon.PeerPin} {
		out[path] = remoteProcessRead(t, path)
	}
	if f.layout != "atomic-json" {
		for _, path := range []string{f.files.State + ".read.lock", f.staleState + ".read.lock"} {
			out[path] = remoteProcessRead(t, path)
		}
	}
	return out
}

func (f *remoteProcessFixture) assertImmutable(t *testing.T, originals map[string][]byte) {
	t.Helper()
	for path, original := range originals {
		if !bytes.Equal(original, remoteProcessRead(t, path)) {
			t.Fatal("normal signer changed original read-only input, key, or legacy HRS")
		}
	}
}

func (f *remoteProcessFixture) assertPrivateBound(t *testing.T) {
	t.Helper()
	var total int64
	err := filepath.WalkDir(f.dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			total += info.Size()
			if total > 32<<20 {
				return errors.New("remote signer private fixture exceeds 32 MiB")
			}
		} else if !info.IsDir() {
			return errors.New("unexpected non-regular fixture material")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func (f *remoteProcessFixture) roundSet(round int32) *cmttypes.ValidatorSet {
	set := f.state.Validators.Copy()
	if round > 0 {
		set.IncrementProposerPriority(round)
	}
	return set
}

func (f *remoteProcessFixture) bind(t *testing.T, pv *PQRemotePrivValidator, round int32) {
	t.Helper()
	if err := pv.SetConsensusCheckpointSigningContext(f.chain(), f.state.LastBlockHeight, bytes.Clone(f.state.AppHash), f.state.LastBlockHeight+1, round, f.roundSet(round)); err != nil {
		t.Fatal("normal process rejected actual stored engine context:", err)
	}
}

func (f *remoteProcessFixture) vote(round int32) *cmtproto.Vote {
	index, _ := f.state.Validators.GetByAddress(f.binding.ValidatorAddress)
	return &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: f.state.LastBlockHeight + 1, Round: round, BlockID: cmtproto.BlockID{Hash: bytes.Repeat([]byte{0x41}, 32), PartSetHeader: cmtproto.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{0x42}, 32)}}, Timestamp: time.Date(2026, 10, 18, 9, 0, 0, 123, time.UTC), ValidatorAddress: bytes.Clone(f.binding.ValidatorAddress), ValidatorIndex: index, Extension: []byte("normal-remote-process-checkpoint")}
}

func checkRemoteProcessBinary(t *testing.T, path, expected string) {
	t.Helper()
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || len(expected) != 64 || strings.ToLower(expected) != expected {
		t.Fatal("normal process requires a canonical absolute binary and independent SHA256 pin")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 || info.Size() > 256<<20 {
		t.Fatal("normal signer binary is missing, not executable/regular, or exceeds its bound")
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	_, readErr := io.Copy(hash, io.LimitReader(file, (256<<20)+1))
	if err = errors.Join(readErr, file.Close()); err != nil || hex.EncodeToString(hash.Sum(nil)) != expected {
		t.Fatal("normal signer binary differs from the independently supplied build pin")
	}
}

type remoteProcessBoundedLog struct {
	mu       sync.Mutex
	data     []byte
	overflow bool
}

func (b *remoteProcessBoundedLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	left := (16 << 10) - len(b.data)
	if len(p) > left {
		b.overflow = true
		p = p[:left]
	}
	b.data = append(b.data, p...)
	return n, nil
}

type remoteSignerProcess struct {
	cmd     *exec.Cmd
	address string
	root    string
	done    chan struct{}
	log     *remoteProcessBoundedLog
	err     error // only inspected after done closes
}

func (p *remoteSignerProcess) diagnostic() string {
	p.log.mu.Lock()
	defer p.log.mu.Unlock()
	// The pinned normal main emits errors only, never the credential or input
	// files. Preserve its first cause while redacting the private fixture path.
	text := strings.TrimSpace(strings.ReplaceAll(string(p.log.data), p.root, "<private-fixture>"))
	if len(text) > 2048 {
		text = text[:2048] + " [truncated]"
	}
	return text
}

func (p *remoteSignerProcess) await(t *testing.T) {
	t.Helper()
	select {
	case <-p.done:
	case <-time.After(4 * time.Second):
		_ = p.cmd.Process.Kill()
		select {
		case <-p.done:
		case <-time.After(3 * time.Second):
			t.Fatal("normal signer child could not be reaped after bounded kill")
		}
		t.Fatal("normal single-session daemon did not terminate within the cleanup bound")
	}
	p.log.mu.Lock()
	overflow := p.log.overflow
	p.log.mu.Unlock()
	if overflow || p.cmd.ProcessState == nil || !p.cmd.ProcessState.Exited() {
		t.Fatal("normal daemon exceeded log bound or exited through an unexpected signal")
	}
	// The normal main reports canceled/closed one-session errors with exit 1.
	// Neither that status nor any diagnostic alone counts as signing success.
	if p.err != nil {
		var exit *exec.ExitError
		if !errors.As(p.err, &exit) || exit.ExitCode() != 1 {
			t.Fatalf("unexpected normal remote-signer process exit: %s", p.diagnostic())
		}
	}
}

func (p *remoteSignerProcess) stop(t *testing.T) {
	t.Helper()
	select {
	case <-p.done:
	default:
		if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
			t.Error("could not signal the original normal signer process")
		}
	}
	p.await(t)
}

func (f *remoteProcessFixture) start(t *testing.T, ctx context.Context, binary, pin, statePath string) *remoteSignerProcess {
	t.Helper()
	checkRemoteProcessBinary(t, binary, pin)
	f.assertPrivateBound(t)
	// Reserve an ephemeral loopback endpoint, then invoke the unchanged normal
	// CLI with its canonical nonzero port. A bind race fails; it is not retried.
	reservation, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reservation.Addr().String()
	if err = reservation.Close(); err != nil {
		t.Fatal(err)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = writer.Write(f.credential); err != nil {
		_ = reader.Close()
		_ = writer.Close()
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		_ = reader.Close()
		t.Fatal(err)
	}
	args := []string{"--serve", "--migration-state", f.files.Migration, "--genesis", f.files.Genesis, "--abci-state", statePath,
		"--consensus-genesis-sha256", f.files.Pins.CometGenesisSHA256, "--original-genesis-hash", f.files.Pins.OriginalGenesisHash, "--bound-migration-state-hash", f.files.Pins.MigrationStateHash,
		"--pq-engine-schedule", f.files.Schedule, "--pq-engine-schedule-hash", f.files.ScheduleHash, "--pq-host-key-binding", f.files.Binding,
		"--pq-host-key-vault", f.vault, "--legacy-key", f.legacyKey, "--legacy-state", f.legacyState,
		"--listen", "tcp://" + address, "--pq-transport-key", f.daemon.TransportKey, "--pq-engine-peer-pin", f.daemon.PeerPin, "--timeout", "10s", "--recovery-fd", "3"}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = f.dir
	cmd.Env = []string{"GOMAXPROCS=2", "GOMEMLIMIT=256MiB", "LANG=C", "TZ=UTC"}
	cmd.ExtraFiles = []*os.File{reader}
	cmd.WaitDelay = 3 * time.Second
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	process := &remoteSignerProcess{cmd: cmd, address: address, root: f.dir, done: make(chan struct{}), log: new(remoteProcessBoundedLog)}
	cmd.Stdout, cmd.Stderr = process.log, process.log
	err = cmd.Start()
	_ = reader.Close() // The child alone retains FD 3; no credential argv/env/file.
	if err != nil {
		t.Fatal("normal remote-signer command could not start:", err)
	}
	go func() { process.err = cmd.Wait(); close(process.done) }()
	t.Cleanup(func() { process.stop(t) })
	deadline := time.NewTimer(12 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-process.done:
			t.Fatalf("normal remote-signer command exited before listening: %s", process.diagnostic())
		case <-ctx.Done():
			t.Fatal("remote process work window expired before readiness")
		case <-deadline.C:
			t.Fatal("normal remote-signer command did not listen within the startup bound")
		case <-tick.C:
			if remoteProcessOwnsListener(cmd.Process.Pid, address) {
				return process
			}
		}
	}
}

// Linux procfs readiness is read-only and proves ownership of the exact socket
// inode by this child. A TCP health probe would consume its sole signing session.
func remoteProcessOwnsListener(pid int, address string) bool {
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	n, err := strconv.Atoi(port)
	if err != nil {
		return false
	}
	want := fmt.Sprintf("0100007F:%04X", n)
	proc := filepath.Join("/proc", strconv.Itoa(pid))
	fds, err := os.ReadDir(filepath.Join(proc, "fd"))
	if err != nil {
		return false
	}
	sockets := make(map[string]bool)
	for _, fd := range fds {
		target, err := os.Readlink(filepath.Join(proc, "fd", fd.Name()))
		if err == nil && strings.HasPrefix(target, "socket:[") && strings.HasSuffix(target, "]") {
			sockets[strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]")] = true
		}
	}
	raw, err := os.ReadFile(filepath.Join(proc, "net", "tcp"))
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 9 && fields[1] == want && fields[3] == "0A" && sockets[fields[9]] {
			return true
		}
	}
	return false
}

// Drops raw TCP response bytes only after observing a changed original HRS.
// SecretConnection, public-key reads, wire encoding and signing all remain the
// actual normal implementation. There is no substituted server or fake ACK.
type remoteProcessLossConn struct {
	net.Conn
	mu      sync.Mutex
	path    string
	before  []byte
	armed   bool
	dropped atomic.Bool
	writes  atomic.Uint64
}

func (c *remoteProcessLossConn) arm(path string, original []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.path, c.before, c.armed = path, bytes.Clone(original), true
}

func (c *remoteProcessLossConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.writes.Add(uint64(n))
	return n, err
}

func (c *remoteProcessLossConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.mu.Lock()
	defer c.mu.Unlock()
	if n > 0 && c.armed {
		current, readErr := os.ReadFile(c.path)
		if readErr != nil {
			clear(p[:n])
			_ = c.Conn.Close()
			return 0, readErr
		}
		if !bytes.Equal(current, c.before) {
			clear(p[:n])
			c.dropped.Store(true)
			_ = c.Conn.Close()
			return 0, io.ErrUnexpectedEOF
		}
	}
	return n, err
}

func (f *remoteProcessFixture) connect(t *testing.T, ctx context.Context, process *remoteSignerProcess, config PQRemoteTransport) (*PQRemotePrivValidator, *remoteProcessLossConn) {
	t.Helper()
	raw, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", process.address)
	if err != nil {
		t.Fatal("normal process single TCP connect failed:", err)
	}
	wire := &remoteProcessLossConn{Conn: raw}
	config.Address = "tcp://" + process.address
	secret, pin, err := AuthenticatePQRemoteConnection(ctx, wire, config)
	if err != nil {
		t.Fatal("normal process authenticated transport failed:", err)
	}
	t.Cleanup(func() { _ = wire.Close() })
	pv, err := NewPQRemotePrivValidator(secret, pin, config.Timeout, f.h.f.bootstrap, f.h.app.pqEngineAuthorization, f.binding, f.h.app)
	if err != nil {
		_ = secret.Close()
		t.Fatal(err)
	}
	return pv, wire
}
