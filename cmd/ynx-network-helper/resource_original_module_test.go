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

// Existing helper CI discovery includes only this new canonical/original Store
// delta. It does not rerun old Linux containment, Darwin or WASM green suites.
func TestP09OriginalResourceStoreModule(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-mod=readonly", "-p", "1", "-race", "./apps/network/contribution", "-run", "^TestOriginal", "-count=1", "-v")
	cmd.Dir = "../.."
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2")
	if out, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("original canonical Store/Native final-fence consumer: %v %s", e, out)
	} else {
		t.Logf("%s", out)
	}
}
