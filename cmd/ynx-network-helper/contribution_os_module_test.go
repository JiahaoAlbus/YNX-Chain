package main_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// Register only the new OS-control module with the existing cmd CI. This
// target does not rerun the pre-existing WASM interpreter/CLI test group.
func TestP09DarwinWorkerOSLimitModule(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Darwin child limits require macOS")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-mod=readonly", "-p", "1", "./internal/oslimits", "-count=1", "-v")
	cmd.Dir = "../../apps/network/wasmworker"
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2")
	if cache := os.Getenv("YNX_NETWORK_WORKER_GOMODCACHE"); cache != "" {
		cmd.Env = append(cmd.Env, "GOMODCACHE="+cache)
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("actual worker OS module: %v %s", err, out)
	} else {
		t.Logf("%s", out)
	}
}
