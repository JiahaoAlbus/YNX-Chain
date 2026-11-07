//go:build linux || darwin

// Private Core CAS source: install into internal/consensus as .go, same package.
// The actual normal Node/App is constructed and bound ONCE by its owner with
// bindPQObserverAccountHost. This adapter attaches only a new original scope.
package consensus

import "errors"

// Called only after the SAME original v3 capture and genuine Source BIND.
// Each context and endpoint is consumed once. This function cannot construct,
// start, stop, replace or resume a Node/App and offers no public Source setter.
// A nonnil launch is returned before its paired error: retain that same scope
// and drain its partial wire with launch.close, never retry/recapture it.
func (p *pqProtectedSourceParent) attachOriginalAccountScope(host *pqObserverAccountHost, original *pqOriginalSourceLaunch) (*pqObserverAccountLaunch, error) {
	if p == nil || original == nil {
		return nil, errSourceParent
	}
	p.mu.Lock()
	// Couple the Source ctx to its actual private captured owner, not equal DATA.
	// The clock helper alone and a different original launch cannot mint a scope.
	if p.original != original || p.conn != original.sourceConn || p.selection.generation != original.generation || p.consumed || p.terminal {
		first := p.first
		p.mu.Unlock()
		return nil, errors.Join(errSourceParent, first)
	}
	p.consumed = true
	p.mu.Unlock()
	if err := original.checkControl(p.process); err != nil {
		return nil, err
	}
	original.mu.Lock()
	if original.accountConsumed || original.accountFile == nil {
		original.mu.Unlock()
		return nil, errSourceParent
	}
	original.accountConsumed = true
	endpoint := original.accountFile
	original.accountFile = nil
	original.mu.Unlock()
	selection := p.selection
	launch := &pqObserverAccountLaunch{original: &pqObserverAccountLaunchState{ctx: p, canonicalOwner: selection.canonicalOwner, chainID: selection.chainID, minimumHeight: selection.minimumHeight, endpoint: endpoint}}
	fail := func(cause error) (*pqObserverAccountLaunch, error) {
		launch.original.mu.Lock()
		if launch.original.firstCause == nil {
			launch.original.firstCause = cause
		}
		launch.original.mu.Unlock()
		return launch, errors.Join(cause, launch.close())
	}
	if err := checkSourceSocket(original.account, original.processes[0], original.processes[2]); err != nil {
		return fail(err)
	}
	uid, pid, err := sourceKernelPeer(original.account.fd)
	if err != nil {
		return fail(err)
	}
	launch.original.peer = pqAccountWirePeer{uid: uid, pid: pid}
	if err = original.checkControl(p.process); err != nil {
		return fail(err)
	}
	if err = host.attach(launch); err != nil {
		return launch, err
	}
	return launch, nil
}
