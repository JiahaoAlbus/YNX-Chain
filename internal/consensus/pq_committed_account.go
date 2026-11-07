//go:build unix

package consensus

import (
	"bytes"
	"context"
	"errors"
	"math"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/light"
	"github.com/cometbft/cometbft/node"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
)

var (
	ErrPQCommittedAccountNotReady = errors.New("original captured account checkpoint has no committed H+1 yet")
	ErrPQCommittedAccountRetired  = errors.New("original committed-account reader is retired")
	ErrPQCommittedAccountBusy     = errors.New("original committed-account read is already in flight")
)

// PQCommittedAccountReader retains ONE actual constructor-bound engine capture.
// It never changes its owner/checkpoint, reopens a Node/database, waits for a
// future block, changes a clock/window or creates a signature. Its shared core
// makes copied Go handles share retirement/debt, rather than copying locks.
// The owning Auth factory must independently select this engine and original
// account under its real Root/Source contract. This API grants none of those.
type PQCommittedAccountReader struct{ core *pqCommittedAccountReader }

type pqCommittedAccountReader struct {
	source           *PQWalletPolicyLiveSource
	ctx              context.Context
	cancel           context.CancelFunc
	mu               sync.Mutex
	reading, retired bool
	closed           bool
	firstCause       error
	wg               sync.WaitGroup
	captured         sm.State
	policy           *PQWalletPolicyAtCheckpoint
}

// PQCommittedAccountEngineOrigin is an opaque in-process identity, never an
// issuer signature, received JSON/hash, Native brand, Root row or permission.
// It can only refer to the exact original Source which made this capture.
type PQCommittedAccountEngineOrigin struct{ core *pqCommittedAccountReader }

// OwnedBy checks only SAME original local engine identity/lifetime. Selecting
// app as an independently trusted Root backend remains with Auth's actual
// protected factory; a matching pointer does not supply that missing authority.
func (o *PQCommittedAccountEngineOrigin) OwnedBy(app *Application) error {
	if o == nil || o.core == nil || app == nil || o.core.source == nil || o.core.source.app != app {
		return ErrPQCommittedAccountRetired
	}
	if err := o.core.unavailable(); err != nil {
		return err
	}
	s, err := app.WalletPolicyLiveSource()
	if err != nil {
		return err
	}
	if s != o.core.source {
		return ErrPQCommittedAccountRetired
	}
	return nil
}

// PQCommittedAccountProofView keeps historical proof and current engine facts
// separate. Proof.Height H, HistoricalAccount.ExecutionHeight H+1 and
// CurrentCheckpoint.Height are distinct values, even when they happen to match.
// CurrentAccount contains the actual nonce/history/active full pair at that
// current committed state. Auth/SDK must apply their independently specified
// nonce/revision/window freshness policy; Core does not invent a staleness grant.
type PQCommittedAccountProofView struct {
	Proof             PQWalletPolicyCheckpoint
	HistoricalAccount PQWalletPolicyAtCheckpointView
	CurrentCheckpoint PQWalletPolicyCheckpoint
	CurrentAccount    PQWalletPolicyAtCheckpointView
	BlockOriginal     []byte
	SuccessorOriginal []byte
}

type pqCommittedAccountProofSeal struct {
	origin           *pqCommittedAccountReader
	proof, current   *PQWalletPolicyAtCheckpoint
	block, successor []byte
}

// PQCommittedAccountProof has no public decoder/constructor. Its seal is created
// only after the original engine/App binding AND actual H/H+1 consensus proof
// both succeed. This proves a local-engine account checkpoint, not Native
// receipt production, client Root selection, independent finality or approval.
type PQCommittedAccountProof struct{ seal *pqCommittedAccountProofSeal }

func (p *PQCommittedAccountProof) Origin() (*PQCommittedAccountEngineOrigin, error) {
	if p == nil || p.seal == nil || p.seal.origin == nil {
		return nil, ErrPQCommittedAccountRetired
	}
	return &PQCommittedAccountEngineOrigin{core: p.seal.origin}, nil
}
func (p *PQCommittedAccountProof) View() (PQCommittedAccountProofView, error) {
	if p == nil || p.seal == nil {
		return PQCommittedAccountProofView{}, ErrPQCommittedAccountRetired
	}
	a, err := p.seal.proof.OwnerPolicy()
	if err != nil {
		return PQCommittedAccountProofView{}, err
	}
	b, err := p.seal.current.OwnerPolicy()
	if err != nil {
		return PQCommittedAccountProofView{}, err
	}
	cp, err := p.seal.proof.Checkpoint()
	if err != nil {
		return PQCommittedAccountProofView{}, err
	}
	current, err := p.seal.current.Checkpoint()
	if err != nil {
		return PQCommittedAccountProofView{}, err
	}
	return PQCommittedAccountProofView{Proof: cp, HistoricalAccount: a, CurrentCheckpoint: current, CurrentAccount: b, BlockOriginal: bytes.Clone(p.seal.block), SuccessorOriginal: bytes.Clone(p.seal.successor)}, nil
}

