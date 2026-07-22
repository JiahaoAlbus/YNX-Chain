package governance

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupRestorePreservesCurrentStateAndRejectsTamper(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	state := filepath.Join(t.TempDir(), "state.json")
	if err := service.Save(state, now); err != nil {
		t.Fatal(err)
	}
	backupDir := t.TempDir()
	record, err := Backup(state, backupDir, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(backupDir, record.Artifact)
	destination := filepath.Join(t.TempDir(), "restored.json")
	if err = service.Save(destination, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	preserved, err := Restore(backup, backup+".record.json", destination, service.policy, now.Add(3*time.Minute))
	if err != nil || preserved == "" {
		t.Fatalf("restore: %q %v", preserved, err)
	}
	if _, err = Load(destination); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(preserved); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(backup)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	if err = os.WriteFile(backup, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = Restore(backup, backup+".record.json", destination, service.policy, now.Add(4*time.Minute)); err == nil {
		t.Fatal("tampered backup restored")
	}
}
