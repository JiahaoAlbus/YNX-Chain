package ownednode

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

func (m *Manager) Start(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval) (resultID string, resultErr error) {
	if ctx == nil {
		return "", ErrConsent
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return "", ErrClosed
	}
	if m.pendingCurrent4 != nil || m.pendingAccount != nil {
		return "", ErrReconcile
	}
	if err := m.peerAllowed(peer); err != nil {
		return "", err
	}
	if !m.fixture {
		return "", ErrOriginalReleaseMissing
	}
	current, err := m.intent(peer, "start", "")
	if err != nil {
		return "", err
	}
	if current != intent {
		return "", ErrConsent
	}
	if m.state.Stage == "reconcile_required" {
		return "", ErrReconcile
	}
	if m.starting != nil || m.process != nil || m.termination != nil || m.state.Stage == "running" || m.state.Stage == "stopping" {
		return "", errors.New("only one owned node process is allowed")
	}
	if m.state.Stage != "installed" && m.state.Stage != "stopped" {
		return "", errors.New("node artifact is not installed")
	}
	arguments, observerSocket, err := m.observerLaunchInputsLocked(ctx)
	if err != nil {
		return "", err
	}
	endpoint, err := m.captureSynchronizationEndpoint(observerSocket)
	if err != nil {
		return "", err
	}
	artifact, _, err := m.artifact()
	if err != nil {
		return "", err
	}
	capacity, err := m.capacity(uint64(len(artifact)) + 1024)
	if err != nil {
		return "", err
	}
	logLimit, err := m.logBudget(uint64(len(artifact)), capacity)
	if err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if err = m.consume(peer, intent, approval); err != nil {
		return "", err
	}
	ctx, cancelStart := context.WithCancel(ctx)
	starting := &nodeStartAttempt{context: ctx, cancel: cancelStart, done: make(chan struct{})}
	m.starting = starting
	var capture *runtimeCapture
	var logs *runLogs
	adopted := false
	defer func() {
		resultErr = m.finishStartAttemptLocked(starting, capture, logs, adopted, resultErr)
	}()
	runID := randomID()
	m.state.Stage = "starting"
	m.state.Generation++
	m.state.RunID = runID
	if err = m.save(); err != nil {
		return "", m.reconcile(err)
	}
	capture, err = m.captureRuntime(artifact, runID)
	if err != nil {
		return "", m.reconcile(err)
	}
	if err = m.runtimeUnchanged(capture); err != nil {
		return "", m.reconcile(err)
	}
	if err = ctx.Err(); err != nil {
		return "", m.reconcile(err)
	}
	logs, err = m.createRunLogs(runID, logLimit)
	if err != nil {
		return "", m.reconcile(err)
	}
	// Only the fixed, original Core observer profile may supply arguments.
	// No request path, shell, arbitrary argv, environment or PID is accepted.
	if m.state.Observer != nil {
		version, probeErr := m.probeObserverVersion(ctx, capture)
		if probeErr != nil {
			return "", m.reconcile(probeErr)
		}
		m.state.Observer.Version = version
		if err = m.save(); err != nil {
			return "", m.reconcile(err)
		}
		if _, err = m.observerArgumentsLocked(ctx); err != nil {
			return "", m.reconcile(err)
		}
	}
	command := exec.Command(capture.path, arguments...)
	command.Dir = filepath.Join(m.directory, "data")
	command.Env = []string{"LC_ALL=C", "LANG=C", "GOMAXPROCS=1"}
	command.WaitDelay = 250 * time.Millisecond
	command.Stdout = logs.stdout
	command.Stderr = logs.stderr
	if err = m.runtimeUnchanged(capture); err == nil {
		err = m.logFilesUnchanged(logs)
	}
	if err != nil {
		return "", m.reconcile(err)
	}
	if err = ctx.Err(); err != nil {
		return "", m.reconcile(err)
	}
	// The manager lock stays held from this fence through Start and adoption.
	// Close cannot retire a session, capture running=nil, then acquire a new child.
	if m.closed {
		return "", m.reconcile(ErrClosed)
	}
	current4Launch, launchErr := m.prepareCurrent4Launch(ctx, command)
	if launchErr != nil {
		return "", m.reconcile(m.retainFailedCurrent4(current4Launch, launchErr))
	}
	// Profile I/O releases the Manager mutex. Recheck the original owner
	// before starting either child after a concurrent Close or cancellation.
	if m.closed {
		// Close may already have released the directory while profile I/O
		// was pending. Do not write a new reconciliation record after release.
		return "", m.retainFailedCurrent4(current4Launch, ErrClosed)
	}
	if err = ctx.Err(); err != nil {
		return "", m.reconcile(m.retainFailedCurrent4(current4Launch, err))
	}
	// From this fence onward an attempted exec may have effects. Cancellation
	// must not turn an uncertain real launch back into a retryable pre-start.
	starting.mainAttempted = true
	if current4Launch != nil {
		launchErr = current4Launch.Start(ctx)
		if launchErr != nil {
			alive, identityErr := current4Launch.ProducerRunning(ctx)
			if !alive || identityErr != nil || ctx.Err() != nil {
				return "", m.reconcile(m.retainFailedCurrent4(current4Launch, errors.Join(launchErr, identityErr)))
			}
			// The ordinary node may keep running when only its resource host
			// fails. Preserve the channel first cause without claiming readiness.
			m.firstCause(launchErr)
		}
	} else if err = command.Start(); err != nil {
		return "", m.reconcile(err)
	}
	m.state.LastPID = command.Process.Pid
	if err = m.runtimeUnchanged(capture); err == nil {
		err = ctx.Err()
	}
	if err == nil && m.state.Observer != nil {
		_, err = m.observerArgumentsLocked(ctx)
	}
	if err != nil {
		_ = command.Process.Kill()
		var waitErr error
		if current4Launch != nil {
			waitErr = m.retainFailedCurrent4(current4Launch, err)
		} else {
			waitErr = command.Wait()
		}
		if waitErr != nil {
			m.state.LastExit = waitErr.Error()
		} else {
			m.state.LastExit = "exit 0 after cancelled/invalid start"
		}
		if logErr := m.finishRunLogs(logs); logErr != nil {
			err = errors.Join(err, logErr)
		}
		return "", m.reconcile(err)
	}
	readContext, cancelReads := context.WithCancel(context.Background())
	running := &child{cmd: command, current4: current4Launch, done: make(chan struct{}), exited: make(chan struct{}), runID: runID, capture: capture, logs: logs, readContext: readContext, cancelReads: cancelReads, syncEndpoint: endpoint}
	m.process = running
	m.state.Stage = "running"
	m.state.Generation++
	m.state.RunID = running.runID
	m.state.LastPID = command.Process.Pid
	m.state.LastExit = ""
	if err = m.save(); err != nil {
		cancelReads()
		_ = command.Process.Kill()
		if current4Launch != nil {
			err = m.retainFailedCurrent4(current4Launch, err)
		} else {
			_ = command.Wait()
		}
		if logErr := m.finishRunLogs(logs); logErr != nil {
			err = errors.Join(err, logErr)
		}
		m.process = nil
		m.state.Stage = "reconcile_required"
		m.firstCause(err)
		_ = m.save()
		return "", ErrReconcile
	}
	m.closeWaitErr, m.closeTerminationErr = nil, nil
	adopted = true
	go m.wait(running)
	go m.monitorCapacity(running)
	return running.runID, nil
}
func (m *Manager) wait(running *child) {
	var err error
	var cleanupErr error
	if running.current4 != nil {
		// The launcher already owns the sole Cmd.Wait. This observes that
		// original completion; it never invokes Wait a second time.
		err = running.current4.ProducerWait(context.Background())
	} else {
		err = running.cmd.Wait()
	}
	// Seal reads before acquiring the manager mutex. A completed Wait must never
	// leave a window in which a recycled PID can satisfy a new observation.
	close(running.exited)
	running.cancelReads()
	m.mu.Lock()
	defer m.mu.Unlock()
	if running.current4 != nil {
		if closeErr := m.retainFailedCurrent4(running.current4, nil); closeErr != nil {
			m.firstCause(closeErr)
			cleanupErr = closeErr
		}
	}
	if m.process == running {
		m.process = nil
		identityErr := m.runtimeUnchanged(running.capture)
		identityErr = errors.Join(identityErr, m.finishRunLogs(running.logs))
		if identityErr == nil {
			identityErr = m.cleanupRuntime(running.capture)
		}
		m.state.Stage = "stopped"
		if identityErr != nil {
			m.state.Stage = "reconcile_required"
			m.firstCause(identityErr)
			cleanupErr = errors.Join(cleanupErr, identityErr)
		}
		m.state.Generation++
		if err != nil {
			m.state.LastExit = err.Error()
			if !running.stopRequested {
				m.firstCause(err)
			}
		} else {
			m.state.LastExit = "exit 0"
		}
		if saveErr := m.save(); saveErr != nil {
			m.state.Stage = "reconcile_required"
			m.firstCause(saveErr)
			cleanupErr = errors.Join(cleanupErr, saveErr)
		}
	}
	if cleanupErr != nil {
		running.waitErr = errors.Join(ErrReconcile, cleanupErr)
		if m.closeWaitErr == nil {
			m.closeWaitErr = running.waitErr
		}
	}
	if running.terminating == nil && m.closeTerminationErr == nil {
		m.closeTerminationErr = running.terminateErr
	}
	close(running.done)
}
func (m *Manager) monitorCapacity(running *child) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-running.done:
			return
		case <-ticker.C:
			m.mu.Lock()
			if m.process != running || running.stopRequested {
				m.mu.Unlock()
				return
			}
			_, err := m.capacity(0)
			if err == nil {
				err = m.runtimeUnchanged(running.capture)
			}
			if err == nil {
				err = m.logFilesUnchanged(running.logs)
			}
			if err != nil {
				m.firstCause(err)
				running.stopRequested = true
				running.cancelReads()
				running.syncReadback = Synchronization{}
				m.state.Stage = "stopping"
				_ = m.save()
				_ = running.cmd.Process.Kill()
				m.mu.Unlock()
				return
			}
			m.mu.Unlock()
		}
	}
}
func (m *Manager) Stop(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval) error {
	if ctx == nil {
		return ErrConsent
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	current, err := m.intent(peer, "stop", "")
	if err != nil {
		m.mu.Unlock()
		return err
	}
	if current != intent {
		m.mu.Unlock()
		return ErrConsent
	}
	if m.state.Stage == "reconcile_required" && m.process == nil {
		m.mu.Unlock()
		return ErrReconcile
	}
	if err = m.consume(peer, intent, approval); err != nil {
		m.mu.Unlock()
		return err
	}
	running := m.process
	if running == nil {
		if starting := m.starting; starting != nil {
			starting.cancel()
			m.state.Stage = "stopping"
			m.state.Generation++
			saveErr := m.save()
			if saveErr != nil {
				m.firstCause(saveErr)
			}
			m.mu.Unlock()
			return errors.Join(saveErr, awaitNodeStart(ctx, starting))
		}
		m.mu.Unlock()
		return nil
	}
	running.stopRequested = true
	running.cancelReads()
	running.syncReadback = Synchronization{}
	m.state.Stage = "stopping"
	m.state.Generation++
	if err = m.save(); err != nil {
		m.firstCause(err)
		m.rememberCloseFailure(err)
	}
	m.mu.Unlock()
	return errors.Join(err, m.terminate(ctx, running))
}
func (m *Manager) terminate(ctx context.Context, running *child) (runErr error) {
	for {
		m.mu.Lock()
		if pending := running.terminating; pending != nil {
			m.mu.Unlock()
			select {
			case <-pending:
				continue
			case <-ctx.Done():
				return errors.Join(ErrReconcile, ctx.Err())
			}
		}
		select {
		case <-running.done:
			err := errors.Join(running.terminateErr, running.waitErr)
			m.mu.Unlock()
			return err
		default:
		}
		if err := ctx.Err(); err != nil {
			m.mu.Unlock()
			return errors.Join(ErrReconcile, err)
		}
		pending := make(chan struct{})
		running.terminating = pending
		m.termination = running
		m.mu.Unlock()
		defer func() {
			m.mu.Lock()
			if runErr != nil {
				running.terminateErr = errors.Join(running.terminateErr, runErr)
			}
			select {
			case <-running.done:
				if m.closeTerminationErr == nil {
					m.closeTerminationErr = running.terminateErr
				}
				runErr = errors.Join(running.terminateErr, running.waitErr)
			default:
			}
			running.terminating = nil
			m.termination = nil
			close(pending)
			m.mu.Unlock()
		}()
		break
	}
	var sourceErr error
	defer func() {
		if sourceErr != nil {
			runErr = errors.Join(runErr, sourceErr)
		}
	}()
	if running.current4 != nil {
		running.current4.ExpectProducerStop()
		if running.current4.HasSourceBroker() {
			drain, err := running.current4.DrainFreshScopesBeforeNodeClose(ctx)
			if !drain.GracefulNativeDrained {
				// This is only local teardown of the same owned processes. It
				// does not renew a Source window, invent SDK CLOSED, or issue
				// a second STOP after a lost acknowledgment. Core stays alive
				// for the initial graceful attempt; failure remains UNKNOWN.
				cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				localErr := running.current4.Stop(cleanupCtx)
				select {
				case <-running.done:
				case <-cleanupCtx.Done():
					localErr = errors.Join(localErr, cleanupCtx.Err())
				}
				cancel()
				cause := errors.Join(ErrReconcile, err, localErr)
				m.mu.Lock()
				m.firstCause(cause)
				if m.directory != "" {
					cause = errors.Join(cause, m.save())
				}
				m.mu.Unlock()
				return cause
			}
			// A genuine local drain may retain a prior Auth failure, even
			// present/code0. Preserve that error without calling the known
			// physical acknowledgment UNKNOWN or preventing local node stop.
			sourceErr = err
		}
		drain, err := running.current4.DrainAccountBeforeNodeClose(ctx)
		if err != nil || !drain.LocalUsersDrained || !drain.LocalComplete {
			return errors.Join(ErrReconcile, err)
		}
	}
	// os.Process remains the original owned handle. Never reconstruct it from
	// LastPID after reopen, never enumerate/kill unrelated daemons/signers.
	if err := running.cmd.Process.Signal(os.Interrupt); err != nil && !errors.Is(err, os.ErrProcessDone) {
		_ = running.cmd.Process.Kill()
	}
	timer := time.NewTimer(m.stopGrace)
	defer timer.Stop()
	select {
	case <-running.done:
		return nil // The shared Wait outcome is joined after the termination owner returns.
	case <-timer.C:
		_ = running.cmd.Process.Kill()
	case <-ctx.Done():
		_ = running.cmd.Process.Kill()
		// Cancellation is not permission to release the original handle before
		// Wait. The pinned foreground runtime has no child-process contract.
		<-running.done
		return ctx.Err()
	}
	select {
	case <-running.done:
		return nil
	case <-ctx.Done():
		_ = running.cmd.Process.Kill()
		<-running.done
		return ctx.Err()
	}
}
func (m *Manager) Close(ctx context.Context) error {
	if ctx == nil {
		return ErrConsent
	}
	for {
		// Joining a Close must not block on the manager mutex held by an
		// outstanding native cleanup. Only the owner enters closeOwned.
		m.closeMu.Lock()
		if m.closeComplete {
			result := m.closeResult
			m.closeMu.Unlock()
			return result
		}
		if closing := m.closeInFlight; closing != nil {
			m.closeMu.Unlock()
			select {
			case <-closing:
				continue
			case <-ctx.Done():
				return errors.Join(ErrReconcile, ctx.Err())
			}
		}
		if err := ctx.Err(); err != nil {
			m.closeMu.Unlock()
			return err
		}
		closing := make(chan struct{})
		m.closeInFlight = closing
		m.closeMu.Unlock()
		err := m.closeOwned(ctx)
		released := m.PhysicalReleased()
		m.closeMu.Lock()
		if released {
			m.closeResult = err
			m.closeComplete = true
		}
		m.closeInFlight = nil
		close(closing)
		m.closeMu.Unlock()
		return err
	}
}

func (m *Manager) closeOwned(ctx context.Context) error {
	m.mu.Lock()
	m.closed = true
	// Loss of the directory/marker identity cannot prevent the original held
	// process from being drained. Keep the cause for the caller even when an
	// unsafe marker prevents an honest journal update during teardown.
	identityErr := m.rootUnchanged()
	if identityErr != nil {
		m.firstCause(identityErr)
		m.rememberCloseFailure(identityErr)
	}
	clear(m.approvals)
	probe := m.versionProbe
	if probe != nil {
		probe.cancel()
	}
	starting := m.starting
	if starting != nil {
		starting.cancel()
	}
	running := m.process
	if running == nil {
		// A Stop owner may still be finishing Source or journal cleanup after Wait.
		running = m.termination
	}
	if running != nil && !running.stopRequested {
		running.stopRequested = true
		running.cancelReads()
		running.syncReadback = Synchronization{}
		m.state.Stage = "stopping"
		m.state.Generation++
		if err := m.save(); err != nil {
			m.firstCause(err)
			m.rememberCloseFailure(err)
		}
	}
	m.mu.Unlock()
	if starting != nil {
		if err := awaitNodeStart(ctx, starting); err != nil {
			return err
		}
	}
	if probe != nil {
		select {
		case <-probe.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	// Only release after both the process Wait and its termination owner have
	// finished. The terminal failures are recorded independently of any joiner's
	// context timeout.
	var terminationErr error
	if running != nil {
		terminationErr = m.terminate(ctx, running)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.process != nil || m.termination != nil {
		return errors.Join(ErrReconcile, identityErr, terminationErr)
	}
	if m.pendingCurrent4 != nil {
		owner := m.pendingCurrent4
		closeErr := owner.Stop(ctx)
		if !owner.LocalPhysicalReleased() {
			return errors.Join(ErrReconcile, closeErr)
		}
		m.firstCause(closeErr)
		m.rememberCloseFailure(closeErr)
		m.pendingCurrent4 = nil
	}
	if m.pendingAccount != nil {
		drain, closeErr := m.pendingAccount.DrainBeforeNodeClose(ctx)
		if !drain.LocalUsersDrained || !drain.LocalComplete {
			return errors.Join(ErrReconcile, closeErr)
		}
		m.firstCause(closeErr)
		m.rememberCloseFailure(closeErr)
		m.pendingAccount = nil
	}
	if m.originalSourceParentProfile != nil {
		done, e := m.originalSourceParentProfile.closeAfterOriginalLaunch(ctx, m)
		if !done {
			return errors.Join(ErrReconcile, e)
		}
		m.firstCause(e)
		// The original profile owns and reports its own earlier timeout;
		// reaching physical release on a later Close remains valid.
		m.originalSourceParentProfile = nil
	}
	m.rememberCloseFailure(m.rootUnchanged())
	releaseErr := m.closeLocks()
	m.released = true
	return errors.Join(m.closeFailure, m.closeWaitErr, m.closeTerminationErr, releaseErr)
}

// Caller holds m.mu. Keep the first Close failure across a pending retry.
func (m *Manager) rememberCloseFailure(err error) {
	if m.closeFailure == nil && err != nil {
		m.closeFailure = err
	}
}
