//go:build unix

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/light"
	"github.com/cometbft/cometbft/node"
	cmtstate "github.com/cometbft/cometbft/proto/tendermint/state"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/cosmos/gogoproto/proto"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

func proofHostOriginalAccount(p ProofHostSourcePlan, e PQTransactionProofExpectation) error {
	if !accountaddress.IsCanonical(p.Account) {
		return errors.New("source plan requires original canonical account")
	}
	match := func(owner string, network []byte) error {
		if owner != p.Account || hex.EncodeToString(network) != p.NetworkID {
			return errors.New("source operation account/network differs from original signed wire")
		}
		return nil
	}
	switch e.TransactionType {
	case PQMigrationType:
		x, err := ynxauth.DecodeMigration(e.NativeWire)
		if err != nil {
			return err
		}
		return match(x.Intent.Owner, x.Intent.ChainID)
	case PQRevocationType:
		x, err := ynxauth.DecodeRevocation(e.NativeWire)
		if err != nil {
			return err
		}
		return match(x.Intent.Owner, x.Intent.ChainID)
	case PQWholeType:
		x, err := ynxbatch.DecodeWhole(e.NativeWire)
		if err != nil {
			return err
		}
		for _, msg := range x.Messages {
			v, err := ynxauth.DecodeTransfer(msg)
			if err != nil {
				return err
			}
			if err = match(v.From, v.ChainID); err != nil {
				return err
			}
		}
		return nil
	case PQEthereumValueType:
		_, x, err := DecodePQEthereumValueTransaction(e.Envelope)
		if err != nil {
			return err
		}
		return match(x.Owner, x.ChainID)
	default:
		m, err := ynxbatch.DecodeMember(e.NativeWire)
		if err != nil {
			return err
		}
		if e.TransactionType == PQActionType {
			x, err := ynxauth.DecodeAction(m.Message)
			if err != nil {
				return err
			}
			return match(x.Owner, x.ChainID)
		}
		x, err := ynxauth.DecodeTransfer(m.Message)
		if err != nil {
			return err
		}
		return match(x.From, x.ChainID)
	}
}

// Minimal read interface shared by original in-process stores and the stopped
// read-only database adapter. It has no Save/Bootstrap/InitChain method.
type proofHostLedger struct {
	load       func() (sm.State, error)
	validators func(int64) (*cmttypes.ValidatorSet, error)
	results    func(int64) (*abci.ResponseFinalizeBlock, error)
	blocks     proofHostBlocks
	committed  func(sm.State) ([]byte, error)
}
type proofHostBlocks interface {
	LoadBlock(int64) *cmttypes.Block
	LoadBlockCommit(int64) *cmttypes.Commit
	LoadSeenCommit(int64) *cmttypes.Commit
}

// The upstream stopped Load/LoadValidators corruption paths terminate the
// process. Decode their exact stored protobufs here and return an error instead;
// proposer priorities follow the original 100000-height checkpoint algorithm.
type proofHostReadDB struct{ db dbm.DB }

func (r proofHostReadDB) load() (sm.State, error) {
	wire, err := r.db.Get([]byte("stateKey"))
	if err != nil || len(wire) == 0 || len(wire) > 64<<20 {
		return sm.State{}, errors.New("missing bounded original Comet checkpoint")
	}
	var p cmtstate.State
	if err = proto.Unmarshal(wire, &p); err != nil {
		return sm.State{}, err
	}
	s, err := sm.FromProto(&p)
	if err != nil {
		return sm.State{}, err
	}
	return *s, nil
}
func (r proofHostReadDB) validatorInfo(h int64) (*cmtstate.ValidatorsInfo, error) {
	wire, err := r.db.Get([]byte(fmt.Sprintf("validatorsKey:%d", h)))
	if err != nil || len(wire) == 0 || len(wire) > 2<<20 {
		return nil, errors.New("missing bounded original validator history")
	}
	v := new(cmtstate.ValidatorsInfo)
	if err = v.Unmarshal(wire); err != nil {
		return nil, err
	}
	return v, nil
}
func (r proofHostReadDB) validators(h int64) (*cmttypes.ValidatorSet, error) {
	if h <= 0 {
		return nil, errors.New("invalid historical validator height")
	}
	v, err := r.validatorInfo(h)
	if err != nil {
		return nil, err
	}
	delta := int64(0)
	if v.ValidatorSet == nil {
		stored := h - h%100000
		if v.LastHeightChanged > stored {
			stored = v.LastHeightChanged
		}
		if stored <= 0 || stored > h || h-stored >= 100000 {
			return nil, errors.New("invalid original validator checkpoint link")
		}
		delta = h - stored
		v, err = r.validatorInfo(stored)
		if err != nil {
			return nil, err
		}
	}
	if v.ValidatorSet == nil || len(v.ValidatorSet.Validators) == 0 || len(v.ValidatorSet.Validators) > 100 {
		return nil, errors.New("missing bounded complete validator set")
	}
	set, err := cmttypes.ValidatorSetFromProto(v.ValidatorSet)
	if err != nil {
		return nil, err
	}
	if delta > 0 {
		set.IncrementProposerPriority(int32(delta))
	}
	return set, nil
}

