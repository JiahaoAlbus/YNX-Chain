package consensus

import (
	"errors"
	"time"
)

// CommitTimingSample describes one local persistence attempt. Durable confirms
// only that this application finished its storage protocol; it is not BFT finality.
// No transaction bodies, account identities or keys are included.
type CommitTimingSample struct {
	Height       int64            `json:"height"`
	Storage      string           `json:"storage"`
	Durable      bool             `json:"durable"`
	ElapsedNs    int64            `json:"elapsedNs"`
	PayloadBytes int              `json:"payloadBytes"`
	StagesNs     map[string]int64 `json:"stagesNs"`
}

// SetCommitTimingEnabled enables bounded diagnostics of the existing Commit
// write path. It is off by default, does not change storage format or Sync calls,
// and retains only the latest attempt. Disabling discards the observation.
func (a *Application) SetCommitTimingEnabled(enabled bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.commitTimingEnabled = enabled
	a.commitTimingLatest = nil
	if !enabled {
		a.commitTimings = nil
		a.commitValidationTimingEnabled = false
	}
}

// LastCommitTiming returns an owned copy. A failed attempt replaces the prior
// successful observation; callers must check Durable, not infer success from Ns.
func (a *Application) LastCommitTiming() (CommitTimingSample, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.commitTimingLatest == nil {
		return CommitTimingSample{}, false
	}
	sample := *a.commitTimingLatest
	sample.StagesNs = make(map[string]int64, len(a.commitTimingLatest.StagesNs))
	for stage, ns := range a.commitTimingLatest.StagesNs {
		sample.StagesNs[stage] = ns
	}
	return sample, true
}

// CommitValidationTimingSample is a separate, local view of the existing
// validate stage. PhaseNs partitions that validation; the two hash intervals
// are CHILD intervals within app_hash and must not be added to PhaseNs.
// Valid concerns state validation only, never storage durability or finality.
// Fields are deliberately excluded from JSON: existing CommitTimingSample and
// its bounded public projection keep exactly their original wire shape.
type CommitValidationTimingSample struct {
	Height             int64            `json:"-"`
	Valid              bool             `json:"-"`
	ElapsedNs          int64            `json:"-"`
	FailedPhase        string           `json:"-"`
	PhaseNs            map[string]int64 `json:"-"`
	HashDocumentNs     int64            `json:"-"`
	HashEncodeDigestNs int64            `json:"-"`
}

// SetCommitValidationTimingEnabled explicitly opts into validation detail.
// Enabling requires the original Commit timing opt-in first. A change clears
// prior observations, so callers cannot mix attempts or configurations.
func (a *Application) SetCommitValidationTimingEnabled(enabled bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if enabled && !a.commitTimingEnabled {
		return errors.New("Commit timing must be enabled before validation detail")
	}
	a.commitValidationTimingEnabled = enabled
	a.commitTimingLatest = nil
	a.commitTimings = nil
	return nil
}

// LastCommitValidationTiming returns an owned copy for the SAME latest Commit
// attempt as LastCommitTiming. It also retains a failed validation's partial
// intervals and fixed phase name, without account data or error payloads.
func (a *Application) LastCommitValidationTiming() (CommitValidationTimingSample, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if !a.commitTimingEnabled || !a.commitValidationTimingEnabled || a.commitTimingLatest == nil || a.commitTimings == nil || a.commitTimings.validation == nil {
		return CommitValidationTimingSample{}, false
	}
	v := a.commitTimings.validation
	sample := CommitValidationTimingSample{Height: a.commitTimingLatest.Height, Valid: v.valid,
		ElapsedNs: v.elapsed.Nanoseconds(), FailedPhase: v.failedPhase,
		PhaseNs: make(map[string]int64, len(v.phases)), HashDocumentNs: v.hashDocument.Nanoseconds(), HashEncodeDigestNs: v.hashEncodeDigest.Nanoseconds()}
	for phase, duration := range v.phases {
		sample.PhaseNs[phase] = duration.Nanoseconds()
	}
	return sample, true
}

type commitValidationTimings struct {
	now                            func() time.Time // nil except deterministic owned tests
	started, phaseStarted          time.Time
	phase, failedPhase             string
	valid                          bool
	elapsed                        time.Duration
	phases                         map[string]time.Duration
	hashDocument, hashEncodeDigest time.Duration
}

func (t *commitValidationTimings) clock() time.Time {
	if t == nil {
		return time.Time{}
	}
	if t.now != nil {
		return t.now()
	}
	return time.Now()
}

func (t *commitValidationTimings) begin(phase string) {
	if t == nil {
		return
	}
	t.started = t.clock()
	t.phaseStarted, t.phase = t.started, phase
	t.phases = make(map[string]time.Duration)
}

func (t *commitValidationTimings) enter(phase string) {
	if t == nil {
		return
	}
	now := t.clock()
	t.phases[t.phase] += now.Sub(t.phaseStarted)
	t.phaseStarted, t.phase = now, phase
}

func (t *commitValidationTimings) finish(valid bool) {
	if t == nil {
		return
	}
	now := t.clock()
	t.phases[t.phase] += now.Sub(t.phaseStarted)
	t.elapsed, t.valid = now.Sub(t.started), valid
	if !valid {
		t.failedPhase = t.phase
	}
}

func (t *commitTimings) validateStateOwned(state CommittedState, witness *validatedMigration) error {
	if t == nil || !t.validationEnabled {
		return state.validateOwned(witness)
	}
	t.validation = &commitValidationTimings{now: t.validationClock}
	return state.validateOwnedWithTimings(witness, t.validation)
}
