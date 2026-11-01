package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestP04UsageDocker28FrameKeepsOriginalInstanceFence(t *testing.T) {
	// PUBLIC inspection fixture, real private Unix HTTP metric transport. The
	// positive real Docker28 response is separately exercised in actual OCI CI.
	m := publicIDEOCIFixture(t)
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	r, err := readIDECreatedRecord(filepath.Join(m.e.cfg.StorageRoot, "resource-"+productHash([]byte(m.p.ResourceID))+".json"))
	if err != nil {
		t.Fatal(err)
	}
	base := os.Getenv("YNX_CLOUD_UNIX_QA_TMP")
	if base == "" {
		base = os.TempDir()
	}
	root, err := os.MkdirTemp(base, "p04-metric-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	socket := filepath.Join(root, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var mode atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		if q.Method != "GET" || q.URL.Path != "/containers/"+r.Operation.DeploymentID+"/stats" {
			http.NotFound(w, q)
			return
		}
		frame := map[string]any{"read": time.Now().UTC(), "cpu_stats": map[string]any{"cpu_usage": map[string]any{"total_usage": 12000000}}, "memory_stats": map[string]any{"usage": 4096}}
		if mode.Load() == 1 {
			frame["id"] = strings.Repeat("9", 64)
		}
		if mode.Load() == 2 {
			delete(frame, "memory_stats")
		}
		json.NewEncoder(w).Encode(frame)
	})}
	go server.Serve(listener)
	defer server.Close()
	m.e.cfg.Socket = socket
	before := len(m.calls)
	sample, err := m.e.ObserveUsage(context.Background(), r.Operation)
	if err != nil || sample.InstanceID != r.Operation.DeploymentID || sample.CPUms != "12" || sample.MemoryBytes != "4096" {
		t.Fatal("actual absent-id schema not bound to original", sample, err)
	}
	if len(m.calls)-before != 2 {
		t.Fatal("metric sample not surrounded by both original inspections")
	}
	mode.Store(1)
	if _, err = m.e.ObserveUsage(context.Background(), r.Operation); err == nil {
		t.Fatal("different explicit stats instance accepted")
	}
	mode.Store(2)
	if _, err = m.e.ObserveUsage(context.Background(), r.Operation); err == nil {
		t.Fatal("missing actual memory counter invented")
	}
}
