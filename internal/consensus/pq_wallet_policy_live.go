package consensus

import (
	"bytes"
	"context"
	"errors"
	"math"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/cometbft/cometbft/node"
	sm "github.com/cometbft/cometbft/state"
)

var ErrPQWalletPolicyLiveRetired = errors.New("owning Wallet policy source is unavailable or retired")
var ErrPQWalletPolicyLiveBusy = errors.New("owning Wallet policy read is already in flight")

// This sealed private child interface has implementations only for the two
// original proof controls (in the Unix companion). There is no public callback
// registrar, replaceable provider, arbitrary reader or second Node lease.
type pqWalletPolicyProofChild interface {
	closeWalletPolicyProofChild() error
}

// Only the fixed private Current4 DATA worker implements this second child.
// It coexists with the original proof child and has no public registrar.
type pqWalletPolicyCurrent4Child interface {
	closeWalletPolicyCurrent4Child() error
}

// The account-purpose worker group is private lifecycle accounting. Source
// retirement cancels every admitted channel before joining outside the lock.
// Only actual worker/reader completion removes an entry; no owner/engine lookup.
type pqWalletPolicyAccountProofChild interface {
	retireWalletPolicyAccountProofChild()
	closeWalletPolicyAccountProofChild() error
}

// PQWalletPolicyLiveSource reads the actual constructor-paired Node and local
// Application. No caller can construct, decode or retarget it. It retains no
// signer, policy cache or file loan. The fixed private Current4 child may own
// one framing worker; Read itself creates none. One synchronous read may be in
// flight; concurrent callers receive Busy.
//
// "Live" distinguishes owning-process reads from opening stopped files, not
// Native CURRENT or independent client finality. A source is usable after
// normal Node construction and until retirement, including before Node.Start.
// Every result is LocalEngineCheckpoint DATA, qualified at that instant only.
// Auth must still hold the original Source/current/decision/principal lifetime.
type PQWalletPolicyLiveSource struct {
	node *node.Node
	app  *Application
	view *node.ProofSourceView

	mu           sync.Mutex
	retired      bool
	reading      bool
	child        pqWalletPolicyProofChild
	current4     pqWalletPolicyCurrent4Child
	accountProof map[pqWalletPolicyAccountProofChild]struct{}
	wg           sync.WaitGroup
	close        sync.Once
	err          error
}

// Called ONLY by newPQNodeWithDatabase after constructing the actual local
// ABCI client and authority with this same app. The binding never moves to a
// new Node, even after retirement; cold restart constructs a new Application.
func bindPQWalletPolicyLiveSource(n *node.Node, a *Application) error {
	if n == nil || a == nil {
		return ErrPQWalletPolicyLiveRetired
	}
	view, err := n.ProofSourceView()
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pqWalletPolicyLive != nil || a.bootstrap == nil {
		return errors.New("application already has an original Node binding or has no independent bootstrap")
	}
	s := &PQWalletPolicyLiveSource{node: n, app: a, view: view}
	if err := n.RegisterProofSourceConsumer(s.Close); err != nil {
		return err
	}
	a.pqWalletPolicyLive = s
	return nil
}

