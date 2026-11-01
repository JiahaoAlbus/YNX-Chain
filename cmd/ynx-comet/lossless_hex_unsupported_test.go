//go:build !linux || !ynx_lossless_hex

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestOperatorLosslessHexUnsupportedSourceRefusesBeforeState(t *testing.T) {
	root := wireObservationTestDir(t)
	p := pqOptions{recoveryFD: -1, mempoolLosslessHex: "on", state: filepath.Join(root, "original-state")}
	if err := runPQNode(&cobra.Command{}, p); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatal("ON fell through to stock or silently remained OFF", err)
	}
	for _, path := range []string{p.state, p.state + ".writer.lock"} {
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			t.Fatal("unsupported source mutated state", err)
		}
	}
}
