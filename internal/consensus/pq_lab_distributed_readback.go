//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/light"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

const PQLabDistributedReadbackVersion = "YNX-PQ-LAB-DISTRIBUTED-READBACK/v1"

type PQLabDistributedReadbackOptions struct {
	RootDir           string        `json:"rootDir"`
	PlanSHA256        string        `json:"planSHA256"`
	ActivationSHA256  string        `json:"activationSHA256"`
	Mode              string        `json:"mode"`
	OutputDir         string        `json:"outputDir"`
	ExpectedHeight    int64         `json:"expectedHeight,string"`
	ExpectedAppHash   string        `json:"expectedAppHash"`
	FirstHeight       int64         `json:"firstHeight,string"`
	TransactionFile   string        `json:"transactionFile"`
	TransactionSHA256 string        `json:"transactionSHA256"`
	NativeWireHash    string        `json:"nativeWireHash"`
	TrustingPeriod    time.Duration `json:"trustingPeriodNanoseconds,string"`
	MaxClockDrift     time.Duration `json:"maxClockDriftNanoseconds,string"`
	TrustNumerator    uint64        `json:"trustNumerator,string"`
	TrustDenominator  uint64        `json:"trustDenominator,string"`
}

// Full state and complete original blocks/results are separate public files.
// No private key, vault, credential, HRS body or remote path is exported.
type PQLabDistributedReadback struct {
	Version               string                             `json:"version"`
	Mode                  string                             `json:"mode"`
	NodeIndex             int                                `json:"nodeIndex"`
	NodeID                string                             `json:"nodeId"`
	PlanSHA256            string                             `json:"planSHA256"`
	ActivationSHA256      string                             `json:"activationSHA256"`
	ChainID               string                             `json:"chainId"`
	Height                int64                              `json:"height,string"`
	AppHash               string                             `json:"appHash"`
	OriginalStateSHA256   string                             `json:"originalStateSHA256"`
	State                 PQLabWorkloadFile                  `json:"state"`
	Heights               *PQLabWorkloadFile                 `json:"heights"`
	Materials             *PQLabWorkloadFile                 `json:"materials"`
	Proof                 *PQLabWorkloadFile                 `json:"proof"`
	QuietObservations     []PQLabDistributedQuietObservation `json:"quietObservations"`
	ColdReopened          bool                               `json:"coldReopened"`
	WriterExcluded        bool                               `json:"writerExcluded"`
	SigningWriterExcluded bool                               `json:"signingWriterExcluded"`
	SourceReadOnly        bool                               `json:"sourceReadOnly"`
	SyntheticOnly         bool                               `json:"syntheticOnly"`
	AuthorityGranted      bool                               `json:"authorityGranted"`
	PublicNetwork         bool                               `json:"publicNetwork"`
	NodeStarted           bool                               `json:"nodeStarted"`
}

type PQLabDistributedQuietObservation struct {
	Height     int64  `json:"height,string"`
	AppHash    string `json:"appHash"`
	CatchingUp bool   `json:"catchingUp"`
	Status     []byte `json:"status"`
	ABCIInfo   []byte `json:"abciInfo"`
}

type PQLabDistributedHeight struct {
	Height                  int64  `json:"height,string"`
	Block                   []byte `json:"block"`
	LightBlock              []byte `json:"lightBlock"`
	FinalizeResponse        []byte `json:"finalizeResponse"`
	CommittedState          []byte `json:"committedState"`
	ExecutionSuccessorBound bool   `json:"executionSuccessorBound"`
}

