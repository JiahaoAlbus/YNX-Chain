//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	dbm "github.com/cometbft/cometbft-db"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

// ProofHostTargetInput is an ordinary function input, not another authority
// document. The owner supplies the retained original bytes and independent
// checkpoint/trust pins. Height/Index only locate those bytes in the ledger.
// In particular, no zero value adopts a database head or an RPC assertion.
type ProofHostTargetInput struct {
	Account, TransactionType                   string
	Envelope, NativeWire                       []byte
	TransactionHash, NativeWireHash            []byte
	Height, Index, EngineHeight, TrustedHeight int64
	EngineAppHash, TrustedBlockHash            []byte
	TrustingPeriod, MaxClockDrift              time.Duration
	TrustLevel                                 cmtmath.Fraction
}

// ProofHostTargetResult is public DATA for the original owner to place in a
// complete, independently pinned SourcePlan. It does not approve that plan,
// create a Host grant, or establish the provenance of the supplied trust pins.
type ProofHostTargetResult struct {
	Version                   string                       `json:"version"`
	Classification            string                       `json:"classification"`
	Account                   string                       `json:"account"`
	NetworkID                 string                       `json:"networkId"`
	EngineHeight              string                       `json:"engineHeight"`
	EngineAppHash             string                       `json:"engineAppHash"`
	TrustedHeight             string                       `json:"trustedHeight"`
	TrustedBlockHash          string                       `json:"trustedBlockHash"`
	TrustingPeriodNanoseconds string                       `json:"trustingPeriodNanoseconds"`
	MaxClockDriftNanoseconds  string                       `json:"maxClockDriftNanoseconds"`
	TrustLevelNumerator       string                       `json:"trustLevelNumerator"`
	TrustLevelDenominator     string                       `json:"trustLevelDenominator"`
	ExpectedTransaction       ProofHostExpectedTransaction `json:"expectedTransaction"`
	Verification              PQTransactionProofResult     `json:"verification"`
	SourceReadOnly            bool                         `json:"sourceReadOnly"`
	WriterExcluded            bool                         `json:"writerExcluded"`
	SigningWriterExcluded     bool                         `json:"signingWriterExcluded"`
	LedgerProofVerified       bool                         `json:"ledgerProofVerified"`
	NativeRootAuthorized      bool                         `json:"nativeRootAuthorized"`
	DeploymentVerified        bool                         `json:"deploymentVerified"`
}

// Bound before copying. The caller retains ownership of its buffers; later
// replacement of a caller's original/hash buffer cannot retarget the read.
func holdProofHostTargetInput(t ProofHostTargetInput) (ProofHostTargetInput, error) {
	if len(t.Envelope) == 0 || len(t.Envelope) > MaxPQContractTransactionBytes || len(t.NativeWire) == 0 || len(t.NativeWire) > chain.MaxPQBatchBytes {
		return ProofHostTargetInput{}, errors.New("bounded retained original envelope and native wire required")
	}
	for _, hash := range [][]byte{t.TransactionHash, t.NativeWireHash, t.EngineAppHash, t.TrustedBlockHash} {
		if len(hash) != sha256.Size {
			return ProofHostTargetInput{}, errors.New("full independent original and checkpoint hashes required")
		}
	}
	t.Envelope, t.NativeWire = bytes.Clone(t.Envelope), bytes.Clone(t.NativeWire)
	t.TransactionHash, t.NativeWireHash = bytes.Clone(t.TransactionHash), bytes.Clone(t.NativeWireHash)
	t.EngineAppHash, t.TrustedBlockHash = bytes.Clone(t.EngineAppHash), bytes.Clone(t.TrustedBlockHash)
	return t, nil
}

