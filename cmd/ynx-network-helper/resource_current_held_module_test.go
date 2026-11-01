package main

import (
	"context"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// The original cmd CI target includes the real held resource and kernel tests.
// No public issuer, Auth native capture, signing, funds, GUI or production grant.
func TestNetworkResourceCurrentHeldModule(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-mod=readonly", "-p", "1", "-race", "-count=1", "./apps/network/localipc", "./apps/network/contribution", "-run", "^TestResourceCurrent")
	command.Dir, _ = filepath.Abs("../..")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("original held Current kernel/reader tests: %s %v", output, err)
	} else {
		t.Logf("PUBLIC_CONTROLLED original Current held module: %s", output)
	}
}