// Bootstrap has no PQ HRS yet. Both modes fence the original application and
// legacy writer, then PQ custody additionally fences its original normal lock.
// Read-only LevelDB still takes its real existing LOCK; a live DB is refused.
func openPQLabDistributedStopped(n PQLabNetworkNode, pq bool) (_ *pqLabStoppedSource, result error) {
	if pq {
		return openPQLabStoppedSource(n)
	}
	var closeFns []func() error
	closeAll := func() error {
		var e error
		for i := len(closeFns) - 1; i >= 0; i-- {
			e = errors.Join(e, closeFns[i]())
		}
		closeFns = nil
		return e
	}
	defer func() {
		if recover() != nil {
			result = errors.New("corrupt original stopped distributed database")
		}
		if result != nil {
			result = errors.Join(result, closeAll())
		}
	}()
	for _, path := range []string{n.StatePath, n.LegacyStateFile, filepath.Join(n.Home, "data")} {
		if err := requireInspectionPath(path); err != nil {
			return nil, err
		}
	}
	info, err := os.Lstat(n.LegacyStateFile)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() == 0 {
		return nil, errors.New("original legacy signing state required; body is not read")
	}
	for _, path := range []string{n.StatePath, n.LegacyStateFile} {
		close, err := existingInspectionWriterLease(path)
		if err != nil {
			return nil, err
		}
		closeFns = append(closeFns, close)
		if err = rejectInspectionUnknown(filepath.Dir(path)); err != nil {
			return nil, err
		}
	}
	closeFns = append(closeFns, func() error {
		after, e := os.Lstat(n.LegacyStateFile)
		if e != nil || !samePQStateFile(info, after) {
			return errors.New("original legacy signing state identity changed")
		}
		return nil
	})
	var dbs []dbm.DB
	for _, name := range []string{"state", "blockstore"} {
		dir := filepath.Join(n.Home, "data", name+".db")
		before, e := inspectionDatabaseFiles(dir)
		if e != nil {
			return nil, e
		}
		db, e := dbm.NewGoLevelDBWithOpts(name, filepath.Join(n.Home, "data"), &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
		if e != nil {
			return nil, e
		}
		dbs = append(dbs, db)
		closeFns = append(closeFns, func() error {
			after, e := inspectionDatabaseFiles(dir)
			if e == nil && !sameInspectionDatabase(before, after) {
				e = errors.New("original database changed")
			}
			return errors.Join(e, db.Close())
		})
	}
	r := proofHostReadDB{db: dbs[0]}
	state, err := r.load()
	if err != nil {
		return nil, err
	}
	blocks := blockstore.NewBlockStore(dbs[1])
	return &pqLabStoppedSource{ledger: proofHostLedger{load: r.load, validators: r.validators, results: sm.NewStore(dbs[0], sm.StoreOptions{}).LoadFinalizeBlockResponse, blocks: blocks}, blocks: blocks, state: state, close: closeAll}, nil
}

func pqDistributedAuthorization(local *PQLabDistributedLocal, pin string) (*PQEngineAuthorization, error) {
	if local.activation == nil {
		if pin != "" {
			return nil, errors.New("activation pin supplied without original activation")
		}
		return nil, nil
	}
	if _, err := proofHostHash(pin); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(filepath.Join(local.root, "activation", "activation.json"))
	if err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(local.activation)
	if err != nil || !bytes.Equal(raw, canonical) || pqLabSHA(raw) != pin {
		return nil, errors.New("independent original activation pin differs")
	}
	return NewPQEngineAuthorization(local.activation.Schedule, local.activation.ScheduleHash)
}

func pqDistributedState(local *PQLabDistributedLocal, auth *PQEngineAuthorization) (CommittedState, []byte, *proofHostOriginal, error) {
	captured, err := capturePQEngineState(local.node.StatePath)
	if err != nil {
		return CommittedState{}, nil, nil, err
	}
	if captured.layout != "atomic-json" {
		return CommittedState{}, nil, nil, errors.New("distributed lab plan requires original atomic layout")
	}
	held, err := holdProofHostCapturedState(captured)
	if err != nil {
		return CommittedState{}, nil, nil, err
	}
	state, err := readPQEngineCommittedStateWithCapture(local.node.StatePath, local.migration, local.bootstrap, auth, nil, func(string) (*pqEngineStateRead, error) { return captured, nil })
	if err == nil {
		err = auth.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height)
	}
	if err == nil && !state.Initialized {
		err = errors.New("original application is not initialized")
	}
	var raw []byte
	if err == nil {
		raw, err = encodeCommittedStateJSON(state)
	}
	if err == nil && len(raw) > 128<<20 {
		err = errors.New("complete original checkpoint exceeds unchanged lab transport bound")
	}
	if err != nil {
		return CommittedState{}, nil, nil, errors.Join(err, held.file.Close())
	}
	return state, raw, held, nil
}

