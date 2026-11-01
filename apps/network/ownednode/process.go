package ownednode

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

type cappedOutput struct {
	mu        sync.Mutex
	remaining int
}

func (w *cappedOutput) Write(raw []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	used := len(raw)
	if used > w.remaining {
		used = w.remaining
	}
	w.remaining -= used
	return len(raw), nil
}

func (m *Manager) Start(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval) (string, error) {
	if ctx == nil {
		return "", ErrConsent
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
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
	if m.process != nil || m.state.Stage == "running" || m.state.Stage == "stopping" {
		return "", errors.New("only one owned node process is allowed")
	}
	if m.state.Stage != "installed" && m.state.Stage != "stopped" {
		return "", errors.New("node artifact is not installed")
	}
	artifact, _, err := m.artifact()
	if err != nil {
		return "", err
	}
	if _, err = m.capacity(uint64(len(artifact)) + 1024); err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	if err = m.consume(peer, intent, approval); err != nil {
		return "", err
	}
	runID := randomID()
	m.state.Stage = "starting"
	m.state.Generation++
	m.state.RunID = runID
	if err = m.save(); err != nil {
		return "", m.reconcile(err)
	}
	capture, err := m.captureRuntime(artifact, runID)
	if err != nil {
		return "", m.reconcile(err)
	}
	if err = m.runtimeUnchanged(capture); err != nil {
		return "", m.reconcile(err)
	}
	if err = ctx.Err(); err != nil {
		return "", m.reconcile(err)
	}
	command := exec.Command(capture.path) // Fixed captured bytes; no task path, shell, args or PID.
	command.Dir = filepath.Join(m.directory, "data")
	command.Env = []string{"LC_ALL=C", "LANG=C", "GOMAXPROCS=1"}
	command.WaitDelay = 250 * time.Millisecond
	output := &cappedOutput{remaining: 4096}
	command.Stdout = output
	command.Stderr = output
	if err = ctx.Err(); err != nil {
		return "", m.reconcile(err)
	}
	if err = command.Start(); err != nil {
		return "", m.reconcile(err)
	}
	m.state.LastPID = command.Process.Pid
	if err = m.runtimeUnchanged(capture); err == nil {
		err = ctx.Err()
	}
	if err != nil {
		_ = command.Process.Kill()
		waitErr := command.Wait()
		if waitErr != nil {
			m.state.LastExit = waitErr.Error()
		} else {
			m.state.LastExit = "exit 0 after cancelled/invalid start"
		}
		return "", m.reconcile(err)
	}
	running := &child{cmd: command, done: make(chan struct{}), runID: runID, capture: capture}
	m.process = running
	m.state.Stage = "running"
	m.state.Generation++
	m.state.RunID = running.runID
	m.state.LastPID = command.Process.Pid
	m.state.LastExit = ""
	if err = m.save(); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		m.process = nil
		m.state.Stage = "reconcile_required"
		m.firstCause(err)
		_ = m.save()
		return "", ErrReconcile
	}
	go m.wait(running)
	go m.monitorCapacity(running)
	return running.runID, nil
}
func (m *Manager) wait(running *child) {
	err := running.cmd.Wait()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.process == running {
		m.process = nil
		identityErr := m.runtimeUnchanged(running.capture)
		if identityErr == nil {
			identityErr = m.cleanupRuntime(running.capture)
		}
		m.state.Stage = "stopped"
		if identityErr != nil {
			m.state.Stage = "reconcile_required"
			m.firstCause(identityErr)
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
		}
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
			if m.process != running {
				m.mu.Unlock()
				return
			}
			_, err := m.capacity(0)
			if err == nil {
				err = m.runtimeUnchanged(running.capture)
			}
			if err != nil {
				m.firstCause(err)
				running.stopRequested = true
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
		m.mu.Unlock()
		return nil
	}
	running.stopRequested = true
	m.state.Stage = "stopping"
	m.state.Generation++
	if err = m.save(); err != nil {
		m.firstCause(err)
	}
	m.mu.Unlock()
	if stopErr := m.terminate(ctx, running); stopErr != nil {
		return stopErr
	}
	return err
}
func (m *Manager) terminate(ctx context.Context, running *child) error {
	// os.Process remains the original owned handle. Never reconstruct it from
	// LastPID after reopen, never enumerate/kill unrelated daemons/signers.
	if err := running.cmd.Process.Signal(os.Interrupt); err != nil && !errors.Is(err, os.ErrProcessDone) {
		_ = running.cmd.Process.Kill()
	}
	timer := time.NewTimer(m.stopGrace)
	defer timer.Stop()
	select {
	case <-running.done:
		return nil
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
	m.mu.Lock()
	if m.released {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	clear(m.approvals)
	running := m.process
	if running != nil {
		running.stopRequested = true
		m.state.Stage = "stopping"
		m.state.Generation++
		if err := m.save(); err != nil {
			m.firstCause(err)
		}
	}
	m.mu.Unlock()
	if running != nil {
		if err := m.terminate(ctx, running); err != nil {
			return err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.released {
		return nil
	}
	if m.process != nil {
		return ErrReconcile
	}
	if err := unlockFile(m.lock); err != nil {
		return err
	}
	if err := m.lock.Close(); err != nil {
		return err
	}
	m.released = true
	return nil
}
