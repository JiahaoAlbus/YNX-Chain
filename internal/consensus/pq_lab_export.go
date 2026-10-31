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
	"regexp"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	dbm "github.com/cometbft/cometbft-db"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

// Trust parameters and original operation pins are supplied by the synthetic
// lab operator. The target coordinates and trusted header come only from the
// four ORIGINAL stopped databases, never from RPC or an incoming proof.
type PQLabExportOptions struct {
	RootDir, PlanSHA256, ActivationSHA256, TransactionFile, TransactionSHA256, NativeWireHash, OutputDir string
	TrustingPeriod, MaxClockDrift                                                                        time.Duration
	TrustNumerator, TrustDenominator                                                                     uint64
}

type PQLabStoppedProofExport struct {
	Version           string            `json:"version"`
	SyntheticOnly     bool              `json:"syntheticOnly"`
	SourceReadOnly    bool              `json:"sourceReadOnly"`
	StoppedNodes      int               `json:"stoppedNodes"`
	EngineHeight      int64             `json:"engineHeight,string"`
	EngineAppHash     string            `json:"engineAppHash"`
	RegistryRoot      string            `json:"registryRoot"`
	PlanSHA256        string            `json:"planSHA256"`
	ActivationSHA256  string            `json:"activationSHA256"`
	Materials         PQLabWorkloadFile `json:"materials"`
	Proof             PQLabWorkloadFile `json:"proof"`
	Checkpoint        PQLabWorkloadFile `json:"checkpoint"`
	TransactionHash   string            `json:"transactionHash"`
	NativeWireHash    string            `json:"nativeWireHash"`
	TransactionHeight int64             `json:"transactionHeight,string"`
	TransactionIndex  int64             `json:"transactionIndex,string"`
	AuthorityGranted  bool              `json:"authorityGranted"`
	PublicNetwork     bool              `json:"publicNetwork"`
	NodeStarted       bool              `json:"nodeStarted"`
}

// These are the only public original transaction namespaces emitted by the
// normal lab corpus/sender. Custody, vault, credentials and HRS bodies are never
// opened as transaction inputs, even if their path and hash were supplied.
var pqLabPublicTransaction = regexp.MustCompile(`^(transaction-[0-9]+\.abci|sender-public/[0-9]{4}/[0-9a-f]{64}/transaction\.abci)$`)

type pqLabStoppedSource struct {
	ledger proofHostLedger
	blocks *blockstore.BlockStore
	state  sm.State
	close  func() error
}

