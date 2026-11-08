//go:build linux

package securelink

import (
	"fmt"
	"io"
	"os"
	"testing"
)

func publicOriginalLocalCallerExpectedStart(t *testing.T, pid int) (uint32, uint64, uint64, uint32) {
	t.Helper()
	f, err := os.Open(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		t.Fatal(err)
	}
	raw, readErr := io.ReadAll(io.LimitReader(f, 8193))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || len(raw) >= 8193 {
		t.Fatalf("PUBLIC stat observation: read=%v close=%v", readErr, closeErr)
	}
	a, err := originalLocalCallerLinuxStart(raw, pid)
	if err != nil {
		t.Fatal(err)
	}
	return LocalCallerLinuxProcessStart, a, 0, uint32(os.Geteuid())
}