// WalletPolicyLiveSource is the protected backend's normal in-process getter.
// Only the normal Node constructor installs this instance. A zero, file-only,
// copied or unpaired app cannot choose another Node by supplying pointers.
func (a *Application) WalletPolicyLiveSource() (*PQWalletPolicyLiveSource, error) {
	if a == nil {
		return nil, ErrPQWalletPolicyLiveRetired
	}
	a.mu.RLock()
	s := a.pqWalletPolicyLive
	a.mu.RUnlock()
	if s == nil {
		return nil, ErrPQWalletPolicyLiveRetired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.app != a || s.retired || s.node == nil || s.view == nil {
		return nil, ErrPQWalletPolicyLiveRetired
	}
	return s, nil
}

func (s *PQWalletPolicyLiveSource) begin() error {
	if s == nil {
		return ErrPQWalletPolicyLiveRetired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired || s.node == nil || s.app == nil || s.view == nil {
		return ErrPQWalletPolicyLiveRetired
	}
	if s.reading {
		return ErrPQWalletPolicyLiveBusy
	}
	s.reading = true
	s.wg.Add(1)
	return nil
}

// Close is permanent and idempotent. Node invokes it before closing any store,
// including failed Start. Retire first; cancel/join the fixed Current4 child,
// join the original proof child and every admitted wallet read before returning.
// Never wait for Node.Quit/Node.Stop.
func (s *PQWalletPolicyLiveSource) Close() error {
	if s == nil {
		return ErrPQWalletPolicyLiveRetired
	}
	s.close.Do(func() {
		s.mu.Lock()
		s.retired = true
		child := s.child
		current4 := s.current4
		accountProof := make([]pqWalletPolicyAccountProofChild, 0, len(s.accountProof))
		for c := range s.accountProof {
			accountProof = append(accountProof, c)
		}
		s.mu.Unlock()
		var err error
		for _, c := range accountProof {
			c.retireWalletPolicyAccountProofChild()
		}
		for _, c := range accountProof {
			err = errors.Join(err, c.closeWalletPolicyAccountProofChild())
		}
		if current4 != nil {
			err = errors.Join(err, current4.closeWalletPolicyCurrent4Child())
		}
		if child != nil {
			err = errors.Join(err, child.closeWalletPolicyProofChild())
		}
		s.wg.Wait()
		s.mu.Lock()
		s.err = err
		s.mu.Unlock()
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
}

// Read takes only a canonical owner and the owning caller's cancellation. H,
// chain, AppHash and the full membership come from the ORIGINAL Node stores.
// There is no caller checkpoint/JSON/current bool. A crossing checkpoint is an
// error with no result or automatic retry. Pending Finalize state is never used.
func (s *PQWalletPolicyLiveSource) Read(ctx context.Context, owner string) (out *PQWalletPolicyAtCheckpoint, err error) {
	if ctx == nil || !accountaddress.IsCanonical(owner) {
		return nil, errors.New("Wallet policy live read requires a context and canonical original owner")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = s.begin(); err != nil {
		return nil, err
	}
	defer func() {
		cancelErr := ctx.Err()
		s.mu.Lock()
		if s.retired {
			err = errors.Join(err, ErrPQWalletPolicyLiveRetired)
		}
		err = errors.Join(err, cancelErr)
		if err != nil {
			out = nil
		}
		s.reading = false
		s.mu.Unlock()
		s.wg.Done()
	}()
	before, err := s.view.LoadState()
	if err != nil {
		return nil, err
	}
	if before.LastBlockHeight <= 0 || before.LastBlockHeight > math.MaxInt64-2 || len(before.AppHash) != 32 || before.LastBlockID.IsZero() {
		return nil, errors.New("original Node has no initialized complete Wallet checkpoint")
	}
	// Full current registry replay and original current/next/last validator and
	// params binding. Reuse the actual engine implementation, not an RPC set.
	if _, err = sm.BindConsensusStateFromSource(before, s.app); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	s.app.mu.RLock()
	cp, err := s.checkpointLocked(before)
	if err == nil {
		out, err = pqWalletPolicyProjection(s.app.committed, s.app.migration, owner, cp, PQWalletPolicyLocalEngineCheckpoint)
	}
	s.app.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	// Never call the wrapped engine store while holding app.mu: its authority
	// loader can acquire the Application read lock on a cache miss.
	after, err := s.view.LoadState()
	if err != nil {
		return nil, err
	}
	if !before.Equals(after) {
		return nil, node.ErrProofSourceCheckpointCrossing
	}
	// App.Commit precedes Store.Save. The second engine read alone could still
	// see H while the app has committed H+1, so check the owning app again.
	s.app.mu.RLock()
	_, err = s.checkpointLocked(after)
	s.app.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *PQWalletPolicyLiveSource) checkpointLocked(actual sm.State) (PQWalletPolicyCheckpoint, error) {
	a := s.app
	if a.pqWalletPolicyLive != s {
		return PQWalletPolicyCheckpoint{}, ErrPQWalletPolicyLiveRetired
	}
	hash, err := a.committedSourceCheckpointLocked(actual.ChainID, actual.LastBlockHeight, actual.AppHash)
	if err != nil {
		return PQWalletPolicyCheckpoint{}, err
	}
	if _, err := a.runtimeApplicationVersionLocked(); err != nil {
		return PQWalletPolicyCheckpoint{}, err
	}
	p := a.persistenceViewLocked()
	if err := ValidateApplicationPersistenceView(p); err != nil || !p.Persistence || p.StateHeight != actual.LastBlockHeight || !bytes.Equal(actual.AppHash, hash[:]) {
		return PQWalletPolicyCheckpoint{}, errors.New("Wallet policy source has no current confirmed original persistence")
	}
	return PQWalletPolicyCheckpoint{ChainID: actual.ChainID, Height: actual.LastBlockHeight, AppHash: hash}, nil
}