func pqDistributedRPC(ctx context.Context, endpoint, method string) ([]byte, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return nil, errors.New("original numeric loopback RPC required")
	}
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return nil, errors.New("non-loopback RPC refused")
	}
	if p, e := strconv.Atoi(port); e != nil || p < 1 || p > 65535 {
		return nil, errors.New("invalid original RPC port")
	}
	u.Scheme = "http"
	u.Path = "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{Proxy: nil}}
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || len(raw) > 2<<20 || pqLightUniqueJSON(raw) != nil {
		return nil, errors.New("invalid bounded original RPC response")
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error,omitempty"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&envelope); err != nil || envelope.JSONRPC != "2.0" || len(envelope.ID) == 0 || len(envelope.Result) == 0 || bytes.Equal(envelope.Result, []byte("null")) || len(envelope.Error) > 0 && !bytes.Equal(envelope.Error, []byte("null")) {
		return nil, errors.New("RPC error or missing original result")
	}
	return bytes.Clone(envelope.Result), nil
}

func pqDistributedQuiet(ctx context.Context, local *PQLabDistributedLocal, state CommittedState) (PQLabDistributedQuietObservation, error) {
	var out PQLabDistributedQuietObservation
	statusRaw, err := pqDistributedRPC(ctx, local.node.RPCAddress, "status")
	if err != nil {
		return out, err
	}
	infoRaw, err := pqDistributedRPC(ctx, local.node.RPCAddress, "abci_info")
	if err != nil {
		return out, err
	}
	return pqDistributedQuietBytes(statusRaw, infoRaw, local.plan.ChainID, local.node.NodeID, state)
}

func pqDistributedQuietBytes(statusRaw, infoRaw []byte, chainID, nodeID string, state CommittedState) (PQLabDistributedQuietObservation, error) {
	var out PQLabDistributedQuietObservation
	if pqLightUniqueJSON(statusRaw) != nil || pqLightUniqueJSON(infoRaw) != nil {
		return out, errors.New("ambiguous original quiet observation")
	}
	var fields struct {
		SyncInfo struct {
			CatchingUp *bool `json:"catching_up"`
		} `json:"sync_info"`
	}
	if err := json.Unmarshal(statusRaw, &fields); err != nil || fields.SyncInfo.CatchingUp == nil {
		return out, errors.New("original catching_up observation is required")
	}
	var status coretypes.ResultStatus
	var info coretypes.ResultABCIInfo
	if err := cmtjson.Unmarshal(statusRaw, &status); err != nil {
		return out, err
	}
	if err := cmtjson.Unmarshal(infoRaw, &info); err != nil {
		return out, err
	}
	if status.NodeInfo.Network != chainID || string(status.NodeInfo.DefaultNodeID) != nodeID || status.SyncInfo.CatchingUp || status.SyncInfo.LatestBlockHeight != state.Height || info.Response.LastBlockHeight != state.Height || hex.EncodeToString(info.Response.LastBlockAppHash) != state.AppHash || info.Response.Data != ApplicationName {
		return out, errors.New("original RPC/ABCI/source checkpoint is not quiet and identical")
	}
	return PQLabDistributedQuietObservation{Height: state.Height, AppHash: state.AppHash, Status: statusRaw, ABCIInfo: infoRaw}, nil
}

func pqDistributedReplay(local *PQLabDistributedLocal, auth *PQEngineAuthorization) (*Application, error) {
	// Same private owned replay construction as the normal block journal reader:
	// no state path, no writer, no source repair. Authorization is still checked
	// at its exact original admission height by every normal Finalize/Commit.
	replay, err := newPersistentApplicationWithAuthorization(local.migration, "", local.bootstrap, nil, nil)
	if err != nil {
		return nil, err
	}
	replay.pqEngineAuthorization = auth
	doc, err := cmttypes.GenesisDocFromJSON(local.genesisRaw)
	if err != nil {
		return nil, err
	}
	params := doc.ConsensusParams.ToProto()
	req := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: doc.AppState}
	for _, v := range doc.Validators {
		key, e := cryptoenc.PubKeyToProto(v.PubKey)
		if e != nil {
			return nil, e
		}
		req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	if _, err = replay.InitChain(context.Background(), req); err != nil {
		return nil, err
	}
	return replay, nil
}

