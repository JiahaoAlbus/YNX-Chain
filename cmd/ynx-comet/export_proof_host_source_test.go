//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportProofHostSourceNormalCommandStrictArguments(t *testing.T) {
	for _, args := range [][]string{
		{}, {"--source-plan", "/missing"},
		{"--source-plan", "/missing", "--source-plan", "/replacement", "--source-plan-sha256", strings.Repeat("1", 64), "--output", "/missing/output"},
		{"--source-plan", "", "--source-plan-sha256", strings.Repeat("1", 64), "--output", "/missing/output"},
		{"--source-plan", "/missing", "--source-plan-sha256", strings.Repeat("1", 64), "--output", "/missing/output", "--trust-root", "self"},
	} {
		t.Run(strings.Join(args, "_"), func(t *testing.T) {
			cmd := newExportProofHostSourceCommand()
			var out bytes.Buffer
			cmd.SetOut(&out)
			cmd.SetErr(&out)
			cmd.SetArgs(args)
			if err := cmd.Execute(); err == nil {
				t.Fatal("incomplete, duplicate or unknown operator flags accepted")
			}
			if strings.Contains(out.String(), "manifestSHA256") {
				t.Fatal("failed invocation emitted success")
			}
		})
	}
}

func TestExportProofHostSourceRejectsPlanBeforeOpeningStoresOrOutput(t *testing.T) {
	root := t.TempDir()
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "plan.json")
	original := []byte(`{"version":"unapproved"}`)
	if err = os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	for _, pin := range []string{strings.Repeat("1", 64), func() string { h := sha256.Sum256(original); return hex.EncodeToString(h[:]) }()} {
		cmd := newExportProofHostSourceCommand()
		var out bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetErr(&out)
		destination := filepath.Join(root, "delivery")
		cmd.SetArgs([]string{"--source-plan", path, "--source-plan-sha256", pin, "--output", destination})
		if err = cmd.Execute(); err == nil {
			t.Fatal("invalid independent plan accepted")
		}
		if _, err = os.Lstat(destination); !os.IsNotExist(err) {
			t.Fatal("failed preflight created/changed destination")
		}
		readback, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(readback, original) {
			t.Fatal("plan source changed")
		}
	}
}
