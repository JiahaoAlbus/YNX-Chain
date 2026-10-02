package social

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestActualStateCheckCLIUpgradeRecoveryAndReadOnlyGate(t *testing.T) {
	s, _ := testService(t)
	actor := newFixture(t, 139)
	id, err := s.publicIdentity(actor.account)
	if err != nil {
		t.Fatal(err)
	}
	legacy := cloneState(s.state)
	legacy.SchemaVersion = 5
	legacy.AudiencePolicyRevision = 0
	if err := saveState(s.cfg.StatePath, &legacy, s.cfg.TokenKey); err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(t.TempDir(), "synthetic-key")
	if err := os.WriteFile(keyPath, s.cfg.TokenKey, 0o600); err != nil {
		t.Fatal(err)
	}
	run := func(reader, action string, stopped bool) ([]byte, error) {
		args := []string{"run", "./apps/social/tools/state-check", "--state-file", s.cfg.StatePath, "--integrity-key-file", keyPath, "--target-reader-schema", reader, "--action", action}
		if stopped {
			args = append(args, "--writer-stopped")
		}
		command := exec.Command("go", args...)
		command.Dir = filepath.Join("..", "..")
		return command.CombinedOutput()
	}
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if output, err := run("5", "check", false); err == nil {
		t.Fatalf("incompatible reader gate passed: %s", output)
	}
	if output, err := run("6", "check", false); err != nil || !bytes.Contains(output, []byte(`"storedSchema":5`)) {
		t.Fatalf("compatible read-only check failed: %s %v", output, err)
	}
	if _, err := run("7", "upgrade", false); err == nil {
		t.Fatal("upgrade ran without explicit stopped-writer assertion")
	}
	unchanged, _ := os.ReadFile(s.cfg.StatePath)
	if !bytes.Equal(before, unchanged) {
		t.Fatal("read-only/refused operation changed state")
	}
	if output, err := run("7", "upgrade", true); err != nil || !bytes.Contains(output, []byte(`"storedSchema":7`)) {
		t.Fatalf("actual CLI upgrade failed: %s %v", output, err)
	}
	upgraded, _ := os.ReadFile(s.cfg.StatePath)
	if output, err := run("7", "recover", true); err != nil {
		t.Fatalf("actual CLI recovery failed: %s %v", output, err)
	}
	recovered, _ := os.ReadFile(s.cfg.StatePath)
	if !bytes.Equal(upgraded, recovered) {
		t.Fatal("recovery replaced current file bytes")
	}
	restarted, err := New(s.cfg)
	if err != nil || restarted.state.PublicIdentities[actor.account] != id {
		t.Fatal("CLI changed opaque binding")
	}
}
