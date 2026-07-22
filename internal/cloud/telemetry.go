package cloud

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

const telemetrySchemaVersion = 1

var latencyBoundsMillis = []int64{10, 50, 100, 250, 500, 1000, 2500, 5000}

type routeTelemetry struct {
	Requests           int64            `json:"requests"`
	Errors             int64            `json:"errors"`
	ResponseBytes      int64            `json:"responseBytes"`
	TotalLatencyMillis int64            `json:"totalLatencyMillis"`
	LatencyBuckets     map[string]int64 `json:"latencyBuckets"`
}

type traceRecord struct {
	TraceID       string    `json:"traceId"`
	RequestID     string    `json:"requestId"`
	ErrorID       string    `json:"errorId,omitempty"`
	Method        string    `json:"method"`
	Route         string    `json:"route"`
	Status        int       `json:"status"`
	ResponseBytes int       `json:"responseBytes"`
	StartedAt     time.Time `json:"startedAt"`
	DurationMs    int64     `json:"durationMs"`
}

type telemetryState struct {
	SchemaVersion int                       `json:"schemaVersion"`
	FirstObserved time.Time                 `json:"firstObservedAt"`
	UpdatedAt     time.Time                 `json:"updatedAt"`
	Routes        map[string]routeTelemetry `json:"routes"`
	Rejections    map[string]int64          `json:"rejections"`
	RecentTraces  []traceRecord             `json:"recentTraces"`
	IntegrityHash string                    `json:"integrityHash"`
}

type alertState struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Active   bool   `json:"active"`
	Evidence string `json:"evidence"`
}

func newTelemetryState(now time.Time) telemetryState {
	return telemetryState{SchemaVersion: telemetrySchemaVersion, FirstObserved: now, UpdatedAt: now, Routes: map[string]routeTelemetry{}, Rejections: map[string]int64{}, RecentTraces: []traceRecord{}}
}

func telemetryIntegrity(state telemetryState) (string, error) {
	state.IntegrityHash = ""
	body, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

func loadTelemetry(path string, now time.Time) (telemetryState, error) {
	body, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newTelemetryState(now), nil
	}
	if err != nil {
		return telemetryState{}, err
	}
	var state telemetryState
	if json.Unmarshal(body, &state) != nil || state.SchemaVersion != telemetrySchemaVersion || state.IntegrityHash == "" {
		return telemetryState{}, errors.New("telemetry schema or integrity is invalid")
	}
	want, err := telemetryIntegrity(state)
	if err != nil || want != state.IntegrityHash {
		return telemetryState{}, errors.New("telemetry integrity verification failed")
	}
	if state.Routes == nil {
		state.Routes = map[string]routeTelemetry{}
	}
	if state.Rejections == nil {
		state.Rejections = map[string]int64{}
	}
	if state.RecentTraces == nil {
		state.RecentTraces = []traceRecord{}
	}
	return state, nil
}

func saveTelemetry(path string, state *telemetryState) error {
	hash, err := telemetryIntegrity(*state)
	if err != nil {
		return err
	}
	state.IntegrityHash = hash
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err = file.Write(body); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err = file.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if dir, openErr := os.Open(filepath.Dir(path)); openErr == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

func latencyBucket(milliseconds int64) string {
	for _, bound := range latencyBoundsMillis {
		if milliseconds <= bound {
			return "le_" + strconv.FormatInt(bound, 10) + "ms"
		}
	}
	return "le_inf"
}

func percentileFromBuckets(metric routeTelemetry, percentile float64) int64 {
	if metric.Requests == 0 {
		return 0
	}
	target := int64(float64(metric.Requests)*percentile + .999999)
	var cumulative int64
	for _, bound := range latencyBoundsMillis {
		cumulative += metric.LatencyBuckets["le_"+strconv.FormatInt(bound, 10)+"ms"]
		if cumulative >= target {
			return bound
		}
	}
	return latencyBoundsMillis[len(latencyBoundsMillis)-1] + 1
}

func evaluateAlerts(state telemetryState, persistenceHealthy bool) []alertState {
	alerts := []alertState{{ID: "telemetry-persistence", Severity: "critical", Active: !persistenceHealthy, Evidence: "integrity-checked telemetry state must remain writable"}}
	keys := make([]string, 0, len(state.Routes))
	for key := range state.Routes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		metric := state.Routes[key]
		if metric.Requests >= 20 {
			errorRate := float64(metric.Errors) / float64(metric.Requests)
			alerts = append(alerts, alertState{ID: "route-error-rate:" + key, Severity: "critical", Active: errorRate > .05, Evidence: "errors/requests > 5% over persistent observations"})
			alerts = append(alerts, alertState{ID: "route-p95-latency:" + key, Severity: "warning", Active: percentileFromBuckets(metric, .95) > 1000, Evidence: "bounded histogram p95 > 1000ms over persistent observations"})
		}
	}
	alerts = append(alerts, alertState{ID: "backpressure", Severity: "warning", Active: state.Rejections["backpressure"] > 0, Evidence: "one or more fail-fast concurrency rejections observed"})
	return alerts
}