func (l proofHostLedger) lightBlock(h int64) (*cmttypes.LightBlock, error) {
	b := l.blocks.LoadBlock(h)
	if b == nil {
		return nil, errors.New("original block has been pruned or is unavailable")
	}
	c := l.blocks.LoadBlockCommit(h)
	if c == nil {
		c = l.blocks.LoadSeenCommit(h)
	}
	if c == nil {
		return nil, errors.New("original complete commit is unavailable")
	}
	v, err := l.validators(h)
	if err != nil {
		return nil, err
	}
	lb := &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &b.Header, Commit: c}, ValidatorSet: v}
	if err = lb.ValidateBasic(b.ChainID); err != nil {
		return nil, err
	}
	return lb, nil
}
func proofHostLightRequest(b *cmttypes.LightBlock) (PQLightProofRequest, error) {
	c, err := cmtjson.Marshal(coretypes.NewResultCommit(b.Header, b.Commit, false))
	if err != nil {
		return PQLightProofRequest{}, err
	}
	v, err := cmtjson.Marshal(&coretypes.ResultValidators{BlockHeight: b.Height, Validators: b.ValidatorSet.Validators, Count: len(b.ValidatorSet.Validators), Total: len(b.ValidatorSet.Validators)})
	if err != nil {
		return PQLightProofRequest{}, err
	}
	return PQLightProofRequest{Version: PQLightProofVersion, CommitResult: c, ValidatorsResult: v}, nil
}