// OpenPQCommittedAccountReader captures present H from the actual owning engine.
// No caller H/hash/policy/current/Root bool can choose this checkpoint. After a
// nonnil partial is returned, adopt it before interpreting err, then Close it.
// NotReady from later Read means H+1 has not actually committed: retain this
// SAME capture and original context; no automatic retry/re-capture/renewal.
func OpenPQCommittedAccountReader(parent context.Context, app *Application, owner string) (r *PQCommittedAccountReader, err error) {
	if parent == nil || app == nil || !accountaddress.IsCanonical(owner) {
		return nil, errors.New("original context, engine and canonical account required")
	}
	s, err := app.WalletPolicyLiveSource()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	c := &pqCommittedAccountReader{source: s, ctx: ctx, cancel: cancel}
	r = &PQCommittedAccountReader{core: c}
	if err = c.begin(); err != nil {
		c.fail(err)
		return r, err
	}
	defer func() {
		if recover() != nil {
			err = errors.New("original account capture failed while reading engine stores")
		}
		c.finish(err)
	}()
	c.captured, c.policy, err = c.capture(owner)
	return r, err
}

func (c *pqCommittedAccountReader) unavailable() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.firstCause != nil {
		return c.firstCause
	}
	if c.retired {
		return ErrPQCommittedAccountRetired
	}
	return c.ctx.Err()
}
func (c *pqCommittedAccountReader) begin() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.firstCause != nil {
		return c.firstCause
	}
	if c.retired {
		return ErrPQCommittedAccountRetired
	}
	if err := c.ctx.Err(); err != nil {
		return err
	}
	if c.reading {
		return ErrPQCommittedAccountBusy
	}
	c.reading = true
	c.wg.Add(1)
	return nil
}
func (c *pqCommittedAccountReader) fail(err error) {
	if err == nil || err == ErrPQCommittedAccountNotReady {
		return
	}
	c.mu.Lock()
	if c.firstCause == nil {
		c.firstCause = err
	}
	c.retired = true
	c.mu.Unlock()
	c.cancel()
}
func (c *pqCommittedAccountReader) finish(err error) {
	c.fail(err)
	c.mu.Lock()
	c.reading = false
	c.wg.Done()
	c.mu.Unlock()
}

// This borrows the SAME original Source's existing debt counter. Node.Close
// retires it then joins the complete store reads AND verification, not just an
// initial policy projection. No second Node consumer, registry or callback is
// installed and no idle Wallet approval pins a store lock/full state snapshot.
func (c *pqCommittedAccountReader) borrow() (func(*error), error) {
	if err := c.unavailable(); err != nil {
		return nil, err
	}
	s, err := c.source.app.WalletPolicyLiveSource()
	if err != nil {
		return nil, err
	}
	if s != c.source {
		return nil, ErrPQCommittedAccountRetired
	}
	if err = s.begin(); err != nil {
		return nil, err
	}
	return func(result *error) {
		s.mu.Lock()
		if s.retired {
			*result = errors.Join(*result, ErrPQWalletPolicyLiveRetired)
		}
		if canceled := c.ctx.Err(); canceled != nil {
			*result = errors.Join(*result, canceled)
		}
		s.reading = false
		s.mu.Unlock()
		s.wg.Done()
	}, nil
}

