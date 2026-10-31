//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/cometbft/cometbft/node"
	sm "github.com/cometbft/cometbft/state"
)

// A bounded serial reader on the ORIGINAL Node lifetime. It never opens live
// databases, signs, calls RPC, changes App state, or retries an attempted
// operation. One terminal UNKNOWN retires the session with all files intact.
type PQLabLiveMaterialsControl struct {
	in                     *pqLabLiveMaterialsInputs
	node                   *node.Node
	app                    *Application
	view                   *node.ProofSourceView
	mu                     sync.Mutex
	started, retired, busy bool
	next                   uint32
	seen                   map[string]bool
	err                    error
	cancel                 context.CancelFunc
	wg                     sync.WaitGroup
	done                   chan struct{}
	finish, close          sync.Once
}

func NewPQLabLiveMaterialsControl(n *node.Node, app *Application, path, pin string) (c *PQLabLiveMaterialsControl, err error) {
	if n == nil || app == nil {
		return nil, errors.New("original owning Node/Application required")
	}
	in, err := loadPQLabLiveMaterialsPolicy(path, pin)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, in.close())
		}
	}()
	app.mu.RLock()
	statePath := app.statePath
	b := app.bootstrap
	auth := app.pqEngineAuthorization
	app.mu.RUnlock()
	want := in.plan.Nodes[in.policy.NodeIndex]
	if statePath != want.StatePath || b == nil || auth == nil || b.record.ChainID != in.plan.ChainID || string(n.NodeInfo().ID()) != want.NodeID {
		return nil, errors.New("live lab reader differs from original pinned node/application identity")
	}
	if err = b.matchesMigration(in.migration); err != nil {
		return nil, err
	}
	authHash, e := auth.schedule.Hash()
	if e != nil || authHash != in.activation.ScheduleHash {
		return nil, errors.New("owning application has another independent PQ schedule")
	}
	view, err := n.ProofSourceView()
	if err != nil {
		return nil, err
	}
	// A completed, partial or UNKNOWN session cannot be silently resumed on
	// process restart. The original operation must be reconciled, not replayed.
	directory, err := os.Open(in.directory)
	if err != nil {
		return nil, err
	}
	names, e := directory.Readdirnames(4)
	ce := directory.Close()
	if ce != nil {
		return nil, ce
	}
	if e != nil && !errors.Is(e, io.EOF) {
		return nil, e
	}
	if len(names) != 2 {
		return nil, errors.New("existing live requests/results require original reconciliation before restart")
	}
	for _, name := range names {
		if name != "policy.json" && name != "anchor.json" {
			return nil, errors.New("unexpected original live session entry")
		}
	}
	c = &PQLabLiveMaterialsControl{in: in, node: n, app: app, view: view, next: 1, seen: make(map[string]bool), done: make(chan struct{})}
	if err = n.RegisterProofSourceConsumer(c.Close); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *PQLabLiveMaterialsControl) Start(parent context.Context) error {
	if parent == nil {
		return errors.New("owning normal process context required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.started || c.retired {
		return errors.New("lab live reader already started or retired")
	}
	c.started = true
	ctx, cancel := context.WithCancel(parent)
	c.cancel = cancel
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		defer c.finish.Do(func() { close(c.done) })
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-c.node.Quit():
				return
			case <-ticker.C:
				_, err := c.step(ctx)
				c.mu.Lock()
				finished := c.next > c.in.policy.MaxOperations
				if err != nil {
					c.err = errors.Join(c.err, err)
					c.retired = true
				}
				c.mu.Unlock()
				if err != nil || finished {
					return
				}
			}
		}
	}()
	return nil
}
func (c *PQLabLiveMaterialsControl) Done() <-chan struct{} { return c.done }
func (c *PQLabLiveMaterialsControl) Err() error            { c.mu.Lock(); defer c.mu.Unlock(); return c.err }
func (c *PQLabLiveMaterialsControl) Close() error {
	c.close.Do(func() {
		c.mu.Lock()
		c.retired = true
		if c.cancel != nil {
			c.cancel()
		}
		c.mu.Unlock()
		c.wg.Wait()
		c.mu.Lock()
		c.err = errors.Join(c.err, c.in.close())
		c.mu.Unlock()
		c.finish.Do(func() { close(c.done) })
	})
	return c.Err()
}

