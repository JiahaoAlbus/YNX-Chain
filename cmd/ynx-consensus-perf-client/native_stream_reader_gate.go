package main

import "time"

// ReaderGate measures the existing outer serialization, not the decoder's inner
// prefix gate. Totals are wall nanoseconds; parallel callers' wait totals may
// exceed the workload window. Hold includes nested load/hash/decode/replay/index
// and transaction checks; these are not independent additive stages.
// Only explicit native streaming construction enables this fixed-size record.
type durableReaderGateStats struct {
	Acquisitions uint64 `json:"acquisitions"`
	WaitNs       int64  `json:"waitNs"`
	MaxWaitNs    int64  `json:"maxWaitNs"`
	HoldNs       int64  `json:"holdNs"`
	MaxHoldNs    int64  `json:"maxHoldNs"`
}

func (r *durableReader) lockProfileReadback() func() {
	if r.readerGate == nil {
		r.profileMu.Lock()
		return r.profileMu.Unlock
	}
	began := time.Now()
	r.profileMu.Lock()
	held := time.Now()
	waited := held.Sub(began).Nanoseconds()
	gate := r.readerGate
	gate.Acquisitions++
	gate.WaitNs += waited
	if waited > gate.MaxWaitNs {
		gate.MaxWaitNs = waited
	}
	return func() {
		elapsed := time.Since(held).Nanoseconds()
		gate.HoldNs += elapsed
		if elapsed > gate.MaxHoldNs {
			gate.MaxHoldNs = elapsed
		}
		r.profileMu.Unlock()
	}
}
