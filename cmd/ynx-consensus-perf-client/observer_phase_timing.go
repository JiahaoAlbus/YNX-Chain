package main

import "time"

const observerTracePerWorker = 256
const observerTraceAggregate = 1024

type observerPhaseTotal struct {
	Attempts   uint64 `json:"attempts"`
	Errors     uint64 `json:"errors"`
	DurationNs int64  `json:"durationNs"`
}

type observerPhaseTrace struct {
	Sequence        uint64 `json:"sequence"`
	Worker          int    `json:"worker"`
	Phase           string `json:"phase"`
	Node            int    `json:"node"`
	Height          int64  `json:"height"`
	Members         int    `json:"members"`
	TransactionHash string `json:"transactionHash,omitempty"`
	StartOffsetNs   int64  `json:"startOffsetNs"`
	DurationNs      int64  `json:"durationNs"`
	Failed          bool   `json:"failed"`
}

// One observer goroutine owns this recorder. Aggregate only after workers exit.
// Totals cover all attempts; a bounded trace is explicitly marked when capped.
type observerPhaseTiming struct {
	Schema      int                           `json:"schema"`
	Totals      map[string]observerPhaseTotal `json:"totals"`
	Trace       []observerPhaseTrace          `json:"trace"`
	TraceCapped bool                          `json:"traceCapped"`
	worker      int
	sequence    uint64
	origin      time.Time
}

func (s *groupedObservationStats) enablePhaseTiming(worker int, origin time.Time) {
	s.Phases = &observerPhaseTiming{Schema: 1, Totals: make(map[string]observerPhaseTotal), worker: worker, origin: origin}
}

// Times exactly the existing call and its returned error, without retries or
// additional RPC. Local checks, RPC wall time and durable batches have disjoint
// labels; worker totals may overlap in wall time and are not finality latency.
func observedCall[T any](s *groupedObservationStats, phase string, node int, height int64, members int, hash string, call func() (T, error)) (T, error) {
	if s.Phases == nil {
		return call()
	}
	start := time.Now()
	value, err := call()
	elapsed := time.Since(start).Nanoseconds()
	p := s.Phases
	total := p.Totals[phase]
	total.Attempts++
	total.DurationNs += elapsed
	if err != nil {
		total.Errors++
	}
	p.Totals[phase] = total
	p.sequence++
	if len(p.Trace) < observerTracePerWorker {
		p.Trace = append(p.Trace, observerPhaseTrace{Sequence: p.sequence, Worker: p.worker, Phase: phase, Node: node, Height: height, Members: members, TransactionHash: hash, StartOffsetNs: start.Sub(p.origin).Nanoseconds(), DurationNs: elapsed, Failed: err != nil})
	} else {
		p.TraceCapped = true
	}
	return value, err
}

func observedCheck(s *groupedObservationStats, phase string, node int, height int64, members int, hash string, call func() error) error {
	_, err := observedCall(s, phase, node, height, members, hash, func() (struct{}, error) { return struct{}{}, call() })
	return err
}

func (s *groupedObservationStats) addPhaseTiming(other *observerPhaseTiming) {
	if other == nil {
		return
	}
	if s.Phases == nil {
		s.Phases = &observerPhaseTiming{Schema: 1, Totals: make(map[string]observerPhaseTotal)}
	}
	for phase, value := range other.Totals {
		total := s.Phases.Totals[phase]
		total.Attempts += value.Attempts
		total.Errors += value.Errors
		total.DurationNs += value.DurationNs
		s.Phases.Totals[phase] = total
	}
	s.Phases.TraceCapped = s.Phases.TraceCapped || other.TraceCapped
	for _, row := range other.Trace {
		if len(s.Phases.Trace) >= observerTraceAggregate {
			s.Phases.TraceCapped = true
			break
		}
		s.Phases.Trace = append(s.Phases.Trace, row)
	}
}