func pqDistributedHeights(ctx context.Context, source *pqLabStoppedSource, snapshot *PQEngineSnapshot, local *PQLabDistributedLocal, auth *PQEngineAuthorization, first int64, tip []byte) ([]byte, error) {
	end := source.state.LastBlockHeight
	initial := local.plan.InitialHeight
	if first < initial || source.blocks.Base() != initial || first > end || end-initial >= 4096 || source.blocks.Height() != end {
		return nil, errors.New("bounded complete retained original height range required")
	}
	replay, err := pqDistributedReplay(local, auth)
	if err != nil {
		return nil, err
	}
	rows := make([]PQLabDistributedHeight, 0, end-first+1)
	encodedBytes := 0
	var previousValidators *cmttypes.ValidatorSet
	for h := initial; h <= end; h++ {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		block := source.blocks.LoadBlock(h)
		if block == nil {
			return nil, errors.New("original block missing or pruned")
		}
		if err := block.ValidateBasic(); err != nil {
			return nil, err
		}
		lb, err := source.ledger.lightBlock(h)
		if err != nil {
			return nil, err
		}
		lb, err = light.BindLightBlock(snapshot, lb)
		if err != nil {
			return nil, err
		}
		params, err := snapshot.ParamsAt(h)
		if err != nil {
			return nil, err
		}
		if block.Version.App != params.Version.App || !bytes.Equal(block.ConsensusHash, params.Hash()) {
			return nil, errors.New("historical runtime/parameters differ from original authority")
		}
		if err = lb.ValidatorSet.VerifyCommit(source.state.ChainID, lb.Commit.BlockID, h, lb.Commit); err != nil {
			return nil, err
		}
		if h == end && !lb.Commit.BlockID.Equals(source.state.LastBlockID) {
			return nil, errors.New("tip commit differs from actual engine checkpoint")
		}
		if h > initial {
			previous := source.blocks.LoadBlock(h - 1)
			parts, e := previous.MakePartSet(cmttypes.BlockPartSizeBytes)
			if e != nil {
				return nil, e
			}
			id := cmttypes.BlockID{Hash: previous.Hash(), PartSetHeader: parts.Header()}
			if !block.LastBlockID.Equals(id) || !bytes.Equal(previous.NextValidatorsHash, block.ValidatorsHash) {
				return nil, errors.New("original full block/validator link mismatch")
			}
			prior, e := source.ledger.lightBlock(h - 1)
			if e != nil {
				return nil, e
			}
			prior, e = light.BindLightBlock(snapshot, prior)
			if e != nil {
				return nil, e
			}
			if e = prior.ValidatorSet.VerifyCommit(source.state.ChainID, id, h-1, block.LastCommit); e != nil {
				return nil, e
			}
		}
		result, err := source.ledger.results(h)
		if err != nil || result == nil || len(result.TxResults) != len(block.Txs) {
			return nil, errors.New("complete original execution results missing")
		}
		bound := h < end
		if bound {
			next := source.blocks.LoadBlock(h + 1)
			if next == nil || !bytes.Equal(next.LastResultsHash, cmttypes.NewResults(result.TxResults).Hash()) || !bytes.Equal(next.AppHash, result.AppHash) {
				return nil, errors.New("original successor/result commitment differs")
			}
		} else if !bytes.Equal(result.AppHash, source.state.AppHash) {
			return nil, errors.New("last execution does not match actual engine AppHash")
		}
		b, err := cmtjson.Marshal(block)
		if err != nil {
			return nil, err
		}
		l, err := cmtjson.Marshal(lb)
		if err != nil {
			return nil, err
		}
		r, err := result.Marshal()
		if err != nil {
			return nil, err
		}
		if h > initial && (previousValidators == nil || block.LastCommit == nil || len(block.LastCommit.Signatures) != len(previousValidators.Validators)) {
			return nil, errors.New("original replay commit/validator coordinates differ")
		}
		replayed, e := replay.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Hash: block.Hash(), NextValidatorsHash: block.NextValidatorsHash, ProposerAddress: block.ProposerAddress, Height: block.Height, Time: block.Time, DecidedLastCommit: sm.BuildLastCommitInfo(block, previousValidators, initial), Misbehavior: block.Evidence.Evidence.ToABCI(), Txs: block.Txs.ToSliceOfBytes()})
		if e != nil {
			return nil, e
		}
		replayedRaw, e := replayed.Marshal()
		if e != nil || !bytes.Equal(replayedRaw, r) {
			return nil, errors.New("normal historical replay differs from complete original execution result")
		}
		if _, e = replay.Commit(ctx, &abci.RequestCommit{}); e != nil {
			return nil, e
		}
		stateRaw, e := encodeCommittedStateJSON(replay.committed)
		if e != nil {
			return nil, e
		}
		if h == end && !bytes.Equal(stateRaw, tip) {
			return nil, errors.New("historical replay differs from actual complete cold checkpoint")
		}
		previousValidators = lb.ValidatorSet
		if h < first {
			continue
		}
		encodedBytes += len(b) + len(l) + len(r) + len(stateRaw)
		if encodedBytes > MaxPQLabProofMaterialsBytes/2 {
			return nil, errors.New("complete height readback exceeds existing bounded public transport")
		}
		rows = append(rows, PQLabDistributedHeight{Height: h, Block: b, LightBlock: l, FinalizeResponse: r, CommittedState: stateRaw, ExecutionSuccessorBound: bound})
	}
	return json.Marshal(rows)
}

