package authgrant

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// PUBLIC lifetime seam only. Real Root/proof/current and SQLite cap production
// are not simulated as cryptographic admission by these policy controls.
type publicReservation struct {
	*publicSource
	gate            sync.Mutex
	op              string
	slot            SemanticSlot
	live, claimed   bool
	asserts, claims int
	claimErr        error
}

func (h *publicReservation) AssertOriginalReservation(ctx context.Context, v SourceVersion, s SemanticSlot, op string) error {
	h.gate.Lock()
	defer h.gate.Unlock()
	h.asserts++
	if e := ctx.Err(); e != nil {
		return e
	}
	if !h.live || op != h.op || s != h.slot || v != h.s.Version {
		return refusal(Stale, "PUBLIC-cap-identity")
	}
	return nil
}
func (h *publicReservation) ClaimOriginalReservation(ctx context.Context, v SourceVersion, s SemanticSlot, op string) error {
	if e := h.AssertOriginalReservation(ctx, v, s, op); e != nil {
		return e
	}
	h.gate.Lock()
	defer h.gate.Unlock()
	if h.claimed {
		return refusal(OriginalOnly, "PUBLIC-double-claim")
	}
	h.claimed = true
	h.claims++
	return h.claimErr
}

type publicReservedVerifier struct {
	*publicVerifier
	held       HeldOriginalTaskReservationSource
	partialErr error
	reservedOp string
}

func (v *publicReservedVerifier) OpenOriginalTaskReservationSource(ctx context.Context, b TaskEffectBinding, g, h Proof, op string) (HeldOriginalTaskReservationSource, error) {
	v.expected = cloneBinding(b)
	v.grant = g
	v.holder = h
	v.reservedOp = op
	return v.held, v.partialErr
}
func reservedFixture() (TaskEffectBinding, *publicReservation, *publicReservedVerifier, *time.Time) {
	b, s, v, now := fixture()
	s.scope = EgressOnlyReadFence
	s.s.Effect.State = "UNKNOWN"
	s.s.Effect.OriginalOp = "original-node-slot-op"
	h := &publicReservation{publicSource: s, op: s.s.Effect.OriginalOp, slot: b.Slot(), live: true}
	return b, h, &publicReservedVerifier{publicVerifier: v, held: h}, now
}
func openReserved(t *testing.T, b TaskEffectBinding, h *publicReservation, v *publicReservedVerifier, now *time.Time) *OriginalTaskReservationCheck {
	t.Helper()
	c, e := openOriginalReservedWithClock(context.Background(), v, b, proof(), proof(), h.op, func() time.Time { return *now })
	if e != nil {
		if c != nil {
			_ = c.Close()
		}
		t.Fatal(e)
	}
	return c
}
func TestOriginalReservationCurrentDoesNotConsumeAndConcurrentFinalClaim(t *testing.T) {
	b, h, v, now := reservedFixture()
	c := openReserved(t, b, h, v, now)
	defer c.Close()
	for i := 0; i < 4; i++ {
		if _, e := c.Current(context.Background()); e != nil {
			t.Fatal(e)
		}
	}
	if h.claims != 0 {
		t.Fatal("Current consumed claim")
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := c.ClaimAtEffect(context.Background()); e == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if wins != 1 || h.claims != 1 {
		t.Fatalf("wins %d claims %d", wins, h.claims)
	}
	if _, e := c.Current(context.Background()); e != nil {
		t.Fatal("post-claim Current must remain valid", e)
	}
	if h.s.Effect.State != "UNKNOWN" || v.reservedOp != h.op {
		t.Fatal("query state/op mutated")
	}
}
func TestOriginalReservationNewGateAndOpaqueCapabilityRequired(t *testing.T) {
	b, h, v, now := reservedFixture()
	if c, e := openWithClock(context.Background(), v.publicVerifier, b, proof(), proof(), func() time.Time { return *now }); e == nil {
		_ = c.Close()
		t.Fatal("NEW gate accepted UNKNOWN")
	}
	for _, state := range []string{"NEW", "RESERVED", "OWN_RESERVED", "COMMITTED"} {
		t.Run(state, func(t *testing.T) {
			b, h, v, n := reservedFixture()
			h.s.Effect.State = state
			c, e := openOriginalReservedWithClock(context.Background(), v, b, proof(), proof(), h.op, func() time.Time { return *n })
			if c != nil {
				defer c.Close()
			}
			if e == nil {
				t.Fatal("public state authorized", state)
			}
		})
	}
	b, h, v, now = reservedFixture()
	h.live = false
	c, e := openOriginalReservedWithClock(context.Background(), v, b, proof(), proof(), h.op, func() time.Time { return *now })
	if c != nil {
		defer c.Close()
	}
	if e == nil {
		t.Fatal("restart/query-only cap authorized")
	}
}
func TestOriginalReservationExactBindingAndCurrentFailures(t *testing.T) {
	cases := map[string]func(*publicReservation){"slot-generation": func(h *publicReservation) { h.slot.Generation = "99" }, "foreign-op": func(h *publicReservation) { h.op = "other" }, "holder": func(h *publicReservation) { h.s.Holder.Epoch = "99" }, "revision": func(h *publicReservation) { h.s.Grant.Revision = "99" }, "revoked": func(h *publicReservation) { h.s.Grant.Status = "revoked" }, "budget": func(h *publicReservation) { h.s.Budget.Reserved = "10" }, "wrong-fence": func(h *publicReservation) { h.scope = SameAuthorityResourceFence }}
	for name, mut := range cases {
		t.Run(name, func(t *testing.T) {
			b, h, v, n := reservedFixture()
			op := h.op
			mut(h)
			c, e := openOriginalReservedWithClock(context.Background(), v, b, proof(), proof(), op, func() time.Time { return *n })
			if c != nil {
				defer c.Close()
			}
			if e == nil {
				t.Fatal("invalid original cap/binding admitted")
			}
			if h.claims != 0 {
				t.Fatal("acquisition consumed")
			}
		})
	}
}
func TestOriginalReservationLateUnknownExpiryAndPartialNoRearm(t *testing.T) {
	for _, mode := range []string{"unknown", "expiry", "retire", "lost-ack"} {
		t.Run(mode, func(t *testing.T) {
			b, h, v, n := reservedFixture()
			c := openReserved(t, b, h, v, n)
			defer c.Close()
			switch mode {
			case "unknown":
				h.live = false
			case "expiry":
				*n = time.UnixMilli(8000)
			case "retire":
				_ = c.Retire()
			case "lost-ack":
				h.claimErr = errors.New("PUBLIC-lost-ack")
			}
			if _, e := c.ClaimAtEffect(context.Background()); e == nil {
				t.Fatal("late failure admitted")
			}
			h.live = true
			*n = time.UnixMilli(2000)
			h.claimErr = nil
			if _, e := c.ClaimAtEffect(context.Background()); e == nil {
				t.Fatal("uncertain claim rearmed")
			}
		})
	}
	b, h, v, n := reservedFixture()
	v.partialErr = errors.New("PUBLIC-acquire-late")
	c, e := openOriginalReservedWithClock(context.Background(), v, b, proof(), proof(), h.op, func() time.Time { return *n })
	if c == nil || e != v.partialErr {
		t.Fatal("partial lost")
	}
	_ = c.Close()
	if h.closeCount != 1 {
		t.Fatal("partial not closed")
	}
}
