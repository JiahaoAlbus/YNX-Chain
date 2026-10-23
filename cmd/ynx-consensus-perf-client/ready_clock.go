package main

import (
	"math"
	"strconv"
	"time"
)

// Native streaming only; fixed-size coverage of the real offered/submitted and
// terminal-hand-back clocks, not a trace or a consensus finality claim.
type readyClientClockReport struct {
	OriginUnixNs          string `json:"originUnixNs"`
	Samples               uint64 `json:"samples"`
	InvalidSamples        uint64 `json:"invalidSamples"`
	MaximumAbsWallDriftNs int64  `json:"maximumAbsWallDriftNs"`
	Valid                 bool   `json:"valid"`
	DriftWithin1ms        bool   `json:"driftWithin1ms"`
}

func (s *readyTimeSeries) sampleClientClock(wall, monotonic time.Time) {
	if wall.IsZero() || monotonic.IsZero() || s.start.IsZero() || wall.UnixNano() != monotonic.UnixNano() {
		s.clockInvalid++
		return
	}
	drift := wall.UnixNano() - s.start.UnixNano() - monotonic.Sub(s.start).Nanoseconds()
	if drift == math.MinInt64 {
		s.clockInvalid++
		return
	}
	if drift < 0 {
		drift = -drift
	}
	s.clockSamples++
	if drift > s.clockMaximumAbsDrift {
		s.clockMaximumAbsDrift = drift
	}
}
func (s *readyTimeSeries) clientClockReport() *readyClientClockReport {
	valid := s.clockInvalid == 0 && s.clockSamples > 0
	return &readyClientClockReport{OriginUnixNs: strconv.FormatInt(s.start.UnixNano(), 10), Samples: s.clockSamples, InvalidSamples: s.clockInvalid, MaximumAbsWallDriftNs: s.clockMaximumAbsDrift, Valid: valid, DriftWithin1ms: valid && s.clockMaximumAbsDrift <= 1000000}
}