func openPQLabStoppedSource(n PQLabNetworkNode) (_ *pqLabStoppedSource, resultErr error) {
	var closers []func() error
	closeAll := func() error {
		var err error
		for i := len(closers) - 1; i >= 0; i-- {
			err = errors.Join(err, closers[i]())
		}
		closers = nil
		return err
	}
	defer func() {
		if recover() != nil {
			resultErr = errors.New("corrupt original stopped lab database")
		}
		if resultErr != nil {
			resultErr = errors.Join(resultErr, closeAll())
		}
	}()
	for _, p := range []string{n.StatePath, n.SignerStateFile, filepath.Join(n.Home, "data")} {
		if err := requireInspectionPath(p); err != nil {
			return nil, err
		}
	}
	info, err := os.Lstat(n.SignerStateFile)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() == 0 {
		return nil, errors.New("original PQ signing state identity required; no body is read")
	}
	lease, err := existingInspectionWriterLease(n.StatePath)
	if err != nil {
		return nil, err
	}
	closers = append(closers, lease)
	lease, err = existingInspectionWriterLease(n.LegacyStateFile)
	if err != nil {
		return nil, err
	}
	closers = append(closers, lease)
	lease, err = existingInspectionLockFile(n.SignerStateFile + ".lock")
	if err != nil {
		return nil, err
	}
	closers = append(closers, lease)
	closers = append(closers, func() error {
		after, e := os.Lstat(n.SignerStateFile)
		if e != nil || !samePQStateFile(info, after) {
			return errors.New("original PQ signing state identity changed")
		}
		return nil
	})
	for _, dir := range []string{filepath.Dir(n.StatePath), filepath.Dir(n.SignerStateFile)} {
		if err = rejectInspectionUnknown(dir); err != nil {
			return nil, err
		}
	}
	dbs := make([]dbm.DB, 0, 2)
	for _, name := range []string{"state", "blockstore"} {
		dir := filepath.Join(n.Home, "data", name+".db")
		before, e := inspectionDatabaseFiles(dir)
		if e != nil {
			return nil, e
		}
		db, e := dbm.NewGoLevelDBWithOpts(name, filepath.Join(n.Home, "data"), &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
		if e != nil {
			return nil, fmt.Errorf("open stopped original %s: %w", name, e)
		}
		dbs = append(dbs, db)
		closers = append(closers, func() error {
			after, e := inspectionDatabaseFiles(dir)
			if e == nil && !sameInspectionDatabase(before, after) {
				e = errors.New("original database identity changed")
			}
			return errors.Join(e, db.Close())
		})
	}
	r := proofHostReadDB{db: dbs[0]}
	s, e := r.load()
	if e != nil {
		return nil, e
	}
	blocks := blockstore.NewBlockStore(dbs[1])
	return &pqLabStoppedSource{ledger: proofHostLedger{load: r.load, validators: r.validators, results: sm.NewStore(dbs[0], sm.StoreOptions{}).LoadFinalizeBlockResponse, blocks: blocks}, blocks: blocks, state: s, close: closeAll}, nil
}

func pqLabExportHeader(b *cmttypes.LightBlock) ProofHostExpectedHeader {
	return ProofHostExpectedHeader{ChainID: b.ChainID, HeaderHeight: strconv.FormatInt(b.Height, 10), BlockHash: hex.EncodeToString(b.Hash()), StateHeight: strconv.FormatInt(b.Height-1, 10), StateAppHash: hex.EncodeToString(b.AppHash)}
}

func pqLabExportOwner(kind string, wire []byte) (string, error) {
	var messages [][]byte
	switch kind {
	case PQTransferType:
		m, e := ynxbatch.DecodeMember(wire)
		if e != nil {
			return "", e
		}
		messages = [][]byte{m.Message}
	case PQWholeType:
		w, e := ynxbatch.DecodeWhole(wire)
		if e != nil {
			return "", e
		}
		messages = w.Messages
	default:
		return "", errors.New("lab export accepts original transfer Member or Whole only")
	}
	owner := ""
	for _, raw := range messages {
		tr, e := ynxauth.DecodeTransfer(raw)
		if e != nil {
			return "", e
		}
		if owner != "" && owner != tr.From {
			return "", errors.New("mixed lab transaction owners")
		}
		owner = tr.From
	}
	if owner == "" {
		return "", errors.New("empty lab transaction")
	}
	return owner, nil
}

// ExportPQLabProof holds ALL four original writer/signing/database leases until
// full capture and final source checks finish. Only then are public outputs
// written. A failed exclusive attempt is retained; callers must not replay an
// UNKNOWN attempt. This function never starts a node or signs a block.
func ExportPQLabProof(o PQLabExportOptions, now time.Time) (out PQLabStoppedProofExport, err error) {
	defer func() {
		if recover() != nil {
			out = PQLabStoppedProofExport{}
			err = errors.New("corrupt original lab store")
		}
	}()
	if now.IsZero() || o.TrustingPeriod <= 0 || o.MaxClockDrift <= 0 || o.TrustNumerator == 0 || o.TrustDenominator == 0 {
		return out, errors.New("explicit bounded light trust parameters required")
	}
	p, m, _, err := loadPQLab(o.RootDir, o.PlanSHA256)
	if err != nil {
		return out, err
	}
	var originals []*proofHostOriginal
	var sources []*pqLabStoppedSource
	var inputs []*proofHostInputs
	closeAll := func() error {
		var e error
		for _, in := range inputs {
			e = errors.Join(e, in.close())
		}
		inputs = nil
		for _, r := range originals {
			e = errors.Join(e, r.unchanged(), r.file.Close())
		}
		originals = nil
		for i := len(sources) - 1; i >= 0; i-- {
			e = errors.Join(e, sources[i].close())
		}
		sources = nil
		return e
	}
	defer func() {
		err = errors.Join(err, closeAll())
		if err != nil {
			out = PQLabStoppedProofExport{}
		}
	}()
	hold := func(path, pin string, limit int64) ([]byte, error) {
		r, e := readProofHostOriginal(path, pin, limit)
		if e != nil {
			return nil, e
		}
		originals = append(originals, r)
		return r.raw, nil
	}
	if _, err = hold(filepath.Join(p.RootDir, "network-plan.json"), o.PlanSHA256, 4<<20); err != nil {
		return out, err
	}
	raw, err := hold(filepath.Join(p.RootDir, "activation", "activation.json"), o.ActivationSHA256, 4<<20)
	if err != nil {
		return out, err
	}
	var a PQLabActivation
	if err = pqLabDecode(raw, &a); err != nil {
		return out, err
	}
	if a.Version != "YNX-PQ-LAB-ACTIVATION/v1" || !a.SyntheticOnly || a.NetworkPlanSHA256 != o.PlanSHA256 || a.ScheduleFile != filepath.Join(p.RootDir, "activation", "schedule.json") || a.NodeStarted || a.PQQuorumVerified || len(a.Nodes) != 4 {
		return out, errors.New("original lab activation identity required")
	}
	scheduleRaw, err := hold(a.ScheduleFile, "", 32<<10)
	if err != nil {
		return out, err
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, a.ScheduleHash)
	if err != nil {
		return out, err
	}
	s := auth.schedule
	if a.RegistryHeight != s.RegistryHeight || a.RegistryRoot != s.RegistryRoot || a.ParamsHeight != s.ParamsUpdateHeight || a.ValidatorHeight != s.ValidatorUpdateHeight || a.ActivationHeight != s.ActivationHeight {
		return out, errors.New("activation schedule differs from original receipt")
	}
	for i, n := range p.Nodes {
		args := append(p.normalArgs(n), "--pq-engine-schedule", a.ScheduleFile, "--pq-engine-schedule-hash", a.ScheduleHash, "--pq-host-key-binding", n.HostBindingFile, "--pq-host-key-vault", n.VaultFile, "--pq-recovery-fd", "3")
		if !reflect.DeepEqual(a.Nodes[i], PQLabActivationNode{Index: i, Args: args, RecoveryFD: 3, RecoveryCredentialFile: n.RecoveryCredentialFile}) {
			return out, errors.New("activation does not describe original four normal processes")
		}
	}
	rel, err := filepath.Rel(filepath.Join(p.RootDir, "workload"), o.TransactionFile)
	if err != nil || !pqLabPublicTransaction.MatchString(filepath.ToSlash(rel)) {
		return out, errors.New("transaction must be an original lab public corpus/sender envelope")
	}
	if _, err = proofHostHash(o.TransactionSHA256); err != nil {
		return out, err
	}
	if _, err = proofHostHash(o.NativeWireHash); err != nil {
		return out, err
	}
	envelope, err := hold(o.TransactionFile, o.TransactionSHA256, MaxPQContractTransactionBytes)
	if err != nil {
		return out, err
	}
	kind, wire, err := pqTransactionWire(envelope)
	if err != nil {
		return out, err
	}
	if pqLabSHA(wire) != o.NativeWireHash {
		return out, errors.New("original native wire hash mismatch")
	}
	owner, err := pqLabExportOwner(kind, wire)
	if err != nil {
		return out, err
	}
	migrationRaw, err := m.CanonicalJSON()
	if err != nil {
		return out, err
	}
	if err = pqLabNetworkFreshDirectory(o.OutputDir); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(o.OutputDir, "intent.json"), struct{ PlanSHA256, ActivationSHA256, TransactionSHA256, NativeWireHash string }{o.PlanSHA256, o.ActivationSHA256, o.TransactionSHA256, o.NativeWireHash}); err != nil {
		return out, err
	}
	for _, n := range p.Nodes {
		source, e := openPQLabStoppedSource(n)
		if e != nil {
			return out, e
		}
		sources = append(sources, source)
	}
	actual := sources[0].state
	if actual.ChainID != p.ChainID || actual.LastBlockHeight <= a.ActivationHeight || actual.InitialHeight != p.InitialHeight {
		return out, errors.New("stopped original engine is not in the lab PQ profile")
	}
	for _, source := range sources[1:] {
		x := source.state
		if x.ChainID != actual.ChainID || x.LastBlockHeight != actual.LastBlockHeight || !bytes.Equal(x.AppHash, actual.AppHash) || !x.LastBlockID.Equals(actual.LastBlockID) {
			return out, errors.New("four stopped engine checkpoints differ")
		}
	}
	for _, source := range sources {
		originalSuccessor := source.blocks.LoadBlock(a.RegistryHeight + 1)
		if originalSuccessor == nil || hex.EncodeToString(originalSuccessor.AppHash) != a.AppHash {
			return out, errors.New("original activation checkpoint differs from retained engine history")
		}
	}
	// The bounded lab scan reads actual blocks, not a mutable RPC tx index.
	base, end := sources[0].blocks.Base(), sources[0].blocks.Height()
	if base <= 0 || end != actual.LastBlockHeight || end-base >= 4096 {
		return out, errors.New("bounded retained original lab block history required")
	}
	height, index := int64(0), int64(-1)
	for h := base; h <= end; h++ {
		block := sources[0].blocks.LoadBlock(h)
		if block == nil {
			return out, errors.New("original lab block was pruned")
		}
		for i, tx := range block.Txs {
			if bytes.Equal(tx, envelope) {
				if index >= 0 {
					return out, errors.New("original transaction occurs more than once")
				}
				height, index = h, int64(i)
			}
		}
	}
	if index < 0 || height <= a.ActivationHeight || height >= end {
		return out, errors.New("original transaction with PQ trusted predecessor and committed successor required")
	}
	trusted, err := sources[0].ledger.lightBlock(height - 1)
	if err != nil {
		return out, err
	}
	block, err := sources[0].ledger.lightBlock(height)
	if err != nil {
		return out, err
	}
	next, err := sources[0].ledger.lightBlock(height + 1)
	if err != nil {
		return out, err
	}
	expected := ProofHostExpectedTransaction{Block: pqLabExportHeader(block), Successor: pqLabExportHeader(next), TransactionType: kind, Envelope: base64.StdEncoding.EncodeToString(envelope), NativeWire: base64.StdEncoding.EncodeToString(wire), TransactionHash: o.TransactionSHA256, NativeWireHash: o.NativeWireHash, Index: strconv.FormatInt(index, 10)}
	var captured ProofHostSourceExport
	for i, n := range p.Nodes {
		plan := ProofHostSourcePlan{Version: ProofHostSourcePlanVersion, SourceID: "pq-lab-" + p.SessionID, Epoch: "1", OperationID: o.TransactionSHA256, Account: owner, NetworkID: p.OriginalGenesisHash, OriginalHash: "0x" + o.NativeWireHash, MigrationFile: p.MigrationFile, MigrationSHA256: pqLabSHA(migrationRaw), GenesisFile: p.GenesisFile, ConsensusGenesisSHA256: p.CometGenesisSHA256, OriginalGenesisHash: p.OriginalGenesisHash, MigrationStateHash: p.MigrationStateHash, StateFile: n.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(n.Home, "data"), SigningStatePath: n.SignerStateFile, SigningLockKind: "pq-signer", ScheduleFile: a.ScheduleFile, ScheduleHash: a.ScheduleHash, ScheduleSHA256: pqLabSHA(scheduleRaw), EngineHeight: strconv.FormatInt(actual.LastBlockHeight, 10), EngineAppHash: hex.EncodeToString(actual.AppHash), TrustedHeight: strconv.FormatInt(height-1, 10), TrustedBlockHash: hex.EncodeToString(trusted.Hash()), TrustingPeriodNanoseconds: strconv.FormatInt(int64(o.TrustingPeriod), 10), MaxClockDriftNanoseconds: strconv.FormatInt(int64(o.MaxClockDrift), 10), TrustLevelNumerator: strconv.FormatUint(o.TrustNumerator, 10), TrustLevelDenominator: strconv.FormatUint(o.TrustDenominator, 10), ExpectedTransaction: expected}
		raw, e := json.Marshal(plan)
		if e != nil {
			return out, e
		}
		in, e := loadProofHostInputs(raw, pqLabSHA(raw))
		if e != nil {
			return out, e
		}
		inputs = append(inputs, in)
		capture, e := in.capture(sources[i].ledger, filepath.Join(o.OutputDir, "captured-context"), now)
		if e != nil {
			return out, fmt.Errorf("original node %d proof capture: %w", i, e)
		}
		if i == 0 {
			captured = capture
		} else {
			// Independent valid commits may contain different >2/3 subsets at
			// the tip. Each was fully verified against the SAME exact headers;
			// do not confuse commit serialization with a block/checkpoint hash.
			for j := 0; j < 4; j++ {
				if !bytes.Equal(captured.Files[j].Bytes, capture.Files[j].Bytes) {
					return out, errors.New("four original public checkpoints differ")
				}
			}
		}
	}
	files := map[string][]byte{}
	for _, f := range captured.Files {
		files[f.Role] = f.Bytes
	}
	var committed CommittedState
	if err = json.Unmarshal(files["state"], &committed); err != nil || committed.ValidatorRegistry == nil {
		return out, errors.New("captured original registry is unavailable")
	}
	expectation, err := expected.expectation()
	if err != nil {
		return out, err
	}
	materials := PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: files["migration"], Genesis: files["genesis"], CommittedState: files["state"], Schedule: files["schedule"], TrustedLightBlock: files["trustedLightBlock"], Pins: p.pins(), ScheduleHash: a.ScheduleHash, EngineHeight: actual.LastBlockHeight, EngineAppHash: bytes.Clone(actual.AppHash), TrustingPeriod: o.TrustingPeriod, MaxClockDrift: o.MaxClockDrift, TrustNumerator: o.TrustNumerator, TrustDenominator: o.TrustDenominator, Expected: expectation}
	materialRaw, err := json.Marshal(materials)
	if err != nil {
		return out, err
	}
	if len(materialRaw) > MaxPQLabProofMaterialsBytes {
		return out, errors.New("complete public materials exceed original proof transport bound")
	}
	// Recheck every original path and release real source locks before committing
	// the public result. No source bytes are rewritten or copied into a live DB.
	if _, _, _, err = loadPQLab(o.RootDir, o.PlanSHA256); err != nil {
		return out, err
	}
	if err = closeAll(); err != nil {
		return out, err
	}
	materialPath, proofPath, checkpointPath := filepath.Join(o.OutputDir, "materials.json"), filepath.Join(o.OutputDir, "proof.json"), filepath.Join(o.OutputDir, "committed-state.json")
	for _, f := range []struct {
		path string
		raw  []byte
	}{{materialPath, materialRaw}, {proofPath, captured.Proof}, {checkpointPath, materials.CommittedState}} {
		if err = pqLabWrite(f.path, f.raw); err != nil {
			return out, err
		}
	}
	out = PQLabStoppedProofExport{Version: "YNX-PQ-LAB-STOPPED-PROOF/v1", SyntheticOnly: true, SourceReadOnly: true, StoppedNodes: 4, EngineHeight: actual.LastBlockHeight, EngineAppHash: hex.EncodeToString(actual.AppHash), RegistryRoot: committed.ValidatorRegistry.Root, PlanSHA256: o.PlanSHA256, ActivationSHA256: o.ActivationSHA256, Materials: pqLabFile(materialPath, materialRaw), Proof: pqLabFile(proofPath, captured.Proof), Checkpoint: pqLabFile(checkpointPath, materials.CommittedState), TransactionHash: o.TransactionSHA256, NativeWireHash: o.NativeWireHash, TransactionHeight: height, TransactionIndex: index}
	if err = pqLabWriteJSON(filepath.Join(o.OutputDir, "result.json"), out); err != nil {
		return PQLabStoppedProofExport{}, err
	}
	return out, nil
}
