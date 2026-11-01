//go:build !linux

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/cobra"
)

// This verifies unsupported-platform behavior, not Linux endpoint capture.
func TestOperatorWireLiveUnsupportedPlatform(t *testing.T) {
	dir := wireObservationTestDir(t)
	control := filepath.Join(dir, "control")
	if err := os.Mkdir(control, 0700); err != nil {
		t.Fatal(err)
	}
	p := pqOptions{state: filepath.Join(dir, "state"), wireObservationOutput: filepath.Join(dir, "after-stop.json"), wireObservationScope: operatorWireObservationScope, wireObservationLiveControl: control}
	if err := runPQNode(&cobra.Command{}, p); err == nil {
		t.Fatal("unsupported live mode reached node construction")
	}
	cmd := newRequestWireObservationCommand()
	cmd.SetOut(io.Discard)
	cmd.SetErr(io.Discard)
	cmd.SetArgs([]string{"--control", control, "--phase", "before"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("unsupported normal request command claimed live evidence")
	}
	if _, err := operatorWireLiveProcessIdentity(); err == nil {
		t.Fatal("non-Linux process identity substituted")
	}
	if _, err := operatorWireLiveMonotonic(); err == nil {
		t.Fatal("non-Linux wall/process clock substituted")
	}
	if err := requestOperatorWireLive(context.Background(), control, "before", io.Discard); err == nil {
		t.Fatal("private caller silently fell back")
	}
	for _, path := range []string{p.state, p.state + ".writer.lock", p.wireObservationOutput} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("unsupported live request changed state/output", path, err)
		}
	}
	entries, err := os.ReadDir(control)
	if err != nil || len(entries) != 0 {
		t.Fatal("unsupported request wrote partial evidence", err)
	}
}