func (c *PQLabLiveMaterialsControl) step(parent context.Context) (present bool, err error) {
	c.mu.Lock()
	if c.retired || c.busy || c.next > c.in.policy.MaxOperations {
		c.mu.Unlock()
		return true, errors.New("lab live session retired, exhausted or in flight")
	}
	c.busy = true
	c.wg.Add(1)
	sequence := c.next
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.busy = false
		if err != nil {
			c.retired = true
			c.err = errors.Join(c.err, err)
		}
		c.mu.Unlock()
		c.wg.Done()
	}()
	if err = parent.Err(); err != nil {
		return true, err
	}
	path := pqLabLiveRequestPath(c.in.directory, sequence)
	if _, e := os.Lstat(path); os.IsNotExist(e) {
		return false, nil
	} else if e != nil {
		return true, e
	}
	if err = c.in.current(); err != nil {
		return true, err
	}
	r, err := readProofHostOriginal(path, "", 16<<10)
	if err != nil {
		return true, err
	}
	defer func() { err = errors.Join(err, r.unchanged(), r.file.Close()) }()
	var request PQLabLiveMaterialsRequest
	if err = pqLabDecode(r.raw, &request); err != nil {
		return true, err
	}
	if request.Sequence != sequence {
		return true, errors.New("live request sequence differs from original operation slot")
	}
	if c.seen[request.TransactionSHA256] {
		return true, errors.New("original transaction already consumed by this live session")
	}
	tx, kind, wire, err := c.in.transaction(request)
	if err != nil {
		return true, err
	}
	defer func() { err = errors.Join(err, tx.unchanged(), tx.file.Close()) }()
	output := pqLabLiveOutputPath(c.in.directory, sequence)
	if err = pqLabNetworkFreshDirectory(output); err != nil {
		return true, err
	}
	c.seen[request.TransactionSHA256] = true
	defer func() {
		if err != nil {
			failure := struct {
				Version, PolicySHA256, Outcome, FirstCauseSHA256 string
				Sequence                                         uint32
			}{"YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1", c.in.pin, "unknown", pqLabSHA([]byte(err.Error())), sequence}
			err = errors.Join(err, pqLabWriteJSON(filepath.Join(output, "failure.json"), failure))
		}
	}()
	if err = pqLabWrite(filepath.Join(output, "intent.json"), r.raw); err != nil {
		return true, err
	}
	ctx, cancel := context.WithTimeout(parent, c.in.policy.CaptureTimeout)
	defer cancel()
	result, err := c.capture(ctx, request, tx.raw, kind, wire, output, time.Now().UTC())
	if err != nil {
		return true, err
	}
	if err = errors.Join(ctx.Err(), r.unchanged(), tx.unchanged(), c.in.current()); err != nil {
		return true, err
	}
	if err = pqLabWriteJSON(filepath.Join(output, "result.json"), result); err != nil {
		return true, err
	}
	c.mu.Lock()
	c.next++
	c.mu.Unlock()
	return true, nil
}

