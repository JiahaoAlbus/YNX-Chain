//go:build linux || darwin

package consensus

import (
	"context"
	"encoding/hex"
	"errors"
	"os"
	"sync"

	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
)

var errPQSourceInheritedCustodyPending = errors.New("unqualified inherited Source launch was not adopted; original process owner must reconcile transport closure")

var ErrPQOriginalSourceNativeBridgeUnavailable = errors.New("original Auth SourceParent native bridge unavailable: Cgo is disabled")

var ErrPQOriginalSourceProfileNotSupplied = errors.New("original independently qualified Source startup image profile not supplied")

// ErrPQOriginalSourceClosePending means the one close attempt returned without
// proving physical completion. The original owner is retained, not retried.
var ErrPQOriginalSourceClosePending = errors.New("original Source profile close returned UNKNOWN; the same owner remains pending")

// PQObserverSourceStartup owns only the optional original Source/channel scope.
// It never owns Node.Start/Stop/Wait, and a Source failure does not cancel the
// actual observer process context. It is opaque: no profile/FD/Source setter.
type PQObserverSourceStartup struct {
	codeProfile          *pqSourceCodeProfile
	codeClosed           chan struct{}
	codeCloseReturned    chan struct{}
	mu                   sync.Mutex
	process              context.Context
	captureRead          context.Context
	cancel               context.CancelFunc
	host                 *pqObserverAccountHost
	original             *pqOriginalSourceLaunch
	source               *pqProtectedSourceParent
	scope                *pqObserverAccountLaunch
	first, cleanup       error
	unclaimedInherited   bool
	stop, ready, done    chan struct{}
	closeOnce, readyOnce sync.Once
}

// NewPQObserverNodeWithOriginalSourceStartup is the normal once constructor.
// The real signal/process context must exist BEFORE entering this function.
// It builds the original Node/App once, then binds the supplied stable host.
// The optional Source receive runs independently; Node.Start must not wait for
// Ready, a Source acquisition, minimum height, or an account proof.
func NewPQObserverNodeWithOriginalSourceStartup(process context.Context, config *cfg.Config, app *Application, key *p2p.NodeKey, logger log.Logger) (*node.Node, *PQObserverSourceStartup, error) {
	if process == nil {
		return nil, nil, errSourceParent
	}
	if err := process.Err(); err != nil {
		return nil, nil, err
	}
	n, err := NewPQObserverNode(config, app, key, logger)
	if err != nil {
		return nil, nil, err
	}
	startup := originalObserverSourceStartupState(process, n, app)
	// The fixed Auth factory performs physical I/O. It belongs to the optional
	// worker, so even an admitted large profile cannot hold Node.Start hostage.
	go func() {
		profile, profileErr := originalPQObserverSourceBuildProfile()
		startup.mu.Lock()
		startup.codeProfile = profile.codeProfile // adopt before inspecting error
		startup.mu.Unlock()
		startup.run(profile, profileErr)
	}()
	// Every optional bind/profile/capture/Source error remains on startup. It is
	// not a failure to construct the ordinary observer and never stops this Node.
	return n, startup, nil
}

// This is a fixed Core build-entry DATA dependency, not stdin expected hashes
// or a public provider. Auth holds the independent reviewed postbuild original
// and actual code images. Never derive expected pins from the received capsule
// or observe a hash and call that trust. This code-only loan is ANDed with the
// unchanged actual sealed SourceBIND/current context; it never creates Source.
func originalPQObserverSourceBuildProfile() (pqOriginalSourceProfile, error) {
	owner, err := acquirePQOriginalSourceCodeProfile()
	profile := pqOriginalSourceProfile{codeProfile: owner} // adopt nonnil before error
	if err != nil {
		return profile, err
	}
	images, err := owner.ReadOriginalImagesDATA()
	if err != nil {
		return profile, err
	}
	for i := range images {
		profile.images[i] = hex.EncodeToString(images[i][:])
	}
	return profile, owner.Current()
}
func validOriginalSourceProfile(p pqOriginalSourceProfile) bool {
	if p.codeProfile == nil {
		return false
	}
	for _, s := range p.images {
		b, e := hex.DecodeString(s)
		if e != nil || len(b) != 32 || hex.EncodeToString(b) != s {
			return false
		}
	}
	return true
}
func originalObserverSourceStartupState(process context.Context, n *node.Node, app *Application) *PQObserverSourceStartup {
	readCtx, cancel := context.WithCancel(process)
	s := &PQObserverSourceStartup{codeClosed: make(chan struct{}), codeCloseReturned: make(chan struct{}), process: process, captureRead: readCtx, cancel: cancel, stop: make(chan struct{}), ready: make(chan struct{}), done: make(chan struct{})}
	var err error
	s.host, err = s.bindNormalHost(n, app, nil)
	s.record(err)
	return s
}

