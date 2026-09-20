package faucet

import (
	"context"
	"fmt"
	"time"
)

const publicHealthFreshness = 20 * time.Second

type healthFlight struct {
	done   chan struct{}
	result Health
}

type healthProbeStats struct {
	probes, failures, joined uint64
	last                     Health
}

// MonitorHealth keeps the metrics snapshot fresh without relying on a public
// caller. It performs only the same bounded read-only probe used by /health.
func (s *Service) MonitorHealth(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		_ = s.CheckHealth(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
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

// RecentHealth returns only a bounded background snapshot. The public endpoint
// can therefore stay responsive during a slow Core persistence cycle without
// claiming an indefinitely stale success. Startup and stale snapshots fall back
// to a real bounded probe in the handler.
func (s *Service) RecentHealth(maxAge time.Duration) (Health, bool) {
	s.healthMu.Lock()
	h := s.healthStats.last
	s.healthMu.Unlock()
	if h.CheckedAt.IsZero() {
		return Health{}, false
	}
	age := time.Since(h.CheckedAt)
	if age < 0 {
		age = 0
	}
	if maxAge <= 0 || age > maxAge {
		return Health{}, false
	}
	h.ProbeCached = true
	h.SnapshotAgeMS = age.Milliseconds()
	return h, true
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
	var ready, admissionReady, upstreamReady, balanceApplicable, checked float64
	if stats.last.FundingReady {
		ready = 1
	}
	if stats.last.AdmissionReady {
		admissionReady = 1
	}
	if stats.last.UpstreamOK {
		upstreamReady = 1
	}
	if stats.last.FundingBalanceApplicable {
		balanceApplicable = 1
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
# HELP ynx_faucet_health_status_duration_seconds Last upstream status stage duration.
# TYPE ynx_faucet_health_status_duration_seconds gauge
ynx_faucet_health_status_duration_seconds %.3f
# HELP ynx_faucet_health_capability_duration_seconds Last capability stage duration.
# TYPE ynx_faucet_health_capability_duration_seconds gauge
ynx_faucet_health_capability_duration_seconds %.3f
# HELP ynx_faucet_health_admission_duration_seconds Last admission store readiness stage duration.
# TYPE ynx_faucet_health_admission_duration_seconds gauge
ynx_faucet_health_admission_duration_seconds %.3f
# HELP ynx_faucet_health_funding_duration_seconds Last account funding stage duration; zero for protocol authority mode.
# TYPE ynx_faucet_health_funding_duration_seconds gauge
ynx_faucet_health_funding_duration_seconds %.3f
# HELP ynx_faucet_upstream_ready Last upstream network and capability readiness.
# TYPE ynx_faucet_upstream_ready gauge
ynx_faucet_upstream_ready %.0f
# HELP ynx_faucet_admission_ready Last durable admission store readiness.
# TYPE ynx_faucet_admission_ready gauge
ynx_faucet_admission_ready %.0f
# HELP ynx_faucet_funding_ready Last end-to-end funding readiness.
# TYPE ynx_faucet_funding_ready gauge
ynx_faucet_funding_ready %.0f
# HELP ynx_faucet_funding_balance_applicable Whether funding uses a finite account balance.
# TYPE ynx_faucet_funding_balance_applicable gauge
ynx_faucet_funding_balance_applicable %.0f
# HELP ynx_faucet_funding_balance_ynxt Last finite funding account balance; interpret only when applicable is 1.
# TYPE ynx_faucet_funding_balance_ynxt gauge
ynx_faucet_funding_balance_ynxt %.0f
`, stats.probes, stats.failures, stats.joined, ready, checked, float64(stats.last.ProbeDurationMS)/1000,
		float64(stats.last.StatusDurationMS)/1000, float64(stats.last.CapabilityDurationMS)/1000,
		float64(stats.last.AdmissionDurationMS)/1000, float64(stats.last.FundingDurationMS)/1000,
		upstreamReady, admissionReady, ready, balanceApplicable, float64(stats.last.FundingBalanceYNXT))
}
