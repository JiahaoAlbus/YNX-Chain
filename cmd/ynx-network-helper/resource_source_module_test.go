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

// Keep the new owner lifecycle regressions in the existing helper CI entry.
func TestP09ResourceSourceOwnerModule(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-mod=readonly", "-p", "1", "-race", "./apps/network/resourceauthority", "-count=1")
	cmd.Dir = "../.."
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("original Source owner lifecycle: %v %s", err, out)
	}
}
