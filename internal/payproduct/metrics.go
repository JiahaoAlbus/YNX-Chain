package payproduct

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

var runtimeDurationBounds = [...]time.Duration{
	5 * time.Millisecond,
	25 * time.Millisecond,
	100 * time.Millisecond,
	500 * time.Millisecond,
	2 * time.Second,
	10 * time.Second,
}

type RuntimeMetrics struct {
	mu       sync.Mutex
	started  time.Time
	requests map[string]*runtimeRequestMetric
}

type runtimeRequestMetric struct {
	Method          string
	Route           string
	Status          int
	Count           uint64
	ResponseBytes   uint64
	DurationTotalUS uint64
	DurationMaxUS   uint64
	DurationBuckets [len(runtimeDurationBounds) + 1]uint64
}

type RuntimeMetricsSnapshot struct {
	SchemaVersion int                      `json:"schemaVersion"`
	Source        string                   `json:"source"`
	StartedAt     time.Time                `json:"startedAt"`
	AsOf          time.Time                `json:"asOf"`
	Requests      []RuntimeRequestSnapshot `json:"requests"`
}

type RuntimeRequestSnapshot struct {
	Method          string            `json:"method"`
	Route           string            `json:"route"`
	Status          int               `json:"status"`
	Count           uint64            `json:"count"`
	ResponseBytes   uint64            `json:"responseBytes"`
	DurationTotalUS uint64            `json:"durationTotalUs"`
	DurationMaxUS   uint64            `json:"durationMaxUs"`
	DurationBuckets map[string]uint64 `json:"durationBuckets"`
}

func NewRuntimeMetrics() *RuntimeMetrics {
	return &RuntimeMetrics{started: time.Now().UTC(), requests: make(map[string]*runtimeRequestMetric)}
}

func (m *RuntimeMetrics) Observe(method, route string, status, responseBytes int, duration time.Duration) {
	if route == "" {
		route = "unmatched"
	}
	key := fmt.Sprintf("%s\x00%s\x00%d", method, route, status)
	durationUS := uint64(max(duration.Microseconds(), 0))
	bytes := uint64(max(responseBytes, 0))
	m.mu.Lock()
	defer m.mu.Unlock()
	metric := m.requests[key]
	if metric == nil {
		metric = &runtimeRequestMetric{Method: method, Route: route, Status: status}
		m.requests[key] = metric
	}
	metric.Count++
	metric.ResponseBytes += bytes
	metric.DurationTotalUS += durationUS
	if durationUS > metric.DurationMaxUS {
		metric.DurationMaxUS = durationUS
	}
	bucket := len(runtimeDurationBounds)
	for index, bound := range runtimeDurationBounds {
		if duration <= bound {
			bucket = index
			break
		}
	}
	metric.DurationBuckets[bucket]++
}

func (m *RuntimeMetrics) Snapshot(asOf time.Time) RuntimeMetricsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := RuntimeMetricsSnapshot{SchemaVersion: 1, Source: "direct-process-observation", StartedAt: m.started, AsOf: asOf, Requests: make([]RuntimeRequestSnapshot, 0, len(m.requests))}
	for _, metric := range m.requests {
		buckets := make(map[string]uint64, len(metric.DurationBuckets))
		for index, count := range metric.DurationBuckets {
			label := ">10000ms"
			if index < len(runtimeDurationBounds) {
				label = "<=" + fmt.Sprint(runtimeDurationBounds[index].Milliseconds()) + "ms"
			}
			buckets[label] = count
		}
		out.Requests = append(out.Requests, RuntimeRequestSnapshot{Method: metric.Method, Route: metric.Route, Status: metric.Status, Count: metric.Count, ResponseBytes: metric.ResponseBytes, DurationTotalUS: metric.DurationTotalUS, DurationMaxUS: metric.DurationMaxUS, DurationBuckets: buckets})
	}
	sort.Slice(out.Requests, func(i, j int) bool {
		left, right := out.Requests[i], out.Requests[j]
		if left.Route != right.Route {
			return left.Route < right.Route
		}
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		return left.Status < right.Status
	})
	return out
}