func (in *proofHostInputs) capture(l proofHostLedger, output string, now time.Time) (out ProofHostSourceExport, err error) {
	// BlockStore panics on corrupt persisted proto. This boundary returns only
	// a bounded failure, never database bytes or a partial success object.
	defer func() {
		if recover() != nil {
			out = ProofHostSourceExport{}
			err = errors.New("original block store is corrupt or unavailable")
		}
	}()
	p := in.plan
	expected, _ := p.ExpectedTransaction.expectation()
	actual, err := l.load()
	if err != nil {
		return out, err
	}
	if actual.ChainID != expected.Block.ChainID || strconv.FormatInt(actual.LastBlockHeight, 10) != p.EngineHeight || hex.EncodeToString(actual.AppHash) != p.EngineAppHash || actual.InitialHeight != in.bootstrap.record.InitialHeight {
		return out, errors.New("actual engine checkpoint differs from independently pinned source plan")
	}
	if expected.Successor.HeaderHeight > actual.LastBlockHeight {
		return out, errors.New("successor is not committed in the actual ledger")
	}
	var captured *pqEngineStateRead
	var state CommittedState
	var stateBytes []byte
	if l.committed == nil {
		captured, err = capturePQEngineState(p.StateFile)
		if err != nil {
			return out, err
		}
		if captured.layout != p.StateLayout {
			return out, errors.New("original state layout mismatch")
		}
		held, holdErr := holdProofHostCapturedState(captured)
		if holdErr != nil {
			return out, holdErr
		}
		in.originals["originalState"] = held
		state, err = readPQEngineCommittedState(p.StateFile, in.migration, in.bootstrap, in.engine, in.runtime)
	} else {
		stateBytes, err = l.committed(actual)
		if err == nil {
			err = json.Unmarshal(stateBytes, &state)
		}
		if err == nil {
			state.bootstrap = in.bootstrap
			err = state.Validate(in.migration)
		}
	}
	if err != nil {
		return out, err
	}
	if state.Height != actual.LastBlockHeight || state.AppHash != p.EngineAppHash || !state.Initialized {
		return out, errors.New("original application is not the exact engine committed checkpoint")
	}
	version, err := runtimeStateApplicationVersion(state, in.runtime)
	if err != nil || version != actual.Version.Consensus.App {
		return out, errors.New("original runtime differs from actual engine version")
	}
	if err = in.engine.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return out, err
	}
	snapshot, e := newPQEngineSnapshot(in.bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	snapshot, err = withRuntimeUpgradeSnapshot(snapshot, e, in.runtime)
	if err != nil {
		return out, err
	}
	policy, err := snapshot.Policy()
	if err != nil || expected.Block.HeaderHeight < policy.ActivationHeight {
		return out, errors.New("source target must be in the independently activated PQ profile")
	}
	if _, err = sm.BindConsensusState(actual, snapshot); err != nil {
		return out, err
	}
	trustedH, _ := strconv.ParseInt(p.TrustedHeight, 10, 64)
	trusted, err := l.lightBlock(trustedH)
	if err != nil {
		return out, err
	}
	if hex.EncodeToString(trusted.Hash()) != p.TrustedBlockHash || trustedH >= expected.Block.HeaderHeight {
		return out, errors.New("ledger trusted header differs from independent trust pin")
	}
	trusted, err = light.BindLightBlock(snapshot, trusted)
	if err != nil {
		return out, err
	}
	params, err := snapshot.ParamsAt(trustedH)
	if err != nil || trusted.Version.App != params.Version.App {
		return out, errors.New("trusted header runtime mismatch")
	}
	if err = trusted.ValidatorSet.VerifyCommit(actual.ChainID, trusted.Commit.BlockID, trustedH, trusted.Commit); err != nil {
		return out, err
	}
	b, err := l.lightBlock(expected.Block.HeaderHeight)
	if err != nil {
		return out, err
	}
	successor, err := l.lightBlock(expected.Successor.HeaderHeight)
	if err != nil {
		return out, err
	}
	block := l.blocks.LoadBlock(expected.Block.HeaderHeight)
	if expected.Index < 0 || expected.Index >= int64(len(block.Txs)) || !bytes.Equal(block.Txs[expected.Index], expected.Envelope) {
		return out, errors.New("original indexed envelope differs from independent operation")
	}
	results, err := l.results(expected.Block.HeaderHeight)
	if err != nil || results == nil || len(results.TxResults) != len(block.Txs) || !bytes.Equal(results.AppHash, successor.AppHash) {
		return out, errors.New("original complete ABCI results missing or different from successor state")
	}
	proof := PQTransactionProofRequest{Version: PQTransactionProofVersion}
	if proof.Block, err = proofHostLightRequest(b); err != nil {
		return out, err
	}
	if proof.Successor, err = proofHostLightRequest(successor); err != nil {
		return out, err
	}
	if proof.TransactionProof, err = cmtjson.Marshal(block.Txs.Proof(int(expected.Index))); err != nil {
		return out, err
	}
	if proof.ExecutionResult, proof.ExecutionProof, err = EncodePQTransactionExecutionProof(results.TxResults, int(expected.Index)); err != nil {
		return out, err
	}
	trust := in.trust(snapshot)
	trust.TrustedLightBlock = trusted
	trust.Now = now
	if _, err = VerifyPQTransactionProof(trust, expected, proof); err != nil {
		return out, err
	}
	if stateBytes == nil {
		stateBytes, err = encodeCommittedStateJSON(state)
		if err != nil {
			return out, err
		}
	}
	trustedBytes, err := cmtjson.Marshal(trusted)
	if err != nil {
		return out, err
	}
	// This is a detached encoding of the complete SAME checkpoint. No reseal,
	// history trimming, new AppHash, initialization or source write occurs.
	if captured != nil {
		if err = captured.unchanged(); err != nil {
			return out, err
		}
	}
	after, err := l.load()
	if err != nil {
		return out, err
	}
	if err = proofHostCheckpointContinuation(l, snapshot, actual, after, l.committed != nil); err != nil {
		return out, err
	}
	return in.bundle(output, stateBytes, trustedBytes, proof)
}