func (c *PQLabLiveMaterialsControl) capture(ctx context.Context, r PQLabLiveMaterialsRequest, envelope []byte, kind string, wire []byte, output string, now time.Time) (out PQLabLiveMaterialsResult, err error) {
	defer func() {
		if recover() != nil {
			out = PQLabLiveMaterialsResult{}
			err = errors.New("corrupt original live source store")
		}
	}()
	p, a := c.in.plan, c.in.activation
	actual, err := c.view.LoadState()
	if err != nil {
		return out, err
	}
	if actual.ChainID != p.ChainID || actual.InitialHeight != p.InitialHeight || actual.LastBlockHeight <= a.ActivationHeight || actual.LastBlockHeight-a.RegistryHeight > 4096 {
		return out, errors.New("bounded original activated engine checkpoint required")
	}
	stateRaw, err := c.app.captureProofHostCommittedJSON(actual)
	if err != nil {
		return out, err
	}
	var state CommittedState
	if err = json.Unmarshal(stateRaw, &state); err != nil {
		return out, err
	}
	_, _, b, err := loadPQLab(p.RootDir, c.in.policy.PlanSHA256)
	if err != nil {
		return out, err
	}
	state.bootstrap = b
	if err = state.Validate(c.in.migration); err != nil {
		return out, err
	}
	if state.PQEngineSchedule == nil {
		return out, errors.New("original complete committed schedule unavailable")
	}
	var anchorState CommittedState
	if json.Unmarshal(c.in.anchor.CommittedState, &anchorState) != nil || anchorState.ValidatorRegistry == nil || state.ValidatorRegistry == nil {
		return out, errors.New("original registry anchor unavailable")
	}
	prefix := 0
	for prefix < len(state.ValidatorRegistry.Events) && state.ValidatorRegistry.Events[prefix].Height <= c.in.anchor.Height {
		prefix++
	}
	if !pqLabLiveCanonicalEqual(anchorState.ValidatorRegistry.Events, state.ValidatorRegistry.Events[:prefix]) {
		return out, errors.New("current registry does not retain the independent original R history")
	}
	auth, err := NewPQEngineAuthorization(c.in.schedule, a.ScheduleHash)
	if err != nil {
		return out, err
	}
	if err = auth.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return out, err
	}
	snapshot, err := newPQEngineSnapshot(b, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	if err != nil {
		return out, err
	}
	if _, err = sm.BindConsensusState(actual, snapshot); err != nil {
		return out, err
	}
	ledger := proofHostLedger{load: c.view.LoadState, validators: c.view.LoadValidators, results: c.view.LoadFinalizeBlockResponse, blocks: c.view, committed: c.app.captureProofHostCommittedJSON}
	height, index := int64(0), int64(-1)
	for h := a.ActivationHeight; h <= actual.LastBlockHeight; h++ {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		block := c.view.LoadBlock(h)
		if block == nil {
			return out, errors.New("original live block history was pruned")
		}
		for i, tx := range block.Txs {
			if bytes.Equal(tx, envelope) {
				if index >= 0 {
					return out, errors.New("original transaction appears in multiple retained slots")
				}
				height, index = h, int64(i)
			}
		}
	}
	if index < 0 || height >= actual.LastBlockHeight {
		return out, errors.New("original transaction and its committed H+1 are not available; preserve operation, no automatic retry")
	}
	trusted, err := c.in.advanceAnchor(ledger, snapshot, height, now)
	if err != nil {
		return out, err
	}
	block, err := ledger.lightBlock(height)
	if err != nil {
		return out, err
	}
	next, err := ledger.lightBlock(height + 1)
	if err != nil {
		return out, err
	}
	expected := ProofHostExpectedTransaction{Block: pqLabExportHeader(block), Successor: pqLabExportHeader(next), TransactionType: kind, Envelope: base64.StdEncoding.EncodeToString(envelope), NativeWire: base64.StdEncoding.EncodeToString(wire), TransactionHash: r.TransactionSHA256, NativeWireHash: r.NativeWireHash, Index: strconv.FormatInt(index, 10)}
	owner, err := pqLabExportOwner(kind, wire)
	if err != nil {
		return out, err
	}
	migrationRaw, err := c.in.migration.CanonicalJSON()
	if err != nil {
		return out, err
	}
	n := p.Nodes[c.in.policy.NodeIndex]
	policy := c.in.policy
	plan := ProofHostSourcePlan{Version: ProofHostSourcePlanVersion, SourceID: "pq-lab-" + p.SessionID, Epoch: "1", OperationID: r.TransactionSHA256, Account: owner, NetworkID: p.OriginalGenesisHash, OriginalHash: "0x" + r.NativeWireHash, MigrationFile: p.MigrationFile, MigrationSHA256: pqLabSHA(migrationRaw), GenesisFile: p.GenesisFile, ConsensusGenesisSHA256: p.CometGenesisSHA256, OriginalGenesisHash: p.OriginalGenesisHash, MigrationStateHash: p.MigrationStateHash, StateFile: n.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(n.Home, "data"), SigningStatePath: n.SignerStateFile, SigningLockKind: "pq-signer", ScheduleFile: a.ScheduleFile, ScheduleHash: a.ScheduleHash, ScheduleSHA256: pqLabSHA(c.in.schedule), EngineHeight: strconv.FormatInt(actual.LastBlockHeight, 10), EngineAppHash: hex.EncodeToString(actual.AppHash), TrustedHeight: strconv.FormatInt(trusted.Height, 10), TrustedBlockHash: hex.EncodeToString(trusted.Hash()), TrustingPeriodNanoseconds: strconv.FormatInt(int64(policy.TrustingPeriod), 10), MaxClockDriftNanoseconds: strconv.FormatInt(int64(policy.MaxClockDrift), 10), TrustLevelNumerator: strconv.FormatUint(policy.TrustNumerator, 10), TrustLevelDenominator: strconv.FormatUint(policy.TrustDenominator, 10), ExpectedTransaction: expected}
	planRaw, err := json.Marshal(plan)
	if err != nil {
		return out, err
	}
	if err = pqLabWrite(filepath.Join(output, "derived-source-plan.json"), planRaw); err != nil {
		return out, err
	}
	in, err := loadProofHostInputs(planRaw, pqLabSHA(planRaw))
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, in.close()) }()
	in.ctx = ctx
	// These bytes were captured from the SAME original Node/App above. The
	// final real read and original continuation validator authenticate any
	// advancement. This does not relabel newer App state as the saved height.
	first := true
	ledger.load = func() (sm.State, error) {
		if first {
			first = false
			return actual, nil
		}
		return c.view.LoadState()
	}
	ledger.committed = func(s sm.State) ([]byte, error) {
		if s.LastBlockHeight != actual.LastBlockHeight || s.ChainID != actual.ChainID || !bytes.Equal(s.AppHash, actual.AppHash) || !s.LastBlockID.Equals(actual.LastBlockID) {
			return nil, errors.New("captured source coordinate mismatch")
		}
		return bytes.Clone(stateRaw), nil
	}
	captured, err := in.capture(ledger, filepath.Join(output, "source-context"), now)
	if err != nil {
		return out, err
	}
	files := map[string][]byte{}
	for _, f := range captured.Files {
		files[f.Role] = f.Bytes
	}
	e, err := expected.expectation()
	if err != nil {
		return out, err
	}
	m := PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: files["migration"], Genesis: files["genesis"], CommittedState: files["state"], Schedule: files["schedule"], TrustedLightBlock: files["trustedLightBlock"], Pins: p.pins(), ScheduleHash: a.ScheduleHash, EngineHeight: actual.LastBlockHeight, EngineAppHash: bytes.Clone(actual.AppHash), TrustingPeriod: policy.TrustingPeriod, MaxClockDrift: policy.MaxClockDrift, TrustNumerator: policy.TrustNumerator, TrustDenominator: policy.TrustDenominator, Expected: e}
	materialRaw, err := json.Marshal(m)
	if err != nil {
		return out, err
	}
	if len(materialRaw) > MaxPQLabProofMaterialsBytes {
		return out, errors.New("public live proof materials exceed transport bound")
	}
	proof, err := DecodePQTransactionProofRequest(captured.Proof)
	if err != nil {
		return out, err
	}
	verified, err := WritePQLabProofInputs(filepath.Join(output, "verifier"), m, proof, now)
	if err != nil {
		return out, err
	}
	materialPath, proofPath, statePath := filepath.Join(output, "materials.json"), filepath.Join(output, "proof.json"), filepath.Join(output, "committed-state.json")
	for _, f := range []struct {
		path string
		raw  []byte
	}{{materialPath, materialRaw}, {proofPath, captured.Proof}, {statePath, m.CommittedState}} {
		if err = pqLabWrite(f.path, f.raw); err != nil {
			return out, err
		}
	}
	out = PQLabLiveMaterialsResult{Version: "YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1", PolicySHA256: c.in.pin, Sequence: r.Sequence, Outcome: "verified_transaction_data", SourceKind: "original-node-owning-stores", OwningNodeIndex: policy.NodeIndex, EngineHeight: actual.LastBlockHeight, EngineAppHash: hex.EncodeToString(actual.AppHash), TransactionHash: r.TransactionSHA256, NativeWireHash: r.NativeWireHash, Materials: pqLabFile(materialPath, materialRaw), Proof: pqLabFile(proofPath, captured.Proof), Checkpoint: pqLabFile(statePath, m.CommittedState), Verified: verified, SyntheticOnly: true, SourceReadOnly: true}
	return out, errors.Join(ctx.Err(), in.unchanged())
}
