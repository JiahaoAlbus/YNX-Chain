package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunCreatesAndInspectsOwnerControlledKeyWithoutPrintingIt(t *testing.T) {
	root := t.TempDir()
	keyPath := filepath.Join(root, "owner.key")
	recordPath := filepath.Join(root, "public.json")
	var output bytes.Buffer
	purpose := "ynx-production-faucet-signer"
	if err := run("create", keyPath, recordPath, purpose, true, &output); err != nil {
		t.Fatal(err)
	}
	keyPayload, err := os.ReadFile(keyPath)
	if err != nil || len(keyPayload) != 32 {
		t.Fatal("owner key was not created as a raw scalar")
	}
	if strings.Contains(output.String(), string(keyPayload)) {
		t.Fatal("owner key bytes appeared in output")
	}
	info, err := os.Stat(keyPath)
	if err != nil || info.Mode().Perm()&0o077 != 0 {
		t.Fatal("owner key permissions are too broad")
	}
	var first publicRecord
	payload, _ := os.ReadFile(recordPath)
	if err := json.Unmarshal(payload, &first); err != nil || !strings.HasPrefix(first.Address, "0x") || first.Purpose != purpose {
		t.Fatal("public owner record is invalid")
	}
	output.Reset()
	if err := run("inspect", keyPath, recordPath, purpose, true, &output); err != nil {
		t.Fatal(err)
	}
	var second publicRecord
	payload, _ = os.ReadFile(recordPath)
	if err := json.Unmarshal(payload, &second); err != nil || second != first {
		t.Fatal("owner key inspection changed the public identity")
	}
	if err := run("create", keyPath, recordPath, purpose, true, &output); err == nil {
		t.Fatal("owner key creation overwrote an existing key")
	}
	if err := run("inspect", keyPath, recordPath, "ynx-unapproved-purpose", true, &output); err == nil {
		t.Fatal("unapproved key purpose unexpectedly passed")
	}
}