// A captured immutable application checkpoint remains historical DATA when a
// live node advances. Authenticate its original full BlockID and the actual
// signed H+1 linkage/AppHash; never reinterpret a newer state as the old H.
func proofHostCheckpointContinuation(l proofHostLedger, snapshot *PQEngineSnapshot, before, after sm.State, live bool) error {
	if after.ChainID != before.ChainID || after.InitialHeight != before.InitialHeight || after.LastBlockHeight < before.LastBlockHeight {
		return errors.New("engine chain changed or checkpoint rolled back")
	}
	if after.LastBlockHeight == before.LastBlockHeight {
		if !bytes.Equal(after.AppHash, before.AppHash) || !after.LastBlockID.Equals(before.LastBlockID) {
			return errors.New("same-height engine checkpoint conflict")
		}
		return nil
	}
	if !live {
		return errors.New("stopped engine changed during source capture")
	}
	previous, err := l.lightBlock(before.LastBlockHeight)
	if err != nil {
		return err
	}
	next, err := l.lightBlock(before.LastBlockHeight + 1)
	if err != nil {
		return err
	}
	if !previous.Commit.BlockID.Equals(before.LastBlockID) || !bytes.Equal(previous.Hash(), before.LastBlockID.Hash) || !next.LastBlockID.Equals(before.LastBlockID) || !bytes.Equal(next.LastCommitHash, previous.Commit.Hash()) || !bytes.Equal(next.AppHash, before.AppHash) {
		return errors.New("live successor does not authenticate the original captured checkpoint")
	}
	for _, b := range []*cmttypes.LightBlock{previous, next} {
		bound, err := light.BindLightBlock(snapshot, b)
		if err != nil {
			return err
		}
		params, err := snapshot.ParamsAt(b.Height)
		if err != nil || params.Version.App != b.Version.App {
			return errors.New("live successor runtime differs from captured authority")
		}
		if err = bound.ValidatorSet.VerifyCommit(before.ChainID, bound.Commit.BlockID, bound.Height, bound.Commit); err != nil {
			return err
		}
	}
	return nil
}

// ExportStoppedProofHostSource uses the original stopped databases, existing
// application/PQ signing leases and independent full plan pin. No lock, ledger,
// application, private key, signing state or directory is created/modified.
func ExportStoppedProofHostSource(rawPlan []byte, planSHA256, output string, now time.Time) (out ProofHostSourceExport, err error) {
	in, err := loadProofHostInputs(rawPlan, planSHA256)
	if err != nil {
		return out, err
	}
	p := in.plan
	defer func() {
		err = errors.Join(err, in.close())
		if err != nil {
			out = ProofHostSourceExport{}
		}
	}()
	if err = proofHostDirectory(output); err != nil {
		return out, err
	}
	for _, path := range []string{p.StateFile, p.SigningStatePath, p.CometDataDirectory} {
		if err = requireInspectionPath(path); err != nil {
			return out, err
		}
	}
	signInfo, err := os.Lstat(p.SigningStatePath)
	if err != nil || !signInfo.Mode().IsRegular() || signInfo.Mode().Perm() != 0600 || signInfo.Size() == 0 {
		return out, errors.New("existing original private PQ HRS identity required; body is not read")
	}
	appLease, err := existingInspectionWriterLease(p.StateFile)
	if err != nil {
		return out, err
	}
	defer func() {
		err = errors.Join(err, appLease())
		if err != nil {
			out = ProofHostSourceExport{}
		}
	}()
	signLease, err := existingInspectionLockFile(p.SigningStatePath + ".lock")
	if err != nil {
		return out, err
	}
	defer func() {
		err = errors.Join(err, signLease())
		if err != nil {
			out = ProofHostSourceExport{}
		}
	}()
	for _, dir := range []string{filepath.Dir(p.StateFile), filepath.Dir(p.SigningStatePath)} {
		if err = rejectInspectionUnknown(dir); err != nil {
			return out, err
		}
	}
	dbs := make([]dbm.DB, 0, 2)
	for _, name := range []string{"state", "blockstore"} {
		dir := filepath.Join(p.CometDataDirectory, name+".db")
		before, e := inspectionDatabaseFiles(dir)
		if e != nil {
			return out, e
		}
		db, e := dbm.NewGoLevelDBWithOpts(name, p.CometDataDirectory, &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
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
			if err != nil {
				out = ProofHostSourceExport{}
			}
		}()
	}
	defer func() {
		if recover() != nil {
			out = ProofHostSourceExport{}
			err = errors.New("original stopped block store is corrupt")
		}
	}()
	r := proofHostReadDB{dbs[0]}
	l := proofHostLedger{load: r.load, validators: r.validators, results: sm.NewStore(dbs[0], sm.StoreOptions{}).LoadFinalizeBlockResponse, blocks: blockstore.NewBlockStore(dbs[1])}
	out, err = in.capture(l, output, now)
	if err != nil {
		return out, err
	}
	current, e := os.Lstat(p.SigningStatePath)
	if e != nil || !samePQStateFile(signInfo, current) {
		return ProofHostSourceExport{}, errors.New("original PQ HRS changed during publication")
	}
	return out, nil
}