func (t ProofHostTargetInput) validate(network string) error {
	if len(t.Envelope) == 0 || len(t.Envelope) > MaxPQContractTransactionBytes || len(t.NativeWire) == 0 || len(t.NativeWire) > chain.MaxPQBatchBytes {
		return errors.New("bounded retained original envelope and native wire required")
	}
	if t.Height <= 0 || t.Height >= math.MaxInt64-2 || t.Index < 0 || t.Index > math.MaxInt32 || t.EngineHeight < t.Height+1 || t.EngineHeight >= math.MaxInt64-2 || t.TrustedHeight <= 0 || t.TrustedHeight >= t.Height || t.TrustingPeriod <= 0 || t.MaxClockDrift < 0 {
		return errors.New("explicit checkpoint, earlier trust anchor, adjacent target and bounded index required")
	}
	for _, hash := range [][]byte{t.TransactionHash, t.NativeWireHash, t.EngineAppHash, t.TrustedBlockHash} {
		if _, err := proofHostHash(hex.EncodeToString(hash)); err != nil {
			return errors.New("independent full nonzero original and checkpoint hashes required")
		}
	}
	if _, err := pqLightTrustLevel(t.TrustLevel, 1); err != nil {
		return err
	}
	kind, wire, err := pqTransactionWire(t.Envelope)
	abciHash, nativeHash := sha256.Sum256(t.Envelope), sha256.Sum256(t.NativeWire)
	if err != nil || kind != t.TransactionType || !bytes.Equal(wire, t.NativeWire) || !bytes.Equal(abciHash[:], t.TransactionHash) || !bytes.Equal(nativeHash[:], t.NativeWireHash) {
		return errors.New("retained original envelope, native wire, type and independent hashes differ")
	}
	return proofHostOriginalAccount(ProofHostSourcePlan{Account: t.Account, NetworkID: network}, PQTransactionProofExpectation{TransactionType: kind, Envelope: t.Envelope, NativeWire: t.NativeWire})
}

