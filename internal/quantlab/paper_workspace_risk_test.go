package quantlab

import (
	"errors"
	"math"
	"path/filepath"
	"sync"
	"testing"
)

func TestNativePaperRiskDurableReceiptIsolationAndRestart(t *testing.T) {
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "native-paper")}
	first, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	second, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, service := range []*Service{first, second} {
		wg.Add(1)
		go func(service *Service) {
			defer wg.Done()
			receipt, err := service.submitPaperRisk("kill", "native-risk-key", "User requested halt", 0, 0)
			if err != nil || !receipt.Paper.KillSwitch {
				t.Errorf("risk receipt: %+v %v", receipt, err)
			}
		}(service)
	}
	wg.Wait()
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := reopened.submitPaperRisk("kill", "native-risk-key", "User requested halt", 0, 0)
	if err != nil || !receipt.Paper.KillSwitch {
		t.Fatal(receipt, err)
	}
	if _, err := reopened.submitPaperRisk("kill", "native-risk-key", "Changed request", 0, 0); !errors.Is(err, ErrConflict) {
		t.Fatal("changed intent did not conflict", err)
	}
	count := 0
	for _, event := range reopened.Snapshot()["audit"].([]AuditEvent) {
		if event.Action == "kill_switch_activated" {
			count++
		}
	}
	if count != 1 {
		t.Fatal("idempotent retries repeated mutation", count)
	}
	other, err := New(Config{StatePath: filepath.Join(t.TempDir(), "other-native-paper")})
	if err != nil {
		t.Fatal(err)
	}
	if other.Snapshot()["paper"].(PaperState).KillSwitch {
		t.Fatal("another workspace halted")
	}
	if _, err := other.submitPaperRisk("kill", "native-risk-key", "Other account halt", 0, 0); err != nil {
		t.Fatal("idempotency key leaked across workspace", err)
	}
}

func TestNativePaperReconciliationUsesOriginalEngineRiskAndCheckedArithmetic(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state")})
	if err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()["paper"].(PaperState)
	result, err := s.submitPaperRisk("reconcile", "reconcile-exact", "", before.Cash, before.Position)
	if err != nil || result.Paper.ReconciliationDelta != 0 || result.Paper.KillSwitch {
		t.Fatal(result, err)
	}
	result, err = s.submitPaperRisk("reconcile", "reconcile-drift", "", before.Cash+1, before.Position)
	if err != nil || result.Paper.ReconciliationDelta != 1 || !result.Paper.KillSwitch {
		t.Fatal(result, err)
	}
	if _, err := s.submitPaperRisk("reconcile", "reconcile-overflow", "", math.MinInt64, math.MaxInt64); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, exists := s.state.Idempotency["native-paper-risk:v1:"+hashBytes([]byte("reconcile-overflow"))]; exists {
		t.Fatal("invalid request persisted")
	}
	if _, err := s.submitPaperRisk("kill", "short", "Valid reason", 0, 0); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}

func TestNativePaperRiskFailedDurableSaveNeverReturnsSuccess(t *testing.T) {
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state")}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s.store = browserRollbackFailStore{s.store}
	if _, err := s.submitPaperRisk("kill", "failed-native-risk", "User requested halt", 0, 0); err == nil {
		t.Fatal("failed save returned success")
	}
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Snapshot()["paper"].(PaperState).KillSwitch {
		t.Fatal("failed save exposed a durable halt")
	}
	if _, ok := reopened.state.Idempotency["native-paper-risk:v1:"+hashBytes([]byte("failed-native-risk"))]; ok {
		t.Fatal("failed receipt retained")
	}
}
