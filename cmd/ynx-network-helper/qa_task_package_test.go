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

func TestP09TaskWorkerNativePackagePin(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Cocoa package contract requires macOS, no GUI fallback")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "task-package-contract")
	qa := filepath.Join(root, "apps/network/qa")
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	compile := exec.CommandContext(ctx, "xcrun", "--sdk", "macosx", "clang", "-mmacosx-version-min=12.0", "-fobjc-arc", "-Wno-deprecated-declarations", "-framework", "Cocoa", "-framework", "WebKit", filepath.Join(qa, "task_package_test.m"), filepath.Join(qa, "proof_profile.m"), "-o", binary)
	compile.Env = os.Environ()
	if out, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("actual native package pin compile: %v\n%s", err, out)
	}
	run := exec.CommandContext(ctx, binary, dir)
	if out, err := run.CombinedOutput(); err != nil {
		t.Fatalf("actual package pin contract: %v\n%s", err, out)
	} else {
		t.Logf("%s", out)
	}
}

// The root ./cmd/... CI discovery explicitly closes the nested runtime test
// gap; it does not claim go test ./... discovers nested modules automatically.
func TestP09FixedWASMModuleContract(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-mod=readonly", "-p", "1", ".")
	cmd.Dir = "../../apps/network/wasmworker"
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2")
	if cache := os.Getenv("YNX_NETWORK_WORKER_GOMODCACHE"); cache != "" {
		cmd.Env = append(cmd.Env, "GOMODCACHE="+cache)
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("actual nested WASM module: %v\n%s", err, out)
	} else {
		t.Logf("%s", out)
	}
}
