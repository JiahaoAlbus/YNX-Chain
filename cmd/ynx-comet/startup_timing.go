package main

import (
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/spf13/pflag"
)

// This optional stderr stream observes existing calls. It does not select a
// source, establish readiness, or change a failed call into a retry. In
// particular an unmatched begin record means UNKNOWN, never zero elapsed.
const operatorStartupTimingVersion = "YNX-COMET-STARTUP-TIMING/v1"

type operatorStartupTimingEvent struct {
	Version          string `json:"version"`
	Clock            string `json:"clock"`
	Stage            string `json:"stage"`
	Event            string `json:"event"`
	Outcome          string `json:"outcome"`
	ElapsedNS        int64  `json:"elapsedNs"`
	StartupElapsedNS int64  `json:"startupElapsedNs"`
}
type operatorStartupTimings struct {
	mu      sync.Mutex
	out     io.Writer
	started time.Time
	failed  bool
}

func registerStartupTimingFlags(f *pflag.FlagSet, p *pqOptions) {
	f.BoolVar(&p.startupTimings, "startup-timings", false, "optional public elapsed stage JSONL on stderr; no readiness or authority claim")
}
func newOperatorStartupTimings(enabled bool, out io.Writer) *operatorStartupTimings {
	if !enabled {
		return nil
	}
	return &operatorStartupTimings{out: out, started: time.Now()}
}
func (s *operatorStartupTimings) emit(stage, event, outcome string, elapsed time.Duration) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failed || s.out == nil {
		return
	}
	v := operatorStartupTimingEvent{Version: operatorStartupTimingVersion, Clock: "monotonic_elapsed_wall_ns", Stage: stage, Event: event, Outcome: outcome, ElapsedNS: elapsed.Nanoseconds(), StartupElapsedNS: time.Since(s.started).Nanoseconds()}
	// A broken diagnostic sink cannot change lifecycle, the original error,
	// credentials, or an uncertain operation. Disable it without retrying.
	if json.NewEncoder(s.out).Encode(v) != nil {
		s.failed = true
	}
}
func (s *operatorStartupTimings) begin(stage string) func(error) {
	if s == nil {
		return func(error) {}
	}
	start := time.Now()
	s.emit(stage, "begin", "RUNNING", 0)
	return func(err error) {
		outcome := "SUCCEEDED"
		if err != nil {
			outcome = "REFUSED_OR_UNKNOWN"
		}
		s.emit(stage, "end", outcome, time.Since(start))
	}
}
func timedOperatorStartupValue[T any](s *operatorStartupTimings, stage string, call func() (T, error)) (value T, err error) {
	done := s.begin(stage)
	value, err = call()
	done(err)
	return
}
func timedOperatorStartupCall(s *operatorStartupTimings, stage string, call func() error) error {
	_, err := timedOperatorStartupValue(s, stage, func() (struct{}, error) { return struct{}{}, call() })
	return err
}

// Keep an explicit stock-mode refusal. Timing alone must not silently select
// a different application or permit an unbound consensus constructor.
func (p pqOptions) validateStartupTimings() error {
	if p.startupTimings && (p.migration == "" || p.state == "" || p.genesisHash == "" || p.originalGenesisHash == "" || p.migrationHash == "") {
		return errors.New("startup timings require the complete original operator source pins")
	}
	return nil
}