func (c *pqCommittedAccountReader) checkpoint(owner string) (actual sm.State, policy *PQWalletPolicyAtCheckpoint, err error) {
	if err = c.ctx.Err(); err != nil {
		return
	}
	actual, err = c.source.view.LoadCommittedState()
	if err != nil {
		return
	}
	if actual.LastBlockHeight <= 0 || actual.LastBlockHeight > math.MaxInt64-2 || len(actual.AppHash) != 32 || actual.LastBlockID.IsZero() {
		return sm.State{}, nil, errors.New("complete initialized original committed checkpoint required")
	}
	if _, err = sm.BindConsensusStateFromSource(actual, c.source.app); err != nil {
		return sm.State{}, nil, err
	}
	a := c.source.app
	a.mu.RLock()
	cp, e := c.source.checkpointLocked(actual)
	if e == nil {
		policy, e = pqWalletPolicyProjection(a.committed, a.migration, owner, cp, PQWalletPolicyLocalEngineCheckpoint)
	}
	a.mu.RUnlock()
	if e != nil {
		return sm.State{}, nil, e
	}
	if err = c.ctx.Err(); err != nil {
		return sm.State{}, nil, err
	}
	return actual, policy, nil
}
func (c *pqCommittedAccountReader) unchanged(before sm.State) error {
	after, err := c.source.view.LoadCommittedState()
	if err != nil {
		return err
	}
	if !before.Equals(after) {
		return node.ErrProofSourceCheckpointCrossing
	}
	a := c.source.app
	a.mu.RLock()
	_, err = c.source.checkpointLocked(after)
	a.mu.RUnlock()
	if err != nil {
		return err
	}
	return c.ctx.Err()
}
func (c *pqCommittedAccountReader) capture(owner string) (actual sm.State, policy *PQWalletPolicyAtCheckpoint, err error) {
	release, err := c.borrow()
	if err != nil {
		return sm.State{}, nil, err
	}
	defer func() {
		release(&err)
		if err != nil {
			actual = sm.State{}
			policy = nil
		}
	}()
	actual, policy, err = c.checkpoint(owner)
	if err != nil {
		return
	}
	err = c.unchanged(actual)
	return
}

func (r *PQCommittedAccountReader) Read() (out *PQCommittedAccountProof, err error) {
	if r == nil || r.core == nil {
		return nil, ErrPQCommittedAccountRetired
	}
	c := r.core
	if err = c.begin(); err != nil {
		return nil, err
	}
	defer func() {
		if recover() != nil {
			err = errors.New("original account proof failed while reading engine stores")
		}
		c.finish(err)
		if err != nil {
			out = nil
		}
	}()
	release, err := c.borrow()
	if err != nil {
		return nil, err
	}
	defer release(&err)
	historical, err := c.policy.OwnerPolicy()
	if err != nil {
		return nil, err
	}
	current, currentPolicy, err := c.checkpoint(historical.Owner)
	if err != nil {
		return nil, err
	}
	if current.ChainID != c.captured.ChainID || current.LastBlockHeight < c.captured.LastBlockHeight {
		return nil, errors.New("original engine chain changed or rolled back")
	}
	if current.LastBlockHeight == c.captured.LastBlockHeight {
		if !current.Equals(c.captured) {
			return nil, errors.New("same-height original engine checkpoint conflict")
		}
		if err = c.unchanged(current); err != nil {
			return nil, err
		}
		return nil, ErrPQCommittedAccountNotReady
	}
	snapshot, err := c.source.app.CommittedPQEngineSnapshot()
	if err != nil {
		return nil, err
	}
	policy, err := snapshot.Policy()
	if err != nil {
		return nil, err
	}
	if c.captured.LastBlockHeight < policy.ActivationHeight {
		return nil, errors.New("account proof requires activated dual-PQ consensus at H and H+1")
	}
	ledger := proofHostLedger{load: c.source.view.LoadCommittedState, validators: c.source.view.LoadValidators, results: c.source.view.LoadFinalizeBlockResponse, blocks: c.source.view}
	// Original continuation verifies BOTH signed headers, runtime parameters,
	// complete full-key authority and exact H+1 AppHash/LastBlockID/LastCommitHash.
	if err = proofHostCheckpointContinuation(ledger, snapshot, c.captured, current, true); err != nil {
		return nil, err
	}
	block, err := ledger.lightBlock(c.captured.LastBlockHeight)
	if err != nil {
		return nil, err
	}
	next, err := ledger.lightBlock(c.captured.LastBlockHeight + 1)
	if err != nil {
		return nil, err
	}
	// Recheck the exact detached evidence which will be encoded: replacement
	// between continuation and encoding must never yield unchecked bytes.
	if err = pqCommittedAccountEvidence(snapshot, c.captured, current, block, next); err != nil {
		return nil, err
	}
	braw, err := cmtjson.Marshal(block)
	if err != nil {
		return nil, err
	}
	nraw, err := cmtjson.Marshal(next)
	if err != nil {
		return nil, err
	}
	if len(braw) == 0 || len(nraw) == 0 || len(braw) > MaxPQTrustedLightBlockBytes || len(nraw) > MaxPQTrustedLightBlockBytes {
		return nil, errors.New("original bounded committed proof unavailable")
	}
	if err = c.unchanged(current); err != nil {
		return nil, err
	}
	return &PQCommittedAccountProof{seal: &pqCommittedAccountProofSeal{origin: c, proof: c.policy, current: currentPolicy, block: braw, successor: nraw}}, nil
}

