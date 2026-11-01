//go:build unix

package consensus

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/light"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
	"golang.org/x/sys/unix"
)

const PQLabFinalizeTraceVersion = "YNX-PQ-LAB-FINALIZE-TRACE/v1"
const pqLabFinalizeReconstruction = "original-BlockExecutor-eight-fields-from-stopped-BlockStore;not-RPC-wire-capture"
const pqLabFinalizeStateEncoding = "complete-encodeCommittedStateJSON-bytes;one-height-materialized;length-and-SHA256;no-field-projection"
const pqLabFinalizeTraceLimit = MaxPQLabProofMaterialsBytes

type PQLabFinalizeTraceOptions struct {
	RootDir, PlanSHA256, ActivationSHA256, OutputDir string
	ExpectedHeight                                   int64
	ExpectedAppHash                                  string
}

// File names are closed, relative PUBLIC names. No custody/source pathname is
// exported or reopened by the portable replay consumer.
type PQLabFinalizeTraceFile struct {
	Name   string `json:"name"`
	Bytes  int64  `json:"bytes,string"`
	SHA256 string `json:"sha256"`
}

type PQLabFinalizeTrace struct {
	Version          string                 `json:"version"`
	PlanSHA256       string                 `json:"planSHA256"`
	ActivationSHA256 string                 `json:"activationSHA256"`
	Pins             ConsensusBootstrapPins `json:"pins"`
	ChainID          string                 `json:"chainId"`
	FirstHeight      int64                  `json:"firstHeight,string"`
	LastHeight       int64                  `json:"lastHeight,string"`
	EngineAppHash    string                 `json:"engineAppHash"`
	ScheduleHash     string                 `json:"scheduleHash"`
	Migration        PQLabFinalizeTraceFile `json:"migration"`
	Genesis          PQLabFinalizeTraceFile `json:"genesis"`
	Schedule         PQLabFinalizeTraceFile `json:"schedule"`
	InitChain        PQLabFinalizeTraceFile `json:"initChain"`
	InitialState     PQLabFinalizeTraceFile `json:"initialState"`
	FinalState       PQLabFinalizeTraceFile `json:"finalState"`
	Records          PQLabFinalizeTraceFile `json:"records"`
	// The original synthetic lab has no runtime-upgrade input. A state requiring
	// one is refused by the normal loader; absence is explicit, never inferred.
	RuntimePlan      *PQLabFinalizeTraceFile `json:"runtimePlan"`
	RuntimePlanHash  string                  `json:"runtimePlanHash"`
	RequestSource    string                  `json:"requestSource"`
	StateEncoding    string                  `json:"stateEncoding"`
	StoppedNodes     int                     `json:"stoppedNodes"`
	ColdReopened     bool                    `json:"coldReopened"`
	SourceReadOnly   bool                    `json:"sourceReadOnly"`
	SyntheticOnly    bool                    `json:"syntheticOnly"`
	NodeStarted      bool                    `json:"nodeStarted"`
	AuthorityGranted bool                    `json:"authorityGranted"`
	PublicNetwork    bool                    `json:"publicNetwork"`
}

// Block and Request are full canonical protobufs. Response includes Log, Info,
// events, gas and every other original response field, even when not in AppHash.
// A full canonical state is regenerated at EACH height, not a balance summary.
type PQLabFinalizeTraceRecord struct {
	Height                  int64  `json:"height,string"`
	Block                   []byte `json:"block"`
	LightBlock              []byte `json:"lightBlock"`
	Request                 []byte `json:"request"`
	Response                []byte `json:"response"`
	StateBytes              int64  `json:"stateBytes,string"`
	StateSHA256             string `json:"stateSHA256"`
	AppHash                 string `json:"appHash"`
	ExecutionSuccessorBound bool   `json:"executionSuccessorBound"`
}

type PQLabFinalizeReplay struct {
	Version                         string                 `json:"version"`
	TraceSHA256                     string                 `json:"traceSHA256"`
	FirstHeight                     int64                  `json:"firstHeight,string"`
	LastHeight                      int64                  `json:"lastHeight,string"`
	Records                         PQLabFinalizeTraceFile `json:"records"`
	FinalState                      PQLabFinalizeTraceFile `json:"finalState"`
	CompleteStateBytesReconstructed bool                   `json:"completeStateBytesReconstructed"`
	FullResponsesCompared           bool                   `json:"fullResponsesCompared"`
	NormalizationApplied            bool                   `json:"normalizationApplied"`
	SourceReadOnly                  bool                   `json:"sourceReadOnly"`
	SyntheticOnly                   bool                   `json:"syntheticOnly"`
	NodeStarted                     bool                   `json:"nodeStarted"`
	AuthorityGranted                bool                   `json:"authorityGranted"`
	LiveNetworkPairQualified        bool                   `json:"liveNetworkPairQualified"`
}