// InspectStoppedProofHostTarget uses exactly the original stopped application,
// PQ signer leases and read-only Comet stores. No SourcePlan decoder is relaxed,
// no partial plan is manufactured, and no output/source file is written.
func InspectStoppedProofHostTarget(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options OperatorCheckpointOptions, target ProofHostTargetInput, now time.Time) (out ProofHostTargetResult, err error) {
	defer func() {
		if recover() != nil {
			err = errors.New("original stopped proof target store is corrupt or unavailable")
		}
		if err != nil {
			out = ProofHostTargetResult{}
		}
	}()
	target, err = holdProofHostTargetInput(target)
	if err != nil {
		return out, err
	}
	if now.IsZero() {
		return out, errors.New("verification requires the caller's local clock")
	}
	if err = target.validate(pins.OriginalGenesisHash); err != nil {
		return out, err
	}
	bootstrap, err := NewConsensusBootstrap(rawGenesis, pins, migration)
	if err != nil {
		return out, err
	}
	if options.Authorization == nil || options.SigningLockKind != "pq-signer" || options.NextAuthorization != nil || options.BackupOutput != "" || options.BackupLegacyKeyPath != "" || options.BackupNodeKeyPath != "" || options.ProposePQActivationHeight != 0 || options.LegacyStakingOwner != "" {
		return out, errors.New("proof target inspection requires current PQ authority and only read-only checkpoint options")
	}
	if options.RuntimeUpgrade != nil {
		if err = validateRuntimeUpgradeBootstrap(migration, bootstrap, options.RuntimeUpgrade); err != nil {
			return out, err
		}
	} else if bootstrap.record.Params.Version == nil || bootstrap.record.Params.Version.App != ApplicationVersion {
		return out, errors.New("historical runtime requires its independent upgrade plan")
	}
	if options.StateLayout != "atomic-json" && options.StateLayout != "snapshot-journal" && options.StateLayout != "block-journal" {
		return out, errors.New("explicit original application layout required")
	}
	for _, path := range []string{options.StatePath, options.SigningStatePath, options.CometDataDirectory} {
		if err = requireInspectionPath(path); err != nil {
			return out, err
		}
	}
	signInfo, err := os.Lstat(options.SigningStatePath)
	if err != nil || !signInfo.Mode().IsRegular() || signInfo.Mode().Perm() != 0600 || signInfo.Size() == 0 {
		return out, errors.New("existing original private PQ HRS identity required; body is not read")
	}
	appInfo, err := os.Lstat(options.StatePath)
	if err != nil || os.SameFile(appInfo, signInfo) {
		return out, errors.New("original application and signing file identities must differ")
	}
	appLease, err := existingInspectionWriterLease(options.StatePath)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, appLease()) }()
	signLease, err := existingInspectionLockFile(options.SigningStatePath + ".lock")
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, signLease()) }()
	for _, dir := range []string{filepath.Dir(options.StatePath), filepath.Dir(options.SigningStatePath)} {
		if err = rejectInspectionUnknown(dir); err != nil {
			return out, err
		}
	}
	captured, err := capturePQEngineState(options.StatePath)
	if err != nil {
		return out, err
	}
	if captured.layout != options.StateLayout {
		return out, errors.New("actual application layout differs from original selection")
	}
	held, err := holdProofHostCapturedState(captured)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, held.unchanged(), held.file.Close()) }()
	dbs := make([]dbm.DB, 0, 2)
	for _, name := range []string{"state", "blockstore"} {
		dir := filepath.Join(options.CometDataDirectory, name+".db")
		before, e := inspectionDatabaseFiles(dir)
		if e != nil {
			return out, e
		}
		db, e := dbm.NewGoLevelDBWithOpts(name, options.CometDataDirectory, &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
		if e != nil {
			return out, fmt.Errorf("open existing stopped %s database: %w", name, e)
		}
		dbs = append(dbs, db)
		defer func() {
			after, e := inspectionDatabaseFiles(dir)
			if e != nil || !sameInspectionDatabase(before, after) {
				err = errors.Join(err, errors.New("original database bytes/identity changed"))
			}
			err = errors.Join(err, db.Close())
		}()
	}
	r := proofHostReadDB{dbs[0]}
	ledger := proofHostLedger{load: r.load, validators: r.validators, results: sm.NewStore(dbs[0], sm.StoreOptions{}).LoadFinalizeBlockResponse, blocks: blockstore.NewBlockStore(dbs[1])}
	actual, err := ledger.load()
	if err != nil {
		return out, err
	}
	if actual.IsEmpty() || actual.ChainID != bootstrap.record.ChainID || actual.InitialHeight != bootstrap.record.InitialHeight || actual.LastBlockTime.IsZero() || actual.LastBlockHeight != target.EngineHeight || !bytes.Equal(actual.AppHash, target.EngineAppHash) {
		return out, errors.New("actual engine checkpoint differs from the independent checkpoint")
	}
	state, err := readPQEngineCommittedState(options.StatePath, migration, bootstrap, options.Authorization, options.RuntimeUpgrade)
	if err != nil {
		return out, err
	}
	if !state.Initialized || state.Height != target.EngineHeight || state.AppHash != hex.EncodeToString(target.EngineAppHash) {
		return out, errors.New("original application differs from the exact initialized engine checkpoint")
	}
	version, err := runtimeStateApplicationVersion(state, options.RuntimeUpgrade)
	if err != nil || version != actual.Version.Consensus.App {
		return out, errors.New("original runtime differs from actual engine version")
	}
	if err = options.Authorization.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return out, err
	}
	snapshot, e := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	snapshot, err = withRuntimeUpgradeSnapshot(snapshot, e, options.RuntimeUpgrade)
	if err != nil {
		return out, err
	}
	policy, err := snapshot.Policy()
	if err != nil || target.Height < policy.ActivationHeight {
		return out, errors.New("target must be in the independently activated PQ profile")
	}
	if _, err = sm.BindConsensusState(actual, snapshot); err != nil {
		return out, err
	}
	out, err = inspectProofHostTargetLedger(ledger, snapshot, target, pins.OriginalGenesisHash, now)
	if err != nil {
		return out, err
	}
	if err = captured.unchanged(); err != nil {
		return out, err
	}
	after, err := ledger.load()
	if err != nil {
		return out, err
	}
	if err = proofHostCheckpointContinuation(ledger, snapshot, actual, after, false); err != nil {
		return out, err
	}
	for _, dir := range []string{filepath.Dir(options.StatePath), filepath.Dir(options.SigningStatePath)} {
		if err = rejectInspectionUnknown(dir); err != nil {
			return out, err
		}
	}
	current, err := os.Lstat(options.SigningStatePath)
	if err != nil || !samePQStateFile(signInfo, current) {
		return out, errors.New("original PQ HRS identity changed during inspection")
	}
	return out, nil
}

