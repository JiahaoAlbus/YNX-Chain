//go:build linux || darwin

package consensus

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/cometbft/cometbft/node"
)

// pqObserverAccountHost is the stable original observer identity, not one
// Source scope. It never creates/reopens/starts/stops a Node, opens a database,
// accepts an engineReference, or registers a second proof-source consumer.
// Each scope still supplies its own original once launch and unchanged context.
// There is no public constructor, callback/FD setter, or Root/Source grant.
type pqObserverAccountHost struct {
	node   *node.Node
	app    *Application
	source *PQWalletPolicyLiveSource
}

// bindPQObserverAccountHost is called privately by the normal owning host ONCE
// after NewPQObserverNode has paired its actual App and Node. No account or
// minimum height is selected here: a new observer may still be synchronizing.
// The returned identity is immutable; a cold replacement requires a new host.
// It holds no extra Node slot, worker, store lease, or pending account channel.
func bindPQObserverAccountHost(n *node.Node, app *Application) (*pqObserverAccountHost, error) {
	if n == nil || app == nil || n.PrivValidator() != nil {
		return nil, errPQObserverAccountLaunch
	}
	s, err := app.WalletPolicyLiveSource()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	valid := !s.retired && s.node == n && s.app == app && s.view != nil
	s.mu.Unlock()
	if !valid {
		return nil, ErrPQWalletPolicyLiveRetired
	}
	return &pqObserverAccountHost{node: n, app: app, source: s}, nil
}

func (h *pqObserverAccountHost) sameOriginal() error {
	if h == nil || h.node == nil || h.app == nil || h.source == nil {
		return errPQObserverAccountLaunch
	}
	s, err := h.app.WalletPolicyLiveSource()
	if err != nil {
		return err
	}
	if s != h.source {
		return ErrPQWalletPolicyLiveRetired
	}
	s.mu.Lock()
	valid := !s.retired && s.node == h.node && s.app == h.app && s.view != nil
	s.mu.Unlock()
	if !valid {
		return ErrPQWalletPolicyLiveRetired
	}
	return nil
}

// attach is the per-genuine-Source private callpoint. It adopts only this new
// once launch, not the observer itself. A minimum-height refusal does not wait,
// recapture, renew the context, or affect any other channel or committed state.
// A later independently acquired scope can attach to this SAME advancing Node.
// Existing admitted channels/tombstones use the original two-channel capacity.
func (h *pqObserverAccountHost) attach(launch *pqObserverAccountLaunch) error {
	if launch == nil || launch.original == nil {
		return errPQObserverAccountLaunch
	}
	s := launch.original
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.consumed || s.closed {
		return errors.Join(errPQObserverAccountLaunch, s.firstCause, s.cleanupError)
	}
	s.consumed = true
	fail := func(err error) error {
		if s.firstCause == nil {
			s.firstCause = err
		}
		return s.closeLocked()
	}
	if s.ctx == nil || s.endpoint == nil || !accountaddress.IsCanonical(s.canonicalOwner) || s.chainID == "" || s.minimumHeight == 0 || s.peer.pid <= 0 {
		return fail(errPQObserverAccountLaunch)
	}
	if _, bounded := s.ctx.Deadline(); !bounded {
		return fail(errPQObserverAccountLaunch)
	}
	if err := s.ctx.Err(); err != nil {
		return fail(err)
	}
	if err := h.sameOriginal(); err != nil {
		return fail(err)
	}
	if err := pqCurrent4CheckEndpoint(s.endpoint, pqCurrent4Peer{uid: s.peer.uid, pid: s.peer.pid}); err != nil {
		return fail(err)
	}
	// Reuse the original committed-checkpoint reader for admission. It verifies
	// actual engine/App equality, full authority/policy and both crossing fences
	// under the SAME source debt counter. This temporary admission check is
	// closed before wire OPEN: it is neither a proof nor that operation's capture.
	// The wire's original empty OPEN retains its own single, later capture.
	checked, err := OpenPQCommittedAccountReader(s.ctx, h.app, s.canonicalOwner)
	if err == nil {
		actual := checked.core.captured
		if checked.core.source != h.source || actual.ChainID != s.chainID || actual.LastBlockHeight < 0 || uint64(actual.LastBlockHeight) < s.minimumHeight {
			err = errPQObserverAccountLaunch
		}
	}
	if checked != nil {
		err = errors.Join(err, checked.Close()) // adopt every partial before err
	}
	if err != nil {
		return fail(err)
	}
	if err = h.sameOriginal(); err != nil {
		return fail(err)
	}
	w, err := attachPQCommittedAccountWire(s.ctx, h.app, s.canonicalOwner, s.endpoint, s.peer)
	if w != nil {
		s.wire = w
		s.endpoint = nil
	}
	if err == nil {
		err = s.ctx.Err()
	}
	if err == nil {
		err = h.sameOriginal()
	}
	if err != nil {
		return fail(err) // closes THIS partial only; never Stop the shared Node
	}
	return nil
}