// ReadPQLabDistributedCheckpoint opens only THIS host's original paths. It does
// not stop a process, create a writer lock, repair a journal or contact a peer.
// An output intent is exclusive; failures preserve partial data and first cause.
func ReadPQLabDistributedCheckpoint(ctx context.Context, o PQLabDistributedReadbackOptions, now time.Time) (out PQLabDistributedReadback, err error) {
	if ctx == nil || now.IsZero() {
		return out, errors.New("explicit local context and time required")
	}
	if o.Mode != "snapshot" && o.Mode != "quiet" && o.Mode != "stopped" && o.Mode != "proof" {
		return out, errors.New("explicit distributed readback mode required")
	}
	if o.Mode != "proof" && (o.TransactionFile != "" || o.TransactionSHA256 != "" || o.NativeWireHash != "" || o.TrustingPeriod != 0 || o.MaxClockDrift != 0 || o.TrustNumerator != 0 || o.TrustDenominator != 0) {
		return out, errors.New("proof parameters cannot be ignored by another readback mode")
	}
	if (o.Mode == "snapshot" || o.Mode == "quiet") && o.FirstHeight != 0 {
		return out, errors.New("history readback requires actual stopped leases")
	}
	if o.ExpectedHeight < 0 || (o.ExpectedHeight == 0) != (o.ExpectedAppHash == "") || o.Mode != "snapshot" && o.ExpectedHeight == 0 {
		return out, errors.New("exact expected checkpoint required")
	}
	if o.ExpectedAppHash != "" {
		if _, err = proofHostHash(o.ExpectedAppHash); err != nil {
			return out, err
		}
	}
	local, err := LoadPQLabDistributedLocal(o.RootDir, o.PlanSHA256)
	if err != nil {
		return out, err
	}
	auth, err := pqDistributedAuthorization(local, o.ActivationSHA256)
	if err != nil {
		return out, err
	}
	if err = pqLabNetworkFreshDirectory(o.OutputDir); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(o.OutputDir, "intent.json"), o); err != nil {
		return out, err
	}
	var held []*proofHostOriginal
	var source *pqLabStoppedSource
	closeAll := func() error {
		var e error
		for _, r := range held {
			e = errors.Join(e, r.unchanged(), r.file.Close())
		}
		held = nil
		if source != nil {
			e = errors.Join(e, source.close())
			source = nil
		}
		return e
	}
	defer func() {
		if recover() != nil {
			err = errors.New("corrupt or unavailable original distributed source")
		}
		err = errors.Join(err, closeAll())
		if err != nil {
			out = PQLabDistributedReadback{}
			_ = pqLabWriteJSON(filepath.Join(o.OutputDir, "UNKNOWN.json"), struct{ Version, Outcome, FirstCause string }{PQLabDistributedReadbackVersion, "UNKNOWN", err.Error()})
		}
	}()
	stopped := o.Mode == "stopped" || o.Mode == "proof"
	if stopped {
		source, err = openPQLabDistributedStopped(local.node, auth != nil)
		if err != nil {
			return out, err
		}
	}
	state, raw, original, err := pqDistributedState(local, auth)
	if err != nil {
		return out, err
	}
	held = append(held, original)
	if o.ExpectedHeight != 0 && (state.Height != o.ExpectedHeight || state.AppHash != o.ExpectedAppHash) {
		return out, errors.New("current original state differs from exact requested checkpoint")
	}
	out = PQLabDistributedReadback{Version: PQLabDistributedReadbackVersion, Mode: o.Mode, NodeIndex: local.node.Index, NodeID: local.node.NodeID, PlanSHA256: o.PlanSHA256, ActivationSHA256: o.ActivationSHA256, ChainID: local.plan.ChainID, Height: state.Height, AppHash: state.AppHash, OriginalStateSHA256: pqLabSHA(original.raw), SourceReadOnly: true, SyntheticOnly: true, WriterExcluded: stopped, SigningWriterExcluded: stopped}
	if o.Mode == "quiet" {
		for i := 0; i < 3; i++ {
			if err = ctx.Err(); err != nil {
				return out, err
			}
			if i > 0 {
				next, data, r, e := pqDistributedState(local, auth)
				if e != nil {
					return out, e
				}
				held = append(held, r)
				if next.Height != state.Height || next.AppHash != state.AppHash || !bytes.Equal(raw, data) {
					return out, errors.New("original source changed during quiet observations")
				}
			}
			observation, e := pqDistributedQuiet(ctx, local, state)
			if e != nil {
				return out, e
			}
			out.QuietObservations = append(out.QuietObservations, observation)
			if i < 2 {
				timer := time.NewTimer(100 * time.Millisecond)
				select {
				case <-ctx.Done():
					timer.Stop()
					return out, ctx.Err()
				case <-timer.C:
				}
			}
		}
	}
	files := map[string][]byte{"committed-state.json": raw}
	if stopped {
		actual := source.state
		if actual.ChainID != local.plan.ChainID || actual.InitialHeight != local.plan.InitialHeight || actual.LastBlockHeight != state.Height || hex.EncodeToString(actual.AppHash) != state.AppHash {
			return out, errors.New("original stopped engine/application checkpoints differ")
		}
		snapshot, e := loadPQEngineSnapshotWithRuntime(local.migration, local.node.StatePath, local.bootstrap, auth, nil, state.Height, actual.AppHash)
		if e != nil {
			return out, e
		}
		if _, e = sm.BindConsensusState(actual, snapshot); e != nil {
			return out, e
		}
		var cold *Application
		if auth == nil {
			cold, e = NewPersistentApplicationWithBootstrap(local.migration, local.node.StatePath, local.bootstrap)
		} else {
			cold, e = NewPersistentApplicationWithEngineAuthorization(local.migration, local.node.StatePath, local.bootstrap, auth)
		}
		if e != nil {
			return out, e
		}
		coldRaw, e := encodeCommittedStateJSON(cold.committed)
		if e != nil || !bytes.Equal(raw, coldRaw) {
			return out, errors.New("normal cold application differs from complete original state")
		}
		out.ColdReopened = true
		first := o.FirstHeight
		if first == 0 {
			first = local.plan.InitialHeight
		}
		heights, e := pqDistributedHeights(ctx, source, snapshot, local, auth, first, raw)
		if e != nil {
			return out, e
		}
		files["heights.json"] = heights
		if o.Mode == "proof" {
			materials, proof, e := pqDistributedProof(local, auth, source, state, o, now)
			if e != nil {
				return out, e
			}
			files["materials.json"], files["proof.json"] = materials, proof
		}
		after, e := source.ledger.load()
		if e != nil {
			return out, e
		}
		if e = proofHostCheckpointContinuation(source.ledger, snapshot, actual, after, false); e != nil {
			return out, e
		}
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	refreshed, e := LoadPQLabDistributedLocal(o.RootDir, o.PlanSHA256)
	if e != nil {
		return out, e
	}
	if _, e = pqDistributedAuthorization(refreshed, o.ActivationSHA256); e != nil {
		return out, e
	}
	if err = closeAll(); err != nil {
		return out, err
	}
	for _, name := range []string{"committed-state.json", "heights.json", "materials.json", "proof.json"} {
		data, exists := files[name]
		if !exists {
			continue
		}
		if err = pqLabWrite(filepath.Join(o.OutputDir, name), data); err != nil {
			return out, err
		}
		entry := pqLabFile(name, data)
		switch name {
		case "committed-state.json":
			out.State = entry
		case "heights.json":
			out.Heights = &entry
		case "materials.json":
			out.Materials = &entry
		case "proof.json":
			out.Proof = &entry
		}
	}
	if err = pqLabWriteJSON(filepath.Join(o.OutputDir, "result.json"), out); err != nil {
		return out, err
	}
	return out, nil
}