func inspectProofHostTargetLedger(ledger proofHostLedger, snapshot *PQEngineSnapshot, target ProofHostTargetInput, network string, now time.Time) (ProofHostTargetResult, error) {
	var out ProofHostTargetResult
	trusted, err := ledger.lightBlock(target.TrustedHeight)
	if err != nil {
		return out, err
	}
	if !bytes.Equal(trusted.Hash(), target.TrustedBlockHash) {
		return out, errors.New("original trusted block differs from independent trust hash")
	}
	trusted, err = light.BindLightBlock(snapshot, trusted)
	if err != nil {
		return out, err
	}
	params, err := snapshot.ParamsAt(target.TrustedHeight)
	if err != nil || params.Version.App != trusted.Version.App {
		return out, errors.New("trusted original runtime differs from pinned authority")
	}
	if err = trusted.ValidatorSet.VerifyCommit(trusted.ChainID, trusted.Commit.BlockID, trusted.Height, trusted.Commit); err != nil {
		return out, err
	}
	b, err := ledger.lightBlock(target.Height)
	if err != nil {
		return out, err
	}
	next, err := ledger.lightBlock(target.Height + 1)
	if err != nil {
		return out, err
	}
	block := ledger.blocks.LoadBlock(target.Height)
	if block == nil || target.Index >= int64(len(block.Txs)) || !bytes.Equal(block.Txs[target.Index], target.Envelope) {
		return out, errors.New("lookup height/index does not contain the independent retained original")
	}
	results, err := ledger.results(target.Height)
	if err != nil || results == nil || len(results.TxResults) != len(block.Txs) || !bytes.Equal(results.AppHash, next.AppHash) {
		return out, errors.New("original complete execution results are unavailable or differ from successor")
	}
	header := func(lb *cmttypes.LightBlock) ProofHostExpectedHeader {
		return ProofHostExpectedHeader{ChainID: lb.ChainID, HeaderHeight: strconv.FormatInt(lb.Height, 10), BlockHash: hex.EncodeToString(lb.Hash()), StateHeight: strconv.FormatInt(lb.Height-1, 10), StateAppHash: hex.EncodeToString(lb.AppHash)}
	}
	x := ProofHostExpectedTransaction{Block: header(b), Successor: header(next), TransactionType: target.TransactionType, Envelope: base64.StdEncoding.EncodeToString(target.Envelope), NativeWire: base64.StdEncoding.EncodeToString(target.NativeWire), TransactionHash: hex.EncodeToString(target.TransactionHash), NativeWireHash: hex.EncodeToString(target.NativeWireHash), Index: strconv.FormatInt(target.Index, 10)}
	expected, err := x.expectation()
	if err != nil {
		return out, err
	}
	proof := PQTransactionProofRequest{Version: PQTransactionProofVersion}
	if proof.Block, err = proofHostLightRequest(b); err != nil {
		return out, err
	}
	if proof.Successor, err = proofHostLightRequest(next); err != nil {
		return out, err
	}
	if proof.TransactionProof, err = cmtjson.Marshal(block.Txs.Proof(int(target.Index))); err != nil {
		return out, err
	}
	if proof.ExecutionResult, proof.ExecutionProof, err = EncodePQTransactionExecutionProof(results.TxResults, int(target.Index)); err != nil {
		return out, err
	}
	verified, err := VerifyPQTransactionProof(PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: target.TrustingPeriod, MaxClockDrift: target.MaxClockDrift, TrustLevel: target.TrustLevel, Now: now}, expected, proof)
	if err != nil {
		return out, err
	}
	return ProofHostTargetResult{Version: "YNX-PROOF-HOST-TARGET/v1", Classification: "data", Account: target.Account, NetworkID: network, EngineHeight: strconv.FormatInt(target.EngineHeight, 10), EngineAppHash: hex.EncodeToString(target.EngineAppHash), TrustedHeight: strconv.FormatInt(target.TrustedHeight, 10), TrustedBlockHash: hex.EncodeToString(target.TrustedBlockHash), TrustingPeriodNanoseconds: strconv.FormatInt(int64(target.TrustingPeriod), 10), MaxClockDriftNanoseconds: strconv.FormatInt(int64(target.MaxClockDrift), 10), TrustLevelNumerator: strconv.FormatUint(target.TrustLevel.Numerator, 10), TrustLevelDenominator: strconv.FormatUint(target.TrustLevel.Denominator, 10), ExpectedTransaction: x, Verification: verified, SourceReadOnly: true, WriterExcluded: true, SigningWriterExcluded: true, LedgerProofVerified: true}, nil
}