type pqFinalizeOriginals struct{ files []*proofHostOriginal }

func (r *pqFinalizeOriginals) read(path string, limit int64) ([]byte, error) {
	for _, f := range r.files {
		if f.path == path {
			if int64(len(f.raw)) > limit {
				return nil, errors.New("original source exceeds bound")
			}
			return f.raw, nil
		}
	}
	f, err := readProofHostOriginal(path, "", limit)
	if err != nil {
		return nil, err
	}
	if f.info.Mode().Perm() != 0600 {
		return nil, errors.Join(errors.New("original lab source must remain 0600"), f.file.Close())
	}
	r.files = append(r.files, f)
	return f.raw, nil
}
func (r *pqFinalizeOriginals) close() error {
	var result error
	for _, f := range r.files {
		result = errors.Join(result, f.unchanged(), f.file.Close())
	}
	r.files = nil
	return result
}

func pqFinalizeFile(name string, raw []byte) PQLabFinalizeTraceFile {
	return PQLabFinalizeTraceFile{Name: name, Bytes: int64(len(raw)), SHA256: pqLabSHA(raw)}
}
func pqFinalizeWrite(dir, name string, raw []byte) (PQLabFinalizeTraceFile, error) {
	if err := pqLabWrite(filepath.Join(dir, name), raw); err != nil {
		return PQLabFinalizeTraceFile{}, err
	}
	return pqFinalizeFile(name, raw), nil
}

type pqFinalizeStream struct {
	file   *os.File
	digest hash.Hash
	size   int64
	path   string
}

func pqFinalizeNewStream(path string) (*pqFinalizeStream, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	return &pqFinalizeStream{file: f, digest: sha256.New(), path: path}, nil
}
func (s *pqFinalizeStream) append(row PQLabFinalizeTraceRecord) error {
	raw, err := json.Marshal(row)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if len(raw) > pqLabFinalizeTraceLimit/2 || int64(len(raw)) > int64(pqLabFinalizeTraceLimit)-s.size {
		return errors.New("complete original trace exceeds bounded public transport; no truncated result")
	}
	n, err := s.file.Write(raw)
	if err != nil {
		return err
	}
	if n != len(raw) {
		return io.ErrShortWrite
	}
	_, _ = s.digest.Write(raw)
	s.size += int64(n)
	return nil
}
func (s *pqFinalizeStream) finish() (PQLabFinalizeTraceFile, error) {
	if s.file == nil || s.size == 0 {
		return PQLabFinalizeTraceFile{}, errors.New("empty or already closed trace")
	}
	err := errors.Join(s.file.Sync(), s.file.Close(), syncJournalDirectory(s.path))
	s.file = nil
	if err != nil {
		return PQLabFinalizeTraceFile{}, err
	}
	return PQLabFinalizeTraceFile{Name: filepath.Base(s.path), Bytes: s.size, SHA256: hex.EncodeToString(s.digest.Sum(nil))}, nil
}
func (s *pqFinalizeStream) close() error {
	if s == nil || s.file == nil {
		return nil
	}
	e := s.file.Close()
	s.file = nil
	return e
}

func pqFinalizeInit(local *PQLabDistributedLocal, auth *PQEngineAuthorization) (*Application, []byte, error) {
	app, err := pqDistributedReplay(local, auth)
	if err != nil {
		return nil, nil, err
	}
	doc, err := cmttypes.GenesisDocFromJSON(local.genesisRaw)
	if err != nil {
		return nil, nil, err
	}
	// Use the exact same normal InitChain builder as the original loopback
	// application. The complete request is retained, not a selected-field view.
	params := doc.ConsensusParams.ToProto()
	req := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: doc.AppState}
	for _, v := range doc.Validators {
		key, e := cryptoenc.PubKeyToProto(v.PubKey)
		if e != nil {
			return nil, nil, e
		}
		req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	raw, err := req.Marshal()
	return app, raw, err
}

// This is the normal BlockExecutor request construction, using the ACTUAL
// original block and actual previous validator set. No clock/height/tx mapping.
func pqFinalizeRequest(block *cmttypes.Block, previous *cmttypes.ValidatorSet, initial int64) (*abci.RequestFinalizeBlock, error) {
	if block == nil || block.Height < initial || block.Height > initial && (previous == nil || block.LastCommit == nil || len(previous.Validators) != len(block.LastCommit.Signatures)) {
		return nil, errors.New("original replay commit/validator coordinates differ")
	}
	return &abci.RequestFinalizeBlock{Hash: block.Hash(), NextValidatorsHash: block.NextValidatorsHash, ProposerAddress: block.ProposerAddress, Height: block.Height, Time: block.Time, DecidedLastCommit: sm.BuildLastCommitInfo(block, previous, initial), Misbehavior: block.Evidence.Evidence.ToABCI(), Txs: block.Txs.ToSliceOfBytes()}, nil
}

