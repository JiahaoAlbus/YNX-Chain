package faucet

import (
	"context"
	"fmt"
)

type healthFlight struct {
	done   chan struct{}
	result Health
}

type healthProbeStats struct {
	probes, failures, joined uint64
	last                     Health
}

// CheckHealth coalesces only overlapping probes. No stale successful result is
// cached. A caller disconnect cannot cancel another caller's shared probe, and
// all upstream stages (including response bodies) share one bounded deadline.
// This read-only probe never retries or changes admission / transaction state.
func (s *Service) CheckHealth(ctx context.Context) Health {
	if ctx.Err() != nil {
		return s.canceledHealth(ctx)
	}
	s.healthMu.Lock()
	f := s.healthFlight
	if f == nil {
		f = &healthFlight{done: make(chan struct{})}
		s.healthFlight = f
		go func() {
			probeCtx, cancel := context.WithTimeout(context.Background(), s.cfg.HealthTimeout)
			defer cancel()
			result := s.probeHealth(probeCtx)
			s.healthMu.Lock()
			f.result = result
			s.healthStats.probes++
			if !result.FundingReady {
				s.healthStats.failures++
			}
			s.healthStats.last = result
			s.healthFlight = nil
			close(f.done)
			s.healthMu.Unlock()
		}()
	} else {
		s.healthStats.joined++
	}
	s.healthMu.Unlock()
	select {
	case <-ctx.Done():
		return s.canceledHealth(ctx)
	case <-f.done:
		return f.result
	}
}

func (s *Service) canceledHealth(ctx context.Context) Health {
	h := s.Health()
	h.OK = false
	h.LastError = ctx.Err().Error()
	h.ProbeFailureStage = "caller"
	return h
}

func (s *Service) healthMetrics() string {
	s.healthMu.Lock()
	stats := s.healthStats
	s.healthMu.Unlock()
	var ready, checked float64
	if stats.last.FundingReady {
		ready = 1
	}
	if !stats.last.CheckedAt.IsZero() {
		checked = float64(stats.last.CheckedAt.Unix())
	}
	return fmt.Sprintf(`# HELP ynx_faucet_health_probes_total Completed read-only upstream probes.
# TYPE ynx_faucet_health_probes_total counter
ynx_faucet_health_probes_total %d
# HELP ynx_faucet_health_failures_total Failed upstream probes.
# TYPE ynx_faucet_health_failures_total counter
ynx_faucet_health_failures_total %d
# HELP ynx_faucet_health_coalesced_total Callers joining an in-flight probe.
# TYPE ynx_faucet_health_coalesced_total counter
ynx_faucet_health_coalesced_total %d
# HELP ynx_faucet_health_ready Last probe readiness; inspect checked timestamp for freshness.
# TYPE ynx_faucet_health_ready gauge
ynx_faucet_health_ready %.0f
# HELP ynx_faucet_health_checked_timestamp_seconds Last completed probe time; zero means never probed.
# TYPE ynx_faucet_health_checked_timestamp_seconds gauge
ynx_faucet_health_checked_timestamp_seconds %.0f
# HELP ynx_faucet_health_duration_seconds Last complete probe duration.
# TYPE ynx_faucet_health_duration_seconds gauge
ynx_faucet_health_duration_seconds %.3f
`, stats.probes, stats.failures, stats.joined, ready, checked, float64(stats.last.ProbeDurationMS)/1000)
}