// Current supplies a freshly checked proof plus separate current owner facts.
// It does not collapse them into a Native-ready/authorized bool or silently
// refresh capture H, nonce, revision or the caller's original time window.
func (r *PQCommittedAccountReader) Current() (*PQCommittedAccountProof, error) { return r.Read() }
func (r *PQCommittedAccountReader) Retire() error {
	if r == nil || r.core == nil {
		return ErrPQCommittedAccountRetired
	}
	c := r.core
	c.mu.Lock()
	c.retired = true
	err := c.firstCause
	c.mu.Unlock()
	c.cancel()
	return err
}

// Join requires permanent retirement before waiting: no later read may add
// debt concurrently with this physical drain. It does not select Close.
func (r *PQCommittedAccountReader) Join() error {
	if r == nil || r.core == nil {
		return ErrPQCommittedAccountRetired
	}
	c := r.core
	c.mu.Lock()
	retired := c.retired
	c.mu.Unlock()
	if !retired {
		return errors.New("retire original account reader before join")
	}
	c.wg.Wait()
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.firstCause
}
func (r *PQCommittedAccountReader) Close() error {
	if r == nil || r.core == nil {
		return ErrPQCommittedAccountRetired
	}
	_ = r.Retire()
	err := r.Join()
	r.core.mu.Lock()
	r.core.closed = true
	r.core.mu.Unlock()
	return err
}

// IsClosed is distinct from retired/idle. Only completed Close selects it;
// returning a sticky first failure does not conceal completed physical drain.
func (r *PQCommittedAccountReader) IsClosed() bool {
	if r == nil || r.core == nil {
		return false
	}
	r.core.mu.Lock()
	defer r.core.mu.Unlock()
	return r.core.closed && r.core.retired && !r.core.reading
}
func (r *PQCommittedAccountReader) Drained() bool {
	if r == nil || r.core == nil {
		return false
	}
	r.core.mu.Lock()
	defer r.core.mu.Unlock()
	return r.core.retired && !r.core.reading
}

// Fixed private evidence check reused by this account reader only. It is not a
// caller-selected provider, policy decoder, generic public proof constructor or
// alternate validator. Every branch uses the original engine registry/math.
func pqCommittedAccountEvidence(snapshot *PQEngineSnapshot, captured, current sm.State, block, next *cmttypes.LightBlock) error {
	// Bind these exact detached evidence objects too, so store replacement
	// between continuation and encoding cannot substitute an unchecked commit.
	bound, err := light.BindLightBlock(snapshot, block)
	if err != nil {
		return err
	}
	if err = bound.ValidatorSet.VerifyCommit(current.ChainID, bound.Commit.BlockID, bound.Height, bound.Commit); err != nil {
		return err
	}
	boundNext, err := light.BindLightBlock(snapshot, next)
	if err != nil {
		return err
	}
	if err = boundNext.ValidatorSet.VerifyCommit(current.ChainID, boundNext.Commit.BlockID, boundNext.Height, boundNext.Commit); err != nil {
		return err
	}
	if bound.Height != captured.LastBlockHeight || boundNext.Height != captured.LastBlockHeight+1 {
		return errors.New("original signed evidence height differs")
	}
	for _, b := range []*cmttypes.LightBlock{bound, boundNext} {
		params, e := snapshot.ParamsAt(b.Height)
		if e != nil || params.Version.App != b.Version.App {
			return errors.New("original signed evidence runtime differs")
		}
	}
	if !bound.Commit.BlockID.Equals(captured.LastBlockID) || !bytes.Equal(bound.Hash(), captured.LastBlockID.Hash) || !boundNext.LastBlockID.Equals(captured.LastBlockID) || !bytes.Equal(boundNext.LastCommitHash, bound.Commit.Hash()) || !bytes.Equal(boundNext.AppHash, captured.AppHash) {
		return errors.New("original signed evidence changed during proof read")
	}

	return nil
}