func pqFinalizeValidateHeight(snapshot *PQEngineSnapshot, first, last int64, tipHash string, previous *cmttypes.Block, previousValidators *cmttypes.ValidatorSet, prior *abci.ResponseFinalizeBlock, block *cmttypes.Block, lb *cmttypes.LightBlock, response *abci.ResponseFinalizeBlock) (*cmttypes.ValidatorSet, error) {
	if block == nil || lb == nil || lb.Header == nil || response == nil || block.Height < first || block.Height > last || block.Height != lb.Height || !bytes.Equal(block.Hash(), lb.Hash()) || len(response.TxResults) != len(block.Txs) {
		return nil, errors.New("complete original block/commit/result identities differ")
	}
	if snapshot == nil || snapshot.bootstrap == nil || block.ChainID != snapshot.bootstrap.record.ChainID {
		return nil, errors.New("original block chain differs from independently pinned genesis")
	}
	if err := block.ValidateBasic(); err != nil {
		return nil, err
	}
	bound, err := light.BindLightBlock(snapshot, lb)
	if err != nil {
		return nil, err
	}
	params, err := snapshot.ParamsAt(block.Height)
	if err != nil {
		return nil, err
	}
	if block.Version.App != params.Version.App || !bytes.Equal(block.ConsensusHash, params.Hash()) {
		return nil, errors.New("historical authority parameters differ")
	}
	if err = bound.ValidatorSet.VerifyCommit(block.ChainID, bound.Commit.BlockID, block.Height, bound.Commit); err != nil {
		return nil, err
	}
	if block.Height == first {
		if previous != nil || previousValidators != nil || prior != nil {
			return nil, errors.New("initial trace is not original genesis boundary")
		}
	} else {
		if previous == nil || previousValidators == nil || prior == nil || previous.Height+1 != block.Height {
			return nil, errors.New("original trace has a height gap")
		}
		parts, e := previous.MakePartSet(cmttypes.BlockPartSizeBytes)
		if e != nil {
			return nil, e
		}
		id := cmttypes.BlockID{Hash: previous.Hash(), PartSetHeader: parts.Header()}
		if !block.LastBlockID.Equals(id) || !bytes.Equal(previous.NextValidatorsHash, block.ValidatorsHash) || !bytes.Equal(block.LastResultsHash, cmttypes.NewResults(prior.TxResults).Hash()) || !bytes.Equal(block.AppHash, prior.AppHash) {
			return nil, errors.New("original complete block/result successor link differs")
		}
		if err = previousValidators.VerifyCommit(block.ChainID, id, block.Height-1, block.LastCommit); err != nil {
			return nil, err
		}
	}
	if block.Height == last && hex.EncodeToString(response.AppHash) != tipHash {
		return nil, errors.New("last result differs from exact cold checkpoint")
	}
	return bound.ValidatorSet, nil
}

func pqFinalizeExecute(ctx context.Context, app *Application, req *abci.RequestFinalizeBlock, expected []byte) ([]byte, error) {
	response, err := app.FinalizeBlock(ctx, req)
	if err != nil {
		return nil, err
	}
	raw, err := response.Marshal()
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(raw, expected) {
		return nil, errors.New("normal replay differs from complete original ResponseFinalizeBlock bytes")
	}
	if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		return nil, err
	}
	state, err := encodeCommittedStateJSON(app.committed)
	if err == nil && len(state) > 128<<20 {
		return nil, errors.New("complete replay state exceeds original lab checkpoint bound")
	}
	return state, err
}

