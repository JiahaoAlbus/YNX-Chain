package contribution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"
	"unicode/utf8"
)

func (r *Runner) finishOriginalSlot(op *operation) {
	op.cancel()
	r.mu.Lock()
	if r.active == op {
		r.active = nil
		close(op.done)
	}
	r.mu.Unlock()
}
func originalFirst(o *OriginalRecord, err error) {
	if err != nil && o.FirstCause == "" {
		o.FirstCause = err.Error()
		if len(o.FirstCause) > 4096 {
			o.FirstCause = o.FirstCause[:4096]
		}
	}
}

// StartOriginalContribution consumes only the original Source's captured Work,
// Consent and input. Public signature-member bytes are verified against its
// protected mappings by original Auth/sole SDK, never decoded into authority
// here. No caller task/program/path, provider or effect callback is accepted.
func (r *Runner) StartOriginalContribution(ctx context.Context, manifestMember, consentMember []byte) (Record, error) {
	if r == nil || r.original == nil {
		return Record{}, ErrDenied
	}
	if len(manifestMember) == 0 || len(manifestMember) > 262144 || len(consentMember) == 0 || len(consentMember) > 262144 {
		return Record{}, ErrInvalid
	}
	r.mu.Lock()
	if r.closed || r.sealed {
		r.mu.Unlock()
		return Record{}, ErrStopped
	}
	if r.active != nil || len(r.original.claims) > 0 {
		r.mu.Unlock()
		return Record{}, ErrCapacity
	}
	// Reserve only process-local capacity while checking Source. No journal,
	// nonce or Native once acquisition occurs on a failed Source0 path.
	opCtx, cancel := context.WithTimeout(ctx, MaxDurationMillis*time.Millisecond)
	op := &operation{cancel: cancel, done: make(chan struct{}), reserved: MaxMemoryBytes}
	r.active = op
	r.mu.Unlock()
	ownedSlot := true
	defer func() {
		if ownedSlot {
			r.finishOriginalSlot(op)
		}
	}()
	source := r.original.source
	if e := source.Current(opCtx); e != nil {
		return Record{}, errors.Join(ErrDenied, e)
	}
	manifest, e := source.ReadOriginalManifest(opCtx)
	if e != nil {
		return Record{}, e
	}
	consent, e := source.ReadOriginalConsent(opCtx)
	if e != nil {
		return Record{}, e
	}
	w, c, e := originalDocuments(manifest, consent)
	if e != nil {
		return Record{}, e
	}
	input, e := source.ReadOriginalInput(opCtx)
	if e != nil {
		return Record{}, e
	}
	if len(input) > HistogramMaxInputBytes || !utf8.Valid(input) || bytes.HasPrefix(input, []byte{0xef, 0xbb, 0xbf}) || !json.Valid(input) || len(bytes.TrimSpace(input)) == 0 || bytes.TrimSpace(input)[0] != '{' {
		return Record{}, ErrInvalid
	}
	b, e := checkWorkBinding(w, c, len(input), time.Now(), Bind(manifest))
	if e != nil {
		return Record{}, e
	}
	jobCtx, jobCancel := context.WithDeadline(opCtx, b.deadline)
	if e = source.VerifyManifest(jobCtx, w.Issuer, bytes.Clone(manifest), bytes.Clone(manifestMember)); e != nil {
		jobCancel()
		return Record{}, errors.Join(ErrDenied, e)
	}
	if e = source.VerifyConsent(jobCtx, c.Principal, bytes.Clone(consent), bytes.Clone(consentMember)); e != nil {
		jobCancel()
		return Record{}, errors.Join(ErrDenied, e)
	}
	bound, preflight, e := hashChunked(jobCtx, input, b.cpu)
	if e != nil || bound != w.Input {
		jobCancel()
		return Record{}, errors.Join(ErrInvalid, e)
	}
	if e = source.Current(jobCtx); e != nil {
		jobCancel()
		return Record{}, errors.Join(ErrDenied, e)
	}
	r.mu.Lock()
	if r.closed || r.sealed || jobCtx.Err() != nil {
		r.mu.Unlock()
		jobCancel()
		return Record{}, ErrStopped
	}
	if old, ok := r.data.Jobs[w.Job]; ok {
		old = cloneRecord(old)
		r.mu.Unlock()
		jobCancel()
		if old.Original == nil || old.Manifest != c.Manifest || !bytes.Equal(old.Original.ManifestOriginal, manifest) || !bytes.Equal(old.Original.ConsentOriginal, consent) {
			return Record{}, ErrConflict
		}
		// Cold history and UNKNOWN are never a new execution/claim. Its one
		// original receipt remains history; verified counters are not restored.
		if old.State == "unknown" || old.State == "interrupted" {
			return cloneRecord(old), ErrConflict
		}
		return cloneRecord(old), nil
	}
	if _, ok := r.data.Nonces[nonceKey(c.Principal, c.Nonce)]; ok {
		r.mu.Unlock()
		jobCancel()
		return Record{}, ErrConflict
	}
	raw, marshalErr := json.Marshal(r.data)
	if marshalErr != nil || len(r.data.Jobs) >= maxRecords || len(raw) > (4<<20)-204800 {
		r.mu.Unlock()
		jobCancel()
		return Record{}, ErrLimit
	}
	op.reserved = b.memory
	r.mu.Unlock()
	claim, claimErr := source.claim(jobCtx)
	if claim == nil {
		jobCancel()
		return Record{}, errors.Join(ErrDenied, claimErr)
	}
	// Adopt the actual nonnull partial BEFORE interpreting claimErr. The
	// original Runner owns this same handle/channel until physical completion.
	r.mu.Lock()
	r.original.claims[w.Job] = &originalClaimOwner{claim: claim}
	r.mu.Unlock()
	o := &OriginalRecord{ManifestOriginal: bytes.Clone(manifest), ConsentOriginal: bytes.Clone(consent)}
	originalFirst(o, claimErr)
	claimRaw, readErr := claim.ReadOriginal(jobCtx)
	if readErr == nil {
		readErr = validateOnceOriginal(claimRaw, w, c, manifest, consent)
		if readErr == nil {
			o.ClaimOriginal = bytes.Clone(claimRaw)
		}
	}
	if claimErr == nil {
		claimErr = readErr
	}
	originalFirst(o, readErr)
	if claimErr == nil {
		claimErr = source.Current(jobCtx)
		originalFirst(o, claimErr)
	}
	r.mu.Lock()
	if claimErr == nil {
		claimErr = jobCtx.Err()
	}
	if claimErr == nil && (r.closed || r.sealed) {
		claimErr = ErrStopped
	}
	// This synchronous finite no-IO witness is ANDed inside the ORIGINAL
	// journal/nonce transaction. Full Source refresh is always outside this lock.
	if claimErr == nil {
		claimErr = claim.CurrentNoIO()
	}
	originalFirst(o, claimErr)
	rec := Record{Original: o, Work: w, Manifest: c.Manifest, ConsentNonce: nonceKey(c.Principal, c.Nonce), State: "running", Usage: preflight}
	if claimErr != nil {
		rec.State = "unknown"
		rec.Failure = o.FirstCause
	}
	r.data.Jobs[w.Job] = rec
	r.data.Nonces[rec.ConsentNonce] = w.Job
	if e = r.persist(); e != nil {
		rec.State = "unknown"
		rec.Failure = e.Error()
		originalFirst(o, e)
		r.data.Jobs[w.Job] = rec
		r.sealed = true
		r.persistenceErr = e
		claimErr = errors.Join(claimErr, e)
	}
	approvedUntil, _ := time.Parse(time.RFC3339Nano, c.ExpiresAt)
	if claimErr == nil {
		r.authorizedJobs[w.Job] = approvedUntil
	}
	returned := cloneRecord(rec)
	r.mu.Unlock()
	if claimErr != nil {
		jobCancel()
		_, _ = r.drainOriginalClaim(opCtx, w.Job)
		return returned, claimErr
	}
	ownedSlot = false
	go r.runOriginal(jobCtx, jobCancel, op, w, bytes.Clone(input), b.cpu, claim)
	return returned, nil
}