// Private same-package fixture/adoption boundary. No external profile or FD
// can enter the normal constructor through this helper.
func newOriginalObserverSourceStartup(process context.Context, n *node.Node, app *Application, profile pqOriginalSourceProfile, profileErr error) *PQObserverSourceStartup {
	s := originalObserverSourceStartupState(process, n, app)
	s.codeProfile = profile.codeProfile
	if profileErr != nil {
		s.rememberUnclaimedInheritedCustody()
		s.record(profileErr)
		s.readyOnce.Do(func() { close(s.ready) })
		close(s.done)
		return s
	}
	go s.run(profile, nil)
	return s
}

// A failed profile cannot authenticate stdin's claimed descriptor numbers.
// Do not read/close arbitrary numbers or claim an inherited transport drained.
// The normal process owner must reconcile its child after actual process exit.
func (s *PQObserverSourceStartup) rememberUnclaimedInheritedCustody() {
	info, err := os.Stdin.Stat()
	if err == nil && info.Mode()&os.ModeNamedPipe != 0 {
		s.mu.Lock()
		s.unclaimedInherited = true
		s.cleanup = errors.Join(s.cleanup, errPQSourceInheritedCustodyPending)
		s.mu.Unlock()
	}
}

func (s *PQObserverSourceStartup) bindNormalHost(n *node.Node, app *Application, profileErr error) (*pqObserverAccountHost, error) {
	h, e := bindPQObserverAccountHost(n, app)
	return h, errors.Join(e, profileErr)
}
func (s *PQObserverSourceStartup) record(err error) {
	if err == nil {
		return
	}
	s.mu.Lock()
	if s.first == nil {
		s.first = err
	}
	s.mu.Unlock()
}
func (s *PQObserverSourceStartup) run(profile pqOriginalSourceProfile, profileErr error) {
	defer close(s.done)
	if profileErr == nil {
		profileErr = s.SourceFailure()
	}
	if profileErr == nil {
		profileErr = s.captureRead.Err()
	}
	if profileErr == nil && !validOriginalSourceProfile(profile) {
		profileErr = ErrPQOriginalSourceProfileNotSupplied
	}
	if profileErr != nil {
		s.rememberUnclaimedInheritedCustody()
		s.record(profileErr)
		s.readyOnce.Do(func() { close(s.ready) })
		return
	}
	original, err := captureOriginalSourceLaunchWithReadContext(s.process, s.captureRead, profile)
	s.mu.Lock()
	s.original = original
	s.mu.Unlock() // adopt every nonnil partial first
	if err == nil {
		var source *pqProtectedSourceParent
		source, err = receiveOriginalSourceParentWithReadContext(s.process, s.captureRead, original)
		s.mu.Lock()
		s.source = source
		s.mu.Unlock()
		if err == nil {
			err = s.captureRead.Err()
		}
		if err == nil {
			var scope *pqObserverAccountLaunch
			scope, err = source.attachOriginalAccountScope(s.host, original)
			s.mu.Lock()
			s.scope = scope
			s.mu.Unlock() // same partial retained on error
		}
	}
	s.record(err)
	s.readyOnce.Do(func() { close(s.ready) })
	// Scope failure is not a Node shutdown. Retain all original custody until the
	// normal owner explicitly closes it or that actual process context ends.
	s.mu.Lock()
	activeSource := s.source
	s.mu.Unlock()
	var sourceDone <-chan struct{}
	if activeSource != nil {
		sourceDone = activeSource.Done()
	}
	select {
	case <-sourceDone:
		s.record(activeSource.cause())
		select {
		case <-s.stop:
		case <-s.process.Done():
			s.Close()
		}
	case <-s.stop:
	case <-s.process.Done():
		s.Close()
	}
	s.mu.Lock()
	source, scope := s.source, s.scope
	s.mu.Unlock()
	if source != nil {
		source.cancel(context.Canceled, sourceParentFailure{present: false, code: 0, reason: 4})
	} // closes Source control ONLY
	if scope != nil && scope.original != nil {
		scope.original.mu.Lock()
		wire := scope.original.wire
		scope.original.mu.Unlock()
		if wire != nil {
			// Source cancellation retires productive work, never this SDK97 conn.
			// The real Native child must finish same-reader cleanup/close or the actual
			// Node owner must terminate transport. EOF is not a remote CLOSED receipt.
			<-wire.done
		}
	}
	var cleanup error
	if source != nil {
		cleanup = source.closeLocal()
	}
	if scope != nil {
		cleanup = errors.Join(cleanup, scope.close())
	}
	if original != nil {
		cleanup = errors.Join(cleanup, original.closeUnused())
	}
	s.mu.Lock()
	s.cleanup = cleanup
	s.mu.Unlock()
}

