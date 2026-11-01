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

func TestNetworkOriginalResourceCurrentModule(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-mod=readonly", "-p", "1", "-race", "./apps/network/contribution", "-run", "^TestOriginalResourceCurrent(DATA|ReaderLifetime)$", "-count=1")
	command.Dir = "../.."
	command.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2")
	if raw, err := command.CombinedOutput(); err != nil {
		t.Fatalf("original resource current producer: %v %s", err, raw)
	}
}
