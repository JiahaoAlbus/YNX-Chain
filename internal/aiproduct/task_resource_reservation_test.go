package aiproduct

import (
	"context"
	"errors"
	"sync"
	"testing"

	authgrant "ynx.local/authgrantpolicy"
)

// PUBLIC lifetime stand-in ONLY. The actual sole policy and Store are exercised;
// this is not Auth's private SQLite ticket, normal carrier, crypto or admission.
// ReadInput gets NEW/no-op; execution gets the query-UNKNOWN projection plus a
// separate original-capability stand-in. No production factory installs this.
type p08ResourceReservationFixture struct {
	mu                             sync.Mutex
	held                           *p08OriginalHeldFixture
	operation                      string
	first, assertError, claimError error
	claimed                        bool
	claims                         int
	assertions                     int
	onClaim                        func() error
}

func (f *p08ResourceReservationFixture) OpenTaskGrantSource(context.Context, authgrant.TaskEffectBinding, authgrant.Proof, authgrant.Proof) (authgrant.HeldTaskGrantSource, error) {
	return f.held, f.first
}
func (f *p08ResourceReservationFixture) OpenOriginalTaskReservationSource(context.Context, authgrant.TaskEffectBinding, authgrant.Proof, authgrant.Proof, string) (authgrant.HeldOriginalTaskReservationSource, error) {
	return f, f.first
}
func (f *p08ResourceReservationFixture) Snapshot(ctx context.Context) (authgrant.Snapshot, error) {
	s, err := f.held.Snapshot(ctx)
	// This is the PUBLIC reserved fixture's own projection, never a production
	// conversion of NEW or a JSON-derived proof of a reservation.
	s.Effect.State, s.Effect.OriginalOp = "UNKNOWN", f.operation
	return s, err
}
func (f *p08ResourceReservationFixture) AssertCurrent(ctx context.Context, v authgrant.SourceVersion) error {
	return f.held.AssertCurrent(ctx, v)
}
func (f *p08ResourceReservationFixture) FenceScope() authgrant.FenceScope { return f.held.FenceScope() }
func (f *p08ResourceReservationFixture) Retire() error                    { return nil }
func (f *p08ResourceReservationFixture) Join() error                      { return nil }
func (f *p08ResourceReservationFixture) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.held.Close()
}
func (f *p08ResourceReservationFixture) AssertOriginalReservation(ctx context.Context, v authgrant.SourceVersion, s authgrant.SemanticSlot, op string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.assertions++
	if f.assertError != nil {
		return f.assertError
	}
	if op != f.operation || s != f.held.snapshot.Grant.Binding.Slot() || v != f.held.snapshot.Version {
		return errToolConflict
	}
	return ctx.Err()
}
func (f *p08ResourceReservationFixture) ClaimOriginalReservation(ctx context.Context, v authgrant.SourceVersion, s authgrant.SemanticSlot, op string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.claimed || op != f.operation || s != f.held.snapshot.Grant.Binding.Slot() || v != f.held.snapshot.Version {
		return errToolConflict
	}
	f.claimed = true
	f.claims++
	if f.onClaim != nil {
		if err := f.onClaim(); err != nil {
			return err
		}
	}
	if f.claimError != nil {
		return f.claimError
	}
	return ctx.Err()
}

func TestP08TaskResourceReservationCurrentAndLockedClaim(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	f := o.verifier.(*p08ResourceReservationFixture)
	f.onClaim = func() error {
		if o.store.mu.TryLock() {
			o.store.mu.Unlock()
			return errors.New("final claim ran outside Store.mu")
		}
		return nil
	}
	owner, err := o.begin(context.Background(), r, true)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		if err = owner.Current(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if f.claims != 0 {
		t.Fatal("current consumed claim")
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	if err = o.Close(); err != nil {
		t.Fatal(err)
	}
	// A separate fresh PUBLIC fixture tests execution; never treat closing an
	// unclaimed reservation child as permission to reacquire the original call.
	o, r, _ = taskResourceFixture(t)
	f = o.verifier.(*p08ResourceReservationFixture)
	f.onClaim = func() error {
		if o.store.mu.TryLock() {
			o.store.mu.Unlock()
			return errors.New("final claim ran outside Store.mu")
		}
		return nil
	}
	owner, result, err := o.Execute(context.Background(), r)
	if err != nil || result.State != "COMMITTED" || f.claims != 1 {
		t.Fatalf("locked claim: %+v %v claims=%d", result, err, f.claims)
	}
	for i := 0; i < 3; i++ {
		if err = owner.Current(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if err = owner.claimAtEffect(context.Background()); err == nil {
		t.Fatal("same owner selected a second claim")
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	sequence := o.store.state.AuditSequence
	owner, result, err = o.Execute(context.Background(), r)
	if owner != nil {
		_ = owner.Close()
	}
	if err == nil || len(result.Original) != 0 || f.claims != 1 || sequence != o.store.state.AuditSequence {
		t.Fatal("new call replayed original claim")
	}
	// Only independent history is legal after the uncertain/selected attempt.
	if q, e := o.Query(context.Background(), r); e != nil || q.State != "COMMITTED" {
		t.Fatalf("original history: %v", e)
	}
}

func TestP08TaskResourceReservationNoTypedFallback(t *testing.T) {
	o, r, held := taskResourceFixture(t)
	o.verifier = p08OriginalVerifierFixture{held: held}
	sequence := o.store.state.AuditSequence
	owner, result, err := o.Execute(context.Background(), r)
	if owner == nil || !errors.Is(err, errTaskEffectSourceUnavailable) || len(result.Original) != 0 || held.closed != 0 || sequence != o.store.state.AuditSequence {
		t.Fatalf("ordinary NEW verifier became reservation: %v", err)
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	if len(o.children) != 0 {
		t.Fatal("unavailable partial child lost")
	}
}

func TestP08TaskResourceReservationClaimFailureNoRearm(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	f := o.verifier.(*p08ResourceReservationFixture)
	cause := errors.New("PUBLIC claim acknowledgement lost")
	f.claimError = cause
	sequence := o.store.state.AuditSequence
	owner, result, err := o.Execute(context.Background(), r)
	if owner == nil || !errors.Is(err, cause) || len(result.Original) != 0 || sequence != o.store.state.AuditSequence || f.claims != 1 {
		t.Fatalf("claim error not preserved: %v", err)
	}
	if err = owner.claimAtEffect(context.Background()); err == nil {
		t.Fatal("failed claim rearmed")
	}
	_ = owner.Close()
	owner, _, err = o.Execute(context.Background(), r)
	if owner != nil {
		_ = owner.Close()
	}
	if err == nil || f.claims != 1 || sequence != o.store.state.AuditSequence {
		t.Fatal("lost claim became another attempt")
	}
}

func TestP08TaskResourceReservationConcurrentSingleEffect(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	f := o.verifier.(*p08ResourceReservationFixture)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			owner, _, err := o.Execute(context.Background(), r)
			if owner != nil {
				err = errors.Join(err, owner.Close())
			}
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 || f.claims != 1 || o.store.state.Actions[r.Binding.StepID].Status != "COMPLETED" {
		t.Fatalf("concurrent claims: successes=%d claims=%d", successes, f.claims)
	}
}