// ExportPQLabFinalizeTrace holds all four original DB/App/signing leases. It
// never opens keys, creates a writer, changes the clock, or starts a Node.
func ExportPQLabFinalizeTrace(ctx context.Context, o PQLabFinalizeTraceOptions) (out PQLabFinalizeTrace, err error) {
	defer func() {
		if recover() != nil {
			out = PQLabFinalizeTrace{}
			err = errors.New("corrupt original stopped trace source")
		}
	}()
	if o.ExpectedHeight <= 0 {
		return out, errors.New("exact stopped height required")
	}
	if _, err = proofHostHash(o.ExpectedAppHash); err != nil {
		return out, err
	}
	var originals pqFinalizeOriginals
	var sources []*pqLabStoppedSource
	closeAll := func() error {
		e := originals.close()
		for i := len(sources) - 1; i >= 0; i-- {
			e = errors.Join(e, sources[i].close())
		}
		sources = nil
		return e
	}
	defer func() {
		err = errors.Join(err, closeAll())
		if err != nil {
			out = PQLabFinalizeTrace{}
		}
	}()
	p, m, b, err := loadPQLabObservedWithRead(o.RootDir, o.PlanSHA256, nil, originals.read)
	if err != nil {
		return out, err
	}
	for _, n := range p.Nodes {
		if o.OutputDir == n.Home || strings.HasPrefix(o.OutputDir, n.Home+string(os.PathSeparator)) {
			return out, errors.New("trace output cannot enter original node/custody namespace")
		}
	}
	activationRaw, err := originals.read(filepath.Join(p.RootDir, "activation", "activation.json"), 4<<20)
	if err != nil {
		return out, err
	}
	if _, err = proofHostHash(o.ActivationSHA256); err != nil || pqLabSHA(activationRaw) != o.ActivationSHA256 {
		return out, errors.New("independent original activation pin differs")
	}
	var activation PQLabActivation
	if err = pqLabDecode(activationRaw, &activation); err != nil {
		return out, err
	}
	if activation.Version != "YNX-PQ-LAB-ACTIVATION/v1" || !activation.SyntheticOnly || activation.NodeStarted || activation.PQQuorumVerified || activation.NetworkPlanSHA256 != o.PlanSHA256 || activation.ScheduleFile != filepath.Join(p.RootDir, "activation", "schedule.json") || len(activation.Nodes) != 4 {
		return out, errors.New("original activation identity differs")
	}
	scheduleRaw, err := originals.read(activation.ScheduleFile, 32<<10)
	if err != nil {
		return out, err
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, activation.ScheduleHash)
	if err != nil {
		return out, err
	}
	s := auth.schedule
	if activation.RegistryHeight != s.RegistryHeight || activation.RegistryRoot != s.RegistryRoot || activation.ParamsHeight != s.ParamsUpdateHeight || activation.ValidatorHeight != s.ValidatorUpdateHeight || activation.ActivationHeight != s.ActivationHeight {
		return out, errors.New("activation coordinates differ from original schedule")
	}
	for i, n := range p.Nodes {
		args := append(p.normalArgs(n), "--pq-engine-schedule", activation.ScheduleFile, "--pq-engine-schedule-hash", activation.ScheduleHash, "--pq-host-key-binding", n.HostBindingFile, "--pq-host-key-vault", n.VaultFile, "--pq-recovery-fd", "3")
		if !reflect.DeepEqual(activation.Nodes[i], PQLabActivationNode{Index: i, Args: args, RecoveryFD: 3, RecoveryCredentialFile: n.RecoveryCredentialFile}) {
			return out, errors.New("activation normal arguments changed")
		}
	}
	if err = pqLabNetworkFreshDirectory(o.OutputDir); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(o.OutputDir, "intent.json"), o); err != nil {
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
	if actual.ChainID != p.ChainID || actual.InitialHeight != p.InitialHeight || actual.LastBlockHeight != o.ExpectedHeight || hex.EncodeToString(actual.AppHash) != o.ExpectedAppHash || o.ExpectedHeight <= activation.ActivationHeight || o.ExpectedHeight-p.InitialHeight >= 4096 {
		return out, errors.New("exact complete stopped PQ checkpoint required")
	}
	for _, source := range sources {
		v := source.state
		if v.ChainID != actual.ChainID || v.InitialHeight != actual.InitialHeight || v.LastBlockHeight != actual.LastBlockHeight || !bytes.Equal(v.AppHash, actual.AppHash) || !v.LastBlockID.Equals(actual.LastBlockID) || source.blocks.Base() != p.InitialHeight || source.blocks.Height() != o.ExpectedHeight {
			return out, errors.New("four complete stopped engine checkpoints differ")
		}
		successor := source.blocks.LoadBlock(activation.RegistryHeight + 1)
		if successor == nil || hex.EncodeToString(successor.AppHash) != activation.AppHash {
			return out, errors.New("actual activation checkpoint is missing or differs")
		}
	}
	var finalRaw []byte
	var finalState CommittedState
	for i, n := range p.Nodes {
		captured, e := capturePQEngineState(n.StatePath)
		if e != nil {
			return out, e
		}
		held, e := holdProofHostCapturedState(captured)
		if e != nil {
			if captured.closeOriginal != nil {
				_ = captured.closeOriginal()
			}
			return out, e
		}
		originals.files = append(originals.files, held)
		state, e := readPQEngineCommittedStateWithCapture(n.StatePath, m, b, auth, nil, func(string) (*pqEngineStateRead, error) { return captured, nil })
		if e != nil {
			return out, e
		}
		if !state.Initialized || state.Height != o.ExpectedHeight || state.AppHash != o.ExpectedAppHash {
			return out, errors.New("actual cold App differs from engine checkpoint")
		}
		if e = auth.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); e != nil {
			return out, e
		}
		raw, e := encodeCommittedStateJSON(state)
		if e != nil {
			return out, e
		}
		if len(raw) > 128<<20 {
			return out, errors.New("complete cold state exceeds original public lab bound")
		}
		if i == 0 {
			finalState, finalRaw = state, raw
		} else if !bytes.Equal(raw, finalRaw) {
			return out, errors.New("four full cold canonical states differ")
		}
	}
	snapshot, err := newPQEngineSnapshot(b, finalState.ValidatorRegistry, finalState.PQEngineSchedule, finalState.Height)
	if err != nil {
		return out, err
	}
	migrationRaw, err := originals.read(p.MigrationFile, 1<<30)
	if err != nil {
		return out, err
	}
	genesisRaw, err := originals.read(p.GenesisFile, 64<<20)
	if err != nil {
		return out, err
	}
	local := &PQLabDistributedLocal{migration: m, bootstrap: b, genesisRaw: genesisRaw}
	replay, initRaw, err := pqFinalizeInit(local, auth)
	if err != nil {
		return out, err
	}
	initialRaw, err := encodeCommittedStateJSON(replay.committed)
	if err != nil {
		return out, err
	}
	out = PQLabFinalizeTrace{Version: PQLabFinalizeTraceVersion, PlanSHA256: o.PlanSHA256, ActivationSHA256: o.ActivationSHA256, Pins: p.pins(), ChainID: p.ChainID, FirstHeight: p.InitialHeight, LastHeight: o.ExpectedHeight, EngineAppHash: o.ExpectedAppHash, ScheduleHash: activation.ScheduleHash, RequestSource: pqLabFinalizeReconstruction, StateEncoding: pqLabFinalizeStateEncoding, StoppedNodes: 4, ColdReopened: true, SourceReadOnly: true, SyntheticOnly: true}
	for _, f := range []struct {
		name   string
		raw    []byte
		target *PQLabFinalizeTraceFile
	}{{"migration.json", migrationRaw, &out.Migration}, {"genesis.json", genesisRaw, &out.Genesis}, {"schedule.json", scheduleRaw, &out.Schedule}, {"init-chain.pb", initRaw, &out.InitChain}, {"initial-state.json", initialRaw, &out.InitialState}, {"final-state.json", finalRaw, &out.FinalState}} {
		*f.target, err = pqFinalizeWrite(o.OutputDir, f.name, f.raw)
		if err != nil {
			return out, err
		}
	}
	stream, err := pqFinalizeNewStream(filepath.Join(o.OutputDir, "records.jsonl"))
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, stream.close()) }()
	var previous *cmttypes.Block
	var previousValidators *cmttypes.ValidatorSet
	var prior *abci.ResponseFinalizeBlock
	for h := p.InitialHeight; h <= o.ExpectedHeight; h++ {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		var block *cmttypes.Block
		var result *abci.ResponseFinalizeBlock
		var validators *cmttypes.ValidatorSet
		var blockRaw, responseRaw, lightRaw []byte
		for i, source := range sources {
			candidate := source.blocks.LoadBlock(h)
			lb, e := source.ledger.lightBlock(h)
			if e != nil {
				return out, e
			}
			response, e := source.ledger.results(h)
			if e != nil {
				return out, e
			}
			v, e := pqFinalizeValidateHeight(snapshot, p.InitialHeight, o.ExpectedHeight, o.ExpectedAppHash, previous, previousValidators, prior, candidate, lb, response)
			if e != nil {
				return out, e
			}
			if h == o.ExpectedHeight && !lb.Commit.BlockID.Equals(actual.LastBlockID) {
				return out, errors.New("tip original commit differs from stopped engine")
			}
			bp, e := candidate.ToProto()
			if e != nil {
				return out, e
			}
			br, e := bp.Marshal()
			if e != nil {
				return out, e
			}
			rr, e := response.Marshal()
			if e != nil {
				return out, e
			}
			if i == 0 {
				block, result, validators, blockRaw, responseRaw = candidate, response, v, br, rr
				lightRaw, e = cmtjson.Marshal(lb)
				if e != nil {
					return out, e
				}
			} else if !bytes.Equal(br, blockRaw) || !bytes.Equal(rr, responseRaw) {
				return out, errors.New("four original full block/result bytes differ")
			}
		}
		request, e := pqFinalizeRequest(block, previousValidators, p.InitialHeight)
		if e != nil {
			return out, e
		}
		requestRaw, e := request.Marshal()
		if e != nil {
			return out, e
		}
		if h == p.InitialHeight && !bytes.Equal(block.AppHash, mustDecodeTraceHash(replay.committed.AppHash)) {
			return out, errors.New("first original block differs from actual initial state")
		}
		stateRaw, e := pqFinalizeExecute(ctx, replay, request, responseRaw)
		if e != nil {
			return out, e
		}
		if h == o.ExpectedHeight && !bytes.Equal(stateRaw, finalRaw) {
			return out, errors.New("complete original trajectory differs from real cold state")
		}
		row := PQLabFinalizeTraceRecord{Height: h, Block: blockRaw, LightBlock: lightRaw, Request: requestRaw, Response: responseRaw, StateBytes: int64(len(stateRaw)), StateSHA256: pqLabSHA(stateRaw), AppHash: replay.committed.AppHash, ExecutionSuccessorBound: h < o.ExpectedHeight}
		if err = stream.append(row); err != nil {
			return out, err
		}
		previous, previousValidators, prior = block, validators, result
	}
	out.Records, err = stream.finish()
	if err != nil {
		return out, err
	}
	if err = closeAll(); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(o.OutputDir, "result.json"), out); err != nil {
		return PQLabFinalizeTrace{}, err
	}
	return out, nil
}

