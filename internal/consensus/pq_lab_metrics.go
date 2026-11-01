//go:build unix

package consensus

import (
	"sync"
	"time"
)

// PQLabMetrics reports measured wall-clock intervals at normal callee
// boundaries. Stages can nest: never add them to claim end-to-end latency.
// It carries no keys, messages, authorization, nonce or cached current state.
type PQLabMetrics struct {
	mu     sync.Mutex
	stages map[string]PQLabStageTiming
}
type PQLabStageTiming struct {
	Calls     uint64 `json:"calls"`
	ElapsedNS int64  `json:"elapsedNs"`
}
type PQLabMetricsSnapshot struct {
	Version          string                      `json:"version"`
	Clock            string                      `json:"clock"`
	IntervalsOverlap bool                        `json:"intervalsOverlap"`
	Stages           map[string]PQLabStageTiming `json:"stages"`
}

func pqLabMeasure(m *PQLabMetrics, stage string) func() {
	if m == nil {
		return func() {}
	}
	start := time.Now()
	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.stages == nil {
			m.stages = map[string]PQLabStageTiming{}
		}
		v := m.stages[stage]
		v.Calls++
		v.ElapsedNS += time.Since(start).Nanoseconds()
		m.stages[stage] = v
	}
}
func (m *PQLabMetrics) Snapshot() PQLabMetricsSnapshot {
	result := PQLabMetricsSnapshot{Version: "YNX-PQ-LAB-CALLEE-ELAPSED/v1", Clock: "monotonic_elapsed_wall_ns", IntervalsOverlap: true, Stages: map[string]PQLabStageTiming{}}
	if m == nil {
		return result
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, v := range m.stages {
		result.Stages[k] = v
	}
	return result
}
