package consensus

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
	// Nested children of validate, not additional elapsed work.
	ValidationStagesNs map[string]int64 `json:"validationStagesNs,omitempty"`
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
	if sample.ValidationStagesNs != nil {
		sample.ValidationStagesNs = make(map[string]int64, len(a.commitTimingLatest.ValidationStagesNs))
		for stage, ns := range a.commitTimingLatest.ValidationStagesNs {
			sample.ValidationStagesNs[stage] = ns
		}
	}
	return sample, true
}