func mustDecodeTraceHash(value string) []byte { raw, _ := hex.DecodeString(value); return raw }

// This held stream preserves O_RDONLY identity/ctime and rereads the FULL hash
// at close, without loading all heights into memory or trusting only mtime.
type pqFinalizeReadStream struct {
	file       *os.File
	path       string
	info       os.FileInfo
	stamp, pin string
}

func pqFinalizeOpenStream(path string, expected PQLabFinalizeTraceFile) (*pqFinalizeReadStream, error) {
	if err := requireInspectionPath(path); err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != expected.Bytes || info.Size() <= 0 || info.Size() > int64(pqLabFinalizeTraceLimit) {
		return nil, errors.New("bounded original complete trace stream required")
	}
	if _, err = proofHostHash(expected.SHA256); err != nil {
		return nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "original-finalize-trace")
	var st unix.Stat_t
	if err = unix.Fstat(fd, &st); err != nil {
		_ = f.Close()
		return nil, err
	}
	stamp, err := proofHostChangeStamp(st)
	if err != nil || st.Nlink != 1 {
		_ = f.Close()
		return nil, errors.New("trace must have one original held inode")
	}
	r := &pqFinalizeReadStream{file: f, path: path, info: info, stamp: stamp, pin: expected.SHA256}
	if err = r.unchanged(); err != nil {
		_ = f.Close()
		return nil, err
	}
	return r, nil
}
func (r *pqFinalizeReadStream) unchanged() error {
	check := func() error {
		info, e := os.Lstat(r.path)
		if e != nil || !samePQStateFile(info, r.info) {
			return errors.New("original trace path changed")
		}
		held, e := r.file.Stat()
		if e != nil || !samePQStateFile(held, r.info) {
			return errors.New("original trace inode changed")
		}
		var st unix.Stat_t
		if unix.Fstat(int(r.file.Fd()), &st) != nil || st.Nlink != 1 {
			return errors.New("trace source identity unavailable")
		}
		stamp, e := proofHostChangeStamp(st)
		if e != nil || stamp != r.stamp {
			return errors.New("trace change epoch differs")
		}
		return nil
	}
	if e := check(); e != nil {
		return e
	}
	h := sha256.New()
	n, e := io.Copy(h, io.NewSectionReader(r.file, 0, r.info.Size()))
	if e != nil || n != r.info.Size() || hex.EncodeToString(h.Sum(nil)) != r.pin {
		return errors.New("complete trace bytes differ from independent pin")
	}
	return check()
}
func (r *pqFinalizeReadStream) close() error { return errors.Join(r.unchanged(), r.file.Close()) }

