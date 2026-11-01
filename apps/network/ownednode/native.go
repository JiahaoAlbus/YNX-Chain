package ownednode

import (
	"context"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

// NativeDecisionProducer is a trusted-host composition boundary for the actual
// pinned nativeconsent.Producer, not a decoder for a caller's allow/source bool.
// Production callers wire the original producer; controlled protocol fixtures
// do not establish that a human approved a node or that its release is admitted.
type NativeDecisionProducer interface {
	Confirm(context.Context, Intent, string) error
}

// ApproveNative consumes the original visible producer for this exact intent,
// then rechecks cancellation, generation and manager identity. It never holds
// the manager mutex across a visible review. The existing publisher/runtime
// admission gate is independent of this local operation decision.
func (m *Manager) ApproveNative(ctx context.Context, peer localipc.Peer, intent Intent, producer NativeDecisionProducer) (*Approval, error) {
	if ctx == nil || producer == nil {
		return nil, ErrConsent
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.Lock()
	current, err := m.intent(peer, intent.Action, intent.ArtifactSHA256)
	mode := m.state.Mode
	if err == nil && current != intent {
		err = ErrConsent
	}
	if err == nil && !m.fixture && intent.Action != "stop" {
		err = ErrOriginalReleaseMissing
	}
	if err == nil && intent.Action == "stop" && m.process == nil {
		err = ErrReconcile
	}
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if err := producer.Confirm(ctx, intent, mode); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return m.approve(peer, intent, 15*time.Second, true)
}

// RestartNative stops only a currently owned handle, waits for that exact run,
// and requests a distinct fresh native decision for the new start generation.
// Cancellation/denial after Stop leaves a stopped node; it never reuses the old
// approval, signals a stored PID, rolls back logs or auto-replays an UNKNOWN run.
func (m *Manager) RestartNative(ctx context.Context, peer localipc.Peer, producer NativeDecisionProducer) (string, error) {
	if ctx == nil || producer == nil {
		return "", ErrConsent
	}
	status, err := m.Status(peer)
	if err != nil {
		return "", err
	}
	if !status.ProcessOwned || status.Stage != "running" {
		return "", ErrReconcile
	}
	stop, err := m.Prepare(peer, "stop", "")
	if err != nil {
		return "", err
	}
	approval, err := m.ApproveNative(ctx, peer, stop, producer)
	if err != nil {
		return "", err
	}
	if err = m.Stop(ctx, peer, stop, approval); err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	start, err := m.Prepare(peer, "start", "")
	if err != nil {
		return "", err
	}
	approval, err = m.ApproveNative(ctx, peer, start, producer)
	if err != nil {
		return "", err
	}
	return m.Start(ctx, peer, start, approval)
}
