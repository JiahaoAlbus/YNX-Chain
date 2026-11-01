package contribution

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestOriginalFinalReceiptRevocationAndDurability(t *testing.T) {
	worker := buildPublicOriginalWorker(t)
	t.Run("revoked-final-receipt-fence", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-settlement-fence")
		claim := &publicOriginalClaim{raw: publicOnceRaw(t, m, c), complete: true, denyAt: 2}
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: claim}
		r := publicOriginalRunner(t, worker, filepath.Join(t.TempDir(), "journal.json"), s)
		if _, e := originalPublicStart(r); e != nil {
			t.Fatal(e)
		}
		if e := r.Wait(context.Background()); e != nil {
			t.Fatal(e)
		}
		rec, _ := r.Record("public-settlement-fence")
		if rec.State != "stopped" || rec.Receipt != nil || r.VerifyResourceMeter().VerifiedJobs != 0 || claim.lockedChecks < 1 {
			t.Fatal("revocation promoted result", rec)
		}
	})
	t.Run("durable-owner-loss-before-first-commit", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-store-fault")
		claim := &publicOriginalClaim{raw: publicOnceRaw(t, m, c), complete: true}
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: claim, invalidateStoreOwner: true}
		r := publicOriginalRunner(t, worker, filepath.Join(t.TempDir(), "journal.json"), s)
		// Explicit PUBLIC fault fixture: close only its actual held kernel FD.
		// Real UNKNOWN owners are never replaced or rearmed to clear a failure.
		t.Cleanup(func() { _ = r.lock.Close(); _ = r.executor.Close() })
		rec, e := originalPublicStart(r)
		if e == nil || rec.State != "unknown" || !r.sealed || r.persistenceErr == nil || r.executor.Executions() != 0 || len(r.data.Nonces) != 1 {
			t.Fatal("ambiguous Store claim dispatched", rec, e)
		}
		if _, e = originalPublicStart(r); !errors.Is(e, ErrStopped) || s.claimCalls != 1 {
			t.Fatal("persistence UNKNOWN retried", e)
		}
	})
	t.Run("one-physical-close-call-survives-context-timeout", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-close")
		gate := make(chan struct{})
		claim := &publicOriginalClaim{raw: publicOnceRaw(t, m, c), complete: true, closeGate: gate}
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: claim}
		r := publicOriginalRunner(t, worker, filepath.Join(t.TempDir(), "journal.json"), s)
		w, consent, e := originalDocuments(m, c)
		if e != nil {
			t.Fatal(e)
		}
		r.mu.Lock()
		r.data.Jobs[w.Job] = Record{Original: &OriginalRecord{ManifestOriginal: m, ConsentOriginal: c, ClaimOriginal: claim.raw}, Work: w, Manifest: Bind(m), ConsentNonce: nonceKey(consent.Principal, consent.Nonce), State: "unknown"}
		r.data.Nonces[nonceKey(consent.Principal, consent.Nonce)] = w.Job
		r.original.claims[w.Job] = &originalClaimOwner{claim: claim}
		if e = r.persist(); e != nil {
			t.Fatal(e)
		}
		r.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()
		if done, e := r.drainOriginalClaim(ctx, w.Job); done || !errors.Is(e, context.DeadlineExceeded) {
			t.Fatal("physical close falsely completed", done, e)
		}
		if r.VerifyResourceMeter().OriginalClaimsPending != 1 {
			t.Fatal("original handle discarded")
		}
		var wg sync.WaitGroup
		results := make(chan error, 2)
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				done, e := r.drainOriginalClaim(context.Background(), w.Job)
				if !done && e == nil {
					e = ErrStopped
				}
				results <- e
			}()
		}
		close(gate)
		wg.Wait()
		close(results)
		for e := range results {
			if e != nil {
				t.Fatal(e)
			}
		}
		claim.mu.Lock()
		calls := claim.closes
		claim.mu.Unlock()
		if calls != 1 || r.VerifyResourceMeter().OriginalClaimsPending != 0 {
			t.Fatal("Native close replay/replacement", calls)
		}
		rec, _ := r.Record(w.Job)
		if rec.State != "unknown" || rec.Original.FirstCause == "" || rec.Original.CleanupFailure == "" {
			t.Fatal("late physical completion erased first UNKNOWN", rec)
		}
	})
}