// ReplayPQLabFinalizeTrace consumes only the PUBLIC immutable bundle. It has no
// node/home/custody inputs and regenerates every full canonical state sequentially.
func ReplayPQLabFinalizeTrace(ctx context.Context, directory, receiptSHA, output string) (out PQLabFinalizeReplay, err error) {
	defer func() {
		if recover() != nil {
			out = PQLabFinalizeReplay{}
			err = errors.New("invalid original public Finalize trajectory")
		}
	}()
	if _, err = proofHostHash(receiptSHA); err != nil {
		return out, err
	}
	var originals pqFinalizeOriginals
	defer func() {
		err = errors.Join(err, originals.close())
		if err != nil {
			out = PQLabFinalizeReplay{}
		}
	}()
	raw, err := originals.read(filepath.Join(directory, "result.json"), 64<<10)
	if err != nil {
		return out, err
	}
	if pqLabSHA(raw) != receiptSHA {
		return out, errors.New("independent trace receipt pin differs")
	}
	var trace PQLabFinalizeTrace
	if err = pqLabDecode(raw, &trace); err != nil {
		return out, err
	}
	if trace.Version != PQLabFinalizeTraceVersion || !trace.SyntheticOnly || !trace.SourceReadOnly || !trace.ColdReopened || trace.StoppedNodes != 4 || trace.NodeStarted || trace.AuthorityGranted || trace.PublicNetwork || trace.RuntimePlan != nil || trace.RuntimePlanHash != "" || trace.RequestSource != pqLabFinalizeReconstruction || trace.StateEncoding != pqLabFinalizeStateEncoding || trace.FirstHeight <= 0 || trace.LastHeight < trace.FirstHeight || trace.LastHeight-trace.FirstHeight >= 4096 {
		return out, errors.New("complete bounded original lab trace metadata required")
	}
	for _, pin := range []string{trace.PlanSHA256, trace.ActivationSHA256, trace.EngineAppHash} {
		if _, err = proofHostHash(pin); err != nil {
			return out, err
		}
	}
	read := func(file PQLabFinalizeTraceFile, name string, limit int64) ([]byte, error) {
		if file.Name != name || file.Bytes <= 0 || file.Bytes > limit {
			return nil, errors.New("closed complete trace role/name/size required")
		}
		r, e := originals.read(filepath.Join(directory, name), limit)
		if e != nil {
			return nil, e
		}
		if int64(len(r)) != file.Bytes || pqLabSHA(r) != file.SHA256 {
			return nil, errors.New("original trace role bytes changed")
		}
		return r, nil
	}
	migrationRaw, err := read(trace.Migration, "migration.json", 1<<30)
	if err != nil {
		return out, err
	}
	genesisRaw, err := read(trace.Genesis, "genesis.json", 64<<20)
	if err != nil {
		return out, err
	}
	scheduleRaw, err := read(trace.Schedule, "schedule.json", 32<<10)
	if err != nil {
		return out, err
	}
	initRaw, err := read(trace.InitChain, "init-chain.pb", 64<<20)
	if err != nil {
		return out, err
	}
	initialRaw, err := read(trace.InitialState, "initial-state.json", 128<<20)
	if err != nil {
		return out, err
	}
	finalRaw, err := read(trace.FinalState, "final-state.json", 128<<20)
	if err != nil {
		return out, err
	}
	if trace.Records.Name != "records.jsonl" {
		return out, errors.New("closed original records role required")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return out, err
	}
	allowed := map[string]bool{"intent.json": true, "result.json": true, "migration.json": true, "genesis.json": true, "schedule.json": true, "init-chain.pb": true, "initial-state.json": true, "final-state.json": true, "records.jsonl": true}
	if len(entries) != len(allowed) {
		return out, errors.New("incomplete or extra trace originals")
	}
	for _, e := range entries {
		if !allowed[e.Name()] || !e.Type().IsRegular() {
			return out, errors.New("foreign or aliased trace original")
		}
	}
	var m chain.ConsensusMigrationState
	if err = json.Unmarshal(migrationRaw, &m); err != nil {
		return out, err
	}
	if m.Network.ChainID != PQLabNativeChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") {
		return out, errors.New("non-lab trace source refused")
	}
	b, err := NewConsensusBootstrap(genesisRaw, trace.Pins, m)
	if err != nil {
		return out, err
	}
	if b.record.ChainID != trace.ChainID || b.record.InitialHeight != trace.FirstHeight {
		return out, errors.New("trace genesis coordinates differ")
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, trace.ScheduleHash)
	if err != nil {
		return out, err
	}
	final, err := loadCommittedStateWithBootstrap(filepath.Join(directory, "final-state.json"), m, b)
	if err != nil {
		return out, err
	}
	if !final.Initialized || final.Height != trace.LastHeight || final.AppHash != trace.EngineAppHash {
		return out, errors.New("trace final checkpoint differs")
	}
	if err = auth.ValidateCommittedSchedule(final.PQEngineSchedule, final.Height); err != nil {
		return out, err
	}
	snapshot, err := newPQEngineSnapshot(b, final.ValidatorRegistry, final.PQEngineSchedule, final.Height)
	if err != nil {
		return out, err
	}
	app, actualInit, err := pqFinalizeInit(&PQLabDistributedLocal{migration: m, bootstrap: b, genesisRaw: genesisRaw}, auth)
	if err != nil {
		return out, err
	}
	actualInitial, err := encodeCommittedStateJSON(app.committed)
	if err != nil {
		return out, err
	}
	if !bytes.Equal(actualInit, initRaw) || !bytes.Equal(actualInitial, initialRaw) {
		return out, errors.New("complete original InitChain/initial state differs")
	}
	input, err := pqFinalizeOpenStream(filepath.Join(directory, "records.jsonl"), trace.Records)
	if err != nil {
		return out, err
	}
	defer func() {
		if input != nil {
			err = errors.Join(err, input.close())
		}
		if err != nil {
			out = PQLabFinalizeReplay{}
		}
	}()
	if output == directory || strings.HasPrefix(output, directory+string(os.PathSeparator)) {
		return out, errors.New("replay output cannot enter original bundle")
	}
	if err = pqLabNetworkFreshDirectory(output); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(output, "intent.json"), struct{ TraceSHA256 string }{receiptSHA}); err != nil {
		return out, err
	}
	stream, err := pqFinalizeNewStream(filepath.Join(output, "replay.jsonl"))
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, stream.close()) }()
	scanner := bufio.NewScanner(io.NewSectionReader(input.file, 0, input.info.Size()))
	scanner.Buffer(make([]byte, 64<<10), pqLabFinalizeTraceLimit/2)
	h := trace.FirstHeight
	var previous *cmttypes.Block
	var previousValidators *cmttypes.ValidatorSet
	var prior *abci.ResponseFinalizeBlock
	for scanner.Scan() {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		var row PQLabFinalizeTraceRecord
		if err = pqLabDecode(scanner.Bytes(), &row); err != nil {
			return out, err
		}
		if row.Height != h || h > trace.LastHeight || row.ExecutionSuccessorBound != (h < trace.LastHeight) {
			return out, errors.New("trace missing/reordered/extra height")
		}
		var bp cmtproto.Block
		if err = bp.Unmarshal(row.Block); err != nil {
			return out, err
		}
		canonical, e := bp.Marshal()
		if e != nil || !bytes.Equal(canonical, row.Block) {
			return out, errors.New("noncanonical complete original block")
		}
		block, e := cmttypes.BlockFromProto(&bp)
		if e != nil {
			return out, e
		}
		lb, e := DecodePQTrustedLightBlock(row.LightBlock)
		if e != nil {
			return out, e
		}
		var response abci.ResponseFinalizeBlock
		if err = response.Unmarshal(row.Response); err != nil {
			return out, err
		}
		canonical, e = response.Marshal()
		if e != nil || !bytes.Equal(canonical, row.Response) {
			return out, errors.New("noncanonical full original response")
		}
		validators, e := pqFinalizeValidateHeight(snapshot, trace.FirstHeight, trace.LastHeight, trace.EngineAppHash, previous, previousValidators, prior, block, lb, &response)
		if e != nil {
			return out, e
		}
		req, e := pqFinalizeRequest(block, previousValidators, trace.FirstHeight)
		if e != nil {
			return out, e
		}
		canonical, e = req.Marshal()
		if e != nil || !bytes.Equal(canonical, row.Request) {
			return out, errors.New("complete original FinalizeBlock request differs from actual block/validator reconstruction")
		}
		if h == trace.FirstHeight && !bytes.Equal(block.AppHash, mustDecodeTraceHash(app.committed.AppHash)) {
			return out, errors.New("first block initial AppHash differs")
		}
		stateRaw, e := pqFinalizeExecute(ctx, app, req, row.Response)
		if e != nil {
			return out, e
		}
		if int64(len(stateRaw)) != row.StateBytes || pqLabSHA(stateRaw) != row.StateSHA256 || app.committed.AppHash != row.AppHash {
			return out, errors.New("complete canonical state bytes differ at original height")
		}
		if h == trace.LastHeight && !bytes.Equal(stateRaw, finalRaw) {
			return out, errors.New("replay final full state differs from actual cold checkpoint")
		}
		if err = stream.append(row); err != nil {
			return out, err
		}
		previous, previousValidators, prior = block, validators, &response
		h++
	}
	if err = scanner.Err(); err != nil {
		return out, err
	}
	if h != trace.LastHeight+1 {
		return out, errors.New("complete original trace ended early")
	}
	replayed, err := stream.finish()
	if err != nil {
		return out, err
	}
	if replayed.Bytes != trace.Records.Bytes || replayed.SHA256 != trace.Records.SHA256 {
		return out, errors.New("trace framing/complete replay bytes differ")
	}
	err = input.close()
	input = nil
	if err != nil {
		return out, err
	}
	if err = originals.close(); err != nil {
		return out, err
	}
	finalFile, err := pqFinalizeWrite(output, "final-state.json", finalRaw)
	if err != nil {
		return out, err
	}
	out = PQLabFinalizeReplay{Version: "YNX-PQ-LAB-FINALIZE-REPLAY/v1", TraceSHA256: receiptSHA, FirstHeight: trace.FirstHeight, LastHeight: trace.LastHeight, Records: replayed, FinalState: finalFile, CompleteStateBytesReconstructed: true, FullResponsesCompared: true, SourceReadOnly: true, SyntheticOnly: true}
	if err = pqLabWriteJSON(filepath.Join(output, "result.json"), out); err != nil {
		return PQLabFinalizeReplay{}, err
	}
	return out, nil
}
