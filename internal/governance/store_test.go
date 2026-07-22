package governance

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSnapshotRestartAndTamperDetection(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Deposit(p.ID, 100, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateEmergency(emergencyInput(now), "security-member", now)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "governance-state.json")
	if err = s.Save(path, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%o", info.Mode().Perm())
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := restored.Get(p.ID)
	if err != nil || got.Status != StatusDiscussion {
		t.Fatalf("proposal restore: %+v %v", got, err)
	}
	gotEmergency, err := restored.Emergency(a.ID, now)
	if err != nil || gotEmergency.Status != "pending_approval" {
		t.Fatalf("emergency restore: %+v %v", gotEmergency, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), "pending_approval", "active", 1))
	if err = os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = Load(path); !errors.Is(err, ErrForbidden) {
		t.Fatalf("tamper accepted: %v", err)
	}
}