// ExportNodeProofHostSource is the real in-process Node/Application callback.
// It reads the node's already-owned stores; it NEVER reopens a live LevelDB or
// calls Init/Finalize/Commit. Capture crossing the initial engine/App boundary
// refuses without retry. Later advancement requires signed historical linkage.
// The hosting operator must hold the actual Node and its original Application;
// request/RPC data cannot implement this source callback or supply authority.
func ExportNodeProofHostSource(n *node.Node, app *Application, rawPlan []byte, planSHA256, output string, now time.Time) (out ProofHostSourceExport, err error) {
	if n == nil || app == nil {
		return ProofHostSourceExport{}, errors.New("actual original node and application required")
	}
	in, err := loadProofHostInputs(rawPlan, planSHA256)
	if err != nil {
		return ProofHostSourceExport{}, err
	}
	defer func() {
		err = errors.Join(err, in.close())
		if err != nil {
			out = ProofHostSourceExport{}
		}
	}()
	app.mu.RLock()
	path := app.statePath
	app.mu.RUnlock()
	if path != in.plan.StateFile {
		return ProofHostSourceExport{}, errors.New("node application path differs from external source plan")
	}
	view, err := n.ProofSourceView()
	if err != nil {
		return ProofHostSourceExport{}, err
	}
	load := func() (sm.State, error) {
		s, err := view.LoadState()
		if err != nil {
			return sm.State{}, err
		}
		if _, err := app.ConsensusAuthorityForState(s.ChainID, s.LastBlockHeight, s.AppHash); err != nil {
			return sm.State{}, err
		}
		return s, nil
	}
	committed := func(actual sm.State) ([]byte, error) { return app.captureProofHostCommittedJSON(actual) }
	return in.capture(proofHostLedger{load: load, validators: view.LoadValidators, results: view.LoadFinalizeBlockResponse, blocks: view, committed: committed}, output, now)
}

func (app *Application) captureProofHostCommittedJSON(actual sm.State) ([]byte, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	if app.bootstrap == nil || app.bootstrap.record.ChainID != actual.ChainID || app.committed.Height != actual.LastBlockHeight || app.committed.AppHash != hex.EncodeToString(actual.AppHash) {
		return nil, errors.New("live engine/application checkpoint changed before capture")
	}
	// Do not assume every nested business map/slice is immutable after a shallow
	// copy. Encode the complete current committed value while its normal lock is
	// held, then release before decoding, validation, hashing and cryptography.
	// Large-checkpoint lock latency requires operator measurement; no claim of
	// production live latency or permission to invoke this on a public node.
	return encodeCommittedStateJSON(app.committed)
}