// Ready means the one optional startup attempt returned, never proof Ready or
// authorization. It does not wait for an SDK account snapshot.
func (s *PQObserverSourceStartup) Ready() <-chan struct{} { return s.ready }
func (s *PQObserverSourceStartup) SourceFailure() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.first
}

// Close only seals this optional scope and closes the parent control to signal
// negative cancellation. It does not close an attached account conn or stop
// Node, and does not report remote/Native/SDK cleanup complete.
func (s *PQObserverSourceStartup) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		close(s.stop)
		s.cancel() // optional stdin/BIND only; never the actual process
		s.mu.Lock()
		source := s.source
		s.mu.Unlock()
		if source != nil {
			source.cancel(context.Canceled, sourceParentFailure{present: false, code: 0, reason: 4})
		}
		go func() {
			// The factory may still be adopting a partial when Close races it.
			// Read the final held owner only after the exact worker returns.
			<-s.done
			s.mu.Lock()
			profile := s.codeProfile
			s.mu.Unlock()
			drain := pqSourceCodeDrain{physicalDone: true}
			if profile != nil {
				profile.Retire()
				drain = profile.Close()
			}
			s.finishCodeCloseAttempt(drain)
		}()
	})
}

// Called once, only after worker.done and the single profile close attempt.
// Returning UNKNOWN releases Join's wait, not the owner or its physical debt.
func (s *PQObserverSourceStartup) finishCodeCloseAttempt(drain pqSourceCodeDrain) {
	s.mu.Lock()
	s.cleanup = errors.Join(s.cleanup, drain.failure)
	if !drain.physicalDone {
		s.cleanup = errors.Join(s.cleanup, ErrPQOriginalSourceClosePending)
	}
	s.mu.Unlock()
	if drain.physicalDone {
		close(s.codeClosed)
	}
	close(s.codeCloseReturned)
}

// Join waits for the local worker and the one profile close attempt to return.
// A known UNKNOWN result returns explicit pending debt even with Background;
// it never means physical completion and never retries Close. Until that attempt
// returns, caller cancellation can stop waiting without dropping the same owner.
// The business Source first cause is independent of physical teardown.
func (s *PQObserverSourceStartup) Join(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		return errSourceParent
	}
	select {
	case <-s.codeCloseReturned:
		s.mu.Lock()
		defer s.mu.Unlock()
		return errors.Join(s.first, s.cleanup)
	default:
	}
	select {
	case <-s.codeCloseReturned:
		s.mu.Lock()
		defer s.mu.Unlock()
		return errors.Join(s.first, s.cleanup)
	case <-ctx.Done():
		s.mu.Lock()
		defer s.mu.Unlock()
		return errors.Join(ctx.Err(), s.first, s.cleanup)
	}
}

// LocalComplete requires the worker and physical profile close to finish, with
// no unclaimed inherited custody. A returned UNKNOWN attempt is insufficient.
// It never settles a remote Source/Native loan or supplies SDK CLOSED.
func (s *PQObserverSourceStartup) LocalComplete() bool {
	if s == nil {
		return true
	}
	select {
	case <-s.codeClosed:
		s.mu.Lock()
		defer s.mu.Unlock()
		return !s.unclaimedInherited
	default:
		return false
	}
}
