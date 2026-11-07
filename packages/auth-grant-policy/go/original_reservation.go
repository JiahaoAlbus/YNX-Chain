package authgrant

import (
	"context"
	"sync"
	"time"
)

// Only the protected original runtime/local adapter supplies this interface.
// It acquires from the SAME held Source/caller and original private ticket.
// Implementing this interface in a PUBLIC test is not production admission.
type OriginalTaskReservationVerifier interface {
	OriginalTaskGrantVerifier
	OpenOriginalTaskReservationSource(context.Context, TaskEffectBinding, Proof, Proof, string) (HeldOriginalTaskReservationSource, error)
}

// Assert is repeatable, including after claim. Claim is once under Store.mu.
// Both bind the Node opaque ticket slot AND this independent Go semantic slot.
// Closing this child must not close the borrowed parent Source.
type HeldOriginalTaskReservationSource interface {
	HeldTaskGrantSource
	AssertOriginalReservation(context.Context, SourceVersion, SemanticSlot, string) error
	ClaimOriginalReservation(context.Context, SourceVersion, SemanticSlot, string) error
}
type OriginalTaskReservationCheck struct {
	check    *TaskGrantCheck
	claimMu  sync.Mutex
	selected bool
}

func OpenOriginalReservedTaskRead(ctx context.Context, v OriginalTaskReservationVerifier, b TaskEffectBinding, g, h Proof, operation string) (*OriginalTaskReservationCheck, error) {
	return openOriginalReservedWithClock(ctx, v, b, g, h, operation, time.Now)
}
func openOriginalReservedWithClock(ctx context.Context, v OriginalTaskReservationVerifier, b TaskEffectBinding, g, h Proof, operation string, clock func() time.Time) (*OriginalTaskReservationCheck, error) {
	if nilInterface(v) || operation == "" || len(operation) > 256 {
		return nil, refusal(Unavailable, "original-reservation")
	}
	c, e := openPhaseWithClock(ctx, v, b, g, h, operation, clock)
	if c == nil {
		return nil, e
	}
	return &OriginalTaskReservationCheck{check: c}, e
}
func (c *TaskGrantCheck) validateSnapshot(s Snapshot, scope FenceScope, now uint64) error {
	return validateSnapshotPhase(c.expected, s, scope, now, c.originalOperation)
}
func (c *TaskGrantCheck) assertOriginalReservation(ctx context.Context, v SourceVersion) error {
	if c.originalOperation == "" {
		return nil
	}
	h, ok := c.source.(HeldOriginalTaskReservationSource)
	if !ok || nilInterface(h) {
		return refusal(Unavailable, "original-reservation-source")
	}
	return h.AssertOriginalReservation(ctx, v, c.expected.Slot(), c.originalOperation)
}
func (c *OriginalTaskReservationCheck) Current(ctx context.Context) (Decision, error) {
	if c == nil || c.check == nil {
		return Decision{}, refusal(Unavailable, "original-reservation-owner")
	}
	return c.check.CheckTaskGrantAtEffect(ctx)
}

// Select once BEFORE the original claim. Lost ACK/error never rearms it and
// never consumes the separate ledger ticket.used settlement capability.
func (c *OriginalTaskReservationCheck) ClaimAtEffect(ctx context.Context) (Decision, error) {
	if c == nil || c.check == nil {
		return Decision{}, refusal(Unavailable, "original-reservation-owner")
	}
	c.claimMu.Lock()
	defer c.claimMu.Unlock()
	if c.selected {
		return Decision{}, refusal(OriginalOnly, "original-reservation-already-selected")
	}
	d, e := c.Current(ctx)
	if e != nil {
		return Decision{}, e
	}
	c.selected = true
	h := c.check.source.(HeldOriginalTaskReservationSource)
	if e = h.ClaimOriginalReservation(ctx, d.Version, d.Slot, c.check.originalOperation); e != nil {
		return Decision{}, c.check.record(e)
	}
	if _, e = c.Current(ctx); e != nil {
		return Decision{}, e
	}
	return d, nil
}
func (c *OriginalTaskReservationCheck) Retire() error {
	if c == nil || c.check == nil {
		return nil
	}
	return c.check.Retire()
}
func (c *OriginalTaskReservationCheck) Close() error {
	if c == nil || c.check == nil {
		return nil
	}
	return c.check.Close()
}
