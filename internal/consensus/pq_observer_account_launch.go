//go:build linux || darwin

package consensus

import (
	"context"
	"errors"
	"os"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
)

var errPQObserverAccountLaunch = errors.New("original observer account launch is unavailable or already consumed")

// pqObserverAccountLaunch is the private owning-host callpoint, not a new
// authority constructor. Its inputs must be supplied by the original protected
// host: canonicalOwner/chain/minimumHeight from readOriginalEngineSelection,
// the SAME unextended Source context, and the independent account-purpose
// endpoint/peer from the original P09 launch. The P09 launch capsule itself
// contains no account selection and cannot construct this value.
//
// No public constructor, callback registration, FD setter, CLI flag, JSON or
// engine-reference resolver is provided. In particular this type does not
// implement the outstanding Native OriginalEngineSource acquisition bridge.
// Copying this private handle shares its one-use/debt state.
type pqObserverAccountLaunch struct{ original *pqObserverAccountLaunchState }

type pqObserverAccountLaunchState struct {
	mu             sync.Mutex
	ctx            context.Context
	canonicalOwner string
	chainID        string
	minimumHeight  uint64
	endpoint       *os.File
	peer           pqAccountWirePeer
	consumed       bool
	closed         bool
	firstCause     error
	cleanupError   error
	wire           *pqCommittedAccountWire
}

// newPQObserverNodeWithAccountLaunch shares the complete normal observer
// constructor; it neither constructs an alternative Application nor starts a
// Node. The account worker is attached only after the actual Node/App pair has
// acquired its original single proof-source consumer, and before Start.
//
// A valid original private launch transfers its endpoint on entry, including
// failed application/Node construction. Every partial wire is retained before
// interpreting its error. Once consumed, this launch cannot be retried against
// another App/Node, including after UNKNOWN or a cold restart.
func newPQObserverNodeWithAccountLaunch(config *cfg.Config, app *Application, nodeKey *p2p.NodeKey, logger log.Logger, launch *pqObserverAccountLaunch) (*node.Node, error) {
	if launch == nil || launch.original == nil {
		return nil, errPQObserverAccountLaunch
	}
	s := launch.original
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.consumed || s.closed {
		return nil, errors.Join(errPQObserverAccountLaunch, s.firstCause, s.cleanupError)
	}
	s.consumed = true
	fail := func(cause error) (*node.Node, error) {
		if s.firstCause == nil {
			s.firstCause = cause
		}
		return nil, s.closeLocked()
	}
	if s.ctx == nil || s.endpoint == nil || app == nil || !accountaddress.IsCanonical(s.canonicalOwner) || s.chainID == "" || s.minimumHeight == 0 || s.peer.pid <= 0 {
		return fail(errPQObserverAccountLaunch)
	}
	// A missing Source deadline cannot be replaced by a fresh timeout here.
	if _, bounded := s.ctx.Deadline(); !bounded {
		return fail(errPQObserverAccountLaunch)
	}
	if err := s.ctx.Err(); err != nil {
		return fail(err)
	}
	app.mu.RLock()
	matched := app.bootstrap != nil && app.bootstrap.record.ChainID == s.chainID && app.committed.Initialized && app.committed.Height >= 0 && uint64(app.committed.Height) >= s.minimumHeight
	app.mu.RUnlock()
	if !matched {
		return fail(errPQObserverAccountLaunch)
	}
	// Check the actual inherited socket before opening engine databases. Image,
	// Source and account qualifications remain the original host's obligations.
	if err := pqCurrent4CheckEndpoint(s.endpoint, pqCurrent4Peer{uid: s.peer.uid, pid: s.peer.pid}); err != nil {
		return fail(err)
	}
	n, err := NewPQObserverNode(config, app, nodeKey, logger)
	if err != nil {
		return fail(err)
	}
	w, err := attachPQCommittedAccountWire(s.ctx, app, s.canonicalOwner, s.endpoint, s.peer)
	if w != nil {
		s.wire = w       // adopt partial before inspecting err
		s.endpoint = nil // attach has assumed the original descriptor's ownership
	}
	if err == nil {
		err = s.ctx.Err() // original deadline/cancellation still applies after setup
	}
	if err != nil {
		// Node owns proxy/store teardown exactly once. Its original consumer
		// retires/joins the account child before any engine database closes.
		n.OnStop()
		return fail(err)
	}
	return n, nil
}

// close is for the SAME original parent teardown/failed-start path. It drains
// the actual account worker, including a late partial and all reader debt. It
// does not Stop/Wait the Node, acknowledge a remote close, or release Native
// Source resources. The original Node owner retains its sole lifecycle calls.
func (l *pqObserverAccountLaunch) close() error {
	if l == nil || l.original == nil {
		return errPQObserverAccountLaunch
	}
	s := l.original
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closeLocked()
}

func (s *pqObserverAccountLaunchState) closeLocked() error {
	if !s.closed {
		s.closed = true
		var err error
		if s.wire != nil {
			err = s.wire.closeWalletPolicyAccountProofChild()
		}
		if s.endpoint != nil {
			err = errors.Join(err, s.endpoint.Close())
			s.endpoint = nil
		}
		s.cleanupError = err
	}
	return errors.Join(s.firstCause, s.cleanupError)
}
