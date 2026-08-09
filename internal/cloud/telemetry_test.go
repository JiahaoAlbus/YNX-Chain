package cloud

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTelemetryIntegrityAndAlertEvaluation(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "telemetry.json")
	state := newTelemetryState(now)
	state.Routes["GET /api/v1/objects"] = routeTelemetry{Requests: 20, Errors: 2, LatencyBuckets: map[string]int64{"le_2500ms": 20}}
	state.Rejections["backpressure"] = 1
	if err := saveTelemetry(path, &state); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadTelemetry(path, now.Add(time.Minute))
	if err != nil || loaded.Routes["GET /api/v1/objects"].Requests != 20 {
		t.Fatalf("load telemetry: %#v %v", loaded, err)
	}
	alerts := evaluateAlerts(loaded, true)
	active := map[string]bool{}
	for _, alert := range alerts {
		active[alert.ID] = alert.Active
	}
	if !active["route-error-rate:GET /api/v1/objects"] || !active["route-p95-latency:GET /api/v1/objects"] || !active["backpressure"] {
		t.Fatalf("alerts: %#v", alerts)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	body = bytes.Replace(body, []byte(`"requests": 20`), []byte(`"requests": 21`), 1)
	if err = os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = loadTelemetry(path, now); err == nil {
		t.Fatal("tampered telemetry accepted")
	}
}
