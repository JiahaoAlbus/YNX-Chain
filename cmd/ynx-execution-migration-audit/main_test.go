package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/executionstate"
)

func TestReadOnlyCLIAndBlockedExit(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "snapshot.json")
	original := []byte(`{"version":2,"secret":"do-not-print"}`)
	if e := os.WriteFile(p, original, 0600); e != nil {
		t.Fatal(e)
	}
	before, _ := os.Stat(p)
	var out bytes.Buffer
	if code := run([]string{"-input", p, "-source-family", "native-a-v2"}, &out); code != 2 {
		t.Fatalf("code %d %s", code, out.String())
	}
	after, _ := os.Stat(p)
	b, _ := os.ReadFile(p)
	if !bytes.Equal(b, original) || !before.ModTime().Equal(after.ModTime()) || before.Mode() != after.Mode() {
		t.Fatal("input changed")
	}
	if bytes.Contains(out.Bytes(), []byte("do-not-print")) || bytes.Contains(out.Bytes(), []byte(p)) {
		t.Fatal("report leaked input")
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 1 {
		t.Fatal("CLI wrote a file")
	}
}

func TestOversizeInputGetsWholeFileDigestWithoutClaimingSchemaChecks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.json")
	data := append([]byte(`{"secret":"never-echo","version":2}`), bytes.Repeat([]byte(" "), 2<<20)...)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	var out bytes.Buffer
	code := run([]string{"-input", path, "-max-parse-mib", "1", "-source-family", "native-baseline-v2", "-source-commit", "be9f03833ac3a7579bd96f22f6bf49f3d8dccc7b", "-sha256", hex.EncodeToString(sum[:])}, &out)
	var r executionstate.Report
	if err := json.Unmarshal(out.Bytes(), &r); err != nil {
		t.Fatal(err)
	}
	if code != 2 || r.Status != "blocked" || r.CompatibilityScope != "whole-file-byte-digest-only" || r.InputBytes != int64(len(data)) || !r.Verified.DigestMatchesDeclaration || r.Verified.SchemaVerified || r.Verified.FullModuleInventoryVerified || len(r.UnverifiedModules) != 40 || len(r.Modules) != 0 || r.MigrationSafe {
		t.Fatal(out.String())
	}
	if bytes.Contains(out.Bytes(), []byte("never-echo")) {
		t.Fatal("leaked input")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(after, data) {
		t.Fatal("input changed")
	}
}
func TestRejectDirectoryAndMissingInput(t *testing.T) {
	for _, args := range [][]string{nil, {"-input", t.TempDir()}, {"-input", "/nonexistent-preflight-fixture"}, {"-input", "unused", "-max-parse-mib", "0"}, {"-input", "unused", "-max-parse-mib", "1025"}} {
		var out bytes.Buffer
		if run(args, &out) != 1 {
			t.Fatal(out.String())
		}
	}
}