func (r *Runner) runOriginal(ctx context.Context, cancel context.CancelFunc, op *operation, w Work, input []byte, cpu uint64, claim originalClaim) {
	defer cancel()
	defer r.finishOriginalSlot(op)
	monitorDone := make(chan struct{})
	monitorCtx, stopMonitor := context.WithCancel(ctx)
	go func() {
		defer close(monitorDone)
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-monitorCtx.Done():
				return
			case <-ticker.C:
				if claim.CurrentNoIO() != nil {
					op.cancel()
					return
				}
			}
		}
	}()
	output, usage, runErr := r.executor.Execute(ctx, input, w.Limits)
	stopMonitor()
	<-monitorDone
	var independent []byte
	var checkUsage Usage
	if runErr == nil {
		independent, checkUsage, runErr = independentHistogram(ctx, input, cpu)
		if runErr == nil && (len(output) != HistogramOutputBytes || !bytes.Equal(output, independent)) {
			runErr = ErrInvalid
		}
	}
	if runErr == nil {
		runErr = r.original.source.Current(ctx)
	} // outside original Store lock
	r.mu.Lock()
	rec := r.data.Jobs[w.Job]
	rec.Usage.BytesRead += usage.BytesRead + checkUsage.BytesRead
	rec.Usage.WallMicros += usage.WallMicros + checkUsage.WallMicros
	rec.Usage.Process = cloneProcessUsage(usage.Process)
	if runErr == nil {
		runErr = ctx.Err()
	}
	if runErr == nil && (r.sealed || r.closed) {
		runErr = ErrStopped
	}
	if runErr == nil {
		runErr = claim.CurrentNoIO()
	} // final synchronous Store fence
	if runErr != nil {
		rec.State = "stopped"
		rec.Failure = runErr.Error()
		originalFirst(rec.Original, runErr)
	} else {
		rec.Result = Result{Job: w.Job, Manifest: rec.Manifest, Input: w.Input, Output: Bind(independent)}
		n, _ := strictUint(w.Input.Bytes)
		rec.Receipt = &Receipt{ID: "source:" + w.Job, Job: w.Job, Class: OriginalLocalClass, Result: rec.Result, VerifiedBytes: n, VerifiedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		rec.State = "verified"
	}
	r.data.Jobs[w.Job] = rec
	if e := r.persist(); e != nil {
		rec.State = "unknown"
		originalFirst(rec.Original, e)
		rec.Failure = e.Error()
		r.data.Jobs[w.Job] = rec
		r.sealed = true
		r.persistenceErr = e
	}
	r.mu.Unlock()
	// Completion of a Native FD close is separately tracked from task/result
	// commitment. A timed-out/partial close retains the original handle and
	// first cause; it does not mint a new claim or rerun a worker.
	drainCtx, drainCancel := context.WithTimeout(context.Background(), time.Second)
	_, _ = r.drainOriginalClaim(drainCtx, w.Job)
	drainCancel()
}
